/**
 * `live-generate` (the `generate` command's agent-initiated targeting): the
 * verdicts the verb decides locally, without a browser, plus the one the
 * helper answers when no overlay is attached. Everything that needs an
 * overlay (the roll call, leases, replay) is covered by
 * tests/live-agent-target.test.mjs and crates/cli/tests/agent_target.rs.
 */
import { LIVE_FILES } from '../live-helpers.mjs';

const NORM = [
  ['localhost:\\d{4,5}', 'g', 'localhost:<PORT>'],
  ['"(port|serverPort)":(\\s*)\\d{4,5}', 'g', '"$1":$2<PORT>'],
  ['Stopped live server on port \\d+\\.', 'g', 'Stopped live server on port <PORT>.'],
];

export default [
  {
    id: 'live-generate-local-verdicts', workspace: 'live-html', files: [...LIVE_FILES],
    // No helper is recorded in the staged workspace, so every step short
    // of a valid request ends in the verb's own verdict, and the valid one
    // ends in server_not_running.
    steps: [
      { verb: 'live-generate', args: ['--help'] },
      { verb: 'live-generate', args: [] },
      { verb: 'live-generate', args: ['--selector'] },
      { verb: 'live-generate', args: ['--selector', 'h1', '--action', 'bold'] },
      { verb: 'live-generate', args: ['--selector', 'h1', '--count', '9'] },
      { verb: 'live-generate', args: ['--selector', 'h1', '--count', 'three'] },
      { verb: 'live-generate', args: ['--selector', 'h1', '--index', '0'] },
      { verb: 'live-generate', args: ['--selector', 'h1', '--wait-for-browser', 'soon'] },
      { verb: 'live-generate', args: ['--selector', 'h1', '--action', 'bolder'] },
    ],
  },
  {
    id: 'live-generate-no-browser-connected', workspace: 'live-html', files: [...LIVE_FILES], normalize: NORM,
    // A running helper with no overlay attached answers at once instead of
    // holding the request.
    steps: [
      { verb: 'live-server', daemon: true, readyFile: '.impeccable/live/server.json', readyTimeoutMs: 15000 },
      { verb: 'live-generate', args: ['--selector', 'h1', '--action', 'bolder', '--count', '2', '--prompt', 'warmer'] },
      { verb: 'live-server', args: ['stop'] },
    ],
  },
];
