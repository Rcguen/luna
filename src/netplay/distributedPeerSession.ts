import Peer, { type DataConnection } from 'peerjs';
import type { Diagnostics, PlayerSlot } from './peerSession';
import type { MultiGuestRequest } from './multiPeerSession';
import { isWireMessage, newRoomCode, type WireMessage } from './protocol';

export type DistributedInput = { tick: number; slot: PlayerSlot; keys: number };

export type DistributedSessionEvents = {
  status: (text: string) => void;
  diagnostics: (value: Diagnostics) => void;
  guestRequest: (request: MultiGuestRequest) => void;
  input: (value: DistributedInput) => void;
  started: (tick: number) => void;
  connection: (slot: PlayerSlot, state: 'pending' | 'connected' | 'disconnected', capacity?: number) => void;
  closed: () => void;
};

type ConnectionState = {
  connection: DataConnection;
  clientId: string;
  slot: PlayerSlot | null;
  approved: boolean;
  ready: boolean;
  helloTimer?: number;
  lastError: string;
};

const iceServers: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};
const MAX_BUFFERED_BYTES = 512 * 1024;

function clientId(): string {
  const key = 'luna-client-id';
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const value = globalThis.crypto?.randomUUID?.() || `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(key, value);
  return value;
}

function isPlayerSlot(value: number | undefined): value is PlayerSlot {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/**
 * Transport for deterministic replicated emulation.
 *
 * Every participant runs the same local mGBA linked-core group. This class
 * transports only the per-frame input vector and the ROM agreement handshake;
 * it intentionally never transports video, audio, ROM bytes, or save data.
 * The host relays guest input so every browser consumes the same ordered input
 * stream. A missing tick therefore pauses the local emulator instead of
 * allowing the two copies to diverge silently.
 */
export class DistributedPeerSession {
  private peer: Peer | null = null;
  private connections = new Map<string, ConnectionState>();
  private rememberedSlots = new Map<string, PlayerSlot>();
  private timers = new Map<string, number>();
  private room = '';
  private roomCapacity = 2;
  private romHash = '';
  private assigned: PlayerSlot | null = null;
  private approved = false;
  private localReady = false;
  private started = false;
  private closed = false;
  private lastError = '';
  private readonly id = clientId();

  constructor(private readonly events: DistributedSessionEvents) {}

  async host(capacity: number, romHash: string): Promise<string> {
    if (![2, 3, 4].includes(capacity)) throw new Error('Distributed rooms support 2, 3, or 4 players.');
    this.reset();
    this.roomCapacity = capacity;
    this.romHash = romHash;
    this.room = newRoomCode();
    this.peer = new Peer(`luna-dist-${this.room}`, { config: iceServers });
    await this.openPeer();
    this.peer.on('connection', (connection) => this.accept(connection));
    this.events.status(`${capacity}-player distributed room ready. Each player must load the same ROM.`);
    return this.room;
  }

  async join(room: string, romHash: string): Promise<void> {
    this.reset();
    const clean = room.replace(/\D/g, '');
    if (clean.length !== 6) throw new Error('Room codes are exactly six digits');
    this.room = clean;
    this.romHash = romHash;
    this.peer = new Peer({ config: iceServers });
    await this.openPeer();
    this.attach(this.peer.connect(`luna-dist-${clean}`, { reliable: true }), false);
    this.events.status('Connected to distributed room; awaiting host approval…');
  }

  approve(peerId: string): void {
    const state = this.connections.get(peerId);
    if (!state?.slot) return;
    state.approved = true;
    this.send(state, { type: 'dist-approval', accepted: true, slot: state.slot, capacity: this.roomCapacity, romHash: this.romHash });
    this.events.connection(state.slot, 'connected', this.roomCapacity);
    this.events.status(`Player ${state.slot} approved. Waiting for matching ROMs and ready state.`);
    this.tryStart();
  }

  reject(peerId: string): void {
    const state = this.connections.get(peerId);
    if (!state) return;
    this.send(state, { type: 'dist-approval', accepted: false, reason: 'Host rejected the join request' });
    this.closeConnection(state);
  }

  markReady(): void {
    if (this.closed || !this.approved && this.assigned !== null) return;
    this.localReady = true;
    if (this.assigned !== null) {
      const state = this.connections.values().next().value as ConnectionState | undefined;
      if (state) this.send(state, { type: 'dist-ready', romHash: this.romHash });
    }
    this.tryStart();
  }

  sendInput(tick: number, slot: PlayerSlot, keys: number): void {
    if (!this.started || this.closed) return;
    const message = { type: 'dist-input', tick, slot, keys: keys >>> 0 } as const;
    if (slot === 1 && this.assigned === null) {
      for (const state of this.connections.values()) if (state.approved) this.send(state, message);
      return;
    }
    const state = this.connections.values().next().value as ConnectionState | undefined;
    if (state?.approved && this.assigned === slot) this.send(state, message);
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
    this.localReady = false;
    this.started = false;
    this.connections.clear();
    this.timers.clear();
    this.lastError = '';
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
      connection.on('open', () => this.send(connection, { type: 'dist-approval', accepted: false, reason: 'Room is full.' }));
      window.setTimeout(() => connection.close(), 1500);
      return;
    }
    this.attach(connection, true);
  }

  private attach(connection: DataConnection, hostSide: boolean): void {
    const state: ConnectionState = { connection, clientId: '', slot: null, approved: false, ready: false, lastError: '' };
    this.connections.set(connection.peer, state);
    connection.on('open', () => {
      const hello = () => this.send(state, { type: 'dist-hello', protocol: 1, clientId: this.id, capacity: this.roomCapacity, romHash: this.romHash });
      hello();
      if (!hostSide) state.helloTimer = window.setInterval(() => { if (!state.approved) hello(); }, 1000);
      this.events.status(hostSide ? 'Guest connected; approval required.' : 'Connected to host; awaiting approval…');
    });
    connection.on('data', (value) => this.handle(state, value, hostSide));
    connection.on('close', () => this.closeConnection(state));
    connection.on('error', (error) => { state.lastError = error.message || 'Data connection error'; this.lastError = state.lastError; this.events.status(`Peer error: ${state.lastError}`); });
    this.startDiagnostics(state);
  }

  private handle(state: ConnectionState, value: unknown, hostSide: boolean): void {
    if (!isWireMessage(value)) return;
    if (value.type === 'dist-hello') {
      if (!hostSide || state.clientId) return;
      state.clientId = value.clientId;
      if (value.capacity !== this.roomCapacity) { this.send(state, { type: 'dist-approval', accepted: false, reason: 'Both players must choose the same room size.' }); this.closeConnection(state); return; }
      if (value.romHash !== this.romHash) { this.send(state, { type: 'dist-approval', accepted: false, reason: 'ROM files do not match. Load the exact same ROM on both devices.' }); this.closeConnection(state); return; }
      if ([...this.connections.values()].some((item) => item !== state && item.clientId === value.clientId)) { this.send(state, { type: 'dist-approval', accepted: false, reason: 'This player is already connected.' }); this.closeConnection(state); return; }
      state.slot = this.findSlot(value.clientId);
      if (!state.slot) { this.send(state, { type: 'dist-approval', accepted: false, reason: 'Room is full.' }); this.closeConnection(state); return; }
      this.events.connection(state.slot, 'pending');
      this.events.guestRequest({ peerId: state.connection.peer, clientId: value.clientId, slot: state.slot, approve: () => this.approve(state.connection.peer), reject: () => this.reject(state.connection.peer) });
      return;
    }
    if (value.type === 'dist-approval' && !hostSide) {
      if (!value.accepted) { this.events.status(value.reason || 'Host rejected the session.'); this.close(); return; }
      if (!isPlayerSlot(value.slot) || value.romHash !== this.romHash) { this.events.status('Host rejected the session because the ROM hash did not match.'); this.close(); return; }
      if (state.helloTimer) { window.clearInterval(state.helloTimer); state.helloTimer = undefined; }
      state.approved = true;
      this.approved = true;
      this.assigned = value.slot;
      this.roomCapacity = value.capacity || this.roomCapacity;
      this.events.connection(value.slot, 'connected', this.roomCapacity);
      this.events.status(`Approved as Player ${value.slot}. Waiting for synchronized start…`);
      return;
    }
    if (value.type === 'dist-ready') {
      if (!hostSide || !state.approved || value.romHash !== this.romHash) return;
      state.ready = true;
      this.tryStart();
      return;
    }
    if (value.type === 'dist-start' && !hostSide && state.approved && value.romHash === this.romHash) {
      this.started = true;
      this.events.started(value.tick);
      this.events.status('Distributed link started. Both devices are running local emulation.');
      return;
    }
    if (value.type === 'dist-input') {
      if (hostSide) {
        if (!state.approved || state.slot !== value.slot) return;
        this.events.input({ tick: value.tick, slot: value.slot as PlayerSlot, keys: value.keys });
        for (const peer of this.connections.values()) if (peer.approved) this.send(peer, value);
      } else if (state.approved && isPlayerSlot(value.slot)) {
        this.events.input({ tick: value.tick, slot: value.slot, keys: value.keys });
      }
      return;
    }
    if (value.type === 'dist-stop') { this.events.status(value.reason || 'Distributed peer stopped.'); this.close(); return; }
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

  private tryStart(): void {
    if (this.started || !this.localReady || this.assigned !== null) return;
    const peers = [...this.connections.values()].filter((state) => state.approved);
    if (peers.length !== this.roomCapacity - 1 || peers.some((state) => !state.ready)) return;
    this.started = true;
    for (const state of peers) this.send(state, { type: 'dist-start', tick: 0, romHash: this.romHash });
    this.events.started(0);
    this.events.status('All players are ready. Distributed link started.');
  }

  private send(state: ConnectionState | DataConnection, message: WireMessage): void {
    const connection = 'connection' in state ? state.connection : state;
    if (!connection.open) return;
    const channel = (connection as DataConnection & { dataChannel?: RTCDataChannel }).dataChannel;
    if (channel && channel.bufferedAmount > MAX_BUFFERED_BYTES) { this.lastError = 'Input channel is congested; waiting for the peer.'; return; }
    connection.send(message);
  }

  private closeConnection(state: ConnectionState, notify = true): void {
    if (!this.connections.delete(state.connection.peer)) return;
    if (state.helloTimer) window.clearInterval(state.helloTimer);
    const timer = this.timers.get(state.connection.peer);
    if (timer) window.clearInterval(timer);
    this.timers.delete(state.connection.peer);
    state.connection.close();
    if (notify && state.slot) { this.events.connection(state.slot, 'disconnected'); this.events.status(`Player ${state.slot} disconnected. Distributed emulation paused.`); }
  }

  private startDiagnostics(state: ConnectionState): void { this.timers.set(state.connection.peer, window.setInterval(() => { void this.refreshDiagnostics(state); }, 1000)); }

  private async refreshDiagnostics(state: ConnectionState): Promise<void> {
    const result = this.currentDiagnostics(state);
    const pc = (state.connection as DataConnection & { peerConnection?: RTCPeerConnection }).peerConnection;
    if (pc) {
      try {
        const reports = await pc.getStats();
        const candidates = new Map<string, { candidateType?: string }>();
        let selected: { localCandidateId?: string; currentRoundTripTime?: number; nominated?: boolean; selected?: boolean; state?: string } | null = null;
        reports.forEach((report) => { if (report.type === 'local-candidate') candidates.set(report.id, report); if (report.type === 'candidate-pair' && (report.nominated || report.selected || report.state === 'succeeded')) selected = report; });
        if (selected) { result.candidate = candidates.get(selected.localCandidateId || '')?.candidateType || 'unavailable'; result.rtt = typeof selected.currentRoundTripTime === 'number' ? selected.currentRoundTripTime * 1000 : null; }
      } catch (error) { state.lastError = error instanceof Error ? error.message : String(error); }
    }
    if (state.connection.open) this.send(state, { type: 'ping', sentAt: performance.now() });
    this.events.diagnostics(result);
  }

  private currentDiagnostics(state: ConnectionState): Diagnostics {
    const pc = (state.connection as DataConnection & { peerConnection?: RTCPeerConnection }).peerConnection;
    return { signaling: this.peer?.open ? 'open' : 'connecting', connection: pc?.connectionState || (state.connection.open ? 'open' : 'new'), ice: pc?.iceConnectionState || 'unavailable', gathering: pc?.iceGatheringState || 'unavailable', candidate: 'unavailable', channel: (state.connection as DataConnection & { dataChannel?: RTCDataChannel }).dataChannel?.readyState || 'unavailable', rtt: null, fps: null, error: state.lastError || this.lastError };
  }
}
