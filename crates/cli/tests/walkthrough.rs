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
    // The server refuses a walkthrough without an approve label; a default is always there.
    assert_eq!(
        v["post"]["interaction"]["ship"],
        serde_json::json!({ "label": "Looks right" })
    );
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
    // No recording at all is still one JSON object on stdout.
    let (out, v) = run(&dir, None, &[]);
    assert!(!out.status.success());
    assert_eq!(v["error"], "usage");
    let (_, v) = run(&dir, None, &["clip.webm", "--chapter", "soon=Text"]);
    assert_eq!(v["error"], "bad_chapter");
    // The card wants strictly increasing chapters and a short approve label.
    let (_, v) = run(
        &dir,
        None,
        &["clip.webm", "--chapter", "0:04=One", "--chapter", "4=Two"],
    );
    assert_eq!(
        v["message"],
        "Two chapters share 0:04: \"One\" and \"Two\". Give each its own moment."
    );
    let long = "x".repeat(41);
    let (_, v) = run(&dir, None, &["clip.webm", "--ship", &long]);
    assert_eq!(v["error"], "usage");
}

#[test]
fn the_recording_itself_is_never_overwritten_or_deleted() {
    // Catches: `walkthrough clip.mp4 --out .` pointing the film at its own input, where
    // ffmpeg -y truncates it and the failure cleanup then deletes the only copy.
    let Some(ffmpeg) = ffmpeg() else {
        eprintln!("skipped: ffmpeg not installed");
        return;
    };
    let dir = scratch("same-file");
    let clip = dir.join("clip.mp4");
    assert!(Command::new(&ffmpeg)
        .args([
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=2:size=320x240:rate=10"
        ])
        .arg(&clip)
        .status()
        .unwrap()
        .success());
    let before = std::fs::read(&clip).unwrap();
    let (out, v) = run(&dir, ffmpeg.parent(), &["clip.mp4", "--out", "."]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stdout)
    );
    assert_eq!(
        std::fs::read(&clip).unwrap(),
        before,
        "the recording is untouched"
    );
    assert_eq!(
        v["film"]["path"],
        dir.join("clip-walkthrough.mp4").to_str().unwrap()
    );
    // A folder the person named is theirs: no ignore file is written into it.
    assert!(!dir.join(".gitignore").exists());
    // A failing conversion leaves the recording and removes only its own scratch files.
    std::fs::write(dir.join("broken.mp4"), "not a video").unwrap();
    let (_, v) = run(&dir, ffmpeg.parent(), &["broken.mp4", "--out", "."]);
    assert_eq!(v["ok"], false);
    assert_eq!(
        std::fs::read_to_string(dir.join("broken.mp4")).unwrap(),
        "not a video"
    );
    let leftovers: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains(".tmp."))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}

#[test]
fn a_browser_recording_without_a_stated_length_still_converts() {
    // Catches: MediaRecorder-style WebM (no duration in the header) refused as unreadable.
    let Some(ffmpeg) = ffmpeg() else {
        eprintln!("skipped: ffmpeg not installed");
        return;
    };
    let dir = scratch("no-duration");
    // Written to a pipe, the muxer can't seek back to record a duration: the same shape.
    let made = Command::new(&ffmpeg)
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=3:size=320x240:rate=10",
        ])
        .args(["-c:v", "libvpx", "-f", "webm", "pipe:1"])
        .output()
        .unwrap();
    if !made.status.success() || made.stdout.is_empty() {
        eprintln!("skipped: this ffmpeg has no VP8 encoder");
        return;
    }
    std::fs::write(dir.join("live.webm"), &made.stdout).unwrap();
    let probe = Command::new(ffmpeg.with_file_name("ffprobe"))
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
        ])
        .arg(dir.join("live.webm"))
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&probe.stdout).trim(),
        "N/A",
        "the fixture must lack a duration"
    );
    let (out, v) = run(
        &dir,
        ffmpeg.parent(),
        &["live.webm", "--chapter", "0:02=Near the end"],
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stdout)
    );
    let ms = v["film"]["durationMs"].as_u64().unwrap();
    assert!((2500..=3500).contains(&ms), "{ms}");
    // With no stated length, a chapter past the end is still caught, on the film itself.
    let (_, v) = run(
        &dir,
        ffmpeg.parent(),
        &["live.webm", "--chapter", "0:30=Too late"],
    );
    assert_eq!(v["error"], "bad_chapter");
    assert!(!dir.join(".impeccable/walkthroughs/live.mp4.tmp").exists());
}

#[test]
fn a_chapter_at_the_exact_end_is_clamped_to_the_last_millisecond() {
    let Some(ffmpeg) = ffmpeg() else {
        eprintln!("skipped: ffmpeg not installed");
        return;
    };
    let dir = scratch("end-chapter");
    let clip = dir.join("clip.mp4");
    assert!(Command::new(&ffmpeg)
        .args([
            "-y", "-v", "error", "-f", "lavfi", "-i",
            "testsrc=duration=2:size=320x240:rate=10",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
        ])
        .arg(&clip)
        .status()
        .unwrap()
        .success());
    let (out, v) = run(
        &dir,
        ffmpeg.parent(),
        &["clip.mp4", "--chapter", "0:01=Middle", "--chapter", "0:02=End"],
    );
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
    let last_ms = v["film"]["durationMs"].as_u64().unwrap() - 1;
    assert_eq!(v["chapters"][1]["at"], last_ms);
    assert_eq!(v["post"]["interaction"]["chapters"][1]["at"], last_ms);
    assert_eq!(v["chapters"][0]["at"], 1000);
    // The source probe also permits small container drift before the encode.
    let (out, v) = run(
        &dir,
        ffmpeg.parent(),
        &["clip.mp4", "--chapter", "0:02.2=End"],
    );
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
    assert_eq!(v["chapters"][0]["at"], last_ms);
    // Clamping two distinct timestamps to the same moment must still fail.
    let (out, v) = run(
        &dir,
        ffmpeg.parent(),
        &["clip.mp4", "--chapter", "0:01.999=Before end", "--chapter", "0:02=End"],
    );
    assert!(!out.status.success());
    assert_eq!(v["error"], "bad_chapter");
    // A first chapter at 0:00 keeps its time, but the poster skips the usually blank first frame.
    let (out, v) = run(&dir, ffmpeg.parent(), &["clip.mp4", "--chapter", "0:00=Start"]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
    assert_eq!(v["chapters"][0]["at"], 0);
    assert_eq!(v["poster"]["atMs"], 1000);
}

#[cfg(unix)]
#[test]
fn an_overlong_browser_recording_is_bounded_and_rejected_without_trimming() {
    use std::os::unix::fs::{symlink, PermissionsExt};

    let Some(ffmpeg) = ffmpeg() else {
        eprintln!("skipped: ffmpeg not installed");
        return;
    };
    let dir = scratch("bounded-no-duration");
    // Tiny frames keep the real encode cheap, while the piped WebM has no duration.
    let made = Command::new(&ffmpeg)
        .args([
            "-v", "error", "-f", "lavfi", "-i",
            "testsrc=duration=125:size=16x16:rate=10",
            "-c:v", "libvpx", "-f", "webm", "pipe:1",
        ])
        .output()
        .unwrap();
    if !made.status.success() || made.stdout.is_empty() {
        eprintln!("skipped: this ffmpeg has no VP8 encoder");
        return;
    }
    let input = dir.join("long.webm");
    std::fs::write(&input, &made.stdout).unwrap();
    let probe = Command::new(ffmpeg.with_file_name("ffprobe"))
        .args(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0"])
        .arg(&input)
        .output()
        .unwrap();
    assert!(probe.status.success());
    assert_eq!(String::from_utf8_lossy(&probe.stdout).trim(), "N/A");

    // Record the invocation and delegate to real ffmpeg. Rejection alone would not
    // catch the regression: the old implementation also rejected after encoding all 125s.
    let tools = dir.join("tools");
    std::fs::create_dir(&tools).unwrap();
    symlink(&ffmpeg, tools.join("real-ffmpeg")).unwrap();
    symlink(ffmpeg.with_file_name("ffprobe"), tools.join("ffprobe")).unwrap();
    let wrapper = tools.join("ffmpeg");
    std::fs::write(
        &wrapper,
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$(dirname \"$0\")/args\"\nexec \"$(dirname \"$0\")/real-ffmpeg\" \"$@\"\n",
    ).unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let (out, v) = run(&dir, Some(&tools), &["long.webm"]);
    assert!(!out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
    assert_eq!(v["error"], "too_long");
    let args = std::fs::read_to_string(tools.join("args")).unwrap();
    let args: Vec<_> = args.lines().collect();
    let limit = args.windows(2).find(|w| w[0] == "-t").expect("encode must be bounded");
    assert_eq!(limit[1].parse::<f64>().unwrap(), 121.0);
    let input_arg = args.iter().position(|a| *a == "-i").unwrap();
    let limit_arg = args.iter().position(|a| *a == "-t").unwrap();
    assert!(limit_arg > input_arg + 1, "-t must be an output option");
    let output = dir.join(".impeccable/walkthroughs");
    assert!(std::fs::read_dir(output).unwrap().flatten().all(|e| {
        let name = e.file_name().to_string_lossy().into_owned();
        !name.contains(".tmp.") && !name.ends_with(".mp4") && !name.ends_with(".png")
    }));
}
