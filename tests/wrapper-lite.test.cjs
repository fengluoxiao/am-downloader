const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const yaml = require('js-yaml');
const { migrateConfig, probeWrapper, normalizeWrapperUrl } = require('../electron/wrapper-lite.cjs');

test('migration preserves preferences, moves the optional radio token and removes TCP settings', () => {
  const old = '# personal settings\r\nmedia-user-token: "saved-token"\r\nalac-save-folder: "D:/Music"\r\natmos-max: 2448\r\ndecrypt-m3u8-port: "host:10020"\r\nget-m3u8-port: "host:20020"\r\nget-m3u8-from-device: true\r\n';
  const migrated = migrateConfig(old);
  const config = yaml.load(migrated);
  assert.equal(config['station-token'], 'saved-token');
  assert.equal(config['alac-save-folder'], 'D:/Music');
  assert.equal(config['atmos-max'], 2448);
  assert.equal(config['wrapper-lite-url'], 'http://127.0.0.1:12340');
  assert.equal(config['wrapper-mode'], 'local');
  assert.equal(config['decrypt-m3u8-port'], undefined);
  assert.equal(config['get-m3u8-port'], undefined);
  assert.equal(migrateConfig(migrated), migrated);
  assert.ok(migrated.startsWith('# personal settings'));
});

test('migration keeps an existing remote service and radio token', () => {
  const config = yaml.load(migrateConfig('wrapper-mode: remote\nwrapper-lite-url: https://music.example/api\nstation-token: kept\nmedia-user-token: obsolete\n'));
  assert.equal(config['wrapper-lite-url'], 'https://music.example/api');
  assert.equal(config['wrapper-mode'], 'remote');
  assert.equal(config['station-token'], 'kept');
  assert.equal(config['media-user-token'], undefined);
});

test('status probe validates the HTTP contract, authentication state and timeout', async (t) => {
  let mode = 'ready';
  const server = http.createServer((req, res) => {
    assert.equal(req.url, '/wrapper/status');
    if (mode === 'timeout') return;
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'http-error') { res.writeHead(503); res.end('{}'); return; }
    if (mode === 'wrong-service') { res.end('{"code":0,"data":{}}'); return; }
    if (mode === 'api-error') { res.end('{"code":401,"msg":"login required"}'); return; }
    res.end(JSON.stringify({ code: 0, data: { regions: mode === 'ready' ? ['cn', 'us'] : [] } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/wrapper/`;
  assert.deepEqual((await probeWrapper(url)).regions, ['cn', 'us']);
  mode = 'not-logged-in';
  const unsigned = await probeWrapper(url);
  assert.equal(unsigned.ok, true);
  assert.deepEqual(unsigned.regions, []);
  for (const value of ['http-error', 'wrong-service', 'api-error', 'timeout']) {
    mode = value;
    const result = await probeWrapper(url, 100);
    assert.equal(result.ok, false, value);
    assert.ok(result.error.length > 0, value);
  }
});

test('rejects unsupported service URLs and preserves a reverse proxy base path', () => {
  assert.equal(normalizeWrapperUrl(' https://music.example/wrapper/ '), 'https://music.example/wrapper');
  for (const value of ['file:///tmp/a', 'ftp://host', 'http://user:pass@host', 'http://host?x=1', 'http://host#x']) {
    assert.throws(() => normalizeWrapperUrl(value));
  }
});
