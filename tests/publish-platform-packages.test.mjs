import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import {
  stampTemplate,
  stagePackage,
  fetchVerifiedBinary,
  isPublished,
  packageName,
} from '../scripts/publish-platform-packages.mjs';
import { ENGINE_TARGETS, binaryName } from '../scripts/fetch-engine.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const VERSION = '9.9.9';

function template(target) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'cli', 'platform-packages', target, 'package.json'), 'utf-8'));
}

describe('platform package templates', () => {
  it('every target has a template whose bin points at bin/<binary> and whose name matches', () => {
    for (const target of ENGINE_TARGETS) {
      const stamped = stampTemplate(template(target), target, VERSION);
      assert.equal(stamped.name, packageName(target));
      assert.equal(stamped.version, VERSION);
      assert.deepEqual(Object.values(stamped.bin), [`bin/${binaryName(target)}`]);
      assert.ok(stamped.files.includes('bin/') && stamped.files.includes('LICENSE'), `${target} ships bin/ and LICENSE`);
    }
  });

  it('refuses a template whose bin does not match the binary name', () => {
    const bad = { ...template('darwin-arm64'), bin: { 'impeccable-darwin-arm64': 'bin/impeccable.exe' } };
    assert.throws(() => stampTemplate(bad, 'darwin-arm64', VERSION), /must map its bin to bin\/impeccable /);
  });

  it('stages package.json, an executable binary, and the LICENSE', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ipp-stage-'));
    try {
      for (const target of ['linux-x64', 'windows-x64']) {
        const dir = stagePackage({
          target,
          version: VERSION,
          binary: Buffer.from(`binary for ${target}`),
          template: template(target),
          license: Buffer.from('LICENSE TEXT'),
          outDir: out,
        });
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
        assert.equal(pkg.version, VERSION);
        const bin = path.join(dir, 'bin', binaryName(target));
        assert.equal(fs.readFileSync(bin, 'utf-8'), `binary for ${target}`);
        if (process.platform !== 'win32') assert.equal(fs.statSync(bin).mode & 0o111, 0o111, 'binary is executable');
        assert.equal(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf-8'), 'LICENSE TEXT');
      }
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});

describe('release asset verification and registry probe', () => {
  const binary = Buffer.from('release binary bytes');
  const goodSha = createHash('sha256').update(binary).digest('hex');
  let server;
  let base;
  const routes = new Map();

  before(async () => {
    server = http.createServer((req, res) => {
      const handler = routes.get(req.url);
      if (!handler) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      handler(res);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  const asset = `/engine-v${VERSION}/impeccable-linux-x64`;
  const serve = (body) => (res) => { res.statusCode = 200; res.end(body); };

  it('publishes only a binary whose sidecar matches', async () => {
    routes.set(asset, serve(binary));
    routes.set(`${asset}.sha256`, serve(`${goodSha}  impeccable-linux-x64\n`));
    const got = await fetchVerifiedBinary('linux-x64', VERSION, base);
    assert.deepEqual(got, binary);
  });

  it('refuses when the sidecar is missing, empty, or mismatched', async () => {
    routes.set(asset, serve(binary));
    routes.delete(`${asset}.sha256`);
    await assert.rejects(fetchVerifiedBinary('linux-x64', VERSION, base), /sidecar is missing.*refusing to publish/);
    routes.set(`${asset}.sha256`, serve(''));
    await assert.rejects(fetchVerifiedBinary('linux-x64', VERSION, base), /empty or malformed.*refusing to publish/);
    routes.set(`${asset}.sha256`, serve('0'.repeat(64)));
    await assert.rejects(fetchVerifiedBinary('linux-x64', VERSION, base), /checksum mismatch/);
  });

  it('reports a published version as published and a 404 as not', async () => {
    routes.set(`/${packageName('linux-x64').replace('/', '%2F')}/${VERSION}`, serve('{"version":"9.9.9"}'));
    assert.equal(await isPublished('linux-x64', VERSION, base), true);
    assert.equal(await isPublished('darwin-x64', VERSION, base), false);
  });
});
