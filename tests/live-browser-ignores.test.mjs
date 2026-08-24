import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO_ROOT, 'skill/scripts/live-browser-ignores.js');

// Evaluated in the test realm (not a vm context) so the arrays the resolver
// returns share this realm's prototypes and deepEqual compares them plainly.
function loadIgnoresApi() {
  const source = readFileSync(SCRIPT, 'utf-8');
  const factory = vm.runInThisContext(
    `(function (window) {\n${source}\nreturn window.__IMPECCABLE_LIVE_IGNORES__;\n})`,
    { filename: SCRIPT },
  );
  return factory({});
}

const resolve = loadIgnoresApi().resolveDetectIgnores;

const EMPTY = { disabledRules: [], disabledValues: [] };

describe('live-browser-ignores resolver', () => {
  it('registers a versioned API on the root', () => {
    const api = loadIgnoresApi();
    assert.equal(api.version, 1);
    assert.equal(typeof api.resolveDetectIgnores, 'function');
  });

  it('degrades to an empty filter when the config global is missing or malformed', () => {
    assert.deepEqual(resolve(), EMPTY);
    assert.deepEqual(resolve({ ignores: undefined, pathname: '/index.html' }), EMPTY);
    assert.deepEqual(resolve({ ignores: null, pathname: '/index.html' }), EMPTY);
    assert.deepEqual(resolve({ ignores: 'nonsense', pathname: '/index.html' }), EMPTY);
    assert.deepEqual(resolve({ ignores: {}, pathname: '/index.html' }), EMPTY);
  });

  it('does not spread a string ignoreRules into characters', () => {
    // `"ignoreRules": "foo"` in a hand-edited config must disable nothing,
    // not look like it disabled three one-letter rules.
    const out = resolve({ ignores: { ignoreRules: 'foo' }, pathname: '/index.html' });
    assert.deepEqual(out, EMPTY);
  });

  it('forwards ignoreRules normalized and deduplicated', () => {
    const out = resolve({
      ignores: { ignoreRules: ['Dark-Glow', 'dark-glow', ' gradient-text ', '', 42, null] },
      pathname: '/index.html',
    });
    assert.deepEqual(out.disabledRules, ['dark-glow', 'gradient-text']);
  });

  it('forwards unscoped value entries and drops malformed ones', () => {
    const out = resolve({
      ignores: {
        ignoreValues: [
          { rule: 'overused-font', value: 'Geist+Mono' },
          null,
          'not-an-entry',
          { rule: '', value: 'x' },
          { rule: 'overused-font', value: '' },
        ],
      },
      pathname: '/index.html',
    });
    assert.deepEqual(out.disabledValues, [{ rule: 'overused-font', value: 'geist mono' }]);
  });

  it('applies wildcard entries only on pages their globs name', () => {
    const ignores = {
      roots: ['prototype/'],
      ignoreValues: [
        { rule: 'dark-glow', value: '*', files: ['prototype/attack-the-soc.html'] },
      ],
    };
    const onPage = resolve({ ignores, pathname: '/attack-the-soc.html' });
    assert.deepEqual(onPage.disabledRules, ['dark-glow']);
    const elsewhere = resolve({ ignores, pathname: '/index.html' });
    assert.deepEqual(elsewhere.disabledRules, []);
  });

  it('never applies an unscoped wildcard entry, matching the CLI', () => {
    // isIgnoredFindingValue in cli/lib/impeccable-config.mjs returns false
    // for a wildcard entry with no files; project-wide suppression is
    // ignoreRules' job.
    const out = resolve({
      ignores: { ignoreValues: [{ rule: 'dark-glow', value: '*' }] },
      pathname: '/index.html',
    });
    assert.deepEqual(out, EMPTY);
  });

  it('drops scoped value entries on pages outside their globs', () => {
    const ignores = {
      roots: ['prototype/'],
      ignoreValues: [
        { rule: 'overused-font', value: 'geist mono', files: ['prototype/mgmt-demo.html'] },
      ],
    };
    const onPage = resolve({ ignores, pathname: '/mgmt-demo.html' });
    assert.deepEqual(onPage.disabledValues, [{ rule: 'overused-font', value: 'geist mono' }]);
    const elsewhere = resolve({ ignores, pathname: '/index.html' });
    assert.deepEqual(elsewhere.disabledValues, []);
  });

  it('does not lend one entry\'s glob prefix to other pages', () => {
    // The trap from issue #639: prefixes come only from `roots`, never from
    // the ignore globs themselves. An entry scoped to prototype/library/**
    // must not suppress on prototype/index.html.
    const ignores = {
      roots: ['prototype/'],
      ignoreValues: [
        { rule: 'em-dash-overuse', value: '*', files: ['prototype/library/**'] },
      ],
    };
    const inside = resolve({ ignores, pathname: '/library/buttons.html' });
    assert.deepEqual(inside.disabledRules, ['em-dash-overuse']);
    const outside = resolve({ ignores, pathname: '/index.html' });
    assert.deepEqual(outside.disabledRules, []);
  });

  it('resolves root and directory URLs to their index file', () => {
    const ignores = {
      roots: ['prototype/'],
      ignoreValues: [
        { rule: 'dark-glow', value: '*', files: ['prototype/index.html'] },
        { rule: 'gradient-text', value: '*', files: ['prototype/news/index.html'] },
      ],
    };
    assert.deepEqual(resolve({ ignores, pathname: '/' }).disabledRules, ['dark-glow']);
    assert.deepEqual(resolve({ ignores, pathname: '/news/' }).disabledRules, ['gradient-text']);
  });

  it('matches path suffixes like the CLI scoped-file matcher', () => {
    // findingMatchesScopedIgnoreFile tries every path suffix of the finding's
    // file, so `library/**` written without the prototype/ prefix still
    // scopes to the library pages.
    const ignores = {
      roots: ['prototype/'],
      ignoreValues: [
        { rule: 'em-dash-overuse', value: '*', files: ['library/**'] },
        { rule: 'dark-glow', value: '*', files: ['buttons.html'] },
      ],
    };
    const out = resolve({ ignores, pathname: '/library/buttons.html' });
    assert.deepEqual(out.disabledRules.sort(), ['dark-glow', 'em-dash-overuse']);
  });

  it('supports the CLI glob dialect, including alternation', () => {
    const ignores = {
      roots: ['prototype/'],
      ignoreValues: [
        { rule: 'dark-glow', value: '*', files: ['prototype/{index,about}.html'] },
        { rule: 'gradient-text', value: '*', files: ['prototype/page-?.html'] },
      ],
    };
    assert.deepEqual(resolve({ ignores, pathname: '/about.html' }).disabledRules, ['dark-glow']);
    assert.deepEqual(resolve({ ignores, pathname: '/page-3.html' }).disabledRules, ['gradient-text']);
    assert.deepEqual(resolve({ ignores, pathname: '/page-33.html' }).disabledRules, []);
  });

  it('treats glob metacharacters in filenames literally', () => {
    const ignores = {
      ignoreValues: [
        { rule: 'dark-glow', value: '*', files: ['pricing (v2).html'] },
      ],
    };
    const out = resolve({ ignores, pathname: '/pricing (v2).html' });
    assert.deepEqual(out.disabledRules, ['dark-glow']);
    const near = resolve({ ignores, pathname: '/pricing xv2y.html' });
    assert.deepEqual(near.disabledRules, []);
  });

  it('accepts a single `file` string alongside `files`', () => {
    const out = resolve({
      ignores: {
        ignoreValues: [{ rule: 'dark-glow', value: '*', file: 'index.html' }],
      },
      pathname: '/index.html',
    });
    assert.deepEqual(out.disabledRules, ['dark-glow']);
  });

  it('asserts no prefix when the configured roots share no common ancestor', () => {
    // With src/**/*.html and public/**/*.html both configured, no single
    // document root maps /foo.html to a unique project file, so no prefix
    // is asserted. A waiver naming src/foo.html must not hide a finding on
    // a page served from public/foo.html; ambiguity resolves to showing
    // the finding. Bare-path spellings still apply whichever root serves it.
    const ignores = {
      roots: ['src/', 'public/'],
      ignoreValues: [
        { rule: 'dark-glow', value: '*', files: ['src/foo.html'] },
        { rule: 'clipped-overflow-container', value: '*', files: ['src/foo.html', 'public/foo.html'] },
        { rule: 'em-dash-overuse', value: '*', files: ['foo.html'] },
        { rule: 'gradient-text', value: '*', files: ['**/foo.html'] },
      ],
    };
    const out = resolve({ ignores, pathname: '/foo.html' });
    assert.deepEqual(out.disabledRules.sort(), ['em-dash-overuse', 'gradient-text']);
  });

  it('reduces nested roots to their common ancestor so normal waivers keep applying', () => {
    // Globs at two depths in one tree (prototype/*.html plus
    // prototype/library/**/*.html) derive the prefixes prototype/ and
    // prototype/library/. Those are not alternative identities: one server
    // serves both, so the document root sits at their common ancestor and
    // a project-relative waiver like prototype/index.html must apply.
    const ignores = {
      roots: ['prototype/', 'prototype/library/'],
      ignoreValues: [
        { rule: 'dark-glow', value: '*', files: ['prototype/index.html'] },
        { rule: 'em-dash-overuse', value: '*', files: ['prototype/library/**'] },
      ],
    };
    assert.deepEqual(
      resolve({ ignores, pathname: '/index.html' }).disabledRules,
      ['dark-glow'],
    );
    assert.deepEqual(
      resolve({ ignores, pathname: '/library/buttons.html' }).disabledRules,
      ['em-dash-overuse'],
    );
  });

  it('survives malformed roots and percent-escapes without throwing', () => {
    const out = resolve({
      ignores: {
        roots: 7,
        ignoreRules: ['dark-glow'],
        ignoreValues: [{ rule: 'gradient-text', value: '*', files: ['broken%.html'] }],
      },
      pathname: '/broken%.html',
    });
    assert.deepEqual(out.disabledRules.sort(), ['dark-glow', 'gradient-text']);
  });
});
