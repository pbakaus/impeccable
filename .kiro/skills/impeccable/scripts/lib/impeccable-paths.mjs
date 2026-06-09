import fs from 'node:fs';
import path from 'node:path';
import { resolveProject, resolveProjectRoot } from '../context.mjs';

export const IMPECCABLE_DIR = '.impeccable';
export const LIVE_DIR = 'live';
export const CRITIQUE_DIR = 'critique';

export function getImpeccableDir(cwd = process.cwd(), options = {}) {
  return path.join(resolveProjectRoot(cwd, options), IMPECCABLE_DIR);
}

export function getDesignSidecarPath(cwd = process.cwd(), options = {}) {
  return path.join(getImpeccableDir(cwd, options), 'design.json');
}

export function getDesignSidecarCandidates(cwd = process.cwd(), contextDir = cwd, options = {}) {
  const projectRoot = resolveProjectRoot(cwd, options);
  const candidates = [
    getDesignSidecarPath(cwd, options),
    path.join(projectRoot, 'DESIGN.json'),
  ];
  const contextLegacy = path.join(contextDir, 'DESIGN.json');
  if (!candidates.includes(contextLegacy)) candidates.push(contextLegacy);
  return candidates;
}

export function resolveDesignSidecarPath(cwd = process.cwd(), contextDir = cwd, options = {}) {
  return firstExisting(getDesignSidecarCandidates(cwd, contextDir, options));
}

export function getLiveDir(cwd = process.cwd(), options = {}) {
  return path.join(getImpeccableDir(cwd, options), LIVE_DIR);
}

export function getLiveConfigPath(cwd = process.cwd(), options = {}) {
  return path.join(getLiveDir(cwd, options), 'config.json');
}

export function getLegacyLiveConfigPath(scriptsDir) {
  return path.join(scriptsDir, 'config.json');
}

export function resolveLiveConfigPath({ cwd = process.cwd(), scriptsDir, env = process.env, targetPath } = {}) {
  if (env.IMPECCABLE_LIVE_CONFIG && env.IMPECCABLE_LIVE_CONFIG.trim()) {
    const configured = env.IMPECCABLE_LIVE_CONFIG.trim();
    return path.isAbsolute(configured) ? configured : path.resolve(cwd, configured);
  }
  const primary = getLiveConfigPath(cwd, { targetPath });
  if (fs.existsSync(primary)) return primary;
  if (scriptsDir) {
    const legacy = getLegacyLiveConfigPath(scriptsDir);
    if (fs.existsSync(legacy)) return legacy;
  }
  return primary;
}

export function getLiveServerPath(cwd = process.cwd(), options = {}) {
  return path.join(getLiveDir(cwd, options), 'server.json');
}

export function getLegacyLiveServerPath(cwd = process.cwd(), options = {}) {
  return path.join(resolveProjectRoot(cwd, options), '.impeccable-live.json');
}

export function readLiveServerInfo(cwd = process.cwd(), options = {}) {
  for (const filePath of [getLiveServerPath(cwd, options), getLegacyLiveServerPath(cwd, options)]) {
    const record = readLiveServerInfoFile(filePath);
    if (record) return record;
  }
  const childRecords = findChildLiveServerInfo(cwd, options);
  if (childRecords.length === 1) return childRecords[0];
  if (childRecords.length > 1) {
    return {
      ambiguous: true,
      candidates: childRecords.map(({ info, path: filePath }) => ({
        path: filePath,
        port: info.port,
        targetPath: info.targetPath || null,
        projectRoot: info.projectRoot || null,
      })),
    };
  }
  return null;
}

function readLiveServerInfoFile(filePath) {
  try {
    const info = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (info && typeof info.pid === 'number' && !isLiveServerPidReachable(info.pid)) {
      try { fs.unlinkSync(filePath); } catch {}
      return null;
    }
    return { info, path: filePath };
  } catch {
    return null;
  }
}

function findChildLiveServerInfo(cwd = process.cwd(), options = {}) {
  if (options?.targetPath) return [];
  const project = resolveProject(cwd, options);
  if (
    !project.isMonorepo
    || path.resolve(project.projectRoot) !== path.resolve(project.repoRoot)
  ) {
    return [];
  }

  const records = [];
  walkForLiveServerFiles(project.repoRoot, (filePath) => {
    const record = readLiveServerInfoFile(filePath);
    if (!record) return;
    if (
      record.info?.repoRoot
      && path.resolve(record.info.repoRoot) !== path.resolve(project.repoRoot)
    ) {
      return;
    }
    records.push(record);
  });
  return records;
}

function walkForLiveServerFiles(root, onFile) {
  const ignoreDirs = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    '.next',
    '.nuxt',
    '.svelte-kit',
    '.turbo',
    '.cache',
    'coverage',
  ]);
  const maxDepth = 5;

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (ignoreDirs.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.name === IMPECCABLE_DIR) {
        const serverPath = path.join(abs, LIVE_DIR, 'server.json');
        if (path.dirname(abs) !== root && fs.existsSync(serverPath)) {
          onFile(serverPath);
        }
        continue;
      }
      walk(abs, depth + 1);
    }
  }

  walk(root, 0);
}

export function isLiveServerPidReachable(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH means "no such process". EPERM means the process exists but this
    // user cannot signal it, so the live server info is still valid.
    return err?.code !== 'ESRCH';
  }
}

export function writeLiveServerInfo(cwd = process.cwd(), info, options = {}) {
  const filePath = getLiveServerPath(cwd, options);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(info));
  return filePath;
}

export function removeLiveServerInfo(cwd = process.cwd(), options = {}) {
  for (const filePath of [getLiveServerPath(cwd, options), getLegacyLiveServerPath(cwd, options)]) {
    try { fs.unlinkSync(filePath); } catch {}
  }
}

export function getLiveSessionsDir(cwd = process.cwd(), options = {}) {
  return path.join(getLiveDir(cwd, options), 'sessions');
}

export function getLegacyLiveSessionsDir(cwd = process.cwd(), options = {}) {
  return path.join(resolveProjectRoot(cwd, options), '.impeccable-live', 'sessions');
}

export function getLiveAnnotationsDir(cwd = process.cwd(), options = {}) {
  return path.join(getLiveDir(cwd, options), 'annotations');
}

export function getCritiqueDir(cwd = process.cwd(), options = {}) {
  return path.join(getImpeccableDir(cwd, options), CRITIQUE_DIR);
}

export function getLegacyLiveAnnotationsDir(cwd = process.cwd(), options = {}) {
  return path.join(resolveProjectRoot(cwd, options), '.impeccable-live', 'annotations');
}

function firstExisting(paths) {
  return paths.find((filePath) => fs.existsSync(filePath)) || null;
}
