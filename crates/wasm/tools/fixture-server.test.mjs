import assert from 'node:assert/strict';
import { once } from 'node:events';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createFixtureHandler } from './fixture-server.mjs';

describe('fixture servers', () => {
  it('handles missing and unsafe paths without interrupting subsequent requests', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'impeccable-fixture-server-'));
    const root = path.join(workspace, 'fixtures');
    const outside = path.join(workspace, 'outside.html');
    try {
      await fs.mkdir(root);
      await fs.writeFile(path.join(root, 'index.html'), '<main>fixture</main>');
      await fs.writeFile(path.join(root, 'style.css'), 'body { color: red }');
      await fs.writeFile(path.join(root, 'script.js'), 'export {};');
      await fs.writeFile(path.join(root, 'icon.svg'), '<svg></svg>');
      await fs.writeFile(path.join(root, 'image.png'), 'png');
      await fs.writeFile(outside, '<main>outside</main>');
      await fs.symlink(outside, path.join(root, 'linked.html'));

      for (const csp of [false, true]) {
        const server = http.createServer(createFixtureHandler(root, { csp }));
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const origin = `http://127.0.0.1:${server.address().port}`;
        try {
          for (const requestPath of ['/js/detect-antipatterns-browser.js', '/linked.html', '/%2e%2e%2Foutside.html']) {
            const response = await fetch(origin + requestPath);
            assert.equal(response.status, 404, requestPath);
          }
          assert.equal((await fetch(origin + '/%E0%A4%A')).status, 400);

          const html = await fetch(origin + '/index.html?csp');
          assert.equal(html.status, 200);
          assert.match(html.headers.get('content-type'), /^text\/html/);
          assert.equal(await html.text(), '<main>fixture</main>');
          assert.equal(
            html.headers.get('content-security-policy'),
            csp ? "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src * data:" : null,
          );
          for (const [file, type] of [
            ['style.css', 'text/css'],
            ['script.js', 'application/javascript'],
            ['icon.svg', 'image/svg+xml'],
            ['image.png', 'image/png'],
          ]) {
            const response = await fetch(`${origin}/${file}`);
            assert.equal(response.status, 200, file);
            assert.equal(response.headers.get('content-type'), type, file);
          }
        } finally {
          await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        }
      }
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('logs unexpected failures and returns 500', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'impeccable-fixture-error-'));
    const file = path.join(root, 'index.html');
    await fs.writeFile(file, '<main>fixture</main>');
    const realFile = await fs.realpath(file);
    const readFileSync = fsSync.readFileSync;
    t.mock.method(fsSync, 'readFileSync', (requested, ...args) => {
      if (requested === realFile) {
        const error = new Error('injected read failure');
        error.code = 'EIO';
        throw error;
      }
      return readFileSync(requested, ...args);
    });
    const logged = t.mock.method(console, 'error', () => {});
    const server = http.createServer(createFixtureHandler(root));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/index.html`);
      assert.equal(response.status, 500);
      assert.equal(logged.mock.callCount(), 1);
      assert.equal(logged.mock.calls[0].arguments[0], 'Fixture server error:');
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('uses the shared request handler in all five fixture tools', async () => {
    for (const name of ['ab-diff', 'disabled-values-check', 'ext-diff', 'skip-scan-check', 'snapshot-diff']) {
      const source = await fs.readFile(new URL(`./${name}.mjs`, import.meta.url), 'utf8');
      assert.match(source, /http\.createServer\(createFixtureHandler\(dir(?:,\s*\{\s*csp:\s*true\s*\})?\)\)/, name);
      if (name === 'ext-diff') assert.match(source, /createFixtureHandler\(dir,\s*\{\s*csp:\s*true\s*\}\)/);
    }
  });
});
