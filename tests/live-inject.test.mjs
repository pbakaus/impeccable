/**
 * Tests for live-inject.mjs — script-tag insert/remove round-trip.
 * Run with: node --test tests/live-inject.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INJECT = resolve(__dirname, '..', 'skill/scripts/live-inject.mjs');

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
});
