import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const REPO_ROOT = process.cwd();
const SCRIPT = join(REPO_ROOT, 'skill/scripts/live-browser-dom.js');

function createAppendTarget() {
  return {
    children: [],
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
  };
}

function createElement({
  id = '',
  tagName = 'DIV',
  classList = [],
  rect = { x: 0, y: 0, top: 0, left: 0, right: 40, bottom: 30, width: 40, height: 30 },
  closestResult = null,
} = {}) {
  const listeners = {};
  const styleCalls = [];
  return {
    nodeType: 1,
    id,
    tagName,
    classList,
    listeners,
    styleCalls,
    style: {
      setProperty(...args) { styleCalls.push(args); },
    },
    closest() { return closestResult; },
    getBoundingClientRect() { return rect; },
    addEventListener(type, handler) { listeners[type] = handler; },
  };
}

function createDocument() {
  const elementsById = new Map();
  const body = createAppendTarget();
  const head = createAppendTarget();
  return {
    body,
    head,
    activeElement: null,
    elementsById,
    getElementById(id) { return elementsById.get(id) || null; },
  };
}

function loadFactory(doc = createDocument(), extras = {}) {
  const context = {
    document: doc,
    window: {},
    globalThis: {},
    console,
    CSS: extras.CSS,
    crypto: extras.crypto,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(SCRIPT, 'utf-8'), context, { filename: SCRIPT });
  return { context, createHelpers: context.__IMPECCABLE_LIVE_DOM__.createLiveBrowserDomHelpers };
}

describe('live-browser-dom helpers', () => {
  it('detects owned chrome and pickable page elements', () => {
    const doc = createDocument();
    const { createHelpers } = loadFactory(doc);
    const helpers = createHelpers({ prefix: 'impeccable-live', skipTags: new Set(['script']) });

    assert.equal(helpers.own(createElement({ id: 'impeccable-live-bar' })), true);
    assert.ok(helpers.own(createElement({ closestResult: createElement({ id: 'impeccable-live-root' }) })));
    assert.equal(helpers.pickable(createElement({ tagName: 'SCRIPT' })), false);
    assert.equal(helpers.pickable(createElement({ rect: { width: 12, height: 30 } })), false);
    assert.equal(helpers.pickable(createElement({ tagName: 'BUTTON' })), true);
  });

  it('mounts chrome in the configured live UI root and styles in head by default', () => {
    const doc = createDocument();
    const { context, createHelpers } = loadFactory(doc);
    const helpers = createHelpers({ prefix: 'impeccable-live', document: doc });
    const uiRoot = createAppendTarget();
    context.__IMPECCABLE_LIVE_UI_ROOT__ = uiRoot;

    const el = {};
    const styleInRoot = {};
    helpers.uiAppend(el);
    helpers.uiAppendStyle(styleInRoot);
    assert.deepEqual(uiRoot.children, [el, styleInRoot]);

    context.__IMPECCABLE_LIVE_UI_ROOT__ = null;
    const styleInHead = {};
    helpers.uiAppendStyle(styleInHead);
    assert.deepEqual(doc.head.children, [styleInHead]);
  });

  it('escapes ids while looking inside the live UI root before document fallback', () => {
    const doc = createDocument();
    const rootHit = {};
    const documentHit = {};
    doc.elementsById.set('fallback', documentHit);
    const { context, createHelpers } = loadFactory(doc, { CSS: { escape: (id) => 'escaped-' + id } });
    context.__IMPECCABLE_LIVE_UI_ROOT__ = {
      appendChild() {},
      getElementById() { return null; },
      querySelector(selector) {
        assert.equal(selector, '#escaped-a.b');
        return rootHit;
      },
    };
    const helpers = createHelpers({ prefix: 'impeccable-live', document: doc, css: context.CSS });

    assert.equal(helpers.uiGetById('a.b'), rootHit);
    context.__IMPECCABLE_LIVE_UI_ROOT__ = null;
    assert.equal(helpers.uiGetById('fallback'), documentHit);
  });

  it('freezes usable anchors and follows nested shadow active elements', () => {
    const doc = createDocument();
    const inner = { id: 'inner' };
    doc.activeElement = { shadowRoot: { activeElement: { shadowRoot: { activeElement: inner } } } };
    const { createHelpers } = loadFactory(doc);
    const helpers = createHelpers({ prefix: 'impeccable-live', document: doc });
    const anchor = createElement({ id: 'hero', tagName: 'SECTION', classList: ['hero'] });

    const frozen = helpers.makeFrozenAnchor(anchor);
    assert.equal(frozen.__impeccableFrozenAnchor, true);
    assert.equal(frozen.id, 'hero');
    assert.equal(frozen.classList[0], 'hero');
    assert.equal(frozen.getBoundingClientRect().width, 40);
    assert.equal(helpers.makeFrozenAnchor(createElement({ rect: { width: 0, height: 30 } })), null);
    assert.equal(helpers.activeElementDeep(), inner);
  });

  it('defangs modal outside handlers on live chrome roots', () => {
    const { createHelpers } = loadFactory();
    const helpers = createHelpers({ prefix: 'impeccable-live' });
    const root = createElement();
    let stopped = 0;

    helpers.defangOutsideHandlers(root);
    assert.deepEqual(root.styleCalls[0], ['pointer-events', 'auto', 'important']);
    root.listeners.pointerdown({ stopPropagation: () => { stopped += 1; } });
    root.listeners.mousedown({ stopPropagation: () => { stopped += 1; } });
    root.listeners.focusin({ stopPropagation: () => { stopped += 1; } });
    assert.equal(stopped, 3);
  });
});
