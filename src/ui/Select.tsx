import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cx } from './utils';

export interface SelectOption<T extends string> {
  label: React.ReactNode;
  value: T;
}

interface Props<T extends string> {
  value: T;
  options: Array<SelectOption<T>>;
  onChange: (value: T) => void;
  className?: string;
}

export default function Select<T extends string>({ value, options, onChange, className }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState({ left: 0, top: 0, width: 0, accent: '' });
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => options.find((option) => option.value === value), [options, value]);

  const placeMenu = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const styles = window.getComputedStyle(ref.current!);
    const accent =
      styles.getPropertyValue('--select-accent').trim() ||
      styles.getPropertyValue('--st').trim() ||
      styles.getPropertyValue('--am-accent').trim();
    setMenuRect({ left: rect.left, top: rect.bottom + 6, width: rect.width, accent });
  };

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    placeMenu();
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', placeMenu);
    window.addEventListener('scroll', placeMenu, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', placeMenu, true);
    };
  }, [open]);

  return (
    <div className={cx('ui-select', open && 'open', className)} ref={ref}>
      <button type="button" className="ui-select-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((next) => !next)}>
        <span>{selected?.label ?? value}</span>
        <ChevronDown />
      </button>
      {open && createPortal(
        <div
          className="ui-select-menu"
          role="listbox"
          ref={menuRef}
          style={{
            left: menuRect.left,
            top: menuRect.top,
            minWidth: menuRect.width,
            '--select-accent': menuRect.accent,
          } as React.CSSProperties}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={cx('ui-select-option', option.value === value && 'selected')}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
