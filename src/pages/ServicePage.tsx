import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle as CheckCircleFilled,
  Globe as GlobalOutlined,
  KeyRound,
  LogIn as LoginOutlined,
  Plus,
  RefreshCw as ReloadOutlined,
  Server,
  ShieldCheck,
  Trash2,
  XCircle as CloseCircleFilled,
} from 'lucide-react';
import type { Status } from '../types';
import LogView from '../components/LogView';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';
import Notice from '../ui/Notice';
import Select from '../ui/Select';
import Surface from '../ui/Surface';
import TextInput from '../ui/TextInput';

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="service-check">
      {ok ? <CheckCircleFilled className="ok" /> : <CloseCircleFilled className="bad" />}
      {label}
    </span>
  );
}

export default function ServicePage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [logs, setLogs] = useState('');
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginLog, setLoginLog] = useState('');
  const [logging, setLogging] = useState(false);
  const [need2fa, setNeed2fa] = useState(false);
  const [code2fa, setCode2fa] = useState('');
  const [showCredentialLogin, setShowCredentialLogin] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [newAccountLabel, setNewAccountLabel] = useState('');
  const [newAccountStorefront, setNewAccountStorefront] = useState('');
  const [notice, setNotice] = useState<{ tone: 'info' | 'warning' | 'success' | 'error'; text: string } | null>(null);

  const showNotice = useCallback((tone: 'info' | 'warning' | 'success' | 'error', text: string) => {
    setNotice({ tone, text });
    window.setTimeout(() => setNotice((current) => (current?.text === text ? null : current)), 5200);
  }, []);

  const refresh = useCallback(async () => {
    setStatus(await window.api.getStatus());
    const l = await window.api.wrapperLogs();
    if (l.logs) setLogs(l.logs);
  }, []);

  const startWrapper = useCallback(async () => {
    setBusy(true);
    const r = await window.api.wrapperStart();
    setBusy(false);
    if (r.ok) { showNotice('success', '解密服务已启动'); setTimeout(refresh, 1500); }
    else showNotice('error', r.error || '启动失败');
  }, [refresh, showNotice]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    const offLog = window.api.onLoginLog((c) => setLoginLog((p) => (p + c).slice(-100000)));
    const offExit = window.api.onLoginExit(() => { setLogging(false); refresh(); });
    const off2fa = window.api.onLogin2faRequired(() => setNeed2fa(true));
    const offFail = window.api.onLoginFailed(() => {
      setNeed2fa(false);
      setLogging(false);
      showNotice('error', '登录被 Apple 拒绝：请检查邮箱和密码、密码不含英文冒号；若账号被锁或没同意过 iTunes 条款，请先在 music.apple.com 网页登录一次');
    });
    const offOk = window.api.onLoginSuccess(async () => {
      setNeed2fa(false);
      setLogging(false);
      setShowCredentialLogin(false);
      setLoginUser('');
      setLoginPass('');
      setLoginLog('');
      showNotice('success', '登录成功，正在启动解密服务...');
      await window.api.loginStop();
      startWrapper();
    });
    return () => { clearInterval(timer); offLog(); offExit(); off2fa(); offOk(); offFail(); };
  }, [refresh, showNotice, startWrapper]);

  const stopWrapper = async () => {
    setBusy(true);
    const r = await window.api.wrapperStop();
    setBusy(false);
    if (r.ok) showNotice('success', '已停止'); else showNotice('error', r.error || '停止失败');
    refresh();
  };

  const switchAccount = async (id: string) => {
    if (!id || id === s?.activeAccountId) return;
    setSwitchingAccount(true);
    setShowCredentialLogin(false);
    setLoginUser('');
    setLoginPass('');
    setLoginLog('');
    setNeed2fa(false);
    setCode2fa('');
    const r = await window.api.switchAccount(id);
    setSwitchingAccount(false);
    if (r.ok) {
      showNotice('success', '账号槽位已切换，wrapper 已停止，请按需重新启动服务');
      refresh();
    } else {
      showNotice('error', r.error || '切换账号失败');
    }
  };

  const createAccount = async () => {
    const r = await window.api.createAccount({ label: newAccountLabel, storefront: newAccountStorefront });
    if (!r.ok) { showNotice('error', r.error || '新增账号失败'); return; }
    setNewAccountLabel('');
    setNewAccountStorefront('');
    showNotice('success', '账号槽位已新增，可以切换过去登录');
    refresh();
  };

  const deleteAccount = async (id: string) => {
    const r = await window.api.deleteAccount(id);
    if (!r.ok) { showNotice('error', r.error || '删除账号失败'); return; }
    showNotice('success', '账号槽位已删除');
    refresh();
  };

  const doLogin = async () => {
    setLoginLog('');
    setLogging(true);
    setNeed2fa(false);
    setCode2fa('');
    const r = await window.api.loginStart(loginUser.trim(), loginPass);
    if (!r.ok) { setLogging(false); showNotice('error', r.error || '登录启动失败'); }
  };

  const cancelLogin = async () => {
    await window.api.loginStop();
    setLogging(false);
    setNeed2fa(false);
    setCode2fa('');
    showNotice('info', '已取消 Apple ID 登录');
  };

  const submit2fa = async (code = code2fa) => {
    const r = await window.api.login2fa(code);
    if (r.ok) { setNeed2fa(false); showNotice('info', '验证码已提交，正在登录...'); }
    else showNotice('error', r.error || '提交失败');
  };

  const s = status;
  const readyCount = useMemo(() => {
    if (!s) return 0;
    return [s.downloader, s.mp4box, s.decryptPort, s.m3u8Port].filter(Boolean).length;
  }, [s]);
  const showLoginForm = Boolean(s && !s.loggedIn) || showCredentialLogin || logging || need2fa;
  const serviceReady = Boolean(s?.wrapperRunning && s?.loggedIn && s?.decryptPort && s?.m3u8Port);

  return (
    <div className="service-page">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <Surface className="service-hero">
        <div className="service-hero-main">
          <div className="service-hero-icon">
            <Server />
          </div>
          <div className="service-hero-copy">
            <span className="service-hero-kicker">解密服务</span>
            <h2>{serviceReady ? '服务已就绪' : s?.wrapperRunning ? '服务正在运行' : '服务未启动'}</h2>
            <p>{serviceReady ? `${s?.activeAccountLabel || '当前账号'}、wrapper 和端口都正常，可以开始下载杜比全景声。` : '下载杜比全景声前，需要选择账号、完成 Apple ID 登录并保持 wrapper 运行。'}</p>
          </div>
        </div>
        <div className="service-command-stack">
          <div className="service-account-switcher">
            <span>当前账号</span>
            <Select
              className="service-account-select"
              value={s?.activeAccountId || 'default'}
              options={(s?.accounts || [
                { id: 'default', label: '默认账号', storefront: 'cn', active: true, loggedIn: false },
              ]).map((account) => ({
                value: account.id,
                label: `${account.label} · ${account.storefront.toUpperCase()}${account.loggedIn ? ' · 已登录' : ' · 未登录'}`,
              }))}
              onChange={switchAccount}
            />
            <Button size="sm" icon={<Plus />} onClick={() => setAccountDialogOpen(true)}>管理</Button>
          </div>
          {s && <Badge tone={s.wrapperRunning ? 'red' : 'default'}>{switchingAccount ? '切换中' : s.wrapperRunning ? '运行中' : '未运行'}</Badge>}
          <div className="service-actions">
            <Button size="sm" icon={<ReloadOutlined />} onClick={refresh}>刷新状态</Button>
            {s?.wrapperRunning
              ? <Button size="sm" variant="danger" disabled={busy || switchingAccount} onClick={stopWrapper}>停止服务</Button>
              : <Button size="sm" variant="primary" disabled={busy || switchingAccount || !s?.loggedIn} onClick={startWrapper}>启动服务</Button>}
          </div>
        </div>
      </Surface>

      <div className="service-overview-grid">
        <Surface className="service-account-card">
          <div className="service-card-title"><ShieldCheck /><span>Apple ID</span></div>
          <strong>{s?.activeAccountLabel || '国区账号'}</strong>
          <p>{s?.loggedIn ? '当前账号已登录，可启动 wrapper。' : '当前账号未登录，需要先输入 Apple ID。'}</p>
        </Surface>
        <Surface className="service-account-card">
          <div className="service-card-title"><KeyRound /><span>media-user-token</span></div>
          <strong>{s?.mediaUserToken ? '已配置' : '可选'}</strong>
          <p>用于歌词、AAC-LC 和 MV，网页登录后会自动写入配置。</p>
        </Surface>
        <Surface className="service-account-card">
          <div className="service-card-title"><Server /><span>环境检查</span></div>
          <strong>{readyCount}/4</strong>
          <p>下载器、MP4Box、解密端口和 m3u8 端口。</p>
        </Surface>
      </div>

      <Surface>
        <div className="ui-section-head compact">
          <div>
            <h2>运行环境</h2>
            <p>端口没有连通时，先启动服务；工具缺失时需要检查本地依赖。</p>
          </div>
        </div>
        {s && (
          <div className="service-grid">
            <div><span>下载器</span><Check ok={s.downloader} label={s.downloader ? '就绪' : '缺失'} /></div>
            <div><span>MP4Box</span><Check ok={s.mp4box} label={s.mp4box ? '就绪' : '缺失'} /></div>
            <div><span>解密端口 10020</span><Check ok={s.decryptPort} label={s.decryptPort ? '连通' : '未连通'} /></div>
            <div><span>m3u8 端口 20020</span><Check ok={s.m3u8Port} label={s.m3u8Port ? '连通' : '未连通'} /></div>
          </div>
        )}
      </Surface>

      <Surface className="service-log-card" padded={false}>
        <div className="service-log-head">
          <div>
            <h2>wrapper 日志</h2>
            <p>服务异常时看这里，正常使用时可以不用管它。</p>
          </div>
        </div>
        <LogView log={logs} height={150} />
      </Surface>

      <Surface className="service-login-surface">
        <div className="ui-section-head compact">
          <div>
            <h2>Apple ID</h2>
            <p>{s?.loggedIn && !showLoginForm ? `${s.activeAccountLabel} 已登录，平时不需要重复输入账号密码。` : `登录到 ${s?.activeAccountLabel || '当前账号'}，凭据只用于本机 wrapper 缓存。`}</p>
          </div>
          {s?.loggedIn && !showLoginForm && <Button size="sm" onClick={() => setShowCredentialLogin(true)}>重新登录</Button>}
        </div>

        {!showLoginForm && <Notice tone="success" className="service-inline-notice">{s?.activeAccountLabel || 'Apple ID'} 已登录。为了安全和清爽，账号密码输入区已收起。</Notice>}

        {showLoginForm && (
          <>
            <div className="service-login-row">
              <TextInput placeholder="Apple ID 邮箱" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} />
              <TextInput placeholder="密码" type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} />
              <Button variant="primary" icon={<LoginOutlined />} disabled={logging && !need2fa} onClick={doLogin}>登录</Button>
              {logging && <Button variant="danger" onClick={cancelLogin}>取消</Button>}
            </div>
            <Notice tone="info" className="service-inline-notice">开启双重认证的账号：点击登录后，6 位验证码会推送到受信任的 Apple 设备，在上方输入即可。</Notice>
          </>
        )}

        {need2fa && (
          <Notice tone="warning" className="service-inline-notice">
            <div className="service-2fa-row">
              <span>双重认证验证码已推送到受信任的 Apple 设备，请在 60 秒内输入：</span>
              <TextInput
                className="service-2fa-input"
                inputMode="numeric"
                maxLength={6}
                value={code2fa}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setCode2fa(v);
                  if (v.length === 6) submit2fa(v);
                }}
              />
              <Button size="sm" variant="primary" disabled={code2fa.length !== 6} onClick={() => submit2fa()}>提交</Button>
            </div>
          </Notice>
        )}

        {showLoginForm && loginLog && <LogView log={loginLog} height={180} />}
      </Surface>

      <Surface>
        <div className="ui-section-head compact">
          <div>
            <h2>media-user-token（歌词 / AAC-LC / MV 用，可选）</h2>
            <p>登录网页后自动提取 token 并写入 config.yaml。</p>
          </div>
          {s && <Badge tone={s.mediaUserToken ? 'green' : 'default'}>{s.mediaUserToken ? '已配置' : '未配置'}</Badge>}
        </div>
        <BrowserLoginButton onDone={refresh} showNotice={showNotice} />
      </Surface>

      <Dialog
        open={accountDialogOpen}
        title="账号槽位"
        onClose={() => setAccountDialogOpen(false)}
        footer={<Button onClick={() => setAccountDialogOpen(false)}>关闭</Button>}
      >
        <div className="service-account-manager">
          <div className="service-account-create">
            <TextInput placeholder="账号名称，例如 美区主号" value={newAccountLabel} onChange={(e) => setNewAccountLabel(e.target.value)} />
            <TextInput placeholder="区域，例如 us / jp / hk" value={newAccountStorefront} onChange={(e) => setNewAccountStorefront(e.target.value)} />
            <Button variant="primary" icon={<Plus />} onClick={createAccount}>新增账号</Button>
          </div>
          <div className="service-account-list">
            {(s?.accounts || []).map((account) => (
              <div className="service-account-row" key={account.id}>
                <div>
                  <strong>{account.label}</strong>
                  <span>{account.storefront.toUpperCase()} · {account.loggedIn ? '已登录' : '未登录'}{account.active ? ' · 当前' : ''}</span>
                </div>
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Trash2 />}
                  disabled={account.active || (s?.accounts.length ?? 0) <= 1}
                  onClick={() => deleteAccount(account.id)}
                >
                  删除
                </Button>
              </div>
            ))}
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function BrowserLoginButton({ onDone, showNotice }: { onDone: () => void; showNotice: (tone: 'info' | 'warning' | 'success' | 'error', text: string) => void }) {
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const offSaved = window.api.onMusicTokenSaved(() => {
      setWaiting(false);
      showNotice('success', 'media-user-token 已自动保存到 config.yaml');
      onDone();
    });
    const offCancel = window.api.onMusicTokenCancelled(() => setWaiting(false));
    return () => { offSaved(); offCancel(); };
  }, [onDone, showNotice]);

  return (
    <Button
      icon={waiting ? undefined : <GlobalOutlined />}
      disabled={waiting}
      onClick={async () => {
        setWaiting(true);
        await window.api.openMusicLogin();
      }}
    >
      {waiting ? '等待网页登录...' : '打开浏览器登录 Apple Music'}
    </Button>
  );
}
