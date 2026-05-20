#!/usr/bin/env node
/**
 * Build an AI handoff packet for pending live copy edits.
 *
 * This script intentionally does not edit source files. It gathers the staged
 * browser edits, nearby rendered context, framework source hints, and likely
 * source candidates so the coding agent can make the source change with full
 * repo context instead of a deterministic resolver guessing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getLiveDir } from './impeccable-paths.mjs';
import { isGeneratedFile } from './is-generated.mjs';
import { readBuffer, getBufferPath } from './live-manual-edits-buffer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HANDOFF_VERSION = 1;
const HANDOFF_DIRNAME = 'manual-edit-handoffs';
const TEXT_EXTENSIONS = new Set(['.html', '.jsx', '.tsx', '.vue', '.svelte', '.astro', '.js', '.mjs', '.ts']);
const SEARCH_DIRS = ['src', 'app', 'pages', 'components', 'public', 'views', 'templates', 'site', 'lib', 'data'];
const SKIP_DIRS = new Set([
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

export function getManualEditHandoffDir(cwd = process.cwd()) {
  return path.join(getLiveDir(cwd), HANDOFF_DIRNAME);
}

export function getManualEditHandoffPath(cwd = process.cwd(), handoffId) {
  return path.join(getManualEditHandoffDir(cwd), handoffId + '.json');
}

export function createManualEditHandoff({
  cwd = process.cwd(),
  pageUrl = null,
  handoffId = createHandoffId(),
  createdAt = new Date().toISOString(),
} = {}) {
  const packet = buildManualEditEvidence({ cwd, pageUrl });
  const opCount = packet.ops.length;

  if (opCount === 0) {
    return {
      cleared: false,
      requiresAgent: true,
      reason: 'no_pending_edits',
      handoffId: null,
      handoffPath: null,
      pageUrl,
      count: 0,
      prompt: 'No pending Impeccable copy edits were found.',
      entries: [],
      ops: [],
    };
  }

  const relativeHandoffPath = path.join('.impeccable', 'live', HANDOFF_DIRNAME, handoffId + '.json');
  const completeScriptPath = resolveCompleteScriptPath(cwd);
  const handoff = {
    version: HANDOFF_VERSION,
    handoffId,
    createdAt,
    pageUrl: pageUrl || null,
    entries: packet.entries.map(summarizeEntry),
    ops: packet.ops,
    context: {
      cwd,
      bufferPath: path.relative(cwd, getBufferPath(cwd)),
      totalEntries: packet.entries.length,
      totalOps: opCount,
    },
    candidates: packet.candidates,
    agentInstructions: buildAgentInstructions(relativeHandoffPath, handoffId, completeScriptPath),
  };

  const handoffPath = getManualEditHandoffPath(cwd, handoffId);
  fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
  fs.writeFileSync(handoffPath, JSON.stringify(handoff, null, 2));

  return {
    cleared: false,
    requiresAgent: true,
    handoffId,
    handoffPath: relativeHandoffPath,
    pageUrl,
    count: opCount,
    prompt: buildPrompt(relativeHandoffPath, handoffId, opCount, pageUrl, completeScriptPath),
    entries: handoff.entries,
    ops: handoff.ops,
    candidates: handoff.candidates,
  };
}

export function buildManualEditEvidence({ cwd = process.cwd(), pageUrl = null } = {}) {
  const buffer = readBuffer(cwd);
  const entries = pageUrl
    ? buffer.entries.filter((entry) => entry.pageUrl === pageUrl)
    : buffer.entries;
  const opCount = countOps(entries);

  if (opCount === 0) {
    return {
      pageUrl,
      count: 0,
      entries: [],
      ops: [],
      candidates: [],
    };
  }

  const searchFiles = collectSearchFiles(cwd);
  const ops = flattenOps(entries);
  const candidates = ops.map((op) => buildCandidatesForOp(op, cwd, searchFiles));
  return {
    version: HANDOFF_VERSION,
    pageUrl: pageUrl || null,
    count: opCount,
    entries,
    ops,
    context: {
      cwd,
      bufferPath: path.relative(cwd, getBufferPath(cwd)),
      totalEntries: entries.length,
      totalOps: opCount,
    },
    candidates,
  };
}

function createHandoffId() {
  return randomUUID().replace(/-/g, '').slice(0, 12);
}

function countOps(entries) {
  let count = 0;
  for (const entry of entries) count += Array.isArray(entry.ops) ? entry.ops.length : 0;
  return count;
}

function summarizeEntry(entry) {
  return {
    id: entry.id,
    pageUrl: entry.pageUrl,
    stagedAt: entry.stagedAt || null,
    element: entry.element || null,
    opCount: Array.isArray(entry.ops) ? entry.ops.length : 0,
  };
}

function flattenOps(entries) {
  const out = [];
  for (const entry of entries) {
    const contextHintsByRef = buildContextHintsByRef(entry);
    for (const op of entry.ops || []) {
      out.push({
        entryId: entry.id,
        pageUrl: entry.pageUrl,
        ref: op.ref,
        contextRef: op.contextRef || null,
        tag: op.tag,
        elementId: op.elementId || null,
        classes: Array.isArray(op.classes) ? op.classes : [],
        originalText: op.originalText,
        newText: op.newText,
        deleted: op.deleted === true,
        sourceHint: op.sourceHint || null,
        leaf: op.leaf || null,
        nearbyEditableTexts: Array.isArray(op.nearbyEditableTexts) ? op.nearbyEditableTexts : [],
        container: op.container || null,
        contextHints: contextHintsByRef.get(op.ref) || [],
      });
    }
  }
  return out;
}

function buildContextHintsByRef(entry) {
  const map = new Map();
  for (const op of entry.ops || []) {
    const hints = new Set();
    const add = (value) => {
      const text = normalizeText(decodeBasicHtml(String(value || '')));
      if (text.length < 3 || text.length > 160) return;
      if (text === normalizeText(op.originalText) || text === normalizeText(op.newText)) return;
      hints.add(text);
    };

    for (const item of op.nearbyEditableTexts || []) {
      add(typeof item === 'string' ? item : item?.text);
    }
    const outer = typeof entry.element?.outerHTML === 'string' ? entry.element.outerHTML : '';
    for (const match of outer.matchAll(/data-impeccable-original-text="([^"]*)"/g)) add(match[1]);
    if (typeof entry.element?.textContent === 'string') {
      for (const chunk of entry.element.textContent.split(/\s{2,}|\n|\t/)) add(chunk);
    }
    map.set(op.ref, [...hints].slice(0, 16));
  }
  return map;
}

function buildCandidatesForOp(op, cwd, searchFiles) {
  const originalText = String(op.originalText || '');
  const contextNeedles = op.contextHints || [];
  return {
    entryId: op.entryId,
    ref: op.ref,
    originalText,
    sourceHint: analyzeSourceHint(op, cwd),
    textMatches: originalText ? findLiteralMatches(searchFiles, originalText, { max: 20 }) : [],
    objectKeyMatches: originalText ? findObjectKeyMatches(searchFiles, originalText, { max: 20 }) : [],
    locatorMatches: findLocatorMatches(searchFiles, op, { max: 20 }),
    contextTextMatches: findContextMatches(searchFiles, contextNeedles, { maxPerHint: 5, max: 24 }),
  };
}

function analyzeSourceHint(op, cwd) {
  const hint = normalizeSourceHint(op.sourceHint);
  if (!hint.file) return null;
  const file = path.resolve(cwd, hint.file);
  const relativeFile = path.relative(cwd, file);
  if (!isPathInsideOrEqual(cwd, file)) {
    return { ...hint, status: 'outside_cwd', relativeFile: hint.file };
  }
  if (!fs.existsSync(file)) {
    return { ...hint, status: 'file_missing', relativeFile };
  }
  if (isGeneratedFile(file, { cwd })) {
    return { ...hint, status: 'generated', relativeFile };
  }

  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  const line = hint.line || 1;
  const start = Math.max(0, line - 4);
  const end = Math.min(lines.length, line + 3);
  const windowText = lines.slice(start, end).join('\n');
  const containsOriginalText = typeof op.originalText === 'string' && windowText.includes(op.originalText);
  return {
    ...hint,
    status: containsOriginalText ? 'ok' : 'text_not_found_near_hint',
    relativeFile,
    excerpt: lines.slice(start, end).map((text, index) => ({
      line: start + index + 1,
      text: text.slice(0, 240),
    })),
  };
}

function normalizeSourceHint(hint) {
  if (!hint || typeof hint !== 'object') return {};
  let line = Number.isFinite(Number(hint.line)) ? Number(hint.line) : null;
  let column = Number.isFinite(Number(hint.column)) ? Number(hint.column) : null;
  if ((!line || !column) && typeof hint.loc === 'string') {
    const match = hint.loc.match(/^(\d+)(?::(\d+))?/);
    if (match) {
      line = Number(match[1]);
      if (match[2]) column = Number(match[2]);
    }
  }
  return {
    file: typeof hint.file === 'string' ? hint.file : '',
    loc: typeof hint.loc === 'string' ? hint.loc : '',
    line,
    column,
  };
}

function collectSearchFiles(cwd) {
  const out = [];
  const seenDirs = new Set();
  const seenFiles = new Set();
  for (const dir of SEARCH_DIRS) {
    scanDir(path.join(cwd, dir), cwd, seenDirs, seenFiles, out, 0);
  }
  scanRootFiles(cwd, seenFiles, out);
  return out;
}

function scanDir(dir, cwd, seenDirs, seenFiles, out, depth) {
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
      if (SKIP_DIRS.has(entry.name)) continue;
      scanDir(fullPath, cwd, seenDirs, seenFiles, out, depth + 1);
      continue;
    }
    if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    maybeAddSearchFile(fullPath, cwd, seenFiles, out);
  }
}

function scanRootFiles(cwd, seenFiles, out) {
  let entries;
  try { entries = fs.readdirSync(cwd, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isFile() || !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    maybeAddSearchFile(path.join(cwd, entry.name), cwd, seenFiles, out);
  }
}

function maybeAddSearchFile(file, cwd, seenFiles, out) {
  let realFile;
  try { realFile = fs.realpathSync(file); } catch { return; }
  if (seenFiles.has(realFile)) return;
  seenFiles.add(realFile);
  if (isGeneratedFile(file, { cwd })) return;
  let content;
  try { content = fs.readFileSync(file, 'utf-8'); } catch { return; }
  out.push({ file, relativeFile: path.relative(cwd, file), content, lines: content.split('\n') });
}

function findLiteralMatches(searchFiles, needle, { max }) {
  return findMatches(searchFiles, needle, { kind: 'text', max });
}

function findObjectKeyMatches(searchFiles, text, { max }) {
  const re = new RegExp('(["\\\'`])' + escapeRegExp(text) + '\\1(?=\\s*:)', 'g');
  const out = [];
  for (const file of searchFiles) {
    for (const match of file.content.matchAll(re)) {
      out.push(matchForIndex(file, match.index, 'object_key', text));
      if (out.length >= max) return out;
    }
  }
  return out;
}

function findLocatorMatches(searchFiles, op, { max }) {
  const needles = [];
  if (op.elementId) needles.push({ kind: 'id', needle: op.elementId });
  for (const cls of op.classes || []) {
    if (cls) needles.push({ kind: 'class', needle: cls });
  }
  if (op.tag) needles.push({ kind: 'tag', needle: '<' + op.tag });

  const out = [];
  const seen = new Set();
  for (const { kind, needle } of needles) {
    for (const match of findMatches(searchFiles, needle, { kind, max })) {
      const key = match.file + ':' + match.line + ':' + kind + ':' + needle;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...match, needle });
      if (out.length >= max) return out;
    }
  }
  return out;
}

function findContextMatches(searchFiles, hints, { maxPerHint, max }) {
  const out = [];
  const seen = new Set();
  for (const hint of hints || []) {
    for (const match of findMatches(searchFiles, hint, { kind: 'context', max: maxPerHint })) {
      const key = match.file + ':' + match.line + ':' + hint;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...match, needle: hint });
      if (out.length >= max) return out;
    }
  }
  return out;
}

function findMatches(searchFiles, needle, { kind, max }) {
  const text = String(needle || '');
  if (!text) return [];
  const out = [];
  for (const file of searchFiles) {
    let index = 0;
    while (out.length < max) {
      index = file.content.indexOf(text, index);
      if (index === -1) break;
      out.push(matchForIndex(file, index, kind, text));
      index += Math.max(1, text.length);
    }
    if (out.length >= max) break;
  }
  return out;
}

function matchForIndex(file, index, kind, needle) {
  const line = file.content.slice(0, index).split('\n').length;
  const lineText = file.lines[line - 1] || '';
  return {
    kind,
    file: file.relativeFile,
    line,
    needle,
    excerpt: lineText.trim().slice(0, 240),
  };
}

function resolveCompleteScriptPath(cwd) {
  const rel = path.relative(cwd, __dirname);
  const scriptsDir = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : __dirname;
  return path.join(scriptsDir || '.', 'live-complete-manual-edits.mjs');
}

function buildPrompt(relativeHandoffPath, handoffId, count, pageUrl, completeScriptPath) {
  const scoped = pageUrl ? ' on ' + pageUrl : '';
  return [
    `Apply ${count} pending Impeccable copy edit${count === 1 ? '' : 's'}${scoped}.`,
    `Read the handoff packet at ${relativeHandoffPath} (handoff ${handoffId}).`,
    'Use the staged DOM paths, rendered context, source hints, and candidates as evidence.',
    'Edit the true source files manually; update related references or object keys when the visible string is used as identity.',
    'Run focused validation for changed files.',
    `When done, run: node ${completeScriptPath} --handoff-id=${handoffId}`,
  ].join('\n');
}

function buildAgentInstructions(relativeHandoffPath, handoffId, completeScriptPath) {
  return [
    'Do not treat candidates as a resolver decision; they are evidence only.',
    'Prefer true source files over generated output.',
    'When changing identity strings, check matching object keys and references before writing.',
    'Preserve unrelated staged/site demo edits unless the handoff specifically targets them.',
    'After applying and validating the source change, clear only this handoff with:',
    `node ${completeScriptPath} --handoff-id=${handoffId}`,
    `Handoff path: ${relativeHandoffPath}`,
  ];
}

function isPathInsideOrEqual(cwd, file) {
  const rel = path.relative(path.resolve(cwd), path.resolve(file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function argVal(args, name) {
  const prefix = name + '=';
  for (const arg of args) {
    if (arg === name) return true;
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node live-manual-edit-handoff.mjs [--page-url=<url>] [--handoff-id=<id>]');
    process.exit(0);
  }
  const result = createManualEditHandoff({
    cwd: process.cwd(),
    pageUrl: argVal(args, '--page-url'),
    handoffId: argVal(args, '--handoff-id') || undefined,
  });
  console.log(JSON.stringify(result));
}

const _running = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (_running === fileURLToPath(import.meta.url)) {
  main();
}
