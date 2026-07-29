import React, { useEffect, useState } from 'react';
import { ChevronLeft as LeftOutlined, ChevronRight as RightOutlined, Download as CloudDownloadOutlined, List as UnorderedListOutlined, Search as SearchOutlined } from 'lucide-react';
import { useTasks } from '../store';
import type { SearchItem, SearchPagination, SearchTrack, SearchType } from '../types';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';
import Notice from '../ui/Notice';
import Segmented from '../ui/Segmented';
import Select from '../ui/Select';
import Surface from '../ui/Surface';
import TextInput from '../ui/TextInput';

const TYPE_OPTIONS: Array<{ label: string; value: SearchType }> = [
  { label: '歌曲', value: 'song' },
  { label: '专辑', value: 'album' },
  { label: '合集', value: 'compilation' },
  { label: '艺人', value: 'artist' },
];

const STOREFRONTS = [
  { label: '国区', value: 'cn' },
  { label: '美区', value: 'us' },
  { label: '日区', value: 'jp' },
  { label: '港区', value: 'hk' },
  { label: '台区', value: 'tw' },
  { label: '英区', value: 'gb' },
];

const SUBTYPE_LABELS: Record<string, string> = { single: '单曲', compilation: '合集', album: '专辑' };

const TYPE_COLORS: Record<SearchType, { st: string; deep: string }> = {
  song: { st: '#3388bb', deep: '#266699' },
  album: { st: '#881144', deep: '#660033' },
  compilation: { st: '#2288dd', deep: '#1a66aa' },
  artist: { st: '#ff7788', deep: '#e2566a' },
};

function fmtDuration(ms?: number) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function TraitTags({ traits }: { traits: string[] }) {
  const map: Record<string, string> = {
    atmos: '杜比全景声',
    spatialAudio: '空间音频',
    lossless: '无损',
    'hi-res-lossless': '高解析无损',
    lossyStereo: 'AAC',
  };
  return (
    <span className="search-tags">
      {traits.map((t) => map[t] ? <Badge key={t}>{map[t]}</Badge> : null)}
    </span>
  );
}

export default function SearchPage({ onGoTasks }: { onGoTasks?: () => void }) {
  const { enqueue } = useTasks();
  const [term, setTerm] = useState('');
  const [type, setType] = useState<SearchType>('song');
  const [storefront, setStorefront] = useState('cn');
  const [albumFilter, setAlbumFilter] = useState<'albumPriority' | 'songPriority'>('albumPriority');
  const [mode, setMode] = useState<'atmos' | 'alac' | 'aac'>('atmos');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [results, setResults] = useState<SearchItem[] | null>(null);
  const [searchedType, setSearchedType] = useState<SearchType | null>(null);
  const [pagination, setPagination] = useState<SearchPagination | null>(null);
  const [offsetHistory, setOffsetHistory] = useState<number[]>([0]);
  const [pageIndex, setPageIndex] = useState(0);
  const [tracksItem, setTracksItem] = useState<SearchItem | null>(null);

  useEffect(() => {
    let alive = true;
    window.api.getStatus().then((s) => {
      if (!alive) return;
      if (s.activeStorefront) setStorefront(s.activeStorefront);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const controlStyle = { '--st': TYPE_COLORS[type].st, '--st-deep': TYPE_COLORS[type].deep } as React.CSSProperties;
  const resultStyle = searchedType ? { '--st': TYPE_COLORS[searchedType].st, '--st-deep': TYPE_COLORS[searchedType].deep } as React.CSSProperties : undefined;

  const toast = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((current) => (current === text ? null : current)), 3600);
  };

  const notifyAdded = (text: string) => {
    toast(onGoTasks ? `${text}，可去下载管理查看` : text);
  };

  const doSearch = async (offset: number, newHistory?: number[], newIndex?: number) => {
    if (!term.trim()) { toast('请输入搜索词'); return; }
    setLoading(true);
    setError(null);
    const r = await window.api.search({ term: term.trim(), storefront, type, albumFilter, offset });
    setLoading(false);
    if (r.error) {
      setError(r.error);
      setResults([]);
      setPagination(null);
      return;
    }
    setResults(r.results || []);
    setSearchedType(type);
    setPagination(r.pagination || null);
    if (newHistory && newIndex !== undefined) {
      setOffsetHistory(newHistory);
      setPageIndex(newIndex);
    }
  };

  const goPage = (dir: 1 | -1) => {
    if (!pagination) return;
    if (dir === 1) {
      const nextOffset = pagination.offset + pagination.pageSize;
      doSearch(nextOffset, [...offsetHistory.slice(0, pageIndex + 1), nextOffset], pageIndex + 1);
    } else if (pageIndex > 0) {
      doSearch(offsetHistory[pageIndex - 1], offsetHistory, pageIndex - 1);
    }
  };

  const download = (item: SearchItem) => {
    if (!item.url) return;
    const r = enqueue([{ url: item.url, mode, song: item.type === 'song', debug: false }]);
    if (r.added > 0) notifyAdded(`已加入队列：${item.name}`);
    else toast(`「${item.name}」已在队列中，跳过`);
  };

  const downloadTrack = (track: SearchTrack) => {
    if (!track.url) return;
    const r = enqueue([{ url: track.url, mode, song: true, debug: false }]);
    if (r.added > 0) notifyAdded(`已加入队列：${track.name}`);
    else toast(`「${track.name}」已在队列中，跳过`);
  };

  const downloadAllTracks = (item: SearchItem) => {
    const items = (item.tracksDetails || []).filter((t) => t.url && t.supportsDolbyAtmos).map((t) => ({ url: t.url!, mode, song: true, debug: false }));
    if (items.length === 0) { toast('这张专辑没有可下载的杜比曲目'); return; }
    const r = enqueue(items);
    if (r.added > 0) notifyAdded(r.skipped > 0 ? `已加入队列：${r.added} 首曲目（跳过 ${r.skipped} 首重复）` : `已加入队列：${r.added} 首曲目`);
    else toast('这些曲目都已在队列中');
  };

  return (
    <div className="search-page" data-st={searchedType ?? undefined} style={resultStyle}>
      <Surface className="search-panel">
        <div className="search-row" style={controlStyle}>
          <div className="search-input-wrap">
            <TextInput
              placeholder="搜索歌曲 / 专辑 / 合集 / 艺人，仅显示支持杜比全景声的结果"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doSearch(0, [0], 0); }}
            />
            <Button variant="primary" icon={<SearchOutlined />} disabled={loading} onClick={() => doSearch(0, [0], 0)}>搜索</Button>
          </div>
          <Segmented options={TYPE_OPTIONS} value={type} onChange={setType} />
          <Select value={storefront} options={STOREFRONTS} onChange={setStorefront} />
        </div>
        <div className="search-row secondary" style={controlStyle}>
          {type === 'album' && (
            <Segmented
              options={[{ label: '专辑优先', value: 'albumPriority' }, { label: '歌名匹配优先', value: 'songPriority' }]}
              value={albumFilter}
              onChange={setAlbumFilter}
            />
          )}
          <span className="search-mode-label">下载格式</span>
          <Segmented
            options={[{ label: '杜比全景声', value: 'atmos' }, { label: 'ALAC 无损', value: 'alac' }, { label: 'AAC', value: 'aac' }]}
            value={mode}
            onChange={setMode}
          />
          {pagination && <span className="search-checked">{pagination.total != null ? `已检查 ${pagination.checked} / ${pagination.total} 张` : `已检查 ${pagination.checked} 条`}</span>}
        </div>
      </Surface>

      {notice && <Notice tone="info">{notice}{onGoTasks && notice.includes('已加入队列') && <Button size="sm" variant="quiet" onClick={onGoTasks}>去看任务</Button>}</Notice>}
      {error && <Notice tone="warning">{error}</Notice>}

      {loading && results === null ? (
        <div className="search-grid">{Array.from({ length: 8 }).map((_, i) => <div className="search-skeleton" key={i} />)}</div>
      ) : (
        <div className="search-results-wrap" aria-busy={loading}>
          {results && results.length === 0 && !error && <div className="ui-empty">没有找到支持杜比全景声的结果，换个关键词或区域试试</div>}
          <div className="search-grid">
            {(results || []).map((item) => (
              <article className="search-card" key={`${item.type}-${item.id}`}>
                {item.artworkUrl && <img className="search-artwork" src={item.artworkUrl} alt={item.name} />}
                <div className="search-card-body">
                  <strong title={item.name}>{item.name}</strong>
                  <span className="search-artist">{item.artistName}{item.albumName ? ` · ${item.albumName}` : ''}</span>
                  <span className="search-tags">
                    {item.type === 'album' && item.albumSubtype && <Badge>{SUBTYPE_LABELS[item.albumSubtype]}</Badge>}
                    <TraitTags traits={item.audioTraits} />
                  </span>
                  <small>{item.releaseDate}{item.trackCount ? ` · ${item.trackCount} 首` : ''}{item.durationInMillis ? ` · ${fmtDuration(item.durationInMillis)}` : ''}</small>
                  <div className="search-card-actions">
                    <Button size="sm" variant="primary" icon={<CloudDownloadOutlined />} onClick={() => download(item)}>下载</Button>
                    {item.type === 'album' && (item.tracksDetails?.length ?? 0) > 0 && (
                      <Button size="sm" icon={<UnorderedListOutlined />} onClick={() => setTracksItem(item)}>曲目 ({item.tracksDetails!.length})</Button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {pagination && (pageIndex > 0 || pagination.hasMore) && (
        <div className="search-pager">
          <Button icon={<LeftOutlined />} disabled={pageIndex === 0 || loading} onClick={() => goPage(-1)}>上一页</Button>
          <span>第 {pageIndex + 1} 页</span>
          <Button icon={<RightOutlined />} disabled={!pagination.hasMore || loading} onClick={() => goPage(1)}>下一页</Button>
        </div>
      )}

      <Dialog
        open={!!tracksItem}
        onClose={() => setTracksItem(null)}
        title={tracksItem && (
          <span className="search-dialog-title">
            {tracksItem.artworkUrl && <img src={tracksItem.artworkUrl} alt="" />}
            <span><strong>{tracksItem.name}</strong><small>{tracksItem.artistName}</small></span>
          </span>
        )}
        footer={<><Button onClick={() => setTracksItem(null)}>关闭</Button><Button variant="primary" icon={<CloudDownloadOutlined />} onClick={() => tracksItem && downloadAllTracks(tracksItem)}>下载全部杜比曲目</Button></>}
      >
        <div className="search-track-list">
          {(tracksItem?.tracksDetails || []).map((t, i) => (
            <div className="search-track-row" key={t.id}>
              <span className="search-track-index">{i + 1}</span>
              <div className="search-track-main">
                <strong>{t.name}</strong>
                <small>{t.artistName}{fmtDuration(t.durationInMillis) ? ` · ${fmtDuration(t.durationInMillis)}` : ''}</small>
                <TraitTags traits={t.audioTraitsTrack} />
              </div>
              {t.url && <Button size="sm" icon={<CloudDownloadOutlined />} disabled={!t.supportsDolbyAtmos && mode === 'atmos'} onClick={() => downloadTrack(t)} />}
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
