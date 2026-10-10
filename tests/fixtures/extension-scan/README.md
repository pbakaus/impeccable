# Extension scanner smoke test

These pages test extension startup and scan delivery, including on pages whose
CSP blocks page scripts and WebAssembly. `flagged.html` should report one
`low-contrast` finding for `p.faint`; `clean.html` should report no findings.

Build with `bun run build:extension`, then serve this directory:

```sh
python3 -m http.server 8337 --bind 127.0.0.1 --directory tests/fixtures/extension-scan
```

For Firefox, temporarily load `dist/extension-firefox/manifest.json` through
`about:debugging`, or use Mozilla's `web-ext`:

```sh
web-ext run --source-dir dist/extension-firefox --start-url http://127.0.0.1:8337/flagged.html
```

For Chrome, load the unpacked `extension/` directory in `chrome://extensions`.

In each browser:

1. Open `flagged.html`, open the extension popup, and click **Scan page**.
   Expect one finding and an overlay on the pale paragraph, with no startup error.
2. Scan again. Expect the same result without duplicate overlays.
3. Follow the link to `clean.html` and explicitly scan. Expect zero findings
   and no error (zero before a scan is not proof of successful scanning).
4. Navigate back to `flagged.html` and scan. Expect one finding again.
5. In Chrome, close and reopen the browser, then repeat the first scan.
   Firefox removes temporary extensions when it closes: reopen Firefox and load
   the extension again through `about:debugging`, or rerun `web-ext run`, then
   repeat the first scan. This exercises a cold core startup in each browser.

The released Firefox 1.4.0 artifact fails at step 1 with the
`OFFSCREEN_DOCUMENT` error from issue #847. Test desktop Firefox and Chrome
separately; the shared detector bundle does not make their hosting APIs identical.
