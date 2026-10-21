import type { BatteryTechnology, GbaEngine } from './wasmAdapter';
import { batterySize } from '../lib/localBatterySaves';

export type SaveKind = 'battery' | 'state';

export class SaveAdapter {
  constructor(private readonly engine: GbaEngine) {}

  supports(kind: SaveKind): boolean { return kind === 'battery' ? this.engine.supportsBatterySave() : this.engine.supportsStateSave(); }

  async exportSave(kind: SaveKind, playerSlot: number): Promise<ArrayBuffer> {
    const player = playerSlot - 1;
    if (player < 0 || player > 3) throw new Error('Invalid player slot.');
    if (kind === 'battery') {
      const image = this.engine.exportBattery(player);
      if (!image) throw new Error('The game has not initialized battery saving yet.');
      return image.bytes;
    }
    return this.engine.exportState(player);
  }

  async importSave(kind: SaveKind, playerSlot: number, bytes: ArrayBuffer, technology?: BatteryTechnology): Promise<void> {
    const player = playerSlot - 1;
    if (player < 0 || player > 3) throw new Error('Invalid player slot.');
    if (kind === 'battery') {
      const detected = this.engine.batteryType(player);
      const possible = ([1, 2, 3, 4, 5, 6] as BatteryTechnology[]).filter((type) => batterySize(type) === bytes.byteLength);
      const resolved = technology || (possible.includes(detected as BatteryTechnology) ? detected as BatteryTechnology : possible.length === 1 ? possible[0] : undefined);
      if (!resolved || batterySize(resolved) !== bytes.byteLength) throw new Error('Save technology is ambiguous or incompatible. Choose the correct SRAM, Flash, or EEPROM type.');
      this.engine.importBattery(player, resolved, bytes);
      return;
    }
    this.engine.importState(player, bytes);
  }
}
