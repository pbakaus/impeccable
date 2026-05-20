#!/usr/bin/env node
/**
 * CLI helper: apply pending live copy edits as one AI-owned batch.
 *
 * The browser Save path stages copy edits in .impeccable/live. This script is
 * called by /manual-edit-commit when the user clicks Apply copy edits. It gives
 * the local AI runner the full staged batch plus evidence, validates the files
 * the runner reports touching, and clears only entries reported as applied.
 *
 * Usage:
 *   node live-commit-manual-edits.mjs
 *   node live-commit-manual-edits.mjs --page-url=/
 *
 * Output JSON:
 *   { applied, failed, files, cleared, count, pageUrl }
 */

import { buildManualEditEvidence } from './live-manual-edit-evidence.mjs';
import { readBuffer, writeBuffer, countByPage } from './live-manual-edits-buffer.mjs';
import { isGeneratedFile } from './is-generated.mjs';
import {
  runCopyEditBatchAgent,
  runCopyEditPostApplyChecks,
} from './live-copy-edit-agent.mjs';
import fs from 'node:fs';
import path from 'node:path';

const ROLLBACK_EXTENSIONS = new Set([
  '.astro',
  '.css',
  '.htm',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mdx',
  '.mjs',
  '.scss',
  '.svelte',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.yaml',
  '.yml',
]);
const ROLLBACK_SKIP_DIRS = new Set([
  '.astro',
  '.git',
  '.impeccable',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);

function argVal(args, name) {
  const prefix = name + '=';
  for (const arg of args) {
    if (arg === name) return true;
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}

function countOps(entries) {
  let count = 0;
  for (const entry of entries || []) count += Array.isArray(entry.ops) ? entry.ops.length : 0;
  return count;
}

function summarizeAppliedEntries(entries, appliedEntryIds) {
  const ids = new Set(appliedEntryIds);
  const out = [];
  for (const entry of entries || []) {
    if (!ids.has(entry.id)) continue;
    for (const op of entry.ops || []) {
      out.push({
        id: entry.id,
        ref: op.ref,
        originalText: op.originalText,
        newText: op.newText,
      });
    }
  }
  return out;
}

function normalizeFailedEntries(batch, result, fallbackReason) {
  const failed = [];
  const failedByEntryId = new Map();
  for (const item of result?.failed || []) {
    const entryId = item.entryId || item.id || null;
    if (!entryId) continue;
    failedByEntryId.set(entryId, item);
  }

  for (const entry of batch.entries || []) {
    const item = failedByEntryId.get(entry.id);
    if (!item) continue;
    failed.push({
      id: entry.id,
      reason: item.reason || item.message || fallbackReason || 'failed',
      candidates: Array.isArray(item.candidates) && item.candidates.length > 0
        ? item.candidates
        : candidatesForEntry(batch, entry.id),
    });
  }
  return failed;
}

function candidatesForEntry(batch, entryId) {
  return (batch.candidates || [])
    .filter((candidate) => candidate.entryId === entryId)
    .flatMap((candidate) => [
      ...(candidate.sourceHint ? [candidate.sourceHint] : []),
      ...(candidate.textMatches || []),
      ...(candidate.objectKeyMatches || []),
      ...(candidate.locatorMatches || []),
      ...(candidate.contextTextMatches || []),
    ])
    .slice(0, 12);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
}

function normalizeRelativeFile(cwd, file) {
  if (!file || typeof file !== 'string') return null;
  const absolute = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  const relative = path.relative(cwd, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (!fs.existsSync(absolute)) return null;
  if (isGeneratedFile(absolute, { cwd })) return null;
  return relative;
}

function sourceHintWindowFailure(cwd, op) {
  const hint = op?.sourceHint;
  if (!hint?.file || !hint.line) return null;
  const relative = normalizeRelativeFile(cwd, hint.file);
  if (!relative) return null;
  const absolute = path.resolve(cwd, relative);
  let content;
  try { content = fs.readFileSync(absolute, 'utf-8'); } catch { return null; }
  const lines = content.split('\n');
  const line = Math.max(1, Number(hint.line) || 1);
  const lineText = lines[line - 1] || '';
  if (
    typeof op.originalText === 'string'
    && op.originalText
    && lineText.includes(op.originalText)
    && !lineShowsAppliedOp(lineText, op)
  ) {
    return {
      file: relative,
      line,
      reason: 'source_hint_still_contains_original_text',
    };
  }
  return null;
}

function candidateFilesForOp(batch, op, reportedFiles, cwd) {
  const candidate = (batch.candidates || []).find((item) => item.entryId === op.entryId && item.ref === op.ref);
  const files = [
    ...reportedFiles,
    op.sourceHint?.file,
    candidate?.sourceHint?.relativeFile,
    candidate?.sourceHint?.file,
    ...(candidate?.textMatches || []).map((item) => item.file),
    ...(candidate?.objectKeyMatches || []).map((item) => item.file),
    ...(candidate?.locatorMatches || []).map((item) => item.file),
    ...(candidate?.contextTextMatches || []).map((item) => item.file),
  ];
  return uniqueStrings(files)
    .map((file) => normalizeRelativeFile(cwd, file))
    .filter(Boolean);
}

function verificationTargetsForOp(batch, op, reportedFiles, cwd) {
  const candidate = (batch.candidates || []).find((item) => item.entryId === op.entryId && item.ref === op.ref);
  const out = [];
  const add = (file, line, kind) => {
    const relativeFile = normalizeRelativeFile(cwd, file);
    const lineNumber = Number(line);
    if (!relativeFile || !Number.isFinite(lineNumber) || lineNumber < 1) return;
    out.push({ file: relativeFile, line: lineNumber, kind });
  };

  add(op.sourceHint?.file, op.sourceHint?.line, 'source_hint');
  add(candidate?.sourceHint?.relativeFile || candidate?.sourceHint?.file, candidate?.sourceHint?.line, 'candidate_source_hint');
  for (const item of candidate?.textMatches || []) add(item.file, item.line, 'text_match');
  for (const item of candidate?.objectKeyMatches || []) add(item.file, item.line, 'object_key_match');
  for (const item of candidate?.locatorMatches || []) add(item.file, item.line, 'locator_match');

  for (const relativeFile of reportedFiles || []) {
    for (const target of locatorTargetsInFile(cwd, relativeFile, op)) {
      out.push(target);
    }
  }

  const seen = new Set();
  return out.filter((target) => {
    const key = target.file + ':' + target.line + ':' + target.kind;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function locatorTargetsInFile(cwd, relativeFile, op) {
  if (!opHasLocator(op)) return [];
  const absolute = path.resolve(cwd, relativeFile);
  let lines;
  try { lines = fs.readFileSync(absolute, 'utf-8').split('\n'); } catch { return []; }
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lineMatchesManualEditLocator(lines[index], op)) continue;
    out.push({ file: relativeFile, line: index + 1, kind: 'reported_locator_match' });
    if (out.length >= 20) break;
  }
  return out;
}

function verificationTargetPasses(cwd, target, op) {
  let lines;
  try { lines = fs.readFileSync(path.resolve(cwd, target.file), 'utf-8').split('\n'); } catch { return false; }
  const line = lines[target.line - 1] || '';
  return lineShowsAppliedOp(line, op);
}

function lineShowsAppliedOp(line, op) {
  const originalText = typeof op?.originalText === 'string' ? op.originalText : '';
  const newText = typeof op?.newText === 'string' ? op.newText : '';
  const deletion = op?.deleted === true || newText.length === 0;
  if (deletion) return !!originalText && !line.includes(originalText);
  if (!line.includes(newText)) return false;
  if (originalText && !newText.includes(originalText) && line.includes(originalText)) return false;
  return true;
}

function opHasLocator(op) {
  return !!(
    op?.tag
    || op?.elementId
    || (Array.isArray(op?.classes) && op.classes.filter(Boolean).length > 0)
  );
}

function lineMatchesManualEditLocator(line, op) {
  if (op.tag) {
    const tagRe = new RegExp('<\\s*' + escapeRegExp(op.tag) + '(?=[\\s>/]|$)', 'i');
    if (!tagRe.test(line)) return false;
  }

  if (op.elementId) {
    const idRe = new RegExp('\\bid\\s*=\\s*["\']' + escapeRegExp(op.elementId) + '["\']');
    if (!idRe.test(line)) return false;
  }

  const classes = Array.isArray(op.classes) ? op.classes.filter(Boolean) : [];
  for (const className of classes) {
    if (!line.includes(className)) return false;
  }

  return true;
}

function verifyAppliedEntry({ batch, entry, reportedFiles, cwd }) {
  const failures = [];
  for (const rawOp of entry.ops || []) {
    const op = { ...rawOp, entryId: entry.id };
    if (op.deleted === true && typeof op.newText !== 'string') op.newText = '';
    if (typeof op.newText !== 'string') {
      failures.push({
        ref: op.ref,
        reason: 'source_verification_failed',
        detail: 'missing_newText',
        candidates: candidatesForEntry(batch, entry.id).slice(0, 12),
      });
      continue;
    }
    const targets = verificationTargetsForOp(batch, op, reportedFiles, cwd);
    if (targets.some((target) => verificationTargetPasses(cwd, target, op))) continue;

    const hintedOldText = sourceHintWindowFailure(cwd, op);
    if (hintedOldText) {
      failures.push({
        ref: op.ref,
        reason: 'source_verification_failed',
        detail: hintedOldText.reason,
        candidates: [hintedOldText, ...targets.map((target) => ({ file: target.file, line: target.line, kind: target.kind })), ...candidatesForEntry(batch, entry.id)].slice(0, 12),
      });
      continue;
    }

    failures.push({
      ref: op.ref,
      reason: 'source_verification_failed',
      detail: op.newText.length === 0 ? 'originalText_still_present_in_plausible_source_location' : 'newText_not_found_in_plausible_source_location',
      candidates: targets.map((target) => ({ file: target.file, line: target.line, kind: target.kind })).concat(candidatesForEntry(batch, entry.id)).slice(0, 12),
    });
  }
  return failures;
}

function verificationFailuresForEntries(batch, entries, reason, extra = {}) {
  return entries.map((entry) => ({
    id: entry.id,
    reason,
    candidates: candidatesForEntry(batch, entry.id),
    ...extra,
  }));
}

function clearAppliedEntries(cwd, appliedEntryIds) {
  const ids = new Set(appliedEntryIds);
  if (ids.size === 0) return 0;
  const buffer = readBuffer(cwd);
  let cleared = 0;
  const kept = [];
  for (const entry of buffer.entries || []) {
    if (ids.has(entry.id)) {
      cleared += Array.isArray(entry.ops) ? entry.ops.length : 0;
    } else {
      kept.push(entry);
    }
  }
  writeBuffer(cwd, { version: buffer.version || 1, entries: kept });
  return cleared;
}

function snapshotRollbackFiles(cwd) {
  const snapshot = new Map();
  for (const relativeFile of collectRollbackFiles(cwd)) {
    const absolute = path.resolve(cwd, relativeFile);
    try {
      snapshot.set(relativeFile, {
        content: fs.readFileSync(absolute, 'utf-8'),
      });
    } catch {
      // If we cannot read a file before the AI run, it is not safe to roll back.
    }
  }
  return snapshot;
}

function collectRollbackFiles(cwd) {
  const out = [];
  const seenDirs = new Set();
  const seenFiles = new Set();
  scanRollbackDir(cwd, cwd, out, seenDirs, seenFiles, 0);
  return out;
}

function scanRollbackDir(dir, cwd, out, seenDirs, seenFiles, depth) {
  if (depth > 10) return;
  let realDir;
  try { realDir = fs.realpathSync(dir); } catch { return; }
  if (seenDirs.has(realDir)) return;
  seenDirs.add(realDir);

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ROLLBACK_SKIP_DIRS.has(entry.name)) continue;
      scanRollbackDir(path.join(dir, entry.name), cwd, out, seenDirs, seenFiles, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!ROLLBACK_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const absolute = path.join(dir, entry.name);
    if (isGeneratedFile(absolute, { cwd })) continue;
    let realFile;
    try { realFile = fs.realpathSync(absolute); } catch { continue; }
    if (seenFiles.has(realFile)) continue;
    seenFiles.add(realFile);
    const relative = path.relative(cwd, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    out.push(relative);
  }
}

function changedFilesSinceSnapshot(cwd, snapshot) {
  const changed = new Map();
  const currentFiles = new Set(collectRollbackFiles(cwd));
  for (const [relativeFile, before] of snapshot.entries()) {
    const absolute = path.resolve(cwd, relativeFile);
    if (!fs.existsSync(absolute)) {
      changed.set(relativeFile, { file: relativeFile, kind: 'deleted' });
      continue;
    }
    let content;
    try { content = fs.readFileSync(absolute, 'utf-8'); } catch { continue; }
    if (content !== before.content) {
      changed.set(relativeFile, { file: relativeFile, kind: 'modified' });
    }
  }
  for (const relativeFile of currentFiles) {
    if (!snapshot.has(relativeFile)) {
      changed.set(relativeFile, { file: relativeFile, kind: 'added' });
    }
  }
  return [...changed.values()];
}

function rollbackChangedFiles(cwd, snapshot, extraFiles = []) {
  const changed = changedFilesSinceSnapshot(cwd, snapshot);
  const byFile = new Map(changed.map((item) => [item.file, item]));
  for (const file of extraFiles || []) {
    const relative = normalizeRollbackPath(cwd, file);
    if (relative && !byFile.has(relative)) {
      byFile.set(relative, { file: relative, kind: snapshot.has(relative) ? 'reported' : 'unknown' });
    }
  }

  const rolledBackFiles = [];
  const rollbackFailures = [];
  for (const item of byFile.values()) {
    const absolute = path.resolve(cwd, item.file);
    const before = snapshot.get(item.file);
    try {
      if (before) {
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, before.content, 'utf-8');
      } else if (item.kind === 'added' && fs.existsSync(absolute)) {
        fs.rmSync(absolute);
      } else {
        rollbackFailures.push({ file: item.file, reason: 'no_snapshot' });
        continue;
      }
      rolledBackFiles.push(item.file);
    } catch (err) {
      rollbackFailures.push({ file: item.file, reason: 'restore_failed', message: err.message || String(err) });
    }
  }
  return { rolledBackFiles, rollbackFailures };
}

function normalizeRollbackPath(cwd, file) {
  if (!file || typeof file !== 'string') return null;
  const absolute = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  const relative = path.relative(cwd, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (isGeneratedFile(absolute, { cwd })) return null;
  return relative;
}

export async function commitManualEdits({
  cwd = process.cwd(),
  pageUrl = null,
  provider = undefined,
  env = process.env,
  timeoutMs = undefined,
} = {}) {
  const batch = buildManualEditEvidence({ cwd, pageUrl });
  const count = countOps(batch.entries);
  if (count === 0) {
    return {
      applied: [],
      failed: [],
      files: [],
      cleared: 0,
      count: 0,
      pageUrl,
      reason: 'no_pending_edits',
      ...countByPage(cwd),
    };
  }

  const rollbackSnapshot = snapshotRollbackFiles(cwd);
  let result;
  try {
    result = await runCopyEditBatchAgent(batch, { cwd, provider, env, timeoutMs });
  } catch (err) {
    const rollback = rollbackChangedFiles(cwd, rollbackSnapshot);
    return {
      applied: [],
      failed: batch.entries.map((entry) => ({
        id: entry.id,
        reason: err.message || String(err),
        candidates: candidatesForEntry(batch, entry.id),
      })),
      files: [],
      cleared: 0,
      count,
      pageUrl,
      rolledBackFiles: rollback.rolledBackFiles,
      rollbackFailures: rollback.rollbackFailures,
      ...countByPage(cwd),
    };
  }

  if (result.status === 'error') {
    const rollback = rollbackChangedFiles(cwd, rollbackSnapshot, result.files || []);
    return {
      applied: [],
      failed: normalizeFailedEntries(batch, result, result.message || 'AI copy edit failed'),
      files: result.files || [],
      cleared: 0,
      count,
      pageUrl,
      notes: result.notes || [],
      rolledBackFiles: rollback.rolledBackFiles,
      rollbackFailures: rollback.rollbackFailures,
      ...countByPage(cwd),
    };
  }

  const reportedAppliedIds = uniqueStrings(result.appliedEntryIds || []);
  const reportedFiles = uniqueStrings(result.files || [])
    .map((file) => normalizeRelativeFile(cwd, file))
    .filter(Boolean);
  const aiFailed = normalizeFailedEntries(batch, result, 'AI copy edit failed');

  if (result.status === 'done' && reportedAppliedIds.length === 0) {
    const rollback = rollbackChangedFiles(cwd, rollbackSnapshot, result.files || []);
    return {
      applied: [],
      failed: verificationFailuresForEntries(batch, batch.entries, 'missing_applied_entry_ids'),
      files: result.files || [],
      cleared: 0,
      count,
      pageUrl,
      notes: result.notes || [],
      rolledBackFiles: rollback.rolledBackFiles,
      rollbackFailures: rollback.rollbackFailures,
      ...countByPage(cwd),
    };
  }

  const reportedAppliedEntries = batch.entries.filter((entry) => reportedAppliedIds.includes(entry.id));
  if (reportedAppliedIds.length > 0 && reportedFiles.length === 0) {
    const rollback = rollbackChangedFiles(cwd, rollbackSnapshot, result.files || []);
    return {
      applied: [],
      failed: [
        ...verificationFailuresForEntries(batch, reportedAppliedEntries, 'missing_touched_files'),
        ...aiFailed,
      ],
      files: result.files || [],
      cleared: 0,
      count,
      pageUrl,
      notes: result.notes || [],
      rolledBackFiles: rollback.rolledBackFiles,
      rollbackFailures: rollback.rollbackFailures,
      ...countByPage(cwd),
    };
  }

  const verifiedAppliedIds = [];
  const verificationFailed = [];
  for (const entry of reportedAppliedEntries) {
    const failures = verifyAppliedEntry({ batch, entry, reportedFiles, cwd });
    if (failures.length === 0) {
      verifiedAppliedIds.push(entry.id);
    } else {
      verificationFailed.push({
        id: entry.id,
        reason: 'source_verification_failed',
        failures,
        candidates: candidatesForEntry(batch, entry.id),
      });
    }
  }
  const unreportedEntries = result.status === 'done' || result.status === 'partial'
    ? batch.entries.filter((entry) => !reportedAppliedIds.includes(entry.id) && !aiFailed.some((item) => item.id === entry.id))
    : [];
  const failed = [
    ...verificationFailed,
    ...verificationFailuresForEntries(batch, unreportedEntries, 'not_reported_applied'),
    ...aiFailed,
  ];

  if (verificationFailed.length > 0) {
    const rolledBackVerified = reportedAppliedEntries
      .filter((entry) => verifiedAppliedIds.includes(entry.id))
      .map((entry) => ({
        id: entry.id,
        reason: 'rolled_back_due_to_batch_verification_failure',
        candidates: candidatesForEntry(batch, entry.id),
      }));
    const rollback = rollbackChangedFiles(cwd, rollbackSnapshot, result.files || []);
    return {
      applied: [],
      failed: [
        ...failed,
        ...rolledBackVerified,
      ],
      files: result.files || [],
      cleared: 0,
      count,
      pageUrl,
      rolledBackFiles: rollback.rolledBackFiles,
      rollbackFailures: rollback.rollbackFailures,
      notes: result.notes || [],
      ...countByPage(cwd),
    };
  }

  const postChecks = runCopyEditPostApplyChecks({ cwd, files: result.files || [] });
  if (!postChecks.ok) {
    const rollback = rollbackChangedFiles(cwd, rollbackSnapshot, result.files || []);
    const postCheckEntries = verifiedAppliedIds.length > 0
      ? reportedAppliedEntries.filter((entry) => verifiedAppliedIds.includes(entry.id))
      : batch.entries;
    return {
      applied: [],
      failed: [
        ...postCheckEntries.map((entry) => ({
          id: entry.id,
          reason: 'post_apply_validation_failed',
          checks: postChecks.failures,
          candidates: candidatesForEntry(batch, entry.id),
        })),
        ...failed,
      ],
      files: result.files || [],
      cleared: 0,
      count,
      pageUrl,
      warnings: postChecks.warnings,
      rolledBackFiles: rollback.rolledBackFiles,
      rollbackFailures: rollback.rollbackFailures,
      notes: result.notes || [],
      ...countByPage(cwd),
    };
  }

  const cleared = clearAppliedEntries(cwd, verifiedAppliedIds);
  const counts = countByPage(cwd);
  return {
    applied: summarizeAppliedEntries(batch.entries, verifiedAppliedIds),
    failed,
    files: result.files || [],
    cleared,
    count,
    pageUrl,
    warnings: postChecks.warnings,
    notes: result.notes || [],
    ...counts,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node live-commit-manual-edits.mjs [--page-url=<url>] [--provider=auto|codex|claude|mock]');
    process.exit(0);
  }

  const result = await commitManualEdits({
    cwd: process.cwd(),
    pageUrl: argVal(args, '--page-url'),
    provider: argVal(args, '--provider') || undefined,
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1]?.endsWith('live-commit-manual-edits.mjs')) {
  main().catch((err) => {
    console.error(JSON.stringify({ error: 'commit_failed', message: err.message || String(err) }));
    process.exit(1);
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
