import React from 'react';
import { cx } from './utils';

type Props = React.HTMLAttributes<HTMLDivElement>;

export default function Toolbar({ className, children, ...props }: Props) {
  return (
    <div className={cx('ui-toolbar', className)} {...props}>
      {children}
    </div>
  );
}
