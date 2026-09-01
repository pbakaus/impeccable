import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  BUNDLE_SUBDIR,
  DETECTOR_PIECES,
  cacheBundleDir,
  isCompleteBundleDir,
  resolveDetectorBundle,
  vendorDetectorBundle,
} from '../scripts/lib/detector-bundle.mjs';

const VERSION = '9.9.9';

let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'detector-bundle-test-')); });
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

let seq = 0;
function scratch(name) {
  const dir = path.join(tmp, `${name}-${seq++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A directory holding the five pieces, each with recognizable content. */
function writeBundle(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const piece of DETECTOR_PIECES) {
    fs.writeFileSync(path.join(dir, piece), piece === 'antipatterns.json' ? '[{"id":"a"}]' : `// ${piece}\n`);
  }
  return dir;
}

/** A fetch that serves a zip body and its sidecar, recording every URL asked for. */
function fakeRelease({ zip, digest, sidecarStatus = 200, zipStatus = 200 }) {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.endsWith('.sha256')) {
      return {
        ok: sidecarStatus === 200,
        status: sidecarStatus,
        arrayBuffer: async () => Buffer.from(`${digest}  detector-browser-bundle.zip\n`),
      };
    }
    return { ok: zipStatus === 200, status: zipStatus, arrayBuffer: async () => zip };
  };
  return { fetchImpl, urls };
}

describe('detector bundle resolution', () => {
  it('uses IMPECCABLE_DETECTOR_LIB when its extension-detector/ is complete', async () => {
    const lib = scratch('lib');
    writeBundle(path.join(lib, BUNDLE_SUBDIR));
    const result = await resolveDetectorBundle({
      version: VERSION,
      env: { IMPECCABLE_DETECTOR_LIB: lib },
      fetchImpl: () => assert.fail('should not download'),
    });
    assert.equal(result.source, 'env');
    assert.equal(result.dir, path.join(lib, BUNDLE_SUBDIR));
  });

  it('names the env var and the missing pieces when the local dir is incomplete', async () => {
    const lib = scratch('lib-partial');
    const dir = path.join(lib, BUNDLE_SUBDIR);
    writeBundle(dir);
    fs.rmSync(path.join(dir, 'core_bg.wasm'));
    await assert.rejects(
      () => resolveDetectorBundle({ version: VERSION, env: { IMPECCABLE_DETECTOR_LIB: lib } }),
      (err) => {
        assert.match(err.message, /IMPECCABLE_DETECTOR_LIB=/);
        assert.match(err.message, /core_bg\.wasm/);
        assert.match(err.message, /detector-archive/);
        return true;
      },
    );
  });

  it('uses the version cache under IMPECCABLE_HOME without downloading', async () => {
    const home = scratch('home');
    const env = { IMPECCABLE_HOME: home };
    writeBundle(cacheBundleDir(VERSION, env));
    const result = await resolveDetectorBundle({
      version: VERSION,
      env,
      fetchImpl: () => assert.fail('should not download'),
    });
    assert.equal(result.source, 'cache');
    assert.equal(result.dir, cacheBundleDir(VERSION, env));
  });

  it('downloads and verifies the release bundle into the cache', async () => {
    const home = scratch('home-download');
    const env = { IMPECCABLE_HOME: home, IMPECCABLE_DETECTOR_BASE: 'https://example.test/dl' };
    const zip = Buffer.from('pretend zip bytes');
    const digest = crypto.createHash('sha256').update(zip).digest('hex');
    const { fetchImpl, urls } = fakeRelease({ zip, digest });

    // The extraction step is the `unzip` CLI in production; inject a stand-in
    // that writes the flattened members the real one would.
    const unzip = (zipPath, member, destDir) => {
      assert.equal(fs.readFileSync(zipPath).toString(), zip.toString());
      assert.equal(member, 'extension-src/detector/*');
      writeBundle(destDir);
    };

    const result = await resolveDetectorBundle({ version: VERSION, env, fetchImpl, unzip });
    assert.equal(result.source, 'download');
    assert.equal(result.dir, cacheBundleDir(VERSION, env));
    assert.ok(isCompleteBundleDir(result.dir));
    assert.ok(
      urls.includes(`https://example.test/dl/detector-v${VERSION}/detector-browser-bundle.zip`),
      `asked for: ${urls.join(', ')}`,
    );
    assert.ok(urls.some((u) => u.endsWith('.sha256')), 'verifies against the sidecar');
  });

  it('refuses a bundle whose checksum does not match', async () => {
    const home = scratch('home-mismatch');
    const env = { IMPECCABLE_HOME: home };
    const { fetchImpl } = fakeRelease({ zip: Buffer.from('bytes'), digest: 'f'.repeat(64) });
    await assert.rejects(
      () => resolveDetectorBundle({ version: VERSION, env, fetchImpl, unzip: () => assert.fail('never extracts') }),
      /checksum mismatch/,
    );
    assert.equal(isCompleteBundleDir(cacheBundleDir(VERSION, env)), false);
  });

  it('refuses to install when the sidecar is unavailable', async () => {
    const home = scratch('home-nosidecar');
    const env = { IMPECCABLE_HOME: home };
    const { fetchImpl } = fakeRelease({ zip: Buffer.from('bytes'), digest: 'x', sidecarStatus: 404 });
    await assert.rejects(
      () => resolveDetectorBundle({ version: VERSION, env, fetchImpl, unzip: () => assert.fail('never extracts') }),
      /unverified detector bundle/,
    );
  });

  it('names every option when nothing resolves and the download fails', async () => {
    const home = scratch('home-empty');
    const env = { IMPECCABLE_HOME: home };
    const fetchImpl = async () => ({ ok: false, status: 404, arrayBuffer: async () => Buffer.alloc(0) });
    await assert.rejects(
      () => resolveDetectorBundle({ version: VERSION, env, fetchImpl }),
      (err) => {
        assert.match(err.message, /IMPECCABLE_DETECTOR_LIB/);
        assert.match(err.message, /IMPECCABLE_DETECTOR_BASE/);
        assert.match(err.message, new RegExp(`detector-v${VERSION}`));
        return true;
      },
    );
  });

  it('refuses to download when IMPECCABLE_DETECTOR_OFFLINE=1', async () => {
    const home = scratch('home-offline');
    await assert.rejects(
      () => resolveDetectorBundle({
        version: VERSION,
        env: { IMPECCABLE_HOME: home, IMPECCABLE_DETECTOR_OFFLINE: '1' },
        fetchImpl: () => assert.fail('should not download'),
      }),
      /IMPECCABLE_DETECTOR_OFFLINE=1/,
    );
  });

  it('copies all five pieces into the destination directory', async () => {
    const lib = scratch('lib-vendor');
    writeBundle(path.join(lib, BUNDLE_SUBDIR));
    const dest = path.join(scratch('dest'), 'detector');
    const result = await vendorDetectorBundle({
      destDir: dest,
      version: VERSION,
      env: { IMPECCABLE_DETECTOR_LIB: lib },
    });
    assert.deepEqual(result.files.map((f) => f.name).sort(), [...DETECTOR_PIECES].sort());
    assert.ok(isCompleteBundleDir(dest));
    assert.ok(result.files.every((f) => f.bytes > 0));
  });
});
