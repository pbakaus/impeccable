import fs from 'node:fs';
import path from 'node:path';

export class FixturePathError extends Error {}

export function resolveFixtureFile(root, requestPath) {
  const realRoot = fs.realpathSync(root);
  const decodedPath = decodeURIComponent(String(requestPath).split('?')[0]);
  const relativePath = decodedPath.replace(/^\/+/, '');
  const candidate = path.resolve(realRoot, relativePath);
  assertContained(realRoot, candidate);

  const realFile = fs.realpathSync(candidate);
  assertContained(realRoot, realFile);
  return realFile;
}

function assertContained(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new FixturePathError('Fixture request path escapes root');
  }
}
