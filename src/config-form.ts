import { load } from 'js-yaml';

export interface ConfigEntry { key: string; value: string; comment: string; line: number }
export const KEY_RE = /^([A-Za-z0-9][A-Za-z0-9_-]*):\s*(.*)$/;

function scalarAndComment(value: string) {
  let quote = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quote === '"' && char === '\\') { i++; continue; }
    if (quote === "'" && char === "'" && value[i + 1] === "'") { i++; continue; }
    if (quote && char === quote) { quote = ''; continue; }
    if (!quote && (char === '"' || char === "'") && value.slice(0, i).trim() === '') { quote = char; continue; }
    if (!quote && char === '#' && (i === 0 || /\s/.test(value[i - 1]))) {
      return { scalar: value.slice(0, i).trim(), comment: value.slice(i) };
    }
  }
  return { scalar: value.trim(), comment: '' };
}

export function parseEntries(raw: string): ConfigEntry[] {
  return raw.split('\n').flatMap((line, i) => {
    const match = line.match(KEY_RE);
    if (!match) return [];
    const { scalar, comment } = scalarAndComment(match[2]);
    return [{ key: match[1], value: scalar, comment: comment.replace(/^#\s?/, ''), line: i }];
  });
}

export function unquote(value: string) {
  try {
    const parsed = load(value);
    if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean') return String(parsed);
  } catch {}
  const quoted = value.match(/^"(.*)"$/) || value.match(/^'(.*)'$/);
  return quoted ? quoted[1] : value;
}

export function applyValues(raw: string, values: Record<string, string>) {
  return raw.split('\n').map((line) => {
    const match = line.match(KEY_RE);
    if (!match || !(match[1] in values)) return line;
    const { scalar, comment } = scalarAndComment(match[2]);
    const value = values[match[1]];
    const typed = (/^(true|false)$/.test(scalar) && /^(true|false)$/.test(value)) ||
      (/^-?\d+(?:\.\d+)?$/.test(scalar) && /^-?\d+(?:\.\d+)?$/.test(value));
    // JSON strings are valid YAML scalars and escape backslashes, quotes and
    // control characters without changing drive letters or UNC paths.
    return `${match[1]}: ${typed ? value : JSON.stringify(value)}${comment ? ` ${comment}` : ''}`;
  }).join('\n');
}
