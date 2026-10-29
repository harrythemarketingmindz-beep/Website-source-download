"""Browser-level capture smoke test; requires Python Playwright and Chromium."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from io import BytesIO
import base64
import zipfile
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        fixtures = {
            '/fixture/main.css': ('text/css', b'@import "nested.css";h1{background:url(pixel.svg)}'),
            '/fixture/nested.css': ('text/css', b'h1{color:green}'),
            '/fixture/pixel.svg': ('image/svg+xml', b'<svg xmlns="http://www.w3.org/2000/svg"/>'),
            '/fixture/app.js': ('text/javascript', b'console.log("fixture")'),
        }
        if self.path in fixtures:
            mime, body = fixtures[self.path]
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(root)))
Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = browser.new_page()
        page.add_init_script("""window.chrome = {
          tabs: {query: async () => [{id: 1, url: location.origin + '/fixture/page'}]},
          permissions: {request: async () => true},
          scripting: {executeScript: async () => [{result: {
            url: location.origin + '/fixture/page', base: location.origin + '/fixture/page', title: 'Fixture',
            html: '<html><head><link rel="stylesheet" href="main.css"></head><body><h1>Captured page</h1><img src="pixel.svg"><script src="app.js"></script><img src="missing.png"></body></html>'
          }}]},
          downloads: {download: async ({url}) => {
            const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
            let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
            window.savedZip = btoa(binary); return 1;
          }}
        };""")
        page.goto(base + '/extension/popup.html')
        page.locator('#save').click()
        page.wait_for_function('window.savedZip', timeout=30000)
        with zipfile.ZipFile(BytesIO(base64.b64decode(page.evaluate('window.savedZip')))) as z:
            assert z.testzip() is None
            html = z.read('index.html').decode()
            assert 'assets/0004-main.css' in html
            assert 'assets/0001-pixel.svg' in html
            assert 'assets/0002-app.js' in html
            assert base + '/fixture/missing.png' in html
            css = z.read('assets/0004-main.css').decode()
            assert '0005-nested.css' in css and '0001-pixel.svg' in css
            import json
            report = json.loads(z.read('capture-report.json'))
            assert report['savedAssets'] == 4
            assert len(report['warnings']) == 1
            assert report['warnings'][0]['reason'] == 'HTTP 404'
        page.screenshot(path=str(root / 'dist' / 'popup.png'))
        browser.close()
        print('PASS: browser capture, nested CSS, asset rewriting, missing-asset report, and ZIP contents')
finally:
    server.shutdown()
