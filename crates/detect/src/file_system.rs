//! Port of `cli/engine/node/file-system.mjs`: the directory walker, the
//! import graph, framework dev-server config detection, and the port probe.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use regex::Regex;

use crate::jsp;
use crate::util::{re, read_text, ANY, D, WS};

/// JS `SKIP_DIRS`.
pub const SKIP_DIRS: &[&str] = &["node_modules", "dist", "build", "__pycache__"];
/// JS `HIDDEN_SOURCE_DIRS`.
pub const HIDDEN_SOURCE_DIRS: &[&str] = &[".vitepress", ".vuepress", ".storybook"];
/// JS `SCANNABLE_EXTENSIONS` (insertion order matters for `resolveImport`).
pub const SCANNABLE_EXTENSIONS: &[&str] = &[
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".jsx",
    ".tsx",
    ".js",
    ".ts",
    ".vue",
    ".svelte",
    ".astro",
    ".blade.php",
];
/// JS `HTML_EXTENSIONS`.
pub const HTML_EXTENSIONS: &[&str] = &[".html", ".htm"];

/// JS: file-system.mjs#hasScannableExtension
pub fn has_scannable_extension(filename: &str) -> bool {
    let lower = impeccable_core::js::to_lower_case(filename);
    if SCANNABLE_EXTENSIONS.contains(&jsp::extname(&lower).as_str()) {
        return true;
    }
    for ext in SCANNABLE_EXTENSIONS {
        if ext[1..].contains('.') && lower.ends_with(ext) {
            return true;
        }
    }
    false
}

/// `HTML_EXTENSIONS.has(path.extname(filePath).toLowerCase())`.
pub fn is_html_path(file_path: &str) -> bool {
    HTML_EXTENSIONS.contains(&impeccable_core::js::to_lower_case(&jsp::extname(file_path)).as_str())
}

/// JS: file-system.mjs#walkDir. Files in `readdirSync` order (the OS order,
/// which Node does not sort either), recursive; an unreadable dir yields [].
pub fn walk_dir(dir: &str) -> Vec<String> {
    walk_dir_reporting(dir, &mut |_, _| {})
}

/// JS: file-system.mjs#walkDir(dir, onReadError). An unreadable directory is
/// reported and skipped rather than silently yielding nothing (#711).
pub fn walk_dir_reporting(
    dir: &str,
    on_read_error: &mut dyn FnMut(&str, &std::io::Error),
) -> Vec<String> {
    let mut files = Vec::new();
    let rd = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) => {
            on_read_error(dir, &e);
            return files;
        }
    };
    let mut entries: Vec<(String, bool)> = Vec::new();
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        // `withFileTypes` reports the entry's own type: a symlink is neither a
        // directory nor a file, so Node skips it in the directory branch and
        // treats it as a candidate file when its name has a scannable ext.
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        entries.push((name, is_dir));
    }
    // Node's readdir returns entries in the order libuv's scandir yields,
    // which on macOS/Linux is sorted by name for the common filesystems.
    entries.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    for (name, is_dir) in entries {
        if SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }
        if is_dir && name.starts_with('.') && !HIDDEN_SOURCE_DIRS.contains(&name.as_str()) {
            continue;
        }
        let full = jsp::join(&[dir, &name]);
        if is_dir {
            files.extend(walk_dir_reporting(&full, on_read_error));
        } else if has_scannable_extension(&name) {
            files.push(full);
        }
    }
    files
}

// ─── Import graph ────────────────────────────────────────────────────────────

static IMPORT_SPECIFIER_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(&format!(
            r#"import{WS}+(?:{ANY}*?from{WS}+)?['"]([^'"]+)['"]"#
        ))
        .unwrap(),
        Regex::new(&format!(
            r#"@import{WS}+(?:url\({WS}*)?['"]?([^'");{WS_CHARS}]+)['"]?{WS}*\)?"#,
            WS_CHARS = impeccable_core::js::WS_CHARS
        ))
        .unwrap(),
        Regex::new(&format!(r#"@(?:use|forward){WS}+['"]([^'"]+)['"]"#)).unwrap(),
    ]
});

/// JS: file-system.mjs#resolveImport
pub fn resolve_import(specifier: &str, from_dir: &str, file_set: &[String]) -> Option<String> {
    if !(specifier.starts_with('.') || specifier.starts_with('/')) {
        return None;
    }
    let base = jsp::resolve(from_dir, &[specifier]);
    if file_set.iter().any(|f| *f == base) {
        return Some(base);
    }
    for ext in SCANNABLE_EXTENSIONS {
        let with_ext = format!("{base}{ext}");
        if file_set.iter().any(|f| *f == with_ext) {
            return Some(with_ext);
        }
    }
    for ext in SCANNABLE_EXTENSIONS {
        let index_file = jsp::join(&[&base, &format!("index{ext}")]);
        if file_set.iter().any(|f| *f == index_file) {
            return Some(index_file);
        }
    }
    None
}

/// JS: file-system.mjs#buildImportGraph. `(file, imports)` pairs in file
/// order; each import list is insertion-ordered and deduplicated (JS `Set`).
pub fn build_import_graph(files: &[String]) -> Vec<(String, Vec<String>)> {
    build_import_graph_reporting(files, &mut |_, _| {})
}

/// JS: file-system.mjs#buildImportGraph(files, onReadError). A file that
/// cannot be read is reported and left out of the graph; the caller skips it
/// for the scan too (#711).
pub fn build_import_graph_reporting(
    files: &[String],
    on_read_error: &mut dyn FnMut(&str, &std::io::Error),
) -> Vec<(String, Vec<String>)> {
    let mut graph = Vec::new();
    for file in files {
        let content = match std::fs::read_to_string(file) {
            Ok(c) => c,
            Err(e) => {
                on_read_error(file, &e);
                continue;
            }
        };
        let dir = jsp::dirname(file);
        let mut imports: Vec<String> = Vec::new();
        for pattern in IMPORT_SPECIFIER_PATTERNS.iter() {
            for m in pattern.captures_iter(&content) {
                if let Some(resolved) = resolve_import(&m[1], &dir, files) {
                    if !imports.contains(&resolved) {
                        imports.push(resolved);
                    }
                }
            }
        }
        graph.push((file.clone(), imports));
    }
    graph
}

// ─── Framework dev server detection ─────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Fingerprint {
    /// `{ header, value }`: header must be present; `value` (case-insensitive
    /// substring keyword) must match when given.
    Header {
        header: &'static str,
        value: Option<&'static str>,
    },
    /// `{ body }`: the response body must contain the (case-insensitive when
    /// `ci`) keyword.
    Body { keyword: &'static str, ci: bool },
}

#[derive(Debug, Clone, Copy)]
pub struct FrameworkConfig {
    pub name: &'static str,
    pub files: &'static [&'static str],
    pub default_port: u32,
    /// `portRe` capture group 1 is the port.
    pub port_re: &'static str,
    pub fingerprint: Fingerprint,
}

/// JS `FRAMEWORK_CONFIGS` (first match wins).
pub const FRAMEWORK_CONFIGS: &[FrameworkConfig] = &[
    FrameworkConfig {
        name: "Next.js",
        files: &["next.config.js", "next.config.mjs", "next.config.ts"],
        default_port: 3000,
        port_re: "port",
        fingerprint: Fingerprint::Header {
            header: "x-powered-by",
            value: Some("next"),
        },
    },
    FrameworkConfig {
        name: "SvelteKit",
        files: &["svelte.config.js", "svelte.config.ts"],
        default_port: 5173,
        port_re: "port",
        fingerprint: Fingerprint::Header {
            header: "x-sveltekit-page",
            value: None,
        },
    },
    FrameworkConfig {
        name: "Nuxt",
        files: &["nuxt.config.js", "nuxt.config.ts"],
        default_port: 3000,
        port_re: "port",
        fingerprint: Fingerprint::Header {
            header: "x-powered-by",
            value: Some("nuxt"),
        },
    },
    FrameworkConfig {
        name: "Vite",
        files: &["vite.config.js", "vite.config.ts", "vite.config.mjs"],
        default_port: 5173,
        port_re: "port",
        fingerprint: Fingerprint::Body {
            keyword: "@vite/client",
            ci: false,
        },
    },
    FrameworkConfig {
        name: "Astro",
        files: &["astro.config.js", "astro.config.ts", "astro.config.mjs"],
        default_port: 4321,
        port_re: "port",
        fingerprint: Fingerprint::Body {
            keyword: "astro",
            ci: true,
        },
    },
    FrameworkConfig {
        name: "Angular",
        files: &["angular.json"],
        default_port: 4200,
        port_re: "json",
        fingerprint: Fingerprint::Body {
            keyword: "ng-version",
            ci: true,
        },
    },
    FrameworkConfig {
        name: "Remix",
        files: &["remix.config.js", "remix.config.ts"],
        default_port: 3000,
        port_re: "port",
        fingerprint: Fingerprint::Header {
            header: "x-powered-by",
            value: Some("remix"),
        },
    },
];

re!(PORT_RE, format!("port{WS}*[:=]{WS}*({D}+)"));
re!(JSON_PORT_RE, format!("\"port\"{WS}*:{WS}*({D}+)"));

#[derive(Debug, Clone)]
pub struct DetectedFramework {
    pub name: &'static str,
    pub port: u32,
    pub config_path: String,
    pub fingerprint: Fingerprint,
}

/// JS: file-system.mjs#detectFrameworkConfig
pub fn detect_framework_config(dir: &str) -> Option<DetectedFramework> {
    let rd = std::fs::read_dir(dir).ok()?;
    let entries: Vec<String> = rd
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    for cfg in FRAMEWORK_CONFIGS {
        let Some(matched) = cfg.files.iter().find(|f| entries.iter().any(|e| e == *f)) else {
            continue;
        };
        let config_path = jsp::join(&[dir, matched]);
        let mut port = cfg.default_port;
        if let Some(content) = read_text(&config_path) {
            let re: &Regex = if cfg.port_re == "json" {
                &JSON_PORT_RE
            } else {
                &PORT_RE
            };
            if let Some(m) = re.captures(&content) {
                // parseInt(digits, 10): a run of ASCII digits, so a plain parse;
                // an absurdly long run overflows to Infinity in JS and would never
                // be a usable port anyway.
                port = m[1].parse::<u32>().unwrap_or(u32::MAX);
            }
        }
        return Some(DetectedFramework {
            name: cfg.name,
            port,
            config_path,
            fingerprint: cfg.fingerprint,
        });
    }
    None
}

/// JS `isPortListening` result: `{ listening: true, matched }` or `{ listening: false }`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PortProbe {
    pub listening: bool,
    pub matched: bool,
}

/// JS: file-system.mjs#isPortListening. With a fingerprint, an HTTP GET of
/// `http://localhost:${port}/` with a 2 s deadline (redirects followed) whose
/// headers / body decide `matched`; without one, a TCP connect to 127.0.0.1
/// with a 500 ms timeout.
pub fn is_port_listening(port: u32, fingerprint: Option<Fingerprint>) -> PortProbe {
    let Some(fp) = fingerprint else {
        let listening = tcp_connect("127.0.0.1", port, Duration::from_millis(500));
        return PortProbe {
            listening,
            matched: listening,
        };
    };
    let deadline = Instant::now() + Duration::from_secs(2);
    match http_get_localhost(port, deadline) {
        None => PortProbe {
            listening: false,
            matched: false,
        },
        Some((headers, body)) => {
            match fp {
                Fingerprint::Header { header, value } => {
                    if let Some(val) = headers.iter().find(|(k, _)| k == header).map(|(_, v)| v) {
                        let ok = match value {
                            None => true,
                            Some(kw) => val.to_ascii_lowercase().contains(kw),
                        };
                        if ok {
                            return PortProbe {
                                listening: true,
                                matched: true,
                            };
                        }
                    }
                }
                Fingerprint::Body { keyword, ci } => {
                    let hit = if ci {
                        body.to_ascii_lowercase().contains(keyword)
                    } else {
                        body.contains(keyword)
                    };
                    if hit {
                        return PortProbe {
                            listening: true,
                            matched: true,
                        };
                    }
                }
            }
            PortProbe {
                listening: true,
                matched: false,
            }
        }
    }
}

fn tcp_connect(host: &str, port: u32, timeout: Duration) -> bool {
    let Ok(addrs) = (host, port as u16).to_socket_addrs() else {
        return false;
    };
    for addr in addrs {
        if TcpStream::connect_timeout(&addr, timeout).is_ok() {
            return true;
        }
    }
    false
}

/// A minimal HTTP/1.1 client for the local dev-server probe (fetch follows
/// redirects; so does this, up to 20 hops, http only). Returns lower-cased
/// header names with their values and the decoded body, or None on any error
/// or the deadline.
fn http_get_localhost(port: u32, deadline: Instant) -> Option<(Vec<(String, String)>, String)> {
    let mut host = "localhost".to_string();
    let mut port = port as u16;
    let mut path = "/".to_string();
    for _ in 0..21 {
        let (status, headers, body) = http_get_once(&host, port, &path, deadline)?;
        if (301..=303).contains(&status) || status == 307 || status == 308 {
            let Some(loc) = headers
                .iter()
                .find(|(k, _)| k == "location")
                .map(|(_, v)| v.clone())
            else {
                return Some((headers, body));
            };
            if let Some(rest) = loc.strip_prefix("http://") {
                let (hp, p) = match rest.find('/') {
                    Some(i) => (&rest[..i], rest[i..].to_string()),
                    None => (rest, "/".to_string()),
                };
                let (h, pt) = match hp.rsplit_once(':') {
                    Some((h, pt)) => (h.to_string(), pt.parse::<u16>().ok()?),
                    None => (hp.to_string(), 80),
                };
                host = h;
                port = pt;
                path = p;
            } else if loc.starts_with('/') {
                path = loc;
            } else {
                // https or a relative form this probe does not follow.
                return None;
            }
            continue;
        }
        return Some((headers, body));
    }
    None
}

fn http_get_once(
    host: &str,
    port: u16,
    path: &str,
    deadline: Instant,
) -> Option<(u16, Vec<(String, String)>, String)> {
    let remaining = deadline.checked_duration_since(Instant::now())?;
    let addrs: Vec<SocketAddr> = (host, port).to_socket_addrs().ok()?.collect();
    let mut stream = None;
    for addr in addrs {
        let remaining = deadline.checked_duration_since(Instant::now())?;
        if let Ok(s) = TcpStream::connect_timeout(&addr, remaining) {
            stream = Some(s);
            break;
        }
    }
    let mut stream = stream?;
    let _ = stream.set_read_timeout(Some(remaining));
    let _ = stream.set_write_timeout(Some(remaining));
    let req = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUser-Agent: impeccable\r\nAccept: */*\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(req.as_bytes()).ok()?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        if Instant::now() >= deadline {
            return None;
        }
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
            Err(_) => return None,
        }
    }
    let split = find_header_end(&buf)?;
    let head = String::from_utf8_lossy(&buf[..split]).into_owned();
    let mut lines = head.split("\r\n");
    let status_line = lines.next()?;
    let status: u16 = status_line.split_whitespace().nth(1)?.parse().ok()?;
    let mut headers = Vec::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
        }
    }
    let raw_body = &buf[split + 4..];
    let chunked = headers
        .iter()
        .any(|(k, v)| k == "transfer-encoding" && v.to_ascii_lowercase().contains("chunked"));
    let body_bytes = if chunked {
        dechunk(raw_body)
    } else {
        raw_body.to_vec()
    };
    Some((
        status,
        headers,
        String::from_utf8_lossy(&body_bytes).into_owned(),
    ))
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn dechunk(body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < body.len() {
        let Some(line_end) = body[i..].windows(2).position(|w| w == b"\r\n") else {
            break;
        };
        let size_str = String::from_utf8_lossy(&body[i..i + line_end]).into_owned();
        let size = usize::from_str_radix(size_str.split(';').next().unwrap_or("0").trim(), 16)
            .unwrap_or(0);
        if size == 0 {
            break;
        }
        let start = i + line_end + 2;
        let end = (start + size).min(body.len());
        out.extend_from_slice(&body[start..end]);
        i = end + 2;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensions() {
        assert!(has_scannable_extension("a.blade.php"));
        assert!(has_scannable_extension("A.HTML"));
        assert!(!has_scannable_extension("a.php"));
        assert!(is_html_path("/x/y.HTM"));
    }

    #[test]
    fn imports() {
        let files = vec!["/p/a.tsx".to_string(), "/p/b/index.css".to_string()];
        assert_eq!(
            resolve_import("./a", "/p", &files).as_deref(),
            Some("/p/a.tsx")
        );
        assert_eq!(
            resolve_import("./b", "/p", &files).as_deref(),
            Some("/p/b/index.css")
        );
        assert_eq!(resolve_import("react", "/p", &files), None);
    }
}
