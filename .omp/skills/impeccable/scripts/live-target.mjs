import path from 'node:path';
import { resolveProjectRoot } from './context.mjs';
import { parseTargetPath } from './lib/target-args.mjs';

export function resolveLiveTarget(cwd = process.cwd(), args = []) {
  const originalCwd = path.resolve(cwd);
  let targetPath = null;
  try {
    targetPath = parseTargetPath(args, { strict: true });
  } catch (err) {
    if (err?.name === 'TargetArgError') {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
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
