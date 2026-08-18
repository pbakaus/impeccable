/**
 * `impeccable live` (boot) and `live-inject` corpus: root resolution
 * (roots.json + repo pointer), config checks, framework injection.
 * Boot cases stop at config_missing so no helper server is spawned; the one
 * full boot (`live-boot-full-cycle`) stops its server in a final step.
 */
import { LIVE_FILES, fakeGit, rm, write } from '../live-helpers.mjs';

const CFG = '.impeccable/live/config.json';
const F = LIVE_FILES;
const PORT_NORM = [
  ['localhost:\\d{4,5}', 'g', 'localhost:<PORT>'],
  ['"(port|serverPort)":(\\s*)\\d{4,5}', 'g', '"$1":$2<PORT>'],
  ['Stopped live server on port \\d+\\.', 'g', 'Stopped live server on port <PORT>.'],
];

export default [
  // --- live.mjs (boot) ---
  { id: 'live-help', verb: 'live', workspace: 'live-html', args: ['--help'] },
  { id: 'live-target-missing-value', verb: 'live', workspace: 'live-html', args: ['--target'] },
  { id: 'live-boot-html-config-missing', verb: 'live', workspace: 'live-html', setup: (ws) => rm(ws, CFG), files: F },
  { id: 'live-boot-vite-config-missing', verb: 'live', workspace: 'live-vite', setup: (ws) => rm(ws, CFG), files: F },
  { id: 'live-boot-vite-from-subdir', verb: 'live', workspace: 'live-vite', cwd: 'src', setup: (ws) => rm(ws, CFG), files: F },
  { id: 'live-boot-context-missing-product', verb: 'live', workspace: 'live-vite', setup: (ws) => { rm(ws, 'PRODUCT.md'); }, files: F },
  { id: 'live-boot-context-missing-design-empty', verb: 'live', workspace: 'live-vite', setup: (ws) => { write(ws, 'DESIGN.md', ''); }, files: F },
  { id: 'live-boot-context-missing-both', verb: 'live', workspace: 'live-vite', setup: (ws) => { rm(ws, 'PRODUCT.md'); rm(ws, 'DESIGN.md'); }, files: F },
  { id: 'live-boot-config-invalid-json', verb: 'live', workspace: 'live-html', setup: (ws) => write(ws, CFG, '{ nope'), files: F },
  { id: 'live-boot-config-invalid-schema', verb: 'live', workspace: 'live-html', setup: (ws) => write(ws, CFG, JSON.stringify({ files: ['index.html'], insertBefore: '</body>', commentSyntax: 'vue' })), files: F },
  { id: 'live-boot-sveltekit-config-missing', verb: 'live', workspace: 'live-sveltekit', setup: (ws) => rm(ws, CFG), files: F },
  { id: 'live-boot-astro-config-missing', verb: 'live', workspace: 'live-astro', setup: (ws) => rm(ws, CFG), files: F },
  { id: 'live-boot-monorepo-from-root', verb: 'live', workspace: 'live-monorepo', setup: (ws) => { fakeGit(ws); rm(ws, 'website/' + CFG); }, files: [...F, 'website/.impeccable/**'] },
  { id: 'live-boot-monorepo-from-child', verb: 'live', workspace: 'live-monorepo', cwd: 'website', setup: (ws) => { fakeGit(ws); rm(ws, 'website/' + CFG); }, files: [...F, 'website/.impeccable/**'] },
  { id: 'live-boot-monorepo-target-file', verb: 'live', workspace: 'live-monorepo', args: ['--target', 'website/src/App.jsx'], setup: (ws) => { fakeGit(ws); rm(ws, 'website/' + CFG); }, files: [...F, 'website/.impeccable/**'] },
  { id: 'live-boot-monorepo-target-eq', verb: 'live', workspace: 'live-monorepo', args: ['--target=website'], setup: (ws) => { fakeGit(ws); rm(ws, 'website/' + CFG); }, files: [...F, 'website/.impeccable/**'] },
  { id: 'live-boot-monorepo-no-git-from-root', verb: 'live', workspace: 'live-monorepo', setup: (ws) => rm(ws, 'website/' + CFG), files: [...F, 'website/.impeccable/**'] },
  {
    id: 'live-boot-multi-app-selection', verb: 'live', workspace: 'live-monorepo', files: [...F, 'website/.impeccable/**', 'admin/.impeccable/**'],
    setup: (ws) => { fakeGit(ws); rm(ws, 'website/' + CFG); write(ws, 'admin/astro.config.mjs', 'export default {};\n'); write(ws, 'admin/package.json', '{"name":"admin"}\n'); },
  },
  {
    id: 'live-boot-multi-app-target', verb: 'live', workspace: 'live-monorepo', args: ['--target', 'admin'], files: [...F, 'website/.impeccable/**', 'admin/.impeccable/**'],
    setup: (ws) => { fakeGit(ws); write(ws, 'admin/astro.config.mjs', 'export default {};\n'); write(ws, 'admin/package.json', '{"name":"admin"}\n'); },
  },
  { id: 'live-boot-workspaces-selection', verb: 'live', workspace: 'live-workspaces', setup: (ws) => fakeGit(ws), files: F },
  { id: 'live-boot-workspaces-target', verb: 'live', workspace: 'live-workspaces', args: ['--target', 'apps/web'], setup: (ws) => fakeGit(ws), files: [...F, 'apps/web/.impeccable/**'] },
  { id: 'live-boot-workspaces-from-child', verb: 'live', workspace: 'live-workspaces', cwd: 'apps/admin', setup: (ws) => fakeGit(ws), files: [...F, 'apps/admin/.impeccable/**'] },
  {
    id: 'live-boot-pointer-accumulates', verb: 'live', workspace: 'live-monorepo', files: [...F, 'website/.impeccable/**', 'admin/.impeccable/**'],
    setup: (ws) => { fakeGit(ws); rm(ws, 'website/' + CFG); write(ws, 'admin/astro.config.mjs', 'export default {};\n'); },
    steps: [{ args: ['--target', 'website'] }, { args: ['--target', 'admin'] }, { args: ['--target', 'website'] }],
  },
  {
    // Real boot: background server + inject + drift scan, then stop. Port is
    // dynamic (first free from 8400), masked per-case.
    id: 'live-boot-full-cycle', verb: 'live', workspace: 'live-html', files: [...F, 'index.html', 'public/**'], normalize: PORT_NORM,
    steps: [{ verb: 'live' }, { verb: 'live-inject', args: ['--check'] }, { verb: 'live-server', args: ['stop'] }],
  },

  // --- live-inject.mjs ---
  { id: 'live-inject-help', verb: 'live-inject', workspace: 'live-html', args: ['--help'] },
  { id: 'live-inject-check-ok', verb: 'live-inject', workspace: 'live-html', args: ['--check'] },
  { id: 'live-inject-check-missing', verb: 'live-inject', workspace: 'live-vite', args: ['--check'], setup: (ws) => rm(ws, CFG) },
  { id: 'live-inject-check-invalid-json', verb: 'live-inject', workspace: 'live-html', args: ['--check'], setup: (ws) => write(ws, CFG, '[1') },
  { id: 'live-inject-check-invalid-files', verb: 'live-inject', workspace: 'live-html', args: ['--check'], setup: (ws) => write(ws, CFG, JSON.stringify({ files: [], insertBefore: '</body>', commentSyntax: 'html' })) },
  { id: 'live-inject-check-invalid-anchor', verb: 'live-inject', workspace: 'live-html', args: ['--check'], setup: (ws) => write(ws, CFG, JSON.stringify({ files: ['index.html'], commentSyntax: 'html' })) },
  { id: 'live-inject-check-env-config', verb: 'live-inject', workspace: 'live-html', args: ['--check'], env: { IMPECCABLE_LIVE_CONFIG: 'alt.json' }, setup: (ws) => write(ws, 'alt.json', JSON.stringify({ files: ['public/docs/guide.html'], insertAfter: '<body>', commentSyntax: 'html' })) },
  { id: 'live-inject-missing-port', verb: 'live-inject', workspace: 'live-html', args: [], files: F },
  { id: 'live-inject-port-nan', verb: 'live-inject', workspace: 'live-html', args: ['--port', 'abc'], files: F },
  { id: 'live-inject-no-config', verb: 'live-inject', workspace: 'live-vite', args: ['--port', '8412'], setup: (ws) => rm(ws, CFG), files: F },
  { id: 'live-inject-target-missing-value', verb: 'live-inject', workspace: 'live-html', args: ['--check', '--target'] },
  { id: 'live-inject-html-tag', verb: 'live-inject', workspace: 'live-html', args: ['--port', '8412', '--token', 'tok-oracle'], files: [...F, 'index.html', 'public/**'] },
  { id: 'live-inject-html-tag-no-token', verb: 'live-inject', workspace: 'live-html', args: ['--port', '8412'], files: [...F, 'index.html'] },
  { id: 'live-inject-token-from-server-json', verb: 'live-inject', workspace: 'live-html', args: ['--port', '8412'], setup: (ws) => write(ws, '.impeccable/live/server.json', '{"pid":1,"port":8412,"token":"from-server-json"}'), files: [...F, 'index.html'] },
  { id: 'live-inject-token-server-json-port-mismatch', verb: 'live-inject', workspace: 'live-html', args: ['--port', '8412'], setup: (ws) => write(ws, '.impeccable/live/server.json', '{"pid":1,"port":8499,"token":"other"}'), files: [...F, 'index.html'] },
  { id: 'live-inject-html-repeat-and-remove', verb: 'live-inject', workspace: 'live-html', files: [...F, 'index.html', 'public/**'], steps: [{ args: ['--port', '8412', '--token', 'a'] }, { args: ['--port', '8413', '--token', 'b'] }, { args: ['--remove'] }, { args: ['--remove'] }] },
  { id: 'live-inject-remove-clean', verb: 'live-inject', workspace: 'live-html', args: ['--remove'], files: [...F, 'index.html'] },
  { id: 'live-inject-file-not-found', verb: 'live-inject', workspace: 'live-html', args: ['--port', '8412', '--token', 't'], setup: (ws) => write(ws, CFG, JSON.stringify({ files: ['missing.html', 'index.html'], insertBefore: '</body>', commentSyntax: 'html' })), files: [...F, 'index.html'] },
  { id: 'live-inject-anchor-missing-all', verb: 'live-inject', workspace: 'live-html', args: ['--port', '8412', '--token', 't'], setup: (ws) => write(ws, CFG, JSON.stringify({ files: ['index.html'], insertBefore: '</nope>', commentSyntax: 'html' })), files: [...F, 'index.html'] },
  { id: 'live-inject-insert-after', verb: 'live-inject', workspace: 'live-html', args: ['--port', '8412', '--token', 't'], setup: (ws) => write(ws, CFG, JSON.stringify({ files: ['index.html'], exclude: ['public/**'], insertAfter: '<body>', commentSyntax: 'html' })), files: [...F, 'index.html'] },
  { id: 'live-inject-exclude-glob', verb: 'live-inject', workspace: 'live-html', args: ['--port', '8412', '--token', 't'], setup: (ws) => write(ws, CFG, JSON.stringify({ files: ['**/*.html'], exclude: ['dist/**', 'public/no-body.html'], insertBefore: '</body>', commentSyntax: 'html' })), files: [...F, 'index.html', 'public/**', 'dist/**', 'src/**'] },
  {
    id: 'live-inject-vite-csp-meta', verb: 'live-inject', workspace: 'live-vite', files: [...F, 'index.html'],
    setup: (ws) => write(ws, 'index.html', '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta\n      http-equiv="Content-Security-Policy"\n      content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; connect-src \'self\' ws: wss:; img-src \'self\' data:;"\n    />\n    <title>CSP</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>\n'),
    steps: [{ args: ['--port', '8412', '--token', 't'] }, { args: ['--remove'] }],
  },
  {
    id: 'live-inject-csp-meta-no-connect-src', verb: 'live-inject', workspace: 'live-html', files: [...F, 'index.html'],
    setup: (ws) => write(ws, 'index.html', '<!DOCTYPE html>\n<html>\n<head>\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'">\n</head>\n<body>\n<h1 class="hero-title">Hi</h1>\n</body>\n</html>\n'),
    args: ['--port', '8412', '--token', 't'],
  },
  { id: 'live-inject-next-jsx', verb: 'live-inject', workspace: 'live-next', files: [...F, 'app/**'], steps: [{ args: ['--port', '8412', '--token', 't'] }, { args: ['--remove'] }] },
  { id: 'live-inject-astro-inline', verb: 'live-inject', workspace: 'live-astro', files: [...F, 'src/**'], steps: [{ args: ['--port', '8412', '--token', 't'] }, { args: ['--remove'] }] },
  { id: 'live-inject-sveltekit-adapter', verb: 'live-inject', workspace: 'live-sveltekit', files: [...F, 'src/**'], steps: [{ args: ['--port', '8412', '--token', 't'] }, { args: ['--port', '8412', '--token', 't'] }, { args: ['--remove'] }, { args: ['--remove'] }] },
  { id: 'live-inject-sveltekit-existing-layout', verb: 'live-inject', workspace: 'live-sveltekit', files: [...F, 'src/**'], setup: (ws) => write(ws, 'src/routes/+layout.svelte', '<script>\n  import \'../app.css\';\n  let { children } = $props();\n</script>\n\n<nav>Top</nav>\n{@render children()}\n'), steps: [{ args: ['--port', '8412', '--token', 't'] }, { args: ['--remove'] }] },
  { id: 'live-inject-nuxt-adapter', verb: 'live-inject', workspace: 'live-nuxt', files: [...F, 'plugins/**', 'app/**'], steps: [{ args: ['--port', '8412', '--token', 't'] }, { args: ['--remove'] }, { args: ['--remove'] }] },
  { id: 'live-inject-nuxt-plugin-conflict', verb: 'live-inject', workspace: 'live-nuxt', files: [...F, 'plugins/**'], setup: (ws) => write(ws, 'plugins/impeccable-live.client.ts', 'export default {};\n'), steps: [{ args: ['--port', '8412', '--token', 't'] }, { args: ['--remove'] }] },
  { id: 'live-inject-nuxt-srcdir', verb: 'live-inject', workspace: 'live-nuxt', files: [...F, 'app/**', 'plugins/**'], setup: (ws) => { write(ws, 'nuxt.config.ts', "export default defineNuxtConfig({ srcDir: 'app/' });\n"); write(ws, 'app/app.vue', '<template><body><NuxtPage /></body></template>\n'); write(ws, CFG, JSON.stringify({ files: ['app/app.vue'], insertBefore: '</body>', commentSyntax: 'html' })); }, args: ['--port', '8412', '--token', 't'] },
  { id: 'live-inject-tanstack-adapter', verb: 'live-inject', workspace: 'live-tanstack', files: [...F, 'src/**'], steps: [{ args: ['--port', '8412', '--token', 't'] }, { args: ['--port', '8412', '--token', 't'] }, { args: ['--remove'] }] },
  { id: 'live-inject-tanstack-component-conflict', verb: 'live-inject', workspace: 'live-tanstack', files: [...F, 'src/**'], setup: (ws) => write(ws, 'src/impeccable/ImpeccableLiveRoot.tsx', 'export default function X() { return null; }\n'), args: ['--port', '8412', '--token', 't'] },
  {
    id: 'live-inject-monorepo-repo-root-ignore', verb: 'live-inject', workspace: 'live-monorepo', cwd: 'website', files: [...F, 'website/.impeccable/**', 'website/.gitignore', 'website/index.html'],
    setup: (ws) => { fakeGit(ws); write(ws, 'website/.impeccable/live/roots.json', JSON.stringify({ version: 1, appRoot: `${ws}/website`, repoRoot: ws, contextRoot: ws, sessionRoot: `${ws}/website/.impeccable/live`, productPath: `${ws}/PRODUCT.md`, designPath: `${ws}/DESIGN.md`, resolvedFrom: 'cwd' }, null, 2)); },
    args: ['--port', '8412', '--token', 't'],
  },
  {
    id: 'live-inject-from-repo-root-via-roots', verb: 'live-inject', workspace: 'live-monorepo', files: [...F, 'website/.impeccable/**', 'website/.gitignore', 'website/index.html'],
    setup: (ws) => { fakeGit(ws); write(ws, 'website/.impeccable/live/roots.json', JSON.stringify({ version: 1, appRoot: `${ws}/website`, repoRoot: ws, contextRoot: ws, sessionRoot: `${ws}/website/.impeccable/live`, productPath: `${ws}/PRODUCT.md`, designPath: `${ws}/DESIGN.md`, resolvedFrom: 'cwd' }, null, 2)); write(ws, '.impeccable/live/app-root.json', JSON.stringify({ version: 2, appRoots: [{ appRoot: `${ws}/website`, bootedAt: '2026-08-01T00:00:00.000Z' }] })); },
    steps: [{ args: ['--check'] }, { args: ['--port', '8412', '--token', 't'] }, { args: ['--remove'] }],
  },
  {
    id: 'live-inject-heals-orphan-journal', verb: 'live-inject', workspace: 'live-html', files: [...F, 'index.html', 'src/**'],
    setup: (ws) => {
      write(ws, 'src/lib/impeccable/ImpeccableLiveRoot.svelte', '<!-- impeccable-live-root -->\n<div></div>\n');
      write(ws, 'src/keep.svelte', '<div>no marker</div>\n');
      write(ws, '.impeccable/live/inject-journal.json', JSON.stringify({ version: 1, appRoot: ws, framework: 'sveltekit', port: 8400, pid: 1, recordedAt: '2026-08-01T00:00:00.000Z', artifacts: [
        { kind: 'created', path: 'src/lib/impeccable/ImpeccableLiveRoot.svelte', marker: 'impeccable-live-root', pruneTo: 'src' },
        { kind: 'created', path: 'src/keep.svelte', marker: 'impeccable-live-root', pruneTo: 'src' },
        { kind: 'created', path: '../outside.svelte', marker: 'impeccable-live-root' },
        { kind: 'patched', path: 'public/no-body.html', patch: 'live-tag', markers: ['impeccable-live-start'] },
      ] }, null, 2) + '\n');
    },
    args: ['--port', '8412', '--token', 't'],
  },
];
