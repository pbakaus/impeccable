/**
 * Crash-safe injection journal.
 *
 * Injection writes into the user's source tree: generated components, a Nuxt
 * client plugin, marker blocks inside a layout, a patched CSP meta tag. The
 * clean path removes all of it on stop. The unclean paths do not:
 *
 *   - the dev server is SIGKILLed, so `--remove` never runs;
 *   - the project changes shape between start and stop (a nuxt.config appears,
 *     a package.json is edited), so detection resolves a different framework
 *     and the old framework's artifacts are nobody's business;
 *   - stop runs from a different directory than start did.
 *
 * So every inject records what it wrote to `.impeccable/live/inject-journal.json`
 * before the next one runs, and both inject and `--remove` reconcile that
 * record against the tree.
 *
 * **The journal is a claim of ownership, not a to-do list.** Healing an
 * artifact only ever removes what still carries our marker; a generated file
 * the user has since replaced, or a layout they have since un-patched by hand,
 * is dropped from the journal untouched.
 *
 * **Path resolution is appRoot-relative.** Live entry scripts chdir onto the
 * roots manifest (`enterLiveRoot`) before doing anything, so a journal written
 * by a session started in the app root is found by a stop issued from any
 * directory inside the repo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PATCH_UNDOERS } from './index.mjs';

export const INJECT_JOURNAL_VERSION = 1;
export const INJECT_JOURNAL_RELPATH = '.impeccable/live/inject-journal.json';

export function injectJournalPath(cwd = process.cwd()) {
  return path.join(cwd, ...INJECT_JOURNAL_RELPATH.split('/'));
}

export function readInjectJournal(cwd = process.cwd()) {
  const file = injectJournalPath(cwd);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.artifacts)) return null;
  return raw;
}

export function clearInjectJournal(cwd = process.cwd()) {
  try { fs.unlinkSync(injectJournalPath(cwd)); } catch { /* already gone */ }
}

function writeInjectJournal(cwd, journal) {
  const file = injectJournalPath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(journal, null, 2) + '\n', 'utf-8');
  return file;
}

/**
 * Record the artifacts an injection just wrote. Replaces any previous record:
 * callers heal first (see healInjectJournal), so nothing survivable is lost.
 */
export function recordInjection(cwd = process.cwd(), { framework, port, artifacts = [] } = {}) {
  if (!artifacts.length) {
    clearInjectJournal(cwd);
    return null;
  }
  return writeInjectJournal(cwd, {
    version: INJECT_JOURNAL_VERSION,
    appRoot: path.resolve(cwd),
    framework: framework || null,
    port: Number.isFinite(Number(port)) ? Number(port) : null,
    pid: process.pid,
    recordedAt: new Date().toISOString(),
    artifacts,
  });
}

function normalizeRel(cwd, rel) {
  return path.resolve(cwd, String(rel || '')).split(path.sep).join('/');
}

function readIfPresent(abs) {
  try {
    return fs.readFileSync(abs, 'utf-8');
  } catch {
    return null;
  }
}

function pruneEmptyDirs(dir, stopDir) {
  let current = path.resolve(dir);
  const stop = path.resolve(stopDir);
  while (current !== stop && current.startsWith(stop + path.sep)) {
    try {
      if (fs.readdirSync(current).length > 0) return;
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

function insideProject(cwd, abs) {
  const rel = path.relative(path.resolve(cwd), path.resolve(abs));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function healArtifact(cwd, artifact, undoers) {
  const abs = path.resolve(cwd, artifact.path);
  // The journal is a project-local file, i.e. attacker-writable input in a
  // cloned repo. Never touch anything outside the project tree, whatever the
  // journal claims to own.
  if (!insideProject(cwd, abs)) return { path: artifact.path, action: 'refused_outside_project' };
  const content = readIfPresent(abs);
  if (content === null) return { path: artifact.path, action: 'absent' };

  if (artifact.kind === 'created') {
    // Only reclaim a generated file that still carries our marker; a created
    // artifact with no marker at all is unverifiable and stays untouched.
    if (!artifact.marker || !content.includes(artifact.marker)) {
      return { path: artifact.path, action: 'disowned' };
    }
    try { fs.rmSync(abs, { force: true }); } catch { return null; }
    if (artifact.pruneTo !== undefined) {
      const pruneRoot = path.resolve(cwd, artifact.pruneTo || '.');
      if (insideProject(cwd, pruneRoot) || pruneRoot === path.resolve(cwd)) {
        pruneEmptyDirs(path.dirname(abs), pruneRoot);
      }
    }
    return { path: artifact.path, action: 'removed' };
  }

  if (artifact.kind === 'patched') {
    const markers = Array.isArray(artifact.markers) ? artifact.markers : [];
    // No marker left means the patch is already gone; never run an undo over
    // a file we no longer recognize (the undoers normalize whitespace).
    if (markers.length && !markers.some((marker) => content.includes(marker))) {
      return { path: artifact.path, action: 'disowned' };
    }
    const undo = undoers[artifact.patch];
    if (typeof undo !== 'function') return null;
    const next = undo(content);
    if (next === content) return { path: artifact.path, action: 'disowned' };
    try { fs.writeFileSync(abs, next, 'utf-8'); } catch { return null; }
    return { path: artifact.path, action: 'unpatched' };
  }

  return null;
}

/**
 * Reconcile the journal against the tree.
 *
 * `keep` is the set of paths the current operation legitimately owns — the
 * artifacts an inject is about to (re)write. Everything else in the journal is
 * an orphan of a session that is gone, and gets healed. This keeps a repeat
 * inject byte-idempotent: the artifacts it is about to rewrite are kept, not
 * torn down and rebuilt.
 *
 * Returns `{ healed, kept }`. `healed` lists only artifacts whose file was
 * actually changed or removed, so callers can stay silent when nothing was
 * orphaned. Idempotent: a second call finds an empty journal.
 */
export function healInjectJournal(cwd = process.cwd(), { keep = [], undoers = PATCH_UNDOERS } = {}) {
  const journal = readInjectJournal(cwd);
  if (!journal) return { healed: [], kept: [] };

  const keepSet = new Set(keep.map((rel) => normalizeRel(cwd, rel)));
  const healed = [];
  const kept = [];

  for (const artifact of journal.artifacts) {
    if (!artifact || typeof artifact.path !== 'string') continue;
    if (keepSet.has(normalizeRel(cwd, artifact.path))) {
      kept.push(artifact);
      continue;
    }
    const outcome = healArtifact(cwd, artifact, undoers);
    if (outcome && (outcome.action === 'removed' || outcome.action === 'unpatched')) {
      healed.push(outcome);
    }
  }

  if (kept.length) {
    writeInjectJournal(cwd, { ...journal, artifacts: kept });
  } else {
    clearInjectJournal(cwd);
  }

  return { healed, kept };
}
