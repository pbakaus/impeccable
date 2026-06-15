#!/usr/bin/env node
/**
 * Impeccable design hook — Cursor preToolUse write gate.
 *
 * Cursor's stop hook is not consistently dispatched by the headless agent, so
 * this hook checks proposed Write/Edit content before it lands. It only denies
 * writes when the real detector finds an issue in the proposed UI content.
 *
 * Contract: never break a turn accidentally. On malformed input or internal
 * errors, allow the tool and exit 0.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  ALLOWED_EXTS,
  EDIT_COUNT_THRESHOLD,
  GENERATED_PATH,
  SENSITIVE_PATH,
  appendDesignSystemNote,
  designSystemOptions,
  filterFindings,
  loadDetector,
  matchesAnyGlob,
  persistCache,
  readCache,
  readConfig,
  renderTemplate,
  resolveProjectCwd,
  truthy,
  writeAuditLog,
} from './hook-lib.mjs';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

function done(payload = null) {
  if (payload) process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

function allow(extra = {}, payload = {}) {
  writeAuditLog(process.env, {
    ts: new Date().toISOString(),
    event: 'preToolUse',
    ...extra,
  });
  return done({ permission: 'allow', ...payload });
}

function deny(message, audit) {
  writeAuditLog(process.env, {
    ts: new Date().toISOString(),
    event: 'preToolUse',
    blocked: true,
    ...audit,
  });
  return done({
    permission: 'deny',
    user_message: message,
    agent_message: message,
  });
}

function toolInput(event) {
  return event?.tool_input && typeof event.tool_input === 'object' ? event.tool_input : {};
}

function proposedFilePath(event, cwd) {
  const input = toolInput(event);
  const raw = input.file_path || input.path || input.target_file || event?.file_path;
  const candidate = typeof raw === 'string' && raw.trim()
    ? raw
    : shellWriteDestination(shellCommand(input));
  if (typeof candidate !== 'string' || !candidate.trim()) return '';
  return path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
}

function proposedContent(event, cwd, filePath) {
  const input = toolInput(event);
  for (const key of ['content', 'streamContent', 'text']) {
    if (typeof input[key] === 'string') return input[key];
  }

  const editProjection = projectedEditContent(input, filePath, cwd);
  if (editProjection !== undefined) return editProjection;

  if (hasFragmentEditContent(input)) {
    return { skipped: 'fragment-only-edit' };
  }

  const command = shellCommand(input);
  const pythonContent = shellPythonWriteContent(command);
  if (pythonContent) return pythonContent;
  const shellContent = shellHereDocContent(command);
  if (shellContent) return shellContent;
  const copiedContent = shellCopiedFileContent(command, cwd);
  if (copiedContent) return copiedContent;
  return '';
}

function hasFragmentEditContent(input) {
  if (!input || typeof input !== 'object') return false;
  if (typeof input.new_string === 'string' || typeof input.newString === 'string' || typeof input.new_str === 'string' || typeof input.replacement === 'string') {
    return true;
  }
  return Array.isArray(input.edits) && input.edits.some((edit) => edit && typeof edit === 'object');
}

function projectedEditContent(input, filePath, cwd) {
  if (!filePath) return undefined;
  const singleOld = firstString(input, ['old_string', 'oldString', 'old_str', 'target']);
  const singleNew = firstString(input, ['new_string', 'newString', 'new_str', 'replacement']);
  if (singleOld !== undefined || singleNew !== undefined) {
    if (singleOld === undefined || singleNew === undefined) return { skipped: 'fragment-only-edit' };
    const original = readExistingProjectFile(filePath, cwd);
    if (original === null) return { skipped: 'edit-original-unreadable' };
    const projected = replaceOnce(original, singleOld, singleNew);
    return projected === null ? { skipped: 'edit-old-string-missing' } : projected;
  }

  if (!Array.isArray(input.edits)) return undefined;
  const original = readExistingProjectFile(filePath, cwd);
  if (original === null) return { skipped: 'edit-original-unreadable' };

  let projected = original;
  for (const edit of input.edits) {
    if (!edit || typeof edit !== 'object') return { skipped: 'fragment-only-edit' };
    const oldString = firstString(edit, ['old_string', 'oldString', 'old_str', 'target']);
    const newString = firstString(edit, ['new_string', 'newString', 'new_str', 'replacement']);
    if (oldString === undefined || newString === undefined) return { skipped: 'fragment-only-edit' };
    const next = replaceOnce(projected, oldString, newString);
    if (next === null) return { skipped: 'edit-old-string-missing' };
    projected = next;
  }
  return projected;
}

function firstString(obj, keys) {
  for (const key of keys) {
    if (typeof obj?.[key] === 'string') return obj[key];
  }
  return undefined;
}

function replaceOnce(original, oldString, newString) {
  if (oldString === '') return null;
  const index = original.indexOf(oldString);
  if (index === -1) return null;
  return `${original.slice(0, index)}${newString}${original.slice(index + oldString.length)}`;
}

function readExistingProjectFile(filePath, cwd) {
  if (!isInsideProject(filePath, cwd)) return null;
  if (SENSITIVE_PATH.test(filePath) || GENERATED_PATH.test(filePath)) return null;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function shellCommand(input) {
  if (typeof input.command === 'string') return input.command;
  if (input.args && typeof input.args.command === 'string') return input.args.command;
  return '';
}

function shellRedirectPath(command) {
  if (!command || typeof command !== 'string') return '';
  const match = command.match(/(?:^|[\s;&|])(?:>>?|1>>?)\s*(?:"([^"]+)"|'([^']+)'|([^<>\s]+))/);
  return (match?.[1] || match?.[2] || match?.[3] || '').trim();
}

function shellWriteDestination(command) {
  return shellRedirectPath(command) || shellTeeDestination(command) || shellCopyPaths(command)?.dest || shellPythonWriteDestination(command) || '';
}

function shellPythonWriteDestination(command) {
  if (!/\bpython(?:3)?\b/.test(command || '')) return '';
  const directPath = firstMatch(command, /(?:^|[^\w.])(?:pathlib\.)?Path\(\s*(["'])(.*?)\1\s*\)\s*\.write_text\s*\(/);
  if (directPath) return directPath;

  const pathsByVar = new Map();
  const assignmentRe = /\b([A-Za-z_]\w*)\s*=\s*(?:pathlib\.)?Path\(\s*(["'])(.*?)\2\s*\)/g;
  let assignment;
  while ((assignment = assignmentRe.exec(command))) {
    pathsByVar.set(assignment[1], assignment[3]);
  }

  const writeVarRe = /\b([A-Za-z_]\w*)\.write_text\s*\(/g;
  let writeVar;
  while ((writeVar = writeVarRe.exec(command))) {
    const candidate = pathsByVar.get(writeVar[1]);
    if (candidate) return candidate;
  }

  return firstMatch(command, /\bopen\(\s*(["'])(.*?)\1\s*,\s*(["'])[wax](?:\+)?b?\3/);
}

function firstMatch(value, re) {
  const match = String(value || '').match(re);
  return (match?.[2] || '').trim();
}

function shellTeeDestination(command) {
  const words = shellWords(command);
  const teeIndex = words.findIndex((word) => path.basename(word) === 'tee');
  if (teeIndex === -1) return '';
  for (const word of words.slice(teeIndex + 1)) {
    if (['&&', '||', ';', '|'].includes(word)) break;
    if (word === '--') continue;
    if (word.startsWith('-')) continue;
    return word;
  }
  return '';
}

function shellCopiedFileContent(command, cwd) {
  const source = shellCopyPaths(command)?.source;
  if (!source) return '';
  const sourcePath = path.isAbsolute(source) ? source : path.resolve(cwd, source);
  if (!isInsideProject(sourcePath, cwd)) return '';
  if (SENSITIVE_PATH.test(sourcePath) || GENERATED_PATH.test(sourcePath)) return '';
  try {
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile() || stat.size > 1024 * 1024) return '';
    return fs.readFileSync(sourcePath, 'utf-8');
  } catch {
    return '';
  }
}

function shellCopyPaths(command) {
  const words = shellWords(command);
  if (words.length < 3 || path.basename(words[0]) !== 'cp') return null;
  const args = [];
  for (const word of words.slice(1)) {
    if (['&&', '||', ';', '|'].includes(word)) break;
    if (word === '--') continue;
    if (word.startsWith('-')) continue;
    args.push(word);
  }
  if (args.length < 2) return null;
  return { source: args[args.length - 2], dest: args[args.length - 1] };
}

function shellWords(command) {
  if (!command || typeof command !== 'string') return [];
  const words = [];
  const re = /"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|([^\s]+)/g;
  let match;
  while ((match = re.exec(command))) {
    words.push((match[1] ?? match[2] ?? match[3] ?? '').replace(/\\(["'])/g, '$1'));
  }
  return words;
}

function shellHereDocContent(command) {
  if (!command || typeof command !== 'string') return '';
  const markerMatch = command.match(/<<-?\s*['"]?([A-Za-z0-9_.-]+)['"]?[^\r\n]*\r?\n/);
  if (!markerMatch) return '';
  const marker = markerMatch[1];
  const start = (markerMatch.index || 0) + markerMatch[0].length;
  const rest = command.slice(start);
  const endRe = new RegExp(`\\r?\\n${escapeRegExp(marker)}(?:\\r?\\n|$)`);
  const end = rest.search(endRe);
  return end >= 0 ? rest.slice(0, end) : '';
}

function shellPythonWriteContent(command) {
  if (!/\bpython(?:3)?\b/.test(command || '')) return '';
  const script = shellHereDocContent(command) || command;
  return pythonStringArg(script, /\.write_text\s*\(\s*/g) || pythonStringArg(script, /\.write\s*\(\s*/g);
}

function pythonStringArg(script, prefixRe) {
  let prefix;
  while ((prefix = prefixRe.exec(script))) {
    const start = prefixRe.lastIndex;
    const triple = script.slice(start, start + 3);
    if (triple === "'''" || triple === '"""') {
      const end = script.indexOf(triple, start + 3);
      if (end !== -1) return script.slice(start + 3, end);
      continue;
    }
    const quote = script[start];
    if (quote !== '"' && quote !== "'") continue;
    let out = '';
    for (let i = start + 1; i < script.length; i++) {
      const ch = script[i];
      if (ch === '\\') {
        out += script[i + 1] || '';
        i += 1;
      } else if (ch === quote) {
        return out;
      } else {
        out += ch;
      }
    }
  }
  return '';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function relativePath(filePath, cwd) {
  try {
    const rel = path.relative(cwd, filePath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return filePath;
    return rel.split(path.sep).join('/');
  } catch {
    return filePath;
  }
}

function isInsideProject(filePath, cwd) {
  try {
    const rel = path.relative(cwd, filePath);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

function cursorBlockMessage(findings, filePath, config, cwd) {
  const rendered = renderTemplate(findings, filePath, config, { cwd });
  const blocked = rendered.replace(
    '[impeccable@1] Design hook findings requiring review',
    '[impeccable@1] Impeccable design hook blocked this write before it landed. Design hook findings requiring review',
  );
  return blocked.length > 4000 ? `${blocked.slice(0, 3984)}\n...(truncated)` : blocked;
}

function findingSignature(findings) {
  return findings
    .map((finding) => `${finding.antipattern || 'unknown'}:${finding.line || 0}`)
    .sort()
    .join('|');
}

function bumpCursorDenial(cache, sessionId, filePath, findings) {
  const session = cache.sessions[sessionId] || { updatedAt: Date.now(), files: {} };
  cache.sessions[sessionId] = session;
  session.updatedAt = Date.now();
  const fileEntry = session.files[filePath] || { editCount: 0, findings: [] };
  session.files[filePath] = fileEntry;
  const key = findingSignature(findings);
  fileEntry.cursorDenials = fileEntry.cursorDenials && typeof fileEntry.cursorDenials === 'object'
    ? fileEntry.cursorDenials
    : {};
  fileEntry.cursorDenials[key] = (fileEntry.cursorDenials[key] || 0) + 1;
  return { key, count: fileEntry.cursorDenials[key] };
}

async function main() {
  if (truthy(process.env.IMPECCABLE_HOOK_DISABLED)) {
    return allow({ skipped: 'env-disabled' });
  }

  let event = null;
  try {
    const raw = await readStdin();
    if (raw) event = JSON.parse(raw);
  } catch {
    return allow({ skipped: 'stdin-malformed' });
  }

  if (!event || typeof event !== 'object') {
    return allow({ skipped: 'stdin-empty' });
  }

  const cwd = resolveProjectCwd(event);
  const started = Date.now();
  const filePath = proposedFilePath(event, cwd);
  const audit = {
    harness: 'cursor',
    cwd,
    tool: event.tool_name || null,
    file: filePath || null,
  };

  if (!filePath) return allow({ ...audit, skipped: 'no-file-path', durationMs: Date.now() - started });
  if (!isInsideProject(filePath, cwd)) return allow({ ...audit, skipped: 'outside-project', durationMs: Date.now() - started });
  if (SENSITIVE_PATH.test(filePath)) return allow({ ...audit, skipped: 'sensitive', durationMs: Date.now() - started });
  if (GENERATED_PATH.test(filePath)) return allow({ ...audit, skipped: 'generated', durationMs: Date.now() - started });

  const ext = path.extname(filePath).toLowerCase();
  audit.ext = ext;
  if (!ALLOWED_EXTS.has(ext)) return allow({ ...audit, skipped: 'extension', durationMs: Date.now() - started });

  const contentResult = proposedContent(event, cwd, filePath);
  if (contentResult && typeof contentResult === 'object' && contentResult.skipped) {
    return allow({ ...audit, skipped: contentResult.skipped, durationMs: Date.now() - started });
  }
  const content = typeof contentResult === 'string' ? contentResult : '';
  if (!content) return allow({ ...audit, skipped: 'no-proposed-content', durationMs: Date.now() - started });

  const config = readConfig(cwd);
  if (config.enabled === false) return allow({ ...audit, skipped: 'config-disabled', durationMs: Date.now() - started });

  const rel = relativePath(filePath, cwd);
  if (matchesAnyGlob(rel, config.ignoreFiles) || matchesAnyGlob(filePath, config.ignoreFiles)) {
    return allow({ ...audit, skipped: 'config-ignore-file', durationMs: Date.now() - started });
  }

  const detector = await loadDetector();
  if (!detector || typeof detector.detectText !== 'function') {
    return allow({ ...audit, skipped: 'detector-missing', durationMs: Date.now() - started });
  }
  const scanOptions = designSystemOptions(config, detector, cwd);

  let findings = [];
  try {
    findings = await detector.detectText(content, filePath, scanOptions);
  } catch {
    return allow({ ...audit, error: 'detector-threw', durationMs: Date.now() - started });
  }

  const filtered = filterFindings(findings || [], content, ext, config);
  if (filtered.length === 0) {
    return allow({
      ...audit,
      findings: (findings || []).length,
      blockedFindings: 0,
      durationMs: Date.now() - started,
    });
  }

  const message = appendDesignSystemNote(cursorBlockMessage(filtered, filePath, config, cwd), scanOptions);
  const sessionId = event.session_id || event.conversation_id || 'unknown';
  const cache = readCache(cwd);
  const denial = bumpCursorDenial(cache, sessionId, filePath, filtered);
  persistCache(cwd, cache);
  if (denial.count > EDIT_COUNT_THRESHOLD) {
    const warning = `${message}\n\nThis is the ${denial.count}th repeated denial for the same file and finding signature, so Impeccable is allowing this write to avoid a loop. Reconsider the issue immediately after the tool runs.`;
    return allow({
      ...audit,
      findings: (findings || []).length,
      blockedFindings: filtered.length,
      cursorDenialKey: denial.key,
      cursorDenialCount: denial.count,
      downgraded: true,
      chars: warning.length,
      durationMs: Date.now() - started,
    }, {
      user_message: warning,
      agent_message: warning,
    });
  }
  return deny(message, {
    ...audit,
    findings: (findings || []).length,
    blockedFindings: filtered.length,
    cursorDenialKey: denial.key,
    cursorDenialCount: denial.count,
    chars: message.length,
    durationMs: Date.now() - started,
  });
}

main().catch((err) => {
  if (process.env.IMPECCABLE_HOOK_DEBUG) {
    process.stderr.write(`[impeccable-hook-before-edit] ${err}\n`);
  }
  done({ permission: 'allow' });
});
