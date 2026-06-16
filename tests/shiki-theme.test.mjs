import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadDesignSystemForCwd, isAllowedColorRaw } from '../cli/engine/design-system.mjs';
import { parseAnyColor } from '../cli/engine/rules/checks.mjs';
import { impeccableShikiThemes } from '../site/lib/impeccable-shiki-theme.mjs';

function relativeLuminance({ r, g, b }) {
  const channel = value => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (0.2126 * channel(r)) + (0.7152 * channel(g)) + (0.0722 * channel(b));
}

function contrastRatio(a, b) {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function themeForegrounds(theme) {
  const colors = new Set([theme.colors['editor.foreground']]);
  for (const token of theme.tokenColors || []) {
    if (token.settings?.foreground) colors.add(token.settings.foreground);
  }
  return [...colors];
}

describe('impeccable Shiki themes', () => {
  it('only use colors from DESIGN.md and the sidecar ramps', () => {
    const designSystem = loadDesignSystemForCwd(process.cwd());
    assert.ok(designSystem?.present, 'DESIGN.md should be available for docs theme validation');

    for (const [mode, theme] of Object.entries(impeccableShikiThemes)) {
      const colors = new Set([
        theme.colors['editor.background'],
        theme.colors['editor.foreground'],
        ...themeForegrounds(theme),
      ]);

      for (const color of colors) {
        assert.ok(isAllowedColorRaw(color, designSystem), `${mode} Shiki color ${color} is not in DESIGN.md`);
      }
    }
  });

  it('keeps every token foreground at AA contrast against its code block background', () => {
    for (const [mode, theme] of Object.entries(impeccableShikiThemes)) {
      const background = parseAnyColor(theme.colors['editor.background']);
      assert.ok(background, `${mode} code background should parse`);

      for (const foregroundValue of themeForegrounds(theme)) {
        const foreground = parseAnyColor(foregroundValue);
        assert.ok(foreground, `${mode} foreground ${foregroundValue} should parse`);

        const ratio = contrastRatio(foreground, background);
        assert.ok(
          ratio >= 4.5,
          `${mode} foreground ${foregroundValue} only has ${ratio.toFixed(2)}:1 contrast`,
        );
      }
    }
  });
});
