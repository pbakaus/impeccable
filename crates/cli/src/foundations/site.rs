//! The foundations observed from outside: the product's own deployed site,
//! named by its committed files, asked from this machine (REN-894). Each
//! check settles only on an answer that proves it either way; a timeout, a
//! refused connection or an unreachable resolver sends nothing. The last
//! answers are kept for a day (no network at all) and, per item, stand in
//! for up to a week when the site can't be reached, so an offline `detect`
//! never wipes what an earlier scan proved.

use regex::Regex;
use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const IDS: [&str; 5] = [
    "https-enforced",
    "certificate-renews",
    "security-headers",
    "email-authentication",
    "security-txt",
];

const BUDGET: Duration = Duration::from_secs(4);
const REQUEST: Duration = Duration::from_secs(3);
const FRESH: u64 = 24 * 3600;
const STAND_IN: u64 = 7 * 24 * 3600;
const HSTS_MIN: u64 = 15_552_000;
const RENEW_DAYS: i64 = 14;
const READ_LIMIT: u64 = 256 * 1024;

pub type Items = BTreeMap<&'static str, &'static str>;

/// The outside items for the repository at `root` (its top).
pub fn check(root: &Path, env: &HashMap<String, String>) -> Items {
    let Some(host) = site_host(root) else {
        return Items::new();
    };
    let now = unix_now();
    let key = root
        .canonicalize()
        .unwrap_or_else(|_| root.to_path_buf())
        .to_string_lossy()
        .into_owned();
    let path =
        impeccable_account::config::impeccable_home(env).map(|h| h.join("foundations-site.json"));
    let mut cache = path.as_deref().map(read_cache).unwrap_or_default();
    let held = cache
        .get(&key)
        .filter(|e| e.host == host)
        .cloned()
        .unwrap_or_else(|| Entry {
            host: host.clone(),
            probed: 0,
            items: BTreeMap::new(),
        });
    if now.saturating_sub(held.probed) < FRESH {
        return held.standing(now, STAND_IN);
    }
    let entry = settle(held, &probe(&host), now);
    let out = entry.standing(now, STAND_IN);
    cache.insert(key, entry);
    if let Some(p) = path {
        write_cache(&p, &cache);
    }
    out
}

/// The kept answers after a probe: what it settled is new; the rest stand
/// in by their own age. A probe that settled nothing (offline) doesn't count
/// as one, so the next run asks again instead of waiting a day.
fn settle(held: Entry, probed: &Items, now: u64) -> Entry {
    let mut entry = Entry {
        probed: if probed.is_empty() { held.probed } else { now },
        ..held
    };
    for (id, state) in probed {
        entry.items.insert(id.to_string(), (state.to_string(), now));
    }
    entry
}

#[derive(Clone, Debug, PartialEq)]
struct Entry {
    host: String,
    probed: u64,
    /// id -> (state, when it was last observed).
    items: BTreeMap<String, (String, u64)>,
}

impl Entry {
    fn standing(&self, now: u64, max_age: u64) -> Items {
        IDS.iter()
            .filter_map(|id| {
                let (state, at) = self.items.get(*id)?;
                (now.saturating_sub(*at) < max_age).then_some((*id, state_str(state)?))
            })
            .collect()
    }
}

fn state_str(s: &str) -> Option<&'static str> {
    match s {
        "checked" => Some("checked"),
        "failing" => Some("failing"),
        _ => None,
    }
}

fn read_cache(path: &Path) -> HashMap<String, Entry> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return HashMap::new();
    };
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str(&text) else {
        return HashMap::new();
    };
    map.into_iter()
        .filter_map(|(k, v)| {
            let host = v.get("host")?.as_str()?.to_string();
            let probed = v.get("probed")?.as_u64()?;
            let items = v
                .get("items")?
                .as_object()?
                .iter()
                .filter_map(|(id, s)| {
                    Some((
                        id.clone(),
                        (
                            s.get("state")?.as_str()?.to_string(),
                            s.get("at")?.as_u64()?,
                        ),
                    ))
                })
                .collect();
            Some((
                k,
                Entry {
                    host,
                    probed,
                    items,
                },
            ))
        })
        .collect()
}

fn write_cache(path: &Path, cache: &HashMap<String, Entry>) {
    let body: serde_json::Map<String, serde_json::Value> = cache
        .iter()
        .map(|(k, e)| {
            let items: serde_json::Map<String, serde_json::Value> = e
                .items
                .iter()
                .map(|(id, (s, at))| (id.clone(), serde_json::json!({ "state": s, "at": at })))
                .collect();
            (
                k.clone(),
                serde_json::json!({ "host": e.host, "probed": e.probed, "items": items }),
            )
        })
        .collect();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // One temp file per process, so concurrent scans never write into each other's.
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let tmp = path.with_extension(format!("json.{}.{nanos}.tmp", std::process::id()));
    if std::fs::write(&tmp, serde_json::Value::Object(body).to_string()).is_ok() {
        let _ = std::fs::rename(tmp, path);
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// --- Where the site is -----------------------------------------------------

/// The deployed site's host, from the first committed file that names one.
pub fn site_host(root: &Path) -> Option<String> {
    // Only files git tracks: an untracked local file names no deployed site.
    let tracked: std::collections::HashSet<String> = super::local::git_ls_files(root)?
        .ok()?
        .into_iter()
        .collect();
    let read = |p: &str| -> Option<String> {
        if !tracked.contains(p) {
            return None;
        }
        let path = root.join(p);
        if !std::fs::symlink_metadata(&path).ok()?.is_file() {
            return None;
        }
        let mut s = String::new();
        std::fs::File::open(path)
            .ok()?
            .take(READ_LIMIT)
            .read_to_string(&mut s)
            .ok()?;
        Some(s)
    };
    let mut found: Vec<String> = Vec::new();
    if let Some(pkg) = read("package.json") {
        if let Some(h) = serde_json::from_str::<serde_json::Value>(&pkg)
            .ok()
            .and_then(|v| v.get("homepage")?.as_str().map(str::to_string))
        {
            found.push(h);
        }
    }
    for dir in ["", "public/", "static/", "docs/"] {
        if let Some(c) = read(&format!("{dir}CNAME")) {
            if let Some(line) = c.lines().map(str::trim).find(|l| !l.is_empty()) {
                found.push(format!("https://{line}/"));
            }
        }
    }
    let quoted = |pattern: &str, files: &[String], found: &mut Vec<String>| {
        let re = Regex::new(pattern).expect("pattern");
        for f in files {
            if let Some(m) = read(f).and_then(|t| re.captures(&t).map(|c| c[1].to_string())) {
                found.push(m);
            }
        }
    };
    let astro: Vec<String> = ["mjs", "ts", "js", "cjs", "mts"]
        .iter()
        .map(|e| format!("astro.config.{e}"))
        .collect();
    quoted(
        r#"\bsite\s*:\s*['"`](https?://[^'"`\s]+)"#,
        &astro,
        &mut found,
    );
    let layouts: Vec<String> = ["app", "src/app"]
        .iter()
        .flat_map(|d| {
            ["tsx", "ts", "jsx", "js"]
                .iter()
                .map(move |e| format!("{d}/layout.{e}"))
        })
        .collect();
    quoted(
        r#"metadataBase\s*:\s*new\s+URL\(\s*['"`](https?://[^'"`\s]+)"#,
        &layouts,
        &mut found,
    );
    let robots: Vec<String> = ["", "public/", "static/"]
        .iter()
        .map(|d| format!("{d}robots.txt"))
        .collect();
    quoted(
        r"(?im)^\s*sitemap\s*:\s*(https?://\S+)",
        &robots,
        &mut found,
    );
    let tag = Regex::new(r"(?is)<(?:link|meta)\b[^>]*>").expect("pattern");
    let attr =
        Regex::new(r#"(?i)\b(rel|property|href|content)\s*=\s*["']([^"']*)["']"#).expect("pattern");
    for dir in ["", "public/", "static/", "src/", "docs/"] {
        let Some(html) = read(&format!("{dir}index.html")) else {
            continue;
        };
        for t in tag.find_iter(&html) {
            let attrs: HashMap<String, String> = attr
                .captures_iter(t.as_str())
                .map(|c| (c[1].to_ascii_lowercase(), c[2].to_string()))
                .collect();
            let url = match (attrs.get("rel"), attrs.get("property")) {
                (Some(r), _) if r.eq_ignore_ascii_case("canonical") => attrs.get("href"),
                (_, Some(p)) if p.eq_ignore_ascii_case("og:url") => attrs.get("content"),
                _ => None,
            };
            if let Some(u) = url {
                found.push(u.clone());
            }
        }
    }
    found.iter().find_map(|u| public_host(u))
}

/// A URL's host when it can be a product's own public site.
pub fn public_host(raw: &str) -> Option<String> {
    let url = url::Url::parse(raw.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = match url.host()? {
        url::Host::Domain(d) => d.trim_end_matches('.').to_ascii_lowercase(),
        _ => return None,
    };
    const NOT_THEIRS: [&str; 14] = [
        "localhost",
        "github.com",
        "gitlab.com",
        "bitbucket.org",
        "npmjs.com",
        "npmjs.org",
        "crates.io",
        "pypi.org",
        "example.com",
        "example.org",
        "example.net",
        "vercel.com",
        "netlify.com",
        "codeberg.org",
    ];
    let under = |d: &str| host == d || host.ends_with(&format!(".{d}"));
    if host.contains('*')
        || !host.contains('.')
        || host.ends_with(".local")
        || host.ends_with(".localhost")
        || host.ends_with(".test")
        || host.ends_with(".invalid")
        || NOT_THEIRS.iter().any(|d| under(d))
    {
        return None;
    }
    Some(host)
}

// --- Asking the site -------------------------------------------------------

fn probe(host: &str) -> Items {
    let (tx, rx) = mpsc::channel::<Items>();
    // Each job sends an item as soon as it settles, so a slow request never
    // hides one that already finished when the budget runs out.
    let jobs: [fn(&str, &mpsc::Sender<Items>); 3] = [
        |h, tx| {
            let tls = tls_leaf(h);
            if let Some(s) = judge_certificate(&tls, unix_now() as i64) {
                let _ = tx.send(Items::from([("certificate-renews", s)]));
            }
            let https = get(h, &format!("https://{h}/"), true);
            if let Got::Answer(r) = &https {
                let _ = tx.send(Items::from([("security-headers", judge_headers(r))]));
            }
            let http = get(h, &format!("http://{h}/"), false);
            if let Some(s) = judge_https(h, &tls, &https, &http) {
                let _ = tx.send(Items::from([("https-enforced", s)]));
            }
        },
        |h, tx| {
            let got = get(h, &format!("https://{h}/.well-known/security.txt"), true);
            if let Some(s) = judge_security_txt(&got) {
                let _ = tx.send(Items::from([("security-txt", s)]));
            }
        },
        |h, tx| {
            if let Some(s) = judge_email(h, &doh_txt) {
                let _ = tx.send(Items::from([("email-authentication", s)]));
            }
        },
    ];
    for job in jobs {
        let tx = tx.clone();
        let host = host.to_string();
        // A committed file can name an address on this machine's network:
        // ask nothing of a host that resolves to one. The lookup runs inside
        // the job, so a slow resolver can't outlast the budget.
        std::thread::spawn(move || {
            if public_addrs(&host, 443).is_some() {
                job(&host, &tx);
            }
        });
    }
    drop(tx);
    let deadline = Instant::now() + BUDGET;
    let mut out = Items::new();
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        match rx.recv_timeout(left) {
            Ok(items) => out.extend(items),
            Err(_) => break,
        }
    }
    out
}

/// An address on the public internet: not loopback, private, link-local,
/// shared (CGNAT), documentation or unspecified.
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let [a, b, ..] = v.octets();
            !(v.is_loopback()
                || v.is_private()
                || v.is_link_local()
                || v.is_unspecified()
                || v.is_broadcast()
                || v.is_documentation()
                || a == 0
                || (a == 100 && (64..128).contains(&b)))
        }
        IpAddr::V6(v) => {
            if let Some(v4) = v.to_ipv4_mapped() {
                return is_public(IpAddr::V4(v4));
            }
            let first = v.segments()[0];
            !(v.is_loopback()
                || v.is_unspecified()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80)
        }
    }
}

/// Every address `host` resolves to, only when all of them are public.
fn public_addrs(host: &str, port: u16) -> Option<Vec<SocketAddr>> {
    let addrs: Vec<SocketAddr> = (host, port).to_socket_addrs().ok()?.collect();
    (!addrs.is_empty() && addrs.iter().all(|a| is_public(a.ip()))).then_some(addrs)
}

/// The same site: the host itself or its www twin.
fn same_site(a: &str, b: &str) -> bool {
    a == b || a == format!("www.{b}") || b == format!("www.{a}")
}

const HOPS: usize = 3;

pub struct Response {
    pub status: u16,
    /// Lowercased names.
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Response {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }
}

pub enum Got {
    Answer(Response),
    /// No answer that proves anything.
    Nothing,
}

/// One page of the site. With `follow`, up to three redirects are followed
/// by hand, and only within the site (`host` or its www twin), so the
/// answer judged is always the site's own.
fn get(host: &str, url: &str, follow: bool) -> Got {
    let agent = ureq::AgentBuilder::new()
        .timeout(REQUEST)
        .redirects(0)
        .user_agent("impeccable-foundations")
        // Every address ureq connects to is checked, including after a redirect.
        .resolver(|netloc: &str| -> std::io::Result<Vec<SocketAddr>> {
            let addrs: Vec<SocketAddr> = netloc.to_socket_addrs()?.collect();
            if addrs.is_empty() || !addrs.iter().all(|a| is_public(a.ip())) {
                return Err(std::io::Error::other("not a public address"));
            }
            Ok(addrs)
        })
        .build();
    let Ok(mut at) = url::Url::parse(url) else {
        return Got::Nothing;
    };
    for _ in 0..=HOPS {
        let resp = match agent.get(at.as_str()).call() {
            Ok(r) => r,
            Err(ureq::Error::Status(_, r)) => r,
            Err(_) => return Got::Nothing,
        };
        let status = resp.status();
        if follow && (300..400).contains(&status) {
            let next = resp.header("location").and_then(|l| at.join(l).ok());
            match next {
                Some(n) if same_site(host, n.host_str().unwrap_or("")) => {
                    at = n;
                    continue;
                }
                // A redirect off the site: nothing about this site is proven.
                _ => return Got::Nothing,
            }
        }
        let headers = resp
            .headers_names()
            .into_iter()
            .filter_map(|n| {
                resp.header(&n)
                    .map(|v| (n.to_ascii_lowercase(), v.to_string()))
            })
            .collect();
        let mut body = String::new();
        let _ = resp.into_reader().take(16 * 1024).read_to_string(&mut body);
        return Got::Answer(Response {
            status,
            headers,
            body,
        });
    }
    Got::Nothing
}

pub enum Tls {
    Leaf(Vec<u8>),
    BadCertificate,
    Nothing,
}

/// The site's leaf certificate, verified against the web's roots.
fn tls_leaf(host: &str) -> Tls {
    use rustls::pki_types::ServerName;
    let roots = rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    let Ok(builder) = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions() else {
        return Tls::Nothing;
    };
    let config = builder.with_root_certificates(roots).with_no_client_auth();
    let Ok(name) = ServerName::try_from(host.to_string()) else {
        return Tls::Nothing;
    };
    let Ok(mut conn) = rustls::ClientConnection::new(Arc::new(config), name) else {
        return Tls::Nothing;
    };
    let Some(addrs) = public_addrs(host, 443) else {
        return Tls::Nothing;
    };
    // The first address that answers, as a browser would.
    let Some(mut sock) = addrs
        .iter()
        .find_map(|a| TcpStream::connect_timeout(a, REQUEST).ok())
    else {
        return Tls::Nothing;
    };
    let _ = sock.set_read_timeout(Some(REQUEST));
    let _ = sock.set_write_timeout(Some(REQUEST));
    while conn.is_handshaking() {
        if let Err(e) = conn.complete_io(&mut sock) {
            use rustls::CertificateError as C;
            let theirs = matches!(
                e.get_ref().and_then(|i| i.downcast_ref::<rustls::Error>()),
                Some(rustls::Error::InvalidCertificate(
                    C::Expired
                        | C::ExpiredContext { .. }
                        | C::NotValidYet
                        | C::NotValidYetContext { .. }
                        | C::NotValidForName
                        | C::NotValidForNameContext { .. }
                ))
            );
            return if theirs {
                Tls::BadCertificate
            } else {
                Tls::Nothing
            };
        }
    }
    match conn.peer_certificates().and_then(|c| c.first()) {
        Some(c) => Tls::Leaf(c.as_ref().to_vec()),
        None => Tls::Nothing,
    }
}

/// DNS TXT records over HTTPS: `None` when the resolver gave no clean answer.
fn doh_txt(name: &str) -> Option<Vec<String>> {
    let agent = ureq::AgentBuilder::new().timeout(REQUEST).build();
    let resp = agent
        .get("https://cloudflare-dns.com/dns-query")
        .query("name", name)
        .query("type", "TXT")
        .set("Accept", "application/dns-json")
        .call()
        .ok()?;
    let mut body = String::new();
    resp.into_reader()
        .take(64 * 1024)
        .read_to_string(&mut body)
        .ok()?;
    parse_doh(&body)
}

// --- Judging (pure) --------------------------------------------------------

pub fn judge_https(host: &str, tls: &Tls, https: &Got, http: &Got) -> Option<&'static str> {
    if matches!(tls, Tls::BadCertificate) {
        return Some("failing");
    }
    let (Got::Answer(secure), Got::Answer(plain)) = (https, http) else {
        return None;
    };
    let redirects = (300..400).contains(&plain.status)
        && plain
            .header("location")
            .and_then(|l| url::Url::parse(l).ok())
            .is_some_and(|l| {
                let to = l.host_str().unwrap_or("").to_ascii_lowercase();
                l.scheme() == "https"
                    && (to == host || to == format!("www.{host}") || host == format!("www.{to}"))
            });
    let hsts = secure
        .header("strict-transport-security")
        .and_then(|v| {
            v.split(';').find_map(|p| {
                let (k, n) = p.trim().split_once('=')?;
                k.trim()
                    .eq_ignore_ascii_case("max-age")
                    .then(|| n.trim().trim_matches('"').parse::<u64>().ok())?
            })
        })
        .is_some_and(|age| age >= HSTS_MIN);
    Some(if redirects && hsts {
        "checked"
    } else {
        "failing"
    })
}

pub fn judge_certificate(tls: &Tls, now: i64) -> Option<&'static str> {
    match tls {
        Tls::BadCertificate => Some("failing"),
        Tls::Nothing => None,
        Tls::Leaf(der) => {
            let left = not_after(der)? - now;
            Some(if left >= RENEW_DAYS * 86_400 {
                "checked"
            } else {
                "failing"
            })
        }
    }
}

pub fn judge_headers(r: &Response) -> &'static str {
    let nosniff = r
        .header("x-content-type-options")
        .is_some_and(|v| v.trim().eq_ignore_ascii_case("nosniff"));
    let referrer = r
        .header("referrer-policy")
        .is_some_and(|v| !v.trim().is_empty());
    let frames = r.header("x-frame-options").is_some_and(|v| {
        matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "deny" | "sameorigin"
        )
    }) || r
        .header("content-security-policy")
        .is_some_and(frames_limited);
    if nosniff && referrer && frames {
        "checked"
    } else {
        "failing"
    }
}

/// A CSP whose `frame-ancestors` directive names sources and none is `*`.
fn frames_limited(csp: &str) -> bool {
    csp.split(';').any(|d| {
        let mut words = d.split_whitespace();
        words
            .next()
            .is_some_and(|n| n.eq_ignore_ascii_case("frame-ancestors"))
            && {
                let sources: Vec<&str> = words.collect();
                !sources.is_empty() && !sources.contains(&"*")
            }
    })
}

pub fn judge_security_txt(got: &Got) -> Option<&'static str> {
    let Got::Answer(r) = got else { return None };
    match r.status {
        200 => {
            let html = r
                .header("content-type")
                .is_some_and(|t| t.to_ascii_lowercase().contains("html"))
                || r.body.trim_start().starts_with('<');
            let contact = r
                .body
                .lines()
                .any(|l| l.trim_start().to_ascii_lowercase().starts_with("contact:"));
            Some(if !html && contact {
                "checked"
            } else {
                "failing"
            })
        }
        404 | 410 => Some("failing"),
        _ => None,
    }
}

/// SPF and DMARC: DMARC at the host or its nearest parent that has one (down
/// to two labels), SPF where DMARC was found or at the host.
pub fn judge_email(host: &str, txt: &dyn Fn(&str) -> Option<Vec<String>>) -> Option<&'static str> {
    // A host's subdomain shares its records with the host's other customers:
    // the person can't add any, and the walk up would find the host's own.
    if HOSTED.iter().any(|d| host.ends_with(&format!(".{d}"))) {
        return None;
    }
    let labels: Vec<&str> = host.split('.').collect();
    let has = |records: &[String], prefix: &str| {
        records
            .iter()
            .any(|r| r.trim_start().to_ascii_lowercase().starts_with(prefix))
    };
    let mut dmarc_at = None;
    for i in 0..labels.len().saturating_sub(1) {
        let domain = labels[i..].join(".");
        if has(&txt(&format!("_dmarc.{domain}"))?, "v=dmarc1") {
            dmarc_at = Some(domain);
            break;
        }
    }
    let spf = match &dmarc_at {
        Some(d) if d != host => has(&txt(d)?, "v=spf1") || has(&txt(host)?, "v=spf1"),
        _ => has(&txt(host)?, "v=spf1"),
    };
    Some(if dmarc_at.is_some() && spf {
        "checked"
    } else {
        "failing"
    })
}

/// Hosting platforms whose subdomains people deploy to without a domain of their own.
const HOSTED: [&str; 16] = [
    "vercel.app",
    "netlify.app",
    "pages.dev",
    "workers.dev",
    "github.io",
    "gitlab.io",
    "fly.dev",
    "onrender.com",
    "herokuapp.com",
    "web.app",
    "firebaseapp.com",
    "railway.app",
    "up.railway.app",
    "surge.sh",
    "azurewebsites.net",
    "amplifyapp.com",
];

/// A DNS JSON answer's TXT strings; NXDOMAIN is a clean "none".
pub fn parse_doh(body: &str) -> Option<Vec<String>> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    match v.get("Status")?.as_u64()? {
        0 | 3 => {}
        _ => return None,
    }
    Some(
        v.get("Answer")
            .and_then(|a| a.as_array())
            .map(|a| {
                a.iter()
                    .filter(|r| r.get("type").and_then(|t| t.as_u64()) == Some(16))
                    .filter_map(|r| r.get("data")?.as_str())
                    .map(|d| {
                        // "\"v=spf1 ...\" \"more\"" -> v=spf1 ...more
                        let parts: Vec<&str> = d.split('"').skip(1).step_by(2).collect();
                        if parts.is_empty() {
                            d.to_string()
                        } else {
                            parts.concat()
                        }
                    })
                    .collect()
            })
            .unwrap_or_default(),
    )
}

/// A DER certificate's notAfter, in seconds since the epoch.
pub fn not_after(der: &[u8]) -> Option<i64> {
    // Certificate SEQUENCE > tbsCertificate SEQUENCE > [0] version?, serial,
    // signature, issuer, validity SEQUENCE { notBefore, notAfter }.
    let (_, cert, _) = tlv(der)?;
    let (_, mut tbs, _) = tlv(cert)?;
    let (tag, _, rest) = tlv(tbs)?;
    if tag == 0xa0 {
        tbs = rest;
    }
    for _ in 0..3 {
        tbs = tlv(tbs)?.2;
    }
    let (_, validity, _) = tlv(tbs)?;
    let after = tlv(validity)?.2;
    let (tag, time, _) = tlv(after)?;
    let s = std::str::from_utf8(time).ok()?;
    let (year, rest) = match tag {
        0x17 => {
            let y: i64 = s.get(0..2)?.parse().ok()?;
            (if y >= 50 { 1900 + y } else { 2000 + y }, s.get(2..)?)
        }
        0x18 => (s.get(0..4)?.parse().ok()?, s.get(4..)?),
        _ => return None,
    };
    let n = |a: usize| -> Option<i64> { rest.get(a..a + 2)?.parse().ok() };
    let (month, day, hour, min, sec) = (n(0)?, n(2)?, n(4)?, n(6)?, n(8)?);
    // Days from the civil date (Howard Hinnant's algorithm).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + hour * 3600 + min * 60 + sec)
}

/// One DER element: (tag, contents, what follows).
fn tlv(b: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let tag = *b.first()?;
    let first = *b.get(1)? as usize;
    let (len, start) = if first < 0x80 {
        (first, 2)
    } else {
        let n = first & 0x7f;
        if n == 0 || n > 4 {
            return None;
        }
        let len = b
            .get(2..2 + n)?
            .iter()
            .fold(0usize, |a, x| (a << 8) | *x as usize);
        (len, 2 + n)
    };
    let end = start.checked_add(len)?;
    Some((tag, b.get(start..end)?, b.get(end..)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resp(status: u16, headers: &[(&str, &str)], body: &str) -> Got {
        Got::Answer(Response {
            status,
            headers: headers
                .iter()
                .map(|(n, v)| (n.to_string(), v.to_string()))
                .collect(),
            body: body.into(),
        })
    }

    // Catches a site URL taken from a host that isn't the product's own.
    #[test]
    fn only_a_public_host_of_their_own_counts() {
        assert_eq!(
            public_host("https://Acme.dev/app").as_deref(),
            Some("acme.dev")
        );
        assert_eq!(
            public_host("https://acme.github.io/").as_deref(),
            Some("acme.github.io")
        );
        for u in [
            "https://github.com/acme/app",
            "http://localhost:3000",
            "https://127.0.0.1/",
            "ftp://acme.dev",
            "https://*.acme.dev",
            "https://docs.example.com",
            "https://app.local/",
        ] {
            assert_eq!(public_host(u), None, "{u}");
        }
    }

    // Catches a pass without the redirect or a real HSTS, and a refused
    // connection read as a failure.
    #[test]
    fn https_needs_the_redirect_and_hsts() {
        let leaf = Tls::Leaf(vec![]);
        let hsts = resp(
            200,
            &[(
                "strict-transport-security",
                "max-age=31536000; includeSubDomains",
            )],
            "",
        );
        let to = |l: &str| resp(301, &[("location", l)], "");
        assert_eq!(
            judge_https("acme.dev", &leaf, &hsts, &to("https://www.acme.dev/")),
            Some("checked")
        );
        assert_eq!(
            judge_https("acme.dev", &leaf, &hsts, &to("http://acme.dev/")),
            Some("failing")
        );
        assert_eq!(
            judge_https("acme.dev", &leaf, &hsts, &resp(200, &[], "")),
            Some("failing")
        );
        let short = resp(200, &[("strict-transport-security", "max-age=300")], "");
        assert_eq!(
            judge_https("acme.dev", &leaf, &short, &to("https://acme.dev/")),
            Some("failing")
        );
        assert_eq!(
            judge_https(
                "acme.dev",
                &Tls::BadCertificate,
                &Got::Nothing,
                &Got::Nothing
            ),
            Some("failing")
        );
        assert_eq!(judge_https("acme.dev", &leaf, &hsts, &Got::Nothing), None);
    }

    #[test]
    fn headers_need_all_three() {
        let all = [
            ("x-content-type-options", "nosniff"),
            ("referrer-policy", "no-referrer"),
            ("content-security-policy", "frame-ancestors 'self'"),
        ];
        let Got::Answer(r) = resp(200, &all, "") else {
            unreachable!()
        };
        assert_eq!(judge_headers(&r), "checked");
        let Got::Answer(r) = resp(200, &all[..2], "") else {
            unreachable!()
        };
        assert_eq!(judge_headers(&r), "failing");
        // Any site may frame it: no protection, whatever the word says.
        let open = [
            all[0],
            all[1],
            (
                "content-security-policy",
                "default-src 'self'; frame-ancestors *",
            ),
        ];
        let Got::Answer(r) = resp(200, &open, "") else {
            unreachable!()
        };
        assert_eq!(judge_headers(&r), "failing");
        assert!(!frames_limited("default-src 'self' frame-ancestors-x"));
        assert!(frames_limited("frame-ancestors 'none'"));
    }

    // Catches a committed file aiming the probes at this machine's network,
    // and a redirect to another site judged as this one.
    #[test]
    fn only_public_addresses_and_the_site_itself_are_asked() {
        for private in [
            "127.0.0.1",
            "10.1.2.3",
            "192.168.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "::1",
            "fd00::1",
            "fe80::1",
            "::ffff:10.0.0.1",
        ] {
            assert!(!is_public(private.parse().unwrap()), "{private}");
        }
        for public in ["93.184.216.34", "2606:4700::1111"] {
            assert!(is_public(public.parse().unwrap()), "{public}");
        }
        assert!(same_site("acme.dev", "www.acme.dev"));
        assert!(same_site("www.acme.dev", "acme.dev"));
        assert!(!same_site("acme.dev", "evil.dev"));
    }

    // Catches an offline run wiping what an earlier one proved: a probe that
    // settled nothing keeps the old answers standing and asks again next run.
    #[test]
    fn an_offline_probe_keeps_the_last_answers() {
        let day = 24 * 3600;
        let held = Entry {
            host: "acme.dev".into(),
            probed: 1_000_000,
            items: BTreeMap::from([(
                "security-txt".to_string(),
                ("failing".to_string(), 1_000_000),
            )]),
        };
        let now = 1_000_000 + 2 * day;
        let kept = settle(held.clone(), &Items::new(), now);
        assert_eq!(kept, held);
        assert_eq!(
            kept.standing(now, STAND_IN).get("security-txt"),
            Some(&"failing")
        );
        let moved = settle(held, &Items::from([("https-enforced", "checked")]), now);
        assert_eq!(moved.probed, now);
        assert_eq!(moved.standing(now, STAND_IN).len(), 2);
    }

    // Catches an app's HTML fallback read as a security.txt, and a server
    // error read as a missing one.
    #[test]
    fn security_txt_needs_a_contact() {
        assert_eq!(
            judge_security_txt(&resp(
                200,
                &[("content-type", "text/plain")],
                "Contact: mailto:s@acme.dev\n"
            )),
            Some("checked")
        );
        assert_eq!(
            judge_security_txt(&resp(
                200,
                &[("content-type", "text/html")],
                "<html>Contact: x</html>"
            )),
            Some("failing")
        );
        assert_eq!(judge_security_txt(&resp(404, &[], "")), Some("failing"));
        assert_eq!(judge_security_txt(&resp(503, &[], "")), None);
        assert_eq!(judge_security_txt(&Got::Nothing), None);
    }

    // Catches DMARC looked up only at a subdomain, and a dead resolver read
    // as missing records.
    #[test]
    fn email_needs_spf_and_dmarc() {
        let dns = |name: &str| -> Option<Vec<String>> {
            Some(match name {
                "_dmarc.acme.dev" => vec!["v=DMARC1; p=none".into()],
                "acme.dev" => vec!["v=spf1 include:_spf.google.com ~all".into()],
                _ => vec![],
            })
        };
        assert_eq!(judge_email("app.acme.dev", &dns), Some("checked"));
        assert_eq!(
            judge_email("acme.dev", &|n: &str| dns(n).map(|r| if n == "acme.dev" {
                vec![]
            } else {
                r
            })),
            Some("failing")
        );
        assert_eq!(judge_email("acme.dev", &|_: &str| None), None);
        assert_eq!(judge_email("acme.vercel.app", &dns), None);
        assert_eq!(
            parse_doh(r#"{"Status":0,"Answer":[{"type":16,"data":"\"v=spf1 \" \"-all\""}]}"#),
            Some(vec!["v=spf1 -all".to_string()])
        );
        assert_eq!(parse_doh(r#"{"Status":3}"#), Some(vec![]));
        assert_eq!(parse_doh(r#"{"Status":2}"#), None);
    }

    // Catches a misread expiry date, and renewal judged on the wrong side
    // of fourteen days.
    #[test]
    fn certificate_expiry_is_read_from_the_leaf() {
        fn el(tag: u8, body: &[u8]) -> Vec<u8> {
            let mut v = vec![tag];
            if body.len() < 0x80 {
                v.push(body.len() as u8)
            } else {
                v.extend([0x81, body.len() as u8])
            }
            v.extend_from_slice(body);
            v
        }
        let validity = [el(0x17, b"260101000000Z"), el(0x18, b"20270115120000Z")].concat();
        let tbs = [
            el(0xa0, &el(0x02, &[2])),
            el(0x02, &[7]),
            el(0x30, &[]),
            el(0x30, &[]),
            el(0x30, &validity),
        ]
        .concat();
        let der = el(0x30, &[el(0x30, &tbs), el(0x30, &[])].concat());
        let at = not_after(&der).unwrap();
        assert_eq!(at, 1_800_014_400); // 2027-01-15T12:00:00Z
        let leaf = Tls::Leaf(der);
        assert_eq!(judge_certificate(&leaf, at - 30 * 86_400), Some("checked"));
        assert_eq!(judge_certificate(&leaf, at - 3 * 86_400), Some("failing"));
        assert_eq!(judge_certificate(&Tls::BadCertificate, 0), Some("failing"));
        assert_eq!(judge_certificate(&Tls::Nothing, 0), None);
    }
}
