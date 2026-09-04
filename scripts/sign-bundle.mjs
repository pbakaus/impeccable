#!/usr/bin/env node
// Local release signing. Private key material travels from op through a pipe
// into crypto, never through argv, environment values, logs or temporary files.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;
const repoRoot = fileURLToPath(new URL('../', import.meta.url));

function localSetting(name) {
  try {
    return execFileSync('git', ['config', '--local', '--get', name], {
      cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch { return undefined; }
}

export function publicKeyHex(key) {
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Signing requires an Ed25519 key.');
  const jwk = key.export({ format: 'jwk' });
  return Buffer.from(jwk.x, 'base64url').toString('hex');
}

// Shared wire format with crates/skills/src/bundle_signature.rs. UTF-8, LF,
// trailing LF. Sign fields explicitly so JSON whitespace/order is irrelevant.
export function signaturePayload({ keyId, version, artifact, size, sha256 }) {
  return Buffer.from(`impeccable-skill-bundle-v1\n${keyId}\nskill-v${version}\n${artifact}\n${size}\n${sha256}\n`);
}

export function readTrustedKeys() {
  return JSON.parse(readFileSync(new URL('./bundle-signing-keys.json', import.meta.url), 'utf8'));
}

export function signBundle(bytes, version, privateKey, trustedKeys) {
  if (typeof version !== 'string' || version.length > 128 || !VERSION_PATTERN.test(version)) throw new Error('Invalid skill version for signing.');
  if (!bytes.length || bytes.length > MAX_BUNDLE_BYTES) throw new Error('Invalid bundle size for signing.');
  const publicKey = createPublicKey(privateKey);
  const publicHex = publicKeyHex(publicKey);
  const keyId = Object.keys(trustedKeys).find(id => trustedKeys[id] === publicHex);
  if (!keyId || !/^[a-z0-9-]{1,64}$/.test(keyId)) {
    throw new Error('The signing key is not in the trusted bundle keyring.');
  }
  const envelope = {
    schema: 1, keyId, version, artifact: 'universal.zip', size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const payload = signaturePayload(envelope);
  const signature = sign(null, payload, privateKey);
  if (!verify(null, payload, publicKey, signature)) throw new Error('Signature self-check failed.');
  return { ...envelope, signature: signature.toString('hex') };
}

function readFrom1Password(reference, account) {
  return execFileSync('op', ['read', reference, '--no-newline', ...(account ? ['--account', account] : [])], {
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 16384,
  });
}

export function signReleaseBundle({ zipPath, version, trustedKeys = readTrustedKeys(),
  secretReference = process.env.IMPECCABLE_SIGNING_KEY_REF ?? localSetting('impeccable.signingKeyRef'),
  account = process.env.OP_ACCOUNT ?? localSetting('impeccable.signingAccount'), readSecret = readFrom1Password }) {
  if (!secretReference?.startsWith('op://')) {
    throw new Error('Set IMPECCABLE_SIGNING_KEY_REF to the 1Password private-key reference (op://vault/item/field).');
  }
  if (typeof version !== 'string' || version.length > 128 || !VERSION_PATTERN.test(version)) throw new Error('Invalid skill version for signing.');
  if (statSync(zipPath).size > MAX_BUNDLE_BYTES) throw new Error('Invalid bundle size for signing.');
  const bytes = readFileSync(zipPath);
  let pem;
  try {
    const secret = readSecret(secretReference, account);
    pem = Buffer.isBuffer(secret) ? secret : Buffer.from(secret);
  } catch {
    // Child-process exceptions can contain stdout/stderr. Never propagate them.
    throw new Error('Could not read the signing key from 1Password. Check CLI integration and unlock the vault.');
  }
  let privateKey;
  try {
    privateKey = createPrivateKey(pem);
  } catch {
    throw new Error('The 1Password field is not a valid PKCS#8 private key.');
  } finally {
    pem.fill(0);
  }
  const envelope = signBundle(bytes, version, privateKey, trustedKeys);
  const output = `${zipPath}.sig.json`;
  writeFileSync(output, `${JSON.stringify(envelope, null, 2)}\n`);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [version, zipPath, ...extra] = process.argv.slice(2);
    if (!zipPath || extra.length || path.basename(zipPath) !== 'universal.zip') {
      throw new Error('Usage: node scripts/sign-bundle.mjs <skill-version> <path/to/universal.zip>');
    }
    console.log(`Signed ${signReleaseBundle({ zipPath, version })}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
