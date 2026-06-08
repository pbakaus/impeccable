#!/usr/bin/env node
/**
 * Impeccable design hook — Cursor stop followup emitter.
 *
 * Drains the afterFileEdit pending queue and emits a one-shot followup_message
 * when findings exist. loop_limit: 1 on the manifest plus loop_count guard
 * here prevent infinite auto-submit loops.
 *
 * Contract: never break a turn. Always exit 0.
 */

import {
  drainPending,
  clearPending,
  renderCursorFollowup,
  followupPayload,
  readConfig,
  truthy,
  writeAuditLog,
  resolveProjectCwd,
} from './hook-lib.mjs';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function main() {
  let event = null;
  try {
    const raw = await readStdin();
    if (raw) event = JSON.parse(raw);
  } catch {
    writeAuditLog(process.env, {
      ts: new Date().toISOString(),
      event: 'stop',
      skipped: 'stdin-malformed',
    });
    return done(0, '');
  }

  const cwd = resolveProjectCwd(event);
  const conversationId = event?.conversation_id || event?.session_id || null;
  const loopCount = Number(event?.loop_count) || 0;

  if (truthy(process.env.IMPECCABLE_HOOK_DISABLED)) {
    clearPending(cwd, conversationId);
    writeAuditLog(process.env, {
      ts: new Date().toISOString(),
      event: 'stop',
      skipped: 'env-disabled',
    });
    return done(0, '');
  }

  if (loopCount >= 1) {
    clearPending(cwd, conversationId);
    writeAuditLog(process.env, {
      ts: new Date().toISOString(),
      event: 'stop',
      skipped: 'loop-guard',
      loopCount,
    });
    return done(0, '');
  }

  const config = readConfig(cwd);
  if (config.enabled === false) {
    clearPending(cwd, conversationId);
    writeAuditLog(process.env, {
      ts: new Date().toISOString(),
      event: 'stop',
      skipped: 'config-disabled',
    });
    return done(0, '');
  }

  const items = drainPending(cwd, conversationId);
  if (items.length === 0) {
    writeAuditLog(process.env, {
      ts: new Date().toISOString(),
      event: 'stop',
      skipped: 'empty-queue',
    });
    return done(0, '');
  }

  const text = renderCursorFollowup(items, { cwd, config });
  if (!text) {
    writeAuditLog(process.env, {
      ts: new Date().toISOString(),
      event: 'stop',
      skipped: 'empty-render',
      items: items.length,
    });
    return done(0, '');
  }

  writeAuditLog(process.env, {
    ts: new Date().toISOString(),
    event: 'stop',
    emitted: true,
    items: items.length,
    chars: text.length,
  });

  return done(0, followupPayload(text));
}

function done(code, out) {
  if (out) process.stdout.write(out);
  process.exit(code);
}

main().catch((err) => {
  if (process.env.IMPECCABLE_HOOK_DEBUG) {
    process.stderr.write(`[impeccable-hook-stop] ${err}\n`);
  }
  process.exit(0);
});
