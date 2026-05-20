#!/usr/bin/env node
/**
 * Applies staged live copy-edit batches by waking a local AI coding agent.
 *
 * The browser Save path stages edits. Apply copy edits calls
 * live-commit-manual-edits.mjs, which builds a page-scoped batch and uses this
 * helper to ask Codex/Claude to edit true source files. The older event CLI at
 * the bottom is kept only for compatibility with stale queued events.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 60_000;

export function buildCopyEditBatchPrompt(batch, { cwd = process.cwd() } = {}) {
  return [
    'You are the Impeccable staged copy-edit batch applier.',
    '',
    'Apply the staged browser copy edits to the real source files in this repository.',
    '',
    'Rules:',
    '- Apply all staged edits in one coherent batch.',
    '- Use DOM refs, leaf/container HTML, source hints, nearby text, and candidate source evidence as context, not as an automatic resolver decision.',
    '- Prefer true source files over generated provider output.',
    '- Make the smallest source changes needed for the visible copy to match each newText.',
    '- If an original string is also used as a clearly coupled data key, object key, animation key, count label, or reference, update that related reference too.',
    '- If a reference change is broad, ambiguous, or risky, do not guess; report that entry as failed with candidate files/lines.',
    '- Preserve unrelated site/demo edits and unrelated staged changes.',
    '- After editing, check touched JS files with node --check where applicable and inspect touched Astro/HTML for obvious syntax damage.',
    '- Check for leftover impeccable-carbonize markers or variant wrapper markers in touched files.',
    '',
    'Final response contract:',
    'Return ONLY JSON, with no markdown fence and no prose.',
    'Success:',
    '{"status":"done","appliedEntryIds":["entry-id"],"files":["relative/path.ext"],"notes":[]}',
    'Partial success:',
    '{"status":"partial","appliedEntryIds":["entry-id"],"failed":[{"entryId":"entry-id","reason":"why","candidates":[{"file":"relative/path.ext","line":1}]}],"files":["relative/path.ext"],"notes":[]}',
    'Failure:',
    '{"status":"error","message":"why it could not be applied safely","failed":[{"entryId":"entry-id","reason":"why"}],"files":[]}',
    '',
    'Repository root:',
    cwd,
    '',
    'Staged copy-edit batch:',
    JSON.stringify(compactBatchForPrompt(batch), null, 2),
  ].join('\n');
}

export function parseCopyEditBatchResult(text) {
  const parsed = parseCopyEditAgentResult(text);
  if (parsed?.status === 'done' || parsed?.status === 'partial' || parsed?.status === 'error') {
    return normalizeBatchResult(parsed);
  }
  return null;
}

export async function runCopyEditBatchAgent(batch, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || process.env;
  const provider = opts.provider || chooseCopyEditAgent({ env });
  if (provider === 'mock') return mockBatchResult(batch, env);
  if (!provider) {
    throw new Error('No live copy-edit AI runner found. Install/authenticate Codex or Claude, or set IMPECCABLE_LIVE_COPY_AGENT=mock for tests.');
  }

  const prompt = buildCopyEditBatchPrompt(batch, { cwd });
  const outDir = opts.outDir || fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-copy-batch-'));
  fs.mkdirSync(outDir, { recursive: true });
  const resultPath = path.join(outDir, 'result.json');
  const logPath = path.join(outDir, 'agent.log');

  if (provider === 'codex') {
    await runCodex(prompt, { cwd, env, resultPath, logPath, timeoutMs: opts.timeoutMs });
  } else if (provider === 'claude') {
    await runClaude(prompt, { cwd, env, resultPath, logPath, timeoutMs: opts.timeoutMs });
  } else {
    throw new Error(`Unsupported live copy-edit AI runner: ${provider}`);
  }

  const output = fs.existsSync(resultPath) ? fs.readFileSync(resultPath, 'utf-8') : '';
  const parsed = parseCopyEditBatchResult(output);
  if (parsed) return parsed;

  const tail = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').slice(-1200) : output.slice(-1200);
  throw new Error('AI copy-edit batch did not return a valid completion payload. ' + tail.trim());
}

export function runCopyEditPostApplyChecks({ cwd = process.cwd(), files = [] } = {}) {
  const failures = [];
  const warnings = [];
  const uniqueFiles = [...new Set((files || []).filter((file) => typeof file === 'string' && file.trim()))];
  for (const relativeFile of uniqueFiles) {
    const file = path.resolve(cwd, relativeFile);
    if (!isPathInsideOrEqual(cwd, file) || !fs.existsSync(file)) {
      warnings.push({ file: relativeFile, reason: 'file_missing_or_outside_cwd' });
      continue;
    }
    let content = '';
    try { content = fs.readFileSync(file, 'utf-8'); } catch (err) {
      failures.push({ file: relativeFile, reason: 'read_failed', message: err.message });
      continue;
    }
    const markerMatch = content.match(/impeccable-carbonize-|data-impeccable-variant|IMPECCABLE_VARIANT|impeccable-live-variant/);
    if (markerMatch) failures.push({ file: relativeFile, reason: 'leftover_impeccable_marker', marker: markerMatch[0] });
    if (/\.(mjs|cjs|js)$/.test(relativeFile)) {
      const check = spawnSync(process.execPath, ['--check', file], { cwd, encoding: 'utf-8' });
      if (check.status !== 0) {
        failures.push({
          file: relativeFile,
          reason: 'invalid_js',
          message: (check.stderr || check.stdout || '').trim(),
        });
      }
    }
  }
  return { ok: failures.length === 0, failures, warnings };
}

function compactBatchForPrompt(batch) {
  return {
    pageUrl: batch?.pageUrl || null,
    entries: (batch?.entries || []).map((entry) => ({
      id: entry.id,
      pageUrl: entry.pageUrl,
      stagedAt: entry.stagedAt || null,
      element: compactContextForBatch(entry.element),
      ops: (entry.ops || []).map(compactBatchOp),
    })),
    candidates: batch?.candidates || [],
  };
}

function compactBatchOp(op) {
  return {
    entryId: op.entryId,
    ref: op.ref,
    contextRef: op.contextRef,
    tag: op.tag,
    elementId: op.elementId,
    classes: op.classes,
    originalText: op.originalText,
    newText: op.newText,
    deleted: op.deleted === true || undefined,
    sourceHint: op.sourceHint,
    leaf: compactContextForBatch(op.leaf),
    nearbyEditableTexts: Array.isArray(op.nearbyEditableTexts) ? op.nearbyEditableTexts.slice(0, 8) : [],
    container: compactContextForBatch(op.container),
    contextHints: Array.isArray(op.contextHints) ? op.contextHints.slice(0, 12) : [],
  };
}

function compactContextForBatch(value) {
  if (!value || typeof value !== 'object') return value || null;
  return {
    ref: value.ref,
    tagName: value.tagName,
    id: value.id,
    classes: value.classes,
    textContent: truncate(value.textContent, 900),
    outerHTML: truncate(value.outerHTML, 1800),
  };
}

function normalizeBatchResult(result) {
  const status = result.status === 'partial' ? 'partial' : result.status === 'error' ? 'error' : 'done';
  const appliedEntryIds = Array.isArray(result.appliedEntryIds)
    ? result.appliedEntryIds.filter((id) => typeof id === 'string')
    : [];
  const failed = Array.isArray(result.failed)
    ? result.failed.filter(Boolean).map((item) => ({
        entryId: item.entryId || item.id || null,
        reason: item.reason || item.message || 'failed',
        candidates: Array.isArray(item.candidates) ? item.candidates : [],
      }))
    : [];
  const files = Array.isArray(result.files) ? result.files.filter((file) => typeof file === 'string') : [];
  const notes = Array.isArray(result.notes) ? result.notes.filter((note) => typeof note === 'string') : [];
  return {
    status,
    message: result.message || null,
    appliedEntryIds,
    failed,
    files,
    notes,
  };
}

function mockBatchResult(batch, env) {
  const raw = env.IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT;
  if (raw) {
    const parsed = parseCopyEditBatchResult(raw);
    if (parsed) return parsed;
    throw new Error('Invalid IMPECCABLE_LIVE_COPY_AGENT_MOCK_RESULT JSON');
  }
  return {
    status: 'done',
    appliedEntryIds: (batch?.entries || []).map((entry) => entry.id).filter(Boolean),
    failed: [],
    files: [],
    notes: ['mock copy-edit batch result'],
  };
}

export function buildCopyEditAgentPrompt(event, { cwd = process.cwd() } = {}) {
  return [
    'You are the Impeccable live copy-edit applier.',
    '',
    'Apply the requested inline copy edit to the real source files in this repository.',
    '',
    'Rules:',
    '- Make the smallest source change that causes the edited browser text to match newText.',
    '- Prefer a valid sourceHint, but verify it before editing.',
    '- If the source text already changed because a newer save raced this one, preserve the user-visible newest intent and do not undo it.',
    '- If the visible string is used as a data key or reference, update related references carefully.',
    '- Do not change unrelated styling, layout, generated files, or demo copy.',
    '- Do not run a broad build unless needed; for plain Astro/JS copy edits, syntax-check or inspect the touched file.',
    '- Never call live-poll.mjs yourself. This worker will acknowledge the browser after you finish.',
    '',
    'Final response contract:',
    'Return ONLY JSON, with no markdown fence and no prose:',
    '{"status":"done","files":["relative/path.ext"]}',
    'or:',
    '{"status":"error","message":"why it could not be applied safely"}',
    '',
    'Repository root:',
    cwd,
    '',
    'Copy edit event:',
    JSON.stringify(compactEventForPrompt(event), null, 2),
  ].join('\n');
}

export function parseCopyEditAgentResult(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  const parsedOuter = tryParseJson(trimmed);
  if (parsedOuter) {
    if (typeof parsedOuter.result === 'string') {
      const nested = parseCopyEditAgentResult(parsedOuter.result);
      if (nested) return nested;
    }
    if (parsedOuter.status === 'done' || parsedOuter.status === 'partial' || parsedOuter.status === 'error') return parsedOuter;
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  const parsed = tryParseJson(jsonMatch[0]);
  if (parsed?.status === 'done' || parsed?.status === 'partial' || parsed?.status === 'error') return parsed;
  return null;
}

export function chooseCopyEditAgent({ env = process.env } = {}) {
  const mode = (env.IMPECCABLE_LIVE_COPY_AGENT || 'auto').trim().toLowerCase();
  if (mode === '0' || mode === 'false' || mode === 'off' || mode === 'none') return null;
  if (mode === 'mock') return 'mock';
  if (mode === 'codex') return commandExists('codex') ? 'codex' : null;
  if (mode === 'claude') return commandExists('claude') ? 'claude' : null;
  if (mode !== 'auto') return null;
  if (commandExists('codex')) return 'codex';
  if (commandExists('claude')) return 'claude';
  return null;
}

export async function runCopyEditAgent(event, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || process.env;
  const provider = opts.provider || chooseCopyEditAgent({ env });
  if (!provider) {
    throw new Error('No live copy-edit AI runner found. Install/authenticate Codex or Claude, or set IMPECCABLE_LIVE_COPY_AGENT=off.');
  }

  const prompt = buildCopyEditAgentPrompt(event, { cwd });
  const outDir = opts.outDir || fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-copy-agent-'));
  fs.mkdirSync(outDir, { recursive: true });
  const resultPath = path.join(outDir, 'result.json');
  const logPath = path.join(outDir, 'agent.log');

  if (provider === 'codex') {
    await runCodex(prompt, { cwd, env, resultPath, logPath, timeoutMs: opts.timeoutMs });
  } else if (provider === 'claude') {
    await runClaude(prompt, { cwd, env, resultPath, logPath, timeoutMs: opts.timeoutMs });
  } else {
    throw new Error(`Unsupported live copy-edit AI runner: ${provider}`);
  }

  const output = fs.existsSync(resultPath) ? fs.readFileSync(resultPath, 'utf-8') : '';
  const parsed = parseCopyEditAgentResult(output);
  if (parsed?.status === 'error') throw new Error(parsed.message || 'AI copy edit failed');
  if (parsed?.status === 'done') return normalizeDoneResult(parsed, event, cwd);

  if (eventLikelyApplied(event, cwd)) {
    return { status: 'done', files: likelyTouchedFiles(event, cwd) };
  }

  const tail = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').slice(-1200) : output.slice(-1200);
  throw new Error('AI copy edit did not return a valid completion payload. ' + tail.trim());
}

function compactEventForPrompt(event) {
  return {
    id: event?.id,
    pageUrl: event?.pageUrl,
    element: {
      tagName: event?.element?.tagName,
      id: event?.element?.id,
      classes: event?.element?.classes,
      textContent: truncate(event?.element?.textContent, 900),
      outerHTML: truncate(event?.element?.outerHTML, 1600),
    },
    ops: (event?.ops || []).map((op) => ({
      ref: op.ref,
      contextRef: op.contextRef,
      tag: op.tag,
      elementId: op.elementId,
      classes: op.classes,
      originalText: op.originalText,
      newText: op.newText,
      deleted: op.deleted === true || undefined,
      sourceHint: op.sourceHint,
      leaf: op.leaf ? {
        ref: op.leaf.ref,
        tagName: op.leaf.tagName,
        classes: op.leaf.classes,
        textContent: truncate(op.leaf.textContent, 500),
        outerHTML: truncate(op.leaf.outerHTML, 1000),
      } : undefined,
      nearbyEditableTexts: Array.isArray(op.nearbyEditableTexts) ? op.nearbyEditableTexts.slice(0, 6) : [],
      container: op.container ? {
        ref: op.container.ref,
        tagName: op.container.tagName,
        classes: op.container.classes,
        textContent: truncate(op.container.textContent, 900),
        outerHTML: truncate(op.container.outerHTML, 1600),
      } : undefined,
    })),
  };
}

function runCodex(prompt, { cwd, env, resultPath, logPath, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const args = [
    'exec',
    '--cd', cwd,
    '--dangerously-bypass-approvals-and-sandbox',
    '--ephemeral',
    '--output-last-message', resultPath,
    '-c', `model_reasoning_effort="${env.IMPECCABLE_LIVE_COPY_AGENT_EFFORT || 'low'}"`,
  ];
  if (env.IMPECCABLE_LIVE_COPY_AGENT_MODEL) {
    args.push('--model', env.IMPECCABLE_LIVE_COPY_AGENT_MODEL);
  }
  args.push('-');
  return runAgentProcess('codex', args, prompt, { cwd, env, logPath, timeoutMs });
}

function runClaude(prompt, { cwd, env, resultPath, logPath, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const args = [
    '--print',
    '--permission-mode', 'bypassPermissions',
    '--output-format', 'json',
    '--no-session-persistence',
  ];
  if (env.IMPECCABLE_LIVE_COPY_AGENT_MODEL) {
    args.push('--model', env.IMPECCABLE_LIVE_COPY_AGENT_MODEL);
  }
  args.push(prompt);
  return runAgentProcess('claude', args, '', { cwd, env: { ...env, CLAUDE_CODE_SIMPLE: '1' }, logPath, timeoutMs, mirrorOutputPath: resultPath });
}

function runAgentProcess(command, args, stdin, { cwd, env, logPath, timeoutMs, mirrorOutputPath }) {
  return new Promise((resolve, reject) => {
    const log = fs.createWriteStream(logPath, { flags: 'a' });
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      rejectOnce(new Error(`AI copy-edit worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const rejectOnce = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      log.end();
      reject(err);
    };
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (mirrorOutputPath) fs.writeFileSync(mirrorOutputPath, output);
      log.end();
      resolve();
    };

    process.once('SIGTERM', () => {
      try { child.kill('SIGTERM'); } catch {}
    });
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      log.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      log.write(chunk);
    });
    child.on('error', rejectOnce);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolveOnce();
      } else {
        rejectOnce(new Error(`${command} exited with ${signal || code}`));
      }
    });
    if (stdin) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

function normalizeDoneResult(result, event, cwd) {
  const files = Array.isArray(result.files) && result.files.length
    ? result.files.filter((file) => typeof file === 'string')
    : likelyTouchedFiles(event, cwd);
  return { status: 'done', files };
}

function eventLikelyApplied(event, cwd) {
  return (event?.ops || []).every((op) => {
    if (op.deleted === true) return true;
    if (typeof op.newText !== 'string') return false;
    const file = resolveSourceHintFile(op.sourceHint, cwd);
    if (!file) return false;
    try {
      return fs.readFileSync(file, 'utf-8').includes(op.newText);
    } catch {
      return false;
    }
  });
}

function likelyTouchedFiles(event, cwd) {
  return [...new Set((event?.ops || [])
    .map((op) => resolveSourceHintFile(op.sourceHint, cwd))
    .filter(Boolean)
    .map((file) => path.relative(cwd, file) || file))];
}

function resolveSourceHintFile(sourceHint, cwd) {
  if (!sourceHint?.file || typeof sourceHint.file !== 'string') return null;
  const file = path.isAbsolute(sourceHint.file) ? sourceHint.file : path.resolve(cwd, sourceHint.file);
  const relative = path.relative(cwd, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return file;
}

function isPathInsideOrEqual(cwd, file) {
  const relative = path.relative(path.resolve(cwd), path.resolve(file));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function truncate(value, max) {
  if (typeof value !== 'string') return value;
  if (value.length <= max) return value;
  return value.slice(0, max) + `... [truncated ${value.length - max} chars]`;
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

async function postReply({ port, token, id, type, message, file }) {
  const res = await fetch(`http://localhost:${port}/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, id, type, message, file }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `reply failed: ${res.status}`);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--event-file') out.eventFile = argv[++i];
    else if (arg.startsWith('--event-file=')) out.eventFile = arg.slice('--event-file='.length);
    else if (arg === '--port') out.port = Number(argv[++i]);
    else if (arg.startsWith('--port=')) out.port = Number(arg.slice('--port='.length));
    else if (arg === '--token') out.token = argv[++i];
    else if (arg.startsWith('--token=')) out.token = arg.slice('--token='.length);
    else if (arg === '--provider') out.provider = argv[++i];
    else if (arg.startsWith('--provider=')) out.provider = arg.slice('--provider='.length);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.eventFile || !args.port || !args.token) {
    console.error('Usage: node live-copy-edit-agent.mjs --event-file <json> --port <port> --token <token> [--provider auto|codex|claude]');
    process.exit(1);
  }
  const event = JSON.parse(fs.readFileSync(args.eventFile, 'utf-8'));
  try {
    const result = await runCopyEditAgent(event, { provider: args.provider === 'auto' ? undefined : args.provider });
    await postReply({
      port: args.port,
      token: args.token,
      id: event.id,
      type: 'done',
      file: result.files?.[0],
    });
  } catch (err) {
    await postReply({
      port: args.port,
      token: args.token,
      id: event.id,
      type: 'error',
      message: err.message || String(err),
    }).catch(() => {});
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('live-copy-edit-agent.mjs')) {
  main();
}
