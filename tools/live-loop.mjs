/**
 * Attach an LLM-backed agent loop to a live-server that is already running
 * in the current working directory. Reads port + token from the PID file
 * (.impeccable-live.json) that live-server.mjs --background writes on boot.
 *
 * Usage (from the project root):
 *   ANTHROPIC_API_KEY=... node tools/live-loop.mjs
 *
 * Optional:
 *   IMPECCABLE_E2E_LLM_MODEL=claude-sonnet-4-6  (default: claude-haiku-4-5)
 *
 * Stop with Ctrl-C; the live-server keeps running until you call
 * `node skill/scripts/live-server.mjs stop`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAgentLoop } from '../tests/live-e2e/agent.mjs';
import { createLlmAgent } from '../tests/live-e2e/agents/llm-agent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'skill', 'scripts');
const PID_FILE = path.join(REPO_ROOT, '.impeccable-live.json');

if (!fs.existsSync(PID_FILE)) {
  console.error(
    `No live-server PID file at ${PID_FILE}. Start one first:\n` +
      `  node skill/scripts/live-server.mjs --background\n` +
      `  node skill/scripts/live-inject.mjs --port <PORT>`,
  );
  process.exit(1);
}

const { port, token } = JSON.parse(fs.readFileSync(PID_FILE, 'utf-8'));
console.log(`Attaching agent loop to live-server on :${port}`);

const agent = await createLlmAgent({
  model: process.env.IMPECCABLE_E2E_LLM_MODEL,
  log: (m) => console.log('[llm] ' + m),
});
if (!agent) {
  console.error('ANTHROPIC_API_KEY is not set. Set it and re-run.');
  process.exit(1);
}

const controller = new AbortController();

process.on('SIGINT', () => {
  console.log('\nStopping agent loop (live-server stays running).');
  controller.abort();
  setTimeout(() => process.exit(0), 200);
});
process.on('SIGTERM', () => controller.abort());

console.log(
  `Agent ready (model=${process.env.IMPECCABLE_E2E_LLM_MODEL || 'claude-haiku-4-5'}).\n` +
    `Pick an element in the browser and hit Go. Ctrl-C to stop.`,
);

await runAgentLoop({
  tmp: REPO_ROOT,
  scriptsDir: SCRIPTS_DIR,
  port,
  token,
  agent,
  signal: controller.signal,
  log: (m) => console.log('[agent] ' + m),
  // Per-event wrap target derived from the picked element's payload.
  // Preference: id > first class > tag-only.
  wrapTarget: (event) => {
    const el = event.element || {};
    const out = {};
    if (el.id) out.elementId = el.id;
    else if (Array.isArray(el.classes) && el.classes.length > 0) {
      // live-wrap matches when ALL listed classes are present on the source
      // node, so include only the first to maximize match likelihood.
      out.classes = el.classes[0];
    }
    if (el.tagName) out.tag = el.tagName.toLowerCase();
    return out;
  },
});
