/**
 * Static HTML/CSS fixture tests for anti-pattern detection.
 * Run via Node's built-in test runner (not bun).
 *
 * Usage: node --test tests/detect-antipatterns-fixtures.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  detectHtml,
  detectText,
  normalizeDesignSystem,
} from '../cli/engine/detect-antipatterns.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures', 'antipatterns');

describe('detectText - Astro structural CSS fixtures', () => {
  const SHOULD_FLAG = [
    'Kinpaku Edge',
    'Patina Edge',
    'Accent Edge',
    'Signal Blue Edge',
    'Chromatic Hex Edge',
    'Named Red Edge',
    'Chromatic Rgb Edge',
    'Chromatic Oklch Edge',
    // `inset` may follow the offsets/color. Requiring it first missed the same
    // stripe written the other legal way.
    'Trailing Inset Edge',
    'Trailing Inset Token Edge',
    'Inset Named Token Edge',
    // Only the two offsets are required; blur/spread default to 0.
    'Two Length Edge',
    'Important Edge',
    'Cascade Override Edge',
    'Color First Edge',
    'Color First Var Edge',
    'Two Length Trailing Inset Edge',
  ];
  const SHOULD_PASS = [
    'Neutral Shadow Token',
    'Current Color Edge',
    'Selected State Edge',
    'Hairline Edge',
    'Thick Fill Edge',
    'Blurred Edge',
    'Narrow Artwork',
    // Authored CSS spells neutrals as hex and keywords. isNeutralColor only
    // parses the computed function forms and reports everything else as
    // chromatic, so routing these through it flagged plain black and gray
    // hairlines as the "colored stripe" AI tell.
    'Black Hex Edge',
    'Black Named Edge',
    'Gray Hex Edge',
    'Dimgray Named Edge',
    'Black Rgb Edge',
    'Shorthand Neutral Hex Edge',
    // Commented-out CSS is not a live rule.
    'Commented Out Edge',
    // Trailing `inset` still respects the neutral-color exemption.
    'Trailing Inset Neutral Edge',
    // The short form still respects the neutral and blur exclusions.
    'Two Length Neutral Edge',
    'Space Rgb Neutral Edge',
    'Cascade Cancelled Edge',
    'Two Length Blurred Edge',
  ];

  it('Astro style blocks flag unresolved chromatic inset stripes only', () => {
    const filePath = path.join(FIXTURES, 'astro-inset-shadow-stripe.astro');
    const source = fs.readFileSync(filePath, 'utf8');
    const findings = detectText(source, filePath).filter(r => r.antipattern === 'side-tab');
    const snippets = findings.map(r => r.snippet || '').join(' | ');
    for (const heading of SHOULD_FLAG) {
      assert.match(snippets, new RegExp(`data-case=${JSON.stringify(heading)}`), `expected "${heading}" to flag`);
    }
    for (const heading of SHOULD_PASS) {
      assert.doesNotMatch(snippets, new RegExp(`data-case=${JSON.stringify(heading)}`), `"${heading}" should pass`);
    }
  });
});

describe('detectHtml — static HTML/CSS fixtures', () => {
  it('should-flag: catches border anti-patterns', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'should-flag.html'));
    assert.ok(f.some(r => r.antipattern === 'side-tab'));
    assert.ok(f.some(r => r.antipattern === 'border-accent-on-rounded'));
  });

  it('should-pass: zero border findings', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'should-pass.html'));
    assert.equal(f.filter(r => r.antipattern === 'side-tab' || r.antipattern === 'border-accent-on-rounded').length, 0);
  });

  it('border-baseline: paired side-tab fixture flags only the positive column', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'border-baseline.html'));
    const sideTabs = f.filter(r => r.antipattern === 'side-tab');
    const accents = f.filter(r => r.antipattern === 'border-accent-on-rounded');
    assert.equal(
      sideTabs.length,
      6,
      `expected 6 side-tab findings, got ${sideTabs.length}: ${sideTabs.map(r => r.snippet).join('; ')}`
    );
    assert.equal(
      accents.length,
      2,
      `expected 2 rounded accent findings, got ${accents.length}: ${accents.map(r => r.snippet).join('; ')}`
    );
  });

  it('linked-stylesheet: catches borders, no false positives', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'linked-stylesheet.html'));
    assert.ok(f.some(r => r.antipattern === 'side-tab'));
    assert.ok(f.some(r => r.antipattern === 'border-accent-on-rounded'));
    assert.equal(f.filter(r => r.snippet?.includes('clean')).length, 0);
    assert.equal(
      f.filter(r => r.antipattern !== 'side-tab' && r.antipattern !== 'border-accent-on-rounded').length,
      0,
      `expected only border findings, got: ${f.map(r => `${r.antipattern}:${r.snippet}`).join('; ')}`
    );
  });

  it('partial-component: flags borders, skips page-level', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'partial-component.html'));
    assert.ok(f.some(r => r.antipattern === 'side-tab'));
    assert.equal(f.filter(r => r.antipattern === 'flat-type-hierarchy').length, 0);
  });

  it('color: flag column triggers all color rules, pass column adds none', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'color.html'));
    // pure-black-white was removed from the skill in v3.2; only the remaining rules
    // are expected to fire from the flag column.
    assert.ok(f.some(r => r.antipattern === 'gray-on-color'), 'expected gray-on-color');
    assert.ok(f.some(r => r.antipattern === 'low-contrast'), 'expected low-contrast');
    assert.ok(f.some(r => r.antipattern === 'gradient-text'), 'expected gradient-text');
    assert.ok(f.some(r => r.antipattern === 'ai-color-palette'), 'expected ai-color-palette');
    assert.equal(
      f.some(r => r.antipattern === 'pure-black-white'),
      false,
      'pure-black-white detector was removed in v3.2',
    );
    // Gradient-bg + gray text case (added with the gradient-fix patch)
    assert.ok(
      f.some(r => r.antipattern === 'low-contrast' && /#808080|#3b82f6|#8b5cf6/i.test(r.snippet || '')),
      'expected low-contrast finding for gray heading on blue/purple gradient',
    );
    assert.ok(
      f.some(r => r.antipattern === 'gray-on-color' && /gradient/i.test(r.snippet || '')),
      'expected gray-on-color finding referencing gradient',
    );
  });

  it('color: white text on background-image url() ancestor is not flagged as low-contrast', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'color.html'));
    // The pass column has white text on a div with background-image: url().
    // The detector can't know the image color, so it must not assume the body
    // bg and report a false low-contrast finding (#ffffff on #fafafa).
    const falsePositive = f.filter(r =>
      r.antipattern === 'low-contrast' &&
      /#ffffff on #fafafa/i.test(r.snippet || '')
    );
    assert.equal(
      falsePositive.length, 0,
      `expected no low-contrast from bg-image ancestor, got: ${falsePositive.map(r => r.snippet).join('; ')}`
    );
  });

  it('color: styled <a> and <button> with their own background get contrast checks', async () => {
    // SAFE_TAGS skips <a> and <button> by default to avoid noise on inline links
    // (text links inside paragraphs). When these elements are styled as buttons
    // (own opaque background, padding, direct text), the contrast check must run.
    // Mirrors a real bug from the landing-demo: a pill-style <a> with
    // warm-charcoal text on near-black bg, ~2:1 contrast, was missed by both
    // the CLI and browser overlay paths because <a> was categorically skipped.
    const f = await detectHtml(path.join(FIXTURES, 'color.html'));
    const pillBtnFlag = f.some(r =>
      r.antipattern === 'low-contrast' &&
      /#5b4f44/i.test(r.snippet || '') &&
      /#1f1a15/i.test(r.snippet || '')
    );
    assert.ok(pillBtnFlag, 'expected low-contrast finding for styled <a> pill button');
    const styledButtonFlag = f.some(r =>
      r.antipattern === 'low-contrast' &&
      /#6c7280/i.test(r.snippet || '') &&
      /#374151/i.test(r.snippet || '')
    );
    assert.ok(styledButtonFlag, 'expected low-contrast finding for styled <button>');
  });

  it('color: inline <a> without own background remains skipped (no regression)', async () => {
    // The exception for styled buttons must not regress to flagging plain
    // inline text links — those would create noise on essentially every
    // page on the web.
    const f = await detectHtml(path.join(FIXTURES, 'color.html'));
    const inlineLinkFalsePositive = f.some(r =>
      r.antipattern === 'low-contrast' &&
      /#aaaaaa/i.test(r.snippet || '')
    );
    assert.equal(
      inlineLinkFalsePositive, false,
      'inline <a> without own background must remain skipped'
    );
  });

  it('color: styled <a> with good contrast does not flag', async () => {
    // The detector exception must let the check run, but a properly contrasted
    // styled button must obviously pass.
    const f = await detectHtml(path.join(FIXTURES, 'color.html'));
    const goodPillFalsePositive = f.some(r =>
      r.antipattern === 'low-contrast' &&
      /#f5f0e8/i.test(r.snippet || '') &&
      /#141419/i.test(r.snippet || '')
    );
    assert.equal(
      goodPillFalsePositive, false,
      'styled <a> with high contrast must not flag'
    );
  });

  it('color: text-bearing chips with their own background get contrast checks', async () => {
    // A <span> chip painting an opaque background under direct text is a real
    // contrast surface even though span sits in SAFE_TAGS. Mirrors a shipped
    // miss: a SEV-2 chip whose white text lost a specificity fight and
    // rendered muted brown on red at 1.2:1.
    const f = await detectHtml(path.join(FIXTURES, 'color.html'));
    const chipFlag = f.some(r =>
      r.antipattern === 'low-contrast' &&
      /#5c5449/i.test(r.snippet || '') &&
      /#b6322d/i.test(r.snippet || '')
    );
    assert.ok(chipFlag, 'expected low-contrast finding for the SEV-2 style chip');

    // The properly contrasted chip must pass, and the sub-9px decorative
    // chip stays below the font floor.
    const chipOkFalsePositive = f.some(r =>
      r.antipattern === 'low-contrast' &&
      /#f5f0e8/i.test(r.snippet || '') &&
      /#141419/i.test(r.snippet || '')
    );
    assert.equal(chipOkFalsePositive, false, 'high-contrast chip must not flag');
    const sub9FalsePositive = f.some(r =>
      r.antipattern === 'low-contrast' &&
      /#963c37/i.test(r.snippet || '')
    );
    assert.equal(sub9FalsePositive, false, 'sub-9px chip must stay below the font floor');
  });

  it('color: background none shorthand resets an earlier background-color', async () => {
    // `pre code { background: none }` after `code { background: <light> }`
    // must leave the code text transparent over the dark panel. Keeping the
    // light surface produces a phantom 1.1:1 finding the browser never paints.
    const f = await detectHtml(path.join(FIXTURES, 'color.html'));
    const phantom = f.some(r =>
      r.antipattern === 'low-contrast' &&
      /#e6e8ed/i.test(r.snippet || '') &&
      /#f6f2f4/i.test(r.snippet || '')
    );
    assert.equal(phantom, false, 'background: none must reset the earlier code background');
  });

  it('color: emoji-only text is never flagged as low-contrast', async () => {
    // Emojis render as multicolor glyphs regardless of CSS `color`, so the
    // CSS text color is irrelevant for contrast. The fixture's emoji cards
    // intentionally set text color to match the bg (which would trip the
    // rule for any other text). The detector must skip emoji-only nodes.
    const f = await detectHtml(path.join(FIXTURES, 'color.html'));
    const emojiCardColorPairs = ['#ffe4e6 on #ffe4e6', '#1a1a1a on #1a1a1a'];
    const matches = f.filter(r =>
      (r.antipattern === 'low-contrast' || r.antipattern === 'gray-on-color') &&
      emojiCardColorPairs.some(pair => (r.snippet || '').includes(pair))
    );
    assert.equal(
      matches.length, 0,
      `expected no contrast findings on emoji-only text, got: ${matches.map(r => r.snippet).join('; ')}`
    );
  });

  it('legitimate-borders: zero findings', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'legitimate-borders.html'));
    assert.equal(f.length, 0, `expected no findings, got: ${f.map(r => `${r.antipattern}:${r.snippet}`).join('; ')}`);
  });

  it('modern-color-borders: oklch/oklab/lch/lab side-tabs are flagged, neutrals pass', async () => {
    // Regression for the isNeutralColor bug where any non-rgb() color format
    // (oklch, oklab, lch, lab — which jsdom does NOT normalize to rgb) was
    // misclassified as neutral, causing checkBorders() to silently skip
    // every element with a modern-color side border.
    //
    // Also regression for the SAFE_TAGS/label bug: card-shaped <label>
    // elements (clickable checklist rows with padding + radius + colored
    // side border) used to be silently skipped because checkBorders'
    // SAFE_TAGS gate excluded <label>. The fix narrows that gate so card-
    // shaped labels are checked while plain inline form labels still pass.
    const f = await detectHtml(path.join(FIXTURES, 'modern-color-borders.html'));
    const sideTabs = f.filter(r => r.antipattern === 'side-tab');
    // Twelve FLAG cases: oklch x3, oklab, lch, lab — all colored border-left
    // with a non-zero border-radius — plus two card-shaped <label> cases
    // (one oklch, one rgb), plus four var()-based cases (shorthand, mixed
    // neutral+colored, border-right, and a card-shaped <label>). Each must
    // produce exactly one side-tab.
    assert.equal(
      sideTabs.length, 12,
      `expected 12 side-tab findings from the FLAG column, got ${sideTabs.length}: ${sideTabs.map(r => r.snippet).join('; ')}`
    );
    // Eleven findings must be border-left; exactly one is border-right
    // (the #flag-var-right case). The fixture doesn't decorate top/bottom
    // on any flag element.
    const leftFindings = sideTabs.filter(r => /border-left/.test(r.snippet || ''));
    const rightFindings = sideTabs.filter(r => /border-right/.test(r.snippet || ''));
    assert.equal(leftFindings.length, 11, `expected 11 border-left findings, got ${leftFindings.length}`);
    assert.equal(rightFindings.length, 1, `expected 1 border-right finding, got ${rightFindings.length}`);
    // PASS column must contribute zero border findings of either flavor.
    // There are 14 pass cases: 7 structural neutrals plus 4 labels (plain
    // inline form label, label with a neutral gray border, label in a form
    // row, and a label with a thin 1px colored left border), plus 3 var()
    // pass cases (neutral-resolving var, thin var, uniform all-sides var).
    // If any leaks through, the label exception or var() fallback is
    // over-broad.
    const borderAccent = f.filter(r => r.antipattern === 'border-accent-on-rounded');
    assert.equal(
      borderAccent.length, 0,
      `expected 0 border-accent-on-rounded, got ${borderAccent.length}: ${borderAccent.map(r => r.snippet).join('; ')}`
    );
  });

  it('modern-color-borders: regex fallback skips neutral 1px oklch dividers', () => {
    const css = `
      .flag-side-tab {
        border-radius: 8px;
        border-left: 2px solid oklch(65% 0.12 250);
      }

      .pass-context-divider {
        border-radius: 8px;
        border-right: 1px solid oklch(92% 0 0 / 0.12);
      }

      .pass-neutral-side {
        border-radius: 8px;
        border-left: 3px solid oklch(80% 0 0);
      }
    `;
    const f = detectText(css, path.join(FIXTURES, 'modern-color-borders-regex.css'));
    const sideTabs = f.filter(r => r.antipattern === 'side-tab');
    assert.equal(
      sideTabs.length,
      1,
      `expected only the colored 2px side-tab to flag, got: ${sideTabs.map(r => r.snippet).join('; ')}`
    );
    assert.match(sideTabs[0].snippet, /border-left: 2px solid oklch/);
  });

  it('typography-should-flag: detects all three issues', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'typography-should-flag.html'));
    assert.ok(f.some(r => r.antipattern === 'overused-font'));
    assert.ok(f.some(r => r.antipattern === 'single-font'));
    assert.ok(f.some(r => r.antipattern === 'flat-type-hierarchy'));
    assert.equal(
      f.some(r => r.antipattern === 'low-contrast'),
      false,
      `typography fixture should not contain incidental contrast findings: ${f.map(r => `${r.antipattern}:${r.snippet}`).join('; ')}`
    );
  });

  it('typography: side-by-side page has visible element-level flag cases', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'typography.html'));
    const ids = new Set(f.map(r => r.antipattern));
    for (const id of ['tight-leading', 'tiny-text', 'all-caps-body', 'wide-tracking', 'justified-text']) {
      assert.ok(ids.has(id), `expected typography side-by-side fixture to include ${id}`);
    }
    assert.ok(ids.has('overused-font'), 'expected typography side-by-side fixture to include a page-level overused-font finding');
  });

  it('typography-should-pass: zero findings', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'typography-should-pass.html'));
    assert.equal(f.length, 0);
  });

  it('design-system: flags only values outside the provided DESIGN.md tokens', async () => {
    const designSystem = normalizeDesignSystem({
      frontmatter: {
        typography: {
          display: { fontFamily: 'Avenir Next, Georgia, serif', fontSize: 'clamp(2.5rem, 6vw, 4rem)' },
          body: { fontFamily: 'IBM Plex Sans, Arial, sans-serif', fontSize: '16px' },
          label: { fontFamily: 'IBM Plex Sans, Arial, sans-serif', fontSize: '14px' },
        },
        colors: {
          ink: '#241f1a',
          paper: '#f7f4ee',
          surface: '#ffffff',
          accent: '#b8422e',
          border: '#d4c7b9',
        },
        rounded: {
          sm: '4px',
          md: '8px',
          '"2xl"': '32px',
          full: '999px',
        },
      },
      sidecar: {
        extensions: {
          colorMeta: {
            accent: {
              canonical: '#b8422e',
              tonalRamp: ['#923524', '#d55a42'],
            },
          },
        },
      },
    });
    const f = await detectHtml(path.join(FIXTURES, 'design-system.html'), { designSystem });
    const designFindings = f.filter((r) => r.antipattern.startsWith('design-system-'));
    const snippets = designFindings.map((r) => r.snippet).join('\n');

    assert.ok(designFindings.some((r) => r.antipattern === 'design-system-font'), 'expected unsupported font');
    assert.ok(designFindings.some((r) => r.antipattern === 'design-system-color'), 'expected undocumented colors');
    assert.ok(designFindings.some((r) => r.antipattern === 'design-system-radius'), 'expected undocumented radius');
    assert.ok(
      designFindings.some((r) => r.antipattern === 'design-system-font' && /Google Fonts: Poppins/.test(r.snippet || '')),
      'expected source-level Google Fonts usage in HTML to be flagged',
    );
    assert.ok(
      designFindings.some((r) => r.antipattern === 'design-system-font-size' && /12\.5px/.test(r.snippet || '')),
      'expected off-ramp literal font-size to be flagged',
    );
    assert.doesNotMatch(snippets, /1rem is off/, 'documented rem step must pass');
    assert.doesNotMatch(snippets, /1\.2em is off/, 'relative em sizes are abstained on');
    assert.doesNotMatch(snippets, /16px is off|14px is off/, 'on-ramp sizes must pass');
    assert.doesNotMatch(snippets, /Undocumented color #ff00aa/, 'source and computed color findings should not duplicate');
    assert.doesNotMatch(snippets, /font-family: Poppins/, 'source and computed font findings should not duplicate');
    assert.doesNotMatch(snippets, /border-radius: 18px is outside/, 'source and computed radius findings should not duplicate');
    assert.doesNotMatch(snippets, /on style "\.design-system-fixture/, 'static DOM design pass should skip <style> content');
    assert.equal(
      designFindings.find((r) => /Flag Color Hot Pink/.test(r.snippet || ''))?.line,
      37,
      'deduped HTML design findings should keep the source line when available',
    );
    assert.equal(
      designFindings.find((r) => /Flag Radius Eighteen/.test(r.snippet || ''))?.line,
      40,
      'deduped radius findings should keep the source line when available',
    );

    for (const label of [
      'Flag Font Unsupported',
      'Flag Color Hot Pink',
      'Flag Background Cyan',
      'Flag Border Teal',
      'Flag Radius Eighteen',
    ]) {
      assert.match(snippets, new RegExp(label), `expected ${label} to be flagged`);
    }
    for (const label of [
      'Pass Display Font',
      'Pass Rem Font Size',
      'Pass Relative Font Size',
      'Pass Generic Font',
      'Pass Token Color',
      'Pass Alpha Color',
      'Pass Close Color',
      'Pass Ramp Color',
      'Pass Zero Radius',
      'Pass Percent Radius',
      'Pass Scale Radius',
      'Pass Pill Radius',
    ]) {
      assert.doesNotMatch(snippets, new RegExp(label), `${label} should pass`);
    }
  });

  it('numeric content is not classified without DOM context', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'numbered-section-markers.html'));
    const numbered = f.filter(r => r.antipattern === 'numbered-section-markers');
    assert.equal(numbered.length, 0, 'raw numeric sequences must not masquerade as semantic section evidence');
  });

  it('numbered-section-labels: tiny repeated index labels flag, deliberate/list/card numbering passes', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'numbered-section-labels.html'));
    const labels = f.filter(r => r.antipattern === 'numbered-section-labels');
    const snippets = labels.map(r => r.snippet).join(' | ');
    assert.equal(
      labels.length,
      4,
      `expected 4 numbered-label findings, got ${labels.length}: ${snippets}`
    );
    for (const heading of ['Alpha ships first', 'Beta earns trust', 'Gamma holds the line', 'Delta closes the loop']) {
      assert.match(snippets, new RegExp(heading), `expected label beside "${heading}" to flag`);
    }
    for (const heading of ['Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu']) {
      assert.doesNotMatch(snippets, new RegExp(heading), `label beside "${heading}" should pass`);
    }
  });

  it('repeated-container-text: same string in 3+ distinct slots of one card flags; structural repetition passes', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'repeated-container-text.html'));
    const repeats = f.filter(r => r.antipattern === 'repeated-container-text');
    const snippets = repeats.map(r => r.snippet).join(' | ');
    assert.equal(
      repeats.length,
      2,
      `expected 2 repeated-text findings, got ${repeats.length}: ${snippets}`
    );
    assert.match(snippets, /Suspended.*3×|Suspended" rendered 3/, 'expected the 3-slot status word to flag');
    assert.match(snippets, /Unavailable" rendered 4/, 'expected the 4-slot status word to flag');
    for (const passText of ['Rolled back', 'On schedule', 'Overview page', 'Standby mode', 'Open slot', 'Rescheduled', '2026']) {
      assert.doesNotMatch(snippets, new RegExp(passText), `"${passText}" should pass`);
    }
  });
});

describe('detectHtml — icon-tile-stack', () => {
  // Two-column fixture convention: left col = should-flag, right col = should-pass.
  // The rule's snippet embeds the heading text in quotes, e.g.
  //   "80x80px icon tile above h3 \"Lightning Fast\"".
  // The test extracts those quoted texts and matches them against the
  // expected lists below.
  const SHOULD_FLAG = [
    'Lightning Fast',
    'Secure Storage',
    'Easy Setup',
    'Powerful Analytics',
    'Emoji Inline Icon',
  ];
  const SHOULD_PASS = [
    'Sarah Chen',
    'Article Headline',
    'Inline Side By Side',
    'Plain Heading No Icon',
    'Tiny Icon Above Me',
    'Huge Hero Image',
  ];

  it('icon-tile-stack: flags only the should-flag column', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'icon-tile-stack.html'));
    const flagged = new Set();
    for (const r of f) {
      if (r.antipattern !== 'icon-tile-stack') continue;
      const m = (r.snippet || '').match(/"([^"]+)"/);
      if (m) flagged.add(m[1]);
    }

    for (const text of SHOULD_FLAG) {
      assert.ok(flagged.has(text), `expected "${text}" to be flagged as icon-tile-stack`);
    }
    for (const text of SHOULD_PASS) {
      assert.ok(!flagged.has(text), `"${text}" should NOT be flagged as icon-tile-stack`);
    }
  });
});

describe('detectHtml — quality (static-compatible rules)', () => {
  // Six of the eight quality rules can run in static HTML/CSS because they only need
  // computed CSS values (tight-leading, tiny-text, justified-text,
  // all-caps-body, wide-tracking) or pure DOM walks (skipped-heading).
  // The other two (line-length, cramped-padding) need real layout rects and
  // live in tests/detect-antipatterns-browser.test.mjs (Puppeteer-backed).
  it('quality: flag column triggers all 6 static-compatible quality rules', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'quality.html'));
    assert.equal(f.filter(r => r.antipattern === 'tight-leading').length, 1);
    assert.equal(f.filter(r => r.antipattern === 'tiny-text').length, 1);
    assert.equal(f.filter(r => r.antipattern === 'justified-text').length, 1);
    assert.equal(f.filter(r => r.antipattern === 'all-caps-body').length, 1);
    assert.equal(f.filter(r => r.antipattern === 'wide-tracking').length, 1);
    assert.equal(f.filter(r => r.antipattern === 'skipped-heading').length, 1);
  });
});

describe('detectHtml — layout', () => {
  it('layout: flag column triggers nested-cards, pass column adds none', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'layout.html'));
    const nested = f.filter(r => r.antipattern === 'nested-cards');
    assert.ok(nested.length >= 4, `expected ≥4 nested-cards findings, got ${nested.length}`);
    // The page-level layout rules (monotonous-spacing, everything-centered)
    // need Tailwind-via-CDN to render, which the static engine does not fetch.
    // They're effectively dormant in this test environment regardless of the fixture
    // contents — so all we can verify is that the pass column doesn't push
    // them awake unexpectedly.
    assert.equal(f.filter(r => r.antipattern === 'monotonous-spacing').length, 0);
    assert.equal(f.filter(r => r.antipattern === 'everything-centered').length, 0);
  });
});

describe('detectHtml — italic-serif-display', () => {
  // Two-column fixture: left col flag, right col pass. Snippet embeds the
  // heading text in quotes so the test can extract it via /"([^"]+)"/.
  const SHOULD_FLAG = [
    'Fraunces 88px italic',
    'Recoleta 64px italic',
    'Playfair 72px italic',
    'Unknown Serif Generic Fallback',
  ];
  const SHOULD_PASS = [
    'Sans Italic Display',
    'Roman Serif Display',
    'Italic Serif Pull Quote',
    // The italic <em> inside the roman h1 is intentionally not detected in v1.
    // The h1's own text "Inline Em Inside Roman" must not appear flagged.
    'Inline Em Inside Roman',
    'Italic Serif at 32px',
    'h1 Sans-Serif Roman',
  ];

  it('italic-serif-display: flags only the should-flag column', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'italic-serif-display.html'));
    const flagged = new Set();
    for (const r of f) {
      if (r.antipattern !== 'italic-serif-display') continue;
      const m = (r.snippet || '').match(/"([^"]+)"/);
      if (m) flagged.add(m[1]);
    }

    for (const text of SHOULD_FLAG) {
      assert.ok(flagged.has(text), `expected "${text}" to be flagged as italic-serif-display`);
    }
    for (const text of SHOULD_PASS) {
      assert.ok(!flagged.has(text), `"${text}" should NOT be flagged as italic-serif-display`);
    }
  });
});

describe('detectHtml — hero-eyebrow-chip', () => {
  const SHOULD_FLAG = [
    'Eyebrow Above Hero',
    'Span Eyebrow Above Hero',
    'Pill Chip Above Hero',
    'Already Uppercase Text',
    'Long Uppercase Sentence Above Hero',
  ];
  const SHOULD_PASS = [
    'Eyebrow With Normal Tracking',
    'Uppercase Caption Far From Hero',
    'Hero With No Eyebrow',
    'Heading Above Heading',
    'Body-Sized Heading Below Eyebrow',
    'Application Panel Heading',
  ];

  it('hero-eyebrow-chip: flags only the should-flag column', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'hero-eyebrow-chip.html'));
    const flagged = new Set();
    for (const r of f) {
      if (r.antipattern !== 'hero-eyebrow-chip') continue;
      // Snippet shape: ... above h1 "Heading Text"
      const matches = [...(r.snippet || '').matchAll(/"([^"]+)"/g)];
      // Last quoted token is the heading text
      if (matches.length) flagged.add(matches[matches.length - 1][1]);
    }

    for (const text of SHOULD_FLAG) {
      assert.ok(flagged.has(text), `expected "${text}" to be flagged as hero-eyebrow-chip`);
    }
    for (const text of SHOULD_PASS) {
      assert.ok(!flagged.has(text), `"${text}" should NOT be flagged as hero-eyebrow-chip`);
    }
  });
});

describe('detectHtml — repeated-section-kickers', () => {
  const SHOULD_FLAG = [
    'The Future Is Admitted',
    'A Private Rehearsal',
    'Reviewed, Not Sold',
    'Touch the Future',
  ];
  const SHOULD_PASS = [
    'Breadcrumb Before Heading',
    'Form Heading Is Separate',
    'Step Indicator',
    'Figure Caption Label',
    'Normal Case Kicker',
    'Intentional Brand Label',
    'Garden Suite',
    'Sea Loft',
    'Cliff Suite',
    '/impeccabletypeset',
    '/impeccablelayout',
    '/impeccablecolorize',
    '/impeccablecraft',
    '/impeccableaudit',
    '/impeccablepolish',
    'Mockup Hero Variant One',
    'Mockup Hero Variant Two',
    'Mockup Hero Variant Three',
  ];

  it('repeated-section-kickers: flags only repeated section scaffolding', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'repeated-section-kickers.html'));
    const flagged = new Set();
    for (const r of f) {
      if (r.antipattern !== 'repeated-section-kickers') continue;
      assert.equal(r.severity, 'advisory');
      const matches = [...(r.snippet || '').matchAll(/"([^"]+)"/g)];
      if (matches.length) flagged.add(matches[matches.length - 1][1]);
    }

    for (const text of SHOULD_FLAG) {
      assert.ok(flagged.has(text), `expected "${text}" to be flagged as repeated-section-kickers`);
    }
    for (const text of SHOULD_PASS) {
      assert.ok(!flagged.has(text), `"${text}" should NOT be flagged as repeated-section-kickers`);
    }
  });
});

describe('detectHtml — motion', () => {
  // The static CSS engine applies class-based fixture styles, so it catches all
  // flag-column layout-transition cases without relying on browser layout.
  it('motion: flag column triggers both motion rules, pass column adds none', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'motion.html'));
    assert.equal(f.filter(r => r.antipattern === 'bounce-easing').length, 2);
    assert.equal(f.filter(r => r.antipattern === 'layout-transition').length, 8);
  });
});

describe('detectHtml — dark glow', () => {
  // Calibrated static baseline — see motion test note above.
  // 11 element-level findings (glow-blue, glow-purple, glow-cyan, glow-multi,
  // inline pink, glow-oklch, glow-hex, glow-hsl, glow-var, glow-text,
  // glow-light-oklch) + 1 page-level text-scan finding. Pass column adds none.
  it('glow: flag column triggers dark-glow, pass column adds none', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'glow.html'));
    const glow = f.filter(r => r.antipattern === 'dark-glow');
    assert.equal(glow.length, 12);
    // Every finding is a glow tell, none reference the pass-column shadows
    for (const g of glow) {
      assert.match(g.snippet, /Zero-offset (box|text)-shadow glow|Colored (box|text)-shadow glow/);
    }
  });
});

describe('detectHtml — cramped-padding (wrapper variant)', () => {
  // The cramped-padding rule has two shapes (merged under one id):
  //   1. Self-text: element has its own text and padding-vs-font-size is wrong
  //   2. Wrapper:   element wraps text-bearing children and has near-zero
  //                 padding against a visible boundary (border/outline/bg)
  // This suite covers the wrapper variant via flush-against-border.html.
  // The self-text variant lives in tests/detect-antipatterns-browser.test.mjs
  // because it needs real layout rects.
  //
  // Snippet for the wrapper variant embeds the element's class in quotes
  // so the test can grep for which cases fired.
  const SHOULD_FLAG_CLASSES = [
    'flag-frameworks',
    'flag-card-borders',
    'flag-bg-only',
    'flag-outline-only',
    'flag-asym-leftflush',
  ];
  const SHOULD_PASS_CLASSES = [
    'pass-no-boundary',
    'pass-top-rule',
    'pass-bordered-padded',
    'pass-bg-padded',
    'pass-outline-padded',
    'pass-image-only',
    'pass-margin-inset',
    'pass-inner-shell',
    'pass-same-bg-child',
    'pass-inner-text-surface',
  ];

  it('cramped-padding (wrapper): flags only the should-flag column', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'flush-against-border.html'));
    const flagged = new Set();
    for (const r of f) {
      if (r.antipattern !== 'cramped-padding') continue;
      const m = (r.snippet || '').match(/"([^"]+)"/);
      if (m) flagged.add(m[1]);
    }

    for (const cls of SHOULD_FLAG_CLASSES) {
      assert.ok(
        flagged.has(cls),
        `expected ".${cls}" to be flagged as cramped-padding (got: ${[...flagged].join(', ')})`
      );
    }
    for (const cls of SHOULD_PASS_CLASSES) {
      assert.ok(
        !flagged.has(cls),
        `".${cls}" should NOT be flagged as cramped-padding`
      );
    }
  });
});

describe('detectHtml — oversized-h1', () => {
  // Fires when a LONG headline is set at display size (dominating the
  // viewport). A punchy one/two-word headline at the same size is a valid
  // stylistic choice and must pass; so must a long headline at a sane size.
  it('oversized-h1: flags only long headlines set at display size', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'oversized-h1.html'));
    const hits = f.filter(r => r.antipattern === 'oversized-h1');
    assert.equal(
      hits.length, 2,
      `expected 2 oversized-h1 findings, got ${hits.length}: ${hits.map(r => r.snippet).join('; ')}`,
    );
    // None of the pass cases (short-but-huge, or long-but-sane-size) may flag.
    assert.equal(
      hits.some(r => /Bold\.|Ship faster|ordinary headline/i.test(r.snippet || '')),
      false,
      'short display headlines and sanely-sized long headlines must not flag',
    );
  });
});

describe('detectHtml — extreme-negative-tracking', () => {
  // Mirror image of wide-tracking: catches letter-spacing crushed past the
  // point of legibility. Optical tightening that display type legitimately
  // wants (around -0.02em) must pass.
  it('extreme-negative-tracking: flags the 3 crushed cases, pass column adds none', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'extreme-negative-tracking.html'));
    const hits = f.filter(r => r.antipattern === 'extreme-negative-tracking');
    assert.equal(
      hits.length, 3,
      `expected 3 extreme-negative-tracking findings, got ${hits.length}: ${hits.map(r => r.snippet).join('; ')}`
    );
    assert.equal(
      hits.some(r => /Optical tighten/i.test(r.snippet || '')),
      false,
      'the -0.02em display heading must not be flagged',
    );
  });
});

describe('detectHtml — clipped-overflow-container', () => {
  // Snippet embeds the container class in quotes. A clipping ancestor
  // (overflow hidden/clip) with an absolutely-positioned descendant clips
  // tooltips/menus that need to escape. Real scroll regions (auto/scroll),
  // visible overflow, and clipping containers without positioned children pass.
  const SHOULD_FLAG = [
    'flag-overflow-hidden',
    'flag-overflow-clip',
    'flag-overflow-negative',
    'flag-overflow-right',
    'flag-shadow-utility',
    'flag-overlay-surface',
  ];
  const SHOULD_PASS = [
    'pass-hidden-no-abs',
    'pass-visible-abs',
    'pass-scroll-abs',
    'pass-contained-abs',
    'pass-button-shine',
    'pass-crop-photo',
    'pass-contained-overlay',
    'pass-carousel-viewport',
    'pass-fisheye-list',
    'pass-split-container',
  ];

  it('clipped-overflow-container: flags only clipping ancestors with positioned children', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'clipped-overflow-container.html'));
    const flagged = new Set();
    for (const r of f) {
      if (r.antipattern !== 'clipped-overflow-container') continue;
      const m = (r.snippet || '').match(/(flag-[\w-]+|pass-[\w-]+)/);
      if (m) flagged.add(m[1]);
    }
    for (const cls of SHOULD_FLAG) {
      assert.ok(flagged.has(cls), `expected ".${cls}" to be flagged as clipped-overflow-container`);
    }
    for (const cls of SHOULD_PASS) {
      assert.ok(!flagged.has(cls), `".${cls}" should NOT be flagged as clipped-overflow-container`);
    }
  });
});

describe('detectHtml — cream-palette', () => {
  it('cream-palette: flags a warm cream/beige page background', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'cream-palette.html'));
    assert.equal(
      f.filter(r => r.antipattern === 'cream-palette').length, 1,
      `expected one cream-palette finding, got: ${f.filter(r => r.antipattern === 'cream-palette').map(r => r.snippet).join('; ')}`,
    );
  });

  it('cream-palette: does not fire on a neutral (non-cream) page', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'typography-should-pass.html'));
    assert.equal(f.some(r => r.antipattern === 'cream-palette'), false, 'neutral page must not flag cream-palette');
  });

  it('cream-palette: catches a Tailwind warm-light bg utility on body', async () => {
    // No inline/<style> background — only a `bg-amber-50` class, which the
    // static engine can't resolve to computed CSS. The class-list fallback
    // must still flag it.
    const f = await detectHtml(path.join(FIXTURES, 'cream-palette-tailwind.html'));
    const hits = f.filter(r => r.antipattern === 'cream-palette');
    assert.equal(hits.length, 1, `expected one cream-palette finding, got: ${hits.map(r => r.snippet).join('; ')}`);
    assert.match(hits[0].snippet, /amber-50/, 'snippet should name the Tailwind utility');
  });
});

describe('detectHtml — generated-UI tells', () => {
  const GPT_IDS = ['gpt-thin-border-wide-shadow', 'repeating-stripes-gradient', 'codex-grid-background', 'theater-slop-phrase'];

  it('gpt-tells: each flag case surfaces by default and the pass column adds none', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'gpt-tells.html'));
    for (const id of GPT_IDS) {
      assert.equal(
        f.filter(r => r.antipattern === id).length, 1,
        `expected exactly one default ${id} finding, got ${f.filter(r => r.antipattern === id).length}`,
      );
    }
  });

  it('gemini-tells: both flag cases surface by default and pass cases stay legal', async () => {
    const findings = await detectHtml(path.join(FIXTURES, 'gemini-tells.html'));
    // Two flag cases: a CSS img:hover{transform} rule and a Tailwind hover:scale on <img>.
    assert.equal(
      findings.filter(r => r.antipattern === 'image-hover-transform').length, 2,
      `expected 2 default image-hover-transform findings, got ${findings.filter(r => r.antipattern === 'image-hover-transform').length}`,
    );
  });
});

describe('em-dash overuse — HTML entity escapes', () => {
  // Build a full page so the page-level text-content analyzer runs. `body` is the
  // prose that carries the dashes; the doctype/html scaffold is required by
  // isFullPage(). Each dash spelling is a separate case because the rule counts
  // per page, not per element.
  const page = (body) =>
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>t</title></head>` +
    `<body><main><h1>A real page heading of ordinary length</h1><p>${body}</p></main></body></html>`;

  // Six dashes clears the 5+ threshold. Sentence fragments keep the surrounding
  // prose realistic so nothing else in the pipeline objects.
  const sixNamed = 'fast &mdash; cheap &mdash; honest &mdash; simple &mdash; quiet &mdash; kind &mdash; done';
  const sixNumeric = 'fast &#8212; cheap &#8212; honest &#8212; simple &#8212; quiet &#8212; kind &#8212; done';
  const sixHex = 'fast &#x2014; cheap &#x2014; honest &#x2014; simple &#x2014; quiet &#x2014; kind &#x2014; done';
  const sixHexUpper = 'fast &#X2014; cheap &#X2014; honest &#X2014; simple &#X2014; quiet &#X2014; kind &#X2014; done';
  const sixNumericPadded = 'fast &#08212; cheap &#08212; honest &#08212; simple &#08212; quiet &#08212; kind &#08212; done';
  // Three literal glyphs + three named entities render identically; the count
  // must see all six.
  const mixed = 'fast — cheap — honest — simple &mdash; quiet &mdash; kind &mdash; done';

  const SHOULD_FLAG = {
    'named &mdash;': sixNamed,
    'numeric &#8212;': sixNumeric,
    'hex &#x2014;': sixHex,
    'uppercase-hex &#X2014;': sixHexUpper,
    'zero-padded decimal &#08212;': sixNumericPadded,
    'mixed literal + entity': mixed,
  };

  // False-positive shapes: none of these should trip the em-dash counter.
  const SHOULD_PASS = {
    // Below the 5+ threshold: occasional em-dash entity use is legitimate prose.
    'two entities below threshold': 'fast &mdash; cheap &mdash; done, otherwise plain sentences fill the paragraph body',
    // En-dashes are a different character and a different job (ranges); the em-dash
    // rule must not decode or count them.
    'en-dash entities': 'pages 10&ndash;20 and 30&ndash;40 and 50&ndash;60 and 70&ndash;80 and 90&ndash;100 and 1&ndash;2',
    'numeric en-dash entities': 'pages 10&#8211;20 and 30&#8211;40 and 50&#8211;60 and 70&#8211;80 and 90&#8211;100 and 1&#8211;2',
    // Double-escaped: the visible text is the literal string "&mdash;", not a dash.
    'double-escaped ampersand': 'write &amp;mdash; and &amp;mdash; and &amp;mdash; and &amp;mdash; and &amp;mdash; and &amp;mdash; literally',
    // Unrelated entities must never be miscounted as dashes.
    'non-dash entities': 'a&nbsp;b &copy; c &hellip; d &amp; e &trade; f &reg; g &deg; h &sect; i &para;',
    // Ordinary hyphenated compounds are single hyphens, not the double-hyphen tell.
    'hyphenated compounds': 'state-of-the-art, well-being, high-quality, self-service, end-to-end, at-a-glance copy',
  };

  const emDashCount = (findings) =>
    findings.filter((r) => r.antipattern === 'em-dash-overuse').length;

  for (const [label, body] of Object.entries(SHOULD_FLAG)) {
    it(`flags em-dash overuse spelled as ${label}`, () => {
      const findings = detectText(page(body), 'em-dash.html');
      assert.equal(
        emDashCount(findings), 1,
        `expected em-dash-overuse for "${label}", got: ${findings.map((r) => r.antipattern).join(', ') || 'none'}`,
      );
    });
  }

  for (const [label, body] of Object.entries(SHOULD_PASS)) {
    it(`does not flag ${label}`, () => {
      const findings = detectText(page(body), 'em-dash.html');
      assert.equal(
        emDashCount(findings), 0,
        `"${label}" should not flag em-dash overuse`,
      );
    });
  }

  it('static-HTML path decodes entity em-dashes too (fixture file)', async () => {
    const findings = await detectHtml(path.join(FIXTURES, 'em-dash-entities.html'));
    assert.equal(
      findings.filter((r) => r.antipattern === 'em-dash-overuse').length, 1,
      'em-dash-entities.html should flag em-dash overuse via the static-HTML path',
    );
  });
});
