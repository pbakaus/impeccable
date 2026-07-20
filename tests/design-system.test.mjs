/**
 * Design-system normalization and source-rule tests.
 * Run with: node --test tests/design-system.test.mjs
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  checkSourceDesignSystem,
  collectStaticDesignSystemFindings,
  isAllowedColorRaw,
  isAllowedFont,
  isAllowedRadiusRaw,
  isAllowedFontSizeRaw,
  loadDesignSystemForCwd,
  normalizeDesignSystem,
} from '../cli/engine/design-system.mjs';

const tempDirs = [];

function mkTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-design-system-'));
  tempDirs.push(dir);
  return dir;
}

function sampleDesignSystem() {
  return normalizeDesignSystem({
    frontmatter: {
      typography: {
        display: { fontFamily: 'Avenir Next, Georgia, serif', fontSize: 'clamp(2.5rem, 6vw, 4rem)' },
        body: { fontFamily: 'IBM Plex Sans, Arial, sans-serif', fontSize: '16px' },
        label: { fontFamily: 'IBM Plex Sans, Arial, sans-serif', fontSize: '0.875rem' },
      },
      colors: {
        ink: '#241f1a',
        paper: '#f7f4ee',
        accent: '#b8422e',
        gold: 'oklch(84% 0.19 80.46)',
      },
      rounded: {
        sm: '4px',
        md: '8px',
        '"2xl"': '80px',
        full: '999px',
      },
    },
    sidecar: {
      extensions: {
        colorMeta: {
          gold: {
            canonical: 'oklch(84% 0.19 80.46)',
            tonalRamp: ['#d9a531', '#b98518'],
          },
        },
        roundedMeta: {
          soft: {
            canonical: '12px',
            values: ['24px'],
          },
        },
      },
    },
  });
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('normalizeDesignSystem()', () => {
  it('normalizes typography, colors, sidecar ramps, and quoted rounded keys', () => {
    const designSystem = sampleDesignSystem();

    assert.equal(isAllowedFont('avenir next', designSystem), true);
    assert.equal(isAllowedFont('ibm plex sans', designSystem), true);
    assert.equal(isAllowedFont('system-ui', designSystem), true);
    assert.equal(isAllowedFont('poppins', designSystem), false);

    assert.equal(isAllowedColorRaw('#241f1a', designSystem), true);
    assert.equal(isAllowedColorRaw('oklch(84% 0.19 80.46 / 0.5)', designSystem), true);
    assert.equal(isAllowedColorRaw('#d9a531', designSystem), true);
    assert.equal(isAllowedColorRaw('#ff00aa', designSystem), false);
    assert.equal(isAllowedColorRaw('var(--brand-accent)', designSystem), true);
    assert.equal(isAllowedColorRaw('currentColor', designSystem), true);

    assert.equal(isAllowedRadiusRaw('0', designSystem), true);
    assert.equal(isAllowedRadiusRaw('50%', designSystem), true);
    assert.equal(isAllowedRadiusRaw('80px', designSystem), true);
    assert.equal(isAllowedRadiusRaw('12px', designSystem), true);
    assert.equal(isAllowedRadiusRaw('24px', designSystem), true);
    assert.equal(isAllowedRadiusRaw('100px', designSystem), true);
    assert.equal(isAllowedRadiusRaw('9999px', designSystem), true);
    assert.equal(isAllowedRadiusRaw('18px', designSystem), false);

    assert.equal(isAllowedFontSizeRaw('16px', designSystem), true);
    assert.equal(isAllowedFontSizeRaw('1rem', designSystem), true);
    assert.equal(isAllowedFontSizeRaw('0.875rem', designSystem), true);
    assert.equal(isAllowedFontSizeRaw('14px', designSystem), true);
    assert.equal(isAllowedFontSizeRaw('12.5px', designSystem), false);
    assert.equal(isAllowedFontSizeRaw('1.2em', designSystem), true);
    assert.equal(isAllowedFontSizeRaw('var(--text-body)', designSystem), true);

    // Fluid values are judged on their endpoints. This fixture documents 14px,
    // 16px, and the display role's 40px/64px endpoints, so a 2rem (32px) max is
    // off the ramp even though the 1rem min is on it.
    assert.equal(isAllowedFontSizeRaw('clamp(1rem, 2vw, 2rem)', designSystem), false);
    assert.equal(isAllowedFontSizeRaw('clamp(2.5rem, 6vw, 4rem)', designSystem), true);
  });

  it('reads a typography.scale map as literal ramp steps', () => {
    const designSystem = normalizeDesignSystem({
      frontmatter: {
        typography: {
          scale: {
            micro: '0.5625rem', // 9px
            body: '1rem', // 16px
            title: '1.5rem', // 24px
          },
          body: { fontFamily: 'IBM Plex Sans, Arial, sans-serif', fontSize: '1rem' },
        },
      },
    });

    assert.equal(designSystem.hasFontSizes, true);
    assert.equal(isAllowedFontSizeRaw('9px', designSystem), true);
    assert.equal(isAllowedFontSizeRaw('0.5625rem', designSystem), true);
    assert.equal(isAllowedFontSizeRaw('24px', designSystem), true);
    // Off every step by more than the 0.5px tolerance.
    assert.equal(isAllowedFontSizeRaw('0.82rem', designSystem), false);
    assert.equal(isAllowedFontSizeRaw('20px', designSystem), false);
  });

  it('accepts both clamp() endpoints as ramp steps', () => {
    const designSystem = normalizeDesignSystem({
      frontmatter: {
        typography: {
          scale: { body: '1rem' },
          display: { fontFamily: 'Alumni Sans, sans-serif', fontSize: 'clamp(3.4rem, 6.5vw, 5.6rem)' },
        },
      },
    });

    // 3.4rem = 54.4px (min) and 5.6rem = 89.6px (max) are both documented.
    assert.equal(isAllowedFontSizeRaw('3.4rem', designSystem), true);
    assert.equal(isAllowedFontSizeRaw('5.6rem', designSystem), true);
    assert.equal(isAllowedFontSizeRaw('54.4px', designSystem), true);
    assert.equal(isAllowedFontSizeRaw('89.6px', designSystem), true);
    // The vw middle term is viewport-relative, never a fixed step.
    assert.equal(isAllowedFontSizeRaw('6.5px', designSystem), false);
    // An arbitrary size between the endpoints is still off the ramp.
    assert.equal(isAllowedFontSizeRaw('4.2rem', designSystem), false);
  });

  it('validates clamp() endpoints in usage, not just in DESIGN.md', () => {
    const designSystem = normalizeDesignSystem({
      frontmatter: {
        typography: {
          scale: { body: '1rem', title: '1.5rem' }, // 16px, 24px
        },
      },
    });

    // Both endpoints documented.
    assert.equal(isAllowedFontSizeRaw('clamp(1rem, 2vw, 1.5rem)', designSystem), true);
    // Neither endpoint is a step: 23.2px and 28.8px.
    assert.equal(isAllowedFontSizeRaw('clamp(1.45rem, 1.8vw, 1.8rem)', designSystem), false);
    // One bad endpoint is enough.
    assert.equal(isAllowedFontSizeRaw('clamp(1rem, 2vw, 1.8rem)', designSystem), false);
    // The viewport term interpolates and is never judged as a step.
    assert.equal(isAllowedFontSizeRaw('clamp(1rem, 6.5vw, 1.5rem)', designSystem), true);
    // Unjudgeable endpoints abstain rather than guess.
    assert.equal(isAllowedFontSizeRaw('clamp(var(--a), 2vw, 1.5rem)', designSystem), true);
    assert.equal(isAllowedFontSizeRaw('clamp(var(--a), 2vw, var(--b))', designSystem), true);
    // Malformed or unparseable fluid values abstain.
    assert.equal(isAllowedFontSizeRaw('clamp(1.45rem, 1.8vw)', designSystem), true);
    // Non-clamp functional values keep abstaining.
    assert.equal(isAllowedFontSizeRaw('calc(1rem + 3px)', designSystem), true);
    assert.equal(isAllowedFontSizeRaw('var(--text-body)', designSystem), true);
  });

  it("accepts DESIGN.md's own fluid roles when used verbatim in source", () => {
    // The endpoints a fluid role declares are documented sizes, so authoring
    // that exact clamp must not flag. Regression guard for the asymmetry where
    // the extractor read clamp endpoints but the checker never validated them.
    const designSystem = normalizeDesignSystem({
      frontmatter: {
        typography: {
          scale: { body: '1rem' },
          display: { fontFamily: 'Alumni Sans, sans-serif', fontSize: 'clamp(3.4rem, 6.5vw, 5.6rem)' },
        },
      },
    });

    assert.equal(isAllowedFontSizeRaw('clamp(3.4rem, 6.5vw, 5.6rem)', designSystem), true);
    assert.equal(isAllowedFontSizeRaw('clamp(3.4rem, 6.5vw, 6rem)', designSystem), false);
  });

  it('strips CSS priority markers from the font-size ignore value', () => {
    // The ignoreValue is what a `hooks ignore-value` waiver has to match, so a
    // size must not need two different waivers depending on whether the
    // declaration carries !important. font-family already behaves this way.
    const designSystem = normalizeDesignSystem({
      frontmatter: { typography: { scale: { body: '1rem' } } },
    });
    const findings = checkSourceDesignSystem(
      '.a { font-size: 1.4rem !important; }\n.b { font-size: 1.4rem; }',
      '/tmp/important.css',
      { designSystem },
    );
    const sizes = findings.filter((f) => f.antipattern === 'design-system-font-size');
    assert.equal(sizes.length, 2);
    assert.deepEqual(sizes.map((f) => f.ignoreValue), ['1.4rem', '1.4rem']);
  });

  it('reports which fluid endpoint is off the ramp', () => {
    const designSystem = normalizeDesignSystem({
      frontmatter: { typography: { scale: { body: '1rem' } } },
    });
    const findings = checkSourceDesignSystem(
      '.a { font-size: clamp(1.45rem, 1.8vw, 1.8rem) !important; }',
      '/tmp/fluid.css',
      { designSystem },
    );
    const sizes = findings.filter((f) => f.antipattern === 'design-system-font-size');
    assert.equal(sizes.length, 1);
    assert.match(sizes[0].snippet, /1\.45rem/);
    assert.match(sizes[0].snippet, /1\.8rem/);
    assert.equal(sizes[0].ignoreValue, '1.45rem');
  });

  it('does not let clamp() endpoints alone switch the font-size rule on', () => {
    // A fully fluid system enumerates no discrete ramp, so inferring one from
    // clamp endpoints would flag every intermediate size. Keep abstaining.
    const designSystem = normalizeDesignSystem({
      frontmatter: {
        typography: {
          display: { fontFamily: 'Avenir Next, Georgia, serif', fontSize: 'clamp(2.5rem, 6vw, 4rem)' },
          body: { fontFamily: 'IBM Plex Sans, Arial, sans-serif', fontSize: 'clamp(1rem, 2vw, 1.125rem)' },
        },
      },
    });

    assert.equal(designSystem.hasFontSizes, false);
    assert.equal(isAllowedFontSizeRaw('12.5px', designSystem), true);
  });
});

describe('loadDesignSystemForCwd()', () => {
  it('loads DESIGN.md plus .impeccable/design.json and marks stale sidecars', () => {
    const cwd = mkTmp();
    fs.mkdirSync(path.join(cwd, '.impeccable'), { recursive: true });
    const designMd = path.join(cwd, 'DESIGN.md');
    const sidecarJson = path.join(cwd, '.impeccable', 'design.json');

    fs.writeFileSync(designMd, `---
typography:
  body:
    fontFamily: "IBM Plex Sans, Arial, sans-serif"
colors:
  ink: "#241f1a"
rounded:
  "2xl": "80px"
---

# Design System
`);
    fs.writeFileSync(sidecarJson, JSON.stringify({
      extensions: {
        colorMeta: {
          accent: {
            canonical: '#b8422e',
            tonalRamp: ['#d55a42'],
          },
        },
        roundedMeta: {
          lg: { canonical: '24px' },
        },
      },
    }));

    fs.utimesSync(sidecarJson, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    fs.utimesSync(designMd, new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z'));

    const loaded = loadDesignSystemForCwd(cwd);
    assert.equal(loaded.present, true);
    assert.equal(loaded.sourcePath, designMd);
    assert.equal(loaded.sidecarPath, sidecarJson);
    assert.equal(loaded.mdNewerThanJson, true);
    assert.equal(isAllowedColorRaw('#d55a42', loaded), true);
    assert.equal(isAllowedRadiusRaw('80px', loaded), true);
    assert.equal(isAllowedRadiusRaw('24px', loaded), true);
  });
});

describe('checkSourceDesignSystem()', () => {
  it('reports source fonts, literal colors, and radii outside DESIGN.md', () => {
    const designSystem = sampleDesignSystem();
    const findings = checkSourceDesignSystem(`
.good {
  font-family: "IBM Plex Sans", Arial, sans-serif;
  color: #241f1a;
  background: rgba(184, 66, 46, 0.45);
  border-radius: 8px;
}

.bad {
  font-family: "Poppins", sans-serif;
  color: #ff00aa;
  background: rgba(255, 0, 170, 1);
  border-radius: 18px;
}
`, '/tmp/source.css', { designSystem });

    assert.deepEqual(
      findings.map((item) => item.antipattern),
      ['design-system-font', 'design-system-color', 'design-system-color', 'design-system-radius'],
    );
    assert.deepEqual(
      findings.map((item) => item.ignoreValue),
      ['Poppins', '#ff00aa', 'rgba(255, 0, 170, 1)', '18px'],
    );
  });

  it('strips CSS priority markers before checking font-family declarations', () => {
    const designSystem = sampleDesignSystem();
    const findings = checkSourceDesignSystem(`
.good {
  font-family: "IBM Plex Sans", Arial, sans-serif !important;
}

.also-good {
  font-family: "Avenir Next" !important;
}

.bad {
  font-family: "Poppins" !important;
}
`, '/tmp/important.css', { designSystem });

    assert.deepEqual(
      findings.map((item) => item.ignoreValue),
      ['Poppins'],
    );
  });

  it('does not treat issue labels, HTML entities, or font variables as literal design values', () => {
    const designSystem = sampleDesignSystem();
    const findings = checkSourceDesignSystem(`
<a href="https://github.com/example/repo/issues/155">#155</a>
<span class="spread-flow-icon">&#8596;</span>
const MONO = 'SFMono-Regular, Roboto Mono, Consolas, monospace';
const FONT = 'IBM Plex Sans, Arial, sans-serif';
const COLOR_SAMPLE = 'rgba(255, 0, 170, 1)';
const COLOR_NOTE = 'oklch(60% 0.2 20)';
button.innerHTML = \`<span style="font-family:\${labelFont || FONT};">Pick</span>\`;
scale.style.cssText = 'font-family:' + MONO + '; font-size: 10px;';
.demo [style*="background: #fef3c7"] {
  border-color: #ff00aa;
}

.bad {
  font-family: "Poppins", sans-serif;
  color: #cc00ff;
}
`, '/tmp/source.jsx', { designSystem });

    assert.deepEqual(
      findings.map((item) => item.ignoreValue),
      ['10px', '#ff00aa', 'Poppins', '#cc00ff'],
    );
  });

  it('reports literal font sizes outside the DESIGN.md type ramp', () => {
    const designSystem = sampleDesignSystem();
    const source = `.off-ramp {
  font-size: 12.5px;
}
const label = { fontSize: "11px" };
const badge = { className: "text-[10px]" };
/* font-size: 9px; */
.on-ramp {
  font-size: 1rem;
}
`;
    const findings = checkSourceDesignSystem(source, '/tmp/sizes.css', { designSystem });
    const fontSizeFindings = findings.filter((item) => item.antipattern === 'design-system-font-size');

    assert.equal(fontSizeFindings.length, 3);
    assert.deepEqual(
      fontSizeFindings.map((item) => item.ignoreValue),
      ['12.5px', '11px', '10px'],
    );
    assert.deepEqual(
      fontSizeFindings.map((item) => item.line),
      [2, 4, 5],
    );
  });

  it('abstains on font-size checks when DESIGN.md has no literal ramp steps', () => {
    const designSystem = normalizeDesignSystem({
      frontmatter: {
        typography: {
          display: { fontFamily: 'Avenir Next, Georgia, serif', fontSize: 'clamp(2.5rem, 6vw, 4rem)' },
          body: { fontFamily: 'IBM Plex Sans, Arial, sans-serif', fontSize: 'clamp(1rem, 2vw, 1.125rem)' },
        },
      },
    });
    assert.equal(designSystem.hasFontSizes, false);

    const findings = checkSourceDesignSystem('.bad { font-size: 12.5px; }', '/tmp/clamp-only.css', { designSystem });
    assert.equal(findings.some((item) => item.antipattern === 'design-system-font-size'), false);
  });
});

describe('collectStaticDesignSystemFindings()', () => {
  function makeElement(tagName, { text = '', attrs = {}, style = {}, parentElement = null } = {}) {
    return {
      tagName: tagName.toUpperCase(),
      textContent: text,
      parentElement,
      _style: style,
      childNodes: text ? [{ nodeType: 3, textContent: text }] : [],
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
      },
    };
  }

  function makeWindow() {
    const defaults = {
      color: 'rgb(36, 31, 26)',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      borderTopWidth: '0px',
      borderRightWidth: '0px',
      borderBottomWidth: '0px',
      borderLeftWidth: '0px',
      borderTopColor: 'rgb(36, 31, 26)',
      borderRightColor: 'rgb(36, 31, 26)',
      borderBottomColor: 'rgb(36, 31, 26)',
      borderLeftColor: 'rgb(36, 31, 26)',
      outlineWidth: '0px',
      outlineColor: 'rgb(36, 31, 26)',
      borderRadius: '0px',
      display: '',
      visibility: 'visible',
      fontFamily: 'IBM Plex Sans, Arial, sans-serif',
    };
    return {
      getComputedStyle(el) {
        return { ...defaults, ...(el?._style || {}) };
      },
    };
  }

  it('skips non-rendered tags and hidden elements in the static DOM pass', () => {
    const designSystem = sampleDesignSystem();
    const hiddenParent = makeElement('section', { attrs: { hidden: '' } });
    const elements = [
      makeElement('style', {
        text: '.hidden { color: #ff00aa; font-family: Poppins; }',
        style: { color: 'rgb(0, 0, 0)', fontFamily: 'Poppins, sans-serif' },
      }),
      makeElement('script', {
        text: 'const color = "#ff00aa";',
        style: { color: 'rgb(0, 0, 0)', fontFamily: 'Poppins, sans-serif' },
      }),
      makeElement('div', {
        text: 'Hidden Drift',
        parentElement: hiddenParent,
        style: { color: 'rgb(255, 0, 170)', fontFamily: 'Poppins, sans-serif', borderRadius: '18px' },
      }),
      makeElement('div', {
        text: 'Display None Drift',
        style: { display: 'none', color: 'rgb(255, 0, 170)', fontFamily: 'Poppins, sans-serif', borderRadius: '18px' },
      }),
      makeElement('div', {
        text: 'Visible Drift',
        style: { color: 'rgb(255, 0, 170)', fontFamily: 'Poppins, sans-serif', borderRadius: '18px' },
      }),
    ];
    const findings = collectStaticDesignSystemFindings(
      { querySelectorAll: () => elements },
      makeWindow(),
      '/tmp/page.html',
      designSystem,
    );
    const snippets = findings.map(item => item.snippet).join('\n');

    assert.match(snippets, /Visible Drift/);
    assert.doesNotMatch(snippets, /Hidden Drift/);
    assert.doesNotMatch(snippets, /Display None Drift/);
    assert.doesNotMatch(snippets, /\.hidden/);
    assert.doesNotMatch(snippets, /const color/);
  });
});
