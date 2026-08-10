/**
 * The Live chrome inventory has exactly one definition, and it is importable.
 *
 * live-browser.js is served raw as a classic script and cannot import an ES
 * module, which is why the list was once inlined there as a function-scope
 * const. That put it out of reach of every Node consumer: this repo's own
 * tooling, and the private impeccable-site repo, whose Live UI lab fails its
 * build when a surface defined here has no snapshot. That guard is only a guard
 * while it reads Live's real list, so these tests pin both halves: the module
 * stays the definition, and the browser bundle still receives it at runtime.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assembleLiveBrowserScript } from '../skill/scripts/live/browser-script-parts.mjs';
import {
  LIVE_CHROME_MOUNT_CONTRACT,
  LIVE_UI_COMPONENT_IDS,
  LIVE_UI_PREFIX,
  LIVE_UI_SURFACES,
} from '../skill/scripts/live/ui-surfaces.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIVE_BROWSER_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '..', 'skill/scripts/live-browser.js'),
  'utf-8',
);

describe('live UI surfaces module', () => {
  it('exports a non-empty inventory with unique keys', () => {
    assert.ok(LIVE_UI_SURFACES.length > 0);
    const keys = LIVE_UI_SURFACES.map((surface) => surface.key);
    assert.equal(new Set(keys).size, keys.length, 'surface keys must be unique');
    for (const surface of LIVE_UI_SURFACES) {
      assert.equal(typeof surface.key, 'string');
      assert.ok(surface.ids.length > 0, `${surface.key} must own at least one element id`);
    }
  });

  it('builds every id from the canonical prefix', () => {
    for (const id of LIVE_UI_COMPONENT_IDS) {
      assert.ok(id.startsWith(`${LIVE_UI_PREFIX}-`), `${id} must carry the ${LIVE_UI_PREFIX} prefix`);
    }
  });

  it('agrees with the PREFIX live-browser.js hardcodes', () => {
    // live-browser.js cannot import LIVE_UI_PREFIX, so it declares the string
    // itself and every id it creates at runtime is built from that. If the two
    // drift, the inventory names ids that no element on the page ever has.
    const declared = LIVE_BROWSER_SOURCE.match(/const PREFIX = '([^']+)';/);
    assert.ok(declared, 'live-browser.js must declare `const PREFIX = ...`');
    assert.equal(declared[1], LIVE_UI_PREFIX);
  });

  it('is not redefined inside live-browser.js', () => {
    // The list living in two places is the failure this module exists to end.
    assert.doesNotMatch(LIVE_BROWSER_SOURCE, /const LIVE_UI_SURFACES = \[/);
    assert.match(LIVE_BROWSER_SOURCE, /window\.__IMPECCABLE_LIVE_UI_SURFACES__/);
  });
});

describe('live UI surfaces reach the browser bundle', () => {
  const assemble = () => assembleLiveBrowserScript({
    token: 'token-a',
    port: 8421,
    vocabulary: [],
    parts: [{ name: 'browser-ui', file: 'live-browser.js', source: LIVE_BROWSER_SOURCE }],
  });

  it('serializes the canonical inventory into the prelude by default', () => {
    const script = assemble();
    const surfaces = JSON.parse(
      script.match(/window\.__IMPECCABLE_LIVE_UI_SURFACES__ = (\[.*?\]);\n/s)[1],
    );
    assert.deepEqual(surfaces, JSON.parse(JSON.stringify(LIVE_UI_SURFACES)));

    const contract = JSON.parse(
      script.match(/window\.__IMPECCABLE_LIVE_MOUNT_CONTRACT__ = (\[.*?\]);\n/s)[1],
    );
    assert.deepEqual(contract, [...LIVE_CHROME_MOUNT_CONTRACT]);
  });

  it('injects the globals before the script part that reads them', () => {
    const script = assemble();
    assert.ok(
      script.indexOf('window.__IMPECCABLE_LIVE_UI_SURFACES__ =')
        < script.indexOf('impeccable live script part: browser-ui'),
    );
  });
});
