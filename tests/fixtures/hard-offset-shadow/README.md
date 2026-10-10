# Hard offset shadow advisory: verification plan

Fixture: `../antipatterns/hard-offset-shadow.html`. It contains four should-flag
panels and eight should-pass panels, with explicit sizes and distinct headings.

## Automated gates

- `cargo test -p impeccable-core checks::hard_offset_shadow`: positive/negative
  offsets, omitted blur/currentColor, multiple layers, 4px boundary, soft/inset
  shadows, focus rings, transparent/faint paint, negative spread, unresolved
  lengths and invalid colors.
- `cargo test -p impeccable-html --test hard_offset_shadow`: exactly four
  advisory findings; scoped/ancestor and comment waivers, hidden ancestors.
- `cargo test -p impeccable-browser --test hard_offset_shadow`: the same four
  selectors through the installed Chromium browser and native rule core.
- `cargo xtask bundle`, then `cargo build --release -p impeccable`.
- `IMPECCABLE_BIN=target/release/impeccable node tests/oracle/run.mjs detect-hard-offset-shadow`:
  advisory-only CLI output exits 0; `--no-advisory` produces no finding and exits 0.
- Full `cargo test --workspace`, `IMPECCABLE_BIN=target/release/impeccable bun run test`,
  and `bun run build` before ready. Review fixture/directory oracle changes by hand.

## Browser/WASM and extension checks

`node tests/fixtures/hard-offset-shadow/browser-check.mjs` runs the in-page WASM
bundle in Puppeteer Chrome and installed Firefox (set `FIREFOX_PATH` outside the
macOS default). It asserts advisory metadata, repeated scans, and rule disabling
and re-enabling. JSON evidence and fixture screenshots land in `build/929/`.
It also renders the shipped DevTools panel in both browsers, feeds it those real
WASM findings through a stubbed extension port, and checks the **Advisories**
heading, four findings, rule settings, and the actual single/copy-all buttons.
Copied shadow reports must not claim AI authorship or suggest `/polish`.
Extension APIs are stubbed in this harness; packaged extension wiring was checked
separately below. Run `node --test tests/extension-devtools.test.mjs` for the
fast report regressions, including mixed categories and other rules' suggestions.


Serve `tests/fixtures/antipatterns` locally and open `hard-offset-shadow.html`.
Use the newly bundled detector, not a released version. In both Chrome and Firefox:

1. Scan the fixture. Expect exactly four **hard-offset-shadow** findings on
   `#flag-0` through `#flag-3`; unrelated rule findings should be reviewed separately.
2. Confirm no hard-offset finding on the pass column, including the deliberate
   neobrutalist treatment with `data-impeccable-ignore="hard-offset-shadow"`.
3. Re-scan. Expect the same four, without duplicate overlays.
4. Disable this rule through the extension's DevTools rule settings and rescan.
   Expect zero findings for this rule. Re-enable and expect four again.
5. Confirm the finding text asks whether the effect fits the intended direction,
   without claiming AI authorship or instructing automatic removal.
6. Confirm both popup/DevTools list the new rule. An advisory can be shown in the
   extension's findings/badge; advisory status guarantees CLI failure semantics,
   not invisibility in every UI.

Firefox's offscreen-host compatibility fix is tracked separately in #847. Test
with that patch when exercising the extension rather than just the in-page WASM
bundle. Keep the two PRs independent.

### Packaged extension verification (2026-10-10)

Tested the current detector after the DOM-helper refactor in the actual extension
popup and DevTools panel, separately from the automated in-page WASM harness:

| Browser | Package | Scan / repeat | Disable / re-enable |
| --- | --- | --- | --- |
| Chrome for Testing 154 | Current unpacked Chrome bundle | 4 / 4 | 0 / 4 |
| Firefox 157 | Current Firefox bundle plus #996 at `50368e772` | 4 / 4 | 0 / 4 |

Both panels identify `#flag-0` through `#flag-3`, and repeated scans leave exactly
four overlays. The pass column remains clear. The Firefox test combines the
current detector with #996's background host and manifest compatibility changes;
it does not establish that this branch alone fixes Firefox scanning.

### Advisory presentation regression

DevTools now puts this rule in **Advisories**, including settings and copy-all,
and omits automatic fix-skill suggestions for it. The engine's `slop` category
remains unchanged for compatibility; this presentation override is limited to
`hard-offset-shadow`. Existing rules keep their grouping and suggestions.

Report regressions were run before the fix (three failures) and after it (four
passing tests). The browser harness exercises the rendered panel and clipboard
buttons, rather than only checking source strings.

### Real-site intentional controls (2026-10-10)

Scanned with the rebuilt native binary using `detect --no-config --json <url>`:

| Intentional control | Hard-offset advisories | Resolved shadow |
| --- | --- | --- |
| https://www.neobrutalism.dev/ | 4 | Black, 4px 4px, zero blur/spread |
| https://neobrutalism.com/docs | 3 | Black, 4px 4px, zero blur/spread |

These sites explicitly present a neobrutalist design direction. Their findings
are expected geometric matches, not evidence of unwanted design or AI authorship.
The controls demonstrate that this check cannot infer intent. Other rules also
reported findings, so their overall CLI exit codes are not an advisory-only test.
Counts are observations of live sites, not stable regression assertions.
These are intentional controls, not confirmed unwanted-design examples.

### Real-project hover-state review (2026-10-10)

Tested the running prxps `/bracket-2026` page in Chrome 154 using this branch's
WASM bundle. The route and brief are unchanged from
[prxps `281f09669`](https://github.com/mager/prxps/tree/281f09669fc227df94c1b4d5c282539500152431).
The local project has unrelated work in progress; it was not modified for this test.

| State | Resolved box shadow | Hard-offset advisories |
| --- | --- | --- |
| Rest / pointer away | None on tested cards | 0 |
| Hover `#card-e-1-16` | `rgb(17, 17, 17) 4px 4px 0px 0px` | 1 |
| Hover `#card-e-8-9` (upset card) | `rgb(229, 62, 62) 4px 4px 0px 0px` | 1 |
| Pointer moved away again | None on tested cards | 0 |

Reproduce with the local prxps dev server and the in-page bundle, move the pointer
to each card, wait for its 150ms transition to settle, then invoke
`window.impeccableDetect()`. Filter by `type === "hard-offset-shadow"`.
The route declares these shadows in
[`+page.svelte`](https://github.com/mager/prxps/blob/281f09669fc227df94c1b4d5c282539500152431/frontend/src/routes/bracket-2026/+page.svelte#L545).
Its [design brief](https://github.com/mager/prxps/blob/281f09669fc227df94c1b4d5c282539500152431/DESIGN.md#L137)
calls for soft card shadows and physical hover interactions. That makes these
useful candidates for human review, but does not prove they are unwanted or
AI-authored. Owner confirmation remains pending. The separate `.input:focus`
hard shadow is not counted as unwanted evidence: it has a focus-indication role
and a dark-scheme override.

This also establishes a limit: a scan at rest does not discover a hover-only
shadow. Exercise the relevant interaction before scanning; the detector does not
automatically walk interaction states.

## Latest validation and baseline disposition (2026-10-10)

Built this branch from scratch with a dedicated `CARGO_TARGET_DIR`, then set
`IMPECCABLE_BIN` to that directory's release binary for the JS tests. This rules
out stale shared build artifacts as the explanation for the failures below.

- Focused Rust: core rule, both static HTML tests, and native Chromium test pass.
- Full oracle corpus replay passes with zero unreviewed differences.
- Extension packaging/report tests: 7 pass. Suite-selection tests also pass.
- Chrome 154 and isolated Firefox 157.0.1: WASM scan/repeat `4 / 4`, disable/restore
  `0 / 4`; rendered panel, settings, copy-all and single-copy assertions pass.
  The system Firefox updater prevented launch, so the current UI check used a
  separate Puppeteer test installation. Extension APIs in this panel harness are
  stubbed; see the separate packaged-extension observations above.
- Framework: 191 pass. Plugin loader: 4 pass.
- Source build and Chrome/Firefox packaging pass; bundling leaves the tracked
  engine assets unchanged. The Firefox package still needs the separate #996 fix.
- `cargo test --workspace` is **not green**: it stops at
  `build_phase::integrity_tests::artifact_cleanup_failure_blocks_the_gate`, with
  `stale evidence: regions/retired.png`.
- `bun run test` is **not green**: core, oracle and detector stages pass; the live
  stage reports 221 pass, 6 fail, 2 skip. Framework/plugin stages were run
  separately after the stop.

For comparison, exported the clean PR base `d631a8827f99414d2b6daba4ef08b7f8701751d7`
with `git archive`, built it in another dedicated target directory, and ran:

```sh
cargo test --release -p impeccable-comp-verbs artifact_cleanup_failure_blocks_the_gate
IMPECCABLE_BIN=/absolute/path/to/base/target/release/impeccable \
  node --test tests/live-agent-target.test.mjs
```

The base has the **same cleanup assertion failure**. Its live-target run reports
33 pass / 7 fail, including **all six** failures from this branch:

- holder turns busy;
- denied claimant pending status;
- disconnected holder releases its lease;
- all idle pages decline resolution;
- a previously unresolvable element mounts during the grace period;
- last silent overlay disconnects.

The base additionally fails the already-answered-target/session case. The denied
claimant and late-mounted-element cases pass when run alone on this branch.
These results establish baseline/timing problems, not a green broad suite.
The affected live-server sources, cleanup sources, and live-target tests have
no diff from the base; this PR does not change their behavior or relax assertions.
Do not run two copies of the live-target suite concurrently: it binds port 8497.

## Limits and calibration before ready

This rule measures resolved outer box shadows with zero blur, nonnegative spread,
alpha after element opacity above 0.1, and an offset of at least 4 CSS pixels on
one axis. The threshold separates the fixture cases; it is not a design standard.
Unresolved lengths/colors and negative spread remain outside this initial rule.
It does not scan text-shadow or raw CSS/JS declarations, infer neobrutalist intent,
or recommend deleting shadows. Static scans cannot establish actual occlusion.

Before enabling this beyond a draft, review real generated-project examples
against their design briefs as well as intentional neobrutalist examples. The
synthetic fixture proves the mechanical rule, not precision on unwanted designs.
Use existing scoped or project ignore mechanisms for intentional uses.
