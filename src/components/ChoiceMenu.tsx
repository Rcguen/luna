import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export type ChoiceOption<T extends string> = { value: T; label: string };

export function ChoiceMenu<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  const show = (index = selectedIndex) => {
    setOpen(true);
    requestAnimationFrame(() => optionRefs.current[Math.max(0, index)]?.focus());
  };
  const choose = (next: T) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (!open) { show(); return; }
      const activeIndex = optionRefs.current.findIndex((option) => option === document.activeElement);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      optionRefs.current[nextIndex]?.focus();
    }
  };

  return <div className="choice-field" ref={rootRef} onKeyDown={onKeyDown} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <span className="choice-label" id={`${id}-label`}>{label}</span>
    <button className={`choice-trigger${open ? ' is-open' : ''}`} type="button" ref={triggerRef}
      aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`}
      onClick={() => open ? setOpen(false) : show()}>
      <span id={`${id}-value`}>{selected?.label}</span><span className="choice-chevron" aria-hidden="true" />
    </button>
    {open && <div className="choice-list" id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`}>
      {options.map((option, index) => <button key={option.value} type="button" role="option"
        aria-selected={option.value === value} ref={(element) => { optionRefs.current[index] = element; }}
        className="choice-option" onClick={() => choose(option.value)}>{option.label}{option.value === value && <span aria-hidden="true">✓</span>}</button>)}
    </div>}
  </div>;
}
