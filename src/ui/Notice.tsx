import React from 'react';
import { cx } from './utils';

type Tone = 'info' | 'warning' | 'success' | 'error';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
}

export default function Notice({ tone = 'info', className, children, ...props }: Props) {
  return <div className={cx('ui-notice', `ui-notice-${tone}`, className)} {...props}>{children}</div>;
}
