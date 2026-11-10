//! Offline checks: the release manifest against the pinned release keys, and
//! a lease (a compact EdDSA JWS) against the service's published lease keys.
//! Both are pure functions over bytes, a key set and the time.

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::Deserialize;
use std::collections::BTreeMap;

/// Release public keys by key id: the only trust root for a Pro artifact.
pub type Keyring = BTreeMap<String, [u8; 32]>;

/// Largest Pro artifact the CLI will download.
pub const MAX_ARTIFACT_BYTES: u64 = 512 * 1024 * 1024;

/// The keys compiled into this binary (`scripts/cli-pro-release-keys.json`,
/// `{ "<key id>": "<64 hex chars>" }`). A build with the `test-release-keys`
/// feature reads `IMPECCABLE_PRO_RELEASE_KEYS` (same JSON) instead, so tests
/// and rehearsals can sign with a key they generate. Release builds never
/// enable that feature, so no environment variable can change what a
/// shipped binary trusts.
pub fn pinned_keys(env: &std::collections::HashMap<String, String>) -> Keyring {
    #[cfg(feature = "test-release-keys")]
    if let Some(json) = env.get("IMPECCABLE_PRO_RELEASE_KEYS") {
        return parse_keyring(json).unwrap_or_default();
    }
    let _ = env;
    parse_keyring(include_str!(
        "../../../../scripts/cli-pro-release-keys.json"
    ))
    .unwrap_or_default()
}

pub fn parse_keyring(json: &str) -> Option<Keyring> {
    let raw: BTreeMap<String, String> = serde_json::from_str(json).ok()?;
    raw.into_iter()
        .map(|(id, hex)| Some((id, hex32(&hex)?)))
        .collect()
}

fn hex32(s: &str) -> Option<[u8; 32]> {
    if s.len() != 64
        || !s
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return None;
    }
    let mut out = [0u8; 32];
    for (i, o) in out.iter_mut().enumerate() {
        *o = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

pub fn is_sha256(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn b64(s: &str) -> Option<Vec<u8>> {
    B64.decode(s.trim().trim_end_matches('=')).ok()
}

/// The manifest the release job signs. The signature is detached
/// (`X-Impeccable-Signature`, base64url Ed25519) over these exact bytes.
#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    pub schema: u32,
    pub key_id: String,
    pub engine: String,
    pub target: String,
    pub artifact_revision: u64,
    pub artifact_sha256: String,
    pub size: u64,
    #[serde(default)]
    pub pack_version: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ManifestError {
    BadSignature,
    UnknownKey,
    Malformed,
    /// Signed for another engine version or platform.
    NotForThisEngine,
}

impl std::fmt::Display for ManifestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            ManifestError::BadSignature => "the release signature does not verify",
            ManifestError::UnknownKey => "the release is signed with a key this CLI does not trust",
            ManifestError::Malformed => "the release manifest is malformed",
            ManifestError::NotForThisEngine => {
                "the release is for another engine version or platform"
            }
        })
    }
}

/// Verify the signature over the raw bytes first, then read them.
pub fn verify_manifest(
    bytes: &[u8],
    signature: &str,
    keys: &Keyring,
    engine: &str,
    target: &str,
) -> Result<Manifest, ManifestError> {
    #[derive(Deserialize)]
    struct KeyId {
        key_id: String,
    }
    let key_id = serde_json::from_slice::<KeyId>(bytes)
        .map_err(|_| ManifestError::Malformed)?
        .key_id;
    let key = keys.get(&key_id).ok_or(ManifestError::UnknownKey)?;
    let sig = b64(signature).ok_or(ManifestError::BadSignature)?;
    UnparsedPublicKey::new(&ED25519, key)
        .verify(bytes, &sig)
        .map_err(|_| ManifestError::BadSignature)?;
    let m: Manifest = serde_json::from_slice(bytes).map_err(|_| ManifestError::Malformed)?;
    if m.schema != 1 || !is_sha256(&m.artifact_sha256) || m.size == 0 || m.size > MAX_ARTIFACT_BYTES
    {
        return Err(ManifestError::Malformed);
    }
    if m.engine != engine || m.target != target {
        return Err(ManifestError::NotForThisEngine);
    }
    Ok(m)
}

/// One published lease key (`/.well-known/impeccable-cli-keys.json`).
#[derive(Deserialize, Debug, Clone)]
pub struct Jwk {
    pub kty: String,
    pub crv: String,
    pub x: String,
    pub kid: String,
    #[serde(default)]
    pub alg: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Jwks {
    pub keys: Vec<Jwk>,
}

#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct LeaseClaims {
    pub sub: String,
    pub gid: String,
    pub artifact_sha256: String,
    pub iat: u64,
    pub exp: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum LeaseError {
    /// Signed with a key id the key set does not hold: refetch the keys once.
    UnknownKid,
    Invalid,
    WrongArtifact,
    Expired,
}

impl std::fmt::Display for LeaseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            LeaseError::UnknownKid => "the lease names a key the service has not published",
            LeaseError::Invalid => "the lease does not verify",
            LeaseError::WrongArtifact => "the lease is for another Pro build",
            LeaseError::Expired => "the lease expired",
        })
    }
}

pub fn verify_lease(
    token: &str,
    jwks: &Jwks,
    sha: &str,
    now: u64,
) -> Result<LeaseClaims, LeaseError> {
    #[derive(Deserialize)]
    struct Header {
        alg: String,
        kid: String,
    }
    let mut parts = token.split('.');
    let (Some(h), Some(p), Some(s), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(LeaseError::Invalid);
    };
    let header: Header = b64(h)
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or(LeaseError::Invalid)?;
    if header.alg != "EdDSA" {
        return Err(LeaseError::Invalid);
    }
    let jwk = jwks
        .keys
        .iter()
        .find(|k| k.kid == header.kid)
        .ok_or(LeaseError::UnknownKid)?;
    if jwk.kty != "OKP" || jwk.crv != "Ed25519" || jwk.alg.as_deref().is_some_and(|a| a != "EdDSA")
    {
        return Err(LeaseError::Invalid);
    }
    let x = b64(&jwk.x)
        .filter(|x| x.len() == 32)
        .ok_or(LeaseError::Invalid)?;
    let sig = b64(s).ok_or(LeaseError::Invalid)?;
    UnparsedPublicKey::new(&ED25519, x)
        .verify(format!("{h}.{p}").as_bytes(), &sig)
        .map_err(|_| LeaseError::Invalid)?;
    let claims: LeaseClaims = b64(p)
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or(LeaseError::Invalid)?;
    if claims.artifact_sha256 != sha {
        return Err(LeaseError::WrongArtifact);
    }
    // The service issues at most seven days (docs/CLI-RULE-PACK.md); a lease
    // claiming more, or issued in the future, is not one it made.
    if claims.iat > now + CLOCK_SKEW_SECS
        || claims.exp <= claims.iat
        || claims.exp - claims.iat > MAX_LEASE_SECS
        || claims.exp > now + MAX_LEASE_SECS + CLOCK_SKEW_SECS
    {
        return Err(LeaseError::Invalid);
    }
    if claims.exp <= now {
        return Err(LeaseError::Expired);
    }
    Ok(claims)
}

/// The longest lease the service issues.
pub const MAX_LEASE_SECS: u64 = 7 * 86400;
/// How far this machine's clock may run behind the service's.
const CLOCK_SKEW_SECS: u64 = 300;

#[cfg(test)]
pub mod tests {
    use super::*;
    use ring::rand::SystemRandom;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    pub fn keypair() -> Ed25519KeyPair {
        Ed25519KeyPair::from_pkcs8(
            Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
                .unwrap()
                .as_ref(),
        )
        .unwrap()
    }

    fn lease(key: &Ed25519KeyPair, kid: &str, sha: &str, exp: u64) -> String {
        lease_at(key, kid, sha, 1, exp)
    }

    fn lease_at(key: &Ed25519KeyPair, kid: &str, sha: &str, iat: u64, exp: u64) -> String {
        let h =
            B64.encode(serde_json::json!({ "alg": "EdDSA", "typ": "JWT", "kid": kid }).to_string());
        let p = B64.encode(serde_json::json!({ "sub": "u", "gid": "g", "artifact_sha256": sha, "iat": iat, "exp": exp }).to_string());
        let s = B64.encode(key.sign(format!("{h}.{p}").as_bytes()));
        format!("{h}.{p}.{s}")
    }

    fn jwks(key: &Ed25519KeyPair, kid: &str) -> Jwks {
        Jwks {
            keys: vec![Jwk {
                kty: "OKP".into(),
                crv: "Ed25519".into(),
                x: B64.encode(key.public_key().as_ref()),
                kid: kid.into(),
                alg: Some("EdDSA".into()),
            }],
        }
    }

    #[test]
    fn leases_are_held_to_key_artifact_and_time() {
        // Catches: an expired, foreign, or re-pointed lease keeping the Pro engine on.
        let (key, other) = (keypair(), keypair());
        let sha = "a".repeat(64);
        let set = jwks(&key, "k1");
        assert!(verify_lease(&lease(&key, "k1", &sha, 100), &set, &sha, 99).is_ok());
        for (token, want) in [
            (lease(&key, "k1", &sha, 100), LeaseError::Expired),
            (lease(&key, "k2", &sha, 1000), LeaseError::UnknownKid),
            (lease(&other, "k1", &sha, 1000), LeaseError::Invalid),
            (
                lease(&key, "k1", &"b".repeat(64), 1000),
                LeaseError::WrongArtifact,
            ),
        ] {
            assert_eq!(verify_lease(&token, &set, &sha, 100), Err(want));
        }
    }

    #[test]
    fn a_lease_longer_than_the_service_issues_is_refused() {
        // Catches: a lease minted with decades of offline life, or dated in the future.
        let key = keypair();
        let sha = "a".repeat(64);
        let set = jwks(&key, "k1");
        let now = 1_000_000_000;
        let week = MAX_LEASE_SECS;
        assert!(verify_lease(
            &lease_at(&key, "k1", &sha, now, now + week),
            &set,
            &sha,
            now
        )
        .is_ok());
        for (iat, exp) in [
            (now, now + week + 1),
            (now - 10 * week, now + 40 * 365 * 86400),
            (now + 3600, now + 7200),
            (now, now),
        ] {
            assert_eq!(
                verify_lease(&lease_at(&key, "k1", &sha, iat, exp), &set, &sha, now),
                Err(LeaseError::Invalid),
                "iat {iat} exp {exp}"
            );
        }
    }

    #[test]
    fn manifests_verify_only_under_a_pinned_key_for_this_engine() {
        // Catches: a manifest with a bad signature or for another platform being trusted.
        let key = keypair();
        let keys = Keyring::from([(
            "r1".to_string(),
            key.public_key().as_ref().try_into().unwrap(),
        )]);
        let body = |target: &str| {
            serde_json::json!({ "schema": 1, "key_id": "r1", "engine": "1.0.0", "target": target, "artifact_revision": 1, "artifact_sha256": "c".repeat(64), "size": 10 })
                .to_string()
                .into_bytes()
        };
        let sign = |b: &[u8]| B64.encode(key.sign(b));
        let good = body("linux-x64");
        assert!(verify_manifest(&good, &sign(&good), &keys, "1.0.0", "linux-x64").is_ok());
        let tampered = String::from_utf8(good.clone())
            .unwrap()
            .replace("\"size\":10", "\"size\":11")
            .into_bytes();
        assert_eq!(
            verify_manifest(&tampered, &sign(&good), &keys, "1.0.0", "linux-x64"),
            Err(ManifestError::BadSignature)
        );
        let other = body("darwin-arm64");
        assert_eq!(
            verify_manifest(&other, &sign(&other), &keys, "1.0.0", "linux-x64"),
            Err(ManifestError::NotForThisEngine)
        );
        assert_eq!(
            verify_manifest(&good, &sign(&good), &Keyring::new(), "1.0.0", "linux-x64"),
            Err(ManifestError::UnknownKey)
        );
    }
}
