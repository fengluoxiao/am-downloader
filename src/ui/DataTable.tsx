import React from 'react';
import { cx } from './utils';

export interface UiColumn<T> {
  key: string;
  title: React.ReactNode;
  width?: number | string;
  className?: string;
  render: (row: T) => React.ReactNode;
}

interface Props<T> {
  rows: T[];
  columns: Array<UiColumn<T>>;
  rowKey: (row: T) => string;
  rowProps?: (row: T) => React.HTMLAttributes<HTMLTableRowElement>;
  empty?: React.ReactNode;
  className?: string;
}

export default function DataTable<T>({ rows, columns, rowKey, rowProps, empty, className }: Props<T>) {
  return (
    <div className={cx('ui-table-wrap', className)}>
      <table className="ui-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={{ width: col.width }} className={col.className}>{col.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} {...rowProps?.(row)}>
              {columns.map((col) => (
                <td key={col.key} className={col.className}>{col.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="ui-empty">{empty || '暂无内容'}</div>}
    </div>
  );
}
