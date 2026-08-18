/**
 * `live-status`, `live-resume`, `live-complete`, `live-poll`, `live-server`
 * against staged durable session state (journals under
 * .impeccable/live/sessions). No helper server runs except in the daemon case.
 */
import { LIVE_FILES, rm, stageWrappedHtml, write, writeJournal } from '../live-helpers.mjs';

const F = LIVE_FILES;
const ID = 'ab12cd34';
const GEN = { type: 'generate', action: 'bolder', count: 3, pageUrl: '/', element: { tagName: 'h1', id: 'hero', classes: ['hero-title'], textContent: 'Oracle Fixture', outerHTML: '<h1 id="hero" class="hero-title">Oracle Fixture</h1>' }, clientSentAt: 1754042400000 };
const S = (id, verb, args, setup, extra = {}) => ({ id, verb, workspace: 'live-html', args, setup, files: F, ...extra });

const generating = (ws) => writeJournal(ws, ID, [GEN, { type: 'agent_phase', phase: 'picked_up', at: 1754042401000 }]);
const carbonizeRequired = (ws) => writeJournal(ws, ID, [GEN, { type: 'agent_done', file: 'index.html', sourceEventType: 'generate', carbonize: false, arrivedVariants: 3 }, { type: 'accept', variantId: '2', pageUrl: '/', paramValues: { face: 'serif' } }, { type: 'agent_done', file: 'index.html', sourceEventType: 'accept', carbonize: true }]);
const acceptRequested = (ws) => writeJournal(ws, ID, [GEN, { type: 'agent_done', file: 'index.html', sourceEventType: 'generate', arrivedVariants: 3 }, { type: 'checkpoint', revision: 3, revisionDomain: 'browser', owner: 'deadbeef', phase: 'cycling', reason: 'variants_ready', pageUrl: '/', expectedVariants: 3, arrivedVariants: 3, visibleVariant: 1, paramValues: { lightness: 0.5 } }, { type: 'accept', variantId: '1', pageUrl: '/', paramValues: { lightness: 0.6 } }]);
const manualApply = (ws) => writeJournal(ws, 'c0ffee01', [{ type: 'manual_edit_apply', pageUrl: '/', chunk: { index: 1, total: 2, opCount: 2, totalOpCount: 3 }, batch: { version: 1, pageUrl: '/', count: 1, entries: [{ id: 'e1', pageUrl: '/', ops: [{ ref: 'h1', tag: 'h1', originalText: 'A', newText: 'B', sourceHint: { file: 'index.html', line: 12 } }, { ref: 'p', tag: 'p', originalText: 'C', newText: 'D' }] }] }, evidencePath: '/tmp/x.json' }]);
const mountFailed = (ws) => writeJournal(ws, ID, [GEN, { type: 'agent_done', file: 'index.html', arrivedVariants: 3 }, { type: 'variant_mount_failed', variant: 2, url: 'http://localhost:5173/node_modules/.impeccable-live/ab12cd34/r1/v2.svelte', error: 'SyntaxError: unexpected token' }]);
const completed = (ws) => writeJournal(ws, ID, [GEN, { type: 'discard' }, { type: 'discarded' }]);
const twoSessions = (ws) => { generating(ws); writeJournal(ws, 'bb22cc33', [{ type: 'steer', message: 'make the hero calmer', pageUrl: '/' }]); completed(ws); writeJournal(ws, 'dd44ee55', [GEN, { type: 'complete', file: 'index.html' }]); };
const staleServerJson = (ws) => write(ws, '.impeccable/live/server.json', '{"pid":2147483646,"port":8497,"token":"stale"}');
const aliveServerJson = (ws) => write(ws, '.impeccable/live/server.json', JSON.stringify({ pid: process.pid, port: 65531, token: 'oracle-token' }));

export default [
  // --- live-status ---
  S('live-status-empty', 'live-status', [], null),
  S('live-status-generating', 'live-status', [], generating),
  S('live-status-many-sessions', 'live-status', [], twoSessions),
  S('live-status-manual-apply', 'live-status', [], manualApply),
  S('live-status-mount-failed', 'live-status', [], mountFailed),
  S('live-status-stale-server-json', 'live-status', [], (ws) => { generating(ws); staleServerJson(ws); }),
  S('live-status-legacy-sessions-dir', 'live-status', [], (ws) => write(ws, '.impeccable-live/sessions/legacy01.jsonl', JSON.stringify({ seq: 1, id: 'legacy01', type: 'generate', ts: '2026-08-01T10:00:00.000Z', event: { id: 'legacy01', ...GEN } }) + '\n')),
  S('live-status-target-missing-value', 'live-status', ['--target'], null),
  S('live-status-from-subdir', 'live-status', [], generating, { cwd: 'src' }),
  // --- live-resume ---
  S('live-resume-help', 'live-resume', ['--help'], null),
  S('live-resume-none', 'live-resume', [], null),
  S('live-resume-generating', 'live-resume', [], generating),
  S('live-resume-by-id', 'live-resume', ['--id', 'bb22cc33'], twoSessions),
  S('live-resume-by-id-eq', 'live-resume', ['--id=dd44ee55'], twoSessions),
  S('live-resume-unknown-id', 'live-resume', ['--id', 'zz99zz99'], generating),
  S('live-resume-first-active-sorted', 'live-resume', [], twoSessions),
  S('live-resume-carbonize-required', 'live-resume', [], carbonizeRequired),
  S('live-resume-accept-requested', 'live-resume', [], acceptRequested),
  S('live-resume-manual-apply', 'live-resume', [], manualApply),
  S('live-resume-mount-failed', 'live-resume', [], mountFailed),
  S('live-resume-completed-only', 'live-resume', [], completed),
  // --- live-complete ---
  S('live-complete-help', 'live-complete', ['--help'], null),
  S('live-complete-no-id', 'live-complete', [], null),
  S('live-complete-clean', 'live-complete', ['--id', ID], carbonizeRequired),
  S('live-complete-source-dirty', 'live-complete', ['--id', ID], (ws) => { carbonizeRequired(ws); stageWrappedHtml(ws); }, { files: [...F, 'index.html'] }),
  S('live-complete-source-dirty-force', 'live-complete', ['--id', ID, '--force'], (ws) => { carbonizeRequired(ws); stageWrappedHtml(ws); }),
  S('live-complete-source-dirty-carbonize-leftovers', 'live-complete', ['--id', ID], (ws) => {
    carbonizeRequired(ws);
    write(ws, 'index.html', '<html><body>\n<!-- impeccable-carbonize-start ab12cd34 -->\n<style>h1 { color: var(--p-lightness, 0.5); }</style>\n<!-- impeccable-param-values ab12cd34: {"lightness":0.7} -->\n<!-- impeccable-carbonize-end ab12cd34 -->\n<h1 data-p-italic="on" style="--impeccable-variant-ready: 1">Hi</h1>\n</body></html>\n');
  }),
  S('live-complete-discarded', 'live-complete', ['--id', ID, '--discarded'], generating),
  S('live-complete-discard-alias', 'live-complete', ['--id=' + ID, '--discard'], generating),
  S('live-complete-error', 'live-complete', ['--id', ID, '--error', 'variant generation crashed'], generating),
  S('live-complete-error-eq', 'live-complete', ['--id', ID, '--error=boom'], generating),
  S('live-complete-error-no-message', 'live-complete', ['--id', ID, '--error'], generating),
  S('live-complete-unknown-session', 'live-complete', ['--id', 'zz99zz99'], null),
  S('live-complete-twice', 'live-complete', ['--id', ID], carbonizeRequired, { steps: [{}, {}] }),
  S('live-complete-source-in-node-modules', 'live-complete', ['--id', ID], (ws) => writeJournal(ws, ID, [GEN, { type: 'agent_done', file: 'node_modules/.impeccable-live/ab12cd34/manifest.json', sourceFile: 'src/routes/+page.svelte', previewMode: 'svelte-component' }])),
  S('live-complete-source-missing-file', 'live-complete', ['--id', ID], (ws) => writeJournal(ws, ID, [GEN, { type: 'agent_done', file: 'src/gone.html' }])),
  // --- live-poll (no server, or a server.json whose pid is the recorder) ---
  S('live-poll-help', 'live-poll', ['--help'], null),
  S('live-poll-no-server', 'live-poll', [], null),
  S('live-poll-no-server-stale-record', 'live-poll', [], staleServerJson),
  S('live-poll-reply-missing-id', 'live-poll', ['--reply'], aliveServerJson),
  S('live-poll-reply-status-as-id', 'live-poll', ['--reply', 'done'], aliveServerJson),
  S('live-poll-reply-missing-status', 'live-poll', ['--reply', ID], aliveServerJson),
  S('live-poll-reply-status-flag', 'live-poll', ['--reply', ID, '--file', 'x'], aliveServerJson),
  S('live-poll-reply-bad-data-json', 'live-poll', ['--reply', ID, 'done', '--data', '{nope'], aliveServerJson),
  // Port 65531 on loopback: connection refused (nothing listens there).
  S('live-poll-reply-connection-refused', 'live-poll', ['--reply', ID, 'done'], aliveServerJson),
  S('live-poll-connection-refused', 'live-poll', ['--timeout=200'], aliveServerJson),
  // --- live-server (no process started) ---
  S('live-server-help', 'live-server', ['--help'], null),
  S('live-server-stop-none', 'live-server', ['stop'], null, { files: [...F, 'index.html'] }),
  S('live-server-stop-none-keep-inject', 'live-server', ['stop', '--keep-inject'], null),
  S('live-server-stop-removes-tag', 'live-server', ['stop'], (ws) => write(ws, 'index.html', '<html><body>\n<!-- impeccable-live-start -->\n<script src="http://localhost:8412/live.js?token=t"></script>\n<!-- impeccable-live-end -->\n</body></html>\n'), { files: [...F, 'index.html'] }),
  { id: 'live-server-stop-no-config', verb: 'live-server', workspace: 'live-vite', args: ['stop'], setup: (ws) => rm(ws, '.impeccable/live/config.json'), files: F },
  { id: 'live-server-already-running', verb: 'live-server', workspace: 'live-html', args: [], setup: aliveServerJson, files: F },
  { id: 'live-server-target-missing-value', verb: 'live-server', workspace: 'live-html', args: ['--target'] },
];
