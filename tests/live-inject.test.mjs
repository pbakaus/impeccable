/**
 * Tests for live-inject.mjs — script-tag insert/remove round-trip.
 * Run with: node --test tests/live-inject.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { livePathGlobToRegex } from '../skill/scripts/lib/live-path-globs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INJECT = resolve(__dirname, '..', 'skill/scripts/live-inject.mjs');

describe('live path globs', () => {
  it('matches recursive segments, including zero segments', () => {
    const anywhere = livePathGlobToRegex('**/index.html');
    assert.equal(anywhere.test('index.html'), true);
    assert.equal(anywhere.test('public/index.html'), true);
    assert.equal(anywhere.test('apps/web/public/index.html'), true);

    const underPublic = livePathGlobToRegex('public/**/*.html');
    assert.equal(underPublic.test('public/index.html'), true);
    assert.equal(underPublic.test('public/docs/index.html'), true);
    assert.equal(underPublic.test('src/index.html'), false);
  });

  it('keeps single-star and question-mark matches inside one segment', () => {
    const pattern = livePathGlobToRegex('pages/*/item?.html');
    assert.equal(pattern.test('pages/docs/item1.html'), true);
    assert.equal(pattern.test('pages/docs/deep/item1.html'), false);
    assert.equal(pattern.test('pages/docs/item12.html'), false);
  });

  it('treats regular-expression punctuation as literal path text', () => {
    const pattern = livePathGlobToRegex('pages/[draft]/item+.html');
    assert.equal(pattern.test('pages/[draft]/item+.html'), true);
    assert.equal(pattern.test('pages/d/itemm.html'), false);
  });
});

function runInject(cwd, configPath, args) {
  try {
    const out = execFileSync('node', [INJECT, ...args], {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, IMPECCABLE_LIVE_CONFIG: configPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out.trim());
  } catch (err) {
    const body = err.stdout?.toString().trim() || err.stderr?.toString().trim() || '';
    return JSON.parse(body || '{}');
  }
}

function runInjectDefault(cwd, args) {
  try {
    const out = execFileSync('node', [INJECT, ...args], {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, IMPECCABLE_LIVE_CONFIG: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out.trim());
  } catch (err) {
    const body = err.stdout?.toString().trim() || err.stderr?.toString().trim() || '';
    return JSON.parse(body || '{}');
  }
}

describe('live-inject — insert/remove round-trip preserves file bytes', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'impeccable-inject-test-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('reports .impeccable/live/config.json as the default missing config path', () => {
    const result = runInjectDefault(tmp, ['--check']);

    assert.equal(result.ok, false);
    assert.equal(result.error, 'config_missing');
    assert.equal(result.path, join(realpathSync(tmp), '.impeccable', 'live', 'config.json'));
  });

  it('uses .impeccable/live/config.json without an environment override', () => {
    const original = `<html>
  <body>
    <p>Content</p>
  </body>
</html>
`;
    writeFileSync(join(tmp, 'index.html'), original);
    const configDir = join(tmp, '.impeccable', 'live');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      files: ['index.html'],
      insertBefore: '</body>',
      commentSyntax: 'html',
    }));

    const inserted = runInjectDefault(tmp, ['--port', '8400']);
    assert.equal(inserted.ok, true);
    assert.match(readFileSync(join(tmp, 'index.html'), 'utf-8'), /localhost:8400\/live\.js/);

    const removed = runInjectDefault(tmp, ['--remove']);
    assert.equal(removed.ok, true);
    assert.equal(readFileSync(join(tmp, 'index.html'), 'utf-8'), original);
  });

  it('round-trips an HTML file without mangling indentation', () => {
    const original = `<!DOCTYPE html>
<html>
  <head><title>Test</title></head>
  <body>
    <main>
      <h1>Hello</h1>
    </main>
  </body>
</html>
`;
    const file = join(tmp, 'index.html');
    writeFileSync(file, original);

    const config = {
      files: ['index.html'],
      insertBefore: '</body>',
      commentSyntax: 'html',
    };
    const cfgPath = join(tmp, 'config.json');
    writeFileSync(cfgPath, JSON.stringify(config));

    runInject(tmp, cfgPath, ['--port', '8400']);
    runInject(tmp, cfgPath, ['--remove']);

    const after = readFileSync(file, 'utf-8');
    assert.equal(after, original, 'file should match original byte-for-byte after insert/remove');
  });

  it('round-trips a JSX layout without mangling indentation', () => {
    // Matches the EAC shape: indented </body> inside a typed RootLayout return.
    const original = `export default async function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
`;
    const file = join(tmp, 'layout.tsx');
    writeFileSync(file, original);

    const config = {
      files: ['layout.tsx'],
      insertBefore: '</body>',
      commentSyntax: 'jsx',
    };
    const cfgPath = join(tmp, 'config.json');
    writeFileSync(cfgPath, JSON.stringify(config));

    runInject(tmp, cfgPath, ['--port', '8400']);
    runInject(tmp, cfgPath, ['--remove']);

    const after = readFileSync(file, 'utf-8');
    assert.equal(after, original, 'JSX file should match original byte-for-byte after insert/remove');
  });

  it('round-trips multiple files at once', () => {
    const originals = {
      'a.html': `<html>
  <body>
    <p>A</p>
  </body>
</html>
`,
      'b.html': `<html>
  <body>
    <p>B</p>
  </body>
</html>
`,
    };
    for (const [name, body] of Object.entries(originals)) {
      writeFileSync(join(tmp, name), body);
    }
    const cfgPath = join(tmp, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({
      files: ['a.html', 'b.html'],
      insertBefore: '</body>',
      commentSyntax: 'html',
    }));

    runInject(tmp, cfgPath, ['--port', '8400']);
    runInject(tmp, cfgPath, ['--remove']);

    for (const [name, body] of Object.entries(originals)) {
      const after = readFileSync(join(tmp, name), 'utf-8');
      assert.equal(after, body, `${name} should match original byte-for-byte after insert/remove`);
    }
  });

  it('round-trips with insertAfter — preserves indented opener line below it', () => {
    const original = `<!DOCTYPE html>
<html>
  <head>
    <title>Test</title>
  </head>
  <body>
    <main>
      <h1>Hello</h1>
    </main>
  </body>
</html>
`;
    const file = join(tmp, 'index.html');
    writeFileSync(file, original);

    const cfgPath = join(tmp, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({
      files: ['index.html'],
      insertAfter: '<head>',
      commentSyntax: 'html',
    }));

    runInject(tmp, cfgPath, ['--port', '8400']);
    runInject(tmp, cfgPath, ['--remove']);

    const after = readFileSync(file, 'utf-8');
    assert.equal(after, original, 'insertAfter round-trip must restore original byte-for-byte');
  });

  it('round-trips through CSP-meta patch and revert (insert mutates the meta tag, remove restores it)', () => {
    // Mirrors a Vite app that ships a CSP meta tag in index.html. live-inject
    // appends `http://localhost:PORT` to script-src / connect-src on insert
    // and stashes the original directives in `data-impeccable-csp-original`.
    // --remove must restore the meta tag's original `content` exactly.
    const original = `<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'self';" />
    <title>CSP test</title>
  </head>
  <body>
    <main>
      <h1>Hello</h1>
    </main>
  </body>
</html>
`;
    const file = join(tmp, 'index.html');
    writeFileSync(file, original);

    const cfgPath = join(tmp, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({
      files: ['index.html'],
      insertBefore: '</body>',
      commentSyntax: 'html',
    }));

    runInject(tmp, cfgPath, ['--port', '8400']);
    runInject(tmp, cfgPath, ['--remove']);

    const after = readFileSync(file, 'utf-8');
    assert.equal(after, original, 'CSP meta tag must round-trip exactly through insert+remove');
  });

  it('emits is:inline on script tag for .astro files (Astro otherwise rewrites src) and round-trips', () => {
    const original = `---
const title = 'Test';
---
<html>
  <body>
    <h1>{title}</h1>
  </body>
</html>
`;
    const file = join(tmp, 'Layout.astro');
    writeFileSync(file, original);

    const cfgPath = join(tmp, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({
      files: ['Layout.astro'],
      insertBefore: '</body>',
      commentSyntax: 'html',
    }));

    runInject(tmp, cfgPath, ['--port', '8400']);
    const afterInject = readFileSync(file, 'utf-8');
    assert.match(afterInject, /<script is:inline src="http:\/\/localhost:8400\/live\.js"><\/script>/, 'astro inject should carry is:inline');

    // Non-astro file with same config should NOT get is:inline
    const htmlFile = join(tmp, 'plain.html');
    writeFileSync(htmlFile, '<html><body><p>x</p></body></html>\n');
    writeFileSync(cfgPath, JSON.stringify({
      files: ['plain.html'],
      insertBefore: '</body>',
      commentSyntax: 'html',
    }));
    runInject(tmp, cfgPath, ['--port', '8400']);
    const afterHtml = readFileSync(htmlFile, 'utf-8');
    assert.doesNotMatch(afterHtml, /is:inline/, 'plain HTML must not get is:inline');

    // Round-trip remove for the astro file
    writeFileSync(cfgPath, JSON.stringify({
      files: ['Layout.astro'],
      insertBefore: '</body>',
      commentSyntax: 'html',
    }));
    runInject(tmp, cfgPath, ['--remove']);
    const afterRemove = readFileSync(file, 'utf-8');
    assert.equal(afterRemove, original, 'astro file should round-trip cleanly after remove');
  });

  it('normalizes stale bare live script blocks in .astro files', () => {
    const original = `---
const title = 'Test';
---
<html>
  <body>
    <h1>{title}</h1>
    <!-- impeccable-live-start -->
    <script src="http://localhost:8400/live.js"></script>
    <!-- impeccable-live-end --></body>
</html>
`;
    const file = join(tmp, 'Layout.astro');
    writeFileSync(file, original);

    const cfgPath = join(tmp, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({
      files: ['Layout.astro'],
      insertBefore: '</body>',
      commentSyntax: 'html',
    }));

    runInject(tmp, cfgPath, ['--port', '8400']);
    const afterInject = readFileSync(file, 'utf-8');

    assert.equal((afterInject.match(/impeccable-live-start/g) || []).length, 1, 'reinjection should leave one live block');
    assert.match(afterInject, /<script is:inline src="http:\/\/localhost:8400\/live\.js"><\/script>/, 'astro reinject should restore is:inline');
    assert.doesNotMatch(afterInject, /<script src="http:\/\/localhost:8400\/live\.js"><\/script>/, 'bare astro live script must not survive');
  });

  it('round-trips when the insert anchor has no leading indent (column-0 </body>)', () => {
    const original = `<html>
<body>
<p>Content</p>
</body>
</html>
`;
    const file = join(tmp, 'flat.html');
    writeFileSync(file, original);

    const cfgPath = join(tmp, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({
      files: ['flat.html'],
      insertBefore: '</body>',
      commentSyntax: 'html',
    }));

    runInject(tmp, cfgPath, ['--port', '8400']);
    runInject(tmp, cfgPath, ['--remove']);

    const after = readFileSync(file, 'utf-8');
    assert.equal(after, original, 'column-0 anchor should round-trip cleanly too');
  });

  it('preserves the character after an insertAfter anchor with no trailing newline (#227)', () => {
    const original = '<head>X</head>';
    const file = join(tmp, 'compact.html');
    writeFileSync(file, original);

    const cfgPath = join(tmp, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({
      files: ['compact.html'],
      insertAfter: '<head>',
      commentSyntax: 'html',
    }));

    runInject(tmp, cfgPath, ['--port', '8400']);
    const afterInject = readFileSync(file, 'utf-8');

    assert.ok(
      afterInject.includes('<!-- impeccable-live-end -->\nX</head>'),
      `the character immediately after <head> must survive injection, got:\n${afterInject}`
    );
  });

  it('round-trips insertAfter files with CRLF newlines', () => {
    const original = '<html>\r\n<head>\r\n  <title>X</title>\r\n</head>\r\n<body>Content</body>\r\n</html>\r\n';
    const file = join(tmp, 'crlf.html');
    writeFileSync(file, original);

    const cfgPath = join(tmp, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({
      files: ['crlf.html'],
      insertAfter: '<head>',
      commentSyntax: 'html',
    }));

    runInject(tmp, cfgPath, ['--port', '8400']);
    const afterInject = readFileSync(file, 'utf-8');

    assert.ok(
      afterInject.includes(
        '<head>\r\n<!-- impeccable-live-start -->\r\n<script src="http://localhost:8400/live.js"></script>\r\n<!-- impeccable-live-end -->\r\n  <title>X</title>'
      ),
      `CRLF insertAfter should keep CRLF boundaries around the injected block, got:\n${JSON.stringify(afterInject)}`
    );

    runInject(tmp, cfgPath, ['--remove']);
    const afterRemove = readFileSync(file, 'utf-8');
    assert.equal(afterRemove, original, 'CRLF file should round-trip cleanly after remove');
  });

  it('uses an idempotent dev-only client plugin for a Nuxt 4 app directory', () => {
    const configSource = `export default defineNuxtConfig({\n  devtools: { enabled: false },\n});\n`;
    const appSource = `<template>\n  <NuxtPage />\n</template>\n`;
    writeFileSync(join(tmp, 'nuxt.config.ts'), configSource);
    mkdirSync(join(tmp, 'app'), { recursive: true });
    writeFileSync(join(tmp, 'app', 'app.vue'), appSource);

    const cfgPath = join(tmp, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({
      files: ['app/app.vue'],
      insertBefore: '</template>',
      commentSyntax: 'html',
    }));

    const first = runInject(tmp, cfgPath, ['--port', '8400']);
    const pluginPath = join(tmp, 'app', 'plugins', 'impeccable-live.client.ts');
    const firstPlugin = readFileSync(pluginPath, 'utf-8');
    assert.equal(first.ok, true);
    assert.equal(first.adapter, 'nuxt');
    assert.equal(first.results[0].file, 'app/plugins/impeccable-live.client.ts');
    assert.equal(first.results[0].changed, true);
    assert.match(firstPlugin, /if \(!import\.meta\.dev/);
    assert.match(firstPlugin, /data-impeccable-live-nuxt/);
    assert.match(firstPlugin, /localhost:8400\/live\.js/);
    assert.equal(readFileSync(join(tmp, 'nuxt.config.ts'), 'utf-8'), configSource, 'Nuxt config remains user-owned');
    assert.equal(readFileSync(join(tmp, 'app', 'app.vue'), 'utf-8'), appSource, 'app.vue remains user-owned');

    const second = runInject(tmp, cfgPath, ['--port', '8400']);
    assert.equal(second.ok, true);
    assert.equal(second.results[0].changed, false, 'same-port reinjection is byte-idempotent');
    assert.equal(readFileSync(pluginPath, 'utf-8'), firstPlugin);

    const moved = runInject(tmp, cfgPath, ['--port', '8401']);
    assert.equal(moved.ok, true);
    assert.equal(moved.results[0].changed, true);
    assert.match(readFileSync(pluginPath, 'utf-8'), /localhost:8401\/live\.js/);
    assert.doesNotMatch(readFileSync(pluginPath, 'utf-8'), /localhost:8400\/live\.js/);

    const removed = runInject(tmp, cfgPath, ['--remove']);
    assert.equal(removed.ok, true);
    assert.equal(removed.adapter, 'nuxt');
    assert.equal(removed.results[0].removed, true);
    assert.equal(existsSync(pluginPath), false);
    assert.equal(readFileSync(join(tmp, 'nuxt.config.ts'), 'utf-8'), configSource);
    assert.equal(readFileSync(join(tmp, 'app', 'app.vue'), 'utf-8'), appSource);
  });

  it('respects a literal Nuxt srcDir and never overwrites a user plugin', () => {
    writeFileSync(join(tmp, 'nuxt.config.ts'), `export default defineNuxtConfig({ srcDir: 'client/' });\n`);
    mkdirSync(join(tmp, 'client', 'plugins'), { recursive: true });
    const pluginPath = join(tmp, 'client', 'plugins', 'impeccable-live.client.ts');
    const userPlugin = `export default defineNuxtPlugin(() => {});\n`;
    writeFileSync(pluginPath, userPlugin);
    const cfgPath = join(tmp, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({
      files: ['client/app.vue'],
      insertBefore: '</template>',
      commentSyntax: 'html',
    }));

    const result = runInject(tmp, cfgPath, ['--port', '8400']);
    assert.equal(result.ok, false);
    assert.equal(result.adapter, 'nuxt');
    assert.equal(result.results[0].error, 'nuxt_plugin_conflict');
    assert.equal(readFileSync(pluginPath, 'utf-8'), userPlugin);
  });
});

// ---------------------------------------------------------------------------
// Injection journal — the CLI half. The unit-level heal semantics live in
// tests/live-frameworks.test.mjs; these pin the two paths that actually run it.
// ---------------------------------------------------------------------------

const ORPHAN_PLUGIN = '/* impeccable-live-nuxt-plugin */\nexport default defineNuxtPlugin(() => {});\n';

function stageOrphanedSession(root) {
  mkdirSync(join(root, 'app', 'plugins'), { recursive: true });
  writeFileSync(join(root, 'app', 'plugins', 'impeccable-live.client.ts'), ORPHAN_PLUGIN);
  mkdirSync(join(root, '.impeccable', 'live'), { recursive: true });
  writeFileSync(join(root, '.impeccable', 'live', 'inject-journal.json'), JSON.stringify({
    version: 1,
    appRoot: root,
    framework: 'nuxt',
    port: 8400,
    pid: 999999,
    recordedAt: new Date().toISOString(),
    artifacts: [{
      kind: 'created',
      path: 'app/plugins/impeccable-live.client.ts',
      marker: 'impeccable-live-nuxt-plugin',
      pruneTo: 'app',
    }],
  }));
}

describe('live-inject — crash-safe injection journal', () => {
  it('refuses to heal artifacts outside the project tree (review M1)', async () => {
    const { healInjectJournal } = await import('../skill/scripts/live/frameworks/journal.mjs');
    const outside = join(tmp, '..', `impeccable-victim-${Date.now()}`);
    writeFileSync(outside, 'precious');
    try {
      mkdirSync(join(tmp, '.impeccable', 'live'), { recursive: true });
      writeFileSync(join(tmp, '.impeccable', 'live', 'inject-journal.json'), JSON.stringify({
        version: 1,
        artifacts: [
          { kind: 'created', path: relative(tmp, outside) },
          { kind: 'created', path: 'unmarked.txt' },
        ],
      }));
      writeFileSync(join(tmp, 'unmarked.txt'), 'no marker present');
      const { healed } = healInjectJournal(tmp, { keep: [] });
      // The escape attempt is refused and the file survives.
      assert.equal(readFileSync(outside, 'utf-8'), 'precious');
      // A created artifact without a marker is unverifiable: untouched.
      assert.equal(readFileSync(join(tmp, 'unmarked.txt'), 'utf-8'), 'no marker present');
      const actions = (healed || []).map((h) => h.action);
      assert.equal(actions.includes('removed'), false, JSON.stringify(healed));
    } finally {
      rmSync(outside, { force: true });
    }
  });

  let tmp;
  beforeEach(() => { tmp = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-journal-cli-'))); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  function writeLiveConfig(root) {
    mkdirSync(join(root, '.impeccable', 'live'), { recursive: true });
    writeFileSync(join(root, '.impeccable', 'live', 'config.json'), JSON.stringify({
      files: ['index.html'],
      insertBefore: '</body>',
      commentSyntax: 'html',
    }));
  }

  it('records what an inject wrote and clears it again on remove', () => {
    writeFileSync(join(tmp, 'index.html'), '<html>\n  <body>\n  </body>\n</html>\n');
    writeLiveConfig(tmp);

    runInjectDefault(tmp, ['--port', '8400']);
    const journal = JSON.parse(readFileSync(join(tmp, '.impeccable', 'live', 'inject-journal.json'), 'utf-8'));
    assert.equal(journal.port, 8400);
    assert.deepEqual(journal.artifacts.map((a) => a.path), ['index.html']);

    runInjectDefault(tmp, ['--remove']);
    assert.equal(existsSync(join(tmp, '.impeccable', 'live', 'inject-journal.json')), false);
  });

  it('heals artifacts a SIGKILLed session left behind, on the next inject', () => {
    // The project no longer detects as Nuxt (the config file is gone), so the
    // adapter's own remove can never reach its plugin. The journal can.
    writeFileSync(join(tmp, 'index.html'), '<html>\n  <body>\n  </body>\n</html>\n');
    writeLiveConfig(tmp);
    stageOrphanedSession(tmp);

    const result = runInjectDefault(tmp, ['--port', '8400']);

    assert.equal(result.ok, true);
    assert.deepEqual(result.healed, [{ path: 'app/plugins/impeccable-live.client.ts', action: 'removed' }]);
    assert.equal(existsSync(join(tmp, 'app', 'plugins', 'impeccable-live.client.ts')), false);
    assert.equal(existsSync(join(tmp, 'app', 'plugins')), false, 'the emptied plugins/ dir is pruned');
    assert.match(readFileSync(join(tmp, 'index.html'), 'utf-8'), /localhost:8400\/live\.js/);
  });

  it('does not report healing when there is nothing orphaned', () => {
    writeFileSync(join(tmp, 'index.html'), '<html>\n  <body>\n  </body>\n</html>\n');
    writeLiveConfig(tmp);

    const result = runInjectDefault(tmp, ['--port', '8400']);

    assert.equal(result.healed, undefined, 'the healed key stays off the happy path');
  });

  it('heals the appRoot journal when stop runs from the wrong directory', () => {
    execFileSync('git', ['init', '-q'], { cwd: tmp });
    writeFileSync(join(tmp, 'index.html'), '<html>\n  <body>\n  </body>\n</html>\n');
    writeLiveConfig(tmp);
    stageOrphanedSession(tmp);
    // enterLiveRoot follows this manifest back to the app root.
    writeFileSync(join(tmp, '.impeccable', 'live', 'roots.json'), JSON.stringify({
      version: 1,
      appRoot: tmp,
      repoRoot: tmp,
      contextRoot: null,
      sessionRoot: join(tmp, '.impeccable', 'live'),
      resolvedFrom: 'cwd',
    }));
    const nested = join(tmp, 'packages', 'deep');
    mkdirSync(nested, { recursive: true });

    const result = runInjectDefault(nested, ['--remove']);

    assert.equal(result.ok, true);
    assert.deepEqual(result.healed, [{ path: 'app/plugins/impeccable-live.client.ts', action: 'removed' }]);
    assert.equal(
      existsSync(join(tmp, 'app', 'plugins', 'impeccable-live.client.ts')),
      false,
      'a stop issued from a nested directory still cleans the app root',
    );
    assert.equal(existsSync(join(tmp, '.impeccable', 'live', 'inject-journal.json')), false);
  });

  it('leaves the journal alone on --check', () => {
    writeFileSync(join(tmp, 'index.html'), '<html>\n  <body>\n  </body>\n</html>\n');
    writeLiveConfig(tmp);
    stageOrphanedSession(tmp);

    const result = runInjectDefault(tmp, ['--check']);

    assert.equal(result.ok, true);
    assert.ok(
      existsSync(join(tmp, 'app', 'plugins', 'impeccable-live.client.ts')),
      '--check is read-only; healing belongs to the inject run',
    );
  });
});
