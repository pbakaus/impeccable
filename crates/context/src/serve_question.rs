//! JS: serve-question.mjs -> `impeccable serve-question`
//!
//! Modes: --schema, --wait, --stop, --update, --start (spawns this binary
//! detached with --detached-serve), and the blocking/detached server itself.

use crate::jsp;
use crate::question_page::PAGE;
use crate::util::{exists, is_dir, iso_now, json_compact, json_pretty, mtime_ms, now_ms, safe_read, utf16_len, Env};
use impeccable_common::Io;
use serde_json::{json, Map, Value};
use std::sync::{Arc, Mutex};

const NEXT_CLAIM_GRACE_MS: f64 = 10000.0;

struct Args<'a> {
    argv: &'a [String],
}

impl<'a> Args<'a> {
    fn arg(&self, name: &str) -> Option<String> {
        let i = self.argv.iter().position(|a| a == &format!("--{}", name))?;
        let v = self.argv.get(i + 1)?;
        if !v.is_empty() && !v.starts_with("--") {
            Some(v.clone())
        } else {
            None
        }
    }
    fn arg_or(&self, name: &str, fallback: &str) -> String {
        self.arg(name).unwrap_or_else(|| fallback.to_string())
    }
    fn has(&self, name: &str) -> bool {
        self.argv.iter().any(|a| a == &format!("--{}", name))
    }
}

fn env_set(env: &Env, key: &str) -> bool {
    env.get(key).map(|v| !v.is_empty()).unwrap_or(false)
}

fn state_file(qdir: &str, key: &str) -> String {
    jsp::join(&[qdir, &format!("{}.state.json", key)])
}
fn answer_file(qdir: &str, key: &str) -> String {
    jsp::join(&[qdir, &format!("{}.answer.json", key)])
}
fn flip_file(qdir: &str, key: &str) -> String {
    jsp::join(&[qdir, &format!("{}.flip.json", key)])
}
fn next_file(qdir: &str, key: &str) -> String {
    jsp::join(&[qdir, &format!("{}.next.json", key)])
}
/// `<key>.render-check`: the id of the hand whose render-check line `--wait`
/// already printed, so the line prints once per round, not once per poll. A
/// new hand carries a new id, so the next round prints it again.
fn render_check_file(qdir: &str, key: &str) -> String {
    jsp::join(&[qdir, &format!("{}.render-check", key)])
}

/// `process.kill(pid, 0)`: Ok(()) alive, Err(true) EPERM (alive but unsignalable), Err(false) dead.
fn pid_probe(pid: i64) -> Result<(), bool> {
    match impeccable_common::proc::kill0(pid) {
        Ok(()) => Ok(()),
        Err("EPERM") => Err(true),
        Err(_) => Err(false),
    }
}

/// `process.kill(pid)` (SIGTERM; TerminateProcess on Windows), errors ignored.
fn kill_pid(pid: i64) {
    impeccable_common::proc::terminate(pid);
}

fn read_state(qdir: &str, key: &str) -> Option<Map<String, Value>> {
    let text = safe_read(&state_file(qdir, key))?;
    serde_json::from_str::<Value>(&text).ok()?.as_object().cloned()
}

fn num_field(m: &Map<String, Value>, key: &str) -> Option<f64> {
    m.get(key).and_then(|v| v.as_f64())
}

fn is_alive(qdir: &str, key: &str) -> bool {
    let Some(state) = read_state(qdir, key) else { return false };
    if let Some(lb) = num_field(&state, "lastBeat") {
        if lb != 0.0 && now_ms() - lb < 12000.0 {
            return true;
        }
    }
    // process.kill(state.pid, 0): pid undefined -> throws TypeError (not EPERM) -> false
    let Some(pid) = state.get("pid").and_then(|p| p.as_f64()) else { return false };
    match pid_probe(pid as i64) {
        Ok(()) => true,
        Err(eperm) => eperm,
    }
}

/// A comp-round comp sits directly in `.impeccable/mocks/` (build-phase's
/// comps gate lists that directory); decision comps live one level down in
/// `.impeccable/mocks/decision/`. Anything else keeps the decision wording.
fn is_comp_round_comp(path: &str) -> bool {
    let p = path.replace('\\', "/");
    let dir = p.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    let dir = dir.strip_prefix("./").unwrap_or(dir);
    dir == ".impeccable/mocks" || dir.ends_with("/.impeccable/mocks")
}

/// The comp round's option one: the decision comp `build-phase start
/// --decision-comp` recorded, while that build's comps phase is open, served
/// on a page that is the comp round (it also serves a comp directly in
/// `.impeccable/mocks/`). A pick of it there is the approval, not a new
/// option one; on any other page the same path is an ordinary decision slot.
fn is_comp_rounds_option_one(cwd: &str, path: &str, served: &[String]) -> bool {
    served.iter().any(|c| is_comp_round_comp(c)) && is_open_rounds_decision_comp(cwd, path)
}

fn is_open_rounds_decision_comp(cwd: &str, path: &str) -> bool {
    let Some(state) = safe_read(&jsp::resolve(cwd, &[".impeccable/build/state.json"])).and_then(|raw| serde_json::from_str::<Value>(&raw).ok()) else { return false };
    let Some(chosen) = state.get("decisionComp").and_then(Value::as_str) else { return false };
    state.get("phase").and_then(Value::as_str) == Some("comps") && same_path(&jsp::resolve(cwd, &[chosen]), &jsp::resolve(cwd, &[path]))
}

fn print_answer(io: &mut Io, raw: &str, served: &[String]) {
    io.out(&format!("ANSWER: {}\n", raw));
    let Ok(a) = serde_json::from_str::<Value>(raw) else { return };
    let truthy = |k: &str| a.get(k).map(crate::staleness::js_truthy).unwrap_or(false);
    if truthy("hero") || truthy("board") {
        io.out("CHOSEN CARD: open the chosen world's board and hero images now, before any code. When your harness only reads files, or runs sandboxed, download them INTO the workspace and open the relative path; a sandboxed viewer rejects absolute paths outside it. They set the craft bar the build must reach.\n");
    }
    let comp = a.get("comp").map(js_str).unwrap_or_default();
    let cwd = io.cwd.to_string_lossy().to_string();
    if truthy("comp") && (is_comp_round_comp(&comp) || is_comp_rounds_option_one(&cwd, &comp, served)) {
        io.out("APPROVED COMP: the user picked this composition in the comp round, so it is the approved comp. Set \"approved\": true in its prompt sidecar, the image's full file name plus .json (a.png gets a.png.json), record its path in the surface brief, then close the comps phase with build-phase advance. Build from it as it stands; never regenerate it.\n");
    } else if truthy("comp") {
        io.out("CHOSEN COMP: the decision comp at that path is compositional option one. On a comp-led build pass it to build-phase start as --decision-comp <that path>, and the comp round adds two variations beside it where it stands; on a code-led build it returns at the finish review as the critique reference. Never regenerate it from scratch.\n");
    }
    if truthy("html") {
        io.out("CHOSEN SKETCH: the HTML sketch at that path is the composition the user picked. Build the real surface to match its arrangement, palette, type and density, lifting markup where it fits; it is a fixed first-viewport thumbnail, so the build owes the responsive page, the content below the fold and every state it skipped. The finish review audits the build against it.\n");
    }
    let option_id = a.get("optionId").and_then(|v| v.as_str());
    if option_id == Some("canon") {
        io.out("CANON CHOSEN: the user picked the category standard on purpose. Ask once for two or three products this should sit alongside; their craft level becomes the quality bar. Execute the canon at full commitment, conventions embraced without irony or smuggled quirk.\n");
    }
    if option_id == Some("reroll") && truthy("register") {
        let r = a.get("register").map(js_str).unwrap_or_default();
        io.out(&format!("REGISTER: the user steered the next hand to the {} register. Re-run concept-seed with the same key, the next --reroll round, and --register {}, then follow what it prints; the register is the user's steering, never yours to pre-select.\n", r, r));
    }
    if truthy("followup") && option_id != Some("reroll") {
        io.out("FOLLOWUP OPEN: the table stays open and the page is showing a loading hand. Deliver the next round now with --update --key <key> --payload <file>, then collect it with --wait; never leave the page waiting on a round you have not sent.\n");
    }
    let bp = a.get("buildPath").and_then(|v| v.as_str());
    if bp == Some("comp") || bp == Some("code") {
        let origin = if truthy("buildPathFlipped") {
            "flipped on the page, so it binds this session only, and the page never writes it back; the sole exception is new-work’s one-time offer, on a project that had no recorded default at all, which asks after the round closes and writes the answer to .impeccable/config.json"
        } else {
            "the round’s recorded default"
        };
        io.out(&format!(
            "BUILD PATH: {} ({}). {}\n",
            bp.unwrap(),
            origin,
            if bp == Some("comp") {
                "Comp-led: the chosen card’s comp is law; generate it before building when it does not exist yet, and the finish review audits the build against it."
            } else {
                "Code-led: no comp is owed; a comp that already rendered rides at the finish review as the critique reference, and the ambition lives in the direction contract."
            }
        ));
    }
}

/// Local comp paths a round declares, in card order: every option's `comp`
/// (or the legacy `sketch`) and the canon card's, as written in the payload.
/// URLs are left out: they are rendered already, never generated here.
fn declared_comps(payload: &Value) -> Vec<String> {
    let mut cards: Vec<&Value> = payload.get("options").and_then(Value::as_array).map(|o| o.iter().collect()).unwrap_or_default();
    if let Some(c) = payload.get("canonCard").filter(|c| c.is_object()) {
        cards.push(c);
    }
    let mut out: Vec<String> = Vec::new();
    for card in cards {
        let comp = card.get("comp").filter(|v| !v.is_null()).or_else(|| card.get("sketch").filter(|v| !v.is_null()));
        let Some(s) = comp.filter(|v| crate::staleness::js_truthy(v)).map(js_str) else { continue };
        if s.starts_with("http://") || s.starts_with("https://") || out.contains(&s) {
            continue;
        }
        out.push(s);
    }
    out
}

/// Local HTML sketch paths a round declares, in card order: every option's
/// `html` and the canon card's. A sketch is one first-viewport HTML file the
/// page draws as a skeleton; URLs are left out, a sketch is always written
/// into the project.
fn declared_html(payload: &Value) -> Vec<String> {
    let mut cards: Vec<&Value> = payload.get("options").and_then(Value::as_array).map(|o| o.iter().collect()).unwrap_or_default();
    if let Some(c) = payload.get("canonCard").filter(|c| c.is_object()) {
        cards.push(c);
    }
    let mut out: Vec<String> = Vec::new();
    for card in cards {
        let Some(s) = card.get("html").filter(|v| crate::staleness::js_truthy(v)).map(js_str) else { continue };
        if s.starts_with("http://") || s.starts_with("https://") || out.contains(&s) {
            continue;
        }
        out.push(s);
    }
    out
}

/// Whether a card declares a decision comp: a truthy `comp`, or the legacy
/// `sketch` (a URL counts).
fn card_has_comp(card: &Value) -> bool {
    let comp = card.get("comp").filter(|v| !v.is_null()).or_else(|| card.get("sketch").filter(|v| !v.is_null()));
    comp.map(crate::staleness::js_truthy).unwrap_or(false)
}

/// The options that owe a comp and declare none, declined challengers
/// excepted, by id (`options[<n>]` for a card with no id), in card order.
fn options_missing_comps(payload: &Value) -> Vec<String> {
    let options = payload.get("options").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
    options
        .iter()
        .enumerate()
        .filter(|(_, o)| o.get("verdict").and_then(Value::as_str) != Some("declined") && !card_has_comp(o))
        .map(|(i, o)| o.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string).unwrap_or_else(|| format!("options[{}]", i)))
        .collect()
}

/// A full comp-led hand with image generation: `buildPath` `{"value":
/// "comp", "toggle": true}` (a code-led round's slots are a flip reserve,
/// and no toggle means no image generation) and at least two options (a
/// degraded roll's single card is text-only).
fn comp_led_full_hand(payload: &Value) -> bool {
    let comp_led = payload.pointer("/buildPath/value").and_then(Value::as_str) == Some("comp");
    let toggle = payload.pointer("/buildPath/toggle") == Some(&Value::Bool(true));
    let options = payload.get("options").and_then(Value::as_array).map(Vec::len).unwrap_or(0);
    comp_led && toggle && options >= 2
}

/// Whether a payload carries the canon exit, a truthy `canon` or an object
/// `canonCard`: direction rounds only; surface rounds and the comp round
/// never carry it.
fn has_canon_exit(payload: &Value) -> bool {
    payload.get("canonCard").is_some_and(Value::is_object) || payload.get("canon").map(crate::staleness::js_truthy).unwrap_or(false)
}

/// The cards a comp-led direction round leaves without a decision comp, by
/// id (`canonCard` for the canon card, `options[<n>]` for a card with no
/// id). The round owes a comp on every card, canon included and declined
/// challengers excepted, only when it is a direction round (it carries the
/// canon exit) and a comp-led full hand with image generation
/// (`comp_led_full_hand`). Empty when the round owes nothing or every card
/// declares one.
fn missing_direction_comps(payload: &Value) -> Vec<String> {
    if !has_canon_exit(payload) || !comp_led_full_hand(payload) {
        return Vec::new();
    }
    let mut missing = options_missing_comps(payload);
    if payload.get("canonCard").filter(|c| c.is_object()).is_some_and(|c| !card_has_comp(c)) {
        missing.push("canonCard".into());
    }
    missing
}

/// The cards a comp-led surface round leaves without a decision comp. The
/// payload alone cannot tell a surface round from the comp round, so the
/// caller decides that from concept-seed's roll record
/// (`surface_roll_pending`); given that, the round owes a comp on every
/// dealt card when it carries no canon exit and is a comp-led full hand with
/// image generation.
fn missing_surface_comps(payload: &Value) -> Vec<String> {
    if has_canon_exit(payload) || !comp_led_full_hand(payload) {
        return Vec::new();
    }
    options_missing_comps(payload)
}

/// Which round a missing-comp refusal names.
#[derive(Clone, Copy, Debug, PartialEq)]
enum CompRound {
    Direction,
    Surface,
}

/// The missing-comp gate `--start` and `--update` share: a direction round
/// (known by its canon exit), else a surface round when concept-seed's
/// latest roll in this project is a surface roll no decision page has taken
/// yet (`roll` is the record as `read_roll` returned it). `None` when the
/// payload owes nothing or declares every comp it owes.
fn missing_comps(roll: Option<&str>, payload: &Value) -> Option<(CompRound, Vec<String>)> {
    let direction = missing_direction_comps(payload);
    if !direction.is_empty() {
        return Some((CompRound::Direction, direction));
    }
    if !surface_roll_pending(roll) {
        return None;
    }
    let surface = missing_surface_comps(payload);
    (!surface.is_empty()).then_some((CompRound::Surface, surface))
}

/// The refusal `--start` and `--update` print for a comp-led direction or
/// surface round that declares no comp on some card. `rerun` names the
/// command to repeat.
fn missing_comps_message(round: CompRound, missing: &[String], rerun: &str, outcome: &str) -> String {
    let (owed, canon_note) = match round {
        CompRound::Direction => (
            "this direction round is comp-led with image generation (buildPath value \"comp\", toggle true), so every card declares a decision comp, canon included, declined challengers excepted",
            " (the canon card's goes inside canonCard)",
        ),
        CompRound::Surface => (
            "this surface round (concept-seed's latest roll here was --scope surface) is comp-led with image generation (buildPath value \"comp\", toggle true), so every dealt card declares a decision comp",
            "",
        ),
    };
    format!(
        "serve-question: {}; {}. Missing a \"comp\": {}. Give each of those cards \"comp\": \".impeccable/mocks/decision/<card id>.png\"{}, then {}; the comps are generated after the page serves, as its NEXT line says.\n",
        owed,
        outcome,
        missing.join(", "),
        canon_note,
        rerun
    )
}

/// How long a roll stays bound to the next decision page. A roll is
/// presented within minutes; an older record belongs to work long gone.
const ROLL_WINDOW_MS: f64 = 60.0 * 60.0 * 1000.0;

/// `.impeccable/questions/roll.json`: concept-seed's latest roll in this
/// project, `{"scope", "key", "reroll", "at"}` (`at` in epoch ms) plus
/// `"worlds"`, the catalog worlds it printed as challengers, when it printed
/// any. Every roll replaces it; a decision page (a payload carrying `buildPath`) that
/// `--start` serves or `--update` delivers removes it, so a roll binds to
/// the one page that presents it.
fn roll_file(qdir: &str) -> String {
    jsp::join(&[qdir, "roll.json"])
}

/// Records a concept-seed roll for the next decision page. Best effort: a
/// roll never fails because its record could not be written.
pub fn record_roll(cwd: &str, scope: &str, key: &str, reroll: usize, worlds: &[Value]) {
    let qdir = jsp::join(&[cwd, ".impeccable", "questions"]);
    let mut record = json!({ "scope": scope, "key": key, "reroll": reroll, "at": now_ms() as u64 });
    if !worlds.is_empty() {
        record["worlds"] = Value::Array(worlds.to_vec());
    }
    let _ = std::fs::create_dir_all(&qdir).and_then(|_| write_atomic(&roll_file(&qdir), &json_compact(&record)));
}

/// The roll record as `--start` / `--update` read it once, before the gate:
/// the same text decides the gate and names the record `take_roll` may
/// remove.
fn read_roll(qdir: &str) -> Option<String> {
    safe_read(&roll_file(qdir))
}

/// Whether a roll record (as `read_roll` returned it) is a surface roll made
/// within `ROLL_WINDOW_MS` that no decision page has taken yet.
fn surface_roll_pending(roll: Option<&str>) -> bool {
    let Some(record) = roll.and_then(|t| serde_json::from_str::<Value>(t).ok()) else {
        return false;
    };
    let fresh = record.get("at").and_then(Value::as_f64).is_some_and(|at| now_ms() - at < ROLL_WINDOW_MS);
    fresh && record.get("scope").and_then(Value::as_str) == Some("surface")
}

/// One dealt catalog world as the NEXT line names it. The record is a local
/// file an API response fed, and the id becomes a file name, so an entry is
/// kept only when its id is a plain slug (`[A-Za-z0-9._-]`, no leading dot)
/// and both URLs are http(s) single tokens of sane length: nothing else can
/// ride an engine-printed line or name a path.
fn world_card(w: &Value) -> Option<Value> {
    let text = |k: &str, max: usize| w.get(k).and_then(Value::as_str).filter(|s| !s.is_empty() && s.len() <= max);
    let id = text("id", 120).filter(|s| !s.starts_with('.') && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')))?;
    let url = |k: &str| text(k, 500).filter(|s| crate::generate_image::is_url(s) && !s.chars().any(|c| c.is_whitespace() || c.is_control() || c == '|' || c == '`'));
    Some(json!({ "id": id, "board": url("board")?, "hero": url("hero")? }))
}

/// Where a dealt world's card images are kept in the workspace, relative to
/// the project: reference images a harness image tool can take as files.
const WORLD_CARDS_DIR: &str = ".impeccable/mocks/worlds";

/// One card download may take this long, so a slow or blocked network never
/// holds `--start` for more than a few seconds (they run in parallel).
const WORLD_CARD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

/// The extensions a kept card image may carry, in the order they are looked for.
const WORLD_CARD_EXTS: [&str; 4] = ["webp", "png", "jpg", "jpeg"];

/// The workspace-relative path of a world's card image when one is already
/// kept: `<WORLD_CARDS_DIR>/<id>-<board|hero>.<ext>`.
fn kept_world_card(cwd: &str, id: &str, kind: &str) -> Option<String> {
    WORLD_CARD_EXTS.iter().map(|ext| format!("{}/{}-{}.{}", WORLD_CARDS_DIR, id, kind, ext)).find(|rel| exists(&jsp::resolve(cwd, &[rel.as_str()])))
}

/// Whether the engine may request a card URL on its own. The URLs come from
/// the roll record, a project file an API response fed, and `--start` fetches
/// them unasked, so a crafted record must not turn it into a probe of
/// loopback, link-local, or private services: a URL is fetched only when it
/// sits under the configured card base (`IMPECCABLE_CARD_BASE`, else
/// impeccable.style's), or is `https` to a named public-looking host (no IP
/// address in any spelling, no userinfo, no single-label, `localhost`,
/// `.local` or `.internal` name). Card fetches follow no redirect either. A URL that
/// fails this is still listed, by URL, for the agent to judge.
fn card_fetch_allowed(env: &Env, url: &str) -> bool {
    let base = crate::concept_seed::card_base(env);
    if url.starts_with(&format!("{}/", base.trim_end_matches('/'))) {
        return true;
    }
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.contains('@') || authority.starts_with('[') {
        return false;
    }
    let host = authority.rsplit_once(':').map(|(h, _)| h).unwrap_or(authority).trim_end_matches('.').to_ascii_lowercase();
    let private_name = host == "localhost" || [".localhost", ".local", ".internal", ".lan", ".home.arpa"].iter().any(|s| host.ends_with(s));
    // A numeric host is an address however it is spelled (`127.1`,
    // `0177.0.0.1`, `0x7f.1` all resolve to loopback), so the last label
    // must be a name: letters only, or punycode.
    let tld = host.rsplit('.').next().unwrap_or("");
    let named = !tld.is_empty() && (tld.bytes().all(|b| b.is_ascii_alphabetic()) || (tld.starts_with("xn--") && tld.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')));
    host.contains('.') && named && host.parse::<std::net::IpAddr>().is_err() && !private_name
}

/// Puts every dealt world's board and hero in the workspace and returns, per
/// world, `(id, board, hero)` where each image is its workspace-relative path
/// when the file is there and its URL when it could not be fetched. A file
/// already there is kept, not fetched again. Downloads run in parallel, each
/// under `WORLD_CARD_TIMEOUT`, and are best effort: a failure only leaves
/// that image named by URL. A fetched file takes its extension from the
/// image's own type, so a later `--ref` of the path sends the right one.
/// `IMPECCABLE_IMAGE_GEN_FAKE` makes no request.
fn fetch_world_cards(env: &Env, cwd: &str, worlds: &[Value]) -> Vec<(String, String, String)> {
    let s = |w: &Value, k: &str| w.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    let offline = env_set(env, "IMPECCABLE_IMAGE_GEN_FAKE");
    // (id, kind, url) per image, board then hero per world.
    let images: Vec<(String, &str, String)> = worlds.iter().flat_map(|w| ["board", "hero"].map(|kind| (s(w, "id"), kind, s(w, kind)))).collect();
    let fetch = |id: &str, kind: &str, url: &str| -> Option<String> {
        if let Some(kept) = kept_world_card(cwd, id, kind) {
            return Some(kept);
        }
        if offline || !card_fetch_allowed(env, url) {
            return None;
        }
        let (bytes, ty) = crate::generate_image::fetch_image(url, WORLD_CARD_TIMEOUT, 0).ok()?;
        let ext = match ty {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            _ => "webp",
        };
        let rel = format!("{}/{}-{}.{}", WORLD_CARDS_DIR, id, kind, ext);
        let abs = jsp::resolve(cwd, &[rel.as_str()]);
        // Temp file then rename: a parallel session never reads half an image.
        let temp = format!("{}.tmp-{}", abs, std::process::id());
        let written = std::fs::create_dir_all(jsp::resolve(cwd, &[WORLD_CARDS_DIR])).and_then(|_| std::fs::write(&temp, &bytes)).and_then(|_| std::fs::rename(&temp, &abs));
        if written.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        written.is_ok().then_some(rel)
    };
    let have: Vec<Option<String>> = std::thread::scope(|scope| {
        let handles: Vec<_> = images.iter().map(|(id, kind, url)| scope.spawn(|| fetch(id, kind, url))).collect();
        handles.into_iter().map(|h| h.join().unwrap_or(None)).collect()
    });
    let named = |i: usize| have[i].clone().unwrap_or_else(|| images[i].2.clone());
    worlds.iter().enumerate().map(|(i, w)| (s(w, "id"), named(i * 2), named(i * 2 + 1))).collect()
}

/// The catalog worlds a decision page's hand was dealt: the roll record's
/// `worlds` (as `read_roll` returned it) when the page takes that roll (a
/// payload carrying `buildPath`, as in `take_roll`), the roll is a direction
/// roll, and it is younger than `ROLL_WINDOW_MS`. A surface roll's
/// challengers change topology under an identity already committed, so their
/// cards are never style references. Empty in every other case.
fn dealt_worlds(roll: Option<&str>, payload: &Value) -> Vec<Value> {
    if !payload.get("buildPath").is_some_and(|b| !b.is_null()) {
        return vec![];
    }
    let Some(record) = roll.and_then(|t| serde_json::from_str::<Value>(t).ok()) else {
        return vec![];
    };
    let fresh = record.get("at").and_then(Value::as_f64).is_some_and(|at| now_ms() - at < ROLL_WINDOW_MS);
    if !fresh || record.get("scope").and_then(Value::as_str) != Some("direction") {
        return vec![];
    }
    record.get("worlds").and_then(Value::as_array).map(|a| a.iter().filter_map(world_card).collect()).unwrap_or_default()
}

/// The worlds recorded in a hand (`dealt_worlds` at the time it was dealt).
fn hand_worlds(hand: Option<&Map<String, Value>>) -> Vec<Value> {
    hand.and_then(|h| h.get("worlds")).and_then(Value::as_array).map(|a| a.iter().filter_map(world_card).collect()).unwrap_or_default()
}

/// A decision page took the roll it was gated against: the payload carries
/// `buildPath`, which only direction and surface rounds do. Removes the
/// record only while it still holds that roll (`read` is the text read
/// before the gate), so a newer roll another session recorded in between
/// stays bound to its own page.
fn take_roll(qdir: &str, read: Option<&str>, payload: &Value) {
    let Some(read) = read else { return };
    if payload.get("buildPath").is_some_and(|b| !b.is_null()) && read_roll(qdir).as_deref() == Some(read) {
        let _ = std::fs::remove_file(roll_file(qdir));
    }
}

/// Provenance of a hand lives in `<key>.hand.json`, written atomically by
/// `--start` and `--update` only, never by the server (whose heartbeat and
/// claim writes rewrite `<key>.state.json` and would race a shared field).
/// Shape: `{"digest": <hand_digest>, "comps": [<declared slots>], "pre":
/// {<slot>: <sha256 of the file that sat there when the hand began>}}`, plus
/// `"worlds"` (`dealt_worlds`) when the hand took a roll that dealt any.
/// `--update` always starts a new hand; `--start` keeps the recorded hand when
/// its digest matches (a restart) and starts a new one otherwise.
fn hand_file(qdir: &str, key: &str) -> String {
    jsp::join(&[qdir, &format!("{}.hand.json", key)])
}

/// The whole payload, not only its slot paths: a re-roll often reuses the
/// previous hand's paths and must still read as a new hand.
fn hand_digest(payload: &Value) -> String {
    use sha2::{Digest, Sha256};
    let d = Sha256::digest(json_compact(payload).as_bytes());
    d.iter().take(8).map(|b| format!("{:02x}", b)).collect()
}

fn file_fingerprint(abs: &str) -> Option<String> {
    use sha2::{Digest, Sha256};
    let bytes = std::fs::read(abs).ok()?;
    Some(Sha256::digest(&bytes).iter().map(|b| format!("{:02x}", b)).collect())
}

/// `<key>.generated/`: one marker per slot `impeccable generate-image` wrote
/// during the hand, `<sha16 of slot>-<hand tag>.json` = `{"slot", "hand"}`.
/// A marker file per slot rather than a list inside the hand file, because
/// parallel generators (one subagent per card) would race a shared
/// read-modify-write. The hand tag in the name keeps one hand's markers off
/// every path another hand writes, so pruning decides from the name alone.
fn generated_dir(qdir: &str, key: &str) -> String {
    jsp::join(&[qdir, &format!("{}.generated", key)])
}

/// The hand id as it appears in a marker file name: the id itself when it is
/// a short run of `[a-z0-9_]` (every id and digest this engine writes), else
/// its hash, so a hand-edited id can never smuggle a separator or a dot, and
/// two ids that differ only in case never share a path on a case-insensitive
/// file system (Windows, default macOS).
fn marker_tag(id: &str) -> String {
    if !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') {
        id.to_string()
    } else {
        hand_digest(&Value::String(id.to_string()))
    }
}

/// The marker file name for `slot` in the hand tagged `tag`.
fn marker_name(slot: &str, tag: &str) -> String {
    format!("{}-{}.json", hand_digest(&Value::String(slot.to_string())), tag)
}

/// The hand tag a marker file name carries: `Some(tag)` for
/// `<16 hex>-<tag>.json` (or its `.json.tmp-<pid>` temp file), `None` for a
/// legacy `<16 hex>.json` name, whose owner lives only in its content.
fn marker_name_tag(name: &str) -> Option<&str> {
    let stem = &name[..name.find(".json")?];
    let (slot, tag) = (stem.get(..16)?, stem.get(16..)?);
    let tag = tag.strip_prefix('-')?;
    (slot.bytes().all(|b| b.is_ascii_hexdigit()) && !tag.is_empty()).then_some(tag)
}

/// The owner a legacy marker's content names (`hand`, else `digest`).
fn legacy_marker_owner(path: &std::path::Path) -> Option<String> {
    safe_read(&path.to_string_lossy())
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|m| m.get("hand").or_else(|| m.get("digest")).and_then(Value::as_str).map(str::to_string))
}

/// The recorded hand, with the slots generated during it merged in as
/// `generated` (markers from another digest are ignored).
fn read_hand(qdir: &str, key: &str) -> Option<Map<String, Value>> {
    let mut hand = safe_read(&hand_file(qdir, key)).and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v.as_object().cloned())?;
    let id = hand_marker_id(&hand);
    let tag = marker_tag(&id);
    let mut generated: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(generated_dir(qdir, key)) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".json") {
                continue;
            }
            let Some(m) = safe_read(&e.path().to_string_lossy()).and_then(|t| serde_json::from_str::<Value>(&t).ok()) else { continue };
            let ours = match marker_name_tag(&name) {
                Some(t) => t == tag,
                None => m.get("hand").or_else(|| m.get("digest")).and_then(Value::as_str) == Some(id.as_str()),
            };
            if ours {
                if let Some(slot) = m.get("slot").and_then(Value::as_str) {
                    generated.push(slot.to_string());
                }
            }
        }
    }
    generated.sort();
    generated.dedup();
    if !generated.is_empty() {
        hand.insert("generated".into(), json!(generated));
    }
    Some(hand)
}

/// Temp file beside the target, then rename: a reader never sees half a file.
fn write_atomic(target: &str, text: &str) -> std::io::Result<()> {
    let temp = format!("{}.tmp-{}", target, std::process::id());
    std::fs::write(&temp, text)?;
    std::fs::rename(&temp, target).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        e
    })
}

fn same_path(a: &str, b: &str) -> bool {
    let norm = |p: &str| {
        let p = p.replace('\\', "/");
        if cfg!(windows) { p.to_lowercase() } else { p }
    };
    norm(a) == norm(b)
}

/// Called by `impeccable generate-image` after it writes `out`: when `out` is
/// a declared slot of a recorded hand in this project, mark it generated
/// during that hand. A deterministic generator returns the same bytes for
/// the same prompt, which the fingerprint rule alone would read as stale.
/// Returns the keys whose hand was marked, or the first write error.
pub fn record_generated(cwd: &str, out: &str) -> Result<Vec<String>, String> {
    let qdir = jsp::join(&[cwd, ".impeccable", "questions"]);
    let out_abs = jsp::resolve(cwd, &[out]);
    let Ok(entries) = std::fs::read_dir(&qdir) else { return Ok(vec![]) };
    let mut keys: Vec<String> = entries
        .flatten()
        .filter_map(|e| e.file_name().to_string_lossy().strip_suffix(".hand.json").map(str::to_string))
        .collect();
    keys.sort();
    let mut marked = Vec::new();
    for key in keys {
        let Some(hand) = read_hand(&qdir, &key) else { continue };
        let id = hand_marker_id(&hand);
        for slot in round_comps(Some(&hand), None) {
            if !same_path(&jsp::resolve(cwd, &[slot.as_str()]), &out_abs) {
                continue;
            }
            let dir = generated_dir(&qdir, &key);
            let marker = jsp::join(&[&dir, &marker_name(&slot, &marker_tag(&id))]);
            std::fs::create_dir_all(&dir)
                .and_then(|_| write_atomic(&marker, &json_compact(&json!({ "slot": slot, "hand": id }))))
                .map_err(|e| format!("{}: {}", marker, e))?;
            marked.push(key.clone());
        }
    }
    Ok(marked)
}

/// A new hand: its digest, its slots, and the fingerprint of every slot that
/// already holds a file, so that file never passes for this hand's comp.
#[cfg(test)]
fn new_hand(cwd: &str, payload: &Value) -> Map<String, Value> {
    new_hand_dealt(cwd, payload, &[])
}

/// `new_hand` for a page that takes a roll: `worlds` (`dealt_worlds`) ride in
/// the hand, because the roll record is gone once the page has taken it and
/// the NEXT line is printed after that, and again by a later `--wait` flip.
fn new_hand_dealt(cwd: &str, payload: &Value, worlds: &[Value]) -> Map<String, Value> {
    let comps = declared_comps(payload);
    let mut pre = Map::new();
    // Sketches share the comps' staleness rule: a re-roll that reuses a card
    // id must not show the sketch the last hand left at that path.
    for c in comps.iter().chain(declared_html(payload).iter()) {
        if let Some(fp) = file_fingerprint(&jsp::resolve(cwd, &[c.as_str()])) {
            pre.insert(c.clone(), Value::String(fp));
        }
    }
    let mut m = Map::new();
    // A per-hand id: an --update re-roll can repeat a payload, so the digest
    // alone cannot tell one hand's generated markers from the next one's.
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    m.insert("id".into(), Value::String(hand_digest(&json!([hand_digest(payload), nonce.to_string(), std::process::id()]))));
    m.insert("digest".into(), Value::String(hand_digest(payload)));
    m.insert("comps".into(), json!(comps));
    let sketches = declared_html(payload);
    if !sketches.is_empty() {
        m.insert("sketches".into(), json!(sketches));
    }
    m.insert("pre".into(), Value::Object(pre));
    m.insert("startedAt".into(), Value::from(now_ms() as i64));
    if !worlds.is_empty() {
        m.insert("worlds".into(), Value::Array(worlds.to_vec()));
    }
    m
}

/// Records a new hand atomically (temp file then rename, so a reader never
/// sees half a hand), then prunes generated markers that belong to another
/// hand. Pruning waits for a successful write, so a failed write leaves the
/// live hand and its markers intact. It decides from the file name alone and
/// deletes only names tagged with another hand, so it never touches a path a
/// parallel generate-image for this hand may be writing. A legacy untagged
/// marker (written before names carried the hand) is judged by its content;
/// this engine never writes that name again, so no new marker can land there.
/// The error names the file.
fn write_hand(qdir: &str, key: &str, hand: &Map<String, Value>) -> Result<(), String> {
    let target = hand_file(qdir, key);
    write_atomic(&target, &json_compact(&Value::Object(hand.clone()))).map_err(|e| format!("{}: {}", target, e))?;
    let id = hand_marker_id(hand);
    let tag = marker_tag(&id);
    if let Ok(entries) = std::fs::read_dir(generated_dir(qdir, key)) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let prune = match marker_name_tag(&name) {
                Some(t) => t != tag,
                None => legacy_marker_owner(&e.path()).as_deref() != Some(id.as_str()),
            };
            if prune {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    Ok(())
}

/// What a generated marker records as its hand: the hand's id, or its digest
/// for a hand file written before ids existed.
fn hand_marker_id(hand: &Map<String, Value>) -> String {
    hand.get("id").or_else(|| hand.get("digest")).and_then(Value::as_str).unwrap_or("").to_string()
}

/// The hand a `--start` serves: the recorded one when the key's hand file
/// carries this payload's digest (a restart keeps its fingerprints), else a
/// new one, written before the server spawns. `worlds` (`dealt_worlds`) go
/// into a new hand only: a restart keeps the worlds its hand was dealt.
fn start_hand(qdir: &str, key: &str, cwd: &str, payload: &Value, worlds: &[Value]) -> Result<Map<String, Value>, String> {
    let digest = hand_digest(payload);
    if let Some(h) = read_hand(qdir, key).filter(|h| h.get("digest").and_then(Value::as_str) == Some(digest.as_str())) {
        return Ok(h);
    }
    let h = new_hand_dealt(cwd, payload, worlds);
    write_hand(qdir, key, &h)?;
    Ok(h)
}

/// The comps a `--wait` judges: the hand's, else the state's (a round served
/// before hands were recorded).
fn round_comps(hand: Option<&Map<String, Value>>, state: Option<&Map<String, Value>>) -> Vec<String> {
    match hand {
        Some(h) => h.get("comps").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default(),
        None => state.map(state_comps).unwrap_or_default(),
    }
}

/// A declared comp is this hand's when its file exists and differs from the
/// file that sat at the slot when the hand began (or none sat there). The comp
/// round generates its comps directly in `.impeccable/mocks/` before it serves
/// them, so those always count, as does its option one, the decision comp an
/// open build recorded; with no hand recorded, existence decides.
fn comp_is_this_hands(cwd: &str, comp: &str, hand: Option<&Map<String, Value>>) -> bool {
    let abs = jsp::resolve(cwd, &[comp]);
    if !exists(&abs) {
        return false;
    }
    let Some(hand) = hand else { return true };
    let served = hand.get("comps").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect::<Vec<_>>()).unwrap_or_default();
    if is_comp_round_comp(comp) || is_comp_rounds_option_one(cwd, comp, &served) {
        return true;
    }
    let generated = hand.get("generated").and_then(Value::as_array).map(|g| g.iter().any(|v| v.as_str() == Some(comp))).unwrap_or(false);
    if generated {
        return true;
    }
    match hand.get("pre").and_then(|p| p.get(comp)).and_then(Value::as_str) {
        None => true,
        Some(before) => file_fingerprint(&abs).map(|now| now != before).unwrap_or(false),
    }
}

/// A declared sketch is this hand's when its file exists and was written after
/// the hand began, or differs from the file that sat there then. The write
/// time is what lets an identical rewrite count: a sketch has no generated
/// marker the way a comp from generate-image does.
fn sketch_is_this_hands(cwd: &str, path: &str, hand: Option<&Map<String, Value>>) -> bool {
    let abs = jsp::resolve(cwd, &[path]);
    if !exists(&abs) {
        return false;
    }
    let Some(h) = hand else { return true };
    let written = std::fs::metadata(&abs).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64);
    let began = h.get("startedAt").and_then(Value::as_f64);
    if let (Some(w), Some(b)) = (written, began) {
        if w > b {
            return true;
        }
    }
    comp_is_this_hands(cwd, path, hand)
}

/// Declared sketches whose file is still the one an earlier round left; the
/// page keeps waiting on them.
fn stale_sketches(cwd: &str, hand: Option<&Map<String, Value>>) -> Vec<String> {
    let Some(h) = hand else { return vec![] };
    let declared: Vec<String> = h.get("sketches").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default();
    declared.into_iter().filter(|p| exists(&jsp::resolve(cwd, &[p.as_str()])) && !sketch_is_this_hands(cwd, p, hand)).collect()
}

/// Declared comps whose file is still the one an earlier round left.
fn stale_comps(cwd: &str, comps: &[String], hand: Option<&Map<String, Value>>) -> Vec<String> {
    comps.iter().filter(|c| exists(&jsp::resolve(cwd, &[c.as_str()])) && !comp_is_this_hands(cwd, c, hand)).cloned().collect()
}

fn any_comp_pending(cwd: &str, comps: &[String], hand: Option<&Map<String, Value>>) -> bool {
    comps.iter().any(|c| !comp_is_this_hands(cwd, c, hand))
}

/// A round whose comps get generated now: it is not code-led (a code-led
/// round's slots are a flip reserve) and a declared local comp slot still has
/// no comp of this hand. A fresh decision round serves first and generates
/// after; a restart of the same hand finds the comps that already landed; the
/// comp round's comps are its own.
fn comps_expected(payload: &Value, cwd: &str, hand: Option<&Map<String, Value>>) -> bool {
    let code_led = payload.pointer("/buildPath/value").and_then(Value::as_str) == Some("code");
    !code_led && any_comp_pending(cwd, &declared_comps(payload), hand)
}

fn visualize_ref(env: &Env, cwd: &str) -> String {
    crate::provider::detect(env, cwd).reference_path("visualize").unwrap_or_else(|| "reference/visualize.md".to_string())
}

/// The directive that puts visualize.md in front of the agent at the moment
/// the decision round's comps are about to be written. When the hand was
/// dealt catalog worlds (`hand_worlds`), the same line hands over their card
/// images, fetched into the workspace first (`fetch_world_cards`): a model
/// follows an engine line where it skips the prose rule that says to open
/// them, and a harness image tool takes reference images only as files.
fn visualize_next_line(env: &Env, cwd: &str, hand: Option<&Map<String, Value>>) -> String {
    let cards = fetch_world_cards(env, cwd, &hand_worlds(hand));
    format!(
        "NEXT read {} now, before writing any decision comp prompt; it and the MODE RULES block concept-seed printed for this surface govern every card's image. Then generate each declared comp into its slot, lead first, and record the exact prompt in its sidecar, the image's full file name plus .json (a.png gets a.png.json).{}\n",
        visualize_ref(env, cwd),
        world_cards_clause(env, cwd, &cards)
    )
}

/// The NEXT line's tail naming each dealt world's card images (`cards` as
/// `fetch_world_cards` returned them); empty when none was dealt. The list
/// closes the line, `|` between worlds, so no path or URL ever touches
/// sentence punctuation.
fn world_cards_clause(env: &Env, cwd: &str, cards: &[(String, String, String)]) -> String {
    if cards.is_empty() {
        return String::new();
    }
    let list: Vec<String> = cards.iter().map(|(id, board, hero)| format!("{} board {} hero {}", id, board, hero)).collect();
    let unfetched = cards.iter().any(|(_, board, hero)| crate::generate_image::is_url(board) || crate::generate_image::is_url(hero));
    format!(
        " The catalog worlds dealt in this roll have card images, listed at the end of this line: when a card's direction builds on one of these worlds, attach that world's board and hero as reference images to that card's comp (the harness image tool's input images, or `{} --ref <board> --ref <hero>`{}), as style inspiration only, never to copy layout or content; a card for a direction you invented yourself has no card images and gets none. WORLD CARDS: {}",
        crate::provider::detect(env, cwd).verb_cmd("generate-image"),
        if unfetched { "; any image listed as a URL could not be fetched, so download it into the workspace first when the tool takes files" } else { "" },
        list.join(" | ")
    )
}

/// This hand's landed comps without a prompt sidecar (`a.png` -> `a.png.json`).
fn comps_missing_sidecar(cwd: &str, comps: &[String], hand: Option<&Map<String, Value>>) -> Vec<String> {
    comps
        .iter()
        .filter(|c| comp_is_this_hands(cwd, c, hand) && !exists(&format!("{}.json", jsp::resolve(cwd, &[c.as_str()]))))
        .cloned()
        .collect()
}

/// The `--wait` note for files an earlier round left at this hand's slots.
fn stale_comps_line(env: &Env, cwd: &str, stale: &[String]) -> String {
    format!(
        "COMP STALE: files left from an earlier round sit at this hand's slots, and the page is showing them: {}. Regenerate each into its slot now under the comp rules in {}, with its prompt sidecar, before the user decides.\n",
        stale.join(", "),
        visualize_ref(env, cwd)
    )
}

/// The `--wait` backstop: names every landed decision comp with no sidecar.
fn sidecar_missing_line(env: &Env, cwd: &str, missing: &[String]) -> String {
    format!(
        "COMP SIDECAR MISSING: {} landed with no prompt sidecar. Every decision comp records the exact prompt that produced it in its sidecar, the image's full file name plus .json (a.png gets a.png.json), as {{\"prompt\": \"...\"}} (generate-image writes it itself, a harness image tool does not), and that prompt is written under the comp rules in {}. Write each missing sidecar now, and read that file before the next comp prompt if you have not.\n",
        missing.join(", "),
        visualize_ref(env, cwd)
    )
}

/// This hand's landed decision comps that carry their prompt sidecar: the
/// renders the agent owes visualize.md's post-render checks. Comp-round comps
/// sit outside this: the decision round is where the checks go unrun.
fn landed_decision_comps(cwd: &str, comps: &[String], hand: Option<&Map<String, Value>>) -> bool {
    comps.iter().any(|c| !is_comp_round_comp(c) && !is_comp_rounds_option_one(cwd, c, comps) && comp_is_this_hands(cwd, c, hand) && exists(&format!("{}.json", jsp::resolve(cwd, &[c.as_str()]))))
}

/// The `--wait` render-check directive: once per hand, the first poll that
/// finds a landed decision comp with its sidecar while the user is deciding.
fn render_check_line(env: &Env, cwd: &str) -> String {
    format!(
        "NEXT open each decision comp once and run {}'s render checks (shipped screen, one dominant move); regenerate any that fail before the user answers.\n",
        visualize_ref(env, cwd)
    )
}

/// Whether this poll owes the render-check line, recording that it was owed
/// so the next poll of the same hand stays quiet.
fn render_check_due(qdir: &str, key: &str, hand: Option<&Map<String, Value>>) -> bool {
    let id = hand.map(hand_marker_id).unwrap_or_default();
    let marker = render_check_file(qdir, key);
    if safe_read(&marker).as_deref() == Some(id.as_str()) {
        return false;
    }
    let _ = std::fs::write(&marker, &id);
    true
}

/// The comps recorded for the live round in `<key>.state.json`.
fn state_comps(state: &Map<String, Value>) -> Vec<String> {
    state.get("comps").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default()
}

fn js_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".to_string(),
        other => crate::critique_storage::js_string_value(other),
    }
}

fn schema_json() -> Value {
    json!({
      "title": "Choose the visual world",
      "question": "The roll assigned Fillmore Handbill. Keep it, take an alternate, or re-roll.",
      "options": [
        { "id": "assigned", "label": "Fillmore Handbill", "kicker": "THE ROLL", "lineage": "1966-71 Fillmore psychedelic handbills", "thesis": "The gig poster that treats every release like a one-night stand.", "palette": ["#e8452c", "#f5d64c", "#1b2a52", "#f3ead8"], "materials": ["letterpress", "split-fountain ink"], "viewport": "A full-bleed dated bill with the product name in warped display type.", "risk": "Reads nostalgic when the type is set timidly.", "raised": [{ "from": "challenger-microfiche", "raise": "The bill now owns its whole viewport as one continuous printed sheet." }], "comp": ".impeccable/mocks/decision/assigned.webp", "hero": "https://impeccable.style/worlds/cards/posters-covers-sleeves-fillmore-handbill-hero.webp", "board": "https://impeccable.style/worlds/cards/posters-covers-sleeves-fillmore-handbill.webp" },
        { "id": "model-pick", "label": "The Broadside Ballad", "kicker": "IMPECCABLE’S PICK", "lineage": "street-sold ballad sheets", "thesis": "Every release printed as the day’s ballad sheet.", "palette": ["#1f1c18", "#efe5d0", "#a33327"], "materials": ["woodcut", "rag paper"], "viewport": "One tall sheet, the newest release as today’s ballad.", "risk": "Also the direction most runs in this category land on.", "comp": ".impeccable/mocks/decision/model-pick.webp" },
        { "id": "challenger-teletext", "label": "Teletext Service", "verdict": "competitive", "lineage": "broadcast teletext magazines", "thesis": "The catalog as a broadcast index: pages, not sections.", "palette": ["#0000c0", "#ffff00", "#00c000", "#ffffff"], "materials": ["block mosaic", "phosphor glow"], "viewport": "P100 index page, releases as numbered rows.", "case": "Fuses cleanly: releases map to numbered pages; loses narrowly on clarity.", "risk": "Reads retro-novelty when the grid is not strict.", "comp": ".impeccable/mocks/decision/challenger-teletext.webp", "hero": "https://impeccable.style/worlds/cards/broadcast-programming-teletext-service-hero.webp" },
        { "id": "challenger-microfiche", "label": "Microfiche Reader", "verdict": "declined", "lineage": "library microfiche stations", "palette": ["#101418", "#9fb4c0"], "materials": ["film grain", "backlit glass"], "case": "Fuses poorly: listeners do not identify with archival retrieval.", "kept": "Total environmental commitment.", "hero": "https://impeccable.style/worlds/cards/archives-microfiche-reader-hero.webp" }
      ],
      "reroll": { "registers": ["safer", "bolder"] },
      "buildPath": { "value": "comp", "toggle": true },
      "canon": true,
      "canonCard": { "label": "The category standard", "thesis": "What this category ships, executed impeccably.", "palette": ["#ffffff", "#111827", "#2563eb"], "materials": ["clean grid", "product photography"], "viewport": "The arrangement a visitor expects, at full craft.", "risk": "Indistinguishable from the competition by design.", "comp": ".impeccable/mocks/decision/canon.webp" },
      "steer": true
    })
}

const SCHEMA_NOTE: &str = "\nOption ids return verbatim in ANSWER; \"reroll\" and \"canon\" are reserved. hero/board/comp accept URLs or local paths; comp slots may point at files that do not exist yet (serve first, generate after; the page polls until they land, so never block serving on generation). hero on a challenger is the inspiration it draws from and renders picture-in-picture beside the comp, never as the promise of the build. verdict routes rendering: \"wins\" and \"competitive\" challengers keep full cards, \"declined\" ones render demoted after them (narrow, quiet, art as a labeled thumb, \"Adopt anyway\"), with their kept line on the front; the page reorders declined cards to the end on its own. raised on the assigned card renders each donation as a named raise line. Salience parity: when the assigned card declares no comp (no image generation this round), catalog art on every card demotes to a labeled thumb, so what looks important is the verdict’s call, never rendering luck. canonCard renders the standing exit as a subordinate card with the same anatomy; without it, canon stays a quiet footer action. Include canon only for visual-direction rounds; never present it as your own recommendation. The pick card is a kicker convention, not a field: kicker \"IMPECCABLE’S PICK\" on your top-ranked grounded candidate, one at most, never in the lead slot. Every card gets the full anatomy, challengers, canon, and declined included: thesis, palette, materials, viewport, risk; the seed already hands you each challenger’s system rules, so a card with no palette chips is an authoring gap, not a data gap. Keep thesis and each fact to one short sentence: the card front shows thesis, identity, and a two-line risk, while first viewport and the case read on the card back behind the Details chip, so long facts cost the reader a flip, not the page its scanability. A card with no imagery at all has no back; its full read renders on the front, so a text-only round loses nothing. A card may declare \"html\", a local path to one self-contained HTML file of the first viewport (1440 x 900 by default; \"htmlFrame\": \"390x844\" names a phone or native surface's first screen): the page draws it in the media slot as a skeleton (text under 22px becomes bars, so composition, palette and display type read and the copy does not) once the file lands, polling until it does, counts only a file written after the round was served, and opens the file as written from the expand chip; code-led and image-less rounds use it, a comp face wins over it, and ANSWER carries the picked card's html. A card with neither may declare \"wireframe\" ({\"cols\":12,\"rows\":10,\"regions\":[{\"label\":\"nav rail\",\"x\":0,\"y\":0,\"w\":3,\"h\":10,\"accent\":true}]}): the page draws it as a layout schematic in the media slot; surface-scope rounds use it on code-led builds, it never counts toward salience, and the card keeps its full read on the front. The comp slot carries the card’s full-fidelity direction comp (the legacy key \"sketch\" is accepted as an alias). Comp aspect follows the surface: portrait at device viewport for native or mobile-first surfaces, landscape otherwise; the page adapts its cards to either. reroll accepts true or { \"registers\": [\"safer\", \"bolder\"] }: the register buttons steer the next hand along the familiar-to-bold axis, the answer carries \"register\", and you re-run concept-seed with --register <value> for the next round; offer the registers on direction rounds, and never pre-select one. buildPath rides the payload as { \"value\": \"comp\"|\"code\", \"toggle\": true }: the value is the recorded default (.impeccable/config.json buildPath, or .impeccable/config.local.json where one machine differs) and the toggle renders a footer switch whose flip binds that session only; the ANSWER then carries buildPath plus buildPathFlipped. On a code-led round each card still declares its comp path as a flip reserve: wireframes render, and a flip to comp makes --wait return once with BUILD PATH FLIPPED so you generate the comps into the declared slots while the round stays open; a flip back to code is free, and a comp that already landed stays as the critique reference. The toggle may only be offered when image generation exists: a harness with no image tool and no API key never sets toggle: true, so the choice never renders where comps cannot be made, and code-led simply rides as the untoggleable value. followup: true keeps the table open after a pick for a second round via --update; send the next payload immediately, the page is waiting on it.";

/// JS: Number(arg('timeout','900')) etc.
fn js_number_arg(a: &Args, name: &str, fallback: &str) -> f64 {
    crate::critique_storage::js_number(&a.arg_or(name, fallback))
}

fn sleep_ms(ms: u64) {
    std::thread::sleep(std::time::Duration::from_millis(ms));
}

fn read_json_file(p: &str) -> Result<Value, String> {
    let text = std::fs::read(p).map_err(|e| crate::util::node_read_error(p, &e))?;
    let text = String::from_utf8_lossy(&text).into_owned();
    serde_json::from_str::<Value>(&text).map_err(|e| format!("SyntaxError: {}", js_json_error(&text, &e)))
}

fn js_json_error(text: &str, e: &serde_json::Error) -> String {
    // Approximation of V8's message shape.
    let _ = text;
    format!("Unexpected token in JSON ({})", e)
}

pub fn run(argv: &[String], io: &mut Io) -> i32 {
    let a = Args { argv };
    let env = io.env.clone();
    let cwd = io.cwd.to_string_lossy().into_owned();
    if env_set(&env, "IMPECCABLE_QUESTION_DISABLED") {
        io.out("serve-question: disabled in this session (no browser); use the structured question tool instead.\n");
        return 2;
    }
    let wants_browser = !a.has("no-open") && !a.has("wait") && !a.has("stop") && !a.has("schema") && !a.has("update");
    if wants_browser && !env_set(&env, "IMPECCABLE_QUESTION_FORCE") {
        let headless = env_set(&env, "CI")
            || (env_set(&env, "SSH_CONNECTION") && !env_set(&env, "DISPLAY"))
            || (cfg!(target_os = "linux") && !env_set(&env, "DISPLAY") && !env_set(&env, "WAYLAND_DISPLAY"));
        if headless {
            io.out("serve-question: no browser detected in this environment (CI/headless/remote); use the structured question tool instead. Set IMPECCABLE_QUESTION_FORCE=1 to serve anyway.\n");
            return 2;
        }
    }
    let payload_path = a.arg("payload");
    let timeout_arg = js_number_arg(&a, "timeout", "900");
    let timeout_sec = if timeout_arg.is_finite() && timeout_arg >= 0.0 { timeout_arg } else { 900.0 };
    let idle_arg = js_number_arg(&a, "idle-grace", "600");
    let idle_grace_ms = (if idle_arg.is_finite() && idle_arg > 0.0 { idle_arg } else { 600.0 }) * 1000.0;
    let port_arg = js_number_arg(&a, "port", "0");
    let qdir = jsp::join(&[&cwd, ".impeccable", "questions"]);

    if a.has("schema") {
        io.out(&format!("{}\n", json_pretty(&schema_json())));
        io.out(&format!("{}\n", SCHEMA_NOTE));
        return 0;
    }

    if a.has("wait") {
        let Some(key) = a.arg("key") else {
            io.err("serve-question: --wait needs --key\n");
            return 1;
        };
        let poll_sec = js_number_arg(&a, "poll", "60");
        let deadline = now_ms() + poll_sec * 1000.0;
        let answered = || exists(&answer_file(&qdir, &key));
        let mut saw_close = false;
        while now_ms() < deadline {
            if answered() {
                break;
            }
            if exists(&flip_file(&qdir, &key)) {
                let _ = std::fs::remove_file(flip_file(&qdir, &key));
                io.out("BUILD PATH FLIPPED: comp (for this session only; never write it to settings). The table is still open and the page shows shimmer where the images will land: generate each open card’s comp into its declared path now, lead first, then collect the answer with --wait again. A card whose comp already exists needs nothing.\n");
                // State without comps (a round from before comps were recorded)
                // still gets the line; a round whose comps all landed does not.
                let hand = read_hand(&qdir, &key);
                let comps = round_comps(hand.as_ref(), read_state(&qdir, &key).as_ref());
                if comps.is_empty() || any_comp_pending(&cwd, &comps, hand.as_ref()) {
                    io.out(&visualize_next_line(&env, &cwd, hand.as_ref()));
                }
                return 0;
            }
            if !is_alive(&qdir, &key) {
                io.out(&format!("serve-question: the question server is gone with no answer. This is a server failure, not a user decision: restart it with --start --key {} and the same payload, reopen the URL for the user, and wait again. Never proceed without their choice while their browser session is open.\n", key));
                return 2;
            }
            if let Some(state) = read_state(&qdir, &key) {
                let mid_delivery = {
                    let by_file = mtime_ms(&next_file(&qdir, &key)).map(|m| now_ms() - m < NEXT_CLAIM_GRACE_MS).unwrap_or(false);
                    by_file || num_field(&state, "claimedAt").map(|c| c != 0.0 && now_ms() - c < NEXT_CLAIM_GRACE_MS).unwrap_or(false)
                };
                if let Some(lb) = num_field(&state, "lastBeat") {
                    if !mid_delivery && lb != 0.0 && now_ms() - lb > 15000.0 {
                        saw_close = true;
                        break;
                    }
                }
            }
            sleep_ms(1000);
        }
        if saw_close && !answered() {
            io.out("PAGE CLOSED: the question page went away without an answer; re-present, reopen the URL, or fall back to the structured question tool\n");
            return 4;
        }
        // Read before the answer path may delete the state file.
        let hand = read_hand(&qdir, &key);
        let stale_sketch = stale_sketches(&cwd, hand.as_ref());
        let (missing, stale, landed, served) = {
            let comps = round_comps(hand.as_ref(), read_state(&qdir, &key).as_ref());
            (comps_missing_sidecar(&cwd, &comps, hand.as_ref()), stale_comps(&cwd, &comps, hand.as_ref()), landed_decision_comps(&cwd, &comps, hand.as_ref()), comps)
        };
        if !answered() {
            io.out(&format!("WAITING: no answer yet after {}s; run --wait --key {} again\n", crate::util::js_number_to_string(poll_sec), key));
            if !missing.is_empty() {
                io.out(&sidecar_missing_line(&env, &cwd, &missing));
            }
            // Only while the user is still deciding: once they pick, the image
            // they saw is the one they chose.
            if !stale.is_empty() {
                io.out(&stale_comps_line(&env, &cwd, &stale));
            }
            if !stale_sketch.is_empty() {
                io.out(&format!("SKETCH STALE: these sketch files predate this round, so the page is still waiting on them: {}. Rewrite each now; the page shows a sketch only once it is written after the round was served.\n", stale_sketch.join(", ")));
            }
            if landed && render_check_due(&qdir, &key, hand.as_ref()) {
                io.out(&render_check_line(&env, &cwd));
            }
            return 3;
        }
        let collected = safe_read(&answer_file(&qdir, &key)).unwrap_or_default();
        let collected = crate::util::js_trim(&collected).to_string();
        print_answer(io, &collected, &served);
        if !missing.is_empty() {
            io.out(&sidecar_missing_line(&env, &cwd, &missing));
        }
        let mut keeps_open = false;
        if let Ok(p) = serde_json::from_str::<Value>(&collected) {
            keeps_open = p.get("optionId").and_then(|v| v.as_str()) == Some("reroll") || p.get("followup") == Some(&Value::Bool(true));
        }
        let _ = std::fs::remove_file(answer_file(&qdir, &key));
        if !keeps_open {
            let _ = std::fs::remove_file(state_file(&qdir, &key));
            let _ = std::fs::remove_file(hand_file(&qdir, &key));
            let _ = std::fs::remove_file(render_check_file(&qdir, &key));
            let _ = std::fs::remove_dir_all(generated_dir(&qdir, &key));
        }
        return 0;
    }

    if a.has("stop") {
        let Some(key) = a.arg("key") else {
            io.err("serve-question: --stop needs --key\n");
            return 1;
        };
        if let Some(state) = read_state(&qdir, &key) {
            if let Some(pid) = state.get("pid").and_then(|p| p.as_f64()) {
                kill_pid(pid as i64);
            }
        }
        let _ = std::fs::remove_file(answer_file(&qdir, &key));
        let _ = std::fs::remove_file(state_file(&qdir, &key));
        let _ = std::fs::remove_file(hand_file(&qdir, &key));
        let _ = std::fs::remove_file(render_check_file(&qdir, &key));
        let _ = std::fs::remove_dir_all(generated_dir(&qdir, &key));
        io.out("stopped\n");
        return 0;
    }

    if a.has("update") {
        let key = a.arg("key");
        let (Some(key), Some(pp)) = (key, payload_path.clone()) else {
            io.err("serve-question: --update needs --key and --payload\n");
            return 1;
        };
        let next_round = match read_json_file(&jsp::resolve(&cwd, &[&pp])) {
            Ok(v) => v,
            Err(msg) => {
                io.err(&format!("{}\n", msg));
                return 1;
            }
        };
        let ok = next_round.get("options").and_then(|o| o.as_array()).map(|o| !o.is_empty()).unwrap_or(false);
        if !ok {
            io.err("serve-question: --update payload needs an options array; nothing was delivered. Fix the payload and rerun --update on the same key.\n");
            return 1;
        }
        let roll = read_roll(&qdir);
        if let Some((round, missing)) = missing_comps(roll.as_deref(), &next_round) {
            io.err(&missing_comps_message(round, &missing, "rerun --update on the same key", "nothing was delivered"));
            return 1;
        }
        if !is_alive(&qdir, &key) {
            io.err("serve-question: no live question server for that key; the page it served is gone too. Re-present the round with --start and a fresh key, or fall back to the structured question tool.\n");
            return 2;
        }
        // A delivered round is always a new hand. Recorded before delivery:
        // on failure the page keeps the previous round, whose hand file is
        // untouched, so nothing is served without its provenance.
        let hand = new_hand_dealt(&cwd, &next_round, &dealt_worlds(roll.as_deref(), &next_round));
        if let Err(e) = write_hand(&qdir, &key, &hand) {
            io.err(&format!("serve-question: could not record the hand ({}); nothing was delivered. Make .impeccable/questions/ writable and rerun --update on the same key.\n", e));
            return 1;
        }
        take_roll(&qdir, roll.as_deref(), &next_round);
        let delivered = next_file(&qdir, &key);
        let _ = std::fs::copy(jsp::resolve(&cwd, &[&pp]), &delivered);
        touch_now(&delivered);
        io.out("next round delivered; the page reloads itself\n");
        if comps_expected(&next_round, &cwd, Some(&hand)) {
            io.out(&visualize_next_line(&env, &cwd, Some(&hand)));
        }
        return 0;
    }

    if a.has("start") {
        let Some(pp) = payload_path.clone() else {
            io.err("serve-question: --start needs --payload <file>\n");
            return 1;
        };
        let start_payload = match read_json_file(&jsp::resolve(&cwd, &[&pp])) {
            Ok(v) => v,
            Err(msg) => {
                io.err(&format!("{}\n", msg));
                return 1;
            }
        };
        let roll = read_roll(&qdir);
        if let Some((round, missing)) = missing_comps(roll.as_deref(), &start_payload) {
            io.err(&missing_comps_message(round, &missing, "rerun --start", "the page was not served"));
            return 1;
        }
        let _ = std::fs::create_dir_all(&qdir);
        let key = a.arg("key").unwrap_or_else(random_key);
        let hand = match start_hand(&qdir, &key, &cwd, &start_payload, &dealt_worlds(roll.as_deref(), &start_payload)) {
            Ok(h) => h,
            Err(e) => {
                io.err(&format!("serve-question: could not record the hand ({}); the page was not served. Make .impeccable/questions/ writable and rerun --start.\n", e));
                return 1;
            }
        };
        take_roll(&qdir, roll.as_deref(), &start_payload);
        // The old state goes either way, so the wait below sees the new
        // server's state, not the dead one's; its pid is never signalled,
        // since a dead server's pid may have been reused.
        let _ = std::fs::remove_file(state_file(&qdir, &key));
        let log_file = jsp::join(&[&qdir, &format!("{}.log", key)]);
        let log = std::fs::OpenOptions::new().append(true).create(true).open(&log_file);
        let exe = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "impeccable".to_string());
        let mut child_args: Vec<String> = vec![
            "serve-question".into(),
            "--payload".into(),
            pp.clone(),
            "--detached-serve".into(),
            "--key".into(),
            key.clone(),
            "--timeout".into(),
            crate::util::js_number_to_string(timeout_sec),
        ];
        if let Some(g) = a.arg("idle-grace") {
            child_args.push("--idle-grace".into());
            child_args.push(g);
        }
        if !a.has("open") {
            child_args.push("--no-open".into());
        }
        let spawned = {
            let mut cmd = std::process::Command::new(&exe);
            cmd.args(&child_args).current_dir(&cwd).stdin(std::process::Stdio::null());
            match log {
                Ok(f) => {
                    let f2 = f.try_clone().ok();
                    cmd.stdout(std::process::Stdio::from(f));
                    if let Some(f2) = f2 {
                        cmd.stderr(std::process::Stdio::from(f2));
                    }
                }
                Err(_) => {
                    cmd.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
                }
            }
            // JS: spawn(..., { detached: true }) + child.unref()
            impeccable_common::proc::detach(&mut cmd);
            cmd.spawn()
        };
        let _ = spawned; // detached: never waited on
        let deadline = now_ms() + 8000.0;
        while now_ms() < deadline && !exists(&state_file(&qdir, &key)) {
            sleep_ms(100);
        }
        if !exists(&state_file(&qdir, &key)) {
            let tail = safe_read(&log_file)
                .map(|t| {
                    let lines: Vec<&str> = crate::util::js_trim(&t).split('\n').collect();
                    let n = lines.len();
                    lines[n.saturating_sub(4)..].join("\n  ")
                })
                .unwrap_or_default();
            io.err(&format!("serve-question: server failed to start{}\n", if tail.is_empty() { String::new() } else { format!("\n  {}", tail) }));
            let rel = jsp::relative(&cwd, &cwd, &log_file);
            io.err(&format!("serve-question: log at {}. A sandboxed exec that cannot listen on localhost causes exactly this; rerun this command once through the harness's network-enabled or unsandboxed command tool before falling back.\n", if rel.is_empty() { log_file.clone() } else { rel }));
            return 1;
        }
        let state = read_state(&qdir, &key).unwrap_or_default();
        io.out(&format!("QUESTION URL: {}\n", state.get("url").map(js_str).unwrap_or_default()));
        io.out(&format!("QUESTION KEY: {}\n", key));
        io.out("Open the URL for the user now: in-app browser when the harness has one, otherwise the system opener (macOS `open`, Linux `xdg-open`), otherwise show the URL.\n");
        if comps_expected(&start_payload, &cwd, Some(&hand)) {
            io.out(&visualize_next_line(&env, &cwd, Some(&hand)));
        }
        io.out(&format!("Then collect the answer with: {} --wait --key {}\n", crate::provider::detect(&env, &cwd).verb_cmd("serve-question"), key));
        return 0;
    }

    // ---- server (blocking or detached) ----
    let raw = match &payload_path {
        Some(pp) => match std::fs::read(jsp::resolve(&cwd, &[pp])) {
            Ok(b) => String::from_utf8_lossy(&b).into_owned(),
            Err(e) => {
                io.err(&format!("Error: {}\n", crate::util::node_read_error(pp, &e)));
                return 1;
            }
        },
        None => io.stdin().to_string(),
    };
    let detached_key = if a.has("detached-serve") { a.arg("key") } else { None };
    let state = Arc::new(Mutex::new(ServerState::new(cwd.clone(), qdir.clone(), detached_key.clone(), idle_grace_ms)));
    {
        let mut st = state.lock().unwrap();
        if let Err(msg) = st.load_round(&raw) {
            io.err(&format!("serve-question: {}\n", msg));
            return 1;
        }
    }
    let port = if port_arg.is_finite() && port_arg >= 0.0 { port_arg as u16 } else { 0 };
    let server = match tiny_http::Server::http(("127.0.0.1", port)) {
        Ok(s) => s,
        Err(e) => {
            io.err(&format!("Error: listen EADDRINUSE: {}\n", e));
            return 1;
        }
    };
    let actual_port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(port);
    let url = format!("http://127.0.0.1:{}/", actual_port);
    if a.has("detached-serve") {
        let _ = std::fs::create_dir_all(&qdir);
        let key = a.arg("key").unwrap_or_default();
        let mut st = json!({ "pid": std::process::id(), "port": actual_port, "url": url });
        let comps = declared_comps(&state.lock().unwrap().payload);
        if !comps.is_empty() {
            st["comps"] = json!(comps);
        }
        let _ = std::fs::write(state_file(&qdir, &key), json_compact(&st));
    } else {
        io.out(&format!("QUESTION URL: {}\n", url));
        io.out("Waiting for the user to choose in the browser (Ctrl-C aborts)...\n");
    }
    if !a.has("no-open") {
        open_system_browser(&url, &env);
    }
    let _ = io.stdout.flush();
    let started_at = now_ms();
    let server = Arc::new(server);
    // Lifetime watchdog thread; exits the process like the JS setInterval.
    {
        let state = state.clone();
        std::thread::spawn(move || loop {
            sleep_ms(2000);
            let st = state.lock().unwrap();
            if st.last_beat_seen.is_none() {
                if timeout_sec > 0.0 && now_ms() - started_at > timeout_sec * 1000.0 {
                    println!("serve-question: timed out with no answer");
                    std::process::exit(2);
                }
            } else if now_ms() - st.last_beat_seen.unwrap() > st.idle_grace_ms {
                let mut delivered_at = 0.0;
                if let Some(nf) = st.next_file() {
                    delivered_at = mtime_ms(&nf).unwrap_or(0.0);
                }
                if now_ms() - delivered_at.max(st.last_claim_at) > NEXT_CLAIM_GRACE_MS {
                    println!("serve-question: the page stopped beating and never came back; exiting");
                    std::process::exit(2);
                }
            }
        });
    }
    for mut request in server.incoming_requests() {
        let method = request.method().as_str().to_string();
        let raw_url = request.url().to_string();
        // JS: every request passes the Host allowlist first; a foreign or
        // missing Host header is a 403.
        let host = request
            .headers()
            .iter()
            .find(|h| h.field.equiv("Host"))
            .map(|h| h.value.as_str().to_string());
        if !allowed_host(host.as_deref(), actual_port) {
            let _ = request.respond(tiny_http::Response::empty(403));
            continue;
        }
        // JS: new URL(req.url, 'http://127.0.0.1'); a target the URL parser
        // rejects is a 400.
        let Some((path, query)) = parse_request_url(&raw_url) else {
            let _ = request.respond(tiny_http::Response::empty(400));
            continue;
        };
        let origin = request
            .headers()
            .iter()
            .find(|h| h.field.equiv("Origin"))
            .map(|h| h.value.as_str().to_string());
        let mut st = state.lock().unwrap();
        if method == "GET" && path == "/" {
            if let Some(pending) = st.next_file() {
                if exists(&pending) {
                    if let Some(text) = safe_read(&pending) {
                        let _ = st.load_round(&text);
                    }
                    let _ = std::fs::remove_file(&pending);
                    st.last_claim_at = now_ms();
                    if let Some(k) = st.detached_key.clone() {
                        if let Some(mut s) = read_state(&st.qdir, &k) {
                            s.insert("claimedAt".into(), Value::from(st.last_claim_at as i64));
                            let comps = declared_comps(&st.payload);
                            if comps.is_empty() {
                                s.remove("comps");
                            } else {
                                s.insert("comps".into(), json!(comps));
                            }
                            let _ = std::fs::write(state_file(&st.qdir, &k), json_compact(&Value::Object(s)));
                        }
                    }
                }
            }
            let html = st.page(st.awaiting_next);
            let resp = tiny_http::Response::from_string(html)
                .with_header(tiny_http::Header::from_bytes("content-type", "text/html; charset=utf-8").unwrap());
            let _ = request.respond(resp);
            continue;
        }
        if method == "POST" && path == "/heartbeat" {
            if let Some(code) = reject_detached_post(st.detached_key.as_deref(), origin.as_deref(), &query, actual_port) {
                let _ = request.respond(tiny_http::Response::empty(code));
                continue;
            }
            let _ = request.respond(tiny_http::Response::empty(204));
            st.last_beat_seen = Some(now_ms());
            if let Some(k) = st.detached_key.clone() {
                let now = now_ms();
                if st.last_beat_write.map(|w| now - w > 4000.0).unwrap_or(true) {
                    st.last_beat_write = Some(now);
                    if let Some(mut s) = read_state(&st.qdir, &k) {
                        s.insert("lastBeat".into(), Value::from(now as i64));
                        let _ = std::fs::write(state_file(&st.qdir, &k), json_compact(&Value::Object(s)));
                    }
                }
            }
            continue;
        }
        if method == "GET" && path == "/next-status" {
            let ready = st.next_file().map(|p| exists(&p)).unwrap_or(false);
            let resp = tiny_http::Response::from_string(format!("{{\"ready\":{}}}", ready))
                .with_header(tiny_http::Header::from_bytes("content-type", "application/json").unwrap());
            let _ = request.respond(resp);
            continue;
        }
        if method == "GET" && path.starts_with("/img/") {
            let idx_str: String = path[5..].chars().take_while(|c| c.is_ascii_digit()).collect();
            let rest = &path[5 + idx_str.len()..];
            // JS: the match is now ^\/img\/(\d+)$ over the pathname alone.
            if !idx_str.is_empty() && rest.is_empty() {
                let idx: usize = idx_str.parse().unwrap_or(usize::MAX);
                match st.local_images.get(idx).cloned() {
                    Some(abs) if exists(&abs) && !is_dir(&abs) => {
                        let ty = if abs.ends_with(".webp") {
                            "image/webp"
                        } else if abs.ends_with(".png") {
                            "image/png"
                        } else if abs.ends_with(".svg") {
                            "image/svg+xml"
                        } else if abs.ends_with(".gif") {
                            "image/gif"
                        } else {
                            "image/jpeg"
                        };
                        let bytes = std::fs::read(&abs).unwrap_or_default();
                        let resp = tiny_http::Response::from_data(bytes).with_header(tiny_http::Header::from_bytes("content-type", ty).unwrap());
                        let _ = request.respond(resp);
                    }
                    _ => {
                        let _ = request.respond(tiny_http::Response::empty(404));
                    }
                }
                continue;
            }
        }
        if method == "GET" && path.starts_with("/sketch/") {
            let idx: Option<usize> = path[8..].parse().ok();
            let hand = st.detached_key.as_deref().and_then(|k| read_hand(&st.qdir, k));
            let landed = idx.and_then(|i| st.local_sketches.get(i).cloned()).filter(|(rel, abs)| !is_dir(abs) && sketch_is_this_hands(&st.cwd, rel, hand.as_ref()));
            match landed.and_then(|(_, abs)| safe_read(&abs)) {
                Some(text) => {
                    // A sketch is agent-written HTML served on the page's own
                    // origin, so it never gets that origin: the CSP sandboxes it
                    // and closes every network path but its fonts. The skeleton
                    // view runs the injected pass; the raw view runs nothing.
                    let raw = query_param(&query, "raw").is_some();
                    let body = if raw { text } else { with_skeleton(&text) };
                    let csp = format!(
                        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob:; script-src {}; connect-src 'none'; base-uri 'none'; form-action 'none'; {}; frame-ancestors 'self'",
                        if raw { "'none'" } else { "'unsafe-inline'" },
                        if raw { "sandbox" } else { "sandbox allow-scripts" }
                    );
                    let mut resp = tiny_http::Response::from_string(body);
                    for (k, v) in [("content-type", "text/html; charset=utf-8"), ("cache-control", "no-store"), ("x-content-type-options", "nosniff"), ("referrer-policy", "no-referrer"), ("content-security-policy", csp.as_str())] {
                        resp = resp.with_header(tiny_http::Header::from_bytes(k, v).unwrap());
                    }
                    let _ = request.respond(resp);
                }
                None => {
                    let _ = request.respond(tiny_http::Response::empty(404));
                }
            }
            continue;
        }
        if method == "POST" && (path == "/build-path" || path == "/answer") {
            // JS: both handlers start with rejectDetachedPost (the /answer gate
            // from #555, the /build-path gate from the follow-up commit).
            if let Some(code) = reject_detached_post(st.detached_key.as_deref(), origin.as_deref(), &query, actual_port) {
                let _ = request.respond(tiny_http::Response::empty(code));
                continue;
            }
            let mut body = String::new();
            let _ = std::io::Read::read_to_string(request.as_reader(), &mut body);
            let ok_resp = || tiny_http::Response::from_string("{\"ok\":true}")
                .with_header(tiny_http::Header::from_bytes("content-type", "application/json").unwrap());
            if path == "/build-path" {
                let value = serde_json::from_str::<Value>(&body).ok().and_then(|v| v.get("value").and_then(|x| x.as_str()).map(|s| s.to_string()));
                if let Some(value) = value.filter(|v| v == "comp" || v == "code") {
                    let was_comp = st.live_build_path.as_deref() == Some("comp");
                    st.live_build_path = Some(value.clone());
                    // Only a flip TO comp needs the agent mid-round: comps must
                    // start rendering into the declared slots. The reverse is free.
                    if let Some(k) = st.detached_key.clone() {
                        if value == "comp" && !was_comp {
                            let _ = std::fs::create_dir_all(&st.qdir);
                            let _ = std::fs::write(flip_file(&st.qdir, &k), "{\"buildPath\":\"comp\"}\n");
                        }
                    }
                }
                // Answer only once the flip is on disk. Responding first raced the
                // caller: the 200 reached the client (a separate process) while this
                // one could still be preempted before the write landed, so a poller
                // that trusted the 200 could look for the flip file and miss it.
                let _ = request.respond(ok_resp());
                continue;
            }
            let _ = request.respond(ok_resp());
            // /answer
            let parsed = serde_json::from_str::<Value>(&body).ok().and_then(|v| v.as_object().cloned()).unwrap_or_default();
            let option_id = parsed.get("optionId").cloned().unwrap_or(Value::Null);
            let chosen = st.options.iter().find(|o| o.get("id") == Some(&option_id) && !option_id.is_null()).cloned();
            let is_reroll = option_id.as_str() == Some("reroll");
            let followup_open = st.detached_key.is_some() && st.payload.get("followup") == Some(&Value::Bool(true)) && !is_reroll;
            let mut ans = Map::new();
            ans.insert("optionId".into(), if option_id.is_null() { Value::Null } else { option_id.clone() });
            ans.insert("steer".into(), parsed.get("steer").cloned().filter(|v| !v.is_null()).unwrap_or(Value::String(String::new())));
            if is_reroll {
                if let Some(r) = parsed.get("register").and_then(|v| v.as_str()) {
                    if r == "safer" || r == "bolder" {
                        ans.insert("register".into(), Value::String(r.to_string()));
                    }
                }
            }
            if followup_open {
                ans.insert("followup".into(), Value::Bool(true));
            }
            if let Some(c) = &chosen {
                let hero = c.get("hero").filter(|v| crate::staleness::js_truthy(v));
                let board = c.get("board").filter(|v| crate::staleness::js_truthy(v));
                if hero.is_some() || board.is_some() {
                    ans.insert("hero".into(), c.get("hero").cloned().filter(|v| !v.is_null()).unwrap_or(Value::Null));
                    ans.insert("board".into(), c.get("board").cloned().filter(|v| !v.is_null()).unwrap_or(Value::Null));
                }
                // The sketch rides the answer only when it is what the user
                // chose from: this hand's file, on a card the comp face did not
                // replace after a flip.
                if let Some(h) = c.get("html").filter(|v| crate::staleness::js_truthy(v)) {
                    let hand = st.detached_key.as_deref().and_then(|k| read_hand(&st.qdir, k));
                    if st.live_build_path.as_deref() != Some("comp") && sketch_is_this_hands(&st.cwd, &js_str(h), hand.as_ref()) {
                        ans.insert("html".into(), h.clone());
                    }
                }
                let comp = c.get("comp").filter(|v| !v.is_null()).or_else(|| c.get("sketch").filter(|v| !v.is_null()));
                if let Some(cv) = comp.filter(|v| crate::staleness::js_truthy(v)) {
                    ans.insert("comp".into(), cv.clone());
                }
            }
            if let Some(lbp) = st.live_build_path.clone() {
                if !is_reroll {
                    ans.insert("buildPath".into(), Value::String(lbp.clone()));
                    ans.insert("buildPathFlipped".into(), Value::Bool(Some(lbp.as_str()) != st.build_path_default.as_ref().map(|b| b.0.as_str())));
                }
            }
            let answer = json_compact(&Value::Object(ans));
            let was_awaiting = st.awaiting_next;
            st.awaiting_next = (is_reroll || followup_open) && st.detached_key.is_some();
            if st.awaiting_next && !was_awaiting {
                st.awaiting_next_since = now_ms();
            }
            if let Some(k) = st.detached_key.clone() {
                let _ = std::fs::create_dir_all(&st.qdir);
                let _ = std::fs::write(answer_file(&st.qdir, &k), format!("{}\n", answer));
            } else {
                print_answer(io, &answer, &declared_comps(&st.payload));
                let _ = io.stdout.flush();
            }
            if !((is_reroll || followup_open) && st.detached_key.is_some()) {
                drop(st);
                sleep_ms(150);
                let _ = io.stdout.flush();
                return 0;
            }
            continue;
        }
        let _ = request.respond(tiny_http::Response::empty(404));
    }
    0
}

use std::io::Write;

/// JS: serve-question.mjs#allowedHost — browsers omit the :80 suffix on the
/// default HTTP port, so a server on --port 80 sees bare loopback hosts.
fn allowed_host(host: Option<&str>, port: u16) -> bool {
    let Some(host) = host else { return false };
    if host == format!("127.0.0.1:{}", port) || host == format!("localhost:{}", port) {
        return true;
    }
    port == 80 && (host == "127.0.0.1" || host == "localhost")
}

/// JS: serve-question.mjs#allowedOrigin
fn allowed_origin(origin: &str, port: u16) -> bool {
    if origin == format!("http://127.0.0.1:{}", port) || origin == format!("http://localhost:{}", port) {
        return true;
    }
    port == 80 && (origin == "http://127.0.0.1" || origin == "http://localhost")
}

/// JS: serve-question.mjs#rejectDetachedPost. Returns the status to answer
/// with (401/403) when the POST must be rejected, None when it may proceed.
fn reject_detached_post(detached_key: Option<&str>, origin: Option<&str>, query: &str, port: u16) -> Option<u16> {
    if let Some(key) = detached_key {
        if query_param(query, "key").as_deref() != Some(key) {
            return Some(401);
        }
    }
    if let Some(o) = origin {
        if !allowed_origin(o, port) {
            return Some(403);
        }
    }
    None
}

/// JS: url.searchParams.get(name) over the search string (no leading '?').
fn query_param(query: &str, name: &str) -> Option<String> {
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = match pair.split_once('=') {
            Some((k, v)) => (k, v),
            None => (pair, ""),
        };
        if form_decode(k) == name {
            return Some(form_decode(v));
        }
    }
    None
}

/// application/x-www-form-urlencoded decode: '+' is space, %XX is a byte.
fn form_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len()
                && bytes[i + 1].is_ascii_hexdigit()
                && bytes[i + 2].is_ascii_hexdigit() =>
            {
                let h = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|x| u8::from_str_radix(x, 16).ok());
                if let Some(v) = h {
                    out.push(v);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// JS: `new URL(req.url, 'http://127.0.0.1')` -> (pathname, search sans '?').
/// None where the URL constructor would throw (a protocol-relative target
/// whose host carries forbidden code points).
fn parse_request_url(raw: &str) -> Option<(String, String)> {
    // Same input cleaning the URL parser applies.
    let trimmed = raw.trim_matches(|c: char| (c as u32) <= 0x20);
    let cleaned: String = trimmed.chars().filter(|c| !matches!(c, '\t' | '\n' | '\r')).collect();
    let starts_slashy = |s: &str, n: usize| s.chars().take(n).filter(|c| *c == '/' || *c == '\\').count() == n;
    let abs = if starts_slashy(&cleaned, 2) {
        // Protocol-relative reference: the authority is taken from the target.
        format!("http:{}", cleaned)
    } else if starts_slashy(&cleaned, 1) {
        format!("http://127.0.0.1{}", cleaned)
    } else {
        // A relative target resolves against the base path '/'.
        format!("http://127.0.0.1/{}", cleaned)
    };
    let u = crate::url::parse(&abs)?;
    let search = u.search.strip_prefix('?').unwrap_or("").to_string();
    Some((u.pathname, search))
}

fn touch_now(p: &str) {
    // Update mtime to now: rewrite the bytes (portable, no filetime crate).
    if let Ok(b) = std::fs::read(p) {
        let _ = std::fs::write(p, b);
    }
}

fn random_key() -> String {
    // Math.random().toString(16).slice(2, 10)
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let mut x = (t as u64) ^ ((std::process::id() as u64) << 32) ^ 0x9E3779B97F4A7C15;
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51afd7ed558ccd);
    x ^= x >> 33;
    format!("{:08x}", (x & 0xffffffff) as u32)
}

pub fn open_system_browser(url: &str, env: &Env) -> bool {
    let (cmd, args): (String, Vec<String>) = if cfg!(target_os = "macos") {
        ("open".into(), vec![url.to_string()])
    } else if cfg!(windows) {
        let comspec = env.get("ComSpec").or_else(|| env.get("COMSPEC")).cloned().unwrap_or_else(|| "cmd.exe".into());
        (comspec, vec!["/c".into(), "start".into(), String::new(), url.to_string()])
    } else {
        ("xdg-open".into(), vec![url.to_string()])
    };
    // JS (lib/open-system-browser.mjs): spawn(command, args, { stdio: 'ignore',
    // detached: true }) + unref(). The Windows form is `cmd /c start "" <url>`
    // exactly as the JS spawned it; the URL is a localhost one this process
    // built, so cmd metacharacters are not a concern there.
    let mut c = std::process::Command::new(cmd);
    c.args(args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    impeccable_common::proc::detach(&mut c);
    c.spawn().is_ok()
}

// ─── round state + page rendering ──────────────────────────────────────────

struct ServerState {
    cwd: String,
    qdir: String,
    detached_key: Option<String>,
    idle_grace_ms: f64,
    payload: Value,
    options: Vec<Value>,
    local_images: Vec<String>,
    /// Declared sketches as (path as written, absolute path), served at /sketch/<n>.
    local_sketches: Vec<(String, String)>,
    build_path_default: Option<(String, bool)>,
    live_build_path: Option<String>,
    awaiting_next: bool,
    awaiting_next_since: f64,
    last_beat_seen: Option<f64>,
    last_beat_write: Option<f64>,
    last_claim_at: f64,
}

/// The skeleton treatment the decision page draws a sketch in: once fonts and
/// layout settle, text under 22px becomes a bar of its own width and colour,
/// so the composition, palette, display type and headline numbers read and the
/// copy does not invite proofreading. `?raw=1` serves the file as written.
const SKETCH_SKELETON: &str = "<script>(()=>{const run=()=>{const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const ns=[];while(w.nextNode()){const n=w.currentNode;if(n.textContent.trim()&&!n.parentElement.closest('script,style,svg,title'))ns.push(n);}for(const n of ns){const el=n.parentElement;const cs=getComputedStyle(el);const fs=parseFloat(cs.fontSize)||14;if(fs>=22)continue;const r=document.createRange();r.selectNodeContents(n);const rects=[...r.getClientRects()].filter(x=>x.width>0);if(!rects.length)continue;const f=document.createDocumentFragment();for(const x of rects){const s=document.createElement('span');s.style.cssText='display:inline-block;vertical-align:middle;width:'+Math.max(6,x.width*.92)+'px;height:'+Math.max(4,fs*.5)+'px;border-radius:99px;background:currentColor;opacity:.32;margin-right:'+(x.width*.08)+'px';f.appendChild(s);}n.replaceWith(f);}parent.postMessage({impeccableSketch:'ready'},'*');};const go=()=>Promise.race([document.fonts?document.fonts.ready:null,new Promise(r=>setTimeout(r,2500))].filter(Boolean)).then(run,run);if(document.readyState==='complete')go();else addEventListener('load',go,{once:true});})();</script>";

/// A sketch's frame from its card's `htmlFrame` ("390x844" or [390, 844]):
/// the device's first screen for a phone or native surface; 1440 x 900, a
/// desktop first viewport, when absent or unreadable.
fn sketch_frame(o: &Value) -> (u32, u32) {
    let pair = match o.get("htmlFrame") {
        Some(Value::String(t)) => t.split_once(['x', 'X', '×']).and_then(|(w, h)| Some((w.trim().parse::<f64>().ok()?, h.trim().parse::<f64>().ok()?))),
        Some(Value::Array(a)) if a.len() == 2 => a[0].as_f64().zip(a[1].as_f64()),
        _ => None,
    };
    match pair {
        Some((w, h)) if (200.0..=4000.0).contains(&w) && (200.0..=4000.0).contains(&h) => (w.round() as u32, h.round() as u32),
        _ => (1440, 900),
    }
}

fn with_skeleton(html: &str) -> String {
    match html.to_ascii_lowercase().rfind("</body>") {
        Some(i) => format!("{}{}{}", &html[..i], SKETCH_SKELETON, &html[i..]),
        None => format!("{}{}", html, SKETCH_SKELETON),
    }
}

fn esc(v: &Value) -> String {
    let s = match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => js_str(other),
    };
    esc_s(&s)
}

fn esc_s(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn get<'a>(o: &'a Value, k: &str) -> Option<&'a Value> {
    o.get(k).filter(|v| !v.is_null())
}
fn truthy(o: &Value, k: &str) -> bool {
    o.get(k).map(crate::staleness::js_truthy).unwrap_or(false)
}
fn str_of(o: &Value, k: &str) -> Option<String> {
    get(o, k).filter(|v| crate::staleness::js_truthy(v)).map(js_str)
}

impl ServerState {
    fn new(cwd: String, qdir: String, detached_key: Option<String>, idle_grace_ms: f64) -> ServerState {
        ServerState {
            cwd,
            qdir,
            detached_key,
            idle_grace_ms,
            payload: Value::Null,
            options: vec![],
            local_images: vec![],
            local_sketches: vec![],
            build_path_default: None,
            live_build_path: None,
            awaiting_next: false,
            awaiting_next_since: 0.0,
            last_beat_seen: None,
            last_beat_write: None,
            last_claim_at: 0.0,
        }
    }

    fn next_file(&self) -> Option<String> {
        self.detached_key.as_ref().map(|k| next_file(&self.qdir, k))
    }

    /// JS: loadRound(json)
    fn load_round(&mut self, json: &str) -> Result<(), String> {
        let parsed: Value = serde_json::from_str(json).map_err(|e| format!("{}", e))?;
        let ok = parsed.get("options").and_then(|o| o.as_array()).map(|o| !o.is_empty()).unwrap_or(false);
        if !ok {
            return Err("payload needs an options array".into());
        }
        let mut local_images: Vec<String> = Vec::new();
        let mut local_sketches: Vec<(String, String)> = Vec::new();
        let cwd = self.cwd.clone();
        let is_url = |s: &str| s.starts_with("http://") || s.starts_with("https://");
        fn image_src(cwd: &str, local_images: &mut Vec<String>, value: Option<&Value>) -> Value {
            let Some(v) = value.filter(|v| crate::staleness::js_truthy(v)) else { return Value::Null };
            let s = js_str(v);
            if s.starts_with("http://") || s.starts_with("https://") {
                return Value::String(s);
            }
            let abs = jsp::resolve(cwd, &[&s]);
            if !exists(&abs) {
                return Value::Null;
            }
            local_images.push(abs);
            Value::String(format!("/img/{}", local_images.len() - 1))
        }
        let mut decorated: Vec<Value> = Vec::new();
        let opts = parsed.get("options").unwrap().as_array().unwrap().clone();
        let canon_card = parsed.get("canonCard").filter(|c| c.is_object() || c.is_array());
        let mut decorate = |option: &Value| -> Value {
            let mut m = option.as_object().cloned().unwrap_or_default();
            let hero = image_src(&cwd, &mut local_images, option.get("hero"));
            let board = image_src(&cwd, &mut local_images, option.get("board"));
            let comp_val = option.get("comp").filter(|v| !v.is_null()).or_else(|| option.get("sketch").filter(|v| !v.is_null()));
            let comp = match comp_val.filter(|v| crate::staleness::js_truthy(v)) {
                None => Value::Null,
                Some(v) => {
                    let s = js_str(v);
                    if is_url(&s) {
                        Value::String(s)
                    } else {
                        local_images.push(jsp::resolve(&cwd, &[&s]));
                        Value::String(format!("/img/{}", local_images.len() - 1))
                    }
                }
            };
            let html = match option.get("html").filter(|v| crate::staleness::js_truthy(v)).map(js_str) {
                Some(s) if !is_url(&s) => {
                    local_sketches.push((s.clone(), jsp::resolve(&cwd, &[&s])));
                    Value::String(format!("/sketch/{}", local_sketches.len() - 1))
                }
                _ => Value::Null,
            };
            m.insert("htmlSrc".into(), html);
            m.insert("heroSrc".into(), hero);
            m.insert("boardSrc".into(), board);
            m.insert("compSrc".into(), comp);
            Value::Object(m)
        };
        for o in &opts {
            decorated.push(decorate(o));
        }
        let canon_decorated = canon_card.map(|c| {
            let mut v = decorate(c);
            if let Some(m) = v.as_object_mut() {
                m.insert("id".into(), Value::String("canon".into()));
                m.insert("isCanon".into(), Value::Bool(true));
            }
            v
        });
        let declined: Vec<Value> = decorated.iter().filter(|o| o.get("verdict").and_then(|v| v.as_str()) == Some("declined")).cloned().collect();
        let mut options: Vec<Value> = decorated.into_iter().filter(|o| o.get("verdict").and_then(|v| v.as_str()) != Some("declined")).collect();
        if let Some(c) = canon_decorated {
            options.push(c);
        }
        options.extend(declined);
        self.payload = parsed.clone();
        self.options = options;
        self.local_images = local_images;
        self.local_sketches = local_sketches;
        self.build_path_default = parsed.get("buildPath").filter(|b| crate::staleness::js_truthy(b)).and_then(|b| {
            let v = b.get("value").and_then(|x| x.as_str())?;
            if v == "comp" || v == "code" {
                Some((v.to_string(), b.get("toggle") == Some(&Value::Bool(true))))
            } else {
                None
            }
        });
        self.live_build_path = self.build_path_default.as_ref().map(|b| b.0.clone());
        self.awaiting_next = false;
        Ok(())
    }

    /// JS: page(waiting)
    fn page(&self, waiting: bool) -> String {
        let wait_budget_ms = if waiting { (self.awaiting_next_since + self.idle_grace_ms - now_ms()).max(0.0) } else { self.idle_grace_ms };
        let flip_chip = |label: &str| format!("<button type=\"button\" class=\"chip flip\" aria-label=\"Flip the card\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 4a8 8 0 1 1-8 8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\"/><path d=\"M4 5.5V12h6.5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg><span>{}</span></button>", label);
        let expand_chip = "<button type=\"button\" class=\"chip expand\" aria-label=\"Expand the image\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></button>";
        let fact = |label: &str, value: Option<&Value>, cls: &str| -> String {
            match value.filter(|v| crate::staleness::js_truthy(v)) {
                Some(v) => format!("<p class=\"fact{}\"><span class=\"fact-label\">{}</span>{}</p>", if cls.is_empty() { String::new() } else { format!(" {}", cls) }, label, esc(v)),
                None => String::new(),
            }
        };
        let demoted = |o: &Value| o.get("verdict").and_then(|v| v.as_str()) == Some("declined");
        let build_path = self.build_path_default.clone();
        let code_led = build_path.as_ref().map(|b| b.0 == "code").unwrap_or(false);
        let has = |o: &Value, k: &str| truthy(o, k);
        let identity_round = !(self.options.first().map(|o| has(o, "compSrc") || has(o, "heroSrc") || has(o, "boardSrc")).unwrap_or(false));
        let face_comp = |o: &Value| -> Option<String> { if demoted(o) || code_led { None } else { str_of(o, "compSrc") } };
        // An HTML sketch is the face wherever no comp is: a code-led round, or
        // a round without image generation. A comp, when one is the face, wins.
        let face_html = |o: &Value| -> Option<String> { if demoted(o) || face_comp(o).is_some() { None } else { str_of(o, "htmlSrc") } };
        let thumb_only = |o: &Value| face_comp(o).is_none() && face_html(o).is_none() && (has(o, "heroSrc") || has(o, "boardSrc")) && (demoted(o) || identity_round);
        let has_media = |o: &Value| face_comp(o).is_some() || face_html(o).is_some() || ((has(o, "heroSrc") || has(o, "boardSrc")) && !thumb_only(o));
        let has_back = |o: &Value| has_media(o) && (has(o, "viewport") || has(o, "case") || (has(o, "boardSrc") && has(o, "heroSrc")));
        let options = &self.options;
        let anatomy = |o: &Value| -> String {
            let mut rows: Vec<String> = Vec::new();
            if let Some(t) = get(o, "thesis").filter(|v| crate::staleness::js_truthy(v)) {
                rows.push(format!("<p class=\"thesis\">{}</p>", esc(t)));
            }
            let mut id_bits: Vec<String> = Vec::new();
            if let Some(p) = o.get("palette").and_then(|p| p.as_array()).filter(|p| !p.is_empty()) {
                let sw: String = p.iter().take(6).map(|c| format!("<i style=\"background:{}\" title=\"{}\"></i>", esc(c), esc(c))).collect();
                id_bits.push(format!("<span class=\"swatches\">{}</span>", sw));
            }
            if let Some(m) = o.get("materials").and_then(|p| p.as_array()).filter(|p| !p.is_empty()) {
                id_bits.push(m.iter().take(4).map(|x| format!("<span class=\"tag\">{}</span>", esc(x))).collect::<Vec<_>>().join(""));
            }
            if !id_bits.is_empty() {
                rows.push(format!("<div class=\"identity\">{}</div>", id_bits.join("")));
            }
            if let Some(raised) = o.get("raised").and_then(|r| r.as_array()).filter(|r| !r.is_empty()) {
                let name_of = |id: Option<&Value>| -> String {
                    let found = id.and_then(|i| options.iter().find(|x| x.get("id") == Some(i)));
                    match found.and_then(|f| str_of(f, "label")) {
                        Some(l) => l,
                        None => match id {
                            None | Some(Value::Null) => String::new(),
                            Some(v) => js_str(v),
                        },
                    }
                };
                let raise_lines: Vec<String> = raised
                    .iter()
                    .take(6)
                    .map(|r| {
                        let text = get(r, "raise").filter(|v| crate::staleness::js_truthy(v)).or_else(|| get(r, "kept").filter(|v| crate::staleness::js_truthy(v)));
                        format!("<p class=\"raise\"><span class=\"fact-label\">From {}</span>{}</p>", esc_s(&name_of(r.get("from"))), text.map(esc).unwrap_or_default())
                    })
                    .collect();
                let raises_head = |count: usize| -> String {
                    format!(
                        "<div class=\"raises-head\"><span class=\"fact-label\">Improved by Impeccable's worlds</span>{}</div>",
                        if count > 1 { format!("<span class=\"raises-count\" data-raises-count>1/{}</span>", count) } else { String::new() }
                    )
                };
                if raise_lines.len() > 1 {
                    rows.push(format!(
                        "<div class=\"raises raises-cycle\" role=\"button\" tabindex=\"0\" title=\"Click or press Enter for the next improvement\" aria-label=\"How Impeccable's worlds improved this direction; activate to see the next improvement\">\n              {}\n              {}\n              <span class=\"sr-live\" aria-live=\"polite\"></span>\n            </div>",
                        raises_head(raise_lines.len()),
                        raise_lines.join("")
                    ));
                } else {
                    rows.push(format!("<div class=\"raises\">{}{}</div>", raises_head(1), raise_lines[0]));
                }
            }
            if thumb_only(o) {
                let src = str_of(o, "heroSrc").or_else(|| str_of(o, "boardSrc")).unwrap_or_default();
                rows.push(format!("<figure class=\"inspo\" title=\"Inspiration: the world this direction draws from. Your page will not look like this image.\"><img src=\"{}\" alt=\"\"><figcaption>inspired by</figcaption></figure>", esc_s(&src)));
            }
            if has_media(o) {
                rows.push(fact("Risk", o.get("risk"), "clamp"));
            } else {
                rows.push(fact("First viewport", o.get("viewport"), ""));
                rows.push(fact("The case", o.get("case"), ""));
                rows.push(fact("Kept", o.get("kept"), ""));
                rows.push(fact("Risk", o.get("risk"), ""));
            }
            if !has(o, "thesis") && has(o, "body") {
                rows.push(format!("<p class=\"detail\">{}</p>", esc(o.get("body").unwrap())));
            } else if has(o, "body") && has(o, "thesis") && !has_back(o) {
                rows.push(format!("<p class=\"detail more\">{}</p>", esc(o.get("body").unwrap())));
            }
            rows.join("\n            ")
        };
        let back_facts = |o: &Value| -> String {
            let parts = [
                fact("First viewport", o.get("viewport"), ""),
                fact("The case", o.get("case"), ""),
                fact("Kept", o.get("kept"), ""),
                fact("Risk", o.get("risk"), ""),
                if has(o, "body") && has(o, "thesis") { format!("<p class=\"detail more\">{}</p>", esc(o.get("body").unwrap())) } else { String::new() },
            ];
            parts.iter().filter(|p| !p.is_empty()).cloned().collect::<Vec<_>>().join("\n            ")
        };
        let media = |o: &Value| -> String {
            let inspiration_src = str_of(o, "heroSrc").or_else(|| str_of(o, "boardSrc"));
            let inspiration = match &inspiration_src {
                Some(src) => format!("<figure class=\"pip\" title=\"Inspiration: the world this direction draws from. Your page will not look like this image.\">\n              <img src=\"{}\" alt=\"\">\n              <figcaption>inspiration</figcaption>\n            </figure>", esc_s(src)),
                None => String::new(),
            };
            let details = if has_back(o) { flip_chip("Details") } else { String::new() };
            if thumb_only(o) {
                return String::new();
            }
            if face_comp(o).is_some() {
                let text_only_facts = back_facts(o);
                return format!(
                    "<div class=\"media comp-pending\" data-comp=\"{}\">\n            <div class=\"shimmer\"><span class=\"comp-note\">rendering&hellip;</span></div>\n            <img class=\"comp\" alt=\"\" hidden>\n            {}\n            <template class=\"text-only-facts\">{}</template>\n            <div class=\"chips\">{}{}</div>\n          </div>",
                    esc_s(&str_of(o, "compSrc").unwrap_or_default()),
                    inspiration,
                    text_only_facts,
                    expand_chip,
                    details
                );
            }
            if let Some(src) = face_html(o) {
                let (fw, fh) = sketch_frame(o);
                let portrait = if f64::from(fh) > f64::from(fw) * 1.05 { " portrait" } else { "" };
                return format!(
                    "<div class=\"media html html-pending{}\" data-html=\"{}\" data-frame-w=\"{}\" style=\"aspect-ratio: {} / {}\">\n            <div class=\"shimmer\"><span class=\"comp-note\">sketching&hellip;</span></div>\n            <div class=\"sketch-frame\"><iframe sandbox=\"allow-scripts\" tabindex=\"-1\" aria-hidden=\"true\" title=\"Sketch\" style=\"width:{}px;height:{}px\"></iframe></div>\n            {}\n            <p class=\"media-label\">sketch</p>\n            <div class=\"chips\">{}{}</div>\n          </div>",
                    portrait,
                    esc_s(&src),
                    fw,
                    fw,
                    fh,
                    fw,
                    fh,
                    inspiration,
                    expand_chip,
                    details
                );
            }
            if has(o, "heroSrc") || has(o, "boardSrc") {
                return format!(
                    "<div class=\"media\" title=\"Inspiration: the world this direction draws from. Your page will not look like this image.\">\n            <img src=\"{}\" alt=\"\">\n            <p class=\"media-label\">inspiration</p>\n            <div class=\"chips\">{}{}</div>\n          </div>",
                    esc_s(&str_of(o, "heroSrc").or_else(|| str_of(o, "boardSrc")).unwrap_or_default()),
                    expand_chip,
                    details
                );
            }
            String::new()
        };
        let num_of = |v: Option<&Value>| -> f64 {
            match v {
                None | Some(Value::Null) => 0.0,
                Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
                Some(Value::Bool(b)) => {
                    if *b {
                        1.0
                    } else {
                        0.0
                    }
                }
                Some(Value::String(s)) => crate::critique_storage::js_number(s),
                Some(_) => f64::NAN,
            }
        };
        let wire = |o: &Value| -> String {
            let Some(frame) = get(o, "wireframe").filter(|v| crate::staleness::js_truthy(v)) else { return String::new() };
            let Some(regions) = frame.get("regions").and_then(|r| r.as_array()).filter(|r| !r.is_empty()) else { return String::new() };
            if !media(o).is_empty() || demoted(o) {
                return String::new();
            }
            let cols_n = num_of(frame.get("cols"));
            let cols = if cols_n > 0.0 { cols_n } else { 12.0 };
            let rows_n = num_of(frame.get("rows"));
            let rows = if rows_n > 0.0 { rows_n } else { 10.0 };
            let pct = |n: f64, total: f64| -> String { format!("{}%", crate::util::to_fixed(((n / total) * 100.0).min(100.0).max(0.0), 2)) };
            let cells: String = regions
                .iter()
                .take(12)
                .map(|r| {
                    let x = { let v = num_of(r.get("x")); if v.is_nan() || v == 0.0 { 0.0 } else { v } };
                    let y = { let v = num_of(r.get("y")); if v.is_nan() || v == 0.0 { 0.0 } else { v } };
                    let w = { let v = num_of(r.get("w")); (if v.is_nan() || v == 0.0 { 1.0 } else { v }).max(0.5) };
                    let h = { let v = num_of(r.get("h")); (if v.is_nan() || v == 0.0 { 1.0 } else { v }).max(0.5) };
                    format!(
                        "<div class=\"wire-region{}\" style=\"left:{};top:{};width:{};height:{}\"><span>{}</span></div>",
                        if truthy(r, "accent") { " accent" } else { "" },
                        pct(x, cols),
                        pct(y, rows),
                        pct(w, cols),
                        pct(h, rows),
                        esc_s(&str_of(r, "label").unwrap_or_default())
                    )
                })
                .collect();
            format!("<div class=\"media wire\" role=\"img\" aria-label=\"Layout schematic\">\n            <div class=\"wire-field\">{}</div>\n            <p class=\"media-label\">layout</p>\n          </div>", cells)
        };
        let choose_label = |o: &Value| if truthy(o, "isCanon") { "Play it straight" } else if demoted(o) { "Adopt anyway" } else { "Build this" };
        let cards: Vec<String> = options
            .iter()
            .enumerate()
            .map(|(index, o)| {
                let media_html = media(o);
                let wire_html = if media_html.is_empty() { wire(o) } else { String::new() };
                let media_or_wire = if !media_html.is_empty() { media_html.clone() } else { wire_html.clone() };
                let id_esc = esc(o.get("id").unwrap_or(&Value::Null));
                let kicker = if has(o, "kicker") {
                    format!("<span class=\"kicker\">{}</span>", esc(o.get("kicker").unwrap()))
                } else if demoted(o) {
                    "<span class=\"kicker declined-k\">Declined</span>".to_string()
                } else if truthy(o, "isCanon") {
                    "<span class=\"kicker standing\">The standing door</span>".to_string()
                } else {
                    String::new()
                };
                let label_esc = esc(o.get("label").unwrap_or(&Value::Null));
                let back = if has_back(o) {
                    let board = str_of(o, "boardSrc");
                    format!(
                        "<div class=\"face back{}\">\n          {}\n          <div class=\"body back-body\">\n            {}\n            {}\n            <button class=\"choose\" data-id=\"{}\">{}</button>\n          </div>\n        </div>",
                        if index == 0 { " lead" } else { "" },
                        match &board {
                            Some(b) => format!("<div class=\"media back-media\">\n            <img src=\"{}\" alt=\"\">\n            <div class=\"chips\">{}{}</div>\n          </div>", esc_s(b), expand_chip, flip_chip("Front")),
                            None => format!("<div class=\"back-head\"><p class=\"tier\">The full read &middot; {}</p>{}</div>", label_esc, flip_chip("Front")),
                        },
                        if board.is_some() { format!("<p class=\"tier\">The full read &middot; {}</p>", label_esc) } else { String::new() },
                        back_facts(o),
                        id_esc,
                        choose_label(o)
                    )
                } else {
                    String::new()
                };
                format!(
                    "\n    <article class=\"card{}{}\" style=\"--fan:{};--deal:{}ms\" data-id=\"{}\"{}>\n      <div class=\"card-inner\">\n        <div class=\"face front{}{}\">\n          {}\n          {}\n          <div class=\"body\">\n            {}\n            <h2>{}</h2>\n            {}\n            <button class=\"choose\" data-id=\"{}\">{}</button>\n          </div>\n        </div>\n        {}\n      </div>\n    </article>",
                    if truthy(o, "isCanon") { " canon" } else { "" },
                    if demoted(o) { " declined" } else { "" },
                    if index == 0 { "0deg" } else if index % 2 == 1 { "1.4deg" } else { "-1.2deg" },
                    index * 90,
                    id_esc,
                    if code_led && has(o, "compSrc") && !demoted(o) { format!(" data-comp-slot=\"{}\"", esc_s(&str_of(o, "compSrc").unwrap_or_default())) } else { String::new() },
                    if index == 0 { " lead" } else { "" },
                    if media_or_wire.is_empty() { " text-only" } else { "" },
                    kicker,
                    media_or_wire,
                    if has(o, "lineage") { format!("<p class=\"tier\">{}</p>", esc(o.get("lineage").unwrap())) } else { String::new() },
                    label_esc,
                    anatomy(o),
                    id_esc,
                    choose_label(o),
                    back
                )
            })
            .collect();
        let cards_html = cards.join("\n");
        let payload = &self.payload;
        let title_default = |d: &str| -> String {
            match get(payload, "title").filter(|v| crate::staleness::js_truthy(v)) {
                Some(t) => esc(t),
                None => esc_s(d),
            }
        };
        let toggle = build_path.as_ref().map(|b| b.1).unwrap_or(false);
        let bp_confirm = if toggle {
            "<div id=\"bp-confirm\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"bp-confirm-title\" hidden>\n  <div class=\"bp-confirm-panel\">\n    <h2 id=\"bp-confirm-title\">Flip to comp-first?</h2>\n    <p>The agent starts rendering a comp for every open card right away, about a minute or two per card on your image provider, and the images land on the cards as they finish. This flip binds this session only.</p>\n    <div class=\"bp-confirm-actions\">\n      <button type=\"button\" class=\"bp-confirm-go\" data-confirm>Render comps</button>\n      <button type=\"button\" class=\"bp-confirm-stay\" data-cancel>Keep code-first</button>\n    </div>\n  </div>\n</div>".to_string()
        } else {
            String::new()
        };
        let bp_switch = if toggle {
            format!("<div id=\"build-path\" data-default=\"{}\">\n        <div class=\"bp-switch\" role=\"radiogroup\" aria-label=\"Build path\">\n          <button type=\"button\" class=\"bp-opt\" data-bp=\"comp\" role=\"radio\" aria-checked=\"false\">Comp first</button>\n          <button type=\"button\" class=\"bp-opt\" data-bp=\"code\" role=\"radio\" aria-checked=\"false\">Code first</button>\n        </div>\n        <p class=\"bp-note\" data-bp-note></p>\n      </div>", build_path.as_ref().unwrap().0)
        } else {
            String::new()
        };
        let question = match get(payload, "question").filter(|v| crate::staleness::js_truthy(v)) {
            Some(q) => format!("<p class=\"question\">{}</p>", esc(q)),
            None => String::new(),
        };
        let steer = if truthy(payload, "steer") { "<input id=\"steer\" placeholder=\"Optional steer: what should be different or kept?\">" } else { "" };
        let reroll_footer = if truthy(payload, "reroll") {
            let die = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\"/><circle cx=\"8.4\" cy=\"8.4\" r=\"1.5\" fill=\"currentColor\"/><circle cx=\"15.6\" cy=\"8.4\" r=\"1.5\" fill=\"currentColor\"/><circle cx=\"8.4\" cy=\"15.6\" r=\"1.5\" fill=\"currentColor\"/><circle cx=\"15.6\" cy=\"15.6\" r=\"1.5\" fill=\"currentColor\"/><circle cx=\"12\" cy=\"12\" r=\"1.5\" fill=\"currentColor\"/></svg>";
            let registers: Vec<&str> = payload
                .get("reroll")
                .and_then(|r| r.get("registers"))
                .and_then(|r| r.as_array())
                .map(|a| a.iter().filter_map(|v| v.as_str()).filter(|s| *s == "safer" || *s == "bolder").collect())
                .unwrap_or_default();
            let safer = if registers.contains(&"safer") { "<button class=\"reroll-btn\" id=\"reroll-safer\" title=\"Deal the familiar register: conventional grounded directions plus the category standard against named competitors\"><span>&larr; Safer hand</span></button>" } else { "" };
            let bolder = if registers.contains(&"bolder") { "<button class=\"reroll-btn\" id=\"reroll-bolder\" title=\"Deal foreign forms only, at full commitment\"><span>Bolder hand &rarr;</span></button>" } else { "" };
            format!("{}<button class=\"reroll-btn\" id=\"reroll\">{}<span>Re-roll</span></button>{}", safer, die, bolder)
        } else {
            String::new()
        };
        let canon = if truthy(payload, "canon") && !truthy(payload, "canonCard") {
            "<button id=\"canon\" title=\"Skip the roll: build the page this category ships, executed impeccably\">Play it straight</button>"
        } else {
            ""
        };
        let followup = if payload.get("followup") == Some(&Value::Bool(true)) && self.detached_key.is_some() { "true" } else { "false" };
        let beat = if waiting && wait_budget_ms <= 0.0 { "" } else { "beat();" };
        let await_next = if waiting { format!("awaitNextRound(false, {});", crate::util::js_number_to_string(wait_budget_ms)) } else { String::new() };
        // JS: const KEY = ${JSON.stringify(detachedKey || '')};
        let key_json = serde_json::to_string(self.detached_key.as_deref().unwrap_or("")).unwrap_or_else(|_| "\"\"".into());
        let subs: [(&str, String); 15] = [
            ("@@1@@", title_default("impeccable · decision")),
            ("@@2@@", expand_chip.to_string()),
            ("@@3@@", bp_confirm),
            ("@@4@@", title_default("Choose a direction")),
            ("@@5@@", bp_switch),
            ("@@6@@", question),
            ("@@7@@", cards_html),
            ("@@8@@", steer.to_string()),
            ("@@9@@", reroll_footer),
            ("@@10@@", canon.to_string()),
            ("@@11@@", followup.to_string()),
            ("@@12@@", beat.to_string()),
            ("@@13@@", crate::util::js_number_to_string(self.idle_grace_ms)),
            ("@@14@@", await_next),
            ("@@15@@", key_json),
        ];
        let mut html = PAGE.to_string();
        // Replace higher numbers first so @@1@@ does not clobber @@10@@..@@15@@.
        for (k, v) in subs.iter().rev() {
            html = html.replace(k, v);
        }
        let _ = (utf16_len(""), iso_now());
        html
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn question_page_uses_system_fonts_and_inline_branding() {
        assert!(!PAGE.contains("fonts.googleapis.com"));
        assert!(!PAGE.contains("fonts.gstatic.com"));
        assert!(!PAGE.contains("@font-face"));
        assert!(!PAGE.contains("/fonts/"));
        assert!(PAGE.contains("--ks-font: system-ui,"));
        assert!(PAGE.contains("aria-label=\"Impeccable\""));
        assert!(PAGE.contains("color-scheme: light"));
        assert!(!PAGE.contains("color-scheme: dark"));
    }

    fn temp_project(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("impeccable-sq-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".impeccable/questions")).unwrap();
        std::fs::create_dir_all(dir.join(".impeccable/mocks/decision")).unwrap();
        dir
    }

    fn run_captured(dir: &std::path::Path, args: &[&str]) -> (i32, String) {
        let env = Env::from([("IMPECCABLE_SKILL_DIR".into(), "/skill".into())]);
        let (mut io, cap) = Io::captured("", dir.to_path_buf(), env);
        let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        let code = run(&argv, &mut io);
        let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
        (code, out)
    }

    #[test]
    fn declared_comps_reads_options_sketch_alias_and_canon_in_card_order() {
        let payload = json!({
            "options": [
                { "id": "a", "comp": ".impeccable/mocks/decision/a.png" },
                { "id": "b", "sketch": ".impeccable/mocks/decision/b.png" },
                { "id": "c", "comp": "https://x/c.png" },
                { "id": "d" },
                { "id": "e", "comp": ".impeccable/mocks/decision/a.png" }
            ],
            "canonCard": { "label": "canon", "comp": ".impeccable/mocks/decision/canon.png" }
        });
        assert_eq!(
            declared_comps(&payload),
            vec![".impeccable/mocks/decision/a.png", ".impeccable/mocks/decision/b.png", ".impeccable/mocks/decision/canon.png"]
        );
    }

    fn write_file(path: &std::path::Path, bytes: &[u8]) {
        std::fs::write(path, bytes).unwrap();
    }

    fn write_state(dir: &std::path::Path, state: &Value) {
        std::fs::write(dir.join(".impeccable/questions/k1.state.json"), state.to_string()).unwrap();
    }

    #[test]
    fn comps_expected_only_for_pending_comp_slots_outside_a_code_led_round() {
        let dir = temp_project("expected");
        let cwd = dir.to_string_lossy().into_owned();
        let with = json!({ "options": [{ "id": "a", "comp": "m/a.png" }] });
        let hand = new_hand(&cwd, &with);
        assert!(comps_expected(&with, &cwd, Some(&hand)));
        let comp_led = json!({ "options": [{ "id": "a", "comp": "m/a.png" }], "buildPath": { "value": "comp", "toggle": true } });
        assert!(comps_expected(&comp_led, &cwd, Some(&hand)));
        let code_led = json!({ "options": [{ "id": "a", "comp": "m/a.png" }], "buildPath": { "value": "code", "toggle": true } });
        assert!(!comps_expected(&code_led, &cwd, Some(&hand)));
        let wireframes = json!({ "options": [{ "id": "a", "wireframe": { "cols": 12 } }] });
        assert!(!comps_expected(&wireframes, &cwd, None));
        let urls_only = json!({ "options": [{ "id": "a", "comp": "https://x/a.png" }] });
        assert!(!comps_expected(&urls_only, &cwd, None));
        // The comp round generates before it serves: its comps are on disk when
        // the hand begins and are still its own.
        write_file(&dir.join(".impeccable/mocks/comp-a.png"), b"a");
        write_file(&dir.join(".impeccable/mocks/comp-b.png"), b"b");
        let comp_round = json!({ "options": [{ "id": "a", "comp": ".impeccable/mocks/comp-a.png" }, { "id": "b", "comp": ".impeccable/mocks/comp-b.png" }] });
        let hand = new_hand(&cwd, &comp_round);
        assert!(!comps_expected(&comp_round, &cwd, Some(&hand)));
        // One slot still empty is enough.
        let partial = json!({ "options": [{ "id": "a", "comp": ".impeccable/mocks/comp-a.png" }, { "id": "c", "comp": ".impeccable/mocks/comp-c.png" }] });
        let hand = new_hand(&cwd, &partial);
        assert!(comps_expected(&partial, &cwd, Some(&hand)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn declared_html_reads_options_and_canon_and_leaves_urls_and_repeats_out() {
        let payload = json!({
            "options": [
                { "id": "a", "html": ".impeccable/mocks/decision/a.html" },
                { "id": "b", "html": "https://example.com/b.html" },
                { "id": "c", "html": ".impeccable/mocks/decision/a.html" },
                { "id": "d" }
            ],
            "canonCard": { "html": ".impeccable/mocks/decision/canon.html" }
        });
        assert_eq!(declared_html(&payload), vec![".impeccable/mocks/decision/a.html".to_string(), ".impeccable/mocks/decision/canon.html".to_string()]);
        // A sketch is no comp: it never makes a round owe one.
        assert!(declared_comps(&payload).is_empty());
    }

    #[test]
    fn a_sketch_left_by_an_earlier_hand_is_not_served_until_rewritten() {
        let dir = temp_project("sketch-provenance");
        let cwd = dir.to_string_lossy().into_owned();
        let slot = ".impeccable/mocks/decision/assigned.html";
        let payload = json!({ "options": [{ "id": "assigned", "html": slot }] });
        write_file(&dir.join(slot), b"<p>last round</p>");
        let hand = new_hand(&cwd, &payload);
        assert!(hand.get("pre").and_then(|p| p.get(slot)).is_some());
        assert!(!sketch_is_this_hands(&cwd, slot, Some(&hand)));
        assert_eq!(stale_sketches(&cwd, Some(&hand)), vec![slot.to_string()]);
        // Identical bytes written after the hand began still count: the write
        // time decides where the fingerprint cannot.
        std::thread::sleep(std::time::Duration::from_millis(20));
        write_file(&dir.join(slot), b"<p>last round</p>");
        assert!(sketch_is_this_hands(&cwd, slot, Some(&hand)));
        assert!(stale_sketches(&cwd, Some(&hand)).is_empty());
        // A hand recorded before startedAt existed falls back to the fingerprint.
        let mut old_hand = hand.clone();
        old_hand.remove("startedAt");
        assert!(!sketch_is_this_hands(&cwd, slot, Some(&old_hand)));
        write_file(&dir.join(slot), b"<p>this round</p>");
        assert!(sketch_is_this_hands(&cwd, slot, Some(&old_hand)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_sketch_frame_reads_a_device_screen_and_defaults_to_desktop() {
        assert_eq!(sketch_frame(&json!({})), (1440, 900));
        assert_eq!(sketch_frame(&json!({ "htmlFrame": "390x844" })), (390, 844));
        assert_eq!(sketch_frame(&json!({ "htmlFrame": "390 × 844" })), (390, 844));
        assert_eq!(sketch_frame(&json!({ "htmlFrame": [834, 1194] })), (834, 1194));
        assert_eq!(sketch_frame(&json!({ "htmlFrame": "tiny" })), (1440, 900));
        assert_eq!(sketch_frame(&json!({ "htmlFrame": "10x10" })), (1440, 900));
    }

    #[test]
    fn the_skeleton_pass_lands_before_the_body_closes() {
        let out = with_skeleton("<html><body><p>x</p></BODY></html>");
        assert!(out.starts_with("<html><body><p>x</p><script>"), "{out}");
        assert!(out.ends_with("</script></BODY></html>"), "{out}");
        // A fragment with no body still gets the pass, at the end.
        assert!(with_skeleton("<p>x</p>").starts_with("<p>x</p><script>"));
    }

    #[test]
    fn a_comp_counts_for_the_hand_only_when_its_bytes_changed_since_the_hand_began() {
        let dir = temp_project("provenance");
        let cwd = dir.to_string_lossy().into_owned();
        let slot = ".impeccable/mocks/decision/assigned.webp";
        let payload = json!({ "options": [{ "id": "assigned", "comp": slot }] });
        write_file(&dir.join(slot), b"old");
        let hand = new_hand(&cwd, &payload);
        // Same second, same bytes: the file an earlier round left is stale,
        // whatever its timestamp says.
        assert!(!comp_is_this_hands(&cwd, slot, Some(&hand)));
        assert_eq!(stale_comps(&cwd, &[slot.to_string()], Some(&hand)), vec![slot.to_string()]);
        assert!(comps_expected(&payload, &cwd, Some(&hand)));
        write_file(&dir.join(slot), b"old");
        assert!(!comp_is_this_hands(&cwd, slot, Some(&hand)));
        // New bytes at the slot, even within the same second: this hand's.
        write_file(&dir.join(slot), b"new");
        assert!(comp_is_this_hands(&cwd, slot, Some(&hand)));
        assert!(!comps_expected(&payload, &cwd, Some(&hand)));
        // No file at the slot when the hand began: whatever lands is this hand's.
        let fresh = ".impeccable/mocks/decision/pick.webp";
        let payload2 = json!({ "options": [{ "id": "pick", "comp": fresh }] });
        let hand2 = new_hand(&cwd, &payload2);
        write_file(&dir.join(fresh), b"pick");
        assert!(comp_is_this_hands(&cwd, fresh, Some(&hand2)));
        // No hand recorded falls back to existence.
        write_file(&dir.join(slot), b"old");
        assert!(comp_is_this_hands(&cwd, slot, None));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn start_restarts_the_same_hand_and_starts_a_new_one_otherwise() {
        let dir = temp_project("start-hand");
        let cwd = dir.to_string_lossy().into_owned();
        let qdir = jsp::join(&[&cwd, ".impeccable", "questions"]);
        let slot = ".impeccable/mocks/decision/a.png";
        let hand1 = json!({ "title": "Pick", "options": [{ "id": "a", "comp": slot }] });
        let hand2 = json!({ "title": "Pick again", "options": [{ "id": "a", "comp": slot }] });

        // Fresh start, a file an earlier session left at the slot: NEXT.
        write_file(&dir.join(slot), b"earlier session");
        let fresh = start_hand(&qdir, "k1", &cwd, &hand1, &[]).unwrap();
        assert!(comps_expected(&hand1, &cwd, Some(&fresh)));
        assert_eq!(read_hand(&qdir, "k1").as_ref(), Some(&fresh));

        // The comp lands; the server dies; a restart of the same payload on the
        // same key keeps the recorded fingerprints: no NEXT.
        write_file(&dir.join(slot), b"this hand");
        let restart = start_hand(&qdir, "k1", &cwd, &hand1, &[]).unwrap();
        assert_eq!(restart, fresh);
        assert!(!comps_expected(&hand1, &cwd, Some(&restart)));

        // A different payload on that key is a new hand: the landed file is stale.
        let other = start_hand(&qdir, "k1", &cwd, &hand2, &[]).unwrap();
        assert_ne!(other, fresh);
        assert!(comps_expected(&hand2, &cwd, Some(&other)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reroll_reusing_slots_owes_comps_until_they_land_even_across_a_restart() {
        let dir = temp_project("reroll-hand");
        let cwd = dir.to_string_lossy().into_owned();
        let qdir = jsp::join(&[&cwd, ".impeccable", "questions"]);
        let slot = ".impeccable/mocks/decision/a.png";
        // The first hand's comp landed at the slot the re-roll reuses.
        write_file(&dir.join(slot), b"first hand");
        write_state(&dir, &json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/" }));
        let reroll = json!({ "title": "Round 2", "options": [{ "id": "a", "comp": slot }] });
        std::fs::write(dir.join("reroll.json"), reroll.to_string()).unwrap();
        let (code, out) = run_captured(&dir, &["--update", "--key", "k1", "--payload", "reroll.json"]);
        assert_eq!(code, 0);
        assert!(out.contains("NEXT read "), "{out}");
        let hand = read_hand(&qdir, "k1").unwrap();
        assert_eq!(hand.get("digest").and_then(Value::as_str), Some(hand_digest(&reroll).as_str()));
        assert_eq!(round_comps(Some(&hand), None), vec![slot.to_string()]);

        // The server dies before the new comp lands; a restart of the re-roll
        // payload keeps the re-roll's hand, so the old file still does not count.
        let restart = start_hand(&qdir, "k1", &cwd, &reroll, &[]).unwrap();
        assert_eq!(restart, hand);
        assert!(comps_expected(&reroll, &cwd, Some(&restart)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn server_state_writes_after_update_do_not_lose_the_hand() {
        let dir = temp_project("hand-race");
        let cwd = dir.to_string_lossy().into_owned();
        let qdir = jsp::join(&[&cwd, ".impeccable", "questions"]);
        let slot = ".impeccable/mocks/decision/a.png";
        write_file(&dir.join(slot), b"first hand");
        write_state(&dir, &json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/", "comps": [slot] }));
        std::fs::write(dir.join("reroll.json"), json!({ "options": [{ "id": "a", "comp": slot }] }).to_string()).unwrap();
        // The server read its state just before --update ran ...
        let stale_read = read_state(&qdir, "k1").unwrap();
        let (_, out) = run_captured(&dir, &["--update", "--key", "k1", "--payload", "reroll.json"]);
        assert!(out.contains("NEXT read "), "{out}");
        // ... and writes it back afterwards, as a heartbeat or claim does.
        let mut s = stale_read.clone();
        s.insert("lastBeat".into(), Value::from(now_ms() as i64));
        std::fs::write(state_file(&qdir, "k1"), json_compact(&Value::Object(s.clone()))).unwrap();
        s.insert("claimedAt".into(), Value::from(now_ms() as i64));
        std::fs::write(state_file(&qdir, "k1"), json_compact(&Value::Object(s.clone()))).unwrap();
        // The hand survives: the first hand's file is still named stale.
        assert!(read_hand(&qdir, "k1").is_some());
        let (_, out) = run_captured(&dir, &["--wait", "--key", "k1", "--poll", "0"]);
        let out = out.replace('\\', "/");
        assert!(out.contains("COMP STALE: ") && out.contains(slot), "{out}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn deterministic_regeneration_into_a_reused_slot_counts_via_generated() {
        let dir = temp_project("regen");
        let cwd = dir.to_string_lossy().into_owned();
        let qdir = jsp::join(&[&cwd, ".impeccable", "questions"]);
        let slot = ".impeccable/mocks/decision/a.png";
        let gen = |out: &str| {
            let env = Env::from([("IMPECCABLE_IMAGE_GEN_FAKE".into(), "1".into())]);
            let (mut io, cap) = Io::captured("", dir.clone(), env);
            let args: Vec<String> = ["--prompt", "Same prompt, same bytes.", "--out", out, "--size", "64x40"].iter().map(|s| s.to_string()).collect();
            let code = crate::generate_image::run(&args, &mut io);
            assert_eq!(code, 0, "{}", String::from_utf8_lossy(&cap.stderr.borrow()));
        };
        // The previous hand generated into the slot.
        gen(slot);
        let before = std::fs::read(dir.join(slot)).unwrap();
        write_state(&dir, &json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/" }));
        std::fs::write(dir.join("reroll.json"), json!({ "options": [{ "id": "a", "comp": slot }] }).to_string()).unwrap();
        let (_, out) = run_captured(&dir, &["--update", "--key", "k1", "--payload", "reroll.json"]);
        assert!(out.contains("NEXT read "), "{out}");
        let (_, out) = run_captured(&dir, &["--wait", "--key", "k1", "--poll", "0"]);
        assert!(out.contains("COMP STALE: "), "{out}");
        // The re-roll regenerates the same prompt: identical bytes, still this hand's.
        gen(&format!("./{}", slot));
        assert_eq!(std::fs::read(dir.join(slot)).unwrap(), before);
        let hand = read_hand(&qdir, "k1").unwrap();
        assert_eq!(hand.get("generated"), Some(&json!([slot])));
        assert!(comp_is_this_hands(&cwd, slot, Some(&hand)));
        let (_, out) = run_captured(&dir, &["--wait", "--key", "k1", "--poll", "0"]);
        assert!(!out.contains("COMP STALE"), "{out}");
        // Rewriting the prompt sidecar alone never counts: only generation or new bytes do.
        std::fs::write(dir.join("again.json"), json!({ "title": "3", "options": [{ "id": "a", "comp": slot }] }).to_string()).unwrap();
        run_captured(&dir, &["--update", "--key", "k1", "--payload", "again.json"]);
        std::fs::write(dir.join(format!("{}.json", slot)), r#"{"prompt":"rewritten"}"#).unwrap();
        let hand = read_hand(&qdir, "k1").unwrap();
        assert!(hand.get("generated").is_none());
        assert!(!comp_is_this_hands(&cwd, slot, Some(&hand)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failed_hand_write_fails_start_and_update() {
        let dir = temp_project("hand-fail");
        let qdir = jsp::join(&[&dir.to_string_lossy(), ".impeccable", "questions"]);
        // A directory where the hand file belongs: the rename cannot land, on
        // every platform.
        std::fs::create_dir_all(hand_file(&qdir, "k1")).unwrap();
        std::fs::write(dir.join("p.json"), json!({ "options": [{ "id": "a", "comp": ".impeccable/mocks/decision/a.png" }] }).to_string()).unwrap();
        let err_of = |args: &[&str]| {
            let env = Env::from([("IMPECCABLE_SKILL_DIR".into(), "/skill".into())]);
            let (mut io, cap) = Io::captured("", dir.clone(), env);
            let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
            let code = run(&argv, &mut io);
            let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
            let err = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
            (code, out, err)
        };
        let (code, out, err) = err_of(&["--start", "--no-open", "--key", "k1", "--payload", "p.json"]);
        assert_eq!(code, 1);
        assert!(out.is_empty(), "{out}");
        assert!(err.starts_with("serve-question: could not record the hand (") && err.contains("the page was not served"), "{err}");
        assert!(!std::path::Path::new(&state_file(&qdir, "k1")).exists());

        write_state(&dir, &json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/" }));
        let (code, out, err) = err_of(&["--update", "--key", "k1", "--payload", "p.json"]);
        assert_eq!(code, 1);
        assert!(out.is_empty(), "{out}");
        assert!(err.contains("nothing was delivered"), "{err}");
        assert!(!std::path::Path::new(&next_file(&qdir, "k1")).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A comp-led direction round: the assigned card, the pick, a competitive
    /// and a declined challenger, and the canon card.
    fn direction_round(comps: bool) -> Value {
        let comp = |id: &str| if comps { json!(format!(".impeccable/mocks/decision/{id}.png")) } else { Value::Null };
        let mut p = json!({
            "title": "Choose the visual world",
            "options": [
                { "id": "assigned", "kicker": "THE ROLL", "thesis": "One." },
                { "id": "model-pick", "kicker": "IMPECCABLE’S PICK", "thesis": "Two." },
                { "id": "challenger-a", "verdict": "competitive", "thesis": "Three.", "hero": "https://x/a-hero.webp" },
                { "id": "challenger-b", "verdict": "declined", "thesis": "Four.", "hero": "https://x/b-hero.webp" }
            ],
            "reroll": { "registers": ["safer", "bolder"] },
            "buildPath": { "value": "comp", "toggle": true },
            "canon": true,
            "canonCard": { "label": "The category standard", "thesis": "Five." }
        });
        if comps {
            for (i, id) in ["assigned", "model-pick", "challenger-a"].iter().enumerate() {
                p["options"][i]["comp"] = comp(id);
            }
            p["canonCard"]["comp"] = comp("canon");
        }
        p
    }

    #[test]
    fn missing_direction_comps_names_every_eligible_card_without_one() {
        let bare = direction_round(false);
        assert_eq!(missing_direction_comps(&bare), vec!["assigned", "model-pick", "challenger-a", "canonCard"]);
        // Declared everywhere it is owed: nothing missing; the declined
        // challenger never owes one.
        assert!(missing_direction_comps(&direction_round(true)).is_empty());
        // One card short is enough, and the legacy sketch key counts.
        let mut partial = direction_round(true);
        partial["options"][1].as_object_mut().unwrap().remove("comp");
        partial["options"][2]["sketch"] = partial["options"][2]["comp"].take();
        partial["options"][2].as_object_mut().unwrap().remove("comp");
        assert_eq!(missing_direction_comps(&partial), vec!["model-pick"]);
        let mut no_canon_comp = direction_round(true);
        no_canon_comp["canonCard"].as_object_mut().unwrap().remove("comp");
        assert_eq!(missing_direction_comps(&no_canon_comp), vec!["canonCard"]);
        // A card with no id is named by its index.
        let mut no_id = direction_round(true);
        no_id["options"][0].as_object_mut().unwrap().remove("id");
        no_id["options"][0].as_object_mut().unwrap().remove("comp");
        assert_eq!(missing_direction_comps(&no_id), vec!["options[0]"]);
        // canon: true without a canonCard is a footer action, not a card.
        let mut footer = bare.clone();
        footer.as_object_mut().unwrap().remove("canonCard");
        assert_eq!(missing_direction_comps(&footer), vec!["assigned", "model-pick", "challenger-a"]);
    }

    #[test]
    fn missing_direction_comps_leaves_rounds_that_owe_none_alone() {
        let with = |f: &dyn Fn(&mut Value)| {
            let mut p = direction_round(false);
            f(&mut p);
            missing_direction_comps(&p)
        };
        // Code-led: the slots are a flip reserve.
        assert!(with(&|p| p["buildPath"]["value"] = json!("code")).is_empty());
        // No toggle, or no buildPath at all: no image generation this round.
        assert!(with(&|p| p["buildPath"]["toggle"] = json!(false)).is_empty());
        assert!(with(&|p| { p["buildPath"].as_object_mut().unwrap().remove("toggle"); }).is_empty());
        assert!(with(&|p| { p.as_object_mut().unwrap().remove("buildPath"); }).is_empty());
        // A surface round (no canon exit) and the comp round carry no canon.
        assert!(with(&|p| { p.as_object_mut().unwrap().remove("canon"); p.as_object_mut().unwrap().remove("canonCard"); }).is_empty());
        assert!(with(&|p| { p["canon"] = json!(false); p.as_object_mut().unwrap().remove("canonCard"); }).is_empty());
        // A degraded roll's single text-only card.
        assert!(with(&|p| { p["options"] = json!([{ "id": "assigned", "thesis": "One." }]); }).is_empty());
    }

    #[test]
    fn start_and_update_refuse_a_comp_led_direction_round_without_comps() {
        let dir = temp_project("missing-comps");
        let qdir = jsp::join(&[&dir.to_string_lossy(), ".impeccable", "questions"]);
        std::fs::write(dir.join("p.json"), direction_round(false).to_string()).unwrap();
        let run_err = |args: &[&str]| {
            let env = Env::from([("IMPECCABLE_SKILL_DIR".into(), "/skill".into())]);
            let (mut io, cap) = Io::captured("", dir.clone(), env);
            let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
            let code = run(&argv, &mut io);
            let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
            let err = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
            (code, out, err)
        };
        let (code, out, err) = run_err(&["--start", "--no-open", "--key", "k1", "--payload", "p.json"]);
        assert_eq!(code, 1, "{err}");
        assert!(out.is_empty(), "{out}");
        assert!(err.contains("the page was not served"), "{err}");
        assert!(err.contains("Missing a \"comp\": assigned, model-pick, challenger-a, canonCard."), "{err}");
        assert!(err.contains(".impeccable/mocks/decision/<card id>.png") && err.contains("then rerun --start;"), "{err}");
        // Refused before anything was recorded or spawned.
        assert!(!std::path::Path::new(&hand_file(&qdir, "k1")).exists());
        assert!(!std::path::Path::new(&state_file(&qdir, "k1")).exists());

        // --update refuses the same round with the page left on its hand.
        write_state(&dir, &json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/" }));
        let (code, out, err) = run_err(&["--update", "--key", "k1", "--payload", "p.json"]);
        assert_eq!(code, 1, "{err}");
        assert!(out.is_empty(), "{out}");
        assert!(err.contains("nothing was delivered") && err.contains("then rerun --update on the same key;"), "{err}");
        assert!(!std::path::Path::new(&next_file(&qdir, "k1")).exists());
        assert!(!std::path::Path::new(&hand_file(&qdir, "k1")).exists());

        // With every comp declared, --update delivers and prints NEXT.
        std::fs::write(dir.join("p.json"), direction_round(true).to_string()).unwrap();
        let (code, out, err) = run_err(&["--update", "--key", "k1", "--payload", "p.json"]);
        assert_eq!(code, 0, "{err}");
        assert!(out.contains("next round delivered") && out.contains("NEXT read "), "{out}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A comp-led surface round: three dealt structures as full cards, no
    /// canon, no pick card.
    fn surface_round(comps: bool) -> Value {
        let mut p = json!({
            "title": "Choose the structure",
            "options": [
                { "id": "ledger", "kicker": "THE ROLL", "thesis": "One." },
                { "id": "rail", "thesis": "Two." },
                { "id": "field", "thesis": "Three." }
            ],
            "reroll": true,
            "buildPath": { "value": "comp", "toggle": true }
        });
        if comps {
            for (i, id) in ["ledger", "rail", "field"].iter().enumerate() {
                p["options"][i]["comp"] = json!(format!(".impeccable/mocks/decision/{id}.png"));
            }
        }
        p
    }

    fn write_roll(dir: &std::path::Path, scope: &str, at: f64) {
        std::fs::write(dir.join(".impeccable/questions/roll.json"), json!({ "scope": scope, "key": "k", "reroll": 0, "at": at as u64 }).to_string()).unwrap();
    }

    #[test]
    fn missing_surface_comps_names_dealt_cards_and_leaves_other_rounds_alone() {
        assert_eq!(missing_surface_comps(&surface_round(false)), vec!["ledger", "rail", "field"]);
        assert!(missing_surface_comps(&surface_round(true)).is_empty());
        let with = |f: &dyn Fn(&mut Value)| {
            let mut p = surface_round(false);
            f(&mut p);
            missing_surface_comps(&p)
        };
        // One card short, and a card with no id named by its index.
        assert_eq!(
            with(&|p| {
                *p = surface_round(true);
                p["options"][1].as_object_mut().unwrap().remove("comp");
                p["options"][2].as_object_mut().unwrap().remove("id");
                p["options"][2].as_object_mut().unwrap().remove("comp");
            }),
            vec!["rail", "options[2]"]
        );
        // Code-led, no toggle, no buildPath: nothing owed.
        assert!(with(&|p| p["buildPath"]["value"] = json!("code")).is_empty());
        assert!(with(&|p| p["buildPath"]["toggle"] = json!(false)).is_empty());
        assert!(with(&|p| { p.as_object_mut().unwrap().remove("buildPath"); }).is_empty());
        // A single card owes nothing; a payload with the canon exit is a
        // direction round, which the direction gate owns.
        assert!(with(&|p| { p["options"] = json!([{ "id": "ledger", "thesis": "One." }]); }).is_empty());
        assert!(with(&|p| p["canon"] = json!(true)).is_empty());
    }

    #[test]
    fn surface_gate_applies_only_while_a_fresh_surface_roll_is_pending() {
        let dir = temp_project("surface-roll");
        let qdir = jsp::join(&[&dir.to_string_lossy(), ".impeccable", "questions"]);
        let bare = surface_round(false);
        let gate = |p: &Value| missing_comps(read_roll(&qdir).as_deref(), p);
        let pending = || surface_roll_pending(read_roll(&qdir).as_deref());
        // No roll recorded: the payload cannot be told from the comp round.
        assert_eq!(gate(&bare), None);
        // A fresh surface roll binds the next decision page.
        write_roll(&dir, "surface", now_ms());
        assert_eq!(gate(&bare), Some((CompRound::Surface, vec!["ledger".into(), "rail".into(), "field".into()])));
        assert_eq!(gate(&surface_round(true)), None);
        // A later direction roll replaces it; a stale one has expired.
        write_roll(&dir, "direction", now_ms());
        assert_eq!(gate(&bare), None);
        write_roll(&dir, "surface", now_ms() - ROLL_WINDOW_MS - 1000.0);
        assert_eq!(gate(&bare), None);
        // An unreadable record gates nothing.
        std::fs::write(dir.join(".impeccable/questions/roll.json"), "{not json").unwrap();
        assert_eq!(gate(&bare), None);
        // A direction round is still the direction gate's, roll or not.
        write_roll(&dir, "surface", now_ms());
        assert_eq!(gate(&direction_round(false)).map(|(r, _)| r), Some(CompRound::Direction));
        // Only a decision page (a payload with buildPath) takes the roll.
        let read = read_roll(&qdir);
        take_roll(&qdir, read.as_deref(), &json!({ "options": [{ "id": "a" }, { "id": "b" }] }));
        assert!(pending());
        // A newer roll recorded after this page read the record (another
        // session's) is not this page's to take.
        write_roll(&dir, "surface", now_ms() + 1.0);
        take_roll(&qdir, read.as_deref(), &surface_round(true));
        assert!(pending());
        // The roll the page was gated against is.
        let read = read_roll(&qdir);
        take_roll(&qdir, read.as_deref(), &surface_round(true));
        assert!(!pending());
        // No record read, nothing to take.
        take_roll(&qdir, None, &surface_round(true));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn start_and_update_refuse_a_comp_led_surface_round_after_a_surface_roll() {
        let dir = temp_project("surface-missing-comps");
        let qdir = jsp::join(&[&dir.to_string_lossy(), ".impeccable", "questions"]);
        let roll = dir.join(".impeccable/questions/roll.json");
        // Recorded the way concept-seed records a roll.
        record_roll(&dir.to_string_lossy(), "surface", "seed-1", 0, &[]);
        assert!(surface_roll_pending(read_roll(&qdir).as_deref()));
        std::fs::write(dir.join("p.json"), surface_round(false).to_string()).unwrap();
        let run_err = |args: &[&str]| {
            let env = Env::from([("IMPECCABLE_SKILL_DIR".into(), "/skill".into())]);
            let (mut io, cap) = Io::captured("", dir.clone(), env);
            let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
            let code = run(&argv, &mut io);
            let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
            let err = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
            (code, out, err)
        };
        let (code, out, err) = run_err(&["--start", "--no-open", "--key", "k1", "--payload", "p.json"]);
        assert_eq!(code, 1, "{err}");
        assert!(out.is_empty(), "{out}");
        assert!(err.starts_with("serve-question: this surface round (concept-seed's latest roll here was --scope surface) is comp-led with image generation"), "{err}");
        assert!(err.contains("so every dealt card declares a decision comp; the page was not served."), "{err}");
        assert!(err.contains("Missing a \"comp\": ledger, rail, field."), "{err}");
        assert!(err.contains("\".impeccable/mocks/decision/<card id>.png\", then rerun --start;") && !err.contains("canonCard"), "{err}");
        // Refused before anything was recorded or spawned; the roll stays bound.
        assert!(!std::path::Path::new(&hand_file(&qdir, "k1")).exists());
        assert!(!std::path::Path::new(&state_file(&qdir, "k1")).exists());
        assert!(roll.exists());

        // A surface re-roll delivered by --update is gated the same way.
        write_state(&dir, &json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/" }));
        let (code, out, err) = run_err(&["--update", "--key", "k1", "--payload", "p.json"]);
        assert_eq!(code, 1, "{err}");
        assert!(out.is_empty(), "{out}");
        assert!(err.contains("nothing was delivered") && err.contains("then rerun --update on the same key;"), "{err}");
        assert!(!std::path::Path::new(&next_file(&qdir, "k1")).exists());
        assert!(roll.exists());

        // With every comp declared, --update delivers and takes the roll, so
        // a later page on this project (the comp round) is not gated by it.
        std::fs::write(dir.join("p.json"), surface_round(true).to_string()).unwrap();
        let (code, out, err) = run_err(&["--update", "--key", "k1", "--payload", "p.json"]);
        assert_eq!(code, 0, "{err}");
        assert!(out.contains("next round delivered") && out.contains("NEXT read "), "{out}");
        assert!(!roll.exists());
        std::fs::write(dir.join("p.json"), surface_round(false).to_string()).unwrap();
        let (code, _, err) = run_err(&["--update", "--key", "k1", "--payload", "p.json"]);
        assert_eq!(code, 0, "{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn markers_survive_a_failed_hand_write_and_leave_with_the_question() {
        let dir = temp_project("markers");
        let cwd = dir.to_string_lossy().into_owned();
        let qdir = jsp::join(&[&cwd, ".impeccable", "questions"]);
        let payload = json!({ "options": [{ "id": "a", "comp": ".impeccable/mocks/decision/a.png" }] });
        let live = new_hand(&cwd, &payload);
        write_hand(&qdir, "k1", &live).unwrap();
        std::fs::create_dir_all(dir.join(".impeccable/mocks/decision")).unwrap();
        std::fs::write(dir.join(".impeccable/mocks/decision/a.png"), b"png").unwrap();
        assert_eq!(record_generated(&cwd, ".impeccable/mocks/decision/a.png").unwrap(), vec!["k1".to_string()]);

        // A failed write of the next hand keeps the live hand's marker.
        let hand_path = hand_file(&qdir, "k1");
        std::fs::remove_file(&hand_path).unwrap();
        std::fs::create_dir_all(&hand_path).unwrap();
        assert!(write_hand(&qdir, "k1", &new_hand(&cwd, &payload)).is_err());
        std::fs::remove_dir_all(&hand_path).unwrap();
        write_atomic(&hand_path, &json_compact(&Value::Object(live.clone()))).unwrap();
        assert_eq!(read_hand(&qdir, "k1").unwrap().get("generated"), Some(&json!([".impeccable/mocks/decision/a.png"])));

        // A new hand with the same payload does not inherit the old marker.
        write_hand(&qdir, "k1", &new_hand(&cwd, &payload)).unwrap();
        assert!(read_hand(&qdir, "k1").unwrap().get("generated").is_none());

        // --stop takes the marker folder with the hand file.
        record_generated(&cwd, ".impeccable/mocks/decision/a.png").unwrap();
        write_state(&dir, &json!({ "pid": 0, "port": 1, "url": "http://127.0.0.1:1/" }));
        let _ = run_captured(&dir, &["--stop", "--key", "k1"]);
        assert!(!std::path::Path::new(&hand_file(&qdir, "k1")).exists());
        assert!(!std::path::Path::new(&generated_dir(&qdir, "k1")).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn marker_names_carry_the_hand_tag() {
        let slot = ".impeccable/mocks/decision/a.png";
        let name = marker_name(slot, "abc123");
        assert_eq!(name, format!("{}-abc123.json", hand_digest(&Value::String(slot.into()))));
        assert_eq!(marker_name_tag(&name), Some("abc123"));
        assert_eq!(marker_name_tag(&format!("{}.tmp-42", name)), Some("abc123"));
        // A legacy name carries no tag; neither does a stray file.
        assert_eq!(marker_name_tag(&format!("{}.json", hand_digest(&Value::String(slot.into())))), None);
        assert_eq!(marker_name_tag("notes.txt"), None);
        assert_eq!(marker_name_tag("zzzzzzzzzzzzzzzz-abc.json"), None);
        // An id that could not sit in a file name safely is hashed.
        assert_eq!(marker_tag("0123456789abcdef"), "0123456789abcdef");
        let odd = marker_tag("..\\x/y.json");
        assert_eq!(odd.len(), 16);
        assert!(odd.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(marker_tag(""), hand_digest(&Value::String(String::new())));
        // Ids that differ only in case get distinct, all-lowercase tags, so
        // they never share a path on a case-insensitive file system.
        let (lower, upper) = (marker_tag("abc"), marker_tag("ABC"));
        assert_eq!(lower, "abc");
        assert_ne!(lower.to_lowercase(), upper.to_lowercase());
        assert_eq!(upper, upper.to_lowercase());
    }

    // Issue #886: the prune used to read a marker's owner and then delete the
    // file, so a parallel generate-image for the new hand that replaced a
    // reused slot's marker between the read and the delete lost its marker.
    // Markers now carry the hand in their name: the new hand writes a path the
    // old hand never used, and the prune decides from names alone.
    #[test]
    fn prune_spares_a_parallel_marker_for_the_new_hand_in_a_reused_slot() {
        let dir = temp_project("marker-race");
        let cwd = dir.to_string_lossy().into_owned();
        let qdir = jsp::join(&[&cwd, ".impeccable", "questions"]);
        let slot = ".impeccable/mocks/decision/a.png";
        let payload = json!({ "options": [{ "id": "a", "comp": slot }] });
        std::fs::create_dir_all(dir.join(".impeccable/mocks/decision")).unwrap();
        std::fs::write(dir.join(slot), b"png").unwrap();

        // The old hand generated into the slot.
        let old = new_hand(&cwd, &payload);
        write_hand(&qdir, "k1", &old).unwrap();
        record_generated(&cwd, slot).unwrap();
        let old_marker = jsp::join(&[&generated_dir(&qdir, "k1"), &marker_name(slot, &marker_tag(&hand_marker_id(&old)))]);
        assert!(std::path::Path::new(&old_marker).exists());

        // --update: the new hand file lands, then (before its prune runs) a
        // parallel generate-image regenerates the reused slot for it.
        let mut new = new_hand(&cwd, &payload);
        new.insert("id".into(), json!("feedfacecafebeef"));
        let target = hand_file(&qdir, "k1");
        write_atomic(&target, &json_compact(&Value::Object(new.clone()))).unwrap();
        assert_eq!(record_generated(&cwd, slot).unwrap(), vec!["k1".to_string()]);
        let new_marker = jsp::join(&[&generated_dir(&qdir, "k1"), &marker_name(slot, "feedfacecafebeef")]);
        assert!(!same_path(&old_marker, &new_marker), "one hand's marker must never share a path with another's");
        // The old hand's marker is still there when the prune starts.
        assert!(std::path::Path::new(&old_marker).exists());

        // The prune half of write_hand: it removes the old hand's marker and
        // keeps the new one.
        write_hand(&qdir, "k1", &new).unwrap();
        assert!(!std::path::Path::new(&old_marker).exists());
        assert!(std::path::Path::new(&new_marker).exists());
        assert_eq!(read_hand(&qdir, "k1").unwrap().get("generated"), Some(&json!([slot])));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_untagged_markers_are_judged_by_content() {
        let dir = temp_project("marker-legacy");
        let cwd = dir.to_string_lossy().into_owned();
        let qdir = jsp::join(&[&cwd, ".impeccable", "questions"]);
        let (a, b) = (".impeccable/mocks/decision/a.png", ".impeccable/mocks/decision/b.png");
        let mut hand = new_hand(&cwd, &json!({ "options": [{ "id": "a", "comp": a }, { "id": "b", "comp": b }] }));
        hand.insert("id".into(), json!("0011223344556677"));
        write_hand(&qdir, "k1", &hand).unwrap();
        let gdir = generated_dir(&qdir, "k1");
        std::fs::create_dir_all(&gdir).unwrap();
        let legacy = |slot: &str| jsp::join(&[&gdir, &format!("{}.json", hand_digest(&Value::String(slot.into())))]);
        std::fs::write(legacy(a), json!({ "slot": a, "hand": "0011223344556677" }).to_string()).unwrap();
        std::fs::write(legacy(b), json!({ "slot": b, "hand": "ffffffffffffffff" }).to_string()).unwrap();
        // The legacy marker whose content names this hand counts; the other does not.
        assert_eq!(read_hand(&qdir, "k1").unwrap().get("generated"), Some(&json!([a])));
        // Rewriting the same hand keeps its legacy marker and prunes the other's.
        write_hand(&qdir, "k1", &hand).unwrap();
        assert!(std::path::Path::new(&legacy(a)).exists());
        assert!(!std::path::Path::new(&legacy(b)).exists());
        // A legacy hand file (no id) matches legacy markers on its digest.
        let mut old = hand.clone();
        old.remove("id");
        let digest = old.get("digest").and_then(Value::as_str).unwrap().to_string();
        write_hand(&qdir, "k1", &old).unwrap();
        assert!(!std::path::Path::new(&legacy(a)).exists());
        std::fs::write(legacy(b), json!({ "slot": b, "digest": digest }).to_string()).unwrap();
        assert_eq!(read_hand(&qdir, "k1").unwrap().get("generated"), Some(&json!([b])));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn comp_round_comps_sit_directly_in_mocks() {
        assert!(is_comp_round_comp(".impeccable/mocks/comp-b-open-book.png"));
        assert!(is_comp_round_comp("./.impeccable/mocks/comp-b.png"));
        assert!(is_comp_round_comp("/abs/proj/.impeccable/mocks/comp-b.png"));
        assert!(!is_comp_round_comp(".impeccable/mocks/decision/a.png"));
        assert!(!is_comp_round_comp("https://x/a.png"));
        assert!(!is_comp_round_comp("elsewhere/a.png"));
    }

    fn answer_lines(raw: &str) -> String {
        let (mut io, cap) = Io::captured("", std::env::temp_dir(), Env::new());
        print_answer(&mut io, raw, &[]);
        let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
        out
    }

    #[test]
    fn comp_round_pick_is_the_approved_comp_not_option_one() {
        let out = answer_lines(r#"{"optionId":"b","steer":"","comp":".impeccable/mocks/comp-b-open-book.png"}"#);
        assert!(out.contains("APPROVED COMP: the user picked this composition in the comp round"), "{out}");
        assert!(out.contains("\"approved\": true"), "{out}");
        assert!(!out.contains("CHOSEN COMP") && !out.contains("option one") && !out.contains("two variations"), "{out}");

        let out = answer_lines(r#"{"optionId":"a","steer":"","comp":".impeccable/mocks/decision/a.png"}"#);
        assert!(out.contains("CHOSEN COMP: the decision comp at that path is compositional option one."), "{out}");
        assert!(out.contains("--decision-comp <that path>"), "{out}");
        assert!(!out.contains("APPROVED COMP"), "{out}");
    }

    #[test]
    fn comp_round_pick_of_the_recorded_decision_comp_is_the_approval() {
        let dir = std::env::temp_dir().join(format!("impeccable-sq-decision-{}-{}", std::process::id(), now_ms() as u64));
        std::fs::create_dir_all(dir.join(".impeccable/build")).unwrap();
        let slot = ".impeccable/mocks/decision/a.png";
        let round: Vec<String> = vec![slot.into(), ".impeccable/mocks/comp-2.png".into(), ".impeccable/mocks/comp-3.png".into()];
        let decision_page: Vec<String> = vec![slot.into(), ".impeccable/mocks/decision/b.png".into()];
        let answer = |raw: &str, served: &[String]| {
            let (mut io, cap) = Io::captured("", dir.clone(), Env::new());
            print_answer(&mut io, raw, served);
            let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
            out
        };
        let state = |phase: &str| json!({ "phase": phase, "decisionComp": slot }).to_string();
        std::fs::write(dir.join(".impeccable/build/state.json"), state("comps")).unwrap();
        let out = answer(r#"{"optionId":"one","comp":"./.impeccable/mocks/decision/a.png"}"#, &round);
        assert!(out.contains("APPROVED COMP") && !out.contains("CHOSEN COMP"), "{out}");
        // Served again in the comp round, option one is this hand's comp, never stale.
        std::fs::create_dir_all(dir.join(".impeccable/mocks/decision")).unwrap();
        std::fs::write(dir.join(slot), b"png").unwrap();
        let cwd = dir.to_string_lossy().to_string();
        let options: Vec<Value> = round.iter().map(|c| json!({ "id": c, "comp": c })).collect();
        let hand = new_hand(&cwd, &json!({ "options": options }));
        assert!(comp_is_this_hands(&cwd, slot, Some(&hand)));
        assert!(stale_comps(&cwd, &[slot.to_string()], Some(&hand)).is_empty());
        // Option one is not a decision-round comp: no render-check directive for it.
        std::fs::write(dir.join(format!("{slot}.json")), b"{}").unwrap();
        assert!(!landed_decision_comps(&cwd, &round, Some(&hand)));
        // A new direction round reusing that slot is not the comp round: the old image is stale there.
        let options: Vec<Value> = decision_page.iter().map(|c| json!({ "id": c, "comp": c })).collect();
        let hand = new_hand(&cwd, &json!({ "options": options }));
        assert!(!comp_is_this_hands(&cwd, slot, Some(&hand)));
        assert_eq!(stale_comps(&cwd, &[slot.to_string()], Some(&hand)), vec![slot.to_string()]);
        let out = answer(r#"{"optionId":"one","comp":".impeccable/mocks/decision/a.png"}"#, &decision_page);
        assert!(out.contains("CHOSEN COMP") && !out.contains("APPROVED COMP"), "{out}");
        // Another decision comp, or the same one once the round closed, stays a decision pick.
        let out = answer(r#"{"optionId":"b","comp":".impeccable/mocks/decision/b.png"}"#, &round);
        assert!(out.contains("CHOSEN COMP") && !out.contains("APPROVED COMP"), "{out}");
        std::fs::write(dir.join(".impeccable/build/state.json"), state("spec")).unwrap();
        let out = answer(r#"{"optionId":"one","comp":".impeccable/mocks/decision/a.png"}"#, &round);
        assert!(out.contains("CHOSEN COMP") && !out.contains("APPROVED COMP"), "{out}");
        let _ = std::fs::remove_dir_all(&dir);
    }


    /// A roll record as concept-seed writes it for a roll that dealt worlds.
    fn write_dealt_roll(dir: &std::path::Path, scope: &str, at: f64, worlds: &Value) {
        std::fs::write(dir.join(".impeccable/questions/roll.json"), json!({ "scope": scope, "key": "k", "reroll": 0, "at": at as u64, "worlds": worlds }).to_string()).unwrap();
    }

    fn two_worlds(base: &str) -> Value {
        json!([
            { "id": "print-fillmore-handbill", "board": format!("{base}/cards/print-fillmore-handbill.webp"), "hero": format!("{base}/cards/print-fillmore-handbill-hero.webp") },
            { "id": "broadcast-teletext", "board": format!("{base}/cards/broadcast-teletext.png?v=3"), "hero": format!("{base}/cards/broadcast-teletext-hero.webp") }
        ])
    }

    const NEXT_TODAY: &str = "NEXT read /skill/reference/visualize.md now, before writing any decision comp prompt; it and the MODE RULES block concept-seed printed for this surface govern every card's image. Then generate each declared comp into its slot, lead first, and record the exact prompt in its sidecar, the image's full file name plus .json (a.png gets a.png.json).\n";

    fn run_env(dir: &std::path::Path, extra: &[(&str, &str)], args: &[&str]) -> (i32, String) {
        let mut env = Env::from([("IMPECCABLE_SKILL_DIR".into(), "/skill".into()), ("IMPECCABLE_SELF".into(), "impeccable".into())]);
        for (k, v) in extra {
            env.insert(k.to_string(), v.to_string());
        }
        let (mut io, cap) = Io::captured("", dir.to_path_buf(), env);
        let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        let code = run(&argv, &mut io);
        let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap().replace('\\', "/");
        (code, out)
    }

    /// The NEXT visualize line of `out`, the skill path without the drive
    /// letter Windows resolves `/skill` under.
    fn next_line(out: &str) -> String {
        let Some(line) = out.lines().find(|l| l.starts_with("NEXT read ")) else { return String::new() };
        let rest = &line["NEXT read ".len()..];
        let rest = if rest.as_bytes().get(1) == Some(&b':') { &rest[2..] } else { rest };
        format!("NEXT read {rest}\n")
    }

    /// Answers card image requests until `stop` is set; returns the paths asked for.
    fn card_server(server: tiny_http::Server, stop: std::sync::Arc<std::sync::atomic::AtomicBool>) -> std::thread::JoinHandle<Vec<String>> {
        std::thread::spawn(move || {
            let mut seen = Vec::new();
            while !stop.load(std::sync::atomic::Ordering::SeqCst) {
                let Ok(Some(request)) = server.recv_timeout(std::time::Duration::from_millis(50)) else { continue };
                let path = request.url().to_string();
                seen.push(path.clone());
                if path.contains("missing") {
                    let _ = request.respond(tiny_http::Response::from_string("gone").with_status_code(404));
                } else if path.contains("wall") {
                    // A 200 sign-in page behind an image URL and Content-Type.
                    let _ = request.respond(tiny_http::Response::from_string("<html>sign in</html>").with_header(tiny_http::Header::from_bytes("content-type", "image/webp").unwrap()));
                } else if path.contains("teletext.png") {
                    // A PNG served as webp: the bytes decide.
                    let body = [&b"\x89PNG\r\n\x1a\n"[..], path.as_bytes()].concat();
                    let _ = request.respond(tiny_http::Response::from_data(body).with_header(tiny_http::Header::from_bytes("content-type", "image/webp").unwrap()));
                } else {
                    let body = format!("RIFF\x10\0\0\0WEBPVP8 {path}");
                    let _ = request.respond(tiny_http::Response::from_data(body.into_bytes()).with_header(tiny_http::Header::from_bytes("content-type", "image/webp").unwrap()));
                }
            }
            seen
        })
    }

    #[test]
    fn dealt_worlds_come_from_a_fresh_direction_roll_a_decision_page_takes() {
        let page = direction_round(true);
        let worlds = two_worlds("https://cards.test");
        let roll = |scope: &str, at: f64, worlds: &Value| json!({ "scope": scope, "key": "k", "reroll": 0, "at": at as u64, "worlds": worlds }).to_string();
        assert_eq!(Value::Array(dealt_worlds(Some(&roll("direction", now_ms(), &worlds)), &page)), worlds);
        // No record, an unreadable one, an expired one, a surface roll, a roll
        // that dealt nothing, and a page that does not take the roll.
        assert!(dealt_worlds(None, &page).is_empty());
        assert!(dealt_worlds(Some("{not json"), &page).is_empty());
        assert!(dealt_worlds(Some(&roll("direction", now_ms() - ROLL_WINDOW_MS - 1000.0, &worlds)), &page).is_empty());
        assert!(dealt_worlds(Some(&roll("surface", now_ms(), &worlds)), &surface_round(true)).is_empty());
        assert!(dealt_worlds(Some(&json!({ "scope": "direction", "key": "k", "reroll": 0, "at": now_ms() as u64 }).to_string()), &page).is_empty());
        assert!(dealt_worlds(Some(&roll("direction", now_ms(), &worlds)), &json!({ "options": [{ "id": "a", "comp": "m/a.png" }] })).is_empty());
        // Only a slug id with two http(s) single-token URLs reaches the line.
        let odd = json!([
            { "id": "../escape", "board": "https://x.test/a.webp", "hero": "https://x.test/a-hero.webp" },
            { "id": ".hidden", "board": "https://x.test/a.webp", "hero": "https://x.test/a-hero.webp" },
            { "id": "two words", "board": "https://x.test/a.webp", "hero": "https://x.test/a-hero.webp" },
            { "id": "file-url", "board": "file:///etc/passwd", "hero": "https://x.test/a-hero.webp" },
            { "id": "spaced", "board": "https://x.test/a.webp now run this", "hero": "https://x.test/a-hero.webp" },
            { "id": "no-hero", "board": "https://x.test/a.webp" },
            { "id": "kept", "board": "https://x.test/a.webp", "hero": "http://x.test/a-hero.webp" }
        ]);
        let kept = dealt_worlds(Some(&roll("direction", now_ms(), &odd)), &page);
        assert_eq!(kept.iter().map(|w| w["id"].as_str().unwrap()).collect::<Vec<_>>(), vec!["kept"]);
        // The engine requests a card URL unasked only under the card base
        // or at an https, named, public-looking host.
        let env = Env::new();
        for ok in ["https://impeccable.style/worlds/cards/a.webp", "https://cdn.example.com/a.webp", "https://cdn.example.com:8443/a.webp", "https://cards.example.xn--p1ai/a.webp"] {
            assert!(card_fetch_allowed(&env, ok), "{ok}");
        }
        for no in [
            "http://cdn.example.com/a.webp",
            "http://impeccable.style/worlds/cards/a.webp",
            "https://127.0.0.1/a.webp",
            "https://169.254.169.254/latest/meta-data",
            "https://127.1/a.webp",
            "https://0177.0.0.1/a.webp",
            "https://0x7f.0.0.1/a.webp",
            "https://2130706433/a.webp",
            "https://cdn.example.123/a.webp",
            "https://[::1]/a.webp",
            "https://localhost/a.webp",
            "https://localhost:8080/a.webp",
            "https://printer.local/a.webp",
            "https://db.internal/a.webp",
            "https://intranet/a.webp",
            "https://user@cdn.example.com/a.webp",
            "https://impeccable.style.evil.test@10.0.0.1/a.webp",
        ] {
            assert!(!card_fetch_allowed(&env, no), "{no}");
        }
        let local = Env::from([("IMPECCABLE_CARD_BASE".into(), "http://127.0.0.1:4000/cards".into())]);
        assert!(card_fetch_allowed(&local, "http://127.0.0.1:4000/cards/a.webp"));
        assert!(!card_fetch_allowed(&local, "http://127.0.0.1:4000/cardsx/a.webp") && !card_fetch_allowed(&local, "http://127.0.0.1:4001/cards/a.webp"));
    }

    #[test]
    fn next_line_fetches_and_names_the_dealt_worlds_card_images() {
        let _proxy_lock = crate::http::PROXY_ENV_LOCK.lock().unwrap();
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let base = format!("http://{}", server.server_addr());
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let handle = card_server(server, stop.clone());
        let dir = temp_project("world-cards");
        let qdir = jsp::join(&[&dir.to_string_lossy(), ".impeccable", "questions"]);
        write_state(&dir, &json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/" }));
        std::fs::write(dir.join("p.json"), direction_round(true).to_string()).unwrap();
        let card_base = format!("{base}/cards");
        let update = |extra: &[(&str, &str)]| run_env(&dir, &[extra, &[("IMPECCABLE_CARD_BASE", card_base.as_str())]].concat(), &["--update", "--key", "k1", "--payload", "p.json"]);
        const SENTENCE: &str = " The catalog worlds dealt in this roll have card images, listed at the end of this line: when a card's direction builds on one of these worlds, attach that world's board and hero as reference images to that card's comp (the harness image tool's input images, or `impeccable generate-image --ref <board> --ref <hero>`), as style inspiration only, never to copy layout or content; a card for a direction you invented yourself has no card images and gets none. WORLD CARDS: ";
        const FILES: &str = "print-fillmore-handbill board .impeccable/mocks/worlds/print-fillmore-handbill-board.webp hero .impeccable/mocks/worlds/print-fillmore-handbill-hero.webp | broadcast-teletext board .impeccable/mocks/worlds/broadcast-teletext-board.png hero .impeccable/mocks/worlds/broadcast-teletext-hero.webp\n";

        // Two dealt worlds: four files land in the workspace and the line
        // names them, after the page took the roll (the record is gone).
        write_dealt_roll(&dir, "direction", now_ms(), &two_worlds(&base));
        let (code, out) = update(&[]);
        assert_eq!(code, 0);
        assert_eq!(next_line(&out), format!("{}{}{}", NEXT_TODAY.trim_end(), SENTENCE, FILES));
        assert!(read_roll(&qdir).is_none());
        let card = |name: &str| String::from_utf8_lossy(&std::fs::read(dir.join(".impeccable/mocks/worlds").join(name)).unwrap_or_default()).into_owned();
        assert!(card("print-fillmore-handbill-board.webp").ends_with("/cards/print-fillmore-handbill.webp"));
        assert!(card("broadcast-teletext-board.png").ends_with("/cards/broadcast-teletext.png?v=3"));
        assert!(card("broadcast-teletext-hero.webp").ends_with("/cards/broadcast-teletext-hero.webp"));
        // The hand keeps the worlds, so a --wait flip names them too.
        assert_eq!(Value::Array(hand_worlds(read_hand(&qdir, "k1").as_ref())), two_worlds(&base));

        // The same worlds dealt again: every file is there, nothing is fetched.
        write_dealt_roll(&dir, "direction", now_ms(), &two_worlds(&base));
        let (_, out) = update(&[]);
        assert_eq!(next_line(&out), format!("{}{}{}", NEXT_TODAY.trim_end(), SENTENCE, FILES));
        stop.store(true, std::sync::atomic::Ordering::SeqCst);
        let mut seen = handle.join().unwrap();
        seen.sort();
        assert_eq!(seen, vec!["/cards/broadcast-teletext-hero.webp", "/cards/broadcast-teletext.png?v=3", "/cards/print-fillmore-handbill-hero.webp", "/cards/print-fillmore-handbill.webp"]);

        // An expired record, a surface roll, and no record print today's line.
        write_dealt_roll(&dir, "direction", now_ms() - ROLL_WINDOW_MS - 1000.0, &two_worlds(&base));
        assert_eq!(next_line(&update(&[]).1), NEXT_TODAY);
        std::fs::write(dir.join("s.json"), surface_round(true).to_string()).unwrap();
        write_dealt_roll(&dir, "surface", now_ms(), &two_worlds(&base));
        assert_eq!(next_line(&run_env(&dir, &[("IMPECCABLE_CARD_BASE", card_base.as_str())], &["--update", "--key", "k1", "--payload", "s.json"]).1), NEXT_TODAY);
        assert!(read_roll(&qdir).is_none());
        assert_eq!(next_line(&update(&[]).1), NEXT_TODAY);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_card_that_cannot_be_fetched_is_named_by_url_and_fails_nothing() {
        let _proxy_lock = crate::http::PROXY_ENV_LOCK.lock().unwrap();
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let base = format!("http://{}", server.server_addr());
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let handle = card_server(server, stop.clone());
        let dir = temp_project("world-cards-fail");
        write_state(&dir, &json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/" }));
        std::fs::write(dir.join("p.json"), direction_round(true).to_string()).unwrap();
        // One image 404s, one URL sits outside the card base on a loopback
        // host (never requested), one answers 200 with a sign-in page, an
        // extensionless one is a webp, and one is served.
        let worlds = json!([
            { "id": "a", "board": format!("{base}/cards/a.webp"), "hero": format!("{base}/cards/missing-hero.webp") },
            { "id": "b", "board": format!("{base}/elsewhere/b.webp"), "hero": format!("{base}/cards/b-hero") },
            { "id": "c", "board": format!("{base}/cards/wall.webp"), "hero": format!("{base}/cards/c-hero.webp") }
        ]);
        write_dealt_roll(&dir, "direction", now_ms(), &worlds);
        let card_base = format!("{base}/cards");
        let (code, out) = run_env(&dir, &[("IMPECCABLE_CARD_BASE", card_base.as_str())], &["--update", "--key", "k1", "--payload", "p.json"]);
        assert_eq!(code, 0);
        assert!(out.starts_with("next round delivered; the page reloads itself\n"), "{out}");
        let line = next_line(&out);
        assert!(line.contains("`impeccable generate-image --ref <board> --ref <hero>`; any image listed as a URL could not be fetched, so download it into the workspace first when the tool takes files), as style inspiration only"), "{line}");
        assert!(line.ends_with(&format!("WORLD CARDS: a board .impeccable/mocks/worlds/a-board.webp hero {base}/cards/missing-hero.webp | b board {base}/elsewhere/b.webp hero .impeccable/mocks/worlds/b-hero.webp | c board {base}/cards/wall.webp hero .impeccable/mocks/worlds/c-hero.webp\n")), "{line}");
        // Nothing but the three real images is kept: no page saved as a card.
        let cards = dir.join(".impeccable/mocks/worlds");
        let mut kept: Vec<String> = std::fs::read_dir(&cards).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        kept.sort();
        assert_eq!(kept, vec!["a-board.webp", "b-hero.webp", "c-hero.webp"]);
        stop.store(true, std::sync::atomic::Ordering::SeqCst);
        let seen = handle.join().unwrap();
        assert!(!seen.iter().any(|p| p.contains("elsewhere")), "{seen:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fake_image_mode_fetches_no_card_and_names_what_is_there() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let base = format!("http://{}", server.server_addr());
        let dir = temp_project("world-cards-fake");
        write_state(&dir, &json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/" }));
        std::fs::write(dir.join("p.json"), direction_round(true).to_string()).unwrap();
        // One card image an earlier round already fetched.
        std::fs::create_dir_all(dir.join(".impeccable/mocks/worlds")).unwrap();
        write_file(&dir.join(".impeccable/mocks/worlds/broadcast-teletext-hero.webp"), b"kept");
        write_dealt_roll(&dir, "direction", now_ms(), &two_worlds(&base));
        let (code, out) = run_env(&dir, &[("IMPECCABLE_IMAGE_GEN_FAKE", "1")], &["--update", "--key", "k1", "--payload", "p.json"]);
        assert_eq!(code, 0);
        assert!(next_line(&out).ends_with(&format!("WORLD CARDS: print-fillmore-handbill board {base}/cards/print-fillmore-handbill.webp hero {base}/cards/print-fillmore-handbill-hero.webp | broadcast-teletext board {base}/cards/broadcast-teletext.png?v=3 hero .impeccable/mocks/worlds/broadcast-teletext-hero.webp\n")), "{out}");
        assert!(server.recv_timeout(std::time::Duration::from_millis(300)).unwrap().is_none());
        assert_eq!(std::fs::read(dir.join(".impeccable/mocks/worlds/broadcast-teletext-hero.webp")).unwrap(), b"kept");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_restart_and_a_flip_keep_the_worlds_the_hand_was_dealt() {
        let dir = temp_project("world-cards-hand");
        let cwd = dir.to_string_lossy().into_owned();
        let qdir = jsp::join(&[&cwd, ".impeccable", "questions"]);
        let fake = [("IMPECCABLE_IMAGE_GEN_FAKE", "1")];
        let worlds = two_worlds("https://cards.test");
        let mut code_led = direction_round(true);
        code_led["buildPath"]["value"] = json!("code");
        // --start records the worlds in a new hand; the roll record is then
        // gone, and a restart of the same payload keeps the hand's worlds.
        let dealt = dealt_worlds(Some(&json!({ "scope": "direction", "key": "k", "reroll": 0, "at": now_ms() as u64, "worlds": worlds }).to_string()), &code_led);
        let hand = start_hand(&qdir, "k1", &cwd, &code_led, &dealt).unwrap();
        let restart = start_hand(&qdir, "k1", &cwd, &code_led, &[]).unwrap();
        assert_eq!(restart, hand);
        assert_eq!(Value::Array(hand_worlds(Some(&restart))), worlds);
        // The code-led round flips to comp: its NEXT line names the cards.
        write_state(&dir, &json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/" }));
        std::fs::write(flip_file(&qdir, "k1"), "1").unwrap();
        let (code, out) = run_env(&dir, &fake, &["--wait", "--key", "k1", "--poll", "2"]);
        assert_eq!(code, 0);
        assert!(out.starts_with("BUILD PATH FLIPPED: comp"), "{out}");
        assert!(next_line(&out).ends_with("WORLD CARDS: print-fillmore-handbill board https://cards.test/cards/print-fillmore-handbill.webp hero https://cards.test/cards/print-fillmore-handbill-hero.webp | broadcast-teletext board https://cards.test/cards/broadcast-teletext.png?v=3 hero https://cards.test/cards/broadcast-teletext-hero.webp\n"), "{out}");
        // A hand dealt no world records no `worlds` key.
        assert!(new_hand(&cwd, &code_led).get("worlds").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn visualize_next_line_names_the_skill_reference() {
        let env = Env::from([("IMPECCABLE_SKILL_DIR".into(), "/skill".into())]);
        let line = visualize_next_line(&env, "/proj", None).replace('\\', "/");
        assert!(line.starts_with("NEXT read /skill/reference/visualize.md now, before writing any decision comp prompt; it and the MODE RULES block concept-seed printed for this surface govern every card's image."), "{line}");
        assert!(line.ends_with("the image's full file name plus .json (a.png gets a.png.json).\n"));
    }

    #[test]
    fn wait_names_landed_comps_without_a_prompt_sidecar() {
        let dir = temp_project("wait-sidecar");
        let comps = [".impeccable/mocks/decision/a.png", ".impeccable/mocks/decision/b.png", ".impeccable/mocks/decision/c.png"];
        let state = json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/", "comps": comps });
        std::fs::write(dir.join(".impeccable/questions/k1.state.json"), state.to_string()).unwrap();
        // a landed without a sidecar, b landed with one, c has not landed yet.
        std::fs::write(dir.join(comps[0]), b"png").unwrap();
        std::fs::write(dir.join(comps[1]), b"png").unwrap();
        std::fs::write(dir.join(format!("{}.json", comps[1])), r#"{"prompt":"p"}"#).unwrap();

        let (code, out) = run_captured(&dir, &["--wait", "--key", "k1", "--poll", "0"]);
        let out = out.replace('\\', "/");
        assert_eq!(code, 3);
        assert!(out.starts_with("WAITING: "), "{out}");
        assert!(out.contains("COMP SIDECAR MISSING: .impeccable/mocks/decision/a.png landed with no prompt sidecar."), "{out}");
        assert!(out.contains("/skill/reference/visualize.md"), "{out}");
        assert!(!out.contains("decision/b.png") && !out.contains("decision/c.png"), "{out}");

        std::fs::write(dir.join(".impeccable/questions/k1.answer.json"), r#"{"optionId":"a","comp":".impeccable/mocks/decision/a.png"}"#).unwrap();
        let (code, out) = run_captured(&dir, &["--wait", "--key", "k1", "--poll", "2"]);
        let out = out.replace('\\', "/");
        assert_eq!(code, 0);
        let answer_at = out.find("ANSWER: ").unwrap();
        let missing_at = out.find("COMP SIDECAR MISSING: .impeccable/mocks/decision/a.png").unwrap();
        assert!(answer_at < missing_at, "{out}");

        // Once every landed comp has its sidecar, the backstop stays quiet.
        std::fs::write(dir.join(format!("{}.json", comps[0])), r#"{"prompt":"p"}"#).unwrap();
        std::fs::write(dir.join(".impeccable/questions/k1.state.json"), state.to_string()).unwrap();
        let (_, out) = run_captured(&dir, &["--wait", "--key", "k1", "--poll", "0"]);
        assert!(!out.contains("COMP SIDECAR MISSING"), "{out}");

        // A file an earlier round left at a slot is named stale while the user
        // decides, never as a missing sidecar, and not after the pick.
        std::fs::remove_file(dir.join(format!("{}.json", comps[0]))).unwrap();
        let qdir = jsp::join(&[&dir.to_string_lossy(), ".impeccable", "questions"]);
        let payload = json!({ "options": comps.iter().map(|c| json!({ "comp": c })).collect::<Vec<_>>() });
        write_hand(&qdir, "k1", &new_hand(&dir.to_string_lossy(), &payload)).unwrap();
        std::fs::remove_file(dir.join(format!("{}.json", comps[1]))).unwrap();
        std::fs::remove_file(dir.join(comps[1])).unwrap();
        let (_, out) = run_captured(&dir, &["--wait", "--key", "k1", "--poll", "0"]);
        let out = out.replace('\\', "/");
        assert!(!out.contains("COMP SIDECAR MISSING"), "{out}");
        assert!(out.contains("COMP STALE: files left from an earlier round sit at this hand's slots, and the page is showing them: .impeccable/mocks/decision/a.png."), "{out}");
        std::fs::write(dir.join(".impeccable/questions/k1.answer.json"), r#"{"optionId":"a"}"#).unwrap();
        let (_, out) = run_captured(&dir, &["--wait", "--key", "k1", "--poll", "2"]);
        assert!(!out.contains("COMP STALE") && !out.contains("COMP SIDECAR MISSING"), "{out}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn wait_prints_the_render_check_once_per_hand() {
        const LINE: &str = "NEXT open each decision comp once and run ";
        let dir = temp_project("wait-render-check");
        let cwd = dir.to_string_lossy().into_owned();
        let qdir = jsp::join(&[&cwd, ".impeccable", "questions"]);
        let comps = [".impeccable/mocks/decision/a.png", ".impeccable/mocks/decision/b.png"];
        let payload = json!({ "options": comps.iter().map(|c| json!({ "comp": c })).collect::<Vec<_>>() });
        let state = json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/", "comps": comps });
        std::fs::write(dir.join(".impeccable/questions/k1.state.json"), state.to_string()).unwrap();
        write_hand(&qdir, "k1", &new_hand(&cwd, &payload)).unwrap();
        let wait = || {
            let (code, out) = run_captured(&dir, &["--wait", "--key", "k1", "--poll", "0"]);
            assert_eq!(code, 3);
            out.replace('\\', "/")
        };

        // Nothing landed yet: no line.
        assert!(!wait().contains(LINE));
        // A comp landed without its sidecar is not ready to be checked.
        std::fs::write(dir.join(comps[0]), b"png").unwrap();
        assert!(!wait().contains(LINE));

        // The first wait after a comp lands with its sidecar prints it once.
        std::fs::write(dir.join(format!("{}.json", comps[0])), r#"{"prompt":"p"}"#).unwrap();
        let out = wait();
        // Windows resolves the skill dir with a drive letter, so match from the path on.
        assert!(out.contains("/skill/reference/visualize.md's render checks (shipped screen, one dominant move); regenerate any that fail before the user answers.\n"), "{out}");
        assert_eq!(out.matches(LINE).count(), 1, "{out}");
        // Later polls of the same hand stay quiet, even as more comps land.
        assert!(!wait().contains(LINE));
        std::fs::write(dir.join(comps[1]), b"png").unwrap();
        std::fs::write(dir.join(format!("{}.json", comps[1])), r#"{"prompt":"p"}"#).unwrap();
        assert!(!wait().contains(LINE));

        // A new hand (an --update round) prints it again once its comps land.
        std::fs::remove_file(dir.join(comps[0])).unwrap();
        std::fs::remove_file(dir.join(comps[1])).unwrap();
        write_hand(&qdir, "k1", &new_hand(&cwd, &payload)).unwrap();
        assert!(!wait().contains(LINE));
        std::fs::write(dir.join(comps[0]), b"png2").unwrap();
        assert!(wait().contains(LINE));
        assert!(!wait().contains(LINE));

        // Never after the pick: the answer is the user's, not a poll.
        write_hand(&qdir, "k1", &new_hand(&cwd, &payload)).unwrap();
        std::fs::write(dir.join(comps[0]), b"png3").unwrap();
        std::fs::write(dir.join(".impeccable/questions/k1.answer.json"), r#"{"optionId":"a"}"#).unwrap();
        let (code, out) = run_captured(&dir, &["--wait", "--key", "k1", "--poll", "2"]);
        assert_eq!(code, 0);
        assert!(!out.contains(LINE), "{out}");
        assert!(!dir.join(".impeccable/questions/k1.render-check").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn wait_skips_the_render_check_for_code_led_and_comp_round_comps() {
        const LINE: &str = "NEXT open each decision comp once and run ";
        let dir = temp_project("wait-render-check-skip");
        let cwd = dir.to_string_lossy().into_owned();
        let qdir = jsp::join(&[&cwd, ".impeccable", "questions"]);
        // Code-led: the slots are a flip reserve. A file there predates the
        // hand (an earlier round's), so it is not this hand's comp.
        let slot = ".impeccable/mocks/decision/a.png";
        std::fs::write(dir.join(slot), b"old").unwrap();
        std::fs::write(dir.join(format!("{}.json", slot)), r#"{"prompt":"p"}"#).unwrap();
        let payload = json!({ "options": [{ "comp": slot }], "buildPath": { "value": "code", "toggle": true } });
        let state = json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/", "comps": [slot] });
        std::fs::write(dir.join(".impeccable/questions/k1.state.json"), state.to_string()).unwrap();
        write_hand(&qdir, "k1", &new_hand(&cwd, &payload)).unwrap();
        let (_, out) = run_captured(&dir, &["--wait", "--key", "k1", "--poll", "0"]);
        assert!(!out.contains(LINE), "{out}");

        // The comp round's own comps are not decision comps.
        let comp = ".impeccable/mocks/comp-b.png";
        std::fs::write(dir.join(comp), b"png").unwrap();
        std::fs::write(dir.join(format!("{}.json", comp)), r#"{"prompt":"p"}"#).unwrap();
        let state = json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/", "comps": [comp] });
        std::fs::write(dir.join(".impeccable/questions/k2.state.json"), state.to_string()).unwrap();
        write_hand(&qdir, "k2", &new_hand(&cwd, &json!({ "options": [{ "comp": comp }] }))).unwrap();
        let (_, out) = run_captured(&dir, &["--wait", "--key", "k2", "--poll", "0"]);
        assert!(!out.contains(LINE), "{out}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn update_prints_the_visualize_directive_only_when_comps_are_due() {
        let dir = temp_project("update-next");
        let state = json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/" });
        std::fs::write(dir.join(".impeccable/questions/k1.state.json"), state.to_string()).unwrap();
        std::fs::write(dir.join("comp.json"), json!({ "options": [{ "id": "a", "comp": ".impeccable/mocks/decision/a.png" }] }).to_string()).unwrap();
        let (code, out) = run_captured(&dir, &["--update", "--key", "k1", "--payload", "comp.json"]);
        let out = out.replace('\\', "/");
        assert_eq!(code, 0);
        assert_eq!(out.lines().next(), Some("next round delivered; the page reloads itself"));
        let next = out.lines().nth(1).unwrap();
        assert!(next.starts_with("NEXT read ") && next.contains("/skill/reference/visualize.md now"), "{out}");

        std::fs::write(dir.join("code.json"), json!({ "options": [{ "id": "a", "comp": ".impeccable/mocks/decision/a.png" }], "buildPath": { "value": "code", "toggle": true } }).to_string()).unwrap();
        let (_, out) = run_captured(&dir, &["--update", "--key", "k1", "--payload", "code.json"]);
        assert!(!out.contains("NEXT"), "{out}");

        // A re-roll into the same decision slot still owes a new comp.
        write_file(&dir.join(".impeccable/mocks/decision/a.png"), b"earlier");
        let (_, out) = run_captured(&dir, &["--update", "--key", "k1", "--payload", "comp.json"]);
        assert!(out.contains("NEXT read "), "{out}");

        // A comp round serves comps already on disk directly in mocks/: no NEXT line.
        write_file(&dir.join(".impeccable/mocks/comp-a.png"), b"comp");
        std::fs::write(dir.join("round.json"), json!({ "options": [{ "id": "a", "comp": ".impeccable/mocks/comp-a.png" }] }).to_string()).unwrap();
        let (_, out) = run_captured(&dir, &["--update", "--key", "k1", "--payload", "round.json"]);
        assert_eq!(out, "next round delivered; the page reloads itself\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn flip_to_comp_puts_visualize_in_front_of_the_comps() {
        let dir = temp_project("flip-next");
        let state = json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/" });
        std::fs::write(dir.join(".impeccable/questions/k1.state.json"), state.to_string()).unwrap();
        std::fs::write(dir.join(".impeccable/questions/k1.flip.json"), r#"{"buildPath":"comp"}"#).unwrap();
        let (code, out) = run_captured(&dir, &["--wait", "--key", "k1", "--poll", "2"]);
        let out = out.replace('\\', "/");
        assert_eq!(code, 0);
        let lines: Vec<&str> = out.lines().collect();
        assert!(lines[0].starts_with("BUILD PATH FLIPPED: comp"), "{out}");
        assert!(lines[1].starts_with("NEXT read ") && lines[1].contains("/skill/reference/visualize.md now"), "{out}");

        // A flip whose recorded comps all landed owes no new prompt.
        std::fs::write(dir.join(".impeccable/mocks/decision/a.png"), b"png").unwrap();
        let state = json!({ "pid": std::process::id(), "port": 1, "url": "http://127.0.0.1:1/", "comps": [".impeccable/mocks/decision/a.png"] });
        std::fs::write(dir.join(".impeccable/questions/k1.state.json"), state.to_string()).unwrap();
        std::fs::write(dir.join(".impeccable/questions/k1.flip.json"), r#"{"buildPath":"comp"}"#).unwrap();
        let (_, out) = run_captured(&dir, &["--wait", "--key", "k1", "--poll", "2"]);
        assert!(out.starts_with("BUILD PATH FLIPPED: comp") && !out.contains("NEXT"), "{out}");

        // The file that sat at the slot when the hand began is not this hand's
        // comp: still owed.
        let qdir = jsp::join(&[&dir.to_string_lossy(), ".impeccable", "questions"]);
        let payload = json!({ "options": [{ "id": "a", "comp": ".impeccable/mocks/decision/a.png" }] });
        write_hand(&qdir, "k1", &new_hand(&dir.to_string_lossy(), &payload)).unwrap();
        std::fs::write(dir.join(".impeccable/questions/k1.flip.json"), r#"{"buildPath":"comp"}"#).unwrap();
        let (_, out) = run_captured(&dir, &["--wait", "--key", "k1", "--poll", "2"]);
        assert!(out.contains("\nNEXT read "), "{out}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // JS scenarios: tests/serve-question.test.mjs (public repo main,
    // eaaecbd1 + 2e075dc5 + 7982002d).

    #[test]
    fn allowed_host_exact_match_only() {
        assert!(allowed_host(Some("127.0.0.1:4321"), 4321));
        assert!(allowed_host(Some("localhost:4321"), 4321));
        assert!(!allowed_host(Some("evil.example:4321"), 4321));
        assert!(!allowed_host(Some("127.0.0.1:4322"), 4321));
        assert!(!allowed_host(None, 4321));
        // Bare loopback only passes on port 80, where browsers omit the suffix.
        assert!(!allowed_host(Some("127.0.0.1"), 4321));
        assert!(!allowed_host(Some("localhost"), 4321));
        assert!(allowed_host(Some("127.0.0.1"), 80));
        assert!(allowed_host(Some("localhost"), 80));
        assert!(allowed_host(Some("127.0.0.1:80"), 80));
        assert!(!allowed_host(Some("evil.example"), 80));
    }

    #[test]
    fn allowed_origin_exact_match_only() {
        assert!(allowed_origin("http://127.0.0.1:4321", 4321));
        assert!(allowed_origin("http://localhost:4321", 4321));
        assert!(!allowed_origin("https://evil.example", 4321));
        assert!(!allowed_origin("http://127.0.0.1", 4321));
        assert!(allowed_origin("http://127.0.0.1", 80));
        assert!(allowed_origin("http://localhost", 80));
        assert!(!allowed_origin("https://127.0.0.1", 80));
    }

    #[test]
    fn reject_detached_post_requires_key_then_origin() {
        // No detached key: no key check, origin still gated.
        assert_eq!(reject_detached_post(None, None, "", 4321), None);
        assert_eq!(reject_detached_post(None, Some("https://evil.example"), "", 4321), Some(403));
        // Detached: missing or wrong key is 401 before any origin look.
        assert_eq!(reject_detached_post(Some("seckey"), None, "", 4321), Some(401));
        assert_eq!(reject_detached_post(Some("seckey"), None, "key=wrong", 4321), Some(401));
        assert_eq!(reject_detached_post(Some("seckey"), Some("https://evil.example"), "", 4321), Some(401));
        // Right key, bad origin: 403.
        assert_eq!(reject_detached_post(Some("seckey"), Some("https://evil.example"), "key=seckey", 4321), Some(403));
        // Right key, no or loopback origin: allowed.
        assert_eq!(reject_detached_post(Some("seckey"), None, "key=seckey", 4321), None);
        assert_eq!(reject_detached_post(Some("seckey"), Some("http://127.0.0.1:4321"), "key=seckey", 4321), None);
        // Percent-encoded keys decode the way URLSearchParams does.
        assert_eq!(reject_detached_post(Some("a b"), None, "key=a%20b", 4321), None);
        assert_eq!(reject_detached_post(Some("a b"), None, "key=a+b", 4321), None);
    }

    #[test]
    fn parse_request_url_matches_new_url_semantics() {
        assert_eq!(parse_request_url("/"), Some(("/".into(), String::new())));
        assert_eq!(parse_request_url("/answer"), Some(("/answer".into(), String::new())));
        assert_eq!(parse_request_url("/answer?key=tk"), Some(("/answer".into(), "key=tk".into())));
        assert_eq!(parse_request_url("/img/3"), Some(("/img/3".into(), String::new())));
        assert_eq!(parse_request_url("/img/3?x=1"), Some(("/img/3".into(), "x=1".into())));
        // Protocol-relative target with an empty host: the URL ctor throws -> 400.
        assert_eq!(parse_request_url("//"), None);
        assert_eq!(parse_request_url("//evil host/x"), None);
        // Dot segments normalize like the URL parser.
        assert_eq!(parse_request_url("/x/../answer"), Some(("/answer".into(), String::new())));
    }
}
