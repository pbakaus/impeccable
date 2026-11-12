//! `impeccable walkthrough` against the system's ffmpeg. The conversion tests skip
//! (and say so) where ffmpeg isn't installed; the argument and missing-tool paths
//! always run.
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "impeccable-walkthrough-{name}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    // The CLI reports paths from its real working directory (/private/var on macOS).
    dir.canonicalize().unwrap()
}

fn ffmpeg() -> Option<PathBuf> {
    ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
        .iter()
        .map(|d| Path::new(d).join("ffmpeg"))
        .find(|p| p.is_file() && p.with_file_name("ffprobe").is_file())
}

fn run(cwd: &Path, ffmpeg_dir: Option<&Path>, args: &[&str]) -> (Output, serde_json::Value) {
    let mut c = Command::new(env!("CARGO_BIN_EXE_impeccable"));
    c.arg("walkthrough")
        .args(args)
        .env_clear()
        .current_dir(cwd)
        .stdin(Stdio::null());
    c.env("IMPECCABLE_NO_UPDATE_CHECK", "1");
    // An explicit folder is the only place looked, so "no ffmpeg" is testable anywhere.
    c.env(
        "IMPECCABLE_FFMPEG_DIR",
        ffmpeg_dir.unwrap_or(Path::new("/nonexistent-ffmpeg-dir")),
    );
    let out = c.output().unwrap();
    let v = serde_json::from_slice(&out.stdout).unwrap_or(serde_json::Value::Null);
    (out, v)
}

/// A 3-second 640x361 test clip with a tone, as WebM where the build has VP8, else GIF.
fn recording(dir: &Path, ffmpeg: &Path, seconds: &str) -> PathBuf {
    let webm = dir.join("My Recording.webm");
    let ok = Command::new(ffmpeg)
        .args(["-y", "-v", "error", "-f", "lavfi", "-i"])
        .arg(format!("testsrc=duration={seconds}:size=640x361:rate=15"))
        .args(["-f", "lavfi", "-i"])
        .arg(format!("sine=frequency=440:duration={seconds}"))
        .args(["-c:v", "libvpx", "-c:a", "libvorbis"])
        .arg(&webm)
        .status()
        .is_ok_and(|s| s.success());
    if ok {
        return webm;
    }
    let gif = dir.join("My Recording.gif");
    assert!(Command::new(ffmpeg)
        .args(["-y", "-v", "error", "-f", "lavfi", "-i"])
        .arg(format!("testsrc=duration={seconds}:size=640x361:rate=10"))
        .arg(&gif)
        .status()
        .unwrap()
        .success());
    gif
}

#[test]
fn a_recording_becomes_a_card_ready_walkthrough() {
    // Catches: an agent having to know ffmpeg, faststart, yuv420p, even sizes and the
    // base64url digest to send one walkthrough card.
    let Some(ffmpeg) = ffmpeg() else {
        eprintln!("skipped: ffmpeg not installed");
        return;
    };
    let dir = scratch("convert");
    let input = recording(&dir, &ffmpeg, "3");
    let (out, v) = run(
        &dir,
        ffmpeg.parent(),
        &[
            input.to_str().unwrap(),
            "--chapter",
            "0:02=The end",
            "--chapter",
            "0:01=The middle",
        ],
    );
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(v["ok"], true);
    let film = PathBuf::from(v["film"]["path"].as_str().unwrap());
    assert_eq!(film, dir.join(".impeccable/walkthroughs/My-Recording.mp4"));
    let bytes = std::fs::read(&film).unwrap();
    assert_eq!(v["film"]["bytes"], bytes.len() as u64);
    // Odd source height 361 came out even (yuv420p needs it), and the width was not upscaled.
    assert_eq!(
        (v["film"]["width"].clone(), v["film"]["height"].clone()),
        (640.into(), 362.into())
    );
    // The digest is the one needs_you.post wants: SHA-256, base64url, no padding.
    use base64::Engine;
    use sha2::Digest;
    let digest =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(sha2::Sha256::digest(&bytes));
    assert_eq!(v["film"]["sha256"], digest);
    assert_eq!(digest.len(), 43);
    // faststart: the moov atom comes before the media data.
    let find = |tag: &[u8]| bytes.windows(4).position(|w| w == tag).unwrap();
    assert!(
        find(b"moov") < find(b"mdat"),
        "moov must lead for streaming"
    );
    // H.264, and the tone is gone.
    let probe = Command::new(ffmpeg.with_file_name("ffprobe"))
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,codec_name",
            "-of",
            "csv=p=0",
        ])
        .arg(&film)
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&probe.stdout).trim(), "h264,video");
    // The poster is a real PNG, and chapters come back sorted in milliseconds.
    let poster = std::fs::read(v["poster"]["path"].as_str().unwrap()).unwrap();
    assert_eq!(&poster[..8], b"\x89PNG\r\n\x1a\n");
    assert_eq!(v["poster"]["atMs"], 1000);
    assert_eq!(
        v["post"]["interaction"]["chapters"],
        serde_json::json!([{ "at": 1000, "text": "The middle" }, { "at": 2000, "text": "The end" }])
    );
    assert_eq!(
        v["post"]["attachments"][0],
        serde_json::json!({ "id": "film", "format": "mp4", "bytes": bytes.len(), "sha256": digest })
    );
    assert_eq!(v["post"]["interaction"]["kind"], "walkthrough");
    // The output folder ignores itself, so a recording never reaches a commit.
    let ignore = std::fs::read_to_string(dir.join(".impeccable/walkthroughs/.gitignore")).unwrap();
    assert!(ignore.lines().any(|l| l.trim() == "*"), "{ignore}");
}

#[test]
fn limits_are_named_before_any_work_is_wasted() {
    let Some(ffmpeg) = ffmpeg() else {
        eprintln!("skipped: ffmpeg not installed");
        return;
    };
    let dir = scratch("limits");
    let input = recording(&dir, &ffmpeg, "3");
    let (out, v) = run(
        &dir,
        ffmpeg.parent(),
        &[input.to_str().unwrap(), "--chapter", "0:09=Too late"],
    );
    assert!(!out.status.success());
    assert_eq!(v["error"], "bad_chapter");
    assert_eq!(
        v["message"],
        "The chapter \"Too late\" is at 0:09, after the recording ends at 0:03."
    );
    assert!(
        !dir.join(".impeccable").exists(),
        "nothing is written for a refused request"
    );
    // Not a recording at all.
    std::fs::write(dir.join("notes.txt"), "hello").unwrap();
    let (out, v) = run(&dir, ffmpeg.parent(), &["notes.txt"]);
    assert!(!out.status.success());
    assert_eq!(v["error"], "unreadable");
}

#[test]
fn a_missing_ffmpeg_gets_the_install_line_and_bad_input_a_plain_reason() {
    let dir = scratch("missing");
    std::fs::write(dir.join("clip.webm"), "not really").unwrap();
    let (out, v) = run(&dir, None, &["clip.webm"]);
    assert!(!out.status.success());
    assert_eq!(v["error"], "ffmpeg_missing");
    let message = v["message"].as_str().unwrap();
    assert!(
        message.starts_with(
            "Making a walkthrough needs ffmpeg, which isn't installed here. Install it with: "
        ),
        "{message}"
    );
    let (_, v) = run(&dir, None, &["nope.webm"]);
    assert_eq!(v["error"], "not_found");
    let (_, v) = run(&dir, None, &["clip.webm", "--chapter", "soon=Text"]);
    assert_eq!(v["error"], "bad_chapter");
}
