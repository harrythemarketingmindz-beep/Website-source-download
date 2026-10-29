# Page Source Saver

A dependency-free Chrome/Edge Manifest V3 extension that saves the active page's rendered HTML and accessible frontend assets into a ZIP.

## Install

1. Open Chrome's Extensions page or Edge's Extensions page.
2. Enable **Developer mode**, choose **Load unpacked**, and select this repository's `extension` folder.
3. Open a regular HTTP/HTTPS website, click the extension, and select **Download page source**.
4. Allow website access when prompted. Keep the popup open until the download starts.

The extension requests optional HTTP/HTTPS host access because styles, images, and fonts often live on separate domains. Access is used only for an explicit capture. You can revoke it in browser extension settings. No analytics or external upload service is used. Asset requests omit login credentials. The captured DOM may still contain personal content visible on the page; review archives before sharing.

## What is saved

### DevTools Sources export (v1.1)

To export files like those listed in **DevTools → Sources**, open the website, open DevTools, and select the **Save Sources** panel (it may be under the `»` menu). Scroll and interact with the website to load the resources you want, then click **Download loaded sources**. If the panel is missing after installing/updating the extension, close and reopen DevTools.

This uses Chrome's DevTools resource API to save content the browser exposes, including resources from other domains and frames, dynamically loaded scripts, and fonts. Files retain their original contents and are grouped by domain under `sources/`. `sources-report.json` maps original URLs to saved paths and lists skipped resources. No additional host permission or refetch is needed in this mode. It may contain authenticated/session-specific content already loaded by the browser; review before sharing.

It cannot discover every public file on the server. Only currently exposed resources are included; virtual source-map entries and unavailable response bodies are not guaranteed. Load the page with DevTools open for best coverage. URLs/imports are not rewritten in this mode, so the export is for inspecting source files rather than offline playback. Limits: 400 files, 15 MB per file, 80 MB total; 12-second timeout per resource.

### Popup page snapshot

- A snapshot of the current rendered document, with local references to successfully downloaded assets.
- Linked stylesheets, nested CSS URL references, scripts, displayed images, linked icons, fonts referenced in CSS, and directly referenced media within limits.
- `capture-report.json` with errors, limits, and capture metadata.

This cannot download server-side code (PHP, databases, backend services), bypass access controls, or guarantee a working offline clone. It captures one page, not an entire domain. Iframes, shadow roots, canvas, runtime state, dynamically requested assets, and JavaScript module dependencies are not recursively captured. Responsive image alternatives are omitted in favor of the displayed image. CSS uses a lightweight URL rewriter; unusual CSS syntax may need manual adjustment. Requests can fail due to authentication, hotlink protection, or browser restrictions; failed assets retain their original URLs. Scripts and navigation can still contact live services. Save only content you are authorized to copy.

Limits: 400 assets, 15 MB per asset, 80 MB total downloaded asset data, 12-second timeout per asset. ZIP files use uncompressed entries to avoid dependencies. Long captures require keeping the popup open.

## Develop and validate

Node.js 20+ and Python 3 are sufficient; no dependency installation is required.

```sh
npm test
npm run build
```

An additional Chromium fixture test is available with `python3 tests/browser_smoke.py` when Python Playwright and `/usr/bin/chromium` are installed. It runs the popup in a real browser with mocked Chrome extension APIs; it verifies archive contents, nested CSS rewriting, and missing-asset reporting, but does not validate actual extension permission prompts or Chrome downloads integration.

The build creates `dist/page-source-saver.zip`, suitable for unpacking and loading as an extension. This is not a signed store release.

Manual browser smoke check: load the extension, save a page containing CSS/images/scripts, extract the archive, and serve the extracted folder with `python3 -m http.server 8000`. Check that the HTML and available assets load, and that failures appear in the report. Also check permission denial, a browser-internal tab, and a protected asset. Browser integration requires a graphical Chrome/Edge session.
