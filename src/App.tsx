import { useEffect, useRef, useState } from 'react';
import { GbaEngine, type EngineFrame } from './engine/wasmAdapter';
import { PeerSession, type Diagnostics } from './netplay/peerSession';
import { TouchControls } from './components/TouchControls';
import type { AudioMessage, FrameMessage } from './netplay/protocol';
import './styles.css';

type Screen = 'home' | 'host' | 'guest';
const EMPTY_DIAGNOSTICS: Diagnostics = { signaling: 'idle', connection: 'idle', ice: 'idle', gathering: 'idle', candidate: 'idle', rtt: null, error: '' };

function formatCode(code: string) { return code ? `${code.slice(0, 3)} ${code.slice(3)}` : '------'; }

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [room, setRoom] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [status, setStatus] = useState('Ready for a two-player session.');
  const [romName, setRomName] = useState('No ROM loaded');
  const [romLoaded, setRomLoaded] = useState(false);
  const [pendingGuest, setPendingGuest] = useState(false);
  const [approved, setApproved] = useState(false);
  const [diagnostics, setDiagnostics] = useState(EMPTY_DIAGNOSTICS);
  const [guestFrame, setGuestFrame] = useState<FrameMessage | null>(null);
  const engineRef = useRef<GbaEngine | null>(null);
  const sessionRef = useRef<PeerSession | null>(null);
  const hostCanvas = useRef<HTMLCanvasElement>(null);
  const guestCanvas = useRef<HTMLCanvasElement>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const audioNextTime = useRef(0);
  const guestKeys = useRef(0);

  const newEngine = async () => {
    const engine = new GbaEngine();
    await engine.start(2);
    engineRef.current = engine;
    return engine;
  };

  const makeEvents = (hostSide: boolean) => ({
    status: (text: string) => setStatus(text),
    diagnostics: (value: Diagnostics) => setDiagnostics(value),
    guestRequest: (approveGuest: () => void, rejectGuest: () => void) => {
      setPendingGuest(true);
      (window as Window & { kirbyApprove?: () => void; kirbyReject?: () => void }).kirbyApprove = () => { approveGuest(); setPendingGuest(false); setApproved(true); };
      (window as Window & { kirbyApprove?: () => void; kirbyReject?: () => void }).kirbyReject = () => { rejectGuest(); setPendingGuest(false); };
    },
    input: (keys: number) => { if (hostSide) engineRef.current?.setKeys(1, keys); },
    frame: (frame: FrameMessage) => { if (!hostSide) setGuestFrame(frame); },
    audio: (audio: AudioMessage) => { if (!hostSide) playAudio(audio); },
    closed: () => { setApproved(false); setStatus('Peer disconnected. Input released.'); if (hostSide) engineRef.current?.setKeys(1, 0); },
  });

  const startHost = async () => {
    try {
      setStatus('Starting the linked host engine…');
      await newEngine();
      const session = new PeerSession(makeEvents(true));
      sessionRef.current = session;
      audioContext.current = new AudioContext();
      (window as Window & { kirbyAudio?: AudioContext }).kirbyAudio = audioContext.current;
      await audioContext.current.resume().catch(() => undefined);
      const code = await session.host();
      setRoomCode(code);
      setScreen('host');
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  };

  const joinRoom = async () => {
    try {
      const clean = room.replace(/\D/g, '');
      if (clean.length !== 6) { setStatus('Enter the six-digit room code.'); return; }
      setStatus('Connecting to host…');
      const session = new PeerSession(makeEvents(false));
      sessionRef.current = session;
      await session.join(clean);
      setRoomCode(clean);
      setScreen('guest');
      await audioContext.current.resume().catch(() => undefined);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  };

  const loadRom = async (file: File) => {
    try {
      if (!engineRef.current) await newEngine();
      const bytes = new Uint8Array(await file.arrayBuffer());
      engineRef.current?.loadRom(bytes);
      setRomName(file.name);
      setRomLoaded(true);
      setStatus('ROM loaded. The host can now start emulation.');
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  };

  useEffect(() => {
    if (screen !== 'host' || !romLoaded) return;
    let raf = 0;
    let last = performance.now();
    let frameAccumulator = 0;
    let lastSent = 0;
    const tick = (now: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      frameAccumulator += Math.min(100, now - last); last = now;
      while (frameAccumulator >= 16.67) { engine.runFrame(); frameAccumulator -= 16.67; }
      const local = engine.frame(0);
      if (local) drawFrame(hostCanvas.current, local);
      if (now - lastSent >= 33 && approved && sessionRef.current) {
        const canvas = document.createElement('canvas');
        const remote = engine.frame(1);
        if (remote) {
          canvas.width = remote.width; canvas.height = remote.height;
          drawFrame(canvas, remote);
          canvas.toBlob(async (blob) => {
            if (!blob) return;
            sessionRef.current?.sendFrame({ type: 'frame', width: remote.width, height: remote.height, data: await blob.arrayBuffer() });
          }, 'image/jpeg', 0.78);
        }
        const audio = engine.drainAudio();
        if (audio) {
          playPcm(audio.rate, audio.samples);
          sessionRef.current.sendAudio({ type: 'audio', rate: audio.rate, data: audio.samples.buffer as ArrayBuffer });
        }
        lastSent = now;
      } else { engine.drainAudio(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [screen, romLoaded, approved]);

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
    if (screen !== 'guest') return;
    const map: Record<string, number> = { ArrowUp: 0x40, ArrowDown: 0x80, ArrowLeft: 0x20, ArrowRight: 0x10, z: 1, x: 2, Enter: 8, Shift: 4, a: 0x200, s: 0x100 };
    const update = (event: KeyboardEvent, down: boolean) => {
      const value = map[event.key]; if (!value) return;
      event.preventDefault();
      guestKeys.current = down ? guestKeys.current | value : guestKeys.current & ~value;
      sessionRef.current?.sendInput(guestKeys.current);
    };
    const release = () => { guestKeys.current = 0; sessionRef.current?.sendInput(0); };
    const down = (event: KeyboardEvent) => update(event, true);
    const up = (event: KeyboardEvent) => update(event, false);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', release); document.addEventListener('visibilitychange', release);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', release); document.removeEventListener('visibilitychange', release); release(); };
  }, [screen]);

  useEffect(() => () => { sessionRef.current?.close(); engineRef.current?.stop(); }, []);

  const leave = () => { sessionRef.current?.close(); engineRef.current?.stop(); sessionRef.current = null; engineRef.current = null; setRomLoaded(false); setScreen('home'); setStatus('Session ended.'); };

  if (screen === 'host') return <GameShell title="Host room" subtitle={`Room ${formatCode(roomCode)}`} canvasRef={hostCanvas} local>
    <div className="room-code">{formatCode(roomCode)}</div><p className="muted">Share this code. The guest still needs your approval.</p>
    {pendingGuest && <div className="approval"><strong>Guest wants to join Player 2</strong><div><button onClick={() => (window as Window & { kirbyApprove?: () => void }).kirbyApprove?.()}>Approve</button><button className="secondary" onClick={() => (window as Window & { kirbyReject?: () => void }).kirbyReject?.()}>Reject</button></div></div>}
    <StatusPanel diagnostics={diagnostics} status={status} /><label className="file-button">{romLoaded ? `Change ROM (${romName})` : 'Load your legal ROM'}<input type="file" accept=".gba,.gb,.gbc" onChange={(e) => e.target.files?.[0] && loadRom(e.target.files[0])} /></label><button className="secondary" onClick={leave}>End session</button>
  </GameShell>;

  if (screen === 'guest') return <GameShell title="Guest Player 2" subtitle={`Room ${formatCode(roomCode)}`} canvasRef={guestCanvas}><StatusPanel diagnostics={diagnostics} status={status} /><TouchControls onKeys={(keys) => sessionRef.current?.sendInput(keys)} /><button className="secondary" onClick={leave}>Disconnect</button></GameShell>;

  return <main className="home"><div className="brand"><span className="star">✦</span><p className="eyebrow">ONLINE GBA ADVENTURES</p><h1>Kirby Online</h1><p className="lede">Two linked players. One shared adventure.</p></div><section className="home-card"><button onClick={startHost}>Create room <span>→</span></button><div className="join-row"><input inputMode="numeric" maxLength={6} placeholder="ROOM CODE" value={room} onChange={(e) => setRoom(e.target.value.replace(/\D/g, ''))} /><button className="secondary" onClick={joinRoom}>Join</button></div><label className="file-button home-file">Load ROM for host<input type="file" accept=".gba,.gb,.gbc" onChange={(e) => e.target.files?.[0] && loadRom(e.target.files[0])} /></label><p className="status">{status}</p></section><footer>Host runs both linked consoles. Guests receive Player 2 video and send Player 2 controls.</footer></main>;
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
  const start = Math.max(context.currentTime + 0.02, audioNextTime.current);
  source.start(start); audioNextTime.current = start + buffer.duration;
}

function GameShell({ title, subtitle, canvasRef, children, local = false }: { title: string; subtitle: string; canvasRef: React.RefObject<HTMLCanvasElement>; children: React.ReactNode; local?: boolean }) { return <main className="game-shell"><header><div><p className="eyebrow">KIRBY ONLINE</p><h1>{title}</h1><p className="muted">{subtitle}</p></div><span className={`live-dot ${local ? 'host' : ''}`}>{local ? 'HOST' : 'GUEST'}</span></header><section className="play-layout"><div className="screen-card"><canvas ref={canvasRef} aria-label="Game screen" /><div className="screen-caption">{local ? 'PLAYER 1 · LOCAL' : 'PLAYER 2 · REMOTE'}</div></div><aside>{children}</aside></section></main>; }

function StatusPanel({ diagnostics, status }: { diagnostics: Diagnostics; status: string }) { return <div className="status-panel"><strong>{status}</strong><dl><dt>Signaling</dt><dd>{diagnostics.signaling}</dd><dt>Connection</dt><dd>{diagnostics.connection}</dd><dt>ICE</dt><dd>{diagnostics.ice}</dd><dt>Candidate</dt><dd>{diagnostics.candidate}</dd><dt>RTT</dt><dd>{diagnostics.rtt ? `${Math.round(diagnostics.rtt)} ms` : '—'}</dd></dl>{diagnostics.error && <p className="error">{diagnostics.error}</p>}</div>; }
