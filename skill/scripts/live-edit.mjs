/**
 * CLI helper: apply manual text edits from the Live-Bar text panel back to
 * source. Auto-handled by live-poll.mjs the same way live-accept.mjs is.
 *
 * Usage:
 *   node live-edit.mjs --id ID --ops '<json-array>' [--file PATH]
 *
 * Each op is one of:
 *   { ref, tag, elementId?, classes?, originalText, newText }      // text replace
 *   { ref, tag, elementId?, classes?, originalText, deleted: true } // block delete
 *
 * The locator reuses live-wrap.mjs's buildSearchQueries + findFileWithQuery +
 * findAllElements + filterByText. Text replace constrains to the matched
 * element's source range so an `originalText` that appears elsewhere isn't
 * touched. Delete uses findClosingLine and refuses (unsafe_delete) when the
 * resolved close-line doesn't carry a literal `</tag>` for the expected tag.
 *
 * Output: JSON { ok, files, applied, failed }. live-poll prints the event with
 * `_editResult` attached when failed.length > 0 so the agent can fix the
 * remaining ops with the Edit tool.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isGeneratedFile } from './is-generated.mjs';
import {
  buildSearchQueries,
  findAllElements,
  filterByText,
  findClosingLine,
  findFileWithQuery,
} from './live-wrap.mjs';

const TEXT_FALLBACK_EXTENSIONS = new Set(['.html', '.jsx', '.tsx', '.vue', '.svelte', '.astro', '.js', '.mjs', '.ts']);
const JS_REFERENCE_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.jsx', '.tsx']);
const TEXT_FALLBACK_SEARCH_DIRS = ['src', 'app', 'pages', 'components', 'public', 'views', 'templates', 'site', 'lib', 'data'];
const TEXT_FALLBACK_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.impeccable',
  '.astro',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'dist',
  'build',
  'out',
  'coverage',
]);
const IDENTITY_PROPERTY_NAMES = new Set([
  'area',
  'category',
  'command',
  'dimension',
  'id',
  'key',
  'kind',
  'name',
  'skill',
  'slug',
  'type',
]);

export async function editCli() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node live-edit.mjs --id ID --ops <json-array> [--file PATH]');
    process.exit(0);
  }

  const id = argVal(args, '--id');
  const opsRaw = argVal(args, '--ops');
  const explicitFile = argVal(args, '--file');

  if (!id) { fatal('missing --id'); }
  if (!opsRaw) { fatal('missing --ops'); }

  let ops;
  try { ops = JSON.parse(opsRaw); }
  catch (err) { fatal('--ops must be valid JSON: ' + err.message); }
  if (!Array.isArray(ops) || ops.length === 0) fatal('--ops must be a non-empty array');

  const cwd = process.cwd();
  const genOpts = { cwd };

  // Group resolved ops by file so we write each file once.
  const byFile = new Map();
  const failed = [];

  for (const op of ops) {
    const fallback = !explicitFile ? resolveTextFallback(op, cwd, genOpts) : { ok: false, reason: null };
    const located = fallback.ok ? fallback : resolveOp(op, explicitFile, cwd, genOpts);
    if (!located.ok) {
      failed.push({
        ref: op.ref,
        op: publicOp(op),
        reason: fallback.reason || located.reason,
        candidates: fallback.candidates || located.candidates,
      });
      continue;
    }
    const { file, match } = located;
    if (!byFile.has(file)) {
      byFile.set(file, { content: fs.readFileSync(file, 'utf-8'), ops: [] });
    }
    byFile.get(file).ops.push({ op, match });
  }

  const applied = [];
  const filesWritten = [];
  const changedFiles = new Map();
  const referenceChanges = [];

  for (const [file, state] of byFile) {
    // Apply bottom-up so earlier line indices remain valid as content above is
    // unchanged. We re-derive `lines` after each op since content shifts.
    state.ops.sort((a, b) => matchSortKey(b.match) - matchSortKey(a.match));
    let content = state.content;
    let changed = false;
    const appliedForFile = [];
    for (const { op, match } of state.ops) {
      if (match.type === 'literal') {
        const result = applyLiteralTextReplace(content, op, match, file);
        if (!result.ok) {
          const failEntry = { ref: op.ref, op: publicOp(op), reason: result.reason, file };
          if (result.forbidden) failEntry.forbidden = result.forbidden;
          failed.push(failEntry);
          continue;
        }
        content = result.content;
        changed = true;
        if (result.referenceChange) {
          referenceChanges.push({
            ...result.referenceChange,
            ref: op.ref,
            op: publicOp(op),
            sourceFile: file,
          });
        }
        appliedForFile.push({ ref: op.ref, op: publicOp(op), file: path.relative(cwd, file), line: result.line });
        continue;
      }
      // Re-resolve match coordinates against the current content state. The
      // initial match came from the original buffer; for bottom-up application,
      // those indices are still valid for ops above the previous edit, but a
      // safer move is to recompute lines on the current content.
      const lines = content.split('\n');
      const adjusted = adjustMatch(lines, op, match);
      if (!adjusted) {
        failed.push({ ref: op.ref, op: publicOp(op), reason: 'lost_after_prior_op', file });
        continue;
      }
      const result = op.deleted === true
        ? applyDelete(content, lines, op, adjusted)
        : applyTextReplace(content, lines, op, adjusted);
      if (!result.ok) {
        const failEntry = { ref: op.ref, op: publicOp(op), reason: result.reason, file };
        if (result.forbidden) failEntry.forbidden = result.forbidden;
        if (result.occurrences) failEntry.occurrences = result.occurrences;
        failed.push(failEntry);
        continue;
      }
      content = result.content;
      changed = true;
      appliedForFile.push({ ref: op.ref, op: publicOp(op), file: path.relative(cwd, file), line: adjusted.startLine + 1 });
    }
    if (changed) {
      changedFiles.set(file, { content, applied: appliedForFile });
    }
  }

  const referenceCleanup = applyReferenceIntegrityCleanup(cwd, changedFiles, referenceChanges, genOpts);
  if (!referenceCleanup.ok) {
    const affected = collectAppliedForChangedFiles(changedFiles);
    for (const appliedOp of affected) {
      failed.push({
        ref: appliedOp.ref,
        op: appliedOp.op,
        reason: referenceCleanup.reason,
        message: referenceCleanup.message,
        file: path.join(cwd, appliedOp.file),
      });
    }
  } else {
    const validationFailures = [];
    for (const [file, state] of changedFiles) {
      const validation = validateChangedFileContent(file, state.content);
      if (!validation.ok) validationFailures.push({ file, validation });
    }

    if (validationFailures.length > 0) {
      const affected = collectAppliedForChangedFiles(changedFiles);
      const first = validationFailures[0];
      for (const appliedOp of affected) {
        failed.push({
          ref: appliedOp.ref,
          op: appliedOp.op,
          reason: first.validation.reason,
          message: first.validation.message,
          file: first.file,
        });
      }
    } else {
      for (const [file, state] of changedFiles) {
        fs.writeFileSync(file, state.content);
        filesWritten.push(path.relative(cwd, file));
        applied.push(...state.applied);
      }
    }
  }

  console.log(JSON.stringify({ ok: true, files: filesWritten, applied, failed }));
}

function resolveOp(op, explicitFile, cwd, genOpts) {
  if (!op || typeof op !== 'object') return { ok: false, reason: 'invalid_op' };
  if (!op.tag) return { ok: false, reason: 'missing_tag' };
  if (typeof op.originalText !== 'string') return { ok: false, reason: 'missing_originalText' };

  const elementId = op.elementId || null;
  const classes = Array.isArray(op.classes) ? op.classes.join(',') : (op.classes || null);
  if (!elementId && !classes) {
    // Tag alone is too broad to disambiguate safely.
    return { ok: false, reason: 'insufficient_locator' };
  }

  const queries = buildSearchQueries(elementId, classes, op.tag, null);

  let targetFile = explicitFile;
  if (!targetFile) {
    for (const q of queries) {
      targetFile = findFileWithQuery(q, cwd, genOpts);
      if (targetFile) break;
    }
    if (!targetFile) return { ok: false, reason: 'element_not_found' };
  }

  if (isGeneratedFile(targetFile, genOpts)) {
    return { ok: false, reason: 'file_is_generated' };
  }

  const content = fs.readFileSync(targetFile, 'utf-8');
  const lines = content.split('\n');

  const candidates = [];
  for (const q of queries) {
    const all = findAllElements(lines, q, op.tag);
    for (const c of all) {
      if (!candidates.some((x) => x.startLine === c.startLine)) candidates.push(c);
    }
    if (candidates.length === 1) break;
  }
  if (candidates.length === 0) return { ok: false, reason: 'element_not_found' };

  let match;
  if (candidates.length === 1) {
    match = candidates[0];
  } else {
    const filtered = filterByText(candidates, lines, op.originalText);
    if (filtered.length === 1) match = filtered[0];
    else if (filtered.length === 0) match = candidates[0]; // dynamic/templated text — fall back
    else return {
      ok: false,
      reason: 'element_ambiguous',
      candidates: filtered.map((c) => ({ startLine: c.startLine + 1, endLine: c.endLine + 1 })),
    };
  }

  return { ok: true, file: targetFile, match };
}

function resolveTextFallback(op, cwd, genOpts) {
  if (!op || op.deleted === true) return { ok: false, reason: null };
  if (typeof op.originalText !== 'string' || typeof op.newText !== 'string') return { ok: false, reason: null };
  if (op.originalText.length === 0) return { ok: false, reason: null };

  const hints = Array.isArray(op.contextHints)
    ? op.contextHints.map((hint) => normalizeHint(hint)).filter(Boolean)
    : [];
  const hasLocator = hasLocatorSignal(op);

  const candidates = findTextFallbackCandidates(op.originalText, cwd, genOpts);
  if (candidates.length === 0) return { ok: false, reason: null };
  if (candidates.length === 1) {
    if (hints.length > 0 || (hasLocator && isSafeUnhintedFallbackCandidate(candidates[0]))) {
      return { ok: true, file: candidates[0].file, match: candidates[0] };
    }
    return { ok: false, reason: null };
  }

  if (hints.length === 0) {
    return hasLocator
      ? { ok: false, reason: 'text_fallback_ambiguous', candidates: summarizeLiteralCandidates(candidates) }
      : { ok: false, reason: null };
  }

  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreTextFallbackCandidate(candidate, hints),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      ok: false,
      reason: 'text_fallback_no_context_match',
      candidates: summarizeLiteralCandidates(candidates),
    };
  }

  const topScore = scored[0].score;
  const top = scored.filter((candidate) => candidate.score === topScore);
  if (top.length !== 1) {
    return {
      ok: false,
      reason: 'text_fallback_ambiguous',
      candidates: summarizeLiteralCandidates(top),
    };
  }

  return { ok: true, file: top[0].file, match: top[0] };
}

function hasLocatorSignal(op) {
  if (!op || typeof op !== 'object') return false;
  if (op.elementId) return true;
  if (Array.isArray(op.classes)) return op.classes.length > 0;
  return typeof op.classes === 'string' && op.classes.trim().length > 0;
}

function isSafeUnhintedFallbackCandidate(candidate) {
  const before = String(candidate.contextBefore || '').slice(-1);
  const after = String(candidate.contextAfter || '').slice(0, 1);
  if (before && before === after && (before === '"' || before === "'" || before === '`')) return true;
  return before === '>' && after === '<';
}

function findTextFallbackCandidates(originalText, cwd, genOpts) {
  const out = [];
  const seenDirs = new Set();
  const seenFiles = new Set();

  for (const dir of TEXT_FALLBACK_SEARCH_DIRS) {
    const absDir = path.join(cwd, dir);
    scanTextFallbackDir(absDir, originalText, cwd, genOpts, seenDirs, seenFiles, out, 0);
  }
  scanTextFallbackRootFiles(cwd, originalText, genOpts, seenFiles, out);

  return out;
}

function scanTextFallbackDir(dir, originalText, cwd, genOpts, seenDirs, seenFiles, out, depth) {
  if (depth > 7 || !fs.existsSync(dir)) return;
  let realDir;
  try { realDir = fs.realpathSync(dir); } catch { return; }
  if (seenDirs.has(realDir)) return;
  seenDirs.add(realDir);

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (TEXT_FALLBACK_SKIP_DIRS.has(entry.name)) continue;
      scanTextFallbackDir(fullPath, originalText, cwd, genOpts, seenDirs, seenFiles, out, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!TEXT_FALLBACK_EXTENSIONS.has(ext)) continue;
    let realFile;
    try { realFile = fs.realpathSync(fullPath); } catch { continue; }
    if (seenFiles.has(realFile)) continue;
    seenFiles.add(realFile);
    if (isGeneratedFile(fullPath, genOpts)) continue;

    let content;
    try { content = fs.readFileSync(fullPath, 'utf-8'); } catch { continue; }
    for (const index of findLiteralOccurrences(content, originalText)) {
      out.push({
        type: 'literal',
        file: fullPath,
        startIndex: index,
        endIndex: index + originalText.length,
        originalText,
        contextBefore: content.slice(Math.max(0, index - 500), index),
        contextAfter: content.slice(index + originalText.length, Math.min(content.length, index + originalText.length + 500)),
        window: content.slice(Math.max(0, index - 500), Math.min(content.length, index + originalText.length + 500)),
        line: lineForIndex(content, index),
      });
    }
  }
}

function scanTextFallbackRootFiles(cwd, originalText, genOpts, seenFiles, out) {
  let entries;
  try { entries = fs.readdirSync(cwd, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!TEXT_FALLBACK_EXTENSIONS.has(ext)) continue;
    const fullPath = path.join(cwd, entry.name);
    let realFile;
    try { realFile = fs.realpathSync(fullPath); } catch { continue; }
    if (seenFiles.has(realFile)) continue;
    seenFiles.add(realFile);
    if (isGeneratedFile(fullPath, genOpts)) continue;
    let content;
    try { content = fs.readFileSync(fullPath, 'utf-8'); } catch { continue; }
    for (const index of findLiteralOccurrences(content, originalText)) {
      out.push({
        type: 'literal',
        file: fullPath,
        startIndex: index,
        endIndex: index + originalText.length,
        originalText,
        contextBefore: content.slice(Math.max(0, index - 500), index),
        contextAfter: content.slice(index + originalText.length, Math.min(content.length, index + originalText.length + 500)),
        window: content.slice(Math.max(0, index - 500), Math.min(content.length, index + originalText.length + 500)),
        line: lineForIndex(content, index),
      });
    }
  }
}

function findLiteralOccurrences(content, originalText) {
  const out = [];
  let index = 0;
  while (true) {
    index = content.indexOf(originalText, index);
    if (index === -1) break;
    if (isSafeLiteralOccurrence(content, index, originalText)) out.push(index);
    index += Math.max(1, originalText.length);
  }
  return out;
}

function isSafeLiteralOccurrence(content, index, originalText) {
  if (!/^[\d.]+$/.test(originalText)) return true;
  const before = content[index - 1] || '';
  const after = content[index + originalText.length] || '';
  return !/[A-Za-z0-9_.-]/.test(before) && !/[A-Za-z0-9_.-]/.test(after);
}

function scoreTextFallbackCandidate(candidate, hints) {
  const win = normalizeHint(candidate.window);
  let score = 0;
  for (const hint of hints) {
    if (!hint || hint === normalizeHint(candidate.originalText)) continue;
    if (win.includes(hint)) {
      score += Math.min(40, Math.max(4, hint.length));
      score += scoreHintProximity(candidate, hint);
    }
  }
  return score;
}

function scoreHintProximity(candidate, hint) {
  const before = String(candidate.contextBefore || '').toLowerCase();
  const after = String(candidate.contextAfter || '').toLowerCase();
  let bestDistance = Infinity;

  const afterIdx = after.indexOf(hint);
  if (afterIdx !== -1) bestDistance = Math.min(bestDistance, afterIdx);

  const beforeIdx = before.lastIndexOf(hint);
  if (beforeIdx !== -1) bestDistance = Math.min(bestDistance, before.length - beforeIdx - hint.length);

  if (!Number.isFinite(bestDistance)) return 0;
  return Math.max(0, 100 - bestDistance);
}

function summarizeLiteralCandidates(candidates) {
  return candidates.slice(0, 12).map((candidate) => ({
    file: path.relative(process.cwd(), candidate.file),
    line: candidate.line,
  }));
}

function applyLiteralTextReplace(content, op, match, file) {
  if (typeof op.newText !== 'string') return { ok: false, reason: 'missing_newText' };
  const charErr = validateNewTextChars(op.newText);
  if (charErr) return { ok: false, reason: 'invalid_chars_in_newText', forbidden: charErr };
  if (content.slice(match.startIndex, match.endIndex) !== op.originalText) {
    return { ok: false, reason: 'text_not_in_source' };
  }
  const replacement = formatLiteralReplacement(content, match.startIndex, match.endIndex, op.newText);
  return {
    ok: true,
    content: content.slice(0, match.startIndex) + replacement + content.slice(match.endIndex),
    line: lineForIndex(content, match.startIndex),
    referenceChange: buildReferenceTextChange(content, match.startIndex, match.endIndex, op, file),
  };
}

function buildReferenceTextChange(content, startIndex, endIndex, op, file) {
  if (!JS_REFERENCE_EXTENSIONS.has(path.extname(file).toLowerCase())) return null;
  if (op.originalText === op.newText) return null;
  if (!isQuotedLiteralOccurrence(content, startIndex, endIndex)) return null;
  const propertyName = propertyNameForQuotedValue(content, startIndex);
  if (!propertyName || !IDENTITY_PROPERTY_NAMES.has(propertyName)) return null;
  return {
    oldText: op.originalText,
    newText: op.newText,
    propertyName,
  };
}

function isQuotedLiteralOccurrence(content, startIndex, endIndex) {
  const before = content[startIndex - 1];
  const after = content[endIndex];
  return !!(before && before === after && (before === '"' || before === "'" || before === '`'));
}

function propertyNameForQuotedValue(content, startIndex) {
  const lineStart = content.lastIndexOf('\n', startIndex) + 1;
  const prefix = content.slice(lineStart, startIndex - 1);
  const match = prefix.match(/(?:^|[,{]\s*)([A-Za-z_$][\w$]*)\s*:\s*$/);
  return match ? match[1] : null;
}

function formatLiteralReplacement(content, startIndex, endIndex, newText) {
  const before = content[startIndex - 1];
  const after = content[endIndex];
  if (before && before === after && (before === '"' || before === "'" || before === '`')) {
    return escapeForQuotedLiteral(newText, before);
  }
  if (isBareJsNumericLiteralOccurrence(content, startIndex, endIndex) && !isSafeJsNumberLiteral(newText)) {
    return "'" + escapeForQuotedLiteral(newText, "'") + "'";
  }
  return newText;
}

function isBareJsNumericLiteralOccurrence(content, startIndex, endIndex) {
  const original = content.slice(startIndex, endIndex);
  if (!/^-?\d+(?:\.\d+)?$/.test(original)) return false;

  const before = nearestNonWsBefore(content, startIndex);
  const after = nearestNonWsAfter(content, endIndex);
  if (!before || !after) return false;
  if (before === '"' || before === "'" || before === '`') return false;
  if (after === '"' || after === "'" || after === '`') return false;
  return /[:=([{,]/.test(before) && /[,;}\])]/.test(after);
}

function isSafeJsNumberLiteral(value) {
  const text = String(value || '').trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return false;
  return Number.isFinite(Number(text));
}

function nearestNonWsBefore(content, index) {
  for (let i = index - 1; i >= 0; i--) {
    if (!/\s/.test(content[i])) return content[i];
  }
  return '';
}

function nearestNonWsAfter(content, index) {
  for (let i = index; i < content.length; i++) {
    if (!/\s/.test(content[i])) return content[i];
  }
  return '';
}

function escapeForQuotedLiteral(value, quote) {
  let out = String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n');
  if (quote === '"' || quote === "'") {
    out = out.replace(new RegExp(escapeRegExp(quote), 'g'), '\\' + quote);
  }
  return out;
}

function lineForIndex(content, index) {
  return content.slice(0, index).split('\n').length;
}

function normalizeHint(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return text.length >= 3 ? text : '';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchSortKey(match) {
  return match.type === 'literal' ? match.startIndex : match.startLine;
}

function publicOp(op) {
  const { contextHints, elementContext, ...rest } = op || {};
  return rest;
}

function collectAppliedForChangedFiles(changedFiles) {
  const out = [];
  for (const state of changedFiles.values()) {
    for (const appliedOp of state.applied) out.push(appliedOp);
  }
  return out;
}

function applyReferenceIntegrityCleanup(cwd, changedFiles, referenceChanges, genOpts) {
  for (const change of referenceChanges) {
    const files = findReferenceCandidateFiles(cwd, genOpts, change.oldText);
    for (const file of files) {
      const base = changedFiles.get(file)?.content ?? fs.readFileSync(file, 'utf-8');
      const oldKeys = findJsObjectStringKeyOccurrences(base, change.oldText);
      if (oldKeys.length === 0) continue;
      const newKeys = findJsObjectStringKeyOccurrences(base, change.newText);
      if (newKeys.length > 0) {
        return {
          ok: false,
          reason: 'reference_integrity_risk',
          message: `Refusing to rename reference key "${change.oldText}" to "${change.newText}" because "${change.newText}" already exists in ${path.relative(cwd, file)}.`,
        };
      }
      const updated = replaceJsObjectStringKeys(base, change.oldText, change.newText);
      if (updated !== base) {
        const state = changedFiles.get(file) || { content: base, applied: [] };
        state.content = updated;
        changedFiles.set(file, state);
      }
    }
  }
  return { ok: true };
}

function findReferenceCandidateFiles(cwd, genOpts, oldText) {
  const files = [];
  const seenDirs = new Set();
  const seenFiles = new Set();
  for (const dir of TEXT_FALLBACK_SEARCH_DIRS) {
    scanReferenceDir(path.join(cwd, dir), cwd, genOpts, oldText, seenDirs, seenFiles, files, 0);
  }
  scanReferenceRootFiles(cwd, genOpts, oldText, seenFiles, files);
  return files;
}

function scanReferenceDir(dir, cwd, genOpts, oldText, seenDirs, seenFiles, out, depth) {
  if (depth > 7 || !fs.existsSync(dir)) return;
  let realDir;
  try { realDir = fs.realpathSync(dir); } catch { return; }
  if (seenDirs.has(realDir)) return;
  seenDirs.add(realDir);

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (TEXT_FALLBACK_SKIP_DIRS.has(entry.name)) continue;
      scanReferenceDir(fullPath, cwd, genOpts, oldText, seenDirs, seenFiles, out, depth + 1);
      continue;
    }
    if (!entry.isFile() || !JS_REFERENCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    maybeAddReferenceFile(fullPath, genOpts, oldText, seenFiles, out);
  }
}

function scanReferenceRootFiles(cwd, genOpts, oldText, seenFiles, out) {
  let entries;
  try { entries = fs.readdirSync(cwd, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isFile() || !JS_REFERENCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    maybeAddReferenceFile(path.join(cwd, entry.name), genOpts, oldText, seenFiles, out);
  }
}

function maybeAddReferenceFile(file, genOpts, oldText, seenFiles, out) {
  let realFile;
  try { realFile = fs.realpathSync(file); } catch { return; }
  if (seenFiles.has(realFile)) return;
  seenFiles.add(realFile);
  if (isGeneratedFile(file, genOpts)) return;
  let content;
  try { content = fs.readFileSync(file, 'utf-8'); } catch { return; }
  if (findJsObjectStringKeyOccurrences(content, oldText).length > 0) out.push(file);
}

function findJsObjectStringKeyOccurrences(content, text) {
  const out = [];
  const re = new RegExp('(["\\\'])' + escapeRegExp(text) + '\\1(?=\\s*:)', 'g');
  for (const match of content.matchAll(re)) {
    out.push({ index: match.index, quote: match[1] });
  }
  return out;
}

function replaceJsObjectStringKeys(content, oldText, newText) {
  const re = new RegExp('(["\\\'])' + escapeRegExp(oldText) + '\\1(?=\\s*:)', 'g');
  return content.replace(re, (_match, quote) => quote + escapeForQuotedLiteral(newText, quote) + quote);
}

function validateChangedFileContent(file, content) {
  const ext = path.extname(file).toLowerCase();
  if (ext !== '.js' && ext !== '.mjs') return { ok: true };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-live-edit-check-'));
  const tmpFile = path.join(dir, path.basename(file));
  try {
    fs.writeFileSync(tmpFile, content);
    execFileSync(process.execPath, ['--check', tmpFile], { encoding: 'utf-8', stdio: 'pipe' });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: 'invalid_source_after_edit',
      message: String(err.stderr || err.message || '').trim(),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// After a higher-up op rewrites part of the file, the unchanged ranges below it
// still have stable line indices (we sort ops bottom-up). But text-replace
// inside the same element block can shift the endLine. Keep the original
// startLine and recompute endLine from the live content.
function adjustMatch(lines, op, match) {
  const { startLine } = match;
  if (startLine >= lines.length) return null;
  // Verify the opening line still references the expected tag.
  const opener = lines[startLine].match(new RegExp('<' + op.tag + '(?=[\\s/>]|$)'));
  if (!opener) return null;
  return { startLine, endLine: findClosingLine(lines, startLine) };
}

function applyTextReplace(content, lines, op, match) {
  if (typeof op.newText !== 'string') return { ok: false, reason: 'missing_newText' };
  const charErr = validateNewTextChars(op.newText);
  if (charErr) return { ok: false, reason: 'invalid_chars_in_newText', forbidden: charErr };
  const { startLine, endLine } = match;
  const sub = lines.slice(startLine, endLine + 1).join('\n');
  const idx = sub.indexOf(op.originalText);
  if (idx === -1) return { ok: false, reason: 'text_not_in_source' };
  // Same text appearing twice in the matched block means we can't tell which
  // leaf the user edited. Refusing is safer than guessing — they can rephrase
  // one occurrence to make it distinct, then retry.
  const occurrences = sub.split(op.originalText).length - 1;
  if (occurrences > 1) return { ok: false, reason: 'text_ambiguous_in_block', occurrences };
  const newSub = sub.slice(0, idx) + op.newText + sub.slice(idx + op.originalText.length);
  const before = lines.slice(0, startLine).join('\n');
  const after = lines.slice(endLine + 1).join('\n');
  // Use index checks, not string truthiness, so a leading empty line (file
  // starts with '\n') or a trailing empty line is preserved instead of
  // silently dropped during reconstruction.
  const joined =
    (startLine > 0 ? before + '\n' : '') +
    newSub +
    (endLine + 1 < lines.length ? '\n' + after : '');
  return { ok: true, content: joined };
}

function applyDelete(content, lines, op, match) {
  const { startLine, endLine } = match;
  if (endLine < startLine) return { ok: false, reason: 'unsafe_delete' };
  const closeRe = new RegExp('</' + op.tag + '\\s*>');
  if (!closeRe.test(lines[endLine])) return { ok: false, reason: 'unsafe_delete' };
  // If start and end share a line (e.g. `<p>x</p>` on one line), drop that line
  // entirely. Otherwise drop the inclusive range.
  const newLines = lines.slice(0, startLine).concat(lines.slice(endLine + 1));
  return { ok: true, content: newLines.join('\n') };
}

function argVal(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

function fatal(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }));
  process.exit(1);
}

// Reject characters that would land in source as markup, template delimiters,
// or template-string punctuation. The manual-edit flow is plain-text only; to
// insert markup the user asks the AI. Server and CLI share this check.
const FORBIDDEN_NEWTEXT_CHARS = ['<', '>', '{', '}', '`'];
export function validateNewTextChars(newText) {
  if (typeof newText !== 'string') return null;
  const hits = FORBIDDEN_NEWTEXT_CHARS.filter((c) => newText.includes(c));
  return hits.length > 0 ? hits : null;
}

const _running = process.argv[1];
if (_running?.endsWith('live-edit.mjs') || _running?.endsWith('live-edit.mjs/')) {
  editCli();
}

// Test exports
export { resolveOp, applyTextReplace, applyDelete };
