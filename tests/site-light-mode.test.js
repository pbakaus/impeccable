import { describe, test, expect } from 'bun:test';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();

function readFile(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), 'utf-8');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cssBlock(css, selector) {
  const match = css.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([\\s\\S]*?)\\n\\}`));
  return match?.[1] || '';
}

function lightToken(tokensCss, name) {
  const lightBlock = cssBlock(tokensCss, 'html.light');
  const match = lightBlock.match(new RegExp(`--${escapeRegExp(name)}:\\s*([^;]+);`));
  return match?.[1]?.trim() || '';
}

function oklchLightness(value) {
  return Number(value.match(/oklch\(\s*([\d.]+)%/)?.[1]);
}

describe('homepage light mode', () => {
  test('periodic table light override targets the emitted tile class', () => {
    const renderer = readFile('site/scripts/components/framework-viz.js');
    const lightCss = readFile('site/styles/light-mode.css');

    expect(renderer).toContain('ptable-element');
    expect(renderer).not.toContain('ptable-cell');
    expect(lightCss).toMatch(/html\.light \.home-kinpaku #framework-viz-container \.ptable-element \{/);
    expect(lightCss).not.toMatch(/html\.light[\s\S]{0,160}\.ptable-cell/);
  });

  test('periodic table tiles use light surfaces with dark text tokens', () => {
    const lightCss = readFile('site/styles/light-mode.css');
    const tokensCss = readFile('site/styles/kinpaku-tokens.css');

    const stage = cssBlock(lightCss, 'html.light .home-kinpaku .language-view--periodic .solution-visual-interactive');
    const tile = cssBlock(lightCss, 'html.light .home-kinpaku #framework-viz-container .ptable-element');

    expect(stage).toContain('background: var(--ks-lacquer-deep) !important;');
    expect(tile).toContain('background: var(--ks-lacquer-raised) !important;');
    expect(tile).toContain('border-color: var(--ks-rule) !important;');

    expect(oklchLightness(lightToken(tokensCss, 'ks-lacquer-deep'))).toBeGreaterThanOrEqual(90);
    expect(oklchLightness(lightToken(tokensCss, 'ks-lacquer-raised'))).toBeGreaterThanOrEqual(90);
    expect(oklchLightness(lightToken(tokensCss, 'ks-champagne'))).toBeLessThanOrEqual(40);
    expect(oklchLightness(lightToken(tokensCss, 'ks-text-muted'))).toBeLessThanOrEqual(60);
  });
});
