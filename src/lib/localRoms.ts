const DB_NAME = 'luna-local-library';
const STORE_NAME = 'roms';
const DB_VERSION = 1;

export type LocalRom = { hash: string; title: string; bytes: ArrayBuffer; savedAt: number };

async function hashRom(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('Local ROM storage is unavailable in this browser.')); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'hash' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local ROM storage.'));
  });
}

export async function cacheRom(title: string, bytes: Uint8Array): Promise<string> {
  const hash = await hashRom(bytes);
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({ hash, title, bytes: bytes.slice().buffer, savedAt: Date.now() } satisfies LocalRom);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not cache the ROM locally.'));
  });
  database.close();
  return hash;
}

export async function getCachedRom(hash: string): Promise<LocalRom | null> {
  const database = await openDatabase();
  const value = await new Promise<LocalRom | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(hash);
    request.onsuccess = () => resolve(request.result as LocalRom | undefined);
    request.onerror = () => reject(request.error || new Error('Could not read the local ROM cache.'));
  });
  database.close();
  return value || null;
}
