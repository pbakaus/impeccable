/**
 * Corpus for the comp-fidelity verbs: `comp-spec`, `comp-diff`, `font-match`,
 * `build-phase`. Only the deterministic, browser-free paths are exercised here
 * (the font-match browser ranking and the comp-diff artifact PNGs vary by
 * Chrome/encoder and are covered by Rust tests instead).
 *
 * Workspace tests/oracle/workspaces/comp-basic:
 *   comp.png       a 768x512 comp fixture (from crates/comp/tests/fixtures)
 *   build.png      a recolored build capture of the same composition
 *   regions.json   three regions (chrome / plate / text) with allowUncovered
 *   spec.json      a pre-measured spec of comp.png+regions.json (the fixture the
 *                  print / diff / measure cases read; the regions case rewrites
 *                  its own under .impeccable/build/)
 *
 * ISO timestamps in stdout and in the written spec/state are masked by the
 * harness, so the createdAt/startedAt fields never make a golden run-dependent.
 */

import fs from 'node:fs';
import path from 'node:path';

const WS = 'comp-basic';

const write = (ws, rel, body) => {
  const abs = path.join(ws, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
};

// The comp verbs emit no staleness/update directives, but pin the catalog and
// skill-dir overrides so a recording machine's env never leaks a font-index
// path or a native reference into the output.
const BASE_ENV = {
  IMPECCABLE_CATALOG_DIR: null,
  IMPECCABLE_SKILL_DIR: null,
  IMPECCABLE_SELF: null,
  IMPECCABLE_BROWSER: null,
  PUPPETEER_EXECUTABLE_PATH: null,
  CHROME_PATH: null,
  CI: null,
};
const env = (extra = {}) => ({ ...BASE_ENV, ...extra });

const cases = [
  // comp-spec: grid readout (stdout only), full measure (writes spec.json), print.
  { id: 'comp-spec-grid', verb: 'comp-spec', workspace: WS, args: ['--comp', 'comp.png', '--grid'], env: env() },
  {
    id: 'comp-spec-regions', verb: 'comp-spec', workspace: WS,
    args: ['--comp', 'comp.png', '--regions', 'regions.json'],
    files: ['.impeccable/build/spec.json'], env: env(),
  },
  { id: 'comp-spec-print', verb: 'comp-spec', workspace: WS, args: ['--print', '--spec', 'spec.json'], env: env() },
  { id: 'comp-spec-plate-prompt', verb: 'comp-spec', workspace: WS, args: ['--plate-prompt', 'art', '--spec', 'spec.json'], env: env() },
  { id: 'comp-spec-usage', verb: 'comp-spec', workspace: WS, args: [], env: env() },
  {
    id: 'comp-spec-refuses-painted-chrome', verb: 'comp-spec', workspace: WS,
    setup: (ws) => write(ws, 'bad.json', JSON.stringify({ allowUncovered: true, regions: [{ id: 'x', kind: 'chrome', grid: 'A0:B1', note: 'an exploded diagram illustration' }] })),
    args: ['--comp', 'comp.png', '--regions', 'bad.json'], env: env(),
  },

  // comp-diff: with a spec (region rows) and without (derived bands).
  { id: 'comp-diff-json', verb: 'comp-diff', workspace: WS, args: ['--comp', 'comp.png', '--build', 'build.png', '--spec', 'spec.json', '--no-files', '--json'], env: env() },
  { id: 'comp-diff-text', verb: 'comp-diff', workspace: WS, args: ['--comp', 'comp.png', '--build', 'build.png', '--spec', 'spec.json', '--no-files'], env: env() },
  { id: 'comp-diff-no-spec', verb: 'comp-diff', workspace: WS, args: ['--comp', 'comp.png', '--build', 'build.png', '--no-files', '--json'], env: env() },
  { id: 'comp-diff-threshold-below', verb: 'comp-diff', workspace: WS, args: ['--comp', 'comp.png', '--build', 'build.png', '--spec', 'spec.json', '--no-files', '--threshold', '0.95'], env: env() },
  { id: 'comp-diff-usage', verb: 'comp-diff', workspace: WS, args: ['--comp', 'comp.png'], env: env() },

  // font-match: MEASURE (pure; writes type onto the region). RANK is skipped
  // here because it needs a browser; the no-browser catalog fallback needs the
  // moat's font-index, which is not present in this repo's oracle env.
  { id: 'font-match-measure', verb: 'font-match', workspace: WS, args: ['--measure', 'body', '--spec', 'spec.json'], files: ['spec.json'], env: env() },
  { id: 'font-match-usage', verb: 'font-match', workspace: WS, args: [], env: env() },

  // build-phase: start (reads comp dims) then status, sharing one workspace.
  {
    id: 'build-phase-start-status', verb: 'build-phase', workspace: WS,
    files: ['.impeccable/build/state.json'], env: env(),
    steps: [{ args: ['start', '--comp', 'comp.png'] }, { args: ['status'] }],
  },
  { id: 'build-phase-usage', verb: 'build-phase', workspace: WS, args: [], env: env() },
];

export default cases;
