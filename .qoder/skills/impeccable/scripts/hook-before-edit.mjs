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

import path from 'node:path';

import {
  ALLOWED_EXTS,
  GENERATED_PATH,
  SENSITIVE_PATH,
  filterFindings,
  loadDetector,
  matchesAnyGlob,
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

function allow(extra = {}) {
  writeAuditLog(process.env, {
    ts: new Date().toISOString(),
    event: 'preToolUse',
    ...extra,
  });
  return done({ permission: 'allow' });
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
    : shellRedirectPath(shellCommand(input));
  if (typeof candidate !== 'string' || !candidate.trim()) return '';
  return path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
}

function proposedContent(event) {
  const input = toolInput(event);
  for (const key of ['content', 'streamContent', 'new_string', 'newString', 'new_str', 'replacement', 'text']) {
    if (typeof input[key] === 'string') return input[key];
  }
  if (Array.isArray(input.edits)) {
    const parts = input.edits
      .map((edit) => edit && typeof edit === 'object'
        ? (edit.new_string || edit.newString || edit.replacement || edit.text || '')
        : '')
      .filter(Boolean);
    if (parts.length > 0) return parts.join('\n');
  }
  const shellContent = shellHereDocContent(shellCommand(input));
  if (shellContent) return shellContent;
  return '';
}

function shellCommand(input) {
  if (typeof input.command === 'string') return input.command;
  if (input.args && typeof input.args.command === 'string') return input.args.command;
  return '';
}

function shellRedirectPath(command) {
  if (!command || typeof command !== 'string') return '';
  const match = command.match(/(?:^|[\s;&|])(?:>|1>)\s*(?:"([^"]+)"|'([^']+)'|([^<>\s]+))/);
  return (match?.[1] || match?.[2] || match?.[3] || '').trim();
}

function shellHereDocContent(command) {
  if (!command || typeof command !== 'string') return '';
  const markerMatch = command.match(/<<-?\s*['"]?([A-Za-z0-9_.-]+)['"]?\r?\n/);
  if (!markerMatch) return '';
  const marker = markerMatch[1];
  const start = (markerMatch.index || 0) + markerMatch[0].length;
  const rest = command.slice(start);
  const endRe = new RegExp(`\\r?\\n${escapeRegExp(marker)}(?:\\r?\\n|$)`);
  const end = rest.search(endRe);
  return end >= 0 ? rest.slice(0, end) : '';
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
    '[impeccable@1] Required design corrections',
    '[impeccable@1] Impeccable design hook blocked this write before it landed. Required design corrections',
  );
  return blocked.length > 4000 ? `${blocked.slice(0, 3984)}\n...(truncated)` : blocked;
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
  const content = proposedContent(event);
  const audit = {
    harness: 'cursor',
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

  let findings = [];
  try {
    findings = await detector.detectText(content, filePath);
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

  const message = cursorBlockMessage(filtered, filePath, config, cwd);
  return deny(message, {
    ...audit,
    findings: (findings || []).length,
    blockedFindings: filtered.length,
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
