export type PendingSave = { id?: number; userId: string; gameId: string; playerSlot: number; saveType: 'battery' | 'state'; bytes: ArrayBuffer; expectedRevision?: number; createdAt: number };
const DB = 'luna-local-saves';
const STORE = 'pending';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enqueueSave(save: PendingSave): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) { store.add(save); return; }
      const pending = item.value as PendingSave;
      if (pending.userId === save.userId && pending.gameId === save.gameId && pending.playerSlot === save.playerSlot && pending.saveType === save.saveType) item.delete();
      item.continue();
    };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listPendingSaves(): Promise<PendingSave[]> {
  const db = await openDb();
  const values = await new Promise<PendingSave[]>((resolve, reject) => { const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  db.close(); return values;
}

export async function removePendingSave(id: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  db.close();
}
