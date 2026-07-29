import React from 'react';
import { X as CloseOutlined } from 'lucide-react';
import Button from './Button';
import { cx } from './utils';

interface Props {
  open: boolean;
  title?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

export default function Sheet({ open, title, onClose, children, className }: Props) {
  if (!open) return null;
  return (
    <div className="ui-sheet-layer" role="dialog" aria-modal="true">
      <button type="button" className="ui-sheet-scrim" aria-label="关闭" onClick={onClose} />
      <aside className={cx('ui-sheet', className)}>
        <header className="ui-sheet-head">
          <strong>{title}</strong>
          <Button size="sm" variant="quiet" icon={<CloseOutlined />} title="关闭" onClick={onClose} />
        </header>
        <div className="ui-sheet-body">{children}</div>
      </aside>
    </div>
  );
}
