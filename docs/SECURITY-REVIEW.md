# Security review notes

For teams whose static scanner (Veracode, Snyk Code, CodeQL, Semgrep) flags this repository before adoption. These notes come from a review of cross-site scripting, file path handling, and server-side request forgery in the code that ships, prompted by a Veracode report of 173 findings (issue #1584). We did not see that report, so treat this as a map of the code to check its findings against.

## What ships, and what a scan should leave out

Impeccable ships four things: the engine binary (the Rust workspace under `crates/`), the launcher (`skill/scripts/impeccable`, `impeccable.cmd`), the npm shim (`cli/bin/cli.js`), and the page scripts that live mode injects into your own dev server (`skill/scripts/live-browser*.js`). The Chrome extension under `extension/` ships separately.

Most of what a whole-repo scan reads is not that. Exclude these paths, or triage their findings as non-shipping:

| Path | What it is |
|---|---|
| `tests/` | Test suites, the oracle cases (about 1,800 files) and HTML fixtures written to contain the patterns the detector flags |
| `crates/*/tests/`, `crates/*/examples/`, `crates/wasm/tools/` | Rust integration tests, examples, and developer scripts |
| `demos/` | Demo pages |
| `.agent/`, `.agents/`, `.claude/`, `.cursor/`, `.devin/`, `.dsh/`, `.gemini/`, `.github/skills/`, `.grok/`, `.hermes/`, `.kiro/`, `.omp/`, `.opencode/`, `.pi/`, `.qoder/`, `.rovodev/`, `.trae/`, `.trae-cn/`, `.veto/`, `.vibe/`, `plugin/`, `cursor-plugin/`, `workspace/custom-skills/` | Generated copies of `skill/`, one per agent harness. `live-browser.js` alone is tracked 24 times, so one pattern there becomes 24 findings |
| `crates/live/assets/detect-antipatterns-browser.js`, `crates/context/assets/component-review.js`, `skill/scripts/modern-screenshot.umd.js` | Generated or vendored bundles. Review their sources (`browser-bundle/`, `ui/component-review/`) instead |

Scan `skill/`, `crates/*/src/`, `cli/`, `ui/`, and `extension/` (without the generated `extension/detector/`).

## The threat model in one paragraph

Every server the engine runs binds to `127.0.0.1`. The live-mode server checks a per-session token, the capture service a capability header, and the decision page and component review page check `Host` on every request and `Origin` on every POST. The snapshot servers accept only their exact `Host` and an explicit file list. The attacker that matters is a web page in another tab or a network attacker. A repository that you open in your agent and run in your dev server is a much weaker attacker: it can already run code as you through `npm install` scripts, so a finding that needs a malicious repo only matters when it gives that repo something it did not already have.

## Cross-site scripting (CWE-79, CWE-80)

No real issue found. A scanner flags every `innerHTML` in `live-browser.js`, and there are dozens. Most of them write constant markup or icons. The rest render your own `.impeccable/design.json` and `DESIGN.md` into your own dev page, and those values go through `escapeHtml` (all five HTML metacharacters), and Markdown links are limited to relative links, `http`, `https`, and `mailto`. The component preview renders your own component snippets on purpose, inside a shadow root, on a page that already runs your code.

The one place where untrusted third-party content reaches HTML is the extension's DevTools panel, which lists findings from pages you scan. Every page-derived string there (`selector`, finding detail) passes through `escapeHtml` and lands in text positions only. The decision page escapes every field it builds into HTML, including the ones that come from the impeccable.style catalog API. The component review page is served with `script-src 'self'`, and snapshot files are served under a sandboxed CSP with `script-src 'none'`.

An HTML sanitizer for component previews was proposed in PR #1586. It would strip the `style`, `href`, and `url()` values that real components use, and the input it guards is your own repository, so it was not taken.

## File path handling (CWE-22, CWE-73)

One real issue, now fixed. `impeccable font-fetch` named each downloaded file after the `font-weight` value in Google Fonts' CSS response without checking it. On Windows, a tampered response could have named a file outside `--out`. Reaching it takes control of an HTTPS response from fonts.googleapis.com, and on macOS and Linux the write fails instead. `faces()` now keeps a face only when its weight is a number or a range of two numbers.

The rest are false positives:

- The live server's `/source` route is token-gated, refuses `..`, resolves symlinks on both the project root and the target, and compares relative paths, so a sibling directory such as `project-backup` does not pass as `project`.
- Annotation screenshots are named from an event id that must match `[A-Za-z0-9_-]{1,64}`.
- Manual edits from the live page write only to files inside the project root, and never to generated files.
- The static servers used for capture and snapshots refuse percent-encoded separators, `..`, drive letters, and symlinks, and serve only an explicit list of files.
- `impeccable install` and `update` verify the skill ZIP's Ed25519 signature before extracting it, and extraction refuses entries that resolve outside the staging directory and never creates symlinks.
- The launcher and the npm shim name their cache directory after the shipped `VERSION` and check every engine download against `engine-checksums.txt`.
- Paths taken from command-line arguments (`--out`, `--target`, and similar) are the user's or the agent's own choice.

## Server-side request forgery (CWE-918)

Also one real issue here. `impeccable live-poll` and `impeccable live-server stop` built their URL from the `port` field of `.impeccable/live/server.json` as raw text. A crafted string in a committed copy of that file could point both verbs at another host and send the live token there. Both verbs now use the port only as a number from 1 to 65535 and treat anything else as no live server.

Everything else that makes a request falls into one of four groups:

- **Fixed hosts:** the roll API and update check (impeccable.style), the account service, engine and skill downloads (GitHub releases, checksum- and signature-verified), and image generation (api.openai.com). Each can be moved only by an environment variable you set (`IMPECCABLE_API_URL`, `IMPECCABLE_UPDATE_HOST`, `IMPECCABLE_ACCOUNT_URL`, `IMPECCABLE_DOWNLOAD_BASE`, `IMPECCABLE_CARD_BASE`, `OPENAI_BASE_URL`).
- **Hosts named by a fixed host:** `font-fetch` asks fonts.googleapis.com for CSS over HTTPS and downloads the font files that CSS names. The decision page prefetches catalog card images, limited to the card base or a public HTTPS host, with no redirects.
- **URLs you asked for:** `impeccable detect <url>`, `shot`, `first-viewport`, `generate-image --ref`, and `--dev-url`. Fetching the address you typed is the feature.
- **Loopback only:** the dev-server probe, `detect --cdp` (refuses non-loopback endpoints), and the live page's calls back to its own server.

No local server exposes a route that fetches a URL taken from a request.

## Fixed in source, shipping next

The two fixes above are in source and reach users with the first engine release after 0.1.31. Engine 0.1.31 and earlier still have both.

To report something this misses, open an issue without a working exploit and ask a maintainer for a private channel.
