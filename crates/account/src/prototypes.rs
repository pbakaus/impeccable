//! Records a live prototyping session once the person accepts a variant
//! (REN-1917): what was prototyped and how many variants, never a picture,
//! code or text of them. Same opt-outs, sign-in and deadline as critique sync.
use crate::critiques::{ready, send, Stop, RELOGIN};
use crate::http::ApiError;
use impeccable_common::Io;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Instant;

/// Nothing on success, signed out, or under an opt-out; at most one line on
/// stderr when it couldn't save, since stdout is the accept's JSON.
/// `accepted_at` is the first accept's time, so a replay records the same moment.
pub fn after_accept(io: &mut Io, session_id: &str, root: &Path, target: &str, variants: u64, accepted_at: (&str, i64)) {
    after_accept_quiet(io, session_id, root, target, variants, accepted_at, false);
}

pub fn after_accept_quiet(io: &mut Io, session_id: &str, root: &Path, target: &str, variants: u64, accepted_at: (&str, i64), quiet: bool) {
    if let Some(reason) = upload(io, session_id, root, target, variants, accepted_at, quiet).filter(|_| !quiet) {
        io.err(&format!("Not saved to Impeccable: {reason}. Run it again to save it.\n"));
    }
}

/// The upload body: exactly the keys the service reads. A retry of the same
/// session in the same project carries the same id, so it records once.
fn body(session_id: &str, root: &Path, target: &str, variants: u64, (at, at_ms): (&str, i64)) -> Option<Value> {
    // The service takes a record made within the last day; an older accept is
    // not news, so it sends nothing (an hour's margin for clock drift).
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as i64;
    if !(now - 23 * 3_600_000..=now + 60_000).contains(&at_ms) {
        return None;
    }
    let target = target.trim();
    if target.is_empty() || target.chars().count() > 200 || target.chars().any(char::is_control) {
        return None;
    }
    if !(1..=24).contains(&variants) {
        return None;
    }
    use sha2::{Digest, Sha256};
    let seed = format!("impeccable-prototype\0{}\0{session_id}", root.to_string_lossy());
    let mut id: [u8; 16] = Sha256::digest(seed.as_bytes())[..16].try_into().ok()?;
    id[6] = (id[6] & 15) | 64;
    id[8] = (id[8] & 63) | 128;
    let h: String = id.iter().map(|b| format!("{b:02x}")).collect();
    Some(json!({
        "prototypeId": format!("{}-{}-{}-{}-{}", &h[..8], &h[8..12], &h[12..16], &h[16..20], &h[20..]),
        "target": target,
        "variants": variants,
        "createdAt": at,
    }))
}

fn upload(io: &mut Io, session_id: &str, root: &Path, target: &str, variants: u64, accepted_at: (&str, i64), quiet: bool) -> Option<String> {
    let started = Instant::now();
    let signed_in = match ready(io, Some(root)) {
        Ok(signed_in) => signed_in,
        Err(Stop::OptOut) => {
            if !quiet {
                if let Some(line) = crate::critiques::opt_out_nudge(io, root) { io.err(&line); }
            }
            return None;
        }
        Err(stop) => return stopped(stop),
    };
    let mut body = body(session_id, root, target, variants, accepted_at)?;
    if let Some((key, _)) = crate::health::critique_repo(&root.to_string_lossy(), &io.env) {
        body["repoKey"] = key.into();
    }
    let answer = match send(io, started, &signed_in, "/cli/v1/prototypes", body, quiet) {
        Ok((answer, _)) => answer,
        Err(stop) => return stopped(stop),
    };
    Some(match answer {
        Ok(v) if matches!(v["outcome"].as_str(), Some("recorded" | "repeat")) => {
            crate::receipt::saved(io, crate::receipt::landed(&v, crate::receipt::page(&signed_in.0, "critiques", None)), quiet);
            return None;
        },
        Ok(_) => "the account service gave an answer this version doesn't read; update with npx impeccable update".into(),
        Err(ApiError::Status { status: 401, .. }) => format!("your sign-in expired; {RELOGIN}"),
        Err(ApiError::Status { status: 403, .. }) => format!("this sign-in can't save prototypes; {RELOGIN}"),
        Err(ApiError::Status { status: 409, .. }) => "it was made before you deleted your critique history".into(),
        Err(ApiError::Status { status: 429, .. }) => "you've reached the upload limit".into(),
        Err(ApiError::Status { status: 400 | 413, .. }) => "the account service refused it; update with npx impeccable update".into(),
        Err(ApiError::Status { .. }) => "Impeccable had a problem".into(),
        Err(ApiError::Network(_)) => "Impeccable couldn't be reached".into(),
    })
}

fn stopped(stop: Stop) -> Option<String> {
    Some(match stop {
        Stop::Silent | Stop::OptOut | Stop::SignedOut(_) => return None,
        Stop::NoAccount(e) => e,
        Stop::Slow => "Impeccable took too long to answer".into(),
        Stop::Unreadable => format!("your sign-in couldn't be read; {RELOGIN}"),
        Stop::Expired => format!("your sign-in expired; {RELOGIN}"),
        Stop::Switched => "you signed in or out while it was saving".into(),
        Stop::Busy => "another upload was running".into(),
        Stop::NoScope => format!("this sign-in can't save prototypes; {RELOGIN}"),
    })
}

