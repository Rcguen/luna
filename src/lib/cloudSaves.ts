import { enqueueSave, listPendingSaves, removePendingSave } from './localSaveQueue';
import { supabase } from './supabase';

export type GameRecord = { id: string; user_id: string; rom_hash: string; title: string; imported_at: string; last_played_at: string | null };
export type SaveRecord = { id: string; user_id: string; game_id: string; player_slot: number; save_type: 'battery' | 'state'; storage_path: string; file_size: number; checksum: string; revision: number; updated_at: string };

const locks = new Map<string, Promise<unknown>>();
async function sha256(bytes: ArrayBuffer): Promise<string> { const digest = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
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

export async function uploadSave(userId: string, gameId: string, playerSlot: number, saveType: 'battery' | 'state', bytes: ArrayBuffer): Promise<SaveRecord | null> {
  if (!bytes.byteLength || bytes.byteLength > 64 * 1024 * 1024) throw new Error('Save file size is invalid.');
  const key = `${userId}:${gameId}:${playerSlot}:${saveType}`;
  const previous = locks.get(key) || Promise.resolve();
  const operation = previous.then(async () => {
    const client = requireClient(); const checksum = await sha256(bytes);
    const { data: rows, error: listError } = await client.from('save_files').select('revision').match({ user_id: userId, game_id: gameId, player_slot: playerSlot, save_type: saveType }).order('revision', { ascending: false }).limit(1);
    if (listError) throw listError;
    const revision = ((rows?.[0]?.revision as number | undefined) || 0) + 1;
    const storagePath = `${userId}/${gameId}/${playerSlot}/${saveType}/${revision}-${checksum}.bin`;
    const { error: uploadError } = await client.storage.from('luna-saves').upload(storagePath, bytes, { contentType: 'application/octet-stream', upsert: false });
    if (uploadError) throw uploadError;
    const { data, error } = await client.from('save_files').insert({ user_id: userId, game_id: gameId, player_slot: playerSlot, save_type: saveType, storage_path: storagePath, file_size: bytes.byteLength, checksum, revision }).select().single();
    if (error) throw error; return data as SaveRecord;
  }).catch(async (error) => { if (!navigator.onLine) { await enqueueSave({ userId, gameId, playerSlot, saveType, bytes, createdAt: Date.now() }); return null; } throw error; });
  locks.set(key, operation); try { return await operation; } finally { if (locks.get(key) === operation) locks.delete(key); }
}

export async function flushPendingSaves(): Promise<number> {
  if (!navigator.onLine || !supabase) return 0;
  let flushed = 0;
  for (const pending of await listPendingSaves()) {
    try { const saved = await uploadSave(pending.userId, pending.gameId, pending.playerSlot, pending.saveType, pending.bytes); if (saved && pending.id !== undefined) { await removePendingSave(pending.id); flushed++; } } catch { /* retain until the next online event */ }
  }
  return flushed;
}

if (typeof window !== 'undefined') window.addEventListener('online', () => { void flushPendingSaves(); });

export async function downloadSave(record: SaveRecord): Promise<ArrayBuffer> { const { data, error } = await requireClient().storage.from('luna-saves').download(record.storage_path); if (error) throw error; return data.arrayBuffer(); }
export async function deleteSave(record: SaveRecord): Promise<void> { const client = requireClient(); const { error: storageError } = await client.storage.from('luna-saves').remove([record.storage_path]); if (storageError) throw storageError; const { error } = await client.from('save_files').delete().eq('id', record.id).eq('user_id', record.user_id); if (error) throw error; }
