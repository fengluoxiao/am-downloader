const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { findAppleMusicInfo } = require('../electron/getinfo.js');
const { createSearchRunner } = require('../electron/search-runner.cjs');

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const response = (json) => ({ ok: () => true, status: () => 200, json: async () => json, text: async () => '' });
const album = (id, atmos = true) => ({ id, attributes: {
  name: `${atmos ? 'hit' : 'ordinary'} album ${id}`, artistName: 'Fixture Artist', releaseDate: `2026-10-${10 - Number(id)}`,
  audioTraits: atmos ? ['atmos'] : undefined, trackCount: 1, isCompilation: true,
  url: `https://music.apple.com/cn/album/hit/${id}`,
}, relationships: { tracks: { data: [{ id: `${id}01`, attributes: { name: atmos ? 'hit song' : 'ordinary song', audioTraits: atmos ? ['atmos'] : [], url: `https://music.apple.com/cn/song/${id}01` } }] } } });

function catalogPage(type, second, entered, fail = false) {
  const candidates = [album('1'), album('2'), album('3', false)];
  const script = { first() { return this; }, waitFor: async () => {}, count: async () => 1, getAttribute: async () => '/assets/app.js' };
  return {
    isClosed: () => false, goto: async () => {}, locator: () => script,
    waitForLoadState: () => { throw new Error('must not wait for networkidle'); },
    url: () => 'https://music.apple.com/cn/search',
    request: { get: async (raw) => {
      const url = new URL(raw);
      if (url.pathname === '/assets/app.js') return { ...response({}), text: async () => 'eyJ0eXAiOiJKV1Qi.fixture-token' };
      if (url.pathname.endsWith('/search')) {
        const resource = url.searchParams.get('types');
        if (resource === 'artists') return response({ results: { artists: { data: [{ id: 'artist1', attributes: { name: 'hit artist' } }] } } });
        if (resource === 'songs' && type !== 'song') return response({ results: { songs: { data: [] } } });
        if (resource === 'songs') return response({ results: { songs: { data: candidates } } });
        return response({ results: { albums: { data: candidates } } });
      }
      if (url.pathname.includes('/artists/')) return response({ data: candidates });
      if (url.pathname.endsWith('/albums/2')) {
        entered.resolve();
        await second.promise;
        if (fail) throw new Error('late network failure');
      }
      const id = url.pathname.split('/').at(-1);
      return response({ data: [candidates.find((a) => a.id === id)] });
    } },
  };
}

for (const type of ['artist', 'album', 'compilation']) {
  test(`${type}: first confirmed result is emitted while later detail request is blocked`, async () => {
    const second = deferred();
    const entered = deferred();
    const results = [];
    const progress = [];
    let finished = false;
    const pending = findAppleMusicInfo(catalogPage(type, second, entered), 'hit', 'cn', type, 'albumPriority', 0, {
      onResult: (item) => results.push(item), onProgress: (p) => progress.push(p),
    }).then((r) => { finished = true; return r; });
    await entered.promise;
    assert.equal(finished, false);
    assert.deepEqual(results.map((r) => r.id), ['1']);
    assert.equal(results[0].tracksDetails.length, 1, 'streamed card already has its track list');
    second.resolve();
    const final = await pending;
    assert.deepEqual(final.results.map((r) => r.id), ['1', '2']);
    assert.deepEqual(results, final.results);
    assert.equal(progress.at(-1).checked, 3, 'rejected candidates count towards progress');
    assert.equal(final.pagination.checked, 3);
  });
}

test('song matches stream with the same filter and no duplicates in the final result', async () => {
  const results = [];
  const final = await findAppleMusicInfo(catalogPage('song'), 'hit', 'cn', 'song', 'albumPriority', 0, { onResult: (item) => results.push(item) });
  assert.deepEqual(results.map((r) => r.id), ['1', '2']);
  assert.deepEqual(results, final.results);
});

for (const mode of ['alac', 'aac']) {
  for (const type of ['song', 'artist', 'album', 'compilation']) {
    test(`${mode} ${type}: non-Atmos results and tracks are retained with accurate traits`, async () => {
      const gate = deferred();
      gate.resolve();
      const streamed = [];
      const final = await findAppleMusicInfo(catalogPage(type, gate, deferred()), 'hit', 'cn', type, 'albumPriority', 0, {
        mode, onResult: (item) => streamed.push(item),
      });
      assert.deepEqual(final.results.map((r) => r.id), ['1', '2', '3']);
      assert.deepEqual(streamed, final.results);
      assert.equal(final.results[2].supportsDolbyAtmos, false);
      assert.deepEqual(final.results[2].audioTraits, []);
      if (type !== 'song') {
        assert.equal(final.results[2].tracksDetails.length, 1);
        assert.equal(final.results[2].tracksDetails[0].supportsDolbyAtmos, false);
      }
    });
  }
}

test('ordinary album search ignores an old songPriority filter and retains full tracks', async () => {
  const gate = deferred();
  gate.resolve();
  const final = await findAppleMusicInfo(catalogPage('album', gate, deferred()), 'hit', 'cn', 'album', 'songPriority', 0, { mode: 'alac' });
  assert.equal(final.results.length, 3);
  assert.equal(final.results[2].tracksDetails[0].name, 'ordinary song');
});

test('a later API failure does not retract matches already streamed', async () => {
  const second = deferred();
  const entered = deferred();
  const results = [];
  const pending = findAppleMusicInfo(catalogPage('artist', second, entered, true), 'hit', 'cn', 'artist', 'albumPriority', 0, { onResult: (item) => results.push(item) });
  await entered.promise;
  second.resolve();
  const final = await pending;
  assert.match(final[0].error, /late network failure/);
  assert.deepEqual(results.map((r) => r.id), ['1']);
});

function sender() {
  const target = new EventEmitter();
  target.id = 1;
  target.isDestroyed = () => false;
  target.messages = [];
  target.send = (_channel, message) => target.messages.push(message);
  return target;
}

test('IPC runner forwards the selected download format and defaults to Atmos', async () => {
  const modes = [];
  const runner = createSearchRunner({
    getStorefront: () => 'cn', getPage: async () => ({ close: async () => {} }),
    search: async (_p, _t, _s, _ty, _f, _o, updates) => { modes.push(updates.mode); return { results: [] }; },
  });
  for (const mode of [undefined, 'alac', 'aac', 'atmos']) await runner.run({ sender: sender() }, { term: 'hit', mode });
  assert.deepEqual(modes, ['atmos', 'alac', 'aac', 'atmos']);
});

test('a new search suppresses late events from the previous search and closes its own page', async () => {
  const oldEntered = deferred();
  const oldDone = deferred();
  let oldUpdates;
  const pages = [];
  const runner = createSearchRunner({
    getStorefront: () => 'cn',
    getPage: async () => { const p = { closed: false, close: async () => { p.closed = true; } }; pages.push(p); return p; },
    search: async (_page, term, _store, _type, _filter, _offset, updates) => {
      if (term === 'old') {
        oldUpdates = updates;
        oldEntered.resolve();
        await oldDone.promise;
      }
      updates.onResult({ id: term });
      return { results: [{ id: term }] };
    },
  });
  const target = sender();
  const old = runner.run({ sender: target }, { term: 'old', requestId: 'old-id' });
  await oldEntered.promise;
  const latest = await runner.run({ sender: target }, { term: 'new', requestId: 'new-id' });
  oldUpdates.onResult({ id: 'late-old-result' });
  oldDone.resolve();
  assert.equal((await old).cancelled, true);
  assert.deepEqual(latest.results, [{ id: 'new' }]);
  assert.deepEqual(target.messages.map((m) => m.requestId), ['new-id']);
  assert.equal(pages.every((p) => p.closed), true);
});

test('explicit cancellation suppresses subsequent results and final response', async () => {
  const entered = deferred();
  const done = deferred();
  const target = sender();
  const runner = createSearchRunner({
    getStorefront: () => 'cn', getPage: async () => ({ close: async () => {} }),
    search: async (_p, _t, _s, _ty, _f, _o, updates) => {
      updates.onResult({ id: 'first' });
      entered.resolve();
      await done.promise;
      updates.onResult({ id: 'after-cancel' });
      return { results: [] };
    },
  });
  const pending = runner.run({ sender: target }, { term: 'hit', requestId: 'cancel-me' });
  await entered.promise;
  runner.cancel({ sender: target }, 'cancel-me');
  done.resolve();
  assert.equal((await pending).cancelled, true);
  assert.deepEqual(target.messages.map((m) => m.item.id), ['first']);
});
