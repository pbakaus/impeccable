import fs from 'node:fs';
import path from 'node:path';
import { resolveProjectRoot } from '../context.mjs';
import { designSidecarCandidatesFor } from './staleness.mjs';
export { IMPECCABLE_COMMAND_PREFIX } from './provider.mjs';

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
  return designSidecarCandidatesFor(resolveProjectRoot(cwd, options), contextDir);
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
    try {
      const info = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (info && typeof info.pid === 'number' && !isLiveServerPidReachable(info.pid)) {
        try { fs.unlinkSync(filePath); } catch {}
        continue;
      }
      return { info, path: filePath };
    } catch {
      /* try next */
    }
  }
  return null;
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

/**
 * Session IDs become path segments (journals, snapshots, accept receipts,
 * preview manifests, generated component dirs). They arrive from CLI `--id`
 * arguments and HTTP payloads, so anything containing a separator or `..` must
 * be rejected before it reaches path.join, which would happily escape
 * `.impeccable/live/`. Real IDs are 8 hex chars; the tests use short slugs.
 */
export function safeSessionId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new Error('invalid session id: ' + id);
  }
  return id;
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
