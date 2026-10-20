export type EngineFrame = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

export type EngineAudio = {
  rate: number;
  samples: Int16Array;
};

type WasmModule = {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _mgs_init(players: number): void;
  _mgs_load_rom(ptr: number, length: number): number;
  _mgs_run_frame(): void;
  _mgs_get_video(player: number): number;
  _mgs_get_video_width(player: number): number;
  _mgs_get_video_height(player: number): number;
  _mgs_set_keys(player: number, keys: number): void;
  _mgs_get_audio(): number;
  _mgs_audio_frames(): number;
  _mgs_get_audio_rate?(): number;
  _mgs_save_state(player: number): number;
  _mgs_state_ptr(): number;
  _mgs_load_state_bytes(player: number, ptr: number, size: number): number;
  _mgs_reset_sio?(): void;
  _mgs_quit(): void;
};

type WasmFactory = (options: {
  locateFile: (file: string) => string;
  onAbort: (reason: unknown) => void;
}) => Promise<WasmModule>;

declare global {
  interface Window {
    MgbaSplitScreenWasm?: WasmFactory;
  }
}

const ENGINE_SCRIPT = `${import.meta.env.BASE_URL}engine/mgba-splitscreen-web.js`;
const ENGINE_BINARY = `${import.meta.env.BASE_URL}engine/mgba-splitscreen-web.wasm`;

let factoryPromise: Promise<WasmFactory> | null = null;

function loadFactory(): Promise<WasmFactory> {
  if (window.MgbaSplitScreenWasm) return Promise.resolve(window.MgbaSplitScreenWasm);
  if (factoryPromise) return factoryPromise;
  factoryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ENGINE_SCRIPT;
    script.onload = () => window.MgbaSplitScreenWasm ? resolve(window.MgbaSplitScreenWasm) : reject(new Error('WASM factory missing'));
    script.onerror = () => reject(new Error('Unable to load the GBA engine'));
    document.head.appendChild(script);
  });
  return factoryPromise;
}

export class GbaEngine {
  private module: WasmModule | null = null;
  private players = 0;
  private stopped = false;

  async start(players = 2): Promise<void> {
    if (this.module) this.stop();
    const factory = await loadFactory();
    this.module = await factory({
      locateFile: () => ENGINE_BINARY,
      onAbort: (reason) => { throw new Error(`GBA engine aborted: ${String(reason)}`); },
    });
    this.players = Math.max(1, Math.min(4, players));
    this.module._mgs_init(this.players);
    this.stopped = false;
  }

  loadRom(bytes: Uint8Array): void {
    const module = this.requireModule();
    const ptr = module._malloc(bytes.byteLength);
    if (!ptr) throw new Error('GBA engine could not allocate ROM memory');
    try {
      module.HEAPU8.set(bytes, ptr);
      const result = module._mgs_load_rom(ptr, bytes.byteLength);
      if (result !== 0) throw new Error(`GBA ROM rejected (engine code ${result})`);
    } finally {
      module._free(ptr);
    }
  }

  runFrame(): void { this.requireModule()._mgs_run_frame(); }

  frame(player: number): EngineFrame | null {
    const module = this.requireModule();
    const width = module._mgs_get_video_width(player);
    const height = module._mgs_get_video_height(player);
    const ptr = module._mgs_get_video(player);
    if (!ptr || !width || !height) return null;
    const bytes = module.HEAPU8.slice(ptr, ptr + width * height * 4);
    return { width, height, rgba: new Uint8ClampedArray(bytes.buffer) };
  }

  setKeys(player: number, keys: number): void { this.requireModule()._mgs_set_keys(player, keys >>> 0); }

  supportsStateSave(): boolean { return Boolean(this.module?._mgs_save_state && this.module?._mgs_load_state_bytes); }

  exportState(player: number): ArrayBuffer {
    const module = this.requireModule(); const size = module._mgs_save_state(player); const ptr = module._mgs_state_ptr();
    if (!size || !ptr) throw new Error('The emulator could not create a save state.');
    return module.HEAPU8.slice(ptr, ptr + size).buffer;
  }

  importState(player: number, bytes: ArrayBuffer): void {
    const module = this.requireModule(); const ptr = module._malloc(bytes.byteLength);
    if (!ptr) throw new Error('The emulator could not allocate save-state memory.');
    try { module.HEAPU8.set(new Uint8Array(bytes), ptr); if (module._mgs_load_state_bytes(player, ptr, bytes.byteLength) !== 0) throw new Error('The emulator rejected the save state.'); }
    finally { module._free(ptr); }
    module._mgs_reset_sio?.();
  }

  drainAudio(): EngineAudio | null {
    const module = this.requireModule();
    const ptr = module._mgs_get_audio();
    const frames = module._mgs_audio_frames();
    if (!ptr || frames <= 0) return null;
    const bytes = module.HEAPU8.slice(ptr, ptr + frames * 4);
    return { rate: module._mgs_get_audio_rate?.() ?? 32768, samples: new Int16Array(bytes.buffer) };
  }

  stop(): void {
    if (this.module && !this.stopped) this.module._mgs_quit();
    this.stopped = true;
    this.module = null;
    this.players = 0;
  }

  private requireModule(): WasmModule {
    if (!this.module) throw new Error('GBA engine is not started');
    return this.module;
  }
}
