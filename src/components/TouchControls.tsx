import { useEffect, useRef } from 'react';

type Props = { onKeys: (keys: number) => void };
const bit = { a: 0x001, b: 0x002, select: 0x004, start: 0x008, right: 0x010, left: 0x020, up: 0x040, down: 0x080, r: 0x100, l: 0x200 } as const;

export function TouchControls({ onKeys }: Props) {
  const held = useRef(new Map<number, number>());
  const onKeysRef = useRef(onKeys);
  onKeysRef.current = onKeys;
  useEffect(() => {
    const releaseAll = () => { if (held.current.size) { held.current.clear(); onKeysRef.current(0); } };
    const releaseWhenHidden = () => { if (document.hidden) releaseAll(); };
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', releaseWhenHidden);
    return () => { window.removeEventListener('blur', releaseAll); document.removeEventListener('visibilitychange', releaseWhenHidden); releaseAll(); };
  }, []);
  const update = (pointerId: number, value: number, active: boolean) => {
    if (active) held.current.set(pointerId, value);
    else if (!held.current.delete(pointerId)) return;
    onKeysRef.current([...held.current.values()].reduce((keys, key) => keys | key, 0));
  };
  const button = (label: string, value: number, name = label) => (
    <button type="button" aria-label={name} className="touch-button" onContextMenu={(e) => e.preventDefault()} onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); update(e.pointerId, value, true); }} onPointerUp={(e) => { e.preventDefault(); update(e.pointerId, value, false); }} onPointerCancel={(e) => update(e.pointerId, value, false)} onLostPointerCapture={(e) => update(e.pointerId, value, false)}>{label}</button>
  );
  return <div className="touch-controls" aria-label="GBA touch controls">
    <div className="dpad">{button('▲', bit.up, 'Up')}{button('◀', bit.left, 'Left')}<span className="dpad-center" aria-hidden="true">✦</span>{button('▶', bit.right, 'Right')}{button('▼', bit.down, 'Down')}</div>
    <div className="shoulders">{button('L', bit.l)}{button('R', bit.r)}</div>
    <div className="face">{button('B', bit.b)}{button('A', bit.a)}</div>
    <div className="system">{button('SELECT', bit.select)}{button('START', bit.start)}</div>
  </div>;
}
