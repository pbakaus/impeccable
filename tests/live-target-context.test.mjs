import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const LIVE_SCRIPT = join(REPO_ROOT, 'skill', 'scripts', 'live.mjs');
const LIVE_INJECT_SCRIPT = join(REPO_ROOT, 'skill', 'scripts', 'live-inject.mjs');
const LIVE_SERVER_SCRIPT = join(REPO_ROOT, 'skill', 'scripts', 'live-server.mjs');
const TARGET = 'apps/dashboard/src/App.jsx';

describe('live target-aware monorepo context', () => {
  let tmp;

  beforeEach(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-live-target-')));
    setupMonorepo(tmp);
  });

  afterEach(() => {
    stopLive(tmp);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('does not let root live config shadow the child project config path', () => {
    writeRootLiveConfig(tmp);

    const res = runNode(LIVE_INJECT_SCRIPT, ['--check', '--target', TARGET], tmp);
    assert.equal(res.status, 0, res.stderr);
    const payload = JSON.parse(res.stdout);

    assert.equal(payload.ok, false);
    assert.equal(payload.error, 'config_missing');
    assert.equal(payload.path, join(tmp, 'apps', 'dashboard', '.impeccable', 'live', 'config.json'));
    assert.equal(payload.projectRoot, join(tmp, 'apps', 'dashboard'));
  });

  it('boots live from the child project and inherits root context when child files are missing', async () => {
    writeChildLiveConfig(tmp);

    const payload = bootLive(tmp);
    try {
      assert.equal(payload.ok, true);
      assert.equal(payload.targetPath, TARGET);
      assert.equal(payload.projectRoot, join(tmp, 'apps', 'dashboard'));
      assert.equal(payload.repoRoot, tmp);
      assert.equal(payload.productPath, 'PRODUCT.md');
      assert.equal(payload.designPath, 'DESIGN.md');
      assert.match(payload.product, /ROOT PRODUCT LIVE INHERIT/);
      assert.match(payload.design, /ROOT DESIGN LIVE INHERIT/);
      assert.deepEqual(payload.pageFiles, ['public/index.html']);
      assert.equal(payload.liveConfigPath, join(tmp, 'apps', 'dashboard', '.impeccable', 'live', 'config.json'));

      assert.equal(existsSync(join(tmp, 'apps', 'dashboard', '.impeccable', 'live', 'server.json')), true);
      assert.equal(existsSync(join(tmp, '.impeccable', 'live', 'server.json')), false);

      const raw = await fetchDesignRaw(payload);
      assert.match(raw, /ROOT DESIGN LIVE INHERIT/);
    } finally {
      stopLive(tmp);
    }
  });

  it('boots live with child PRODUCT.md override and inherited root DESIGN.md', async () => {
    writeChildLiveConfig(tmp);
    write(tmp, 'apps/dashboard/PRODUCT.md', '# DASHBOARD PRODUCT LIVE OVERRIDE\n');

    const payload = bootLive(tmp);
    try {
      assert.equal(payload.ok, true);
      assert.equal(payload.productPath, join('apps', 'dashboard', 'PRODUCT.md'));
      assert.equal(payload.designPath, 'DESIGN.md');
      assert.match(payload.product, /DASHBOARD PRODUCT LIVE OVERRIDE/);
      assert.match(payload.design, /ROOT DESIGN LIVE INHERIT/);

      const raw = await fetchDesignRaw(payload);
      assert.match(raw, /ROOT DESIGN LIVE INHERIT/);
      assert.doesNotMatch(raw, /DASHBOARD PRODUCT LIVE OVERRIDE/);
    } finally {
      stopLive(tmp);
    }
  });
});

function setupMonorepo(root) {
  run('git', ['init', '-q'], root);
  write(root, 'package.json', JSON.stringify({ private: true, workspaces: ['apps/*'] }, null, 2));
  write(root, 'turbo.json', JSON.stringify({ tasks: {} }, null, 2));
  write(root, 'PRODUCT.md', '# ROOT PRODUCT LIVE INHERIT\n');
  write(root, 'DESIGN.md', '# ROOT DESIGN LIVE INHERIT\n');
  write(root, 'apps/dashboard/src/App.jsx', 'export default function Dashboard() { return <main>Dashboard</main>; }\n');
  write(root, 'apps/dashboard/public/index.html', '<!doctype html><html><body><main>Dashboard</main></body></html>\n');
  write(root, 'apps/marketing/src/App.jsx', 'export default function Marketing() { return <main>Marketing</main>; }\n');
  write(root, 'apps/admin/src/App.jsx', 'export default function Admin() { return <main>Admin</main>; }\n');
}

function writeRootLiveConfig(root) {
  write(root, '.impeccable/live/config.json', JSON.stringify({
    files: ['public/root.html'],
    insertBefore: '</body>',
    commentSyntax: 'html',
  }, null, 2));
}

function writeChildLiveConfig(root) {
  write(root, 'apps/dashboard/.impeccable/live/config.json', JSON.stringify({
    files: ['public/index.html'],
    insertBefore: '</body>',
    commentSyntax: 'html',
  }, null, 2));
}

function bootLive(root) {
  const res = runNode(LIVE_SCRIPT, ['--target', TARGET], root);
  assert.equal(res.status, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

async function fetchDesignRaw(payload) {
  const res = await fetch(`http://localhost:${payload.serverPort}/design-system/raw?token=${payload.serverToken}`);
  assert.equal(res.status, 200);
  return res.text();
}

function stopLive(root) {
  runNode(LIVE_SERVER_SCRIPT, ['stop', '--keep-inject', '--target', TARGET], root);
}

function runNode(script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 30_000,
  });
}

function run(command, args, cwd) {
  const res = spawnSync(command, args, { cwd, encoding: 'utf-8' });
  assert.equal(res.status, 0, `${command} ${args.join(' ')}\n${res.stderr}`);
  return res;
}

function write(root, rel, body) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}
