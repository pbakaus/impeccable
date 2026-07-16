import fs from 'node:fs';
import path from 'node:path';

import { getLiveDir } from '../lib/impeccable-paths.mjs';

export const SOURCE_ARTIFACT_PREVIEW_MODE = 'source-artifact';

export function scaffoldSourceArtifactSession({
  id,
  count,
  sourceFile,
  sourceStartLine,
  sourceEndLine,
  originalSource,
  previewContent,
  cwd = process.cwd(),
} = {}) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(id || ''))) {
    throw new Error('invalid source artifact session id');
  }
  const sourcePath = resolveInside(cwd, sourceFile);
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('source artifact target missing');

  const sessionDir = path.join(getLiveDir(cwd), 'previews', id);
  const extension = path.extname(sourcePath) || '.html';
  const previewPath = path.join(sessionDir, 'preview' + extension);
  const manifestPath = path.join(sessionDir, 'manifest.json');
  fs.mkdirSync(sessionDir, { recursive: true });

  const manifest = {
    id,
    count: Number(count || 1),
    previewMode: SOURCE_ARTIFACT_PREVIEW_MODE,
    sourceFile: relative(cwd, sourcePath),
    previewFile: relative(cwd, previewPath),
    sourceStartLine: Number(sourceStartLine),
    sourceEndLine: Number(sourceEndLine),
    originalSource: String(originalSource || ''),
  };
  fs.writeFileSync(previewPath, String(previewContent || ''), 'utf-8');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return { ...manifest, manifestFile: relative(cwd, manifestPath), sessionDir: relative(cwd, sessionDir) };
}

export function findSourceArtifactManifest(id, cwd = process.cwd()) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(id || ''))) return null;
  const manifestPath = path.join(getLiveDir(cwd), 'previews', id, 'manifest.json');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch { return null; }
  if (manifest?.id !== id || manifest?.previewMode !== SOURCE_ARTIFACT_PREVIEW_MODE) return null;
  const sourcePath = resolveInside(cwd, manifest.sourceFile);
  const previewPath = resolveInside(cwd, manifest.previewFile);
  if (!sourcePath || !previewPath || !fs.existsSync(sourcePath) || !fs.existsSync(previewPath)) return null;
  return { ...manifest, manifestPath, sourcePath, previewPath };
}

export function removeSourceArtifactSession(id, cwd = process.cwd()) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(id || ''))) return false;
  const sessionDir = path.join(getLiveDir(cwd), 'previews', id);
  if (!fs.existsSync(sessionDir)) return false;
  fs.rmSync(sessionDir, { recursive: true, force: true });
  return true;
}

function resolveInside(cwd, value) {
  if (!value || typeof value !== 'string') return null;
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, value);
  const rel = path.relative(root, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

function relative(cwd, value) {
  return path.relative(cwd, value).split(path.sep).join('/');
}
