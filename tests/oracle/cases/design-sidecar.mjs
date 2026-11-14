/** Content-fingerprint command and doctor end-to-end regressions (#846). */
import fs from 'node:fs';
import path from 'node:path';

const env = { IMPECCABLE_CONTEXT_DIR: '', IMPECCABLE_PROVIDER: 'claude-code', HOME: '<WS>/home' };
const files = ['DESIGN.md', '.impeccable/design.json'];
const source = ws => path.join(ws, 'DESIGN.md');
const timestampOnly = ws => fs.utimesSync(source(ws), 2000000000, 2000000000);
const changedBytesOldTime = ws => {
  fs.appendFileSync(source(ws), '\nA deliberate source edit.\n');
  fs.utimesSync(source(ws), 100, 100);
};

export default [
  { id: 'design-sidecar-help', verb: 'design-sidecar', args: ['--help'], workspace: 'ctx-empty', env },
  { id: 'design-sidecar-no-source', verb: 'design-sidecar', args: ['stamp'], workspace: 'ctx-empty', env },
  { id: 'design-sidecar-missing-target', verb: 'design-sidecar', args: ['stamp', '--target'], workspace: 'ctx-full', env, files },
  { id: 'design-sidecar-stamp', verb: 'design-sidecar', args: ['stamp'], workspace: 'ctx-full', env, files },
  { id: 'design-sidecar-checkout', workspace: 'ctx-full', env, files, steps: [
    { verb: 'design-sidecar', args: ['stamp'] },
    { verb: 'doctor', args: ['--json'], setup: timestampOnly },
  ] },
  { id: 'design-sidecar-source-edited', workspace: 'ctx-full', env, files, steps: [
    { verb: 'design-sidecar', args: ['stamp'] },
    { verb: 'doctor', args: ['--json'], setup: changedBytesOldTime },
  ] },
];
