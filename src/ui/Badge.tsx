import React from 'react';
import { cx } from './utils';

type Props = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: 'default' | 'blue' | 'red' | 'yellow' | 'green';
};

export default function Badge({ tone = 'default', className, children, ...props }: Props) {
  return <span className={cx('ui-badge', `ui-badge-${tone}`, className)} {...props}>{children}</span>;
}
