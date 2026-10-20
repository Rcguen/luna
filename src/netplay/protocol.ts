export type InputMessage = { type: 'input'; keys: number };
export type HelloMessage = { type: 'hello'; protocol: 1 };
export type ApprovalMessage = { type: 'approval'; accepted: boolean; reason?: string };
export type FrameMessage = { type: 'frame'; width: number; height: number; data: ArrayBuffer };
export type AudioMessage = { type: 'audio'; rate: number; data: ArrayBuffer };
export type PingMessage = { type: 'ping'; sentAt: number };
export type PongMessage = { type: 'pong'; sentAt: number };
export type WireMessage = InputMessage | HelloMessage | ApprovalMessage | FrameMessage | AudioMessage | PingMessage | PongMessage;

export function isWireMessage(value: unknown): value is WireMessage {
  return !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
}

export function newRoomCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}
