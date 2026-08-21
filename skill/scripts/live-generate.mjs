#!/usr/bin/env node
/**
 * Agent-initiated element targeting for the `generate` command.
 *
 * Asks the live overlay to find an element by CSS selector, scroll to it,
 * enter the picked state, and fire the normal Go pipeline with the given
 * action and count. On success the browser starts a standard generate
 * session; the agent then handles the resulting `generate` event from the
 * poll loop exactly as live.md describes. Requires a running live helper
 * server (live.mjs boot) and an open page with the overlay attached.
 *
 * Usage:
 *   node <scripts_path>/live-generate.mjs --selector "section.pricing" --action bolder --count 3
 *   node <scripts_path>/live-generate.mjs --selector ".card" --text "Studio" --action impeccable --prompt "warmer"
 *
 * Flags:
 *   --selector <css>   required; resolved with document.querySelectorAll
 *   --text <snippet>   optional; keeps only matches whose textContent contains it
 *   --index <n>        optional; 1-based pick among the remaining matches
 *   --action <name>    optional; one of the live action vocabulary (default: impeccable)
 *   --count <n>        optional; variants to request, 1-8 (default: 3)
 *   --prompt <text>    optional; freeform direction, same as typing before Go
 *   --dry-run          optional; resolve and report without starting anything
 *   --timeout <ms>     optional; client-side cap on the held request (default: 20000)
 *   --wait-for-browser <ms>  optional; poll the helper until a page with the
 *                      overlay connects (or the budget runs out) before
 *                      sending the target. For harnesses with no browser
 *                      tool: hand the user the URL, run with this flag, and
 *                      the command fires as soon as they open the page.
 */

import process from 'node:process';
import { enterLiveRoot } from './live/roots.mjs';
import { VISUAL_ACTIONS } from './live/vocabulary.mjs';
import { readLiveServerInfo } from './lib/impeccable-paths.mjs';

enterLiveRoot(process.cwd());

function fail(payload) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'dry-run') { args['dry-run'] = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      fail({ ok: false, error: 'missing_flag_value', flag: arg });
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const selector = (args.selector || '').trim();
if (!selector) {
  fail({
    ok: false,
    error: 'selector_required',
    _instructions: 'Pass --selector with a CSS selector for the element to target. Derive it from the page source: prefer an id, a unique class, or a landmark section, and add --text "<visible text>" when the class repeats.',
  });
}

const action = args.action || 'impeccable';
if (!VISUAL_ACTIONS.includes(action)) {
  fail({
    ok: false,
    error: 'invalid_action',
    action,
    validActions: VISUAL_ACTIONS,
    _instructions: 'Map the request wording onto the closest listed action (bold -> bolder, quiet/calmer -> quieter, simplify -> distill). When no action fits, use --action impeccable and carry the wording via --prompt.',
  });
}

const count = args.count === undefined ? 3 : Number(args.count);
if (!Number.isInteger(count) || count < 1 || count > 8) {
  fail({ ok: false, error: 'invalid_count', count: args.count, _instructions: 'Pass --count as an integer from 1 to 8.' });
}

let index;
if (args.index !== undefined) {
  index = Number(args.index);
  if (!Number.isInteger(index) || index < 1) {
    fail({ ok: false, error: 'invalid_index', index: args.index, _instructions: 'Pass --index as a 1-based integer position among the matches.' });
  }
}

const timeoutMs = args.timeout === undefined ? 20_000 : Number(args.timeout);

let waitForBrowserMs = 0;
if (args['wait-for-browser'] !== undefined) {
  waitForBrowserMs = Number(args['wait-for-browser']);
  if (!Number.isInteger(waitForBrowserMs) || waitForBrowserMs < 1) {
    fail({ ok: false, error: 'invalid_wait', wait: args['wait-for-browser'], _instructions: 'Pass --wait-for-browser as a positive integer of milliseconds, e.g. --wait-for-browser 120000.' });
  }
}

const found = readLiveServerInfo(process.cwd());
if (!found || !found.info || !found.info.port || !found.info.token) {
  fail({
    ok: false,
    error: 'server_not_running',
    _instructions: 'No live helper server is recorded for this project. Run the live boot first (node <scripts_path>/live.mjs), open the app URL that serves a pageFiles entry, then rerun this command.',
  });
}

const { port, token } = found.info;

const INSTRUCTIONS = {
  ok: (r) => (r.dryRun
    ? `Dry run only: the selector resolves to one element (${r.element?.tag}${r.element?.id ? '#' + r.element.id : ''}) and no session was started. Rerun without --dry-run to generate.`
    : `Session ${r.sessionId} started: the browser scrolled to the target and fired Go (action "${r.action}", count ${r.count}). Poll now with live-poll.mjs; the next event for this session is its generate event. Handle it exactly per live.md's Handle generate, then reply done and keep polling.`),
  no_browser_connected: () => 'No page with the live overlay is connected. Open the app URL that serves a pageFiles entry yourself with your harness browser tool, then rerun this command. Only when no browser tool exists: give the user the URL and rerun with --wait-for-browser 120000 so the command fires as soon as they open the page.',
  browser_timeout: () => 'The overlay did not answer in time. The page may be mid-reload: run live-status.mjs to check whether a session started anyway, reload the app page, then rerun this command.',
  invalid_selector: () => 'The selector is not valid CSS. Fix the selector syntax and rerun.',
  no_match: (r) => (r.rawMatchCount > 0
    ? `The selector hit ${r.rawMatchCount} node(s) but none is pickable (too small, chrome, or filtered by --text). Target a larger element or adjust --text.`
    : 'The selector matched nothing on the open page. Derive a better selector from the page source (an id, a unique class, or a landmark), or add --text with a snippet of the element\'s visible text.'),
  ambiguous: (r) => `The selector matched ${r.matchCount} elements. Either target their common container instead, or disambiguate with --text "<visible text>" or --index <1-based position>. The candidates are listed in this output.`,
  index_out_of_range: (r) => `--index is out of range: only ${r.matchCount} match(es). Use an index from 1 to ${r.matchCount}.`,
  busy: (r) => `A live session is already mid-flight (browser state ${r.state}). Let the user finish or discard it in the browser, or handle the pending event in your poll loop, then rerun.`,
  go_failed: (r) => `The overlay could not start generation from the picked state (browser state ${r.state}). Reload the app page and rerun this command.`,
  server_stopping: () => 'The live helper server is shutting down. Re-run the live boot (live.mjs), reopen the page, then rerun this command.',
};

async function waitForBrowserConnection(budgetMs) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    let status;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/status?token=${token}`, {
        signal: AbortSignal.timeout(5_000),
      });
      status = await res.json();
    } catch (err) {
      fail({
        ok: false,
        error: 'server_unreachable',
        detail: err?.message,
        _instructions: 'The recorded live server did not answer while waiting for a browser; it likely died. Re-run the live boot (node <scripts_path>/live.mjs), reopen the app page, then rerun this command.',
      });
    }
    if ((status.connectedClients || 0) > 0) return;
    if (Date.now() >= deadline) {
      fail({
        ok: false,
        error: 'no_browser_connected',
        waitedMs: budgetMs,
        _instructions: INSTRUCTIONS.no_browser_connected(),
      });
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

async function main() {
  if (waitForBrowserMs > 0) await waitForBrowserConnection(waitForBrowserMs);
  const body = {
    token,
    selector,
    action,
    count,
    ...(args.text ? { text: args.text } : {}),
    ...(index !== undefined ? { index } : {}),
    ...(args.prompt ? { prompt: args.prompt } : {}),
    ...(args['dry-run'] ? { dryRun: true } : {}),
  };
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}/agent-target`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    fail({
      ok: false,
      error: timedOut ? 'request_timeout' : 'server_unreachable',
      detail: err?.message,
      _instructions: timedOut
        ? INSTRUCTIONS.browser_timeout()
        : 'The recorded live server did not answer; it likely died. Re-run the live boot (node <scripts_path>/live.mjs), reopen the app page, then rerun this command.',
    });
  }
  let result;
  try {
    result = await res.json();
  } catch {
    fail({ ok: false, error: 'bad_server_response', status: res.status });
  }
  if (!res.ok) {
    fail({ ok: false, error: result.error || `http_${res.status}`, ...result });
  }
  const instructions = INSTRUCTIONS[result.ok ? 'ok' : result.error];
  const output = {
    ...result,
    ...(instructions ? { _instructions: instructions(result) } : {}),
  };
  console.log(JSON.stringify(output, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  fail({ ok: false, error: 'unexpected_failure', detail: err?.message });
});
