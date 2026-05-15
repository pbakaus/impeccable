import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const REPO_ROOT = process.cwd();
const SCRIPT = join(REPO_ROOT, 'skill/scripts/live-text-rows.js');

function loadCollector() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const context = {
    window: dom.window,
    globalThis: dom.window,
    document: dom.window.document,
    console,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(SCRIPT, 'utf-8'), context);
  return {
    dom,
    collect: dom.window.__IMPECCABLE_LIVE_TEXT_ROWS__.collectEditableTextRows,
  };
}

function setBody(dom, html) {
  dom.window.document.body.innerHTML = html;
  return dom.window.document.body.firstElementChild;
}

describe('collectEditableTextRows', () => {
  it('pure-text root emits a single root row', () => {
    const { dom, collect } = loadCollector();
    const root = setBody(dom, '<div>Hello</div>');
    const rows = collect(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ref, 'div');
    assert.equal(rows[0].text, 'Hello');
    assert.equal(rows[0].textNodes.length, 1);
  });

  it('two siblings of same tag get 1-indexed refs', () => {
    const { dom, collect } = loadCollector();
    const root = setBody(dom, '<div><p>A</p><p>B</p><h2>C</h2></div>');
    const rows = collect(root);
    assert.deepEqual(rows.map((r) => r.ref), ['div>p.1', 'div>p.2', 'div>h2.1']);
    assert.deepEqual(rows.map((r) => r.text), ['A', 'B', 'C']);
  });

  it('mixed-content parent emits no row, descends into leaves', () => {
    const { dom, collect } = loadCollector();
    const root = setBody(dom, '<p>Hello <em>world</em></p>');
    const rows = collect(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ref, 'p>em.1');
    assert.equal(rows[0].text, 'world');
  });

  it('button with nested span only emits the span row', () => {
    const { dom, collect } = loadCollector();
    const root = setBody(dom, '<button><span>Save</span></button>');
    const rows = collect(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ref, 'button>span.1');
    assert.equal(rows[0].text, 'Save');
  });

  it('whitespace-only direct text is ignored', () => {
    const { dom, collect } = loadCollector();
    const root = setBody(dom, '<div>   \n  </div>');
    const rows = collect(root);
    assert.equal(rows.length, 0);
  });

  it('script subtree skipped + parent with element child does not emit', () => {
    const { dom, collect } = loadCollector();
    const root = setBody(dom, '<div>x<script>alert(1)</script>z</div>');
    const rows = collect(root);
    assert.equal(rows.length, 0);
  });

  it('contenteditable element is skipped entirely', () => {
    const { dom, collect } = loadCollector();
    const root = setBody(dom, '<div><p contenteditable="true">edit me</p><p>plain</p></div>');
    const rows = collect(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ref, 'div>p.2');
    assert.equal(rows[0].text, 'plain');
  });

  it('deeply nested pure-text descendant emits with parent>tag.N', () => {
    const { dom, collect } = loadCollector();
    const root = setBody(dom, '<section><article><p>copy</p></article></section>');
    const rows = collect(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ref, 'article>p.1');
    assert.equal(rows[0].text, 'copy');
  });

  it('isOwn hook skips Impeccable chrome inside the subtree', () => {
    const { dom, collect } = loadCollector();
    const root = setBody(
      dom,
      '<div><p>real</p><div id="impeccable-live-bar"><p>chrome</p></div></div>'
    );
    const isOwn = (el) => !!(el.id && el.id.indexOf('impeccable-live') === 0);
    const rows = collect(root, { isOwn });
    assert.deepEqual(rows.map((r) => r.text), ['real']);
  });

  it('returns empty array for non-element input', () => {
    const { collect } = loadCollector();
    assert.deepEqual(collect(null), []);
    assert.deepEqual(collect(undefined), []);
  });

  it('multiple direct text nodes are concatenated', () => {
    const { dom, collect } = loadCollector();
    const doc = dom.window.document;
    const p = doc.createElement('p');
    p.appendChild(doc.createTextNode('foo '));
    p.appendChild(doc.createTextNode('bar'));
    doc.body.innerHTML = '';
    doc.body.appendChild(p);
    const rows = collect(p);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, 'foo bar');
    assert.equal(rows[0].textNodes.length, 2);
  });
});
