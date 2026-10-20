// Older GUI versions put Windows paths into YAML double quotes without
// escaping backslashes. Repair only known path fields, including \t/\n which
// otherwise parse successfully but silently turn into control characters.
function normalizeWindowsPaths(raw) {
  return raw.replace(/^((?:alac-save-folder|atmos-save-folder|aac-save-folder|mv-save-folder|ffmpeg-path|temari-lib):[ \t]*)"((?:\\.|[^"\r\n])*)"([ \t]*(?:#[^\r\n]*)?)(?=\r?$)/gm,
    (line, prefix, value, suffix) => {
      if (!/^(?:[A-Za-z]:[\\/]|\\\\)/.test(value)) return line;
      let unescaped = false;
      for (let i = 0; i < value.length; i++) {
        if (value[i] !== '\\') continue;
        if (value[i + 1] === '\\' || value[i + 1] === '"') i++;
        else { unescaped = true; break; }
      }
      return unescaped ? `${prefix}${JSON.stringify(value)}${suffix}` : line;
    });
}

module.exports = { normalizeWindowsPaths };
