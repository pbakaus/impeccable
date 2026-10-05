//! The approved comp as a fixed reference.
//!
//! Every comp-led gate measures against the comp the user approved. The comp
//! sits at an editable path under `.impeccable/mocks/`, so an agent can edit it
//! (composite its own plates into it, regenerate it) until the reference matches
//! the work, and then re-run `comp-spec` to move the spec's `compSha256` along
//! with it. This module keeps the approved pixels out of reach of that loop:
//!
//! - when a comp is approved (`build-phase start --comp`, the comps gate
//!   closing, or the first spec written for the build's comp) the engine keeps a
//!   byte copy at `.impeccable/build/approved-comp.<ext>` and records its pixel
//!   hash (the same identity `comp-spec` writes as `compSha256`) in
//!   `.impeccable/build/approved-comp.json`;
//! - every entry point that measures against the comp calls [`issue`] first and
//!   refuses, without measuring, when the comp's pixels no longer match;
//! - `build-phase restore-comp` puts the kept copy back.
//!
//! Gates refuse rather than silently measure against the copy: the agent, the
//! crop and font tools, the comp-diff verb and the finish reviewer all read the
//! editable path, so the only consistent reference is an editable path that
//! holds the approved pixels. A silent swap would score plates and code against
//! one image while the agent keeps looking at another.

use std::path::{Path, PathBuf};

use impeccable_common::Io;
use impeccable_comp::png_io;
use impeccable_comp::raster::Image;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::comp_spec::{BUILD_DIR, SPEC_PATH};

pub const RECORD_PATH: &str = ".impeccable/build/approved-comp.json";
const COPY_STEM: &str = "approved-comp";

/// The comp identity `comp-spec` records as `compSha256`: dimensions plus
/// decoded RGBA, so a metadata-only rewrite (embed-prompt) keeps the identity.
pub fn pixel_sha256(img: &Image) -> String {
    let mut hasher = Sha256::new();
    hasher.update(img.width.to_le_bytes());
    hasher.update(img.height.to_le_bytes());
    hasher.update(&img.data);
    format!("{:x}", hasher.finalize())
}

fn resolve(io: &Io, p: &str) -> PathBuf {
    let path = Path::new(p);
    if path.is_absolute() { path.to_path_buf() } else { io.cwd.join(path) }
}

pub fn same_file(io: &Io, a: &str, b: &str) -> bool {
    let (a, b) = (resolve(io, a), resolve(io, b));
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => a.components().eq(b.components()),
    }
}

/// The comp as comp-spec, the record and every check see it: decoded from the
/// file's own bytes, never from the sibling PNG cache `load_raster` keeps for a
/// WebP or JPEG source (an edit to the source never refreshes it).
pub fn decode_comp(bytes: &[u8]) -> Option<Image> {
    png_io::decode_source(bytes).ok()
}

fn bytes_pixel_sha256(bytes: &[u8]) -> Option<String> {
    decode_comp(bytes).map(|img| pixel_sha256(&img))
}

/// The pixel hash of the file at `comp`, or `None` when it is missing or not a
/// decodable image (the callers' own unreadable-comp handling speaks then).
pub fn file_pixel_sha256(io: &Io, comp: &str) -> Option<String> {
    bytes_pixel_sha256(&std::fs::read(resolve(io, comp)).ok()?)
}

fn load_record(io: &Io) -> Option<Value> {
    let raw = std::fs::read_to_string(resolve(io, RECORD_PATH)).ok()?;
    serde_json::from_str::<Value>(&raw).ok().filter(|r| r["comp"].is_string() && r["pixelSha256"].is_string())
}

/// The record for `comp`, when the engine kept one for that file.
fn record_for(io: &Io, comp: &str) -> Option<Value> {
    load_record(io).filter(|r| same_file(io, r["comp"].as_str().unwrap_or(""), comp))
}

/// Keep a byte copy of `comp` as the approved reference and record its hash.
/// `Ok(None)` when the file cannot be read or decoded (nothing to keep);
/// `Err` when the copy or record cannot be written, which approval refuses on.
pub fn keep(io: &Io, comp: &str) -> Result<Option<Value>, String> {
    let Ok(bytes) = std::fs::read(resolve(io, comp)) else { return Ok(None) };
    let Some(pixels) = bytes_pixel_sha256(&bytes) else { return Ok(None) };
    let ext = Path::new(comp).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase)
        .filter(|e| e.chars().all(|c| c.is_ascii_alphanumeric())).unwrap_or_else(|| "png".into());
    let copy = format!("{BUILD_DIR}/{COPY_STEM}.{ext}");
    let failed = |what: &str, e: std::io::Error| format!("cannot keep the approved comp: writing {what} failed ({e})");
    std::fs::create_dir_all(resolve(io, BUILD_DIR)).map_err(|e| failed(BUILD_DIR, e))?;
    std::fs::write(resolve(io, &copy), &bytes).map_err(|e| failed(&copy, e))?;
    let record = json!({
        "comp": comp,
        "pixelSha256": pixels,
        "fileSha256": format!("{:x}", Sha256::digest(&bytes)),
        "copy": copy,
        "at": crate::util::iso_now(),
    });
    std::fs::write(resolve(io, RECORD_PATH), crate::util::json_pretty(&record)).map_err(|e| failed(RECORD_PATH, e))?;
    Ok(Some(record))
}

/// Forget the kept reference (a build restarted on a new comp round).
pub fn forget(io: &Io) {
    let _ = std::fs::remove_file(resolve(io, RECORD_PATH));
}

/// Whether the kept copy still decodes to the recorded hash.
fn copy_intact(io: &Io, record: &Value) -> Option<String> {
    let copy = record["copy"].as_str()?;
    (file_pixel_sha256(io, copy).as_deref() == record["pixelSha256"].as_str()).then(|| copy.to_string())
}

const FIXED: &str = "The approved comp is the fixed reference every gate measures against; never edit it, composite into it, or regenerate it.";

fn remedy(io: &Io, record: Option<&Value>, s: &str) -> String {
    match record.and_then(|r| copy_intact(io, r)) {
        Some(copy) => format!("Restore it with {s} build-phase restore-comp (the engine kept the approved copy at {copy}), then regenerate the plates or change the page code until they match the unchanged comp."),
        None => "No intact engine copy exists for this build: restore the approved file from its original source, then regenerate the plates or change the page code until they match the unchanged comp.".to_string(),
    }
}

fn changed_message(io: &Io, comp: &str, expected: &str, actual: Option<&str>, record: Option<&Value>, s: &str) -> String {
    let found = match actual {
        Some(actual) => format!("has changed since approval: expected pixel sha256 {expected}, found {actual}"),
        None => format!("is missing or not a decodable image: expected pixel sha256 {expected}"),
    };
    format!("the approved comp {comp} {found}. {FIXED} Nothing was measured against the changed file. {}", remedy(io, record, s))
}

/// The refusal owed before anything measures against the spec's comp, or
/// `None` when the comp still holds the approved pixels (or has no recorded
/// identity at all: no comp, or a legacy spec with neither a record nor a
/// `compSha256`). It writes nothing; [`build_issue`] keeps a build's first copy.
/// [`issue`] for the spec read from `spec_path`: the build's own spec gets
/// [`build_issue`], any other spec only the pixel check for the comp it names.
pub fn issue_at(io: &Io, spec: &Value, spec_path: &str, s: &str) -> Option<String> {
    if same_file(io, spec_path, SPEC_PATH) { build_issue(io, spec, s) } else { issue(io, spec, s) }
}

/// [`issue`] for the build's own spec (`.impeccable/build/spec.json`): it must
/// also measure the recorded approved comp, not another file (a composite
/// saved under a new name and re-specced is not the build's reference).
pub fn build_issue(io: &Io, spec: &Value, s: &str) -> Option<String> {
    let comp = spec.get("comp").and_then(Value::as_str)?;
    if record_for(io, comp).is_none() {
        if let Some(other) = load_record(io) {
            let approved = other["comp"].as_str().unwrap_or("");
            return Some(format!(
                "{SPEC_PATH} measures {comp}, but the approved comp is {approved}. {FIXED} Re-run {s} comp-spec --comp {approved} --regions <regions file> on the approved comp; a comp the user newly approves is saved under a new file name and started with {s} build-phase start --reset --comp <new file>."
            ));
        }
    }
    let why = issue(io, spec, s);
    // A build with no kept copy yet gets one here, from its own spec only and
    // only once the comp matches it; never from a spec at another path.
    if why.is_none() && load_record(io).is_none() && spec.get("compSha256").and_then(Value::as_str).is_some() {
        let _ = keep(io, comp);
    }
    why
}

pub fn issue(io: &Io, spec: &Value, s: &str) -> Option<String> {
    let comp = spec.get("comp").and_then(Value::as_str)?;
    let spec_hash = spec.get("compSha256").and_then(Value::as_str);
    let record = record_for(io, comp);
    if record.is_none() && spec_hash.is_none() { return None; }
    let actual = file_pixel_sha256(io, comp);
    match record {
        Some(record) => {
            let expected = record["pixelSha256"].as_str().unwrap_or("");
            if actual.as_deref() != Some(expected) {
                return Some(changed_message(io, comp, expected, actual.as_deref(), Some(&record), s));
            }
            match spec_hash {
                Some(hash) if hash != expected => Some(format!(
                    "{SPEC_PATH} was measured on an image that is not the approved comp (spec compSha256 {hash}, approved {expected}): re-measuring an edited comp does not move the reference. {FIXED} Re-run {s} comp-spec --comp {comp} --regions <regions file> on the approved comp, then regenerate the plates or change the page code until they match it."
                )),
                _ => None,
            }
        }
        None => {
            let expected = spec_hash?;
            if actual.as_deref() != Some(expected) {
                return Some(changed_message(io, comp, expected, actual.as_deref(), None, s));
            }
            None
        }
    }
}

/// The refusal for a comparison against `comp` with no spec that names it:
/// only a record kept for that file can say what its pixels should be.
pub fn issue_for_comp(io: &Io, comp: &str, s: &str) -> Option<String> {
    let record = record_for(io, comp)?;
    let expected = record["pixelSha256"].as_str().unwrap_or("");
    let actual = file_pixel_sha256(io, comp);
    (actual.as_deref() != Some(expected)).then(|| changed_message(io, comp, expected, actual.as_deref(), Some(&record), s))
}

/// `comp-spec --regions` on the build's comp: refuse to re-measure a comp whose
/// pixels differ from the approved ones, and keep the reference when the build
/// has none yet. `actual` is the pixel hash of the comp comp-spec read and
/// `previous` the spec it is about to replace: a build that predates the record
/// is checked against that spec's `compSha256` before its pixels are kept. A
/// comp no build state names (a mapping-only run) is not guarded.
pub fn spec_refusal(io: &Io, comp: &str, actual: &str, previous: Option<&Value>, s: &str) -> Option<String> {
    let state = std::fs::read_to_string(resolve(io, &format!("{BUILD_DIR}/state.json"))).ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())?;
    if !state["comp"].as_str().is_some_and(|c| same_file(io, c, comp)) { return None; }
    if let Some(record) = record_for(io, comp) {
        let expected = record["pixelSha256"].as_str().unwrap_or("");
        return (actual != expected).then(|| changed_message(io, comp, expected, Some(actual), Some(&record), s));
    }
    let measured = previous.filter(|p| p["comp"].as_str().is_some_and(|c| same_file(io, c, comp)))
        .and_then(|p| p["compSha256"].as_str());
    if let Some(expected) = measured.filter(|h| *h != actual) {
        return Some(changed_message(io, comp, expected, Some(actual), None, s));
    }
    keep(io, comp).err().map(|e| format!("{e}; the build cannot fix its reference, so nothing was measured. Make {BUILD_DIR} writable and re-run."))
}

/// `build-phase start --reset --comp` on the file the engine kept as approved,
/// now holding other pixels: a newly approved comp gets a new file name, so
/// reusing the approved name for different pixels is refused.
pub fn restart_refusal(io: &Io, comp: &str, s: &str) -> Option<String> {
    let record = record_for(io, comp)?;
    let expected = record["pixelSha256"].as_str().unwrap_or("");
    let actual = file_pixel_sha256(io, comp)?;
    (actual != expected).then(|| format!(
        "{} A comp the user newly approves is saved under a new file name and started with {s} build-phase start --reset --comp <new file>.",
        changed_message(io, comp, expected, Some(&actual), Some(&record), s)
    ))
}

/// `build-phase restore-comp`: put the kept copy back at the comp path. The
/// edited file is moved under the build directory (never into the mocks, where
/// the comps gate would count it as a comp). Returns the message and exit code.
pub fn restore(io: &Io) -> (String, i32) {
    let Some(record) = load_record(io) else {
        return (format!("build-phase: restore-comp found no approved copy ({RECORD_PATH} is missing): restore the approved comp from its original source.\n"), 1);
    };
    let comp = record["comp"].as_str().unwrap_or("").to_string();
    let expected = record["pixelSha256"].as_str().unwrap_or("").to_string();
    let Some(copy) = copy_intact(io, &record) else {
        return (format!("build-phase: restore-comp refused: the kept copy {} no longer decodes to the approved pixel sha256 {expected}; restore the approved comp from its original source.\n", record["copy"].as_str().unwrap_or("(none)")), 2);
    };
    let current = file_pixel_sha256(io, &comp);
    if current.as_deref() == Some(expected.as_str()) {
        return (format!("comp {comp} already holds the approved pixels (sha256 {expected}); nothing restored\n"), 0);
    }
    let mut aside = None;
    if let Ok(edited) = std::fs::read(resolve(io, &comp)) {
        let tag = current.as_deref().map(|h| &h[..12]).unwrap_or("unreadable");
        let ext = Path::new(&comp).extension().and_then(|e| e.to_str()).unwrap_or("png");
        let path = format!("{BUILD_DIR}/edited-comp-{tag}.{ext}");
        if std::fs::write(resolve(io, &path), edited).is_err() {
            return (format!("build-phase: restore-comp could not keep the edited file at {path}; nothing restored\n"), 1);
        }
        aside = Some(path);
    }
    let bytes = match std::fs::read(resolve(io, &copy)) { Ok(b) => b, Err(e) => return (format!("build-phase: restore-comp cannot read {copy}: {e}\n"), 1) };
    if let Some(parent) = resolve(io, &comp).parent() { let _ = std::fs::create_dir_all(parent); }
    if let Err(e) = std::fs::write(resolve(io, &comp), bytes) {
        return (format!("build-phase: restore-comp cannot write {comp}: {e}\n"), 1);
    }
    let kept = aside.map(|p| format!(" The edited file is kept at {p} as evidence, not as a comp.")).unwrap_or_default();
    (format!("RESTORED {comp} from {copy} (pixel sha256 {expected}).{kept} Re-run the step that refused; plates and page code built against the edited comp now have to match the approved one.\n"), 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use impeccable_comp::raster as r;

    fn ws() -> (Io, PathBuf) {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("impeccable-approved-comp-{}-{}", std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".impeccable/mocks")).unwrap();
        let (io, _) = Io::captured("", dir.clone(), Default::default());
        (io, dir)
    }

    fn png(color: [u8; 4]) -> Vec<u8> {
        png_io::encode_png(&r::create_image(8, 8, color), &[]).unwrap()
    }

    const COMP: &str = ".impeccable/mocks/comp-1.png";

    #[test]
    fn unchanged_comp_passes_and_a_metadata_rewrite_keeps_the_identity() {
        let (io, dir) = ws();
        std::fs::write(dir.join(COMP), png([10, 20, 30, 255])).unwrap();
        let record = keep(&io, COMP).unwrap().unwrap();
        let spec = json!({"comp": COMP, "compSha256": record["pixelSha256"]});
        assert_eq!(issue(&io, &spec, "impeccable"), None);
        let tagged = png_io::encode_png(&r::create_image(8, 8, [10, 20, 30, 255]), &[("prompt".into(), "x".into())]).unwrap();
        std::fs::write(dir.join(COMP), tagged).unwrap();
        assert_eq!(issue(&io, &spec, "impeccable"), None);
    }

    #[test]
    fn an_edited_comp_is_refused_with_both_hashes_and_restored_from_the_copy() {
        let (io, dir) = ws();
        std::fs::write(dir.join(COMP), png([10, 20, 30, 255])).unwrap();
        let record = keep(&io, COMP).unwrap().unwrap();
        let expected = record["pixelSha256"].as_str().unwrap().to_string();
        let spec = json!({"comp": COMP, "compSha256": expected});
        std::fs::write(dir.join(COMP), png([200, 20, 30, 255])).unwrap();
        let actual = file_pixel_sha256(&io, COMP).unwrap();
        let why = issue(&io, &spec, "impeccable").unwrap();
        assert!(why.contains(&expected) && why.contains(&actual), "{why}");
        assert!(why.contains("never edit it, composite into it, or regenerate it"), "{why}");
        assert!(why.contains("impeccable build-phase restore-comp"), "{why}");
        let (message, code) = restore(&io);
        assert_eq!(code, 0, "{message}");
        assert_eq!(file_pixel_sha256(&io, COMP).unwrap(), expected);
        assert!(dir.join(format!(".impeccable/build/edited-comp-{}.png", &actual[..12])).exists());
        assert_eq!(issue(&io, &spec, "impeccable"), None);
        assert_eq!(restore(&io).1, 0);
    }

    #[test]
    fn a_spec_remeasured_on_an_edited_comp_does_not_move_the_reference() {
        let (io, dir) = ws();
        std::fs::write(dir.join(COMP), png([10, 20, 30, 255])).unwrap();
        let record = keep(&io, COMP).unwrap().unwrap();
        let spec = json!({"comp": COMP, "compSha256": "0".repeat(64)});
        let why = issue(&io, &spec, "impeccable").unwrap();
        assert!(why.contains("not the approved comp") && why.contains(record["pixelSha256"].as_str().unwrap()), "{why}");
    }

    #[test]
    fn a_legacy_build_keeps_its_copy_on_first_check_and_refuses_without_one() {
        let (io, dir) = ws();
        std::fs::write(dir.join(COMP), png([10, 20, 30, 255])).unwrap();
        let hash = file_pixel_sha256(&io, COMP).unwrap();
        let spec = json!({"comp": COMP, "compSha256": hash});
        assert_eq!(issue(&io, &spec, "impeccable"), None);
        assert!(!dir.join(RECORD_PATH).exists(), "a spec at another path never pins the reference");
        assert_eq!(build_issue(&io, &spec, "impeccable"), None);
        assert!(dir.join(RECORD_PATH).exists() && dir.join(".impeccable/build/approved-comp.png").exists());
        forget(&io);
        std::fs::write(dir.join(COMP), png([1, 2, 3, 255])).unwrap();
        let why = issue(&io, &spec, "impeccable").unwrap();
        assert!(why.contains("No intact engine copy"), "{why}");
        assert_eq!(restore(&io).1, 1);
        // No recorded identity at all: nothing to check against.
        assert_eq!(issue(&io, &json!({"comp": COMP}), "impeccable"), None);
    }

    #[test]
    fn a_damaged_copy_is_never_restored() {
        let (io, dir) = ws();
        std::fs::write(dir.join(COMP), png([10, 20, 30, 255])).unwrap();
        keep(&io, COMP).unwrap().unwrap();
        std::fs::write(dir.join(".impeccable/build/approved-comp.png"), png([9, 9, 9, 255])).unwrap();
        std::fs::write(dir.join(COMP), png([200, 20, 30, 255])).unwrap();
        assert_eq!(restore(&io).1, 2);
        assert_eq!(file_pixel_sha256(&io, COMP), Some(pixel_sha256(&r::create_image(8, 8, [200, 20, 30, 255]))));
    }
}
