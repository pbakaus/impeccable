import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { checkLoopRelease, recordLoopChecksum, parsePins } from '../scripts/check-loop-release.mjs';

test('Loop release recording and checking fail closed without real network', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-release-test-'));
  const originalFetch = globalThis.fetch;
  const file = path.join(root, 'crates/cli/loop-checksums.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# test pins\n');
  const payload = Buffer.from('fixture zip bytes');
  const digest = createHash('sha256').update(payload).digest('hex');
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(payload);
  };
  const options = { root, base: 'http://127.0.0.1:1234' };
  try {
    assert.equal(await checkLoopRelease(options), 0);
    await recordLoopChecksum('1.9.0', options);
    await recordLoopChecksum('1.10.0', options);
    assert.equal(await checkLoopRelease(options), 2);
    assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`${digest}  impeccable-loop-1.10.0.zip`));
    assert.equal(urls[0], `${options.base}/loop-v1.9.0/impeccable-loop-1.9.0.zip`);
    const before = fs.readFileSync(file, 'utf8');
    await recordLoopChecksum('1.9.0', options);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    globalThis.fetch = async () => new Response('wrong bytes');
    await assert.rejects(checkLoopRelease(options), /checksum mismatch/);
    await assert.rejects(recordLoopChecksum('1.9.0', options), /refusing to overwrite/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    await assert.rejects(recordLoopChecksum('../bad', options), /semver/);
    await assert.rejects(checkLoopRelease({ ...options, base: 'http://example.com' }), /HTTPS/);
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'http://evil.test/zip' } });
    await assert.rejects(checkLoopRelease(options), /HTTPS/);
    // GitHub's release assets redirect to a signed URL with a query; that is followed, and its bytes are checked.
    const signed = [];
    globalThis.fetch = async (url) => {
      signed.push(String(url));
      return String(url).includes('sig=') ? new Response(payload) : new Response(null, { status: 302, headers: { location: '/signed/loop.zip?sp=r&sig=abc' } });
    };
    assert.equal(await checkLoopRelease(options), 2);
    assert.equal(signed[1], `${options.base}/signed/loop.zip?sp=r&sig=abc`);
    await assert.rejects(checkLoopRelease({ ...options, base: 'http://127.0.0.1:1234/?x=1' }), /HTTPS/);
    globalThis.fetch = async () => new Response(null, { status: 404 });
    await assert.rejects(checkLoopRelease(options), /HTTP 404/);
    assert.throws(() => parsePins('bad'), /Invalid/);
    assert.throws(() => parsePins(`${digest}  impeccable-loop-01.0.0.zip`), /Invalid/);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
