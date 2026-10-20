export type DownloadMode = 'atmos' | 'alac' | 'aac';

export interface DownloadedItem {
  url: string;
  mode: DownloadMode;
  song: boolean;
  title: string;
  finishedAt: number;
  files?: string[];
  trackUrls?: string[];
}

export function mediaIdentity(raw: string, song = false): string {
  try {
    const u = new URL(raw);
    const parts = u.pathname.split('/').filter(Boolean);
    const type = parts.find((p) => ['song', 'album', 'playlist', 'artist', 'station'].includes(p));
    const id = parts[parts.length - 1];
    const track = u.searchParams.get('i');
    if (track || type === 'song') return `song:${track || id}`;
    if (type && id) return `${type}:${id}`;
    return `${song ? 'song' : 'link'}:${u.origin}${u.pathname}`;
  } catch { return `${song ? 'song' : 'link'}:${raw}`; }
}

export function downloadedKey(mode: DownloadMode, song: boolean, url: string) {
  return `${mode}|${mediaIdentity(url, song)}`;
}

export function mergeDownloaded(previous: DownloadedItem[], added: DownloadedItem[]) {
  const map = new Map(previous.map((d) => [downloadedKey(d.mode, d.song, d.url), d]));
  for (const item of added) {
    const key = downloadedKey(item.mode, item.song, item.url);
    const old = map.get(key);
    map.set(key, { ...item, files: [...new Set([...(old?.files || []), ...(item.files || [])])] });
  }
  return [...map.values()];
}

export interface LibraryChange { kind?: 'move' | 'copy'; from?: string; to?: string }

export function relocateDownloaded(items: DownloadedItem[], change: LibraryChange) {
  const { kind, from, to } = change;
  if (!kind || !from || !to || from === to) return items;
  const normalize = (s: string) => {
    const p = s.replace(/\\/g, '/').replace(/\/$/, '');
    return /^[A-Za-z]:/.test(p) ? p.toLowerCase() : p;
  };
  const base = normalize(from);
  return items.map((item) => ({ ...item, files: item.files?.flatMap((file) => {
    const p = normalize(file);
    if (p !== base && !p.startsWith(`${base}/`)) return [file];
    const destination = to + file.slice(from.replace(/[\\/]$/, '').length);
    return kind === 'copy' ? [file, destination] : [destination];
  }) }));
}
