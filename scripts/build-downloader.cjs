// Build the pinned HTTP/Temari downloader; requires Git and Go 1.23.1 or newer.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const revision = 'f2573eaf680b5457aed1651c855a37dcb60e1261';
const source = 'https://ghclone.com/WorldObservationLog/apple-music-downloader.git';
const root = path.resolve(__dirname, '..');
const cache = path.join(root, '.cache', 'downloader-lite');
const output = path.join(root, 'build-res', 'repo');
const go = process.env.AM_GO || 'go';
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: 'inherit', windowsHide: true, ...options });
fs.mkdirSync(path.dirname(cache), { recursive: true });
if (!fs.existsSync(path.join(cache, '.git'))) run('git', ['clone', '--no-checkout', source, cache]);
run('git', ['fetch', '--depth', '1', 'origin', revision], { cwd: cache });
run('git', ['checkout', '--detach', revision], { cwd: cache });
run('git', ['restore', '--source', revision, '--', 'main.go', 'utils/runv4/runv4.go'], { cwd: cache });
// The upstream Go binding locates its DLL/SO via runtime.Caller in the Go module
// cache. Ship those libraries next to the executable and prefer that location,
// so a packaged app never depends on the developer's Go installation.
const enginePath = path.join(cache, 'utils', 'runv4', 'runv4.go');
let engine = fs.readFileSync(enginePath, 'utf8').replace(/\r\n/g, '\n');
const oldDefault = '\t\tlib, err = temarimod.LoadDefault()';
if (!engine.includes(oldDefault)) throw new Error('Upstream Temari initialization changed; review the packaging patch');
engine = engine.replace('\t"os"\n', '\t"os"\n\t"path/filepath"\n\t"runtime"\n');
engine = engine.replace(oldDefault, `
        executable, executableErr := os.Executable()
        name := "libtemari.so"
        if runtime.GOOS == "windows" { name = "temari.dll" }
        bundled := filepath.Join(filepath.Dir(executable), name)
        if _, statErr := os.Stat(bundled); executableErr == nil && statErr == nil {
            lib, err = temarimod.Load(bundled)
        } else {
            lib, err = temarimod.LoadDefault()
        }`);
fs.writeFileSync(enginePath, engine);
const mainPath = path.join(cache, 'main.go');
let main = fs.readFileSync(mainPath, 'utf8').replace(/\r\n/g, '\n');
if (!main.includes('func main() {')) throw new Error('Upstream entry point changed');
// Stable catalog IDs tie each successful output to its song, including album subsets.
main = main.replace('type AddedTrack struct {', 'type AddedTrack struct {\n\tTrackID string `json:"track_id"`');
const ripStart = main.indexOf('func ripTrack(');
const ripEnd = main.indexOf('\nfunc ripStation(', ripStart);
const ripSource = main.slice(ripStart, ripEnd);
if ((ripSource.match(/AddedTrack\{/g) || []).length !== 3) throw new Error('Upstream track receipts changed');
main = main.slice(0, ripStart) + ripSource.replace(/AddedTrack\{/g, 'AddedTrack{TrackID: track.ID,') + main.slice(ripEnd);
// Keep all media editing off network shares and isolate each track's tag temps.
main = main.replace('\t"main/utils/task"', '\t"main/utils/task"\n\t"main/utils/stagedoutput"');
const stageAnchor = '\tif needDlAacLc {\n\t\tif !wrapperlite.Default.Ready() {';
if (!main.includes(stageAnchor)) throw new Error('Upstream download staging point changed');
main = main.replace(stageAnchor, `
    staged, stageErr := stagedoutput.New(trackPath)
    if stageErr != nil { fmt.Println("Failed to prepare local output:", stageErr); counter.Error++; return }
    defer staged.Close()
    trackPath = staged.Path

${stageAnchor}`);
const tagAnchor = '\tmp4, err := mp4tag.Open(track.SavePath)';
const tagEnd = '\treturn nil\n}\n\nfunc main()';
if (!main.includes(tagAnchor) || !main.includes(tagEnd)) throw new Error('Upstream metadata writer changed');
main = main.replace(tagAnchor, '\treturn stagedoutput.RetryIO(func() error {\n' + tagAnchor);
main = main.replace(tagEnd, '\treturn nil\n\t})\n}\n\nfunc main()');
const convertAnchor = '\t// CONVERSION FEATURE hook\n\tconvertIfNeeded(track)';
if (!main.includes(convertAnchor)) throw new Error('Upstream final output point changed');
main = main.replace(convertAnchor, `${convertAnchor}
    published, publishErr := staged.Commit(track.SavePath)
    if publishErr != nil { fmt.Println("Failed to publish completed track:", publishErr); counter.Error++; return }
    track.SavePath = published
    track.SaveName = filepath.Base(published)`);
main = main.replace('func main() {', `func main() {
    if len(os.Args) == 2 && os.Args[1] == "--self-test" {
        if err := runv4.Init(""); err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
        fmt.Println("wrapper-lite + Temari ready")
        return
    }`);
fs.writeFileSync(mainPath, main);
const patchDir = path.join(root, 'scripts', 'downloader-patches', 'stagedoutput');
const stagedPackage = path.join(cache, 'utils', 'stagedoutput');
fs.mkdirSync(stagedPackage, { recursive: true });
for (const name of fs.readdirSync(patchDir)) fs.copyFileSync(path.join(patchDir, name), path.join(stagedPackage, name));
fs.copyFileSync(path.join(root, 'scripts', 'downloader-patches', 'tagging_integration_test.go'), path.join(cache, 'tagging_integration_test.go'));
run(go, ['fmt', './utils/stagedoutput'], { cwd: cache });
// Includes real Temari decryption golden vectors and the HTTP client contract.
run(go, ['test', './utils/wrapperlite', './utils/runv4', './utils/stagedoutput'], { cwd: cache });
if (process.env.AM_TEST_MP4BOX) {
  run(go, ['test', '-count=1', '-tags=stagingintegration', 'main.go', 'tagging_integration_test.go'], { cwd: cache });
}
fs.mkdirSync(output, { recursive: true });
const hashes = {};
const moduleDir = execFileSync(go, ['list', '-m', '-f', '{{.Dir}}', 'github.com/WorldObservationLog/Temari/bindings/go'], { cwd: cache, encoding: 'utf8', windowsHide: true }).trim();
for (const [platform, name] of [['linux-x86_64', 'libtemari.so'], ['windows-x86_64', 'temari.dll']]) {
  const destination = path.join(output, name);
  const bundledLibrary = fs.readFileSync(path.join(moduleDir, 'lib', platform, name));
  if (!fs.existsSync(destination) || !fs.readFileSync(destination).equals(bundledLibrary)) {
    if (fs.existsSync(destination)) fs.chmodSync(destination, 0o644);
    fs.writeFileSync(destination, bundledLibrary);
  }
  hashes[name] = crypto.createHash('sha256').update(fs.readFileSync(path.join(output, name))).digest('hex');
}
for (const [os, name] of [['linux', 'apple-music-dl'], ['windows', 'apple-music-dl.exe']]) {
  run(go, ['build', '-trimpath', '-ldflags=-s -w', '-o', path.join(output, name), '.'], {
    cwd: cache, env: { ...process.env, GOOS: os, GOARCH: 'amd64', CGO_ENABLED: '0' },
  });
  hashes[name] = crypto.createHash('sha256').update(fs.readFileSync(path.join(output, name))).digest('hex');
}
fs.writeFileSync(path.join(output, 'downloader-version.json'), JSON.stringify({ source, revision, temari: 'v0.3.0', packagingPatch: 'Load Temari beside executable; offline --self-test; track IDs in JSON receipts; local media staging and atomic publication with sharing-violation retries', architecture: 'amd64', hashes }, null, 2) + '\n');
const selfTestName = process.platform === 'win32' ? 'apple-music-dl.exe' : 'apple-music-dl';
if (process.arch === 'x64' && ['linux', 'win32'].includes(process.platform)) run(path.join(output, selfTestName), ['--self-test']);
