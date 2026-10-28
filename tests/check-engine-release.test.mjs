/**
 * `scripts/check-engine-release.mjs --record` and its manifest check.
 *
 * Every engine download is verified against skill/scripts/engine-checksums.txt,
 * so the record step must write what the release serves and the check must
 * notice a manifest that no longer agrees with the release sidecars. The release
 * is a local server holding five fake binaries, their sidecars and the npm
 * platform packages.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { checkEngineRelease, recordEngineChecksums } from '../scripts/check-engine-release.mjs';
import { ENGINE_TARGETS, assetName, binaryPath, currentTarget, fetchEngine } from '../scripts/fetch-engine.mjs';

const VERSION = '9.9.9';
const bodies = new Map(ENGINE_TARGETS.map((target) => [assetName(target), Buffer.from(`fake engine ${target}\n`)]));
const digest = (body) => createHash('sha256').update(body).digest('hex');

let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/npm/@impeccable%2fcli-') && req.url.endsWith(`/${VERSION}`)) {
      res.writeHead(200);
      res.end('{}');
      return;
    }
    const [, tag, name] = req.url.split('/');
    const asset = name?.replace(/\.sha256$/, '');
    if (tag !== `engine-v${VERSION}` || !bodies.has(asset)) {
      res.writeHead(404);
      res.end('');
      return;
    }
    const body = bodies.get(asset);
    res.writeHead(200);
    res.end(name.endsWith('.sha256') ? `${digest(body)}  ${asset}\n` : body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function stageRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-check-release-'));
  fs.mkdirSync(path.join(root, 'skill', 'scripts'), { recursive: true });
  return { root, manifest: path.join(root, 'skill', 'scripts', 'engine-checksums.txt') };
}

const check = (root) => checkEngineRelease({ version: VERSION, base, root, registry: `${base}/npm` });
const manifestProblems = async (root) => (await check(root)).missing.filter((m) => m.kind === 'manifest');

describe('engine checksum manifest', () => {
  it('records one correct line per release asset', async () => {
    const { root, manifest } = stageRoot();
    await recordEngineChecksums({ version: VERSION, base, root });
    const lines = fs.readFileSync(manifest, 'utf8').split('\n').filter((line) => line && !line.startsWith('#'));
    assert.deepEqual(
      lines.sort(),
      [...bodies].map(([asset, body]) => `${VERSION} ${asset} ${digest(body)}`).sort(),
    );
    assert.deepEqual(await check(root), { ok: true, version: VERSION, base, missing: [] });
  });

  it('reports a line that no longer matches the release sidecar', async () => {
    const { root, manifest } = stageRoot();
    await recordEngineChecksums({ version: VERSION, base, root });
    const wrong = `${VERSION} ${assetName('linux-x64')} ${'0'.repeat(64)}`;
    const text = fs.readFileSync(manifest, 'utf8').replace(new RegExp(`^${VERSION} ${assetName('linux-x64')} .*$`, 'm'), wrong);
    fs.writeFileSync(manifest, text);
    const problems = await manifestProblems(root);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].target, 'linux-x64');
  });

  it('reports a release asset with no line', async () => {
    const { root, manifest } = stageRoot();
    await recordEngineChecksums({ version: VERSION, base, root });
    const kept = fs.readFileSync(manifest, 'utf8').split('\n').filter((line) => !line.includes(assetName('darwin-arm64')));
    fs.writeFileSync(manifest, kept.join('\n'));
    const problems = await manifestProblems(root);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].target, 'darwin-arm64');
  });
});

describe('fetch-engine verification', () => {
  // A target other than this host's, so IMPECCABLE_BIN never short-circuits the download.
  const target = ENGINE_TARGETS.find((t) => t !== currentTarget());
  const line = (sum) => `# test\n${VERSION} ${assetName(target)} ${sum}\n`;
  const fetchWith = (manifestText) => {
    const { root, manifest } = stageRoot();
    if (manifestText !== null) fs.writeFileSync(manifest, manifestText);
    const dest = path.join(root, 'bin');
    return { dest, run: () => fetchEngine(target, { version: VERSION, base, root, dest }) };
  };

  it('installs a binary that matches its manifest line', async () => {
    const { dest, run } = fetchWith(line(digest(bodies.get(assetName(target)))));
    assert.equal(await run(), binaryPath(target, dest));
  });

  for (const [name, text, error] of [
    ['no manifest', null, /no checksum for engine 9\.9\.9/],
    ['no line for the version', `1.0.0 ${assetName(target)} ${'a'.repeat(64)}\n`, /no checksum for engine 9\.9\.9/],
    ['a digest that does not match', line('0'.repeat(64)), /checksum mismatch/],
    ['a malformed line', `${VERSION} ${assetName(target)} not-a-digest\n`, /expected '<version> <asset> <sha256>'/],
  ]) {
    it(`refuses ${name} and writes nothing`, async () => {
      const { dest, run } = fetchWith(text);
      await assert.rejects(run(), error);
      assert.equal(fs.existsSync(dest), false);
    });
  }
});
