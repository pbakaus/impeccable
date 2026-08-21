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
 *   node picker-doc-poll.mjs --reply <id> done "msg" --answers '{"key":"value"}'
 *
 * Events printed: {"type":"edit_request","id","kind","prompt","category",
 * "payload"} for work a person asked for in words,
 * {"type":"save_batch","id","changes","downstream","replyCommand"} for edits
 * already applied to the store and owed a prose pass in DESIGN.md or
 * PRODUCT.md, {"type":"timeout"} when the budget runs out (poll again), and
 * {"type":"exit"} when the session ended (stop polling).
 *
 * Reply statuses: done (change applied; message shown to the user in the
 * document), error (could not apply; message explains), retry (release the
 * request back to pending).
 *
 * --answers and --context attach values for the session to write. The session
 * is the only writer of the store while it runs, so a value the agent settles
 * travels here rather than being written to those files directly.
 *
 * Session discovery: .impeccable/design-context/runtime/session.json, written
 * by the session process and removed when it exits; a missing file prints
 * {"type":"exit"} so a finished session never hangs the loop.
 */

import { readFile } from 'node:fs/promises';
import { paths } from './design-context/store.mjs';

const sessionPath = paths(process.cwd()).sessionJson;
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

const VALUE_FLAGS = new Set(['--answers', '--context', '--timeout']);

/* The message is whatever positional words are left, so a flag and the value
   that belongs to it both have to come out first, or an attached JSON payload
   would be read back to the user as their confirmation line. */
function positionalAfter(marker) {
  const words = [];
  for (let index = args.indexOf(marker) + 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      if (VALUE_FLAGS.has(arg)) index += 1;
      continue;
    }
    words.push(arg);
  }
  return words;
}

if (args.includes('--reply')) {
  const [id, status, ...rest] = positionalAfter('--reply');
  if (!id || !status) {
    console.error('usage: picker-doc-poll.mjs --reply <id> <done|error|retry> [message] [--answers JSON] [--context JSON]');
    process.exit(1);
  }
  /* Values the agent settled while doing the work, handed to the session to
     write. Bad JSON is a mistake worth stopping for rather than dropping. */
  const attached = {};
  for (const flag of ['answers', 'context']) {
    const raw = readFlag(`--${flag}`, '');
    if (!raw) continue;
    try {
      attached[flag] = JSON.parse(raw);
    } catch {
      console.error(`--${flag} must be a JSON object`);
      process.exit(1);
    }
  }
  const response = await fetch(`${base}/doc/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: info.token, id, status, message: rest.join(' '), ...attached }),
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
