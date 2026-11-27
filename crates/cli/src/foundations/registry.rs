//! The foundations the npm registry settles (REN-894): every direct
//! dependency in the root `package.json` exists under that exact name
//! (`real-packages`), and none is more than a major version behind its
//! latest release (`current-dependencies`). One small request per name
//! (`/-/package/<name>/dist-tags`), asked from this machine. Answers are
//! kept per name for a day (no network at all when every name is fresh)
//! and stand in for up to a week when the registry can't be reached, so an
//! offline `detect` never wipes what an earlier scan proved.

use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::path::Path;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const REGISTRY: &str = "https://registry.npmjs.org";
const BUDGET: Duration = Duration::from_secs(6);
const REQUEST: Duration = Duration::from_secs(3);
const WORKERS: usize = 16;
const FRESH: u64 = 24 * 3600;
const STAND_IN: u64 = 7 * 24 * 3600;

pub type Items = BTreeMap<&'static str, &'static str>;

/// What the registry said about one name.
#[derive(Clone, Debug, PartialEq)]
pub enum Answer {
    Latest(String),
    Missing,
}

/// A direct dependency the registry can judge.
#[derive(Clone, Debug, PartialEq)]
pub struct Dep {
    pub name: String,
    /// The declared range's lowest release line, when it names one.
    pub line: Option<(u64, u64)>,
}

#[derive(Default)]
pub struct Report {
    pub items: Items,
    /// Unscoped names the registry doesn't have.
    pub missing: Vec<String>,
    /// The furthest behind first: (name, declared line, latest line).
    pub behind: Vec<(String, String, String)>,
}

/// The registry items for the repository at `root` (its top).
pub fn check(root: &Path, env: &HashMap<String, String>) -> Report {
    let Ok(text) = std::fs::read_to_string(root.join("package.json")) else {
        return Report::default();
    };
    let deps = deps(&text);
    if deps.is_empty() {
        return Report::default();
    }
    let now = unix_now();
    let path = impeccable_account::config::impeccable_home(env)
        .map(|h| h.join("foundations-registry.json"));
    let mut cache = path.as_deref().map(read_cache).unwrap_or_default();
    let stale: Vec<String> = deps
        .iter()
        .filter(|d| {
            cache
                .get(&d.name)
                .is_none_or(|(_, at)| now.saturating_sub(*at) >= FRESH)
        })
        .map(|d| d.name.clone())
        .collect();
    if !stale.is_empty() {
        let base = env
            .get("IMPECCABLE_NPM_REGISTRY")
            .filter(|s| !s.is_empty())
            .map(|s| s.trim_end_matches('/').to_string())
            .unwrap_or_else(|| REGISTRY.to_string());
        for (name, answer) in ask(&base, stale) {
            cache.insert(name, (answer, now));
        }
        cache.retain(|_, (_, at)| now.saturating_sub(*at) < STAND_IN);
        if let Some(p) = &path {
            write_cache(p, &cache);
        }
    }
    let answers: HashMap<String, Answer> = cache
        .into_iter()
        .filter(|(_, (_, at))| now.saturating_sub(*at) < STAND_IN)
        .map(|(n, (a, _))| (n, a))
        .collect();
    judge(&deps, &answers, own_registry(root))
}

/// The registry items from what it answered. `private` is a project whose
/// `.npmrc` points at another registry: an unscoped name it lacks may live there.
pub fn judge(deps: &[Dep], answers: &HashMap<String, Answer>, private: bool) -> Report {
    let mut report = Report::default();
    let scoped = |n: &str| n.starts_with('@');
    // A scoped name npm lacks is a private package, not an invented one.
    let judged: Vec<&Dep> = deps
        .iter()
        .filter(|d| !(scoped(&d.name) && answers.get(&d.name) == Some(&Answer::Missing)))
        .collect();
    report.missing = judged
        .iter()
        .filter(|d| !scoped(&d.name) && answers.get(&d.name) == Some(&Answer::Missing))
        .map(|d| d.name.clone())
        .collect();
    let unknown_unscoped = judged
        .iter()
        .any(|d| !scoped(&d.name) && !answers.contains_key(&d.name));
    if !report.missing.is_empty() && !private {
        report.items.insert("real-packages", "failing");
    } else if report.missing.is_empty() && !unknown_unscoped {
        report.items.insert("real-packages", "checked");
    }

    let ranged: Vec<&&Dep> = judged
        .iter()
        .filter(|d| d.line.is_some() && answers.get(&d.name) != Some(&Answer::Missing))
        .collect();
    let mut lags = Vec::new();
    let mut unknown = 0;
    for d in &ranged {
        match answers.get(&d.name) {
            Some(Answer::Latest(v)) => match parse_line(v) {
                Some(latest) => {
                    let declared = d.line.expect("ranged");
                    lags.push((lag(declared, latest), d.name.clone(), declared, latest));
                }
                None => unknown += 1,
            },
            _ => unknown += 1,
        }
    }
    // More than a tenth unknown can hide the one that's far behind.
    if !lags.is_empty() && unknown * 10 <= ranged.len() {
        lags.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
        let failing = lags[0].0 >= 2;
        report.items.insert(
            "current-dependencies",
            if failing { "failing" } else { "checked" },
        );
        report.behind = lags
            .into_iter()
            .filter(|l| l.0 >= 2)
            .map(|(_, n, d, l)| (n, show(d), show(l)))
            .collect();
    }
    report
}

/// How many release lines `latest` is past `declared`; for 0.x the minor is
/// the line, and any 1.0 or later is past every 0.x.
pub fn lag(declared: (u64, u64), latest: (u64, u64)) -> u64 {
    match (declared.0, latest.0) {
        (0, 0) => latest.1.saturating_sub(declared.1),
        (0, m) => m + 1,
        (d, l) => l.saturating_sub(d),
    }
}

fn show((major, minor): (u64, u64)) -> String {
    if major == 0 {
        format!("0.{minor}")
    } else {
        major.to_string()
    }
}

/// The lowest release line a declared range allows: its first version
/// number (`^16.2` → 16, `>=1 <3` → 1, `~0.5.1` → 0.5). A tag (`beta`), `*`
/// or `latest` names none.
pub fn range_line(spec: &str) -> Option<(u64, u64)> {
    let s = spec.trim();
    let start = s.find(|c: char| c.is_ascii_digit())?;
    // Only operators and a `v` may come before the number.
    if !s[..start]
        .chars()
        .all(|c| matches!(c, '^' | '~' | '>' | '=' | '<' | 'v' | ' '))
    {
        return None;
    }
    parse_line(&s[start..])
}

/// `major.minor` of a version, the minor 0 when absent or a wildcard.
fn parse_line(v: &str) -> Option<(u64, u64)> {
    let mut parts = v.trim().trim_start_matches('v').split(['.', '-', '+', ' ']);
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().and_then(|m| m.parse().ok()).unwrap_or(0);
    Some((major, minor))
}

/// The direct dependencies the registry can judge, from `package.json`.
pub fn deps(package_json: &str) -> Vec<Dep> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(package_json) else {
        return Vec::new();
    };
    let mut out: BTreeMap<String, Dep> = BTreeMap::new();
    for field in ["devDependencies", "dependencies"] {
        let Some(map) = v.get(field).and_then(|m| m.as_object()) else {
            continue;
        };
        for (key, spec) in map {
            let Some(spec) = spec.as_str() else { continue };
            if let Some(dep) = dep(key, spec) {
                out.insert(dep.name.clone(), dep);
            }
        }
    }
    out.into_values().collect()
}

fn dep(key: &str, spec: &str) -> Option<Dep> {
    let spec = spec.trim();
    let (name, range) = match spec.strip_prefix("npm:") {
        // `npm:real-name@^1.2`: the aliased package is the one installed.
        Some(alias) => {
            let at = alias.get(1..)?.find('@').map(|i| i + 1);
            match at {
                Some(i) => (&alias[..i], &alias[i + 1..]),
                None => (alias, ""),
            }
        }
        None => (key, spec),
    };
    const LOCAL: [&str; 9] = [
        "workspace:",
        "file:",
        "link:",
        "portal:",
        "patch:",
        "git",
        "github:",
        "http:",
        "https:",
    ];
    if LOCAL.iter().any(|p| range.starts_with(p))
        || matches!(range, "*" | "latest" | "x")
        // `user/repo` is a GitHub shorthand, never a registry range.
        || (range.contains('/') && !range.contains("||"))
        || !valid_name(name)
    {
        return None;
    }
    Some(Dep {
        name: name.to_string(),
        line: range_line(range),
    })
}

fn valid_name(name: &str) -> bool {
    let ok = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_' | '~'))
    };
    match name.strip_prefix('@') {
        Some(rest) => rest.split_once('/').is_some_and(|(s, n)| ok(s) && ok(n)),
        None => ok(name) && name.len() <= 214,
    }
}

/// Whether the project's `.npmrc` installs unscoped packages from elsewhere.
fn own_registry(root: &Path) -> bool {
    std::fs::read_to_string(root.join(".npmrc")).is_ok_and(|t| {
        t.lines().any(|l| {
            let l = l.trim();
            l.strip_prefix("registry")
                .map(|r| r.trim_start().strip_prefix('=').unwrap_or("").trim())
                .is_some_and(|url| !url.is_empty() && !url.contains("registry.npmjs.org"))
        })
    })
}

// --- Asking the registry ---------------------------------------------------

/// Answers for `names`, from up to `WORKERS` requests at once, within
/// `BUDGET`. A name with no clean answer is left out.
fn ask(base: &str, names: Vec<String>) -> Vec<(String, Answer)> {
    let total = names.len();
    let queue = Arc::new(Mutex::new(names));
    let deadline = Instant::now() + BUDGET;
    let agent = ureq::AgentBuilder::new()
        .timeout(REQUEST)
        .user_agent("impeccable-foundations")
        .build();
    let (tx, rx) = mpsc::channel::<(String, Option<Answer>)>();
    for _ in 0..WORKERS.min(total) {
        let (queue, tx, agent, base) = (queue.clone(), tx.clone(), agent.clone(), base.to_string());
        std::thread::spawn(move || loop {
            if Instant::now() >= deadline {
                return;
            }
            let Some(name) = queue.lock().ok().and_then(|mut q| q.pop()) else {
                return;
            };
            let answer = dist_tags(&agent, &base, &name);
            if tx.send((name, answer)).is_err() {
                return;
            }
        });
    }
    drop(tx);
    let mut out = Vec::new();
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        match rx.recv_timeout(left) {
            Ok((name, Some(a))) => out.push((name, a)),
            Ok((_, None)) => {}
            Err(_) => break,
        }
    }
    out
}

fn dist_tags(agent: &ureq::Agent, base: &str, name: &str) -> Option<Answer> {
    let url = format!("{base}/-/package/{}/dist-tags", name.replace('/', "%2f"));
    match agent.get(&url).call() {
        Ok(resp) => {
            let mut body = String::new();
            resp.into_reader()
                .take(64 * 1024)
                .read_to_string(&mut body)
                .ok()?;
            let v: serde_json::Value = serde_json::from_str(&body).ok()?;
            Some(Answer::Latest(v.get("latest")?.as_str()?.to_string()))
        }
        Err(ureq::Error::Status(404, _)) => Some(Answer::Missing),
        // npm refuses a scoped name it doesn't publicly have: private, as a 404 is.
        Err(ureq::Error::Status(401 | 403, _)) if name.starts_with('@') => Some(Answer::Missing),
        Err(_) => None,
    }
}

// --- The kept answers ------------------------------------------------------

fn read_cache(path: &Path) -> HashMap<String, (Answer, u64)> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return HashMap::new();
    };
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str(&text) else {
        return HashMap::new();
    };
    map.into_iter()
        .filter_map(|(name, v)| {
            let at = v.get("at")?.as_u64()?;
            let answer = match v.get("latest").and_then(|l| l.as_str()) {
                Some(l) => Answer::Latest(l.to_string()),
                None if v.get("missing").and_then(|m| m.as_bool()) == Some(true) => Answer::Missing,
                None => return None,
            };
            Some((name, (answer, at)))
        })
        .collect()
}

fn write_cache(path: &Path, cache: &HashMap<String, (Answer, u64)>) {
    let body: serde_json::Map<String, serde_json::Value> = cache
        .iter()
        .map(|(name, (answer, at))| {
            let v = match answer {
                Answer::Latest(l) => serde_json::json!({ "latest": l, "at": at }),
                Answer::Missing => serde_json::json!({ "missing": true, "at": at }),
            };
            (name.clone(), v)
        })
        .collect();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("json.tmp");
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

#[cfg(test)]
mod tests {
    use super::*;

    fn d(name: &str, line: Option<(u64, u64)>) -> Dep {
        Dep {
            name: name.into(),
            line,
        }
    }
    fn latest(v: &str) -> Answer {
        Answer::Latest(v.into())
    }

    // Catches a range read as the wrong release line, and a tag or a local
    // path judged as a registry version.
    #[test]
    fn a_range_names_its_lowest_line() {
        assert_eq!(range_line("^16.2.0"), Some((16, 2)));
        assert_eq!(range_line(">=1 <3"), Some((1, 0)));
        assert_eq!(range_line("~0.5.1"), Some((0, 5)));
        assert_eq!(range_line("v2"), Some((2, 0)));
        assert_eq!(range_line("beta"), None);
        let found = deps(
            r#"{"dependencies":{"react":"^16.8.0","local":"file:../x","ws":"workspace:*","gh":"user/repo","any":"*","old":"npm:left-pad@^1.0.0"},"devDependencies":{"@acme/ui":"^2"}}"#,
        );
        assert_eq!(
            found,
            vec![
                d("@acme/ui", Some((2, 0))),
                d("left-pad", Some((1, 0))),
                d("react", Some((16, 8))),
            ]
        );
    }

    // Catches a private scoped package called invented, an unreachable name
    // read as a pass, and a missing name hidden behind an unknown one.
    #[test]
    fn only_a_missing_unscoped_name_fails_real_packages() {
        let deps = [d("react", None), d("@acme/ui", None), d("zz-made-up", None)];
        let mut answers = HashMap::from([
            ("react".to_string(), latest("19.0.0")),
            ("@acme/ui".to_string(), Answer::Missing),
            ("zz-made-up".to_string(), Answer::Missing),
        ]);
        let r = judge(&deps, &answers, false);
        assert_eq!(r.items.get("real-packages"), Some(&"failing"));
        assert_eq!(r.missing, vec!["zz-made-up".to_string()]);
        // Another registry in .npmrc may hold it: not proof.
        assert_eq!(
            judge(&deps, &answers, true).items.get("real-packages"),
            None
        );
        answers.insert("zz-made-up".into(), latest("1.0.0"));
        assert_eq!(
            judge(&deps, &answers, false).items.get("real-packages"),
            Some(&"checked")
        );
        answers.remove("zz-made-up");
        assert_eq!(
            judge(&deps, &answers, false).items.get("real-packages"),
            None
        );
    }

    // Catches one major behind read as failing, two read as passing, 0.x
    // lines compared by major, and a verdict on too few answers.
    #[test]
    fn current_dependencies_allow_one_major_behind() {
        assert_eq!(lag((16, 0), (19, 1)), 3);
        assert_eq!(lag((0, 5), (0, 6)), 1);
        assert_eq!(lag((0, 5), (1, 0)), 2);
        let deps = [d("react", Some((18, 0))), d("vite", Some((5, 0)))];
        let answers = HashMap::from([
            ("react".to_string(), latest("19.1.0")),
            ("vite".to_string(), latest("7.0.0")),
        ]);
        let r = judge(&deps, &answers, false);
        assert_eq!(r.items.get("current-dependencies"), Some(&"failing"));
        assert_eq!(r.behind, vec![("vite".into(), "5".into(), "7".into())]);
        let ok = HashMap::from([
            ("react".to_string(), latest("19.1.0")),
            ("vite".to_string(), latest("6.0.0")),
        ]);
        assert_eq!(
            judge(&deps, &ok, false).items.get("current-dependencies"),
            Some(&"checked")
        );
        // One of two unknown is more than a tenth: no verdict.
        let half = HashMap::from([("react".to_string(), latest("19.1.0"))]);
        assert_eq!(
            judge(&deps, &half, false).items.get("current-dependencies"),
            None
        );
    }
}
