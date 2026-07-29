import React from 'react';
import { cx } from './utils';

type Props = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export default function TextArea({ className, ...props }: Props) {
  return <textarea className={cx('ui-textarea', className)} {...props} />;
}
