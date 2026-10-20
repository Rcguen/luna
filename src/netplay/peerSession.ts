import Peer, { type DataConnection } from 'peerjs';
import type { AudioMessage, FrameMessage, WireMessage } from './protocol';
import { isWireMessage, newRoomCode } from './protocol';

export type Diagnostics = {
  signaling: string;
  connection: string;
  ice: string;
  gathering: string;
  candidate: string;
  channel: string;
  rtt: number | null;
  fps: number | null;
  error: string;
};

export type SessionEvents = {
  status: (text: string) => void;
  diagnostics: (value: Diagnostics) => void;
  guestRequest: (approve: () => void, reject: () => void) => void;
  input: (keys: number) => void;
  frame: (message: FrameMessage) => void;
  audio: (message: AudioMessage) => void;
  closed: () => void;
};

const iceServers: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

export class PeerSession {
  private peer: Peer | null = null;
  private connection: DataConnection | null = null;
  private diagnosticsTimer = 0;
  private events: SessionEvents;
  private lastError = '';
  private room = '';
  private approved = false;
  private hostRequestShown = false;
  private closed = false;
  private receivedFrames = 0;
  private lastFpsAt = performance.now();

  constructor(events: SessionEvents) { this.events = events; }

  async host(): Promise<string> {
    this.resetLifecycle();
    this.room = newRoomCode();
    this.peer = new Peer(`kirby-${this.room}`, { config: iceServers });
    await this.openPeer();
    this.peer.on('connection', (connection) => this.acceptIncoming(connection));
    this.events.status('Room ready. Share the code and approve the guest.');
    return this.room;
  }

  async join(room: string): Promise<void> {
    this.resetLifecycle();
    const clean = room.replace(/\D/g, '');
    if (clean.length !== 6) throw new Error('Room codes are exactly six digits');
    this.room = clean;
    this.peer = new Peer({ config: iceServers });
    await this.openPeer();
    const connection = this.peer.connect(`kirby-${clean}`, { reliable: true });
    this.attach(connection, false);
    this.events.status('Waiting for host approval…');
  }

  approve(): void { this.approved = true; this.send({ type: 'approval', accepted: true }); }
  reject(): void { this.send({ type: 'approval', accepted: false, reason: 'Host rejected the join request' }); this.close(); }
  sendInput(keys: number): void { if (this.approved) this.send({ type: 'input', keys: keys >>> 0 }); }
  sendFrame(frame: FrameMessage): void { if (this.approved) this.send(frame); }
  sendAudio(audio: AudioMessage): void { if (this.approved) this.send(audio); }
  roomCode(): string { return this.room; }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearInterval(this.diagnosticsTimer);
    this.connection?.close();
    this.peer?.destroy();
    this.connection = null;
    this.peer = null;
    this.events.closed();
  }

  private resetLifecycle(): void {
    this.closed = false;
    this.approved = false;
    this.hostRequestShown = false;
    this.lastError = '';
    this.receivedFrames = 0;
    this.lastFpsAt = performance.now();
  }

  private openPeer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = this.peer;
      if (!peer) return reject(new Error('Peer not initialized'));
      const timer = window.setTimeout(() => reject(new Error('Signaling service timed out')), 12000);
      peer.on('open', () => { window.clearTimeout(timer); resolve(); });
      peer.on('error', (error) => {
        this.lastError = error.message || error.type || 'PeerJS error';
        this.events.status(`Connection error: ${this.lastError}`);
        if (error.type !== 'peer-unavailable') reject(error);
      });
      peer.on('disconnected', () => this.events.status('Signaling disconnected'));
    });
  }

  private acceptIncoming(connection: DataConnection): void {
    if (this.connection) { connection.close(); return; }
    this.attach(connection, true);
  }

  private attach(connection: DataConnection, hostSide: boolean): void {
    this.connection = connection;
    connection.on('open', () => {
      this.send({ type: 'hello', protocol: 1 });
      this.events.status(hostSide ? 'Guest connected; approval required.' : 'Connected to host; awaiting approval.');
    });
    connection.on('data', (value) => this.handle(value, hostSide));
    connection.on('close', () => { if (!this.closed) { this.events.status('Peer disconnected'); this.close(); } });
    connection.on('error', (error) => { this.lastError = error.message || 'Data connection error'; this.events.status(`Peer error: ${this.lastError}`); });
    this.startDiagnostics(connection);
  }

  private handle(value: unknown, hostSide: boolean): void {
    if (!isWireMessage(value)) return;
    if (value.type === 'hello') {
      if (hostSide && !this.hostRequestShown) {
        this.hostRequestShown = true;
        this.events.guestRequest(() => this.approve(), () => this.reject());
      }
      return;
    }
    if (value.type === 'input' && hostSide && this.approved) this.events.input(value.keys);
    if (value.type === 'frame' && !hostSide && this.approved) { this.receivedFrames += 1; this.events.frame(value); }
    if (value.type === 'audio' && !hostSide && this.approved) this.events.audio(value);
    if (value.type === 'approval' && !hostSide) {
      if (value.accepted) { this.approved = true; this.events.status('Host approved the session.'); }
      else { this.events.status(value.reason || 'Host rejected the session.'); this.close(); }
    }
    if (value.type === 'ping') this.send({ type: 'pong', sentAt: value.sentAt });
    if (value.type === 'pong') this.events.diagnostics({ ...this.currentDiagnostics(), rtt: performance.now() - value.sentAt });
  }

  private send(message: WireMessage): void {
    if (!this.connection?.open) return;
    const dataChannel = (this.connection as DataConnection & { dataChannel?: RTCDataChannel }).dataChannel;
    if (dataChannel && dataChannel.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.lastError = 'Connection buffer is full; media packet skipped.';
      return;
    }
    this.connection.send(message);
  }

  private startDiagnostics(connection: DataConnection): void {
    window.clearInterval(this.diagnosticsTimer);
    this.diagnosticsTimer = window.setInterval(() => {
      void this.refreshDiagnostics(connection);
    }, 1000);
  }

  private async refreshDiagnostics(connection: DataConnection): Promise<void> {
      const pc = (connection as DataConnection & { peerConnection?: RTCPeerConnection }).peerConnection;
      const result = this.currentDiagnostics(pc);
      const now = performance.now();
      if (now - this.lastFpsAt >= 1000) {
        result.fps = this.receivedFrames * 1000 / (now - this.lastFpsAt);
        this.receivedFrames = 0;
        this.lastFpsAt = now;
      }
      if (pc) {
        try {
          const reports = await pc.getStats();
          const candidates = new Map<string, { candidateType?: string }>();
          let selected: { localCandidateId?: string; remoteCandidateId?: string; currentRoundTripTime?: number; nominated?: boolean; state?: string } | null = null;
          reports.forEach((report) => {
            if (report.type === 'local-candidate' || report.type === 'remote-candidate') candidates.set(report.id, report);
            if (report.type === 'candidate-pair' && (report.nominated || report.selected || report.state === 'succeeded')) selected = report;
          });
          if (selected) {
            result.candidate = candidates.get(selected.localCandidateId || '')?.candidateType || 'unavailable';
            result.rtt = typeof selected.currentRoundTripTime === 'number' ? selected.currentRoundTripTime * 1000 : result.rtt;
          }
        } catch (error) {
          this.lastError = error instanceof Error ? error.message : String(error);
        }
      }
      if (connection.open) this.send({ type: 'ping', sentAt: performance.now() });
      this.events.diagnostics(result);
  }

  private currentDiagnostics(pc?: RTCPeerConnection): Diagnostics {
    const direct = pc ?? (this.connection as DataConnection & { peerConnection?: RTCPeerConnection } | null)?.peerConnection;
    return {
      signaling: this.peer?.open ? 'open' : 'connecting',
      connection: direct?.connectionState || (this.connection?.open ? 'open' : 'new'),
      ice: direct?.iceConnectionState || 'unavailable',
      gathering: direct?.iceGatheringState || 'unavailable',
      candidate: 'unavailable',
      channel: (this.connection as DataConnection & { dataChannel?: RTCDataChannel } | null)?.dataChannel?.readyState || 'unavailable',
      rtt: null,
      fps: null,
      error: this.lastError,
    };
  }
}
