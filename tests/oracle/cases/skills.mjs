/**
 * The installer verbs' static help (`install`, `link`, `update`, `check`).
 *
 * Only the help paths, one prompt path and one no-target `update` path are
 * pinned here: every other installer path writes into harness directories or
 * reaches the network, which the corpus keeps out. The help text must render
 * before any operational path runs (#708), through both the top-level verb
 * and the legacy `skills` namespace. The Replit case stops at a missing local
 * bundle, after the detection table and the detected-only prompt have printed
 * and before anything is written (#1019). The `.codex` case stops at the
 * no-target exit, after naming the copy `update` does not manage (#1391).
 */
import fs from 'node:fs';
import path from 'node:path';

export default [
  { id: 'skills-install-help', verb: 'install', args: ['--help'] },
  { id: 'skills-install-help-short', verb: 'install', args: ['-h'] },
  { id: 'skills-link-help', verb: 'link', args: ['--help'] },
  { id: 'skills-update-help', verb: 'update', args: ['--help'] },
  { id: 'skills-check-help', verb: 'check', args: ['--help'] },
  // loop parses its arguments before its macOS check, so usage and a bad verb read the same on every OS.
  { id: 'loop-help', verb: 'loop', args: ['--help'] },
  { id: 'loop-unknown-verb', verb: 'loop', args: ['bogus'] },
  { id: 'skills-namespace-install-help', verb: 'skills', args: ['install', '--help'] },
  { id: 'skills-namespace-check-help-short', verb: 'skills', args: ['check', '-h'] },
  // An Impeccable skill under `.codex/skills` is not an install target, so
  // `update` finds nothing to refresh and names the copy before the install
  // pointer (#1391). Offline: the no-target path exits before any download.
  {
    id: 'skills-update-codex-skills-dir', verb: 'update', workspace: 'ctx-empty',
    setup: (ws) => {
      fs.mkdirSync(path.join(ws, '.codex/skills/impeccable'), { recursive: true });
      fs.writeFileSync(path.join(ws, '.codex/skills/impeccable/SKILL.md'), '---\nname: impeccable\nversion: 3.9.1\n---\n');
    },
    args: ['-y'],
    files: ['.codex/**'],
  },
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
