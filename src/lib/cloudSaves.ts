import { enqueueSave, listPendingSaves, removePendingSave } from './localSaveQueue';
import { supabase } from './supabase';

export type GameRecord = { id: string; user_id: string; rom_hash: string; title: string; imported_at: string; last_played_at: string | null };
export type SaveRecord = { id: string; user_id: string; game_id: string; player_slot: number; save_type: 'battery' | 'state'; storage_path: string; file_size: number; checksum: string; revision: number; updated_at: string; created_at?: string; pinned?: boolean };
export type UploadOptions = { expectedRevision?: number; queueOnFailure?: boolean };

export class SaveConflictError extends Error {
  constructor(message = 'A newer cloud save exists. Luna kept the local save and did not overwrite it.') { super(message); this.name = 'SaveConflictError'; }
}

const locks = new Map<string, Promise<unknown>>();
export async function sha256(bytes: ArrayBuffer): Promise<string> { const digest = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function requireClient() { if (!supabase) throw new Error('Cloud saves are not configured.'); return supabase; }

export async function registerGame(userId: string, title: string, romBytes: Uint8Array): Promise<GameRecord> {
  const client = requireClient(); const romHash = await sha256(romBytes.buffer as ArrayBuffer);
  const { data, error } = await client.from('games').upsert({ user_id: userId, rom_hash: romHash, title, last_played_at: new Date().toISOString() }, { onConflict: 'user_id,rom_hash' }).select().single();
  if (error) throw error; return data as GameRecord;
}

export async function listGames(userId: string): Promise<GameRecord[]> {
  const { data, error } = await requireClient().from('games').select('*').eq('user_id', userId).order('last_played_at', { ascending: false, nullsFirst: false });
  if (error) throw error; return (data || []) as GameRecord[];
}

export async function listSaves(userId: string, gameId: string): Promise<SaveRecord[]> {
  const { data, error } = await requireClient().from('save_files').select('*').eq('user_id', userId).eq('game_id', gameId).order('revision', { ascending: false });
  if (error) throw error; return (data || []) as SaveRecord[];
}

export async function setSavePinned(record: SaveRecord, pinned: boolean): Promise<SaveRecord> {
  const { data, error } = await requireClient().from('save_files').update({ pinned }).eq('id', record.id).eq('user_id', record.user_id).select().single();
  if (error) throw error;
  return data as SaveRecord;
}

export async function latestSave(userId: string, gameId: string, playerSlot: number, saveType: 'battery' | 'state'): Promise<SaveRecord | null> {
  const { data, error } = await requireClient().from('save_files').select('*').match({ user_id: userId, game_id: gameId, player_slot: playerSlot, save_type: saveType }).order('revision', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data as SaveRecord | null;
}

function retryable(error: unknown): boolean {
  if (!navigator.onLine || error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /fetch|network|timeout|temporar|connection/i.test(message);
}

async function uploadOnce(userId: string, gameId: string, playerSlot: number, saveType: 'battery' | 'state', bytes: ArrayBuffer, expectedRevision?: number): Promise<SaveRecord> {
  const client = requireClient();
  const checksum = await sha256(bytes);
  const latest = await latestSave(userId, gameId, playerSlot, saveType);
  if (latest?.checksum === checksum && latest.file_size === bytes.byteLength) return latest;
  const cloudRevision = latest?.revision || 0;
  if (expectedRevision !== undefined && cloudRevision !== expectedRevision) throw new SaveConflictError();
  const revision = cloudRevision + 1;
  const storagePath = `${userId}/${gameId}/${playerSlot}/${saveType}/${revision}-${checksum}.bin`;
  const { error: uploadError } = await client.storage.from('luna-saves').upload(storagePath, bytes, { contentType: 'application/octet-stream', upsert: false });
  if (uploadError) throw uploadError;
  const { data, error } = await client.from('save_files').insert({ user_id: userId, game_id: gameId, player_slot: playerSlot, save_type: saveType, storage_path: storagePath, file_size: bytes.byteLength, checksum, revision }).select().single();
  if (!error) {
    const saved = data as SaveRecord;
    // Retention runs only after a successful metadata insert. Existing rows
    // are untouched until the next successful cloud save, so rollout is safe.
    await pruneSaveBackups(userId, gameId, playerSlot, saveType, 10).catch((cleanupError) => {
      console.warn('Cloud save retention cleanup deferred:', cleanupError);
    });
    return saved;
  }
  const { error: cleanupError } = await client.storage.from('luna-saves').remove([storagePath]);
  if (cleanupError) throw new Error(`Save metadata failed and the uploaded orphan could not be removed: ${cleanupError.message}`);
  throw error;
}

export async function uploadSave(userId: string, gameId: string, playerSlot: number, saveType: 'battery' | 'state', bytes: ArrayBuffer, options: UploadOptions = {}): Promise<SaveRecord | null> {
  if (!bytes.byteLength || bytes.byteLength > 64 * 1024 * 1024) throw new Error('Save file size is invalid.');
  if (!Number.isInteger(playerSlot) || playerSlot < 1 || playerSlot > 4) throw new Error('Player slot is invalid.');
  const key = `${userId}:${gameId}:${playerSlot}:${saveType}`;
  const previous = locks.get(key) || Promise.resolve();
  const operation = previous.then(() => uploadOnce(userId, gameId, playerSlot, saveType, bytes, options.expectedRevision)).catch(async (error) => {
    if (options.queueOnFailure !== false && !(error instanceof SaveConflictError) && retryable(error)) {
      await enqueueSave({ userId, gameId, playerSlot, saveType, bytes: bytes.slice(0), expectedRevision: options.expectedRevision, createdAt: Date.now() });
      return null;
    }
    throw error;
  });
  locks.set(key, operation); try { return await operation; } finally { if (locks.get(key) === operation) locks.delete(key); }
}

export async function flushPendingSaves(): Promise<number> {
  if (!navigator.onLine || !supabase) return 0;
  let flushed = 0;
  for (const pending of await listPendingSaves()) {
    try {
      const saved = await uploadSave(pending.userId, pending.gameId, pending.playerSlot, pending.saveType, pending.bytes, { expectedRevision: pending.expectedRevision, queueOnFailure: false });
      if (saved && pending.id !== undefined) { await removePendingSave(pending.id); flushed += 1; }
    } catch { /* Keep the original queued item for retry or manual conflict resolution. */ }
  }
  return flushed;
}

if (typeof window !== 'undefined') window.addEventListener('online', () => { void flushPendingSaves(); });

export async function downloadSave(record: SaveRecord): Promise<ArrayBuffer> {
  const expectedPath = `${record.user_id}/${record.game_id}/${record.player_slot}/${record.save_type}/${record.revision}-${record.checksum}.bin`;
  if (record.storage_path !== expectedPath) throw new Error('Cloud save metadata contains an invalid storage path.');
  const { data, error } = await requireClient().storage.from('luna-saves').download(record.storage_path);
  if (error) throw error;
  const bytes = await data.arrayBuffer();
  if (bytes.byteLength !== record.file_size || await sha256(bytes) !== record.checksum) throw new Error('Cloud save failed size or SHA-256 verification. The local save was not changed.');
  return bytes;
}

export function selectRetentionCandidates(records: SaveRecord[], keep = 10): SaveRecord[] {
  const ordered = records.slice().sort((a, b) => b.revision - a.revision);
  if (ordered.length <= keep) return [];
  const protectedIds = new Set(ordered.slice(0, keep).map((record) => record.id));
  for (const record of ordered) if (record.pinned) protectedIds.add(record.id);
  return ordered.slice().reverse().filter((record) => !protectedIds.has(record.id));
}

/** Keep the newest ten verified backups, plus every manually pinned backup.
 * The newest record is always protected. A candidate is downloaded and
 * checksum-verified before deletion; failed verification leaves it intact. */
export async function pruneSaveBackups(userId: string, gameId: string, playerSlot: number, saveType: 'battery' | 'state', keep = 10): Promise<number> {
  const records = (await listSaves(userId, gameId)).filter((record) => record.player_slot === playerSlot && record.save_type === saveType).sort((a, b) => b.revision - a.revision);
  const candidates = selectRetentionCandidates(records, keep);
  let removed = 0;
  for (const record of candidates) {
    try {
      await downloadSave(record);
      await deleteSave(record);
      removed += 1;
    } catch (error) {
      console.warn(`Cloud backup ${record.revision} was retained because cleanup verification failed:`, error);
    }
  }
  return removed;
}

export async function deleteSave(record: SaveRecord): Promise<void> {
  const client = requireClient();
  const current = await latestSave(record.user_id, record.game_id, record.player_slot, record.save_type);
  if (current?.id === record.id) throw new Error('The current cloud save is protected. Create a newer backup before deleting this one.');
  const { error: storageError } = await client.storage.from('luna-saves').remove([record.storage_path]);
  if (storageError) throw storageError;
  const { error } = await client.from('save_files').delete().eq('id', record.id).eq('user_id', record.user_id);
  if (error) throw new Error(`Storage object removed, but save metadata cleanup failed and will need retry: ${error.message}`);
}
