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
