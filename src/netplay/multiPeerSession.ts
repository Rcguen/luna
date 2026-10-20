import Peer, { type DataConnection } from 'peerjs';
import type { AudioMessage, FrameMessage, WireMessage } from './protocol';
import { isWireMessage, newRoomCode } from './protocol';
import type { Diagnostics, PlayerSlot } from './peerSession';

export type MultiGuestRequest = {
  peerId: string;
  clientId: string;
  slot: PlayerSlot;
  approve: () => void;
  reject: () => void;
};

export type MultiSessionEvents = {
  status: (text: string) => void;
  diagnostics: (value: Diagnostics) => void;
  guestRequest: (request: MultiGuestRequest) => void;
  input: (slot: PlayerSlot, keys: number) => void;
  frame: (slot: PlayerSlot, message: FrameMessage) => void;
  audio: (slot: PlayerSlot, message: AudioMessage) => void;
  connection: (slot: PlayerSlot, state: 'pending' | 'connected' | 'disconnected', capacity?: number) => void;
  closed: () => void;
};

type ConnectionState = {
  connection: DataConnection;
  clientId: string;
  slot: PlayerSlot | null;
  approved: boolean;
  helloTimer?: number;
  receivedFrames: number;
  lastFpsAt: number;
  lastError: string;
  lastFrameSequence: number;
  droppedFrames: number;
  pendingFrame?: FrameMessage;
  frameFlushTimer?: number;
};

const iceServers: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] };
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
const FRAME_BUFFERED_HIGH_WATER = 256 * 1024;
const FRAME_BUFFERED_LOW_WATER = 64 * 1024;
const AUDIO_BUFFERED_HIGH_WATER = 96 * 1024;

function clientId(): string {
  const key = 'luna-client-id';
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const value = globalThis.crypto?.randomUUID?.() || `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(key, value);
  return value;
}

function isPlayerSlot(value: number | undefined): value is PlayerSlot { return value === 1 || value === 2 || value === 3 || value === 4; }

export class MultiPeerSession {
  private peer: Peer | null = null;
  private connections = new Map<string, ConnectionState>();
  private rememberedSlots = new Map<string, PlayerSlot>();
  private timers = new Map<string, number>();
  private room = '';
  private roomCapacity = 2;
  private assigned: PlayerSlot | null = null;
  private approved = false;
  private closed = false;
  private lastError = '';
  private lastInput = -1;
  private readonly id = clientId();

  constructor(private readonly events: MultiSessionEvents) {}

  async host(capacity: number): Promise<string> {
    if (![2, 3, 4].includes(capacity)) throw new Error('Rooms support 2, 3, or 4 players.');
    this.reset();
    this.roomCapacity = capacity;
    this.room = newRoomCode();
    this.peer = new Peer(`kirby-${this.room}`, { config: iceServers });
    await this.openPeer();
    this.peer.on('connection', (connection) => this.accept(connection));
    this.events.status(`${capacity}-player room ready. Approve guests as they join.`);
    return this.room;
  }

  async join(room: string): Promise<void> {
    this.reset();
    const clean = room.replace(/\D/g, '');
    if (clean.length !== 6) throw new Error('Room codes are exactly six digits');
    this.room = clean;
    this.peer = new Peer({ config: iceServers });
    await this.openPeer();
    this.attach(this.peer.connect(`kirby-${clean}`, { reliable: true }), false);
    this.events.status('Waiting for host approval and a player slot…');
  }

  approve(peerId: string): void {
    const state = this.connections.get(peerId);
    if (!state?.slot) return;
    state.approved = true;
    this.send(state, { type: 'approval', accepted: true, slot: state.slot, capacity: this.roomCapacity });
    this.events.connection(state.slot, 'connected', this.roomCapacity);
    this.events.status(`Player ${state.slot} approved.`);
  }

  reject(peerId: string): void {
    const state = this.connections.get(peerId);
    if (!state) return;
    this.send(state, { type: 'approval', accepted: false, reason: 'Host rejected the join request' });
    this.closeConnection(state);
  }

  sendInput(keys: number): void {
    const state = this.connections.values().next().value as ConnectionState | undefined;
    const next = keys >>> 0;
    if (this.approved && state && next !== this.lastInput) {
      this.lastInput = next;
      this.send(state, { type: 'input', keys: next });
    }
  }

  sendFrame(slot: PlayerSlot, frame: FrameMessage): void {
    for (const state of this.connections.values()) {
      if (state.approved && state.slot === slot) {
        // Frames are disposable. Keep only the newest frame so a reliable
        // DataChannel cannot turn temporary congestion into visible latency.
        state.pendingFrame = frame;
        this.flushFrame(state);
      }
    }
  }
  sendAudio(slot: PlayerSlot, audio: AudioMessage): void {
    for (const state of this.connections.values()) {
      if (!state.approved || state.slot !== slot) continue;
      // Audio shares an ordered DataChannel with video. Drop audio while a
      // frame is waiting, or while the channel is moderately queued, so
      // audio cannot create head-of-line blocking for the newest frame.
      const channel = this.dataChannel(state);
      if (state.pendingFrame || (channel && channel.bufferedAmount > AUDIO_BUFFERED_HIGH_WATER)) continue;
      this.send(state, audio, true, AUDIO_BUFFERED_HIGH_WATER);
    }
  }
  roomCode(): string { return this.room; }
  capacity(): number { return this.roomCapacity; }
  assignedSlot(): PlayerSlot | null { return this.assigned; }
  connectedSlots(): PlayerSlot[] { return [...this.connections.values()].flatMap((state) => state.approved && state.slot ? [state.slot] : []); }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const state of [...this.connections.values()]) this.closeConnection(state, false);
    for (const timer of this.timers.values()) window.clearInterval(timer);
    this.timers.clear();
    this.peer?.destroy();
    this.peer = null;
    this.events.closed();
  }

  private reset(): void {
    this.close();
    this.closed = false;
    this.approved = false;
    this.assigned = null;
    this.connections.clear();
    this.timers.clear();
    this.lastError = '';
    this.lastInput = -1;
  }

  private openPeer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = this.peer;
      if (!peer) return reject(new Error('Peer not initialized'));
      const timeout = window.setTimeout(() => reject(new Error('Signaling service timed out')), 12000);
      peer.on('open', () => { window.clearTimeout(timeout); resolve(); });
      peer.on('error', (error) => {
        this.lastError = error.message || error.type || 'PeerJS error';
        this.events.status(`Connection error: ${this.lastError}`);
        if (error.type !== 'peer-unavailable') reject(error);
      });
      peer.on('disconnected', () => this.events.status('Signaling disconnected; reconnecting…'));
    });
  }

  private accept(connection: DataConnection): void {
    if (this.connections.size >= this.roomCapacity - 1) {
      connection.on('open', () => this.send(connection, { type: 'approval', accepted: false, reason: 'Room is full.' }));
      window.setTimeout(() => connection.close(), 1500);
      return;
    }
    this.attach(connection, true);
  }

  private attach(connection: DataConnection, hostSide: boolean): void {
    const state: ConnectionState = { connection, clientId: '', slot: null, approved: !hostSide, receivedFrames: 0, lastFpsAt: performance.now(), lastError: '', lastFrameSequence: -1, droppedFrames: 0 };
    this.connections.set(connection.peer, state);
    connection.on('open', () => {
      this.configureChannel(state);
      const hello = () => this.send(state, { type: 'hello', protocol: 1, clientId: this.id });
      hello();
      // A data channel can report open before the first application packet
      // reaches the other PeerJS endpoint. Retry until approval closes the
      // handshake without changing the assigned slot.
      if (!hostSide) state.helloTimer = window.setInterval(() => { if (!state.approved) hello(); }, 1000);
      this.events.status(hostSide ? 'Guest connected; approval and slot assignment required.' : 'Connected to host; awaiting approval…');
    });
    connection.on('data', (value) => this.handle(state, value, hostSide));
    connection.on('close', () => this.closeConnection(state));
    connection.on('error', (error) => { state.lastError = error.message || 'Data connection error'; this.lastError = state.lastError; this.events.status(`Peer error: ${state.lastError}`); });
    this.startDiagnostics(state);
  }

  private handle(state: ConnectionState, value: unknown, hostSide: boolean): void {
    if (!isWireMessage(value)) return;
    if (value.type === 'hello') {
      if (!hostSide) return;
      if (state.clientId) return;
      state.clientId = value.clientId;
      if ([...this.connections.values()].some((item) => item !== state && item.clientId === value.clientId)) { this.send(state, { type: 'approval', accepted: false, reason: 'This player is already connected.' }); this.closeConnection(state); return; }
      state.slot = this.findSlot(value.clientId);
      if (!state.slot) { this.send(state, { type: 'approval', accepted: false, reason: 'Room is full.' }); this.closeConnection(state); return; }
      this.events.connection(state.slot, 'pending');
      this.events.guestRequest({ peerId: state.connection.peer, clientId: value.clientId, slot: state.slot, approve: () => this.approve(state.connection.peer), reject: () => this.reject(state.connection.peer) });
      return;
    }
    if (value.type === 'input' && hostSide && state.approved && state.slot) this.events.input(state.slot, value.keys);
    if (value.type === 'frame' && !hostSide && state.approved && this.assigned) {
      state.receivedFrames += 1;
      if (value.sequence !== undefined) {
        if (state.lastFrameSequence >= 0 && value.sequence > state.lastFrameSequence + 1) state.droppedFrames += value.sequence - state.lastFrameSequence - 1;
        state.lastFrameSequence = value.sequence;
      }
      this.events.frame(this.assigned, value);
    }
    if (value.type === 'audio' && !hostSide && state.approved && this.assigned) this.events.audio(this.assigned, value);
    if (value.type === 'approval' && !hostSide) {
      if (state.helloTimer) { window.clearInterval(state.helloTimer); state.helloTimer = undefined; }
      if (value.accepted && isPlayerSlot(value.slot)) { state.approved = true; this.approved = true; this.assigned = value.slot; this.roomCapacity = value.capacity || this.roomCapacity; this.events.connection(value.slot, 'connected', this.roomCapacity); this.events.status(`Approved as Player ${value.slot}.`); }
      else if (!value.accepted) { this.events.status(value.reason || 'Host rejected the session.'); this.close(); }
    }
    if (value.type === 'ping') this.send(state, { type: 'pong', sentAt: value.sentAt });
    if (value.type === 'pong') this.events.diagnostics({ ...this.currentDiagnostics(state), rtt: performance.now() - value.sentAt });
  }

  private findSlot(id: string): PlayerSlot | null {
    const remembered = this.rememberedSlots.get(id);
    if (remembered && !this.slotInUse(remembered)) return remembered;
    for (let slot = 2; slot <= this.roomCapacity; slot += 1) if (!this.slotInUse(slot as PlayerSlot)) { this.rememberedSlots.set(id, slot as PlayerSlot); return slot as PlayerSlot; }
    return null;
  }

  private slotInUse(slot: PlayerSlot): boolean { return [...this.connections.values()].some((state) => state.slot === slot); }

  private configureChannel(state: ConnectionState): void {
    const channel = this.dataChannel(state);
    if (!channel) return;
    channel.bufferedAmountLowThreshold = FRAME_BUFFERED_LOW_WATER;
    channel.addEventListener('bufferedamountlow', () => this.flushFrame(state));
  }

  private dataChannel(state: ConnectionState): RTCDataChannel | undefined {
    return (state.connection as DataConnection & { dataChannel?: RTCDataChannel }).dataChannel;
  }

  private flushFrame(state: ConnectionState): void {
    if (state.frameFlushTimer || !state.pendingFrame || !state.approved || !state.connection.open) return;
    const channel = this.dataChannel(state);
    if (channel && channel.bufferedAmount > FRAME_BUFFERED_HIGH_WATER) {
      state.frameFlushTimer = window.setTimeout(() => {
        state.frameFlushTimer = undefined;
        this.flushFrame(state);
      }, 16);
      return;
    }
    const frame = state.pendingFrame;
    if (this.send(state, frame, true, FRAME_BUFFERED_HIGH_WATER)) state.pendingFrame = undefined;
  }

  private send(state: ConnectionState | DataConnection, message: WireMessage, media = false, highWater = MAX_BUFFERED_BYTES): boolean {
    const connection = 'connection' in state ? state.connection : state;
    if (!connection.open) return false;
    const channel = (connection as DataConnection & { dataChannel?: RTCDataChannel }).dataChannel;
    if (channel && channel.bufferedAmount > highWater) {
      this.lastError = media ? 'Media queue is congested; waiting for the newest frame.' : 'Connection buffer is full; control packet skipped.';
      return false;
    }
    connection.send(message);
    return true;
  }

  private closeConnection(state: ConnectionState, notify = true): void {
    if (!this.connections.delete(state.connection.peer)) return;
    if (state.helloTimer) window.clearInterval(state.helloTimer);
    if (state.frameFlushTimer) window.clearTimeout(state.frameFlushTimer);
    state.frameFlushTimer = undefined;
    state.pendingFrame = undefined;
    const timer = this.timers.get(state.connection.peer);
    if (timer) window.clearInterval(timer);
    this.timers.delete(state.connection.peer);
    state.connection.close();
    if (notify && state.slot) { this.events.connection(state.slot, 'disconnected'); this.events.status(`Player ${state.slot} disconnected.`); if (this.assigned === null) this.events.closed(); }
  }

  private startDiagnostics(state: ConnectionState): void { this.timers.set(state.connection.peer, window.setInterval(() => { void this.refreshDiagnostics(state); }, 1000)); }

  private async refreshDiagnostics(state: ConnectionState): Promise<void> {
    const result = this.currentDiagnostics(state);
    const now = performance.now();
    if (now - state.lastFpsAt >= 1000) { result.fps = state.receivedFrames * 1000 / (now - state.lastFpsAt); result.droppedFrames = state.droppedFrames; state.receivedFrames = 0; state.droppedFrames = 0; state.lastFpsAt = now; }
    const pc = (state.connection as DataConnection & { peerConnection?: RTCPeerConnection }).peerConnection;
    if (pc) {
      try {
        const reports = await pc.getStats();
        const candidates = new Map<string, { candidateType?: string }>();
        let selected: { localCandidateId?: string; currentRoundTripTime?: number; nominated?: boolean; selected?: boolean; state?: string } | null = null;
        reports.forEach((report) => {
          if (report.type === 'local-candidate') candidates.set(report.id, report);
          if (report.type === 'candidate-pair' && (report.nominated || report.selected || report.state === 'succeeded')) selected = report;
          if (report.type === 'data-channel') {
            if (typeof report.bytesSent === 'number') result.bytesSent = report.bytesSent;
            if (typeof report.bytesReceived === 'number') result.bytesReceived = report.bytesReceived;
          }
        });
        if (selected) { result.candidate = candidates.get(selected.localCandidateId || '')?.candidateType || 'unavailable'; result.rtt = typeof selected.currentRoundTripTime === 'number' ? selected.currentRoundTripTime * 1000 : null; }
      } catch (error) { state.lastError = error instanceof Error ? error.message : String(error); }
    }
    if (state.connection.open) this.send(state, { type: 'ping', sentAt: performance.now() });
    this.events.diagnostics(result);
  }

  private currentDiagnostics(state: ConnectionState): Diagnostics {
    const pc = (state.connection as DataConnection & { peerConnection?: RTCPeerConnection }).peerConnection;
    const channel = this.dataChannel(state);
    return { signaling: this.peer?.open ? 'open' : 'connecting', connection: pc?.connectionState || (state.connection.open ? 'open' : 'new'), ice: pc?.iceConnectionState || 'unavailable', gathering: pc?.iceGatheringState || 'unavailable', candidate: 'unavailable', channel: channel?.readyState || 'unavailable', rtt: null, fps: null, droppedFrames: 0, bufferedBytes: channel?.bufferedAmount ?? null, bytesSent: null, bytesReceived: null, error: state.lastError || this.lastError };
  }
}
