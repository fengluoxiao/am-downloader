import React, { useEffect, useMemo, useState } from 'react';
import { Download as CloudDownloadOutlined, Pause as PauseOutlined, Play as CaretRightOutlined, Square as StopOutlined, X as CloseOutlined } from 'lucide-react';
import { MODE_LABELS, Task, useTasks } from '../store';
import LogView from '../components/LogView';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Notice from '../ui/Notice';
import Progress from '../ui/Progress';
import Surface from '../ui/Surface';
import Switch from '../ui/Switch';
import TextArea from '../ui/TextArea';
import { cx } from '../ui/utils';

const MODE_OPTIONS: Array<{ label: string; value: Task['mode'] }> = [
  { label: '杜比全景声', value: 'atmos' },
  { label: 'ALAC 无损', value: 'alac' },
  { label: 'AAC', value: 'aac' },
];

const MODE_COPY: Record<Task['mode'], string> = {
  atmos: '空间音频 / EC-3 JOC',
  alac: '无损音频，适合归档',
  aac: '体积更小，兼容性好',
};

const STATUS_LABEL: Record<Task['status'], string> = {
  queued: '排队中',
  running: '下载中',
  paused: '已暂停',
  success: '已完成',
  failed: '失败',
  stopped: '已停止',
};

function statusTone(status: Task['status']) {
  if (status === 'running') return 'blue';
  if (status === 'paused') return 'yellow';
  if (status === 'failed' || status === 'stopped') return 'red';
  if (status === 'success') return 'green';
  return 'default';
}

export default function DownloadPage() {
  const { tasks, concurrency, setConcurrency, enqueue, stopTask, pauseTask, resumeTask, stopAll } = useTasks();
  const [urls, setUrls] = useState('');
  const [mode, setMode] = useState<Task['mode']>('atmos');
  const [song, setSong] = useState(false);
  const [debug, setDebug] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'success' | 'error'; text: string } | null>(null);

  const active = useMemo(
    () => tasks
      .filter((t) => t.status === 'running' || t.status === 'queued' || t.status === 'paused')
      .sort((a, b) => a.createdAt - b.createdAt),
    [tasks]
  );
  const runningCount = active.filter((t) => t.status === 'running').length;

  useEffect(() => {
    if (selectedId && active.some((t) => t.id === selectedId)) return;
    setSelectedId(active.find((t) => t.status === 'running')?.id ?? active[0]?.id ?? null);
  }, [active, selectedId]);

  const selected = tasks.find((t) => t.id === selectedId) ?? active[0] ?? tasks[0];

  const showNotice = (tone: 'info' | 'warning' | 'success' | 'error', text: string) => {
    setNotice({ tone, text });
    window.setTimeout(() => setNotice((current) => (current?.text === text ? null : current)), 4200);
  };

  const start = () => {
    const list = urls.split('\n').map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) { showNotice('warning', '请粘贴至少一个 Apple Music 链接'); return; }

    const bad = list.find((u) => !/^https?:\/\/music\.apple\.com/.test(u));
    if (bad) { showNotice('warning', `链接格式不对: ${bad}`); return; }

    const r = enqueue(list.map((url) => ({ url, mode, song, debug })));
    if (r.added === 0) {
      showNotice('info', r.downloaded > 0 && r.skipped === 0 ? '这些链接都已下载过，不再重复下载' : '这些链接都已在队列中或已下载过');
      return;
    }

    setUrls('');
    const skipParts: string[] = [];
    if (r.skipped > 0) skipParts.push(`${r.skipped} 个重复`);
    if (r.downloaded > 0) skipParts.push(`${r.downloaded} 个已下载过`);
    showNotice(
      'success',
      skipParts.length > 0
        ? `已加入队列：${r.added} 个任务，跳过 ${skipParts.join('、')}（同时最多 ${concurrency} 个）`
        : `已加入队列：${r.added} 个任务（同时最多 ${concurrency} 个）`
    );
  };

  return (
    <div className="download-page">
      <Surface className="download-create">
        <div className="ui-section-head">
          <div>
            <h2>新建下载</h2>
            <p>粘贴 Apple Music 链接，一行一个，队列会按并发数自动启动。</p>
          </div>
          <Badge tone="red">最多 5 线程</Badge>
        </div>

        <TextArea
          rows={4}
          placeholder={'例如: https://music.apple.com/cn/album/1989-taylors-version-deluxe/1708308989'}
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
        />

        <div className="download-mode-grid" role="radiogroup" aria-label="下载格式">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={mode === option.value}
              className={cx('download-mode-card', mode === option.value && 'selected')}
              onClick={() => setMode(option.value)}
            >
              <strong>{option.label}</strong>
              <span>{MODE_COPY[option.value]}</span>
            </button>
          ))}
        </div>

        <div className="download-option-panel">
          <div className="download-option-toggles">
            <Switch checked={song} onChange={setSong} label="单曲链接" />
            <Switch checked={debug} onChange={setDebug} label="只查看音质" />
          </div>
          <div className="download-stepper" aria-label="并发数">
            <span>并发数</span>
            <Button size="sm" variant="quiet" disabled={concurrency <= 1} onClick={() => setConcurrency(Math.max(1, concurrency - 1))}>-</Button>
            <strong>{concurrency}</strong>
            <Button size="sm" variant="quiet" disabled={concurrency >= 5} onClick={() => setConcurrency(Math.min(5, concurrency + 1))}>+</Button>
          </div>
          <div className="download-submit-row">
            <Button variant="primary" icon={<CloudDownloadOutlined />} onClick={start}>加入队列</Button>
            {active.length > 0 && <Button variant="danger" icon={<StopOutlined />} onClick={stopAll}>全部停止</Button>}
          </div>
        </div>
      </Surface>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {tasks.length === 0 && (
        <Notice tone="info">下载前请确认解密服务（wrapper）已启动，可在左侧「解密服务」页面查看状态。</Notice>
      )}

      {active.length > 0 && (
        <Surface className="download-queue">
          <div className="ui-section-head compact">
            <div>
              <h2>队列</h2>
              <p>{runningCount} 个下载中 / {active.length} 个待处理（并发上限 {concurrency}）</p>
            </div>
          </div>

          <div className="download-task-list">
            {active.map((t) => (
              <button
                key={t.id}
                type="button"
                className={cx('download-task-row', t.id === selectedId && 'selected')}
                onClick={() => setSelectedId(t.id)}
              >
                <div className="download-task-main">
                  <div className="download-task-title-line">
                    <Badge tone={statusTone(t.status)}>{STATUS_LABEL[t.status]}</Badge>
                    <Badge>{MODE_LABELS[t.mode]}</Badge>
                    <span className="download-task-title">{t.title}</span>
                  </div>
                  <Progress value={t.status === 'queued' ? 0 : t.progress} active={t.status === 'running'} />
                </div>
                <div className="download-task-actions" onClick={(event) => event.stopPropagation()}>
                  {t.status === 'running' && <Button size="sm" icon={<PauseOutlined />} onClick={() => pauseTask(t.id)}>暂停</Button>}
                  {t.status === 'paused' && <Button size="sm" variant="primary" icon={<CaretRightOutlined />} onClick={() => resumeTask(t.id)}>继续</Button>}
                  <Button size="sm" variant="danger" icon={<CloseOutlined />} onClick={() => stopTask(t.id)}>取消</Button>
                </div>
              </button>
            ))}
          </div>
        </Surface>
      )}

      {selected && (
        <Surface className="download-log">
          <div className="ui-section-head compact">
            <div>
              <h2>输出</h2>
              <p>{selected.title}</p>
            </div>
          </div>
          <LogView log={selected.log} height={320} />
        </Surface>
      )}
    </div>
  );
}
