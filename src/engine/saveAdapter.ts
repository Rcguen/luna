import type { GbaEngine } from './wasmAdapter';

export type SaveKind = 'battery' | 'state';

/** Explicit capability boundary: the current generated web bridge exports
 * emulator state APIs, but does not export mCore battery-save import/export. */
export class SaveAdapter {
  constructor(private readonly engine: GbaEngine) {}

  supports(kind: SaveKind): boolean { return kind === 'state' && this.engine.supportsStateSave(); }

  async exportSave(kind: SaveKind, playerSlot: number): Promise<ArrayBuffer> {
    if (kind === 'battery') throw new Error('Battery save export is unavailable in the current web engine bridge.');
    return this.engine.exportState(playerSlot);
  }

  async importSave(kind: SaveKind, playerSlot: number, bytes: ArrayBuffer): Promise<void> {
    if (kind === 'battery') throw new Error('Battery save import is unavailable in the current web engine bridge.');
    this.engine.importState(playerSlot, bytes);
  }
}
