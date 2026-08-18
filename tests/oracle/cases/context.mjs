/**
 * Corpus for the context-and-helper verbs: `context`, `doctor`, `pin`,
 * `surface-brief`, `critique-storage`, `palette`, `embed-prompt`,
 * `context-signals`, `detect-csp`, `concept-seed`, `generate-image`,
 * `serve-question`.
 *
 * Workspaces (tests/oracle/workspaces/ctx-*):
 *   ctx-empty          package.json only
 *   ctx-visual-only    index.html + src/*.css, no PRODUCT.md
 *   ctx-product-only   stamped PRODUCT.md (web), visual code, no DESIGN.md
 *   ctx-full           PRODUCT.md + DESIGN.md + sidecar v2 + two briefs + critique + buildPath comp
 *   ctx-native-ios     PRODUCT.md `## Platform` ios, no visual code
 *   ctx-adaptive       PRODUCT.md `## Platform` "ios, android"
 *   ctx-bad-platform   PRODUCT.md `## Platform` flutter + pubspec.yaml
 *   ctx-monorepo       pnpm-workspace + apps/a (own PRODUCT/DESIGN) + apps/b (inherits) + projectRoots
 *   ctx-legacy         unstamped PRODUCT.md with ## Register, DESIGN.json sidecar v1, bad config, orphan brief
 *   ctx-csp-*          one per detect-csp shape (append-arrays, append-string, middleware, meta, none)
 *   ctx-signals        git-initialised in setup() with fixed author/committer dates
 *   ctx-pin            .claude/.agents/.cursor skills dirs with impeccable installed
 *
 * Only offline, deterministic paths are exercised: no roll API, no OpenAI, no
 * browser, no listening server. Env vars that would change behaviour on the
 * recording machine (OPENAI_API_KEY, catalog/context overrides, CI) are pinned
 * per case through BASE_ENV.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const WS = '<WS>';
const REPO = '<REPO>';

// Env the recording machine may carry that would leak into output.
const BASE_ENV = {
  OPENAI_API_KEY: null,
  IMPECCABLE_CONTEXT_DIR: null,
  IMPECCABLE_CATALOG_DIR: null,
  IMPECCABLE_API_URL: null,
  IMPECCABLE_STALENESS_CACHE: null,
  IMPECCABLE_UPDATE_CACHE: null,
  IMPECCABLE_NO_STALENESS_CHECK: null,
  IMPECCABLE_HOOK_DISABLED: null,
  IMPECCABLE_PALETTE_SEED: null,
  IMPECCABLE_CONCEPT_SEED: null,
  IMPECCABLE_COMPOSITIONS: null,
  IMPECCABLE_IMAGE_GEN_FAKE: null,
  IMPECCABLE_QUESTION_DISABLED: null,
  IMPECCABLE_QUESTION_FORCE: null,
  IMPECCABLE_CRITIQUE_META: null,
  CI: null,
  SSH_CONNECTION: null,
};
const env = (extra = {}) => ({ ...BASE_ENV, ...extra });

const IMPECCABLE_FILES = ['.impeccable/**', 'PRODUCT.md', 'DESIGN.md', 'DESIGN.json', '.impeccable-live.json'];

// ---- setup helpers ---------------------------------------------------------

const write = (ws, rel, body) => {
  const abs = path.join(ws, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return abs;
};

// Fixed mtimes so DESIGN.md-vs-sidecar age comparisons never depend on copy
// order or filesystem timestamp granularity.
const T_OLD = new Date('2026-01-01T00:00:00Z');
const T_NEW = new Date('2026-06-01T00:00:00Z');
const touch = (abs, when) => { if (fs.existsSync(abs)) fs.utimesSync(abs, when, when); };
const sidecarNewer = (ws) => { touch(path.join(ws, 'DESIGN.md'), T_OLD); touch(path.join(ws, '.impeccable/design.json'), T_NEW); };
const sidecarOlder = (ws) => { touch(path.join(ws, 'DESIGN.md'), T_NEW); touch(path.join(ws, 'DESIGN.json'), T_OLD); touch(path.join(ws, '.impeccable/design.json'), T_OLD); };

// ctx-legacy carries `.impeccable-live.json` (gitignored in this repo, so it
// is written at stage time) and a DESIGN.md newer than its legacy sidecar.
const legacySetup = (ws) => {
  write(ws, '.impeccable-live.json', JSON.stringify({ port: 4310, sessions: [] }, null, 2) + '\n');
  sidecarOlder(ws);
};

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Oracle', GIT_AUTHOR_EMAIL: 'oracle@example.com', GIT_AUTHOR_DATE: '2026-01-02T03:04:05Z',
  GIT_COMMITTER_NAME: 'Oracle', GIT_COMMITTER_EMAIL: 'oracle@example.com', GIT_COMMITTER_DATE: '2026-01-02T03:04:05Z',
  GIT_CONFIG_NOSYSTEM: '1', HOME: '/nonexistent-home',
};
const git = (ws, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main', ...args], { cwd: ws, env: { ...process.env, ...GIT_ENV }, stdio: 'ignore' });
const gitInit = (ws) => {
  git(ws, 'init', '-q');
  git(ws, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(ws, 'add', '.');
  git(ws, 'commit', '-qm', 'init');
};
const gitDirty = (ws) => { gitInit(ws); fs.appendFileSync(path.join(ws, 'src/styles.css'), 'p { margin: 0; }\n'); write(ws, 'src/New.tsx', 'export const New = () => null;\n'); };
const gitFeature = (ws) => {
  gitInit(ws);
  git(ws, 'checkout', '-qb', 'feature/hero');
  fs.appendFileSync(path.join(ws, 'src/App.tsx'), '// feature\n');
  write(ws, 'src/util.ts', 'export const add = (a: number, b: number) => a + b + 0;\n');
  git(ws, 'add', '.');
  git(ws, 'commit', '-qm', 'feature');
};

// Tiny valid rasters for embed-prompt.
function pngChunk(type, data) {
  const t = Buffer.from(type, 'latin1');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); }
  return (c ^ 0xffffffff) >>> 0;
}
function tinyPng() {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(Buffer.from([0, 255, 0, 0]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}
function tinyJpeg() {
  // SOI, APP0 (JFIF), SOS, EOI. Enough structure for the COM reader/writer.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sos, Buffer.from([0x00, 0xff, 0xd9])]);
}
const imagesSetup = (ws) => {
  fs.mkdirSync(path.join(ws, 'assets/nested'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'assets/.hidden'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'assets/node_modules'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'assets/a.png'), tinyPng());
  fs.writeFileSync(path.join(ws, 'assets/b.jpg'), tinyJpeg());
  fs.writeFileSync(path.join(ws, 'assets/c.webp'), Buffer.from('RIFF....WEBPVP8 ', 'latin1'));
  fs.writeFileSync(path.join(ws, 'assets/nested/d.jpeg'), tinyJpeg());
  fs.writeFileSync(path.join(ws, 'assets/.hidden/e.png'), tinyPng());
  fs.writeFileSync(path.join(ws, 'assets/node_modules/f.png'), tinyPng());
  fs.writeFileSync(path.join(ws, 'assets/notes.txt'), 'not a raster\n');
  fs.writeFileSync(path.join(ws, 'prompt.txt'), 'A prompt read from a file.\nSecond line.\n');
};

const CATALOG = `${REPO}/tests/fixtures/concept-catalog`;
const seedEnv = (extra = {}) => env({ IMPECCABLE_CATALOG_DIR: CATALOG, IMPECCABLE_API_URL: 'http://127.0.0.1:9/api', IMPECCABLE_API_TIMEOUT: '300', ...extra });
const degradedEnv = (extra = {}) => env({ IMPECCABLE_CATALOG_DIR: `${WS}/no-such-catalog`, IMPECCABLE_API_URL: 'http://127.0.0.1:9/api', IMPECCABLE_API_TIMEOUT: '300', ...extra });

const QUESTION_PAYLOAD = { title: 'Pick', options: [{ id: 'a', label: 'A', thesis: 'One.' }, { id: 'b', label: 'B', thesis: 'Two.' }] };

const cases = [
  // ======================================================================
  // context
  // ======================================================================
  { id: 'context-empty', verb: 'context', workspace: 'ctx-empty', env: env(), files: IMPECCABLE_FILES },
  { id: 'context-visual-only', verb: 'context', workspace: 'ctx-visual-only', env: env(), files: IMPECCABLE_FILES },
  { id: 'context-product-only', verb: 'context', workspace: 'ctx-product-only', env: env(), files: IMPECCABLE_FILES },
  { id: 'context-full', verb: 'context', workspace: 'ctx-full', setup: sidecarNewer, env: env(), files: IMPECCABLE_FILES },
  { id: 'context-full-target-brief', verb: 'context', workspace: 'ctx-full', setup: sidecarNewer, args: ['--target', 'src/pages/index.astro'], env: env(), files: IMPECCABLE_FILES },
  { id: 'context-full-target-related', verb: 'context', workspace: 'ctx-full', setup: sidecarNewer, args: ['-t', 'src/components/Hero.astro'], env: env(), files: IMPECCABLE_FILES },
  { id: 'context-full-target-route', verb: 'context', workspace: 'ctx-full', setup: sidecarNewer, args: ['--target=/pricing'], env: env(), files: IMPECCABLE_FILES },
  { id: 'context-full-target-missing-file', verb: 'context', workspace: 'ctx-full', setup: sidecarNewer, args: ['--target', 'src/pages/nope.astro'], env: env(), files: IMPECCABLE_FILES },
  { id: 'context-full-target-last-wins', verb: 'context', workspace: 'ctx-full', setup: sidecarNewer, args: ['--target', 'src/pages/nope.astro', '--target', 'src/pages/index.astro'], env: env(), files: IMPECCABLE_FILES },
  { id: 'context-full-from-subdir', verb: 'context', workspace: 'ctx-full', setup: sidecarNewer, cwd: 'src/pages', env: env(), files: IMPECCABLE_FILES },
  { id: 'context-target-missing-value', verb: 'context', workspace: 'ctx-full', setup: sidecarNewer, args: ['--target'], env: env() },
  { id: 'context-target-eq-empty', verb: 'context', workspace: 'ctx-full', setup: sidecarNewer, args: ['--target='], env: env() },
  { id: 'context-target-followed-by-flag', verb: 'context', workspace: 'ctx-full', setup: sidecarNewer, args: ['--target', '--help'], env: env() },
  { id: 'context-native-ios', verb: 'context', workspace: 'ctx-native-ios', env: env(), files: IMPECCABLE_FILES },
  { id: 'context-adaptive', verb: 'context', workspace: 'ctx-adaptive', env: env(), files: IMPECCABLE_FILES },
  { id: 'context-bad-platform', verb: 'context', workspace: 'ctx-bad-platform', env: env(), files: IMPECCABLE_FILES },
  { id: 'context-monorepo-root', verb: 'context', workspace: 'ctx-monorepo', env: env(), files: IMPECCABLE_FILES },
  { id: 'context-monorepo-target-a', verb: 'context', workspace: 'ctx-monorepo', args: ['--target', 'apps/a/src/App.tsx'], env: env(), files: IMPECCABLE_FILES },
  { id: 'context-monorepo-target-b-inherits', verb: 'context', workspace: 'ctx-monorepo', args: ['--target', 'apps/b'], env: env(), files: IMPECCABLE_FILES },
  { id: 'context-monorepo-target-dot', verb: 'context', workspace: 'ctx-monorepo', args: ['--target', '.'], env: env(), files: IMPECCABLE_FILES },
  { id: 'context-monorepo-target-missing', verb: 'context', workspace: 'ctx-monorepo', args: ['--target', 'apps/zzz/src/App.tsx'], env: env(), files: IMPECCABLE_FILES },
  { id: 'context-monorepo-from-child-cwd', verb: 'context', workspace: 'ctx-monorepo', cwd: 'apps/b', env: env(), files: IMPECCABLE_FILES },
  { id: 'context-legacy', verb: 'context', workspace: 'ctx-legacy', setup: legacySetup, env: env(), files: IMPECCABLE_FILES },
  { id: 'context-hook-disabled-env', verb: 'context', workspace: 'ctx-product-only', env: env({ IMPECCABLE_HOOK_DISABLED: 'yes' }), files: IMPECCABLE_FILES },
  {
    id: 'context-hook-disabled-config', verb: 'context', workspace: 'ctx-product-only',
    setup: (ws) => write(ws, '.impeccable/config.json', JSON.stringify({ hook: { enabled: false } }, null, 2) + '\n'),
    env: env(), files: IMPECCABLE_FILES,
  },
  { id: 'context-openai-key', verb: 'context', workspace: 'ctx-product-only', env: env({ OPENAI_API_KEY: 'sk-oracle' }), files: IMPECCABLE_FILES },
  { id: 'context-no-staleness-check-env', verb: 'context', workspace: 'ctx-legacy', setup: legacySetup, env: env({ IMPECCABLE_NO_STALENESS_CHECK: '1' }), files: IMPECCABLE_FILES },
  {
    id: 'context-no-staleness-check-config', verb: 'context', workspace: 'ctx-legacy',
    setup: (ws) => { legacySetup(ws); write(ws, '.impeccable/config.local.json', JSON.stringify({ stalenessCheck: false }, null, 2) + '\n'); },
    env: env(), files: IMPECCABLE_FILES,
  },
  {
    // Tier-1 throttling: the first boot reports mention/route findings, the
    // second boot within a week reports only `auto` ones. Both steps share
    // the isolated HOME, so the notice cache carries between them.
    id: 'context-staleness-throttle', verb: 'context', workspace: 'ctx-legacy', setup: legacySetup, env: env(), files: IMPECCABLE_FILES,
    steps: [{}, {}],
  },
  {
    id: 'context-staleness-cache-env', verb: 'context', workspace: 'ctx-legacy', setup: legacySetup,
    env: env({ IMPECCABLE_STALENESS_CACHE: `${WS}/.oracle-cache/notice.json` }), files: [...IMPECCABLE_FILES, '.oracle-cache/**'],
    steps: [{}, {}],
  },
  {
    id: 'context-dir-override', verb: 'context', workspace: 'ctx-empty',
    setup: (ws) => { write(ws, 'elsewhere/PRODUCT.md', '# Elsewhere\n\n<!-- impeccable:product-schema 1 -->\n\n## Platform\n\nweb\n\n## Positioning\nFound through IMPECCABLE_CONTEXT_DIR.\n'); write(ws, 'elsewhere/DESIGN.md', '# Design: Elsewhere\n\n## Colors\n- **Ink** (#111): Text.\n'); },
    env: env({ IMPECCABLE_CONTEXT_DIR: `${WS}/elsewhere` }), files: IMPECCABLE_FILES,
  },
  { id: 'context-dir-override-relative', verb: 'context', workspace: 'ctx-empty', setup: (ws) => write(ws, 'ctx/PRODUCT.md', '# Rel\n\n<!-- impeccable:product-schema 1 -->\n\n## Positioning\nRelative override.\n'), env: env({ IMPECCABLE_CONTEXT_DIR: 'ctx' }), files: IMPECCABLE_FILES },
  { id: 'context-dir-override-ignored-when-project-has-product', verb: 'context', workspace: 'ctx-product-only', setup: (ws) => write(ws, 'elsewhere/PRODUCT.md', '# Should not load\n'), env: env({ IMPECCABLE_CONTEXT_DIR: `${WS}/elsewhere` }), files: IMPECCABLE_FILES },
  { id: 'context-dir-override-missing', verb: 'context', workspace: 'ctx-empty', env: env({ IMPECCABLE_CONTEXT_DIR: `${WS}/nowhere` }), files: IMPECCABLE_FILES },
  {
    id: 'context-build-path-local-over-shared', verb: 'context', workspace: 'ctx-full',
    setup: (ws) => { sidecarNewer(ws); write(ws, '.impeccable/config.local.json', JSON.stringify({ buildPath: 'code' }, null, 2) + '\n'); },
    env: env(), files: IMPECCABLE_FILES,
  },
  {
    id: 'context-build-path-invalid-ignored', verb: 'context', workspace: 'ctx-full',
    setup: (ws) => { sidecarNewer(ws); write(ws, '.impeccable/config.local.json', JSON.stringify({ buildPath: 'fast' }, null, 2) + '\n'); },
    env: env(), files: IMPECCABLE_FILES,
  },
  { id: 'context-fallback-dir-docs', verb: 'context', workspace: 'ctx-empty', setup: (ws) => write(ws, 'docs/PRODUCT.md', '# Docs product\n\n<!-- impeccable:product-schema 1 -->\n\n## Positioning\nLives under docs/.\n'), env: env(), files: IMPECCABLE_FILES },
  { id: 'context-lowercase-product-name', verb: 'context', workspace: 'ctx-empty', setup: (ws) => write(ws, 'product.md', '# lower\n\n<!-- impeccable:product-schema 1 -->\n\n## Positioning\nLowercase filename.\n'), env: env(), files: IMPECCABLE_FILES },
  { id: 'context-design-only', verb: 'context', workspace: 'ctx-empty', setup: (ws) => write(ws, 'DESIGN.md', '---\nname: Only\n---\n# Design: Only\n\n## Colors\n- **Ink** (#111): Text.\n'), env: env(), files: IMPECCABLE_FILES },
  { id: 'context-empty-platform-section', verb: 'context', workspace: 'ctx-empty', setup: (ws) => write(ws, 'PRODUCT.md', '# P\n\n<!-- impeccable:product-schema 1 -->\n\n## Platform\n\n## Positioning\nEmpty platform section.\n'), env: env(), files: IMPECCABLE_FILES },
  { id: 'context-android', verb: 'context', workspace: 'ctx-empty', setup: (ws) => write(ws, 'PRODUCT.md', '# P\n\n<!-- impeccable:product-schema 1 -->\n\n## Platform\n\nAndroid\n\n## Positioning\nNative android.\n'), env: env(), files: IMPECCABLE_FILES },
  { id: 'context-adaptive-word', verb: 'context', workspace: 'ctx-empty', setup: (ws) => write(ws, 'PRODUCT.md', '# P\n\n<!-- impeccable:product-schema 1 -->\n\n## Platform\n\nadaptive\n\n## Positioning\nAdaptive keyword.\n'), env: env(), files: IMPECCABLE_FILES },
  { id: 'context-native-evidence-web', verb: 'context', workspace: 'ctx-product-only', setup: (ws) => write(ws, 'ios/Podfile', "platform :ios, '15.0'\n"), env: env(), files: IMPECCABLE_FILES },
  { id: 'context-build-path-unset-with-surfaces', verb: 'context', workspace: 'ctx-product-only', setup: (ws) => write(ws, '.impeccable/surfaces/src-app-tsx.md', '---\nversion: 1\nslug: "src-app-tsx"\nprimary_target: "src/App.tsx"\nrelated_targets: []\n---\n\n# Surface brief: App\n'), env: env(), files: IMPECCABLE_FILES },
  { id: 'context-project-roots-match-nothing', verb: 'context', workspace: 'ctx-monorepo', setup: (ws) => write(ws, '.impeccable/config.json', JSON.stringify({ projectRoots: ['services/*'] }, null, 2) + '\n'), env: env(), files: IMPECCABLE_FILES },
  { id: 'context-hook-manifest-source-provider', verb: 'context', workspace: 'ctx-product-only', setup: (ws) => write(ws, '.claude/settings.local.json', JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'node .claude/skills/impeccable/scripts/hook.mjs' }] }] } }, null, 2) + '\n'), env: env(), files: IMPECCABLE_FILES },

  // ======================================================================
  // doctor
  // ======================================================================
  { id: 'doctor-help', verb: 'doctor', workspace: 'ctx-empty', args: ['--help'], env: env() },
  { id: 'doctor-help-short', verb: 'doctor', workspace: 'ctx-empty', args: ['-h', '--json'], env: env() },
  { id: 'doctor-empty-text', verb: 'doctor', workspace: 'ctx-empty', env: env() },
  { id: 'doctor-empty-json', verb: 'doctor', workspace: 'ctx-empty', args: ['--json'], env: env() },
  { id: 'doctor-visual-only-text', verb: 'doctor', workspace: 'ctx-visual-only', env: env() },
  { id: 'doctor-visual-only-json', verb: 'doctor', workspace: 'ctx-visual-only', args: ['--json'], env: env() },
  { id: 'doctor-product-only-text', verb: 'doctor', workspace: 'ctx-product-only', env: env() },
  { id: 'doctor-product-only-json', verb: 'doctor', workspace: 'ctx-product-only', args: ['--json'], env: env() },
  { id: 'doctor-full-text', verb: 'doctor', workspace: 'ctx-full', setup: sidecarNewer, env: env() },
  { id: 'doctor-full-json', verb: 'doctor', workspace: 'ctx-full', setup: sidecarNewer, args: ['--json'], env: env() },
  { id: 'doctor-full-sidecar-stale', verb: 'doctor', workspace: 'ctx-full', setup: (ws) => { touch(path.join(ws, 'DESIGN.md'), T_NEW); touch(path.join(ws, '.impeccable/design.json'), T_OLD); }, args: ['--json'], env: env() },
  { id: 'doctor-native-ios-text', verb: 'doctor', workspace: 'ctx-native-ios', env: env() },
  { id: 'doctor-native-ios-json', verb: 'doctor', workspace: 'ctx-native-ios', args: ['--json'], env: env() },
  { id: 'doctor-adaptive-text', verb: 'doctor', workspace: 'ctx-adaptive', env: env() },
  { id: 'doctor-adaptive-json', verb: 'doctor', workspace: 'ctx-adaptive', args: ['--json'], env: env() },
  { id: 'doctor-bad-platform-text', verb: 'doctor', workspace: 'ctx-bad-platform', env: env() },
  { id: 'doctor-bad-platform-json', verb: 'doctor', workspace: 'ctx-bad-platform', args: ['--json'], env: env() },
  { id: 'doctor-monorepo-text', verb: 'doctor', workspace: 'ctx-monorepo', env: env() },
  { id: 'doctor-monorepo-json', verb: 'doctor', workspace: 'ctx-monorepo', args: ['--json'], env: env() },
  { id: 'doctor-monorepo-target-a', verb: 'doctor', workspace: 'ctx-monorepo', args: ['--json', '--target', 'apps/a'], env: env() },
  { id: 'doctor-monorepo-target-b', verb: 'doctor', workspace: 'ctx-monorepo', args: ['--target', 'apps/b/src/App.tsx'], env: env() },
  { id: 'doctor-monorepo-child-cwd', verb: 'doctor', workspace: 'ctx-monorepo', cwd: 'apps/a', args: ['--json'], env: env() },
  { id: 'doctor-monorepo-roots-match-nothing', verb: 'doctor', workspace: 'ctx-monorepo', setup: (ws) => write(ws, '.impeccable/config.json', JSON.stringify({ projectRoots: ['services/*'] }, null, 2) + '\n'), env: env() },
  { id: 'doctor-legacy-text', verb: 'doctor', workspace: 'ctx-legacy', setup: legacySetup, env: env(), files: IMPECCABLE_FILES },
  { id: 'doctor-legacy-json', verb: 'doctor', workspace: 'ctx-legacy', setup: legacySetup, args: ['--json'], env: env(), files: IMPECCABLE_FILES },
  { id: 'doctor-legacy-fix', verb: 'doctor', workspace: 'ctx-legacy', setup: legacySetup, args: ['--fix'], env: env(), files: IMPECCABLE_FILES },
  { id: 'doctor-legacy-fix-json', verb: 'doctor', workspace: 'ctx-legacy', setup: legacySetup, args: ['--fix', '--json'], env: env(), files: IMPECCABLE_FILES },
  { id: 'doctor-legacy-fix-twice', verb: 'doctor', workspace: 'ctx-legacy', setup: legacySetup, args: ['--fix'], env: env(), files: IMPECCABLE_FILES, steps: [{}, {}, { args: ['--json'] }] },
  {
    id: 'doctor-legacy-fix-no-overwrite', verb: 'doctor', workspace: 'ctx-legacy',
    setup: (ws) => { legacySetup(ws); write(ws, '.impeccable/design.json', JSON.stringify({ schemaVersion: 2 }) + '\n'); },
    args: ['--fix'], env: env(), files: IMPECCABLE_FILES,
  },
  {
    // Unstamped PRODUCT.md that already has a v4 section: --fix stamps it.
    id: 'doctor-fix-stamps-product', verb: 'doctor', workspace: 'ctx-product-only',
    setup: (ws) => write(ws, 'PRODUCT.md', '# Unstamped\n\n## Platform\n\nweb\n\n## Positioning\nHas a v4 section but no stamp.\n'),
    args: ['--fix'], env: env(), files: IMPECCABLE_FILES, steps: [{}, {}],
  },
  { id: 'doctor-fix-clean', verb: 'doctor', workspace: 'ctx-full', setup: sidecarNewer, args: ['--fix'], env: env(), files: IMPECCABLE_FILES },
  { id: 'doctor-target-missing-value', verb: 'doctor', workspace: 'ctx-full', setup: sidecarNewer, args: ['--json', '--target'], env: env() },
  { id: 'doctor-target-eq-empty', verb: 'doctor', workspace: 'ctx-full', setup: sidecarNewer, args: ['--target='], env: env() },
  { id: 'doctor-target-file', verb: 'doctor', workspace: 'ctx-full', setup: sidecarNewer, args: ['--target=src/pages/index.astro'], env: env() },
  { id: 'doctor-hook-conflict', verb: 'doctor', workspace: 'ctx-product-only', setup: (ws) => { write(ws, '.impeccable/config.json', JSON.stringify({ hook: { enabled: false } }, null, 2) + '\n'); write(ws, '.claude/settings.local.json', JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'node .claude/skills/impeccable/scripts/hook.mjs' }] }] } }, null, 2) + '\n'); }, args: ['--json'], env: env() },
  { id: 'doctor-legacy-live-dir', verb: 'doctor', workspace: 'ctx-product-only', setup: (ws) => write(ws, '.impeccable-live/sessions/s1.json', '{}\n'), args: ['--fix'], env: env() },
  { id: 'doctor-design-seed-marker', verb: 'doctor', workspace: 'ctx-product-only', setup: (ws) => write(ws, 'DESIGN.md', "<!-- SEED: established with the user before implementation; re-run /impeccable document once there's code to capture the actual tokens and components. -->\n# Seed\n\n## Colors\n- **Ink** (#111): Text.\n\n## Typography\n**Body Font:** Inter\n"), args: ['--json'], env: env() },
  { id: 'doctor-design-coverage-missing-all', verb: 'doctor', workspace: 'ctx-product-only', setup: (ws) => write(ws, 'DESIGN.md', '# Thin\n\nNo canonical sections at all.\n'), env: env() },
  { id: 'doctor-sidecar-schema-missing', verb: 'doctor', workspace: 'ctx-product-only', setup: (ws) => { write(ws, 'DESIGN.md', '# D\n\n## Colors\n- x\n\n## Typography\n- y\n\n## Components\n- z\n'); write(ws, '.impeccable/design.json', '{"title":"x"}\n'); sidecarNewer(ws); }, args: ['--json'], env: env() },
  { id: 'doctor-config-local-and-shared', verb: 'doctor', workspace: 'ctx-product-only', setup: (ws) => { write(ws, '.impeccable/config.json', '{"buildPath":"comp","detector":{"ignoreRules":["*","GRADIENT-TEXT"]}}\n'); write(ws, '.impeccable/config.local.json', '{"buildPath":"maybe","nope":1}\n'); }, env: env() },
  { id: 'doctor-config-malformed', verb: 'doctor', workspace: 'ctx-product-only', setup: (ws) => write(ws, '.impeccable/config.json', '{not json'), env: env() },
  { id: 'doctor-config-array', verb: 'doctor', workspace: 'ctx-product-only', setup: (ws) => write(ws, '.impeccable/config.json', '[1,2]\n'), env: env() },
  { id: 'doctor-hook-script-missing', verb: 'doctor', workspace: 'ctx-product-only', setup: (ws) => write(ws, '.claude/settings.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs"' }] }] } }, null, 2) + '\n'), args: ['--json'], env: env() },
  { id: 'doctor-hook-script-present', verb: 'doctor', workspace: 'ctx-product-only', setup: (ws) => { write(ws, '.claude/settings.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node .claude/skills/impeccable/scripts/hook.mjs' }] }] } }, null, 2) + '\n'); write(ws, '.claude/skills/impeccable/scripts/hook.mjs', '// present\n'); }, args: ['--json'], env: env() },
  {
    id: 'doctor-design-drift', verb: 'doctor', workspace: 'ctx-signals',
    setup: (ws) => {
      write(ws, 'DESIGN.md', '# D\n\n## Colors\n- x\n\n## Typography\n- y\n\n## Components\n- z\n');
      gitInit(ws);
      for (let i = 0; i < 26; i++) {
        write(ws, `src/c${i}.tsx`, `export const C${i} = () => null;\n`);
        git(ws, 'add', '.');
        git(ws, 'commit', '-qm', `change ${i}`);
      }
    },
    args: ['--json'], env: env(),
  },
  { id: 'doctor-design-no-drift', verb: 'doctor', workspace: 'ctx-signals', setup: (ws) => { write(ws, 'DESIGN.md', '# D\n\n## Colors\n- x\n\n## Typography\n- y\n\n## Components\n- z\n'); gitInit(ws); }, args: ['--json'], env: env() },

  // ======================================================================
  // pin
  // ======================================================================
  { id: 'pin-usage-no-args', verb: 'pin', workspace: 'ctx-pin', env: env() },
  { id: 'pin-usage-one-arg', verb: 'pin', workspace: 'ctx-pin', args: ['pin'], env: env() },
  { id: 'pin-bad-action', verb: 'pin', workspace: 'ctx-pin', args: ['toggle', 'audit'], env: env() },
  { id: 'pin-bad-command', verb: 'pin', workspace: 'ctx-pin', args: ['pin', 'doctor'], env: env() },
  { id: 'pin-bad-command-teach', verb: 'pin', workspace: 'ctx-pin', args: ['pin', 'teach'], env: env() },
  { id: 'pin-no-harness', verb: 'pin', workspace: 'ctx-empty', args: ['pin', 'audit'], env: env(), files: ['.*/skills/**'] },
  { id: 'pin-unpin-no-harness', verb: 'pin', workspace: 'ctx-empty', args: ['unpin', 'audit'], env: env(), files: ['.*/skills/**'] },
  { id: 'pin-polish', verb: 'pin', workspace: 'ctx-pin', args: ['pin', 'polish'], env: env(), files: ['.*/skills/**'] },
  { id: 'pin-audit-skips-existing', verb: 'pin', workspace: 'ctx-pin', args: ['pin', 'audit'], env: env(), files: ['.*/skills/**'] },
  { id: 'pin-live-from-subdir', verb: 'pin', workspace: 'ctx-pin', cwd: 'sub/deeper', setup: (ws) => fs.mkdirSync(path.join(ws, 'sub/deeper'), { recursive: true }), args: ['pin', 'live'], env: env(), files: ['.*/skills/**'] },
  { id: 'pin-unpin-nothing-pinned', verb: 'pin', workspace: 'ctx-pin', args: ['unpin', 'polish'], env: env(), files: ['.*/skills/**'] },
  { id: 'pin-unpin-skips-non-pinned', verb: 'pin', workspace: 'ctx-pin', args: ['unpin', 'audit'], env: env(), files: ['.*/skills/**'] },
  { id: 'pin-then-unpin', verb: 'pin', workspace: 'ctx-pin', env: env(), files: ['.*/skills/**'], steps: [{ args: ['pin', 'critique'] }, { args: ['pin', 'critique'] }, { args: ['unpin', 'critique'] }, { args: ['unpin', 'critique'] }] },
  { id: 'pin-i-impeccable-alias', verb: 'pin', workspace: 'ctx-empty', setup: (ws) => write(ws, '.codex/skills/i-impeccable/SKILL.md', '---\nname: i-impeccable\n---\n'), args: ['pin', 'shape'], env: env(), files: ['.*/skills/**'] },

  // ======================================================================
  // surface-brief
  // ======================================================================
  { id: 'surface-brief-usage', verb: 'surface-brief', workspace: 'ctx-full', env: env() },
  { id: 'surface-brief-unknown', verb: 'surface-brief', workspace: 'ctx-full', args: ['delete', 'x'], env: env() },
  { id: 'surface-brief-path-file', verb: 'surface-brief', workspace: 'ctx-full', args: ['path', 'src/pages/index.astro'], env: env() },
  { id: 'surface-brief-path-route', verb: 'surface-brief', workspace: 'ctx-full', args: ['path', 'route:/docs/intro/'], env: env() },
  { id: 'surface-brief-path-slash', verb: 'surface-brief', workspace: 'ctx-full', args: ['path', '/'], env: env() },
  { id: 'surface-brief-path-url', verb: 'surface-brief', workspace: 'ctx-full', args: ['path', 'https://Impeccable.Style/docs/audit/?x=1#top'], env: env() },
  { id: 'surface-brief-path-outside', verb: 'surface-brief', workspace: 'ctx-full', args: ['path', '../elsewhere/x.astro'], env: env() },
  { id: 'surface-brief-path-missing-target', verb: 'surface-brief', workspace: 'ctx-full', args: ['path'], env: env() },
  { id: 'surface-brief-path-from-subdir', verb: 'surface-brief', workspace: 'ctx-full', cwd: 'src', args: ['path', 'pages/index.astro'], env: env() },
  { id: 'surface-brief-list', verb: 'surface-brief', workspace: 'ctx-full', args: ['list'], env: env() },
  { id: 'surface-brief-list-empty', verb: 'surface-brief', workspace: 'ctx-empty', args: ['list'], env: env() },
  { id: 'surface-brief-read-primary', verb: 'surface-brief', workspace: 'ctx-full', args: ['read', 'src/pages/index.astro'], env: env() },
  { id: 'surface-brief-read-related', verb: 'surface-brief', workspace: 'ctx-full', args: ['read', 'src/components/Hero.astro'], env: env() },
  { id: 'surface-brief-read-route', verb: 'surface-brief', workspace: 'ctx-full', args: ['read', '/pricing'], env: env() },
  { id: 'surface-brief-read-route-prefixed', verb: 'surface-brief', workspace: 'ctx-full', args: ['read', 'route:/pricing/'], env: env() },
  { id: 'surface-brief-read-not-found', verb: 'surface-brief', workspace: 'ctx-full', args: ['read', 'src/pages/about.astro'], env: env() },
  { id: 'surface-brief-read-no-target-ambiguous', verb: 'surface-brief', workspace: 'ctx-full', args: ['read'], env: env() },
  { id: 'surface-brief-read-no-target-only-brief', verb: 'surface-brief', workspace: 'ctx-full', setup: (ws) => fs.rmSync(path.join(ws, '.impeccable/surfaces/route-pricing.md')), args: ['read'], env: env() },
  { id: 'surface-brief-read-none', verb: 'surface-brief', workspace: 'ctx-empty', args: ['read', 'src/x.tsx'], env: env() },
  { id: 'surface-brief-read-invalid-target', verb: 'surface-brief', workspace: 'ctx-full', args: ['read', 'route:../etc'], env: env() },
  { id: 'surface-brief-read-monorepo-child', verb: 'surface-brief', workspace: 'ctx-monorepo', setup: (ws) => write(ws, 'apps/a/.impeccable/surfaces/src-app-tsx.md', '---\nversion: 1\nslug: "src-app-tsx"\nprimary_target: "src/App.tsx"\nrelated_targets: []\n---\n\n# Surface brief: A\n'), args: ['read', 'apps/a/src/App.tsx'], env: env() },
  { id: 'surface-brief-write-usage', verb: 'surface-brief', workspace: 'ctx-full', args: ['write', 'src/pages/about.astro'], env: env() },
  {
    id: 'surface-brief-write-read-list', verb: 'surface-brief', workspace: 'ctx-full',
    setup: (ws) => write(ws, 'body.md', '# Surface brief: About\n\n## Mode\nRead\n\nTell the story.\n\n'),
    env: env(), files: ['.impeccable/surfaces/**'],
    steps: [
      { args: ['write', 'src/pages/about.astro', `${WS}/body.md`, 'src/components/Team.astro', 'src/pages/about.astro', 'src/components/Team.astro'] },
      { args: ['read', 'src/components/Team.astro'] },
      { args: ['list'] },
      { args: ['write', 'src/pages/about.astro', `${WS}/body.md`] },
      { args: ['read', 'src/components/Team.astro'] },
    ],
  },
  { id: 'surface-brief-write-route', verb: 'surface-brief', workspace: 'ctx-empty', setup: (ws) => write(ws, 'body.md', 'Root route brief.'), args: ['write', '/', `${WS}/body.md`, 'route:/home/'], env: env(), files: ['.impeccable/surfaces/**'] },
  { id: 'surface-brief-write-url', verb: 'surface-brief', workspace: 'ctx-empty', setup: (ws) => write(ws, 'body.md', 'URL brief.'), args: ['write', 'https://example.com/pricing/#plans', `${WS}/body.md`], env: env(), files: ['.impeccable/surfaces/**'] },
  { id: 'surface-brief-write-invalid-target', verb: 'surface-brief', workspace: 'ctx-empty', setup: (ws) => write(ws, 'body.md', 'x'), args: ['write', '../outside.astro', `${WS}/body.md`], env: env(), files: ['.impeccable/surfaces/**'] },
  { id: 'surface-brief-write-missing-body', verb: 'surface-brief', workspace: 'ctx-empty', args: ['write', 'src/x.tsx', `${WS}/nope.md`], env: env(), files: ['.impeccable/surfaces/**'] },
  { id: 'surface-brief-write-monorepo-child', verb: 'surface-brief', workspace: 'ctx-monorepo', setup: (ws) => write(ws, 'body.md', 'Child brief.'), args: ['write', 'apps/b/src/App.tsx', `${WS}/body.md`], env: env(), files: ['**/.impeccable/surfaces/**'] },

  // ======================================================================
  // critique-storage
  // ======================================================================
  { id: 'critique-usage', verb: 'critique-storage', workspace: 'ctx-full', env: env() },
  { id: 'critique-unknown', verb: 'critique-storage', workspace: 'ctx-full', args: ['delete', 'x'], env: env() },
  { id: 'critique-slug-path', verb: 'critique-storage', workspace: 'ctx-full', args: ['slug', 'src/pages/index.astro'], env: env() },
  { id: 'critique-slug-url', verb: 'critique-storage', workspace: 'ctx-full', args: ['slug', 'http://localhost:3000/pricing'], env: env() },
  { id: 'critique-slug-passthrough', verb: 'critique-storage', workspace: 'ctx-full', args: ['slug', 'already-a-slug'], env: env() },
  { id: 'critique-slug-dot', verb: 'critique-storage', workspace: 'ctx-full', args: ['slug', '.'], env: env() },
  { id: 'critique-slug-empty', verb: 'critique-storage', workspace: 'ctx-full', args: ['slug', '   '], env: env() },
  { id: 'critique-slug-missing', verb: 'critique-storage', workspace: 'ctx-full', args: ['slug'], env: env() },
  { id: 'critique-slug-long', verb: 'critique-storage', workspace: 'ctx-full', args: ['slug', 'src/very/deeply/nested/directory/structure/with/many/segments/component-name.tsx'], env: env() },
  { id: 'critique-slug-outside', verb: 'critique-storage', workspace: 'ctx-full', args: ['slug', '../other/Page.tsx'], env: env() },
  { id: 'critique-latest-none', verb: 'critique-storage', workspace: 'ctx-empty', args: ['latest', 'src/x.tsx'], env: env() },
  { id: 'critique-latest-existing', verb: 'critique-storage', workspace: 'ctx-full', args: ['latest', 'src/pages/index.astro'], env: env() },
  { id: 'critique-latest-other-slug', verb: 'critique-storage', workspace: 'ctx-full', args: ['latest', 'route-pricing'], env: env() },
  { id: 'critique-trend-existing', verb: 'critique-storage', workspace: 'ctx-full', args: ['trend', 'src-pages-index-astro'], env: env() },
  { id: 'critique-trend-none', verb: 'critique-storage', workspace: 'ctx-full', args: ['trend', 'nothing-here', '3'], env: env() },
  { id: 'critique-write-usage', verb: 'critique-storage', workspace: 'ctx-full', args: ['write', 'src/pages/index.astro'], env: env() },
  {
    // The snapshot filename carries the wall clock, so files are not
    // snapshotted; latest/trend afterwards prove the round trip. The written
    // path is masked by normalize() (see lib.mjs, critique stamps).
    id: 'critique-write-then-read', verb: 'critique-storage', workspace: 'ctx-empty',
    setup: (ws) => { write(ws, 'body.md', '# Critique\n\nScore 81/100.\n\n'); write(ws, 'body2.md', 'Second pass.\n'); },
    env: env({ IMPECCABLE_CRITIQUE_META: JSON.stringify({ total_score: 81, p0_count: 0, p1_count: 2, target: 'src/App.tsx', note: 'ratio 3:1 #hero', slug: 'ignored', timestamp: 'ignored' }) }),
    steps: [
      { args: ['write', 'src/App.tsx', `${WS}/body.md`] },
      { args: ['latest', 'src/App.tsx'] },
      { args: ['write', 'src-app-tsx', `${WS}/body2.md`], env: env({ IMPECCABLE_CRITIQUE_META: '{not json' }) },
      { args: ['latest', 'src-app-tsx'] },
      { args: ['trend', 'src/App.tsx'] },
      { args: ['trend', 'src/App.tsx', '1'] },
    ],
  },
  { id: 'critique-write-monorepo-child', verb: 'critique-storage', workspace: 'ctx-monorepo', cwd: 'apps/a', setup: (ws) => write(ws, 'body.md', 'Child critique.\n'), args: ['write', 'src/App.tsx', `${WS}/body.md`], env: env(), steps: [{}, { args: ['latest', 'src/App.tsx'] }, { args: ['latest', 'src/App.tsx'], cwd: 'apps/b' }] },

  // ======================================================================
  // palette
  // ======================================================================
  { id: 'palette-id-known', verb: 'palette', args: ['--id', 'seed-002'], env: env() },
  { id: 'palette-id-unknown', verb: 'palette', args: ['--id', 'no-such-seed'], env: env() },
  { id: 'palette-from-key', verb: 'palette', args: ['--from', 'oracle-fixture-key'], env: env() },
  { id: 'palette-from-key-2', verb: 'palette', args: ['--from', 'another key with spaces'], env: env() },
  { id: 'palette-env-seed', verb: 'palette', args: [], env: env({ IMPECCABLE_PALETTE_SEED: 'env-seed-key' }) },
  { id: 'palette-from-overrides-env', verb: 'palette', args: ['--from', 'oracle-fixture-key'], env: env({ IMPECCABLE_PALETTE_SEED: 'env-seed-key' }) },
  { id: 'palette-id-overrides-from', verb: 'palette', args: ['--from', 'oracle-fixture-key', '--id', 'no-such-seed'], env: env() },

  // ======================================================================
  // embed-prompt
  // ======================================================================
  { id: 'embed-no-args', verb: 'embed-prompt', workspace: 'ctx-empty', setup: imagesSetup, args: [], env: env() },
  { id: 'embed-missing-file', verb: 'embed-prompt', workspace: 'ctx-empty', setup: imagesSetup, args: ['assets/nope.png', '--prompt', 'x'], env: env() },
  { id: 'embed-no-prompt', verb: 'embed-prompt', workspace: 'ctx-empty', setup: imagesSetup, args: ['assets/a.png'], env: env() },
  { id: 'embed-png', verb: 'embed-prompt', workspace: 'ctx-empty', setup: imagesSetup, env: env(), files: ['assets/a.png*'], steps: [
    { args: ['assets/a.png', '--prompt', 'A warm editorial hero, paper and ink.'] },
    { args: ['assets/a.png', '--read'] },
    { args: ['assets/a.png', '--prompt', 'Replaced prompt.'] },
    { args: ['assets/a.png', '--read'] },
  ] },
  { id: 'embed-png-prompt-file', verb: 'embed-prompt', workspace: 'ctx-empty', setup: imagesSetup, env: env(), files: ['assets/a.png*'], steps: [
    { args: ['assets/a.png', '--prompt-file', 'prompt.txt'] },
    { args: ['assets/a.png', '--read'] },
  ] },
  { id: 'embed-png-malformed', verb: 'embed-prompt', workspace: 'ctx-empty', setup: (ws) => { imagesSetup(ws); fs.writeFileSync(path.join(ws, 'assets/bad.png'), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('garbage-not-chunks')])); }, args: ['assets/bad.png', '--prompt', 'x'], env: env(), files: ['assets/bad.png*'] },
  { id: 'embed-jpeg', verb: 'embed-prompt', workspace: 'ctx-empty', setup: imagesSetup, env: env(), files: ['assets/b.jpg*'], steps: [
    { args: ['assets/b.jpg', '--prompt', 'JPEG prompt one.'] },
    { args: ['assets/b.jpg', '--read'] },
    { args: ['assets/b.jpg', '--prompt', 'JPEG prompt two.'] },
    { args: ['assets/b.jpg', '--read'] },
  ] },
  { id: 'embed-webp-sidecar', verb: 'embed-prompt', workspace: 'ctx-empty', setup: imagesSetup, env: env(), files: ['assets/c.webp*'], steps: [
    { args: ['assets/c.webp', '--read'] },
    { args: ['assets/c.webp', '--prompt', 'Sidecar prompt.'] },
    { args: ['assets/c.webp', '--read'] },
  ] },
  { id: 'embed-read-none', verb: 'embed-prompt', workspace: 'ctx-empty', setup: imagesSetup, args: ['assets/a.png', '--read'], env: env() },
  { id: 'embed-scan-no-targets', verb: 'embed-prompt', workspace: 'ctx-empty', setup: imagesSetup, args: ['--scan'], env: env() },
  { id: 'embed-scan-missing-path', verb: 'embed-prompt', workspace: 'ctx-empty', setup: imagesSetup, args: ['--scan', 'assets', 'nowhere'], env: env() },
  { id: 'embed-scan-missing', verb: 'embed-prompt', workspace: 'ctx-empty', setup: imagesSetup, args: ['--scan', 'assets'], env: env() },
  { id: 'embed-scan-hidden-root', verb: 'embed-prompt', workspace: 'ctx-empty', setup: imagesSetup, args: ['--scan', 'assets/.hidden'], env: env() },
  { id: 'embed-scan-single-file', verb: 'embed-prompt', workspace: 'ctx-empty', setup: imagesSetup, args: ['--scan', 'assets/notes.txt'], env: env() },
  { id: 'embed-scan-clean', verb: 'embed-prompt', workspace: 'ctx-empty', setup: imagesSetup, env: env(), steps: [
    { args: ['assets/a.png', '--prompt', 'p'] },
    { args: ['assets/b.jpg', '--prompt', 'p'] },
    { args: ['assets/c.webp', '--prompt', 'p'] },
    { args: ['assets/nested/d.jpeg', '--prompt', 'p'] },
    { args: ['--scan', 'assets/'] },
  ] },

  // ======================================================================
  // context-signals
  // ======================================================================
  { id: 'signals-empty', verb: 'context-signals', workspace: 'ctx-empty', env: env() },
  { id: 'signals-visual-only', verb: 'context-signals', workspace: 'ctx-visual-only', env: env() },
  { id: 'signals-full-with-critique', verb: 'context-signals', workspace: 'ctx-full', setup: sidecarNewer, env: env() },
  { id: 'signals-native-ios', verb: 'context-signals', workspace: 'ctx-native-ios', env: env() },
  { id: 'signals-critique-legacy-keys', verb: 'context-signals', workspace: 'ctx-empty', setup: (ws) => write(ws, '.impeccable/critique/2026-02-02T02-02-02Z__x.md', '---\nscore: "88"\np0: 0\np1: 2\ntimestamp: "2026-02-02T02:02:02.000Z"\nslug: x\n---\nbody\n'), env: env() },
  { id: 'signals-critique-blank-keys', verb: 'context-signals', workspace: 'ctx-empty', setup: (ws) => write(ws, '.impeccable/critique/2026-02-02T02-02-02Z__x.md', '---\ntotal_score: n/a\nslug: x\n---\nbody\n'), env: env() },
  { id: 'signals-git-clean-main', verb: 'context-signals', workspace: 'ctx-signals', setup: gitInit, env: env() },
  { id: 'signals-git-dirty-main', verb: 'context-signals', workspace: 'ctx-signals', setup: gitDirty, env: env() },
  { id: 'signals-git-feature-branch', verb: 'context-signals', workspace: 'ctx-signals', setup: gitFeature, env: env() },
  { id: 'signals-git-dirty-non-ui', verb: 'context-signals', workspace: 'ctx-signals', setup: (ws) => { gitInit(ws); write(ws, 'src/util.ts', 'export const x = 2;\n'); write(ws, 'dist/bundle.css', 'a{}\n'); write(ws, 'README.md', 'x\n'); }, env: env() },
  { id: 'signals-git-dirty-renamed', verb: 'context-signals', workspace: 'ctx-signals', setup: (ws) => { gitInit(ws); git(ws, 'mv', 'src/App.tsx', 'src/Main.tsx'); }, env: env() },

  // ======================================================================
  // detect-csp
  // ======================================================================
  { id: 'csp-append-arrays', verb: 'detect-csp', workspace: 'ctx-csp-append-arrays', env: env() },
  { id: 'csp-append-string', verb: 'detect-csp', workspace: 'ctx-csp-append-string', env: env() },
  { id: 'csp-middleware', verb: 'detect-csp', workspace: 'ctx-csp-middleware', env: env() },
  { id: 'csp-meta', verb: 'detect-csp', workspace: 'ctx-csp-meta', env: env() },
  { id: 'csp-none', verb: 'detect-csp', workspace: 'ctx-csp-none', setup: (ws) => write(ws, 'node_modules/dep/middleware.ts', 'export function middleware(req, res) { res.headers.set("Content-Security-Policy", "x"); }\n'), env: env() },
  { id: 'csp-nuxt-security', verb: 'detect-csp', workspace: 'ctx-csp-none', setup: (ws) => write(ws, 'nuxt.config.ts', "export default defineNuxtConfig({ modules: ['nuxt-security'], security: { headers: { contentSecurityPolicy: { 'script-src': [\"'self'\"] } } } });\n"), env: env() },
  { id: 'csp-empty', verb: 'detect-csp', workspace: 'ctx-empty', env: env() },

  // ======================================================================
  // concept-seed (local catalog or offline degraded only)
  // ======================================================================
  { id: 'seed-scope-invalid', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'world', '--from', 'k1'], env: seedEnv() },
  { id: 'seed-reroll-invalid', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'direction', '--from', 'k1', '--reroll', '-1'], env: seedEnv() },
  { id: 'seed-register-invalid', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'direction', '--from', 'k1', '--reroll', '1', '--register', 'wild'], env: seedEnv() },
  { id: 'seed-register-without-reroll', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'direction', '--from', 'k1', '--register', 'bolder'], env: seedEnv() },
  { id: 'seed-register-surface', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'surface', '--from', 'k1', '--reroll', '1', '--register', 'bolder'], env: seedEnv() },
  { id: 'seed-mode-invalid', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'direction', '--from', 'k1', '--mode', 'sell'], env: seedEnv() },
  { id: 'seed-grain-invalid', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'surface', '--from', 'k1', '--grain', 'pixel'], env: seedEnv() },
  { id: 'seed-platform-invalid', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'surface', '--from', 'k1', '--platform', 'tv'], env: seedEnv() },
  { id: 'seed-candidate-count-invalid', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'direction', '--from', 'k1', '--candidate-count', '9'], env: seedEnv() },
  { id: 'seed-no-product-gate', verb: 'concept-seed', workspace: 'ctx-visual-only', args: ['--scope', 'direction', '--from', 'k1'], env: seedEnv() },
  { id: 'seed-direction-local', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'direction', '--mode', 'persuade', '--from', 'oracle-key-1'], env: seedEnv() },
  { id: 'seed-direction-local-reroll', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'direction', '--mode', 'persuade', '--from', 'oracle-key-1', '--reroll', '1'], env: seedEnv() },
  { id: 'seed-direction-local-reroll-bolder', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'direction', '--mode', 'persuade', '--from', 'oracle-key-1', '--reroll', '2', '--register', 'bolder'], env: seedEnv() },
  { id: 'seed-direction-local-reroll-safer', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'direction', '--from', 'oracle-key-1', '--reroll', '1', '--register', 'safer'], env: seedEnv() },
  { id: 'seed-direction-local-count-5', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'direction', '--mode', 'operate', '--from', 'oracle-key-2', '--candidate-count', '5'], env: seedEnv() },
  { id: 'seed-direction-local-unscoped', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'direction', '--from', 'oracle-key-3'], env: seedEnv() },
  { id: 'seed-direction-env-key', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'direction'], env: seedEnv({ IMPECCABLE_CONCEPT_SEED: 'oracle-key-1' }) },
  { id: 'seed-surface-local', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'surface', '--mode', 'operate', '--from', 'oracle-key-1'], env: seedEnv() },
  { id: 'seed-surface-local-default-scope', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--mode', 'operate', '--from', 'oracle-key-1'], env: seedEnv() },
  { id: 'seed-surface-local-grain-flow', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'surface', '--mode', 'read', '--from', 'oracle-key-2', '--grain', 'flow', '--platform', 'ios'], env: seedEnv() },
  { id: 'seed-surface-local-compositions', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'surface', '--mode', 'persuade', '--from', 'oracle-key-1', '--platform', 'web'], env: seedEnv({ IMPECCABLE_COMPOSITIONS: '1' }) },
  { id: 'seed-surface-local-card-base', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'surface', '--mode', 'experience', '--from', 'oracle-key-4', '--reroll', '1'], env: seedEnv({ IMPECCABLE_CARD_BASE: 'https://cards.example/base/' }) },
  { id: 'seed-degraded-direction', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'direction', '--mode', 'persuade', '--from', 'oracle-key-1'], env: degradedEnv() },
  { id: 'seed-degraded-surface', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'surface', '--mode', 'operate', '--from', 'oracle-key-1'], env: degradedEnv() },
  { id: 'seed-degraded-safer', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'direction', '--from', 'oracle-key-1', '--reroll', '1', '--register', 'safer'], env: degradedEnv() },
  { id: 'seed-degraded-bolder', verb: 'concept-seed', workspace: 'ctx-product-only', args: ['--scope', 'direction', '--from', 'oracle-key-1', '--reroll', '1', '--register', 'bolder'], env: degradedEnv() },
  { id: 'seed-degraded-no-product-gate', verb: 'concept-seed', workspace: 'ctx-empty', args: ['--scope', 'direction', '--from', 'k1'], env: degradedEnv() },
  { id: 'seed-chosen-telemetry-off', verb: 'concept-seed', workspace: 'ctx-empty', args: ['--chosen', 'some-id', '--kind', 'challenger', '--from', 'k1', '--scope', 'direction'], env: seedEnv() },
  { id: 'seed-kind-assigned-telemetry-off', verb: 'concept-seed', workspace: 'ctx-empty', args: ['--kind', 'assigned', '--from', 'k1', '--scope', 'direction'], env: seedEnv() },
  { id: 'seed-chosen-bad-kind', verb: 'concept-seed', workspace: 'ctx-empty', args: ['--chosen', 'x', '--kind', 'random', '--from', 'k1'], env: seedEnv({ IMPECCABLE_NO_TELEMETRY: null, DO_NOT_TRACK: null }) },
  { id: 'seed-chosen-no-id-challenger', verb: 'concept-seed', workspace: 'ctx-empty', args: ['--kind', 'challenger', '--from', 'k1'], env: seedEnv({ IMPECCABLE_NO_TELEMETRY: null, DO_NOT_TRACK: null }) },
  { id: 'seed-chosen-api-unreachable', verb: 'concept-seed', workspace: 'ctx-empty', args: ['--chosen', 'x', '--kind', 'pick', '--from', 'k1', '--scope', 'surface'], env: seedEnv({ IMPECCABLE_NO_TELEMETRY: null, DO_NOT_TRACK: null }) },

  // ======================================================================
  // generate-image (fake mode + argument errors only)
  // ======================================================================
  { id: 'genimg-fake-missing-args', verb: 'generate-image', workspace: 'ctx-empty', args: ['--prompt', 'x'], env: env({ IMPECCABLE_IMAGE_GEN_FAKE: '1' }) },
  { id: 'genimg-fake-missing-prompt', verb: 'generate-image', workspace: 'ctx-empty', args: ['--out', 'out.png'], env: env({ IMPECCABLE_IMAGE_GEN_FAKE: '1' }) },
  { id: 'genimg-fake-svg', verb: 'generate-image', workspace: 'ctx-empty', setup: (ws) => fs.mkdirSync(path.join(ws, 'comps')), args: ['--prompt', 'A warm editorial hero for a note-taking app, paper texture, ink type, one blue accent, wide composition.', '--out', 'comps/hero.svg', '--size', '800x500'], env: env({ IMPECCABLE_IMAGE_GEN_FAKE: '1' }), files: ['comps/**'] },
  { id: 'genimg-fake-svg-default-size', verb: 'generate-image', workspace: 'ctx-empty', args: ['--prompt', 'Short.', '--out', 'hero.svg', '--size', 'huge'], env: env({ IMPECCABLE_IMAGE_GEN_FAKE: '1' }), files: ['hero.svg*'] },
  { id: 'genimg-fake-png', verb: 'generate-image', workspace: 'ctx-empty', setup: (ws) => fs.mkdirSync(path.join(ws, 'comps')), args: ['--prompt', 'A dashboard comp.', '--out', 'comps/dash.png', '--size', '640x400'], env: env({ IMPECCABLE_IMAGE_GEN_FAKE: '1' }), files: ['comps/**'], steps: [{}, { verb: 'embed-prompt', args: ['comps/dash.png', '--read'] }] },
  { id: 'genimg-fake-prompt-file', verb: 'generate-image', workspace: 'ctx-empty', setup: (ws) => write(ws, 'prompt.txt', 'Prompt from file wins.\n'), args: ['--prompt', 'inline loses', '--prompt-file', 'prompt.txt', '--out', 'x.svg', '--size', '400x300'], env: env({ IMPECCABLE_IMAGE_GEN_FAKE: '1' }), files: ['x.svg*'] },
  { id: 'genimg-real-no-key', verb: 'generate-image', workspace: 'ctx-empty', args: ['--prompt', 'x', '--out', 'x.png'], env: env() },
  { id: 'genimg-real-missing-args', verb: 'generate-image', workspace: 'ctx-empty', args: ['--out', 'x.png'], env: env({ OPENAI_API_KEY: 'sk-oracle' }) },

  // ======================================================================
  // serve-question (no browser, no listening server)
  // ======================================================================
  { id: 'question-schema', verb: 'serve-question', workspace: 'ctx-empty', args: ['--schema'], env: env() },
  { id: 'question-disabled', verb: 'serve-question', workspace: 'ctx-empty', args: ['--schema'], env: env({ IMPECCABLE_QUESTION_DISABLED: '1' }) },
  { id: 'question-headless-ci', verb: 'serve-question', workspace: 'ctx-empty', setup: (ws) => write(ws, 'payload.json', JSON.stringify(QUESTION_PAYLOAD)), args: ['--payload', 'payload.json'], env: env({ CI: '1' }) },
  { id: 'question-headless-ci-start', verb: 'serve-question', workspace: 'ctx-empty', setup: (ws) => write(ws, 'payload.json', JSON.stringify(QUESTION_PAYLOAD)), args: ['--start', '--payload', 'payload.json'], env: env({ CI: '1' }) },
  { id: 'question-wait-no-key', verb: 'serve-question', workspace: 'ctx-empty', args: ['--wait'], env: env() },
  { id: 'question-wait-no-server', verb: 'serve-question', workspace: 'ctx-empty', args: ['--wait', '--key', 'k1', '--poll', '2'], env: env(), files: ['.impeccable/questions/**'] },
  { id: 'question-wait-answer-ready', verb: 'serve-question', workspace: 'ctx-empty', setup: (ws) => { write(ws, '.impeccable/questions/k1.state.json', JSON.stringify({ pid: 1, port: 1, url: 'http://127.0.0.1:1/' })); write(ws, '.impeccable/questions/k1.answer.json', JSON.stringify({ optionId: 'a', steer: 'keep the type', hero: 'https://x/hero.webp', comp: '.impeccable/mocks/decision/a.webp', buildPath: 'comp', buildPathFlipped: false })); }, args: ['--wait', '--key', 'k1', '--poll', '2'], env: env(), files: ['.impeccable/questions/**'] },
  { id: 'question-wait-answer-reroll', verb: 'serve-question', workspace: 'ctx-empty', setup: (ws) => { write(ws, '.impeccable/questions/k1.state.json', JSON.stringify({ pid: 1, port: 1, url: 'http://127.0.0.1:1/' })); write(ws, '.impeccable/questions/k1.answer.json', JSON.stringify({ optionId: 'reroll', steer: '', register: 'bolder' })); }, args: ['--wait', '--key', 'k1', '--poll', '2'], env: env(), files: ['.impeccable/questions/**'] },
  { id: 'question-wait-answer-canon-followup', verb: 'serve-question', workspace: 'ctx-empty', setup: (ws) => { write(ws, '.impeccable/questions/k1.state.json', JSON.stringify({ pid: 1, port: 1, url: 'http://127.0.0.1:1/' })); write(ws, '.impeccable/questions/k1.answer.json', JSON.stringify({ optionId: 'canon', steer: '', followup: true, buildPath: 'code', buildPathFlipped: true })); }, args: ['--wait', '--key', 'k1', '--poll', '2'], env: env(), files: ['.impeccable/questions/**'] },
  { id: 'question-wait-answer-raw', verb: 'serve-question', workspace: 'ctx-empty', setup: (ws) => { write(ws, '.impeccable/questions/k1.state.json', JSON.stringify({ pid: 1, port: 1, url: 'http://127.0.0.1:1/' })); write(ws, '.impeccable/questions/k1.answer.json', 'not-json'); }, args: ['--wait', '--key', 'k1', '--poll', '2'], env: env(), files: ['.impeccable/questions/**'] },
  { id: 'question-wait-flip', verb: 'serve-question', workspace: 'ctx-empty', setup: (ws) => { write(ws, '.impeccable/questions/k1.state.json', JSON.stringify({ pid: 1, port: 1, url: 'http://127.0.0.1:1/' })); write(ws, '.impeccable/questions/k1.flip.json', JSON.stringify({ buildPath: 'comp' })); }, args: ['--wait', '--key', 'k1', '--poll', '2'], env: env(), files: ['.impeccable/questions/**'] },
  { id: 'question-wait-page-closed', verb: 'serve-question', workspace: 'ctx-empty', setup: (ws) => write(ws, '.impeccable/questions/k1.state.json', JSON.stringify({ pid: 1, port: 1, url: 'http://127.0.0.1:1/', lastBeat: 1000 })), args: ['--wait', '--key', 'k1', '--poll', '2'], env: env(), files: ['.impeccable/questions/**'] },
  { id: 'question-wait-dead-pid', verb: 'serve-question', workspace: 'ctx-empty', setup: (ws) => write(ws, '.impeccable/questions/k1.state.json', JSON.stringify({ pid: 2147483000, port: 1, url: 'http://127.0.0.1:1/', lastBeat: 1000 })), args: ['--wait', '--key', 'k1', '--poll', '2'], env: env(), files: ['.impeccable/questions/**'] },
  { id: 'question-stop-no-key', verb: 'serve-question', workspace: 'ctx-empty', args: ['--stop'], env: env() },
  { id: 'question-stop-nothing', verb: 'serve-question', workspace: 'ctx-empty', args: ['--stop', '--key', 'k1'], env: env(), files: ['.impeccable/questions/**'] },
  { id: 'question-stop-clears-files', verb: 'serve-question', workspace: 'ctx-empty', setup: (ws) => { write(ws, '.impeccable/questions/k1.state.json', JSON.stringify({ pid: 2147483000, port: 1, url: 'x' })); write(ws, '.impeccable/questions/k1.answer.json', '{}'); write(ws, '.impeccable/questions/k1.log', 'log\n'); }, args: ['--stop', '--key', 'k1'], env: env(), files: ['.impeccable/questions/**'] },
  { id: 'question-update-no-key', verb: 'serve-question', workspace: 'ctx-empty', setup: (ws) => write(ws, 'payload.json', JSON.stringify(QUESTION_PAYLOAD)), args: ['--update', '--payload', 'payload.json'], env: env() },
  { id: 'question-update-empty-options', verb: 'serve-question', workspace: 'ctx-empty', setup: (ws) => write(ws, 'payload.json', JSON.stringify({ options: [] })), args: ['--update', '--key', 'k1', '--payload', 'payload.json'], env: env(), files: ['.impeccable/questions/**'] },
  { id: 'question-update-no-server', verb: 'serve-question', workspace: 'ctx-empty', setup: (ws) => write(ws, 'payload.json', JSON.stringify(QUESTION_PAYLOAD)), args: ['--update', '--key', 'k1', '--payload', 'payload.json'], env: env(), files: ['.impeccable/questions/**'] },
  { id: 'question-payload-no-options', verb: 'serve-question', workspace: 'ctx-empty', setup: (ws) => write(ws, 'payload.json', JSON.stringify({ title: 'no options' })), args: ['--payload', 'payload.json', '--no-open'], env: env(), files: ['.impeccable/questions/**'] },
];

export default cases;
