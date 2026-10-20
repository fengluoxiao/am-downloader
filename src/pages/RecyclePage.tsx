import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw as ReloadOutlined, RotateCcw as RollbackOutlined, Trash2 as DeleteOutlined } from 'lucide-react';
import dayjs from 'dayjs';
import type { RecycleItem } from '../types';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import DataTable from '../ui/DataTable';
import Surface from '../ui/Surface';
import Toolbar from '../ui/Toolbar';

function humanSize(n: number | null) {
  if (n == null) return '-';
  if (n > 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`;
  if (n > 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n > 1 << 10) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export default function RecyclePage() {
  const [items, setItems] = useState<RecycleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setItems(await window.api.recycleList()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => window.api.onLibraryChanged(() => { void refresh(); }), [refresh]);

  const restore = async (item: RecycleItem) => {
    const res = await window.api.recycleRestore(item.id);
    if (res.ok) {
      setNotice('已恢复');
      refresh();
    } else setNotice(res.error || '恢复失败');
  };

  const purge = async (item: RecycleItem) => {
    if (!window.confirm(`彻底删除「${item.name}」？\n这个操作不能恢复。`)) return;
    const res = await window.api.recyclePurge(item.id);
    if (res.ok) {
      setNotice('已彻底删除');
      refresh();
    } else setNotice(res.error || '删除失败');
  };

  const empty = async () => {
    if (!window.confirm('清空回收站？\n回收站内所有项目都会被彻底删除，不能恢复。')) return;
    const res = await window.api.recycleEmpty();
    if (res.ok) {
      setNotice('回收站已清空');
      refresh();
    } else setNotice(res.error || '清空失败');
  };

  return (
    <div className="recycle-page">
      <Toolbar>
        <div className="recycle-heading">
          <div className="recycle-title-row">
            <h2>回收站</h2>
            <Badge tone={items.length ? 'red' : 'default'}>{items.length}</Badge>
          </div>
          <p>删除的文件会先放在这里，可以恢复到原位置。</p>
        </div>
        <div className="recycle-actions">
          <Button icon={<ReloadOutlined />} onClick={refresh} disabled={loading}>{loading ? '刷新中' : '刷新'}</Button>
          <Button variant="danger" icon={<DeleteOutlined />} disabled={!items.length} onClick={empty}>清空回收站</Button>
        </div>
      </Toolbar>

      {notice && <Surface className="recycle-notice">{notice}</Surface>}

      <DataTable<RecycleItem>
        className="recycle-table"
        rows={items}
        rowKey={(item) => item.id}
        empty="回收站是空的"
        columns={[
          {
            key: 'name',
            title: '名称',
            render: (item) => (
              <div className="recycle-file-cell">
                <span className="recycle-file-name">{item.name}</span>
                <span className="recycle-file-path">{item.originalPath}</span>
              </div>
            ),
          },
          { key: 'type', title: '类型', width: 92, render: (item) => <Badge>{item.type === 'folder' ? '文件夹' : '文件'}</Badge> },
          { key: 'size', title: '大小', width: 110, render: (item) => humanSize(item.size) },
          { key: 'time', title: '删除时间', width: 168, render: (item) => dayjs(item.deletedAt).format('YYYY-MM-DD HH:mm') },
          {
            key: 'actions',
            title: '操作',
            width: 218,
            render: (item) => (
              <div className="recycle-row-actions">
                <Button size="sm" icon={<RollbackOutlined />} onClick={() => restore(item)}>恢复</Button>
                <Button size="sm" variant="danger" icon={<DeleteOutlined />} onClick={() => purge(item)}>彻底删除</Button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
