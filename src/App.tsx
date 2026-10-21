import { useEffect, useRef, useState } from 'react';
import { GbaEngine, type BatteryTechnology, type EngineDiagnostics, type EngineFrame } from './engine/wasmAdapter';
import { type Diagnostics, type PlayerSlot } from './netplay/peerSession';
import { MultiPeerSession, type MultiGuestRequest } from './netplay/multiPeerSession';
import { DistributedPeerSession, type DistributedInput } from './netplay/distributedPeerSession';
import { TouchControls } from './components/TouchControls';
import { HomeView, type OnlineMode } from './components/HomeView';
import { downloadSave, latestSave, listGames, registerGame, SaveConflictError, uploadSave, type GameRecord } from './lib/cloudSaves';
import { cacheRom, getCachedRom, hashRom } from './lib/localRoms';
import { batterySize, getLocalBatteryForUser, putLocalBattery, setCloudRevision } from './lib/localBatterySaves';
import type { Session } from '@supabase/supabase-js';
import type { AudioMessage, FrameMessage } from './netplay/protocol';
import './styles.css';

type Screen = 'home' | 'solo' | 'host' | 'guest' | 'distributed-host' | 'distributed-guest';
type StreamQuality = 'auto' | 'smooth' | 'balanced' | 'sharp';
type PendingCloudBattery = { userId: string; gameId: string; romHash: string; ownerId: string; localRevision: number; cloudRevision: number; bytes: ArrayBuffer };
const EMPTY_DIAGNOSTICS: Diagnostics = { signaling: 'idle', connection: 'idle', ice: 'idle', gathering: 'idle', candidate: 'idle', channel: 'idle', rtt: null, fps: null, error: '' };
const EMPTY_ENGINE: EngineDiagnostics = { wasm: 'idle', emulator: 'idle', rom: 'waiting', framesExecuted: 0, framesRendered: 0, lastFrame: '0×0', audioFrames: 0, audioBatches: 0, audioRate: 32768, error: '' };
let audioNextTime = 0;

function resetAudioClock() {
  audioNextTime = 0;
}
const lastGameKey = (userId: string) => `luna:last-game:${userId}`;

function formatCode(code: string) { return code ? `${code.slice(0, 3)} ${code.slice(3)}` : '------'; }

function resolveBatteryTechnology(engine: GbaEngine, player: number, bytes: ArrayBuffer): BatteryTechnology {
  const candidates = ([1, 2, 3, 4, 5, 6] as BatteryTechnology[]).filter((technology) => batterySize(technology) === bytes.byteLength);
  const detected = engine.batteryType(player) as BatteryTechnology;
  if (candidates.includes(detected)) return detected;
  if (candidates.length === 1) return candidates[0];
  throw new Error('This 64 KiB save is ambiguous between Flash and SRAM. Import it manually and choose the correct technology.');
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
      return;
    }
    await document.documentElement.requestFullscreen?.();
    // Android browsers only allow orientation locking from fullscreen. Keep
    // this best-effort so browsers without the API still enter fullscreen.
    try { await screen.orientation?.lock?.('landscape'); } catch { /* optional */ }
  } catch { /* fullscreen can be denied by the browser or OS */ }
}

function streamConfig(quality: StreamQuality, rtt: number | null) {
  // Keep the host's encode work and the reliable DataChannel queue bounded.
  // Fewer, cleaner frames are more usable than a 30 FPS stream that stalls.
  if (quality === 'smooth') return { interval: 50, jpeg: 0.65 };
  if (quality === 'sharp') return { interval: 40, jpeg: 0.92 };
  if (quality === 'balanced') return { interval: 40, jpeg: 0.88 };
  if (rtt !== null && rtt > 150) return { interval: 67, jpeg: 0.68 };
  if (rtt !== null && rtt > 80) return { interval: 50, jpeg: 0.78 };
  return { interval: 50, jpeg: 0.88 };
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [room, setRoom] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [roomCapacity, setRoomCapacity] = useState(2);
  // Keep legacy room links compatible: distributed rooms opt in through
  // mode=distributed, while older stream invites remain stream sessions.
  const [onlineMode, setOnlineMode] = useState<OnlineMode>('stream');
  const [status, setStatus] = useState('Ready for a 2-player session.');
  const [romName, setRomName] = useState('No ROM loaded');
  const [romHash, setRomHash] = useState('');
  const [romLoaded, setRomLoaded] = useState(false);
  const [romLoading, setRomLoading] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [currentGame, setCurrentGame] = useState<GameRecord | null>(null);
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [pendingGuest, setPendingGuest] = useState<MultiGuestRequest | null>(null);
  const [approved, setApproved] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [assignedSlot, setAssignedSlot] = useState<PlayerSlot | null>(null);
  const [playerStates, setPlayerStates] = useState<Record<number, 'waiting' | 'pending' | 'connected' | 'disconnected'>>({ 1: 'connected', 2: 'waiting', 3: 'waiting', 4: 'waiting' });
  const [diagnostics, setDiagnostics] = useState(EMPTY_DIAGNOSTICS);
  const [engineStatus, setEngineStatus] = useState(EMPTY_ENGINE);
  const [guestHasVideo, setGuestHasVideo] = useState(false);
  const [streamQuality, setStreamQuality] = useState<StreamQuality>('auto');
  const [hostPanelOpen, setHostPanelOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState('Battery saves stay on this device.');
  const engineRef = useRef<GbaEngine | null>(null);
  const activeSaveRef = useRef<{ engine: GbaEngine; romHash: string; ownerId: string } | null>(null);
  const cloudSaveRef = useRef<{ userId: string; gameId: string; romHash: string } | null>(null);
  const saveWriteRef = useRef<Promise<void>>(Promise.resolve());
  const lastSavedRevision = useRef(0);
  const cloudPendingRef = useRef<PendingCloudBattery | null>(null);
  const cloudTimerRef = useRef<number | null>(null);
  const cloudInFlightRef = useRef<Promise<void> | null>(null);
  const lastCloudUploadAt = useRef(0);
  const romBytesRef = useRef<Uint8Array | null>(null);
  const sessionRef = useRef<MultiPeerSession | null>(null);
  const distributedSessionRef = useRef<DistributedPeerSession | null>(null);
  const hostCanvas = useRef<HTMLCanvasElement>(null);
  const guestCanvas = useRef<HTMLCanvasElement>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const guestKeys = useRef(0);
  const lastEngineUpdate = useRef(0);
  const captureCanvases = useRef<Record<number, HTMLCanvasElement>>({});
  const captureBusy = useRef(new Set<number>());
  const guestDecodeBusy = useRef(false);
  const guestPendingFrame = useRef<FrameMessage | null>(null);
  const restoringLibrary = useRef<string | null>(null);
  const distributedInputs = useRef(new Map<number, Map<PlayerSlot, number>>());
  const distributedNextTick = useRef(0);
  const distributedLastSentTick = useRef(-1);
  const distributedLastSentKeys = useRef(-1);
  const distributedStarted = useRef(false);
  const distributedAssignedSlot = useRef<PlayerSlot | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invitedRoom = params.get('room')?.replace(/\D/g, '') || '';
    if (invitedRoom.length === 6) setRoom(invitedRoom);
    if (params.get('mode') === 'distributed') setOnlineMode('distributed');
    const invitedPlayers = Number(params.get('players'));
    if ([2, 3, 4].includes(invitedPlayers)) setRoomCapacity(invitedPlayers);
  }, []);

  const newEngine = async (players = roomCapacity) => {
    engineRef.current?.stop();
    const engine = new GbaEngine();
    await engine.start(players);
    engineRef.current = engine;
    setEngineStatus(engine.diagnostics());
    return engine;
  };

  const restoreLocalBattery = async (engine: GbaEngine, bytes: Uint8Array) => {
    if (!engine.supportsBatterySave()) throw new Error('This WASM build cannot persist battery saves. The game was not started to protect your progress.');
    const hash = await hashRom(bytes);
    const local = await getLocalBatteryForUser(hash, session?.user.id || null);
    const ownerId = local.ownerId;
    let saved = local.saved;
    let message = saved ? saved.recovered ? 'Restored the verified local backup; the newest save was damaged.' : 'Restored your local battery save.' : 'No previous battery save found. Progress will save locally.';
    const cloud = session && currentGame?.rom_hash === hash ? { userId: session.user.id, gameId: currentGame.id } : null;
    if (cloud) {
      try {
        const remote = await latestSave(cloud.userId, cloud.gameId, 1, 'battery');
        if (remote && saved?.image.checksum === remote.checksum) {
          await setCloudRevision(hash, ownerId, saved.save.revision, remote.revision);
          saved.save.cloudRevision = remote.revision;
          saved.save.cloudLocalRevision = saved.save.revision;
        } else if (remote && !saved) {
          const remoteBytes = await downloadSave(remote);
          const technology = resolveBatteryTechnology(engine, 0, remoteBytes);
          const local = await putLocalBattery(hash, ownerId, technology, remoteBytes);
          await setCloudRevision(hash, ownerId, local.revision, remote.revision);
          saved = { save: { ...local, cloudRevision: remote.revision, cloudLocalRevision: local.revision }, image: local.current, recovered: false };
          message = 'Downloaded, verified, and restored your cloud battery save.';
        } else if (remote && saved && remote.revision > saved.save.cloudRevision) {
          if (saved.save.cloudLocalRevision === saved.save.revision) {
            const remoteBytes = await downloadSave(remote);
            const technology = resolveBatteryTechnology(engine, 0, remoteBytes);
            const local = await putLocalBattery(hash, ownerId, technology, remoteBytes);
            await setCloudRevision(hash, ownerId, local.revision, remote.revision);
            saved = { save: { ...local, cloudRevision: remote.revision, cloudLocalRevision: local.revision }, image: local.current, recovered: false };
            message = 'A newer verified cloud save replaced the previously synced local copy; the old local save remains as a backup.';
          } else {
            message = 'Local and cloud saves both changed. Luna kept the local save; export a backup before resolving the conflict.';
          }
        }
      } catch (error) {
        message = `${message} Cloud restore unavailable: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (saved) engine.importBattery(0, saved.image.technology, saved.image.bytes);
    activeSaveRef.current = { engine, romHash: hash, ownerId };
    lastSavedRevision.current = saved?.save.revision || 0;
    setSaveStatus(message);
  };

  const flushCloudSync = async (): Promise<void> => {
    if (cloudInFlightRef.current) return cloudInFlightRef.current;
    const pending = cloudPendingRef.current;
    if (!pending) return;
    cloudPendingRef.current = null;
    const operation = (async () => {
      try {
        const uploaded = await uploadSave(pending.userId, pending.gameId, 1, 'battery', pending.bytes, { expectedRevision: pending.cloudRevision });
        lastCloudUploadAt.current = Date.now();
        if (uploaded) {
          await setCloudRevision(pending.romHash, pending.ownerId, pending.localRevision, uploaded.revision);
          if (activeSaveRef.current?.romHash === pending.romHash) setSaveStatus('Battery save stored locally and synced to cloud.');
        } else if (activeSaveRef.current?.romHash === pending.romHash) {
          setSaveStatus('Battery save stored locally; cloud upload is queued for retry.');
        }
      } catch (error) {
        if (!(error instanceof SaveConflictError)) cloudPendingRef.current = pending;
        if (activeSaveRef.current?.romHash === pending.romHash) setSaveStatus(error instanceof SaveConflictError ? error.message : `Battery save is safe locally; cloud sync failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    cloudInFlightRef.current = operation;
    try { await operation; } finally { cloudInFlightRef.current = null; }
    // If local autosave changed while the upload was in flight, immediately
    // continue with the newest snapshot instead of leaving it for a later tab
    // lifecycle event. A failed retry reuses the same object and is not spun.
    if (cloudPendingRef.current && cloudPendingRef.current !== pending) await flushCloudSync();
  };

  const scheduleCloudSync = (pending: PendingCloudBattery, immediate = false) => {
    cloudPendingRef.current = pending;
    if (immediate) {
      if (cloudTimerRef.current !== null) { window.clearTimeout(cloudTimerRef.current); cloudTimerRef.current = null; }
      void flushCloudSync();
      return;
    }
    if (cloudTimerRef.current !== null) return;
    const delay = lastCloudUploadAt.current === 0 ? 0 : Math.max(0, 30000 - (Date.now() - lastCloudUploadAt.current));
    cloudTimerRef.current = window.setTimeout(() => { cloudTimerRef.current = null; void flushCloudSync(); }, delay);
  };

  const persistLocalBattery = (flushCloud = false): Promise<void> => {
    const active = activeSaveRef.current;
    if (!active) return flushCloud ? flushCloudSync() : Promise.resolve();
    let image;
    try { image = active.engine.exportBattery(0); }
    catch (error) { setSaveStatus(`Local save failed: ${error instanceof Error ? error.message : String(error)}`); return Promise.reject(error); }
    if (!image) return flushCloud ? flushCloudSync() : Promise.resolve(); // The game has not initialized SRAM/Flash/EEPROM.
    const { romHash, ownerId } = active;
    saveWriteRef.current = saveWriteRef.current.catch(() => undefined).then(async () => {
      try {
        const saved = await putLocalBattery(romHash, ownerId, image.technology, image.bytes);
        if (activeSaveRef.current === active && saved.revision !== lastSavedRevision.current) {
          lastSavedRevision.current = saved.revision;
          setSaveStatus('Battery save stored on this device.');
        }
        const cloud = cloudSaveRef.current;
        if (cloud?.romHash === romHash && saved.cloudLocalRevision !== saved.revision) {
          scheduleCloudSync({ userId: cloud.userId, gameId: cloud.gameId, romHash, ownerId, localRevision: saved.revision, cloudRevision: saved.cloudRevision, bytes: saved.current.bytes.slice(0) }, flushCloud);
        }
      } catch (error) {
        setSaveStatus(`Local save failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    });
    return saveWriteRef.current.then(() => flushCloud ? flushCloudSync() : undefined);
  };

  useEffect(() => {
    cloudSaveRef.current = session && currentGame ? { userId: session.user.id, gameId: currentGame.id, romHash: currentGame.rom_hash } : null;
  }, [session, currentGame]);

  const ensureAudio = async () => {
    if (!audioContext.current) {
      audioContext.current = new AudioContext();
      resetAudioClock();
      (window as Window & { kirbyAudio?: AudioContext }).kirbyAudio = audioContext.current;
    }
    await audioContext.current.resume().catch(() => undefined);
  };

  const renderGuestFrame = (frame: FrameMessage) => {
    setGuestHasVideo(true);
    guestPendingFrame.current = frame;
    if (guestDecodeBusy.current) return;
    guestDecodeBusy.current = true;
    void (async () => {
      try {
        while (guestPendingFrame.current) {
          const next = guestPendingFrame.current;
          guestPendingFrame.current = null;
          const bitmap = await createImageBitmap(new Blob([next.data], { type: 'image/jpeg' }));
          const canvas = guestCanvas.current;
          if (canvas) {
            if (canvas.width !== next.width || canvas.height !== next.height) {
              canvas.width = next.width;
              canvas.height = next.height;
            }
            canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
          }
          bitmap.close();
        }
      } catch (_) {
        setStatus('A guest video frame could not be decoded.');
      } finally {
        guestDecodeBusy.current = false;
        if (guestPendingFrame.current) renderGuestFrame(guestPendingFrame.current);
      }
    })();
  };

  const makeEvents = (hostSide: boolean) => ({
    status: (text: string) => setStatus(text),
    diagnostics: (value: Diagnostics) => setDiagnostics(value),
    guestRequest: (request: MultiGuestRequest) => { setPendingGuest(request); setHostPanelOpen(true); setPlayerStates((states) => ({ ...states, [request.slot]: 'pending' })); },
    input: (slot: PlayerSlot, keys: number) => { if (hostSide) engineRef.current?.setKeys(slot - 1, keys); },
    // This callback is created before the guest receives its assigned slot.
    // Do not capture the initial null state: the host session already routes
    // only the approved slot to this guest connection.
    frame: (_slot: PlayerSlot, frame: FrameMessage) => { if (!hostSide) renderGuestFrame(frame); },
    audio: (_slot: PlayerSlot, audio: AudioMessage) => { if (!hostSide) playAudio(audio); },
    connection: (slot: PlayerSlot, state: 'pending' | 'connected' | 'disconnected', capacity?: number) => { setPlayerStates((states) => { const next = { ...states, [slot]: state }; if (hostSide) setApproved(Object.entries(next).some(([player, value]) => Number(player) > 1 && value === 'connected')); return next; }); if (state === 'connected') { setApproved(true); setAssignedSlot(slot); if (capacity) setRoomCapacity(capacity); } if (state === 'disconnected') { if (hostSide) engineRef.current?.setKeys(slot - 1, 0); } },
    closed: () => { setApproved(false); setAssignedSlot(null); setGuestHasVideo(false); setStatus('Peer disconnected. Input released.'); if (hostSide) for (let slot = 1; slot < roomCapacity; slot += 1) engineRef.current?.setKeys(slot, 0); },
  });

  const makeDistributedEvents = (hostSide: boolean) => ({
    status: (text: string) => setStatus(text),
    diagnostics: (value: Diagnostics) => setDiagnostics(value),
    guestRequest: (request: MultiGuestRequest) => { setPendingGuest(request); setHostPanelOpen(true); setPlayerStates((states) => ({ ...states, [request.slot]: 'pending' })); },
    input: (value: DistributedInput) => {
      const tick = distributedInputs.current.get(value.tick) || new Map<PlayerSlot, number>();
      tick.set(value.slot, value.keys);
      distributedInputs.current.set(value.tick, tick);
    },
    started: (tick: number) => {
      distributedStarted.current = true;
      distributedNextTick.current = tick;
      distributedLastSentTick.current = -1;
      distributedLastSentKeys.current = -1;
      setGameStarted(true);
      setStatus('Distributed link started. Each device is rendering its own local emulator.');
    },
    connection: (slot: PlayerSlot, state: 'pending' | 'connected' | 'disconnected', capacity?: number) => {
      setPlayerStates((states) => ({ ...states, [slot]: state }));
      if (state === 'connected') {
        setApproved(true);
        if (!hostSide) {
          distributedAssignedSlot.current = slot;
          setAssignedSlot(slot);
          distributedSessionRef.current?.markReady();
        }
        if (capacity) setRoomCapacity(capacity);
      }
      if (state === 'disconnected') {
        distributedStarted.current = false;
        setGameStarted(false);
        setStatus('Peer disconnected. Distributed emulation paused.');
      }
    },
    closed: () => {
      distributedStarted.current = false;
      distributedInputs.current.clear();
      setApproved(false);
      setAssignedSlot(null);
      distributedAssignedSlot.current = null;
      setGameStarted(false);
      setStatus('Peer disconnected. Input released.');
    },
  });

  const startHost = async () => {
    try {
      if (romLoading) { setStatus('ROM is still loading. Please wait a moment.'); return; }
      if (!romBytesRef.current) { setStatus('Load your legal ROM before creating a room.'); return; }
      setStatus('Starting the linked host engine…');
      const engine = await newEngine(roomCapacity);
      if (romBytesRef.current) engine.loadRom(romBytesRef.current);
      await restoreLocalBattery(engine, romBytesRef.current);
      const session = new MultiPeerSession(makeEvents(true));
      sessionRef.current = session;
      await ensureAudio();
      const code = await session.host(roomCapacity);
      setRoomCode(code);
      setGameStarted(Boolean(romBytesRef.current));
      setScreen('host');
    } catch (error) { engineRef.current?.fail(error); setEngineStatus(engineRef.current?.diagnostics() || EMPTY_ENGINE); setStatus(`Failed to start emulator: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const startDistributedHost = async () => {
    try {
      if (romLoading) { setStatus('ROM is still loading. Please wait a moment.'); return; }
      if (!romBytesRef.current) { setStatus('Load the same legal ROM on both devices before creating a distributed room.'); return; }
      const localHash = romHash || await hashRom(romBytesRef.current);
      setRomHash(localHash);
      setStatus('Starting distributed link mode…');
      const engine = await newEngine(roomCapacity);
      engine.loadRom(romBytesRef.current);
      await ensureAudio();
      const session = new DistributedPeerSession(makeDistributedEvents(true));
      distributedSessionRef.current = session;
      const code = await session.host(roomCapacity, localHash);
      distributedInputs.current.clear();
      distributedStarted.current = false;
      setRoomCode(code);
      setApproved(false);
      setAssignedSlot(null);
      setGameStarted(false);
      setScreen('distributed-host');
      session.markReady();
    } catch (error) { engineRef.current?.fail(error); setEngineStatus(engineRef.current?.diagnostics() || EMPTY_ENGINE); setStatus(`Failed to start distributed mode: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const startSolo = async () => {
    try {
      if (romLoading) { setStatus('ROM is still loading. Please wait a moment.'); return; }
      if (!romBytesRef.current) { setStatus('Select your legal ROM first.'); return; }
      setStatus('Starting solo emulator…');
      await ensureAudio();
      const engine = await newEngine(1);
      engine.loadRom(romBytesRef.current);
      await restoreLocalBattery(engine, romBytesRef.current);
      setRomLoaded(true); setGameStarted(true); setScreen('solo'); setStatus('Solo game running.');
    } catch (error) { engineRef.current?.fail(error); setEngineStatus(engineRef.current?.diagnostics() || EMPTY_ENGINE); setStatus(`Failed to start solo emulator: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const joinRoom = async () => {
    if (onlineMode === 'distributed') {
      await joinDistributedRoom();
      return;
    }
    try {
      const clean = room.replace(/\D/g, '');
      if (clean.length !== 6) { setStatus('Enter the six-digit room code.'); return; }
      setStatus('Connecting to host…');
      setGuestHasVideo(false);
      const session = new MultiPeerSession(makeEvents(false));
      sessionRef.current = session;
      await ensureAudio();
      await session.join(clean);
      setRoomCode(clean);
      setScreen('guest');
      await audioContext.current.resume().catch(() => undefined);
    } catch (error) { setStatus(`Connection failed: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const joinDistributedRoom = async () => {
    try {
      const clean = room.replace(/\D/g, '');
      if (clean.length !== 6) { setStatus('Enter the six-digit room code.'); return; }
      if (!romBytesRef.current) { setStatus('Load the exact same legal ROM before joining distributed mode.'); return; }
      const localHash = romHash || await hashRom(romBytesRef.current);
      setRomHash(localHash);
      setStatus('Starting local emulator and connecting…');
      const engine = await newEngine(roomCapacity);
      engine.loadRom(romBytesRef.current);
      await ensureAudio();
      const session = new DistributedPeerSession(makeDistributedEvents(false));
      distributedSessionRef.current = session;
      distributedInputs.current.clear();
      distributedStarted.current = false;
      await session.join(clean, localHash);
      setRoomCode(clean);
      setGameStarted(false);
      setScreen('distributed-guest');
      await audioContext.current?.resume().catch(() => undefined);
    } catch (error) { engineRef.current?.fail(error); setEngineStatus(engineRef.current?.diagnostics() || EMPTY_ENGINE); setStatus(`Distributed connection failed: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const loadRom = async (file: File) => {
    if (screen !== 'home') { setStatus('End the current session before changing ROMs so its save can be flushed safely.'); return; }
    setRomLoading(true);
    setStatus(`Loading ${file.name}…`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const localHash = await hashRom(bytes);
      const cachedHash = await cacheRom(file.name, bytes).catch(() => '');
      // Publish the bytes before the asynchronous WASM startup so a fast
      // click on Create room/Play solo cannot observe a false empty state.
      romBytesRef.current = bytes;
      setRomHash(localHash);
      if (!engineRef.current) await newEngine();
      engineRef.current?.loadRom(bytes);
      setRomName(file.name);
      setRomLoaded(true);
      if (session) {
        try {
          const game = await registerGame(session.user.id, file.name, bytes);
          setCurrentGame(game);
          localStorage.setItem(lastGameKey(session.user.id), game.id);
          setLibraryRefresh((value) => value + 1);
        } catch (error) { setStatus(`ROM loaded locally; cloud metadata unavailable: ${error instanceof Error ? error.message : String(error)}`); }
      }
      setStatus(cachedHash ? 'ROM saved on this device. The host can now start emulation.' : 'ROM loaded. Local browser storage is unavailable, so choose it again next time.');
    } catch (error) { romBytesRef.current = null; engineRef.current?.fail(error); setEngineStatus(engineRef.current?.diagnostics() || EMPTY_ENGINE); setStatus(`ROM load failed: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setRomLoading(false); }
  };

  useEffect(() => {
    if (!session) { restoringLibrary.current = null; return; }
    if (restoringLibrary.current === session.user.id) return;
    restoringLibrary.current = session.user.id;
    void (async () => {
      try {
        const games = await listGames(session.user.id);
        const preferredId = localStorage.getItem(lastGameKey(session.user.id));
        const game = games.find((item) => item.id === preferredId) || games[0];
        if (!game) return;
        const cached = await getCachedRom(game.rom_hash);
        if (!cached) { setStatus(`Welcome back. Choose “Load ROM” once to restore ${game.title} on this device.`); return; }
        romBytesRef.current = new Uint8Array(cached.bytes);
        setRomHash(game.rom_hash);
        setRomName(game.title);
        setRomLoaded(true);
        setCurrentGame(game);
        setStatus(`Ready to play ${game.title}.`);
      } catch { /* cloud or local library can be unavailable without blocking local play */ }
    })();
  }, [session]);

  useEffect(() => {
    if (!session || !romBytesRef.current || currentGame) return;
    void registerGame(session.user.id, romName, romBytesRef.current).then((game) => {
      setCurrentGame(game);
      localStorage.setItem(lastGameKey(session.user.id), game.id);
      setLibraryRefresh((value) => value + 1);
    }).catch(() => undefined);
  }, [session, currentGame, romName]);

  useEffect(() => {
    if (!['solo', 'host'].includes(screen) || !romLoaded || !gameStarted) return;
    let raf = 0;
    let last = performance.now();
    let frameAccumulator = 16.67;
    let lastSent = 0;
    const tick = (now: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      try {
        // Bound catch-up work. Running six frames after a mobile browser stall
        // creates a feedback loop where rendering/audio fall even farther behind.
        frameAccumulator = Math.min(33.34, frameAccumulator + Math.min(34, now - last)); last = now;
        let framesThisTick = 0;
        while (frameAccumulator >= 16.67 && framesThisTick < 2) { engine.runFrame(); frameAccumulator -= 16.67; framesThisTick += 1; }
        const local = engine.frame(0);
        if (local) drawFrame(hostCanvas.current, local);
      } catch (error) {
        engine.fail(error);
        setEngineStatus(engine.diagnostics());
        setStatus(`Emulator stopped: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      const config = streamConfig(streamQuality, diagnostics.rtt);
      const activeSession = sessionRef.current;
      const shouldSend = screen === 'host' && now - lastSent >= config.interval && approved && activeSession;
      if (shouldSend) {
        for (const slot of activeSession.connectedSlots()) {
          if (captureBusy.current.has(slot)) continue;
          const remote = engine.frame(slot - 1);
          if (!remote) continue;
          const canvas = captureCanvases.current[slot] || (captureCanvases.current[slot] = document.createElement('canvas'));
          drawFrame(canvas, remote);
          captureBusy.current.add(slot);
          canvas.toBlob(async (blob) => {
            try {
              if (blob && sessionRef.current === activeSession) {
                activeSession.sendFrame(slot, { type: 'frame', width: remote.width, height: remote.height, data: await blob.arrayBuffer() });
              }
            } finally {
              captureBusy.current.delete(slot);
            }
          }, 'image/jpeg', config.jpeg);
        }
        lastSent = now;
      }
      if (screen === 'host') {
        const connectedSlots = new Set(activeSession?.connectedSlots() || []);
        for (let slot = 2; slot <= roomCapacity; slot += 1) {
          const playerSlot = slot as PlayerSlot;
          const remoteAudio = engine.drainAudio(playerSlot);
          if (remoteAudio && approved && activeSession && connectedSlots.has(playerSlot)) {
            activeSession.sendAudio(playerSlot, { type: 'audio', rate: remoteAudio.rate, data: remoteAudio.samples.buffer as ArrayBuffer });
          }
        }
      }
      const localAudio = engine.drainAudio(1);
      if (localAudio) {
        // Host hears only Player 1. Guests receive the mix for their own slot
        // through the per-slot audio messages above.
        playPcm(localAudio.rate, localAudio.samples);
      }
      if (now - lastEngineUpdate.current >= 500) { setEngineStatus(engine.diagnostics()); lastEngineUpdate.current = now; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [screen, romLoaded, gameStarted, approved, roomCapacity, streamQuality, diagnostics.rtt]);

  useEffect(() => {
    if (!['distributed-host', 'distributed-guest'].includes(screen) || !romLoaded) return;
    let raf = 0;
    let lastRunAt = 0;
    const tick = (now: number) => {
      const engine = engineRef.current;
      const session = distributedSessionRef.current;
      const slot = distributedAssignedSlot.current || (screen === 'distributed-host' ? 1 : null);
      if (!engine || !session || !slot || !distributedStarted.current) { raf = requestAnimationFrame(tick); return; }
      if (now - lastRunAt < 16) { raf = requestAnimationFrame(tick); return; }
      const frame = distributedNextTick.current;
      const localKeys = guestKeys.current >>> 0;
      const inputs = distributedInputs.current.get(frame) || new Map<PlayerSlot, number>();
      inputs.set(slot, localKeys);
      distributedInputs.current.set(frame, inputs);
      if (distributedLastSentTick.current !== frame || distributedLastSentKeys.current !== localKeys) {
        session.sendInput(frame, slot, localKeys);
        distributedLastSentTick.current = frame;
        distributedLastSentKeys.current = localKeys;
      }
      // Deterministic replication: never advance one local core group without
      // the complete input vector for that tick. This trades some latency for
      // correctness and prevents silent divergence on lossy connections.
      if (inputs.size < roomCapacity) { raf = requestAnimationFrame(tick); return; }
      try {
        for (let player = 1; player <= roomCapacity; player += 1) engine.setKeys(player - 1, inputs.get(player as PlayerSlot) || 0);
        engine.runFrame();
        const local = engine.frame(slot - 1);
        if (local) drawFrame(hostCanvas.current, local);
        const audio = engine.drainAudio(slot);
        if (audio) playPcm(audio.rate, audio.samples);
        distributedInputs.current.delete(frame);
        distributedNextTick.current = frame + 1;
        lastRunAt = now;
      } catch (error) {
        engine.fail(error);
        setEngineStatus(engine.diagnostics());
        setStatus(`Distributed emulator stopped: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      if (now - lastEngineUpdate.current >= 250) { setEngineStatus(engine.diagnostics()); lastEngineUpdate.current = now; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [screen, romLoaded, roomCapacity]);

  useEffect(() => {
    if (!['solo', 'host', 'guest', 'distributed-host', 'distributed-guest'].includes(screen)) return;
    const map: Record<string, number> = {
      ArrowUp: 0x40, ArrowDown: 0x80, ArrowLeft: 0x20, ArrowRight: 0x10,
      z: 1, Z: 1, KeyZ: 1, x: 2, X: 2, KeyX: 2,
      Enter: 8, NumpadEnter: 8, Space: 8,
      Shift: 4, a: 0x200, A: 0x200, KeyA: 0x200, s: 0x100, S: 0x100, KeyS: 0x100,
      w: 0x40, W: 0x40, KeyW: 0x40, d: 0x10, D: 0x10, KeyD: 0x10,
    };
    const update = (event: KeyboardEvent, down: boolean) => {
      const value = map[event.code] ?? map[event.key]; if (!value) return;
      event.preventDefault();
      guestKeys.current = down ? guestKeys.current | value : guestKeys.current & ~value;
      if (screen === 'guest') sessionRef.current?.sendInput(guestKeys.current);
      else if (!screen.startsWith('distributed')) engineRef.current?.setKeys(0, guestKeys.current);
    };
    const release = () => {
      guestKeys.current = 0;
      if (screen === 'guest') sessionRef.current?.sendInput(0);
      else if (!screen.startsWith('distributed')) engineRef.current?.setKeys(0, 0);
    };
    const down = (event: KeyboardEvent) => update(event, true);
    const up = (event: KeyboardEvent) => update(event, false);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', release); document.addEventListener('visibilitychange', release);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', release); release(); };
  }, [screen]);

  useEffect(() => () => { sessionRef.current?.close(); distributedSessionRef.current?.close(); engineRef.current?.stop(); }, []);

  useEffect(() => {
    if (screen !== 'solo' && screen !== 'host') return;
    const timer = window.setInterval(() => { void persistLocalBattery().catch(() => undefined); }, 5000);
    const onVisibility = () => { if (document.visibilityState === 'hidden') void persistLocalBattery().catch(() => undefined); };
    const onPageHide = () => { void persistLocalBattery().catch(() => undefined); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('pagehide', onPageHide); };
  }, [screen]);

  const startGame = () => { if (!romLoaded) { setStatus('Load your legal ROM before starting.'); return; } setGameStarted(true); setStatus(Object.values(playerStates).slice(1, roomCapacity).some((state) => state !== 'connected') ? 'Game running; waiting for remaining guest seats.' : 'Game started.'); };
  const leave = async () => { try { await persistLocalBattery(); } catch { setStatus('Could not store the battery save. The emulator is still open; retry Exit after freeing browser storage.'); return; } sessionRef.current?.close(); distributedSessionRef.current?.close(); engineRef.current?.stop(); activeSaveRef.current = null; resetAudioClock(); sessionRef.current = null; distributedSessionRef.current = null; engineRef.current = null; romBytesRef.current = null; guestPendingFrame.current = null; distributedInputs.current.clear(); distributedStarted.current = false; distributedAssignedSlot.current = null; setEngineStatus(EMPTY_ENGINE); setRomLoaded(false); setRomLoading(false); setGameStarted(false); setPendingGuest(null); setApproved(false); setAssignedSlot(null); setGuestHasVideo(false); setHostPanelOpen(false); setScreen('home'); setStatus(`Ready for a ${roomCapacity}-player session.`); };
  const inviteLink = roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}${screen.startsWith('distributed') ? `&mode=distributed&players=${roomCapacity}` : ''}` : '';
  const copyInvite = async () => { if (!inviteLink) return; await navigator.clipboard?.writeText(inviteLink); setStatus('Invite link copied.'); };

  if (screen === 'solo') return <GameShell role="solo" title="Solo game" subtitle={romName} canvasRef={hostCanvas} local badge="SOLO"><EngineStatusPanel status={engineStatus} /><p className="status" role="status">{saveStatus}</p><TouchControls onKeys={(keys) => engineRef.current?.setKeys(0, keys)} /><button className="secondary" onClick={() => void leave()}>Exit game</button></GameShell>;

  if (screen === 'host') return <GameShell role="host" title="Host room" subtitle={`${roomCapacity}-player room · ${formatCode(roomCode)}`} canvasRef={hostCanvas} local>
    <button className="host-tools-toggle" type="button" aria-expanded={hostPanelOpen} onClick={() => setHostPanelOpen((open) => !open)}>{hostPanelOpen ? 'Close' : 'Room'}</button>
    <div className={`host-tools${hostPanelOpen ? ' is-open' : ''}`}>
      <div className="room-code">{formatCode(roomCode)}</div><p className="muted">Share this code or the invite link. The guest still needs your approval.</p><div className="invite-row"><input aria-label="Invite link" readOnly value={inviteLink} /><button className="secondary" onClick={() => void copyInvite()}>Copy invite</button></div>
      {pendingGuest && <div className="approval"><strong>Guest requests Player {pendingGuest.slot}</strong><div><button onClick={() => { pendingGuest.approve(); setPendingGuest(null); }}>Approve</button><button className="secondary" onClick={() => { pendingGuest.reject(); setPendingGuest(null); }}>Reject</button></div></div>}
      <div className="lobby">{Array.from({ length: roomCapacity }, (_, index) => index + 1).map((slot) => <div key={slot}><span>Player {slot}{slot === 1 ? ' · Host' : ''}</span><strong>{playerStates[slot]}</strong></div>)}</div>
      <StatusPanel diagnostics={diagnostics} status={status} /><EngineStatusPanel status={engineStatus} /><p className="status" role="status">{saveStatus} Guest battery saves are not enabled in host-streaming mode.</p><label className="quality-control">Stream quality<select value={streamQuality} onChange={(e) => setStreamQuality(e.target.value as StreamQuality)}><option value="auto">Auto</option><option value="smooth">Smooth · lower latency</option><option value="balanced">Balanced</option><option value="sharp">Sharp · higher quality</option></select></label><label className="file-button">{romLoaded ? `Change ROM (${romName})` : 'Load your legal ROM'}<input type="file" accept=".gba,.gb,.gbc" onChange={(e) => e.target.files?.[0] && loadRom(e.target.files[0])} /></label><button onClick={startGame} disabled={gameStarted}>{gameStarted ? 'Game running' : 'Start game'}</button>
    </div>
    <TouchControls onKeys={(keys) => engineRef.current?.setKeys(0, keys)} /><button className="secondary" onClick={() => void leave()}>End session</button>
  </GameShell>;

  if (screen === 'distributed-host') return <GameShell role="host" title="Distributed room" subtitle={`${roomCapacity}-player room · ${formatCode(roomCode)}`} canvasRef={hostCanvas} local badge="HOST">
    <button className="host-tools-toggle" type="button" aria-expanded={hostPanelOpen} onClick={() => setHostPanelOpen((open) => !open)}>{hostPanelOpen ? 'Close' : 'Room'}</button>
    <div className={`host-tools${hostPanelOpen ? ' is-open' : ''}`}>
      <div className="room-code">{formatCode(roomCode)}</div><p className="muted">Share this code or invite link. Every player must load the exact same ROM locally.</p><div className="invite-row"><input aria-label="Distributed invite link" readOnly value={inviteLink} /><button className="secondary" onClick={() => void copyInvite()}>Copy invite</button></div>
      {pendingGuest && <div className="approval"><strong>Guest requests Player {pendingGuest.slot}</strong><div><button onClick={() => { pendingGuest.approve(); setPendingGuest(null); }}>Approve</button><button className="secondary" onClick={() => { pendingGuest.reject(); setPendingGuest(null); }}>Reject</button></div></div>}
      <div className="lobby">{Array.from({ length: roomCapacity }, (_, index) => index + 1).map((slot) => <div key={slot}><span>Player {slot}{slot === 1 ? ' · Host' : ''}</span><strong>{playerStates[slot]}</strong></div>)}</div>
      <StatusPanel diagnostics={diagnostics} status={status} /><EngineStatusPanel status={engineStatus} /><p className="muted">Distributed mode exchanges only frame-numbered inputs. Video, audio, and ROM bytes stay local. Automatic battery persistence for distributed sessions is not enabled yet.</p>
    </div>
    <TouchControls onKeys={(keys) => { guestKeys.current = keys; }} /><button className="secondary" onClick={leave}>End session</button>
  </GameShell>;

  if (screen === 'guest') return <GameShell role="guest" title={`Guest Player ${assignedSlot || '…'}`} subtitle={`${roomCapacity}-player room · ${formatCode(roomCode)}`} canvasRef={guestCanvas} caption={`PLAYER ${assignedSlot || '…'} · STREAM`} overlay={!guestHasVideo ? <div className="screen-overlay">Waiting for host video<small>Ask the host to approve you and start the game.</small></div> : undefined}><StatusPanel diagnostics={diagnostics} status={status} /><TouchControls onKeys={(keys) => sessionRef.current?.sendInput(keys)} /><button className="secondary" onClick={leave}>Disconnect</button></GameShell>;

  if (screen === 'distributed-guest') return <GameShell role="guest" local badge={assignedSlot ? `P${assignedSlot}` : 'GUEST'} title={`Player ${assignedSlot || '…'}`} subtitle={`${roomCapacity}-player distributed room · ${formatCode(roomCode)}`} canvasRef={hostCanvas} caption={`PLAYER ${assignedSlot || '…'} · LOCAL`} overlay={!gameStarted ? <div className="screen-overlay">Waiting for synchronized start<small>Both devices must approve and load the same ROM.</small></div> : undefined}><StatusPanel diagnostics={diagnostics} status={status} /><EngineStatusPanel status={engineStatus} /><TouchControls onKeys={(keys) => { guestKeys.current = keys; }} /><button className="secondary" onClick={leave}>Disconnect</button></GameShell>;

  const loadSavedGame = async (game: GameRecord) => {
    const cached = await getCachedRom(game.rom_hash);
    if (!cached) { setStatus(`This ROM is not cached on this device. Choose “Load ROM” once for ${game.title}.`); return; }
    romBytesRef.current = new Uint8Array(cached.bytes);
    setRomHash(game.rom_hash);
    setRomName(game.title); setRomLoaded(true); setCurrentGame(game);
    localStorage.setItem(lastGameKey(game.user_id), game.id);
    void registerGame(game.user_id, game.title, new Uint8Array(cached.bytes)).catch(() => undefined);
    setStatus(`Loaded ${game.title}. Ready to play.`);
  };

  return <HomeView
    room={room}
    roomCapacity={roomCapacity}
    onlineMode={onlineMode}
    romName={romName}
    romLoaded={romLoaded}
    romLoading={romLoading}
    status={status}
    session={session}
    libraryRefresh={libraryRefresh}
    onRoom={setRoom}
    onCapacity={(value) => { setRoomCapacity(value); setStatus(`Ready for a ${value}-player session.`); }}
    onMode={setOnlineMode}
    onLoadRom={(file) => { void loadRom(file); }}
    onSolo={() => { void startSolo(); }}
    onCreateRoom={() => { void (onlineMode === 'distributed' ? startDistributedHost() : startHost()); }}
    onJoin={() => { void joinRoom(); }}
    onSession={setSession}
    onLoadGame={loadSavedGame}
  />;
}

const canvasImages = new WeakMap<HTMLCanvasElement, ImageData>();
function drawFrame(canvas: HTMLCanvasElement | null, frame: EngineFrame) {
  if (!canvas) return;
  if (canvas.width !== frame.width || canvas.height !== frame.height) {
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvasImages.delete(canvas);
  }
  let image = canvasImages.get(canvas);
  if (!image) {
    image = new ImageData(frame.width, frame.height);
    canvasImages.set(canvas, image);
  }
  image.data.set(frame.rgba);
  canvas.getContext('2d')?.putImageData(image, 0, 0);
}

function playAudio(audio: AudioMessage) {
  const context = (window as Window & { kirbyAudio?: AudioContext }).kirbyAudio; if (!context) return;
  const bytes = audio.data instanceof ArrayBuffer ? audio.data : (audio.data as unknown as Uint8Array).buffer;
  playPcm(audio.rate, new Int16Array(bytes));
}

function playPcm(rate: number, samples: Int16Array) {
  const context = (window as Window & { kirbyAudio?: AudioContext }).kirbyAudio; if (!context || samples.length < 2) return;
  void context.resume();
  const frames = Math.floor(samples.length / 2);
  const buffer = context.createBuffer(2, frames, rate);
  const left = buffer.getChannelData(0); const right = buffer.getChannelData(1);
  for (let i = 0; i < frames; i++) { left[i] = samples[i * 2] / 32768; right[i] = samples[i * 2 + 1] / 32768; }
  const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
  const now = context.currentTime;
  const minLead = 0.02;
  const maxLead = 0.18;
  if (!Number.isFinite(audioNextTime) || audioNextTime < now || audioNextTime - now > maxLead) audioNextTime = now + minLead;
  const start = Math.max(now + minLead, audioNextTime);
  source.start(start); audioNextTime = start + buffer.duration;
}

function GameShell({ role, title, subtitle, canvasRef, children, local = false, badge, overlay, caption }: {
  role: 'solo' | 'host' | 'guest';
  title: string;
  subtitle: string;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  children: React.ReactNode;
  local?: boolean;
  badge?: string;
  overlay?: React.ReactNode;
  caption?: string;
}) {
  const playerCaption = caption || (local ? 'PLAYER 1 · LOCAL' : 'PLAYER 2 · REMOTE');
  return <main className={`game-shell role-${role}`}>
    <header className="session-header">
      <div className="session-title"><img src={`${import.meta.env.BASE_URL}luna-mark.svg`} alt="" width="42" height="42" /><div><p className="eyebrow">LUNA / NOW PLAYING</p><h1>{title}</h1><p className="muted">{subtitle}</p></div></div>
      <span className={`live-dot ${local ? 'host' : ''}`}>{badge || (local ? 'HOST' : 'GUEST')}</span>
    </header>
    <section className="play-layout">
      <div className="screen-card"><div className="screen-stage"><canvas ref={canvasRef} aria-label={playerCaption} />{overlay}</div>
        <div className="screen-caption"><span>{playerCaption}</span><span className="desktop-key-hint">ARROWS · MOVE &nbsp; Z / X · A / B &nbsp; ENTER · START</span><button className="fullscreen-button" type="button" aria-label="Toggle fullscreen" onClick={toggleFullscreen}>Fullscreen</button></div>
      </div>
      <aside>{children}</aside>
    </section>
  </main>;
}

function EngineStatusPanel({ status }: { status: EngineDiagnostics }) { return <div className="status-panel engine-panel"><strong>Emulator diagnostics</strong><dl><dt>WASM</dt><dd>{status.wasm}</dd><dt>Emulator</dt><dd>{status.emulator}</dd><dt>ROM</dt><dd>{status.rom}</dd><dt>Frames executed</dt><dd>{status.framesExecuted}</dd><dt>Frames rendered</dt><dd>{status.framesRendered}</dd><dt>Framebuffer</dt><dd>{status.lastFrame}</dd><dt>Audio samples</dt><dd>{status.audioFrames} @ {status.audioRate} Hz</dd><dt>Audio batches</dt><dd>{status.audioBatches}</dd></dl>{status.error && <p className="error">{status.error}</p>}</div>; }

function StatusPanel({ diagnostics, status }: { diagnostics: Diagnostics; status: string }) { return <div className="status-panel network-panel"><strong role="status">{status}</strong><dl><dt>Signaling</dt><dd>{diagnostics.signaling}</dd><dt>Connection</dt><dd>{diagnostics.connection}</dd><dt>ICE</dt><dd>{diagnostics.ice}</dd><dt>Channel</dt><dd>{diagnostics.channel}</dd><dt>Candidate</dt><dd>{diagnostics.candidate}</dd><dt>RTT</dt><dd>{diagnostics.rtt ? `${Math.round(diagnostics.rtt)} ms` : '—'}</dd><dt>Received FPS</dt><dd>{diagnostics.fps ? diagnostics.fps.toFixed(1) : '—'}</dd></dl>{diagnostics.error && <p className="error">{diagnostics.error}</p>}</div>; }
