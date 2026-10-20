// Run with Vite on port 5173. Uses an isolated config and a local fake HTTP service.
const { _electron } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '..');

(async () => {
  let state = 'ready';
  const server = http.createServer((req, res) => {
    if (!['/status', '/proxy/status'].includes(req.url)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'application/json');
    if (state === 'failed') { res.writeHead(503); res.end('{}'); return; }
    res.end(JSON.stringify({ code: 0, data: { regions: state === 'ready' ? ['cn'] : [] } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'am-wrapper-lite-ui-'));
  const url = `http://127.0.0.1:${server.address().port}`;
  const configPath = path.join(repo, 'config.yaml');
  const config = yaml.load(fs.readFileSync(path.join(root, 'build-res/repo/config.yaml'), 'utf8'));
  config['wrapper-mode'] = 'remote';
  config['wrapper-lite-url'] = url;
  fs.writeFileSync(configPath, yaml.dump(config));
  const binaryName = process.platform === 'win32' ? 'apple-music-dl.exe' : 'apple-music-dl';
  fs.copyFileSync(path.join(root, 'build-res/repo', binaryName), path.join(repo, binaryName));
  const libraryName = process.platform === 'win32' ? 'temari.dll' : 'libtemari.so';
  fs.copyFileSync(path.join(root, 'build-res/repo', libraryName), path.join(repo, libraryName));
  const native = require('node:child_process').execFileSync(path.join(repo, binaryName), ['--self-test'], { cwd: repo, encoding: 'utf8', windowsHide: true });
  assert.match(native, /wrapper-lite \+ Temari ready/);
  const env = { ...process.env, AM_DL_REPO: repo, VITE_DEV_SERVER_URL: 'http://localhost:5173' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ args: ['.', '--no-sandbox'], cwd: root, env });
    const win = await app.firstWindow();
    const errors = [];
    win.on('pageerror', (error) => errors.push(error.message));
    await win.getByRole('button', { name: '解密服务', exact: true }).click();
    await win.getByRole('heading', { name: '服务已就绪', exact: true }).waitFor();
    let status = await win.evaluate(() => window.api.getStatus());
    assert.equal(status.wrapperApi, true);
    assert.equal(status.loggedIn, true);
    assert.equal(status.downloader, true);
    assert.deepEqual(status.wrapperRegions, ['cn']);
    assert.equal(await win.getByPlaceholder('Apple ID 邮箱').count(), 0);
    assert.equal(await win.getByRole('button', { name: '停止服务', exact: true }).count(), 0);

    await win.getByRole('textbox', { name: 'wrapper-lite 地址' }).fill(`${url}/proxy/`);
    await win.getByRole('button', { name: '保存并检查连接', exact: true }).click();
    await win.getByText('连接已保存，wrapper-lite 接口正常', { exact: true }).waitFor();
    assert.equal(yaml.load(fs.readFileSync(configPath, 'utf8'))['wrapper-lite-url'], `${url}/proxy`);
    assert.equal((await win.evaluate(() => window.api.wrapperStop())).ok, false);
    assert.equal((await win.evaluate(() => window.api.loginStart('test@example.com', 'not-a-real-password'))).ok, false);
    assert.equal((await win.evaluate(() => window.api.switchAccount('other'))).ok, false);

    state = 'not-logged-in';
    status = await win.evaluate(() => window.api.getStatus());
    assert.equal(status.wrapperApi, true);
    assert.equal(status.loggedIn, false);
    const attempt = { urls: ['https://music.apple.com/cn/song/123'], mode: 'atmos', song: true, debug: false, select: false };
    const unsigned = await win.evaluate((opts) => window.api.downloadStart(opts), attempt);
    assert.equal(unsigned.ok, false);
    assert.match(unsigned.error, /尚未登录/);
    state = 'failed';
    const unavailable = await win.evaluate((opts) => window.api.downloadStart(opts), attempt);
    assert.equal(unavailable.ok, false);
    assert.match(unavailable.error, /503/);
    state = 'ready';
    await win.getByRole('button', { name: '刷新状态', exact: true }).click();
    await win.getByRole('heading', { name: '服务已就绪', exact: true }).waitFor();
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    await win.screenshot({ path: path.join(root, 'test-results/wrapper-lite-service.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await app.close();
    app = await _electron.launch({ args: ['.', '--no-sandbox'], cwd: root, env });
    const second = await app.firstWindow();
    await second.waitForFunction(() => Boolean(window.api));
    status = await second.evaluate(() => window.api.getStatus());
    assert.equal(status.wrapperUrl, `${url}/proxy`);
    assert.equal(status.wrapperApi, true);
    console.log('PASS: Electron startup, remote HTTP connection, settings persistence, remote management guards, and failed/unsigned download rejection');
  } finally {
    if (app) await app.close();
    server.closeAllConnections();
    server.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
