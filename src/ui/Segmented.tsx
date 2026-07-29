import React from 'react';
import { cx } from './utils';

export interface SegmentOption<T extends string> {
  label: React.ReactNode;
  value: T;
}

interface Props<T extends string> {
  options: Array<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export default function Segmented<T extends string>({ options, value, onChange, className }: Props<T>) {
  return (
    <div className={cx('ui-segmented', className)} role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={cx('ui-segmented-item', option.value === value && 'selected')}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
