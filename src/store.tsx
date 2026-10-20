import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { downloadedKey, mergeDownloaded, relocateDownloaded } from './download-history';
import type { DownloadedItem, LibraryChange } from './download-history';
export type { DownloadedItem } from './download-history';

export type TaskStatus = 'queued' | 'running' | 'paused' | 'success' | 'failed' | 'stopped';

export interface Task {
  id: string;
  url: string;
  mode: 'atmos' | 'alac' | 'aac';
  song: boolean;
  debug: boolean;
  title: string;
  cmd: string;
  status: TaskStatus;
  log: string;
  progress: number; // 0-100
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
}

export interface EnqueueItem {
  url: string;
  mode: Task['mode'];
  song: boolean;
  debug: boolean;
}

interface TaskCtx {
  tasks: Task[];
  downloadedItems: DownloadedItem[];
  concurrency: number;
  setConcurrency: (n: number) => void;
  enqueue: (items: EnqueueItem[]) => { added: number; skipped: number; downloaded: number };
  isDownloaded: (url: string, mode: Task['mode'], song: boolean) => boolean;
  stopTask: (id: string) => void;
  pauseTask: (id: string) => void;
  resumeTask: (id: string) => void;
  stopAll: () => void;
  clearFinished: () => void;
}

const Ctx = createContext<TaskCtx>(null as unknown as TaskCtx);
export const useTasks = () => useContext(Ctx);

const TASKS_STORAGE_KEY = 'am-download-tasks-v1';
const CONCURRENCY_STORAGE_KEY = 'am-download-concurrency';
const DOWNLOADED_STORAGE_KEY = 'am-downloaded-items-v2';

function loadStoredDownloaded(): DownloadedItem[] {
  try {
    const raw = localStorage.getItem(DOWNLOADED_STORAGE_KEY) ?? localStorage.getItem('am-downloaded-items-v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((d) => d && typeof d.url === 'string')
      .map((d) => ({
        url: String(d.url),
        mode: d.mode === 'alac' || d.mode === 'aac' ? d.mode : 'atmos',
        song: Boolean(d.song),
        title: String(d.title || ''),
        finishedAt: Number(d.finishedAt) || 0,
        files: Array.isArray(d.files) ? d.files.filter((p: unknown) => typeof p === 'string') : undefined,
        trackUrls: Array.isArray(d.trackUrls) ? d.trackUrls.filter((p: unknown) => typeof p === 'string') : undefined,
      }));
  } catch {
    return [];
  }
}

export const MODE_LABELS: Record<Task['mode'], string> = {
  atmos: '杜比全景声',
  alac: 'ALAC 无损',
  aac: 'AAC',
};

function shortTitle(url: string) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean);
    const slug = seg[seg.length - 2] || seg[seg.length - 1] || url;
    try {
      return decodeURIComponent(slug);
    } catch {
      return slug;
    }
  } catch {
    return url;
  }
}

function parseProgress(log: string): number {
  let pct = 0;
  const re = /Track (\d+) of (\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log))) {
    const n = Number(m[1]);
    const total = Number(m[2]);
    if (total > 0) pct = Math.max(pct, Math.round((n / total) * 100));
  }
  return Math.min(pct, 99);
}

function loadStoredTasks(): Task[] {
  try {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .filter((t) => t && typeof t.id === 'string' && typeof t.url === 'string')
      .map((t) => {
        const active = t.status === 'queued' || t.status === 'running' || t.status === 'paused';
        const log = String(t.log || '').slice(-200000);
        return {
          id: String(t.id),
          url: String(t.url),
          mode: t.mode === 'alac' || t.mode === 'aac' ? t.mode : 'atmos',
          song: Boolean(t.song),
          debug: Boolean(t.debug),
          title: String(t.title || shortTitle(String(t.url))),
          cmd: String(t.cmd || ''),
          status: active ? 'stopped' : t.status,
          log: active ? `${log}\n[应用重启] 未完成任务无法接回原进程，已标记为已停止。\n` : log,
          progress: Number.isFinite(Number(t.progress)) ? Number(t.progress) : 0,
          createdAt: Number(t.createdAt) || now,
          startedAt: Number(t.startedAt) || undefined,
          endedAt: active ? now : Number(t.endedAt) || undefined,
        } as Task;
      })
      .filter((t) => ['queued', 'running', 'paused', 'success', 'failed', 'stopped'].includes(t.status))
      .slice(0, 500);
  } catch {
    return [];
  }
}

function loadStoredConcurrency() {
  const n = Number(localStorage.getItem(CONCURRENCY_STORAGE_KEY));
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
}

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>(loadStoredTasks);
  // 仅首次升级导入旧任务；v2 按文件核对，绝不能在重启后补回已清除的记录。
  const [downloadedItems, setDownloadedItems] = useState<DownloadedItem[]>(() => {
    const map = new Map<string, DownloadedItem>();
    for (const t of localStorage.getItem(DOWNLOADED_STORAGE_KEY) === null ? loadStoredTasks() : []) {
      if (t.status !== 'success') continue;
      map.set(downloadedKey(t.mode, t.song, t.url), {
        url: t.url, mode: t.mode, song: t.song, title: t.title, finishedAt: t.endedAt || t.createdAt,
      });
    }
    for (const d of loadStoredDownloaded()) {
      if (!map.has(downloadedKey(d.mode, d.song, d.url))) map.set(downloadedKey(d.mode, d.song, d.url), d);
    }
    return [...map.values()].sort((a, b) => b.finishedAt - a.finishedAt);
  });
  const [concurrency, setConcurrency] = useState(loadStoredConcurrency);
  const startingRef = useRef<Set<string>>(new Set());
  const cancelledRef = useRef<Set<string>>(new Set());
  const tasksRef = useRef<Task[]>([]);
  tasksRef.current = tasks;
  const downloadedRef = useRef(downloadedItems);
  downloadedRef.current = downloadedItems;

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    const refresh = (change: LibraryChange = {}) => {
      const snapshot = relocateDownloaded(downloadedRef.current, change);
      downloadedRef.current = snapshot;
      setDownloadedItems(snapshot);
      const current = ++revision;
      void window.api.reconcileDownloaded(snapshot, tasksRef.current).then((checked) => {
        if (disposed || current !== revision) return;
        const keys = new Map(checked.map((d) => [downloadedKey(d.mode, d.song, d.url), d]));
        setDownloadedItems((prev) => prev.flatMap((d) => {
          // Do not overwrite receipts received while this filesystem check was pending.
          if (!snapshot.includes(d)) return [d];
          const kept = keys.get(downloadedKey(d.mode, d.song, d.url));
          return kept ? [kept] : [];
        }));
      }).catch((error) => console.error('核对下载文件失败', error));
    };
    const off = window.api.onLibraryChanged(refresh);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    refresh();
    return () => { disposed = true; off(); window.removeEventListener('focus', onFocus); };
  }, []);

  // log / exit events keyed by the real process id (assigned when a queued task starts)
  useEffect(() => {
    const offLog = window.api.onDlLog(({ id, chunk }) => {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const log = (t.log + chunk).slice(-200000);
          return { ...t, log, progress: Math.max(t.progress, parseProgress(log)) };
        })
      );
    });
    const offExit = window.api.onDlExit(({ id, code, downloaded = [] }) => {
      const task = tasksRef.current.find((t) => t.id === id);
      if (task && task.status !== 'stopped' && downloaded.length) {
        setDownloadedItems((prev) => mergeDownloaded(prev, downloaded));
      }
      setTasks((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                status: t.status === 'stopped' ? 'stopped' : code === 0 ? 'success' : 'failed',
                progress: code === 0 ? 100 : t.progress,
                endedAt: Date.now(),
              }
            : t
        )
      );
    });
    return () => { offLog(); offExit(); };
  }, []);

  useEffect(() => {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem(CONCURRENCY_STORAGE_KEY, String(concurrency));
  }, [concurrency]);

  useEffect(() => {
    localStorage.setItem(DOWNLOADED_STORAGE_KEY, JSON.stringify(downloadedItems));
  }, [downloadedItems]);

  // scheduler: fill free slots from the queue
  useEffect(() => {
    let slots = concurrency - tasks.filter((t) => t.status === 'running' || t.status === 'paused').length;
    if (slots <= 0) return;
    for (const q of tasks.filter((t) => t.status === 'queued')) {
      if (slots <= 0) break;
      if (startingRef.current.has(q.id)) continue;
      startingRef.current.add(q.id);
      slots--;
      void (async () => {
        const r = await window.api.downloadStart({
          urls: [q.url],
          mode: q.mode,
          song: q.song,
          debug: q.debug,
          select: false,
        });
        startingRef.current.delete(q.id);
        if (r.ok && r.id) {
          const realId = r.id;
          if (cancelledRef.current.delete(q.id)) {
            window.api.downloadStop(realId);
            setTasks((prev) => prev.map((t) => (t.id === q.id ? { ...t, id: realId } : t)));
            return;
          }
          setTasks((prev) =>
            prev.map((t) =>
              t.id === q.id
                ? { ...t, id: realId, status: 'running', cmd: r.cmd || '', log: `$ ${r.cmd}\n\n`, startedAt: Date.now() }
                : t
            )
          );
        } else {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === q.id
                ? { ...t, status: 'failed', log: `启动失败: ${r.error || '未知错误'}`, endedAt: Date.now() }
                : t
            )
          );
        }
      })();
    }
  }, [tasks, concurrency]);

  const enqueue = (items: EnqueueItem[]) => {
    const now = Date.now();
    // 排队中 / 下载中 / 已暂停的同链接任务视为重复，跳过
    const active = new Set(
      tasks.filter((t) => t.status === 'queued' || t.status === 'running' || t.status === 'paused').map((t) => downloadedKey(t.mode, t.song, t.url))
    );
    // 已下载完成的同格式同链接也跳过
    const completed = new Set(downloadedItems.map((d) => downloadedKey(d.mode, d.song, d.url)));
    let downloadedSkipped = 0;
    const fresh = items.filter((it) => {
      if (completed.has(downloadedKey(it.mode, it.song, it.url))) { downloadedSkipped++; return false; }
      const key = downloadedKey(it.mode, it.song, it.url);
      if (active.has(key)) return false;
      active.add(key);
      return true;
    });
    const skipped = items.length - fresh.length - downloadedSkipped;
    if (fresh.length > 0) {
    setTasks((prev) => [
      ...fresh.map((it, i) => ({
        id: `q${now}_${i}_${Math.floor(Math.random() * 10000)}`,
        url: it.url,
        mode: it.mode,
        song: it.song,
        debug: it.debug,
        title: `${MODE_LABELS[it.mode]} · ${shortTitle(it.url)}`,
        cmd: '',
        status: 'queued' as TaskStatus,
        log: '',
        progress: 0,
        createdAt: now + i,
      })),
      ...prev,
    ]);
    }
    return { added: fresh.length, skipped, downloaded: downloadedSkipped };
  };

  const isDownloaded = (url: string, mode: Task['mode'], song: boolean) => {
    const key = downloadedKey(mode, song, url);
    return downloadedItems.some((d) => downloadedKey(d.mode, d.song, d.url) === key);
  };

  const stopTask = (id: string) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    if (t.status === 'running' || t.status === 'paused') window.api.downloadStop(id);
    if (t.status === 'queued' || t.status === 'running' || t.status === 'paused') {
      cancelledRef.current.add(id);
      setTasks((prev) =>
        prev.map((x) => (x.id === id ? { ...x, status: 'stopped', endedAt: Date.now() } : x))
      );
    }
  };

  const pauseTask = (id: string) => {
    window.api.downloadPause(id).then((r) => {
      if (r.ok) {
        setTasks((prev) => prev.map((t) => (t.id === id && t.status === 'running' ? { ...t, status: 'paused' } : t)));
      }
    });
  };

  const resumeTask = (id: string) => {
    window.api.downloadResume(id).then((r) => {
      if (r.ok) {
        setTasks((prev) => prev.map((t) => (t.id === id && t.status === 'paused' ? { ...t, status: 'running' } : t)));
      }
    });
  };

  const stopAll = () => {
    for (const t of tasks) {
      if (t.status === 'running' || t.status === 'paused') window.api.downloadStop(t.id);
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.status === 'running' || t.status === 'queued' || t.status === 'paused'
          ? { ...t, status: 'stopped', endedAt: Date.now() }
          : t
      )
    );
  };

  const clearFinished = () =>
    setTasks((prev) => prev.filter((t) => t.status === 'running' || t.status === 'queued' || t.status === 'paused'));

  return (
    <Ctx.Provider value={{ tasks, downloadedItems, concurrency, setConcurrency, enqueue, isDownloaded, stopTask, pauseTask, resumeTask, stopAll, clearFinished }}>
      {children}
    </Ctx.Provider>
  );
}
