import React from 'react';
import { cx } from './utils';

type ButtonVariant = 'default' | 'primary' | 'danger' | 'quiet';
type ButtonSize = 'sm' | 'md';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export default function Button({ icon, children, variant = 'default', size = 'md', className, ...props }: Props) {
  return (
    <button className={cx('ui-button', `ui-button-${variant}`, `ui-button-${size}`, className)} {...props}>
      {icon && <span className="ui-button-icon">{icon}</span>}
      {children && <span className="ui-button-label">{children}</span>}
    </button>
  );
}
