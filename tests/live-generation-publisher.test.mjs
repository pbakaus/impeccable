import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createLiveSessionStore } from '../skill/scripts/live/session-store.mjs';
import { scaffoldSourceArtifactSession } from '../skill/scripts/live/source-artifact.mjs';
import {
  prepareGenerationArtifact,
  publishGenerationArtifact,
  sha256,
} from '../skill/scripts/live/generation-publisher.mjs';

describe('transactional generation publisher', () => {
  let tmp;
  let source;
  let artifact;
  let store;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'impeccable-publisher-'));
    source = join(tmp, 'page.html');
    artifact = join(tmp, 'variant.html');
    writeFileSync(source, '<main><div data-impeccable-variants="abc12345"><div data-impeccable-variant="original">Original</div></div></main>');
    store = createLiveSessionStore({ cwd: tmp, sessionId: 'abc12345' });
    store.appendEvent({
      type: 'generate',
      id: 'abc12345',
      generationEpoch: 1,
      action: 'polish',
      count: 3,
      element: { outerHTML: '<main>Original</main>' },
    });
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('atomically publishes an artifact that matches the fenced source revision', () => {
    const before = readFileSync(source, 'utf-8');
    writeFileSync(artifact, '<main><div data-impeccable-variants="abc12345"><div data-impeccable-variant="original">Original</div><div data-impeccable-variant="1">Variant</div></div></main>');
    const result = publishGenerationArtifact({
      id: 'abc12345',
      epoch: 1,
      sourceFile: source,
      artifactFile: artifact,
      expectedSourceHash: sha256(before),
      expectedVariants: 3,
      cwd: tmp,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.arrivedVariants, 1);
    assert.equal(readFileSync(source, 'utf-8'), readFileSync(artifact, 'utf-8'));
    const snapshot = store.getSnapshot('abc12345');
    assert.equal(snapshot.phase, 'variants_progress');
    assert.equal(snapshot.publishedRevision, 1);
    assert.equal(snapshot.deliveredVariants['1'].digest, result.digest);
  });

  it('prepares a revision artifact with the current epoch and source fence', () => {
    const result = prepareGenerationArtifact({ id: 'abc12345', sourceFile: source, cwd: tmp });
    assert.equal(result.ok, true);
    assert.equal(result.epoch, 1);
    assert.equal(result.revision, 1);
    assert.equal(result.expectedSourceHash, sha256(readFileSync(source, 'utf-8')));
    assert.equal(readFileSync(join(tmp, result.artifactFile), 'utf-8'), readFileSync(source, 'utf-8'));
  });

  it('rejects a late publication after early accept without touching source', () => {
    const before = readFileSync(source, 'utf-8');
    writeFileSync(artifact, '<main><div data-impeccable-variants="abc12345"><div data-impeccable-variant="1">Late</div></div></main>');
    store.appendEvent({ type: 'accept', id: 'abc12345', variantId: '1' });

    const result = publishGenerationArtifact({
      id: 'abc12345',
      epoch: 1,
      sourceFile: source,
      artifactFile: artifact,
      expectedSourceHash: sha256(before),
      cwd: tmp,
    });

    assert.deepEqual(result, {
      ok: false,
      error: 'stale_generation_epoch',
      canceled: true,
      phase: 'accept_requested',
    });
    assert.equal(readFileSync(source, 'utf-8'), before);
  });

  it('rejects a stale artifact when source changed after the worker snapshot', () => {
    const before = readFileSync(source, 'utf-8');
    writeFileSync(artifact, '<main><div data-impeccable-variants="abc12345"><div data-impeccable-variant="1">Variant</div></div></main>');
    writeFileSync(source, before.replace('Original', 'Changed'));

    const result = publishGenerationArtifact({
      id: 'abc12345',
      epoch: 1,
      sourceFile: source,
      artifactFile: artifact,
      expectedSourceHash: sha256(before),
      cwd: tmp,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'source_hash_mismatch');
    assert.match(readFileSync(source, 'utf-8'), /Changed/);
  });

  it('keeps an already reviewable source variant immutable across revisions', () => {
    const firstSource = '<main><div data-impeccable-variants="abc12345"><div data-impeccable-variant="original">Original</div><div data-impeccable-variant="1"><section><div>First</div></section></div></div></main>';
    writeFileSync(artifact, firstSource);
    const first = publishGenerationArtifact({
      id: 'abc12345',
      epoch: 1,
      sourceFile: source,
      artifactFile: artifact,
      expectedSourceHash: sha256(readFileSync(source, 'utf-8')),
      arrivedVariants: 1,
      expectedVariants: 3,
      cwd: tmp,
    });
    assert.equal(first.ok, true);

    const prepared = prepareGenerationArtifact({ id: 'abc12345', sourceFile: source, cwd: tmp });
    const changed = firstSource.replace('First', 'Silently changed')
      .replace('</div></div></main>', '</div><div data-impeccable-variant="2">Second</div></div></main>');
    writeFileSync(join(tmp, prepared.artifactFile), changed);
    const result = publishGenerationArtifact({
      id: 'abc12345',
      epoch: prepared.epoch,
      sourceFile: source,
      artifactFile: prepared.artifactFile,
      expectedSourceHash: prepared.expectedSourceHash,
      arrivedVariants: 2,
      expectedVariants: 3,
      cwd: tmp,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'published_variant_changed');
    assert.equal(result.variant, 1);
    assert.equal(readFileSync(source, 'utf-8'), firstSource);
  });

  it('allows the deferred parameter manifest without weakening prior markup immutability', () => {
    const firstSource = '<main><div data-impeccable-variants="abc12345"><style data-impeccable-css="abc12345">@scope ([data-impeccable-variant="1"]) { h1 { color: red; } }</style><div data-impeccable-variant="original">Original</div><div data-impeccable-variant="1"><h1>First</h1></div></div></main>';
    writeFileSync(artifact, firstSource);
    const first = publishGenerationArtifact({
      id: 'abc12345', epoch: 1, sourceFile: source, artifactFile: artifact,
      expectedSourceHash: sha256(readFileSync(source, 'utf-8')), arrivedVariants: 1, expectedVariants: 3, cwd: tmp,
    });
    assert.equal(first.ok, true);

    const prepared = prepareGenerationArtifact({ id: 'abc12345', sourceFile: source, cwd: tmp });
    const withParams = firstSource
      .replace('<div data-impeccable-variant="1"', '<div data-impeccable-variant="1" data-impeccable-params=\'[{"id":"scale"}]\'')
      .replace('</div></main>', '<div data-impeccable-variant="2">Second</div></div></main>');
    writeFileSync(join(tmp, prepared.artifactFile), withParams);
    const result = publishGenerationArtifact({
      id: 'abc12345', epoch: prepared.epoch, sourceFile: source, artifactFile: prepared.artifactFile,
      expectedSourceHash: prepared.expectedSourceHash, arrivedVariants: 2, expectedVariants: 3, cwd: tmp,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(readFileSync(source, 'utf-8'), /data-impeccable-params/);
  });

  it('rejects later source revisions that restyle an already reviewable variant', () => {
    const firstSource = '<main><div data-impeccable-variants="abc12345"><style data-impeccable-css="abc12345">@scope ([data-impeccable-variant="1"]) { :scope > h1 { color: red; } }</style><div data-impeccable-variant="original">Original</div><div data-impeccable-variant="1"><h1>First</h1></div></div></main>';
    writeFileSync(artifact, firstSource);
    const first = publishGenerationArtifact({
      id: 'abc12345', epoch: 1, sourceFile: source, artifactFile: artifact,
      expectedSourceHash: sha256(readFileSync(source, 'utf-8')), arrivedVariants: 1, expectedVariants: 3, cwd: tmp,
    });
    assert.equal(first.ok, true);

    const prepared = prepareGenerationArtifact({ id: 'abc12345', sourceFile: source, cwd: tmp });
    const changed = firstSource.replace('color: red', 'color: blue');
    writeFileSync(join(tmp, prepared.artifactFile), changed);
    const result = publishGenerationArtifact({
      id: 'abc12345', epoch: prepared.epoch, sourceFile: source, artifactFile: prepared.artifactFile,
      expectedSourceHash: prepared.expectedSourceHash, arrivedVariants: 1, expectedVariants: 3, cwd: tmp,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'published_variant_css_changed', JSON.stringify(result));
    assert.equal(readFileSync(source, 'utf-8'), firstSource);
  });
});

describe('transactional isolated source preview publisher', () => {
  let tmp;
  const id = 'isolatedpub';

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'impeccable-isolated-publisher-'));
    writeFileSync(join(tmp, 'page.html'), '<main><section class="hero">Original</section></main>');
    createLiveSessionStore({ cwd: tmp, sessionId: id }).appendEvent({
      type: 'generate', id, generationEpoch: 1, count: 3,
    });
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('publishes to the preview artifact while fencing the byte-identical source', () => {
    const original = readFileSync(join(tmp, 'page.html'), 'utf-8');
    const session = scaffoldSourceArtifactSession({
      id,
      count: 3,
      sourceFile: 'page.html',
      sourceStartLine: 1,
      sourceEndLine: 1,
      originalSource: '<section class="hero">Original</section>',
      previewContent: '<main><div data-impeccable-variants="isolatedpub"><div data-impeccable-variant="original"><section class="hero">Original</section></div></div></main>',
      cwd: tmp,
    });
    const prepared = prepareGenerationArtifact({ id, sourceFile: session.previewFile, cwd: tmp });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.sourceFile, 'page.html');
    assert.equal(prepared.previewFile, session.previewFile);
    assert.equal(prepared.previewMode, 'source-artifact');

    const candidate = readFileSync(join(tmp, prepared.artifactFile), 'utf-8')
      .replace('</div></main>', '<div data-impeccable-variant="1"><section>Variant one</section></div></div></main>');
    writeFileSync(join(tmp, prepared.artifactFile), candidate);
    const published = publishGenerationArtifact({
      id,
      epoch: prepared.epoch,
      sourceFile: session.previewFile,
      artifactFile: prepared.artifactFile,
      expectedSourceHash: prepared.expectedSourceHash,
      arrivedVariants: 1,
      expectedVariants: 3,
      cwd: tmp,
    });

    assert.equal(published.ok, true, JSON.stringify(published));
    assert.equal(published.sourceFile, 'page.html');
    assert.equal(published.previewMode, 'source-artifact');
    assert.equal(readFileSync(join(tmp, 'page.html'), 'utf-8'), original);
    assert.match(readFileSync(join(tmp, session.previewFile), 'utf-8'), /Variant one/);
  });
});

describe('transactional Svelte component publisher', () => {
  let tmp;
  let source;
  let manifestPath;
  let componentDir;
  let store;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'impeccable-svelte-publisher-'));
    source = join(tmp, 'src', 'routes', '+page.svelte');
    componentDir = join(tmp, 'node_modules', '.impeccable-live', 'svelte123');
    manifestPath = join(componentDir, 'manifest.json');
    mkdirSync(join(tmp, 'src', 'routes'), { recursive: true });
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(source, '<main><h1>{title}</h1></main>\n');
    writeFileSync(manifestPath, JSON.stringify({
      id: 'svelte123',
      previewMode: 'svelte-component',
      sourceFile: 'src/routes/+page.svelte',
      sourceStartLine: 1,
      sourceEndLine: 1,
      count: 3,
      propContract: [{ prop: 'title', expr: 'title', placeholder: '{title}' }],
      originalMarkup: '<main><h1>{title}</h1></main>',
      componentDir: 'node_modules/.impeccable-live/svelte123',
      runtimeModule: '/node_modules/.impeccable-live/__runtime.js',
    }, null, 2) + '\n');
    for (let variant = 1; variant <= 3; variant++) {
      writeFileSync(join(componentDir, `v${variant}.svelte`), `<main>Stub ${variant}</main>\n`);
    }
    store = createLiveSessionStore({ cwd: tmp, sessionId: 'svelte123' });
    store.appendEvent({
      type: 'generate',
      id: 'svelte123',
      generationEpoch: 1,
      action: 'polish',
      count: 3,
      element: { outerHTML: '<main><h1>Original</h1></main>' },
    });
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('prepares an isolated component directory fenced against the real route', () => {
    const result = prepareGenerationArtifact({ id: 'svelte123', sourceFile: manifestPath, cwd: tmp });

    assert.equal(result.ok, true);
    assert.equal(result.previewMode, 'svelte-component');
    assert.equal(result.sourceFile, 'node_modules/.impeccable-live/svelte123/manifest.json');
    assert.equal(result.targetSourceFile, 'src/routes/+page.svelte');
    assert.equal(result.expectedSourceHash, sha256(readFileSync(source, 'utf-8')));
    const artifactManifest = JSON.parse(readFileSync(join(tmp, result.artifactFile), 'utf-8'));
    assert.equal(artifactManifest.componentDir, result.componentDir);
    assert.equal(readFileSync(join(tmp, result.componentDir, 'v1.svelte'), 'utf-8'), '<main>Stub 1</main>\n');

    writeFileSync(join(tmp, result.componentDir, 'v1.svelte'), '<main>Prepared only</main>\n');
    assert.equal(readFileSync(join(componentDir, 'v1.svelte'), 'utf-8'), '<main>Stub 1</main>\n');
  });

  it('publishes components before committing the arrived manifest and journals preview metadata', () => {
    const prepared = prepareGenerationArtifact({ id: 'svelte123', sourceFile: manifestPath, cwd: tmp });
    const artifactManifestPath = join(tmp, prepared.artifactFile);
    const artifactManifest = JSON.parse(readFileSync(artifactManifestPath, 'utf-8'));
    artifactManifest.arrivedVariants = 1;
    writeFileSync(artifactManifestPath, JSON.stringify(artifactManifest, null, 2) + '\n');
    writeFileSync(join(tmp, prepared.componentDir, 'v1.svelte'), '<main>First live variant</main>\n');

    const result = publishGenerationArtifact({
      id: 'svelte123',
      epoch: prepared.epoch,
      sourceFile: manifestPath,
      artifactFile: artifactManifestPath,
      expectedSourceHash: prepared.expectedSourceHash,
      arrivedVariants: 1,
      expectedVariants: 3,
      cwd: tmp,
    });

    assert.equal(result.ok, true);
    assert.equal(result.previewMode, 'svelte-component');
    assert.equal(result.sourceFile, 'src/routes/+page.svelte');
    assert.equal(result.previewFile, 'node_modules/.impeccable-live/svelte123/manifest.json');
    assert.equal(readFileSync(join(componentDir, 'v1.svelte'), 'utf-8'), '<main>First live variant</main>\n');
    assert.equal(readFileSync(source, 'utf-8'), '<main><h1>{title}</h1></main>\n');
    const liveManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    assert.equal(liveManifest.arrivedVariants, 1);
    assert.equal(liveManifest.componentDir, 'node_modules/.impeccable-live/svelte123');
    const snapshot = store.getSnapshot('svelte123');
    assert.equal(snapshot.arrivedVariants, 1);
    assert.equal(snapshot.previewMode, 'svelte-component');
    assert.equal(snapshot.previewFile, 'node_modules/.impeccable-live/svelte123/manifest.json');
  });

  it('keeps published variants immutable across later revisions', () => {
    const first = prepareGenerationArtifact({ id: 'svelte123', sourceFile: manifestPath, cwd: tmp });
    publishSveltePrepared(first, { arrived: 1, edits: { 1: '<main>First live variant</main>\n' } });
    const second = prepareGenerationArtifact({ id: 'svelte123', sourceFile: manifestPath, cwd: tmp });
    const before = readFileSync(join(componentDir, 'v1.svelte'), 'utf-8');

    const result = publishSveltePrepared(second, {
      arrived: 2,
      edits: {
        1: '<main>Silently changed first variant</main>\n',
        2: '<main>Second live variant</main>\n',
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'published_variant_changed');
    assert.equal(result.variant, 1);
    assert.equal(readFileSync(join(componentDir, 'v1.svelte'), 'utf-8'), before);
    assert.equal(JSON.parse(readFileSync(manifestPath, 'utf-8')).arrivedVariants, 1);
  });

  it('publishes later variants and params without rewriting an already reviewable variant', () => {
    const first = prepareGenerationArtifact({ id: 'svelte123', sourceFile: manifestPath, cwd: tmp });
    publishSveltePrepared(first, { arrived: 1, edits: { 1: '<main>First live variant</main>\n' } });
    const second = prepareGenerationArtifact({ id: 'svelte123', sourceFile: manifestPath, cwd: tmp });
    writeFileSync(join(tmp, second.componentDir, 'params.json'), '{"2":[{"id":"density"}]}\n');

    const result = publishSveltePrepared(second, {
      arrived: 3,
      edits: {
        2: '<main>Second live variant</main>\n',
        3: '<main>Third live variant</main>\n',
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.arrivedVariants, 3);
    assert.equal(readFileSync(join(componentDir, 'v1.svelte'), 'utf-8'), '<main>First live variant</main>\n');
    assert.equal(readFileSync(join(componentDir, 'v2.svelte'), 'utf-8'), '<main>Second live variant</main>\n');
    assert.equal(existsSync(join(componentDir, 'params.json')), true);
    assert.deepEqual(JSON.parse(readFileSync(join(componentDir, 'params.json'), 'utf-8')), {
      2: [{ id: 'density' }],
    });
  });

  it('rejects a prepared Svelte publication after Accept without touching live artifacts', () => {
    const prepared = prepareGenerationArtifact({ id: 'svelte123', sourceFile: manifestPath, cwd: tmp });
    const beforeManifest = readFileSync(manifestPath, 'utf-8');
    const beforeVariant = readFileSync(join(componentDir, 'v1.svelte'), 'utf-8');
    store.appendEvent({ type: 'accept', id: 'svelte123', variantId: '1' });

    const result = publishSveltePrepared(prepared, {
      arrived: 1,
      edits: { 1: '<main>Too late</main>\n' },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'stale_generation_epoch');
    assert.equal(readFileSync(manifestPath, 'utf-8'), beforeManifest);
    assert.equal(readFileSync(join(componentDir, 'v1.svelte'), 'utf-8'), beforeVariant);
  });

  it('rejects a live component directory masquerading as a staged artifact', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    manifest.arrivedVariants = 1;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    const result = publishGenerationArtifact({
      id: 'svelte123',
      epoch: 1,
      sourceFile: manifestPath,
      artifactFile: manifestPath,
      expectedSourceHash: sha256(readFileSync(source, 'utf-8')),
      arrivedVariants: 1,
      expectedVariants: 3,
      cwd: tmp,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'artifact_not_staged');
  });

  function publishSveltePrepared(prepared, { arrived, edits }) {
    const artifactManifestPath = join(tmp, prepared.artifactFile);
    const artifactManifest = JSON.parse(readFileSync(artifactManifestPath, 'utf-8'));
    artifactManifest.arrivedVariants = arrived;
    writeFileSync(artifactManifestPath, JSON.stringify(artifactManifest, null, 2) + '\n');
    for (const [variant, content] of Object.entries(edits)) {
      writeFileSync(join(tmp, prepared.componentDir, `v${variant}.svelte`), content);
    }
    return publishGenerationArtifact({
      id: 'svelte123',
      epoch: prepared.epoch,
      sourceFile: manifestPath,
      artifactFile: artifactManifestPath,
      expectedSourceHash: prepared.expectedSourceHash,
      arrivedVariants: arrived,
      expectedVariants: 3,
      cwd: tmp,
    });
  }
});
