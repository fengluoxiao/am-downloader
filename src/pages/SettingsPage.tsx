import React, { useEffect, useMemo, useState } from 'react';
import { CircleQuestionMark as QuestionCircleOutlined, Code as CodeOutlined, FolderOpen as FolderOpenOutlined, RefreshCw as ReloadOutlined, Save as SaveOutlined, Unlock as UnlockOutlined } from 'lucide-react';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';
import Notice from '../ui/Notice';
import Segmented from '../ui/Segmented';
import Select from '../ui/Select';
import Surface from '../ui/Surface';
import Switch from '../ui/Switch';
import TextArea from '../ui/TextArea';
import TextInput from '../ui/TextInput';
import { parseEntries, unquote, applyValues } from '../config-form';
import type { ConfigEntry as Entry } from '../config-form';

const ENUMS: Record<string, { options: string[]; label: string }> = {
  'lrc-type': { options: ['lyrics', 'syllable-lyrics'], label: '歌词类型' },
  'lrc-format': { options: ['lrc', 'ttml'], label: '歌词格式' },
  'cover-format': { options: ['jpg', 'png', 'original'], label: '封面格式' },
  'get-m3u8-mode': { options: ['hires', 'all'], label: 'm3u8 获取模式' },
  'wrapper-mode': { options: ['local', 'remote'], label: 'wrapper-lite 连接方式' },
  'aac-type': { options: ['aac-lc', 'aac', 'aac-binaural', 'aac-downmix'], label: 'AAC 类型' },
  'atmos-max': { options: ['2768', '2448'], label: '全景声码率上限' },
  'alac-max': { options: ['192000', '96000', '48000', '44100'], label: 'ALAC 采样率上限' },
  storefront: { options: ['cn', 'us', 'jp', 'hk', 'tw', 'gb'], label: '账号区域' },
};

const LABELS: Record<string, string> = {
  'station-token': '电台 token（可选）',
  'wrapper-lite-url': 'wrapper-lite HTTP 地址',
  'temari-lib': 'Temari 库路径（留空使用内置库）',
  'authorization-token': 'authorization-token',
  language: '语言',
  'embed-lrc': '内嵌歌词',
  'save-lrc-file': '保存歌词文件',
  'save-artist-cover': '保存艺人封面',
  'save-animated-artwork': '保存动态封面 (需 ffmpeg)',
  'emby-animated-artwork': 'Emby 动态封面 (需 ffmpeg)',
  'embed-cover': '内嵌封面',
  'cover-size': '封面尺寸',
  'tag-sort-order': '写入排序标签',
  'tag-itunes-id': '写入 iTunes ID',
  'alac-save-folder': 'ALAC 保存目录',
  'atmos-save-folder': '全景声保存目录',
  'aac-save-folder': 'AAC 保存目录',
  'mv-save-folder': 'MV 保存目录',
  'max-memory-limit': '内存上限 (MB)',
  'exit-on-error': '出错即退出',
  'limit-max': '单曲时长上限',
  'album-folder-format': '专辑目录命名格式',
  'playlist-folder-format': '歌单目录命名格式',
  'ffmpeg-path': 'ffmpeg 路径',
  ...Object.fromEntries(Object.entries(ENUMS).map(([k, v]) => [k, v.label])),
};

const SIMPLE_KEYS = new Set(['wrapper-mode', 'wrapper-lite-url', 'language', 'lrc-type', 'lrc-format', 'embed-lrc', 'save-lrc-file', 'alac-save-folder', 'atmos-save-folder', 'aac-save-folder', 'mv-save-folder', 'alac-max', 'atmos-max']);

type ViewMode = 'simple' | 'advanced' | 'raw';

export default function SettingsPage() {
  const [raw, setRaw] = useState('');
  const [path, setPath] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem('am-settings-view') as ViewMode) || 'simple');
  const [rawDraft, setRawDraft] = useState<string | null>(null);
  const [rawUnlocked, setRawUnlocked] = useState(false);
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'success' | 'error'; text: string } | null>(null);

  const load = async () => {
    const r = await window.api.readConfig();
    setRaw(r.raw);
    setPath(r.path);
    setValues({});
  };

  useEffect(() => { load(); }, []);

  const entries = useMemo(() => parseEntries(raw), [raw]);
  const mergedRaw = useMemo(() => applyValues(raw, values), [raw, values]);
  const shownEntries = useMemo(() => (view === 'simple' ? entries.filter((e) => SIMPLE_KEYS.has(e.key)) : entries), [entries, view]);
  const getVal = (e: Entry) => (e.key in values ? values[e.key] : unquote(e.value));
  const setVal = (key: string, v: string) => setValues((p) => ({ ...p, [key]: v }));
  const showNotice = (tone: 'info' | 'warning' | 'success' | 'error', text: string) => setNotice({ tone, text });

  const switchView = (v: ViewMode) => {
    setView(v);
    localStorage.setItem('am-settings-view', v);
    if (v === 'raw') { setRawDraft(null); setRawUnlocked(false); }
  };

  const save = async () => {
    setSaving(true);
    const content = view === 'raw' && rawDraft !== null ? rawDraft : mergedRaw;
    const r = await window.api.writeConfig(content);
    setSaving(false);
    if (r.ok) { showNotice('success', '配置已保存'); await load(); setRawDraft(null); }
    else showNotice('error', `保存失败: ${r.error}`);
  };

  const unlockRaw = async () => {
    setConfirmUnlock(false);
    const r = await window.api.elevateAuth();
    if (r.ok) { setRawUnlocked(true); showNotice('success', '认证通过，编辑已解锁'); }
    else showNotice('error', r.error || '认证失败');
  };

  const renderControl = (e: Entry) => {
    const v = getVal(e);
    if (v === 'true' || v === 'false') return <Switch checked={v === 'true'} onChange={(c) => setVal(e.key, String(c))} />;
    if (e.key.endsWith('-save-folder')) return <PathPicker label={LABELS[e.key] || e.key} value={v} onPick={(next) => setVal(e.key, next)} kind="folder" />;
    if (e.key === 'ffmpeg-path' || e.key.endsWith('-path')) return <PathPicker label={LABELS[e.key] || e.key} value={v} onPick={(next) => setVal(e.key, next)} kind="file" />;
    const en = ENUMS[e.key];
    if (en) return <Select value={v} options={en.options.map((o) => ({ value: o, label: o }))} onChange={(nv) => setVal(e.key, nv)} />;
    return <TextInput value={v} onChange={(ev) => setVal(e.key, ev.target.value)} />;
  };

  return (
    <div className="settings-page">
      <Surface>
        <div className="ui-section-head">
          <div>
            <h2>下载器配置 (config.yaml)</h2>
            <p>{path}</p>
          </div>
          <div className="settings-actions">
            <Segmented value={view === 'raw' ? 'advanced' : view} onChange={(v) => switchView(v as ViewMode)} options={[{ label: '简单', value: 'simple' }, { label: '复杂', value: 'advanced' }]} />
            <Button icon={<CodeOutlined />} variant={view === 'raw' ? 'primary' : 'default'} onClick={() => switchView(view === 'raw' ? 'advanced' : 'raw')}>原始 YAML</Button>
            <Button icon={<ReloadOutlined />} onClick={load}>重新加载</Button>
            <Button variant="primary" icon={<SaveOutlined />} disabled={saving} onClick={save}>保存</Button>
          </div>
        </div>

        {notice && <Notice tone={notice.tone} className="settings-notice">{notice.text}</Notice>}
        <Notice tone="info" className="settings-notice">1Panel 部署选择 remote 并填写 wrapper-lite HTTP 地址；歌词直接使用服务账号。storefront 需与账号区域一致（cn/us/jp...）；atmos-max 可选 2768 / 2448。</Notice>
        <Notice tone="info" className="settings-notice">保存目录支持本机磁盘、已挂载的 NAS 盘（例如 Y:\music\dolbyatmos）和 UNC 网络共享（例如 \\NAS\music）。可以直接输入路径或点击选择。</Notice>

        {view === 'raw' ? (
          <div className="settings-raw">
            {!rawUnlocked ? (
              <Notice tone="warning">原始 YAML 处于只读状态。解锁后可直接编辑全部配置，请谨慎操作。 <Button size="sm" variant="danger" icon={<UnlockOutlined />} onClick={() => setConfirmUnlock(true)}>解锁编辑</Button></Notice>
            ) : (
              <Notice tone="error">编辑已解锁，保存前请仔细检查 YAML 格式。</Notice>
            )}
            <TextArea className="settings-raw-editor" value={rawDraft !== null ? rawDraft : mergedRaw} readOnly={!rawUnlocked} onChange={(e) => setRawDraft(e.target.value)} rows={26} />
          </div>
        ) : (
          <div className="settings-grid">
            {shownEntries.map((e) => (
              <div className="settings-entry" key={`${e.key}-${e.line}`}>
                <label>
                  <span>{LABELS[e.key] || e.key}</span>
                  {e.comment && <span title={e.comment}><QuestionCircleOutlined /></span>}
                </label>
                {renderControl(e)}
              </div>
            ))}
          </div>
        )}
      </Surface>

      <Dialog
        open={confirmUnlock}
        title="解锁原始 YAML 编辑？"
        onClose={() => setConfirmUnlock(false)}
        footer={<><Button onClick={() => setConfirmUnlock(false)}>取消</Button><Button variant="danger" onClick={unlockRaw}>确认解锁</Button></>}
      >
        直接编辑 YAML 会跳过表单校验，写错格式或字段名可能导致下载器无法启动。解锁需要系统管理员认证：Linux/macOS 会输入密码，Windows 会弹出 UAC。
      </Dialog>
    </div>
  );
}

function PathPicker({ label, value, onPick, kind }: { label: string; value: string; onPick: (path: string) => void; kind: 'file' | 'folder' }) {
  return (
    <div className="settings-path-picker">
      <TextInput value={value} onChange={(e) => onPick(e.target.value)} aria-label={label} placeholder={kind === 'folder' ? '选择保存目录' : '选择可执行文件'} />
      <Button
        size="sm"
        icon={<FolderOpenOutlined />}
        onClick={async () => {
          const r = kind === 'folder' ? await window.api.pickFolder(value) : await window.api.pickFile(value);
          if (r.ok && r.path) onPick(r.path);
        }}
      >
        选择
      </Button>
    </div>
  );
}
