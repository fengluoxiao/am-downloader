# AM Downloader

Apple Music Dolby Atmos downloader desktop GUI built with Electron, React and Vite.

This project is a desktop wrapper and workflow tool. The bundled downloader now uses [WorldObservationLog/apple-music-downloader](https://github.com/WorldObservationLog/apple-music-downloader) with wrapper-lite HTTP and the bundled Temari engine. The desktop workflow originally used [rahulhingve/apple-music-dolby-atmos-downloader](https://github.com/rahulhingve/apple-music-dolby-atmos-downloader). The Apple Music search experience integrates ideas and code paths from [fengluoxiao/amget](https://github.com/fengluoxiao/amget).

## Features

- Search Apple Music by song, album, compilation or artist.
- Add search results or pasted Apple Music links to a local download queue.
- Download Dolby Atmos, ALAC or AAC depending on the selected mode.
- Manage active downloads and download history with pause, resume, cancel and log viewing.
- Manage downloaded files in a separate file manager page with thumbnails and recycle-bin restore.
- Connect to wrapper-lite over HTTP, locally or on a 1Panel server.
- Start, stop and inspect a local wrapper-lite Docker container.
- Save multiple Apple ID wrapper account slots with independent storefront settings.
- Edit downloader configuration from a simple mode or raw YAML mode.
- Linux/Hyprland compatibility mode disables GPU compositing by default to avoid window freezes.

## Credits

This application stands on top of these projects:

- [rahulhingve/apple-music-dolby-atmos-downloader](https://github.com/rahulhingve/apple-music-dolby-atmos-downloader) for the original Apple Music Dolby Atmos downloader and wrapper workflow.
- [WorldObservationLog/apple-music-downloader](https://github.com/WorldObservationLog/apple-music-downloader), [wrapper](https://github.com/WorldObservationLog/wrapper) and [Temari](https://github.com/WorldObservationLog/Temari) for the HTTP service and local decryption engine.
- [fengluoxiao/amget](https://github.com/fengluoxiao/amget) for Apple Music catalog search and Dolby Atmos result filtering.
- Electron, React, Vite, Playwright and lucide-react for the desktop app stack.

## Requirements

- Node.js 20 or newer.
- A logged-in wrapper-lite HTTP service (default `http://127.0.0.1:12340`). Docker is required only when managing the service on this computer.
- MP4Box available in `PATH`.
- A valid Apple Music subscription for the account used with the wrapper.

MP4Box runs on the computer running this desktop app, including when wrapper-lite is on a 1Panel server. On Windows, install [GPAC](https://gpac.io/downloads/) (for example, `winget install --id GPAC.GPAC --exact`). The app also checks the standard `Program Files/GPAC` directories and its own `tools/gpac` directory inside the app user data folder. A portable copy must include MP4Box's supporting DLLs. Dependency checks and download processes use the same search path; missing MP4Box is reported before downloading begins.

For a 1Panel server, follow the [完整创建与连接流程](docs/1panel-wrapper-lite.md). A copyable Compose file is in [deploy/1panel/compose.yaml](deploy/1panel/compose.yaml).

For local Docker management, build the image as `wrapper-lite:local`. The app uses this data directory:

```bash
~/tools/wrapper-lite/rootfs/data
```

Both development and packaged builds copy the bundled downloader into the writable app user data directory and refresh its binary on upgrades, preserving configuration. `AM_DL_REPO` can point to an external directory containing a compatible HTTP/Temari downloader and `config.yaml`. Windows uses `apple-music-dl.exe`; Linux uses `apple-music-dl` (bundled builds target x86_64).

Old TCP connection keys are migrated automatically, with the original configuration backed up as `config.yaml.pre-wrapper-lite.bak`. New local accounts use `wrapper-lite-accounts`; sign in again rather than reusing old wrapper sessions.

## Development

Install dependencies:

```bash
npm install
```

On PowerShell systems that block `npm.ps1`, use `npm.cmd i`. To rebuild the bundled Linux and Windows downloaders from the pinned upstream revision (Git and Go 1.23.1+ required):

```bash
npm run build:downloader
```

The script tests the HTTP client and Temari decryption against upstream golden vectors before building. `AM_GO` can specify a Go executable; standard Go settings such as `GOPROXY` are respected. The source revision and binary SHA-256 hashes are recorded in `build-res/repo/downloader-version.json`.

Run in development mode:

```bash
npm run dev
```

Build the renderer and run the app:

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
2. For 1Panel, select the remote connection, enter `http://SERVER:12340`, then save and check the connection. Complete Apple ID login and 2FA in 1Panel.
3. For local Docker, create or select an account slot, log in and start wrapper-lite. Confirm the HTTP interface and account region are ready.
4. Search Apple Music or paste links on the Download page.
5. Add items to the queue and watch progress in Download Management.
6. Browse completed files from File Management.

## Account Slots

Local Docker supports multiple account slots. Each slot stores its own wrapper-lite data and storefront value. Switching accounts stops the current service, saves the current slot, restores the selected slot and updates the downloader `storefront` setting. Remote accounts are managed on the 1Panel server.

## Notes

This project is intended for personal research and local use with accounts and subscriptions you are authorized to use. Respect Apple Music terms, copyright law and the licenses of upstream projects.
