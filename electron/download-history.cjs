const fs = require('node:fs');
const path = require('node:path');

function mediaIdentity(raw, song = false) {
  try {
    const u = new URL(raw);
    const parts = u.pathname.split('/').filter(Boolean);
    const type = parts.find((p) => ['song', 'album', 'playlist', 'artist', 'station'].includes(p));
    const id = parts.at(-1);
    const track = u.searchParams.get('i');
    if (track || type === 'song') return `song:${track || id}`;
    if (type && id) return `${type}:${id}`;
    return `${song ? 'song' : 'link'}:${u.origin}${u.pathname}`;
  } catch { return `${song ? 'song' : 'link'}:${raw}`; }
}

function receipts(stdout, opts, repo) {
  let tracks = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('[')) continue;
    try {
      const value = JSON.parse(line);
      if (Array.isArray(value)) tracks = value;
    } catch {}
  }
  const finishedAt = Date.now();
  const byId = new Map();
  const source = opts.urls[0];
  for (const t of tracks) {
    if (!t || typeof t.path !== 'string') continue;
    const file = path.resolve(repo, t.path);
    try { if (!fs.statSync(file).isFile()) continue; } catch { continue; }
    const id = String(t.track_id || (opts.song ? mediaIdentity(source, true).replace(/^song:/, '') : ''));
    if (!id) continue;
    const url = `https://music.apple.com/song/${id}`;
    const existing = byId.get(id);
    if (existing) existing.files = [...new Set([...existing.files, file])];
    else byId.set(id, { url, mode: opts.mode, song: true, title: String(t.song || ''), finishedAt, files: [file] });
  }
  const result = [...byId.values()];
  // A zero process exit can include skipped/unavailable tracks. Only a complete
  // receipt set may mark the entire album/playlist as downloaded.
  const counts = [...stdout.matchAll(/Completed:\s*(\d+)\/(\d+)/g)].at(-1);
  const total = counts ? Number(counts[2]) : 0;
  if (!opts.song && !mediaIdentity(source).startsWith('song:') && total > 0 &&
      Number(counts[1]) === total && tracks.length === total && result.length === total) {
    result.push({ url: source, mode: opts.mode, song: false, title: '', finishedAt,
      files: result.flatMap((r) => r.files), trackUrls: result.map((r) => r.url) });
  }
  return result;
}

function inside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function fileExists(file, recycle) {
  try { if (fs.statSync(file).isFile()) return true; } catch {}
  for (const item of recycle) {
    if (!inside(item.originalPath, file)) continue;
    const physical = path.join(item.trashPath, path.relative(item.originalPath, file));
    try { if (fs.statSync(physical).isFile()) return true; } catch {}
  }
  return false;
}

function reconcile(items, recycle, inventory, histories = []) {
  const checked = items.flatMap((item) => {
    if (Array.isArray(item.trackUrls)) return [item];
    let files = item.files;
    if (!Array.isArray(files)) {
      // Upgrade old URL-only history using exact filenames printed by the CLI.
      // Read the logical paths of recycled files as well as the live library.
      const log = histories.find((h) => h.mode === item.mode && mediaIdentity(h.url, h.song) === mediaIdentity(item.url, item.song))?.log || '';
      const lines = new Set(log.replace(/\x1b\[[0-9;]*m/g, '').split(/[\r\n]/).map((s) => s.trim()));
      const candidates = inventory.filter((f) => f.mode === item.mode && lines.has(path.parse(f.path).name));
      if (mediaIdentity(item.url, item.song).startsWith('song:')) {
        const withAlbum = candidates.filter((f) => lines.has(path.basename(path.dirname(f.path))));
        const matches = withAlbum.length ? withAlbum : candidates;
        files = matches.length === 1 ? matches.map((f) => f.path) : [];
        if (!files.length && !log) {
          // Clearing finished tasks used to discard their logs. In that case
          // accept only one exact title match from the old Apple Music slug.
          let slug = '';
          try {
            const parts = new URL(item.url).pathname.split('/').filter(Boolean);
            slug = decodeURIComponent(parts.at(-2) || '');
          } catch {}
          const titleKey = (s) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
          if (slug && !['song', 'album'].includes(slug)) {
            const matches = inventory.filter((f) => f.mode === item.mode &&
              titleKey(path.parse(f.path).name.replace(/^\d+[.\s_-]+/, '')) === titleKey(slug));
            if (matches.length === 1) files = matches.map((f) => f.path);
          }
        }
      } else {
        files = candidates.filter((f) => lines.has(path.basename(path.dirname(f.path)))).map((f) => f.path);
      }
    }
    files = files.filter((f) => typeof f === 'string' && fileExists(f, recycle));
    if (!files.length) return [];
    // Legacy collection receipts have no per-track manifest; invalidate them
    // after any member disappears instead of claiming a partially kept album.
    if (!item.song && item.files && files.length !== item.files.length) return [];
    return [{ ...item, files }];
  });
  const tracks = new Set(checked.filter((d) => !d.trackUrls).map((d) => `${d.mode}|${mediaIdentity(d.url, d.song)}`));
  return checked.filter((d) => !d.trackUrls || (d.trackUrls.length > 0 && d.trackUrls.every((u) => tracks.has(`${d.mode}|${mediaIdentity(u, true)}`))));
}

module.exports = { mediaIdentity, receipts, inside, fileExists, reconcile };
