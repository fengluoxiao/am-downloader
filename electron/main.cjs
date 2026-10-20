const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const yaml = require('js-yaml');
const { findAppleMusicInfo } = require('./getinfo');
const { createSearchRunner } = require('./search-runner.cjs');
const { DEFAULT_URL, connectionSettings, normalizeWrapperUrl, probeWrapper, migrateConfig } = require('./wrapper-lite.cjs');
const downloadHistory = require('./download-history.cjs');
const { mediaToolEnv } = require('./media-tools.cjs');

// Hyprland 下 Electron 的 GPU compositing / GPU process 都可能在窗口创建后假死或 SIGTRAP。
// 默认在 Hyprland 走软件渲染；AM_GUI_DISABLE_GPU=0 可关闭该兼容层；AM_GUI_OZONE=x11/wayland 可手动覆盖 ozone。
const isHyprland =
  Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE) ||
  /hyprland/i.test(process.env.XDG_CURRENT_DESKTOP || '') ||
  /hyprland/i.test(process.env.DESKTOP_SESSION || '');
const ozoneMode = process.env.AM_GUI_OZONE || 'auto';
const shouldDisableGpuCompositing =
  process.env.AM_GUI_DISABLE_GPU_COMPOSITING === '1' ||
  (isHyprland && process.env.AM_GUI_DISABLE_GPU_COMPOSITING !== '0');
const shouldDisableGpu =
  process.env.AM_GUI_DISABLE_GPU === '1' ||
  (isHyprland && process.env.AM_GUI_DISABLE_GPU !== '0');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', ozoneMode);
  if (ozoneMode === 'x11' || ozoneMode === 'wayland') {
    app.commandLine.appendSwitch('ozone-platform', ozoneMode);
  }
  if (ozoneMode === 'wayland') {
    app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
  }
  if (shouldDisableGpuCompositing) {
    app.commandLine.appendSwitch('disable-gpu-compositing');
  }
  if (shouldDisableGpu) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-software-rasterizer', 'false');
  }
}

// ---------- paths ----------
// 打包后 config.yaml 会被写入，repo 需要落在可写的 userData 下；
// 开发和打包环境均使用配套的 HTTP/Temari 下载器，避免误用旧 TCP 二进制。
function resolveRepoDir() {
  if (process.env.AM_DL_REPO) return process.env.AM_DL_REPO;
  const tpl = app.isPackaged ? path.join(process.resourcesPath, 'repo') : path.resolve(__dirname, '..', 'build-res', 'repo');
  const userRepo = path.join(app.getPath('userData'), 'repo');
  fs.mkdirSync(userRepo, { recursive: true });
  if (fs.existsSync(tpl)) {
    for (const f of fs.readdirSync(tpl)) {
      const target = path.join(userRepo, f);
      // Config is user-owned. Refresh bundled binaries after an app upgrade.
      if (f === 'config.yaml' && fs.existsSync(target)) continue;
      const source = path.join(tpl, f);
      if (!fs.statSync(source).isFile()) continue;
      const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      if (!fs.existsSync(target) || digest(source) !== digest(target)) fs.copyFileSync(source, target);
    }
    try { fs.chmodSync(path.join(userRepo, 'apple-music-dl'), 0o755); } catch {}
  }
  return userRepo;
}
const REPO_DIR = resolveRepoDir();
const BINARY = path.join(REPO_DIR, process.platform === 'win32' ? 'apple-music-dl.exe' : 'apple-music-dl');
const CONFIG_PATH = path.join(REPO_DIR, 'config.yaml');
const WRAPPER_DIR = process.env.AM_WRAPPER_DIR || path.join(os.homedir(), 'tools', 'wrapper-lite');
const WRAPPER_DATA = path.join(WRAPPER_DIR, 'rootfs', 'data');
const WRAPPER_IMAGE = 'wrapper-lite:local';
const WRAPPER_NAME = 'wrapper-lite';
const LOGIN_NAME = 'am-wrapper-lite-login';
const TWOFA_PATH = path.join(WRAPPER_DATA, '2fa.txt');
const ACCOUNT_PROFILE_ROOT = path.join(app.getPath('userData'), 'wrapper-lite-accounts');
const ACCOUNT_STATE_PATH = path.join(ACCOUNT_PROFILE_ROOT, 'state.json');

let win = null;
const tasks = new Map(); // id -> child_process
let loginProc = null;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------- helpers ----------
function execFileP(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000, env: mediaToolEnv(REPO_DIR, app.getPath('userData')), ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? String(err.message || err) : null });
    });
  });
}

function whichP(bin) {
  return execFileP(process.platform === 'win32' ? 'where.exe' : 'which', [bin]).then((r) => r.ok && r.stdout.trim().length > 0);
}

function wrapperConnection() { return connectionSettings(readConfigObj().obj); }
function localOnly() {
  if (wrapperConnection().mode === 'remote') return '远程服务请在 1Panel 中管理容器和 Apple ID 登录';
  if (tasks.size || wrapperStartLock) return '请等待下载或服务启动结束后再操作';
  return '';
}

function readAccountState() {
  try {
    const data = JSON.parse(fs.readFileSync(ACCOUNT_STATE_PATH, 'utf8'));
    const profiles = normalizeAccountProfiles(data.profiles);
    if (profiles.length) {
      const activeId = profiles.some((profile) => profile.id === data.activeId) ? data.activeId : profiles[0].id;
      return { activeId, profiles };
    }
    const migrated = discoverAccountProfiles(data.activeId);
    if (migrated.length) return { activeId: migrated.some((profile) => profile.id === data.activeId) ? data.activeId : migrated[0].id, profiles: migrated };
  } catch {}
  const discovered = discoverAccountProfiles();
  if (discovered.length) return { activeId: discovered[0].id, profiles: discovered };
  const configuredStorefront = String(readConfigObj().obj.storefront || '').toLowerCase();
  const fallback = { id: 'default', label: '默认账号', storefront: /^[a-z]{2}$/.test(configuredStorefront) ? configuredStorefront : 'cn' };
  return { activeId: fallback.id, profiles: [fallback] };
}

function writeAccountState(state) {
  fs.mkdirSync(ACCOUNT_PROFILE_ROOT, { recursive: true });
  fs.writeFileSync(ACCOUNT_STATE_PATH, JSON.stringify({ activeId: state.activeId, profiles: normalizeAccountProfiles(state.profiles) }, null, 2), 'utf8');
}

function normalizeAccountProfiles(profiles) {
  if (!Array.isArray(profiles)) return [];
  const seen = new Set();
  return profiles.flatMap((profile) => {
    const id = String(profile && profile.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    const storefront = String(profile && profile.storefront || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 12);
    if (!id || !storefront || seen.has(id)) return [];
    seen.add(id);
    return [{ id, label: String(profile.label || storefront.toUpperCase()).trim().slice(0, 40) || storefront.toUpperCase(), storefront }];
  });
}

function createAccountId(storefront) {
  const base = `${storefront}-${Date.now().toString(36)}`.replace(/[^a-zA-Z0-9_-]/g, '');
  return base || `account-${Date.now().toString(36)}`;
}

function discoverAccountProfiles(activeId) {
  const ids = new Set();
  if (activeId) ids.add(String(activeId));
  try {
    for (const entry of fs.readdirSync(ACCOUNT_PROFILE_ROOT, { withFileTypes: true })) {
      if (entry.isDirectory()) ids.add(entry.name);
    }
  } catch {}
  return Array.from(ids).flatMap((id) => {
    const cleanId = String(id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    if (!cleanId) return [];
    return [{ id: cleanId, label: `${cleanId.toUpperCase()} 账号`, storefront: cleanId.split('-')[0].toLowerCase() || 'cn' }];
  });
}

function activeAccountId() {
  return readAccountState().activeId;
}

function accountProfileDir(id) {
  return path.join(ACCOUNT_PROFILE_ROOT, id);
}

function accountHasLogin(id) {
  return hasLiteLogin(accountProfileDir(id));
}

function wrapperLoggedIn() {
  return hasLiteLogin(WRAPPER_DATA);
}

function hasLiteLogin(dir) {
  return ['MUSIC_TOKEN', 'DEV_TOKEN', 'STOREFRONT_ID'].every((file) => {
    try { return fs.readFileSync(path.join(dir, file), 'utf8').trim().length > 0; } catch { return false; }
  });
}

async function copyWrapperDataWithDocker(fromHost, toHost) {
  fs.mkdirSync(fromHost, { recursive: true });
  fs.mkdirSync(toHost, { recursive: true });
  const r = await execFileP('docker', [
    'run', '--rm', '--privileged',
    '-v', `${fromHost}:/from`,
    '-v', `${toHost}:/to`,
    '--entrypoint', 'sh', WRAPPER_IMAGE,
    '-c', 'find /to -mindepth 1 -maxdepth 1 -exec rm -rf {} + && cp -a /from/. /to/',
  ], { timeout: 60000 });
  return r.ok ? { ok: true } : { ok: false, error: r.stderr || r.error || '复制账号数据失败' };
}

async function clearWrapperDataWithDocker() {
  fs.mkdirSync(WRAPPER_DATA, { recursive: true });
  const r = await execFileP('docker', [
    'run', '--rm', '--privileged',
    '-v', `${WRAPPER_DATA}:/current`,
    '--entrypoint', 'sh', WRAPPER_IMAGE,
    '-c', 'find /current -mindepth 1 -maxdepth 1 -exec rm -rf {} + && mkdir -p /current/data/com.apple.android.music/files',
  ], { timeout: 60000 });
  return r.ok ? { ok: true } : { ok: false, error: r.stderr || r.error || '清空账号数据失败' };
}

async function saveCurrentAccountProfile(id = activeAccountId()) {
  if (!wrapperLoggedIn()) return { ok: true };
  return copyWrapperDataWithDocker(WRAPPER_DATA, accountProfileDir(id));
}

async function restoreAccountProfile(id) {
  const profileDir = accountProfileDir(id);
  if (!fs.existsSync(path.join(profileDir, 'data'))) return clearWrapperDataWithDocker();
  return copyWrapperDataWithDocker(profileDir, WRAPPER_DATA);
}

function accountProfilesPayload() {
  const { activeId, profiles } = readAccountState();
  return profiles.map((profile) => ({ ...profile, active: profile.id === activeId, loggedIn: accountHasLogin(profile.id) || (profile.id === activeId && wrapperLoggedIn()) }));
}

function activeAccountProfile() {
  const { activeId, profiles } = readAccountState();
  return profiles.find((profile) => profile.id === activeId) || profiles[0] || { id: 'default', label: '默认账号', storefront: 'cn' };
}

function setConfigValue(key, value) {
  const { raw } = readConfigObj();
  const line = `${key}: ${JSON.stringify(String(value))}`;
  const next = new RegExp(`^${key}:.*$`, 'm').test(raw)
    ? raw.replace(new RegExp(`^${key}:.*$`, 'm'), line)
    : `${line}\n${raw}`;
  fs.writeFileSync(CONFIG_PATH, next, 'utf8');
}

function readConfigObj() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return { raw, obj: yaml.load(raw) || {} };
  } catch {
    return { raw: '', obj: {} };
  }
}

if (fs.existsSync(CONFIG_PATH)) {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const migrated = migrateConfig(raw);
  if (migrated !== raw) {
    if (!fs.existsSync(`${CONFIG_PATH}.pre-wrapper-lite.bak`)) fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.pre-wrapper-lite.bak`);
    fs.writeFileSync(CONFIG_PATH, migrated, 'utf8');
  }
}

function downloadRoots() {
  const { obj } = readConfigObj();
  const roots = [];
  const push = (p, format) => {
    if (!p) return;
    const abs = path.isAbsolute(p) ? p : path.join(REPO_DIR, p);
    if (roots.some((r) => r.dir === abs)) return; // 同一目录只扫一次
    roots.push({ dir: abs, format });
  };
  push(obj['atmos-save-folder'], '杜比全景声');
  push(obj['alac-save-folder'], 'ALAC');
  push(obj['aac-save-folder'], 'AAC');
  push(obj['mv-save-folder'], 'MV');
  return roots;
}

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'Apple Music 杜比全景声下载器',
    backgroundColor: '#0f1419',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (app.isPackaged || !process.env.VITE_DEV_SERVER_URL) {
    const indexHtml = path.join(__dirname, '..', 'dist', 'index.html');
    if (fs.existsSync(indexHtml)) win.loadFile(indexHtml);
    else win.loadURL(devUrl);
  } else {
    win.loadURL(devUrl);
  }

}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const p of tasks.values()) { try { p.kill('SIGTERM'); } catch {} }
  closeSearchBrowser();
  if (process.platform !== 'darwin') app.quit();
});

// ---------- IPC: amget 搜索（Playwright + AMP API） ----------
let searchBrowser = null;
let searchPage = null;
let searchLaunching = null;

async function ensureSearchPage() {
  if (searchPage && !searchPage.isClosed()) return searchPage;
  if (searchLaunching) return searchLaunching;
  searchLaunching = (async () => {
    if (searchBrowser) {
      try { await searchBrowser.close(); } catch {}
      searchBrowser = null;
    }
    const playwright = require('playwright');
    searchBrowser = await playwright.chromium.launch({ channel: 'msedge' });
    const context = await searchBrowser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      javaScriptEnabled: true,
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7' },
    });
    searchPage = await context.newPage();
    searchLaunching = null;
    return searchPage;
  })().catch((e) => { searchLaunching = null; throw e; });
  return searchLaunching;
}

function closeSearchBrowser() {
  if (searchBrowser) {
    try { searchBrowser.close(); } catch {}
    searchBrowser = null;
    searchPage = null;
  }
}

const searchRunner = createSearchRunner({
  getPage: async () => (await ensureSearchPage()).context().newPage(),
  search: findAppleMusicInfo,
  getStorefront: () => activeAccountProfile().storefront,
});
ipcMain.handle('search:run', (event, opts) => searchRunner.run(event, opts));
ipcMain.on('search:cancel', (event, requestId) => searchRunner.cancel(event, requestId));

// ---------- IPC: status ----------
ipcMain.handle('status:get', async () => {
  const connection = wrapperConnection();
  const remote = connection.mode === 'remote';
  const [health, container, mp4box, docker] = await Promise.all([
    probeWrapper(connection.url),
    remote ? null : execFileP('docker', ['ps', '--filter', `name=^${WRAPPER_NAME}$`, '--format', '{{.Status}}']),
    whichP('MP4Box'), remote ? false : whichP('docker'),
  ]);
  const loggedIn = remote ? health.ok && health.regions.length > 0 : wrapperLoggedIn();
  const accounts = accountProfilesPayload();
  const activeAccount = accounts.find((profile) => profile.active) || accounts[0];
  return {
    repoDir: REPO_DIR,
    downloader: fs.existsSync(BINARY),
    config: fs.existsSync(CONFIG_PATH),
    mp4box,
    docker,
    wrapperRunning: remote ? health.ok : Boolean(container?.ok && container.stdout.trim()),
    wrapperStatusText: remote ? (health.ok ? '远程服务已连接' : health.error) : container.stdout.trim(),
    wrapperApi: health.ok,
    wrapperMode: connection.mode,
    wrapperUrl: connection.url,
    wrapperRegions: health.regions,
    wrapperError: health.error,
    loggedIn,
    activeAccountId: activeAccount.id,
    activeAccountLabel: activeAccount.label,
    activeStorefront: activeAccount.storefront,
    accounts,
    stationToken: (readConfigObj().obj['station-token'] || '').length > 50,
  };
});

ipcMain.handle('wrapper:configure', async (_e, { mode, url }) => {
  try {
    if (tasks.size || loginProc || wrapperStartLock) return { ok: false, error: '请先结束下载、登录或服务启动，再修改连接' };
    if (!['local', 'remote'].includes(mode)) throw new Error('未知连接方式');
    const normalized = normalizeWrapperUrl(url);
    if (mode === 'local' && normalized !== DEFAULT_URL) throw new Error(`本机 Docker 使用 ${DEFAULT_URL}，自定义地址请选择远程服务`);
    const { raw } = readConfigObj();
    const config = yaml.load(raw) || {};
    config['wrapper-mode'] = mode;
    config['wrapper-lite-url'] = normalized;
    // Preserve comments and all other preferences.
    let next = migrateConfig(raw);
    for (const key of ['wrapper-mode', 'wrapper-lite-url']) next = next.replace(new RegExp(`^${key}:.*$`, 'm'), () => `${key}: ${JSON.stringify(config[key])}`);
    fs.writeFileSync(CONFIG_PATH, next, 'utf8');
    const health = await probeWrapper(normalized);
    return { ok: true, connected: health.ok, error: health.error };
  } catch (error) { return { ok: false, error: error.message }; }
});

ipcMain.handle('account:switch', async (_e, id) => {
  const denied = localOnly();
  if (denied) return { ok: false, error: denied };
  const state = readAccountState();
  const target = state.profiles.find((profile) => profile.id === id);
  if (!target) return { ok: false, error: '未知账号槽位' };
  if (id === activeAccountId()) return { ok: true, profiles: accountProfilesPayload() };
  loginProc = null;
  for (const name of [LOGIN_NAME, WRAPPER_NAME]) {
    const stopped = await execFileP('docker', ['rm', '-f', name]);
    if (!stopped.ok && !/No such container/i.test(stopped.stderr)) return { ok: false, error: stopped.stderr || stopped.error };
  }
  const saved = await saveCurrentAccountProfile();
  if (!saved.ok) return saved;
  const restored = await restoreAccountProfile(id);
  if (!restored.ok) return restored;
  writeAccountState({ activeId: id, profiles: state.profiles });
  try { setConfigValue('storefront', target.storefront); } catch {}
  return { ok: true, profiles: accountProfilesPayload() };
});

ipcMain.handle('account:create', async (_e, { label, storefront }) => {
  const denied = localOnly();
  if (denied) return { ok: false, error: denied };
  const state = readAccountState();
  const sf = String(storefront || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 12);
  if (!sf) return { ok: false, error: '请输入账号区域，例如 cn / us / jp' };
  const name = String(label || '').trim().slice(0, 40) || `${sf.toUpperCase()} 账号`;
  const profile = { id: createAccountId(sf), label: name, storefront: sf };
  writeAccountState({ activeId: state.activeId, profiles: [...state.profiles, profile] });
  return { ok: true, profile, profiles: accountProfilesPayload() };
});

ipcMain.handle('account:delete', async (_e, id) => {
  const denied = localOnly();
  if (denied) return { ok: false, error: denied };
  const state = readAccountState();
  if (state.profiles.length <= 1) return { ok: false, error: '至少保留一个账号槽位' };
  const target = state.profiles.find((profile) => profile.id === id);
  if (!target) return { ok: false, error: '账号槽位不存在' };
  if (id === state.activeId) return { ok: false, error: '不能删除当前正在使用的账号，请先切换到其他账号' };
  try { fs.rmSync(accountProfileDir(id), { recursive: true, force: true }); } catch {}
  writeAccountState({ activeId: state.activeId, profiles: state.profiles.filter((profile) => profile.id !== id) });
  return { ok: true, profiles: accountProfilesPayload() };
});

// ---------- IPC: wrapper service ----------
let wrapperStartLock = null;

ipcMain.handle('wrapper:start', async () => {
  if (wrapperConnection().mode === 'remote') {
    const health = await probeWrapper(wrapperConnection().url);
    return health.ok ? { ok: true } : { ok: false, error: health.error };
  }
  if (loginProc) return { ok: false, error: '请先完成 Apple ID 登录' };
  if (wrapperStartLock) return wrapperStartLock;
  wrapperStartLock = (async () => {
    try {
      return await startWrapperInner();
    } finally {
      wrapperStartLock = null;
    }
  })();
  return wrapperStartLock;
});

async function startWrapperInner() {
  const loggedIn = wrapperLoggedIn();
  if (!loggedIn) return { ok: false, error: '尚未登录 Apple ID，请先在下方完成登录' };
  const existing = await execFileP('docker', ['ps', '--filter', `name=^${WRAPPER_NAME}$`, '--format', '{{.Status}}']);
  if (!existing.ok) return { ok: false, error: existing.stderr || existing.error };
  if (existing.stdout.trim()) {
    const health = await probeWrapper(DEFAULT_URL);
    return health.ok ? { ok: true } : { ok: false, error: health.error };
  }
  await execFileP('docker', ['rm', '-f', WRAPPER_NAME]);
  const r = await execFileP('docker', [
    'run', '-d', '--name', WRAPPER_NAME, '--privileged',
    '-v', `${WRAPPER_DATA}:/app/rootfs/data`,
    '-p', '127.0.0.1:12340:12340',
    '--restart', 'unless-stopped',
    WRAPPER_IMAGE,
  ]);
  if (!r.ok) return { ok: false, error: r.stderr || r.error };
  for (let attempt = 0; attempt < 8; attempt++) {
    const health = await probeWrapper(DEFAULT_URL, 1000);
    if (health.ok) return { ok: true };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const logs = await execFileP('docker', ['logs', '--tail', '10', WRAPPER_NAME]);
  return { ok: false, error: `wrapper-lite HTTP 接口尚未就绪，请查看日志后刷新：\n${(logs.stdout + logs.stderr).trim()}` };
}

ipcMain.handle('wrapper:stop', async () => {
  const denied = localOnly();
  if (denied) return { ok: false, error: denied };
  const r = await execFileP('docker', ['stop', WRAPPER_NAME]);
  return r.ok ? { ok: true } : { ok: false, error: r.stderr || r.error };
});

ipcMain.handle('wrapper:logs', async () => {
  if (wrapperConnection().mode === 'remote') return { ok: true, logs: `远程 wrapper-lite：${wrapperConnection().url}\n请在 1Panel → 容器 → wrapper-lite → 日志中查看运行日志。` };
  const r = await execFileP('docker', ['logs', '--tail', '200', WRAPPER_NAME]);
  return { ok: r.ok, logs: (r.stdout + r.stderr).trim() };
});

// ---------- IPC: login ----------
ipcMain.handle('login:start', async (_e, { username, password }) => {
  const denied = localOnly();
  if (denied) return { ok: false, error: denied };
  if (loginProc) return { ok: false, error: '登录进程已在运行' };
  if (!username || !password) return { ok: false, error: '请输入 Apple ID 和密码' };
  if (username.includes(':')) {
    return { ok: false, error: 'Apple ID 不能包含英文冒号 :' };
  }
  const stopped = await execFileP('docker', ['rm', '-f', WRAPPER_NAME]);
  if (!stopped.ok && !/No such container/i.test(stopped.stderr)) return { ok: false, error: stopped.stderr || stopped.error };
  await execFileP('docker', ['rm', '-f', LOGIN_NAME]);
  fs.mkdirSync(WRAPPER_DATA, { recursive: true });
  try { fs.rmSync(TWOFA_PATH); } catch {}
  const proc = spawn('docker', [
    'run', '--rm', '--privileged', '--name', LOGIN_NAME,
    '-v', `${WRAPPER_DATA}:/app/rootfs/data`,
    '--entrypoint', './wrapper-lite-rootless', WRAPPER_IMAGE,
    '--login', `${username}:${password}`, '--code-from-file', '--base-dir', '/data',
  ]);
  loginProc = proc;
  let buf = '';
  const sent = { tfa: false, ok: false, fail: false };
  const onData = (d) => {
    const chunk = String(d);
    send('login-log', chunk);
    buf = (buf + chunk).slice(-20000);
    if (!sent.tfa && buf.includes('Enter your 2FA code')) { sent.tfa = true; send('login-2fa-required'); }
    if (buf.includes('login complete, exiting')) sent.ok = true;
    if (!sent.fail && (buf.includes('login failed') || buf.includes('auth error') || buf.includes('failed to cache account info') || buf.includes('2FA code timeout'))) { sent.fail = true; send('login-failed'); }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('error', (error) => {
    send('login-log', `\n[启动失败] ${error.message}\n`);
    sent.fail = true;
    send('login-failed');
  });
  proc.on('close', async (code) => {
    if (loginProc !== proc) return;
    loginProc = null;
    send('login-log', `\n[进程退出，代码 ${code}]\n`);
    send('login-exit', code);
    if (code === 0 && sent.ok && !sent.fail && wrapperLoggedIn()) {
      const saved = await saveCurrentAccountProfile();
      if (!saved.ok) send('login-log', `\n[账号备份失败] ${saved.error}\n`);
      send('login-success');
    } else if (!sent.fail) send('login-failed');
  });
  return { ok: true };
});

ipcMain.handle('login:2fa', async (_e, code) => {
  if (wrapperConnection().mode === 'remote' || !loginProc) return { ok: false, error: '当前没有本机登录进程，远程验证码请在 1Panel 服务器提交' };
  const c = String(code || '').trim();
  if (!/^\d{6}$/.test(c)) return { ok: false, error: '请输入 6 位数字验证码' };
  // 数据目录在容器内属 root，直接写会 EACCES，改为在容器里写入
  const containerPath = '/app/rootfs/data/2fa.txt';
  const r = await execFileP('docker', [
    'exec', LOGIN_NAME, 'sh', '-c',
    `printf %s '${c}' > '${containerPath}'`,
  ]);
  if (r.ok) return { ok: true };
  // 兜底：容器可能刚好退出，尝试直接写（目录属主为当前用户时可用）
  try {
    fs.mkdirSync(path.dirname(TWOFA_PATH), { recursive: true });
    fs.writeFileSync(TWOFA_PATH, c);
    return { ok: true };
  } catch {}
  return { ok: false, error: r.stderr || r.error || '写入验证码失败' };
});

ipcMain.handle('login:stop', async () => {
  if (wrapperConnection().mode === 'remote') return { ok: true };
  const proc = loginProc;
  loginProc = null;
  if (proc) { try { proc.kill('SIGTERM'); } catch {} }
  await execFileP('docker', ['rm', '-f', LOGIN_NAME]);
  return { ok: true };
});

// ---------- IPC: browser login for media-user-token ----------
let tokenWin = null;

function saveMediaUserToken(token) {
  const { raw } = readConfigObj();
  const line = `station-token: ${JSON.stringify(token)}`;
  const next = /^station-token:.*$/m.test(raw)
    ? raw.replace(/^station-token:.*$/m, () => line)
    : `${line}\n${raw}`;
  fs.writeFileSync(CONFIG_PATH, next, 'utf8');
}

ipcMain.handle('musictoken:open', async () => {
  if (tokenWin && !tokenWin.isDestroyed()) { tokenWin.focus(); return { ok: true }; }
  tokenWin = new BrowserWindow({
    width: 1100,
    height: 800,
    autoHideMenuBar: true,
    title: '登录 Apple Music',
    webPreferences: { partition: 'persist:apple-music' },
  });
  const ses = tokenWin.webContents.session;
  // Apple 登录页会拒绝 Electron 默认 UA，伪装成标准 Chrome
  ses.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
  tokenWin.loadURL('https://music.apple.com/cn/browse');
  let done = false;
  const finish = (token) => {
    if (done) return;
    done = true;
    clearInterval(timer);
    try { saveMediaUserToken(token); } catch {}
    send('musictoken-saved');
    if (tokenWin && !tokenWin.isDestroyed()) tokenWin.close();
  };
  const timer = setInterval(async () => {
    if (!tokenWin || tokenWin.isDestroyed()) { clearInterval(timer); return; }
    try {
      const cookies = await ses.cookies.get({ name: 'media-user-token' });
      const c = cookies.find((k) => k.value && k.value.length > 50);
      if (c) finish(decodeURIComponent(c.value));
    } catch {}
  }, 2000);
  tokenWin.on('closed', () => { clearInterval(timer); tokenWin = null; if (!done) send('musictoken-cancelled'); });
  return { ok: true };
});

// ---------- IPC: downloads ----------
ipcMain.handle('download:start', async (_e, opts) => {
  const { urls, mode, song, debug, select } = opts;
  if (!fs.existsSync(BINARY)) return { ok: false, error: `下载器不存在: ${BINARY}` };
  if (loginProc || wrapperStartLock) return { ok: false, error: '请等待登录或服务启动完成' };
  const health = await probeWrapper(wrapperConnection().url);
  if (!health.ok) return { ok: false, error: health.error };
  if (!health.regions.length) return { ok: false, error: 'wrapper-lite 尚未登录，请先完成 Apple ID 登录' };
  if (!await whichP('MP4Box')) return { ok: false, error: '本机缺少 MP4Box，无法封装或写入歌曲标签。请安装 GPAC 后重试；远程 wrapper 无需修改。' };
  const args = ['--json'];
  if (mode === 'atmos') args.push('--atmos');
  else if (mode === 'aac') args.push('--aac');
  if (song) args.push('--song');
  if (debug) args.push('--debug');
  if (select) args.push('--select');
  for (const u of urls) args.push(u);

  const id = `t${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const env = mediaToolEnv(REPO_DIR, app.getPath('userData'));
  const proc = spawn(BINARY, args, { cwd: REPO_DIR, env, detached: process.platform !== 'win32', windowsHide: true });
  tasks.set(id, proc);
  let output = '';
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    output = (output + String(d)).slice(-16 * 1024 * 1024);
    send('dl-log', { id, chunk: String(d) });
  });
  proc.stderr.on('data', (d) => send('dl-log', { id, chunk: String(d) }));
  proc.on('close', (code) => {
    tasks.delete(id);
    send('dl-exit', { id, code, downloaded: downloadHistory.receipts(output, opts, REPO_DIR) });
  });
  proc.on('error', (err) => {
    tasks.delete(id);
    send('dl-log', { id, chunk: `\n[启动失败] ${err.message}\n` });
    send('dl-exit', { id, code: -1 });
  });
  return { ok: true, id, cmd: `${BINARY} ${args.join(' ')}` };
});

ipcMain.handle('download:stop', (_e, id) => {
  const p = tasks.get(id);
  if (p) {
    // wake a paused process group first so SIGTERM is delivered
    try { process.kill(-p.pid, 'SIGCONT'); } catch {}
    try { process.kill(-p.pid, 'SIGTERM'); } catch { try { p.kill('SIGTERM'); } catch {} }
    tasks.delete(id);
  }
  return { ok: true };
});

ipcMain.handle('download:pause', (_e, id) => {
  const p = tasks.get(id);
  if (!p) return { ok: false, error: '任务不存在' };
  try { process.kill(-p.pid, 'SIGSTOP'); } catch { try { p.kill('SIGSTOP'); } catch (err) { return { ok: false, error: String(err) }; } }
  return { ok: true };
});

ipcMain.handle('download:resume', (_e, id) => {
  const p = tasks.get(id);
  if (!p) return { ok: false, error: '任务不存在' };
  try { process.kill(-p.pid, 'SIGCONT'); } catch { try { p.kill('SIGCONT'); } catch (err) { return { ok: false, error: String(err) }; } }
  return { ok: true };
});

// ---------- IPC: files ----------
const AUDIO_EXTS = new Set(['.m4a', '.mp4', '.ec3', '.ac3', '.flac', '.mp3', '.opus', '.wav', '.mov', '.m4v']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const IMAGE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function normalizeFileRoots() {
  return downloadRoots().map((r) => ({ name: r.format, format: r.format, path: r.dir }));
}

function resolveBrowserPath(target) {
  const roots = normalizeFileRoots();
  if (!roots.length) return { roots, root: null, dir: null };
  const requested = target && path.isAbsolute(target) ? path.normalize(target) : roots[0].path;
  const root = roots.find((r) => {
    const rel = path.relative(r.path, requested);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }) || roots[0];
  const rel = path.relative(root.path, requested);
  const dir = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)) ? requested : root.path;
  return { roots, root, dir };
}

function pathInsideRoots(target) {
  if (!target || !path.isAbsolute(target)) return false;
  const requested = path.normalize(target);
  return normalizeFileRoots().some((r) => {
    const rel = path.relative(r.path, requested);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

function findCoverImage(filePath) {
  const dir = path.dirname(filePath);
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  const images = entries
    .filter((e) => e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name);
  if (!images.length) return null;
  const preferred = images.find((name) => /^cover\./i.test(name))
    || images.find((name) => /^(folder|front|artwork|album)\./i.test(name))
    || images[0];
  return path.join(dir, preferred);
}

function thumbnailPathFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return filePath;
  if (AUDIO_EXTS.has(ext)) return findCoverImage(filePath);
  return null;
}

function uniqueDestination(destDir, name) {
  const parsed = path.parse(name);
  let dest = path.join(destDir, name);
  let i = 2;
  while (fs.existsSync(dest)) {
    dest = path.join(destDir, `${parsed.name} 副本${i === 2 ? '' : ` ${i}`}${parsed.ext}`);
    i += 1;
  }
  return dest;
}

function copyRecursive(src, dest) {
  if (fs.cpSync) fs.cpSync(src, dest, { recursive: true, errorOnExist: true });
  else {
    const st = fs.statSync(src);
    if (st.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      for (const name of fs.readdirSync(src)) copyRecursive(path.join(src, name), path.join(dest, name));
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

function recycleRoot() {
  return path.join(app.getPath('userData'), 'recycle-bin');
}

function recycleFilesDir() {
  return path.join(recycleRoot(), 'files');
}

function recycleIndexPath() {
  return path.join(recycleRoot(), 'index.json');
}

function readRecycleIndex() {
  try {
    const data = JSON.parse(fs.readFileSync(recycleIndexPath(), 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeRecycleIndex(items) {
  fs.mkdirSync(recycleRoot(), { recursive: true });
  fs.writeFileSync(recycleIndexPath(), JSON.stringify(items, null, 2), 'utf8');
}

function movePath(src, dest) {
  try { fs.renameSync(src, dest); }
  catch {
    copyRecursive(src, dest);
    fs.rmSync(src, { recursive: true, force: true });
  }
}

function recycleItemFor(target) {
  const st = fs.statSync(target);
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const name = path.basename(target);
  const trashPath = uniqueDestination(recycleFilesDir(), `${id}-${name}`);
  return {
    id,
    name,
    originalPath: target,
    trashPath,
    type: st.isDirectory() ? 'folder' : 'file',
    size: st.isDirectory() ? null : st.size,
    deletedAt: Date.now(),
  };
}

function walkAudio(dir, format, out, depth) {
  if (depth > 6) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkAudio(p, format, out, depth + 1);
    else if (AUDIO_EXTS.has(path.extname(e.name).toLowerCase())) {
      try {
        const st = fs.statSync(p);
        out.push({ name: e.name, path: p, size: st.size, mtime: st.mtimeMs, format });
      } catch {}
    }
  }
}

ipcMain.handle('files:list', () => {
  const out = [];
  for (const { dir, format } of downloadRoots()) walkAudio(dir, format, out, 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
});

ipcMain.handle('files:roots', () => normalizeFileRoots());

ipcMain.handle('download:reconcile', (_e, items, histories) => {
  const recycle = readRecycleIndex();
  const inventory = [];
  if (items.some((item) => !Array.isArray(item.files))) {
    const modeFor = (format) => format === 'ALAC' ? 'alac' : format === 'AAC' ? 'aac' : 'atmos';
    for (const root of downloadRoots()) {
      const found = [];
      walkAudio(root.dir, root.format, found, 0);
      inventory.push(...found.map((f) => ({ path: f.path, mode: modeFor(root.format) })));
    }
    for (const item of recycle) {
      const root = downloadRoots().find((r) => downloadHistory.inside(r.dir, item.originalPath));
      if (!root) continue;
      if (item.type === 'file') {
        if (AUDIO_EXTS.has(path.extname(item.originalPath).toLowerCase())) inventory.push({ path: item.originalPath, mode: modeFor(root.format) });
      } else {
        const found = [];
        walkAudio(item.trashPath, root.format, found, 0);
        inventory.push(...found.map((f) => ({ path: path.join(item.originalPath, path.relative(item.trashPath, f.path)), mode: modeFor(root.format) })));
      }
    }
  }
  return downloadHistory.reconcile(items, recycle, inventory, histories);
});

ipcMain.handle('files:readDir', (_e, target) => {
  const { roots, root, dir } = resolveBrowserPath(target);
  if (!root || !dir) return { ok: true, roots, root: null, path: '', parent: null, entries: [] };
  const relToRoot = path.relative(root.path, dir);
  const parent = relToRoot ? path.dirname(dir) : null;
  let entries = [];
  try {
    fs.mkdirSync(root.path, { recursive: true });
    entries = fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      try {
        const p = path.join(dir, e.name);
        const st = fs.statSync(p);
        const ext = e.isDirectory() ? '' : path.extname(e.name).toLowerCase();
        const isFile = e.isFile();
        return [{
          name: e.name,
          path: p,
          type: e.isDirectory() ? 'folder' : 'file',
          size: e.isDirectory() ? null : st.size,
          mtime: st.mtimeMs,
          ext,
          format: root.format,
          playable: isFile && AUDIO_EXTS.has(ext),
          image: isFile && IMAGE_EXTS.has(ext),
          thumbnailable: isFile && (AUDIO_EXTS.has(ext) || IMAGE_EXTS.has(ext)),
        }];
      } catch {
        return [];
      }
    });
  } catch (err) {
    return { ok: false, error: String(err.message || err), roots, root, path: dir, parent, entries: [] };
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  });
  return { ok: true, roots, root, path: dir, parent, entries };
});

ipcMain.handle('files:thumbnail', (_e, target) => {
  if (!pathInsideRoots(target)) return { ok: false, error: '文件不在下载目录内' };
  const img = thumbnailPathFor(target);
  if (!img || !pathInsideRoots(img)) return { ok: true, dataUrl: null };
  try {
    const st = fs.statSync(img);
    if (!st.isFile() || st.size > 12 * 1024 * 1024) return { ok: true, dataUrl: null };
    const ext = path.extname(img).toLowerCase();
    const mime = IMAGE_MIME[ext] || 'application/octet-stream';
    const data = fs.readFileSync(img).toString('base64');
    return { ok: true, dataUrl: `data:${mime};base64,${data}` };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('files:open', (_e, p) => { shell.openPath(p); });
ipcMain.handle('files:reveal', (_e, p) => { shell.showItemInFolder(p); });
ipcMain.handle('files:delete', (_e, target) => {
  if (!pathInsideRoots(target)) return { ok: false, error: '文件不在下载目录内' };
  try {
    fs.mkdirSync(recycleFilesDir(), { recursive: true });
    const item = recycleItemFor(target);
    movePath(target, item.trashPath);
    const items = readRecycleIndex();
    items.unshift(item);
    writeRecycleIndex(items);
    send('library-changed', {});
    return { ok: true, item };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
ipcMain.handle('files:copy', (_e, target, destDir) => {
  if (!pathInsideRoots(target)) return { ok: false, error: '文件不在下载目录内' };
  if (!destDir || !path.isAbsolute(destDir)) return { ok: false, error: '请选择目标文件夹' };
  try {
    fs.mkdirSync(destDir, { recursive: true });
    const dest = uniqueDestination(destDir, path.basename(target));
    copyRecursive(target, dest);
    send('library-changed', { kind: 'copy', from: target, to: dest });
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
ipcMain.handle('files:move', (_e, target, destDir) => {
  if (!pathInsideRoots(target)) return { ok: false, error: '文件不在下载目录内' };
  if (!destDir || !path.isAbsolute(destDir)) return { ok: false, error: '请选择目标文件夹' };
  try {
    fs.mkdirSync(destDir, { recursive: true });
    const dest = uniqueDestination(destDir, path.basename(target));
    try { fs.renameSync(target, dest); }
    catch {
      copyRecursive(target, dest);
      fs.rmSync(target, { recursive: true, force: true });
    }
    send('library-changed', { kind: 'move', from: target, to: dest });
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});
ipcMain.handle('files:openFolder', (_e, format) => {
  const root = downloadRoots().find((r) => r.format === format) || downloadRoots()[0];
  if (root) { fs.mkdirSync(root.dir, { recursive: true }); shell.openPath(root.dir); }
});

ipcMain.handle('recycle:list', () => {
  const items = readRecycleIndex().filter((item) => {
    try { return fs.existsSync(item.trashPath); } catch { return false; }
  });
  writeRecycleIndex(items);
  return items;
});

ipcMain.handle('recycle:restore', (_e, id) => {
  const items = readRecycleIndex();
  const item = items.find((x) => x.id === id);
  if (!item) return { ok: false, error: '回收站项目不存在' };
  try {
    const parent = path.dirname(item.originalPath);
    fs.mkdirSync(parent, { recursive: true });
    const dest = fs.existsSync(item.originalPath) ? uniqueDestination(parent, item.name) : item.originalPath;
    movePath(item.trashPath, dest);
    writeRecycleIndex(items.filter((x) => x.id !== id));
    send('library-changed', { kind: 'move', from: item.originalPath, to: dest });
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('recycle:purge', (_e, id) => {
  const items = readRecycleIndex();
  const item = items.find((x) => x.id === id);
  if (!item) return { ok: false, error: '回收站项目不存在' };
  try {
    fs.rmSync(item.trashPath, { recursive: true, force: true });
    writeRecycleIndex(items.filter((x) => x.id !== id));
    send('library-changed', {});
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('recycle:empty', () => {
  const items = readRecycleIndex();
  try {
    for (const item of items) fs.rmSync(item.trashPath, { recursive: true, force: true });
    writeRecycleIndex([]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    send('library-changed', {});
  }
});

// ---------- IPC: config ----------
ipcMain.handle('dialog:pickFolder', async (_e, current) => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择保存目录',
    defaultPath: current && path.isAbsolute(current) ? current : REPO_DIR,
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled || !r.filePaths[0] ? { ok: false } : { ok: true, path: r.filePaths[0] };
});

ipcMain.handle('dialog:pickFile', async (_e, current) => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择文件',
    defaultPath: current && path.isAbsolute(current) ? current : os.homedir(),
    properties: ['openFile'],
  });
  return r.canceled || !r.filePaths[0] ? { ok: false } : { ok: true, path: r.filePaths[0] };
});

ipcMain.handle('config:read', () => {
  const { raw } = readConfigObj();
  return { ok: true, raw, path: CONFIG_PATH };
});

ipcMain.handle('config:write', (_e, raw) => {
  try {
    if (tasks.size || loginProc || wrapperStartLock) throw new Error('请先结束下载、登录或服务启动，再修改配置');
    const migrated = migrateConfig(raw);
    const connection = connectionSettings(yaml.load(migrated) || {});
    if (connection.mode === 'local' && connection.url !== DEFAULT_URL) throw new Error('自定义服务地址需要选择远程服务模式');
    fs.writeFileSync(CONFIG_PATH, migrated, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// ---------- IPC: 系统提权认证（解锁原始 YAML 前的身份确认） ----------
ipcMain.handle('auth:elevate', async () => {
  const timeout = 120000; // 给用户足够时间输密码
  if (process.platform === 'linux') {
    if (!(await whichP('pkexec'))) return { ok: false, error: '未找到 pkexec，无法弹出系统认证框' };
    const r = await execFileP('pkexec', ['--disable-internal-agent', '/bin/true'], { timeout });
    if (r.ok) return { ok: true };
    const cancelled = /dismissed|cancelled|126|127/i.test(r.error + r.stderr);
    return { ok: false, error: cancelled ? '认证已取消' : '认证失败' };
  }
  if (process.platform === 'darwin') {
    const r = await execFileP('osascript', ['-e', 'do shell script "/bin/true" with administrator privileges'], { timeout });
    return r.ok ? { ok: true } : { ok: false, error: '认证已取消或失败' };
  }
  if (process.platform === 'win32') {
    const r = await execFileP('powershell', [
      '-NoProfile', '-Command',
      "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','exit' -Verb RunAs -Wait -WindowStyle Hidden",
    ], { timeout });
    return r.ok ? { ok: true } : { ok: false, error: 'UAC 已取消或失败' };
  }
  return { ok: false, error: '当前平台不支持提权认证' };
});
