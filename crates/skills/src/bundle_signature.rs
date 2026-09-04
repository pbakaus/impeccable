//! Authenticity gate for remote skill bundles. The only trust roots are the
//! public keys compiled into this binary, never anything in a download.
use once_cell::sync::Lazy;
use regex::Regex;
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Read};

pub(crate) const MAX_SIGNATURE_BYTES: u64 = 16 * 1024;
pub(crate) const ERROR_PREFIX: &str = "Could not verify skill bundle: ";
pub(crate) type TrustedKeys = BTreeMap<String, String>;
static VERSION: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
).unwrap()
});

pub(crate) fn trusted_keys() -> Result<TrustedKeys, String> {
    serde_json::from_str(include_str!("../../../scripts/bundle-signing-keys.json"))
        .map_err(|_| "Invalid compiled bundle signing keyring".into())
}

pub(crate) fn release_version(location: &str) -> Result<String, String> {
    let version = location
        .strip_prefix("https://github.com/pbakaus/impeccable/releases/download/skill-v")
        .and_then(|s| s.strip_suffix("/universal.zip"))
        .filter(|v| v.len() <= 128 && VERSION.is_match(v));
    version.map(str::to_string).ok_or_else(|| {
        "Bundle download must redirect to a versioned Impeccable GitHub release".into()
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    schema: u32,
    key_id: String,
    version: String,
    artifact: String,
    size: u64,
    sha256: String,
    signature: String,
}

fn decode_hex(value: &str, size: usize) -> Result<Vec<u8>, String> {
    if value.len() != size * 2
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("Invalid bundle signature encoding".into());
    }
    (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&value[i..i + 2], 16).map_err(|_| "Invalid hex".into()))
        .collect()
}

pub(crate) fn verify_reader(
    reader: &mut dyn Read,
    signature: &[u8],
    version: &str,
    keys: &TrustedKeys,
) -> Result<(), String> {
    if signature.len() as u64 > MAX_SIGNATURE_BYTES {
        return Err("Bundle signature is too large".into());
    }
    let envelope: Envelope = serde_json::from_slice(signature)
        .map_err(|_| "Missing or malformed bundle signature".to_string())?;
    if envelope.schema != 1
        || envelope.version != version
        || !VERSION.is_match(version)
        || envelope.artifact != "universal.zip"
        || envelope.size == 0
        || envelope.size > crate::bundle::MAX_DOWNLOAD_BYTES
    {
        return Err("Bundle signature metadata does not match the requested release".into());
    }
    let public_key = keys
        .get(&envelope.key_id)
        .ok_or("Unknown bundle signing key; update the Impeccable CLI and retry")?;
    let public_key = decode_hex(public_key, 32)?;
    let signature = decode_hex(&envelope.signature, 64)?;
    decode_hex(&envelope.sha256, 32)?;
    let payload = format!(
        "impeccable-skill-bundle-v1\n{}\nskill-v{}\n{}\n{}\n{}\n",
        envelope.key_id, envelope.version, envelope.artifact, envelope.size, envelope.sha256
    );
    UnparsedPublicKey::new(&ED25519, public_key)
        .verify(payload.as_bytes(), &signature)
        .map_err(|_| "Bundle signature verification failed".to_string())?;

    let mut hash = Sha256::new();
    let mut size = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > envelope.size {
            return Err("Bundle size does not match its signature".into());
        }
        hash.update(&buffer[..count]);
    }
    if size != envelope.size || format!("{:x}", hash.finalize()) != envelope.sha256 {
        return Err("Bundle digest or size does not match its signature".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    #[test]
    #[ignore = "Set IMPECCABLE_VERIFY_BUNDLE and IMPECCABLE_VERIFY_BUNDLE_VERSION to a reviewed release ZIP"]
    fn verifies_reviewed_release_with_production_keyring() {
        let path = std::env::var("IMPECCABLE_VERIFY_BUNDLE").unwrap();
        let version = std::env::var("IMPECCABLE_VERIFY_BUNDLE_VERSION").unwrap();
        let signature = std::fs::read(format!("{path}.sig.json")).unwrap();
        let mut file = std::fs::File::open(path).unwrap();
        verify_reader(&mut file, &signature, &version, &trusted_keys().unwrap()).unwrap();
    }

    #[test]
    fn verifies_node_interoperability_vector() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/bundle-signature.json"
        ))
        .unwrap();
        let bundle = fixture["bundle"].as_str().unwrap().as_bytes();
        let envelope = serde_json::to_vec(&fixture["envelope"]).unwrap();
        let keys = serde_json::from_value(fixture["keys"].clone()).unwrap();
        verify_reader(&mut &bundle[..], &envelope, "4.2.0", &keys).unwrap();
    }

    fn fixture() -> (Vec<u8>, Vec<u8>, std::collections::BTreeMap<String, String>) {
        // A public, deterministic TEST key. Never present in the production keyring.
        let key = Ed25519KeyPair::from_seed_unchecked(&[7; 32]).unwrap();
        let bundle = b"test bundle".to_vec();
        let digest = format!("{:x}", Sha256::digest(&bundle));
        let payload = format!(
            "impeccable-skill-bundle-v1\ntest-only\nskill-v4.2.0\nuniversal.zip\n11\n{digest}\n"
        );
        let hex = |bytes: &[u8]| bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let envelope = serde_json::json!({
            "schema": 1, "keyId": "test-only", "version": "4.2.0",
            "artifact": "universal.zip", "size": 11, "sha256": digest,
            "signature": hex(key.sign(payload.as_bytes()).as_ref()),
        });
        (
            bundle,
            serde_json::to_vec(&envelope).unwrap(),
            [("test-only".into(), hex(key.public_key().as_ref()))].into(),
        )
    }

    #[test]
    fn accepts_signed_bytes_and_rejects_tampering() {
        let (bundle, envelope, keys) = fixture();
        verify_reader(&mut &bundle[..], &envelope, "4.2.0", &keys).unwrap();
        for tampered in [b"Test bundle".as_slice(), b"test bundle extra", b"test"] {
            assert!(verify_reader(&mut &tampered[..], &envelope, "4.2.0", &keys).is_err());
        }
        assert!(verify_reader(&mut &bundle[..], &envelope, "4.2.1", &keys).is_err());
        assert!(verify_reader(&mut &bundle[..], &envelope, "4.2.0", &Default::default()).is_err());
    }

    #[test]
    fn rejects_changed_metadata_bad_encodings_and_unsigned_bundles() {
        let (bundle, envelope, keys) = fixture();
        for (field, value) in [
            ("schema", serde_json::json!(2)),
            ("keyId", serde_json::json!("attacker")),
            ("version", serde_json::json!("4.2.1")),
            ("artifact", serde_json::json!("other.zip")),
            ("size", serde_json::json!(10)),
            ("sha256", serde_json::json!("0".repeat(64))),
            ("signature", serde_json::json!("0".repeat(128))),
            ("signature", serde_json::json!("ff")),
            ("sha256", serde_json::json!("g".repeat(64))),
            (
                "publicKey",
                serde_json::json!("never trust an embedded key"),
            ),
        ] {
            let mut bad: serde_json::Value = serde_json::from_slice(&envelope).unwrap();
            bad[field] = value;
            assert!(
                verify_reader(
                    &mut &bundle[..],
                    &serde_json::to_vec(&bad).unwrap(),
                    "4.2.0",
                    &keys
                )
                .is_err(),
                "{field}"
            );
        }
        for malformed in [b"".as_slice(), b"{}", b"not json"] {
            assert!(verify_reader(&mut &bundle[..], malformed, "4.2.0", &keys).is_err());
        }
        let duplicate = String::from_utf8(envelope)
            .unwrap()
            .replacen('{', "{\"schema\":1,", 1);
        assert!(verify_reader(&mut &bundle[..], duplicate.as_bytes(), "4.2.0", &keys).is_err());
    }

    #[test]
    fn release_location_is_exact_and_versioned() {
        let prefix = "https://github.com/pbakaus/impeccable/releases/download/";
        assert_eq!(
            release_version(&format!("{prefix}skill-v4.2.0/universal.zip")).unwrap(),
            "4.2.0"
        );
        for bad in [
            format!("{prefix}skill-v4.2.0/other.zip"),
            format!("{prefix}skill-v4.2.0/universal.zip?key=x"),
            format!("{prefix}skill-v4.2.0/universal.zip#x"),
            format!("{prefix}skill-v04.2.0/universal.zip"),
            "http://github.com/pbakaus/impeccable/releases/download/skill-v4.2.0/universal.zip".into(),
            "https://github.com/attacker/impeccable/releases/download/skill-v4.2.0/universal.zip".into(),
            "https://github.com.evil.test/pbakaus/impeccable/releases/download/skill-v4.2.0/universal.zip".into(),
        ] {
            assert!(release_version(&bad).is_err(), "{bad}");
        }
    }
}
