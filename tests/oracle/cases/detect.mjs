/**
 * `impeccable detect` corpus.
 *
 * Every antipattern fixture is scanned individually in JSON and text mode with
 * --no-config (the repo's own .impeccable config ignores tests/fixtures), plus
 * directory scans, project-config / DESIGN.md / inline-ignore behaviour from
 * the detect-config workspace, and the flag surface (help, scope, quiet,
 * no-advisory, errors).
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../lib.mjs';

const FIXTURES = path.join(REPO_ROOT, 'tests', 'fixtures', 'antipatterns');

export default function cases() {
  const out = [];
  const entries = fs.readdirSync(FIXTURES, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

  for (const ent of entries) {
    const rel = `tests/fixtures/antipatterns/${ent.name}`;
    const id = ent.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    out.push({
      id: `detect-fixture-json-${id}`,
      verb: 'detect',
      args: ['--no-config', '--json', `<REPO>/${rel}`],
      isolateHome: false,
    });
    out.push({
      id: `detect-fixture-text-${id}`,
      verb: 'detect',
      args: ['--no-config', `<REPO>/${rel}`],
      isolateHome: false,
    });
  }

  out.push(
    { id: 'detect-dir-json-all-fixtures', verb: 'detect', args: ['--no-config', '--json', `<REPO>/tests/fixtures/antipatterns`], isolateHome: false, timeoutMs: 180_000 },
    { id: 'detect-dir-text-all-fixtures', verb: 'detect', args: ['--no-config', `<REPO>/tests/fixtures/antipatterns`], isolateHome: false, timeoutMs: 180_000 },
    { id: 'detect-dir-quiet-all-fixtures', verb: 'detect', args: ['--no-config', '--quiet', `<REPO>/tests/fixtures/antipatterns`], isolateHome: false, timeoutMs: 180_000 },
    { id: 'detect-scope-type', verb: 'detect', args: ['--no-config', '--json', '--scope', 'type', `<REPO>/tests/fixtures/antipatterns`], isolateHome: false, timeoutMs: 180_000 },
    { id: 'detect-scope-layout-text', verb: 'detect', args: ['--no-config', '--scope', 'layout', `<REPO>/tests/fixtures/antipatterns`], isolateHome: false, timeoutMs: 180_000 },
    { id: 'detect-scope-both', verb: 'detect', args: ['--no-config', '--json', '--scope', 'type,layout', `<REPO>/tests/fixtures/antipatterns`], isolateHome: false, timeoutMs: 180_000 },
    { id: 'detect-scope-unknown', verb: 'detect', args: ['--no-config', '--json', '--scope', 'nope', `<REPO>/tests/fixtures/antipatterns/blinking-cursor.html`], isolateHome: false },
    { id: 'detect-no-advisory-json', verb: 'detect', args: ['--no-config', '--no-advisory', '--json', `<REPO>/tests/fixtures/antipatterns`], isolateHome: false, timeoutMs: 180_000 },
    { id: 'detect-no-advisory-text', verb: 'detect', args: ['--no-config', '--no-advisory', `<REPO>/tests/fixtures/antipatterns`], isolateHome: false, timeoutMs: 180_000 },
    { id: 'detect-multifile-json', verb: 'detect', args: ['--no-config', '--json', `<REPO>/tests/fixtures/antipatterns/multifile`], isolateHome: false },
    { id: 'detect-multifile-text', verb: 'detect', args: ['--no-config', `<REPO>/tests/fixtures/antipatterns/multifile`], isolateHome: false },
    { id: 'detect-framework-vite-json', verb: 'detect', args: ['--no-config', '--json', `<REPO>/tests/fixtures/antipatterns/framework-vite`], isolateHome: false },
    { id: 'detect-framework-next-tailwind-json', verb: 'detect', args: ['--no-config', '--json', `<REPO>/tests/fixtures/antipatterns/framework-next-tailwind`], isolateHome: false },
    { id: 'detect-framework-next-modules-text', verb: 'detect', args: ['--no-config', `<REPO>/tests/fixtures/antipatterns/framework-next-modules`], isolateHome: false },
    { id: 'detect-framework-next-cssinjs-json', verb: 'detect', args: ['--no-config', '--json', `<REPO>/tests/fixtures/antipatterns/framework-next-cssinjs`], isolateHome: false },

    // Flag surface and errors
    { id: 'detect-help', verb: 'detect', args: ['--help'] },
    { id: 'detect-no-args', verb: 'detect', args: [] },
    { id: 'detect-missing-file', verb: 'detect', args: ['--no-config', 'does-not-exist.html'] },
    { id: 'detect-missing-file-json', verb: 'detect', args: ['--no-config', '--json', 'does-not-exist.html'] },
    { id: 'detect-unknown-flag', verb: 'detect', args: ['--bogus', `<REPO>/tests/fixtures/antipatterns/blinking-cursor.html`], isolateHome: false },
    { id: 'detect-bad-viewport', verb: 'detect', args: ['--viewport', 'wide', `<REPO>/tests/fixtures/antipatterns/blinking-cursor.html`], isolateHome: false },
    { id: 'cli-help', verb: 'cli-help', args: [] },
    { id: 'cli-version', verb: 'cli-version', args: [] },

    // Project config, DESIGN.md, inline ignores (detect-config workspace)
    { id: 'detect-config-page-json', verb: 'detect', workspace: 'detect-config', args: ['--json', 'src/page.html'] },
    { id: 'detect-config-page-text', verb: 'detect', workspace: 'detect-config', args: ['src/page.html'] },
    { id: 'detect-config-page-no-config', verb: 'detect', workspace: 'detect-config', args: ['--no-config', '--json', 'src/page.html'] },
    { id: 'detect-config-page-no-design-system', verb: 'detect', workspace: 'detect-config', args: ['--no-design-system', '--json', 'src/page.html'] },
    { id: 'detect-config-dir-json', verb: 'detect', workspace: 'detect-config', args: ['--json', 'src'] },
    { id: 'detect-config-dir-text', verb: 'detect', workspace: 'detect-config', args: ['src'] },
    { id: 'detect-config-dir-dot', verb: 'detect', workspace: 'detect-config', args: ['--json', '.'] },
    { id: 'detect-config-inline-json', verb: 'detect', workspace: 'detect-config', args: ['--json', 'src/inline.html'] },
    { id: 'detect-config-inline-disabled', verb: 'detect', workspace: 'detect-config', args: ['--no-inline-ignores', '--json', 'src/inline.html'] },
    { id: 'detect-config-css-json', verb: 'detect', workspace: 'detect-config', args: ['--json', 'src/styles.css'] },
    { id: 'detect-config-css-text', verb: 'detect', workspace: 'detect-config', args: ['src/styles.css'] },
    { id: 'detect-config-vendor-ignored', verb: 'detect', workspace: 'detect-config', args: ['--json', 'src/vendor/ignored.html'] },
    { id: 'detect-config-from-subdir', verb: 'detect', workspace: 'detect-config', cwd: 'src', args: ['--json', 'page.html'] },
    // A file in one project must not pick up another project's DESIGN.md
    { id: 'detect-config-cross-project', verb: 'detect', workspace: 'detect-config', args: ['--json', `<REPO>/tests/fixtures/antipatterns/blinking-cursor.html`], isolateHome: false },
  );

  return out;
}
