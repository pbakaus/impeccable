import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const LIVE_SCRIPT = join(REPO_ROOT, 'skill', 'scripts', 'live.mjs');
const LIVE_POLL_SCRIPT = join(REPO_ROOT, 'skill', 'scripts', 'live-poll.mjs');
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

    const res = runNode(LIVE_SCRIPT, ['--target', TARGET], tmp);
    assert.equal(res.status, 0, res.stderr);
    const payload = JSON.parse(res.stdout);

    assert.equal(payload.ok, false);
    assert.equal(payload.error, 'config_missing');
    assert.equal(payload.path, join(tmp, 'apps', 'dashboard', '.impeccable', 'live', 'config.json'));
    assert.equal(payload.projectRoot, join(tmp, 'apps', 'dashboard'));
    assert.equal(payload.repoRoot, tmp);
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

  it('continues the live lifecycle from the projectRoot returned by --target', () => {
    writeChildLiveConfig(tmp);

    const payload = bootLive(tmp);
    try {
      assert.equal(payload.ok, true);
      assert.equal(payload.projectRoot, join(tmp, 'apps', 'dashboard'));

      const poll = runNode(LIVE_POLL_SCRIPT, ['--timeout=50'], payload.projectRoot);
      assert.equal(poll.status, 0, `stdout:\n${poll.stdout}\nstderr:\n${poll.stderr}`);
      assert.deepEqual(JSON.parse(poll.stdout), { type: 'timeout' });

      const stop = runNode(LIVE_SERVER_SCRIPT, ['stop', '--keep-inject'], payload.projectRoot);
      assert.equal(stop.status, 0, `stdout:\n${stop.stdout}\nstderr:\n${stop.stderr}`);
      assert.match(stop.stdout, /Stopped live server/);
    } finally {
      stopLive(tmp);
    }
  });

  it('boots live from the child cwd without --target after the app is selected', async () => {
    writeChildLiveConfig(tmp);

    const childRoot = join(tmp, 'apps', 'dashboard');
    const res = runNode(LIVE_SCRIPT, [], childRoot);
    assert.equal(res.status, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
    const payload = JSON.parse(res.stdout);
    try {
      assert.equal(payload.ok, true);
      assert.equal(payload.targetPath, null);
      assert.equal(payload.projectRoot, childRoot);
      assert.equal(payload.repoRoot, tmp);
      assert.equal(payload.productPath, join('..', '..', 'PRODUCT.md'));
      assert.equal(payload.designPath, join('..', '..', 'DESIGN.md'));
      assert.match(payload.product, /ROOT PRODUCT LIVE INHERIT/);
      assert.match(payload.design, /ROOT DESIGN LIVE INHERIT/);
      assert.equal(payload.liveConfigPath, join(childRoot, '.impeccable', 'live', 'config.json'));
      assert.equal(existsSync(join(childRoot, '.impeccable', 'live', 'server.json')), true);
      assert.equal(existsSync(join(tmp, '.impeccable', 'live', 'server.json')), false);
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

  it('blocks live before server start when PRODUCT.md is missing everywhere', () => {
    rmSync(join(tmp, 'PRODUCT.md'), { force: true });
    writeChildLiveConfig(tmp);

    const payload = runLiveContextMissing(tmp);

    assert.deepEqual(payload.missing, ['PRODUCT.md']);
    assert.equal(payload.nextCommand, 'init');
    assert.equal(payload.projectRoot, join(tmp, 'apps', 'dashboard'));
    assert.equal(payload.repoRoot, tmp);
    assert.equal(payload.productPath, null);
    assert.equal(payload.designPath, 'DESIGN.md');
    assertNoLiveBootSideEffects(tmp);
  });

  it('blocks live before server start when DESIGN.md is missing everywhere', () => {
    rmSync(join(tmp, 'DESIGN.md'), { force: true });
    writeChildLiveConfig(tmp);

    const payload = runLiveContextMissing(tmp);

    assert.deepEqual(payload.missing, ['DESIGN.md']);
    assert.equal(payload.nextCommand, 'document');
    assert.equal(payload.projectRoot, join(tmp, 'apps', 'dashboard'));
    assert.equal(payload.repoRoot, tmp);
    assert.equal(payload.productPath, 'PRODUCT.md');
    assert.equal(payload.designPath, null);
    assertNoLiveBootSideEffects(tmp);
  });

  it('blocks live before server start with init first when both context files are missing', () => {
    rmSync(join(tmp, 'PRODUCT.md'), { force: true });
    rmSync(join(tmp, 'DESIGN.md'), { force: true });
    writeChildLiveConfig(tmp);

    const payload = runLiveContextMissing(tmp);

    assert.deepEqual(payload.missing, ['PRODUCT.md', 'DESIGN.md']);
    assert.equal(payload.nextCommand, 'init');
    assert.equal(payload.productPath, null);
    assert.equal(payload.designPath, null);
    assertNoLiveBootSideEffects(tmp);
  });

  it('asks for an app before starting live from a monorepo root', () => {
    writeRootLiveConfig(tmp);
    writeChildLiveConfig(tmp);
    write(tmp, 'apps/admin/PRODUCT.md', '# ADMIN PRODUCT LIVE\n');
    write(tmp, 'apps/admin/DESIGN.md', '# ADMIN DESIGN LIVE\n');
    write(tmp, 'apps/marketing/PRODUCT.md', '# MARKETING PRODUCT LIVE\n');

    const res = runNode(LIVE_SCRIPT, [], tmp);
    assert.equal(res.status, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
    const payload = JSON.parse(res.stdout);

    assert.equal(payload.ok, false);
    assert.equal(payload.error, 'target_selection_required');
    assert.equal(payload.repoRoot, tmp);
    assert.equal(payload.projectRoot, tmp);
    assert.deepEqual(payload.targetCandidates.map((candidate) => candidate.path), [
      'apps/admin',
      'apps/dashboard',
      'apps/marketing',
    ]);
    const byPath = Object.fromEntries(payload.targetCandidates.map((candidate) => [candidate.path, candidate]));
    assert.deepEqual(
      {
        productStatus: byPath['apps/admin'].productStatus,
        productPath: byPath['apps/admin'].productPath,
        designStatus: byPath['apps/admin'].designStatus,
        designPath: byPath['apps/admin'].designPath,
      },
      {
        productStatus: 'child',
        productPath: 'apps/admin/PRODUCT.md',
        designStatus: 'child',
        designPath: 'apps/admin/DESIGN.md',
      },
    );
    assert.deepEqual(
      {
        productStatus: byPath['apps/dashboard'].productStatus,
        productPath: byPath['apps/dashboard'].productPath,
        designStatus: byPath['apps/dashboard'].designStatus,
        designPath: byPath['apps/dashboard'].designPath,
      },
      {
        productStatus: 'inherited',
        productPath: 'PRODUCT.md',
        designStatus: 'inherited',
        designPath: 'DESIGN.md',
      },
    );
    assert.deepEqual(
      {
        productStatus: byPath['apps/marketing'].productStatus,
        productPath: byPath['apps/marketing'].productPath,
        designStatus: byPath['apps/marketing'].designStatus,
        designPath: byPath['apps/marketing'].designPath,
      },
      {
        productStatus: 'child',
        productPath: 'apps/marketing/PRODUCT.md',
        designStatus: 'inherited',
        designPath: 'DESIGN.md',
      },
    );
    assert.equal(existsSync(join(tmp, '.impeccable', 'live', 'server.json')), false);
    assert.equal(existsSync(join(tmp, 'apps', 'dashboard', '.impeccable', 'live', 'server.json')), false);
    assert.doesNotMatch(readFileSync(join(tmp, 'public', 'root.html'), 'utf-8'), /live\.js/);
    assert.doesNotMatch(readFileSync(join(tmp, 'apps', 'dashboard', 'public', 'index.html'), 'utf-8'), /live\.js/);
  });

});

describe('live single-repo context setup guard', () => {
  let tmp;

  beforeEach(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-live-single-')));
  });

  afterEach(() => {
    runNode(LIVE_SERVER_SCRIPT, ['stop', '--keep-inject'], tmp);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('starts live without app selection when PRODUCT.md and DESIGN.md exist', () => {
    setupSingleRepo(tmp);

    const res = runNode(LIVE_SCRIPT, [], tmp);
    assert.equal(res.status, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
    const payload = JSON.parse(res.stdout);
    try {
      assert.equal(payload.ok, true);
      assert.equal(payload.targetPath, null);
      assert.equal(payload.projectRoot, tmp);
      assert.equal(payload.repoRoot, tmp);
      assert.equal(payload.productPath, 'PRODUCT.md');
      assert.equal(payload.designPath, 'DESIGN.md');
      assert.match(payload.product, /SINGLE PRODUCT/);
      assert.match(payload.design, /SINGLE DESIGN/);
      assert.equal(existsSync(join(tmp, '.impeccable', 'live', 'server.json')), true);
    } finally {
      runNode(LIVE_SERVER_SCRIPT, ['stop', '--keep-inject'], tmp);
    }
  });

  it('routes missing PRODUCT.md to init without app selection', () => {
    setupSingleRepo(tmp, { product: false, design: true });

    const payload = runSingleRepoMissingContext(tmp);

    assert.deepEqual(payload.missing, ['PRODUCT.md']);
    assert.equal(payload.nextCommand, 'init');
    assert.equal(payload.productPath, null);
    assert.equal(payload.designPath, 'DESIGN.md');
    assertNoSingleRepoLiveBootSideEffects(tmp);
  });

  it('routes missing DESIGN.md to document without app selection', () => {
    setupSingleRepo(tmp, { product: true, design: false });

    const payload = runSingleRepoMissingContext(tmp);

    assert.deepEqual(payload.missing, ['DESIGN.md']);
    assert.equal(payload.nextCommand, 'document');
    assert.equal(payload.productPath, 'PRODUCT.md');
    assert.equal(payload.designPath, null);
    assertNoSingleRepoLiveBootSideEffects(tmp);
  });

  it('routes missing PRODUCT.md and DESIGN.md to init first without app selection', () => {
    setupSingleRepo(tmp, { product: false, design: false });

    const payload = runSingleRepoMissingContext(tmp);

    assert.deepEqual(payload.missing, ['PRODUCT.md', 'DESIGN.md']);
    assert.equal(payload.nextCommand, 'init');
    assert.equal(payload.productPath, null);
    assert.equal(payload.designPath, null);
    assertNoSingleRepoLiveBootSideEffects(tmp);
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

function setupSingleRepo(root, { product = true, design = true } = {}) {
  run('git', ['init', '-q'], root);
  write(root, 'package.json', JSON.stringify({ private: true, name: 'single-app' }, null, 2));
  if (product) write(root, 'PRODUCT.md', '# SINGLE PRODUCT\n');
  if (design) write(root, 'DESIGN.md', '# SINGLE DESIGN\n');
  write(root, 'public/index.html', '<!doctype html><html><body><main>Single</main></body></html>\n');
  write(root, '.impeccable/live/config.json', JSON.stringify({
    files: ['public/index.html'],
    insertBefore: '</body>',
    commentSyntax: 'html',
  }, null, 2));
}

function writeRootLiveConfig(root) {
  write(root, '.impeccable/live/config.json', JSON.stringify({
    files: ['public/root.html'],
    insertBefore: '</body>',
    commentSyntax: 'html',
  }, null, 2));
  write(root, 'public/root.html', '<!doctype html><html><body><main>Root</main></body></html>\n');
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

function runLiveContextMissing(root) {
  const res = runNode(LIVE_SCRIPT, ['--target', TARGET], root);
  assert.equal(res.status, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'context_missing');
  assert.equal(payload.targetPath, TARGET);
  return payload;
}

function runSingleRepoMissingContext(root) {
  const res = runNode(LIVE_SCRIPT, [], root);
  assert.equal(res.status, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'context_missing');
  assert.equal(payload.targetPath, null);
  assert.notEqual(payload.error, 'target_selection_required');
  return payload;
}

function assertNoLiveBootSideEffects(root) {
  assert.equal(existsSync(join(root, 'apps', 'dashboard', '.impeccable', 'live', 'server.json')), false);
  assert.equal(existsSync(join(root, '.impeccable', 'live', 'server.json')), false);
  assert.doesNotMatch(readFileSync(join(root, 'apps', 'dashboard', 'public', 'index.html'), 'utf-8'), /live\.js/);
}

function assertNoSingleRepoLiveBootSideEffects(root) {
  assert.equal(existsSync(join(root, '.impeccable', 'live', 'server.json')), false);
  assert.doesNotMatch(readFileSync(join(root, 'public', 'index.html'), 'utf-8'), /live\.js/);
}

async function fetchDesignRaw(payload) {
  const res = await fetch(`http://localhost:${payload.serverPort}/design-system/raw?token=${payload.serverToken}`);
  assert.equal(res.status, 200);
  return res.text();
}

function stopLive(root) {
  runNode(LIVE_SERVER_SCRIPT, ['stop', '--keep-inject'], join(root, 'apps', 'dashboard'));
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
