const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getStatus: () => ipcRenderer.invoke('status:get'),
  switchAccount: (id) => ipcRenderer.invoke('account:switch', id),
  createAccount: (profile) => ipcRenderer.invoke('account:create', profile),
  deleteAccount: (id) => ipcRenderer.invoke('account:delete', id),

  wrapperStart: () => ipcRenderer.invoke('wrapper:start'),
  wrapperStop: () => ipcRenderer.invoke('wrapper:stop'),
  wrapperLogs: () => ipcRenderer.invoke('wrapper:logs'),
  wrapperConfigure: (settings) => ipcRenderer.invoke('wrapper:configure', settings),

  loginStart: (username, password) => ipcRenderer.invoke('login:start', { username, password }),
  login2fa: (code) => ipcRenderer.invoke('login:2fa', code),
  loginStop: () => ipcRenderer.invoke('login:stop'),
  onLoginLog: (cb) => {
    const fn = (_e, chunk) => cb(chunk);
    ipcRenderer.on('login-log', fn);
    return () => ipcRenderer.removeListener('login-log', fn);
  },
  onLoginExit: (cb) => {
    const fn = (_e, code) => cb(code);
    ipcRenderer.on('login-exit', fn);
    return () => ipcRenderer.removeListener('login-exit', fn);
  },
  onLogin2faRequired: (cb) => {
    const fn = () => cb();
    ipcRenderer.on('login-2fa-required', fn);
    return () => ipcRenderer.removeListener('login-2fa-required', fn);
  },
  onLoginSuccess: (cb) => {
    const fn = () => cb();
    ipcRenderer.on('login-success', fn);
    return () => ipcRenderer.removeListener('login-success', fn);
  },
  onLoginFailed: (cb) => {
    const fn = () => cb();
    ipcRenderer.on('login-failed', fn);
    return () => ipcRenderer.removeListener('login-failed', fn);
  },

  openMusicLogin: () => ipcRenderer.invoke('musictoken:open'),
  onMusicTokenSaved: (cb) => {
    const fn = () => cb();
    ipcRenderer.on('musictoken-saved', fn);
    return () => ipcRenderer.removeListener('musictoken-saved', fn);
  },
  onMusicTokenCancelled: (cb) => {
    const fn = () => cb();
    ipcRenderer.on('musictoken-cancelled', fn);
    return () => ipcRenderer.removeListener('musictoken-cancelled', fn);
  },

  downloadStart: (opts) => ipcRenderer.invoke('download:start', opts),
  downloadStop: (id) => ipcRenderer.invoke('download:stop', id),
  downloadPause: (id) => ipcRenderer.invoke('download:pause', id),
  downloadResume: (id) => ipcRenderer.invoke('download:resume', id),
  reconcileDownloaded: (items, histories) => ipcRenderer.invoke('download:reconcile', items, histories),
  onLibraryChanged: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('library-changed', fn);
    return () => ipcRenderer.removeListener('library-changed', fn);
  },
  onDlLog: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('dl-log', fn);
    return () => ipcRenderer.removeListener('dl-log', fn);
  },
  onDlExit: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('dl-exit', fn);
    return () => ipcRenderer.removeListener('dl-exit', fn);
  },

  listFiles: () => ipcRenderer.invoke('files:list'),
  fileRoots: () => ipcRenderer.invoke('files:roots'),
  readDir: (p) => ipcRenderer.invoke('files:readDir', p),
  thumbnail: (p) => ipcRenderer.invoke('files:thumbnail', p),
  openFile: (p) => ipcRenderer.invoke('files:open', p),
  revealFile: (p) => ipcRenderer.invoke('files:reveal', p),
  deletePath: (p) => ipcRenderer.invoke('files:delete', p),
  copyPath: (p, destDir) => ipcRenderer.invoke('files:copy', p, destDir),
  movePath: (p, destDir) => ipcRenderer.invoke('files:move', p, destDir),
  openFolder: (format) => ipcRenderer.invoke('files:openFolder', format),

  recycleList: () => ipcRenderer.invoke('recycle:list'),
  recycleRestore: (id) => ipcRenderer.invoke('recycle:restore', id),
  recyclePurge: (id) => ipcRenderer.invoke('recycle:purge', id),
  recycleEmpty: () => ipcRenderer.invoke('recycle:empty'),

  readConfig: () => ipcRenderer.invoke('config:read'),
  writeConfig: (raw) => ipcRenderer.invoke('config:write', raw),
  elevateAuth: () => ipcRenderer.invoke('auth:elevate'),
  pickFolder: (current) => ipcRenderer.invoke('dialog:pickFolder', current),
  pickFile: (current) => ipcRenderer.invoke('dialog:pickFile', current),

  search: (opts) => ipcRenderer.invoke('search:run', opts),
  searchCancel: (requestId) => ipcRenderer.send('search:cancel', requestId),
  onSearchUpdate: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('search:update', fn);
    return () => ipcRenderer.removeListener('search:update', fn);
  },
});
