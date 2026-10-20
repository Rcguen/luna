export type InputMessage = { type: 'input'; keys: number };
export type HelloMessage = { type: 'hello'; protocol: 1; clientId: string };
export type ApprovalMessage = { type: 'approval'; accepted: boolean; reason?: string; slot?: number; capacity?: number };
export type FrameMessage = { type: 'frame'; width: number; height: number; data: ArrayBuffer };
export type AudioMessage = { type: 'audio'; rate: number; data: ArrayBuffer };
export type PingMessage = { type: 'ping'; sentAt: number };
export type PongMessage = { type: 'pong'; sentAt: number };
export type DistributedHelloMessage = { type: 'dist-hello'; protocol: 1; clientId: string; capacity: number; romHash: string };
export type DistributedApprovalMessage = { type: 'dist-approval'; accepted: boolean; reason?: string; slot?: number; capacity?: number; romHash?: string };
export type DistributedReadyMessage = { type: 'dist-ready'; romHash: string };
export type DistributedStartMessage = { type: 'dist-start'; tick: number; romHash: string };
export type DistributedInputMessage = { type: 'dist-input'; tick: number; slot: number; keys: number };
export type DistributedStopMessage = { type: 'dist-stop'; reason?: string };
export type WireMessage = InputMessage | HelloMessage | ApprovalMessage | FrameMessage | AudioMessage | PingMessage | PongMessage |
  DistributedHelloMessage | DistributedApprovalMessage | DistributedReadyMessage | DistributedStartMessage | DistributedInputMessage | DistributedStopMessage;

export const INPUT_MASK = 0x3ff;
export const MAX_FRAME_BYTES = 512 * 1024;
export const MAX_AUDIO_BYTES = 256 * 1024;
export const MAX_APPROVAL_REASON = 200;
export const MAX_CLIENT_ID = 80;
export const MAX_ROM_HASH = 64;
export const MAX_TICK = 0x7fffffff;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isBinary(value: unknown, maxBytes: number): value is ArrayBuffer {
  return value instanceof ArrayBuffer && value.byteLength > 0 && value.byteLength <= maxBytes;
}

export function isWireMessage(value: unknown): value is WireMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'input': return Number.isInteger(value.keys) && value.keys >= 0 && value.keys <= INPUT_MASK;
    case 'hello': return value.protocol === 1 && typeof value.clientId === 'string' && value.clientId.length > 0 && value.clientId.length <= MAX_CLIENT_ID;
    case 'approval': return typeof value.accepted === 'boolean' && (value.reason === undefined || (typeof value.reason === 'string' && value.reason.length <= MAX_APPROVAL_REASON)) && (value.slot === undefined || (Number.isInteger(value.slot) && value.slot >= 2 && value.slot <= 4)) && (value.capacity === undefined || (Number.isInteger(value.capacity) && value.capacity >= 2 && value.capacity <= 4));
    case 'frame': return Number.isInteger(value.width) && value.width >= 1 && value.width <= 1024 && Number.isInteger(value.height) && value.height >= 1 && value.height <= 1024 && isBinary(value.data, MAX_FRAME_BYTES);
    case 'audio': return Number.isFinite(value.rate) && value.rate >= 8000 && value.rate <= 96000 && isBinary(value.data, MAX_AUDIO_BYTES);
    case 'dist-hello': return value.protocol === 1 && typeof value.clientId === 'string' && value.clientId.length > 0 && value.clientId.length <= MAX_CLIENT_ID && Number.isInteger(value.capacity) && value.capacity >= 2 && value.capacity <= 4 && typeof value.romHash === 'string' && /^[a-f0-9]{64}$/i.test(value.romHash);
    case 'dist-approval': return typeof value.accepted === 'boolean' && (value.reason === undefined || (typeof value.reason === 'string' && value.reason.length <= MAX_APPROVAL_REASON)) && (value.slot === undefined || (Number.isInteger(value.slot) && value.slot >= 2 && value.slot <= 4)) && (value.capacity === undefined || (Number.isInteger(value.capacity) && value.capacity >= 2 && value.capacity <= 4)) && (value.romHash === undefined || (typeof value.romHash === 'string' && /^[a-f0-9]{64}$/i.test(value.romHash)));
    case 'dist-ready': return typeof value.romHash === 'string' && /^[a-f0-9]{64}$/i.test(value.romHash);
    case 'dist-start': return Number.isInteger(value.tick) && value.tick >= 0 && value.tick <= MAX_TICK && typeof value.romHash === 'string' && /^[a-f0-9]{64}$/i.test(value.romHash);
    case 'dist-input': return Number.isInteger(value.tick) && value.tick >= 0 && value.tick <= MAX_TICK && Number.isInteger(value.slot) && value.slot >= 1 && value.slot <= 4 && Number.isInteger(value.keys) && value.keys >= 0 && value.keys <= INPUT_MASK;
    case 'dist-stop': return value.reason === undefined || (typeof value.reason === 'string' && value.reason.length <= MAX_APPROVAL_REASON);
    case 'ping':
    case 'pong': return typeof value.sentAt === 'number' && Number.isFinite(value.sentAt) && value.sentAt >= 0;
    default: return false;
  }
}

export function newRoomCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}
