const DEFAULT_URL = 'http://127.0.0.1:12340';
const { normalizeWindowsPaths } = require('./config-paths.cjs');

function normalizeWrapperUrl(value = DEFAULT_URL) {
  const url = new URL(String(value).trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('请输入 HTTP/HTTPS 服务地址，例如 http://192.168.1.10:12340');
  }
  return url.toString().replace(/\/+$/, '');
}

function connectionSettings(config) {
  return {
    mode: config['wrapper-mode'] === 'remote' ? 'remote' : 'local',
    url: normalizeWrapperUrl(config['wrapper-lite-url'] || DEFAULT_URL),
  };
}

async function probeWrapper(url, timeout = 3000) {
  try {
    const response = await fetch(`${normalizeWrapperUrl(url)}/status`, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body.code !== 0 || !Array.isArray(body.data?.regions) || !body.data.regions.every((r) => typeof r === 'string')) {
      throw new Error(body.msg && body.code !== 0 ? body.msg : '响应不是 wrapper-lite /status 格式');
    }
    return { ok: true, regions: body.data.regions, error: '' };
  } catch (error) {
    return { ok: false, regions: [], error: `wrapper-lite 连接失败：${error.message}` };
  }
}

// Preserve download paths and quality preferences while removing obsolete TCP settings.
function migrateConfig(raw) {
  let next = normalizeWindowsPaths(raw).replace(/^(?:decrypt-m3u8-port|get-m3u8-port|get-m3u8-from-device):[^\r\n]*(?:\r?\n|$)/gm, '');
  if (!/^station-token:/m.test(next) && /^media-user-token:/m.test(next)) {
    next = next.replace(/^media-user-token:/m, 'station-token:');
  }
  next = next.replace(/^media-user-token:[^\r\n]*(?:\r?\n|$)/gm, '');
  const defaults = { 'wrapper-lite-url': DEFAULT_URL, 'wrapper-mode': 'local', 'temari-lib': '', 'station-token': '' };
  for (const [key, value] of Object.entries(defaults)) {
    if (!new RegExp(`^${key}:`, 'm').test(next)) next += `\n${key}: ${JSON.stringify(value)}\n`;
  }
  return next;
}

module.exports = { DEFAULT_URL, normalizeWrapperUrl, connectionSettings, probeWrapper, migrateConfig };
