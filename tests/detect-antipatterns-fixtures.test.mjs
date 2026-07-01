/**
 * Static HTML/CSS fixture tests for anti-pattern detection.
 * Run via Node's built-in test runner (not bun).
 *
 * Usage: node --test tests/detect-antipatterns-fixtures.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  detectHtml,
  detectText,
  normalizeDesignSystem,
} from '../cli/engine/detect-antipatterns.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures', 'antipatterns');

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
      4,
      `expected 4 side-tab findings, got ${sideTabs.length}: ${sideTabs.map(r => r.snippet).join('; ')}`
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
          display: { fontFamily: 'Avenir Next, Georgia, serif' },
          body: { fontFamily: 'IBM Plex Sans, Arial, sans-serif' },
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

  it('numbered-section-markers: visible sequence flags while script/style/svg internals pass', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'numbered-section-markers.html'));
    const numbered = f.filter(r => r.antipattern === 'numbered-section-markers');
    assert.equal(
      numbered.length,
      1,
      `expected one visible numbered-marker finding, got: ${numbered.map(r => r.snippet).join('; ')}`
    );
    assert.match(numbered[0].snippet, /01, 02, 03/);
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
    // The rule no longer gates on heading font size (modern hero h1s
    // use clamp() / vw / var() that static HTML/CSS cannot resolve), and the
    // eyebrow text ceiling moved 30 → 60 chars. Both shapes now flag.
    'Body-Sized Heading Below Eyebrow',
    'Long Uppercase Sentence Above Hero',
  ];
  const SHOULD_PASS = [
    'Eyebrow With Normal Tracking',
    'Uppercase Caption Far From Hero',
    'Hero With No Eyebrow',
    'Heading Above Heading',
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
  it('glow: flag column triggers dark-glow, pass column adds none', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'glow.html'));
    assert.equal(f.filter(r => r.antipattern === 'dark-glow').length, 1);
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

describe('detectHtml — gated provider tells (--gpt / --gemini)', () => {
  const GPT_IDS = ['gpt-thin-border-wide-shadow', 'repeating-stripes-gradient', 'codex-grid-background', 'theater-slop-phrase'];

  it('gpt-tells: gated OFF by default — none of the GPT idioms surface', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'gpt-tells.html'));
    for (const id of GPT_IDS) {
      assert.equal(
        f.some(r => r.antipattern === id), false,
        `${id} must not surface without --gpt`,
      );
    }
  });

  it('gpt-tells: with providers:[gpt], each flag case triggers once, pass column adds none', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'gpt-tells.html'), { providers: ['gpt'] });
    for (const id of GPT_IDS) {
      assert.equal(
        f.filter(r => r.antipattern === id).length, 1,
        `expected exactly one ${id} finding under --gpt, got ${f.filter(r => r.antipattern === id).length}`,
      );
    }
  });

  it('gemini-tells: gated OFF by default, ON under providers:[gemini]', async () => {
    const off = await detectHtml(path.join(FIXTURES, 'gemini-tells.html'));
    assert.equal(
      off.some(r => r.antipattern === 'image-hover-transform'), false,
      'image-hover-transform must not surface without --gemini',
    );
    const on = await detectHtml(path.join(FIXTURES, 'gemini-tells.html'), { providers: ['gemini'] });
    // Two flag cases: a CSS img:hover{transform} rule and a Tailwind hover:scale on <img>.
    assert.equal(
      on.filter(r => r.antipattern === 'image-hover-transform').length, 2,
      `expected 2 image-hover-transform findings under --gemini, got ${on.filter(r => r.antipattern === 'image-hover-transform').length}`,
    );
  });
});
