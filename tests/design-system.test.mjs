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
        display: { fontFamily: 'Avenir Next, Georgia, serif' },
        body: { fontFamily: 'IBM Plex Sans, Arial, sans-serif' },
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
      ['#ff00aa', 'Poppins', '#cc00ff'],
    );
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
