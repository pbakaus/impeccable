#!/usr/bin/env node
/**
 * Canonical durable completion acknowledgement for Impeccable live sessions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLiveSessionStore } from './live/session-store.mjs';
import { readLiveServerInfo } from './lib/impeccable-paths.mjs';
import { enterLiveRoot } from './live/roots.mjs';
import { verifyAcceptedFile } from './live/accept-verify.mjs';

function parseArgs(argv) {
  const out = { status: 'complete' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--id') out.id = argv[++i];
    else if (arg.startsWith('--id=')) out.id = arg.slice('--id='.length);
    else if (arg === '--discarded' || arg === '--discard') out.status = 'discarded';
    else if (arg === '--error') { out.status = 'agent_error'; out.message = argv[++i] || 'unknown error'; }
    else if (arg.startsWith('--error=')) { out.status = 'agent_error'; out.message = arg.slice('--error='.length); }
    else if (arg === '--force') out.force = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

export async function completeCli() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.id) {
    console.log(`Usage: node live-complete.mjs --id SESSION_ID [--discarded|--error MESSAGE] [--force]\n\nAppend the final durable session acknowledgement. Use after accept/discard cleanup is verified.\nCompletion is refused while the session's source file still carries live-mode leftovers\n(markers, data-p-* attributes, unbaked --p-* vars); fix the file or pass --force.`);
    process.exit(args.help ? 0 : 1);
  }

  // The carbonize contract used to be prose; this makes it mechanical. A
  // "complete" while the source still carries live plumbing is how markers
  // and dead param branches accumulated across sessions.
  if (args.status === 'complete' && !args.force) {
    const store = createLiveSessionStore({ cwd: process.cwd(), sessionId: args.id });
    const snapshot = store.getSnapshot(args.id, { includeCompleted: true });
    const sourceFile = snapshot?.sourceFile;
    const absSource = sourceFile ? path.resolve(process.cwd(), sourceFile) : null;
    const relSource = absSource ? path.relative(process.cwd(), absSource) : null;
    const insideProject = relSource !== null && relSource !== '' && !relSource.startsWith('..') && !path.isAbsolute(relSource);
    if (insideProject && !relSource.startsWith('node_modules' + path.sep) && !relSource.startsWith('node_modules/')) {
      const verify = verifyAcceptedFile(fs, absSource);
      if (!verify.clean) {
        console.log(JSON.stringify({
          ok: false,
          error: 'source_dirty',
          id: args.id,
          file: sourceFile,
          findings: verify.findings,
          hint: 'The accepted source still carries live-mode leftovers. Finish the carbonize cleanup (bake params, remove markers and data-p-* attributes), then run live-complete again. Use --force only if a finding is a false positive.',
        }, null, 2));
        process.exit(1);
      }
    }
  }

  const serverInfo = readServerInfo();
  const serverResult = serverInfo ? await completeThroughServer(serverInfo, args) : null;
  if (serverResult?.ok) {
    const store = createLiveSessionStore({ cwd: process.cwd(), sessionId: args.id });
    const snapshot = store.getSnapshot(args.id, { includeCompleted: true });
    console.log(JSON.stringify({ ok: true, id: args.id, phase: snapshot?.phase || args.status, snapshot }, null, 2));
    return;
  }

  const store = createLiveSessionStore({ cwd: process.cwd(), sessionId: args.id });
  const event = args.status === 'discarded'
    ? { type: 'discarded', id: args.id }
    : args.status === 'agent_error'
      ? { type: 'agent_error', id: args.id, message: args.message || 'unknown error' }
      : { type: 'complete', id: args.id };
  const snapshot = store.appendEvent(event);
  console.log(JSON.stringify({ ok: true, id: args.id, phase: snapshot.phase, snapshot }, null, 2));
}

function readServerInfo() {
  return readLiveServerInfo(process.cwd())?.info || null;
}

async function completeThroughServer(info, args) {
  const type = args.status === 'discarded'
    ? 'discarded'
    : args.status === 'agent_error'
      ? 'error'
      : 'complete';
  try {
    const res = await fetch(`http://localhost:${info.port}/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: info.token, id: args.id, type, message: args.message }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const _running = process.argv[1];
if (_running?.endsWith('live-complete.mjs') || _running?.endsWith('live-complete.mjs/')) {
  enterLiveRoot();
  completeCli();
}
