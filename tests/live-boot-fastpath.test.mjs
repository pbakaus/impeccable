/**
 * The generate command's fast lane through the live boot: `--allow-missing-context`
 * boots a project that has no PRODUCT.md / DESIGN.md (naming what is missing
 * instead of refusing), and the boot reports `devUrl`, the dev server that is
 * serving the injected page right now, so the agent never reads terminals.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { ENGINE_MISSING_MESSAGE, engineEnv, findEngineBinary } from './lib/engine-bin.mjs';

const ENGINE_BIN = findEngineBinary();

// Async on purpose: the stand-in dev server below lives in this process, so
// a blocking exec would freeze the event loop while the boot probes it.
function run(cwd, args, env = {}) {
  return new Promise((resolve) => {
    execFile(ENGINE_BIN, args, { cwd, encoding: 'utf-8', env: engineEnv(ENGINE_BIN, env) }, (err, stdout) => {
      const text = (stdout || err?.stdout || '').trim();
      if (!text) return resolve({ ok: false, error: 'no_output', detail: String(err) });
      // `live-server stop` answers in prose ("Stopped live server on port N.").
      try { resolve(JSON.parse(text)); } catch { resolve({ ok: !err, raw: text }); }
    });
  });
}

describe('live boot fast lane', { skip: ENGINE_BIN ? false : ENGINE_MISSING_MESSAGE }, () => {
  let tmp;
  let server;
  let devUrl;
  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'impeccable-boot-fastlane-'));
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'fastlane', scripts: { dev: 'vite' } }));
    writeFileSync(join(tmp, 'vite.config.js'), 'export default {}\n');
    writeFileSync(join(tmp, 'index.html'), '<!doctype html><html><body><h1 id="hero">Hero</h1></body></html>\n');
    mkdirSync(join(tmp, '.impeccable/live'), { recursive: true });
    writeFileSync(join(tmp, '.impeccable/live/config.json'), JSON.stringify({"files": ["index.html"], "insertBefore": "</body>", "commentSyntax": "html"}));
    // A stand-in dev server: serves the project's index.html as it is on disk,
    // injected tag included, the way Vite would.
    server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(join(tmp, 'index.html'), 'utf-8'));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    devUrl = `http://127.0.0.1:${server.address().port}/`;
  });
  after(async () => {
    if (existsSync(join(tmp, '.impeccable/live/server.json'))) await run(tmp, ['live-server', 'stop']);
    await new Promise((r) => server.close(r));
    rmSync(tmp, { recursive: true, force: true });
  });

  it('refuses without the flag, boots with it, naming what is missing, and finds the dev server', async () => {
    const refused = await run(tmp, ['live']);
    assert.equal(refused.ok, false);
    assert.equal(refused.error, 'context_missing');
    assert.deepEqual(refused.missing, ['PRODUCT.md', 'DESIGN.md']);

    const booted = await run(tmp, ['live', '--allow-missing-context', '--dev-url'], { IMPECCABLE_DEV_URL_CANDIDATES: `http://127.0.0.1:1/, ${devUrl}` });
    assert.equal(booted.ok, true, JSON.stringify(booted));
    assert.deepEqual(booted.contextMissing, ['PRODUCT.md', 'DESIGN.md']);
    assert.match(booted.contextNote, /do not run init or document/);
    assert.equal(booted.hasProduct, false);
    assert.equal(booted.hasDesign, false);
    assert.equal(booted.devUrl, devUrl, 'the origin serving the injected page is reported');
    assert.ok(readFileSync(join(tmp, 'index.html'), 'utf-8').includes('live.js?token='), 'the page was injected');

    const stopped = await run(tmp, ['live-server', 'stop']);
    assert.ok(stopped.ok !== false, JSON.stringify(stopped));
  });

  it('with both files present the flags report devUrl null and an empty contextMissing', async () => {
    writeFileSync(join(tmp, 'PRODUCT.md'), '# Product\n\n## Platform\n\nweb\n');
    writeFileSync(join(tmp, 'DESIGN.md'), '---\nname: Test\n---\n# Design\n');
    const booted = await run(tmp, ['live', '--allow-missing-context', '--dev-url'], { IMPECCABLE_DEV_URL_CANDIDATES: 'http://127.0.0.1:1/' });
    assert.equal(booted.ok, true, JSON.stringify(booted));
    assert.deepEqual(booted.contextMissing, []);
    assert.equal(booted.contextNote, null);
    assert.equal(booted.devUrl, null);
    await run(tmp, ['live-server', 'stop']);
  });

  it('a plain live boot is untouched by the lane: no probe, no new keys', async () => {
    const booted = await run(tmp, ['live'], { IMPECCABLE_DEV_URL_CANDIDATES: devUrl });
    assert.equal(booted.ok, true, JSON.stringify(booted));
    assert.ok(!('devUrl' in booted), 'devUrl only appears with --dev-url');
    assert.ok(!('contextMissing' in booted) && !('contextNote' in booted), 'context keys only appear with --allow-missing-context');
    await run(tmp, ['live-server', 'stop']);
  });
});
