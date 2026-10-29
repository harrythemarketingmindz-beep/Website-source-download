export function webUrl(value, base) {
  try { const u = new URL(value, base); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; }
}
export function assetPath(url, index) {
  const name = new URL(url).pathname.split('/').pop() || 'resource';
  return `assets/${String(index).padStart(4, '0')}-${name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100)}`;
}
// Collect both CSS url() references and quoted @import rules.
export function cssReferences(css) {
  const refs = [];
  const pattern = /url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s)'"\n]+))\s*\)|@import\s+(?:"([^"\n]+)"|'([^'\n]+)')/gi;
  for (const match of css.matchAll(pattern)) {
    const value = match.slice(1).find(v => v !== undefined);
    const start = match.index + match[0].indexOf(value);
    refs.push({ value, start, end: start + value.length });
  }
  return refs;
}
export function rewriteCss(css, base, resolve) {
  for (const ref of cssReferences(css).reverse()) {
    const url = webUrl(ref.value, base);
    if (!url || ref.value.startsWith('#')) continue;
    const replacement = resolve(url);
    css = css.slice(0, ref.start) + replacement + css.slice(ref.end);
  }
  return css;
}
