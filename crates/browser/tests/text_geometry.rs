//! The text geometry rules against an installed browser, on the fixtures'
//! should-flag and should-pass cases. Skips cleanly when there is none.
//!
//! `line-length`, `body-text-viewport-edge`, `tight-leading` and
//! `cramped-padding` measure where the text is (its Range client rects and
//! the line boxes it sits on) rather than the box around it; `text-overflow`
//! confirms a spill from what paints past the box and reads a wrapper's
//! `overflow-x`; `edge-flush-cards` takes only x scrollers that hold a row of
//! cards. None of that is visible to the static engine, which measures no
//! boxes.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use impeccable_browser::BrowserEngine;
use impeccable_detect::engines::{ScanOptions, UrlEngine};

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/antipatterns")
}

fn serve() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || handle(stream));
        }
    });
    port
}

fn handle(mut stream: TcpStream) {
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).unwrap_or(0);
    let request = String::from_utf8_lossy(&buf[..n]);
    let path = request
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/")
        .to_string();
    let (status, body) = match std::fs::read(fixtures_dir().join(path.trim_start_matches('/'))) {
        Ok(body) => ("200 OK", body),
        Err(_) => ("404 Not Found", b"missing".to_vec()),
    };
    let head = format!(
        "HTTP/1.0 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&body);
    let _ = stream.flush();
}

fn engine() -> Option<BrowserEngine> {
    let env: HashMap<String, String> = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return None;
    }
    Some(BrowserEngine::new(env))
}

/// Whether the browser has a Japanese face to set CJK text in. macOS and
/// Windows ship one; on Linux it is whatever fontconfig lists.
fn has_cjk_font() -> bool {
    if !cfg!(target_os = "linux") {
        return true;
    }
    std::process::Command::new("fc-list")
        .args([":lang=ja", "family"])
        .output()
        .map(|out| !String::from_utf8_lossy(&out.stdout).trim().is_empty())
        .unwrap_or(false)
}

/// `(snippet, selector)` for each finding of `rule` on one fixture.
fn findings(engine: &BrowserEngine, port: u16, fixture: &str, rule: &str) -> Vec<(String, String)> {
    let url = format!("http://127.0.0.1:{port}/{fixture}");
    engine
        .detect_url(&url, &ScanOptions::default())
        .expect("scan")
        .into_iter()
        .filter(|f| f.antipattern == rule)
        .map(|f| {
            let selector = f.extras.get("selector").and_then(|s| s.as_str()).unwrap_or("").to_string();
            (f.snippet, selector)
        })
        .collect()
}

fn assert_cases(found: &[(String, String)], flag: &[&str], pass: &[&str], rule: &str) {
    for case in flag {
        assert!(
            found.iter().any(|(_, sel)| sel.contains(case)),
            "{rule}: `{case}` should flag, got {found:?}"
        );
    }
    for case in pass {
        assert!(
            !found.iter().any(|(_, sel)| sel.contains(case)),
            "{rule}: `{case}` should pass, got {found:?}"
        );
    }
}

#[test]
fn the_text_geometry_rules_measure_the_text() {
    let Some(engine) = engine() else { return };
    let port = serve();

    // The generated selectors name the wide paragraphs by position; the
    // one-line note, the centred lines, the 16px CJK column and the narrow
    // measure are absent.
    let mut lines = findings(&engine, port, "line-length.html", "line-length");
    lines.sort_by(|a, b| a.1.cmp(&b.1));
    let selectors: Vec<&str> = lines.iter().map(|(_, sel)| sel.as_str()).collect();
    // The 12px CJK column is measured in a CJK face; a machine with none
    // (a stock Ubuntu runner) sets it in fallback boxes of another width.
    let cjk: &[&str] = if has_cjk_font() {
        &["p.copy.cjk-wide"]
    } else {
        eprintln!("no CJK font installed: the CJK column is not asserted");
        &[]
    };
    assert_eq!(
        selectors,
        [cjk, &[
            "p.copy.flag-large-span",
            "p.copy.flag-mono",
            "p.copy.wide:nth-of-type(1)",
            "p.copy.wide:nth-of-type(2)",
            "p.copy.wide:nth-of-type(3)",
        ]]
        .concat(),
        "the wide column, its inline-prose twin, its 2.4 line-height twin, the 12px CJK column, the \
         24px span across 1,200px and the monospace column; the 16px paragraph set in a 24px span \
         and the 680px monospace column hold under 85 characters a line: {lines:?}"
    );
    // The measured count depends on the installed fonts (the fallback for
    // Arial differs between Linux, macOS and Windows), so only its floor is
    // pinned: every flagged paragraph sets over 85 characters a line.
    for (snippet, selector) in &lines {
        let chars: u32 = snippet
            .strip_prefix('~')
            .and_then(|rest| rest.split_once(" chars on "))
            .and_then(|(n, _)| n.parse().ok())
            .unwrap_or_else(|| panic!("{selector}: unexpected snippet {snippet:?}"));
        assert!(chars >= 85, "{selector}: {snippet}");
        assert!(snippet.ends_with("rendered lines (aim for <80)"), "{selector}: {snippet}");
    }

    let edges = findings(&engine, port, "body-text-viewport-edge.html", "body-text-viewport-edge");
    let (page, edges): (Vec<_>, Vec<_>) = edges.into_iter().partition(|(_, sel)| sel == "body");
    assert_cases(
        &edges,
        &[
            "div.escape:nth-of-type(1) > p",
            "div.escape:nth-of-type(2) > p",
            "li",
            "flag-inline-prose",
            "flag-gutter-beside-overflow",
        ],
        &[
            "pass-centred-text",
            "pass-padded-text",
            "pass-clipped-slide",
            "pass-past-viewport",
            "pass-ticker-first",
            "pass-ticker-second",
            // Past the window's edge: the page's overflow, not a gutter.
            "past-cut-by-wrapper",
            "past-runs-on",
            "past-transformed-wrapper",
            "past-shell-sliver",
        ],
        "body-text-viewport-edge",
    );
    assert_eq!(
        edges.len(),
        5,
        "two paragraphs, the list item, the inline prose, and the 8px left gutter of the paragraph \
         that also runs past the right edge: {edges:?}"
    );
    let gutter = edges.iter().find(|(_, sel)| sel.contains("flag-gutter-beside-overflow")).unwrap();
    assert!(gutter.0.ends_with("(left 8px)"), "only the gutter side: {gutter:?}");
    assert_eq!(
        page.iter().map(|(s, _)| s.as_str()).collect::<Vec<_>>(),
        vec![
            "page scrolls sideways at 1280px: div (\"A column of a fixed-width desktop layout…\") reaches 2520px past \
             the right edge, and text in 5 blocks runs past it"
        ],
        "one page-level finding: the paragraph an overflow-x-hidden wrapper cuts, the column running past the \
         window, the paragraph in a transformed wrapper, the non-wrapping row's second column and the \
         gutter case. Wrappers that hide overflow cut three of them, and the page scrolls to the other \
         two, so it scrolls sideways. It names the 3800px row that sets the page's width, a bare div \
         under the body, by the start of its text"
    );

    // Bold titles of two lines or fewer, or in a -webkit-box line clamp, are
    // exempt (taste call r3-03), a clamp that hides nothing included; bold
    // body text of four lines, a weight-500 title, regular copy in a clamp and
    // bold text a max-height clip shows three lines of keep the floor. A flex
    // row is measured run by run: short runs a wrapping row moves as whole
    // items pass, a run long enough to wrap in its item keeps the floor.
    let leading = findings(&engine, port, "tight-leading.html", "tight-leading");
    assert_cases(
        &leading,
        &[
            "card-blurb",
            "nested-desc",
            "bold-body-run",
            "medium-slot-title",
            "clamped-regular-blurb",
            "bold-clipped-summary",
            "flex-long-run",
        ],
        &[
            "items-row",
            "teaser-copy",
            "link-run",
            "bold-slot-title",
            "bold-ticker-link",
            "clamped-exact-title",
            "clamped-video-title",
        ],
        "tight-leading",
    );
    assert_eq!(leading.len(), 10, "the ten flag cases: {leading:?}");
    // The same short runs in a row that does not wrap, and in grid cells,
    // wrap inside their items and keep the floor.
    let runs = findings(&engine, port, "tight-leading-runs.html", "tight-leading");
    assert_cases(&runs, &["nowrap-runs-row", "grid-runs-row"], &[], "tight-leading");
    assert_eq!(runs.len(), 2, "the two flag cases: {runs:?}");

    // A chip under 27.5px tall is measured by its glyphs (taste call r3-20):
    // the step chip's line box holds them 5px off its edges, the 20px chip's
    // glyphs still reach within 2px. The price chip passes at 27px and
    // reports at 28px and 27.6px, where the content area measures it.
    // A side a reader sees no edge on is not crowded (observations-28 row
    // 13): text a sideways scroll or an ellipsis cuts, a band that runs on
    // into a sibling of the same fill, a fill laid on a positioned layer of
    // the same colour, and a chip a transform draws at 0.3. The start side
    // of a scrolled table and a band beside another colour still report
    // (`cramped-padding-edges.html`).
    let cramped = findings(&engine, port, "cramped-padding.html", "cramped-padding");
    assert_cases(
        &cramped,
        &["flag-card-4", "flag-touching-chip", "flag-price-chip", "flag-price-chip-subpixel"],
        &["pass-highlight", "pass-step-chip", "pass-price-chip"],
        "cramped-padding",
    );
    let edges = findings(&engine, port, "cramped-padding-edges.html", "cramped-padding");
    assert_cases(
        &edges,
        &["flag-scroll-start", "flag-band-next-differs"],
        &[
            "pass-scroll-table",
            "pass-ellipsis-panel",
            "pass-same-band",
            "pass-layer-grid",
            "pass-scaled-chip",
        ],
        "cramped-padding",
    );
    assert_eq!(edges.len(), 2, "only the two flag cases: {edges:?}");
    for chip in ["flag-price-chip", "flag-price-chip-subpixel"] {
        let (snippet, _) = cramped
            .iter()
            .find(|(_, sel)| sel.split(|c: char| !(c.is_alphanumeric() || c == '-' || c == '_')).any(|t| t == chip))
            .expect(chip);
        assert!(snippet.ends_with("on top (no inset)"), "{chip}: {snippet}");
    }
}

#[test]
fn text_overflow_and_edge_flush_cards_read_the_x_axis() {
    let Some(engine) = engine() else { return };
    let port = serve();

    let overflow = findings(&engine, port, "text-overflow.html", "text-overflow");
    assert_cases(
        &overflow,
        &[
            "flag-nowrap",
            "flag-in-x-hidden-wrapper",
            "flag-pseudo-suffix",
            "flag-stat-collides",
            "flag-viewport-edge",
            "flag-under-positioned-image",
            "flag-under-positioned-box",
        ],
        &[
            "pass-ripple",
            "pass-image-replacement",
            "pass-reserve",
            "pass-stat-neighbor",
            "pass-free-space-pre",
            "pass-free-space-headline",
            "pass-under-hairline",
            "pass-hover-tooltip",
            "pass-corner-badge",
            "pass-icon-label-below-clip",
            "pass-ink-matches-surface",
        ],
        "text-overflow",
    );
    assert!(
        overflow.iter().all(|(snippet, _)| snippet.contains("flag-")),
        "only flag cases report: {overflow:?}"
    );

    let flush = findings(&engine, port, "edge-flush-cards.html", "edge-flush-cards");
    assert_eq!(flush.len(), 1, "only the pager: {flush:?}");
    assert!(flush[0].0.contains("flag-pager"), "{flush:?}");
}

/// `(snippet, selector)` for each finding of `rule` on one fixture, scanned
/// at `viewport`.
fn findings_at(
    engine: &BrowserEngine,
    port: u16,
    fixture: &str,
    rule: &str,
    viewport: (u32, u32),
) -> Vec<(String, String)> {
    let url = format!("http://127.0.0.1:{port}/{fixture}");
    let options = ScanOptions {
        viewport: Some(viewport),
        ..Default::default()
    };
    engine
        .detect_url(&url, &options)
        .expect("scan")
        .into_iter()
        .filter(|f| f.antipattern == rule)
        .map(|f| {
            let selector = f.extras.get("selector").and_then(|s| s.as_str()).unwrap_or("").to_string();
            (f.snippet, selector)
        })
        .collect()
}

/// Taste calls r3-34 and r4-p20 at a phone's width: a 12px gutter floor, and
/// a list past the edge of a page whose body hides sideways overflow reports
/// once, as text cut off at the edge.
#[test]
fn viewport_edge_at_phone_width() {
    let Some(engine) = engine() else { return };
    let port = serve();
    let edges = findings_at(
        &engine,
        port,
        "body-text-viewport-edge-phone.html",
        "body-text-viewport-edge",
        (390, 844),
    );
    let (page, edges): (Vec<_>, Vec<_>) = edges.into_iter().partition(|(_, sel)| sel == "body");
    assert_cases(
        &edges,
        &["flag-phone-8", "flag-phone-11"],
        &["pass-phone-12", "pass-phone-14", "pass-phone-24", "past-wide-item"],
        "body-text-viewport-edge",
    );
    assert_eq!(edges.len(), 2, "{edges:?}");
    assert_eq!(page.len(), 1, "{page:?}");
    assert!(
        page[0].0.starts_with("text runs past the right edge of the 390px viewport and is cut off: ul.wide-list reaches 114px past it")
            && page[0].0.ends_with("with text in 2 blocks"),
        "{page:?}"
    );
}
