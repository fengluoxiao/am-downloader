const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const yaml = require('js-yaml');
const { normalizeWindowsPaths } = require('../electron/config-paths.cjs');
const { migrateConfig } = require('../electron/wrapper-lite.cjs');

function loadRenderer(name) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', name), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require });
  return exports;
}
const form = loadRenderer('config-form.ts');
const paths = loadRenderer('file-path.ts');

test('form saves and reloads mapped drives, UNC shares and literal YAML punctuation', () => {
  const raw = 'atmos-save-folder: Atmos # spatial audio\n';
  for (const folder of [String.raw`Y:\music\dolbyatmos`, String.raw`Y:\音乐\杜比 全景声`, String.raw`\\NAS\music\杜比`, String.raw`\\192.168.1.3\Media Share\音乐`, 'Y:\\', String.raw`Y:\music\# favourites`, "Y:\\music\\artist's music", String.raw`Y:\temp\new\track`, '/mnt/nas/music']) {
    const saved = form.applyValues(raw, { 'atmos-save-folder': folder });
    assert.equal(yaml.load(saved)['atmos-save-folder'], folder);
    assert.equal(form.unquote(form.parseEntries(saved)[0].value), folder);
    assert.ok(saved.includes('# spatial audio'));
    assert.equal(normalizeWindowsPaths(saved), saved, 'valid escaped paths must stay intact');
    assert.equal(form.applyValues(saved, { 'atmos-save-folder': folder }), saved);
  }
});

test('repairs old double-quoted Windows paths without interpreting tab/newline escapes', () => {
  for (const folder of [String.raw`Y:\music\dolbyatmos`, String.raw`Y:\temp\new\track`, String.raw`\\NAS\music\Dolby Atmos`]) {
    const bad = `atmos-save-folder: "${folder}" # NAS\r\n`;
    const fixed = normalizeWindowsPaths(bad);
    assert.equal(yaml.load(fixed)['atmos-save-folder'], folder);
    assert.ok(fixed.endsWith('# NAS\r\n'));
    assert.equal(migrateConfig(migrateConfig(bad)), migrateConfig(bad));
    assert.equal(yaml.load(migrateConfig(bad))['atmos-save-folder'], folder);
  }
  const valid = "atmos-save-folder: 'Y:\\music\\dolbyatmos'\n";
  assert.equal(normalizeWindowsPaths(valid), valid);
  assert.equal(normalizeWindowsPaths('station-token: "bad\\q"\n'), 'station-token: "bad\\q"\n', 'other fields must not be repaired');
});

test('YAML comments and quoted strings retain their original meaning', () => {
  const raw = `station-token: "old" # real comment\nembed-lrc: true\natmos-max: 2768\nartist-folder-format: '{ArtistName}'\n`;
  const value = 'a "quoted" \\ path # still in string';
  const saved = form.applyValues(raw, { 'station-token': value, 'embed-lrc': 'false', 'atmos-max': '2448', 'artist-folder-format': "artist's {ArtistName}" });
  const obj = yaml.load(saved);
  assert.equal(obj['station-token'], value);
  assert.equal(obj['embed-lrc'], false);
  assert.equal(obj['atmos-max'], 2448);
  assert.equal(obj['artist-folder-format'], "artist's {ArtistName}");
  assert.equal(form.parseEntries(saved)[0].comment, 'real comment');
  assert.equal(form.unquote(form.parseEntries(saved)[0].value), value);
  assert.equal(form.unquote("'artist''s folder'"), "artist's folder");
  assert.equal(form.parseEntries('atmos-save-folder: "Y:\\\\# favourites" # actual')[0].comment, 'actual');
});

test('file breadcrumbs handle drive letters, UNC paths, path boundaries and POSIX', () => {
  for (const [base, current, expected] of [
    [String.raw`Y:\music`, String.raw`Y:\music\歌手\专辑`, ['歌手', '专辑']],
    [String.raw`Y:\music`, 'y:/MUSIC/Artist/Album', ['Artist', 'Album']],
    [String.raw`\\NAS\music`, String.raw`\\nas\MUSIC\Artist\Album`, ['Artist', 'Album']],
    [String.raw`Y:\music`, String.raw`Y:\music-other\Album`, []],
    ['/mnt/nas', '/mnt/nas/Artist/Album', ['Artist', 'Album']],
    ['/', '/Artist/Album', ['Artist', 'Album']],
  ]) assert.deepEqual(Array.from(paths.relativeParts(base, current)), expected);
  assert.equal(paths.joinPath(String.raw`Y:\music`, ['歌手', '专辑']), String.raw`Y:\music\歌手\专辑`);
  assert.equal(paths.joinPath(String.raw`\\NAS\music`, ['Artist']), String.raw`\\NAS\music\Artist`);
  assert.equal(paths.joinPath('/', ['Artist']), '/Artist');
});
