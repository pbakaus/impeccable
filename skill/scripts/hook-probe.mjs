#!/usr/bin/env node

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { cwd, env, stdin } from 'node:process';

async function readStdin() {
  let input = '';
  stdin.setEncoding('utf8');
  for await (const chunk of stdin) input += chunk;
  return input.trim();
}

function inferProvider(payload) {
  if (env.IMPECCABLE_HOOK_PROVIDER) return env.IMPECCABLE_HOOK_PROVIDER;
  if (payload?.provider) return String(payload.provider);
  if (payload?.workspaceId || ['afterFileEdit', 'stop'].includes(payload?.hook_event_name)) return 'cursor';
  if (payload?.session_id || payload?.tool_name) return 'claude';
  if (payload?.eventName || payload?.hook_event_name) return 'codex';
  if (payload?.event) return 'cursor';
  return 'unknown';
}

function inferEvent(payload) {
  return payload?.eventName
    || payload?.hook_event_name
    || payload?.event
    || payload?.tool_name
    || 'unknown';
}

try {
  const input = await readStdin();
  let payload = null;
  if (input) {
    try {
      payload = JSON.parse(input);
    } catch {
      payload = null;
    }
  }

  if (env.IMPECCABLE_HOOK_PROBE_LOG) {
    const line = {
      provider: inferProvider(payload),
      event: inferEvent(payload),
      file: payload?.file_path || payload?.file || payload?.path || payload?.tool_input?.file_path,
      cwd: cwd(),
      timestamp: new Date().toISOString(),
    };
    mkdirSync(dirname(env.IMPECCABLE_HOOK_PROBE_LOG), { recursive: true });
    appendFileSync(env.IMPECCABLE_HOOK_PROBE_LOG, `${JSON.stringify(line)}\n`);
  }
} catch {
  // Hooks must never block the user flow.
}
