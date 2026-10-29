import { makeZip } from './zip.js';
import { sourcePath, sourceBytes } from './source-files.js';

const button = document.querySelector('#export');
const status = document.querySelector('#status');
const MAX_FILES = 400, MAX_FILE_BYTES = 15 * 1024 * 1024, MAX_BYTES = 80 * 1024 * 1024;

function readContent(resource) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Content retrieval timed out')), 12000);
    resource.getContent((content, encoding) => {
      clearTimeout(timer);
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else if (typeof content !== 'string') reject(new Error('Browser did not expose resource content'));
      else {
        try { resolve(sourceBytes(content, encoding)); } catch (error) { reject(error); }
      }
    });
  });
}

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    status.textContent = 'Reading DevTools resource list…';
    const resources = await new Promise(resolve => chrome.devtools.inspectedWindow.getResources(resolve));
    const unique = [...new Map(resources.map(resource => [resource.url, resource])).values()];
    const files = new Map(), entries = [];
    let total = 0, attempted = 0;
    for (const resource of unique) {
      const entry = { url: resource.url };
      entries.push(entry);
      try {
        const path = sourcePath(resource.url, attempted + 1);
        if (!path) throw new Error('Unsupported browser or virtual URL');
        if (attempted >= MAX_FILES) throw new Error('400-file limit reached');
        attempted++;
        if (total >= MAX_BYTES) throw new Error('80 MB archive limit reached');
        status.textContent = `Reading resource ${attempted} of ${unique.length}…`;
        const bytes = await readContent(resource);
        if (bytes.length > MAX_FILE_BYTES) throw new Error('Resource exceeds 15 MB');
        if (total + bytes.length > MAX_BYTES) throw new Error('80 MB archive limit reached');
        files.set(path, bytes); total += bytes.length;
        entry.path = path; entry.bytes = bytes.length; entry.status = 'saved';
      } catch (error) { entry.status = 'skipped'; entry.reason = error.message; }
    }
    const saved = files.size;
    if (!saved) throw new Error('No readable resources found. Reload the website with DevTools open and try again.');
    files.set('sources-report.json', JSON.stringify({
      capturedAt: new Date().toISOString(), mode: 'devtools-loaded-resources',
      saved, skipped: entries.length - saved, entries,
      limitations: 'Only resources exposed by Chrome DevTools at export time. No backend code or discovery of unloaded files. Virtual source-map originals may be absent. Content comes from the current browser session and can include authenticated data. Files retain original contents; imports and URLs are not rewritten for offline playback.'
    }, null, 2));
    files.set('README.txt', 'LOADED WEBSITE SOURCES\n\nFiles are grouped by domain under sources/. Numeric folders distinguish resource URLs and query variants. See sources-report.json for the original URL of every saved file and all skipped resources.\n\nThese are original browser-exposed resource contents, not an offline website clone. No URLs or imports are rewritten. Content may include session-specific information; review before sharing.\n');
    const blobUrl = URL.createObjectURL(makeZip(files));
    try {
      await chrome.downloads.download({ url: blobUrl, filename: 'website-loaded-sources.zip', saveAs: true });
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (error) { URL.revokeObjectURL(blobUrl); throw error; }
    status.textContent = `Download started: ${saved} files, ${entries.length - saved} skipped. See sources-report.json.`;
  } catch (error) { status.textContent = `Could not export: ${error.message}`; }
  finally { button.disabled = false; }
});
