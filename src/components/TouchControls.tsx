import { memo, useRef } from 'react';

type Props = { onKeys: (keys: number) => void };
const bit = { a: 0x001, b: 0x002, select: 0x004, start: 0x008, right: 0x010, left: 0x020, up: 0x040, down: 0x080, r: 0x100, l: 0x200 } as const;

export const TouchControls = memo(function TouchControls({ onKeys }: Props) {
  const held = useRef(new Set<number>());
  const update = (value: number, active: boolean) => {
    active ? held.current.add(value) : held.current.delete(value);
    onKeys([...held.current].reduce((sum, key) => sum | key, 0));
  };
  const button = (label: string, value: number, className = '') => (
    <button type="button" aria-label={label === '●' ? 'D-pad center' : label} className={`touch-button ${className}`} onContextMenu={(e) => e.preventDefault()} onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); update(value, true); }} onPointerUp={(e) => { e.preventDefault(); update(value, false); }} onPointerCancel={() => update(value, false)} onLostPointerCapture={() => update(value, false)}>{label}</button>
  );
  return <div className="touch-controls" aria-label="GBA touch controls">
    <div className="dpad">{button('▲', bit.up)}{button('◀', bit.left)}{button('●', 0, 'dpad-center')}{button('▶', bit.right)}{button('▼', bit.down)}</div>
    <div className="shoulders">{button('L', bit.l)}{button('R', bit.r)}</div>
    <div className="face">{button('B', bit.b)}{button('A', bit.a)}</div>
    <div className="system">{button('SELECT', bit.select)}{button('START', bit.start)}</div>
  </div>;
});
