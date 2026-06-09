import path from 'node:path';
import { resolveProjectRoot } from './context.mjs';
export { parseTargetPath, stripTargetArgs } from './lib/target-args.mjs';
import { parseTargetPath } from './lib/target-args.mjs';

export function resolveLiveTarget(cwd = process.cwd(), args = []) {
  const originalCwd = path.resolve(cwd);
  const targetPath = parseTargetPath(args);
  const absoluteTargetPath = targetPath
    ? path.isAbsolute(targetPath) ? targetPath : path.resolve(originalCwd, targetPath)
    : null;
  const projectRoot = targetPath
    ? resolveProjectRoot(originalCwd, { targetPath: absoluteTargetPath })
    : originalCwd;
  return {
    originalCwd,
    projectRoot,
    targetPath,
    absoluteTargetPath,
    targetOptions: absoluteTargetPath ? { targetPath: absoluteTargetPath } : {},
  };
}

export function chdirToLiveTarget(args = []) {
  const target = resolveLiveTarget(process.cwd(), args);
  if (target.projectRoot !== target.originalCwd) {
    process.chdir(target.projectRoot);
  }
  return target;
}

export function resolveStoredTargetPath(info = {}) {
  const targetPath = info?.targetPath ? String(info.targetPath) : null;
  if (!targetPath) return null;
  if (path.isAbsolute(targetPath)) return targetPath;

  const projectRoot = info.projectRoot ? path.resolve(info.projectRoot) : null;
  const repoRoot = info.repoRoot ? path.resolve(info.repoRoot) : null;
  if (projectRoot && repoRoot) {
    const projectRel = path.relative(repoRoot, projectRoot).split(path.sep).join('/');
    const normalizedTarget = targetPath.split(path.sep).join('/');
    if (projectRel && (normalizedTarget === projectRel || normalizedTarget.startsWith(projectRel + '/'))) {
      return path.resolve(repoRoot, targetPath);
    }
    return path.resolve(projectRoot, targetPath);
  }
  if (repoRoot) return path.resolve(repoRoot, targetPath);
  if (projectRoot) return path.resolve(projectRoot, targetPath);
  return path.resolve(targetPath);
}
