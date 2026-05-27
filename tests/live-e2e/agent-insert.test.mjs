/**
 * Unit tests for insert-mode agent helpers.
 * Run with: node --test tests/live-e2e/agent-insert.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  insertTargetFromEvent,
  createFakeAgent,
} from './agent.mjs';

describe('insertTargetFromEvent', () => {
  it('maps insert.anchor fields to live-insert CLI args', () => {
    const target = insertTargetFromEvent({
      mode: 'insert',
      insert: {
        position: 'after',
        anchor: {
          id: 'features',
          tagName: 'section',
          classes: ['feature-grid'],
          textContent: 'One Two',
        },
      },
    });
    assert.equal(target.position, 'after');
    assert.equal(target.elementId, 'features');
    assert.equal(target.tag, 'section');
    assert.equal(target.classes, 'feature-grid');
    assert.equal(target.text, 'One Two');
  });

  it('defaults position to after when missing', () => {
    const target = insertTargetFromEvent({
      insert: { anchor: { tagName: 'div', classes: ['x'] } },
    });
    assert.equal(target.position, 'after');
    assert.equal(target.tag, 'div');
    assert.equal(target.classes, 'x');
  });
});

describe('createFakeAgent — insert mode', () => {
  it('returns net-new markup without cloning the picked tag', async () => {
    const agent = createFakeAgent();
    const output = await agent.generateVariants(
      { mode: 'insert', count: 3, placeholder: { width: 320, height: 80 } },
      { wrapInfo: { styleMode: 'plain-css', commentSyntax: { open: '{/*', close: '*/}' }, file: 'src/App.jsx' } },
    );
    assert.equal(output.variants.length, 3);
    assert.match(output.variants[0].innerHtml, /inserted-strip/);
    assert.doesNotMatch(output.variants[0].innerHtml, /<h1\b/);
    assert.match(output.scopedCss, /@scope \(\[data-impeccable-variant="1"\]\)/);
    assert.match(output.scopedCss, /\.inserted-copy/);
  });
});
