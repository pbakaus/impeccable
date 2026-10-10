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

/**
 * A project whose DESIGN.md declares `primary` and whose pages wear purple:
 * a static HTML page with a purple heading and a violet gradient, and a
 * component with Tailwind purple classes.
 */
function stageBrandProject(ws, primary) {
  fs.writeFileSync(path.join(ws, 'package.json'), '{"name":"brand"}\n');
  fs.writeFileSync(
    path.join(ws, 'DESIGN.md'),
    `---\ncolors:\n  primary: "${primary}"\n  surface: "#ffffff"\n---\n# Brand\n\nThe primary colour is the brand.\n`,
  );
  fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(ws, 'src', 'page.html'),
    '<!doctype html>\n<html lang="en">\n<head>\n<style>\n'
      + 'h1 { color: #5c2d91; font-size: 32px; }\n'
      + '.promo { color: #7c3aed; }\n'
      + '</style>\n</head>\n<body>\n<h1>Featured services</h1>\n'
      + '<p class="promo">The brand purple on a promotion.</p>\n</body>\n</html>\n',
  );
  fs.writeFileSync(
    path.join(ws, 'src', 'Hero.jsx'),
    'export const Hero = () => (\n'
      + '  <section className="bg-gradient-to-r from-violet-600 to-indigo-600">\n'
      + '    <h1 className="text-purple-700 text-5xl">Featured services</h1>\n'
      + '  </section>\n);\n',
  );
}

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
    ...[false, true].map(noAdvisory => ({
      id: `detect-hard-offset-shadow-${noAdvisory ? 'no-advisory' : 'advisory'}`,
      verb: 'detect',
      args: ['--no-config', '--json', ...(noAdvisory ? ['--no-advisory'] : []), 'shadow.html'],
      setup: ws => fs.writeFileSync(path.join(ws, 'shadow.html'), '<div style="width:220px;height:96px;color:#222;background:#fff;box-shadow:4px 4px 0 #333"></div>'),
    })),
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
    {
      id: 'detect-jsx-commented-img', verb: 'detect',
      setup: (ws) => fs.writeFileSync(path.join(ws, 'repro.tsx'), `function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function Thumb({ url }: { url?: string }) {
  return (
    <div>
      {url ? (
        // Plain <img>: presigned thumbnail URL
        <img src={url} alt="" />
      ) : null}
    </div>
  );
}
`),
      args: ['--no-config', '--json', 'repro.tsx'],
    },
    {
      id: 'detect-unresolved-custom-property-padding', verb: 'detect',
      setup: (ws) => fs.writeFileSync(path.join(ws, 'image-card.html'), `<!doctype html>
<link rel="stylesheet" href="brand/tokens.css">
<style>
  .reverse {
    background: #f5f5f5;
    padding: var(--brand-pad-y) var(--brand-pad-x);
  }
</style>
<div class="reverse"><p>Readable card copy</p></div>
`),
      args: ['--no-config', '--json', 'image-card.html'],
    },

    // Flag surface and errors
    { id: 'detect-help', verb: 'detect', args: ['--help'] },
    { id: 'detect-no-args', verb: 'detect', args: [] },
    { id: 'detect-missing-file', verb: 'detect', args: ['--no-config', 'does-not-exist.html'] },
    { id: 'detect-missing-file-json', verb: 'detect', args: ['--no-config', '--json', 'does-not-exist.html'] },
    // #711: a target that cannot be scanned forces exit 1, and that takes
    // precedence over findings from the targets that did scan.
    {
      id: 'detect-missing-file-with-findings', verb: 'detect',
      args: ['--no-config', '--json', `<REPO>/tests/fixtures/antipatterns/layout.html`, 'does-not-exist.html'],
      isolateHome: false,
    },
    {
      id: 'detect-unreadable-file-json', verb: 'detect',
      setup: (ws) => {
        const p = path.join(ws, 'locked.html');
        fs.writeFileSync(p, '<div style="border-left: 4px solid #ff0000">x</div>\n');
        fs.chmodSync(p, 0o000);
      },
      args: ['--no-config', '--json', 'locked.html'],
    },
    {
      // The readable file carries a rounded card so it produces a finding:
      // the point of the case is that a scanned target still reports next to
      // the unreadable one's error.
      id: 'detect-unreadable-file-in-dir', verb: 'detect',
      setup: (ws) => {
        const card = '<div style="border-left: 4px solid #ff0000; border-radius: 10px">x</div>\n';
        fs.writeFileSync(path.join(ws, 'a.html'), card);
        const p = path.join(ws, 'b.html');
        fs.writeFileSync(p, card);
        fs.chmodSync(p, 0o000);
      },
      args: ['--no-config', '--json', '.'],
    },
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
    // detector.extensions in directory walks (#822)
    { id: 'detect-config-extensions-dir-json', verb: 'detect', workspace: 'detect-extensions', args: ['--json', '--no-design-system', 'app/views'] },
    { id: 'detect-config-extensions-dir-no-config', verb: 'detect', workspace: 'detect-extensions', args: ['--no-config', '--json', 'app/views'] },
    // A file in one project must not pick up another project's DESIGN.md
    { id: 'detect-config-cross-project', verb: 'detect', workspace: 'detect-config', args: ['--json', `<REPO>/tests/fixtures/antipatterns/blinking-cursor.html`], isolateHome: false },

    // A DESIGN.md that declares a purple switches ai-color-palette's
    // purple/violet forms off for its project, in the static and the regex
    // engines alike, and text mode says so; a DESIGN.md without one changes
    // nothing (corpus decision r3-23-ai-color-palette-brand-hue).
    ...['purple', 'blue'].flatMap((hue) => ['json', 'text'].map((mode) => ({
      id: `detect-design-${hue}-${mode}`, verb: 'detect',
      setup: (ws) => stageBrandProject(ws, hue === 'purple' ? '#5c2d91' : '#1a4d8f'),
      args: mode === 'json' ? ['--json', 'src'] : ['src'],
    }))),
  );

  return out;
}
