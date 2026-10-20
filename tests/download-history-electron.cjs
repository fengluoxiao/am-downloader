// Real renderer + IPC + filesystem, with isolated user data and a fake catalog/downloader.
const { _electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const history = require('../electron/download-history.cjs');
const root = path.resolve(__dirname, '..');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'am-history-ui-'));
  const repo = path.join(temp, 'repo');
  const dir = path.join(repo, 'Atmos', 'Fixture Album');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(repo, 'config.yaml'), 'atmos-save-folder: Atmos\nalac-save-folder: ALAC\naac-save-folder: AAC\nwrapper-mode: remote\nwrapper-lite-url: http://127.0.0.1:1\n');
  const album = 'https://music.apple.com/cn/album/fixture/900';
  const tracks = [1, 2, 3].map((id) => ({ id: String(id), name: `Fixture Track ${id}`, url: `${album}?i=${id}`, supportsDolbyAtmos: true, audioTraitsTrack: ['atmos'] }));
  const catalog = [{ id: '900', name: 'Fixture Album', type: 'album', url: album, trackCount: 3, audioTraits: ['atmos'], supportsDolbyAtmos: true, tracksDetails: tracks },
    ...tracks.map((t) => ({ ...t, type: 'song', url: `https://music.apple.com/us/song/alias/${t.id}`, audioTraits: ['atmos'] }))];
  const files = tracks.map((t) => path.join(dir, `${t.id}. ${t.name}.m4a`));
  files.slice(0, 2).forEach((f) => fs.writeFileSync(f, 'fixture audio'));
  const records = tracks.slice(0, 2).map((t, i) => ({ url: t.url, mode: 'atmos', song: true, title: t.name, finishedAt: 1, files: [files[i]] }));
  const launcher = path.join(temp, 'launch.cjs');
  fs.writeFileSync(launcher, `
const { app, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(temp, 'user-data'))});
require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});
globalThis.historyRequests = [];
ipcMain.removeHandler('search:run');
ipcMain.handle('search:run', () => ({ ok: true, results: ${JSON.stringify(catalog)} }));
ipcMain.removeHandler('download:start');
ipcMain.handle('download:start', (_e, opts) => {
  const id = 'fixture-' + (globalThis.historyRequests.length + 1);
  globalThis.historyRequests.push({ id, opts });
  return { ok: true, id, cmd: 'fixture downloader --json' };
});
`);
  const env = { ...process.env, AM_DL_REPO: repo };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  let app;
  try {
    app = await _electron.launch({ args: [launcher, '--no-sandbox'], cwd: root, env });
    const win = await app.firstWindow();
    const errors = [];
    win.on('pageerror', (e) => errors.push(e.message));
    await win.waitForFunction(() => !!window.api);
    const historicalTask = { id: 'old-success', url: album, mode: 'atmos', song: false, title: 'Album success', status: 'success', log: '', createdAt: 1, progress: 100 };
    await win.addInitScript(({ records, historicalTask }) => {
      if (sessionStorage.getItem('history-fixture-seeded')) return;
      localStorage.setItem('am-downloaded-items-v2', JSON.stringify(records));
      localStorage.setItem('am-download-tasks-v1', JSON.stringify([historicalTask]));
      localStorage.setItem('am-download-concurrency', '3');
      sessionStorage.setItem('history-fixture-seeded', '1');
    }, { records, historicalTask });
    await win.reload();
    const search = async () => {
      await win.getByPlaceholder('搜索歌曲 / 专辑 / 合集 / 艺人', { exact: true }).fill('fixture');
      await win.locator('.search-input-wrap').getByRole('button', { name: '搜索', exact: true }).click();
      await win.locator('.search-card').last().waitFor();
    };
    const card = (name) => win.locator('.search-card').filter({ has: win.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
    const state = async (name, downloaded) => {
      try {
        await card(name).getByRole('button', { name: downloaded ? '已下载' : '下载', exact: true }).waitFor();
      } catch (error) {
        console.error(await win.evaluate(() => ({ records: localStorage.getItem('am-downloaded-items-v2'), cards: [...document.querySelectorAll('.search-card')].map((c) => c.textContent) })));
        throw error;
      }
      assert.equal(await card(name).getByRole('button', { name: downloaded ? '已下载' : '下载', exact: true }).isDisabled(), downloaded);
    };
    await search();
    await state('Fixture Album', false);
    await state('Fixture Track 1', true);
    await state('Fixture Track 2', true);
    await state('Fixture Track 3', false);

    const deleted = await win.evaluate((file) => window.api.deletePath(file), files[0]);
    assert.equal(deleted.ok, true);
    await state('Fixture Track 1', true);
    // Restore uses the real IPC handler and keeps the downloaded state.
    assert.equal((await win.evaluate((id) => window.api.recycleRestore(id), deleted.item.id)).ok, true);
    await state('Fixture Track 1', true);
    const again = await win.evaluate((file) => window.api.deletePath(file), files[0]);
    assert.equal((await win.evaluate((id) => window.api.recyclePurge(id), again.item.id)).ok, true);
    await state('Fixture Track 1', false);
    await state('Fixture Track 2', true);
    await win.reload();
    await search();
    await state('Fixture Track 1', false);
    await state('Fixture Track 2', true);

    const finish = async (r) => {
      const id = new URL(r.opts.urls[0]).searchParams.get('i');
      const file = files[Number(id) - 1];
      fs.writeFileSync(file, 'downloaded fixture');
      const downloaded = history.receipts(`Completed: 1/1\n${JSON.stringify([{ path: file, track_id: id, song: `Fixture Track ${id}` }])}`, r.opts, repo);
      await app.evaluate(({ BrowserWindow }, data) => BrowserWindow.getAllWindows()[0].webContents.send('dl-exit', data), { id: r.id, code: 0, downloaded });
    };
    // Pick one song inside the album: the other missing song stays available.
    await card('Fixture Album').getByRole('button', { name: '曲目 (3)', exact: true }).click();
    await win.locator('.search-track-row').filter({ hasText: 'Fixture Track 3' }).getByRole('button').click();
    await win.locator('.ui-dialog-foot').getByRole('button', { name: '关闭', exact: true }).click();
    await win.waitForFunction(() => JSON.parse(localStorage.getItem('am-download-tasks-v1')).some((t) => t.status === 'running'));
    let requests = await app.evaluate(() => globalThis.historyRequests);
    assert.equal(requests.length, 1);
    assert.equal(new URL(requests[0].opts.urls[0]).searchParams.get('i'), '3');
    await finish(requests[0]);
    await state('Fixture Track 3', true);
    await state('Fixture Album', false);
    await state('Fixture Track 1', false);

    // Clicking the album now queues only the remaining missing member.
    await card('Fixture Album').getByRole('button', { name: '下载', exact: true }).click();
    await win.waitForFunction(() => JSON.parse(localStorage.getItem('am-download-tasks-v1')).some((t) => t.status === 'running'));
    requests = await app.evaluate(() => globalThis.historyRequests);
    assert.equal(requests.length, 2);
    assert.equal(new URL(requests[1].opts.urls[0]).searchParams.get('i'), '1');
    await finish(requests[1]);
    await state('Fixture Album', true);
    await state('Fixture Track 1', true);
    await state('Fixture Track 3', true);

    // An individual purge makes the album incomplete without clearing the other songs.
    const second = await win.evaluate((file) => window.api.deletePath(file), files[1]);
    await state('Fixture Album', true);
    await win.evaluate((id) => window.api.recyclePurge(id), second.item.id);
    await state('Fixture Album', false);
    await state('Fixture Track 2', false);
    await state('Fixture Track 1', true);
    await win.evaluate((dir) => window.api.deletePath(dir), dir);
    await state('Fixture Track 1', true);
    assert.equal((await win.evaluate(() => window.api.recycleEmpty())).ok, true);
    for (const t of tracks) await state(t.name, false);
    await win.reload();
    await search();
    for (const t of tracks) await state(t.name, false);
    const saved = await win.evaluate(() => JSON.parse(localStorage.getItem('am-downloaded-items-v2')));
    assert.deepEqual(saved, []);
    assert.deepEqual(errors, []);
    console.log('PASS: Electron album subset, URL aliases, restore, purge, album completion, empty trash, and persisted deletion without resurrecting successful tasks');
  } finally {
    if (app) await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
