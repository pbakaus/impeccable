#!/usr/bin/env node
/**
 * Impeccable design hook — Cursor afterFileEdit recorder.
 *
 * Runs detection on each agent file edit, queues fresh/pending findings for
 * the stop hook to surface as a one-shot followup_message. Never prints hook
 * output here — Cursor discards postToolUse/afterFileEdit additional_context.
 *
 * Contract: never break a turn. Always exit 0.
 */

import {
  runHook,
  appendPending,
  truthy,
  writeAuditLog,
  resolveHarness,
  normalizeHookEvent,
  resolveProjectCwd,
} from './hook-lib.mjs';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function main() {
  const inheritedEnv = { ...process.env };
  process.env.IMPECCABLE_HOOK_DEPTH = process.env.IMPECCABLE_HOOK_DEPTH || '1';

  if (truthy(inheritedEnv.IMPECCABLE_HOOK_DISABLED)) {
    writeAuditLog(process.env, {
      ts: new Date().toISOString(),
      event: 'afterFileEdit',
      skipped: 'env-disabled',
    });
    return process.exit(0);
  }

  let event = null;
  try {
    const raw = await readStdin();
    if (raw) event = JSON.parse(raw);
  } catch {
    writeAuditLog(process.env, {
      ts: new Date().toISOString(),
      event: 'afterFileEdit',
      skipped: 'stdin-malformed',
    });
    return process.exit(0);
  }

  const harness = resolveHarness(inheritedEnv, event);
  const cwd = resolveProjectCwd(event);
  const conversationId = event?.conversation_id || event?.session_id || null;
  event = normalizeHookEvent(event, cwd, harness);

  const result = await runHook({
    stdinJson: event,
    env: inheritedEnv,
    cwd,
  });

  let queued = false;
  if (
    result.emission
    && (result.emission.kind === 'fresh' || result.emission.kind === 'pending')
  ) {
    appendPending(cwd, conversationId, result.emission);
    queued = true;
  }

  writeAuditLog(process.env, {
    ...result.audit,
    event: 'afterFileEdit',
    queued,
    emissionKind: result.emission?.kind || null,
  });

  process.exit(0);
}

main().catch((err) => {
  if (process.env.IMPECCABLE_HOOK_DEBUG) {
    process.stderr.write(`[impeccable-hook-after-edit] ${err}\n`);
  }
  process.exit(0);
});
