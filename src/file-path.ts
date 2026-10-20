export function joinPath(base: string, parts: string[]) {
  if (!parts.length) return base;
  const separator = base.includes('\\') ? '\\' : '/';
  return base.replace(/[\\/]+$/, '') + separator + parts.join(separator);
}

export function relativeParts(base: string, current: string) {
  const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const root = normalize(base);
  const target = normalize(current);
  const windows = /^[a-z]:/i.test(root) || root.startsWith('//');
  const comparableRoot = windows ? root.toLowerCase() : root;
  const comparableTarget = windows ? target.toLowerCase() : target;
  if (comparableTarget === comparableRoot) return [];
  if (!comparableTarget.startsWith(`${comparableRoot}/`)) return [];
  return target.slice(root.length + 1).split('/').filter(Boolean);
}
