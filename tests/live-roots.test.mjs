import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  consumeTargetArg,
  discoverAppCandidates,
  findGitRoot,
  resolveLiveRoots,
  resolveRoots,
  writeRootsManifest,
} from '../skill/scripts/live/roots.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOTS_MODULE = join(__dirname, '..', 'skill', 'scripts', 'live', 'roots.mjs');

function write(root, rel, content = '') {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

describe('live roots resolution', () => {
  let tmp;

  beforeEach(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-roots-')));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function setupPlainNestedApp() {
    // The agent-reviews shape: a git repo whose root is a CLI package (no dev
    // config, no workspaces) with the served app nested in website/.
    mkdirSync(join(tmp, '.git'), { recursive: true });
    write(tmp, 'package.json', JSON.stringify({ name: 'cli-package' }));
    write(tmp, 'PRODUCT.md', '# product');
    write(tmp, 'DESIGN.md', '# design');
    write(tmp, 'website/package.json', JSON.stringify({ name: 'website' }));
    write(tmp, 'website/svelte.config.js', 'export default {};');
    write(tmp, 'website/vite.config.js', 'export default {};');
    write(tmp, 'website/src/routes/+page.svelte', '<h1>hi</h1>');
  }

  it('roots a targeted file at the nested app, context at the git root', () => {
    setupPlainNestedApp();
    const { manifest } = resolveRoots({
      cwd: tmp,
      targetPath: join(tmp, 'website/src/routes/+page.svelte'),
    });
    assert.equal(manifest.appRoot, join(tmp, 'website'));
    assert.equal(manifest.repoRoot, tmp);
    assert.equal(manifest.contextRoot, tmp);
    assert.equal(manifest.productPath, join(tmp, 'PRODUCT.md'));
    assert.equal(manifest.designPath, join(tmp, 'DESIGN.md'));
    assert.equal(manifest.sessionRoot, join(tmp, 'website', '.impeccable', 'live'));
  });

  it('auto-picks a single nested app when booted from the repo root without a target', () => {
    setupPlainNestedApp();
    const { manifest, selection } = resolveRoots({ cwd: tmp });
    assert.equal(selection, undefined);
    assert.equal(manifest.appRoot, join(tmp, 'website'));
    assert.match(manifest.resolvedFrom, /^candidate:/);
  });

  it('asks for a selection when several nested apps exist', () => {
    setupPlainNestedApp();
    write(tmp, 'admin/package.json', JSON.stringify({ name: 'admin' }));
    write(tmp, 'admin/vite.config.ts', 'export default {};');
    const { manifest, selection } = resolveRoots({ cwd: tmp });
    assert.equal(manifest, undefined);
    assert.equal(selection.candidates.length, 2);
    assert.deepEqual(selection.candidates.map((c) => c.name).sort(), ['admin', 'website']);
  });

  it('resolves context files independently across levels', () => {
    setupPlainNestedApp();
    rmSync(join(tmp, 'DESIGN.md'));
    write(tmp, 'website/DESIGN.md', '# child design');
    const { manifest } = resolveRoots({
      cwd: tmp,
      targetPath: join(tmp, 'website/src/routes/+page.svelte'),
    });
    assert.equal(manifest.designPath, join(tmp, 'website', 'DESIGN.md'));
    assert.equal(manifest.productPath, join(tmp, 'PRODUCT.md'));
  });

  it('treats a live-configured directory as an app root without a dev config', () => {
    mkdirSync(join(tmp, '.git'), { recursive: true });
    write(tmp, 'site/.impeccable/live/config.json', '{"files":["index.html"]}');
    write(tmp, 'site/index.html', '<html></html>');
    const { manifest } = resolveRoots({ cwd: tmp, targetPath: join(tmp, 'site/index.html') });
    assert.equal(manifest.appRoot, join(tmp, 'site'));
  });

  it('stays at cwd when no app markers exist anywhere', () => {
    write(tmp, 'notes.txt', 'nothing here');
    const { manifest } = resolveRoots({ cwd: tmp });
    assert.equal(manifest.appRoot, tmp);
    assert.equal(manifest.repoRoot, tmp);
    assert.equal(manifest.resolvedFrom, 'fallback');
  });

  it('does not ascend above cwd without a git boundary', () => {
    write(tmp, 'vite.config.js', 'export default {};');
    const nested = join(tmp, 'deep', 'inner');
    mkdirSync(nested, { recursive: true });
    const { manifest } = resolveRoots({ cwd: nested });
    // tmp has a dev config but there is no git root, so the walk must not
    // climb out of the starting directory.
    assert.equal(manifest.appRoot, nested);
  });

  it('persists a manifest and finds it again from anywhere in the repo', () => {
    setupPlainNestedApp();
    const { manifest } = resolveRoots({
      cwd: tmp,
      targetPath: join(tmp, 'website/src/routes/+page.svelte'),
    });
    writeRootsManifest(manifest);

    // From deep inside the app: found by upward walk.
    const fromApp = resolveLiveRoots(join(tmp, 'website/src/routes'));
    assert.equal(fromApp.source, 'persisted');
    assert.equal(fromApp.manifest.appRoot, join(tmp, 'website'));

    // From the repo root: found via the pointer.
    const fromRepo = resolveLiveRoots(tmp);
    assert.equal(fromRepo.source, 'pointer');
    assert.equal(fromRepo.manifest.appRoot, join(tmp, 'website'));
  });

  it('ignores a stale manifest that claims a different appRoot', () => {
    setupPlainNestedApp();
    write(tmp, 'website/.impeccable/live/roots.json', JSON.stringify({
      version: 1,
      appRoot: join(tmp, 'elsewhere'),
    }));
    const res = resolveLiveRoots(join(tmp, 'website'));
    assert.equal(res.source, 'fresh');
    assert.equal(res.manifest.appRoot, join(tmp, 'website'));
  });

  it('finds the git root through intermediate directories', () => {
    mkdirSync(join(tmp, '.git'), { recursive: true });
    const deep = join(tmp, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    assert.equal(findGitRoot(deep), tmp);
  });

  it('discovers app candidates below common monorepo layouts', () => {
    mkdirSync(join(tmp, '.git'), { recursive: true });
    write(tmp, 'apps/web/next.config.js', 'module.exports = {};');
    write(tmp, 'apps/api/package.json', '{"name":"api"}');
    write(tmp, 'packages/ui/package.json', '{"name":"ui"}');
    const candidates = discoverAppCandidates(tmp);
    assert.deepEqual(candidates, [join(tmp, 'apps', 'web')]);
  });

  it('enterLiveRoot moves a process onto the persisted appRoot', () => {
    setupPlainNestedApp();
    const { manifest } = resolveRoots({
      cwd: tmp,
      targetPath: join(tmp, 'website/src/routes/+page.svelte'),
    });
    writeRootsManifest(manifest);
    const res = spawnSync(process.execPath, [
      '-e',
      `import(${JSON.stringify(ROOTS_MODULE)}).then((m) => { m.enterLiveRoot(); console.log(process.cwd()); });`,
    ], { cwd: tmp, encoding: 'utf-8' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(realpathSync(res.stdout.trim()), join(tmp, 'website'));
  });
});

describe('review regressions: walk bounds', () => {
  it('does not climb past a target outside the cwd git repo (m5)', () => {
    const outer = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-roots-outer-')));
    try {
      mkdirSync(join(outer, 'repo', '.git'), { recursive: true });
      writeFileSync(join(outer, 'vite.config.js'), 'export default {};');
      const loose = join(outer, 'loose', 'inner', 'sub');
      mkdirSync(loose, { recursive: true });
      const { manifest } = resolveRoots({ cwd: join(outer, 'repo'), targetPath: loose });
      // The dev config at `outer` sits above the target's own tree with no
      // git boundary; the walk must not adopt it.
      assert.notEqual(manifest.appRoot, outer);
      assert.equal(manifest.appRoot, loose);
    } finally {
      rmSync(outer, { recursive: true, force: true });
    }
  });
});

describe('review regressions: multi-app pointer', () => {
  it('prefers the app whose live server is running over the last boot', async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-roots-multi-')));
    try {
      mkdirSync(join(repo, '.git'), { recursive: true });
      for (const name of ['siteA', 'siteB']) {
        write(repo, `${name}/vite.config.js`, 'export default {};');
        write(repo, `${name}/package.json`, `{"name":"${name}"}`);
      }
      const a = resolveRoots({ cwd: repo, targetPath: join(repo, 'siteA/vite.config.js') }).manifest;
      const b = resolveRoots({ cwd: repo, targetPath: join(repo, 'siteB/vite.config.js') }).manifest;
      writeRootsManifest(a);
      writeRootsManifest(b); // B booted last: a naive pointer now points at B

      // A's helper server is the one alive: an authenticated /status
      // responder on a real port, hosted in a CHILD process because the
      // probe is execFileSync and a same-process responder could never
      // accept while the event loop is blocked (production helpers are
      // always separate processes).
      const responder = spawn(process.execPath, ['-e', [
        "const s = require('node:http').createServer((q, r) => {",
        "  const ok = q.url === '/status?token=t';",
        "  r.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });",
        "  r.end('{}');",
        "});",
        "s.listen(0, '127.0.0.1', () => console.log(s.address().port));",
      ].join('\n')], { stdio: ['ignore', 'pipe', 'ignore'] });
      const livePort = await new Promise((resolve, reject) => {
        responder.stdout.once('data', (chunk) => resolve(Number(String(chunk).trim())));
        responder.once('error', reject);
        setTimeout(() => reject(new Error('responder never became ready')), 5000);
      });
      try {
        // server.json records the RESPONDER's own pid (process that actually
        // listens): the identity probe asserts pid liveness AND authenticated
        // /status from the same process, so the pid must match the listener.
        write(repo, 'siteA/.impeccable/live/server.json', JSON.stringify({ pid: responder.pid, port: livePort, token: 't' }));
        write(repo, 'siteB/.impeccable/live/server.json', JSON.stringify({ pid: 999999999, port: 2, token: 't' }));

        const resolved = resolveLiveRoots(repo);
        assert.equal(resolved.source, 'pointer');
        assert.equal(resolved.manifest.appRoot, join(repo, 'siteA'));
      } finally {
        responder.kill();
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('reads a legacy single-value pointer', () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-roots-legacy-')));
    try {
      mkdirSync(join(repo, '.git'), { recursive: true });
      write(repo, 'app/vite.config.js', 'export default {};');
      const m = resolveRoots({ cwd: repo, targetPath: join(repo, 'app/vite.config.js') }).manifest;
      // Write the manifest, then downgrade the pointer to the v1 shape.
      writeRootsManifest(m);
      write(repo, '.impeccable/live/app-root.json', JSON.stringify({ appRoot: join(repo, 'app') }));
      const resolved = resolveLiveRoots(repo);
      assert.equal(resolved.manifest.appRoot, join(repo, 'app'));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('review regressions: stopped-session recovery', () => {
  it('prefers the app with an active durable session when no server is alive', () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-roots-stopped-')));
    try {
      mkdirSync(join(repo, '.git'), { recursive: true });
      for (const name of ['siteA', 'siteB']) {
        write(repo, `${name}/vite.config.js`, 'export default {};');
      }
      const a = resolveRoots({ cwd: repo, targetPath: join(repo, 'siteA/vite.config.js') }).manifest;
      const b = resolveRoots({ cwd: repo, targetPath: join(repo, 'siteB/vite.config.js') }).manifest;
      writeRootsManifest(a);
      writeRootsManifest(b); // B booted last; both servers are stopped.

      // A holds the interrupted session the user wants to recover.
      write(repo, 'siteA/.impeccable/live/sessions/ab12cd34.snapshot.json',
        JSON.stringify({ id: 'ab12cd34', phase: 'variants_ready' }));
      write(repo, 'siteB/.impeccable/live/sessions/ff00ff00.snapshot.json',
        JSON.stringify({ id: 'ff00ff00', phase: 'completed' }));

      const resolved = resolveLiveRoots(repo);
      assert.equal(resolved.source, 'pointer');
      assert.equal(resolved.manifest.appRoot, join(repo, 'siteA'));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('review regressions: helper --target', () => {
  it('enterLiveRoot honors --target and strips it from argv', () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-roots-target-')));
    try {
      mkdirSync(join(repo, '.git'), { recursive: true });
      for (const name of ['appA', 'appB']) {
        write(repo, `${name}/vite.config.js`, 'export default {};');
      }
      const a = resolveRoots({ cwd: repo, targetPath: join(repo, 'appA/vite.config.js') }).manifest;
      const b = resolveRoots({ cwd: repo, targetPath: join(repo, 'appB/vite.config.js') }).manifest;
      writeRootsManifest(a);
      writeRootsManifest(b);
      // Both alive: pointer resolution alone is ambiguous (A? B?); --target
      // must decide, and downstream flag parsing must not see the tokens.
      write(repo, 'appA/.impeccable/live/server.json', JSON.stringify({ pid: process.pid, port: 1, token: 't' }));
      write(repo, 'appB/.impeccable/live/server.json', JSON.stringify({ pid: process.pid, port: 2, token: 't' }));

      const res = spawnSync(process.execPath, [
        '-e',
        `import(${JSON.stringify(ROOTS_MODULE)}).then((m) => {
          process.argv.push('--target', ${JSON.stringify(join(repo, 'appB'))});
          m.enterLiveRoot();
          console.log(JSON.stringify({ cwd: process.cwd(), argvHasTarget: process.argv.includes('--target') }));
        });`,
      ], { cwd: repo, encoding: 'utf-8' });
      assert.equal(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout.trim().split('\n').pop());
      assert.equal(realpathSync(out.cwd), join(repo, 'appB'));
      assert.equal(out.argvHasTarget, false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('rejects a --target with no usable value instead of falling back to implicit selection', () => {
    for (const argv of [
      ['node', 'live-complete.mjs', '--target'],
      ['node', 'live-complete.mjs', '--target='],
      ['node', 'live-complete.mjs', '--target', '--id'],
    ]) {
      assert.throws(() => consumeTargetArg([...argv]), /--target requires a path value/);
    }
    // Well-formed values still parse and are consumed.
    const argv = ['node', 'live-complete.mjs', '--target', 'appB', '--id', 'x'];
    assert.equal(consumeTargetArg(argv), 'appB');
    assert.deepEqual(argv, ['node', 'live-complete.mjs', '--id', 'x']);
  });

  it('enterLiveRoot exits with an error on a valueless --target rather than picking an app', () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-roots-target-bad-')));
    try {
      mkdirSync(join(repo, '.git'), { recursive: true });
      write(repo, 'appA/vite.config.js', 'export default {};');
      const a = resolveRoots({ cwd: repo, targetPath: join(repo, 'appA/vite.config.js') }).manifest;
      writeRootsManifest(a);
      write(repo, 'appA/.impeccable/live/server.json', JSON.stringify({ pid: process.pid, port: 1, token: 't' }));

      const res = spawnSync(process.execPath, [
        '-e',
        `import(${JSON.stringify(ROOTS_MODULE)}).then((m) => {
          process.argv.push('--target');
          m.enterLiveRoot();
          console.log('reached:' + process.cwd());
        });`,
      ], { cwd: repo, encoding: 'utf-8' });
      assert.notEqual(res.status, 0, 'malformed --target must not proceed');
      assert.match(res.stderr, /--target requires a path value/);
      assert.doesNotMatch(res.stdout, /reached:/, 'helper body must not run');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('review regressions: pid reuse', () => {
  it('does not classify a non-node process reusing the recorded pid as a live server', () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-roots-pidreuse-')));
    try {
      mkdirSync(join(repo, '.git'), { recursive: true });
      for (const name of ['appA', 'appB']) {
        write(repo, `${name}/vite.config.js`, 'export default {};');
      }
      const a = resolveRoots({ cwd: repo, targetPath: join(repo, 'appA/vite.config.js') }).manifest;
      const b = resolveRoots({ cwd: repo, targetPath: join(repo, 'appB/vite.config.js') }).manifest;
      writeRootsManifest(a);
      writeRootsManifest(b); // B booted last.

      // B's helper died; its pid was reused by a non-node process (launchd /
      // init: pid 1 is alive on every unix and is never a node process).
      write(repo, 'siteB-unused.txt', '');
      write(repo, 'appB/.impeccable/live/server.json', JSON.stringify({ pid: 1, port: 2, token: 't' }));
      // A holds the interrupted session the user is recovering.
      write(repo, 'appA/.impeccable/live/sessions/aa11bb22.snapshot.json',
        JSON.stringify({ id: 'aa11bb22', phase: 'variants_ready' }));

      const resolved = resolveLiveRoots(repo);
      assert.equal(resolved.manifest.appRoot, join(repo, 'appA'));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('review regressions: discovery parity', () => {
  it('discovers a live-configured static site with no bundler markers', () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-roots-static-')));
    try {
      mkdirSync(join(repo, '.git'), { recursive: true });
      write(repo, 'package.json', '{"name":"cli"}');
      write(repo, 'docs-site/.impeccable/live/config.json', '{"files":["index.html"]}');
      write(repo, 'docs-site/index.html', '<html></html>');
      const { manifest, selection } = resolveRoots({ cwd: repo });
      assert.equal(selection, undefined);
      assert.equal(manifest.appRoot, join(repo, 'docs-site'));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
