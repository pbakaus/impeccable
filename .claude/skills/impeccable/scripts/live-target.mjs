import path from 'node:path';
import { resolveProjectRoot } from './context.mjs';

export function parseTargetPath(args = []) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--target' || arg === '-t') {
      return args[i + 1] && !String(args[i + 1]).startsWith('-')
        ? String(args[i + 1])
        : null;
    }
    if (arg.startsWith('--target=')) return arg.slice('--target='.length);
  }
  return null;
}

export function stripTargetArgs(args = []) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--target' || arg === '-t') {
      i++;
      continue;
    }
    if (arg.startsWith('--target=')) continue;
    out.push(arg);
  }
  return out;
}

export function resolveLiveTarget(cwd = process.cwd(), args = []) {
  const originalCwd = path.resolve(cwd);
  const targetPath = parseTargetPath(args);
  const projectRoot = targetPath
    ? resolveProjectRoot(originalCwd, { targetPath })
    : originalCwd;
  return {
    originalCwd,
    projectRoot,
    targetPath,
    targetOptions: targetPath ? { targetPath } : {},
  };
}

export function chdirToLiveTarget(args = []) {
  const target = resolveLiveTarget(process.cwd(), args);
  if (target.projectRoot !== target.originalCwd) {
    process.chdir(target.projectRoot);
  }
  return target;
}
