//! `impeccable shot`: a page is required; with a browser it writes one PNG per
//! viewport at that viewport's size and prints each path.

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
    for args in [&[][..], &["missing.html"][..], &["index.html", "--viewport", "wide"][..]] {
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
    assert_eq!(text, ".impeccable/shots/1440x900.png\n.impeccable/shots/390x844.png\n");
    assert_eq!(png_size(&std::fs::read(dir.join(".impeccable/shots/390x844.png")).unwrap()), (390, 844));
    assert!(std::fs::read_to_string(dir.join(".impeccable/shots/.gitignore")).unwrap().ends_with("\n*\n"));

    let out = run(&dir, &["index.html", "--viewport", "800x600", "--full", "--out", "looks"]);
    assert_eq!(String::from_utf8_lossy(&out.stdout), "looks/800x600-full.png\n");
    let (w, h) = png_size(&std::fs::read(dir.join("looks/800x600-full.png")).unwrap());
    assert!(w == 800 && h > 3000, "{w}x{h}");
}
