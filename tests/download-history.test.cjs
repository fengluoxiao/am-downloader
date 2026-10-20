const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const history = require('../electron/download-history.cjs');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/download-history.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const renderer = { exports: {} };
vm.runInNewContext(compiled, { exports: renderer.exports, URL, Set, Map });
const ui = renderer.exports;
const url = (id) => `https://music.apple.com/cn/song/test/${id}`;
const album = 'https://music.apple.com/cn/album/test/900';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'am-history-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'Album');
  fs.mkdirSync(dir);
  const files = [1, 2, 3].map((n) => path.join(dir, `${n}. Track ${n}.m4a`));
  files.forEach((f) => fs.writeFileSync(f, 'audio fixture'));
  const opts = { urls: [album], mode: 'atmos', song: false };
  const raw = files.map((f, i) => ({ path: path.relative(root, f), track_id: String(i + 1), song: `Track ${i + 1}` }));
  const output = `Completed: 3/3 | Warnings: 0 | Errors: 0\n${JSON.stringify(raw)}\n`;
  return { root, dir, files, opts, raw, output, records: history.receipts(output, opts, root) };
}

test('song URL aliases and formats share the same rules in renderer and backend', () => {
  const aliases = [url(1), 'https://music.apple.com/us/song/other-name/1?l=en', `${album}?i=1&l=zh`];
  for (const u of aliases) {
    assert.equal(history.mediaIdentity(u, true), 'song:1');
    assert.equal(ui.mediaIdentity(u, true), 'song:1');
    assert.equal(ui.downloadedKey('atmos', false, u), 'atmos|song:1');
  }
  assert.notEqual(ui.downloadedKey('alac', true, url(1)), ui.downloadedKey('atmos', true, url(1)));
  assert.equal(ui.mediaIdentity(album), 'album:900');
});

test('file trash, restore, permanent purge and restart preserve only the right songs', (t) => {
  const f = fixture(t);
  assert.equal(f.records.length, 4);
  const trash = path.join(f.root, 'trash.m4a');
  const recycled = [{ originalPath: f.files[1], trashPath: trash }];
  fs.renameSync(f.files[1], trash);
  assert.equal(history.reconcile(f.records, recycled, []).length, 4);
  fs.renameSync(trash, f.files[1]);
  assert.equal(history.reconcile(f.records, [], []).length, 4);
  fs.renameSync(f.files[1], trash);
  fs.rmSync(trash);
  const kept = history.reconcile(f.records, [], []);
  assert.deepEqual(kept.map((r) => history.mediaIdentity(r.url)), ['song:1', 'song:3']);
  assert.deepEqual(history.reconcile(JSON.parse(JSON.stringify(kept)), [], []), kept);
});

test('folder trash and empty trash clear its songs without touching other formats', (t) => {
  const f = fixture(t);
  const other = path.join(f.root, 'ALAC.m4a');
  fs.writeFileSync(other, 'other format');
  const records = [...f.records, { ...f.records[0], mode: 'alac', files: [other] }];
  const trash = path.join(f.root, 'trash-folder');
  fs.renameSync(f.dir, trash);
  const recycled = [{ originalPath: f.dir, trashPath: trash }];
  assert.equal(history.reconcile(records, recycled, []).length, 5);
  fs.rmSync(trash, { recursive: true });
  assert.deepEqual(history.reconcile(records, [], []).map((r) => r.mode), ['alac']);
});

test('only successful track receipts count, even when album process exits zero', (t) => {
  const f = fixture(t);
  const partial = history.receipts(`Completed: 1/3 | Warnings: 2\n${JSON.stringify(f.raw.slice(0, 1))}`, f.opts, f.root);
  assert.equal(partial.length, 1);
  assert.equal(partial[0].song, true);
  assert.equal(history.receipts('Completed: 0/1\nnull\n', f.opts, f.root).length, 0);
  fs.rmSync(f.files[0]);
  assert.equal(history.receipts(f.output, f.opts, f.root).length, 2);
});

test('copy and move keep alternate files; prefix neighbors are not relocated', (t) => {
  const f = fixture(t);
  const dest = path.join(f.root, 'copy.m4a');
  fs.copyFileSync(f.files[0], dest);
  const copied = ui.relocateDownloaded(f.records, { kind: 'copy', from: f.files[0], to: dest });
  fs.rmSync(f.files[0]);
  assert.equal(history.reconcile(copied, [], []).length, 4, 'a second copy still satisfies album manifest');
  const moved = path.join(f.root, 'moved.m4a');
  fs.renameSync(dest, moved);
  const updated = ui.relocateDownloaded(copied, { kind: 'move', from: dest, to: moved });
  assert.equal(history.reconcile(updated, [], []).length, 4);
  const neighbor = ui.relocateDownloaded([{ ...f.records[0], files: [f.dir + '-other/song.m4a'] }], { kind: 'move', from: f.dir, to: 'unused' });
  assert.equal(neighbor[0].files[0], f.dir + '-other/song.m4a');
});

test('legacy URL history migrates against exact CLI filenames, including trash', (t) => {
  const f = fixture(t);
  const legacy = { url: `${album}?i=2`, mode: 'atmos', song: true, title: '', finishedAt: 1 };
  const oldTask = { ...legacy, log: 'Artist\nAlbum\n2. Track 2\n' };
  const inventory = f.files.map((file) => ({ path: file, mode: 'atmos' }));
  const trash = path.join(f.root, 'old-trash');
  fs.renameSync(f.files[1], trash);
  const recycled = [{ originalPath: f.files[1], trashPath: trash }];
  const migrated = history.reconcile([legacy], recycled, inventory, [oldTask]);
  assert.deepEqual(migrated[0].files, [f.files[1]]);
  fs.rmSync(trash);
  assert.equal(history.reconcile(migrated, [], inventory, [oldTask]).length, 0);
  assert.equal(history.reconcile([legacy], [], inventory, [oldTask]).length, 0);
});

test('legacy song records survive cleared task logs only with a unique exact title', (t) => {
  const f = fixture(t);
  const item = { url: 'https://music.apple.com/cn/song/track-1/1', mode: 'atmos', song: true, title: '', finishedAt: 1 };
  const inventory = f.files.map((file) => ({ path: file, mode: 'atmos' }));
  assert.deepEqual(history.reconcile([item], [], inventory)[0].files, [f.files[0]]);
  const other = path.join(f.root, 'Other album');
  fs.mkdirSync(other);
  const sameName = path.join(other, path.basename(f.files[0]));
  fs.writeFileSync(sameName, 'ambiguous song');
  assert.equal(history.reconcile([item], [], [...inventory, { path: sameName, mode: 'atmos' }]).length, 0);
});
