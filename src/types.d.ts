export interface Status {
  repoDir: string;
  downloader: boolean;
  config: boolean;
  mp4box: boolean;
  docker: boolean;
  wrapperRunning: boolean;
  wrapperStatusText: string;
  decryptPort: boolean;
  m3u8Port: boolean;
  loggedIn: boolean;
  activeAccountId: string;
  activeAccountLabel: string;
  activeStorefront: string;
  accounts: AccountProfile[];
  mediaUserToken: boolean;
}

export interface AccountProfile {
  id: string;
  label: string;
  storefront: string;
  active: boolean;
  loggedIn: boolean;
}

export interface AudioFile {
  name: string;
  path: string;
  size: number;
  mtime: number;
  format: string;
}

export interface FileRoot {
  name: string;
  format: string;
  path: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'folder' | 'file';
  size: number | null;
  mtime: number;
  ext: string;
  format: string;
  playable: boolean;
  image: boolean;
  thumbnailable: boolean;
}

export interface DirectoryListing {
  ok: boolean;
  error?: string;
  roots: FileRoot[];
  root: FileRoot | null;
  path: string;
  parent: string | null;
  entries: FileEntry[];
}

export interface RecycleItem {
  id: string;
  name: string;
  originalPath: string;
  trashPath: string;
  type: 'folder' | 'file';
  size: number | null;
  deletedAt: number;
}

export interface DownloadOpts {
  urls: string[];
  mode: 'alac' | 'atmos' | 'aac';
  song: boolean;
  debug: boolean;
  select: boolean;
}

export type SearchType = 'song' | 'album' | 'compilation' | 'artist';

export interface SearchOpts {
  term: string;
  storefront: string;
  type: SearchType;
  albumFilter?: 'albumPriority' | 'songPriority';
  offset?: number;
}

export interface SearchTrack {
  id: string;
  name: string;
  durationInMillis?: number;
  supportsDolbyAtmos: boolean;
  audioTraitsTrack: string[];
  artistName?: string;
  url?: string;
}

export interface SearchItem {
  id: string;
  type: 'song' | 'album';
  albumSubtype?: 'single' | 'compilation' | 'album';
  name: string;
  artistName?: string;
  releaseDate?: string;
  artworkUrl?: string;
  supportsDolbyAtmos: boolean;
  audioTraits: string[];
  genres?: string[];
  url?: string;
  trackCount?: number;
  durationInMillis?: number;
  albumName?: string;
  albumId?: string;
  tracksDetails?: SearchTrack[];
}

export interface SearchPagination {
  offset: number;
  pageSize: number;
  checked: number;
  total: number | null;
  hasMore: boolean;
}

export interface SearchResponse {
  ok?: boolean;
  results?: SearchItem[];
  pagination?: SearchPagination | null;
  error?: string;
  status?: number;
}

declare global {
  interface Window {
    api: {
      getStatus: () => Promise<Status>;
      switchAccount: (id: string) => Promise<{ ok: boolean; profiles?: AccountProfile[]; error?: string }>;
      createAccount: (profile: { label: string; storefront: string }) => Promise<{ ok: boolean; profile?: AccountProfile; profiles?: AccountProfile[]; error?: string }>;
      deleteAccount: (id: string) => Promise<{ ok: boolean; profiles?: AccountProfile[]; error?: string }>;
      wrapperStart: () => Promise<{ ok: boolean; error?: string }>;
      wrapperStop: () => Promise<{ ok: boolean; error?: string }>;
      wrapperLogs: () => Promise<{ ok: boolean; logs: string }>;
      loginStart: (u: string, p: string) => Promise<{ ok: boolean; error?: string }>;
      login2fa: (code: string) => Promise<{ ok: boolean; error?: string }>;
      loginStop: () => Promise<{ ok: boolean }>;
      onLoginLog: (cb: (chunk: string) => void) => () => void;
      onLoginExit: (cb: (code: number) => void) => () => void;
      onLogin2faRequired: (cb: () => void) => () => void;
      onLoginSuccess: (cb: () => void) => () => void;
      onLoginFailed: (cb: () => void) => () => void;
      openMusicLogin: () => Promise<{ ok: boolean }>;
      onMusicTokenSaved: (cb: () => void) => () => void;
      onMusicTokenCancelled: (cb: () => void) => () => void;
      downloadStart: (opts: DownloadOpts) => Promise<{ ok: boolean; id?: string; cmd?: string; error?: string }>;
      downloadStop: (id: string) => Promise<{ ok: boolean }>;
      downloadPause: (id: string) => Promise<{ ok: boolean; error?: string }>;
      downloadResume: (id: string) => Promise<{ ok: boolean; error?: string }>;
      onDlLog: (cb: (data: { id: string; chunk: string }) => void) => () => void;
      onDlExit: (cb: (data: { id: string; code: number }) => void) => () => void;
      listFiles: () => Promise<AudioFile[]>;
      fileRoots: () => Promise<FileRoot[]>;
      readDir: (p?: string) => Promise<DirectoryListing>;
      thumbnail: (p: string) => Promise<{ ok: boolean; dataUrl?: string | null; error?: string }>;
      openFile: (p: string) => Promise<void>;
      revealFile: (p: string) => Promise<void>;
      deletePath: (p: string) => Promise<{ ok: boolean; error?: string }>;
      copyPath: (p: string, destDir: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      movePath: (p: string, destDir: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      openFolder: (format?: string) => Promise<void>;
      recycleList: () => Promise<RecycleItem[]>;
      recycleRestore: (id: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      recyclePurge: (id: string) => Promise<{ ok: boolean; error?: string }>;
      recycleEmpty: () => Promise<{ ok: boolean; error?: string }>;
      readConfig: () => Promise<{ ok: boolean; raw: string; path: string }>;
      writeConfig: (raw: string) => Promise<{ ok: boolean; error?: string }>;
      elevateAuth: () => Promise<{ ok: boolean; error?: string }>;
      pickFolder: (current?: string) => Promise<{ ok: boolean; path?: string }>;
      pickFile: (current?: string) => Promise<{ ok: boolean; path?: string }>;
      search: (opts: SearchOpts) => Promise<SearchResponse>;
    };
  }
}

export {};
