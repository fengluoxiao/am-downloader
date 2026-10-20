import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUp as ArrowUpOutlined, AudioLines as AudioOutlined, File as FileOutlined, Folder as FolderOutlined, FolderOpen as FolderOpenOutlined, Grid2X2 as AppstoreOutlined, List as UnorderedListOutlined, PlayCircle as PlayCircleOutlined, RefreshCw as ReloadOutlined } from 'lucide-react';
import dayjs from 'dayjs';
import type { DirectoryListing, FileEntry, FileRoot } from '../types';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import DataTable, { UiColumn } from '../ui/DataTable';
import Dialog from '../ui/Dialog';
import Notice from '../ui/Notice';
import Select from '../ui/Select';
import Surface from '../ui/Surface';
import TextInput from '../ui/TextInput';
import { joinPath, relativeParts } from '../file-path';

function humanSize(n: number | null) {
  if (n == null) return '-';
  if (n > 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`;
  if (n > 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n > 1 << 10) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function pathParts(root: FileRoot | null, current: string) {
  return root ? relativeParts(root.path, current) : [];
}

export default function FilesPage() {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [kw, setKw] = useState('');
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [menu, setMenu] = useState<{ entry: FileEntry; x: number; y: number } | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => window.localStorage.getItem('am-files-view-mode') === 'list' ? 'list' : 'grid');
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'success' | 'error'; text: string } | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<FileEntry[] | null>(null);

  const showNotice = (tone: 'info' | 'warning' | 'success' | 'error', text: string) => setNotice({ tone, text });

  const load = useCallback(async (dir?: string) => {
    setLoading(true);
    try {
      const next = await window.api.readDir(dir);
      setListing(next);
      setSelectedPaths([]);
      setMenu(null);
      if (!next.ok) showNotice('error', next.error || '读取文件夹失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('click', close); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [menu]);

  const entries = useMemo(() => {
    const q = kw.trim().toLowerCase();
    const raw = listing?.entries || [];
    return q ? raw.filter((e) => e.name.toLowerCase().includes(q) || e.ext.toLowerCase().includes(q)) : raw;
  }, [kw, listing]);
  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedEntries = useMemo(() => entries.filter((entry) => selectedSet.has(entry.path)), [entries, selectedSet]);
  const folderCount = useMemo(() => entries.filter((entry) => entry.type === 'folder').length, [entries]);
  const fileCount = entries.length - folderCount;

  useEffect(() => {
    let alive = true;
    const candidates = (listing?.entries || []).filter((e) => e.thumbnailable && thumbs[e.path] === undefined);
    candidates.forEach(async (entry) => {
      const res = await window.api.thumbnail(entry.path);
      if (alive) setThumbs((prev) => ({ ...prev, [entry.path]: res.ok ? res.dataUrl || null : null }));
    });
    return () => { alive = false; };
  }, [listing, thumbs]);

  const rootOptions = useMemo(() => (listing?.roots || []).map((r) => ({ label: r.name, value: r.path })), [listing]);
  const crumbs = useMemo(() => {
    const root = listing?.root || null;
    const current = listing?.path || '';
    const parts = pathParts(root, current);
    return { root, parts };
  }, [listing]);

  const openEntry = (entry: FileEntry) => entry.type === 'folder' ? load(entry.path) : window.api.openFile(entry.path);
  const toggleEntrySelection = (entry: FileEntry) => {
    setSelectedPaths((prev) => prev.includes(entry.path) ? prev.filter((p) => p !== entry.path) : [...prev, entry.path]);
  };
  const clickEntry = (event: React.MouseEvent, entry: FileEntry) => {
    if (event.ctrlKey || event.metaKey) {
      toggleEntrySelection(entry);
      return;
    }
    setSelectedPaths(entry.type === 'folder' ? [] : [entry.path]);
    if (entry.type === 'folder') openEntry(entry);
  };
  const stopRowClick = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const showMenu = (event: React.MouseEvent, entry: FileEntry) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedSet.has(entry.path)) setSelectedPaths([entry.path]);
    setMenu({ entry, x: Math.min(event.clientX, window.innerWidth - 168), y: Math.min(event.clientY, window.innerHeight - 236) });
  };
  const menuEntries = () => !menu ? [] : selectedSet.has(menu.entry.path) && selectedEntries.length > 0 ? selectedEntries : [menu.entry];

  const copyEntries = async (targets: FileEntry[]) => {
    setMenu(null);
    const picked = await window.api.pickFolder(listing?.path);
    if (!picked.ok || !picked.path) return;
    let ok = 0;
    for (const entry of targets) {
      const res = await window.api.copyPath(entry.path, picked.path);
      if (res.ok) ok += 1; else showNotice('error', `${entry.name}: ${res.error || '复制失败'}`);
    }
    if (ok > 0) showNotice('success', targets.length > 1 ? `已复制 ${ok} 项` : '已复制');
  };

  const moveEntries = async (targets: FileEntry[]) => {
    setMenu(null);
    const picked = await window.api.pickFolder(listing?.path);
    if (!picked.ok || !picked.path) return;
    let ok = 0;
    for (const entry of targets) {
      const res = await window.api.movePath(entry.path, picked.path);
      if (res.ok) ok += 1; else showNotice('error', `${entry.name}: ${res.error || '移动失败'}`);
    }
    if (ok > 0) { showNotice('success', targets.length > 1 ? `已移动 ${ok} 项` : '已移动'); setSelectedPaths([]); load(listing?.path); }
  };

  const confirmDelete = async () => {
    if (!deleteTargets) return;
    let ok = 0;
    for (const entry of deleteTargets) {
      const res = await window.api.deletePath(entry.path);
      if (res.ok) ok += 1; else showNotice('error', `${entry.name}: ${res.error || '删除失败'}`);
    }
    setDeleteTargets(null);
    if (ok > 0) { showNotice('success', deleteTargets.length > 1 ? `已移到应用回收站 ${ok} 项` : '已移到应用回收站'); setSelectedPaths([]); load(listing?.path); }
  };

  const changeViewMode = (value: 'grid' | 'list') => { setViewMode(value); window.localStorage.setItem('am-files-view-mode', value); };
  const iconFor = (entry: FileEntry, large = false) => {
    const thumb = thumbs[entry.path];
    if (thumb) return <img className={large ? 'am-file-thumb am-file-thumb-large' : 'am-file-thumb'} src={thumb} alt="" draggable={false} />;
    const style = { fontSize: large ? 34 : 14 };
    if (entry.type === 'folder') return <FolderOutlined style={{ ...style, color: '#d89b1d' }} />;
    if (entry.playable) return <AudioOutlined style={{ ...style, color: '#3388bb' }} />;
    return <FileOutlined style={style} />;
  };

  const columns: Array<UiColumn<FileEntry>> = [
    { key: 'name', title: '名称', render: (entry) => <span className="files-name-cell">{iconFor(entry)}<span>{entry.name}</span></span> },
    { key: 'type', title: '类型', width: 118, render: (entry) => <Badge>{entry.type === 'folder' ? '文件夹' : entry.ext ? entry.ext.slice(1).toUpperCase() : '文件'}</Badge> },
    { key: 'size', title: '大小', width: 110, render: (entry) => humanSize(entry.size) },
    { key: 'mtime', title: '修改时间', width: 168, render: (entry) => dayjs(entry.mtime).format('YYYY-MM-DD HH:mm') },
    {
      key: 'actions', title: '操作', width: 204, render: (entry) => (
        <span className="tasks-actions" onMouseDown={stopRowClick} onClick={stopRowClick}>
          <Button size="sm" icon={entry.type === 'folder' ? <FolderOpenOutlined /> : entry.playable ? <PlayCircleOutlined /> : <FileOutlined />} onClick={() => openEntry(entry)}>{entry.type === 'folder' ? '打开' : entry.playable ? '播放' : '打开'}</Button>
          <Button size="sm" icon={<FolderOpenOutlined />} onClick={() => window.api.revealFile(entry.path)}>位置</Button>
        </span>
      ),
    },
  ];

  return (
    <div className="files-page">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <Surface className="files-workspace" padded={false}>
        <div className="files-command-bar">
          <div className="files-toolbar-left">
            <Select value={listing?.root?.path || ''} options={rootOptions} onChange={(value) => load(value)} />
            <Button icon={<ArrowUpOutlined />} disabled={!listing?.parent} title="返回上级" onClick={() => listing?.parent && load(listing.parent)} />
            <Button icon={<ReloadOutlined />} disabled={loading} title="刷新当前文件夹" onClick={() => load(listing?.path)} />
            <TextInput placeholder="搜索当前文件夹" value={kw} onChange={(e) => setKw(e.target.value)} />
          </div>
          <div className="files-toolbar-right">
            <Select value={viewMode} onChange={changeViewMode} options={[{ value: 'grid', label: '图标视图' }, { value: 'list', label: '列表视图' }]} />
            <Button icon={<FolderOpenOutlined />} disabled={!listing?.path} onClick={() => listing?.path && window.api.openFile(listing.path)}>系统打开</Button>
          </div>
        </div>

        <div className="files-path-row">
          <div className="files-crumbs">
            {crumbs.root ? <button type="button" onClick={() => load(crumbs.root!.path)}>{crumbs.root.name}</button> : <span>还没有配置保存目录</span>}
            {crumbs.parts.map((part, index) => {
              const target = joinPath(crumbs.root?.path || '', crumbs.parts.slice(0, index + 1));
              const last = index === crumbs.parts.length - 1;
              return <React.Fragment key={target}><span>/</span>{last ? <strong>{part}</strong> : <button type="button" onClick={() => load(target)}>{part}</button>}</React.Fragment>;
            })}
          </div>
          <div className="files-folder-meta">
            <Badge>{folderCount} 个文件夹</Badge>
            <Badge>{fileCount} 个文件</Badge>
            {selectedEntries.length > 0 && <Badge tone="red">已选 {selectedEntries.length}</Badge>}
          </div>
        </div>

        {selectedEntries.length > 0 && (
          <div className="files-selection-bar">
            <span>已选中 {selectedEntries.length} 项</span>
            <Button size="sm" onClick={() => copyEntries(selectedEntries)}>复制到...</Button>
            <Button size="sm" onClick={() => moveEntries(selectedEntries)}>移动到...</Button>
            <Button size="sm" variant="danger" onClick={() => setDeleteTargets(selectedEntries)}>删除</Button>
          </div>
        )}

        <div className="files-browser-body">
          {viewMode === 'grid' ? (
            <div className="am-file-grid" aria-busy={loading}>
              {!loading && entries.length === 0 ? <div className="ui-empty">{kw ? '当前文件夹没有匹配项' : '这个文件夹是空的'}</div> : entries.map((entry) => (
                <div key={entry.path} className={`am-file-tile${selectedSet.has(entry.path) ? ' selected' : ''}`} role="button" tabIndex={0} title={entry.name} onClick={(e) => clickEntry(e, entry)} onContextMenu={(e) => showMenu(e, entry)} onKeyDown={(e) => { if (e.key === 'Enter') openEntry(entry); }}>
                  <div className="am-file-tile-icon">{iconFor(entry, true)}</div>
                  <span className="am-file-tile-name">{entry.name}</span>
                  <span className="am-file-tile-meta">{entry.type === 'folder' ? '文件夹' : `${entry.ext ? entry.ext.slice(1).toUpperCase() : '文件'} · ${humanSize(entry.size)}`}</span>
                </div>
              ))}
            </div>
          ) : (
            <DataTable
              className="files-table"
              rows={entries}
              columns={columns}
              rowKey={(entry) => entry.path}
              empty={kw ? '当前文件夹没有匹配项' : '这个文件夹是空的'}
              rowProps={(entry) => ({
                className: selectedSet.has(entry.path) ? 'files-row-selected' : undefined,
                onClick: (e) => clickEntry(e, entry),
                onContextMenu: (e) => showMenu(e, entry),
                style: { cursor: 'pointer' },
              })}
            />
          )}
        </div>
      </Surface>

      {menu && (
        <div className="am-file-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          {menuEntries().length === 1 && <><button type="button" onClick={() => { setMenu(null); openEntry(menu.entry); }}>{menu.entry.type === 'folder' ? '打开文件夹' : menu.entry.playable ? '播放' : '打开'}</button><button type="button" onClick={() => { setMenu(null); window.api.revealFile(menu.entry.path); }}>显示位置</button><div className="am-file-menu-separator" /></>}
          {menuEntries().length > 1 && <div className="am-file-menu-title">已选中 {menuEntries().length} 项</div>}
          <button type="button" onClick={() => copyEntries(menuEntries())}>{menuEntries().length > 1 ? '复制选中项到...' : '复制到...'}</button>
          <button type="button" onClick={() => moveEntries(menuEntries())}>{menuEntries().length > 1 ? '移动选中项到...' : '移动到...'}</button>
          <div className="am-file-menu-separator" />
          <button type="button" className="danger" onClick={() => { setDeleteTargets(menuEntries()); setMenu(null); }}>{menuEntries().length > 1 ? '删除选中项' : '删除'}</button>
        </div>
      )}

      <Dialog open={!!deleteTargets} title={deleteTargets && (deleteTargets.length > 1 ? `删除选中的 ${deleteTargets.length} 项？` : `删除「${deleteTargets[0].name}」？`)} onClose={() => setDeleteTargets(null)} footer={<><Button onClick={() => setDeleteTargets(null)}>取消</Button><Button variant="danger" onClick={confirmDelete}>删除</Button></>}>
        会移动到应用内回收站，可以在侧边栏「回收站」恢复。
      </Dialog>
    </div>
  );
}
