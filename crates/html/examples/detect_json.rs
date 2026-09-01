//! Print the JS `detect --json` array for one HTML file through the static
//! engine (no design system, inline ignores as `--no-config`: disabled).
//!
//!     cargo run -p impeccable-html --example detect_json -- path/to/file.html
//!
//! `--inline-ignores` re-enables the whole-file waivers. The regex engine's
//! text-content analyzers are wired from the `detect` crate so the output can
//! be diffed against the JS CLI directly.

use impeccable_html::{detect_html, DetectHtmlOptions};
use std::path::Path;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let inline = args.iter().any(|a| a == "--inline-ignores");
    let path = args.iter().find(|a| !a.starts_with("--")).cloned();
    let Some(path) = path else {
        eprintln!("usage: detect_json [--inline-ignores] <file.html>");
        std::process::exit(1);
    };
    let analyzers = |content: &str, file_path: &str| {
        impeccable_detect::detect_text::run_text_content_analyzers(content, file_path, None)
    };
    let opts = DetectHtmlOptions {
        inline_ignores_disabled: !inline,
        text_content_analyzers: Some(&analyzers),
        ..Default::default()
    };
    match detect_html(Path::new(&path), &opts) {
        Ok(findings) => {
            println!("{}", serde_json::to_string_pretty(&findings).unwrap());
        }
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    }
}
