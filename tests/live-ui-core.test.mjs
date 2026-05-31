/**
 * Tests for the framework-neutral live chrome contract.
 * Run with: node --test tests/live-ui-core.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIVE_CHROME_MOUNT_CONTRACT,
  LIVE_UI_COMPONENT_IDS,
  LIVE_UI_SURFACES,
  activeElementDeep,
  appendStyleToLiveUiRoot,
  appendToLiveUiRoot,
  getLiveUiElementById,
  resolveLiveUiRoot,
} from '../skill/scripts/live-ui-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_FILE = join(__dirname, '..', 'skill', 'scripts', 'live-ui-core.mjs');

class FakeNode {
  constructor(id = '') {
    this.id = id;
    this.children = [];
    this.parent = null;
  }
  appendChild(child) {
    this.children.push(child);
    child.parent = this;
    return child;
  }
  getElementById(id) {
    if (this.id === id) return this;
    for (const child of this.children) {
      const found = child.getElementById?.(id);
      if (found) return found;
    }
    return null;
  }
  querySelector(selector) {
    if (!selector.startsWith('#')) return null;
    return this.getElementById(selector.slice(1));
  }
}

describe('live-ui-core contract', () => {
  it('defines the adapter-neutral mount contract', () => {
    assert.deepEqual(LIVE_CHROME_MOUNT_CONTRACT, ['root', 'transport', 'state', 'actions']);
  });

  it('inventories every live-mode chrome surface expected by the audit', () => {
    const keys = LIVE_UI_SURFACES.map((surface) => surface.key);
    for (const key of [
      'global-bottom-bar',
      'pending-copy-edit-dock',
      'element-selection-chrome',
      'action-picker',
      'edit-chrome',
      'generating-row',
      'variant-cycling-row',
      'variant-params-panel',
      'saving-confirmed-rows',
      'insert-mode-chrome',
      'annotation-chrome',
      'design-system-panel',
      'toasts-and-errors',
      'css-isolation-boundary',
    ]) {
      assert.ok(keys.includes(key), `missing live UI inventory key ${key}`);
    }
    assert.ok(LIVE_UI_COMPONENT_IDS.includes('impeccable-live-global-bar'));
    assert.ok(LIVE_UI_COMPONENT_IDS.includes('impeccable-live-bar'));
    assert.ok(LIVE_UI_COMPONENT_IDS.includes('impeccable-live-params-panel'));
    assert.ok(LIVE_UI_COMPONENT_IDS.includes('impeccable-live-root'));
  });

  it('contains no Svelte imports and no React assumptions', () => {
    const source = readFileSync(CORE_FILE, 'utf-8');
    assert.doesNotMatch(source, /from ['"]svelte|@sveltejs|\$app\/environment/);
    assert.doesNotMatch(source, /from ['"]react|ReactDOM|createRoot|jsx/);
  });

  it('mounts into a provided plain shadow-like root', () => {
    const body = new FakeNode('body');
    const head = new FakeNode('head');
    const shadow = new FakeNode('shadow-root');
    const env = { document: { body, head, getElementById: (id) => body.getElementById(id) }, __IMPECCABLE_LIVE_UI_ROOT__: shadow };

    const el = new FakeNode('impeccable-live-bar');
    appendToLiveUiRoot(el, env);
    assert.equal(shadow.children[0], el);
    assert.equal(resolveLiveUiRoot(env), shadow);
    assert.equal(getLiveUiElementById('impeccable-live-bar', env), el);

    const style = new FakeNode('impeccable-live-bar-focus-style');
    appendStyleToLiveUiRoot(style, env);
    assert.equal(shadow.children[1], style);
    assert.equal(head.children.length, 0);
  });

  it('falls back to document body/head for non-adapter DOM mounting', () => {
    const body = new FakeNode('body');
    const head = new FakeNode('head');
    const env = { document: { body, head, getElementById: (id) => body.getElementById(id) } };

    appendToLiveUiRoot(new FakeNode('impeccable-live-toast'), env);
    appendStyleToLiveUiRoot(new FakeNode('impeccable-live-keyframes'), env);

    assert.equal(body.children[0].id, 'impeccable-live-toast');
    assert.equal(head.children[0].id, 'impeccable-live-keyframes');
  });

  it('walks through open shadow active elements', () => {
    const input = { id: 'impeccable-live-input' };
    const host = { shadowRoot: { activeElement: input } };
    assert.equal(activeElementDeep({ activeElement: host }), input);
  });
});
