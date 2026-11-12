//! `impeccable walkthrough <recording> [--chapter M:SS=Text]... [--ship Label] [--out <dir>]`
//!
//! Turns whatever an agent's browser tool recorded (WebM, GIF, MOV, MP4) into
//! what a Needs you walkthrough card takes: a faststart H.264 MP4 with no
//! audio, a poster still, and the attachment fields `needs_you.post` asks for
//! (bytes, and the film's SHA-256 as base64url without padding). The agent
//! never has to know ffmpeg; the system's ffmpeg does the work, and a missing
//! one gets the exact install line.
//!
//! Output is one JSON object on stdout, success or failure, like the live
//! verbs: `post` inside it is ready to merge into the `needs_you.post` call.
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use impeccable_common::Io;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const USAGE: &str = "Usage: impeccable walkthrough <recording> [--chapter M:SS=Text]... [--ship Label] [--out <dir>]\n\nConverts a screen recording (webm, gif, mov, mp4) into a Needs you walkthrough:\nan H.264 MP4 with no audio, a poster still, and the fields needs_you.post wants.\nChapters mark the moments that matter, for example --chapter 0:04=\"Adding to the cart\".\n";

/// The card's limits (the Needs you server enforces the same ones).
const MAX_SECONDS: f64 = 120.0;
const MAX_FILM_BYTES: u64 = 50_000_000;
const MAX_CHAPTERS: usize = 12;
const MAX_CHAPTER_TEXT: usize = 200;
const MAX_SHIP_LABEL: usize = 40;
/// The approve button's label unless `--ship` names another.
const DEFAULT_SHIP: &str = "Looks right";

/// One encode attempt: the widest frame it keeps, and x264's quality factor.
const ATTEMPTS: [(u32, u32); 2] = [(1920, 23), (1280, 30)];

#[derive(Debug, PartialEq)]
struct Chapter {
    at_ms: u64,
    text: String,
}

/// `M:SS=Text`, `H:MM:SS=Text` or `SS=Text` (seconds may carry a fraction).
fn parse_chapter(raw: &str) -> Result<Chapter, String> {
    let bad =
        || format!("--chapter wants M:SS=Text, like 0:04=\"Adding to the cart\"; got \"{raw}\".");
    let (time, text) = raw.split_once('=').ok_or_else(bad)?;
    let text = text.trim();
    if text.is_empty()
        || text.chars().count() > MAX_CHAPTER_TEXT
        || text.chars().any(char::is_control)
    {
        return Err(format!(
            "A chapter's text is 1 to {MAX_CHAPTER_TEXT} characters on one line; got \"{raw}\"."
        ));
    }
    let parts: Vec<&str> = time.trim().split(':').collect();
    if parts.is_empty() || parts.len() > 3 {
        return Err(bad());
    }
    let mut seconds = 0f64;
    for (i, part) in parts.iter().enumerate() {
        let last = i == parts.len() - 1;
        let value: f64 = if last {
            part.parse().map_err(|_| bad())?
        } else {
            part.parse::<u32>().map_err(|_| bad())? as f64
        };
        if !value.is_finite() || value < 0.0 || (i > 0 && value >= 60.0) {
            return Err(bad());
        }
        seconds = seconds * 60.0 + value;
    }
    Ok(Chapter {
        at_ms: (seconds * 1000.0).round() as u64,
        text: text.to_string(),
    })
}

fn clock(ms: u64) -> String {
    format!("{}:{:02}", ms / 60_000, (ms % 60_000) / 1000)
}

/// ffmpeg or ffprobe: `IMPECCABLE_FFMPEG_DIR` when set, else PATH, else the
/// usual install folders (an agent's shell often has a thin PATH).
fn tool(io: &Io, name: &str) -> Option<PathBuf> {
    let file = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(dir) = io.env("IMPECCABLE_FFMPEG_DIR").filter(|d| !d.is_empty()) {
        // An explicit folder is the only place looked: tests and locked-down setups rely on it.
        return Some(PathBuf::from(dir).join(&file)).filter(|p| p.is_file());
    }
    if let Some(path) = io.env("PATH") {
        dirs.extend(std::env::split_paths(path).filter(|d| d.is_absolute()));
    }
    for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        dirs.push(PathBuf::from(extra));
    }
    dirs.into_iter()
        .map(|d| d.join(&file))
        .find(|p| p.is_file())
}

fn install_hint() -> &'static str {
    if cfg!(target_os = "macos") {
        "brew install ffmpeg"
    } else if cfg!(windows) {
        "winget install Gyan.FFmpeg"
    } else {
        "sudo apt install ffmpeg (or your distribution's ffmpeg package)"
    }
}

fn run_tool(tool: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let out = Command::new(tool)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("couldn't run {}: {e}", tool.display()))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let last = err
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("no output");
        return Err(last.trim().chars().take(300).collect());
    }
    Ok(out.stdout)
}

/// What ffprobe says about a file: seconds, the first video stream's codec
/// and size, and whether any audio stream is present.
struct Probe {
    /// None when the container doesn't say (a browser MediaRecorder WebM often doesn't).
    seconds: Option<f64>,
    codec: String,
    width: u64,
    height: u64,
    audio: bool,
}

fn probe(ffprobe: &Path, file: &Path) -> Result<Probe, String> {
    let out = run_tool(
        ffprobe,
        &[
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,codec_name,width,height:format=duration",
            "-of",
            "json",
            &file.to_string_lossy(),
        ],
    )?;
    let v: Value =
        serde_json::from_slice(&out).map_err(|_| "ffprobe's answer wasn't JSON".to_string())?;
    let streams = v["streams"].as_array().cloned().unwrap_or_default();
    let video = streams
        .iter()
        .find(|s| s["codec_type"] == "video")
        .ok_or("the file has no video")?;
    let seconds = v["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse::<f64>().ok())
        .filter(|d| d.is_finite() && *d > 0.0);
    Ok(Probe {
        seconds,
        codec: video["codec_name"].as_str().unwrap_or("").to_string(),
        width: video["width"].as_u64().unwrap_or(0),
        height: video["height"].as_u64().unwrap_or(0),
        audio: streams.iter().any(|s| s["codec_type"] == "audio"),
    })
}

fn fail(io: &mut Io, error: &str, message: String) -> i32 {
    io.out(&format!(
        "{}\n",
        json!({ "ok": false, "error": error, "message": message })
    ));
    1
}

pub(crate) fn run(args: &[String], io: &mut Io) -> i32 {
    let mut input = None;
    let mut out_dir = None;
    let mut chapters = Vec::new();
    let mut ship = DEFAULT_SHIP.to_string();
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "--help" | "-h" => {
                io.out(USAGE);
                return 0;
            }
            "--chapter" => match rest.next().map(|c| parse_chapter(c)) {
                Some(Ok(c)) => chapters.push(c),
                Some(Err(e)) => return fail(io, "bad_chapter", e),
                None => return fail(io, "bad_chapter", "--chapter needs M:SS=Text.".into()),
            },
            "--ship" => match rest.next().map(|l| l.trim().to_string()) {
                Some(l) if (1..=MAX_SHIP_LABEL).contains(&l.chars().count()) && !l.chars().any(char::is_control) => {
                    ship = l
                }
                _ => {
                    return fail(
                        io,
                        "usage",
                        format!("--ship takes the approve button's label, 1 to {MAX_SHIP_LABEL} characters."),
                    )
                }
            },
            "--out" => match rest.next() {
                Some(dir) => out_dir = Some(PathBuf::from(dir)),
                None => return fail(io, "usage", "--out needs a folder.".into()),
            },
            a if a.starts_with('-') => {
                return fail(io, "usage", format!("Unknown option for walkthrough: {a}"))
            }
            a if input.is_none() => input = Some(PathBuf::from(a)),
            _ => return fail(io, "usage", "walkthrough takes one recording.".into()),
        }
    }
    let Some(input) = input else {
        return fail(
            io,
            "usage",
            "walkthrough needs a recording: impeccable walkthrough <recording> [--chapter M:SS=Text]...".into(),
        );
    };
    let input = if input.is_absolute() {
        input
    } else {
        io.cwd.join(input)
    };
    if !input.is_file() {
        return fail(
            io,
            "not_found",
            format!("No recording at {}.", input.display()),
        );
    }
    if chapters.len() > MAX_CHAPTERS {
        return fail(
            io,
            "bad_chapter",
            format!(
                "A walkthrough takes up to {MAX_CHAPTERS} chapters; got {}.",
                chapters.len()
            ),
        );
    }
    chapters.sort_by_key(|c| c.at_ms);
    // The card wants chapters strictly increasing: two at one moment is a mistake to name.
    if let Some(pair) = chapters.windows(2).find(|w| w[0].at_ms == w[1].at_ms) {
        return fail(
            io,
            "bad_chapter",
            format!(
                "Two chapters share {}: \"{}\" and \"{}\". Give each its own moment.",
                clock(pair[0].at_ms),
                pair[0].text,
                pair[1].text
            ),
        );
    }

    let (Some(ffmpeg), Some(ffprobe)) = (tool(io, "ffmpeg"), tool(io, "ffprobe")) else {
        return fail(
            io,
            "ffmpeg_missing",
            format!(
                "Making a walkthrough needs ffmpeg, which isn't installed here. Install it with: {}. Then run this again.",
                install_hint()
            ),
        );
    };

    let source = match probe(&ffprobe, &input) {
        Ok(p) => p,
        Err(e) => {
            return fail(
                io,
                "unreadable",
                format!(
                    "{} isn't a recording ffmpeg can read: {e}.",
                    input.display()
                ),
            )
        }
    };
    let too_long = |io: &mut Io, seconds: f64| {
        fail(
            io,
            "too_long",
            format!(
                "A walkthrough runs up to 2:00, and this recording is {}. Record a shorter pass of the moments that matter, or trim it first.",
                clock((seconds * 1000.0).ceil() as u64)
            ),
        )
    };
    let late_chapter = |io: &mut Io, late: &Chapter, length_ms: u64| {
        fail(
            io,
            "bad_chapter",
            format!(
                "The chapter \"{}\" is at {}, after the recording ends at {}.",
                late.text,
                clock(late.at_ms),
                clock(length_ms)
            ),
        )
    };
    // A recording that states its length is checked before anything is written. One that
    // doesn't (a browser's MediaRecorder WebM) is checked on the film made from it.
    if let Some(seconds) = source.seconds {
        if seconds > MAX_SECONDS {
            return too_long(io, seconds);
        }
        let length_ms = (seconds * 1000.0).round() as u64;
        if let Some(late) = chapters.iter().find(|c| c.at_ms > length_ms) {
            return late_chapter(io, late, length_ms);
        }
    }

    // Only the default folder is made to ignore itself: a folder the person named is theirs.
    let default_out = out_dir.is_none();
    let out_dir = out_dir
        .map(|d| if d.is_absolute() { d } else { io.cwd.join(d) })
        .unwrap_or_else(|| io.cwd.join(".impeccable").join("walkthroughs"))
        // `--out .` reports clean paths, not `/project/./clip.mp4`.
        .components()
        .filter(|c| !matches!(c, std::path::Component::CurDir))
        .collect::<PathBuf>();
    if let Err(e) = std::fs::create_dir_all(&out_dir) {
        return fail(
            io,
            "write_failed",
            format!("Couldn't create {}: {e}.", out_dir.display()),
        );
    }
    if default_out {
        impeccable_common::git::ensure_dir_ignored(&out_dir.to_string_lossy(), &["*"]);
    }
    let mut stem: String = input
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "walkthrough".into())
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    // The recording itself is never the output: converting clip.mp4 into its own folder
    // writes clip-walkthrough.mp4 beside it.
    let same = |a: &Path, b: &Path| match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    };
    if same(&out_dir.join(format!("{stem}.mp4")), &input)
        || same(&out_dir.join(format!("{stem}.png")), &input)
    {
        stem.push_str("-walkthrough");
    }
    let film = out_dir.join(format!("{stem}.mp4"));
    let poster = out_dir.join(format!("{stem}.png"));
    // Everything is built under names only this run uses, then moved into place: a failure
    // removes what this run made and nothing else, and a finished file is never half-written.
    let token = std::process::id();
    let film_tmp = out_dir.join(format!(".{stem}.{token}.tmp.mp4"));
    let poster_tmp = out_dir.join(format!(".{stem}.{token}.tmp.png"));
    let discard = |io: &mut Io, error: &str, message: String| {
        let _ = std::fs::remove_file(&film_tmp);
        let _ = std::fs::remove_file(&poster_tmp);
        fail(io, error, message)
    };

    let mut encoded = None;
    let mut last_error = String::new();
    for (max_width, crf) in ATTEMPTS {
        // Even dimensions (yuv420p needs them), never upscaled past the source.
        let scale = format!("scale='trunc(min({max_width},iw)/2)*2':-2");
        let crf = crf.to_string();
        let result = run_tool(
            &ffmpeg,
            &[
                "-y",
                "-v",
                "error",
                "-i",
                &input.to_string_lossy(),
                "-an",
                "-map",
                "0:v:0",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                &crf,
                "-pix_fmt",
                "yuv420p",
                "-vf",
                &scale,
                "-movflags",
                "+faststart",
                &film_tmp.to_string_lossy(),
            ],
        );
        match result {
            Err(e) => {
                last_error = e;
                break;
            }
            Ok(_) => match std::fs::metadata(&film_tmp).map(|m| m.len()) {
                Ok(bytes) if bytes <= MAX_FILM_BYTES => {
                    encoded = Some(bytes);
                    break;
                }
                Ok(bytes) => {
                    last_error = format!(
                        "the video is {} MB, over the card's 50 MB, even at 1280 px wide",
                        bytes / 1_000_000
                    )
                }
                Err(e) => {
                    last_error = e.to_string();
                    break;
                }
            },
        }
    }
    let Some(film_bytes) = encoded else {
        return discard(
            io,
            "convert_failed",
            format!("Couldn't make the video: {last_error}."),
        );
    };

    // What was made is checked, not assumed: the card refuses anything else.
    let (made, made_seconds) = match probe(&ffprobe, &film_tmp) {
        Ok(p) if p.codec == "h264" && !p.audio && p.seconds.is_some() => {
            let seconds = p.seconds.unwrap_or(0.0);
            (p, seconds)
        }
        Ok(p) => {
            return discard(
                io,
                "convert_failed",
                format!(
                    "The video came out as {} {} audio, not H.264 without audio.",
                    p.codec,
                    if p.audio { "with" } else { "without" }
                ),
            );
        }
        Err(e) => {
            return discard(
                io,
                "convert_failed",
                format!("Couldn't check the video: {e}."),
            );
        }
    };
    // The film is what the card plays, so its length is the one that has to fit.
    if made_seconds > MAX_SECONDS {
        let _ = std::fs::remove_file(&film_tmp);
        return too_long(io, made_seconds);
    }
    let made_ms = (made_seconds * 1000.0).round() as u64;
    if let Some(late) = chapters.iter().find(|c| c.at_ms > made_ms) {
        let _ = std::fs::remove_file(&film_tmp);
        return late_chapter(io, late, made_ms);
    }

    // The poster is the first chapter's moment, or a second in: past any blank first frame.
    let poster_ms = chapters
        .first()
        .map(|c| c.at_ms)
        .unwrap_or(1000)
        .min(made_ms.saturating_sub(100));
    let at = format!("{:.3}", poster_ms as f64 / 1000.0);
    let poster_result = run_tool(
        &ffmpeg,
        &[
            "-y",
            "-v",
            "error",
            "-ss",
            &at,
            "-i",
            &film_tmp.to_string_lossy(),
            "-frames:v",
            "1",
            "-vf",
            "scale='min(1280,iw)':-2",
            &poster_tmp.to_string_lossy(),
        ],
    );
    let poster_bytes = match poster_result.and_then(|_| {
        std::fs::metadata(&poster_tmp)
            .map(|m| m.len())
            .map_err(|e| e.to_string())
    }) {
        Ok(b) if b > 0 => b,
        Ok(_) | Err(_) => {
            return discard(
                io,
                "convert_failed",
                "Couldn't cut the poster still from the video.".into(),
            );
        }
    };

    let digest = match std::fs::read(&film_tmp) {
        Ok(bytes) => B64.encode(Sha256::digest(&bytes)),
        Err(e) => {
            return discard(
                io,
                "write_failed",
                format!("Couldn't read back the video: {e}."),
            )
        }
    };
    if let Err(e) =
        std::fs::rename(&film_tmp, &film).and_then(|_| std::fs::rename(&poster_tmp, &poster))
    {
        return discard(
            io,
            "write_failed",
            format!(
                "Couldn't save the walkthrough in {}: {e}.",
                out_dir.display()
            ),
        );
    }
    let chapter_rows: Vec<Value> = chapters
        .iter()
        .map(|c| json!({ "at": c.at_ms, "text": c.text }))
        .collect();
    let payload = json!({
        "ok": true,
        "film": {
            "path": film, "format": "mp4", "bytes": film_bytes, "sha256": digest,
            "durationMs": made_ms, "width": made.width, "height": made.height,
        },
        "poster": { "path": poster, "format": "png", "bytes": poster_bytes, "atMs": poster_ms },
        "chapters": chapter_rows,
        // Ready for needs_you.post: merge these two keys into the call, then upload
        // each attachment the way the post's answer says.
        "post": {
            "attachments": [
                { "id": "film", "format": "mp4", "bytes": film_bytes, "sha256": digest },
                { "id": "poster", "format": "png", "bytes": poster_bytes },
            ],
            "interaction": {
                "kind": "walkthrough",
                "film": { "id": "film" },
                "shot": { "id": "poster" },
                "ship": { "label": ship },
                "chapters": chapter_rows,
            },
        },
        "_instructions": if chapters.is_empty() {
            "Post this with needs_you.post: merge `post` into the call (title, notes, priority, target, question_key and request_id are yours), then upload film.path as attachment `film` and poster.path as `poster`. A walkthrough reads best with a chapter for each moment that matters: run again on the original recording with --chapter M:SS=Text for each."
        } else {
            "Post this with needs_you.post: merge `post` into the call (title, notes, priority, target, question_key and request_id are yours), then upload film.path as attachment `film` and poster.path as `poster`."
        },
    });
    io.out(&format!(
        "{}\n",
        serde_json::to_string_pretty(&payload).unwrap_or_default()
    ));
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chapters_read_the_ways_people_write_times() {
        let at = |raw: &str| parse_chapter(raw).map(|c| (c.at_ms, c.text));
        assert_eq!(
            at("0:04=Adding to the cart"),
            Ok((4000, "Adding to the cart".into()))
        );
        assert_eq!(at("1:30= Paying "), Ok((90_000, "Paying".into())));
        assert_eq!(at("12.5=Half"), Ok((12_500, "Half".into())));
        assert_eq!(at("0:01:05=Long form"), Ok((65_000, "Long form".into())));
        // The first = splits; the text may hold more.
        assert_eq!(at("0:02=a=b"), Ok((2000, "a=b".into())));
        for bad in [
            "0:04",
            "0:04=",
            "x=Text",
            "0:75=Text",
            "-1=Text",
            "1:2:3:4=Text",
            "0:04=line\nbreak",
        ] {
            assert!(parse_chapter(bad).is_err(), "{bad}");
        }
        assert!(parse_chapter(&format!("0:01={}", "x".repeat(201))).is_err());
    }

    #[test]
    fn clock_reads_like_a_player() {
        assert_eq!(clock(0), "0:00");
        assert_eq!(clock(4_000), "0:04");
        assert_eq!(clock(125_900), "2:05");
    }
}
