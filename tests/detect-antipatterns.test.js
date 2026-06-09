import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  ANTIPATTERNS, checkElementBorders, checkElementMotion, checkElementGlow, isNeutralColor, isFullPage,
  getRulesForDimension,
  detectText, detectHtml, extractStyleBlocks, extractCSSinJS,
  walkDir, SCANNABLE_EXTENSIONS,
  buildImportGraph, resolveImport,
  detectFrameworkConfig, isPortListening, FRAMEWORK_CONFIGS,
} from '../cli/engine/detect-antipatterns.mjs';
import {
  checkElementTextOverflowDOM,
  isScreenReaderOnlyTextStyle,
} from '../cli/engine/rules/checks.mjs';

const FIXTURES = path.join(import.meta.dir, 'fixtures', 'antipatterns');
const SCRIPT = path.join(import.meta.dir, '..', 'cli', 'engine', 'detect-antipatterns.mjs');
const BENCH_SCRIPT = path.join(import.meta.dir, '..', 'scripts', 'benchmark-detector.mjs');

function writeStaticFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-static-'));
  for (const [name, contents] of Object.entries(files)) {
    const fullPath = path.join(dir, name);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  }
  return { dir, file: path.join(dir, 'index.html') };
}

async function withStaticFixture(files, callback) {
  const fixture = writeStaticFixture(files);
  try {
    return await callback(fixture);
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
}

function findingIds(findings) {
  return findings.map(f => f.antipattern);
}

function personalizedIds(findings) {
  return findings.map(f => f.antipattern).filter(id => id.startsWith('non-token-'));
}

function designSidecar(typography) {
  return JSON.stringify({
    schemaVersion: 2,
    generatedAt: '2026-06-05T00:00:00.000Z',
    title: 'Design System: Test',
    tokens: { typography },
    extensions: {},
    components: [],
    narrative: {},
  }, null, 2);
}

const KEIO_DISTILLED_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Keio Typography Slice</title>
  <style>
    :root {
      --font: "DM Sans", system-ui, -apple-system, Segoe UI, sans-serif;
      --mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
    }
    body { font-family: var(--font); font-size: 16px; line-height: 1.5; }
    .preheading {
      font-size: 12px; font-weight: 500; letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .brand .word {
      font-size: 23px; font-weight: 300; letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .hero h1 {
      margin: 0; font-weight: 200;
      font-size: clamp(46px, 6.4vw, 98px);
      line-height: 0.98; letter-spacing: -0.025em;
    }
    .hero-lede {
      max-width: 48ch; margin: 0;
      font-size: clamp(17px, 1.25vw, 20px); line-height: 1.55;
      letter-spacing: -0.003em;
    }
    .glass-pill {
      font-size: 12px; font-weight: 500; letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .strip-words span { font-size: 15px; letter-spacing: -0.005em; }
    .foot-inner { font-size: 13px; }
  </style>
</head>
<body>
  <header class="brand"><span class="word">Keio</span></header>
  <main class="hero">
    <span class="preheading">Floral atelier</span>
    <h1>Flowers, composed like still life.</h1>
    <p class="hero-lede">A seasonal studio working in small batches.</p>
    <span class="glass-pill">Seasonal No. 26</span>
  </main>
  <section class="strip-words"><span>Private residences</span></section>
  <footer class="foot-inner">hello@keio.flowers</footer>
</body>
</html>`;

const ROLE_ONLY_TYPOGRAPHY_TOKENS = {
  caption: {
    fontFamily: '"DM Sans", sans-serif',
    fontSize: '12px',
    lineHeight: 1.4,
    letterSpacing: '0.16em',
  },
  body: {
    fontFamily: '"DM Sans", sans-serif',
    fontSize: '16px',
    lineHeight: 1.5,
    letterSpacing: '0',
  },
  title: { fontSize: '20px', lineHeight: 1.2 },
  display: { fontSize: '32px', lineHeight: 1.1 },
};

const NARROW_TYPOGRAPHY_TOKENS = {
  roles: ROLE_ONLY_TYPOGRAPHY_TOKENS,
  scale: {
    fontSize: ['12px', '16px', '20px', '32px'],
    lineHeight: [1.4, 1.5, 1.2, 1.1],
    letterSpacing: ['0.16em', '0'],
    fontFamily: ['"DM Sans", sans-serif'],
  },
};

const KEIO_MATCHING_TYPOGRAPHY_TOKENS = {
  roles: {
    base: {
      fontFamily: '"DM Sans", sans-serif',
      fontSize: '16px',
      lineHeight: 1.5,
    },
    hero: {
      fontFamily: '"DM Sans", sans-serif',
      fontSize: 'clamp(46px, 6.4vw, 98px)',
      lineHeight: 0.98,
      letterSpacing: '-0.025em',
    },
  },
  scale: {
    fontSize: [
      '16px',
      '12px',
      '23px',
      'clamp(46px, 6.4vw, 98px)',
      'clamp(17px, 1.25vw, 20px)',
      '15px',
      '13px',
    ],
    lineHeight: [1.5, 0.98, 1.55],
    letterSpacing: ['0.18em', '0.16em', '-0.025em', '-0.003em', '-0.005em'],
    fontFamily: ['"DM Sans", sans-serif'],
  },
};


// ---------------------------------------------------------------------------
// Core: checkElementBorders (computed style simulation)
// ---------------------------------------------------------------------------

describe('checkElementBorders', () => {
  function mockStyle(overrides) {
    return { borderTopWidth: '0', borderRightWidth: '0', borderBottomWidth: '0', borderLeftWidth: '0',
      borderTopColor: '', borderRightColor: '', borderBottomColor: '', borderLeftColor: '',
      borderRadius: '0', ...overrides };
  }

  test('detects side-tab with radius', () => {
    const f = checkElementBorders('div', mockStyle({
      borderLeftWidth: '4', borderLeftColor: 'rgb(59, 130, 246)', borderRadius: '12',
    }));
    expect(f.length).toBe(1);
    expect(f[0].id).toBe('side-tab');
  });

  test('detects side-tab without radius (thick)', () => {
    const f = checkElementBorders('div', mockStyle({
      borderLeftWidth: '4', borderLeftColor: 'rgb(59, 130, 246)',
    }));
    expect(f.length).toBe(1);
    expect(f[0].id).toBe('side-tab');
  });

  test('skips side border below threshold without radius', () => {
    const f = checkElementBorders('div', mockStyle({
      borderLeftWidth: '2', borderLeftColor: 'rgb(59, 130, 246)',
    }));
    expect(f).toHaveLength(0);
  });

  test('detects border-accent-on-rounded (top)', () => {
    const f = checkElementBorders('div', mockStyle({
      borderTopWidth: '3', borderTopColor: 'rgb(139, 92, 246)', borderRadius: '12',
    }));
    expect(f.length).toBe(1);
    expect(f[0].id).toBe('border-accent-on-rounded');
  });

  test('skips safe tags', () => {
    const f = checkElementBorders('blockquote', mockStyle({
      borderLeftWidth: '4', borderLeftColor: 'rgb(59, 130, 246)',
    }));
    expect(f).toHaveLength(0);
  });

  test('skips neutral colors', () => {
    const f = checkElementBorders('div', mockStyle({
      borderLeftWidth: '4', borderLeftColor: 'rgb(200, 200, 200)',
    }));
    expect(f).toHaveLength(0);
  });

  test('skips uniform borders (not accent)', () => {
    const f = checkElementBorders('div', mockStyle({
      borderTopWidth: '2', borderRightWidth: '2', borderBottomWidth: '2', borderLeftWidth: '2',
      borderTopColor: 'rgb(59, 130, 246)', borderRightColor: 'rgb(59, 130, 246)',
      borderBottomColor: 'rgb(59, 130, 246)', borderLeftColor: 'rgb(59, 130, 246)',
    }));
    expect(f).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isNeutralColor
// ---------------------------------------------------------------------------

describe('isNeutralColor', () => {
  test('gray is neutral', () => expect(isNeutralColor('rgb(200, 200, 200)')).toBe(true));
  test('blue is not neutral', () => expect(isNeutralColor('rgb(59, 130, 246)')).toBe(false));
  test('transparent is neutral', () => expect(isNeutralColor('transparent')).toBe(true));
  test('null is neutral', () => expect(isNeutralColor(null)).toBe(true));
});

// ---------------------------------------------------------------------------
// Regex fallback (detectText)
// ---------------------------------------------------------------------------

describe('detectText — Tailwind side-tab', () => {
  test('detects border-l-4 (thick, no rounded needed)', () => {
    const f = detectText('<div class="border-l-4 border-blue-500">', 'test.html');
    expect(f.some(r => r.antipattern === 'side-tab')).toBe(true);
  });

  test('detects border-l-1 + rounded', () => {
    const f = detectText('<div class="border-l-1 border-blue-500 rounded-md">', 'test.html');
    expect(f.some(r => r.antipattern === 'side-tab')).toBe(true);
  });

  test('ignores border-l-1 without rounded', () => {
    const f = detectText('<div class="border-l-1 border-gray-300">', 'test.html');
    expect(f.filter(r => r.antipattern === 'side-tab')).toHaveLength(0);
  });

  test('ignores border-t without rounded', () => {
    const f = detectText('<div class="border-t-4 border-b-4">', 'test.html');
    expect(f.filter(r => r.antipattern === 'border-accent-on-rounded')).toHaveLength(0);
  });
});

describe('detectText — CSS borders', () => {
  test('detects border-left shorthand', () => {
    const f = detectText('.card { border-left: 4px solid #3b82f6; }', 'test.css');
    expect(f.some(r => r.antipattern === 'side-tab')).toBe(true);
  });

  test('ignores neutral border', () => {
    const f = detectText('.card { border-left: 4px solid #e5e7eb; }', 'test.css');
    expect(f.filter(r => r.antipattern === 'side-tab')).toHaveLength(0);
  });

  test('skips blockquote', () => {
    const f = detectText('<blockquote style="border-left: 4px solid #ccc;">', 'test.html');
    expect(f.filter(r => r.antipattern === 'side-tab')).toHaveLength(0);
  });
});

describe('detectText — overused fonts', () => {
  test('detects Inter', () => {
    const f = detectText("body { font-family: 'Inter', sans-serif; }", 'test.css');
    expect(f.some(r => r.antipattern === 'overused-font')).toBe(true);
  });

  test('detects Fraunces (current AI-default monoculture)', () => {
    const f = detectText("h1 { font-family: 'Fraunces', Georgia, serif; }", 'test.css');
    expect(f.some(r => r.antipattern === 'overused-font')).toBe(true);
  });

  test('detects Geist (Vercel-default monoculture)', () => {
    const f = detectText("body { font-family: 'Geist', sans-serif; }", 'test.css');
    expect(f.some(r => r.antipattern === 'overused-font')).toBe(true);
  });

  test('does not flag distinctive fonts', () => {
    const f = detectText("body { font-family: 'Karla', sans-serif; }", 'test.css');
    expect(f.filter(r => r.antipattern === 'overused-font')).toHaveLength(0);
  });
});

describe('detectText — flat type hierarchy', () => {
  test('flags sizes too close together', () => {
    const page = '<!DOCTYPE html><html><style>h1{font-size:18px}h2{font-size:16px}h3{font-size:15px}p{font-size:14px}.s{font-size:13px}</style></html>';
    const f = detectText(page, 'test.html');
    expect(f.some(r => r.antipattern === 'flat-type-hierarchy')).toBe(true);
  });

  test('passes good hierarchy', () => {
    const page = '<!DOCTYPE html><html><style>h1{font-size:48px}h2{font-size:32px}p{font-size:16px}.s{font-size:12px}</style></html>';
    const f = detectText(page, 'test.html');
    expect(f.filter(r => r.antipattern === 'flat-type-hierarchy')).toHaveLength(0);
  });
});

// Static HTML/CSS fixture tests moved to detect-antipatterns-fixtures.test.mjs (run via node --test)

// ---------------------------------------------------------------------------
// Full page vs partial detection
// ---------------------------------------------------------------------------

describe('isFullPage', () => {
  test('detects DOCTYPE', () => expect(isFullPage('<!DOCTYPE html><html>')).toBe(true));
  test('detects <html>', () => expect(isFullPage('<html><head></head>')).toBe(true));
  test('detects <head>', () => expect(isFullPage('<head><meta charset="UTF-8"></head>')).toBe(true));
  test('rejects component/partial', () => expect(isFullPage('<div class="card">content</div>')).toBe(false));
  test('rejects JSX', () => expect(isFullPage('export default function Card() { return <div>hi</div> }')).toBe(false));
});

describe('partials skip page-level checks', () => {
  test('regex: partial with flat hierarchy is not flagged', () => {
    const partial = '<div style="font-size: 14px">text</div>\n<div style="font-size: 16px">text</div>\n<div style="font-size: 15px">text</div>';
    const f = detectText(partial, 'card.tsx');
    expect(f.filter(r => r.antipattern === 'flat-type-hierarchy')).toHaveLength(0);
  });

  test('regex: partial with single overused font is not flagged for single-font', () => {
    const partial = `<div style="font-family: 'Inter', sans-serif; font-size: 14px">text</div>\n`.repeat(25);
    const f = detectText(partial, 'card.tsx');
    expect(f.filter(r => r.antipattern === 'single-font')).toHaveLength(0);
  });

  test('regex: partial still flags border anti-patterns', () => {
    const partial = '<div class="border-l-4 border-blue-500 rounded-lg">card</div>';
    const f = detectText(partial, 'card.tsx');
    expect(f.some(r => r.antipattern === 'side-tab')).toBe(true);
  });

  test('regex: full page with flat hierarchy IS flagged', () => {
    const page = '<!DOCTYPE html><html><head></head><body>\n' +
      '<h1 style="font-size: 18px">h1</h1>\n<h2 style="font-size: 16px">h2</h2>\n' +
      '<p style="font-size: 14px">p</p>\n<span style="font-size: 15px">s</span>\n' +
      '<small style="font-size: 13px">sm</small>\n</body></html>';
    const f = detectText(page, 'index.html');
    expect(f.some(r => r.antipattern === 'flat-type-hierarchy')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layout anti-patterns
// ---------------------------------------------------------------------------

describe('detectHtml — layout', () => {
  test('detects monotonous spacing via regex', () => {
    // A page where every padding/margin is 16px
    const html = '<!DOCTYPE html><html><body>' +
      '<div style="padding: 16px; margin-bottom: 16px;"><p style="margin-bottom: 16px;">a</p></div>'.repeat(5) +
      '</body></html>';
    const f = detectText(html, 'test.html');
    expect(f.some(r => r.antipattern === 'monotonous-spacing')).toBe(true);
  });

});

// ---------------------------------------------------------------------------
// Text overflow screen-reader-only handling
// ---------------------------------------------------------------------------

describe('checkElementTextOverflowDOM', () => {
  function baseTextStyle(overrides = {}) {
    return {
      position: 'static',
      width: '160px',
      height: '20px',
      overflow: 'visible',
      overflowX: 'visible',
      overflowY: 'visible',
      clipPath: 'none',
      clip: 'auto',
      ...overrides,
    };
  }

  function mockTextElement({
    className = 'flag-overflow',
    style = baseTextStyle(),
    clientWidth = 24,
    clientHeight = 20,
    scrollWidth = 80,
    rectWidth = clientWidth,
    rectHeight = clientHeight,
  } = {}) {
    return {
      tagName: 'DIV',
      className,
      childNodes: [{ nodeType: 3, textContent: 'A long accessible label that overflows its box' }],
      parentElement: null,
      clientWidth,
      clientHeight,
      scrollWidth,
      __style: style,
      getAttribute(name) {
        return name === 'class' ? className : null;
      },
      getBoundingClientRect() {
        return { width: rectWidth, height: rectHeight };
      },
    };
  }

  function withMockComputedStyle(callback) {
    const original = globalThis.getComputedStyle;
    globalThis.getComputedStyle = (el) => el.__style;
    try {
      return callback();
    } finally {
      if (original === undefined) delete globalThis.getComputedStyle;
      else globalThis.getComputedStyle = original;
    }
  }

  test('classifies clip-path sr-only text as visually hidden', () => {
    expect(isScreenReaderOnlyTextStyle(baseTextStyle({
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      overflowX: 'hidden',
      overflowY: 'hidden',
      clipPath: 'inset(50%)',
    }), { width: 1, height: 1 })).toBe(true);
  });

  test('classifies legacy clip rect sr-only text as visually hidden', () => {
    expect(isScreenReaderOnlyTextStyle(baseTextStyle({
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      overflowX: 'hidden',
      overflowY: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
    }), { width: 1, height: 1 })).toBe(true);
  });

  test('classifies tiny absolute overflow-hidden text as visually hidden without clip', () => {
    expect(isScreenReaderOnlyTextStyle(baseTextStyle({
      position: 'absolute',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      overflowX: 'hidden',
      overflowY: 'hidden',
    }), { width: 1, height: 1 })).toBe(true);
  });

  test('classifies fully clipped text as visually hidden without tiny sizing', () => {
    expect(isScreenReaderOnlyTextStyle(baseTextStyle({
      position: 'absolute',
      width: '160px',
      height: '20px',
      overflow: 'visible',
      clipPath: 'inset(50%)',
    }), { width: 160, height: 20 })).toBe(true);
  });

  test('flags visible overflowing text', () => {
    const findings = withMockComputedStyle(() => checkElementTextOverflowDOM(mockTextElement()));

    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('text-overflow');
    expect(findings[0].snippet).toContain('.flag-overflow');
  });

  test('skips overflowing sr-only text', () => {
    const srOnly = mockTextElement({
      className: 'pass-sr-only-clip-path',
      style: baseTextStyle({
        position: 'absolute',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
        overflowX: 'hidden',
        overflowY: 'hidden',
        clipPath: 'inset(50%)',
      }),
      clientWidth: 1,
      clientHeight: 1,
      scrollWidth: 240,
      rectWidth: 1,
      rectHeight: 1,
    });

    const findings = withMockComputedStyle(() => checkElementTextOverflowDOM(srOnly));

    expect(findings).toHaveLength(0);
  });

  test('does not classify tiny visible text as sr-only', () => {
    const style = baseTextStyle({
      position: 'absolute',
      width: '1px',
      height: '1px',
    });

    expect(isScreenReaderOnlyTextStyle(style, { width: 1, height: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Motion anti-patterns
// ---------------------------------------------------------------------------

describe('checkElementMotion', () => {
  function mockStyle(overrides) {
    return { transitionProperty: '', animationName: 'none', animationTimingFunction: '', transitionTimingFunction: '', ...overrides };
  }

  test('detects bounce animation name', () => {
    const f = checkElementMotion('div', mockStyle({ animationName: 'bounce' }));
    expect(f.some(r => r.id === 'bounce-easing')).toBe(true);
  });

  test('detects elastic animation name', () => {
    const f = checkElementMotion('div', mockStyle({ animationName: 'elastic-in' }));
    expect(f.some(r => r.id === 'bounce-easing')).toBe(true);
  });

  test('detects overshoot cubic-bezier in animation timing', () => {
    const f = checkElementMotion('div', mockStyle({
      animationTimingFunction: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
    }));
    expect(f.some(r => r.id === 'bounce-easing')).toBe(true);
  });

  test('detects overshoot cubic-bezier in transition timing', () => {
    const f = checkElementMotion('div', mockStyle({
      transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    }));
    expect(f.some(r => r.id === 'bounce-easing')).toBe(true);
  });

  test('passes standard ease-out-quart', () => {
    const f = checkElementMotion('div', mockStyle({
      transitionTimingFunction: 'cubic-bezier(0.25, 1, 0.5, 1)',
    }));
    expect(f.filter(r => r.id === 'bounce-easing')).toHaveLength(0);
  });

  test('passes standard ease', () => {
    const f = checkElementMotion('div', mockStyle({
      transitionTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1.0)',
    }));
    expect(f.filter(r => r.id === 'bounce-easing')).toHaveLength(0);
  });

  test('detects width transition', () => {
    const f = checkElementMotion('div', mockStyle({ transitionProperty: 'width' }));
    expect(f.some(r => r.id === 'layout-transition')).toBe(true);
  });

  test('detects height transition', () => {
    const f = checkElementMotion('div', mockStyle({ transitionProperty: 'height' }));
    expect(f.some(r => r.id === 'layout-transition')).toBe(true);
  });

  test('detects padding transition', () => {
    const f = checkElementMotion('div', mockStyle({ transitionProperty: 'padding' }));
    expect(f.some(r => r.id === 'layout-transition')).toBe(true);
  });

  test('detects margin transition', () => {
    const f = checkElementMotion('div', mockStyle({ transitionProperty: 'margin' }));
    expect(f.some(r => r.id === 'layout-transition')).toBe(true);
  });

  test('detects max-height transition', () => {
    const f = checkElementMotion('div', mockStyle({ transitionProperty: 'max-height' }));
    expect(f.some(r => r.id === 'layout-transition')).toBe(true);
  });

  test('detects layout prop among mixed transitions', () => {
    const f = checkElementMotion('div', mockStyle({ transitionProperty: 'opacity, width, color' }));
    expect(f.some(r => r.id === 'layout-transition')).toBe(true);
  });

  test('passes transform transition', () => {
    const f = checkElementMotion('div', mockStyle({ transitionProperty: 'transform' }));
    expect(f.filter(r => r.id === 'layout-transition')).toHaveLength(0);
  });

  test('passes opacity transition', () => {
    const f = checkElementMotion('div', mockStyle({ transitionProperty: 'opacity' }));
    expect(f.filter(r => r.id === 'layout-transition')).toHaveLength(0);
  });

  test('skips transition: all', () => {
    const f = checkElementMotion('div', mockStyle({ transitionProperty: 'all' }));
    expect(f.filter(r => r.id === 'layout-transition')).toHaveLength(0);
  });

  test('skips safe tags', () => {
    const f = checkElementMotion('button', mockStyle({
      animationName: 'bounce', transitionProperty: 'width',
    }));
    expect(f).toHaveLength(0);
  });
});

describe('detectText — motion', () => {
  test('detects animate-bounce Tailwind class', () => {
    const f = detectText('<div class="animate-bounce">loading</div>', 'test.html');
    expect(f.some(r => r.antipattern === 'bounce-easing')).toBe(true);
  });

  test('detects animation: bounce CSS', () => {
    const f = detectText('.icon { animation: bounce 1s infinite; }', 'test.css');
    expect(f.some(r => r.antipattern === 'bounce-easing')).toBe(true);
  });

  test('detects animation-name: elastic', () => {
    const f = detectText('.card { animation-name: elastic; }', 'test.css');
    expect(f.some(r => r.antipattern === 'bounce-easing')).toBe(true);
  });

  test('detects overshoot cubic-bezier', () => {
    const f = detectText('.btn { transition: transform 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55); }', 'test.css');
    expect(f.some(r => r.antipattern === 'bounce-easing')).toBe(true);
  });

  test('passes standard cubic-bezier', () => {
    const f = detectText('.btn { transition: transform 0.4s cubic-bezier(0.25, 1, 0.5, 1); }', 'test.css');
    expect(f.filter(r => r.antipattern === 'bounce-easing')).toHaveLength(0);
  });

  test('detects transition: width', () => {
    const f = detectText('.sidebar { transition: width 0.3s ease; }', 'test.css');
    expect(f.some(r => r.antipattern === 'layout-transition')).toBe(true);
  });

  test('detects transition: height', () => {
    const f = detectText('.panel { transition: height 0.4s ease-out; }', 'test.css');
    expect(f.some(r => r.antipattern === 'layout-transition')).toBe(true);
  });

  test('detects transition: max-height', () => {
    const f = detectText('.accordion { transition: max-height 0.5s ease; }', 'test.css');
    expect(f.some(r => r.antipattern === 'layout-transition')).toBe(true);
  });

  test('detects transition-property: width', () => {
    const f = detectText('.box { transition-property: width; transition-duration: 0.3s; }', 'test.css');
    expect(f.some(r => r.antipattern === 'layout-transition')).toBe(true);
  });

  test('skips transition: all', () => {
    const f = detectText('.card { transition: all 0.3s ease; }', 'test.css');
    expect(f.filter(r => r.antipattern === 'layout-transition')).toHaveLength(0);
  });

  test('skips transition: transform', () => {
    const f = detectText('.card { transition: transform 0.3s ease; }', 'test.css');
    expect(f.filter(r => r.antipattern === 'layout-transition')).toHaveLength(0);
  });

  test('skips transition: opacity', () => {
    const f = detectText('.btn { transition: opacity 0.2s ease; }', 'test.css');
    expect(f.filter(r => r.antipattern === 'layout-transition')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dark glow anti-pattern
// ---------------------------------------------------------------------------

describe('checkElementGlow', () => {
  function mockStyle(overrides) {
    return { boxShadow: 'none', backgroundColor: '', ...overrides };
  }

  // Dark bg = luminance < 0.1 (e.g. #111827 = gray-900)
  const darkBg = { r: 17, g: 24, b: 39 }; // #111827
  const lightBg = { r: 249, g: 250, b: 251 }; // #f9fafb
  const mediumBg = { r: 107, g: 114, b: 128 }; // #6b7280

  test('detects blue glow on dark background', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: 'rgba(59, 130, 246, 0.4) 0px 0px 20px 0px',
    }), darkBg);
    expect(f.some(r => r.id === 'dark-glow')).toBe(true);
  });

  test('detects purple glow on dark background', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: 'rgba(139, 92, 246, 0.35) 0px 0px 25px 0px',
    }), darkBg);
    expect(f.some(r => r.id === 'dark-glow')).toBe(true);
  });

  test('detects glow in multi-shadow', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: 'rgba(0, 0, 0, 0.3) 0px 4px 6px 0px, rgba(168, 85, 247, 0.3) 0px 0px 30px 0px',
    }), darkBg);
    expect(f.some(r => r.id === 'dark-glow')).toBe(true);
  });

  test('passes gray shadow on dark background', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: 'rgba(0, 0, 0, 0.4) 0px 4px 12px 0px',
    }), darkBg);
    expect(f.filter(r => r.id === 'dark-glow')).toHaveLength(0);
  });

  test('passes colored shadow on light background', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: 'rgba(59, 130, 246, 0.4) 0px 0px 20px 0px',
    }), lightBg);
    expect(f.filter(r => r.id === 'dark-glow')).toHaveLength(0);
  });

  test('passes colored shadow on medium gray background', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: 'rgba(59, 130, 246, 0.5) 0px 0px 20px 0px',
    }), mediumBg);
    expect(f.filter(r => r.id === 'dark-glow')).toHaveLength(0);
  });

  test('passes focus ring (spread only, no blur)', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: 'rgba(59, 130, 246, 0.5) 0px 0px 0px 3px',
    }), darkBg);
    expect(f.filter(r => r.id === 'dark-glow')).toHaveLength(0);
  });

  test('passes subtle shadow (blur < 5px)', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: 'rgba(59, 130, 246, 0.2) 0px 1px 3px 0px',
    }), darkBg);
    expect(f.filter(r => r.id === 'dark-glow')).toHaveLength(0);
  });

  test('passes no shadow', () => {
    const f = checkElementGlow('div', mockStyle({ boxShadow: 'none' }), darkBg);
    expect(f.filter(r => r.id === 'dark-glow')).toHaveLength(0);
  });

  test('detects glow on buttons (not skipped by safe tags)', () => {
    const f = checkElementGlow('button', mockStyle({
      boxShadow: 'rgba(59, 130, 246, 0.4) 0px 0px 20px 0px',
    }), darkBg);
    expect(f.some(r => r.id === 'dark-glow')).toBe(true);
  });
});

describe('detectText — dark glow', () => {
  test('detects colored box-shadow glow on dark background', () => {
    const html = '<!DOCTYPE html><html><body style="background: #111827;"><div style="box-shadow: 0 0 20px rgba(59, 130, 246, 0.4);">glow</div></body></html>';
    const f = detectText(html, 'test.html');
    expect(f.some(r => r.antipattern === 'dark-glow')).toBe(true);
  });

  test('skips gray shadow on dark background', () => {
    const html = '<!DOCTYPE html><html><body style="background: #111827;"><div style="box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);">shadow</div></body></html>';
    const f = detectText(html, 'test.html');
    expect(f.filter(r => r.antipattern === 'dark-glow')).toHaveLength(0);
  });

  test('skips colored shadow on light page', () => {
    const html = '<!DOCTYPE html><html><body style="background: #f9fafb;"><div style="box-shadow: 0 0 20px rgba(59, 130, 246, 0.4);">glow</div></body></html>';
    const f = detectText(html, 'test.html');
    expect(f.filter(r => r.antipattern === 'dark-glow')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Static HTML/CSS engine
// ---------------------------------------------------------------------------

describe('detectHtml — static HTML/CSS engine', () => {
  test('inlines local linked stylesheets', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'linked-stylesheet.html'));
    expect(findingIds(f)).toContain('side-tab');
  });

  test('flattens @layer, resolves CSS variables and fallbacks, and skips unsupported selectors', async () => {
    await withStaticFixture({
      'index.html': `<!DOCTYPE html>
        <html>
          <head>
            <style>
              @layer components {
                :root { --accent: #3b82f6; --fallback-accent: var(--missing-accent, #a855f7); }
                .layer-side { border-left: 5px solid var(--accent); border-radius: 8px; }
                .layer-top { border-top: 4px solid var(--fallback-accent); border-radius: 8px; }
                .ignored:future-only(foo) { border-left: 20px solid #ef4444; }
              }
            </style>
          </head>
          <body>
            <div class="layer-side">Layer variable side tab</div>
            <div class="layer-top">Fallback variable top accent</div>
          </body>
        </html>`,
    }, async ({ file }) => {
      const profile = [];
      const f = await detectHtml(file, { profile });
      const ids = findingIds(f);
      expect(ids).toContain('side-tab');
      expect(ids).toContain('border-accent-on-rounded');
      expect(profile.some(e => e.engine === 'static-html' && e.ruleId === 'unsupported-selector')).toBe(true);
    });
  });

  test('honors specificity, source order, !important, and inline style precedence', async () => {
    await withStaticFixture({
      'index.html': `<!DOCTYPE html>
        <html>
          <head>
            <style>
              .specificity-pass { border-left: 5px solid #3b82f6; border-radius: 8px; }
              div.specificity-pass { border-left-color: #d1d5db; }
              .source-order-flag { border-left: 5px solid #d1d5db; border-radius: 8px; }
              .source-order-flag { border-left-color: #ef4444; }
              .important-pass { border-left: 5px solid #d1d5db !important; border-radius: 8px; }
              .important-pass { border-left-color: #3b82f6; }
            </style>
          </head>
          <body>
            <div class="specificity-pass">Specificity neutral pass</div>
            <div class="source-order-flag">Source order chromatic flag</div>
            <div class="important-pass">Important neutral pass</div>
            <div style="border-left: 5px solid #06b6d4; border-radius: 8px;">Inline chromatic flag</div>
          </body>
        </html>`,
    }, async ({ file }) => {
      const f = await detectHtml(file);
      expect(findingIds(f).filter(id => id === 'side-tab')).toHaveLength(2);
    });
  });

  test('expands background, border, font, transition, and animation shorthands', async () => {
    await withStaticFixture({
      'index.html': `<!DOCTYPE html>
        <html>
          <head>
            <style>
              .font-short {
                font: italic 700 11px/1.05 Arial, sans-serif;
              }
              .background-short {
                background: #000;
                color: #111;
                font-size: 16px;
              }
              .border-short {
                border: 1px solid #d1d5db;
                border-left: 5px solid #3b82f6;
                border-radius: 8px;
              }
              .motion-short {
                transition: width 250ms cubic-bezier(.68,-.55,.27,1.55);
                animation: bounce 1s cubic-bezier(.68,-.55,.27,1.55) infinite;
              }
            </style>
          </head>
          <body>
            <p class="font-short">This tiny paragraph is long enough to trigger both the static font shorthand size and line-height checks.</p>
            <button class="background-short">Low contrast button text</button>
            <div class="border-short">Border shorthand side tab</div>
            <div class="motion-short">Motion shorthand easing</div>
          </body>
        </html>`,
    }, async ({ file }) => {
      const ids = findingIds(await detectHtml(file));
      expect(ids).toContain('tiny-text');
      expect(ids).toContain('tight-leading');
      expect(ids).toContain('low-contrast');
      expect(ids).toContain('side-tab');
      expect(ids).toContain('bounce-easing');
      expect(ids).toContain('layout-transition');
    });
  });
});


// ---------------------------------------------------------------------------
// ANTIPATTERNS registry
// ---------------------------------------------------------------------------

describe('ANTIPATTERNS registry', () => {
  test('has at least 5 entries', () => {
    expect(ANTIPATTERNS.length).toBeGreaterThanOrEqual(5);
  });

  test('each entry has required fields', () => {
    for (const ap of ANTIPATTERNS) {
      expect(ap.id).toBeTypeOf('string');
      expect(ap.name).toBeTypeOf('string');
      expect(ap.description).toBeTypeOf('string');
    }
  });

  test('typography dimension includes explicit rule set independent of skillSection metadata', () => {
    const ids = new Set(getRulesForDimension('typography').map(rule => rule.id));
    for (const id of [
      'overused-font',
      'single-font',
      'flat-type-hierarchy',
      'italic-serif-display',
      'hero-eyebrow-chip',
      'repeated-section-kickers',
      'oversized-h1',
      'extreme-negative-tracking',
      'tight-leading',
      'tiny-text',
      'justified-text',
      'all-caps-body',
      'wide-tracking',
      'skipped-heading',
      'line-length',
      'icon-tile-stack',
      'non-token-font-size',
      'non-token-line-height',
      'non-token-letter-spacing',
      'non-token-font-family',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
    expect(ANTIPATTERNS.find(rule => rule.id === 'tight-leading')?.skillSection).toBeUndefined();
    expect(ANTIPATTERNS.find(rule => rule.id === 'line-length')?.skillSection).toBe('Layout & Space');
  });
});

// ---------------------------------------------------------------------------
// Typography dimension and design-token preflight
// ---------------------------------------------------------------------------

describe('typography dimension', () => {
  test('detectHtml keeps typography and excludes color, motion, and layout findings', async () => {
    await withStaticFixture({
      'index.html': `<!doctype html>
<html>
<head>
  <style>
    body { font-family: Inter, sans-serif; background: #111827; color: #f9fafb; }
    h1 { font-size: 18px; }
    h2 { font-size: 17px; }
    p { font-size: 16px; color: #9ca3af; background: #3b82f6; }
    .motion { transition: width 0.3s ease; animation: bounce 1s infinite; }
    .layout { border-left: 4px solid #3b82f6; border-radius: 12px; padding: 16px; }
  </style>
</head>
<body>
  <h1>Flat Typography</h1>
  <h2>Nearly Identical Heading</h2>
  <p class="motion layout">The page carries typography, color, motion, and layout issues.</p>
</body>
</html>`,
    }, async ({ file }) => {
      const ids = findingIds(await detectHtml(file, { dimensions: ['typography'] }));
      expect(ids).toContain('overused-font');
      expect(ids).toContain('flat-type-hierarchy');
      for (const excluded of ['gray-on-color', 'low-contrast', 'bounce-easing', 'layout-transition', 'side-tab']) {
        expect(ids).not.toContain(excluded);
      }
    });
  });

  test('CLI --dimension typography parses as an option and filters output', async () => {
    await withStaticFixture({
      'index.html': `<!doctype html>
<html>
<head>
  <style>
    body { font-family: Inter, sans-serif; background: #111827; color: #f9fafb; }
    h1 { font-size: 18px; }
    h2 { font-size: 17px; }
    p { font-size: 16px; color: #9ca3af; background: #3b82f6; transition: width 0.3s ease; }
  </style>
</head>
<body><h1>Flat Typography</h1><h2>Nearly Identical Heading</h2><p>Text</p></body>
</html>`,
    }, async ({ file }) => {
      const result = spawnSync('node', [SCRIPT, '--json', '--dimension', 'typography', file], {
        encoding: 'utf-8',
        timeout: 15000,
      });
      expect(result.status).toBe(2);
      const parsed = JSON.parse(result.stdout.trim());
      const ids = findingIds(parsed);
      expect(ids).toContain('overused-font');
      expect(ids).not.toContain('gray-on-color');
      expect(result.stderr || '').not.toContain('cannot access typography');
    });
  });

  test('semantic role-only typography snapshots do not enable personalized checks', async () => {
    await withStaticFixture({
      '.impeccable/design.json': designSidecar(ROLE_ONLY_TYPOGRAPHY_TOKENS),
      'index.html': KEIO_DISTILLED_HTML,
    }, async ({ file }) => {
      const f = await detectHtml(file, { dimensions: ['typography'] });
      expect(personalizedIds(f)).toEqual([]);
    });
  });

  test('Keio distilled fixture flags values outside an explicit narrow typography scale', async () => {
    await withStaticFixture({
      '.impeccable/design.json': designSidecar(NARROW_TYPOGRAPHY_TOKENS),
      'index.html': KEIO_DISTILLED_HTML,
    }, async ({ file }) => {
      const f = await detectHtml(file, { dimensions: ['typography'] });
      const snippets = f.map(item => item.snippet);
      expect(personalizedIds(f)).toContain('non-token-font-size');
      expect(personalizedIds(f)).toContain('non-token-line-height');
      expect(personalizedIds(f)).toContain('non-token-letter-spacing');
      expect(snippets).toContain('font-size: 23px is not in design typography scale: 12px, 16px, 20px, 32px');
      expect(snippets).toContain('line-height: 0.98 is not in design typography scale: 1.4, 1.5, 1.2, 1.1');
      expect(snippets).toContain('letter-spacing: 0.18em is not in design typography scale: 0.16em, 0');
    });
  });

  test('Keio control fixture passes when typography tokens match the observed values', async () => {
    await withStaticFixture({
      '.impeccable/design.json': designSidecar(KEIO_MATCHING_TYPOGRAPHY_TOKENS),
      'index.html': KEIO_DISTILLED_HTML,
    }, async ({ file }) => {
      const f = await detectHtml(file, { dimensions: ['typography'] });
      expect(personalizedIds(f)).toEqual([]);
    });
  });

  test('personalized typography reports real HTML line numbers and ignores linked CSS source', async () => {
    const html = `<!doctype html>
<html>
<head>
  <link rel="stylesheet" href="linked.css">
  <style>
    .hero { font-size: 23px; line-height: 0.98; }
  </style>
</head>
<body>
  <h1 class="hero">Line numbers stay real.</h1>
</body>
</html>`;
    await withStaticFixture({
      '.impeccable/design.json': designSidecar(NARROW_TYPOGRAPHY_TOKENS),
      'linked.css': '.linked { font-size: 99px; }',
      'index.html': html,
    }, async ({ file }) => {
      const lineCount = fs.readFileSync(file, 'utf8').split(/\r?\n/).length;
      const f = await detectHtml(file, { dimensions: ['typography'] });
      const personalized = f.filter(item => item.antipattern.startsWith('non-token-'));
      expect(personalized.length).toBeGreaterThan(0);
      expect(personalized.some(item => item.snippet.includes('font-size: 99px'))).toBe(false);
      for (const item of personalized) {
        expect(item.line).toBeGreaterThanOrEqual(1);
        expect(item.line).toBeLessThanOrEqual(lineCount);
      }
    });
  });

  test('personalized typography pass cases skip variables, inherited values, and unusable sidecars', async () => {
    await withStaticFixture({
      '.impeccable/design.json': designSidecar(NARROW_TYPOGRAPHY_TOKENS),
      'index.html': `<!doctype html><html><head><style>
        :root { --body-size: 16px; --body-leading: 1.5; }
        body { font-family: "DM Sans", sans-serif; font-size: 16px; line-height: 1.5; letter-spacing: 0; }
        p { font-size: var(--body-size); line-height: inherit; letter-spacing: normal; }
      </style></head><body><p>Inherited typography.</p></body></html>`,
    }, async ({ file }) => {
      expect(personalizedIds(await detectHtml(file, { dimensions: ['typography'] }))).toEqual([]);
    });

    for (const sidecar of [null, '{', JSON.stringify({ schemaVersion: 2, extensions: {} })]) {
      const files = {
        'index.html': `<!doctype html><html><head><style>
          h1 { font-size: 13px; line-height: 0.9; letter-spacing: 0.3em; }
        </style></head><body><h1>Unusable sidecar should not flag.</h1></body></html>`,
      };
      if (sidecar !== null) files['.impeccable/design.json'] = sidecar;
      await withStaticFixture(files, async ({ file }) => {
        expect(personalizedIds(await detectHtml(file, { dimensions: ['typography'] }))).toEqual([]);
      });
    }
  });

  test('repo dogfood typography roles do not create personalized findings without scale', () => {
    const cssPath = path.join(import.meta.dir, '..', 'site', 'styles', 'main.css');
    const f = detectText(fs.readFileSync(cssPath, 'utf8'), cssPath, { dimensions: ['typography'] });
    expect(personalizedIds(f)).toEqual([]);
  });

  test('detectText runs personalized typography checks for non-HTML sources', async () => {
    await withStaticFixture({
      '.impeccable/design.json': designSidecar(NARROW_TYPOGRAPHY_TOKENS),
      'src/styles.css': '.hero { font-size: 23px; line-height: 0.98; letter-spacing: 0.18em; }',
      'index.html': '<!doctype html><html><body></body></html>',
    }, async ({ dir }) => {
      const cssPath = path.join(dir, 'src', 'styles.css');
      const f = detectText(fs.readFileSync(cssPath, 'utf8'), cssPath, { dimensions: ['typography'] });
      expect(personalizedIds(f)).toContain('non-token-font-size');
      expect(personalizedIds(f)).toContain('non-token-line-height');
      expect(personalizedIds(f)).toContain('non-token-letter-spacing');
    });
  });

  test('personalized typography checks inline styles and fallback declaration text', async () => {
    await withStaticFixture({
      '.impeccable/design.json': designSidecar(NARROW_TYPOGRAPHY_TOKENS),
      'index.html': `<!doctype html><html><body>
        <p style="font-size: 23px; line-height: 0.98;">Inline typography drift.</p>
      </body></html>`,
      'src/Card.tsx': 'const css = `.card { font-size: 23px; line-height: 0.98; }`; export const Card = () => <p className="card">Drift</p>;',
    }, async ({ file, dir }) => {
      const htmlFindings = await detectHtml(file, { dimensions: ['typography'] });
      expect(personalizedIds(htmlFindings)).toContain('non-token-font-size');
      expect(personalizedIds(htmlFindings)).toContain('non-token-line-height');

      const tsxPath = path.join(dir, 'src', 'Card.tsx');
      const tsxFindings = detectText(fs.readFileSync(tsxPath, 'utf8'), tsxPath, { dimensions: ['typography'] });
      expect(personalizedIds(tsxFindings)).toContain('non-token-font-size');
      expect(personalizedIds(tsxFindings)).toContain('non-token-line-height');
    });
  });
});

// ---------------------------------------------------------------------------
// walkDir
// ---------------------------------------------------------------------------

describe('walkDir', () => {
  test('finds scannable files', () => {
    const files = walkDir(FIXTURES);
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.every(f => SCANNABLE_EXTENSIONS.has(path.extname(f)))).toBe(true);
  });

  test('returns empty for nonexistent dir', () => {
    expect(walkDir('/nonexistent/path/12345')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CLI integration
// ---------------------------------------------------------------------------

describe('CLI', () => {
  function run(...args) {
    const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', timeout: 15000 });
    return { stdout: result.stdout || '', stderr: result.stderr || '', code: result.status };
  }

  test('--help exits 0', () => {
    const { stdout, code } = run('--help');
    expect(code).toBe(0);
    expect(stdout).toContain('Usage:');
  });

  test('detect subcommand is not treated as a scan target', () => {
    const { stderr, code } = run('detect', '--json', path.join(FIXTURES, 'should-pass.html'));
    expect(code).toBe(0);
    expect(stderr).not.toContain('cannot access detect');
  });

  test('should-pass exits 0', () => {
    const { code } = run(path.join(FIXTURES, 'should-pass.html'));
    expect(code).toBe(0);
  });

  test('should-flag exits 2 with findings', () => {
    const { code, stderr } = run(path.join(FIXTURES, 'should-flag.html'));
    expect(code).toBe(2);
    expect(stderr).toContain('side-tab');
  });

  test('--json outputs valid JSON', () => {
    const { stdout, code } = run('--json', path.join(FIXTURES, 'should-flag.html'));
    expect(code).toBe(2);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toBeArray();
    expect(parsed.length).toBeGreaterThan(0);
  });

  test('-json alias outputs valid JSON', () => {
    const { stdout, stderr, code } = run('-json', path.join(FIXTURES, 'should-flag.html'));
    expect(code).toBe(2);
    expect(stderr).not.toContain('cannot access -json');
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toBeArray();
    expect(parsed.length).toBeGreaterThan(0);
  });

  test('--json on clean file outputs empty array', () => {
    const { stdout, code } = run('--json', path.join(FIXTURES, 'should-pass.html'));
    expect(code).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual([]);
  });

  test('--fast is accepted but deprecated (no-op, full scan still runs)', () => {
    const { code, stderr } = run('--fast', path.join(FIXTURES, 'should-flag.html'));
    expect(code).toBe(2); // still flags the planted anti-patterns via the full scan
    expect(stderr).toContain('--fast is deprecated');
  });

  test('linked stylesheet detected (static HTML/CSS default)', () => {
    const { code, stderr } = run(path.join(FIXTURES, 'linked-stylesheet.html'));
    expect(code).toBe(2);
    expect(stderr).toContain('side-tab');
  });

  test('warns on nonexistent path', () => {
    const { stderr } = run('/nonexistent/file/xyz.html');
    expect(stderr).toContain('Warning');
  });
});

// ---------------------------------------------------------------------------
// Detector benchmark smoke test
// ---------------------------------------------------------------------------

describe('benchmark-detector', () => {
  test('--quick --json emits timing schema', () => {
    const result = spawnSync('node', [BENCH_SCRIPT, '--quick', '--json'], {
      encoding: 'utf-8',
      timeout: 30000,
    });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.version).toBe(1);
    expect(parsed.quick).toBe(true);
    expect(parsed.browser).toBe(false);
    expect(parsed.cases).toBeArray();
    expect(parsed.cases.length).toBeGreaterThan(0);
    expect(parsed.summary).toBeArray();
    expect(parsed.summary.length).toBeGreaterThan(0);

    const okCase = parsed.cases.find(c => c.status === 'ok');
    expect(okCase).toBeTruthy();
    expect(okCase).toHaveProperty('totalMs');
    expect(okCase).toHaveProperty('findings');
    expect(okCase.profile).toBeArray();

    const row = parsed.summary[0];
    for (const key of ['engine', 'phase', 'ruleId', 'target', 'calls', 'totalMs', 'avgMs', 'p50', 'p95', 'findings']) {
      expect(row).toHaveProperty(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Tier 1: Vue/Svelte <style> block extraction
// ---------------------------------------------------------------------------

describe('extractStyleBlocks', () => {
  test('extracts single <style> block from Vue SFC', () => {
    const vue = `<template><div>hi</div></template>
<style scoped>
.card { border-left: 4px solid blue; }
</style>`;
    const blocks = extractStyleBlocks(vue, '.vue');
    expect(blocks.length).toBe(1);
    expect(blocks[0].content).toContain('border-left: 4px solid blue');
    expect(blocks[0].startLine).toBeGreaterThan(1);
  });

  test('extracts multiple <style> blocks', () => {
    const vue = `<template><div>hi</div></template>
<style>
.a { color: red; }
</style>
<style scoped>
.b { color: blue; }
</style>`;
    const blocks = extractStyleBlocks(vue, '.vue');
    expect(blocks.length).toBe(2);
  });

  test('extracts <style> from Svelte', () => {
    const svelte = `<div>hi</div>
<style>
.sidebar { border-right: 4px solid #8b5cf6; }
</style>`;
    const blocks = extractStyleBlocks(svelte, '.svelte');
    expect(blocks.length).toBe(1);
    expect(blocks[0].content).toContain('border-right: 4px solid');
  });

  test('returns empty for non-Vue/Svelte files', () => {
    const jsx = 'export function Card() { return <div>hi</div>; }';
    expect(extractStyleBlocks(jsx, '.jsx')).toHaveLength(0);
    expect(extractStyleBlocks(jsx, '.tsx')).toHaveLength(0);
  });

  test('returns empty when no <style> blocks exist', () => {
    const vue = '<template><div>hi</div></template><script>export default {}</script>';
    expect(extractStyleBlocks(vue, '.vue')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tier 1: CSS-in-JS extraction
// ---------------------------------------------------------------------------

describe('extractCSSinJS', () => {
  test('extracts styled-components template literal', () => {
    const tsx = "const Card = styled.div`\n  border-left: 4px solid blue;\n  padding: 16px;\n`;";
    const blocks = extractCSSinJS(tsx, '.tsx');
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks.some(b => b.content.includes('border-left: 4px solid'))).toBe(true);
  });

  test('extracts styled(Component) template literal', () => {
    const tsx = "const Box = styled(BaseBox)`\n  border-right: 5px solid #8b5cf6;\n`;";
    const blocks = extractCSSinJS(tsx, '.tsx');
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks.some(b => b.content.includes('border-right: 5px solid'))).toBe(true);
  });

  test('extracts emotion css template literal', () => {
    const tsx = "const style = css`\n  animation: bounce 1s infinite;\n`;";
    const blocks = extractCSSinJS(tsx, '.tsx');
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks.some(b => b.content.includes('animation: bounce'))).toBe(true);
  });

  test('returns empty for non-JS files', () => {
    expect(extractCSSinJS('.card { color: red; }', '.css')).toHaveLength(0);
    expect(extractCSSinJS('<div>hi</div>', '.html')).toHaveLength(0);
  });

  test('returns empty when no CSS-in-JS patterns exist', () => {
    const tsx = "function Card() { return <div className='p-4'>hi</div>; }";
    expect(extractCSSinJS(tsx, '.tsx')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tier 1: detectText on Vue/Svelte files (style blocks + template classes)
// ---------------------------------------------------------------------------

describe('detectText -- Vue SFC', () => {
  test('detects side-tab in <style> block', () => {
    const vue = `<template><div class="card">hi</div></template>
<style scoped>
.card { border-left: 4px solid #3b82f6; border-radius: 12px; }
</style>`;
    const f = detectText(vue, 'Card.vue');
    expect(f.some(r => r.antipattern === 'side-tab')).toBe(true);
  });

  test('detects overused font in <style> block', () => {
    const vue = `<template><div>hi</div></template>
<style>
body { font-family: 'Inter', sans-serif; }
</style>`;
    const f = detectText(vue, 'App.vue');
    expect(f.some(r => r.antipattern === 'overused-font')).toBe(true);
  });

  test('detects bounce animation in <style> block', () => {
    const vue = `<template><div>hi</div></template>
<style>
.item { animation: bounce 1s infinite; }
</style>`;
    const f = detectText(vue, 'Card.vue');
    expect(f.some(r => r.antipattern === 'bounce-easing')).toBe(true);
  });

  test('detects gradient-text in <style> block', () => {
    const vue = `<template><div>hi</div></template>
<style>
h1 { background: linear-gradient(to right, purple, cyan); -webkit-background-clip: text; background-clip: text; }
</style>`;
    const f = detectText(vue, 'Hero.vue');
    expect(f.some(r => r.antipattern === 'gradient-text')).toBe(true);
  });

  test('detects Tailwind anti-patterns in <template>', () => {
    const vue = `<template>
  <div class="border-l-4 border-blue-500 rounded-lg">card</div>
</template>`;
    const f = detectText(vue, 'Card.vue');
    expect(f.some(r => r.antipattern === 'side-tab')).toBe(true);
  });
});

describe('detectText -- Svelte', () => {
  test('detects side-tab in <style> block', () => {
    const svelte = `<div>hi</div>
<style>
.sidebar { border-right: 4px solid #8b5cf6; border-radius: 16px; }
</style>`;
    const f = detectText(svelte, 'Sidebar.svelte');
    expect(f.some(r => r.antipattern === 'side-tab')).toBe(true);
  });

  test('detects overused font in <style> block', () => {
    const svelte = `<div>hi</div>
<style>
.app { font-family: 'Roboto', sans-serif; }
</style>`;
    const f = detectText(svelte, 'App.svelte');
    expect(f.some(r => r.antipattern === 'overused-font')).toBe(true);
  });

  test('detects layout transition in <style> block', () => {
    const svelte = `<div>hi</div>
<style>
.panel { transition: height 0.4s ease; }
</style>`;
    const f = detectText(svelte, 'Panel.svelte');
    expect(f.some(r => r.antipattern === 'layout-transition')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tier 1: detectText on CSS-in-JS files
// ---------------------------------------------------------------------------

describe('detectText -- CSS-in-JS', () => {
  test('detects side-tab in styled-components', () => {
    const tsx = "const Card = styled.div`\n  border-left: 4px solid #3b82f6;\n  border-radius: 12px;\n`;";
    const f = detectText(tsx, 'Card.tsx');
    expect(f.some(r => r.antipattern === 'side-tab')).toBe(true);
  });

  test('detects bounce in emotion css', () => {
    const tsx = "const style = css`\n  animation: bounce 1s infinite;\n`;";
    const f = detectText(tsx, 'anim.ts');
    expect(f.some(r => r.antipattern === 'bounce-easing')).toBe(true);
  });

  test('detects overused font in styled-components', () => {
    const tsx = "const Wrapper = styled.main`\n  font-family: 'Inter', sans-serif;\n`;";
    const f = detectText(tsx, 'Layout.tsx');
    expect(f.some(r => r.antipattern === 'overused-font')).toBe(true);
  });

  test('detects gradient-text in styled-components', () => {
    const tsx = "const Title = styled.h1`\n  background: linear-gradient(to right, purple, cyan);\n  -webkit-background-clip: text;\n  background-clip: text;\n`;";
    const f = detectText(tsx, 'Hero.tsx');
    expect(f.some(r => r.antipattern === 'gradient-text')).toBe(true);
  });

  test('does not false-positive on clean CSS-in-JS', () => {
    const tsx = "const Card = styled.div`\n  border-radius: 12px;\n  padding: 24px;\n`;";
    const f = detectText(tsx, 'Card.tsx');
    expect(f.filter(r => r.antipattern === 'side-tab')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tier 1: Fixture file integration tests (CLI)
// ---------------------------------------------------------------------------

describe('CLI -- framework fixtures', () => {
  function run(...args) {
    const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', timeout: 15000 });
    return { stdout: result.stdout || '', stderr: result.stderr || '', code: result.status };
  }

  test('jsx-should-flag catches anti-patterns', () => {
    const { code, stderr } = run(path.join(FIXTURES, 'jsx-should-flag.jsx'));
    expect(code).toBe(2);
    expect(stderr).toContain('side-tab');
  });

  test('jsx-should-pass is clean', () => {
    const { code } = run(path.join(FIXTURES, 'jsx-should-pass.jsx'));
    expect(code).toBe(0);
  });

  test('vue-should-flag catches anti-patterns', () => {
    const { code, stderr } = run(path.join(FIXTURES, 'vue-should-flag.vue'));
    expect(code).toBe(2);
    expect(stderr).toContain('side-tab');
  });

  test('vue-should-pass is clean', () => {
    const { code } = run(path.join(FIXTURES, 'vue-should-pass.vue'));
    expect(code).toBe(0);
  });

  test('svelte-should-flag catches anti-patterns', () => {
    const { code, stderr } = run(path.join(FIXTURES, 'svelte-should-flag.svelte'));
    expect(code).toBe(2);
    expect(stderr).toContain('side-tab');
  });

  test('svelte-should-pass is clean', () => {
    const { code } = run(path.join(FIXTURES, 'svelte-should-pass.svelte'));
    expect(code).toBe(0);
  });

  test('cssinjs-should-flag catches anti-patterns', () => {
    const { code, stderr } = run(path.join(FIXTURES, 'cssinjs-should-flag.tsx'));
    expect(code).toBe(2);
    expect(stderr).toContain('side-tab');
  });

  test('cssinjs-should-pass is clean', () => {
    const { code } = run(path.join(FIXTURES, 'cssinjs-should-pass.tsx'));
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Realistic Next.js project fixtures
// ---------------------------------------------------------------------------

describe('CLI -- Next.js + Tailwind project', () => {
  const dir = path.join(FIXTURES, 'framework-next-tailwind');
  let stderr;

  function run(...args) {
    const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', timeout: 15000 });
    return { stdout: result.stdout || '', stderr: result.stderr || '', code: result.status };
  }

  test('finds all expected anti-pattern types', () => {
    const result = run(dir);
    stderr = result.stderr;
    expect(result.code).toBe(2);
    for (const ap of ['side-tab', 'gradient-text', 'ai-color-palette', 'overused-font', 'bounce-easing']) {
      expect(stderr).toContain(ap);
    }
  });

  test('FeatureCard: side-tab + ai-color-palette + bounce-easing', () => {
    const { stderr } = run(path.join(dir, 'components', 'FeatureCard.tsx'));
    expect(stderr).toContain('side-tab');
    expect(stderr).toContain('border-l-4');
    expect(stderr).toContain('ai-color-palette');
    expect(stderr).toContain('text-purple-600');
    expect(stderr).toContain('bounce-easing');
    expect(stderr).toContain('animate-bounce');
  });

  test('PricingCard: gradient-text + ai-color-palette', () => {
    const { stderr } = run(path.join(dir, 'components', 'PricingCard.tsx'));
    expect(stderr).toContain('gradient-text');
    expect(stderr).toContain('bg-clip-text');
    expect(stderr).toContain('ai-color-palette');
  });

  test('globals.css: overused Inter font', () => {
    const { stderr } = run(path.join(dir, 'app', 'globals.css'));
    expect(stderr).toContain('overused-font');
    expect(stderr).toContain('Inter');
  });

  test('page.tsx: gradient-text + ai-color-palette', () => {
    const { stderr } = run(path.join(dir, 'app', 'page.tsx'));
    expect(stderr).toContain('gradient-text');
    expect(stderr).toContain('ai-color-palette');
  });

  test('directory scan shows import context for components', () => {
    const { stderr } = run(dir);
    expect(stderr).toContain('imported by page.tsx');
  });

  test('--json produces clean JSON without framework message', () => {
    const { stdout, code } = run('--json', dir);
    expect(code).toBe(2);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toBeArray();
    expect(parsed.length).toBeGreaterThanOrEqual(6);
  });
});

describe('CLI -- Next.js + CSS Modules project', () => {
  function run(...args) {
    const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', timeout: 15000 });
    return { stdout: result.stdout || '', stderr: result.stderr || '', code: result.status };
  }

  const dir = path.join(FIXTURES, 'framework-next-modules');

  test('finds all expected anti-pattern types', () => {
    const { code, stderr } = run(dir);
    expect(code).toBe(2);
    for (const ap of ['side-tab', 'overused-font', 'layout-transition', 'gradient-text']) {
      expect(stderr).toContain(ap);
    }
  });

  test('StatsCard.module.css: side-tab + overused-font + layout-transition', () => {
    const { stderr } = run(path.join(dir, 'components', 'StatsCard.module.css'));
    expect(stderr).toContain('side-tab');
    expect(stderr).toContain('border-left: 4px solid #6366f1');
    expect(stderr).toContain('overused-font');
    expect(stderr).toContain('Inter');
    expect(stderr).toContain('layout-transition');
    expect(stderr).toContain('transition: width');
  });

  test('Sidebar.module.css: side-tab border accent', () => {
    const { stderr } = run(path.join(dir, 'components', 'Sidebar.module.css'));
    expect(stderr).toContain('side-tab');
    expect(stderr).toContain('border-right: 3px solid');
  });

  test('globals.css: overused Roboto', () => {
    const { stderr } = run(path.join(dir, 'app', 'globals.css'));
    expect(stderr).toContain('overused-font');
    expect(stderr).toContain('Roboto');
  });

  test('page.module.css: gradient-text across lines', () => {
    const { stderr } = run(path.join(dir, 'app', 'page.module.css'));
    expect(stderr).toContain('gradient-text');
    expect(stderr).toContain('background-clip: text');
  });

  test('directory scan shows import context for CSS modules', () => {
    const { stderr } = run(dir);
    expect(stderr).toContain('imported by StatsCard.tsx');
    expect(stderr).toContain('imported by Sidebar.tsx');
    expect(stderr).toContain('imported by layout.tsx');
  });
});

describe('CLI -- Next.js + CSS-in-JS (styled-components) project', () => {
  function run(...args) {
    const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', timeout: 15000 });
    return { stdout: result.stdout || '', stderr: result.stderr || '', code: result.status };
  }

  const dir = path.join(FIXTURES, 'framework-next-cssinjs');

  test('finds all expected anti-pattern types', () => {
    const { code, stderr } = run(dir);
    expect(code).toBe(2);
    for (const ap of ['side-tab', 'gradient-text', 'overused-font', 'bounce-easing', 'layout-transition']) {
      expect(stderr).toContain(ap);
    }
  });

  test('FeatureGrid.tsx: side-tab + bounce-easing + layout-transition', () => {
    const { stderr } = run(path.join(dir, 'components', 'FeatureGrid.tsx'));
    expect(stderr).toContain('side-tab');
    expect(stderr).toContain('border-left: 4px solid');
    expect(stderr).toContain('bounce-easing');
    expect(stderr).toContain('animation: bounce');
    expect(stderr).toContain('layout-transition');
    expect(stderr).toContain('transition: width');
  });

  test('Hero.tsx: gradient-text + overused Montserrat font', () => {
    const { stderr } = run(path.join(dir, 'components', 'Hero.tsx'));
    expect(stderr).toContain('gradient-text');
    expect(stderr).toContain('background-clip: text');
    expect(stderr).toContain('overused-font');
    expect(stderr).toContain('Montserrat');
  });

  test('GlobalStyle.tsx: overused Inter', () => {
    const { stderr } = run(path.join(dir, 'components', 'GlobalStyle.tsx'));
    expect(stderr).toContain('overused-font');
    expect(stderr).toContain('Inter');
  });

  test('Testimonials.tsx: side-tab + gradient-text in styled blockquote', () => {
    const { stderr } = run(path.join(dir, 'components', 'Testimonials.tsx'));
    expect(stderr).toContain('side-tab');
    expect(stderr).toContain('border-left: 4px solid');
    expect(stderr).toContain('gradient-text');
  });

  test('directory scan shows import context for components', () => {
    const { stderr } = run(dir);
    expect(stderr).toContain('imported by index.tsx');
    expect(stderr).toContain('imported by _app.tsx');
  });

  test('--json produces clean JSON without framework message', () => {
    const { stdout, code } = run('--json', dir);
    expect(code).toBe(2);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toBeArray();
    expect(parsed.length).toBeGreaterThanOrEqual(6);
    // Verify importedBy is present in JSON
    const featureGridFindings = parsed.filter(f => f.file?.includes('FeatureGrid'));
    expect(featureGridFindings.length).toBeGreaterThan(0);
    expect(featureGridFindings[0].importedBy).toContain('index.tsx');
  });
});

// ---------------------------------------------------------------------------
// Tier 2: Import graph
// ---------------------------------------------------------------------------

describe('buildImportGraph', () => {
  const MF = path.join(FIXTURES, 'multifile');

  test('resolves ES import from tsx to tsx', () => {
    const graph = buildImportGraph([
      path.join(MF, 'App.tsx'),
      path.join(MF, 'Card.tsx'),
      path.join(MF, 'styles.css'),
    ]);
    const appImports = graph.get(path.join(MF, 'App.tsx'));
    expect(appImports).toBeDefined();
    expect(appImports.has(path.join(MF, 'Card.tsx'))).toBe(true);
    expect(appImports.has(path.join(MF, 'styles.css'))).toBe(true);
  });

  test('resolves extensionless imports', () => {
    const graph = buildImportGraph([
      path.join(MF, 'App.tsx'),
      path.join(MF, 'Card.tsx'),
    ]);
    const appImports = graph.get(path.join(MF, 'App.tsx'));
    expect(appImports.has(path.join(MF, 'Card.tsx'))).toBe(true);
  });

  test('resolves CSS @import', () => {
    const graph = buildImportGraph([
      path.join(MF, 'theme.scss'),
      path.join(MF, 'variables.scss'),
    ]);
    const themeImports = graph.get(path.join(MF, 'theme.scss'));
    expect(themeImports).toBeDefined();
    expect(themeImports.has(path.join(MF, 'variables.scss'))).toBe(true);
  });

  test('ignores bare/node_modules imports', () => {
    const graph = buildImportGraph([
      path.join(MF, 'App.tsx'),
    ]);
    const appImports = graph.get(path.join(MF, 'App.tsx'));
    // Should not contain 'react' or 'styled-components'
    for (const imp of appImports) {
      expect(imp).toContain(MF);
    }
  });
});

describe('resolveImport', () => {
  const MF = path.join(FIXTURES, 'multifile');

  test('resolves relative path with extension', () => {
    const fileSet = new Set([path.join(MF, 'Card.tsx')]);
    const result = resolveImport('./Card.tsx', MF, fileSet);
    expect(result).toBe(path.join(MF, 'Card.tsx'));
  });

  test('resolves extensionless import by trying extensions', () => {
    const fileSet = new Set([path.join(MF, 'Card.tsx')]);
    const result = resolveImport('./Card', MF, fileSet);
    expect(result).toBe(path.join(MF, 'Card.tsx'));
  });

  test('returns null for bare specifiers', () => {
    const fileSet = new Set([path.join(MF, 'Card.tsx')]);
    expect(resolveImport('react', MF, fileSet)).toBeNull();
    expect(resolveImport('styled-components', MF, fileSet)).toBeNull();
  });

  test('returns null for unresolvable imports', () => {
    const fileSet = new Set([path.join(MF, 'Card.tsx')]);
    expect(resolveImport('./Unknown', MF, fileSet)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tier 2: Multi-file directory scan
// ---------------------------------------------------------------------------

describe('CLI -- multi-file scan', () => {
  function run(...args) {
    const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', timeout: 15000 });
    return { stdout: result.stdout || '', stderr: result.stderr || '', code: result.status };
  }

  test('scanning multifile/ directory finds findings across files', () => {
    const { code, stderr } = run(path.join(FIXTURES, 'multifile'));
    expect(code).toBe(2);
    expect(stderr).toContain('side-tab');
  });

  test('--json multi-file scan includes import context', () => {
    const { stdout, code } = run('--json', path.join(FIXTURES, 'multifile'));
    expect(code).toBe(2);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.length).toBeGreaterThan(0);
    // Findings from Card.tsx should mention being imported by App.tsx
    const cardFindings = parsed.filter(f => f.file?.includes('Card.tsx'));
    expect(cardFindings.length).toBeGreaterThan(0);
    expect(cardFindings.some(f => f.importedBy?.includes('App.tsx'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tier 3: Framework config detection
// ---------------------------------------------------------------------------

describe('detectFrameworkConfig', () => {
  test('detects next.config.mjs and returns Next.js with default port', () => {
    const result = detectFrameworkConfig(path.join(FIXTURES, 'framework-next-tailwind'));
    expect(result).not.toBeNull();
    expect(result.name).toBe('Next.js');
    expect(result.port).toBe(3000);
  });

  test('detects next.config.js (pages router)', () => {
    const result = detectFrameworkConfig(path.join(FIXTURES, 'framework-next-cssinjs'));
    expect(result).not.toBeNull();
    expect(result.name).toBe('Next.js');
  });

  test('parses custom port from vite.config.ts', () => {
    const result = detectFrameworkConfig(path.join(FIXTURES, 'framework-vite'));
    expect(result).not.toBeNull();
    expect(result.name).toBe('Vite');
    expect(result.port).toBe(8080);
  });

  test('returns null for directory without framework config', () => {
    const result = detectFrameworkConfig(path.join(FIXTURES, 'multifile'));
    expect(result).toBeNull();
  });

  test('returns null for nonexistent directory', () => {
    const result = detectFrameworkConfig('/nonexistent/path/12345');
    expect(result).toBeNull();
  });
});

describe('isPortListening', () => {
  test('returns { listening: false } for unlikely port', async () => {
    const result = await isPortListening(59999);
    expect(result.listening).toBe(false);
  });
});

describe('FRAMEWORK_CONFIGS', () => {
  test('covers major frameworks', () => {
    const names = FRAMEWORK_CONFIGS.map(c => c.name);
    expect(names).toContain('Next.js');
    expect(names).toContain('Vite');
    expect(names).toContain('SvelteKit');
    expect(names).toContain('Nuxt');
    expect(names).toContain('Astro');
  });

  test('each config has required fields', () => {
    for (const cfg of FRAMEWORK_CONFIGS) {
      expect(cfg.name).toBeTypeOf('string');
      expect(cfg.defaultPort).toBeTypeOf('number');
      expect(cfg.files).toBeArray();
      expect(cfg.files.length).toBeGreaterThan(0);
    }
  });
});

describe('CLI -- dev server suggestion', () => {
  function run(...args) {
    const result = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf-8', timeout: 15000 });
    return { stdout: result.stdout || '', stderr: result.stderr || '', code: result.status };
  }

  test('suggests URL scan when Next.js config found', () => {
    const { stderr } = run(path.join(FIXTURES, 'framework-next-tailwind'));
    expect(stderr).toContain('Next.js');
    expect(stderr).toContain('3000');
  });

  test('suggests URL scan when Vite config found', () => {
    const { stderr } = run(path.join(FIXTURES, 'framework-vite'));
    expect(stderr).toContain('Vite');
    expect(stderr).toContain('8080');
  });
});
