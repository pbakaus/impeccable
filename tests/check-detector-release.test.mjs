/**
 * scripts/check-detector-release.mjs: the release-order guard for the closed
 * detector archives that crates/core/build.rs downloads. Probes are injected
 * so the test never touches the network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveAsset, assetUrl, checkDetectorRelease, DETECTOR_TARGETS, BROWSER_BUNDLE_ASSET,
  IN_PAGE_BUNDLE_ASSET, DEFAULT_DETECTOR_BASE,
} from '../scripts/check-detector-release.mjs';

const okResponse = { status: 206, body: { cancel: async () => {} } };
const missingResponse = { status: 404, body: null };

describe('check-detector-release', () => {
  it('names one archive per target, .lib on Windows, and the detector-v tag in the URL', () => {
    assert.equal(archiveAsset('darwin-arm64'), 'libimpeccable_detector-darwin-arm64.a');
    assert.equal(archiveAsset('windows-x64'), 'impeccable_detector-windows-x64.lib');
    assert.equal(
      assetUrl('0.1.0', archiveAsset('linux-x64'), 'https://example.test/dl/'),
      'https://example.test/dl/detector-v0.1.0/libimpeccable_detector-linux-x64.a',
    );
    assert.equal(DEFAULT_DETECTOR_BASE, 'https://github.com/pbakaus/impeccable/releases/download');
  });

  it('passes when every archive, checksum and both bundles answer', async () => {
    const seen = [];
    const fetchImpl = async (url) => { seen.push(url); return okResponse; };
    const result = await checkDetectorRelease({ version: '0.1.0', base: 'https://example.test/dl', fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.missing.length, 0);
    // Per target: archive + .sha256. Plus the extension bundle, the in-page
    // bundle crates/core embeds, and that bundle's own .sha256.
    assert.equal(seen.length, DETECTOR_TARGETS.length * 2 + 3);
    assert.ok(seen.includes(`https://example.test/dl/detector-v0.1.0/${BROWSER_BUNDLE_ASSET}`));
    assert.ok(seen.includes(`https://example.test/dl/detector-v0.1.0/${IN_PAGE_BUNDLE_ASSET}`));
    assert.ok(seen.includes(`https://example.test/dl/detector-v0.1.0/${IN_PAGE_BUNDLE_ASSET}.sha256`));
  });

  it('lists every missing asset, sorted by target then archive/checksum/bundle', async () => {
    const fetchImpl = async (url) => (url.includes('windows-x64') || url.includes(BROWSER_BUNDLE_ASSET) || url.includes(IN_PAGE_BUNDLE_ASSET) ? missingResponse : okResponse);
    const result = await checkDetectorRelease({ version: '0.1.0', base: 'https://example.test/dl', fetchImpl });
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing.map((m) => m.what), [
      'impeccable_detector-windows-x64.lib',
      'impeccable_detector-windows-x64.lib.sha256',
      BROWSER_BUNDLE_ASSET,
      IN_PAGE_BUNDLE_ASSET,
      `${IN_PAGE_BUNDLE_ASSET}.sha256`,
    ]);
  });

  it('treats a network error as a missing asset instead of throwing', async () => {
    const fetchImpl = async () => { throw new Error('offline'); };
    const result = await checkDetectorRelease({ version: '0.1.0', base: 'https://example.test/dl', fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.missing.length, DETECTOR_TARGETS.length * 2 + 3);
  });
});
