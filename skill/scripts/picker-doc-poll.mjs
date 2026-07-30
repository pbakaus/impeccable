#!/usr/bin/env node
/** Agent poll CLI for the design-document edit session.
 *
 * The picker forks picker-doc-session.mjs on submit; this is how the agent
 * hears from it, on the live-poll.mjs contract: one-shot by default, block
 * until one event arrives, print it as JSON on stdout, exit.
 *
 *   node picker-doc-poll.mjs                       # block, print one event
 *   node picker-doc-poll.mjs --timeout=600000      # total budget in ms
 *   node picker-doc-poll.mjs --reply <id> <status> [message]
 *
 * Events printed: {"type":"edit_request","id","kind","prompt","category",
 * "payload"} for work, {"type":"timeout"} when the budget runs out (poll
 * again), {"type":"exit"} when the session ended (stop polling).
 *
 * Reply statuses: done (change applied; message shown to the user in the
 * document), error (could not apply; message explains), retry (release the
 * request back to pending).
 *
 * Session discovery: .impeccable/design-interview/doc-session.json, written
 * by the session process and removed when it exits; a missing file prints
 * {"type":"exit"} so a finished session never hangs the loop.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const sessionPath = path.resolve(process.cwd(), '.impeccable/design-interview/doc-session.json');
/* Sliced under undici's 300s header timeout, same as live-poll. */
const PER_REQUEST_MS = 270_000;
const DEFAULT_TOTAL_MS = 600_000;

async function session() {
  try {
    return JSON.parse(await readFile(sessionPath, 'utf8'));
  } catch {
    return null;
  }
}

const args = process.argv.slice(2);

function readFlag(name, fallback) {
  const exact = args.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const at = args.indexOf(name);
  if (at !== -1 && args[at + 1]) return args[at + 1];
  return fallback;
}

const info = await session();
if (!info) {
  console.log(JSON.stringify({ type: 'exit', reason: 'no-session' }));
  process.exit(0);
}
const base = `http://127.0.0.1:${info.port}`;

if (args.includes('--reply')) {
  const at = args.indexOf('--reply');
  const [id, status, ...rest] = args.slice(at + 1).filter((arg) => !arg.startsWith('--'));
  if (!id || !status) {
    console.error('usage: picker-doc-poll.mjs --reply <id> <done|error|retry> [message]');
    process.exit(1);
  }
  const response = await fetch(`${base}/doc/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: info.token, id, status, message: rest.join(' ') }),
  }).catch(() => null);
  if (!response?.ok) {
    console.error(`Reply failed: ${response ? response.status : 'session unreachable'}`);
    process.exit(1);
  }
  console.log(JSON.stringify(await response.json()));
  process.exit(0);
}

const totalBudget = Number(readFlag('--timeout', DEFAULT_TOTAL_MS));
const deadline = Date.now() + (Number.isFinite(totalBudget) && totalBudget > 0 ? totalBudget : DEFAULT_TOTAL_MS);

for (;;) {
  const slice = Math.min(deadline - Date.now(), PER_REQUEST_MS);
  if (slice <= 0) {
    console.log(JSON.stringify({ type: 'timeout' }));
    process.exit(0);
  }
  let payload;
  try {
    const response = await fetch(`${base}/doc/poll?token=${encodeURIComponent(info.token)}&timeout=${slice}`);
    payload = await response.json();
  } catch {
    /* The session process exited between polls. */
    console.log(JSON.stringify({ type: 'exit', reason: 'session-gone' }));
    process.exit(0);
  }
  if (payload.type === 'timeout') continue;
  console.log(JSON.stringify(payload));
  process.exit(0);
}
