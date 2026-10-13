# Hard offset shadow advisory: verification plan

Fixture: `../antipatterns/hard-offset-shadow.html`. It contains four should-flag
panels and eight should-pass panels, with explicit sizes and distinct headings.

## Visual verification for reviewers

Open [the PR verification site](https://impeccable-radar.vercel.app/pr/998/).
No extension installation is needed. The page identifies the detector revision
for the color-parsing follow-up; earlier prxps and packaged-extension captures
remain labeled with their original detector revision.

1. Open the live fixture: expect four hard-offset advisories in the should-flag
   column and none for this rule among the eight should-pass controls. Also open
   the color regression fixture: red, gray, HWB and nested color-mix should each
   produce one advisory; its five controls should produce none.
2. Compare the regular and upset prxps cards at rest and on hover. Use keyboard
   focus or "Keep hover state visible" on touch screens. These are captured
   screenshots; recorded scans show 0 → 1 → 0 as the pointer enters and leaves.
3. Review the Chrome/Firefox panel captures: the findings belong to **Advisories**
   and should not prescribe automatic fixes. The panel harness uses real WASM
   findings with stubbed extension APIs; it is not an extension-installation test.

Mager reviewed the prxps examples on October 11, 2026 and supports shipping this
as a review prompt even though he likes the hover effects. This validates the
advisory's purpose, not a claim that those effects must be removed or that every
geometric match is unwanted. Intentional choices can use the existing waivers.

## Automated gates

- `cargo test -p impeccable-core checks::hard_offset_shadow`: positive/negative
  offsets, omitted blur/currentColor, multiple layers, 4px boundary, soft/inset
  shadows, focus rings, transparent/faint paint, negative spread, unresolved
  lengths and invalid colors. Named colors, HWB alpha, nested color-mix,
  compact CSS serialization, duplicate paint and sub-4px precision are covered.
- `cargo test -p impeccable-html --test hard_offset_shadow`: exactly four
  advisory findings in each fixture; named/functional colors through the static
  cascade, scoped/ancestor and comment waivers, hidden ancestors.
- `cargo test -p impeccable-browser --test hard_offset_shadow`: the same four
  selectors in both fixtures through installed Chromium and the native rule core.
- `cargo xtask bundle`, then `cargo build --release -p impeccable`.
- `IMPECCABLE_BIN=target/release/impeccable node tests/oracle/run.mjs detect-hard-offset-shadow`:
  advisory-only CLI output exits 0; `--no-advisory` produces no finding and exits 0.
- Full `cargo test --workspace`, `IMPECCABLE_BIN=target/release/impeccable bun run test`,
  and `bun run build` before ready. Review fixture/directory oracle changes by hand.

## Browser/WASM and extension checks

`node tests/fixtures/hard-offset-shadow/browser-check.mjs` runs the in-page WASM
bundle in Puppeteer Chrome and installed Firefox (set `FIREFOX_PATH` outside the
macOS default). It asserts advisory metadata, repeated scans, and rule disabling
and re-enabling. The additional `colors.html` fixture checks named and functional
colors against four positive and five negative controls in both browsers. JSON evidence and fixture screenshots land in `build/929/`.
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
AI-authored. Owner review is recorded above: the effect can be worth questioning
even when the owner likes it. The separate `.input:focus`
hard shadow is not counted as unwanted evidence: it has a focus-indication role
and a dark-scheme override.

This also establishes a limit: a scan at rest does not discover a hover-only
shadow. Exercise the relevant interaction before scanning; the detector does not
automatically walk interaction states.

## Earlier validation and baseline disposition (2026-10-10)

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

## Color-parsing review follow-up (2026-10-11)

Both review bots identified the same static false negative for named shadow
colors. Before the fix, new core and static integration regressions failed on
`4px 4px red` (zero findings instead of one). The rule now tokenizes CSS with
`cssparser` and delegates paint to the shared `parse_any_color` function. This
also preserves compact static serialization such as `0#333`, handles HWB and
nested color-mix, rejects unknown/duplicate paint and unresolved lengths, and
keeps f64 precision at the 4px threshold. Other shadow checks are unchanged.

Validation on the follow-up source:

- Core + static HTML crate suites: **805 passed, 0 failed**.
- Native Chromium integration: both fixtures pass (four advisory selectors each).
- Rebuilt WASM in Chrome 154 and Firefox 157.0.1: original fixture **4 / 4**
  across repeated scans, disable/restore **0 / 4**, color fixture **4** matches
  and **0** on five controls. DevTools grouping, settings and copy checks pass.
- Two new CLI goldens reviewed: color fixture emits exactly four advisories and
  exits 0; `--no-advisory` emits `[]` and exits 0. Full oracle replay passes;
  no existing goldens or frozen vectors changed.
- JS core: **179 passed / 1 skip**; detector: **7 passed**; framework:
  **191 passed**; plugin: **4 passed**. Bundle, release build and source build pass.
- `cargo test --workspace` again stops at the known cleanup assertion above
  (`stale evidence: regions/retired.png`). The affected core/HTML suites were
  also run separately to completion rather than relying on that partial run.
- Full JS run again stops in live mode: **221 passed / 6 failed / 2 skipped**.
  Every failing case is present in the previously recorded clean-base run,
  including the already-answered-target/session case this time. No live or
  cleanup code changed. Broad-suite success is **not** claimed.

The preview includes `colors.html`; its browser results complement the static
Rust regressions and CLI oracle, since browsers normalize named colors before
passing computed styles to the detector. New Chrome/Firefox color screenshots
are in the hosted verification page. Earlier packaged-extension and prxps
captures above remain historical evidence at their stated revision.

## Whole-shadow validity follow-up (2026-10-13)

An invalid layer invalidates the entire `box-shadow` declaration. The review
example `0 0 -1px black, 4px 4px black` previously produced a static advisory even
though browsers render no shadow. The same mismatch occurred with the invalid
layer after the matching one. Both core and static HTML regressions failed
before the fix.

The check now parses the entire comma-separated list before reporting. It rejects
negative blur, invalid length counts, duplicate paint/inset, interrupted length
groups and empty layers. Unresolved values conservatively suppress the list.
Valid inset, soft, transparent and negative-spread layers can still coexist with
an outer hard-shadow advisory. Named and functional color parsing is preserved.

`lists.html` contains four valid controls that should produce advisories and
eight invalid declarations that should produce none. The static HTML and native
Chromium tests assert four findings. The Chrome/Firefox WASM harness checks the
exact four selectors and confirms all eight invalid controls compute to `none`.
The two reviewed `detect-hard-offset-shadow-lists-*` oracle cases pin four
advisories/exit 0 and `--no-advisory` returning `[]`/exit 0. Frozen function vectors
remain unchanged.

## Limits and calibration

This rule measures resolved outer box shadows with zero blur, nonnegative spread,
alpha after element opacity above 0.1, and an offset of at least 4 CSS pixels on
one axis. The threshold separates the fixture cases; it is not a design standard.
Unresolved lengths/colors and negative spread remain outside this initial rule.
It does not scan text-shadow or raw CSS/JS declarations, infer neobrutalist intent,
or recommend deleting shadows. Static scans cannot establish actual occlusion.

The prxps owner review and intentional neobrutalist controls support presenting
this as an advisory, not an automatic correction. The synthetic fixture proves
the mechanical rule, not precision on unwanted designs. There is no measured
precision corpus establishing which matches users will want to change. The 4px
threshold remains open to maintainer calibration. Use existing scoped or project
ignore mechanisms for intentional uses.

Readiness documentation prepared with AI assistance from OpenAI Codex under
Mager's direction.
