import React from 'react';
import { cx } from './utils';

type Props = React.InputHTMLAttributes<HTMLInputElement>;

export default function TextInput({ className, ...props }: Props) {
  return <input className={cx('ui-input', className)} {...props} />;
}
