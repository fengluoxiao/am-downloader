// Real search IPC and renderer with controlled search timing; no Apple account/network needed.
const { _electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'am-search-ui-'));
  const repo = path.join(temp, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'config.yaml'), 'atmos-save-folder: Atmos\nalac-save-folder: ALAC\naac-save-folder: AAC\nwrapper-mode: remote\nwrapper-lite-url: http://127.0.0.1:1\n');
  const launcher = path.join(temp, 'launch.cjs');
  fs.writeFileSync(launcher, `
const { app, ipcMain } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(temp, 'user-data'))});
const info = require(${JSON.stringify(path.join(root, 'electron/getinfo.js'))});
const playwright = require(${JSON.stringify(path.join(root, 'node_modules/playwright'))});
const page = () => ({ isClosed: () => false, context: () => context, closed: false, async close() { this.closed = true; } });
const context = { newPage: async () => page() };
playwright.chromium.launch = async () => ({ newContext: async () => context, close: async () => {} });
globalThis.searchFixtures = [];
info.findAppleMusicInfo = async (page, term, store, type, filter, offset, updates) => {
  const atmos = updates.mode === 'atmos';
  const item = (n) => ({ id: term + '-' + n, type: 'album', name: term + ' album ' + n, artistName: 'Fixture',
    audioTraits: atmos ? ['atmos'] : ['lossless'], supportsDolbyAtmos: atmos, trackCount: 1, url: 'https://music.apple.com/cn/album/fixture/' + n,
    tracksDetails: [{ id: 'song' + n, name: term + ' track ' + n, url: 'https://music.apple.com/cn/song/' + n, audioTraitsTrack: atmos ? ['atmos'] : ['lossless'], supportsDolbyAtmos: atmos }] });
  const first = item(1), second = item(2);
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  const run = { term, mode: updates.mode, updates, first, second, resolve, page, completed: false };
  globalThis.searchFixtures.push(run);
  updates.onResult(first);
  updates.onProgress({ checked: 1, total: 3 });
  await done;
  run.completed = true;
  if (term === 'failure') throw new Error('fixture later request failed');
  updates.onResult(second);
  updates.onProgress({ checked: 3, total: 3 });
  return { results: [first, second], pagination: { offset, pageSize: 10, checked: 3, total: 3, hasMore: false } };
};
require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});
globalThis.downloadFixtures = [];
ipcMain.removeHandler('download:start');
ipcMain.handle('download:start', (_e, opts) => {
  globalThis.downloadFixtures.push(opts);
  return { ok: true, id: 'fixture-' + globalThis.downloadFixtures.length, cmd: 'fixture' };
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
    const input = win.getByPlaceholder('搜索歌曲 / 专辑 / 合集 / 艺人', { exact: true });
    const searchButton = win.locator('.search-input-wrap').getByRole('button', { name: '搜索', exact: true });
    const firstCard = (term) => win.locator('.search-card').filter({ hasText: `${term} album 1` });
    const start = async (term, enter = false) => {
      await input.fill(term);
      if (enter) await input.press('Enter'); else await searchButton.click();
      await firstCard(term).waitFor();
    };
    const finish = (term) => app.evaluate((_electron, term) => globalThis.searchFixtures.find((r) => r.term === term).resolve(), term);
    await start('partial');
    assert.equal(await win.locator('.search-skeleton').count(), 0);
    assert.equal(await searchButton.isDisabled(), true);
    assert.equal(await firstCard('partial').getByRole('button', { name: '下载', exact: true }).isEnabled(), true);
    assert.match(await win.getByRole('status').textContent(), /已找到 1 条/);
    assert.equal(await app.evaluate(() => globalThis.searchFixtures[0].completed), false, 'page renders before the search promise resolves');
    await firstCard('partial').getByRole('button', { name: '曲目 (1)', exact: true }).click();
    await win.getByRole('dialog').getByText('partial track 1', { exact: true }).waitFor();
    await win.locator('.ui-dialog-foot').getByRole('button', { name: '关闭', exact: true }).click();
    await app.evaluate(() => { const run = globalThis.searchFixtures[0]; run.updates.onResult(run.first); });
    assert.equal(await win.locator('.search-card').count(), 1, 'duplicate streaming events do not duplicate cards');
    await finish('partial');
    await win.locator('.search-card').filter({ hasText: 'partial album 2' }).waitFor();
    await win.waitForFunction(() => !document.querySelector('.search-input-wrap button').disabled);
    assert.equal(await win.locator('.search-card').count(), 2);

    await start('failure');
    await finish('failure');
    await win.getByText('搜索失败: fixture later request failed', { exact: true }).waitFor();
    assert.equal(await firstCard('failure').count(), 1, 'late failures retain confirmed cards');

    await start('cancel');
    await win.getByRole('button', { name: '停止筛选', exact: true }).click();
    await app.evaluate(() => {
      const run = globalThis.searchFixtures.find((r) => r.term === 'cancel');
      run.updates.onResult({ ...run.first, id: 'late-cancel', name: 'must never appear' });
      run.resolve();
    });
    assert.equal(await firstCard('cancel').count(), 1);
    assert.equal(await win.getByText('must never appear', { exact: true }).count(), 0);

    await start('old');
    await start('new', true);
    await app.evaluate(() => {
      const run = globalThis.searchFixtures.find((r) => r.term === 'old');
      run.updates.onResult({ ...run.first, id: 'late-old', name: 'old late result' });
      run.resolve();
    });
    await finish('new');
    await win.locator('.search-card').filter({ hasText: 'new album 2' }).waitFor();
    assert.equal(await win.locator('.search-card').count(), 2);
    assert.equal(await firstCard('old').count(), 0);
    assert.equal(await win.getByText('old late result', { exact: true }).count(), 0);

    await start('mode-change');
    await win.getByRole('radio', { name: 'ALAC 无损', exact: true }).click();
    await win.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes('正在搜索'));
    assert.equal(await app.evaluate(() => globalThis.searchFixtures.at(-1).mode), 'alac');
    await app.evaluate(() => {
      const previous = globalThis.searchFixtures.at(-2);
      previous.updates.onResult({ ...previous.first, id: 'late-mode', name: 'old Atmos result' });
      previous.resolve();
      globalThis.searchFixtures.at(-1).resolve();
    });
    await win.waitForFunction(() => !document.querySelector('.search-input-wrap button').disabled);
    assert.equal(await win.locator('.search-card').count(), 2);
    assert.equal(await win.getByText('old Atmos result', { exact: true }).count(), 0);
    await firstCard('mode-change').getByRole('button', { name: '曲目 (1)', exact: true }).click();
    const bulkDownload = win.getByRole('dialog').getByRole('button', { name: '下载全部曲目', exact: true });
    assert.equal(await bulkDownload.isEnabled(), true, 'ALAC bulk download allows non-Atmos tracks');
    await bulkDownload.click();
    await win.waitForFunction(() => JSON.parse(localStorage.getItem('am-download-tasks-v1') || '[]').some((t) => t.mode === 'alac' && t.status === 'running'));
    assert.equal(await app.evaluate(() => globalThis.downloadFixtures[0].mode), 'alac');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('dl-exit', { id: 'fixture-1', code: 0, downloaded: [] }));
    await win.waitForFunction(() => JSON.parse(localStorage.getItem('am-download-tasks-v1') || '[]').some((t) => t.mode === 'alac' && t.status === 'success'));
    await win.locator('.ui-dialog-foot').getByRole('button', { name: '关闭', exact: true }).click();
    const searches = await app.evaluate(() => globalThis.searchFixtures.length);
    await win.getByRole('radio', { name: 'AAC', exact: true }).click();
    await firstCard('mode-change').getByRole('button', { name: '曲目 (1)', exact: true }).click();
    await bulkDownload.click();
    await win.waitForFunction(() => JSON.parse(localStorage.getItem('am-download-tasks-v1') || '[]').some((t) => t.mode === 'aac' && t.status === 'running'));
    assert.equal(await app.evaluate(() => globalThis.downloadFixtures[1].mode), 'aac');
    assert.equal(await app.evaluate(() => globalThis.searchFixtures.length), searches, 'ALAC/AAC share unfiltered results');
    await win.locator('.ui-dialog-foot').getByRole('button', { name: '关闭', exact: true }).click();
    await win.getByRole('radio', { name: '杜比全景声', exact: true }).click();
    await win.getByRole('button', { name: '停止筛选', exact: true }).waitFor();
    await firstCard('mode-change').getByText('杜比全景声', { exact: true }).waitFor();
    assert.equal(await app.evaluate(() => globalThis.searchFixtures.at(-1).mode), 'atmos');
    await app.evaluate(() => globalThis.searchFixtures.at(-1).resolve());
    await win.waitForFunction(() => !document.querySelector('.search-input-wrap button').disabled);
    assert.deepEqual(errors, []);
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    await win.screenshot({ path: path.join(root, 'test-results/search-stream.png'), fullPage: true });
    console.log('PASS: progressive results, cancellation, format switches, and ALAC/AAC bulk download of non-Atmos tracks');
  } finally {
    if (app) await app.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
