import React from 'react';
import { cx } from './utils';

interface Props {
  value: number;
  active?: boolean;
  className?: string;
}

export default function Progress({ value, active, className }: Props) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cx('ui-progress', active && 'active', className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="ui-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
