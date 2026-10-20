// Uses a private config/user-data folder. Never writes to the real Y: drive or NAS.
const { _electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '..');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'am-paths-ui-'));
  const repo = path.join(temp, 'repo');
  fs.mkdirSync(repo);
  const configPath = path.join(repo, 'config.yaml');
  const mapped = String.raw`Y:\music\dolbyatmos`;
  const original = `alac-save-folder: Local\natmos-save-folder: "${mapped}" # NAS music\naac-save-folder: AAC\nmv-save-folder: MV\nwrapper-mode: remote\nwrapper-lite-url: http://127.0.0.1:1\n`;
  fs.writeFileSync(configPath, original);
  const launcher = path.join(temp, 'launch.cjs');
  fs.writeFileSync(launcher, `
const { app, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(temp, 'user-data'))});
require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});
ipcMain.removeHandler('dialog:pickFolder');
ipcMain.handle('dialog:pickFolder', () => ({ ok: true, path: ${JSON.stringify(mapped)} }));
`);
  const env = { ...process.env, AM_DL_REPO: repo };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  let app;
  const launch = async () => {
    app = await _electron.launch({ args: [launcher, '--no-sandbox'], cwd: root, env });
    const win = await app.firstWindow();
    await win.getByRole('button', { name: '设置', exact: true }).click();
    return win;
  };
  try {
    let win = await launch();
    const errors = [];
    win.on('pageerror', (e) => errors.push(e.message));
    assert.equal(yaml.load(fs.readFileSync(configPath, 'utf8'))['atmos-save-folder'], mapped);
    assert.equal(fs.readFileSync(configPath + '.pre-wrapper-lite.bak', 'utf8'), original);
    const field = () => win.getByRole('textbox', { name: '全景声保存目录', exact: true });
    assert.equal(await field().inputValue(), mapped, 'startup repairs old invalid YAML');

    // Manual input supports Chinese, spaces and UNC shares.
    const share = String.raw`\\NAS\Media Share\音乐\Dolby Atmos`;
    await field().fill(share);
    await win.getByRole('button', { name: '保存', exact: true }).click();
    await win.getByText('配置已保存', { exact: true }).waitFor();
    assert.equal(yaml.load(fs.readFileSync(configPath, 'utf8'))['atmos-save-folder'], share);
    await win.getByRole('button', { name: '重新加载', exact: true }).click();
    assert.equal(await field().inputValue(), share, 'reload does not double backslashes');

    // The folder picker takes the same serialization path as typed input.
    await field().locator('..').getByRole('button', { name: '选择', exact: true }).click();
    assert.equal(await field().inputValue(), mapped);
    await win.getByRole('button', { name: '保存', exact: true }).click();
    await win.waitForFunction((mapped) => document.querySelector('input[aria-label="全景声保存目录"]').value === mapped, mapped);
    const onDisk = yaml.load(fs.readFileSync(configPath, 'utf8'));
    assert.equal(onDisk['atmos-save-folder'], mapped);
    assert.ok(fs.readFileSync(configPath, 'utf8').includes('# NAS music'));

    await app.close();
    app = null;
    win = await launch();
    assert.equal(await field().inputValue(), mapped, 'restart keeps the exact drive path');
    await win.getByRole('button', { name: '保存', exact: true }).click();
    await win.getByText('配置已保存', { exact: true }).waitFor();
    assert.equal(yaml.load(fs.readFileSync(configPath, 'utf8'))['atmos-save-folder'], mapped);
    assert.deepEqual(errors, []);
    console.log('PASS: Electron repairs the reported YAML, preserves backup, accepts typed UNC paths, saves folder-picker drive paths, reloads and restarts without changing backslashes');
  } finally {
    if (app) await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
