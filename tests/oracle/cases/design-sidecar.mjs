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

const workspaceSidecar = ws => {
  fs.mkdirSync(path.join(ws, '.git'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }));
  const app = path.join(ws, 'apps/web');
  fs.mkdirSync(path.join(app, '.impeccable'), { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), '{}');
  fs.writeFileSync(path.join(app, 'DESIGN.md'), '# Child design\nUse green buttons.\n');
  fs.writeFileSync(path.join(app, '.impeccable/design.json'), '{"schemaVersion":2}');
};

export default [
  { id: 'design-sidecar-target-short-workspace', verb: 'design-sidecar', args: ['stamp', '--target', 'web'], workspace: 'ctx-full', env, setup: workspaceSidecar, files: [...files, 'apps/web/DESIGN.md', 'apps/web/.impeccable/design.json'] },
  { id: 'design-sidecar-target-unknown', verb: 'design-sidecar', args: ['stamp', '--target', 'missing'], workspace: 'ctx-full', env, files },
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
