import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeZip, crc32 } from '../extension/zip.js';
import { assetPath, rewriteCss, webUrl } from '../extension/resources.js';
import { sourcePath, sourceBytes } from '../extension/source-files.js';

test('DevTools paths group domains and safely distinguish query variants', () => {
  assert.equal(sourcePath('https://cdn.example.com/js/app.js?v=1', 1), 'sources/cdn.example.com/0001/js/app.js');
  assert.notEqual(sourcePath('https://cdn.example.com/js/app.js?v=1', 1), sourcePath('https://cdn.example.com/js/app.js?v=2', 2));
  assert.equal(sourcePath('https://example.com/', 3), 'sources/example.com/0003/index.html');
  assert.equal(sourcePath('chrome-extension://abc/script.js', 1), null);
  assert.ok(!sourcePath('https://example.com/%2e%2e/thing', 1).split('/').includes('..'));
});

test('DevTools content decoding preserves binary bytes and Unicode', () => {
  assert.deepEqual(sourceBytes('AP+A', 'base64'), new Uint8Array([0, 255, 128]));
  assert.equal(new TextDecoder().decode(sourceBytes('hello 🌍', '')), 'hello 🌍');
  assert.throws(() => sourceBytes('x', 'unsupported'));
});

test('ZIP can be read and CRC-verified by an independent implementation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'source-saver-'));
  try {
    const files = new Map([['index.html', '<h1>Hello 🌍</h1>'], ['assets/é.bin', new Uint8Array([0, 255, 128, 42])], ['empty', '']]);
    writeFileSync(join(dir, 'capture.zip'), Buffer.from(await makeZip(files).arrayBuffer()));
    execFileSync('python3', ['-c', `import zipfile,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert z.read('index.html').decode() == '<h1>Hello 🌍</h1>'
 assert z.read('assets/é.bin') == bytes([0,255,128,42])
 assert z.read('empty') == b''
 assert len(z.namelist()) == 3`, join(dir, 'capture.zip')]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('CRC32 uses the standard polynomial and unsafe paths are rejected', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.throws(() => makeZip(new Map([['../escape', 'x']])));
});
test('CSS resolves nested resources, imports, queries, and preserves inline data/fragments', () => {
  const input = '@import "theme.css"; a{background:url(../img/a.png?v=2);mask:url(#mask)} b{src:url("data:font/woff;base64,AA")}';
  const seen = [];
  const output = rewriteCss(input, 'https://example.org/css/main.css', url => { seen.push(url.href); return 'local/' + url.pathname.split('/').pop(); });
  assert.ok(output.includes('@import "local/theme.css"'));
  assert.ok(output.includes('url(local/a.png)'));
  assert.ok(output.includes('url(#mask)'));
  assert.ok(output.includes('data:font/woff;base64,AA'));
  assert.deepEqual(seen.sort(), ['https://example.org/css/theme.css', 'https://example.org/img/a.png?v=2'].sort());
});
test('resource paths are unique by index and do not expose query strings', () => {
  assert.notEqual(assetPath('https://x.test/a.png?q=1', 1), assetPath('https://x.test/a.png?q=2', 2));
  assert.equal(assetPath('https://x.test/a.png?secret=value', 1), 'assets/0001-a.png');
  assert.equal(webUrl('javascript:alert(1)', 'https://x.test'), null);
  assert.equal(webUrl('/a', 'https://x.test').href, 'https://x.test/a');
});
