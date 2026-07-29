import React from 'react';
import { cx } from './utils';

interface Props {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  className?: string;
}

export default function Slider({ min, max, value, onChange, className }: Props) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      className={cx('ui-slider', className)}
      style={{ '--ui-slider-fill': `${pct}%` } as React.CSSProperties}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
    />
  );
}
