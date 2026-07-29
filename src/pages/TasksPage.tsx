import React, { useMemo, useState } from 'react';
import { CheckCircle, Clock3, Download, Eraser as ClearOutlined, FileText as FileTextOutlined, FolderOpen as FolderOpenOutlined, Pause as PauseOutlined, Play as CaretRightOutlined, Square as StopOutlined, X as CloseOutlined } from 'lucide-react';
import dayjs from 'dayjs';
import { MODE_LABELS, Task, TaskStatus, useTasks } from '../store';
import LogView from '../components/LogView';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import DataTable, { UiColumn } from '../ui/DataTable';
import Progress from '../ui/Progress';
import Select from '../ui/Select';
import Sheet from '../ui/Sheet';
import Surface from '../ui/Surface';
import TextInput from '../ui/TextInput';
import Toolbar from '../ui/Toolbar';

const STATUS_TEXT: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '下载中',
  paused: '已暂停',
  success: '完成',
  failed: '失败',
  stopped: '已停止',
};

const ACTIVE_STATUS: TaskStatus[] = ['queued', 'running', 'paused'];

function isActive(t: Task) {
  return ACTIVE_STATUS.includes(t.status);
}

function statusTone(status: TaskStatus) {
  if (status === 'running') return 'blue';
  if (status === 'paused') return 'yellow';
  if (status === 'success') return 'green';
  if (status === 'failed' || status === 'stopped') return 'red';
  return 'default';
}

function duration(t: Task) {
  const start = t.startedAt ?? t.createdAt;
  const end = t.endedAt ?? Date.now();
  const sec = Math.max(0, Math.floor((end - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  if (min < 60) return `${min}m ${rest}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export default function TasksPage() {
  const { tasks, stopTask, pauseTask, resumeTask, stopAll, clearFinished } = useTasks();
  const [viewing, setViewing] = useState<Task | null>(null);
  const [kw, setKw] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | TaskStatus>('all');
  const [mode, setMode] = useState<'all' | Task['mode']>('all');

  const counts = useMemo(() => ({
    total: tasks.length,
    active: tasks.filter(isActive).length,
    running: tasks.filter((t) => t.status === 'running').length,
    queued: tasks.filter((t) => t.status === 'queued').length,
    success: tasks.filter((t) => t.status === 'success').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
  }), [tasks]);

  const data = useMemo(() => {
    const q = kw.trim().toLowerCase();
    return tasks
      .filter((t) => {
        if (status === 'active' && !isActive(t)) return false;
        if (status !== 'all' && status !== 'active' && t.status !== status) return false;
        if (mode !== 'all' && t.mode !== mode) return false;
        if (!q) return true;
        return t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q) || t.cmd.toLowerCase().includes(q);
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [kw, mode, status, tasks]);

  const columns: Array<UiColumn<Task>> = [
    { key: 'status', title: '状态', width: 96, render: (t) => <Badge tone={statusTone(t.status)}>{STATUS_TEXT[t.status]}</Badge> },
    { key: 'mode', title: '格式', width: 116, render: (t) => <Badge>{MODE_LABELS[t.mode]}</Badge> },
    {
      key: 'task',
      title: '任务',
      width: 460,
      render: (t) => (
        <div className="tasks-title-cell">
          <strong>{t.title}</strong>
          <span>{t.url}</span>
        </div>
      ),
    },
    { key: 'progress', title: '进度', width: 170, render: (t) => <Progress value={t.status === 'queued' ? 0 : t.progress} active={t.status === 'running'} /> },
    {
      key: 'time',
      title: '时间',
      width: 158,
      render: (t) => (
        <div className="tasks-time-cell">
          <span>{dayjs(t.startedAt ?? t.createdAt).format('MM-DD HH:mm:ss')}</span>
          <small>耗时 {duration(t)}</small>
        </div>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 252,
      render: (t) => (
        <div className="tasks-actions">
          <Button size="sm" icon={<FileTextOutlined />} onClick={() => setViewing(t)}>日志</Button>
          {t.status === 'running' && <Button size="sm" icon={<PauseOutlined />} onClick={() => pauseTask(t.id)}>暂停</Button>}
          {t.status === 'paused' && <Button size="sm" variant="primary" icon={<CaretRightOutlined />} onClick={() => resumeTask(t.id)}>继续</Button>}
          {isActive(t) && <Button size="sm" variant="danger" icon={<CloseOutlined />} onClick={() => stopTask(t.id)}>取消</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="tasks-page">
      <Surface className="tasks-hero">
        <div className="tasks-hero-copy">
          <span>下载管理</span>
          <h2>任务历史</h2>
          <p>这里管理下载队列、运行状态和历史日志；文件浏览请去文件管理。</p>
        </div>
        <div className="tasks-summary-grid">
          <div className="tasks-summary-card"><Download /><span>总计</span><strong>{counts.total}</strong></div>
          <div className="tasks-summary-card"><Clock3 /><span>进行中</span><strong>{counts.active}</strong></div>
          <div className="tasks-summary-card"><CheckCircle /><span>已完成</span><strong>{counts.success}</strong></div>
        </div>
      </Surface>

      <div className="tasks-panel">
        <Toolbar>
          <div className="tasks-filters">
            <TextInput placeholder="搜索任务、链接或命令" value={kw} onChange={(e) => setKw(e.target.value)} />
            <Select
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'active', label: '进行中' },
                { value: 'queued', label: '排队中' },
                { value: 'running', label: '下载中' },
                { value: 'paused', label: '已暂停' },
                { value: 'success', label: '完成' },
                { value: 'failed', label: '失败' },
                { value: 'stopped', label: '已停止' },
              ]}
            />
            <Select
              value={mode}
              onChange={setMode}
              options={[
                { value: 'all', label: '全部格式' },
                { value: 'atmos', label: MODE_LABELS.atmos },
                { value: 'alac', label: MODE_LABELS.alac },
                { value: 'aac', label: MODE_LABELS.aac },
              ]}
            />
          </div>
          <div className="tasks-actions">
            <Button icon={<FolderOpenOutlined />} onClick={() => window.api.openFolder('杜比全景声')}>打开下载目录</Button>
            <Button icon={<ClearOutlined />} onClick={clearFinished} disabled={!tasks.some((t) => !isActive(t))}>清除已结束</Button>
            <Button variant="danger" icon={<StopOutlined />} onClick={stopAll} disabled={!tasks.some(isActive)}>取消全部进行中</Button>
          </div>
        </Toolbar>

        <DataTable className="tasks-table" rows={data} columns={columns} rowKey={(t) => t.id} empty="暂无下载历史" />
      </div>

      <Sheet open={!!viewing} title={viewing?.title} onClose={() => setViewing(null)}>
        {viewing && <LogView log={tasks.find((t) => t.id === viewing.id)?.log || ''} height={window.innerHeight - 160} />}
      </Sheet>
    </div>
  );
}
