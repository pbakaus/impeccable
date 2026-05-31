/**
 * Tests for live-sveltekit-adapter.mjs.
 * Run with: node --test tests/live-sveltekit-adapter.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SVELTE_LIVE_ROOT_COMPONENT,
  applySvelteKitLiveAdapter,
  buildSvelteLiveRootComponent,
  detectSvelteKitProject,
  patchSvelteLayout,
  removeSvelteKitLiveAdapter,
  unpatchSvelteLayout,
} from '../skill/scripts/live-sveltekit-adapter.mjs';

describe('live-sveltekit-adapter', () => {
  let tmp;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'impeccable-sveltekit-adapter-'));
    mkdirSync(join(tmp, 'src/routes'), { recursive: true });
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({
      devDependencies: {
        '@sveltejs/kit': '^2.0.0',
        svelte: '^5.0.0',
      },
    }));
    writeFileSync(join(tmp, 'svelte.config.js'), 'export default { kit: {} };\n');
    writeFileSync(join(tmp, 'src/app.html'), `<!DOCTYPE html>
<html>
  <head>%sveltekit.head%</head>
  <body><div>%sveltekit.body%</div></body>
</html>
`);
    writeFileSync(join(tmp, 'src/routes/+layout.svelte'), `<script>
  let { children } = $props();
</script>

{@render children?.()}
`);
  });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('detects SvelteKit from package/config/app.html signals', () => {
    const detected = detectSvelteKitProject(tmp, { files: ['src/app.html'] });
    assert.equal(detected.appHtml, 'src/app.html');
    assert.equal(detected.layoutFile, 'src/routes/+layout.svelte');
  });

  it('patches +layout.svelte and leaves src/app.html untouched', () => {
    const appBefore = readFileSync(join(tmp, 'src/app.html'), 'utf-8');
    const result = applySvelteKitLiveAdapter({
      cwd: tmp,
      port: 9911,
      config: { files: ['src/app.html'] },
    });

    assert.equal(result.adapter, 'sveltekit');
    assert.equal(result.appHtmlUntouched, true);
    assert.equal(readFileSync(join(tmp, 'src/app.html'), 'utf-8'), appBefore);

    const layout = readFileSync(join(tmp, 'src/routes/+layout.svelte'), 'utf-8');
    assert.match(layout, /ImpeccableLiveRoot/);
    assert.match(layout, /impeccable-live-svelte-start/);
    assert.match(layout, /\{@render children\?\.\(\)\}/);

    const root = readFileSync(join(tmp, SVELTE_LIVE_ROOT_COMPONENT), 'utf-8');
    assert.match(root, /attachShadow\(\{ mode: 'open' \}\)/);
    assert.match(root, /__IMPECCABLE_LIVE_UI_ROOT__/);
    assert.match(root, /__IMPECCABLE_LIVE_CHROME_MOUNT__/);
    assert.match(root, /impeccable-live-root/);
    assert.match(root, /host\.style\.setProperty\('width', '0', 'important'\)/);
    assert.match(root, /host\.style\.setProperty\('height', '0', 'important'\)/);
    assert.match(root, /host\.style\.setProperty\('overflow', 'visible', 'important'\)/);
    assert.doesNotMatch(root, /host\.style\.setProperty\('width', '100vw', 'important'\)/);
    assert.match(root, /http:\/\/localhost:9911\/live\.js/);
  });

  it('removes the layout patch and generated root component', () => {
    applySvelteKitLiveAdapter({
      cwd: tmp,
      port: 9911,
      config: { files: ['src/app.html'] },
    });
    const result = removeSvelteKitLiveAdapter({ cwd: tmp, config: { files: ['src/app.html'] } });

    assert.equal(result.adapter, 'sveltekit');
    assert.equal(result.removed, true);
    assert.doesNotMatch(readFileSync(join(tmp, 'src/routes/+layout.svelte'), 'utf-8'), /ImpeccableLiveRoot/);
    assert.equal(existsSync(join(tmp, SVELTE_LIVE_ROOT_COMPONENT)), false);
  });

  it('patches Svelte 4 slot layouts without duplicating on rerun', () => {
    const before = `<main>
  <slot />
</main>
`;
    const once = patchSvelteLayout(before);
    const twice = patchSvelteLayout(once);

    assert.equal(once, twice);
    assert.match(once, /<ImpeccableLiveRoot \/>[\s\S]*<slot \/>/);
    assert.equal(unpatchSvelteLayout(once).trim(), before.trim());
  });

  it('keeps generated adapter component free of live chrome labels', () => {
    const root = buildSvelteLiveRootComponent(9911);
    for (const label of ['Edit copy', 'Accept', 'Discard', 'Pick', 'Insert', 'Go', 'Tune']) {
      assert.doesNotMatch(root, new RegExp(label), `Svelte adapter must not define ${label} UI`);
    }
  });
});
