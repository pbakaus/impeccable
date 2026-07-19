# Issue #387: rendered contrast reproduction and site audit

Issue: [#387 — impeccable.style does not meet the minimum accessibility standards](https://github.com/pbakaus/impeccable/issues/387)

Audit date: 2026-07-19  
Source revision: `e4ab5e24` (`origin/main`)  
Worktree: `/Users/abdulwahab/impeccable-issue-387-audit`  
Branch: `codex/issue-387-audit`

## Outcome

The report is reproducible and the issue is confirmed.

The problem is broader than one yellow label. Full kinpaku gold and full verdigris patina are repeatedly used as text colors after the surrounding surface switches to light mode. On the site's paper surfaces:

- Kinpaku gold (`rgb(255 186 0)`) measures about **1.57–1.67:1**.
- Full patina (`rgb(15 182 172)`) measures about **2.17–2.53:1**.
- Both fail WCAG 2.2 AA for normal text, and also fail the relaxed 3:1 threshold for large text in the sampled pairings.

The existing light-mode safety alias does not solve the problem: `--ks-kinpaku-ink` currently resolves to the full `--ks-patina`, not the darker `--ks-patina-deep` or another verified text token.

The route-wide rendered scan found:

- **46 discovered routes**, of which 45 rendered successfully. `/docs/teach/` returned 404.
- **184 page states**: every route in light and dark themes at desktop and mobile widths.
- **263 unique solid-background WCAG AA failure signatures** after de-duplicating desktop/mobile copies.
- **560 rendered occurrences** of those AA failure signatures.
- **36 of 45 valid routes** contain at least one solid-background AA failure.
- **567 unique failure signatures** at WCAG AAA.
- **932 unique miss signatures** against the reporter's custom 9:1 target.

These totals include deliberately poor “before” examples in command demonstrations. Those examples are separated below because their remediation differs from ordinary site chrome.

## Standards interpretation

WCAG 2.2 SC 1.4.3 requires **4.5:1 for normal text** and **3:1 for large text** at Level AA. SC 1.4.6 raises those thresholds to **7:1** and **4.5:1** at Level AAA. The reporter's **9:1** target is a valid project policy, but it is not a WCAG AA or AAA threshold.

The logotype exception applies to logo or brand-name text. It does not exempt ordinary gold labels, status text, links, tabs, CTA copy, or category chips merely because they use a brand color.

Ratios in the scanner are calculated from browser-computed colors with the WCAG relative-luminance formula. Pass/fail uses the unrounded value; the displayed ratio is rounded for readability.

References:

- [WCAG 2.2 Understanding SC 1.4.3: Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [WCAG 2.2 Understanding SC 1.4.6: Contrast (Enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html)

## Standard reproduction

### 1. Start from a clean worktree

```bash
git fetch origin main
git worktree add -b codex/issue-387-audit \
  /Users/abdulwahab/impeccable-issue-387-audit \
  origin/main
cd /Users/abdulwahab/impeccable-issue-387-audit
bun install --frozen-lockfile
```

### 2. Start the actual site development command

Use the repository command rather than invoking Astro directly. It generates the static API payload used by the homepage command demos.

```bash
bun run dev -- --host 127.0.0.1 --port 4337
```

### 3. Run the rendered contrast scanner

WCAG AA, every discovered route, both themes, both viewports:

```bash
bun run audit:site-contrast -- \
  --base-url=http://127.0.0.1:4337 \
  --standard=aa \
  --fail-on-aa
```

The reporter's strict target:

```bash
bun run audit:site-contrast -- \
  --base-url=http://127.0.0.1:4337 \
  --standard=9
```

Machine-readable output:

```bash
bun run audit:site-contrast -- \
  --base-url=http://127.0.0.1:4337 \
  --format=json \
  --output=/tmp/impeccable-contrast.json
```

Focused homepage reproduction:

```bash
bun run audit:site-contrast -- \
  --base-url=http://127.0.0.1:4337 \
  --routes=/ \
  --themes=light \
  --viewports=desktop \
  --standard=aa
```

The scanner:

- crawls same-origin links from explicit public-route seeds;
- forces the requested theme before first paint;
- tests 1440×1000 and 390×844 viewports;
- requests reduced motion so scroll-reveal content is present and stable;
- scans visible rendered text, placeholders, and selected options;
- computes effective solid ancestor backgrounds and alpha compositing;
- uses the WCAG large-text threshold from computed size and weight;
- groups repeated DOM copies while retaining occurrence counts and examples;
- separates WCAG AA, WCAG AAA, and the custom 9:1 target;
- excludes image/gradient results from conclusive failure counts and can emit them with `--include-complex` for manual verification.

## Systemic causes

### S-01 · Light-mode text fallback points to a failing color (P1)

`site/styles/kinpaku-tokens.css:166` defines `--ks-kinpaku-ink: var(--ks-patina)`. Full patina measures only about 2.2–2.5:1 on the site's light surfaces. Components that correctly tried to use the “ink” alias still fail.

Recommendation: introduce or select a verified on-paper accent-text token. Do not alias it to a decorative fill token. Validate it against every light surface token, including raised and tinted surfaces.

### S-02 · Fill gold is used directly as light-mode text (P1)

The light theme intentionally preserves `--ks-kinpaku` at `site/styles/kinpaku-tokens.css:162`. Many page styles continue to use that fill token for text, producing the repeated 1.57–1.67:1 failures.

Recommendation: separate `gold-fill`, `gold-border`, and `gold-text-on-paper` roles. A brand fill should not double as body, label, or control text.

### S-03 · Full patina is used directly as light-mode text (P1)

`--ks-patina` is a strong state/fill color in dark mode but is too light on paper. Page styles in `home-kinpaku.css`, `designing-kinpaku.css`, `docs-visuals.css`, `live-mode-kinpaku.css`, and `slop-kinpaku.css` use it directly for small text.

Recommendation: use `--ks-patina-deep` or a newly verified text role in light mode; retain full patina for fills, rules, and sufficiently dark surfaces.

### S-04 · Broad light-mode overrides are incomplete (P1)

`site/styles/light-mode.css` contains many component-specific corrections, but selectors outside those lists retain dark-theme accent roles. New pages can regress simply by introducing a new label class.

Recommendation: move semantic foreground roles into the token layer and make component CSS consume those roles. Use page-specific overrides only for exceptional surfaces.

### S-05 · Several demo palettes do not respond to the site theme (P1/P2)

Command demos use fixed light surfaces and colors. In dark theme, global foreground inheritance or partial theme overrides can produce white-on-white and dark-on-dark combinations as low as 1.09:1.

Recommendation: decide whether demos are informative UI or incidental illustration. Informative HTML must meet contrast in both themes. Truly illustrative examples need a clearly accessible caption/alternative and should not expose misleading interactive semantics.

### S-06 · The design-system page demonstrates broken primary-button contrast (P1)

Primary “Start audit” buttons render light gray text on gold at 1.07–1.74:1 in dark theme. The system reference currently teaches a failing component state.

Recommendation: make the primary button's on-gold foreground an explicit invariant and test every normal, hover, pressed, and sampled state.

### S-07 · Muted text stops sit just below AA on several surfaces (P1)

Independent of gold/patina, gray metadata appears at 3.79–4.34:1 in the design system and shader lab, and at 4.16:1 in the homepage terminal proof.

Recommendation: verify every text-ramp stop against every surface token and document the minimum permitted size for each stop.

### S-08 · The 9:1 request is not yet a defined product policy (P2)

If 9:1 becomes the project target, 932 unique rendered signatures miss it. That includes many combinations that already pass AAA. Treating 9:1 as a release gate would require a deliberate redesign of the muted text ramp, not only a gold/patina patch.

Recommendation: record the conformance target in `PRODUCT.md`/`DESIGN.md` as AA, AAA, or a custom enhanced target before using it as CI policy.

### S-09 · `/docs/teach/` is linked but returns 404 (P2, audit hygiene)

The crawler discovered `/docs/teach/` from site content, but Astro returned 404 in every theme/viewport state. This is not a contrast failure, but it prevents a fully clean route audit.

Recommendation: update the stale alias/link or add the intended redirect.

## Detailed issue inventory

The following are grouped engineering issues. A group can represent repeated instances sharing a selector and color pairing. All listed ratios are rendered measurements on solid backgrounds.

### Homepage

1. **H-01 · Active install tab uses fill gold as text (P1).** `/`, light. `#install-tab-impeccable`, 1.67:1. Source: `site/styles/home-kinpaku.css` plus the light-mode token mapping.
2. **H-02 · Node requirement emphasis uses fill gold (P1).** `/`, light. `downloads-rebuild-method-note > strong`, 1.67:1. Source: `site/styles/home-kinpaku.css`.
3. **H-03 · Active command spread title remains gold (P1).** `/`, light. `spread-command-name`, 1.67:1 even at the large-text threshold. Sources: `site/styles/home-kinpaku.css:1019`, `site/styles/light-mode.css:257`.
4. **H-04 · Active command spread category remains gold (P1).** `/`, light. `spread-category-label`, 1.67:1. Sources: `site/styles/home-kinpaku.css:187`, `site/styles/light-mode.css:258`.
5. **H-05 · Command flow icon remains gold (P1).** `/`, light. `spread-flow-icon`, 1.67:1.
6. **H-06 · Install group labels use full patina (P1).** `/`, light. “Install via” and “First run”, 2.46:1.
7. **H-07 · BETA badge uses full gold on paper (P1).** `/`, light. `why-panel-badge`, 1.57:1. Source: `site/styles/home-kinpaku.css:1757`.
8. **H-08 · DESIGN.md badge uses full patina on a pale tint (P1).** `/`, light. “Google Stitch spec”, 2.17:1. Source: `site/styles/home-kinpaku.css:2139`.
9. **H-09 · Bento ordinals use full patina (P1).** `/`, light. `ks-bento-num`, 2.32:1. The failure repeats across the “Ready to drop in” tiles.
10. **H-10 · Visualize/Shape/Live Build plate labels use full patina (P1).** `/`, light. `why-vz-plate-kind`, 2.32:1. Sources: `site/styles/home-kinpaku.css`, `site/styles/light-mode.css:1756`.
11. **H-11 · DESIGN.md tile metadata uses full patina (P1).** `/`, light. “Primary”, “Wordmark”, “Body”, and “Components”, 2.32:1. Sources: `site/styles/home-kinpaku.css:2156`, `site/styles/light-mode.css:1677`.
12. **H-12 · PRODUCT.md keys and terminal success/path tokens use full patina (P1).** `/`, light. 2.46:1. Source group: `site/styles/home-kinpaku.css:1628`.
13. **H-13 · Terminal title is too faint on its header surface (P1).** `/`, light. 2.26:1.
14. **H-14 · Terminal metadata misses AA (P1).** `/`, light. 4.16:1 at roughly 10.8px. This is a separate muted-ramp issue.
15. **H-15 · CI prompt uses a low-contrast brown/gold text role (P1).** `/`, light. 3.72:1 at roughly 14px. Source: `site/styles/home-kinpaku.css:1717`.
16. **H-16 · Failing CI status misses AA in dark mode (P1).** `/`, dark. Vermilion on the tinted dark surface measures 3.95:1 at roughly 10px.

### Case study, changelog, and utility pages

17. **P-01 · Neo Mirai primary CTA uses light text on gold (P1).** `/cases/neo-mirai/`, light. “Open the live build”, 1.44:1. Sources: `site/pages/cases/neo-mirai.astro:21`, `site/styles/docs-visuals.css:3183`.
18. **P-02 · Neo Mirai secondary CTA uses gold on paper (P1).** `/cases/neo-mirai/`, light. 1.57:1. Sources: `site/pages/cases/neo-mirai.astro:22`, `site/styles/docs-visuals.css:3189`.
19. **P-03 · Neo Mirai eyebrow, section labels, and strip captions use gold (P1).** `/cases/neo-mirai/`, light. 1.44–1.57:1. Sources: `site/styles/docs-visuals.css:3022`, `site/styles/docs-visuals.css:3101`.
20. **P-04 · Changelog active filter uses paper-colored text on gold (P1).** `/changelog/`, light. “Skill”, 1.57:1. Source: `site/styles/changelog-faq-kinpaku.css:72`.
21. **P-05 · Changelog “After” tag uses full patina on a pale tint (P1).** `/changelog/`, light. 2.25:1. Sources: `site/styles/changelog-faq-kinpaku.css:207`, `site/styles/light-mode.css:857`.
22. **P-06 · Shader-lab descriptions and status text miss AA (P1).** `/shader-lab/`, both themes. 3.85–4.34:1. Source: `site/pages/shader-lab/index.astro:50`, `:61`, `:76`, `:79`, and `:111`.

### Design system and explorations

23. **DS-01 · Primary buttons demonstrate invalid on-gold text (P1).** `/design-system/`, dark. “Start audit”, 1.07–1.74:1 across normal/hover/pressed specimens. Sources: `site/styles/kinpaku-kit.css:149`, `site/styles/design-system.css:1167`.
24. **DS-02 · Light-mode hero, tab, labels, status, pagination, and audit values use full gold (P1).** `/design-system/`, light. 21 selector families at 1.57:1. Representative sources: `site/styles/design-system.css:170`, `:538`, `:1450`, `:1477`, `:1503`; `site/styles/kinpaku-kit.css:417`, `:439`.
25. **DS-03 · Light-mode section eyebrows and subsection labels use full patina (P1).** `/design-system/`, light. 2.32:1. Sources: `site/styles/kinpaku-kit.css:71`, `:94`, `site/styles/light-mode.css:218`.
26. **DS-04 · Secondary action text uses a failing light-mode accent alias (P1).** `/design-system/`, light. “See rules”/“Cancel”, 2.32–2.46:1.
27. **DS-05 · Dark prototype stages inherit light-theme ink (P1).** `/design-system/`, light. Prototype headings/body/tile names measure 1.02–1.20:1 because light ink is rendered inside explicit dark specimen stages. Sources: `site/styles/design-system.css:893`, `:916`, `:984`.
28. **DS-06 · Token values, disabled samples, and footer metadata use an under-contrast muted stop (P1).** `/design-system/`, dark 3.79:1; light 2.97:1. Sources: `site/styles/design-system.css:507`, `:671`, `:1588`.
29. **DS-07 · Exploration candidate labels use full gold (P1).** `/design-system/explorations/`, light. 1.57:1.
30. **DS-08 · Exploration section metadata uses full patina (P1).** `/design-system/explorations/`, light. 2.32:1.

### Designing, detector, docs index, and shared docs chrome

31. **D-01 · Designing terminal prompt uses gold on a gray command surface (P1).** `/designing/`, light. `$`, 1.31:1. Source: `site/styles/designing-kinpaku.css:872`.
32. **D-02 · Designing labels and command names use gold on light panels (P1).** `/designing/`, light. 1.67:1. Representative sources: `site/styles/designing-kinpaku.css:677`, `:820`, `:1039`, `:1309`.
33. **D-03 · Designing status and phase labels use full patina (P1).** `/designing/`, light. 1.94–2.46:1. Sources: `site/styles/designing-kinpaku.css:655`, `:735`, `:942`, `:1302`.
34. **D-04 · Detector buttons and fixture links use light-on-gold or gold-on-light (P1).** `/detector/`, light. 1.44:1. Source families: `site/styles/detector-lab.css:146`, `:259`.
35. **D-05 · Detector numbered summaries use full patina on gray (P1).** `/detector/`, light. 1.94:1. Source: `site/styles/detector-lab.css:407`.
36. **D-06 · Detector category metadata uses an under-contrast brown/gold role (P1).** `/detector/`, light. 3.21:1 at small sizes.
37. **D-07 · Docs index category and ordinal labels use full patina (P1).** `/docs/`, light. 2.53:1 on white. Source: `site/styles/docs-kinpaku.css` docs-index blocks around `:950–1034`.
38. **D-08 · Related-command chips use full gold across 19 command pages (P1).** `/docs/adapt/`, `/docs/animate/`, `/docs/audit/`, `/docs/bolder/`, `/docs/clarify/`, `/docs/colorize/`, `/docs/craft/`, `/docs/critique/`, `/docs/delight/`, `/docs/distill/`, `/docs/document/`, `/docs/extract/`, `/docs/harden/`, `/docs/layout/`, `/docs/onboard/`, `/docs/overdrive/`, `/docs/quieter/`, `/docs/shape/`, and `/docs/typeset/`. Light theme, 1.67:1. Source: `site/styles/docs-kinpaku.css:1072`.
39. **D-09 · Docs file-status labels use full patina (P1).** `/docs/document/`, `/docs/init/`, `/docs/shape/`, and related visual modules. Light theme, 2.46:1. Sources: `site/styles/docs-visuals.css:357`, `site/styles/light-mode.css:1211`.
40. **D-10 · Docs flow accent names use the wrong accent role on paper (P1).** `/docs/craft/` and `/docs/extract/`, light. 1.67:1 on a tinted step. Sources: `site/styles/docs-visuals.css:800`, `:820`, `site/styles/light-mode.css:1208`.

### Live Mode, Slop catalog, and tutorial

41. **L-01 · Live Mode start prompt and stage markers use full gold (P1).** `/live-mode/`, light. 1.44–1.67:1. Sources: `site/styles/live-mode-kinpaku.css:165`, `:490`.
42. **L-02 · Live Mode pathway kind and CTA text use the failing accent alias (P1).** `/live-mode/`, light. 2.46:1. Sources: `site/styles/live-mode-kinpaku.css:659`, `:695`, `site/styles/light-mode.css:810`.
43. **L-03 · Live Mode framework metadata misses AA in dark mode (P1).** `/live-mode/`, dark. Seven small labels at 3.41:1. Source: `site/styles/live-mode-kinpaku.css:731`.
44. **L-04 · Slop catalog CLI chips use full gold on pale gold (P1).** `/slop/`, light. 1.57:1 across the rule catalog. Sources: `site/styles/slop-kinpaku.css:781`, `:808`.
45. **L-05 · Slop method labels, legend title, and rule links use full gold (P1).** `/slop/`, light. 1.67:1. Sources: `site/styles/slop-kinpaku.css:600`, `:856`, `:907`.
46. **L-06 · Slop quality and browser chips use full patina on pale green (P1).** `/slop/`, light. 2.20–2.24:1. Sources: `site/styles/slop-kinpaku.css:802`, `:814`.
47. **L-07 · Slop category and opt-in labels narrowly fail in dark mode (P1).** `/slop/`, dark. Vermilion/tinted text at 4.04–4.18:1 at roughly 10px.
48. **L-08 · Iterate Live tutorial pin and variant button use paper-on-gold (P1).** `/tutorials/iterate-live/`, light. 1.57:1. Sources: `site/styles/docs-visuals.css:1143`, `:1238`.
49. **L-09 · Iterate Live tutorial variant kicker uses full patina (P1).** `/tutorials/iterate-live/`, light. 2.22:1. Source: `site/styles/docs-visuals.css:1221`.
50. **L-10 · Iterate Live success pill misses AA in dark mode (P1).** `/tutorials/iterate-live/`, dark. Dark green on near-black at 3.13:1 for small text. Source: `site/styles/docs-visuals.css:1256`.

### Deliberately poor command demonstrations

These are still rendered HTML text and controls. They should not be silently counted as ordinary site chrome, but they also should not be assumed exempt. If the copy communicates the lesson, it remains informative text.

51. **X-01 · Audit demo contains white-on-near-white controls (P2 pending content decision).** `/docs/audit/`, as low as 1.16:1 in dark theme. Source: `site/scripts/demos/commands/audit.js` and shared demo CSS.
52. **X-02 · Harden demo contains white-on-white input text and low-contrast alerts (P2 pending content decision).** `/docs/harden/`, as low as 1.09:1. Source: `site/scripts/demos/commands/harden.js`.
53. **X-03 · Polish demo inherits dark-theme foregrounds into light profile cards (P2 pending content decision).** `/docs/polish/`, 1.32:1.
54. **X-04 · Clarify demo headings disappear on pale panels in dark mode (P2 pending content decision).** `/docs/clarify/`, 1.32–1.35:1.
55. **X-05 · Optimize demo metrics use orange/red/gray below AA (P2 pending content decision).** `/docs/optimize/`, 1.98–2.61:1 in both themes.
56. **X-06 · Layout demo avatars and metadata fail (P2 pending content decision).** `/docs/layout/`, 1.63–3.25:1.
57. **X-07 · Quieter demo CTAs use white on bright green/pink (P2 pending content decision).** `/docs/quieter/`, 1.67–3.33:1.
58. **X-08 · Distill demo icons and action copy fail (P2 pending content decision).** `/docs/distill/`, 1.32–4.03:1.
59. **X-09 · Critique demo empty-state and warning chips fail (P2 pending content decision).** `/docs/critique/`, 2.85–3.19:1, with additional dark green status text at 3.13:1.
60. **X-10 · Adapt demo deliberately small text measures 2.16:1 (P2 pending content decision).** `/docs/adapt/`, both themes.
61. **X-11 · Overdrive “after” paragraph becomes nearly invisible in light mode (P1 likely theme bug).** `/docs/overdrive/`, 1.17:1. This appears to be a theme mismatch rather than an intentional “before” flaw.
62. **X-12 · Colorize demo includes white-on-gold and gray-on-light text (P2 pending content decision).** `/docs/colorize/`, 1.71–2.61:1.

## Recommended remediation order

1. **P1 — Fix semantic accent text tokens.** Add verified on-paper text roles and change `--ks-kinpaku-ink` away from full patina.
2. **P1 — Replace direct text uses of `--ks-kinpaku` and `--ks-patina`.** Start with the global kit, docs relationship chips, homepage proof modules, Slop catalog, and Live Mode.
3. **P1 — Repair primary button contrast in the kit and design-system states.** The reference page must demonstrate the correct invariant.
4. **P1 — Add rendered route coverage.** Run `audit:site-contrast` in CI against a built/previewed site with `--standard=aa --fail-on-aa`.
5. **P1/P2 — Decide the accessibility contract for illustrative demos.** Either make informative demo content accessible in both themes or provide an accessible equivalent and remove misleading control semantics.
6. **P2 — Decide whether the target is AA, AAA, or custom 9:1.** Do not label 9:1 as a WCAG requirement.
7. **P2 — Remove the stale `/docs/teach/` route reference.** Keep the route inventory clean.
8. **P3 — Re-run visual/manual checks for gradient, image, texture, and pseudo-element backgrounds.** The scanner intentionally does not convert those into conclusive failures.
9. **P3 — Run `$impeccable polish` after contrast fixes.** Verify hover, focus, active, disabled, and reduced-motion states in both themes.

## Positive findings

- Dark mode is substantially stronger for ordinary site chrome; most dark-theme failures occur in demo specimens or a few small status labels.
- The token system already distinguishes `--ks-patina-deep` and `--ks-link-on-paper`, so the repository has the raw material for semantic text roles.
- Several light-mode links correctly use `--ks-link-on-paper` and pass AA.
- The theme is applied before first paint, preventing a theme flash from invalidating the audit state.
- Reduced-motion styling is present, which makes deterministic accessibility scanning possible.
- `/faq/`, `/privacy/`, `/tutorials/`, `/tutorials/getting-started/`, and `/tutorials/critique-with-overlay/` had no conclusive solid-background AA failures in this run.

## Validation limits

- Image, gradient, texture, canvas, and pseudo-element backgrounds require pixel sampling or manual review. They are excluded from conclusive counts.
- The scanner measures authored/computed colors, not anti-aliased edge pixels, matching WCAG evaluation guidance.
- Hover, focus, open popover/dialog, and every animated carousel frame are not exhaustively enumerated yet.
- The grouped totals describe rendered signatures, not a final count of code changes. One token correction can resolve many signatures.

## Implemented result (2026-07-20)

### Final rendered counts

The post-fix scanner discovered 46 routes. Forty-five rendered successfully; `/docs/teach/` remains the known 404 and is reported once for each theme/viewport combination. Across the 45 valid routes, both themes, and desktop/mobile viewports:

- 0 conclusive solid-background WCAG AA failure patterns
- 0 conclusive solid-background WCAG AA failure occurrences
- 725 WCAG AAA failure patterns, retained as informational
- 1,516 strict 9:1 misses, retained as informational
- 1,769 image, gradient, or texture-background combinations queued for visual review

The release gate is WCAG AA. AAA and the custom 9:1 threshold are deliberately not release-blocking.

### Semantic token mapping

| Role | Dark mapping | Light mapping | Intended use |
| --- | --- | --- | --- |
| `--ks-accent-ink` | `--ks-kinpaku` | `--ks-patina-deep` | Branded accent text and outlined actions |
| `--ks-state-ink` | `--ks-patina` | `--ks-patina-deep` | Success, path, file-state, and positive metadata |
| `--ks-on-accent` | `oklch(14% 0.018 95)` | `oklch(14% 0.018 95)` | Text placed on gold or patina fills |
| `--ks-vermilion` | `oklch(62% 0.15 35)` | `oklch(52% 0.16 35)` | Warning and failure text/chips |

Gold and patina remain unchanged as decorative fills, borders, rules, icons, textures, and brand marks. The semantic ink roles only replace failing foreground text.

### Illustrative demo policy

Command comparisons now render as figures with accessible captions. Their deliberately poor before/after visuals remain visually unchanged, while the illustrative split content and skill-demo viewports are `inert` and `aria-hidden="true"`. This keeps fake links, buttons, and inputs out of keyboard and screen-reader interaction without removing the comparison’s pointer/touch split surface.

The route scanner ignores hidden, inert, `aria-hidden`, disabled, and `aria-disabled` content. This exclusion is intentionally narrow: it does not suppress visible ordinary site chrome.

### Manual review performed

- Checked the homepage at 1440×1000 in light and dark themes: gold fills, textures, buttons, borders, and branding remained intact.
- Checked the homepage install area at 390×844: active tabs, the Node requirement, and terminal content remained readable without horizontal overflow.
- Checked the design-system page in light mode: canonical bento labels use the light-theme accent ink, primary buttons use dark-on-gold text, and embedded dark prototype stages retain light headings/body copy.
- Checked `/docs/audit/`: each command comparison exposes a caption, both illustrative split panels are inert and aria-hidden, and mock controls remain visual-only.
- Kept pointer/touch split movement, keyboard traversal, reduced motion, and the broader complex-background list in the final human test checklist because those behaviors require interactive or perceptual judgment beyond the conclusive color scanner.
