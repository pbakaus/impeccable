/**
 * Tests for design-parser.mjs — frontmatter + body extraction.
 * Run with: node --test tests/design-parser.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDesignMd } from '../skill/scripts/design-parser.mjs';

describe('parseDesignMd frontmatter branch', () => {
  it('returns null frontmatter when the file has no YAML header', () => {
    const md = `# Design System: Demo

## 1. Overview

Some prose.
`;
    const model = parseDesignMd(md);
    assert.equal(model.schemaVersion, 2);
    assert.equal(model.frontmatter, null);
    assert.equal(model.title, 'Design System: Demo');
  });

  it('parses a Stitch-shaped frontmatter and strips it from the body', () => {
    const md = `---
name: Demo System
description: A quiet editorial look.
colors:
  primary: "#b8422e"
  neutral-bg: "#faf7f2"
typography:
  display:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontWeight: 300
    lineHeight: 1
  body:
    fontFamily: "Inter, sans-serif"
rounded:
  sm: "4px"
  md: "8px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-bg}"
    rounded: "{rounded.sm}"
---

# Design System: Demo

## 1. Overview

Opening prose.
`;
    const model = parseDesignMd(md);
    assert.equal(model.schemaVersion, 2);
    assert.equal(model.title, 'Design System: Demo');
    assert.ok(model.frontmatter);
    assert.equal(model.frontmatter.name, 'Demo System');
    assert.equal(model.frontmatter.description, 'A quiet editorial look.');
    assert.equal(model.frontmatter.colors.primary, '#b8422e');
    assert.equal(model.frontmatter.colors['neutral-bg'], '#faf7f2');
    assert.equal(model.frontmatter.typography.display.fontFamily, 'Cormorant Garamond, Georgia, serif');
    assert.equal(model.frontmatter.typography.display.fontWeight, 300);
    assert.equal(model.frontmatter.typography.display.lineHeight, 1);
    assert.equal(model.frontmatter.rounded.md, '8px');
    assert.equal(model.frontmatter.components['button-primary'].backgroundColor, '{colors.primary}');
  });

  it('recovers gracefully when frontmatter has no closing marker', () => {
    // No `---` terminator: the whole file is treated as body, not partial
    // frontmatter. The H1 title still resolves from the body.
    const md = `---
this is not valid yaml : : :
no closing marker
# Design System: Broken

## 1. Overview

Prose.
`;
    const model = parseDesignMd(md);
    assert.equal(model.frontmatter, null);
    assert.equal(model.title, 'Design System: Broken');
  });

  it('ignores line-only comments but preserves unquoted hex values', () => {
    const md = `---
# Top-level comment
colors:
  primary: #b8422e
  # mid-block comment
  accent: "#ec4899"
---

# Design System: Commented

## 1. Overview

Prose.
`;
    const model = parseDesignMd(md);
    assert.equal(model.frontmatter.colors.primary, '#b8422e');
    assert.equal(model.frontmatter.colors.accent, '#ec4899');
  });
});
