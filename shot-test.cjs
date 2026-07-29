const { app, BrowserWindow } = require('electron');
const path = require('path');
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1200, height: 800, show: false, webPreferences: { preload: path.join('/home/fengluoxiao/文档/Codex/2026-07-23/rahulhingve-apple-music-dolby-atmos-downloader/app', 'electron/preload.cjs'), contextIsolation: true } });
  win.loadFile(path.join('/home/fengluoxiao/文档/Codex/2026-07-23/rahulhingve-apple-music-dolby-atmos-downloader/app', 'dist/index.html'));
  setTimeout(async () => {
    const info = await win.webContents.executeJavaScript(`({len: document.body.innerHTML.length, cards: document.querySelectorAll('.ant-card').length, theme: document.body.dataset.theme})`);
    console.log('INFO', JSON.stringify(info));
    const img = await win.webContents.capturePage();
    require('fs').writeFileSync('/tmp/am-shot2.png', img.toPNG());
    app.quit();
  }, 5000);
});
