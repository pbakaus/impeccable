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
   Expect a low-contrast finding and an overlay on the pale paragraph, with no startup error. Additional advisories can depend on viewport width.
2. Use Tab to focus **Copy all findings**, then press Enter. Expect a visible
   “Copied findings” message. Paste into a plain text editor. The report must
   name the scanned URL, show the same total count as the popup, and include the low-contrast
   detail and the pale paragraph's selector. Repeat with Space.
3. Scan again. Copy must be disabled while scanning, then become available with
   the same report and no duplicate overlays.
4. Follow the link to `clean.html` and explicitly scan. Expect zero findings
   and no error (zero before a scan is not proof of successful scanning).
   **Copy all findings** must be disabled until this scan completes. After it
   completes, copy and paste the report: it must name `clean.html`, show
   `Total findings: 0`, and say no anti-patterns were found.
5. Navigate back to `flagged.html` and scan. Expect the low-contrast finding again.
6. In Chrome, close and reopen the browser, then repeat the first scan.
   Firefox removes temporary extensions when it closes: reopen Firefox and load
   the extension again through `about:debugging`, or rerun `web-ext run`, then
   repeat the first scan. This exercises a cold core startup in each browser.

The released Firefox 1.4.0 artifact fails at step 1 with the
`OFFSCREEN_DOCUMENT` error from issue #847. Test desktop Firefox and Chrome
separately; the shared detector bundle does not make their hosting APIs identical.


## Copy report edge cases

- Open a second tab and scan it from DevTools. Reopen the popup on the first
  tab: it must copy only the first tab's findings and URL.
- Reload the scanned page or navigate to another URL. Old results must not be
  available to copy before a fresh scan completes.
- Try a blocked page such as `chrome://extensions` or `about:debugging`. A failed
  scan must not enable copying or retain a report from an earlier page.
- Open Impeccable in DevTools. Use **Copy all findings** and a finding's copy
  button. Compare the report with the popup report and confirm that selectors,
  categories, details, and suggested skills remain present.
- Scan `../antipatterns/hard-offset-shadow.html` from the same fixture server
  (serve `tests/fixtures` instead if needed). Advisory findings must appear in
  an **Advisories** section. A hard offset shadow must not add a generic
  `/polish` suggestion.
- Clipboard rejection and delayed scan/navigation messages are covered by
  `tests/extension-popup.test.mjs`; success in a stubbed clipboard is not a
  substitute for the real Chrome and Firefox copy-and-paste checks above.

## Restart during visual analysis

On a page with text over a background image, start a scan while image loading is
slow. Copy must remain disabled during the visual pass. Select **Restart scan**
and let the new scan finish. When the old image request finishes or fails, the
new findings must remain available; no old error may clear them or enable Copy
for an incomplete replacement. Repeat after closing and reopening the popup.

`tests/extension-build.test.mjs` controls this order directly: it holds an image
answer open, starts a replacement, then releases or rejects the old answer. It
also checks stale findings/errors, late message rejection, late injection, and
navigation at the background worker boundary.


## Deferred checks and worker restart

- Scroll two deferred image-backed elements into view together. Both findings
  must remain in the final report. The second check must use its own element's
  snapshot and pixels.
- While a deferred image check waits, restart the scan, navigate away, or close
  the tab. A scan in another tab must still finish. A late answer from the old
  check must not change the new report.
- In Chrome, stop the extension service worker while a page remains open, then
  trigger a deferred check. The current document's result must still reach the
  popup. Results from a replaced document must not be accepted.

The protocol tests cover active and queued cancellation, current-document ID
recovery, concurrent partial/final reports, and teardown during a new scan.
These controlled tests do not replace the manual worker-stop check above.


Use `deferred.html` for this check at a normal desktop window height.
The initial scan must complete with zero findings while the image-backed
paragraph is below the viewport.

For Firefox background recovery, scan that page at the top. Keep that page open. In `about:debugging#/runtime/this-firefox`, select
**Terminate background script** and confirm **Stopped**. Return to the page and
scroll the text into view without selecting Scan again. Its contrast finding
must appear and copy correctly. This also tests restoration of Firefox's
rule-core iframe, which is destroyed when the background page stops.
