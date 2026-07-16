import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createLiveSessionStore } from '../skill/scripts/live/session-store.mjs';
import {
  prepareGenerationArtifact,
  publishGenerationArtifact,
} from '../skill/scripts/live/generation-publisher.mjs';
import {
  inlineVueComponentAccept,
  nuxtViteFsModulePath,
  removeAllVueComponentSessions,
  scaffoldVueComponentSession,
} from '../skill/scripts/live/vue-component.mjs';

describe('Nuxt Vue component preview', () => {
  let tmp;
  let source;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'impeccable-vue-component-'));
    source = join(tmp, 'app', 'pages', 'index.vue');
    mkdirSync(join(tmp, 'app', 'pages'), { recursive: true });
    writeFileSync(join(tmp, 'nuxt.config.ts'), 'export default defineNuxtConfig({ ssr: false });\n');
    writeFileSync(source, [
      '<template>',
      '  <main>',
      '    <h1 class="hero-title">Hello {{ user.name }}</h1>',
      '  </main>',
      '</template>',
      '',
      '<style scoped>',
      '.hero-title { font-size: 2rem; }',
      '</style>',
      '',
    ].join('\n'));
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('stages real Vue SFCs without rewriting the active route', () => {
    const before = readFileSync(source, 'utf-8');
    const result = scaffoldVueComponentSession({
      id: 'vue12345',
      count: 3,
      sourceFile: 'app/pages/index.vue',
      sourceStartLine: 3,
      sourceEndLine: 3,
      originalLines: ['    <h1 class="hero-title">Hello {{ user.name }}</h1>'],
      cwd: tmp,
    });

    assert.equal(readFileSync(source, 'utf-8'), before);
    assert.equal(result.manifest.previewMode, 'vue-component');
    assert.equal(result.manifest.componentExtension, 'vue');
    assert.match(result.manifestFile, /^app\/\.impeccable-live\/vue12345\/manifest\.json$/);
    const variant = readFileSync(join(tmp, result.componentDir, 'v1.vue'), 'utf-8');
    assert.match(variant, /<template>/);
    assert.match(variant, /Hello \{\{ name \}\}/);
    assert.equal(existsSync(join(tmp, 'app/.impeccable-live/__runtime.js')), true);
    assert.equal(
      result.manifest.runtimeModule,
      nuxtViteFsModulePath(join(tmp, 'app/.impeccable-live/__runtime.js'), tmp),
    );
    assert.equal(
      result.manifest.componentModuleBase,
      nuxtViteFsModulePath(join(tmp, result.componentDir), tmp),
    );
    assert.match(result.manifest.runtimeModule, /^\/@fs\//);
    assert.doesNotMatch(result.manifest.runtimeModule, /^\/app\//);
    assert.match(result.manifest.componentModuleBase, /^\/@fs\//);
  });

  it('keeps Vite module URLs valid for literal Nuxt srcDir projects', () => {
    writeFileSync(join(tmp, 'nuxt.config.ts'), "export default defineNuxtConfig({ srcDir: 'client/' });\n");
    const clientSource = join(tmp, 'client', 'pages', 'index.vue');
    mkdirSync(join(tmp, 'client', 'pages'), { recursive: true });
    writeFileSync(clientSource, '<template><h1>Client app</h1></template>\n');

    const result = scaffoldVueComponentSession({
      id: 'clientsrc',
      count: 1,
      sourceFile: 'client/pages/index.vue',
      sourceStartLine: 1,
      sourceEndLine: 1,
      originalLines: ['<h1>Client app</h1>'],
      cwd: tmp,
    });

    assert.match(result.manifestFile, /^client\/\.impeccable-live\/clientsrc\/manifest\.json$/);
    assert.match(result.manifest.runtimeModule, /^\/@fs\/.*\/client\/\.impeccable-live\/__runtime\.js$/);
    assert.match(result.manifest.componentModuleBase, /^\/@fs\/.*\/client\/\.impeccable-live\/clientsrc$/);
  });

  it('accepts one generated SFC into clean Vue source and restores route expressions', () => {
    const result = scaffoldVueComponentSession({
      id: 'vue12345',
      count: 3,
      sourceFile: 'app/pages/index.vue',
      sourceStartLine: 3,
      sourceEndLine: 3,
      originalLines: ['    <h1 class="hero-title">Hello {{ user.name }}</h1>'],
      cwd: tmp,
    });
    writeFileSync(join(tmp, result.componentDir, 'v1.vue'), [
      '<script setup>',
      "defineProps({ name: { default: '' } });",
      '</script>',
      '<template>',
      '  <h1 class="hero-title variant-one">Welcome {{ name }}</h1>',
      '</template>',
      '<style scoped>',
      '.variant-one { letter-spacing: 0.02em; }',
      '</style>',
      '',
    ].join('\n'));

    const accepted = inlineVueComponentAccept(result.manifest, 1, tmp);
    assert.equal(accepted.handled, true);
    const next = readFileSync(source, 'utf-8');
    assert.match(next, /Welcome \{\{ user\.name \}\}/);
    assert.match(next, /class="hero-title variant-one"|class="variant-one hero-title"/);
    assert.match(next, /\.variant-one \{ letter-spacing: 0\.02em; \}/);
    assert.doesNotMatch(next, /data-impeccable/);
    assert.equal(existsSync(join(tmp, result.componentDir, 'manifest.json')), false);
    assert.equal(existsSync(join(tmp, result.componentDir, 'v1.vue')), true, 'imported SFC remains until Live shutdown');
  });

  it('removes deferred SFCs, the shared runtime, and the generated root on Live shutdown', () => {
    const result = scaffoldVueComponentSession({
      id: 'vue12345',
      count: 1,
      sourceFile: 'app/pages/index.vue',
      sourceStartLine: 3,
      sourceEndLine: 3,
      originalLines: ['    <h1 class="hero-title">Hello {{ user.name }}</h1>'],
      cwd: tmp,
    });
    inlineVueComponentAccept(result.manifest, 1, tmp);
    const root = join(tmp, 'app/.impeccable-live');
    assert.equal(existsSync(join(root, '__runtime.js')), true);
    assert.equal(existsSync(join(tmp, result.componentDir, 'v1.vue')), true);

    removeAllVueComponentSessions(tmp);

    assert.equal(existsSync(join(root, '__runtime.js')), false);
    assert.equal(existsSync(root), false);
  });

  it('publishes manifest-last, preserves the route, and rejects late work after Accept', () => {
    const result = scaffoldVueComponentSession({
      id: 'vue12345',
      count: 3,
      sourceFile: 'app/pages/index.vue',
      sourceStartLine: 3,
      sourceEndLine: 3,
      originalLines: ['    <h1 class="hero-title">Hello {{ user.name }}</h1>'],
      cwd: tmp,
    });
    const store = createLiveSessionStore({ cwd: tmp, sessionId: 'vue12345' });
    store.appendEvent({
      type: 'generate',
      id: 'vue12345',
      generationEpoch: 1,
      count: 3,
      action: 'polish',
      element: { outerHTML: '<h1>Hello Paul</h1>' },
    });
    const routeBefore = readFileSync(source, 'utf-8');
    const prepared = prepareGenerationArtifact({ id: 'vue12345', sourceFile: result.manifestFile, cwd: tmp });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.previewMode, 'vue-component');
    const artifactManifest = JSON.parse(readFileSync(join(tmp, prepared.artifactFile), 'utf-8'));
    artifactManifest.arrivedVariants = 1;
    writeFileSync(join(tmp, prepared.artifactFile), JSON.stringify(artifactManifest, null, 2) + '\n');
    writeFileSync(join(tmp, prepared.componentDir, 'v1.vue'), '<template><h1>First</h1></template>\n');

    const published = publishGenerationArtifact({
      id: 'vue12345',
      epoch: prepared.epoch,
      sourceFile: result.manifestFile,
      artifactFile: prepared.artifactFile,
      expectedSourceHash: prepared.expectedSourceHash,
      arrivedVariants: 1,
      expectedVariants: 3,
      cwd: tmp,
    });
    assert.equal(published.ok, true);
    assert.equal(published.previewMode, 'vue-component');
    assert.equal(readFileSync(source, 'utf-8'), routeBefore);
    assert.equal(JSON.parse(readFileSync(join(tmp, result.manifestFile), 'utf-8')).arrivedVariants, 1);

    const late = prepareGenerationArtifact({ id: 'vue12345', sourceFile: result.manifestFile, cwd: tmp });
    store.appendEvent({ type: 'accept', id: 'vue12345', variantId: '1' });
    const rejected = publishGenerationArtifact({
      id: 'vue12345',
      epoch: late.epoch,
      sourceFile: result.manifestFile,
      artifactFile: late.artifactFile,
      expectedSourceHash: late.expectedSourceHash,
      arrivedVariants: 2,
      expectedVariants: 3,
      cwd: tmp,
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, 'stale_generation_epoch');
    assert.equal(readFileSync(source, 'utf-8'), routeBefore);
  });
});
