//! `impeccable journeys`: someone from an app's cast takes a saved workflow,
//! or a goal given for the occasion, through the app at an address, and the
//! command reports each step, the issues they hit and where to watch it again.
//!
//! The service runs the journey (`/cli/v1/journeys` and `/cli/v1/workflows`,
//! scope `journeys:start`). In the person's own Chrome it runs through the
//! Impeccable extension, which takes it over from the journey's page. This
//! file starts one, opens that page, polls until the journey ends and prints
//! what the service says. Every refusal is a code with one fixed line here:
//! no sentence of the service's and no token is ever printed. With `--json`
//! stdout carries exactly one JSON object and the lines go to stderr.
//! docs/CLI-CONTRACT.md ("Journeys") has the whole contract.
use crate::config::Account;
use crate::http::{ApiError, Client};
use crate::session::{Session, SessionError};
use impeccable_common::Io;
use serde_json::{json, Map, Value};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const JOURNEYS: &str = "/cli/v1/journeys";
const WORKFLOWS: &str = "/cli/v1/workflows";

/// The states the service names, and the three a journey ends in. They are
/// the service's wire words; none reaches the person.
const STATES: [&str; 6] = [
    "queued",
    "waiting_for_browser",
    "walking",
    "done",
    "failed",
    "cancelled",
];
const ENDED: [&str; 3] = ["done", "failed", "cancelled"];
const DEVICES: [&str; 3] = ["desktop", "mobile", "tablet"];
/// In place of a persona's slug: the service picks one from the app's cast.
const ANYONE: &str = "auto";

const MAX_SLUG: usize = 64;
const MAX_GOAL: usize = 2000;
const MAX_URL: usize = 2048;

const POLL: Duration = Duration::from_secs(1);
/// How long a journey is watched before the command stops watching.
const JOURNEY_TIMEOUT: Duration = Duration::from_secs(20 * 60);
/// How long a journey may wait for the person's Chrome.
const BROWSER_WAIT: Duration = Duration::from_secs(2 * 60);
/// Polls in a row that may go unanswered before the command gives up.
const MISSES: u32 = 5;

const USAGE: &str = "Usage:
  impeccable journeys <workflow | \"a goal in plain words\"> (--url <address> | --pr <n>) [options]
      someone from your app's cast takes the saved workflow, or the goal,
      through your app and reports each step, the issues they hit and a
      link to watch it again
  impeccable journeys workflows [--repo <owner/name>] [--app <key>] [--json]
      list the app's saved workflows
  impeccable journeys status <id> [--wait <seconds>] [--json]
      where a journey stands; with --wait, follow it for at most that long first
  impeccable journeys stop <id> [--json]
      call a journey off
  impeccable journeys skill
      write the impeccable-journeys skill into this checkout, so your coding
      agent runs a journey after it changes a flow

Options:
  --url <address>      where the journey starts, such as http://localhost:5173/todos
  --pr <n>             start on pull request <n>'s preview instead
  --as <persona>       who takes it, by their slug (default: someone from the cast)
  --new                they arrive as someone new (default: someone who has been before)
  --device <size>      phone, tablet or desktop (default: the persona's own
                       device); several, such as phone,tablet, run one after
                       another
  --cloud              run it in Impeccable's browser instead of your Chrome
  --save <name>        save the goal as a workflow called <name>, then run it
  --detach             exit once the journey has started, printing its id and
                       page; it goes on, and `journeys status <id>` says how it went
  --wait <seconds>     journeys status: follow the journey for at most that long
                       (default: read it once)
  --repo <owner/name>  the repository (default: this checkout's origin)
  --app <key>          the app (default main)
  --json               print only the result, as one JSON object
  -h, --help           show this help

Journeys need your Impeccable account: run `impeccable login` once.

Exit codes:
  0  the journey reached its goal
  1  it ended without getting there, or stopped partway
  2  it couldn't start (a refusal, bad usage), or the command stopped
     watching before the end (timeout, Ctrl-C)
  3  journeys status only: it is still going
  4  not signed in: run `impeccable login`, then try again
  With several devices: 2 if any couldn't start, else 1 if any didn't get
  there, else 0. --detach exits 0 once the journey has started, and
  journeys stop 0 once it is called off (or had already ended).";

/// What the command was run on, for the lines that name it.
#[derive(Default, Clone)]
struct Ctx {
    repo: String,
    app: String,
    workflow: Option<String>,
    url: Option<String>,
    pr: Option<u64>,
    persona: Option<String>,
    save: Option<String>,
    id: Option<String>,
    /// The journey's page, once the service has named one this CLI may open.
    page: Option<String>,
    /// The device the journey is at, once the service has said.
    device: Option<String>,
    /// Whether the journey was called off when the command stopped watching it.
    cancelled: bool,
}

/// Why the command stopped short.
enum Stop {
    /// A refusal code [`refusal_line`] has a line for.
    Refusal(String),
    Timeout,
    Stopped,
    Unreachable,
    Outdated,
    Unknown,
    NoRepo,
    Usage(String),
    /// No sign-in this command can use, and the line that says what to do.
    SignIn(String),
}

/// One line for each refusal code the service's contract lists.
fn refusal_line(code: &str, c: &Ctx) -> Option<String> {
    let (repo, app) = (&c.repo, &c.app);
    let or = |v: &Option<String>| v.clone().unwrap_or_default();
    Some(match code {
        "not-enabled" => "Journeys aren't on for this workspace yet.".into(),
        "no-access" => format!("You don't have access to {repo} in Impeccable. Ask someone who does to add you."),
        "bad-request" => "Impeccable couldn't read what this version sent. Update the Impeccable CLI and try again.".into(),
        "no-repo" => format!("{repo} isn't connected to Impeccable. Set it up with `npx @impeccable/reviews` first."),
        // The refusal names no apps, so the line says where the key is: the end of the app's address in Impeccable.
        "no-app" => format!(
            "{repo} has no app called {app}. Add --app <key>, the end of the app's address in Impeccable (…/apps/{}/<key>).",
            repo.split('/').nth(1).unwrap_or("")
        ),
        "no-cast" => format!("{app} has no cast yet, so there's no one to take the journey. Add people to its cast in Impeccable first."),
        "no-persona" => format!("{app}'s cast has no one called {}. Leave out --as, or pick someone from the cast.", or(&c.persona)),
        "no-errand" => format!("{app} has no workflow called {}. Run `impeccable journeys workflows` to see the saved ones.", or(&c.workflow)),
        "slug-taken" => format!("{app} already has a workflow called {}. Save this one under another name.", or(&c.save)),
        "no-browser" => "No Chrome with the Impeccable extension is connected. Open Chrome with the extension, or add --cloud to run the journey in Impeccable's browser.".into(),
        "bad-url" => format!("Impeccable can't open {} for a journey. Check the address and try again.", or(&c.url)),
        "no-preview" => format!("Pull request #{} has no preview yet. Wait for it, or give --url.", c.pr.unwrap_or(0)),
        "no-outing" => "Impeccable can't find this journey anymore. Start it again.".into(),
        "too-many" => "That's a lot of journeys for now. Try again in a few minutes.".into(),
        "not-built" => "Impeccable can't do that yet. Try again after an update.".into(),
        "bad-device" => "Journeys run on a phone, a tablet or a desktop. Pick one or more of those with --device.".into(),
        "no-terms" => "This workspace hasn't accepted Impeccable's terms yet. Ask an owner to accept them in the app, then try again.".into(),
        "not-pro" => format!("Journeys come with Impeccable Pro, and this account doesn't include it. {}", crate::pro::PRICING),
        _ => return None,
    })
}

/// Why a journey that started ended `failed`, by the journey's own code.
/// The codes are free-form: the ones known here get a line of their own.
fn failure_line(code: &str, c: &Ctx) -> String {
    match code {
        "bad-url" => format!(
            "The journey couldn't open {}. Check that it loads, then try again.",
            c.url.as_deref().unwrap_or("the address")
        ),
        "no-browser" => "The journey lost your Chrome before the end. Keep Chrome open with the Impeccable extension, or add --cloud.".into(),
        "session-failed" => "The browser the journey ran in stopped partway. Run it again.".into(),
        "job-lost" => "Impeccable lost track of the journey partway. Run it again.".into(),
        "switched-off" => "Journeys were switched off for this workspace, so this one stopped. Nothing after that was run.".into(),
        "not-built" => "Impeccable can't finish this kind of journey yet. Try again after an update.".into(),
        _ => match &c.page {
            Some(page) => format!("Something went wrong on Impeccable's side. Run it again, or see what happened at {page}"),
            None => "Something went wrong on Impeccable's side. Run it again.".into(),
        },
    }
}

const SIGNED_OUT: &str =
    "Journeys need your Impeccable account. Run `impeccable login`, then try again.";
const EXPIRED: &str = "Your sign-in expired. Run `impeccable login`, then try again.";

impl Stop {
    /// The code `--json` prints.
    fn code(&self) -> &str {
        match self {
            Stop::Refusal(code) => code,
            Stop::Timeout => "timeout",
            Stop::Stopped => "stopped",
            Stop::Unreachable => "unreachable",
            Stop::Outdated => "outdated",
            Stop::Unknown => "unknown",
            Stop::NoRepo | Stop::Usage(_) => "bad-usage",
            Stop::SignIn(_) => "not-signed-in",
        }
    }

    fn line(&self, c: &Ctx) -> String {
        let minutes = JOURNEY_TIMEOUT.as_secs() / 60;
        let at = |words: &str| match &c.page {
            Some(page) => format!("{words} at {page}"),
            None => format!("{words}."),
        };
        match self {
            Stop::Refusal(code) => refusal_line(code, c).unwrap_or_default(),
            Stop::Timeout if c.cancelled => format!("The journey took longer than {minutes} minutes, so it was called off."),
            Stop::Timeout => at(&format!("The journey is taking longer than {minutes} minutes, so this stopped watching. It may still be going")),
            Stop::Stopped if c.id.is_none() => "Stopped before the next journey started.".into(),
            Stop::Stopped if c.cancelled => "Stopped. The journey is called off.".into(),
            Stop::Stopped => at("Stopped watching. The journey may still be going"),
            Stop::Unreachable => "Impeccable didn't answer. Try again in a minute.".into(),
            Stop::Outdated => "Impeccable answered in a way this version doesn't understand. Update the Impeccable CLI and try again.".into(),
            Stop::Unknown => "Impeccable turned this down for a reason this version doesn't know. Update the Impeccable CLI and try again.".into(),
            Stop::NoRepo => "Run this in a checkout of your GitHub repository, or name it with --repo owner/name.".into(),
            Stop::Usage(line) | Stop::SignIn(line) => line.clone(),
        }
    }

    fn exit(&self) -> i32 {
        if matches!(self, Stop::SignIn(_)) {
            4
        } else {
            2
        }
    }
}

/// A refused request's situation: its code's when the contract lists it,
/// the sign-in lines for a grant the service won't take, `unreachable` for
/// no answer or a server error, else `unknown`.
fn stop_of(e: SessionError) -> Stop {
    match e {
        SessionError::NotSignedIn => Stop::SignIn(SIGNED_OUT.into()),
        SessionError::Expired | SessionError::Api(ApiError::Status { status: 401, .. }) => {
            Stop::SignIn(EXPIRED.into())
        }
        SessionError::Api(ApiError::Status { status, code }) => match code.as_deref() {
            Some("not-signed-in") => Stop::SignIn(EXPIRED.into()),
            // A sign-in from before journeys: the grant lacks their scope.
            Some("insufficient_scope") => Stop::SignIn(
                "Journeys need a fresh sign-in. Run `impeccable login`, then try again.".into(),
            ),
            Some(code) if refusal_line(code, &Ctx::default()).is_some() => {
                Stop::Refusal(code.into())
            }
            // Where journeys are switched off the door is not there at all.
            None if status == 404 => Stop::Refusal("not-enabled".into()),
            _ if status >= 500 => Stop::Unreachable,
            _ => Stop::Unknown,
        },
        SessionError::Api(ApiError::Network(_)) => Stop::Unreachable,
        SessionError::Local(e) => {
            Stop::SignIn(format!("Couldn't read your Impeccable sign-in: {e}."))
        }
    }
}

/* ------------------------------- output ------------------------------- */

/// Where lines go, and whether they carry colour. With `--json`, stdout
/// carries the one object and every line goes to stderr.
struct Say {
    json: bool,
    color: bool,
}

impl Say {
    fn out(&self, io: &mut Io, line: &str) {
        io.out(&format!("{line}\n"));
        let _ = io.stdout.flush();
    }
    fn info(&self, io: &mut Io, line: &str) {
        if self.json {
            io.err(&format!("{line}\n"));
            let _ = io.stderr.flush();
        } else {
            self.out(io, line);
        }
    }
    /// The link on a line of its own, bare, so it copies whole.
    fn link(&self, io: &mut Io, words: &str, url: &str) {
        self.info(io, words);
        self.info(io, url);
    }
    fn ink(&self, open: &str, close: &str, s: &str) -> String {
        if self.color {
            format!("\x1b[{open}m{s}\x1b[{close}m")
        } else {
            s.to_string()
        }
    }
    fn bold(&self, s: &str) -> String {
        self.ink("1", "22", s)
    }
    fn dim(&self, s: &str) -> String {
        self.ink("2", "22", s)
    }
    fn green(&self, s: &str) -> String {
        self.ink("32", "39", s)
    }
    fn red(&self, s: &str) -> String {
        self.ink("31", "39", s)
    }
    fn yellow(&self, s: &str) -> String {
        self.ink("33", "39", s)
    }
}

fn color(io: &Io) -> bool {
    use std::io::IsTerminal;
    std::io::stdout().is_terminal()
        && io.env("NO_COLOR").is_none_or(|v| v.is_empty())
        && io.env("TERM").is_none_or(|t| t != "dumb")
}

/// Text from the service (what the persona did and found, workflow names)
/// reaches the terminal without its control characters, so no escape
/// sequence in it can move the cursor or recolour the screen.
fn plain(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).collect()
}

/// 48s, 1m 04s.
fn duration(ms: u64) -> String {
    let s = (ms + 500) / 1000;
    if s < 60 {
        format!("{s}s")
    } else {
        format!("{}m {:02}s", s / 60, s % 60)
    }
}

fn plural(n: u64, one: &str) -> String {
    format!("{n} {one}{}", if n == 1 { "" } else { "s" })
}

/// How a device reads to a person.
fn device_word(device: &str) -> &str {
    if device == "mobile" {
        "phone"
    } else {
        device
    }
}

fn on_device(device: Option<&str>) -> String {
    device.map_or(String::new(), |d| format!(" on a {}", device_word(d)))
}

/* ------------------------------- shapes ------------------------------- */

/// A workflow's slug: lowercase letters and digits in runs joined by single
/// hyphens.
fn slug_shape(v: &str) -> bool {
    !v.is_empty()
        && v.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !v.starts_with('-')
        && !v.ends_with('-')
        && !v.contains("--")
}

fn is_slug(v: &str) -> bool {
    v.len() <= MAX_SLUG && slug_shape(v)
}

/// `owner/name`, as GitHub spells them.
fn repo_shape(v: &str) -> bool {
    let name = |s: &str, max: usize, extra: &[u8]| {
        (1..=max).contains(&s.len())
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || extra.contains(&b))
    };
    v.split_once('/')
        .is_some_and(|(owner, repo)| name(owner, 39, b"") && name(repo, 100, b"._"))
}

fn app_shape(v: &str) -> bool {
    (1..=80).contains(&v.len())
        && v.as_bytes()[0].is_ascii_alphanumeric()
        && v.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}

/// A journey's id goes into a URL path, so nothing else is allowed through.
fn id_shape(v: &str) -> bool {
    (1..=64).contains(&v.len())
        && v.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// The devices `--device` names, in the order given, each once; `None` when
/// one is no device. `phone` is `mobile` by its everyday name.
fn parse_devices(given: &[String]) -> Option<Vec<String>> {
    let mut devices: Vec<String> = Vec::new();
    for name in given.iter().flat_map(|g| g.split(',')) {
        let name = name.trim().to_ascii_lowercase();
        let device = if name == "phone" { "mobile" } else { &name };
        if !DEVICES.contains(&device) {
            return None;
        }
        if !devices.iter().any(|d| d == device) {
            devices.push(device.to_string());
        }
    }
    Some(devices)
}

fn device_of(v: &Value) -> Option<String> {
    v.as_str()
        .filter(|d| DEVICES.contains(d))
        .map(str::to_string)
}

/// A page of the service's this CLI may show and open: https (http only
/// between a loopback service and a loopback page), without credentials, on
/// the service's own host or the site above it (`api.example.com` and
/// `example.com`). The CLI never builds a page address itself.
fn own_page(issuer: &str, raw: &str) -> Option<String> {
    let page = url::Url::parse(raw).ok()?;
    let service = url::Url::parse(issuer).ok()?;
    let loopback = crate::config::loopback_url(&service);
    let secure = page.scheme() == "https"
        || (loopback && page.scheme() == "http" && crate::config::loopback_url(&page));
    let same = match (page.host_str(), service.host_str()) {
        (Some(p), Some(s)) => {
            p == s
                || (loopback && crate::config::loopback_url(&page))
                || matches!(service.host(), Some(url::Host::Domain(_)))
                    && s.split_once('.').is_some_and(|(_, parent)| {
                        // Never a country-code suffix (service.co.uk -> co.uk).
                        parent
                            .rsplit_once('.')
                            .is_some_and(|(_, tld)| tld.len() > 2)
                            && (p == parent || p.ends_with(&format!(".{parent}")))
                    })
        }
        _ => false,
    };
    (secure && same && page.username().is_empty() && page.password().is_none())
        .then(|| page.into())
}

struct Step {
    n: u64,
    did: String,
    issue: Option<String>,
    /// The person said No to this step, or to one before it.
    said_no: bool,
}

/// Where a journey stands, as `GET /cli/v1/journeys/<id>` answers.
struct Status {
    id: String,
    state: String,
    steps: Vec<Step>,
    /// How it ended; `None` until it has.
    outcome: Option<Map<String, Value>>,
    error: Option<String>,
    device: Option<String>,
    page: Option<String>,
}

fn outcome_shape(v: &Value) -> bool {
    let list = |k: &str, each: &dyn Fn(&Value) -> bool| {
        v.get(k)
            .and_then(Value::as_array)
            .is_some_and(|a| a.iter().all(each))
    };
    v.get("finished").is_some_and(Value::is_boolean)
        && v.get("steps").is_some_and(Value::is_u64)
        && v.get("ms").is_some_and(Value::is_u64)
        && list("doneWhen", &|d| d["text"].is_string() && d["met"].is_boolean())
        && list("issues", &|i| i["step"].is_u64() && i["what"].is_string())
        && v.get("replayUrl")
            .is_some_and(|u| u.is_null() || u.is_string())
}

impl Status {
    fn read(v: &Value, id: &str, issuer: &str) -> Option<Status> {
        let state = v["state"].as_str().filter(|s| STATES.contains(s))?;
        if v["id"].as_str() != Some(id) {
            return None;
        }
        let mut steps = Vec::new();
        for s in v["steps"].as_array()? {
            let issue = match s.get("issue") {
                None => None,
                Some(i) => Some(i.as_str()?.to_string()),
            };
            steps.push(Step {
                n: s["n"].as_u64()?,
                did: s["did"].as_str()?.to_string(),
                issue,
                said_no: s["refused"] == "no",
            });
        }
        let outcome = match v.get("outcome")? {
            Value::Null => None,
            o if outcome_shape(o) => o.as_object().cloned(),
            _ => return None,
        };
        let error = match v.get("error") {
            None | Some(Value::Null) => None,
            Some(e) => Some(e.as_str()?.to_string()),
        };
        let device = match v.get("device") {
            None => None,
            Some(d) => Some(device_of(d)?),
        };
        Some(Status {
            id: id.to_string(),
            state: state.to_string(),
            steps,
            outcome,
            error,
            device,
            page: v["page"].as_str().and_then(|p| own_page(issuer, p)),
        })
    }

    /// The issues of the steps so far.
    fn issues(&self) -> Vec<Value> {
        self.steps
            .iter()
            .filter_map(|s| {
                let what = s.issue.as_ref()?;
                Some(json!({ "step": s.n, "page": "", "what": what }))
            })
            .collect()
    }

    /// What a journey that has ended answers with. The service fills
    /// `outcome` once it has ended; should it not, the result says what the
    /// steps say and no more.
    fn outcome(&self) -> Map<String, Value> {
        self.outcome.clone().unwrap_or_else(|| {
            json!({
                "finished": false, "steps": self.steps.len(), "ms": null,
                "doneWhen": [], "issues": self.issues(), "replayUrl": null,
            })
            .as_object()
            .cloned()
            .unwrap_or_default()
        })
    }
}

/* ------------------------------- the service ------------------------------- */

/// The signed-in session, and the calls a journey makes with it.
struct Door {
    session: Session,
    account: Account,
}

impl Door {
    fn open(io: &Io) -> Result<Door, Stop> {
        let account = Account::from_env(&io.env).map_err(|e| Stop::Usage(format!("{e}.")))?;
        let session = Session::load(&account).map_err(stop_of)?;
        Ok(Door { session, account })
    }

    /// One whole request takes at most `deadline`, connect to last byte.
    fn within(&mut self, deadline: Duration) {
        self.session.client = Client::with_deadline(&self.account, deadline);
    }

    fn get(&mut self, path: &str) -> Result<Value, Stop> {
        self.session.get(path).map_err(stop_of)
    }

    fn post(&mut self, path: &str, body: Value) -> Result<Value, Stop> {
        let url = format!("{}{path}", self.account.issuer);
        self.session
            .call(|client, token| client.post_json(&url, token, body.clone()))
            .map_err(stop_of)
    }
}

/// The GitHub repository this checkout's `origin` names, as `owner/name`.
fn checkout_repo(io: &Io) -> Option<String> {
    let remote = crate::health::git(&io.cwd.to_string_lossy(), &["remote", "get-url", "origin"])?;
    let slug = crate::health::normalize_remote(&remote)?
        .strip_prefix("https://github.com/")?
        .to_string();
    repo_shape(&slug).then_some(slug)
}

/// Ctrl-C stops watching, and the journey is called off on the way out.
static CTRL_C: AtomicBool = AtomicBool::new(false);

#[cfg(unix)]
fn watch_ctrl_c() {
    extern "C" fn on(_: libc::c_int) {
        CTRL_C.store(true, Ordering::SeqCst);
        // A second Ctrl-C ends the command at once.
        unsafe { libc::signal(libc::SIGINT, libc::SIG_DFL) };
    }
    unsafe { libc::signal(libc::SIGINT, on as extern "C" fn(libc::c_int) as libc::sighandler_t) };
}
#[cfg(not(unix))]
fn watch_ctrl_c() {}

fn ctrl_c() -> bool {
    CTRL_C.load(Ordering::SeqCst)
}

/// Opens `url` in the system browser unless `IMPECCABLE_NO_BROWSER` is set,
/// as `impeccable login` reads it; the link is printed either way.
fn open(io: &Io, url: &str) -> bool {
    !io.env_truthy("IMPECCABLE_NO_BROWSER") && crate::open_browser(url)
}

/* ------------------------------- commands ------------------------------- */

#[derive(Default)]
struct Args {
    url: Option<String>,
    pr: Option<String>,
    persona: Option<String>,
    save: Option<String>,
    wait: Option<String>,
    repo: Option<String>,
    app: Option<String>,
    devices: Vec<String>,
    new: bool,
    cloud: bool,
    detach: bool,
    json: bool,
    help: bool,
    words: Vec<String>,
}

/// `None` for an option this command doesn't have, or one missing its value.
fn parse_args(args: &[String]) -> Option<Args> {
    let mut a = Args::default();
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        let (name, inline) = match arg.split_once('=') {
            Some((name, value)) if name.starts_with("--") => (name, Some(value.to_string())),
            _ => (arg.as_str(), None),
        };
        let flag = match name {
            "--new" => Some(&mut a.new),
            "--cloud" => Some(&mut a.cloud),
            "--detach" => Some(&mut a.detach),
            "--json" => Some(&mut a.json),
            "--help" | "-h" => Some(&mut a.help),
            _ => None,
        };
        if let Some(flag) = flag {
            if inline.is_some() {
                return None;
            }
            *flag = true;
            continue;
        }
        if !name.starts_with('-') || name == "-" {
            a.words.push(arg.clone());
            continue;
        }
        let value = inline.or_else(|| rest.next().cloned())?;
        match name {
            "--url" => a.url = Some(value),
            "--pr" => a.pr = Some(value),
            "--as" => a.persona = Some(value),
            "--save" => a.save = Some(value),
            "--wait" => a.wait = Some(value),
            "--repo" => a.repo = Some(value),
            "--app" => a.app = Some(value),
            "--device" => a.devices.push(value),
            _ => return None,
        }
    }
    Some(a)
}

/// What one journey answers with: its exit code, and the object `--json`
/// prints for it.
struct Done {
    code: i32,
    json: Value,
    device: Option<String>,
}

/// `--save`: the goal saved as a workflow, once, before any journey; what
/// the journeys then name. Answers the part of the start request that says
/// what to do.
fn goal_of(
    target: &str,
    a: &Args,
    door: &mut Door,
    ctx: &mut Ctx,
    say: &Say,
    io: &mut Io,
) -> Result<Value, Stop> {
    if is_slug(target) {
        return Ok(json!({ "errand": target }));
    }
    let goal = target.trim();
    let Some(save) = &a.save else {
        return Ok(json!({ "goal": goal, "doneWhen": [] }));
    };
    let start_path = a
        .url
        .as_deref()
        .and_then(|u| url::Url::parse(u).ok())
        .map_or("/".to_string(), |u| u.path().to_string());
    // The first words of the goal, as the saved workflow's name.
    let words: Vec<&str> = goal.split_whitespace().take(6).collect();
    let name: String = words.join(" ").chars().take(60).collect();
    let name = name.trim_end().trim_end_matches(['.', ',', ';', ':', '!', '?']);
    let saved = door.post(
        WORKFLOWS,
        json!({
            "repo": ctx.repo, "app": ctx.app, "slug": save, "name": name, "goal": goal,
            "doneWhen": [], "startPath": start_path, "persona": a.persona,
        }),
    )?;
    let slug = saved["errand"]["slug"]
        .as_str()
        .filter(|s| is_slug(s))
        .ok_or(Stop::Outdated)?;
    ctx.workflow = Some(slug.to_string());
    say.info(
        io,
        &format!(
            "Saved as {}. Run it again any time with `impeccable journeys {slug}`.",
            say.bold(slug)
        ),
    );
    Ok(json!({ "errand": slug }))
}

/// One journey, at `device` or the persona's own: started, opened in Chrome
/// unless `--cloud`, watched to its end (or left going with `--detach`).
fn journey(
    goal: &Value,
    device: Option<&str>,
    a: &Args,
    door: &mut Door,
    ctx: &mut Ctx,
    say: &Say,
    io: &mut Io,
) -> Result<Done, Stop> {
    // Ctrl-C between journeys starts no further ones.
    if ctrl_c() {
        return Err(Stop::Stopped);
    }
    let persona = a.persona.as_deref().unwrap_or(ANYONE);
    let chrome = !a.cloud;
    let mut body = goal.clone();
    body["repo"] = ctx.repo.clone().into();
    body["app"] = ctx.app.clone().into();
    match (&ctx.url, ctx.pr) {
        (Some(url), _) => body["url"] = url.clone().into(),
        (None, pr) => body["pr"] = pr.into(),
    }
    body["persona"] = persona.into();
    body["browser"] = if chrome { "chrome" } else { "cloud" }.into();
    body["visitMode"] = if a.new { "new" } else { "returning" }.into();
    if let Some(device) = device {
        body["device"] = device.into();
    }
    let started = door.post(JOURNEYS, body)?;
    let id = started["id"]
        .as_str()
        .filter(|id| id_shape(id))
        .ok_or(Stop::Outdated)?
        .to_string();
    let state = started["state"]
        .as_str()
        .filter(|s| STATES.contains(s))
        .ok_or(Stop::Outdated)?;
    ctx.id = Some(id.clone());
    // What it is actually at: the service's word, so a journey without
    // --device names the persona's own.
    ctx.device = match started.get("device") {
        None => device.map(str::to_string),
        Some(d) => Some(device_of(d).ok_or(Stop::Outdated)?),
    };
    // The journey's page is what hands the journey to the extension, so a
    // journey with no page this CLI may open cannot be shown or run.
    let page = started["page"]
        .as_str()
        .and_then(|p| own_page(&door.account.issuer, p))
        .ok_or(Stop::Outdated)?;
    ctx.page = Some(page.clone());

    let who = if persona == ANYONE {
        "someone from the cast"
    } else {
        persona
    };
    let what = match goal["errand"].as_str() {
        Some(workflow) => workflow.to_string(),
        None => format!("\"{}\"", goal["goal"].as_str().unwrap_or("")),
    };
    let on = match (&ctx.url, ctx.pr) {
        (Some(url), _) => url.clone(),
        (None, pr) => format!("the preview of #{}", pr.unwrap_or(0)),
    };
    let at = ctx
        .device
        .as_deref()
        .map_or(String::new(), |d| format!(",{}", on_device(Some(d))));
    say.info(
        io,
        &format!(
            "Off we go: {} is taking {} on {on}{at}.",
            say.bold(who),
            say.bold(&what)
        ),
    );
    // Watched from here, the page says so, which lets the extension close
    // that page once the journey's tab is open, and that tab at the end.
    let hand_off = if chrome && !a.detach {
        let mut u = url::Url::parse(&page).map_err(|_| Stop::Outdated)?;
        u.query_pairs_mut().append_pair("from", "terminal");
        u.to_string()
    } else {
        page.clone()
    };
    let words = if !chrome {
        "Watch it here:"
    } else if open(io, &hand_off) {
        "It's in your Chrome now:"
    } else {
        "Open it in Chrome with the Impeccable extension:"
    };
    say.link(io, words, &page);
    if a.detach {
        say.info(io, &format!("It goes on without this. See how it's going with `impeccable journeys status {id}`, or stop it with `impeccable journeys stop {id}`."));
        let mut json = json!({ "id": id, "state": state, "page": page });
        if let Some(device) = &ctx.device {
            json["device"] = device.clone().into();
        }
        return Ok(Done {
            code: 0,
            json,
            device: ctx.device.clone(),
        });
    }

    match watch(&id, chrome, None, door, ctx, say, io) {
        Ok(done) => {
            // The result's page opens in the Chrome that ran it, beside the line that links it.
            if let Some(replay) = done.json["replayUrl"]
                .as_str()
                .filter(|_| chrome)
                .and_then(|u| own_page(&door.account.issuer, u))
            {
                open(io, &replay);
            }
            Ok(done)
        }
        Err(stop) => {
            // Stopped watching while it is under way (Ctrl-C, the timeout,
            // no Chrome turning up): it is called off, best effort.
            if matches!(stop, Stop::Stopped | Stop::Timeout)
                || matches!(&stop, Stop::Refusal(code) if code == "no-browser")
            {
                door.within(Duration::from_secs(3));
                ctx.cancelled = door
                    .post(&format!("{JOURNEYS}/{id}/cancel"), json!({}))
                    .is_ok();
            }
            Err(stop)
        }
    }
}

/// The journeys `--device` asks for, one after another (one Chrome): each
/// under a heading naming its device, then a short combined result. One that
/// can't start or is stopped ends the series, and the rest are not run.
fn journeys(
    target: &str,
    devices: &[String],
    a: &Args,
    door: &mut Door,
    ctx: &mut Ctx,
    say: &Say,
    io: &mut Io,
) -> Result<i32, Stop> {
    let goal = goal_of(target, a, door, ctx, say, io)?;
    if devices.len() <= 1 {
        let done = journey(&goal, devices.first().map(String::as_str), a, door, ctx, say, io)?;
        if a.json {
            say.out(io, &done.json.to_string());
        }
        return Ok(done.code);
    }
    let mut results: Vec<Done> = Vec::new();
    let mut ended = false;
    for (i, device) in devices.iter().enumerate() {
        if ended {
            results.push(Done {
                code: 2,
                json: json!({ "error": "not-run", "device": device }),
                device: Some(device.clone()),
            });
            continue;
        }
        let mut each = Ctx {
            id: None,
            page: None,
            cancelled: false,
            device: Some(device.clone()),
            ..ctx.clone()
        };
        if !a.json {
            let word = device_word(device);
            let heading = format!("{}{}", word[..1].to_uppercase(), &word[1..]);
            let gap = if i > 0 { "\n" } else { "" };
            say.out(
                io,
                &format!(
                    "{gap}{} {}",
                    say.bold(&heading),
                    say.dim(&format!("({} of {})", i + 1, devices.len()))
                ),
            );
        }
        match journey(&goal, Some(device), a, door, &mut each, say, io) {
            Ok(done) => results.push(done),
            Err(stop) => {
                say.info(io, &stop.line(&each));
                let at = each.device.clone().unwrap_or_else(|| device.clone());
                let mut json = json!({ "error": stop.code(), "device": at });
                if let Some(id) = &each.id {
                    json["id"] = id.clone().into();
                }
                results.push(Done {
                    code: stop.exit(),
                    json,
                    device: Some(device.clone()),
                });
                ended = true;
            }
        }
    }
    if a.json {
        let all: Vec<&Value> = results.iter().map(|r| &r.json).collect();
        say.out(io, &json!({ "journeys": all }).to_string());
    } else {
        say.out(io, "");
        say.out(io, &say.bold("All together:"));
        let word = |r: &Done| device_word(r.device.as_deref().unwrap_or("")).to_string();
        let width = results.iter().map(|r| word(r).len()).max().unwrap_or(0);
        for r in &results {
            let how = if r.code == 0 {
                say.green("made it")
            } else if r.json["error"] == "not-run" {
                say.dim("not run")
            } else if r.code >= 2 {
                "couldn't finish watching".into()
            } else if r.json["state"] == "done" {
                "didn't get there".into()
            } else if r.json["state"] == "cancelled" {
                "was cancelled".into()
            } else {
                "stopped partway".into()
            };
            let issues = match r.json["issues"].as_array() {
                Some(list) if list.is_empty() => ", no issues".to_string(),
                Some(list) => format!(", {}", plural(list.len() as u64, "issue")),
                None => String::new(),
            };
            say.out(io, &format!("  {:width$}  {how}{issues}", word(r)));
        }
    }
    Ok(results
        .iter()
        .map(|r| r.code)
        .find(|c| *c >= 2)
        .or_else(|| results.iter().map(|r| r.code).find(|c| *c == 1))
        .unwrap_or(0))
}

/// Polls the journey until it ends: each new step as it lands, then the
/// result. With `limit` (`journeys status`), the time is the caller's to
/// give: once it is up, the answer is where the journey stands, and one
/// waiting for Chrome is still going.
fn watch(
    id: &str,
    chrome: bool,
    limit: Option<Duration>,
    door: &mut Door,
    ctx: &mut Ctx,
    say: &Say,
    io: &mut Io,
) -> Result<Done, Stop> {
    let started = Instant::now();
    let total = limit.unwrap_or(JOURNEY_TIMEOUT);
    // `journeys status --wait` keeps to its time: no read runs far past it.
    door.within(match limit {
        Some(wait) => wait.clamp(Duration::from_secs(2), Duration::from_secs(10)),
        None => Duration::from_secs(10),
    });
    let path = format!("{JOURNEYS}/{id}");
    let mut last: Option<Status> = None;
    let mut shown = 0;
    let mut misses = 0;
    let mut waiting_since: Option<Instant> = None;
    loop {
        if ctrl_c() {
            return Err(Stop::Stopped);
        }
        match door.get(&path) {
            Err(Stop::Unreachable) => {
                misses += 1;
                if misses >= MISSES {
                    return Err(Stop::Unreachable);
                }
            }
            Err(stop) => return Err(stop),
            Ok(v) => {
                misses = 0;
                let mut status =
                    Status::read(&v, id, &door.account.issuer).ok_or(Stop::Outdated)?;
                if let Some(page) = &status.page {
                    ctx.page = Some(page.clone());
                }
                status.steps.sort_by_key(|s| s.n);
                let from = shown;
                for step in status.steps.iter().filter(|s| s.n > from) {
                    if !say.json {
                        let n = say.dim(&format!("{:>2}", step.n));
                        say.out(io, &format!("  {n}  {}", plain(&step.did)));
                        if let Some(issue) = &step.issue {
                            let issue = say.yellow(&format!("⚠ {}", plain(issue)));
                            say.out(io, &format!("      {issue}"));
                        }
                    }
                    shown = step.n;
                }
                if ENDED.contains(&status.state.as_str()) {
                    return Ok(result(&status, ctx, say, io));
                }
                // Only the person's Chrome can fail to turn up; the cloud
                // browser's wait counts towards the overall timeout.
                if status.state == "waiting_for_browser" && chrome && limit.is_none() {
                    let since = *waiting_since.get_or_insert_with(Instant::now);
                    if since.elapsed() >= BROWSER_WAIT {
                        return Err(Stop::Refusal("no-browser".into()));
                    }
                } else {
                    waiting_since = None;
                }
                last = Some(status);
            }
        }
        if started.elapsed() >= total {
            if limit.is_none() {
                return Err(Stop::Timeout);
            }
            // Time is up: where it stands, or that Impeccable didn't answer in time.
            return match &last {
                Some(status) => Ok(going(status, ctx, say, io)),
                None => Err(Stop::Unreachable),
            };
        }
        let wake = Instant::now() + POLL.min(total.saturating_sub(started.elapsed()));
        while Instant::now() < wake && !ctrl_c() {
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

/// A journey that has ended: exit 0 when it reached its goal, else 1.
fn result(status: &Status, ctx: &Ctx, say: &Say, io: &mut Io) -> Done {
    let outcome = status.outcome();
    let finished = outcome["finished"] == true;
    let code = if status.state == "done" && finished { 0 } else { 1 };
    // The code a failed journey passes on: the service's when it is shaped
    // like a code, else `unknown`.
    let failure = (status.state == "failed").then(|| {
        status
            .error
            .as_deref()
            .filter(|e| {
                (1..=64).contains(&e.len())
                    && e.as_bytes()[0].is_ascii_alphanumeric()
                    && e.bytes().all(|b| {
                        b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-'
                    })
            })
            .unwrap_or("unknown")
            .to_string()
    });
    let device = status.device.clone().or_else(|| ctx.device.clone());
    let mut json = Value::Object(outcome.clone());
    json["id"] = status.id.clone().into();
    json["state"] = status.state.clone().into();
    if let Some(device) = &device {
        json["device"] = device.clone().into();
    }
    if let Some(failure) = &failure {
        json["error"] = failure.clone().into();
    }
    let done = Done { code, json, device };
    if say.json {
        return done;
    }
    let on = on_device(done.device.as_deref());
    let steps = plural(outcome["steps"].as_u64().unwrap_or(0), "step");
    let took = match outcome["ms"].as_u64() {
        Some(ms) => format!("{steps} in {}", duration(ms)),
        None => steps.clone(),
    };
    // The first step the person said No to, as the journey's page names it.
    let said_no = status.steps.iter().find(|s| s.said_no).map(|s| s.n);
    say.out(io, "");
    let headline = match (code, status.state.as_str(), said_no) {
        (0, _, _) => say.green(&format!("Made it{on}: {took}.")),
        (_, "done", Some(n)) => format!("You said No at step {n}, so it didn't get done{on}: {took}."),
        (_, "done", None) => format!("Didn't get there{on}: {took}."),
        (_, "cancelled", _) => format!("The journey{on} was cancelled after {steps}."),
        _ => format!("The journey{on} stopped partway: {took}."),
    };
    say.out(io, &say.bold(&headline));
    if let Some(failure) = &failure {
        say.out(io, &failure_line(failure, ctx));
    }
    for d in outcome["doneWhen"].as_array().into_iter().flatten() {
        let mark = if d["met"] == true {
            say.green("✓")
        } else {
            say.red("✗")
        };
        say.out(io, &format!("  {mark} {}", plain(d["text"].as_str().unwrap_or(""))));
    }
    let issues = outcome["issues"].as_array().cloned().unwrap_or_default();
    if issues.is_empty() {
        say.out(io, "No issues.");
    } else {
        say.out(io, &say.bold(&say.yellow(&plural(issues.len() as u64, "issue"))));
    }
    for i in &issues {
        let page = match i["page"].as_str().filter(|p| !p.is_empty()) {
            Some(page) => format!(" on {}", plain(page)),
            None => String::new(),
        };
        let at = say.dim(&format!("step {}{page}", i["step"]));
        say.out(io, &format!("  {at}  {}", plain(i["what"].as_str().unwrap_or(""))));
    }
    if let Some(replay) = outcome["replayUrl"].as_str() {
        say.out(io, &format!("Watch it again: {}", plain(replay)));
    }
    done
}

/// A journey that has not ended, as `journeys status` answers it: exit 3,
/// its steps and issues so far, and where to watch it.
fn going(status: &Status, ctx: &Ctx, say: &Say, io: &mut Io) -> Done {
    let device = status.device.clone().or_else(|| ctx.device.clone());
    let mut json = json!({
        "id": status.id, "state": status.state, "steps": status.steps.len(), "issues": status.issues(),
    });
    if let Some(device) = &device {
        json["device"] = device.clone().into();
    }
    if let Some(page) = &ctx.page {
        json["page"] = page.clone().into();
    }
    let done = Done {
        code: 3,
        json,
        device,
    };
    if say.json {
        return done;
    }
    say.out(io, "");
    let headline = match status.state.as_str() {
        "walking" => format!(
            "Still going{}: {} so far.",
            on_device(done.device.as_deref()),
            plural(status.steps.len() as u64, "step")
        ),
        "waiting_for_browser" => {
            "Not started yet: waiting for Chrome with the Impeccable extension.".into()
        }
        _ => "Not started yet.".into(),
    };
    say.out(io, &say.bold(&headline));
    let again = format!("Check again with `impeccable journeys status {} --wait 60`", status.id);
    match &ctx.page {
        Some(page) => say.link(io, &format!("{again}, or watch it here:"), page),
        None => say.out(io, &format!("{again}.")),
    }
    done
}

/// `journeys stop <id>`: the cancel Ctrl-C sends. A journey that had
/// already ended answers with the state it ended in.
fn stop(id: &str, door: &mut Door, say: &Say, io: &mut Io) -> Result<i32, Stop> {
    let answer = door.post(&format!("{JOURNEYS}/{id}/cancel"), json!({}))?;
    let state = answer["state"]
        .as_str()
        .filter(|s| STATES.contains(s))
        .ok_or(Stop::Outdated)?;
    if say.json {
        say.out(io, &json!({ "id": id, "state": state }).to_string());
    }
    say.info(
        io,
        &if state == "cancelled" {
            "The journey is called off.".to_string()
        } else {
            format!("That journey had already ended. See how it went with `impeccable journeys status {id}`.")
        },
    );
    Ok(0)
}

/// `journeys workflows`: the app's saved workflows.
fn workflows(door: &mut Door, ctx: &Ctx, say: &Say, io: &mut Io) -> Result<i32, Stop> {
    let query: String = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("repo", &ctx.repo)
        .append_pair("app", &ctx.app)
        .finish();
    let answer = door.get(&format!("{WORKFLOWS}?{query}"))?;
    let list = answer["errands"]
        .as_array()
        .filter(|list| {
            list.iter().all(|e| {
                e["slug"].is_string()
                    && e["name"].is_string()
                    && (e["persona"].is_null() || e["persona"].is_string())
            })
        })
        .ok_or(Stop::Outdated)?;
    if say.json {
        say.out(io, &answer.to_string());
        return Ok(0);
    }
    if list.is_empty() {
        let app = if ctx.app == "main" {
            String::new()
        } else {
            format!(" ({})", ctx.app)
        };
        say.out(io, &format!("No saved workflows for {}{app} yet. Save one with `impeccable journeys \"what to try\" --url <address> --save <name>`.", ctx.repo));
        return Ok(0);
    }
    let text = |e: &Value, k: &str| plain(e[k].as_str().unwrap_or(""));
    let width = list.iter().map(|e| text(e, "slug").len()).max().unwrap_or(0);
    for e in list {
        let usually = match e["persona"].as_str() {
            Some(persona) => say.dim(&format!("  · usually {}", plain(persona))),
            None => String::new(),
        };
        let slug = say.bold(&format!("{:width$}", text(e, "slug")));
        say.out(io, &format!("  {slug}  {}{usually}", text(e, "name")));
    }
    Ok(0)
}

const SKILL: &str = include_str!("journeys_skill.md");
/// Where agents look for skills: Claude Code, and the shared folder Codex,
/// Cursor and others read.
const SKILL_HOMES: [&str; 2] = [".claude/skills", ".agents/skills"];

/// `journeys skill`: writes the instructions into the checkout. It starts
/// no journey and needs no sign-in.
fn skill(io: &mut Io) -> i32 {
    let cwd = io.cwd.to_string_lossy().into_owned();
    let root = crate::health::git(&cwd, &["rev-parse", "--show-toplevel"])
        .map(|top| std::path::PathBuf::from(top.trim()))
        .unwrap_or_else(|| io.cwd.clone());
    for home in SKILL_HOMES {
        let file = format!("{home}/impeccable-journeys/SKILL.md");
        let path = root.join(&file);
        let written = path
            .parent()
            .map_or(Ok(()), std::fs::create_dir_all)
            .and_then(|()| std::fs::write(&path, SKILL));
        if let Err(e) = written {
            io.err(&format!("Couldn't write {file}: {e}\n"));
            return 1;
        }
        io.out(&format!("Wrote {file}\n"));
    }
    io.out("Commit them, and your coding agent runs a journey through the flows it changes.\n");
    0
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let Some(a) = parse_args(args) else {
        if args.iter().any(|x| x == "--json") {
            io.out("{\"error\":\"bad-usage\"}\n");
            io.err(&format!("{USAGE}\n"));
        } else {
            io.out(&format!("{USAGE}\n"));
        }
        return 2;
    };
    if a.help {
        io.out(&format!("{USAGE}\n"));
        return 0;
    }
    // A workflow may be called `status` too: with somewhere to start, it is
    // that workflow.
    let sub = match a.words.first().map(String::as_str) {
        Some(s @ ("status" | "stop" | "workflows" | "skill"))
            if a.url.is_none() && a.pr.is_none() =>
        {
            Some(s)
        }
        _ => None,
    };
    if sub == Some("skill") && a.words.len() == 1 {
        return skill(io);
    }
    let say = Say {
        json: a.json,
        color: !a.json && color(io),
    };
    let mut ctx = Ctx {
        repo: a.repo.clone().unwrap_or_default(),
        app: a.app.clone().unwrap_or_else(|| "main".into()),
        url: a.url.clone(),
        persona: a.persona.clone(),
        save: a.save.clone(),
        ..Ctx::default()
    };
    match go(&a, sub, &mut ctx, &say, io) {
        Ok(code) => code,
        Err(stop) => {
            if a.json {
                let mut json = json!({ "error": stop.code() });
                if let Some(device) = &ctx.device {
                    json["device"] = device.clone().into();
                }
                if let Some(id) = &ctx.id {
                    json["id"] = id.clone().into();
                }
                say.out(io, &json.to_string());
            }
            say.info(io, &stop.line(&ctx));
            stop.exit()
        }
    }
}

fn go(a: &Args, sub: Option<&str>, ctx: &mut Ctx, say: &Say, io: &mut Io) -> Result<i32, Stop> {
    let usage = |line: String| Stop::Usage(format!("{line}\n\n{USAGE}"));
    let target = a.words.join(" ").trim().to_string();
    let starts = a.detach
        || a.save.is_some()
        || !a.devices.is_empty()
        || a.persona.is_some()
        || a.new
        || a.cloud;
    let mut devices = Vec::new();
    match sub {
        Some(sub @ ("status" | "stop")) => {
            let id = a.words.get(1).filter(|id| a.words.len() == 2 && id_shape(id));
            let Some(id) = id else {
                return Err(usage(format!("Name the journey by the id it printed, such as `impeccable journeys {sub} <id>`.")));
            };
            if starts {
                let wait = if sub == "status" { ", --wait" } else { "" };
                return Err(usage(format!("journeys {sub} takes only the journey's id{wait} and --json.")));
            }
            let wait = match (&a.wait, sub) {
                (None, _) => 0,
                (Some(_), "stop") => return Err(usage("journeys stop takes no --wait.".into())),
                (Some(w), _) => w
                    .parse::<u32>()
                    .ok()
                    .filter(|_| w.len() <= 5)
                    .ok_or_else(|| usage("--wait needs a number of seconds, such as --wait 60.".into()))?,
            };
            let mut door = Door::open(io)?;
            ctx.id = Some(id.clone());
            if sub == "stop" {
                return stop(id, &mut door, say, io);
            }
            watch_ctrl_c();
            let limit = Some(Duration::from_secs(wait.into()));
            let done = watch(id, true, limit, &mut door, ctx, say, io)?;
            if a.json {
                say.out(io, &done.json.to_string());
            }
            return Ok(done.code);
        }
        Some(_) => {
            if a.words.len() != 1 || starts || a.wait.is_some() {
                return Err(Stop::Usage(USAGE.into()));
            }
        }
        None => {
            let pr = a.pr.as_deref().map(|pr| pr.parse::<u64>().ok().filter(|n| *n > 0));
            let http = |u: &str| {
                let u = u.to_ascii_lowercase();
                u.starts_with("http://") || u.starts_with("https://")
            };
            let line = if target.is_empty() {
                Some("Name a workflow, or say what to try in quotes.".to_string())
            } else if a.url.is_some() == a.pr.is_some() {
                Some("Give exactly one of --url <address> or --pr <number>.".into())
            } else if pr == Some(None) {
                Some("--pr needs a pull request number.".into())
            } else if a.url.as_deref().is_some_and(|u| !http(u)) {
                Some("--url needs a full address, such as http://localhost:5173/todos.".into())
            } else if slug_shape(&target) && !is_slug(&target) {
                Some(format!("A workflow's name is at most {MAX_SLUG} characters."))
            } else if target.chars().count() > MAX_GOAL {
                Some(format!("Say what to try in at most {MAX_GOAL} characters."))
            } else if a.url.as_deref().is_some_and(|u| u.len() > MAX_URL) {
                Some(format!("--url is at most {MAX_URL} characters."))
            } else if a.save.is_some() && is_slug(&target) {
                Some("--save goes with a goal in plain words, not a saved workflow.".into())
            } else if a.save.as_deref().is_some_and(|s| !is_slug(s)) {
                Some(format!("--save needs a name of at most {MAX_SLUG} characters, in lowercase words joined by -, such as add-a-todo."))
            } else if a.persona.as_deref().is_some_and(|p| !is_slug(p)) {
                Some("--as needs a persona's slug, such as dana.".into())
            } else if a.wait.is_some() {
                Some("--wait goes with `journeys status <id>`.".into())
            } else {
                None
            };
            if let Some(line) = line {
                return Err(usage(line));
            }
            ctx.pr = pr.flatten();
            ctx.workflow = is_slug(&target).then(|| target.clone());
            devices = parse_devices(&a.devices).ok_or(Stop::Refusal("bad-device".into()))?;
            // Several journeys run one after another in one Chrome, so only one can be left going.
            if a.detach && devices.len() > 1 {
                return Err(usage("--detach takes one device at a time.".into()));
            }
        }
    }
    if a.repo.as_deref().is_some_and(|r| !repo_shape(r)) {
        return Err(Stop::Usage(
            "--repo needs a repository as owner/name, such as acme/storefront.".into(),
        ));
    }
    if a.app.as_deref().is_some_and(|k| !app_shape(k)) {
        return Err(Stop::Usage("--app needs an app's key, such as storefront.".into()));
    }
    ctx.repo = match &a.repo {
        Some(repo) => repo.clone(),
        None => checkout_repo(io).ok_or(Stop::NoRepo)?,
    };
    let mut door = Door::open(io)?;
    if sub.is_some() {
        return workflows(&mut door, ctx, say, io);
    }
    watch_ctrl_c();
    journeys(&target, &devices, a, &mut door, ctx, say, io)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_is_opened_only_on_the_services_own_site() {
        // Catches: a start answer naming another site's page, which the CLI would open in the person's browser and print as the journey's.
        let api = "https://api.impeccable.style";
        for page in [
            "https://impeccable.style/app/acme/journeys/j1",
            "https://api.impeccable.style/j/1",
        ] {
            assert!(own_page(api, page).is_some(), "{page}");
        }
        for page in [
            "http://impeccable.style/j/1",
            "https://evil.example/j/1",
            "https://impeccable.style.evil.example/j/1",
            "https://user:pw@impeccable.style/j/1",
            "javascript:alert(1)",
        ] {
            assert!(own_page(api, page).is_none(), "{page}");
        }
        let local = "http://127.0.0.1:8787";
        assert!(own_page(local, "http://localhost:5173/j/1").is_some());
        assert!(own_page(local, "http://evil.example/j/1").is_none());
    }

    #[test]
    fn devices_are_named_once_each_and_a_phone_is_mobile() {
        // Catches: `--device phone,phone,tablet` running the phone twice, or an unknown size starting a journey at the default.
        let given = |v: &[&str]| parse_devices(&v.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert_eq!(
            given(&["phone, Tablet", "mobile"]),
            Some(vec!["mobile".to_string(), "tablet".to_string()])
        );
        assert_eq!(given(&["watch"]), None);
        assert_eq!(given(&[]), Some(vec![]));
    }

    #[test]
    fn the_services_words_lose_their_control_characters() {
        // Catches: an escape sequence in a step's text recolouring or clearing the person's terminal.
        assert_eq!(plain("Clicked \x1b[31mSave\x1b[0m\x07"), "Clicked [31mSave[0m");
    }

    #[test]
    fn a_status_the_cli_cannot_read_is_refused_whole() {
        // Catches: a half-read status printing steps for another journey, or a state this version has no line for.
        let ok = json!({ "id": "j1", "state": "walking", "steps": [{ "n": 1, "did": "Opened /", "said": "" }], "outcome": null, "error": null, "device": "mobile" });
        let read = |v: &Value| Status::read(v, "j1", "https://api.impeccable.style");
        assert!(read(&ok).is_some());
        for (key, bad) in [
            ("id", json!("j2")),
            ("state", json!("flying")),
            ("steps", json!([{ "n": "1", "did": "x" }])),
            ("outcome", json!({ "finished": true })),
            ("device", json!("watch")),
        ] {
            let mut v = ok.clone();
            v[key] = bad;
            assert!(read(&v).is_none(), "{key}");
        }
    }
}
