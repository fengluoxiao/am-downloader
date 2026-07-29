import React from 'react';
import { X as CloseOutlined } from 'lucide-react';
import Button from './Button';
import { cx } from './utils';

interface Props {
  open: boolean;
  title?: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

export default function Dialog({ open, title, footer, onClose, children, className }: Props) {
  if (!open) return null;
  return (
    <div className="ui-dialog-layer" role="dialog" aria-modal="true">
      <button type="button" className="ui-dialog-scrim" aria-label="关闭" onClick={onClose} />
      <section className={cx('ui-dialog', className)}>
        <header className="ui-dialog-head">
          <div className="ui-dialog-title">{title}</div>
          <Button size="sm" variant="quiet" icon={<CloseOutlined />} title="关闭" onClick={onClose} />
        </header>
        <div className="ui-dialog-body">{children}</div>
        {footer && <footer className="ui-dialog-foot">{footer}</footer>}
      </section>
    </div>
  );
}
