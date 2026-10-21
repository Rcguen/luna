/** Battery saves are local-first. IndexedDB commits the current save and its
 * previous version atomically; a failed/quota-limited transaction leaves the
 * last committed copy intact. ROM bytes are stored separately. */
export type BatteryTechnology = 1 | 2 | 3 | 4 | 5 | 6;
export type BatteryImage = { technology: BatteryTechnology; bytes: ArrayBuffer; checksum: string; savedAt: number };
export type LocalBattery = {
  id: string;
  romHash: string;
  ownerId: string;
  formatVersion: 1;
  saveType: 'battery';
  revision: number;
  current: BatteryImage;
  backup: BatteryImage | null;
  cloudRevision: number;
  cloudLocalRevision?: number;
};

const DB = 'luna-local-battery';
const STORE = 'saves';
const SIZES: Record<BatteryTechnology, number> = { 1: 32768, 2: 65536, 3: 131072, 4: 8192, 5: 512, 6: 65536 };

export function batterySize(type: number): number { return SIZES[type as BatteryTechnology] || 0; }
export function batteryKey(romHash: string, ownerId: string): string { return `v1:battery:${romHash}:${ownerId}`; }

export function localPlayerId(_userId: string | null = null): string {
  const key = 'luna:local-player-id';
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return `device:${id}`;
}

/** Read the stable device save and migrate the older auth-scoped key created
 * by Luna 0.1. The local key must not change while Supabase restores a session. */
export async function getLocalBatteryForUser(romHash: string, userId: string | null): Promise<{ ownerId: string; saved: Awaited<ReturnType<typeof getLocalBattery>> }> {
  const ownerId = localPlayerId();
  let saved = await getLocalBattery(romHash, ownerId);
  if (!saved && userId) {
    const legacy = await getLocalBattery(romHash, `user:${userId}`);
    if (legacy) {
      const migrated = await putLocalBattery(romHash, ownerId, legacy.image.technology, legacy.image.bytes);
      saved = { save: migrated, image: migrated.current, recovered: legacy.recovered };
    }
  }
  return { ownerId, saved };
}

export async function batteryChecksum(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('Local save storage is unavailable.')); return; }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local save storage.'));
  });
}

export async function getLocalBattery(romHash: string, ownerId: string): Promise<{ save: LocalBattery; image: BatteryImage; recovered: boolean } | null> {
  const db = await openDb();
  try {
    const record = await new Promise<LocalBattery | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(batteryKey(romHash, ownerId));
      request.onsuccess = () => resolve(request.result as LocalBattery | undefined);
      request.onerror = () => reject(request.error || new Error('Could not read the local save.'));
    });
    if (!record) return null;
    if (record.romHash !== romHash || record.ownerId !== ownerId || record.formatVersion !== 1 || record.saveType !== 'battery') throw new Error('Local save identity is incompatible.');
    for (const [image, recovered] of [[record.current, false], [record.backup, true]] as const) {
      if (image && image.bytes.byteLength === batterySize(image.technology) && await batteryChecksum(image.bytes) === image.checksum) return { save: record, image, recovered };
    }
    throw new Error('The local save and its backup failed checksum validation. No empty save was loaded.');
  } finally { db.close(); }
}

export async function putLocalBattery(romHash: string, ownerId: string, technology: BatteryTechnology, bytes: ArrayBuffer): Promise<LocalBattery> {
  if (bytes.byteLength !== batterySize(technology)) throw new Error('The battery-save size does not match its detected technology.');
  const checksum = await batteryChecksum(bytes);
  const db = await openDb();
  try {
    return await new Promise<LocalBattery>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const id = batteryKey(romHash, ownerId);
      let result: LocalBattery;
      const request = store.get(id);
      request.onsuccess = () => {
        const old = request.result as LocalBattery | undefined;
        if (old?.current.checksum === checksum && old.current.technology === technology) { result = old; return; }
        result = {
          id, romHash, ownerId, formatVersion: 1, saveType: 'battery',
          revision: (old?.revision || 0) + 1,
          current: { technology, bytes: bytes.slice(0), checksum, savedAt: Date.now() },
          backup: old?.current || null,
          cloudRevision: old?.cloudRevision || 0,
          cloudLocalRevision: old?.cloudLocalRevision || 0,
        };
        store.put(result);
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('Could not persist the battery save.'));
      tx.onabort = () => reject(tx.error || new Error('Local save write was interrupted.'));
    });
  } finally { db.close(); }
}

export async function setCloudRevision(romHash: string, ownerId: string, expectedLocalRevision: number, cloudRevision: number): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.get(batteryKey(romHash, ownerId));
      request.onsuccess = () => {
        const save = request.result as LocalBattery | undefined;
        if (save && save.revision === expectedLocalRevision) store.put({ ...save, cloudRevision, cloudLocalRevision: expectedLocalRevision });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not update cloud sync status.'));
    });
  } finally { db.close(); }
}
