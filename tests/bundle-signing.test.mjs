import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { signBundle, signaturePayload, publicKeyHex, signReleaseBundle, readTrustedKeys } from '../scripts/sign-bundle.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const trustedKeys = { 'test-only': publicKeyHex(publicKey) };

test('production keyring is populated and excludes the public test key', () => {
  const keys = readTrustedKeys();
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/bundle-signature.json', import.meta.url)));
  assert.ok(Object.keys(keys).length > 0);
  for (const [id, key] of Object.entries(keys)) {
    assert.match(id, /^[a-z0-9-]{1,64}$/);
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.notEqual(key, fixture.keys['test-only']);
  }
});

test('matches the shared Node/Rust interoperability vector (public test seed)', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/bundle-signature.json', import.meta.url)));
  const key = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 7)]),
    format: 'der', type: 'pkcs8',
  });
  assert.deepEqual(signBundle(Buffer.from(fixture.bundle), '4.2.0', key, fixture.keys), fixture.envelope);
});

test('signs the exact bundle with version, size, digest, artifact and domain bound', () => {
  const bundle = Buffer.from('test bundle');
  const envelope = signBundle(bundle, '4.2.0', privateKey, trustedKeys);
  assert.equal(envelope.keyId, 'test-only');
  assert.equal(envelope.version, '4.2.0');
  assert.equal(envelope.size, bundle.length);
  assert.equal(envelope.artifact, 'universal.zip');
  assert.equal(envelope.schema, 1);
  assert.match(signaturePayload(envelope).toString(), /^impeccable-skill-bundle-v1\n/);
  assert.ok(verify(null, signaturePayload(envelope), publicKey, Buffer.from(envelope.signature, 'hex')));
  for (const changed of [
    { version: '4.2.1' }, { size: 1 }, { sha256: '0'.repeat(64) },
    { artifact: 'other.zip' }, { keyId: 'other-key' },
  ]) {
    assert.equal(verify(null, signaturePayload({ ...envelope, ...changed }), publicKey,
      Buffer.from(envelope.signature, 'hex')), false);
  }
});

test('rejects unknown or non-Ed25519 keys and invalid versions', () => {
  assert.throws(() => signBundle(Buffer.from('zip'), '4.2.0', privateKey, {}), /trusted/);
  for (const version of ['4.2.0\nother', '../4.2.0', '', '04.2.0', '4.2']) {
    assert.throws(() => signBundle(Buffer.from('zip'), version, privateKey, trustedKeys), /version/);
  }
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => publicKeyHex(rsa.publicKey), /Ed25519/);
});

test('1Password read uses a pipe, checks the pinned key, writes only a public signature', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'impeccable-sign-test-'));
  try {
    const zipPath = path.join(root, 'universal.zip');
    writeFileSync(zipPath, 'test bundle');
    const secretReference = 'op://test-vault/test-item/private-key';
    let called = false;
    signReleaseBundle({ zipPath, version: '4.2.0', trustedKeys, secretReference,
      readSecret(reference) {
        called = true;
        assert.equal(reference, secretReference);
        return privateKey.export({ type: 'pkcs8', format: 'pem' });
      },
    });
    assert.ok(called);
    const envelope = JSON.parse(readFileSync(`${zipPath}.sig.json`, 'utf8'));
    assert.ok(verify(null, signaturePayload(envelope), createPublicKey(privateKey),
      Buffer.from(envelope.signature, 'hex')));
    assert.doesNotMatch(readFileSync(`${zipPath}.sig.json`, 'utf8'), /PRIVATE KEY/);
    assert.throws(() => signReleaseBundle({ zipPath, version: '4.2.0', trustedKeys,
      secretReference, readSecret() { throw new Error('SECRET that must not leak'); },
    }), /Could not read.*1Password/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
