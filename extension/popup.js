import { makeZip } from './zip.js';
import { webUrl, assetPath, rewriteCss } from './resources.js';

const button = document.querySelector('#save');
const status = document.querySelector('#status');
let tab;
try {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = webUrl(tab?.url);
  if (!url) throw new Error('Open an HTTP or HTTPS page to save its source.');
  document.querySelector('#page-name').textContent = url.hostname;
  button.disabled = false;
} catch (error) { status.textContent = error.message; }

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    // Permission requests must begin inside the user gesture.
    const granted = await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] });
    if (!granted) throw new Error('Website access is needed to fetch the page’s linked assets. Try again to allow access.');
    status.textContent = 'Capturing the current page…';
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const clone = document.documentElement.cloneNode(true);
        const images = document.querySelectorAll('img');
        clone.querySelectorAll('img').forEach((img, i) => {
          if (images[i].currentSrc) img.setAttribute('src', images[i].currentSrc);
        });
        // Do not embed live password or form values in the archive.
        clone.querySelectorAll('input').forEach(input => input.removeAttribute('value'));
        clone.querySelectorAll('textarea').forEach(input => input.textContent = '');
        return { html: '<!doctype html>\n' + clone.outerHTML, base: document.baseURI, url: location.href, title: document.title };
      }
    });
    if (!result?.result) throw new Error('This page cannot be captured. Try a regular website tab.');
    const snapshot = result.result;
    const doc = new DOMParser().parseFromString(snapshot.html, 'text/html');
    doc.querySelectorAll('base, meta[http-equiv="Content-Security-Policy" i]').forEach(el => el.remove());
    const files = new Map(), resources = new Map(), warnings = [];
    const MAX_FILES = 400, MAX_BYTES = 80 * 1024 * 1024, MAX_FILE = 15 * 1024 * 1024;
    let total = 0;
    function register(url, css = false) {
      const key = new URL(url); key.hash = '';
      if (!resources.has(key.href)) {
        if (resources.size >= MAX_FILES) return null;
        resources.set(key.href, { url: key.href, path: assetPath(key.href, resources.size + 1), css, ok: false });
      }
      const item = resources.get(key.href);
      item.css ||= css;
      return item;
    }
    function discoverCss(text, base) {
      rewriteCss(text, base, url => { register(url, /\.css(?:$|\?)/i.test(url.href)); return url.href; });
    }
    const attributes = [];
    function addAttribute(el, attr, css = false) {
      const raw = el.getAttribute(attr);
      if (!raw || raw.startsWith('#')) return;
      const url = webUrl(raw, snapshot.base);
      if (!url) return;
      register(url, css); attributes.push({ el, attr, url });
    }
    doc.querySelectorAll('script[src], img[src], source[src], video[poster], audio[src], video[src], input[type="image"][src], embed[src]').forEach(el => {
      addAttribute(el, el.hasAttribute('poster') ? 'poster' : 'src');
    });
    doc.querySelectorAll('link[href]').forEach(el => {
      if (/stylesheet|icon/i.test(el.rel)) addAttribute(el, 'href', el.relList.contains('stylesheet'));
      else el.remove(); // Preload hints would otherwise keep fetching remote assets.
    });
    // currentSrc above preserves the displayed responsive image; alternative candidates are omitted.
    doc.querySelectorAll('[srcset]').forEach(el => {
      if (el.tagName === 'SOURCE' && el.parentElement?.tagName === 'PICTURE') el.remove();
      else el.removeAttribute('srcset');
    });
    const styles = [...doc.querySelectorAll('style')].map(el => ({ el, text: el.textContent, attr: false }));
    doc.querySelectorAll('[style]').forEach(el => styles.push({ el, text: el.getAttribute('style'), attr: true }));
    for (const style of styles) discoverCss(style.text, snapshot.base);
    for (const item of resources.values()) {
      status.textContent = `Fetching ${[...resources.values()].filter(r => r.done).length + 1} of ${resources.size} assets…`;
      try {
        if (total >= MAX_BYTES) throw new Error('Archive size limit reached');
        const response = await fetch(item.url, { credentials: 'omit', signal: AbortSignal.timeout(12000), referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (Number(response.headers.get('content-length')) > MAX_FILE) throw new Error('Asset exceeds 15 MB');
        const reader = response.body.getReader(), chunks = [];
        let size = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > MAX_FILE || total + size > MAX_BYTES) throw new Error('Asset or archive size limit reached');
            chunks.push(value);
          }
        } catch (error) { await reader.cancel(); throw error; }
        const bytes = new Uint8Array(size);
        let cursor = 0;
        for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
        total += size;
        item.css ||= /text\/css/i.test(response.headers.get('content-type') || '');
        if (item.css) {
          item.text = new TextDecoder().decode(bytes); item.base = response.url;
          discoverCss(item.text, item.base);
        } else files.set(item.path, bytes);
        item.ok = true;
      } catch (error) { warnings.push({ url: item.url, reason: error.message }); }
      item.done = true;
    }
    function local(url, inCss = false) {
      const key = new URL(url); key.hash = '';
      const item = resources.get(key.href);
      return item?.ok ? (inCss ? item.path.slice(7) : item.path) + url.hash : url.href;
    }
    for (const item of resources.values()) {
      if (item.ok && item.css) files.set(item.path, rewriteCss(item.text, item.base, url => local(url, true)));
    }
    for (const { el, attr, url } of attributes) {
      el.setAttribute(attr, local(url));
      // Content was rewritten or downloaded, so original integrity metadata may no longer apply.
      el.removeAttribute('integrity'); el.removeAttribute('crossorigin');
    }
    for (const { el, text, attr } of styles) {
      const rewritten = rewriteCss(text, snapshot.base, url => local(url));
      if (attr) el.setAttribute('style', rewritten); else el.textContent = rewritten;
    }
    doc.querySelectorAll('a[href], area[href], iframe[src], form[action]').forEach(el => {
      const attr = el.hasAttribute('href') ? 'href' : el.hasAttribute('action') ? 'action' : 'src';
      const raw = el.getAttribute(attr);
      const url = webUrl(raw, snapshot.base);
      if (url && !raw.startsWith('#')) el.setAttribute(attr, url.href);
    });
    files.set('index.html', '<!doctype html>\n' + doc.documentElement.outerHTML);
    files.set('capture-report.json', JSON.stringify({
      source: snapshot.url, title: snapshot.title, capturedAt: new Date().toISOString(),
      savedAssets: [...resources.values()].filter(r => r.ok).length, attemptedAssets: resources.size,
      limits: { maxFiles: MAX_FILES, maxAssetBytes: MAX_FILE, maxArchiveAssetBytes: MAX_BYTES },
      assetLimitReached: resources.size >= MAX_FILES, warnings,
      limitations: 'Single rendered page only. No backend source, iframe contents, shadow DOM, canvas pixels, runtime state, JS module dependency crawling, or guaranteed offline functionality. Failed assets retain remote URLs. Requests omit credentials. Scripts may still contact live services.'
    }, null, 2));
    files.set('README.txt', 'PAGE SOURCE SAVER\n\nExtract this archive. Serve the folder with a local HTTP server (for example: python3 -m http.server 8000) and open index.html.\n\nThis is a frontend snapshot, not a full website backup. Read capture-report.json for skipped files and limits. JavaScript may contact the original services. Only save content you are permitted to copy.\n');
    status.textContent = 'Preparing ZIP…';
    const blobUrl = URL.createObjectURL(makeZip(files));
    try {
      await chrome.downloads.download({ url: blobUrl, filename: `${new URL(snapshot.url).hostname.replace(/[^a-zA-Z0-9.-]/g, '_')}-source.zip`, saveAs: true });
      status.textContent = `Download started: ${files.size - 3} assets. ${warnings.length} unavailable. See capture-report.json for details.`;
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (error) { URL.revokeObjectURL(blobUrl); throw error; }
  } catch (error) { status.textContent = `Could not save: ${error.message}`; }
  finally { button.disabled = false; }
});
