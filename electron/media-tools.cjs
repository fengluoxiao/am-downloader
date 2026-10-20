const path = require('node:path');

// Use the same PATH for dependency checks and downloader children. Electron may
// have started before GPAC was installed, so also check its standard locations.
function mediaToolEnv(repoDir, userDataDir, base = process.env, platform = process.platform) {
  const env = { ...base };
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const pathKeys = Object.keys(env).filter((key) => windows ? key.toLowerCase() === 'path' : key === 'PATH');
  const inherited = pathKeys.map((key) => env[key]).filter(Boolean);
  for (const key of pathKeys) delete env[key];
  const dirs = [paths.join(userDataDir, 'tools', 'gpac'), repoDir];
  if (windows) {
    for (const key of ['ProgramW6432', 'ProgramFiles', 'ProgramFiles(x86)']) {
      if (base[key]) dirs.push(paths.join(base[key], 'GPAC'));
    }
  }
  const home = windows ? base.USERPROFILE : base.HOME;
  if (home) dirs.push(paths.join(home, '.cargo', 'bin'));
  env[windows ? 'Path' : 'PATH'] = [...dirs, ...inherited].join(windows ? ';' : ':');
  return env;
}

module.exports = { mediaToolEnv };
