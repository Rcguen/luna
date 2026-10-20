import { useEffect, useRef, useState } from 'react';
import { GbaEngine, type EngineDiagnostics, type EngineFrame } from './engine/wasmAdapter';
import { type Diagnostics, type PlayerSlot } from './netplay/peerSession';
import { MultiPeerSession, type MultiGuestRequest } from './netplay/multiPeerSession';
import { TouchControls } from './components/TouchControls';
import { AuthPanel } from './components/AuthPanel';
import { GameLibrary } from './components/GameLibrary';
import { registerGame, type GameRecord } from './lib/cloudSaves';
import type { Session } from '@supabase/supabase-js';
import type { AudioMessage, FrameMessage } from './netplay/protocol';
import './styles.css';

type Screen = 'home' | 'solo' | 'host' | 'guest';
const EMPTY_DIAGNOSTICS: Diagnostics = { signaling: 'idle', connection: 'idle', ice: 'idle', gathering: 'idle', candidate: 'idle', channel: 'idle', rtt: null, fps: null, error: '' };
const EMPTY_ENGINE: EngineDiagnostics = { wasm: 'idle', emulator: 'idle', rom: 'waiting', framesExecuted: 0, framesRendered: 0, lastFrame: '0×0', audioFrames: 0, audioBatches: 0, audioRate: 32768, error: '' };
let audioNextTime = 0;

function formatCode(code: string) { return code ? `${code.slice(0, 3)} ${code.slice(3)}` : '------'; }

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [room, setRoom] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [roomCapacity, setRoomCapacity] = useState(2);
  const [status, setStatus] = useState('Ready for a 2-player session.');
  const [romName, setRomName] = useState('No ROM loaded');
  const [romLoaded, setRomLoaded] = useState(false);
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
  const [guestFrame, setGuestFrame] = useState<FrameMessage | null>(null);
  const engineRef = useRef<GbaEngine | null>(null);
  const romBytesRef = useRef<Uint8Array | null>(null);
  const sessionRef = useRef<MultiPeerSession | null>(null);
  const hostCanvas = useRef<HTMLCanvasElement>(null);
  const guestCanvas = useRef<HTMLCanvasElement>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const guestKeys = useRef(0);
  const lastEngineUpdate = useRef(0);

  useEffect(() => {
    const invitedRoom = new URLSearchParams(window.location.search).get('room')?.replace(/\D/g, '') || '';
    if (invitedRoom.length === 6) setRoom(invitedRoom);
  }, []);

  const newEngine = async (players = roomCapacity) => {
    engineRef.current?.stop();
    const engine = new GbaEngine();
    await engine.start(players);
    engineRef.current = engine;
    setEngineStatus(engine.diagnostics());
    return engine;
  };

  const ensureAudio = async () => {
    if (!audioContext.current) {
      audioContext.current = new AudioContext();
      audioNextTime = 0;
      (window as Window & { kirbyAudio?: AudioContext }).kirbyAudio = audioContext.current;
    }
    await audioContext.current.resume().catch(() => undefined);
  };

  const makeEvents = (hostSide: boolean) => ({
    status: (text: string) => setStatus(text),
    diagnostics: (value: Diagnostics) => setDiagnostics(value),
    guestRequest: (request: MultiGuestRequest) => { setPendingGuest(request); setPlayerStates((states) => ({ ...states, [request.slot]: 'pending' })); },
    input: (slot: PlayerSlot, keys: number) => { if (hostSide) engineRef.current?.setKeys(slot - 1, keys); },
    frame: (slot: PlayerSlot, frame: FrameMessage) => { if (!hostSide && slot === assignedSlot) setGuestFrame(frame); },
    audio: (_slot: PlayerSlot, audio: AudioMessage) => { if (!hostSide) playAudio(audio); },
    connection: (slot: PlayerSlot, state: 'pending' | 'connected' | 'disconnected', capacity?: number) => { setPlayerStates((states) => { const next = { ...states, [slot]: state }; if (hostSide) setApproved(Object.entries(next).some(([player, value]) => Number(player) > 1 && value === 'connected')); return next; }); if (state === 'connected') { setApproved(true); setAssignedSlot(slot); if (capacity) setRoomCapacity(capacity); } if (state === 'disconnected') { if (hostSide) engineRef.current?.setKeys(slot - 1, 0); } },
    closed: () => { setApproved(false); setAssignedSlot(null); setStatus('Peer disconnected. Input released.'); if (hostSide) for (let slot = 1; slot < roomCapacity; slot += 1) engineRef.current?.setKeys(slot, 0); },
  });

  const startHost = async () => {
    try {
      setStatus('Starting the linked host engine…');
      const engine = await newEngine(roomCapacity);
      if (romBytesRef.current) engine.loadRom(romBytesRef.current);
      const session = new MultiPeerSession(makeEvents(true));
      sessionRef.current = session;
      await ensureAudio();
      const code = await session.host(roomCapacity);
      setRoomCode(code);
      setGameStarted(Boolean(romBytesRef.current));
      setScreen('host');
    } catch (error) { engineRef.current?.fail(error); setEngineStatus(engineRef.current?.diagnostics() || EMPTY_ENGINE); setStatus(`Failed to start emulator: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const startSolo = async () => {
    try {
      if (!romBytesRef.current) { setStatus('Select your legal ROM first.'); return; }
      setStatus('Starting solo emulator…');
      await ensureAudio();
      const engine = await newEngine(1);
      engine.loadRom(romBytesRef.current);
      setRomLoaded(true); setGameStarted(true); setScreen('solo'); setStatus('Solo game running.');
    } catch (error) { engineRef.current?.fail(error); setEngineStatus(engineRef.current?.diagnostics() || EMPTY_ENGINE); setStatus(`Failed to start solo emulator: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const joinRoom = async () => {
    try {
      const clean = room.replace(/\D/g, '');
      if (clean.length !== 6) { setStatus('Enter the six-digit room code.'); return; }
      setStatus('Connecting to host…');
      const session = new MultiPeerSession(makeEvents(false));
      sessionRef.current = session;
      await ensureAudio();
      await session.join(clean);
      setRoomCode(clean);
      setScreen('guest');
      await audioContext.current.resume().catch(() => undefined);
    } catch (error) { setStatus(`Connection failed: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const loadRom = async (file: File) => {
    try {
      if (!engineRef.current) await newEngine();
      const bytes = new Uint8Array(await file.arrayBuffer());
      romBytesRef.current = bytes;
      engineRef.current?.loadRom(bytes);
      setRomName(file.name);
      setRomLoaded(true);
      if (session) {
        try { setCurrentGame(await registerGame(session.user.id, file.name, bytes)); setLibraryRefresh((value) => value + 1); } catch (error) { setStatus(`ROM loaded locally; cloud metadata unavailable: ${error instanceof Error ? error.message : String(error)}`); }
      }
      setStatus('ROM loaded. The host can now start emulation.');
    } catch (error) { engineRef.current?.fail(error); setEngineStatus(engineRef.current?.diagnostics() || EMPTY_ENGINE); setStatus(`ROM load failed: ${error instanceof Error ? error.message : String(error)}`); }
  };

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
        frameAccumulator += Math.min(100, now - last); last = now;
        while (frameAccumulator >= 16.67) { engine.runFrame(); frameAccumulator -= 16.67; }
        const local = engine.frame(0);
        if (local) drawFrame(hostCanvas.current, local);
      } catch (error) {
        engine.fail(error);
        setEngineStatus(engine.diagnostics());
        setStatus(`Emulator stopped: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      const shouldSend = screen === 'host' && now - lastSent >= 33 && approved && sessionRef.current;
      if (shouldSend) {
        for (let slot = 2; slot <= roomCapacity; slot += 1) {
          const remote = engine.frame(slot - 1);
          if (!remote) continue;
          const canvas = document.createElement('canvas'); canvas.width = remote.width; canvas.height = remote.height; drawFrame(canvas, remote);
          canvas.toBlob(async (blob) => { if (blob) sessionRef.current?.sendFrame(slot as PlayerSlot, { type: 'frame', width: remote.width, height: remote.height, data: await blob.arrayBuffer() }); }, 'image/jpeg', 0.78);
        }
        lastSent = now;
      }
      const audio = engine.drainAudio();
      if (audio) {
        playPcm(audio.rate, audio.samples);
        if (shouldSend) for (let slot = 2; slot <= roomCapacity; slot += 1) sessionRef.current?.sendAudio(slot as PlayerSlot, { type: 'audio', rate: audio.rate, data: audio.samples.buffer as ArrayBuffer });
      }
      if (now - lastEngineUpdate.current >= 250) { setEngineStatus(engine.diagnostics()); lastEngineUpdate.current = now; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [screen, romLoaded, gameStarted, approved, roomCapacity]);

  useEffect(() => {
    if (!guestFrame || !guestCanvas.current) return;
    const blob = new Blob([guestFrame.data], { type: 'image/jpeg' });
    createImageBitmap(blob).then((bitmap) => {
      const canvas = guestCanvas.current;
      if (!canvas) return;
      canvas.width = guestFrame.width; canvas.height = guestFrame.height;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
      bitmap.close();
    }).catch(() => setStatus('A guest video frame could not be decoded.'));
  }, [guestFrame]);

  useEffect(() => {
    if (!['solo', 'host', 'guest'].includes(screen)) return;
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
      else engineRef.current?.setKeys(0, guestKeys.current);
    };
    const release = () => {
      guestKeys.current = 0;
      if (screen === 'guest') sessionRef.current?.sendInput(0);
      else engineRef.current?.setKeys(0, 0);
    };
    const down = (event: KeyboardEvent) => update(event, true);
    const up = (event: KeyboardEvent) => update(event, false);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', release); document.addEventListener('visibilitychange', release);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', release); release(); };
  }, [screen]);

  useEffect(() => () => { sessionRef.current?.close(); engineRef.current?.stop(); }, []);

  const startGame = () => { if (!romLoaded) { setStatus('Load your legal ROM before starting.'); return; } setGameStarted(true); setStatus(Object.values(playerStates).slice(1, roomCapacity).some((state) => state !== 'connected') ? 'Game running; waiting for remaining guest seats.' : 'Game started.'); };
  const leave = () => { sessionRef.current?.close(); engineRef.current?.stop(); sessionRef.current = null; engineRef.current = null; romBytesRef.current = null; setEngineStatus(EMPTY_ENGINE); setRomLoaded(false); setGameStarted(false); setPendingGuest(null); setApproved(false); setAssignedSlot(null); setScreen('home'); setStatus(`Ready for a ${roomCapacity}-player session.`); };
  const inviteLink = roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}` : '';
  const copyInvite = async () => { if (!inviteLink) return; await navigator.clipboard?.writeText(inviteLink); setStatus('Invite link copied.'); };

  if (screen === 'solo') return <GameShell title="Solo game" subtitle={romName} canvasRef={hostCanvas} local badge="SOLO"><EngineStatusPanel status={engineStatus} /><TouchControls onKeys={(keys) => engineRef.current?.setKeys(0, keys)} /><button className="secondary" onClick={leave}>Exit game</button></GameShell>;

  if (screen === 'host') return <GameShell title="Host room" subtitle={`${roomCapacity}-player room · ${formatCode(roomCode)}`} canvasRef={hostCanvas} local>
    <div className="room-code">{formatCode(roomCode)}</div><p className="muted">Share this code or the invite link. The guest still needs your approval.</p><div className="invite-row"><input aria-label="Invite link" readOnly value={inviteLink} /><button className="secondary" onClick={() => void copyInvite()}>Copy invite</button></div>
    {pendingGuest && <div className="approval"><strong>Guest requests Player {pendingGuest.slot}</strong><div><button onClick={() => { pendingGuest.approve(); setPendingGuest(null); }}>Approve</button><button className="secondary" onClick={() => { pendingGuest.reject(); setPendingGuest(null); }}>Reject</button></div></div>}
    <div className="lobby">{Array.from({ length: roomCapacity }, (_, index) => index + 1).map((slot) => <div key={slot}><span>Player {slot}{slot === 1 ? ' · Host' : ''}</span><strong>{playerStates[slot]}</strong></div>)}</div>
    <StatusPanel diagnostics={diagnostics} status={status} /><EngineStatusPanel status={engineStatus} /><TouchControls onKeys={(keys) => engineRef.current?.setKeys(0, keys)} /><label className="file-button">{romLoaded ? `Change ROM (${romName})` : 'Load your legal ROM'}<input type="file" accept=".gba,.gb,.gbc" onChange={(e) => e.target.files?.[0] && loadRom(e.target.files[0])} /></label><button onClick={startGame} disabled={gameStarted}>{gameStarted ? 'Game running' : 'Start game'}</button><button className="secondary" onClick={leave}>End session</button>
  </GameShell>;

  if (screen === 'guest') return <GameShell title={`Guest Player ${assignedSlot || '…'}`} subtitle={`${roomCapacity}-player room · ${formatCode(roomCode)}`} canvasRef={guestCanvas}><StatusPanel diagnostics={diagnostics} status={status} /><TouchControls onKeys={(keys) => sessionRef.current?.sendInput(keys)} /><button className="secondary" onClick={leave}>Disconnect</button></GameShell>;

  return <main className="home"><div className="brand"><span className="star" aria-hidden="true">✦</span><p className="eyebrow">ONLINE GBA ADVENTURES</p><h1>Luna</h1><p className="lede">Two linked players. One shared adventure.</p></div><AuthPanel onSession={setSession} /><section className="home-card" aria-labelledby="play-heading"><p id="play-heading" className="eyebrow">PLAY</p><label className="muted" htmlFor="room-capacity">Players per room</label><select id="room-capacity" value={roomCapacity} onChange={(e) => { const value = Number(e.target.value); setRoomCapacity(value); setStatus(`Ready for a ${value}-player session.`); }}><option value="2">2 players</option><option value="3">3 players</option><option value="4">4 players</option></select><label className="file-button home-file">Load ROM<input aria-label="Load a legal ROM" type="file" accept=".gba,.gb,.gbc" onChange={(e) => e.target.files?.[0] && loadRom(e.target.files[0])} /></label><button className="secondary" onClick={startSolo}>Play solo</button><button onClick={startHost}>Create room <span aria-hidden="true">→</span></button><div className="join-row"><input aria-label="Six-digit room code" inputMode="numeric" maxLength={6} placeholder="ROOM CODE" value={room} onChange={(e) => setRoom(e.target.value.replace(/\D/g, ''))} /><button className="secondary" onClick={joinRoom}>Join</button></div><p className="status" role="status">{status}</p></section><GameLibrary userId={session?.user.id || null} refreshKey={libraryRefresh} /><footer>Host runs {roomCapacity} linked consoles. Each guest receives only their assigned Player 2–4 video and sends only their assigned controls. Guests may join without an account.</footer></main>;
}

function drawFrame(canvas: HTMLCanvasElement | null, frame: EngineFrame) { if (!canvas) return; canvas.width = frame.width; canvas.height = frame.height; const image = new ImageData(frame.width, frame.height); image.data.set(frame.rgba); canvas.getContext('2d')?.putImageData(image, 0, 0); }

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
  const left = new Float32Array(frames); const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { left[i] = samples[i * 2] / 32768; right[i] = samples[i * 2 + 1] / 32768; }
  buffer.copyToChannel(left, 0); buffer.copyToChannel(right, 1);
  const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
  const start = Math.max(context.currentTime + 0.02, audioNextTime);
  source.start(start); audioNextTime = start + buffer.duration;
}

function GameShell({ title, subtitle, canvasRef, children, local = false, badge }: { title: string; subtitle: string; canvasRef: React.RefObject<HTMLCanvasElement>; children: React.ReactNode; local?: boolean; badge?: string }) { return <main className="game-shell"><header><div><p className="eyebrow">LUNA ONLINE</p><h1>{title}</h1><p className="muted">{subtitle}</p></div><span className={`live-dot ${local ? 'host' : ''}`}>{badge || (local ? 'HOST' : 'GUEST')}</span></header><section className="play-layout"><div className="screen-card"><canvas ref={canvasRef} aria-label={local ? 'Player 1 game screen' : 'Player 2 remote game screen'} /><div className="screen-caption">{local ? 'PLAYER 1 · LOCAL' : 'PLAYER 2 · REMOTE'}</div></div><aside>{children}</aside></section></main>; }

function EngineStatusPanel({ status }: { status: EngineDiagnostics }) { return <div className="status-panel"><strong>Emulator diagnostics</strong><dl><dt>WASM</dt><dd>{status.wasm}</dd><dt>Emulator</dt><dd>{status.emulator}</dd><dt>ROM</dt><dd>{status.rom}</dd><dt>Frames executed</dt><dd>{status.framesExecuted}</dd><dt>Frames rendered</dt><dd>{status.framesRendered}</dd><dt>Framebuffer</dt><dd>{status.lastFrame}</dd><dt>Audio samples</dt><dd>{status.audioFrames} @ {status.audioRate} Hz</dd><dt>Audio batches</dt><dd>{status.audioBatches}</dd></dl>{status.error && <p className="error">{status.error}</p>}</div>; }

function StatusPanel({ diagnostics, status }: { diagnostics: Diagnostics; status: string }) { return <div className="status-panel"><strong role="status">{status}</strong><dl><dt>Signaling</dt><dd>{diagnostics.signaling}</dd><dt>Connection</dt><dd>{diagnostics.connection}</dd><dt>ICE</dt><dd>{diagnostics.ice}</dd><dt>Channel</dt><dd>{diagnostics.channel}</dd><dt>Candidate</dt><dd>{diagnostics.candidate}</dd><dt>RTT</dt><dd>{diagnostics.rtt ? `${Math.round(diagnostics.rtt)} ms` : '—'}</dd><dt>Received FPS</dt><dd>{diagnostics.fps ? diagnostics.fps.toFixed(1) : '—'}</dd></dl>{diagnostics.error && <p className="error">{diagnostics.error}</p>}</div>; }
