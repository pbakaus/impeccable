#!/usr/bin/env node
/**
 * CLI helper: commit pending manual edits from the buffer to source.
 *
 * Reads .impeccable/live/pending-manual-edits.json, then for each entry shells
 * out to live-edit.mjs (which handles the actual source-file rewrite). On a
 * successful entry, drops it from the buffer. Failed entries stay in the
 * buffer so the user can fix the underlying source mismatch and retry.
 *
 * Trigger: only when the user explicitly asks the AI to commit manual edits.
 * Never run as a side effect of other operations.
 *
 * Usage:
 *   node live-commit-manual-edits.mjs              # commit all pages
 *   node live-commit-manual-edits.mjs --page-url=/ # commit only entries for "/"
 *
 * Output JSON:
 *   { applied: [...], failed: [...], files: [...], cleared: bool, reason?: 'no_pending_edits' }
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readBuffer, writeBuffer } from './live-manual-edits-buffer.mjs';

function argVal(args, name) {
  const prefix = name + '=';
  for (const a of args) {
    if (a === name) return true;
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EDIT_SCRIPT = path.join(__dirname, 'live-edit.mjs');

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node live-commit-manual-edits.mjs [--page-url=<url>]');
  process.exit(0);
}

const pageUrlFilter = argVal(args, '--page-url');
const cwd = process.cwd();

const buffer = readBuffer(cwd);
const entries = pageUrlFilter
  ? buffer.entries.filter((e) => e.pageUrl === pageUrlFilter)
  : buffer.entries;

if (entries.length === 0) {
  console.log(JSON.stringify({
    cleared: false,
    reason: 'no_pending_edits',
    applied: [],
    failed: [],
    files: [],
  }));
  process.exit(0);
}

const applied = [];
const failed = [];
const filesTouched = new Set();
const committedEntryIds = new Set();

for (const entry of entries) {
  let result;
  try {
    const opsWithContext = entry.ops.map((op) => ({
      ...op,
      contextHints: buildContextHints(entry, op),
    }));
    const out = execFileSync(
      'node',
      [EDIT_SCRIPT, '--id', entry.id, '--ops', JSON.stringify(opsWithContext)],
      { encoding: 'utf-8', cwd, timeout: 30_000 }
    );
    result = JSON.parse(out.trim());
  } catch (err) {
    failed.push({ id: entry.id, pageUrl: entry.pageUrl, reason: 'edit_script_error', message: err.message });
    continue;
  }
  if (Array.isArray(result.files)) for (const f of result.files) filesTouched.add(f);
  if (Array.isArray(result.applied)) for (const a of result.applied) applied.push({ ...a, pageUrl: entry.pageUrl });
  if (Array.isArray(result.failed) && result.failed.length > 0) {
    for (const f of result.failed) failed.push({ ...f, id: entry.id, pageUrl: entry.pageUrl });
    // Entry has some failures: keep the failed ops in the buffer, drop the
    // applied ones. We re-walk: keep ops whose ref shows up in result.failed.
    const failedRefs = new Set(result.failed.map((f) => f.op?.ref).filter(Boolean));
    entry.ops = entry.ops.filter((op) => failedRefs.has(op.ref));
    if (entry.ops.length === 0) committedEntryIds.add(entry.id);
  } else {
    committedEntryIds.add(entry.id);
  }
}

// Rewrite the buffer: drop fully-committed entries; keep entries with
// remaining (failed) ops.
const remainingEntries = [];
for (const entry of buffer.entries) {
  if (pageUrlFilter && entry.pageUrl !== pageUrlFilter) {
    remainingEntries.push(entry);
    continue;
  }
  if (committedEntryIds.has(entry.id)) continue;
  // Find the (possibly mutated) entry from above to preserve failed-only ops.
  const updated = entries.find((e) => e.id === entry.id) || entry;
  if (updated.ops.length > 0) remainingEntries.push(updated);
}
writeBuffer(cwd, { entries: remainingEntries });

console.log(JSON.stringify({
  cleared: failed.length === 0,
  applied,
  failed,
  files: [...filesTouched],
}));

function buildContextHints(entry, op) {
  const hints = new Set();
  const element = entry?.element || {};
  const originalText = typeof op?.originalText === 'string' ? normalizeText(op.originalText) : '';
  const newText = typeof op?.newText === 'string' ? normalizeText(op.newText) : '';

  const add = (value) => {
    const text = normalizeText(decodeBasicHtml(String(value || '')));
    if (text.length < 3 || text.length > 160) return;
    if (text === originalText || text === newText) return;
    hints.add(text);
  };

  const outer = typeof element.outerHTML === 'string' ? element.outerHTML : '';
  for (const match of outer.matchAll(/data-impeccable-original-text="([^"]*)"/g)) {
    add(match[1]);
  }

  if (typeof element.textContent === 'string') {
    for (const chunk of element.textContent.split(/\s{2,}|\n|\t/)) add(chunk);
  }

  return [...hints].slice(0, 12);
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function decodeBasicHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
