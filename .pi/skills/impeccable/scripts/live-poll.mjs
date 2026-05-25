/**
 * CLI client for the live variant mode poll/reply protocol.
 *
 * Usage:
 *   npx impeccable poll                         # Block until browser event, print JSON
 *   npx impeccable poll --timeout=600000        # Custom timeout (ms); default is long-poll friendly
 *   npx impeccable poll --reply <id> done       # Reply "done" to event <id>
 *   npx impeccable poll --reply <id> error "msg" # Reply with error
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { completionAckForAcceptResult, completionTypeForAcceptResult } from './live-completion.mjs';
import { readLiveServerInfo } from './impeccable-paths.mjs';

// Node's built-in fetch (undici under the hood) enforces a 300s headers
// timeout that can't be lowered per-request. We cap each request below
// that ceiling and loop in `pollOnce` to synthesize a long poll without
// depending on the standalone undici package.
const PER_REQUEST_TIMEOUT_MS = 270_000;

function readServerInfo() {
  const record = readLiveServerInfo(process.cwd());
  if (!record) {
    console.error('No running live server found. Start one with: npx impeccable live');
    process.exit(1);
  }
  return record.info;
}

export function buildPollReplyPayload(token, { id, type, message, file, data }) {
  return { token, id, type, message, file, data };
}

export function manualApplyPollBanner(event = {}) {
  const id = event.id || 'EVENT_ID';
  return [
    `Manual Apply action required: edit source, then reply with \`live-poll.mjs --reply ${id} done --data '<json>'\`.`,
    'The JSON data must include status, appliedEntryIds, failed, files, and notes; summary counters are rejected.',
    'Do not run live-commit-manual-edits.mjs for this leased event.',
    'Do not poll again before replying.',
  ].join('\n') + '\n';
}

/**
 * Parse `--reply <id> <status> [--file path] [--data '<json>'] [message]` argv
 * into a reply object. Returns null when `--reply` is absent. Throws (code
 * INVALID_REPLY_ARGS) when the reply shape is missing its event id/status and
 * INVALID_DATA_JSON when `--data` is present but not valid JSON. Exported so
 * the arg-parsing contract is unit-tested without spawning a process.
 */
export function parseReplyArgs(args) {
  const replyIdx = args.indexOf('--reply');
  if (replyIdx === -1) return null;
  const id = args[replyIdx + 1];
  const status = args[replyIdx + 2];
  validateReplyArgs({ id, status });
  const fileIdx = args.indexOf('--file');
  const file = fileIdx !== -1 && fileIdx + 1 < args.length ? args[fileIdx + 1] : undefined;
  const dataIdx = args.indexOf('--data');
  let data;
  if (dataIdx !== -1 && dataIdx + 1 < args.length) {
    try {
      data = JSON.parse(args[dataIdx + 1]);
    } catch (err) {
      const wrapped = new Error('--data must be valid JSON: ' + err.message);
      wrapped.code = 'INVALID_DATA_JSON';
      throw wrapped;
    }
  }
  // Message is any remaining positional arg that isn't a flag or a flag's value.
  const message = args.find((a, i) =>
    i > replyIdx + 2
    && !a.startsWith('--')
    && i !== fileIdx + 1
    && i !== dataIdx + 1
  ) || undefined;
  return { id, type: status, message, file, data };
}

function validateReplyArgs({ id, status }) {
  const usage = "Usage: npx impeccable poll --reply <id> <status> [--file path] [--data '<json>'] [message]";
  if (!id || id.startsWith('--')) {
    const err = new Error(`${usage}\nMissing event id after --reply.`);
    err.code = 'INVALID_REPLY_ARGS';
    throw err;
  }
  if (['done', 'error', 'complete', 'discard', 'discarded'].includes(id)) {
    const err = new Error(`${usage}\nThe value after --reply must be the event id, not the status ${JSON.stringify(id)}. Use --reply EVENT_ID ${id}.`);
    err.code = 'INVALID_REPLY_ARGS';
    throw err;
  }
  if (!status || status.startsWith('--')) {
    const err = new Error(`${usage}\nMissing reply status after event id ${JSON.stringify(id)}.`);
    err.code = 'INVALID_REPLY_ARGS';
    throw err;
  }
}

async function postReply(base, token, reply) {
  const res = await fetch(`${base}/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPollReplyPayload(token, reply)),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const parts = [body.error || res.statusText, body.reason, body.hint].filter(Boolean);
    throw new Error(parts.join(': '));
  }
}

export async function pollCli() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: impeccable poll [options]

Wait for a browser event from the live variant server, or reply to one.

Modes:
  poll                             Block until a browser event arrives, print JSON
  poll --reply <id> done           Reply "done" to event <id>
  poll --reply <id> error "msg"    Reply with an error message
  poll --reply <id> done --data '<json>'
                                   Reply with a structured JSON result (manual_edit_apply)

Options:
  --timeout=MS   Long-poll timeout in ms (default: 600000). Use the default unless the user asked to pause live; never use a short timeout to end the chat turn
  --file PATH    Attach a source file path to the reply (generate flow)
  --data JSON    Attach a JSON result object to the reply (manual_edit_apply flow). Must be valid JSON
  --help         Show this help message`);
    process.exit(0);
  }

  const info = readServerInfo();
  const base = `http://localhost:${info.port}`;

  // Reply mode: npx impeccable poll --reply <id> <status> [--file path] [--data '<json>'] [message]
  if (args.includes('--reply')) {
    let reply;
    try {
      reply = parseReplyArgs(args);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }

    try {
      await postReply(base, info.token, reply);

      // Success — silent exit (agent doesn't need output for replies)
    } catch (err) {
      if (err.cause?.code === 'ECONNREFUSED') {
        console.error('Live server not running. Start one with: npx impeccable live');
      } else {
        console.error('Reply failed:', err.message);
      }
      process.exit(1);
    }
    return;
  }

  // Poll mode: block until browser event. Default 10 min. Node's built-in
  // fetch enforces a 300s headers timeout, so we loop in slices under that
  // ceiling and keep re-polling until we get a real event or the user's
  // total timeout runs out.
  const timeoutArg = args.find(a => a.startsWith('--timeout='));
  const totalTimeout = timeoutArg ? parseInt(timeoutArg.split('=')[1], 10) : 600000;

  const deadline = Date.now() + totalTimeout;
  let event;
  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        event = { type: 'timeout' };
        break;
      }
      const slice = Math.min(remaining, PER_REQUEST_TIMEOUT_MS);
      const res = await fetch(`${base}/poll?token=${info.token}&timeout=${slice}`);

      if (res.status === 401) {
        console.error('Authentication failed. The server token may have changed.');
        console.error('Try restarting: npx impeccable live stop && npx impeccable live');
        process.exit(1);
      }

      if (!res.ok) {
        console.error(`Poll failed: ${res.status} ${res.statusText}`);
        process.exit(1);
      }

      const next = await res.json();
      // Server-side timeout means no browser event arrived in this slice.
      // Loop and re-poll until we get a real event or we hit the user's
      // total deadline.
      if (next?.type === 'timeout' && Date.now() < deadline) continue;
      event = next;
      break;
    }

    // Auto-handle accept/discard via deterministic script
    if (event.type === 'accept' || event.type === 'discard') {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const acceptScript = path.join(__dirname, 'live-accept.mjs');
      const scriptArgs = event.type === 'discard'
        ? ['--id', event.id, '--discard']
        : ['--id', event.id, '--variant', event.variantId];
      if (event.pageUrl) {
        scriptArgs.push('--page-url', event.pageUrl);
      }
      if (event.type === 'accept' && event.paramValues && Object.keys(event.paramValues).length > 0) {
        scriptArgs.push('--param-values', JSON.stringify(event.paramValues));
      }
      try {
        const out = execFileSync(
          'node',
          [acceptScript, ...scriptArgs],
          { encoding: 'utf-8', cwd: process.cwd(), timeout: 30_000 }
        );
        event._acceptResult = JSON.parse(out.trim());
      } catch (err) {
        event._acceptResult = { handled: false, mode: 'error', error: err.message };
      }

      const completionType = completionTypeForAcceptResult(event.type, event._acceptResult);
      try {
        await postReply(base, info.token, {
          id: event.id,
          type: completionType,
          message: event._acceptResult?.error,
          file: event._acceptResult?.file,
          data: event._acceptResult?.carbonize === true ? { carbonize: true } : undefined,
        });
      } catch (err) {
        event._completionAck = { ok: false, error: err.message };
      }
      if (!event._completionAck) {
        event._completionAck = completionAckForAcceptResult(event.id, completionType, event._acceptResult);
      }
    }

    if (event.type === 'manual_edit_apply') {
      process.stderr.write('\n' + manualApplyPollBanner(event) + '\n');
    }

    // Second signal path: stderr banner in case the agent parses stdout
    // JSON but skips nested fields. One line is enough — the full checklist
    // is in reference/live.md.
    if (event._acceptResult?.carbonize === true) {
      process.stderr.write('\n⚠ Carbonize cleanup REQUIRED before next poll. After cleanup, run live-complete.mjs --id ' + event.id + '. See reference/live.md "Required after accept".\n\n');
    }

    // Print the event as JSON — the agent reads this from stdout
    console.log(JSON.stringify(event));
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED') {
      console.error('Live server not running. Start one with: npx impeccable live');
    } else {
      console.error('Poll failed:', err.message);
    }
    process.exit(1);
  }
}

// Auto-execute when run directly
const _running = process.argv[1];
if (_running?.endsWith('live-poll.mjs') || _running?.endsWith('live-poll.mjs/')) {
  pollCli();
}
