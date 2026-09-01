//! A small WHATWG-URL subset for `new URL(s)` on http(s) inputs: enough for
//! hostname/pathname extraction and `href` re-serialization with hash and
//! search cleared. Returns None where `new URL()` would throw for the shapes
//! these scripts see (empty host, whitespace/forbidden host code points).

pub struct Url {
    pub scheme: String,
    pub username: String,
    pub password: String,
    pub hostname: String,
    pub port: String,
    pub pathname: String,
    pub search: String,
    pub hash: String,
}

fn is_forbidden_host_cp(c: char) -> bool {
    matches!(
        c,
        '\0' | '\t' | '\n' | '\r' | ' ' | '#' | '/' | ':' | '<' | '>' | '?' | '@' | '[' | '\\' | ']' | '^' | '|' | '%'
    )
}

fn percent_encode_path(s: &str) -> String {
    // path percent-encode set: C0 controls, space, ", #, <, >, ?, `, {, }, and non-ASCII
    let mut out = String::new();
    for c in s.chars() {
        let enc = (c as u32) <= 0x1f || (c as u32) >= 0x7f || matches!(c, ' ' | '"' | '#' | '<' | '>' | '?' | '`' | '{' | '}');
        if enc {
            let mut buf = [0u8; 4];
            for b in c.encode_utf8(&mut buf).bytes() {
                out.push_str(&format!("%{:02X}", b));
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn percent_encode_query(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        let enc = (c as u32) <= 0x1f || (c as u32) >= 0x7f || matches!(c, ' ' | '"' | '#' | '<' | '>' | '\'');
        if enc {
            let mut buf = [0u8; 4];
            for b in c.encode_utf8(&mut buf).bytes() {
                out.push_str(&format!("%{:02X}", b));
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn percent_encode_fragment(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        let enc = (c as u32) <= 0x1f || (c as u32) >= 0x7f || matches!(c, ' ' | '"' | '<' | '>' | '`');
        if enc {
            let mut buf = [0u8; 4];
            for b in c.encode_utf8(&mut buf).bytes() {
                out.push_str(&format!("%{:02X}", b));
            }
        } else {
            out.push(c);
        }
    }
    out
}

pub fn parse(input: &str) -> Option<Url> {
    // strip leading/trailing C0+space, remove tab/newline
    let trimmed = input.trim_matches(|c: char| (c as u32) <= 0x20);
    let cleaned: String = trimmed.chars().filter(|c| !matches!(c, '\t' | '\n' | '\r')).collect();
    let colon = cleaned.find(':')?;
    let scheme = cleaned[..colon].to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let rest = &cleaned[colon + 1..];
    // special scheme: skip any number of / or \
    let rest = rest.trim_start_matches(|c| c == '/' || c == '\\');
    // authority ends at / \ ? #
    let auth_end = rest.find(|c| c == '/' || c == '\\' || c == '?' || c == '#').unwrap_or(rest.len());
    let authority = &rest[..auth_end];
    let after = &rest[auth_end..];
    let (userinfo, hostport) = match authority.rfind('@') {
        Some(i) => (&authority[..i], &authority[i + 1..]),
        None => ("", authority),
    };
    let (username, password) = match userinfo.find(':') {
        Some(i) => (userinfo[..i].to_string(), userinfo[i + 1..].to_string()),
        None => (userinfo.to_string(), String::new()),
    };
    // host and port
    let (host_raw, port_raw) = if hostport.starts_with('[') {
        match hostport.find(']') {
            Some(i) => {
                let h = &hostport[..=i];
                let p = &hostport[i + 1..];
                (h.to_string(), p.strip_prefix(':').map(|s| s.to_string()))
            }
            None => return None,
        }
    } else {
        match hostport.rfind(':') {
            Some(i) => (hostport[..i].to_string(), Some(hostport[i + 1..].to_string())),
            None => (hostport.to_string(), None),
        }
    };
    if host_raw.is_empty() {
        return None;
    }
    // percent-decode then check forbidden
    let decoded = percent_decode(&host_raw);
    let hostname = if host_raw.starts_with('[') {
        host_raw.to_ascii_lowercase()
    } else {
        if decoded.chars().any(is_forbidden_host_cp) {
            return None;
        }
        // Non-ASCII hosts would need IDNA; keep lowercase best effort.
        decoded.to_lowercase()
    };
    let mut port = String::new();
    if let Some(p) = port_raw {
        if !p.is_empty() {
            if !p.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            let n: u64 = p.parse().ok()?;
            if n > 65535 {
                return None;
            }
            let default = if scheme == "http" { 80 } else { 443 };
            if n != default {
                port = n.to_string();
            }
        }
    }
    // path / query / fragment
    let (path_q, hash) = match after.find('#') {
        Some(i) => (&after[..i], Some(&after[i + 1..])),
        None => (after, None),
    };
    let (path_part, query) = match path_q.find('?') {
        Some(i) => (&path_q[..i], Some(&path_q[i + 1..])),
        None => (path_q, None),
    };
    let path_part = path_part.replace('\\', "/");
    // segment normalization
    let mut segs: Vec<String> = Vec::new();
    let raw_segs: Vec<&str> = if path_part.is_empty() { vec![] } else { path_part[1..].split('/').collect() };
    let n = raw_segs.len();
    for (i, seg) in raw_segs.iter().enumerate() {
        let lower = seg.to_ascii_lowercase();
        let is_dotdot = lower == ".." || lower == ".%2e" || lower == "%2e." || lower == "%2e%2e";
        let is_dot = lower == "." || lower == "%2e";
        let last = i == n - 1;
        if is_dotdot {
            segs.pop();
            if last {
                segs.push(String::new());
            }
        } else if is_dot {
            if last {
                segs.push(String::new());
            }
        } else {
            segs.push(percent_encode_path(seg));
        }
    }
    let pathname = if segs.is_empty() { "/".to_string() } else { format!("/{}", segs.join("/")) };
    let search = match query {
        Some(q) if !q.is_empty() => format!("?{}", percent_encode_query(q)),
        _ => String::new(),
    };
    let hash = match hash {
        Some(h) if !h.is_empty() => format!("#{}", percent_encode_fragment(h)),
        _ => String::new(),
    };
    Some(Url { scheme, username, password, hostname, port, pathname, search, hash })
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() + 0 && i + 2 <= bytes.len() - 1 {
            let h = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|x| u8::from_str_radix(x, 16).ok());
            if let Some(v) = h {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

impl Url {
    pub fn origin(&self) -> String {
        let mut s = format!("{}://{}", self.scheme, self.hostname);
        if !self.port.is_empty() {
            s.push(':');
            s.push_str(&self.port);
        }
        s
    }
    /// `href`
    pub fn to_string(&self) -> String {
        let mut s = format!("{}://", self.scheme);
        if !self.username.is_empty() || !self.password.is_empty() {
            s.push_str(&self.username);
            if !self.password.is_empty() {
                s.push(':');
                s.push_str(&self.password);
            }
            s.push('@');
        }
        s.push_str(&self.hostname);
        if !self.port.is_empty() {
            s.push(':');
            s.push_str(&self.port);
        }
        s.push_str(&self.pathname);
        s.push_str(&self.search);
        s.push_str(&self.hash);
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basics() {
        let u = parse("https://Impeccable.Style/docs/audit/").unwrap();
        assert_eq!(u.hostname, "impeccable.style");
        assert_eq!(u.pathname, "/docs/audit/");
        let u = parse("http://localhost:3000/pricing?x=1#h").unwrap();
        assert_eq!(u.port, "3000");
        assert_eq!(u.pathname, "/pricing");
        assert_eq!(u.search, "?x=1");
        assert_eq!(u.hash, "#h");
        assert_eq!(parse("https://a.b").unwrap().to_string(), "https://a.b/");
        assert!(parse("http://").is_none());
        assert!(parse("http://a b/").is_none());
    }
}
