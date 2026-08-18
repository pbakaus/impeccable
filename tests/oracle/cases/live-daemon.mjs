/**
 * One end-to-end helper-server flow driven through the daemon step support
 * in lib.mjs: start `live-server` detached, then status / poll / reply /
 * complete / stop against it. Everything run-dependent (port, token, pids,
 * lease and phase timestamps, durations) is masked per-case.
 */
import { LIVE_FILES, writeJournal } from '../live-helpers.mjs';

const ID = 'ab12cd34';
const GEN = { type: 'generate', action: 'bolder', count: 3, pageUrl: '/', element: { tagName: 'h1', id: 'hero', classes: ['hero-title'], textContent: 'Oracle Fixture', outerHTML: '<h1 id="hero" class="hero-title">Oracle Fixture</h1>' }, clientSentAt: 1754042400000 };
const NORM = [
  ['localhost:\\d{4,5}', 'g', 'localhost:<PORT>'],
  ['"(port|serverPort)":(\\s*)\\d{4,5}', 'g', '"$1":$2<PORT>'],
  ['Stopped live server on port \\d+\\.', 'g', 'Stopped live server on port <PORT>.'],
  ['already running on port \\d+ ', 'g', 'already running on port <PORT> '],
  ['"(leaseUntil|generationReadyAt|lastPollAt|generationCompletedAt|generationCanceledAt|at|leasedAt|clientSentAt)":(\\s*)\\d{10,}', 'g', '"$1":$2<EPOCH>'],
  ['"(durationMs|scaffoldDurationMs)":(\\s*)\\d+(?:\\.\\d+)?', 'g', '"$1":$2<N>'],
  // The journal embeds the float duration above, so its byte length moves too.
  ['"__journalBytes":(\\s*)\\d+', 'g', '"__journalBytes":$1<N>'],
];

export default [
  {
    id: 'live-daemon-server-status-poll-complete', workspace: 'live-html', files: [...LIVE_FILES, 'index.html'], normalize: NORM,
    // A durable session with a pending generate: the server restores it into
    // its queue on start, so the first poll leases it (running the deferred
    // wrap preflight against index.html) instead of timing out.
    setup: (ws) => writeJournal(ws, ID, [GEN]),
    steps: [
      { verb: 'live-server', daemon: true, readyFile: '.impeccable/live/server.json', readyTimeoutMs: 15000 },
      { verb: 'live-server', args: [] },
      { verb: 'live-status', args: [] },
      { verb: 'live-poll', args: ['--timeout=8000'] },
      { verb: 'live-poll', args: ['--reply', ID, 'done', '--file', 'index.html'] },
      { verb: 'live-poll', args: ['--timeout=300'] },
      { verb: 'live-poll', args: ['--reply', 'zz99zz99', 'done'] },
      { verb: 'live-poll', args: ['--reply', ID, 'steer_done'] },
      { verb: 'live-resume', args: [] },
      { verb: 'live-complete', args: ['--id', ID] },
      { verb: 'live-status', args: [] },
      { verb: 'live-server', args: ['stop'] },
      { verb: 'live-status', args: [] },
    ],
  },
];
