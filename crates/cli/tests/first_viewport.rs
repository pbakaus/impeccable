//! `impeccable first-viewport`: both selectors are required; a page whose
//! thesis and action sit in the first viewport and that has no empty stretch
//! passes; a page with its thesis below the fold, its action cut off and a
//! blank stretch fails on all three, even when a flipped-away face or a
//! clipped image covers the stretch's rows.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("impeccable-first-viewport-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir.canonicalize().unwrap()
}

fn run(cwd: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_impeccable"))
        .arg("first-viewport")
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

const STYLE: &str = "body { margin: 0; font: 16px/1.4 Georgia, serif; } p { margin: 0; padding: 8px; }";

#[test]
fn both_selectors_are_required() {
    let dir = scratch("usage");
    std::fs::write(dir.join("index.html"), "<p>hi</p>").unwrap();
    for args in [&["index.html", "--thesis", ".t"][..], &["index.html", "--thesis", "", "--action", ".a"][..]] {
        let out = run(&dir, args);
        assert_eq!(out.status.code(), Some(2), "{args:?}");
        assert!(String::from_utf8_lossy(&out.stderr).starts_with("Usage: impeccable first-viewport"));
    }
}

#[test]
fn a_page_that_opens_on_its_thesis_passes() {
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("pass");
    std::fs::write(
        dir.join("index.html"),
        format!(
            "<!doctype html><style>{STYLE} .thesis {{ height: 300px; background: #c33; }}
             .buy {{ transform: rotate(180deg); backface-visibility: hidden; }}</style>
             <h1>Seeds</h1><div class=\"thesis\"></div><button class=\"buy\">Add to basket</button>
             <p>One</p><p>Two</p><p>Three</p>"
        ),
    )
    .unwrap();
    let out = run(&dir, &["index.html", "--thesis", ".thesis", "--action", ".buy", "--viewport", "390x844"]);
    let text = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0), "{text}");
    assert_eq!(text.matches("ok  ").count(), 3, "{text}");
}

#[test]
fn a_thesis_below_the_fold_a_cut_action_and_a_blank_stretch_fail() {
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("fail");
    // Text down to just past the fold, so the only blank stretch is the card.
    let lines = "<p>A line of the introduction</p>".repeat(20);
    std::fs::write(
        dir.join("index.html"),
        format!(
            "<!doctype html><style>{STYLE}
                          .buy {{ display: block; margin-top: 100px; height: 80px; }}
             .card {{ position: relative; height: 900px; }}
             .back {{ position: absolute; inset: 0; transform: rotateY(180deg); backface-visibility: hidden; }}
             .back svg {{ width: 100%; height: 100%; }}
             .crop {{ height: 40px; overflow: hidden; }} .crop img {{ display: block; width: 100px; height: 1000px; }}
             .thesis {{ height: 200px; background: #c33; }}</style>
             <div class=\"intro\">{lines}</div><button class=\"buy\">Add to basket</button>
             <div class=\"crop\"><img alt=\"\" src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\"></div>
             <div class=\"card\"><div class=\"back\"><svg viewBox=\"0 0 10 10\"><circle cx=\"5\" cy=\"5\" r=\"4\" fill=\"none\" stroke=\"#000\"/></svg></div></div>
             <div class=\"thesis\"></div><p>End</p>"
        ),
    )
    .unwrap();
    let out = run(&dir, &["index.html", "--thesis", ".thesis", "--action", ".buy", "--viewport", "390x844"]);
    let text = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(1), "{text}");
    assert!(text.contains("FAIL  thesis .thesis: 0% shows"), "{text}");
    assert!(text.contains("FAIL  primary action .buy: not wholly inside"), "{text}");
    assert!(text.contains("FAIL  longest empty stretch"), "{text}");
}

#[test]
fn a_drawing_in_an_app_shell_below_the_fold_is_content() {
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("shell");
    std::fs::write(
        dir.join("index.html"),
        format!(
            "<!doctype html><style>{STYLE} html, body {{ height: 100%; overflow: hidden; }}
             main {{ height: 100%; overflow-y: auto; }} .thesis {{ height: 300px; background: #c33; }}
             svg {{ display: block; width: 390px; height: 1600px; }}</style>
             <main><h1>Seeds</h1><div class=\"thesis\"></div><button class=\"buy\">Add</button>
             <svg viewBox=\"0 0 10 10\" preserveAspectRatio=\"none\"><circle cx=\"5\" cy=\"5\" r=\"4.5\" fill=\"none\" stroke=\"#000\" stroke-width=\".05\"/></svg>
             <p>End</p></main>"
        ),
    )
    .unwrap();
    let out = run(&dir, &["index.html", "--thesis", ".thesis", "--action", ".buy", "--viewport", "390x844"]);
    let text = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(0), "{text}");
}

#[test]
fn a_thesis_a_full_height_wrapper_hides_fails() {
    if !has_browser() {
        eprintln!("skip: no installed browser found");
        return;
    }
    let dir = scratch("hidden");
    std::fs::write(
        dir.join("index.html"),
        format!(
            "<!doctype html><style>{STYLE} .frame {{ width: 97px; height: 100vh; overflow: hidden; }}
             .thesis {{ width: 388px; height: 300px; background: #c33; }}</style>
             <div class=\"frame\"><h1>Seeds</h1><button class=\"buy\">Add</button>
             <div class=\"thesis\">The whole season on one packet, from seed to seed.</div></div>"
        ),
    )
    .unwrap();
    let out = run(&dir, &["index.html", "--thesis", ".thesis", "--action", ".buy", "--viewport", "390x844"]);
    let text = String::from_utf8_lossy(&out.stdout);
    assert_eq!(out.status.code(), Some(1), "{text}");
    assert!(text.contains("FAIL  thesis .thesis: 25% shows"), "{text}");
}
