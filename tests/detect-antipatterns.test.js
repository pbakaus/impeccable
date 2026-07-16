import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  ANTIPATTERNS, checkElementBorders, checkElementMotion, checkElementGlow, isNeutralColor, isFullPage,
  detectText, detectHtml, extractStyleBlocks, extractCSSinJS,
  walkDir, SCANNABLE_EXTENSIONS,
  buildImportGraph, resolveImport,
  detectFrameworkConfig, isPortListening, FRAMEWORK_CONFIGS,
} from '../cli/engine/detect-antipatterns.mjs';
import { filterByScopes } from '../cli/engine/registry/antipatterns.mjs';
import {
  checkColors,
  checkElementTextOverflowDOM,
  checkHeroEyebrow,
  checkHoverContrast,
  checkNumberedSectionLabels,
  parseNumberedLabelText,
  checkHtmlPatterns,
  checkPageTypography,
  isScreenReaderOnlyTextStyle,
  parseAnyColor,
  parseColorMix,
  scanCssTextForInsetStripe,
  scanCssTextForMarquee,
  scanCssTextForPseudoStripe,
  scanCssTextForPulsingDot,
  scanCssTextForRadialHalo,
  scanHtmlForShapeAssembledIllustration,
} from '../cli/engine/rules/checks.mjs';

const FIXTURES = path.join(import.meta.dir, 'fixtures', 'antipatterns');
const SCRIPT = path.join(import.meta.dir, '..', 'cli', 'engine', 'detect-antipatterns.mjs');
const BENCH_SCRIPT = path.join(import.meta.dir, '..', 'scripts', 'benchmark-detector.mjs');

function withoutDesignSystemArgs(args) {
  return args[0] === 'detect'
    ? ['detect', '--no-design-system', '--no-config', ...args.slice(1)]
    : ['--no-design-system', '--no-config', ...args];
}

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

function pageWithGoogleFonts(href) {
  return [
    '<!DOCTYPE html><html><head>',
    `<link href="${href}" rel="stylesheet">`,
    '</head><body>',
    ...Array.from({ length: 22 }, (_, i) => `<p>Sample content row ${i + 1}</p>`),
    '</body></html>',
  ].join('\n');
}

function pageTypographyForGoogleFonts(href) {
  const html = pageWithGoogleFonts(href);
  const doc = {
    styleSheets: [],
    documentElement: { outerHTML: html },
    querySelectorAll(selector) {
      if (selector === '*') return Array.from({ length: 24 }, () => ({}));
      return [];
    },
  };
  const win = {
    getComputedStyle() {
      return { fontSize: '16px' };
    },
  };
  return checkPageTypography(doc, win);
}


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

  test('detects border-l-2 + rounded', () => {
    const f = detectText('<div class="border-l-2 border-blue-500 rounded-md">', 'test.html');
    expect(f.some(r => r.antipattern === 'side-tab')).toBe(true);
  });

  test('ignores border-l-1 + rounded', () => {
    const f = detectText('<div class="border-l-1 border-blue-500 rounded-md">', 'test.html');
    expect(f.filter(r => r.antipattern === 'side-tab')).toHaveLength(0);
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

  test('detects border-left shorthand in Sass', () => {
    const f = detectText(".card\n  border-left: 4px solid #3b82f6", 'test.sass');
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

  test('detects overused Google Fonts css2 family after first family param', () => {
    const page = pageWithGoogleFonts('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300&family=Inter:wght@400;500;600&display=swap');
    const f = detectText(page, 'index.html');
    expect(f.some(r => r.antipattern === 'overused-font' && /Inter/i.test(r.snippet))).toBe(true);
  });

  test('does not flag single-font for combined Google Fonts css2 families', () => {
    const page = pageWithGoogleFonts('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300&family=Jost:wght@300;400;500&display=swap');
    const f = detectText(page, 'index.html');
    expect(f.filter(r => r.antipattern === 'single-font')).toHaveLength(0);
  });

  test('keeps legacy Google Fonts css pipe-separated families multi-font', () => {
    const page = pageWithGoogleFonts('https://fonts.googleapis.com/css?family=Cormorant+Garamond|Jost&display=swap');
    const f = detectText(page, 'index.html');
    expect(f.filter(r => r.antipattern === 'single-font')).toHaveLength(0);
  });

  test('page typography parses repeated Google Fonts css2 family params', () => {
    const f = pageTypographyForGoogleFonts('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300&family=Inter:wght@400;500;600&display=swap');
    expect(f.some(r => r.id === 'overused-font' && /inter/i.test(r.snippet))).toBe(true);
    expect(f.filter(r => r.id === 'single-font')).toHaveLength(0);
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

describe('detectText — numbered section markers', () => {
  test('flags visible full-page numbered section labels', () => {
    const page = '<!DOCTYPE html><html><body>' +
      '<section><span>01</span><h2>Strategy</h2></section>' +
      '<section><span>02</span><h2>Prototype</h2></section>' +
      '<section><span>03</span><h2>Launch</h2></section>' +
      '</body></html>';
    const f = detectText(page, 'test.html');
    expect(f.some(r => r.antipattern === 'numbered-section-markers')).toBe(true);
  });

  test('does not run page-level numbered marker analysis on JS source with embedded HTML strings', () => {
    const source = `
      const shell = '<!DOCTYPE html><html><head><title>Preview</title></head><body></body></html>';
      const palette = 'oklch(86% 0.07 84 / 0.08)';
      const shadow = '0 0 0 1px oklch(0% 0 0 / 0.04), 0 4px 16px oklch(0% 0 0 / 0.05), 0 1px 3px oklch(0% 0 0 / 0.06)';
      const size = '11.5px';
      const eye = '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/></svg>';
      const shader = 'float band = bandAt(uv.y - y, 0.05, 0.32);';
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    `;
    const f = detectText(source, 'live-browser.js');
    expect(f.filter(r => r.antipattern === 'numbered-section-markers')).toHaveLength(0);
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
    const f = detectText('.icon { animation: bounce-ball 1s infinite; }', 'test.css');
    const finding = f.find(r => r.antipattern === 'bounce-easing');
    expect(finding).toBeTruthy();
    expect(finding.snippet).toBe('animation: bounce-ball');
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

  test('detects zero-offset colored halo on light background', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: 'rgba(59, 130, 246, 0.4) 0px 0px 20px 0px',
    }), lightBg);
    expect(f.some(r => r.id === 'dark-glow')).toBe(true);
  });

  test('detects zero-offset colored halo on medium gray background', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: 'rgba(59, 130, 246, 0.5) 0px 0px 20px 0px',
    }), mediumBg);
    expect(f.some(r => r.id === 'dark-glow')).toBe(true);
  });

  test('passes offset colored drop shadow on light background', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: 'rgba(59, 130, 246, 0.4) 0px 8px 20px 0px',
    }), lightBg);
    expect(f.filter(r => r.id === 'dark-glow')).toHaveLength(0);
  });

  test('passes achromatic zero-offset shadow on light background', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: 'rgba(0, 0, 0, 0.15) 0px 0px 24px 0px',
    }), lightBg);
    expect(f.filter(r => r.id === 'dark-glow')).toHaveLength(0);
  });

  test('detects oklch glow on dark background', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: '0 0 12px oklch(0.85 0.12 200 / 0.5)',
    }), darkBg);
    expect(f.some(r => r.id === 'dark-glow')).toBe(true);
  });

  test('detects oklch zero-offset glow on light background', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: 'oklch(0.65 0.2 300 / 0.45) 0px 0px 20px 0px',
    }), lightBg);
    expect(f.some(r => r.id === 'dark-glow')).toBe(true);
  });

  test('passes achromatic oklch glow (white halo) on dark background', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: '0 0 12px oklch(1 0 0 / .7)',
    }), darkBg);
    expect(f.filter(r => r.id === 'dark-glow')).toHaveLength(0);
  });

  test('detects hex glow on dark background', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: '0 0 16px #3b82f6',
    }), darkBg);
    expect(f.some(r => r.id === 'dark-glow')).toBe(true);
  });

  test('detects hsl glow on dark background', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: '0 0 22px hsl(280, 80%, 60%)',
    }), darkBg);
    expect(f.some(r => r.id === 'dark-glow')).toBe(true);
  });

  test('skips unresolvable var() shadow color instead of guessing', () => {
    const f = checkElementGlow('div', mockStyle({
      boxShadow: '0 0 10px var(--ok)',
    }), darkBg);
    expect(f.filter(r => r.id === 'dark-glow')).toHaveLength(0);
  });

  test('detects chromatic text-shadow glow on any background', () => {
    const f = checkElementGlow('h1', mockStyle({
      textShadow: 'rgb(34, 211, 238) 0px 0px 12px',
    }), lightBg);
    expect(f.some(r => r.id === 'dark-glow')).toBe(true);
  });

  test('passes offset neutral text-shadow', () => {
    const f = checkElementGlow('h1', mockStyle({
      textShadow: 'rgba(0, 0, 0, 0.6) 0px 1px 2px',
    }), darkBg);
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

  test('detects zero-offset colored halo on light page', () => {
    const html = '<!DOCTYPE html><html><body style="background: #f9fafb;"><div style="box-shadow: 0 0 20px rgba(59, 130, 246, 0.4);">glow</div></body></html>';
    const f = detectText(html, 'test.html');
    expect(f.some(r => r.antipattern === 'dark-glow')).toBe(true);
  });

  test('skips offset colored drop shadow on light page', () => {
    const html = '<!DOCTYPE html><html><body style="background: #f9fafb;"><div style="box-shadow: 0 8px 20px rgba(59, 130, 246, 0.4);">shadow</div></body></html>';
    const f = detectText(html, 'test.html');
    expect(f.filter(r => r.antipattern === 'dark-glow')).toHaveLength(0);
  });

  test('detects oklch glow on dark oklch page', () => {
    const html = '<!DOCTYPE html><html><body style="background: oklch(0.145 0.038 252);"><div style="box-shadow: 0 0 12px oklch(0.85 0.12 200 / 0.5);">glow</div></body></html>';
    const f = detectText(html, 'test.html');
    expect(f.some(r => r.antipattern === 'dark-glow')).toBe(true);
  });

  test('resolves single-level var() shadow colors', () => {
    const html = '<!DOCTYPE html><html><head><style>:root { --ok: oklch(0.78 0.14 155); } .lamp { box-shadow: 0 0 10px var(--ok); }</style></head><body style="background: #f9fafb;"><div class="lamp">lamp</div></body></html>';
    const f = detectText(html, 'test.html');
    expect(f.some(r => r.antipattern === 'dark-glow')).toBe(true);
  });

  test('skips unresolvable var() shadow colors', () => {
    const html = '<!DOCTYPE html><html><body style="background: #111827;"><div style="box-shadow: 0 0 10px var(--undefined-accent);">lamp</div></body></html>';
    const f = detectText(html, 'test.html');
    expect(f.filter(r => r.antipattern === 'dark-glow')).toHaveLength(0);
  });

  test('detects chromatic text-shadow glow', () => {
    const html = '<!DOCTYPE html><html><body style="background: #f9fafb;"><h1 style="text-shadow: 0 0 12px #22d3ee;">glow</h1></body></html>';
    const f = detectText(html, 'test.html');
    expect(f.some(r => r.antipattern === 'dark-glow')).toBe(true);
  });

  test('skips achromatic zero-offset halo (soft elevation)', () => {
    const html = '<!DOCTYPE html><html><body style="background: #f9fafb;"><div style="box-shadow: 0 0 24px rgba(0, 0, 0, 0.15);">card</div></body></html>';
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
// Side-tab as absolutely-positioned pseudo-element stripe
// ---------------------------------------------------------------------------

describe('side-tab — pseudo-element stripe variant', () => {
  test('fixture flags both stripe variants and nothing else', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'pseudo-stripe.html'));
    const stripes = f.filter(r => r.antipattern === 'side-tab');
    const snippets = stripes.map(r => r.snippet).join(' | ');
    expect(stripes).toHaveLength(2);
    expect(snippets).toContain('.card-stripe::before');
    expect(snippets).toContain('.row-stripe::after');
  });

  test('detects ::before stripe with var() background resolved to chromatic', () => {
    const css = `
      :root { --accent: oklch(0.78 0.145 155); }
      .hero::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--accent); }
    `;
    const f = scanCssTextForPseudoStripe(css);
    expect(f).toHaveLength(1);
    expect(f[0].id).toBe('side-tab');
    expect(f[0].snippet).toContain('.hero::before');
  });

  test('detects height:100% + right:0 variant', () => {
    const css = '.card::after { position: absolute; right: 0; top: 0; height: 100%; width: 4px; background: #3b82f6; }';
    expect(scanCssTextForPseudoStripe(css)).toHaveLength(1);
  });

  test('detects floating stripe inset a few px from each end', () => {
    // The evasion shape from human review: same left-edge accent bar, but
    // backed off the card's corners by a small top/bottom inset so it never
    // touches an edge (and needs no corner rounding to read as a side tab).
    const css = '.row::before { content: ""; position: absolute; left: 0; top: 12px; bottom: 12px; width: 3px; border-radius: 3px; background: oklch(0.65 0.19 15); }';
    const f = scanCssTextForPseudoStripe(css);
    expect(f).toHaveLength(1);
    expect(f[0].id).toBe('side-tab');
    expect(f[0].snippet).toContain('(left: 0)');
  });

  test('skips deeply-inset partial rail (not an edge-spanning stripe)', () => {
    const css = '.rail::before { position: absolute; left: 0; top: 40px; bottom: 40px; width: 4px; background: #3b82f6; }';
    expect(scanCssTextForPseudoStripe(css)).toHaveLength(0);
  });

  test('unresolvable custom-property color errs toward detection', () => {
    const css = '.card::before { position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--from-external-sheet); }';
    expect(scanCssTextForPseudoStripe(css)).toHaveLength(1);
  });

  test('skips neutral hairline divider', () => {
    const css = '.col::before { position: absolute; left: 0; top: 0; bottom: 0; width: 1px; background: rgba(0,0,0,0.08); }';
    expect(scanCssTextForPseudoStripe(css)).toHaveLength(0);
  });

  test('skips neutral 4px rail (chromatic gate)', () => {
    const css = '.timeline::before { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: rgb(209, 213, 219); }';
    expect(scanCssTextForPseudoStripe(css)).toHaveLength(0);
  });

  test('skips 2px stripe below width threshold', () => {
    const css = '.card::before { position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: #3b82f6; }';
    expect(scanCssTextForPseudoStripe(css)).toHaveLength(0);
  });

  test('skips blockquote pseudo decoration', () => {
    const css = 'blockquote::before { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: #d97706; }';
    expect(scanCssTextForPseudoStripe(css)).toHaveLength(0);
  });

  test('skips non-edge-anchored pseudo (toggle knob)', () => {
    const css = '.switch::before { position: absolute; left: 2px; top: 2px; width: 10px; height: 10px; background: #3b82f6; }';
    expect(scanCssTextForPseudoStripe(css)).toHaveLength(0);
  });

  test('skips full-overlay pseudo (inset: 0, no narrow width)', () => {
    const css = '.hero::after { position: absolute; inset: 0; background: #3b82f6; }';
    expect(scanCssTextForPseudoStripe(css)).toHaveLength(0);
  });

  // Horizontal (top/bottom) stripe variant
  test('detects top-anchored full-width pseudo stripe', () => {
    const css = '.stat-card::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 4px; background: #e04a3a; }';
    const f = scanCssTextForPseudoStripe(css);
    expect(f).toHaveLength(1);
    expect(f[0].snippet).toContain('(top: 0)');
  });

  test('detects bottom-anchored width:100% pseudo stripe', () => {
    const css = '.promo::after { content: ""; position: absolute; bottom: 0; left: 0; width: 100%; height: 5px; background: oklch(0.62 0.2 30); }';
    const f = scanCssTextForPseudoStripe(css);
    expect(f).toHaveLength(1);
    expect(f[0].snippet).toContain('(bottom: 0)');
  });

  test('skips link/button underline affordances (horizontal variant)', () => {
    const link = '.nav-link::after { position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: #e04a3a; }';
    const anchor = 'a.cta::after { position: absolute; bottom: 0; left: 0; width: 100%; height: 3px; background: #e04a3a; }';
    const btn = '.cta-btn::after { position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: #e04a3a; }';
    expect(scanCssTextForPseudoStripe(link)).toHaveLength(0);
    expect(scanCssTextForPseudoStripe(anchor)).toHaveLength(0);
    expect(scanCssTextForPseudoStripe(btn)).toHaveLength(0);
  });

  test('skips selected-state underlines, flags all-tabs underlines (horizontal variant)', () => {
    const selectedTab = '[role="tab"][aria-selected="true"]::after { position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: #4a7de0; }';
    const activeItem = '.tabs .item.active::after { position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: #4a7de0; }';
    expect(scanCssTextForPseudoStripe(selectedTab)).toHaveLength(0);
    expect(scanCssTextForPseudoStripe(activeItem)).toHaveLength(0);
    // The same stripe on EVERY tab in the group is decoration, not state.
    const allTabs = '.tabs .item::after { position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: #4a7de0; }';
    const roleTab = '[role="tab"]::after { position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: #4a7de0; }';
    expect(scanCssTextForPseudoStripe(allTabs)).toHaveLength(1);
    expect(scanCssTextForPseudoStripe(roleTab)).toHaveLength(1);
  });

  test('skips hover-state underline affordance (horizontal variant)', () => {
    const css = '.item:hover::after { position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: #e04a3a; }';
    expect(scanCssTextForPseudoStripe(css)).toHaveLength(0);
  });

  test('skips 2px and 16px horizontal bars (thickness gates)', () => {
    const thin = '.card::before { position: absolute; top: 0; left: 0; right: 0; height: 2px; background: #e04a3a; }';
    const band = '.card::before { position: absolute; top: 0; left: 0; right: 0; height: 16px; background: #e04a3a; }';
    expect(scanCssTextForPseudoStripe(thin)).toHaveLength(0);
    expect(scanCssTextForPseudoStripe(band)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Low contrast — modern computed-color serializations (browser adapter path)
// ---------------------------------------------------------------------------

describe('checkColors — oklch computed colors', () => {
  test('flat dark-on-dark oklch CTA pair parses and fails contrast', () => {
    // Real browsers hand back oklch() strings from getComputedStyle for
    // colors authored in modern spaces; the adapters must not lose them.
    const textColor = parseAnyColor('oklch(0.34 0.01 70)');
    const bgColor = parseAnyColor('oklch(0.22 0.01 70)');
    expect(textColor).toBeTruthy();
    expect(bgColor).toBeTruthy();
    const f = checkColors({
      tag: 'a',
      textColor,
      bgColor,
      effectiveBg: bgColor,
      effectiveBgStops: null,
      fontSize: 14.4,
      fontWeight: 500,
      hasDirectText: true,
      isEmojiOnly: false,
      bgClip: '',
      bgImage: '',
      classList: 'btn btn-primary',
    });
    expect(f.some(r => r.id === 'low-contrast')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Numbered section labels — pure helpers
// ---------------------------------------------------------------------------

describe('numbered-section-labels — pure helpers', () => {
  test('parseNumberedLabelText accepts zero-padded and separator forms only', () => {
    expect(parseNumberedLabelText('01')).toEqual({ index: 1, text: '01' });
    expect(parseNumberedLabelText('12')).toEqual({ index: 12, text: '12' });
    expect(parseNumberedLabelText('04 / rollout')).toMatchObject({ index: 4 });
    expect(parseNumberedLabelText('6 · getting started')).toMatchObject({ index: 6 });
    expect(parseNumberedLabelText('7')).toBeNull();
    expect(parseNumberedLabelText('Step 3')).toBeNull();
    expect(parseNumberedLabelText('12 minute read')).toBeNull();
    expect(parseNumberedLabelText('50% off everything')).toBeNull();
    expect(parseNumberedLabelText('')).toBeNull();
  });

  test('checkNumberedSectionLabels needs 2+ candidates with 2+ distinct indices', () => {
    const candidate = (index) => ({ index, labelText: String(index).padStart(2, '0'), headingTag: 'h2', headingText: 'Heading' });
    expect(checkNumberedSectionLabels({ candidates: [candidate(1)] })).toHaveLength(0);
    expect(checkNumberedSectionLabels({ candidates: [candidate(1), candidate(1)] })).toHaveLength(0);
    const flagged = checkNumberedSectionLabels({ candidates: [candidate(1), candidate(2)] });
    expect(flagged).toHaveLength(2);
    expect(flagged[0].id).toBe('numbered-section-labels');
  });
});

// ---------------------------------------------------------------------------
// Radial-gradient background halo
// ---------------------------------------------------------------------------

describe('radial-halo', () => {
  const darkRoot = 'body { background: oklch(0.085 0.020 262); }';

  test('flags chromatic halo fading to transparent on a dark page', () => {
    const css = `${darkRoot} body { background: radial-gradient(120% 80% at 50% -10%, oklch(0.240 0.045 268) 0%, transparent 55%), oklch(0.085 0.020 262); }`;
    const f = scanCssTextForRadialHalo(css);
    expect(f).toHaveLength(1);
    expect(f[0].snippet).toContain('radial-gradient halo');
  });

  test('skips achromatic vignette with no transparent stop', () => {
    const css = `${darkRoot} body { background: radial-gradient(120% 90% at 50% -10%, oklch(0.19 0.02 264) 0%, oklch(0.075 0.01 262) 100%); }`;
    expect(scanCssTextForRadialHalo(css)).toHaveLength(0);
  });

  test('skips panel sheen fading to an opaque surface color', () => {
    const css = `${darkRoot} .hero { background: radial-gradient(120% 90% at 85% 0%, oklch(0.255 0.034 262), oklch(0.205 0.032 262) 60%); }`;
    expect(scanCssTextForRadialHalo(css)).toHaveLength(0);
  });

  test('skips px-sized dot texture patterns', () => {
    const css = `${darkRoot} .device::before { background-image: radial-gradient(oklch(1 0 0 / 0.018) 1px, transparent 1.4px); }`;
    expect(scanCssTextForRadialHalo(css)).toHaveLength(0);
  });

  test('skips translucent light-scene washes (inner alpha below 0.7)', () => {
    const css = `${darkRoot} .hero .light { background: radial-gradient(closest-side, oklch(0.62 0.10 255 / 0.55), oklch(0.42 0.09 258 / 0.22) 45%, transparent 72%); }`;
    expect(scanCssTextForRadialHalo(css)).toHaveLength(0);
  });

  test('skips halos on light pages', () => {
    const css = 'body { background: #faf7f2; } .hero { background: radial-gradient(60% 40% at 50% 0%, #7c3aed 0%, transparent 70%); }';
    expect(scanCssTextForRadialHalo(css)).toHaveLength(0);
  });

  test('skips declarations that include photographic url() layers', () => {
    const css = `${darkRoot} .hero { background: url(cover.jpg), radial-gradient(60% 40% at 50% 0%, #7c3aed 0%, transparent 70%); }`;
    expect(scanCssTextForRadialHalo(css)).toHaveLength(0);
  });

  test('resolves var() color stops', () => {
    const css = `:root { --glow: oklch(0.5 0.18 300); } ${darkRoot} .bg { background: radial-gradient(80% 60% at 50% 0%, var(--glow) 0%, transparent 60%); }`;
    expect(scanCssTextForRadialHalo(css)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Hover-state contrast + color-mix parsing
// ---------------------------------------------------------------------------

describe('hover contrast + color-mix', () => {
  test('parseColorMix: mix with transparent keeps color, scales alpha', () => {
    const c = parseColorMix('color-mix(in oklab, rgb(230, 68, 37) 16%, transparent)');
    expect(c.r).toBe(230);
    expect(c.g).toBe(68);
    expect(c.b).toBe(37);
    expect(c.a).toBeCloseTo(0.16, 2);
  });

  test('parseColorMix: 50/50 opaque mix averages channels', () => {
    const c = parseColorMix('color-mix(in srgb, rgb(0, 0, 0), rgb(255, 255, 255))');
    expect(c.a).toBe(1);
    expect(Math.abs(c.r - 128)).toBeLessThanOrEqual(1);
  });

  test('parseAnyColor routes color-mix expressions', () => {
    const c = parseAnyColor('color-mix(in oklab, oklch(0.625 0.205 33) 16%, transparent)');
    expect(c).not.toBeNull();
    expect(c.a).toBeCloseTo(0.16, 2);
  });

  test('checkHoverContrast flags a failing hover pair on a styled control', () => {
    const f = checkHoverContrast({
      tag: 'a',
      textColor: { r: 239, g: 236, b: 233, a: 1 },
      bg: { r: 215, g: 56, b: 23, a: 1 },
      ownBgAlpha: 1,
      fontSize: 13.6,
      fontWeight: 500,
      hasDirectText: true,
      isEmojiOnly: false,
    });
    expect(f).toHaveLength(1);
    expect(f[0].id).toBe('low-contrast');
    expect(f[0].snippet).toContain(':hover');
  });

  test('checkHoverContrast skips plain links without their own background', () => {
    const f = checkHoverContrast({
      tag: 'a',
      textColor: { r: 120, g: 120, b: 120, a: 1 },
      bg: { r: 128, g: 128, b: 128, a: 1 },
      ownBgAlpha: null,
      fontSize: 16,
      fontWeight: 400,
      hasDirectText: true,
      isEmojiOnly: false,
    });
    expect(f).toHaveLength(0);
  });

  test('checkHoverContrast passes a compliant hover pair', () => {
    const f = checkHoverContrast({
      tag: 'a',
      textColor: { r: 255, g: 255, b: 255, a: 1 },
      bg: { r: 20, g: 20, b: 20, a: 1 },
      ownBgAlpha: 1,
      fontSize: 14,
      fontWeight: 500,
      hasDirectText: true,
      isEmojiOnly: false,
    });
    expect(f).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Auto-scrolling marquee
// ---------------------------------------------------------------------------

describe('marquee', () => {
  test('flags infinite percent-travel X loop (implicit start)', () => {
    const css = `
      .ticker-track { display: flex; width: max-content; animation: ticker 25s linear infinite; }
      @keyframes ticker { to { transform: translateX(-50%); } }
    `;
    const f = scanCssTextForMarquee(css);
    expect(f).toHaveLength(1);
    expect(f[0].id).toBe('marquee');
    expect(f[0].snippet).toContain('.ticker-track');
  });

  test('flags <marquee> elements', () => {
    const f = scanCssTextForMarquee('<div><marquee>sale sale sale</marquee></div>');
    expect(f).toHaveLength(1);
    expect(f[0].snippet).toContain('<marquee>');
  });

  test('skips centered elements animating other properties', () => {
    const css = `
      .toast { animation: rise 3s ease infinite; }
      @keyframes rise { from { transform: translate(-50%, 8px); } to { transform: translate(-50%, 0); } }
    `;
    expect(scanCssTextForMarquee(css)).toHaveLength(0);
  });

  test('skips non-infinite slide-in animations', () => {
    const css = `
      .panel { animation: enter 0.4s ease; }
      @keyframes enter { from { transform: translateX(-100%); } to { transform: translateX(0); } }
    `;
    expect(scanCssTextForMarquee(css)).toHaveLength(0);
  });

  test('skips px-travel sweeps (playheads, progress indicators)', () => {
    const css = `
      .wave-anim .playhead { animation: sweep 6s linear infinite; }
      @keyframes sweep { from { transform: translateX(0); } to { transform: translateX(760px); } }
    `;
    expect(scanCssTextForMarquee(css)).toHaveLength(0);
  });

  test('skips rotation and pulse animations', () => {
    const css = `
      .spinner { animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .dot { animation: breathe 2s ease infinite; }
      @keyframes breathe { 50% { transform: translateX(-50%) scale(1.1); opacity: 0.6; } }
    `;
    expect(scanCssTextForMarquee(css)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Inset box-shadow stripes (side-tab variant)
// ---------------------------------------------------------------------------

describe('inset box-shadow stripe', () => {
  test('flags single-edge chromatic inset stripes on repeated items', () => {
    const css = `
      :root { --good: #16a34a; }
      .flag-good { box-shadow: inset 0 3px 0 var(--good); }
      .callout { box-shadow: inset 4px 0 0 #dc2626; }
    `;
    const f = scanCssTextForInsetStripe(css);
    expect(f).toHaveLength(2);
    expect(f[0].id).toBe('side-tab');
  });

  test('exempts current/selected-state indicators', () => {
    const css = `
      .section-link[aria-current="location"] { box-shadow: inset 3px 0 0 #ea580c; }
      .item.active { box-shadow: inset 3px 0 0 #ea580c; }
      [role="tab"][aria-selected="true"] { box-shadow: inset 0 -3px 0 #ea580c; }
      .link:hover { box-shadow: inset 3px 0 0 #ea580c; }
    `;
    expect(scanCssTextForInsetStripe(css)).toHaveLength(0);
  });

  test('skips narrow glyphs, blurred/spread shadows, neutrals, and thick fills', () => {
    const css = `
      .brand-mark { width: 13px; box-shadow: inset 0 -7px 0 #2563eb; }
      .card { box-shadow: inset 0 3px 6px rgba(0,0,0,.2); }
      .row { box-shadow: inset 0 1px 0 #e5e7eb; }
      .well { box-shadow: inset 0 20px 0 #dc2626; }
    `;
    expect(scanCssTextForInsetStripe(css)).toHaveLength(0);
  });

  test('flags all-tabs inset underlines, keeps the selected tab exempt', () => {
    const allTabs = '.tab { box-shadow: inset 0 -3px 0 #f59e0b; }';
    const roleTab = '[role="tab"] { box-shadow: inset 0 -3px 0 #f59e0b; }';
    const selectedOnly = 'nav button[aria-selected="true"] { box-shadow: inset 0 -3px 0 #f59e0b; }';
    expect(scanCssTextForInsetStripe(allTabs)).toHaveLength(1);
    expect(scanCssTextForInsetStripe(roleTab)).toHaveLength(1);
    expect(scanCssTextForInsetStripe(selectedOnly)).toHaveLength(0);
  });

  test('static tab strip: chromatic border on every tab flags, selected-only underline stays silent', async () => {
    // All-tabs variant: every tab in the group carries the stripe.
    await withStaticFixture({
      'index.html': `<!DOCTYPE html><html><head><style>
        .tabs { display: flex; }
        .tab { border-bottom: 3px solid #d22a2a; padding: 8px 12px; }
        h1 { font-size: 40px; }
      </style></head><body>
        <div class="tabs" role="tablist">
          <div class="tab" role="tab" aria-selected="true">Today</div>
          <div class="tab" role="tab" aria-selected="false">Tomorrow</div>
          <div class="tab" role="tab" aria-selected="false">Week</div>
        </div>
        <h1>Departures board</h1>
        <p>Enough body copy for the page-level scanners to treat this as a page.</p>
      </body></html>`,
    }, async ({ file }) => {
      const findings = await detectHtml(file);
      const stripes = findings.filter(f => f.antipattern === 'side-tab');
      // The two unselected tabs flag; the selected tab stays exempt.
      expect(stripes).toHaveLength(2);
    });

    // Reserved-space variant: transparent on all, chromatic on selected only.
    await withStaticFixture({
      'index.html': `<!DOCTYPE html><html><head><style>
        .tabs { display: flex; }
        .tab { border-bottom: 3px solid transparent; padding: 8px 12px; }
        .tab[aria-selected="true"] { border-bottom-color: #d22a2a; }
        h1 { font-size: 40px; }
      </style></head><body>
        <div class="tabs" role="tablist">
          <div class="tab" role="tab" aria-selected="true">Today</div>
          <div class="tab" role="tab" aria-selected="false">Tomorrow</div>
        </div>
        <h1>Departures board</h1>
        <p>Enough body copy for the page-level scanners to treat this as a page.</p>
      </body></html>`,
    }, async ({ file }) => {
      const findings = await detectHtml(file);
      expect(findings.filter(f => f.antipattern === 'side-tab')).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Grid-line background variants (checkHtmlPatterns block scan)
// ---------------------------------------------------------------------------

describe('codex-grid-background variants', () => {
  const grids = (html) => checkHtmlPatterns(html).filter(f => f.id === 'codex-grid-background');

  test('flags two-axis inverted-calc hairlines with shorthand tile size', () => {
    const css = `body { background:
      linear-gradient(90deg, transparent calc(100% - 1px), oklch(0.84 0.015 255 / 0.4) 1px) 0 0 / 48px 48px,
      linear-gradient(transparent calc(100% - 1px), oklch(0.84 0.015 255 / 0.4) 1px) 0 0 / 48px 48px,
      #eef1f7; }`;
    expect(grids(css)).toHaveLength(1);
  });

  test('flags single-axis hairline tiled by a px pair cell', () => {
    const css = `body { background: linear-gradient(90deg, rgba(23,25,24,.035) 1px, transparent 1px) 0 0 / 40px 40px, #f4f1ea; }`;
    const f = grids(css);
    expect(f).toHaveLength(1);
    expect(f[0].snippet).toContain('line-field');
  });

  test('keeps percent-tiled single hairlines (data-viz track rules) legal', () => {
    const css = `.span-track { background-image: linear-gradient(90deg, #303532 1px, transparent 1px); background-size: 25% 100%; }`;
    expect(grids(css)).toHaveLength(0);
  });

  test('classic two-axis background-size form still flags', () => {
    const css = `.hero { background-image:
      linear-gradient(#eee 1px, transparent 1px),
      linear-gradient(90deg, #eee 1px, transparent 1px);
      background-size: 24px 24px; }`;
    expect(grids(css)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Hero eyebrow: dash-prefix branch
// ---------------------------------------------------------------------------

describe('hero-eyebrow dash-prefix branch', () => {
  const base = {
    headingTag: 'h1',
    headingText: 'Find the service that started it.',
    headingFontSize: 72,
    siblingTag: 'p',
    siblingText: 'Distributed tracing for microservices',
    siblingTextTransform: 'none',
    siblingFontSize: 13,
    siblingLetterSpacing: 0.26,
    siblingFontWeight: '400',
    siblingColor: 'rgb(120, 120, 110)',
  };

  test('flags sentence-case label with accent dash pseudo', () => {
    const f = checkHeroEyebrow({ ...base, siblingHasAccentDashPseudo: true });
    expect(f).toHaveLength(1);
    expect(f[0].snippet).toContain('dash-prefix');
  });

  test('same label without the dash stays legal', () => {
    expect(checkHeroEyebrow({ ...base, siblingHasAccentDashPseudo: false })).toHaveLength(0);
  });

  test('static engine resolves the dash through the cascade', async () => {
    await withStaticFixture({
      'index.html': `<!DOCTYPE html><html><head><style>
        :root { --signal: #e84a1c; }
        .eyebrow { font-size: 13px; letter-spacing: .02em; color: #6f6a5f; }
        .eyebrow::before { content: ""; width: 28px; height: 3px; background: var(--signal); }
        h1 { font-size: 72px; }
      </style></head><body><main>
        <p class="eyebrow">Distributed tracing for microservices</p>
        <h1>Find the service that started it.</h1>
        <p>Body copy long enough to make this a real page for the scanners.</p>
      </main></body></html>`,
    }, async ({ file }) => {
      const findings = await detectHtml(file);
      const hits = findings.filter(f => f.antipattern === 'hero-eyebrow-chip');
      expect(hits).toHaveLength(1);
      expect(hits[0].snippet).toContain('dash-prefix');
    });
  });
});

// ---------------------------------------------------------------------------
// Pulsing status dots
// ---------------------------------------------------------------------------

describe('pulsing-dot', () => {
  test('fixture flags the five pulsing dots and none of the passes', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'pulsing-dot.html'));
    const dots = f.filter(r => r.antipattern === 'pulsing-dot');
    const snippets = dots.map(r => r.snippet).join(' | ');
    expect(dots).toHaveLength(5);
    expect(snippets).toContain('.live-dot');
    expect(snippets).toContain('.status .dot');
    expect(snippets).toContain('.beacon');
    expect(snippets).toContain('.rec-mark');
    expect(snippets).toContain('animate-ping');
    expect(snippets).not.toContain('spinner');
    expect(snippets).not.toContain('fake-pulse');
    expect(snippets).not.toContain('breathing-card');
    expect(snippets).not.toContain('square-badge');
  });

  test('header dot is promoted to error severity; body dots keep the default', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'pulsing-dot.html'));
    const dots = f.filter(r => r.antipattern === 'pulsing-dot');
    const headerDot = dots.find(r => r.snippet.includes('.rec-mark'));
    expect(headerDot.severity).toBe('error');
    expect(headerDot.snippet).toContain('in header/nav');
    const bodyDot = dots.find(r => r.snippet.includes('.live-dot'));
    expect(bodyDot.severity).toBe('warning');
    expect(bodyDot.snippet).not.toContain('in header/nav');
  });

  test('merges size and animation declared in separate rule blocks for one selector', () => {
    const css = `
      .dot { width: 8px; height: 8px; border-radius: 50%; }
      .dot { animation: pulse 2s infinite; }
      @keyframes pulse { 50% { opacity: 0.3; } }
    `;
    const f = scanCssTextForPulsingDot(css);
    expect(f).toHaveLength(1);
    expect(f[0].selector).toBe('.dot');
  });

  test('descends into matching media queries for the animation half', () => {
    const css = `
      .dot { width: 7px; height: 7px; border-radius: 50%; }
      @media (prefers-reduced-motion: no-preference) {
        .dot { animation: pulseDot 2.4s ease-in-out infinite; }
      }
      @keyframes pulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
    `;
    expect(scanCssTextForPulsingDot(css)).toHaveLength(1);
  });

  test('prefers-reduced-motion: reduce resets never mask the default animation', () => {
    const css = `
      .dot { width: 8px; height: 8px; border-radius: 50%; animation: pulse 2s infinite; }
      @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
      @keyframes pulse { 50% { opacity: 0.3; } }
    `;
    expect(scanCssTextForPulsingDot(css)).toHaveLength(1);
  });

  test('a later animation: none outside reduced-motion disables the dot', () => {
    const css = `
      .dot { width: 8px; height: 8px; border-radius: 50%; animation: pulse 2s infinite; }
      .dot { animation: none; }
      @keyframes pulse { 50% { opacity: 0.3; } }
    `;
    expect(scanCssTextForPulsingDot(css)).toHaveLength(0);
  });

  test('detects tiny circle with infinite opacity-pulse keyframes', () => {
    const css = `
      .dot { width: 8px; height: 8px; border-radius: 50%; animation: pulse 2s infinite; }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    `;
    const f = scanCssTextForPulsingDot(css);
    expect(f).toHaveLength(1);
    expect(f[0].id).toBe('pulsing-dot');
  });

  test('detects box-shadow ripple keyframes', () => {
    const css = `
      .dot { width: 7px; height: 7px; border-radius: 999px; animation: ripple 1.8s linear infinite; }
      @keyframes ripple { 0% { box-shadow: 0 0 0 0 rgba(0,255,0,0.4); } 100% { box-shadow: 0 0 0 6px rgba(0,255,0,0); } }
    `;
    expect(scanCssTextForPulsingDot(css)).toHaveLength(1);
  });

  test('accepts pulse-family names when keyframes are not in the scanned text', () => {
    const css = '.dot { width: 8px; height: 8px; border-radius: 50%; animation: blink 1.4s infinite; }';
    expect(scanCssTextForPulsingDot(css)).toHaveLength(1);
  });

  test('rotation-only animations never flag (spinners)', () => {
    const css = `
      .spinner { width: 14px; height: 14px; border-radius: 50%; animation: spin 0.8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
    `;
    expect(scanCssTextForPulsingDot(css)).toHaveLength(0);
  });

  test('rotation-only keyframes win over a pulse-like name', () => {
    const css = `
      .dot { width: 8px; height: 8px; border-radius: 50%; animation: pulse-ring 1s linear infinite; }
      @keyframes pulse-ring { to { transform: rotate(180deg); } }
    `;
    expect(scanCssTextForPulsingDot(css)).toHaveLength(0);
  });

  test('skips large pulsing surfaces (not a dot)', () => {
    const css = `
      .card { width: 240px; height: 120px; border-radius: 16px; animation: pulse 3s infinite; }
      @keyframes pulse { 50% { opacity: 0.5; } }
    `;
    expect(scanCssTextForPulsingDot(css)).toHaveLength(0);
  });

  test('skips finite pulse animations', () => {
    const css = `
      .dot { width: 8px; height: 8px; border-radius: 50%; animation: pulse 0.6s ease-out 3; }
      @keyframes pulse { 50% { opacity: 0.5; } }
    `;
    expect(scanCssTextForPulsingDot(css)).toHaveLength(0);
  });

  test('skips non-circular pulsing elements', () => {
    const css = `
      .badge { width: 12px; height: 12px; border-radius: 2px; animation: pulse 2s infinite; }
      @keyframes pulse { 50% { opacity: 0.5; } }
    `;
    expect(scanCssTextForPulsingDot(css)).toHaveLength(0);
  });

  test('Tailwind animate-ping on tiny rounded-full element flags; large skeleton does not', () => {
    const html = `
      <span class="animate-ping w-2 h-2 rounded-full bg-emerald-500"></span>
      <div class="animate-pulse rounded-md w-48 h-6 bg-gray-200"></div>
    `;
    const f = scanCssTextForPulsingDot(html);
    expect(f).toHaveLength(1);
    expect(f[0].snippet).toContain('animate-ping');
  });
});

// ---------------------------------------------------------------------------
// Shape-assembled illustrations
// ---------------------------------------------------------------------------

describe('shape-assembled-illustration', () => {
  test('fixture flags only the hero mascot scene', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'shape-assembled-illustration.html'));
    const hits = f.filter(r => r.antipattern === 'shape-assembled-illustration');
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe('advisory');
    expect(hits[0].snippet).toContain('primitive shapes');
  });

  test('flags a large multi-fill primitive scene', () => {
    const shapes = Array.from({ length: 10 }, (_, i) =>
      `<rect x="${i * 30}" y="40" width="24" height="60" fill="#c${i % 4}${i % 8}"/>`).join('');
    const html = `<svg viewBox="0 0 400 300">${shapes}<circle cx="60" cy="40" r="20" fill="#123456"/></svg>`;
    expect(scanHtmlForShapeAssembledIllustration(html)).toHaveLength(1);
  });

  test('small explicit size wins over a large viewBox (icons, logos)', () => {
    const shapes = Array.from({ length: 10 }, (_, i) =>
      `<rect x="${i * 30}" y="40" width="24" height="60" fill="#c${i % 4}${i % 8}"/>`).join('');
    const html = `<svg viewBox="0 0 400 300" width="32" height="32">${shapes}</svg>`;
    expect(scanHtmlForShapeAssembledIllustration(html)).toHaveLength(0);
  });

  test('axis-labeled charts never flag', () => {
    const bars = Array.from({ length: 9 }, (_, i) =>
      `<rect x="${i * 40}" y="${100 + i * 10}" width="30" height="${200 - i * 10}" fill="#${i % 3}${i % 3}${i % 3}abc"/>`).join('');
    const labels = '<text x="0" y="380">Q1</text><text x="120" y="380">Q2</text><text x="240" y="380">Q3</text>';
    const html = `<svg viewBox="0 0 400 400">${bars}${labels}</svg>`;
    expect(scanHtmlForShapeAssembledIllustration(html)).toHaveLength(0);
  });

  test('stroke-only line drawings (no fills) never flag', () => {
    const shapes = Array.from({ length: 10 }, (_, i) =>
      `<circle cx="${40 + i * 30}" cy="150" r="20"/>`).join('');
    const html = `<svg viewBox="0 0 400 300" fill="none" stroke="currentColor">${shapes}</svg>`;
    expect(scanHtmlForShapeAssembledIllustration(html)).toHaveLength(0);
  });

  test('tiling pattern backgrounds never flag', () => {
    const shapes = Array.from({ length: 10 }, (_, i) =>
      `<rect x="${i * 30}" y="40" width="24" height="60" fill="#c${i % 4}${i % 8}"/>`).join('');
    const html = `<svg viewBox="0 0 1200 600"><defs><pattern id="p" width="10" height="10"><rect width="5" height="5" fill="#eee"/></pattern></defs>${shapes}</svg>`;
    expect(scanHtmlForShapeAssembledIllustration(html)).toHaveLength(0);
  });

  test('fewer than eight primitives never flags (path-heavy real illustration)', () => {
    const html = `<svg viewBox="0 0 600 400">
      <path d="M0 0 C 10 10, 20 20, 30 30" fill="#111"/>
      <path d="M5 5 C 15 15, 25 25, 35 35" fill="#222"/>
      <rect x="10" y="10" width="40" height="40" fill="#333"/>
      <circle cx="100" cy="100" r="30" fill="#444"/>
    </svg>`;
    expect(scanHtmlForShapeAssembledIllustration(html)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Nav CTA contrast construction sweep
// ---------------------------------------------------------------------------

describe('nav CTA contrast constructions', () => {
  // One fixture per construction family that has shipped (or could ship) a
  // low-contrast header CTA past the detector: solid own bg, specificity
  // cascade, var() indirection, own gradient bg, pseudo-element surface,
  // inherited color, alpha-composited bg, oklch serialization. The
  // background-image: url(...) variant stays unflaggable by design (no
  // computable surface color).
  test('every computable construction produces a low-contrast finding', async () => {
    const f = await detectHtml(path.join(FIXTURES, 'nav-cta-constructions.html'));
    const lows = f.filter(r => r.antipattern === 'low-contrast').map(r => r.snippet).join(' | ');
    expect(lows).toContain('#e8b84b');  // v1 solid bg + own color
    expect(lows).toContain('#e5a93f');  // v2 specificity cascade
    expect(lows).toContain('#f0b64e');  // v3 var() indirection
    expect(lows).toContain('#f2b854');  // v4 own gradient bg (worst stop)
    expect(lows).toContain('#efb352');  // v5 pseudo-element surface
    expect(lows).toContain('#eab04a');  // v6 inherited color
    expect(lows).toContain('#cf9c48');  // v7 alpha bg composited over header
    expect(lows).toContain('#fcb442');  // v8 oklch on both sides
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
});

// ---------------------------------------------------------------------------
// walkDir
// ---------------------------------------------------------------------------

describe('walkDir', () => {
  test('includes Sass files in scannable extensions', () => {
    expect(SCANNABLE_EXTENSIONS.has('.sass')).toBe(true);
  });

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
    const result = spawnSync('node', [SCRIPT, ...withoutDesignSystemArgs(args)], { encoding: 'utf-8', timeout: 15000 });
    return { stdout: result.stdout || '', stderr: result.stderr || '', code: result.status };
  }
  function runIn(cwd, ...args) {
    const result = spawnSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf-8', timeout: 15000 });
    return { stdout: result.stdout || '', stderr: result.stderr || '', code: result.status };
  }

  test('--help exits 0', () => {
    const { stdout, code } = run('--help');
    expect(code).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('--quiet');
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

  test('--quiet suppresses text details and keeps the summary exit signal', () => {
    const { stdout, stderr, code } = run('--quiet', path.join(FIXTURES, 'should-flag.html'));
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr.trim()).toMatch(/^[1-9]\d* anti-patterns? found\.$/);
    expect(stderr).not.toContain('side-tab');
    expect(stderr).not.toContain('line ');
  });

  test('--quiet stays silent on clean files', () => {
    const { stdout, stderr, code } = run('--quiet', path.join(FIXTURES, 'should-pass.html'));
    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toBe('');
  });

  test('--quiet does not affect JSON output', () => {
    const { stdout, stderr, code } = run('--json', '--quiet', path.join(FIXTURES, 'should-flag.html'));
    expect(code).toBe(2);
    expect(stderr).toBe('');
    const parsed = JSON.parse(stdout.trim());
    expect(parsed).toBeArray();
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.some(f => f.antipattern === 'side-tab')).toBe(true);
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

  test('local DESIGN.md enables design-system rules by default and --no-design-system disables them', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-cli-design-system-'));
    try {
      fs.writeFileSync(path.join(dir, 'DESIGN.md'), `---
typography:
  body:
    fontFamily: "IBM Plex Sans, Arial, sans-serif"
colors:
  ink: "#241f1a"
  paper: "#f7f4ee"
rounded:
  md: "8px"
---

# Design System
`);
      fs.writeFileSync(path.join(dir, 'index.html'), `
        <section style="font-family: 'Poppins', sans-serif; color: #ff00aa; background: #f7f4ee; border-radius: 18px;">
          Design drift
        </section>
      `);

      const active = runIn(dir, '--json', 'index.html');
      expect(active.code).toBe(2);
      const activeIds = JSON.parse(active.stdout).map((finding) => finding.antipattern);
      expect(activeIds).toContain('design-system-font');
      expect(activeIds).toContain('design-system-color');
      expect(activeIds).toContain('design-system-radius');

      const disabled = runIn(dir, '--json', '--no-design-system', 'index.html');
      const disabledIds = JSON.parse(disabled.stdout).map((finding) => finding.antipattern);
      expect(disabledIds.some((id) => id.startsWith('design-system-'))).toBe(false);

      const raw = runIn(dir, '--json', '--no-config', 'index.html');
      const rawIds = JSON.parse(raw.stdout).map((finding) => finding.antipattern);
      expect(rawIds.some((id) => id.startsWith('design-system-'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('filterByScopes keeps only findings for the requested design domain', () => {
    const findings = [
      { antipattern: 'flat-type-hierarchy' },
      { antipattern: 'nested-cards' },
      { antipattern: 'line-length' },
    ];

    expect(filterByScopes(findings, ['type']).map((f) => f.antipattern)).toEqual([
      'flat-type-hierarchy',
      'line-length',
    ]);
    expect(filterByScopes(findings, ['layout']).map((f) => f.antipattern)).toEqual([
      'nested-cards',
      'line-length',
    ]);
    expect(filterByScopes(findings, [])).toEqual(findings);
  });

  test('--scope filters CLI output to a design domain', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-cli-scope-'));
    try {
      fs.writeFileSync(path.join(dir, 'DESIGN.md'), `---
typography:
  body:
    fontFamily: "IBM Plex Sans, Arial, sans-serif"
    fontSize: "16px"
colors:
  ink: "#241f1a"
  paper: "#f7f4ee"
---

# Design System
`);
      fs.writeFileSync(path.join(dir, 'index.css'), `
.bad {
  font-family: "IBM Plex Sans", Arial, sans-serif;
  font-size: 12.5px;
  color: #ff00aa;
}
`);

      const full = runIn(dir, '--json', 'index.css');
      expect(full.code).toBe(2);
      const fullIds = JSON.parse(full.stdout).map((finding) => finding.antipattern);
      expect(fullIds).toContain('design-system-font-size');
      expect(fullIds).toContain('design-system-color');

      const typeOnly = runIn(dir, '--json', '--scope', 'type', 'index.css');
      const typeIds = JSON.parse(typeOnly.stdout).map((finding) => finding.antipattern);
      expect(typeIds).toContain('design-system-font-size');
      expect(typeIds.some((id) => id === 'design-system-color')).toBe(false);

      const badScope = runIn(dir, '--scope', 'bogus', 'index.css');
      expect(badScope.code).toBe(1);
      expect(badScope.stderr).toContain('Valid scopes:');

      // A bare --scope must fail instead of silently scanning unscoped.
      const missingTrailing = runIn(dir, 'index.css', '--scope');
      expect(missingTrailing.code).toBe(1);
      expect(missingTrailing.stderr).toContain('--scope requires a value');

      const missingBeforeFlag = runIn(dir, '--scope', '--json', 'index.css');
      expect(missingBeforeFlag.code).toBe(1);
      expect(missingBeforeFlag.stderr).toContain('--scope requires a value');

      const emptyInline = runIn(dir, '--scope=', 'index.css');
      expect(emptyInline.code).toBe(1);
      expect(emptyInline.stderr).toContain('--scope requires a value');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('detector designSystem.enabled=false disables CLI design-system rules', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-cli-design-disabled-'));
    try {
      fs.mkdirSync(path.join(dir, '.impeccable'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.impeccable', 'config.json'), JSON.stringify({
        detector: { designSystem: { enabled: false } },
      }));
      fs.writeFileSync(path.join(dir, 'DESIGN.md'), `---
typography:
  body:
    fontFamily: "IBM Plex Sans, Arial, sans-serif"
colors:
  ink: "#241f1a"
  paper: "#f7f4ee"
rounded:
  md: "8px"
---

# Design System
`);
      fs.writeFileSync(path.join(dir, 'index.html'), `
        <section style="font-family: 'Poppins', sans-serif; color: #ff00aa; background: #f7f4ee; border-radius: 18px;">
          Design drift
        </section>
      `);

      const result = runIn(dir, '--json', 'index.html');
      const ids = JSON.parse(result.stdout).map((finding) => finding.antipattern);
      expect(ids.some((id) => id.startsWith('design-system-'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('respects .impeccable config ignoreFiles like the hook', async () => {
    await withStaticFixture({
      '.impeccable/config.json': JSON.stringify({
        detector: { ignoreFiles: ['src/noisy.css'] },
      }),
      'src/noisy.css': "body { font-family: 'Inter', sans-serif; }",
    }, ({ dir }) => {
      const { stdout, code } = runIn(dir, '--json', 'src');
      expect(code).toBe(0);
      expect(JSON.parse(stdout.trim())).toEqual([]);
    });
  });

  test('respects .impeccable config ignoreRules like the hook', async () => {
    await withStaticFixture({
      '.impeccable/config.json': JSON.stringify({
        detector: { ignoreRules: ['side-tab'] },
      }),
      'src/card.css': '.card { border-left: 4px solid #3b82f6; border-radius: 12px; }',
    }, ({ dir }) => {
      const { stdout, code } = runIn(dir, '--json', 'src/card.css');
      expect(code).toBe(0);
      expect(JSON.parse(stdout.trim())).toEqual([]);
    });
  });

  test('respects .impeccable config ignoreValues like the hook', async () => {
    await withStaticFixture({
      '.impeccable/config.json': JSON.stringify({
        detector: {
          ignoreValues: [
            { rule: 'overused-font', value: 'Inter' },
          ],
        },
      }),
      'src/fonts.css': [
        "body { font-family: 'Inter', sans-serif; }",
        "h1 { font-family: 'Roboto', sans-serif; }",
      ].join('\n'),
    }, ({ dir }) => {
      const { stdout, code } = runIn(dir, '--json', 'src/fonts.css');
      expect(code).toBe(2);
      const snippets = JSON.parse(stdout.trim()).map(f => f.snippet).join('\n');
      expect(snippets).not.toContain('Inter');
      expect(snippets).toContain('Roboto');
    });
  });

  test('respects scoped wildcard ignoreValues like the hook', async () => {
    await withStaticFixture({
      '.impeccable/config.json': JSON.stringify({
        detector: {
          ignoreValues: [
            { rule: 'overused-font', value: '*', files: ['src/main.css'] },
          ],
        },
      }),
      'src/main.css': "body { font-family: 'Inter', sans-serif; }",
      'src/other.css': "body { font-family: 'Inter', sans-serif; }",
    }, ({ dir }) => {
      const { stdout, code } = runIn(dir, '--json', 'src');
      expect(code).toBe(2);
      const findings = JSON.parse(stdout.trim());
      expect(findings.some(f => f.file.endsWith('src/main.css'))).toBe(false);
      expect(findings.some(f => f.file.endsWith('src/other.css'))).toBe(true);
    });
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
    const result = spawnSync('node', [SCRIPT, ...withoutDesignSystemArgs(args)], { encoding: 'utf-8', timeout: 15000 });
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
    const result = spawnSync('node', [SCRIPT, ...withoutDesignSystemArgs(args)], { encoding: 'utf-8', timeout: 15000 });
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
    const result = spawnSync('node', [SCRIPT, ...withoutDesignSystemArgs(args)], { encoding: 'utf-8', timeout: 15000 });
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
    const result = spawnSync('node', [SCRIPT, ...withoutDesignSystemArgs(args)], { encoding: 'utf-8', timeout: 15000 });
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

  test('resolves Sass @import', () => {
    const graph = buildImportGraph([
      path.join(MF, 'theme.sass'),
      path.join(MF, 'variables.sass'),
    ]);
    const themeImports = graph.get(path.join(MF, 'theme.sass'));
    expect(themeImports).toBeDefined();
    expect(themeImports.has(path.join(MF, 'variables.sass'))).toBe(true);
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
    const result = spawnSync('node', [SCRIPT, ...withoutDesignSystemArgs(args)], { encoding: 'utf-8', timeout: 15000 });
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
    const result = spawnSync('node', [SCRIPT, ...withoutDesignSystemArgs(args)], { encoding: 'utf-8', timeout: 15000 });
    return { stdout: result.stdout || '', stderr: result.stderr || '', code: result.status };
  }

  test('suggests URL scan when Next.js config found', () => {
    const { stderr } = run(path.join(FIXTURES, 'framework-next-tailwind'));
    expect(stderr).toContain('Next.js');
    expect(stderr).toContain('3000');
  });

  test('--quiet suppresses framework URL scan suggestions', () => {
    const { stderr, code } = run('--quiet', path.join(FIXTURES, 'framework-next-tailwind'));
    expect(code).toBe(2);
    expect(stderr.trim()).toMatch(/^[1-9]\d* anti-patterns? found\.$/);
    expect(stderr).not.toContain('Next.js');
    expect(stderr).not.toContain('3000');
    expect(stderr).not.toContain('Start the dev server');
  });

  test('suggests URL scan when Vite config found', () => {
    const { stderr } = run(path.join(FIXTURES, 'framework-vite'));
    expect(stderr).toContain('Vite');
    expect(stderr).toContain('8080');
  });
});
