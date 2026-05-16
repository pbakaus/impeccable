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
import path from 'node:path';
import { isGeneratedFile } from './is-generated.mjs';
import {
  buildSearchQueries,
  findAllElements,
  filterByText,
  findClosingLine,
  findFileWithQuery,
} from './live-wrap.mjs';

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
    const located = resolveOp(op, explicitFile, cwd, genOpts);
    if (!located.ok) {
      failed.push({ ref: op.ref, op, reason: located.reason, candidates: located.candidates });
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

  for (const [file, state] of byFile) {
    // Apply bottom-up so earlier line indices remain valid as content above is
    // unchanged. We re-derive `lines` after each op since content shifts.
    state.ops.sort((a, b) => b.match.startLine - a.match.startLine);
    let content = state.content;
    let changed = false;
    for (const { op, match } of state.ops) {
      // Re-resolve match coordinates against the current content state. The
      // initial match came from the original buffer; for bottom-up application,
      // those indices are still valid for ops above the previous edit, but a
      // safer move is to recompute lines on the current content.
      const lines = content.split('\n');
      const adjusted = adjustMatch(lines, op, match);
      if (!adjusted) {
        failed.push({ ref: op.ref, op, reason: 'lost_after_prior_op', file });
        continue;
      }
      const result = op.deleted === true
        ? applyDelete(content, lines, op, adjusted)
        : applyTextReplace(content, lines, op, adjusted);
      if (!result.ok) {
        failed.push({ ref: op.ref, op, reason: result.reason, file });
        continue;
      }
      content = result.content;
      changed = true;
      applied.push({ ref: op.ref, op, file: path.relative(cwd, file), line: adjusted.startLine + 1 });
    }
    if (changed) {
      fs.writeFileSync(file, content);
      filesWritten.push(path.relative(cwd, file));
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
  const { startLine, endLine } = match;
  const sub = lines.slice(startLine, endLine + 1).join('\n');
  const idx = sub.indexOf(op.originalText);
  if (idx === -1) return { ok: false, reason: 'text_not_in_source' };
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

const _running = process.argv[1];
if (_running?.endsWith('live-edit.mjs') || _running?.endsWith('live-edit.mjs/')) {
  editCli();
}

// Test exports
export { resolveOp, applyTextReplace, applyDelete };
