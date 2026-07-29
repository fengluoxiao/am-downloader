import React from 'react';
import { cx } from './utils';

type Props = React.HTMLAttributes<HTMLDivElement> & {
  padded?: boolean;
};

export default function Surface({ padded = true, className, children, ...props }: Props) {
  return (
    <div className={cx('ui-surface', padded && 'ui-surface-padded', className)} {...props}>
      {children}
    </div>
  );
}
