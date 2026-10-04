//! A non-HTML file only gets the regex engine, so text mode says the scan
//! was an undercount, even when it found nothing (#884). `--json` and
//! `--quiet` stay silent.

use std::collections::HashMap;

use impeccable_common::Io;
use impeccable_detect::cli::run_detect;
use impeccable_detect::{Engines, MissingHtmlEngine};

const NOTE_TAIL: &str = " scanned with regex matching only.\nRules that need a parsed page (tiny-text, low-contrast and other element rules) are NOT evaluated there; findings are an undercount, not a clean bill of health.\nScan built .html files or a URL for full coverage.\n";

fn run(dir: &std::path::Path, flags: &[&str]) -> (i32, String, String) {
    let mut args: Vec<String> = ["--no-config", "--no-design-system"]
        .iter()
        .chain(flags)
        .map(|s| s.to_string())
        .collect();
    args.push(dir.to_string_lossy().into_owned());
    let (mut io, cap) = Io::captured("", dir.to_path_buf(), HashMap::new());
    let engines = Engines {
        html: &MissingHtmlEngine,
        url: None,
    };
    let code = run_detect(&args, &mut io, &engines);
    let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
    let err = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
    (code, out, err)
}

#[test]
fn zero_finding_source_scan_says_it_was_regex_only() {
    let dir = std::env::temp_dir().join(format!("impeccable-regex-note-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("a.astro"),
        "<p style=\"font-size:8px\">tiny label</p>\n",
    )
    .unwrap();
    std::fs::write(dir.join("b.jsx"), "export const B = () => <p>ok</p>;\n").unwrap();

    assert_eq!(
        run(&dir, &[]),
        (0, String::new(), format!("\n2 non-HTML files{NOTE_TAIL}"))
    );
    assert_eq!(
        run(&dir, &["--json"]),
        (0, "[]\n".to_string(), String::new())
    );
    assert_eq!(run(&dir, &["--quiet"]), (0, String::new(), String::new()));

    std::fs::remove_file(dir.join("b.jsx")).unwrap();
    assert_eq!(run(&dir, &[]).2, format!("\n1 non-HTML file{NOTE_TAIL}"));

    std::fs::remove_dir_all(&dir).unwrap();
}
