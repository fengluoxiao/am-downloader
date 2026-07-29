# AM Downloader

Apple Music Dolby Atmos downloader desktop GUI built with Electron, React and Vite.

This project is a desktop wrapper and workflow tool. The underlying download/decrypt capability is based on [rahulhingve/apple-music-dolby-atmos-downloader](https://github.com/rahulhingve/apple-music-dolby-atmos-downloader). The Apple Music search experience integrates ideas and code paths from the local `amget` project, including song, album, compilation and artist search over Apple Music catalog metadata.

## Features

- Search Apple Music by song, album, compilation or artist.
- Add search results or pasted Apple Music links to a local download queue.
- Download Dolby Atmos, ALAC or AAC depending on the selected mode.
- Manage active downloads and download history with pause, resume, cancel and log viewing.
- Manage downloaded files in a separate file manager page with thumbnails and recycle-bin restore.
- Start, stop and inspect the Apple Music wrapper decrypt service.
- Save multiple Apple ID wrapper account slots with independent storefront settings.
- Edit downloader configuration from a simple mode or raw YAML mode.
- Linux/Hyprland compatibility mode disables GPU compositing by default to avoid window freezes.

## Credits

This application stands on top of these projects:

- [rahulhingve/apple-music-dolby-atmos-downloader](https://github.com/rahulhingve/apple-music-dolby-atmos-downloader) for the original Apple Music Dolby Atmos downloader and wrapper workflow.
- `amget` by fengluoxiao for Apple Music catalog search and Dolby Atmos result filtering.
- Electron, React, Vite, Playwright and lucide-react for the desktop app stack.

## Requirements

- Node.js 20 or newer.
- Docker, with access to the Apple Music wrapper image used by the downloader workflow.
- MP4Box available in `PATH`.
- A valid Apple Music subscription for the account used with the wrapper.

The app expects the wrapper data directory at:

```bash
~/tools/wrapper/rootfs/data
```

The packaged app copies the bundled downloader resources into the app user data directory on first launch. In development, the app can also use an external downloader repo through `AM_DL_REPO`.

## Development

Install dependencies:

```bash
npm install
```

Run in development mode:

```bash
npm run dev
```

Run the built app:

```bash
npm start
```

Build the renderer:

```bash
npm run build
```

Build a Linux `.deb` package:

```bash
npm run dist
```

Type-check:

```bash
npm run typecheck
```

## Usage

1. Open the Decrypt Service page.
2. Create or select an Apple ID account slot and log in.
3. Start the wrapper service and confirm the decrypt ports are connected.
4. Search Apple Music or paste links on the Download page.
5. Add items to the queue and watch progress in Download Management.
6. Browse completed files from File Management.

## Account Slots

The decrypt service supports multiple account slots. Each slot stores its own wrapper data and storefront value. Switching accounts stops the current wrapper, saves the current slot, restores the selected slot and updates the downloader `storefront` setting.

## Notes

This project is intended for personal research and local use with accounts and subscriptions you are authorized to use. Respect Apple Music terms, copyright law and the licenses of upstream projects.
