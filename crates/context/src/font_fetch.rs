//! `impeccable font-fetch "<Family>"`: self-host a Google font in one call (REN-1952).
//!
//! craft-floor asks for a sourced, self-hosted face. Without this, a build spent six calls on it (curl with a browser's
//! user agent, then scripts to parse the CSS and fetch each file). This asks Google Fonts' CSS API for the family at the
//! given weights, downloads the latin and latin-ext WOFF2 files into the project, and prints `@font-face` rules that
//! point at them.

use crate::http::get_following;
use impeccable_common::Io;
use std::io::Read;

const CSS_API: &str = "https://fonts.googleapis.com/css2";
/// Google serves WOFF2 to a browser that asks as one; any other agent gets TTF.
const BROWSER: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
/// The subsets a page in a Latin-script language needs.
const SUBSETS: [&str; 2] = ["latin", "latin-ext"];
const MAX_FONT_BYTES: u64 = 2 * 1024 * 1024;

fn usage() -> &'static str {
    "Usage: impeccable font-fetch \"<Family>\" [--weights 400,700] [--italic] [--out assets/fonts]\n\n\
Download a Google font's WOFF2 files (latin and latin-ext) into the project and\n\
print the @font-face rules for them, paths relative to the project root.\n\n\
  --weights <list>  Comma-separated weights (default 400,700).\n\
  --italic          Also fetch the italics.\n\
  --out <dir>       Where the files go, relative to here (default assets/fonts)."
}

/// One `@font-face` the CSS API returned.
#[derive(Debug, PartialEq)]
pub struct Face {
    pub subset: String,
    pub style: String,
    pub weight: String,
    pub url: String,
    pub range: String,
}

/// The faces in a css2 response, each with the subset its comment names.
pub fn faces(css: &str) -> Vec<Face> {
    static BLOCK: once_cell::sync::Lazy<regex::Regex> =
        once_cell::sync::Lazy::new(|| regex::Regex::new(r"/\*\s*([a-z0-9-]+)\s*\*/\s*@font-face\s*\{([^}]*)\}").unwrap());
    let field = |block: &str, name: &str| {
        regex::Regex::new(&format!(r"{name}:\s*([^;]+);")).ok().and_then(|r| r.captures(block)).map(|c| c[1].trim().to_string()).unwrap_or_default()
    };
    BLOCK
        .captures_iter(css)
        .filter_map(|c| {
            let block = c.get(2)?.as_str();
            let src = field(block, "src");
            let url = src.strip_prefix("url(")?.split(')').next()?.trim_matches(['"', '\'']).to_string();
            Some(Face { subset: c[1].to_string(), style: field(block, "font-style"), weight: field(block, "font-weight"), url, range: field(block, "unicode-range") })
        })
        .collect()
}

/// The css2 request for `family` at `weights`, italics too when asked.
pub fn css_url(family: &str, weights: &[u32], italic: bool) -> String {
    let name = family.split_whitespace().collect::<Vec<_>>().join("+");
    let axis = if italic {
        let mut pairs: Vec<String> = weights.iter().map(|w| format!("0,{w}")).collect();
        pairs.extend(weights.iter().map(|w| format!("1,{w}")));
        format!("ital,wght@{}", pairs.join(";"))
    } else {
        format!("wght@{}", weights.iter().map(u32::to_string).collect::<Vec<_>>().join(";"))
    };
    format!("{CSS_API}?family={name}:{axis}&display=swap")
}

/// A face's file name: `poppins-600-italic-latin-ext.woff2`.
pub fn file_name(family: &str, face: &Face) -> String {
    let slug: String = family.to_ascii_lowercase().split_whitespace().collect::<Vec<_>>().join("-");
    let italic = if face.style == "italic" { "-italic" } else { "" };
    format!("{slug}-{}{italic}-{}.woff2", face.weight, face.subset)
}

/// A variable font's file, shared by every weight: `sora-italic-latin.woff2`.
pub fn variable_name(family: &str, face: &Face) -> String {
    let slug: String = family.to_ascii_lowercase().split_whitespace().collect::<Vec<_>>().join("-");
    let italic = if face.style == "italic" { "-italic" } else { "" };
    format!("{slug}{italic}-{}.woff2", face.subset)
}

/// The rule for one downloaded face, `src` at `path`.
pub fn rule(family: &str, face: &Face, path: &str) -> String {
    format!(
        "@font-face {{\n  font-family: \"{family}\";\n  font-style: {};\n  font-weight: {};\n  font-display: swap;\n  src: url(\"{path}\") format(\"woff2\");\n  unicode-range: {};\n}}\n",
        face.style, face.weight, face.range
    )
}

fn get(url: &str) -> Result<ureq::Response, String> {
    match get_following(url, 3, |b| b.timeout(std::time::Duration::from_secs(30)).user_agent(BROWSER)) {
        Ok(r) => Ok(r),
        Err(ureq::Error::Status(code, _)) => Err(format!("HTTP {code}")),
        Err(e) => Err(e.to_string()),
    }
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let (mut family, mut weights, mut italic, mut out) = (None::<String>, vec![400u32, 700], false, "assets/fonts".to_string());
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--help" | "-h" => {
                io.out(&format!("{}\n", usage()));
                return 0;
            }
            "--italic" => italic = true,
            "--weights" => match it.next().map(|w| w.split(',').map(|s| s.trim().parse::<u32>()).collect::<Result<Vec<_>, _>>()) {
                Some(Ok(w)) if !w.is_empty() && w.iter().all(|w| (1..=1000).contains(w)) => weights = w,
                _ => {
                    io.err("--weights takes numbers from 1 to 1000, like 400,700.\n");
                    return 1;
                }
            },
            "--out" => match it.next() {
                Some(o) => out = o.trim_end_matches('/').to_string(),
                None => {
                    io.err("--out takes a directory.\n");
                    return 1;
                }
            },
            // A family of several words may come quoted or as separate words: `font-fetch Space Grotesk`.
            _ if !a.starts_with("--") => family = Some(family.map_or(a.trim().to_string(), |f| format!("{f} {}", a.trim()))),
            _ => {
                io.err(&format!("{}\n", usage()));
                return 1;
            }
        }
    }
    let Some(family) = family.filter(|f| !f.is_empty() && f.chars().all(|c| c.is_ascii_alphanumeric() || c == ' ')) else {
        io.err(&format!("{}\n", usage()));
        return 1;
    };
    // Inside the project only: no absolute path, no `..`.
    if !crate::design_map::is_relative_path(&out) {
        io.err("--out must be a directory inside this project, like assets/fonts.\n");
        return 1;
    }
    weights.sort_unstable();
    weights.dedup();
    let dir = io.cwd.join(&out);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        io.err(&format!("Could not create {out}: {e}\n"));
        return 1;
    }
    // The spelling is inside the project; so must be where it resolves: a directory on the way may be a link out.
    let inside = match (std::fs::canonicalize(&io.cwd), std::fs::canonicalize(&dir)) {
        (Ok(root), Ok(real)) => real.starts_with(&root),
        _ => false,
    };
    if !inside {
        io.err(&format!("{out} resolves outside this project: nothing written.\n"));
        return 1;
    }
    let css = match get(&css_url(&family, &weights, italic)).and_then(|r| r.into_string().map_err(|e| e.to_string())) {
        Ok(css) => css,
        Err(e) if e == "HTTP 400" => {
            io.err(&format!("Google Fonts has no family named \"{family}\" at those weights. Check the name at fonts.google.com.\n"));
            return 1;
        }
        Err(e) => {
            io.err(&format!("Could not reach Google Fonts: {e}\n"));
            return 1;
        }
    };
    let wanted: Vec<Face> = faces(&css).into_iter().filter(|f| SUBSETS.contains(&f.subset.as_str())).collect();
    if wanted.is_empty() {
        io.err(&format!("Google Fonts returned no latin files for \"{family}\".\n"));
        return 1;
    }
    let mut rules = String::new();
    // A variable font serves one file for every weight: fetch it once and point each rule at it.
    let mut fetched: Vec<(String, String)> = Vec::new();
    for face in &wanted {
        if let Some((_, name)) = fetched.iter().find(|(url, _)| *url == face.url) {
            rules.push_str(&rule(&family, face, &format!("{out}/{name}")));
            continue;
        }
        // A file several weights share (a variable font) is named without a weight, so it never reads as one weight's.
        let shared = wanted.iter().filter(|f| f.url == face.url).count() > 1;
        let name = if shared { variable_name(&family, face) } else { file_name(&family, face) };
        fetched.push((face.url.clone(), name.clone()));
        let path = dir.join(&name);
        // A file already here is kept; a link in its place (dangling or not) is never written through.
        match std::fs::symlink_metadata(&path) {
            Ok(m) if m.file_type().is_symlink() => {
                io.err(&format!("{out}/{name} is a link: nothing written through it.\n"));
                return 1;
            }
            _ => {}
        }
        if !path.exists() {
            let bytes = get(&face.url).and_then(|r| {
                let mut buf = Vec::new();
                r.into_reader().take(MAX_FONT_BYTES).read_to_end(&mut buf).map(|_| buf).map_err(|e| e.to_string())
            });
            match bytes.and_then(|b| std::fs::write(&path, b).map_err(|e| e.to_string())) {
                Ok(()) => {}
                Err(e) => {
                    io.err(&format!("Could not download {name}: {e}\n"));
                    return 1;
                }
            }
        }
        rules.push_str(&rule(&family, face, &format!("{out}/{name}")));
    }
    io.out(&format!(
        "{rules}\n{} files in {out}{}. Paste these rules into your stylesheet; their paths are relative to the project root, so make them relative to the stylesheet if it lives elsewhere. Nothing else to fetch.\n",
        fetched.len(),
        if fetched.len() < wanted.len() { " (a variable font: one file per subset serves every weight)" } else { "" }
    ));
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    const CSS: &str = "/* devanagari */\n@font-face {\n  font-family: 'Poppins';\n  font-style: normal;\n  font-weight: 600;\n  src: url(https://fonts.gstatic.com/a.woff2) format('woff2');\n  unicode-range: U+0900-097F;\n}\n/* latin */\n@font-face {\n  font-family: 'Poppins';\n  font-style: italic;\n  font-weight: 600;\n  font-display: swap;\n  src: url(https://fonts.gstatic.com/b.woff2) format('woff2');\n  unicode-range: U+0000-00FF, U+0131;\n}\n";

    #[test]
    fn reads_each_face_with_its_subset_and_names_its_file() {
        let got = faces(CSS);
        assert_eq!(got.len(), 2);
        assert_eq!(got[1], Face { subset: "latin".into(), style: "italic".into(), weight: "600".into(), url: "https://fonts.gstatic.com/b.woff2".into(), range: "U+0000-00FF, U+0131".into() });
        assert_eq!(file_name("Space Grotesk", &got[1]), "space-grotesk-600-italic-latin.woff2");
        assert_eq!(variable_name("Space Grotesk", &got[1]), "space-grotesk-italic-latin.woff2");
        assert!(rule("Space Grotesk", &got[1], "assets/fonts/x.woff2").contains("src: url(\"assets/fonts/x.woff2\") format(\"woff2\");\n  unicode-range: U+0000-00FF, U+0131;"));
    }

    #[test]
    fn asks_for_the_weights_and_italics_by_the_css2_axis_syntax() {
        assert_eq!(css_url("Space Grotesk", &[400, 700], false), "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&display=swap");
        assert_eq!(css_url("Inter", &[400], true), "https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;1,400&display=swap");
    }
}
