/**
 * Notice throttling and directive rendering for staleness findings.
 *
 * The boot path already carries PRODUCT.md, DESIGN.md, a surface brief,
 * RESOLVED_CONTEXT, the detector fallback, native platform references, and the
 * update directive. An unthrottled staleness block would push real context out
 * of attention and train the agent to open every session with housekeeping, so
 * the rules here are deliberately strict:
 *
 *   - One directive for the whole set, never one per finding.
 *   - A 'mention' or 'route' finding surfaces at most once a week per project,
 *     mirroring the update check's anti-nag window. A finding the user has
 *     already declined to act on must not reappear tomorrow.
 *   - 'auto' findings are not throttled and are not shown to the user. They are
 *     migrations the next write performs anyway, so the agent needs the note
 *     every session until the write happens, and the user needs it never.
 *
 * State lives in the user's home dir alongside the update cache rather than in
 * the project, so no gitignore entry is owed and a clone does not inherit
 * someone else's dismissals.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RENOTIFY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// Resolved per call rather than at import so a test (or a sandboxed run) can
// redirect the cache without reloading the module.
function cachePath() {
  return process.env.IMPECCABLE_STALENESS_CACHE
    || path.join(os.homedir(), '.impeccable', 'staleness-check.json');
}

function readCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(), 'utf-8'));
    return raw && typeof raw === 'object' && raw.projects ? raw : { projects: {} };
  } catch {
    return { projects: {} };
  }
}

/**
 * Drop project entries whose newest stamp has aged past the renotify window.
 * They would be re-notified on the next boot anyway, so keeping them only lets
 * the file accumulate one entry per directory Impeccable has ever booted in
 * (scratch dirs and test fixtures included).
 */
function pruneCache(cache, now) {
  const projects = {};
  for (const [key, entries] of Object.entries(cache.projects || {})) {
    if (!entries || typeof entries !== 'object') continue;
    const stamps = Object.values(entries).filter((value) => typeof value === 'number');
    if (stamps.length && now - Math.max(...stamps) < RENOTIFY_INTERVAL_MS) projects[key] = entries;
  }
  return { projects };
}

function writeCache(cache) {
  try {
    const filePath = cachePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(cache));
  } catch {
    // Best-effort. A read-only home dir means the notice repeats next session,
    // which is strictly better than failing the boot.
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Opt out with IMPECCABLE_NO_STALENESS_CHECK=1 or `"stalenessCheck": false` in
 * .impeccable/config.json. Local config overrides shared, matching how
 * updateCheck resolves.
 */
export function stalenessCheckDisabled(roots = [process.cwd()]) {
  if (process.env.IMPECCABLE_NO_STALENESS_CHECK) return true;
  let value;
  for (const root of roots) {
    if (!root) continue;
    for (const name of ['config.json', 'config.local.json']) {
      const raw = readJson(path.join(root, '.impeccable', name));
      if (raw && typeof raw === 'object' && typeof raw.stalenessCheck === 'boolean') {
        value = raw.stalenessCheck;
      }
    }
  }
  return value === false;
}

/**
 * Drop findings already surfaced for this project inside the renotify window,
 * and stamp the ones that survive. 'auto' findings pass through untouched and
 * unstamped: they are for the agent, not the user, and repeat until fixed.
 */
export function filterFreshFindings(findings, { projectRoot, now = Date.now() } = {}) {
  if (!findings.length) return [];
  const auto = findings.filter((entry) => entry.severity === 'auto');
  const notifiable = findings.filter((entry) => entry.severity !== 'auto');
  if (!notifiable.length) return auto;

  const key = path.resolve(projectRoot || process.cwd());
  const cache = readCache();
  const seen = cache.projects[key] && typeof cache.projects[key] === 'object' ? cache.projects[key] : {};

  const fresh = notifiable.filter((entry) => {
    const last = seen[entry.id];
    return !(typeof last === 'number' && now - last < RENOTIFY_INTERVAL_MS);
  });

  // Forget stamps for findings that no longer fire, so a recurrence after a
  // real fix is reported again instead of being suppressed by an old stamp.
  // This has to run even when nothing is fresh: the common shape is one
  // finding fixed while another is still inside its window.
  const live = new Set(notifiable.map((entry) => entry.id));
  const next = Object.fromEntries(
    Object.entries(seen).filter(([id]) => live.has(id)),
  );
  for (const entry of fresh) next[entry.id] = now;

  const changed = JSON.stringify(next) !== JSON.stringify(seen);
  if (changed) {
    const pruned = pruneCache(cache, now);
    pruned.projects[key] = next;
    writeCache(pruned);
  }
  return [...auto, ...fresh];
}

/**
 * Render the single boot directive, or null when nothing survived throttling.
 */
export function buildStalenessDirective(findings) {
  if (!findings.length) return null;
  const payload = findings.map((entry) => ({
    id: entry.id,
    artifact: entry.artifact,
    path: entry.path,
    severity: entry.severity,
    summary: entry.summary,
    fix: entry.fix,
  }));

  const hasReportable = findings.some((entry) => entry.severity !== 'auto');
  const lines = [
    `CONTEXT_STALE:\n${JSON.stringify(payload, null, 2)}`,
    "Impeccable's own project files have drifted from what this version reads. "
      + 'Do not stop, reorder, or expand the requested task for any of this.',
    'By severity: `auto` is a migration the next write to that file performs anyway, so apply it then and do not '
      + 'raise it with the user. `mention` gets one short line in your reply with the offered fix. `route` names the '
      + 'command that owns the repair; offer it, and run it only if the user asks.',
    'A finding that reports a deprecated field is binding: treat that field as absent for every decision in this '
      + 'session, whatever value it holds.',
  ];
  if (hasReportable) {
    lines.push('Surface the reportable findings once, after the task response, in at most two sentences. '
      + 'They are already throttled, so say them plainly rather than hedging about whether they matter.');
  }
  return lines.join(' ');
}
