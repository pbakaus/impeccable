#!/usr/bin/env node
/**
 * Impeccable design hook — PostToolUse + Stop entry point.
 *
 * Reads the Claude Code / Codex / Cursor hook event from stdin and routes by
 * `hook_event_name`:
 *
 *   - PostToolUse: runs the immediate-tier detector rules against the touched
 *     file and emits a system reminder via
 *     `hookSpecificOutput.additionalContext` when findings exist.
 *   - Stop: runs the FULL detector rule set over every UI file touched this
 *     session (the deep pass), deduped against what the per-edit pass already
 *     surfaced, and emits once via the Stop additionalContext channel.
 *
 * Contract: never break a turn. Always exit 0. Clean files emit a small ack
 * unless quiet mode is enabled; a clean Stop pass is silent.
 *
 * Most logic lives in `hook-lib.mjs` so it is unit-testable without a
 * subprocess. This file is the thin stdin/stdout adapter.
 */

import { runHook, runStopHook, writeAuditLog } from './hook-lib.mjs';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

function isStopEvent(stdinJson) {
  try {
    const event = JSON.parse(stdinJson);
    return event && typeof event === 'object' && event.hook_event_name === 'Stop';
  } catch {
    // Malformed stdin falls through to runHook, which audits the skip.
    return false;
  }
}

async function main() {
  // Snapshot the inherited env FIRST so the re-entrancy guard checks the
  // parent's value, not the value we are about to export for any child
  // processes the hook might ever spawn.
  const inheritedEnv = { ...process.env };
  process.env.IMPECCABLE_HOOK_DEPTH = process.env.IMPECCABLE_HOOK_DEPTH || '1';

  let stdinJson = '';
  try { stdinJson = await readStdin(); } catch { /* fall through */ }

  const run = isStopEvent(stdinJson) ? runStopHook : runHook;
  const result = await run({
    stdinJson,
    env: inheritedEnv,
    cwd: process.cwd(),
  });

  writeAuditLog(process.env, result.audit, process.cwd());

  if (result.stdout) process.stdout.write(result.stdout);
  process.exit(result.exitCode || 0);
}

main().catch((err) => {
  // Last-ditch: never break the agent's turn even if something we did not
  // anticipate goes wrong. Audit-log the failure if logging is enabled.
  try {
    writeAuditLog(process.env, {
      ts: new Date().toISOString(),
      event: 'hook-error',
      error: String(err && err.message ? err.message : err),
    });
  } catch { /* swallow */ }
  if (process.env.IMPECCABLE_HOOK_DEBUG) {
    process.stderr.write(`[impeccable-hook] ${err}\n`);
  }
  process.exit(0);
});
