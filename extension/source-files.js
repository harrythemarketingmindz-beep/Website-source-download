// A leading numeric folder prevents collisions between query variants and sanitized paths.
export function sourcePath(raw, index) {
  const url = new URL(raw);
  if (!['http:', 'https:', 'blob:', 'data:'].includes(url.protocol)) return null;
  const clean = value => value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+$/, '_').slice(0, 100);
  const parts = url.pathname.split('/').filter(Boolean).map(clean);
  if (!parts.length || url.pathname.endsWith('/')) parts.push('index.html');
  return `sources/${clean(url.host || url.protocol.slice(0, -1))}/${String(index).padStart(4, '0')}/${parts.join('/')}`;
}

export function sourceBytes(content, encoding) {
  if (encoding === 'base64') return Uint8Array.from(atob(content), char => char.charCodeAt(0));
  if (encoding) throw new Error(`Unsupported encoding: ${encoding}`);
  return new TextEncoder().encode(content);
}
