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
  const start = Math.max(0, line - 4);
  const end = Math.min(lines.length, line + 3);
  const windowText = lines.slice(start, end).join('\n');
  if (
    typeof op.originalText === 'string'
    && op.originalText
    && typeof op.newText === 'string'
    && !windowText.includes(op.newText)
    && windowText.includes(op.originalText)
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

function verifyAppliedEntry({ batch, entry, reportedFiles, cwd }) {
  const failures = [];
  for (const rawOp of entry.ops || []) {
    const op = { ...rawOp, entryId: entry.id };
    if (op.deleted === true) continue;
    const hintedOldText = sourceHintWindowFailure(cwd, op);
    if (hintedOldText) {
      failures.push({
        ref: op.ref,
        reason: 'source_verification_failed',
        detail: hintedOldText.reason,
        candidates: [hintedOldText, ...candidatesForEntry(batch, entry.id)].slice(0, 12),
      });
      continue;
    }
    const files = candidateFilesForOp(batch, op, reportedFiles, cwd);
    const found = files.some((relativeFile) => {
      try {
        return fs.readFileSync(path.resolve(cwd, relativeFile), 'utf-8').includes(op.newText);
      } catch {
        return false;
      }
    });
    if (!found) {
      failures.push({
        ref: op.ref,
        reason: 'source_verification_failed',
        detail: 'newText_not_found_in_plausible_source_file',
        candidates: files.map((file) => ({ file })).concat(candidatesForEntry(batch, entry.id)).slice(0, 12),
      });
    }
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

  let result;
  try {
    result = await runCopyEditBatchAgent(batch, { cwd, provider, env, timeoutMs });
  } catch (err) {
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
      ...countByPage(cwd),
    };
  }

  if (result.status === 'error') {
    return {
      applied: [],
      failed: normalizeFailedEntries(batch, result, result.message || 'AI copy edit failed'),
      files: result.files || [],
      cleared: 0,
      count,
      pageUrl,
      notes: result.notes || [],
      ...countByPage(cwd),
    };
  }

  const reportedAppliedIds = uniqueStrings(result.appliedEntryIds || []);
  const reportedFiles = uniqueStrings(result.files || [])
    .map((file) => normalizeRelativeFile(cwd, file))
    .filter(Boolean);
  const aiFailed = normalizeFailedEntries(batch, result, 'AI copy edit failed');

  if (result.status === 'done' && reportedAppliedIds.length === 0) {
    return {
      applied: [],
      failed: verificationFailuresForEntries(batch, batch.entries, 'missing_applied_entry_ids'),
      files: result.files || [],
      cleared: 0,
      count,
      pageUrl,
      notes: result.notes || [],
      ...countByPage(cwd),
    };
  }

  const reportedAppliedEntries = batch.entries.filter((entry) => reportedAppliedIds.includes(entry.id));
  if (reportedAppliedIds.length > 0 && reportedFiles.length === 0) {
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
      ...countByPage(cwd),
    };
  }

  const postChecks = runCopyEditPostApplyChecks({ cwd, files: result.files || [] });
  if (!postChecks.ok) {
    return {
      applied: [],
      failed: batch.entries.map((entry) => ({
        id: entry.id,
        reason: 'post_apply_validation_failed',
        checks: postChecks.failures,
        candidates: candidatesForEntry(batch, entry.id),
      })),
      files: result.files || [],
      cleared: 0,
      count,
      pageUrl,
      warnings: postChecks.warnings,
      notes: result.notes || [],
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
  const unreportedEntries = result.status === 'done'
    ? batch.entries.filter((entry) => !reportedAppliedIds.includes(entry.id) && !aiFailed.some((item) => item.id === entry.id))
    : [];
  const failed = [
    ...verificationFailed,
    ...verificationFailuresForEntries(batch, unreportedEntries, 'not_reported_applied'),
    ...aiFailed,
  ];

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
