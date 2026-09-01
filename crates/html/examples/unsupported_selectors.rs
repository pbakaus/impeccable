//! List the selectors css-select-compatible parsing rejected while scanning
//! the given HTML files (a parity aid; JS skips those rules the same way).
use std::path::Path;

fn main() {
    for arg in std::env::args().skip(1) {
        let path = Path::new(&arg);
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        let html = String::from_utf8_lossy(&bytes);
        let list = impeccable_html::engine::unsupported_selectors(&html, path);
        if !list.is_empty() {
            println!("{}:", arg);
            for s in list {
                println!("  {}", s);
            }
        }
    }
}
