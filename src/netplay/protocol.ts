export type InputMessage = { type: 'input'; keys: number };
export type HelloMessage = { type: 'hello'; protocol: 1; clientId: string };
export type ApprovalMessage = { type: 'approval'; accepted: boolean; reason?: string; slot?: number; capacity?: number };
export type FrameMessage = { type: 'frame'; width: number; height: number; data: ArrayBuffer; sequence?: number };
export type AudioMessage = { type: 'audio'; rate: number; data: ArrayBuffer };
export type PingMessage = { type: 'ping'; sentAt: number };
export type PongMessage = { type: 'pong'; sentAt: number };
export type WireMessage = InputMessage | HelloMessage | ApprovalMessage | FrameMessage | AudioMessage | PingMessage | PongMessage;

export const INPUT_MASK = 0x3ff;
export const MAX_FRAME_BYTES = 512 * 1024;
export const MAX_AUDIO_BYTES = 256 * 1024;
export const MAX_APPROVAL_REASON = 200;
export const MAX_CLIENT_ID = 80;

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
    case 'frame': return Number.isInteger(value.width) && value.width >= 1 && value.width <= 1024 && Number.isInteger(value.height) && value.height >= 1 && value.height <= 1024 && (value.sequence === undefined || (Number.isInteger(value.sequence) && value.sequence >= 0)) && isBinary(value.data, MAX_FRAME_BYTES);
    case 'audio': return Number.isFinite(value.rate) && value.rate >= 8000 && value.rate <= 96000 && isBinary(value.data, MAX_AUDIO_BYTES);
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
