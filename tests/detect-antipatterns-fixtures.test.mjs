/**
 * jsdom fixture tests for anti-pattern detection.
 * Run via Node's built-in test runner (not bun) to avoid jsdom resource limits.
 *
 * Usage: node --test tests/detect-antipatterns-fixtures.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  detectHtml,
} from '../cli/engine/detect-antipatterns.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures', 'antipatterns');

describe('detectHtml — jsdom fixtures', () => {
  it('should-flag: catches border anti-patterns', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'should-flag.html'));
    assert.ok(f.some(r => r.antipattern === 'side-tab'));
    assert.ok(f.some(r => r.antipattern === 'border-accent-on-rounded'));
  });

  it('should-pass: zero border findings', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'should-pass.html'));
    assert.equal(f.filter(r => r.antipattern === 'side-tab' || r.antipattern === 'border-accent-on-rounded').length, 0);
  });

  it('linked-stylesheet: catches borders, no false positives', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'linked-stylesheet.html'));
    assert.ok(f.some(r => r.antipattern === 'side-tab'));
    assert.ok(f.some(r => r.antipattern === 'border-accent-on-rounded'));
    assert.equal(f.filter(r => r.snippet?.includes('clean')).length, 0);
  });

  it('partial-component: flags borders, skips page-level', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'partial-component.html'));
    assert.ok(f.some(r => r.antipattern === 'side-tab'));
    assert.equal(f.filter(r => r.antipattern === 'flat-type-hierarchy').length, 0);
  });

  it('color: flag column triggers all color rules, pass column adds none', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'color.html'));
    // All five color rules must fire from the flag column
    assert.ok(f.some(r => r.antipattern === 'pure-black-white'), 'expected pure-black-white');
    assert.ok(f.some(r => r.antipattern === 'gray-on-color'), 'expected gray-on-color');
    assert.ok(f.some(r => r.antipattern === 'low-contrast'), 'expected low-contrast');
    assert.ok(f.some(r => r.antipattern === 'gradient-text'), 'expected gradient-text');
    assert.ok(f.some(r => r.antipattern === 'ai-color-palette'), 'expected ai-color-palette');
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

  it('color: Tailwind bg-black/N opacity modifiers are not flagged as pure-black-white', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'color.html'));
    // The pass column has bg-black/3, hover:bg-black/5, bg-black/50 — none are pure black.
    // Only the flag column's literal bg-black class should trigger pure-black-white.
    const pureBlackFindings = f.filter(r => r.antipattern === 'pure-black-white');
    const opacityFalsePositives = pureBlackFindings.filter(r =>
      (r.snippet || '').includes('bg-black') &&
      f.some(() => true) // check that bg-black/N class triggers are absent
    );
    // There should be exactly the flag-column hits (bg-black class + #000000 inline)
    // and zero from the pass-column opacity variants.
    // The pass-column elements have data-test attributes starting with "bg-black-"
    // The Tailwind class check produces snippet "bg-black" — count those.
    const twSnippets = pureBlackFindings.filter(r => (r.snippet || '') === 'bg-black');
    assert.equal(
      twSnippets.length, 1,
      `expected exactly 1 Tailwind bg-black finding (flag column only), got ${twSnippets.length}: ${twSnippets.map(r => r.snippet).join('; ')}`
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

  it('legitimate-borders: minimal false positives', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'legitimate-borders.html'));
    const borderFindings = f.filter(r => r.antipattern === 'side-tab' || r.antipattern === 'border-accent-on-rounded');
    assert.ok(borderFindings.length <= 1);
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
    // There are 13 pass cases: 6 structural neutrals plus 4 labels (plain
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

  it('typography-should-flag: detects all three issues', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'typography-should-flag.html'));
    assert.ok(f.some(r => r.antipattern === 'overused-font'));
    assert.ok(f.some(r => r.antipattern === 'single-font'));
    assert.ok(f.some(r => r.antipattern === 'flat-type-hierarchy'));
  });

  it('typography-should-pass: zero findings', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'typography-should-pass.html'));
    assert.equal(f.length, 0);
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

describe('detectHtml — quality (jsdom-compatible rules)', () => {
  // Six of the eight quality rules can run in jsdom because they only need
  // computed CSS values (tight-leading, tiny-text, justified-text,
  // all-caps-body, wide-tracking) or pure DOM walks (skipped-heading).
  // The other two (line-length, cramped-padding) need real layout rects and
  // live in tests/detect-antipatterns-browser.test.mjs (Puppeteer-backed).
  it('quality: flag column triggers all 6 jsdom-compatible quality rules', async () => {
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
    // need Tailwind-via-CDN to render, which jsdom doesn't execute. They're
    // effectively dormant in this test environment regardless of the fixture
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
  ];
  const SHOULD_PASS = [
    'Eyebrow With Normal Tracking',
    'Body-Sized Heading Below Eyebrow',
    'Uppercase Caption Far From Hero',
    'Hero With No Eyebrow',
    'Heading Above Heading',
    'Long Uppercase Sentence Above Hero',
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

describe('detectHtml — motion', () => {
  // jsdom doesn't fully apply class-based styles, so the absolute finding counts
  // are lower than what a real browser would see. The hardcoded counts below are
  // the calibrated jsdom baseline — if a future change pushes them up, that's a
  // pass-column false positive; if down, the rule or fixture has regressed.
  it('motion: flag column triggers both motion rules, pass column adds none', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'motion.html'));
    assert.equal(f.filter(r => r.antipattern === 'bounce-easing').length, 2);
    assert.equal(f.filter(r => r.antipattern === 'layout-transition').length, 2);
  });
});

describe('detectHtml — dark glow', () => {
  // Calibrated jsdom baseline — see motion test note above.
  it('glow: flag column triggers dark-glow, pass column adds none', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'glow.html'));
    assert.equal(f.filter(r => r.antipattern === 'dark-glow').length, 1);
  });
});
