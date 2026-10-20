import Peer, { type DataConnection } from 'peerjs';
import type { AudioMessage, FrameMessage, WireMessage } from './protocol';
import { isWireMessage, newRoomCode } from './protocol';

export type Diagnostics = {
  signaling: string;
  connection: string;
  ice: string;
  gathering: string;
  candidate: string;
  rtt: number | null;
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

export class PeerSession {
  private peer: Peer | null = null;
  private connection: DataConnection | null = null;
  private diagnosticsTimer = 0;
  private events: SessionEvents;
  private lastError = '';
  private room = '';

  constructor(events: SessionEvents) { this.events = events; }

  async host(): Promise<string> {
    this.room = newRoomCode();
    this.peer = new Peer(`kirby-${this.room}`, { config: iceServers });
    await this.openPeer();
    this.peer.on('connection', (connection) => this.acceptIncoming(connection));
    this.events.status('Room ready. Share the code and approve the guest.');
    return this.room;
  }

  async join(room: string): Promise<void> {
    const clean = room.replace(/\D/g, '');
    if (clean.length !== 6) throw new Error('Room codes are exactly six digits');
    this.room = clean;
    this.peer = new Peer({ config: iceServers });
    await this.openPeer();
    const connection = this.peer.connect(`kirby-${clean}`, { reliable: true });
    this.attach(connection, false);
    this.events.status('Waiting for host approval…');
  }

  approve(): void { this.send({ type: 'approval', accepted: true }); }
  reject(): void { this.send({ type: 'approval', accepted: false, reason: 'Host rejected the join request' }); this.close(); }
  sendInput(keys: number): void { this.send({ type: 'input', keys: keys >>> 0 }); }
  sendFrame(frame: FrameMessage): void { this.send(frame); }
  sendAudio(audio: AudioMessage): void { this.send(audio); }
  roomCode(): string { return this.room; }

  close(): void {
    window.clearInterval(this.diagnosticsTimer);
    this.connection?.close();
    this.peer?.destroy();
    this.connection = null;
    this.peer = null;
    this.events.closed();
  }

  private openPeer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = this.peer;
      if (!peer) return reject(new Error('Peer not initialized'));
      const timer = window.setTimeout(() => reject(new Error('Signaling service timed out')), 12000);
      peer.on('open', () => { window.clearTimeout(timer); resolve(); });
      peer.on('error', (error) => {
        this.lastError = error.message || error.type;
        this.events.status(`Connection error: ${this.lastError}`);
        if (error.type !== 'peer-unavailable') reject(error);
      });
      peer.on('disconnected', () => this.events.status('Signaling disconnected'));
    });
  }

  private acceptIncoming(connection: DataConnection): void {
    if (this.connection) { connection.close(); return; }
    this.attach(connection, true);
    this.events.guestRequest(() => this.approve(), () => this.reject());
  }

  private attach(connection: DataConnection, hostSide: boolean): void {
    this.connection = connection;
    connection.on('open', () => {
      this.send({ type: 'hello', protocol: 1 });
      this.events.status(hostSide ? 'Guest connected; approval required.' : 'Connected to host; awaiting approval.');
    });
    connection.on('data', (value) => this.handle(value, hostSide));
    connection.on('close', () => { this.events.status('Peer disconnected'); this.events.closed(); });
    connection.on('error', (error) => { this.lastError = error.message; this.events.status(`Peer error: ${error.message}`); });
    this.startDiagnostics(connection);
  }

  private handle(value: unknown, hostSide: boolean): void {
    if (!isWireMessage(value)) return;
    if (value.type === 'input' && hostSide) this.events.input(value.keys);
    if (value.type === 'frame' && !hostSide) this.events.frame(value);
    if (value.type === 'audio' && !hostSide) this.events.audio(value);
    if (value.type === 'approval' && !hostSide) {
      if (value.accepted) this.events.status('Host approved the session.');
      else { this.events.status(value.reason || 'Host rejected the session.'); this.close(); }
    }
    if (value.type === 'ping') this.send({ type: 'pong', sentAt: value.sentAt });
    if (value.type === 'pong') this.events.diagnostics({ ...this.currentDiagnostics(), rtt: performance.now() - value.sentAt });
  }

  private send(message: WireMessage): void {
    if (this.connection?.open) this.connection.send(message);
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
      rtt: null,
      error: this.lastError,
    };
  }
}
