import { useEffect, useState } from 'react';
import type { BatteryTechnology } from '../engine/wasmAdapter';
import type { GameRecord, SaveRecord } from '../lib/cloudSaves';
import { deleteSave, downloadSave, latestSave, listGames, listSaves, uploadSave } from '../lib/cloudSaves';
import { batterySize, getLocalBatteryForUser, localPlayerId, putLocalBattery, setCloudRevision } from '../lib/localBatterySaves';
import { ChoiceMenu } from './ChoiceMenu';

const saveTypeOptions = [{ value: 'battery', label: 'Battery save (.sav)' }, { value: 'state', label: 'Save state (not connected)' }] as const;
const technologyOptions = [
  { value: '1', label: 'SRAM · 32 KiB' },
  { value: '6', label: 'SRAM · 64 KiB' },
  { value: '2', label: 'Flash · 64 KiB' },
  { value: '3', label: 'Flash · 128 KiB' },
  { value: '4', label: 'EEPROM · 8 KiB' },
  { value: '5', label: 'EEPROM · 512 B' },
] as const;

function download(bytes: ArrayBuffer, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  URL.revokeObjectURL(url);
}

function safeName(title: string) { return title.replace(/\.(gba|gb|gbc)$/i, '').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '') || 'luna-save'; }

export function GameLibrary({ userId, refreshKey = 0, onLoadGame }: { userId: string | null; refreshKey?: number; onLoadGame: (game: GameRecord) => Promise<void> }) {
  const [games, setGames] = useState<GameRecord[]>([]); const [message, setMessage] = useState(''); const [saving, setSaving] = useState(false);
  useEffect(() => { if (!userId) { setGames([]); return; } void listGames(userId).then(setGames).catch((error) => setMessage(error.message)); }, [userId, refreshKey]);
  if (!userId) return null;

  const exportCurrent = async (game: GameRecord) => {
    const local = await getLocalBatteryForUser(game.rom_hash, userId);
    if (!local.saved) throw new Error('No local battery save exists yet. Play and use the game’s own save feature first.');
    download(local.saved.image.bytes, `${safeName(game.title)}.sav`);
  };
  const downloadCloudBackup = async (save: SaveRecord) => download(await downloadSave(save), `${save.save_type}-player-${save.player_slot}-r${save.revision}.bin`);
  const importBattery = async (game: GameRecord, file: File, technology: BatteryTechnology) => {
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength !== batterySize(technology)) throw new Error(`This file is ${bytes.byteLength} bytes; the selected save technology requires ${batterySize(technology)} bytes.`);
    if (!window.confirm('Replace the current local battery save? Luna will retain the previous valid save as a backup.')) return;
    setSaving(true); setMessage('Validating and importing local battery save…');
    try {
      const ownerId = localPlayerId(userId);
      const local = await putLocalBattery(game.rom_hash, ownerId, technology, bytes);
      const remote = await latestSave(userId, game.id, 1, 'battery');
      const uploaded = await uploadSave(userId, game.id, 1, 'battery', local.current.bytes, { expectedRevision: remote?.revision || 0 });
      if (uploaded) {
        await setCloudRevision(game.rom_hash, ownerId, local.revision, uploaded.revision);
        setMessage('Battery save imported locally and synced to cloud. It will be restored before the game starts.');
      } else setMessage('Battery save imported locally. Cloud sync is queued.');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };

  const run = async (operation: () => Promise<void>) => { try { await operation(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } };
  return <section className="library"><div className="library-heading"><div><p className="eyebrow">YOUR CLOUD LIBRARY</p><h2>My Games</h2></div><span className="muted">ROM stays on your device</span></div>{games.length === 0 ? <p className="muted">No imported games yet. Load a local ROM while signed in.</p> : games.map((game) => <GameRow key={game.id} game={game} onLoad={() => onLoadGame(game)} onExportCurrent={() => run(() => exportCurrent(game))} onDownloadCloud={(save) => run(() => downloadCloudBackup(save))} onDelete={async (save) => { try { await deleteSave(save); setMessage('Cloud backup deleted.'); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); throw error; } }} onImport={(file, technology) => importBattery(game, file, technology)} saving={saving} />)}{message && <p className="status" role="status">{message}</p>}</section>;
}

function GameRow({ game, onLoad, onExportCurrent, onDownloadCloud, onDelete, onImport, saving }: { game: GameRecord; onLoad: () => Promise<void>; onExportCurrent: () => Promise<void>; onDownloadCloud: (save: SaveRecord) => Promise<void>; onDelete: (save: SaveRecord) => Promise<void>; onImport: (file: File, technology: BatteryTechnology) => Promise<void>; saving: boolean }) {
  const [saves, setSaves] = useState<SaveRecord[]>([]);
  const [type, setType] = useState<'battery' | 'state'>('battery');
  const [technology, setTechnology] = useState<BatteryTechnology>(3);
  const reload = () => listSaves(game.user_id, game.id).then(setSaves).catch(() => undefined);

  useEffect(() => { void reload(); }, [game.user_id, game.id]);

  return <article className="game-row">
    <div className="game-row-heading">
      <div><strong title={game.title}>{game.title}</strong><p className="muted">Last played {game.last_played_at ? new Date(game.last_played_at).toLocaleDateString() : 'not yet'}</p></div>
      <button className="load-game-button" onClick={() => void onLoad()}>Load game</button>
    </div>
    <div className="save-tools">
      <ChoiceMenu label={`${game.title} save type`} value={type} options={saveTypeOptions} onChange={setType} />
      {type === 'battery' ? <>
        <ChoiceMenu label={`${game.title} battery technology`} value={String(technology)} options={technologyOptions} onChange={(value) => setTechnology(Number(value) as BatteryTechnology)} />
        <label className="file-button">Import .sav<input type="file" accept=".sav,.bin" disabled={saving} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImport(file, technology).then(reload); event.currentTarget.value = ''; }} /></label>
        <button className="secondary" disabled={saving} onClick={() => void onExportCurrent()}>Export current .sav</button>
      </> : <p className="muted">Save-state import/export is not connected yet. Battery saves are independent and safe to use.</p>}
    </div>
    {saves.length > 0 && <details className="save-history">
      <summary>Cloud backup history ({saves.length})</summary>
      <ul className="save-list">{saves.map((save) => <li key={save.id}>
        <span>{save.save_type} · P{save.player_slot} · revision {save.revision}</span>
        <button className="link-button" onClick={() => void onDownloadCloud(save)}>Download backup</button>
        <button className="link-button danger" onClick={() => void onDelete(save).then(reload).catch(() => undefined)}>Delete cloud copy</button>
      </li>)}</ul>
    </details>}
    <p className="muted">Player 1 battery saves are supported. Host-streaming guest saves remain disabled until an authenticated ownership transfer exists.</p>
  </article>;
}
