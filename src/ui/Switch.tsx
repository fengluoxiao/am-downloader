import React from 'react';
import { cx } from './utils';

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  className?: string;
}

export default function Switch({ checked, onChange, label, className }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx('ui-switch-wrap', className)}
      onClick={() => onChange(!checked)}
    >
      {label && <span className="ui-switch-label">{label}</span>}
      <span className={cx('ui-switch', checked && 'checked')}>
        <span className="ui-switch-thumb" />
      </span>
    </button>
  );
}
