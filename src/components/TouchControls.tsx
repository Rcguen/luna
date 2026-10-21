import { useEffect, useRef } from 'react';

type Props = { onKeys: (keys: number) => void };
const bit = { a: 0x001, b: 0x002, select: 0x004, start: 0x008, right: 0x010, left: 0x020, up: 0x040, down: 0x080, r: 0x100, l: 0x200 } as const;

export function TouchControls({ onKeys }: Props) {
  const held = useRef(new Map<number, { value: number; element: HTMLButtonElement }>());
  const onKeysRef = useRef(onKeys);
  onKeysRef.current = onKeys;
  useEffect(() => {
    const releaseAll = () => {
      for (const press of held.current.values()) press.element.classList.remove('is-pressed');
      // A browser can lose the final pointer event while the page is being
      // rotated, backgrounded, or interrupted by browser chrome. Clear any
      // stale class as well as the pointer map so the visual state can never
      // remain pressed after the input state was released.
      document.querySelectorAll<HTMLButtonElement>('.touch-button.is-pressed').forEach((element) => element.classList.remove('is-pressed'));
      if (!held.current.size) return;
      held.current.clear();
      onKeysRef.current(0);
    };
    const releasePointer = (event: PointerEvent) => update(event.pointerId, 0, null);
    const releaseWhenHidden = () => { if (document.hidden) releaseAll(); };
    window.addEventListener('blur', releaseAll);
    window.addEventListener('pagehide', releaseAll);
    window.addEventListener('pointerup', releasePointer, true);
    window.addEventListener('pointercancel', releasePointer, true);
    window.addEventListener('lostpointercapture', releasePointer, true);
    document.addEventListener('visibilitychange', releaseWhenHidden);
    return () => {
      window.removeEventListener('blur', releaseAll);
      window.removeEventListener('pagehide', releaseAll);
      window.removeEventListener('pointerup', releasePointer, true);
      window.removeEventListener('pointercancel', releasePointer, true);
      window.removeEventListener('lostpointercapture', releasePointer, true);
      document.removeEventListener('visibilitychange', releaseWhenHidden);
      releaseAll();
    };
  }, []);
  const update = (pointerId: number, value: number, element: HTMLButtonElement | null) => {
    const previous = held.current.get(pointerId);
    if (previous) {
      held.current.delete(pointerId);
      if (![...held.current.values()].some((press) => press.element === previous.element)) previous.element.classList.remove('is-pressed');
    }
    if (element) {
      held.current.set(pointerId, { value, element });
      element.classList.add('is-pressed');
    } else if (!previous) return;
    let keys = 0;
    for (const press of held.current.values()) keys |= press.value;
    onKeysRef.current(keys);
  };
  const button = (label: string, value: number, name = label) => (
    <button type="button" aria-label={name} className="touch-button" onContextMenu={(e) => e.preventDefault()} onPointerDown={(e) => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* global release handlers are the fallback */ } update(e.pointerId, value, e.currentTarget); }} onPointerUp={(e) => { e.preventDefault(); update(e.pointerId, value, null); }} onPointerCancel={(e) => update(e.pointerId, value, null)} onLostPointerCapture={(e) => update(e.pointerId, value, null)}>{label}</button>
  );
  return <div className="touch-controls" aria-label="GBA touch controls">
    <div className="dpad">{button('▲', bit.up, 'Up')}{button('◀', bit.left, 'Left')}<span className="dpad-center" aria-hidden="true">✦</span>{button('▶', bit.right, 'Right')}{button('▼', bit.down, 'Down')}</div>
    <div className="shoulders">{button('L', bit.l)}{button('R', bit.r)}</div>
    <div className="face">{button('B', bit.b)}{button('A', bit.a)}</div>
    <div className="system">{button('SELECT', bit.select)}{button('START', bit.start)}</div>
  </div>;
}
