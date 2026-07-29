import React, { useEffect, useState } from 'react';
import { Download as CloudDownloadOutlined, Search as SearchOutlined, List as UnorderedListOutlined, FolderOpen as FolderOpenOutlined, Trash2 as DeleteOutlined, Cable as ApiOutlined, Settings as SettingOutlined, Sun as SunOutlined, Moon as MoonOutlined } from 'lucide-react';
import DownloadPage from './pages/DownloadPage';
import SearchPage from './pages/SearchPage';
import TasksPage from './pages/TasksPage';
import FilesPage from './pages/FilesPage';
import RecyclePage from './pages/RecyclePage';
import ServicePage from './pages/ServicePage';
import SettingsPage from './pages/SettingsPage';
import { useTasks } from './store';
import { useTheme } from './theme';
import Button from './ui/Button';
import Badge from './ui/Badge';
import { cx } from './ui/utils';

export default function App() {
  const [page, setPage] = useState('search');
  const { tasks } = useTasks();
  const { mode, toggle } = useTheme();
  const runningCount = tasks.filter((t) => t.status === 'running').length;

  const pageDescriptions: Record<string, string> = {
    download: '粘贴链接即可下载，支持专辑 / 单曲 / 歌单',
    search: '搜索 Apple Music，仅显示支持杜比全景声的内容',
    tasks: '管理下载队列和已下载文件',
    files: '浏览和管理已下载的音频文件',
    recycle: '恢复误删文件或彻底清理回收站',
    service: '管理解密服务与 Apple ID 登录',
    settings: '下载器配置',
  };

  const items = [
    { key: 'search', icon: <SearchOutlined />, label: '搜索' },
    { key: 'download', icon: <CloudDownloadOutlined />, label: '下载' },
    {
      key: 'tasks',
      icon: <UnorderedListOutlined />,
      label: '下载管理',
      count: runningCount,
    },
    { key: 'files', icon: <FolderOpenOutlined />, label: '文件管理' },
    { key: 'recycle', icon: <DeleteOutlined />, label: '回收站' },
    { key: 'service', icon: <ApiOutlined />, label: '解密服务' },
    { key: 'settings', icon: <SettingOutlined />, label: '设置' },
  ];

  return (
    <div className="am-app-shell">
      <aside className="am-sidebar">
        <div className="am-brand">
          <div className="am-brand-mark">AM</div>
          <div className="am-brand-copy">
            <div className="am-brand-title">Apple Music</div>
            <div className="am-brand-subtitle">杜比全景声下载器</div>
          </div>
        </div>
        <nav className="am-sidebar-menu" aria-label="主导航">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cx('am-nav-item', page === item.key && 'selected')}
              onClick={() => setPage(item.key)}
            >
              <span className="am-nav-icon">{item.icon}</span>
              <span className="am-nav-label">{item.label}</span>
              {'count' in item && (item.count || 0) > 0 && <Badge tone="red">{item.count}</Badge>}
            </button>
          ))}
        </nav>
      </aside>
      <main className="am-main-shell">
        <header className="am-topbar">
          <span className="am-page-caption">
            {pageDescriptions[page]}
          </span>
          <Button
            className="am-theme-button"
            variant="quiet"
            size="sm"
            title={mode === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
            icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggle}
          />
        </header>
        <section className="am-content">
          {/* 页面常驻不卸载，切换后保留各自状态（如搜索结果、滚动位置） */}
          <div className="am-page" style={{ display: page === 'search' ? 'block' : 'none' }}><SearchPage onGoTasks={() => setPage('tasks')} /></div>
          <div className="am-page" style={{ display: page === 'download' ? 'block' : 'none' }}><DownloadPage /></div>
          <div className="am-page" style={{ display: page === 'tasks' ? 'block' : 'none' }}><TasksPage /></div>
          <div className="am-page" style={{ display: page === 'files' ? 'block' : 'none' }}><FilesPage /></div>
          <div className="am-page" style={{ display: page === 'recycle' ? 'block' : 'none' }}><RecyclePage /></div>
          <div className="am-page" style={{ display: page === 'service' ? 'block' : 'none' }}><ServicePage /></div>
          <div className="am-page" style={{ display: page === 'settings' ? 'block' : 'none' }}><SettingsPage /></div>
        </section>
      </main>
    </div>
  );
}
