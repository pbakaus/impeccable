import { execFileSync } from 'node:child_process';
import path from 'node:path';

const PREFLIGHT_TIMEOUT_MS = 15_000;

export function buildGenerationPreflight(event, scriptsDir, { isolated = false } = {}) {
  if (!event || event.type !== 'generate' || !event.id) return null;

  const isInsert = event.mode === 'insert';
  const target = isInsert ? insertTarget(event) : replaceTarget(event);
  if (!target.elementId && !target.classes) return null;

  const script = path.join(scriptsDir, isInsert ? 'live-insert.mjs' : 'live-wrap.mjs');
  const args = [script, '--id', event.id, '--count', String(event.count || 3)];
  if (!isInsert && isolated) args.push('--isolated');
  if (isInsert) args.push('--position', target.position);
  if (target.elementId) args.push('--element-id', target.elementId);
  if (target.classes) args.push('--classes', target.classes);
  if (target.tag) args.push('--tag', target.tag);
  if (target.text) args.push('--text', target.text);
  if (!isInsert && event.pageUrl) args.push('--page-url', event.pageUrl);
  return { script, args, mode: isInsert ? 'insert' : 'replace' };
}

export function runGenerationPreflight(event, {
  cwd = process.cwd(),
  scriptsDir,
  execFileSyncImpl = execFileSync,
  timeoutMs = PREFLIGHT_TIMEOUT_MS,
  isolated = false,
} = {}) {
  const command = buildGenerationPreflight(event, scriptsDir, { isolated });
  if (!command) {
    return { ok: false, skipped: true, reason: 'insufficient_locator' };
  }

  const startedAt = performance.now();
  try {
    const stdout = execFileSyncImpl(process.execPath, command.args, {
      cwd,
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const line = String(stdout).trim().split('\n').filter(Boolean).pop();
    if (!line) throw new Error('preflight returned no scaffold metadata');
    return {
      ok: true,
      mode: command.mode,
      durationMs: performance.now() - startedAt,
      scaffold: JSON.parse(line),
    };
  } catch (error) {
    return {
      ok: false,
      mode: command.mode,
      durationMs: performance.now() - startedAt,
      error: compactError(error),
    };
  }
}

function replaceTarget(event) {
  return normalizeTarget(event.element || {});
}

function insertTarget(event) {
  return {
    ...normalizeTarget(event.insert?.anchor || {}),
    position: event.insert?.position === 'before' ? 'before' : 'after',
  };
}

function normalizeTarget(target) {
  const classes = Array.isArray(target.classes)
    ? target.classes.join(' ')
    : String(target.classes || '').trim();
  const text = typeof target.textContent === 'string'
    ? target.textContent.trim().slice(0, 80)
    : '';
  return {
    elementId: target.id || target.elementId || undefined,
    classes: classes || undefined,
    tag: target.tagName || target.tag || undefined,
    text: text || undefined,
  };
}

function compactError(error) {
  const stderr = error?.stderr ? String(error.stderr).trim() : '';
  const message = stderr.split('\n').filter(Boolean).pop() || error?.message || 'preflight failed';
  return String(message).slice(0, 500);
}
