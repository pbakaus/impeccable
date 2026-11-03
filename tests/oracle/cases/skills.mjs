/**
 * The installer verbs' static help (`install`, `link`, `update`, `check`).
 *
 * Only the help paths and one prompt path are pinned here: every other
 * installer path writes into harness directories or reaches the network, which
 * the corpus keeps out. The help text must render before any operational path
 * runs (#708), through both the top-level verb and the legacy `skills`
 * namespace. The Replit case stops at a missing local bundle, after the
 * detection table and the detected-only prompt have printed and before
 * anything is written (#1019).
 */
import fs from 'node:fs';
import path from 'node:path';

export default [
  { id: 'skills-install-help', verb: 'install', args: ['--help'] },
  { id: 'skills-install-help-short', verb: 'install', args: ['-h'] },
  { id: 'skills-link-help', verb: 'link', args: ['--help'] },
  { id: 'skills-update-help', verb: 'update', args: ['--help'] },
  { id: 'skills-check-help', verb: 'check', args: ['--help'] },
  { id: 'skills-namespace-install-help', verb: 'skills', args: ['install', '--help'] },
  { id: 'skills-namespace-check-help-short', verb: 'skills', args: ['check', '-h'] },
  // A Replit project: `.replit` at the root plus the empty `.agents/` dir every
  // Repl ships with. The detection table and the detected-only prompt must name
  // Replit Agent, not Codex CLI, and the install target stays `.agents`.
  {
    id: 'skills-install-replit-project', verb: 'install', workspace: 'skills-replit',
    setup: (ws) => fs.mkdirSync(path.join(ws, '.agents')),
    stdin: '1\n\n',
    env: { IMPECCABLE_BUNDLE_PATH: '<WS>/no-such-bundle' },
    files: ['.agents/**', '.codex/**', '.impeccable/**'],
  },
];
