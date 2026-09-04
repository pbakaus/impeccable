# Skill bundle signatures

`impeccable install`, `update`, and `check` authenticate a remote skill ZIP
before extracting it. `universal.zip.sig.json` is an Ed25519 signature over
the ZIP's SHA-256 digest, byte length, release version, artifact name, and key
ID. The engine trusts only `scripts/bundle-signing-keys.json`, compiled into
the binary. A signature cannot introduce a new trusted key.

The download endpoint on impeccable.style redirects to a versioned GitHub
release. The installer resolves that redirect once and downloads the ZIP and
its signature from that same release. Every subsequent redirect must use
HTTPS. Missing signatures, unknown keys, changed metadata, and changed ZIP
bytes stop the operation before extraction or writes to installed skills.
The temporary download directory is removed on failure.

## Sign a release

Install the 1Password CLI and enable its desktop app integration. The signing
item holds the PKCS#8 Ed25519 private key in a concealed `private-key` field.
Set references, not key material, in your shell:

```sh
export OP_ACCOUNT='<account ID or sign-in address>'
export IMPECCABLE_SIGNING_KEY_REF='op://<vault ID>/<item ID>/private-key'
bun run release:skill
```

For a persistent setup on your machine, use local Git settings instead:

```sh
git config --local impeccable.signingAccount '<account ID or sign-in address>'
git config --local impeccable.signingKeyRef 'op://<vault ID>/<item ID>/private-key'
```

Those values stay in `.git/config`, outside version control. Environment
variables take precedence. Neither setting contains the private key.

The release command rebuilds the ZIP, reads the key through `op read`, checks
that its public key is trusted, and writes the sidecar before creating any
tag or release. The ZIP and sidecar are uploaded together. The key is never
passed as a command argument, written to a temporary file, or printed. It
does exist briefly in the local signing process's memory. 1Password failures
are reported without forwarding child-process output.

`--dry-run` does not access 1Password or create a signature. It checks the
usual release prerequisites and shows both assets in the upload plan; it
does not prove that signing credentials work.

To sign an already-published release for the initial rollout, download and
review the exact released `universal.zip`, then run:

```sh
node scripts/sign-bundle.mjs 4.2.0 /path/to/universal.zip
```

Check the resulting sidecar against the Rust verifier and compiled public key:

```sh
IMPECCABLE_VERIFY_BUNDLE=/path/to/universal.zip \
IMPECCABLE_VERIFY_BUNDLE_VERSION=4.2.0 \
cargo test -p impeccable-skills verifies_reviewed_release_with_production_keyring -- --ignored
```

This creates only the local sidecar. It neither uploads it nor replaces the
ZIP. Never regenerate an old ZIP and sign those different bytes as the old
release. Uploading the sidecar is a separate maintainer approval step.

## Rollout and rotation

Before shipping the enforcing engine, publish a valid signature beside the
exact ZIP currently served by impeccable.style. Verify the pair using a
locally built engine, then release the engine, its npm platform packages, and
the CLI/skill pins. Keep the existing release available throughout. Do not
release an enforcing engine with an empty keyring or an unsigned served ZIP.

For planned rotation, ship an engine trusting both the old and new public
keys before signing with the new key. Older engines that do not know the new
key will refuse the download and ask for a CLI update. A compromised key
requires an engine update removing that public key; removing it from a
website does not revoke trust in already-installed binaries. Keep the
dedicated signing item separate from GitHub and deployment credentials.

## Scope

This protects against bundle substitution when an attacker can change the
download endpoint, release asset, or both, but cannot use the signing key or
replace the trusted engine. It is not a freshness protocol: a previously
signed release can still be replayed. Signed timestamp metadata and rollback
state are separate work. Signatures do not establish that authored skill
content is safe, and do not authenticate separately downloaded engine
binaries (those currently use their existing SHA-256 sidecars).

`IMPECCABLE_BUNDLE_PATH` and `impeccable link` are explicit local-development
trust paths. They continue to accept unsigned local files/directories. Do not
use those overrides to get around a failed remote verification. There is no
unsigned-network fallback or skip-signature flag.

## Wire format

JSON sidecar fields: `schema` (1), `keyId`, `version`, `artifact`
(`universal.zip`), `size`, `sha256`, `signature`. Hex strings are lowercase;
the public key is 32 bytes and the signature is 64 bytes. Unknown or repeated
fields are rejected. The signature payload is UTF-8 with LF line endings
and a final LF:

```text
impeccable-skill-bundle-v1
<keyId>
skill-v<version>
universal.zip
<size as decimal>
<sha256 as lowercase hex>
```

The Node signer and Rust verifier share a fixed test vector under
`tests/fixtures/bundle-signature.json`. Its deterministic test key must never
be added to the production keyring.
