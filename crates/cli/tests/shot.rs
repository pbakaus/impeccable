//! `impeccable shot`: a page is required, and `--out` takes a folder, not a
//! flag; with a browser it writes one PNG per viewport at that viewport's size
//! and prints each path.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("impeccable-shot-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir.canonicalize().unwrap()
}

fn run(cwd: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_impeccable"))
        .arg("shot")
        .args(args)
        .current_dir(cwd)
        .env("IMPECCABLE_NO_UPDATE_CHECK", "1")
        .output()
        .unwrap()
}

fn has_browser() -> bool {
    let env = std::env::vars().collect();
    impeccable_browser::discovery::find_browser(&env).is_ok()
}

/// A PNG's width and height, from its IHDR chunk.
fn png_size(bytes: &[u8]) -> (u32, u32) {
    assert_eq!(&bytes[1..4], b"PNG");
    let be = |i: usize| u32::from_be_bytes(bytes[i..i + 4].try_into().unwrap());
    (be(16), be(20))
}

#[test]
fn a_page_is_required() {
    let dir = scratch("usage");
    std::fs::write(dir.join("index.html"), "<p>hi</p>").unwrap();
    for args in [
        &[][..],
        &["missing.html"][..],
        &["index.html", "--viewport", "wide"][..],
        &["index.html", "--out", "--full"][..],
    ] {
        let out = run(&dir, args);
        assert_eq!(out.status.code(), Some(2), "{args:?}");
    }
}

#[test]
fn each_viewport_is_one_png_at_its_size() {
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("sizes");
    std::fs::write(dir.join("index.html"), "<!doctype html><h1>Seeds</h1><p style=\"height: 3000px\">Tall</p>").unwrap();
    let out = run(&dir, &["index.html"]);
    let text = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0), "{text}{}", String::from_utf8_lossy(&out.stderr));
    let shots = Path::new(".impeccable").join("shots");
    let expected = format!("{}\n{}\n", shots.join("1440x900.png").display(), shots.join("390x844.png").display());
    assert_eq!(text, expected);
    assert_eq!(png_size(&std::fs::read(dir.join(".impeccable/shots/390x844.png")).unwrap()), (390, 844));
    assert!(std::fs::read_to_string(dir.join(".impeccable/shots/.gitignore")).unwrap().ends_with("\n*\n"));

    let out = run(&dir, &["index.html", "--viewport", "800x600", "--full", "--out", "looks"]);
    assert_eq!(String::from_utf8_lossy(&out.stdout), format!("{}\n", Path::new("looks").join("800x600-full.png").display()));
    let (w, h) = png_size(&std::fs::read(dir.join("looks/800x600-full.png")).unwrap());
    assert!(w == 800 && h > 3000, "{w}x{h}");
}

#[test]
fn a_page_that_scrolls_itself_smoothly_is_captured_from_the_top() {
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("smooth");
    let page = |script: &str| {
        format!(
            "<!doctype html><style>html {{ scroll-behavior: smooth; }} body {{ margin: 0; }}
             div {{ height: 900px; }} .a {{ background: #c33; }} .b {{ background: #33c; }} .c {{ background: #3c3; }}</style>
             <div class=\"a\"></div><div class=\"b\"></div><div class=\"c\"></div>{script}"
        )
    };
    std::fs::write(dir.join("still.html"), page("")).unwrap();
    std::fs::write(dir.join("moved.html"), page("<script>addEventListener('load', () => scrollTo(0, 1800));</script>")).unwrap();
    for name in ["still", "moved"] {
        let out = run(&dir, &[&format!("{name}.html"), "--viewport", "390x844", "--out", name]);
        assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stderr));
    }
    let shot = |name: &str| std::fs::read(dir.join(name).join("390x844.png")).unwrap();
    assert!(shot("still") == shot("moved"), "the capture of a page that scrolled itself is not its top");
}
