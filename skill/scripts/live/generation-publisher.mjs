import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createLiveSessionStore } from './session-store.mjs';
import { withSourceLockSync } from './source-lock.mjs';
import { getLiveDir } from '../lib/impeccable-paths.mjs';
import {
  SOURCE_ARTIFACT_PREVIEW_MODE,
  findSourceArtifactManifest,
} from './source-artifact.mjs';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function reconcilePublishedSourceVariants({ current, candidate, priorArrived = 0 } = {}) {
  let reconciled = String(candidate || '');
  const stable = String(current || '');
  for (let variant = 1; variant <= Number(priorArrived || 0); variant += 1) {
    const stableBlock = extractVariantBlock(stable, variant);
    const candidateBlock = extractVariantBlock(reconciled, variant);
    if (!stableBlock || !candidateBlock) {
      return failure('published_variant_missing', { variant });
    }
    const offset = reconciled.indexOf(candidateBlock);
    reconciled = reconciled.slice(0, offset) + stableBlock + reconciled.slice(offset + candidateBlock.length);
  }
  return { ok: true, content: reconciled };
}

export function prepareGenerationArtifact({ id, sourceFile, cwd = process.cwd() } = {}) {
  if (!id) return failure('missing_session_id');
  if (!sourceFile) return failure('missing_file');
  const requestedPath = resolveInside(cwd, sourceFile);
  if (!requestedPath || !fs.existsSync(requestedPath)) return failure(requestedPath ? 'source_missing' : 'path_outside_project');

  const componentTarget = readComponentPublicationTarget(requestedPath, cwd, id);
  if (componentTarget?.error) return componentTarget;
  const sourceArtifactTarget = componentTarget ? null : readSourceArtifactPublicationTarget(requestedPath, cwd, id);
  if (sourceArtifactTarget?.error) return sourceArtifactTarget;
  const sourcePath = componentTarget?.sourcePath || sourceArtifactTarget?.sourcePath || requestedPath;

  try {
    return withSourceLockSync(sourcePath, 'generation-prepare:' + id, () => {
      const store = createLiveSessionStore({ cwd, sessionId: id });
      const snapshot = store.getSnapshot(id, { includeCompleted: true });
      if (!snapshot?.updatedAt) return failure('session_missing');
      if (snapshot.generationCanceled === true) {
        return failure('stale_generation_epoch', { canceled: true, phase: snapshot.phase });
      }
      const source = fs.readFileSync(sourcePath, 'utf-8');
      const artifactBase = sourceArtifactTarget
        ? fs.readFileSync(sourceArtifactTarget.previewPath, 'utf-8')
        : source;
      const revision = Number(snapshot.publishedRevision || 0) + 1;
      const artifactDir = path.join(getLiveDir(cwd), 'artifacts');
      if (componentTarget) {
        return prepareComponentArtifact({
          id,
          revision,
          snapshot,
          source,
          sourcePath,
          requestedPath,
          target: componentTarget,
          artifactDir,
          cwd,
        });
      }
      const extension = path.extname(sourcePath) || '.html';
      const artifactPath = path.join(artifactDir, id + '-r' + revision + extension);
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.writeFileSync(artifactPath, artifactBase, 'utf-8');
      return {
        ok: true,
        id,
        epoch: Number(snapshot.generationEpoch || 1),
        revision,
        sourceFile: relative(cwd, sourcePath),
        ...(sourceArtifactTarget ? {
          previewFile: relative(cwd, sourceArtifactTarget.previewPath),
          previewMode: SOURCE_ARTIFACT_PREVIEW_MODE,
        } : {}),
        artifactFile: relative(cwd, artifactPath),
        expectedSourceHash: sha256(source),
      };
    }, { cwd });
  } catch (error) {
    if (error?.code === 'SOURCE_LOCKED') return failure('source_locked');
    return failure('prepare_failed', { message: error?.message || String(error) });
  }
}

export function publishGenerationArtifact({
  id,
  epoch,
  sourceFile,
  artifactFile,
  expectedSourceHash,
  arrivedVariants,
  expectedVariants,
  publicationKind,
  cwd = process.cwd(),
} = {}) {
  if (!id) return failure('missing_session_id');
  if (!Number.isInteger(epoch) || epoch < 1) return failure('invalid_generation_epoch');
  if (!sourceFile || !artifactFile) return failure('missing_file');
  if (publicationKind && !['variants', 'params'].includes(publicationKind)) {
    return failure('invalid_publication_kind');
  }

  const requestedPath = resolveInside(cwd, sourceFile);
  const artifactPath = resolveInside(cwd, artifactFile);
  if (!requestedPath || !artifactPath) return failure('path_outside_project');
  if (!fs.existsSync(requestedPath)) return failure('source_missing');
  if (!fs.existsSync(artifactPath)) return failure('artifact_missing');

  const componentTarget = readComponentPublicationTarget(requestedPath, cwd, id);
  if (componentTarget?.error) return componentTarget;
  const sourceArtifactTarget = componentTarget ? null : readSourceArtifactPublicationTarget(requestedPath, cwd, id);
  if (sourceArtifactTarget?.error) return sourceArtifactTarget;
  const artifactManifest = readJson(artifactPath);
  const isComponentArtifact = isComponentPreviewMode(artifactManifest?.previewMode);
  if (Boolean(componentTarget) !== isComponentArtifact) {
    return failure('artifact_preview_mode_mismatch');
  }
  if (componentTarget && componentTarget.manifest.previewMode !== artifactManifest?.previewMode) {
    return failure('artifact_preview_mode_mismatch');
  }
  const sourcePath = componentTarget?.sourcePath || sourceArtifactTarget?.sourcePath || requestedPath;

  try {
    return withSourceLockSync(sourcePath, 'generation:' + id + ':' + epoch, () => {
      const store = createLiveSessionStore({ cwd, sessionId: id });
      const snapshot = store.getSnapshot(id, { includeCompleted: true });
      if (!snapshot?.updatedAt) return failure('session_missing');
      if (snapshot.generationCanceled === true) {
        return failure('stale_generation_epoch', { canceled: true, phase: snapshot.phase });
      }
      if (Number(snapshot.generationEpoch || 1) !== epoch) {
        return failure('stale_generation_epoch', { expectedEpoch: snapshot.generationEpoch || 1 });
      }

      const current = fs.readFileSync(sourcePath, 'utf-8');
      const currentHash = sha256(current);
      if (!expectedSourceHash || currentHash !== expectedSourceHash) {
        return failure('source_hash_mismatch', { actualSourceHash: currentHash });
      }

      if (componentTarget) {
        return publishComponentArtifact({
          id,
          epoch,
          snapshot,
          target: componentTarget,
          artifactManifest,
          artifactPath,
          sourcePath,
          arrivedVariants,
          expectedVariants,
          publicationKind,
          store,
          cwd,
        });
      }

      const stablePreview = sourceArtifactTarget
        ? fs.readFileSync(sourceArtifactTarget.previewPath, 'utf-8')
        : current;
      const artifact = fs.readFileSync(artifactPath, 'utf-8');
      if (!artifact.includes('data-impeccable-variants="' + id + '"')) {
        return failure('artifact_missing_session_wrapper');
      }
      const delivered = countDeliveredVariants(artifact);
      if (delivered < 1) return failure('artifact_has_no_variants');
      if (Number.isInteger(arrivedVariants) && delivered < arrivedVariants) {
        return failure('artifact_variant_count_mismatch', { delivered });
      }
      const priorArrived = Math.max(0, Number(snapshot.arrivedVariants || 0));
      for (let variant = 1; variant <= priorArrived; variant++) {
        const currentVariant = extractVariantBlock(stablePreview, variant);
        const artifactVariant = extractVariantBlock(artifact, variant);
        if (!currentVariant || !artifactVariant) {
          return failure('published_variant_missing', { variant });
        }
        if (sha256(withoutVariantParams(currentVariant)) !== sha256(withoutVariantParams(artifactVariant))) {
          return failure('published_variant_changed', { variant });
        }
      }
      const currentPreviewCss = extractPreviewCss(stablePreview, id);
      const artifactPreviewCss = extractPreviewCss(artifact, id);
      if (priorArrived > 0 && currentPreviewCss && !artifactPreviewCss.startsWith(currentPreviewCss)) {
        return failure('published_variant_css_changed');
      }

      const commitSnapshot = store.getSnapshot(id, { includeCompleted: true });
      if (commitSnapshot?.generationCanceled === true) {
        return failure('stale_generation_epoch', { canceled: true, phase: commitSnapshot.phase });
      }
      if (Number(commitSnapshot?.generationEpoch || 1) !== epoch) {
        return failure('stale_generation_epoch', { expectedEpoch: commitSnapshot?.generationEpoch || 1 });
      }
      const artifactHash = sha256(artifact);
      const publishPath = sourceArtifactTarget?.previewPath || sourcePath;
      atomicReplace(publishPath, artifact);
      const revision = Number(commitSnapshot.publishedRevision || 0) + 1;
      store.appendEvent({
        type: 'variant_published',
        id,
        generationEpoch: epoch,
        revision,
        digest: artifactHash,
        sourceFile: relative(cwd, sourcePath),
        ...(sourceArtifactTarget ? {
          previewFile: relative(cwd, publishPath),
          previewMode: SOURCE_ARTIFACT_PREVIEW_MODE,
        } : {}),
        arrivedVariants: delivered,
        expectedVariants: Number(expectedVariants || snapshot.expectedVariants || delivered),
        publicationKind: publicationKind || 'variants',
        at: Date.now(),
      });
      return {
        ok: true,
        id,
        epoch,
        revision,
        digest: artifactHash,
        sourceFile: relative(cwd, sourcePath),
        ...(sourceArtifactTarget ? {
          previewFile: relative(cwd, publishPath),
          previewMode: SOURCE_ARTIFACT_PREVIEW_MODE,
        } : {}),
        arrivedVariants: delivered,
        expectedVariants: Number(expectedVariants || snapshot.expectedVariants || delivered),
        publicationKind: publicationKind || 'variants',
      };
    }, { cwd });
  } catch (error) {
    if (error?.code === 'SOURCE_LOCKED') return failure('source_locked');
    return failure('publish_failed', { message: error?.message || String(error) });
  }
}

function prepareComponentArtifact({
  id,
  revision,
  snapshot,
  source,
  sourcePath,
  requestedPath,
  target,
  artifactDir,
  cwd,
}) {
  const artifactComponentDir = path.join(
    artifactDir,
    id + '-r' + revision + '-' + target.manifest.previewMode + '-' + process.pid + '-' + Date.now(),
  );
  fs.mkdirSync(artifactComponentDir, { recursive: true });
  copyDirectoryFiles(target.componentPath, artifactComponentDir);
  const artifactPath = path.join(artifactComponentDir, 'manifest.json');
  const artifactManifest = {
    ...target.manifest,
    componentDir: relative(cwd, artifactComponentDir),
  };
  fs.writeFileSync(artifactPath, JSON.stringify(artifactManifest, null, 2) + '\n', 'utf-8');
  return {
    ok: true,
    id,
    epoch: Number(snapshot.generationEpoch || 1),
    revision,
    sourceFile: relative(cwd, requestedPath),
    targetSourceFile: relative(cwd, sourcePath),
    artifactFile: relative(cwd, artifactPath),
    componentDir: relative(cwd, artifactComponentDir),
    previewMode: target.manifest.previewMode,
    expectedSourceHash: sha256(source),
  };
}

function publishComponentArtifact({
  id,
  epoch,
  snapshot,
  target,
  artifactManifest,
  artifactPath,
  sourcePath,
  arrivedVariants,
  expectedVariants,
  publicationKind,
  store,
  cwd,
}) {
  if (!artifactManifest || typeof artifactManifest !== 'object') {
    return failure('artifact_manifest_invalid');
  }
  if (artifactManifest.id !== id || target.manifest.id !== id) {
    return failure('artifact_session_mismatch');
  }
  const artifactComponentPath = resolveInside(cwd, artifactManifest.componentDir);
  if (!artifactComponentPath || path.resolve(artifactComponentPath) !== path.dirname(artifactPath)) {
    return failure('artifact_component_dir_mismatch');
  }
  if (!isDescendant(path.join(getLiveDir(cwd), 'artifacts'), artifactComponentPath)) {
    return failure('artifact_not_staged');
  }
  const immutableMismatch = componentManifestMismatch(target.manifest, artifactManifest);
  if (immutableMismatch) {
    return failure('artifact_manifest_changed', { field: immutableMismatch });
  }

  const expected = Number(expectedVariants || target.manifest.count || snapshot.expectedVariants || 0);
  const declared = optionalPositiveInteger(artifactManifest.arrivedVariants);
  const delivered = Number.isInteger(arrivedVariants) ? arrivedVariants : declared;
  if (!Number.isInteger(delivered) || delivered < 1) return failure('artifact_has_no_variants');
  if (expected > 0 && delivered > expected) {
    return failure('artifact_variant_count_mismatch', { delivered, expected });
  }
  if (declared !== null && declared !== delivered) {
    return failure('artifact_variant_count_mismatch', { delivered: declared, expected: delivered });
  }

  const priorArrived = Math.max(
    optionalPositiveInteger(target.manifest.arrivedVariants) || 0,
    Number(snapshot.arrivedVariants || 0),
  );
  if (delivered < priorArrived) {
    return failure('artifact_variant_count_regressed', { delivered, priorArrived });
  }

  const componentExtension = target.manifest.componentExtension
    || (target.manifest.previewMode === 'vue-component' ? 'vue' : 'svelte');
  const variantContents = [];
  for (let variant = 1; variant <= delivered; variant++) {
    const artifactVariantPath = path.join(artifactComponentPath, 'v' + variant + '.' + componentExtension);
    if (!regularFileInside(artifactComponentPath, artifactVariantPath)) {
      return failure('artifact_variant_missing', { variant });
    }
    const content = fs.readFileSync(artifactVariantPath, 'utf-8');
    if (!content.trim()) return failure('artifact_variant_empty', { variant });
    const targetVariantPath = path.join(target.componentPath, 'v' + variant + '.' + componentExtension);
    if (variant <= priorArrived && !regularFileInside(target.componentPath, targetVariantPath)) {
      return failure('published_variant_missing', { variant });
    }
    if (variant <= priorArrived) {
      const prior = fs.readFileSync(targetVariantPath, 'utf-8');
      if (sha256(prior) !== sha256(content)) {
        return failure('published_variant_changed', { variant });
      }
    }
    variantContents.push({ variant, content, targetPath: targetVariantPath });
  }

  const artifactParamsPath = path.join(artifactComponentPath, 'params.json');
  let paramsContent = null;
  if (fs.existsSync(artifactParamsPath)) {
    if (!regularFileInside(artifactComponentPath, artifactParamsPath)) {
      return failure('artifact_params_invalid');
    }
    paramsContent = fs.readFileSync(artifactParamsPath, 'utf-8');
    const params = parseJson(paramsContent);
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return failure('artifact_params_invalid');
    }
  }

  // Components and optional params become reachable before the manifest
  // advertises them. Committing the manifest last makes publication atomic
  // from the browser's point of view while the source lock excludes Accept.
  fs.mkdirSync(target.componentPath, { recursive: true });
  for (const variant of variantContents) {
    if (variant.variant > priorArrived) atomicReplace(variant.targetPath, variant.content);
  }
  if (paramsContent !== null) {
    atomicReplace(path.join(target.componentPath, 'params.json'), paramsContent);
  }
  const commitSnapshot = store.getSnapshot(id, { includeCompleted: true });
  if (commitSnapshot?.generationCanceled === true) {
    return failure('stale_generation_epoch', { canceled: true, phase: commitSnapshot.phase });
  }
  if (Number(commitSnapshot?.generationEpoch || 1) !== epoch) {
    return failure('stale_generation_epoch', { expectedEpoch: commitSnapshot?.generationEpoch || 1 });
  }
  const publishedManifest = {
    ...target.manifest,
    componentDir: relative(cwd, target.componentPath),
    arrivedVariants: delivered,
  };
  delete publishedManifest.manifestPath;
  const manifestContent = JSON.stringify(publishedManifest, null, 2) + '\n';
  atomicReplace(target.manifestPath, manifestContent);

  const digest = digestComponentPublication(manifestContent, variantContents, paramsContent);
  const revision = Number(snapshot.publishedRevision || 0) + 1;
  const sourceFile = relative(cwd, sourcePath);
  const previewFile = relative(cwd, target.manifestPath);
  store.appendEvent({
    type: 'variant_published',
    id,
    generationEpoch: epoch,
    revision,
    digest,
    sourceFile,
    previewFile,
    previewMode: target.manifest.previewMode,
    arrivedVariants: delivered,
    expectedVariants: expected || delivered,
    publicationKind: publicationKind || 'variants',
    at: Date.now(),
  });
  return {
    ok: true,
    id,
    epoch,
    revision,
    digest,
    sourceFile,
    previewFile,
    previewMode: target.manifest.previewMode,
    componentDir: relative(cwd, target.componentPath),
    arrivedVariants: delivered,
    expectedVariants: expected || delivered,
    publicationKind: publicationKind || 'variants',
  };
}

const COMPONENT_MANIFEST_FIELDS = [
  'id',
  'mode',
  'previewMode',
  'sourceFile',
  'sourceStartLine',
  'sourceEndLine',
  'insertLine',
  'position',
  'anchorStartLine',
  'anchorEndLine',
  'count',
  'propContract',
  'originalMarkup',
  'anchorMarkup',
  'runtimeModule',
  'componentModuleBase',
  'framework',
  'componentExtension',
];

function readComponentPublicationTarget(manifestPath, cwd, id) {
  if (path.basename(manifestPath) !== 'manifest.json') return null;
  const manifest = readJson(manifestPath);
  if (!manifest || !isComponentPreviewMode(manifest.previewMode)) return null;
  if (manifest.id !== id) return failure('artifact_session_mismatch');
  const sourcePath = resolveInside(cwd, manifest.sourceFile);
  const componentPath = resolveInside(cwd, manifest.componentDir);
  if (!sourcePath || !componentPath) return failure('path_outside_project');
  if (!fs.existsSync(sourcePath)) return failure('source_missing');
  if (path.resolve(componentPath) !== path.dirname(manifestPath)) {
    return failure('manifest_component_dir_mismatch');
  }
  return { manifest, manifestPath, sourcePath, componentPath };
}

function readSourceArtifactPublicationTarget(requestedPath, cwd, id) {
  const manifest = findSourceArtifactManifest(id, cwd);
  if (!manifest) return null;
  if (path.resolve(requestedPath) !== path.resolve(manifest.previewPath)) {
    return failure('source_artifact_preview_mismatch');
  }
  return manifest;
}

function componentManifestMismatch(target, artifact) {
  for (const field of COMPONENT_MANIFEST_FIELDS) {
    if (JSON.stringify(target[field] ?? null) !== JSON.stringify(artifact[field] ?? null)) return field;
  }
  return null;
}

function isComponentPreviewMode(value) {
  return value === 'svelte-component' || value === 'vue-component';
}

function copyDirectoryFiles(sourceDir, targetDir) {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    fs.copyFileSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
  }
}

function regularFileInside(root, file) {
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}

function isDescendant(root, candidate) {
  const rel = path.relative(root, candidate);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function digestComponentPublication(manifestContent, variants, paramsContent) {
  const hash = createHash('sha256');
  hash.update(manifestContent);
  for (const variant of variants) {
    hash.update('\0v' + variant.variant + '\0');
    hash.update(variant.content);
  }
  if (paramsContent !== null) hash.update('\0params\0' + paramsContent);
  return hash.digest('hex');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function optionalPositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function countDeliveredVariants(source) {
  const matches = source.match(/<div\b[^>]*\bdata-impeccable-variant=(?:"|')(?!original(?:"|'))[^"']+(?:"|')[^>]*>/g);
  return matches?.length || 0;
}

function extractVariantBlock(source, variant) {
  const open = /<div\b[^>]*>/gi;
  let match;
  let start = -1;
  const attr = new RegExp("\\bdata-impeccable-variant=(?:\"" + variant + "\"|'" + variant + "')");
  while ((match = open.exec(source))) {
    if (attr.test(match[0])) {
      start = match.index;
      break;
    }
  }
  if (start < 0) return null;

  const token = /<div\b[^>]*\/\s*>|<div\b[^>]*>|<\/div\s*>/gi;
  token.lastIndex = start;
  let depth = 0;
  while ((match = token.exec(source))) {
    if (/^<\/div/i.test(match[0])) {
      depth -= 1;
      if (depth === 0) return source.slice(start, token.lastIndex);
    } else if (!/\/\s*>$/.test(match[0])) {
      depth += 1;
    }
  }
  return null;
}

function withoutVariantParams(block) {
  return String(block || '').replace(
    /\sdata-impeccable-params=(?:"[^"]*"|'[^']*')/i,
    '',
  );
}

function extractPreviewCss(source, id) {
  const escapedId = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const open = new RegExp("<style\\b[^>]*\\bdata-impeccable-css=(?:\"" + escapedId + "\"|'" + escapedId + "')[^>]*>", 'i');
  const match = open.exec(source);
  if (!match) return '';
  const start = match.index + match[0].length;
  const end = source.indexOf('</style>', start);
  if (end < 0) return '';
  return source.slice(start, end)
    .replace(/^\s*\{\s*`\s*/, '')
    .replace(/\s*`\s*\}\s*$/, '')
    .trim();
}

function atomicReplace(target, content) {
  let mode = 0o666;
  try { mode = fs.statSync(target).mode; } catch {}
  const temp = target + '.impeccable-publish-' + process.pid + '-' + Date.now();
  try {
    fs.writeFileSync(temp, content, { encoding: 'utf-8', mode });
    fs.renameSync(temp, target);
  } finally {
    try { fs.unlinkSync(temp); } catch {}
  }
}

function resolveInside(cwd, value) {
  const resolved = path.resolve(cwd, value);
  const rel = path.relative(cwd, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

function relative(cwd, value) {
  return path.relative(cwd, value).split(path.sep).join('/');
}

function failure(error, details = {}) {
  return { ok: false, error, ...details };
}
