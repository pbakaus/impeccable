//! JS: concept-seed.mjs -> `impeccable concept-seed`

use crate::catalog::*;
use crate::context::load_context;
use crate::jsp;
use crate::roll_selection::*;
use crate::seed_text as t;
use crate::target_args::TargetOptions;
use crate::telemetry;
use crate::util::Env;
use impeccable_common::Io;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};

fn fill(tpl: &str, pairs: &[(&str, &str)]) -> String {
    let mut s = tpl.to_string();
    for (k, v) in pairs {
        s = s.replace(&format!("@@{}@@", k), v);
    }
    s
}

/// The mode file that carries a seed mode's rules: experience shares persuade's.
pub fn mode_rules_file(mode: &str) -> &'static str {
    match mode {
        "operate" => "mode-operate",
        "read" => "mode-read",
        _ => "mode-persuade",
    }
}

/// A level-2 section's body, verbatim: every line after `## <name>` up to the
/// next `## ` heading or EOF, trimmed of leading and trailing blank lines.
/// `None` when the heading is absent or the body is empty. CRLF tolerant.
pub fn extract_section(text: &str, name: &str) -> Option<String> {
    let text = text.replace("\r\n", "\n");
    let heading = format!("## {}", name);
    let mut lines = text.split('\n');
    lines.by_ref().find(|l| l.trim_end() == heading)?;
    let body: Vec<&str> = lines.take_while(|l| !l.starts_with("## ")).collect();
    let start = body.iter().position(|l| !l.trim().is_empty())?;
    let end = body.iter().rposition(|l| !l.trim().is_empty())?;
    Some(body[start..=end].join("\n"))
}

/// Whether a surface of this mode builds in code by default. Image comps of
/// working screens and documents rate below their code-led builds, so those
/// modes are code-led whatever build path the project recorded.
pub fn code_led_mode(mode: &str) -> bool {
    matches!(mode, "operate" | "read")
}

/// The MODE RULES block for `mode`, or the one-line fallback naming the file
/// when it cannot be read or lacks a section. Never fails the roll.
pub fn mode_rules_block(env: &Env, cwd: &str, mode: &str) -> String {
    let file = mode_rules_file(mode);
    let path = crate::provider::detect(env, cwd).reference_path(file);
    let shown = path.clone().unwrap_or_else(|| format!("reference/{}.md", file));
    let sections = path
        .as_deref()
        .and_then(crate::util::safe_read)
        .and_then(|text| Some((extract_section(&text, "Directions")?, extract_section(&text, "Comps")?)));
    match sections {
        Some((directions, comps)) => fill(t::MODE_RULES_BLOCK, &[("MODE", mode), ("PATH", &shown), ("DIRECTIONS", &directions), ("COMPS", &comps)]),
        None => fill(t::MODE_RULES_UNAVAILABLE, &[("PATH", &shown)]),
    }
}

/// The PRESENTATION block printed after every roll: new-work.md's decision
/// round, condensed. `build_path` is the recorded default and its file.
pub fn presentation_block(env: &Env, cwd: &str, scope: &str, reroll: usize, degraded: bool, register: Option<&str>, mode: Option<&str>, build_path: Option<&(String, String)>) -> String {
    let sq = crate::provider::detect(env, cwd).verb_cmd("serve-question");
    let present = fill(if reroll > 0 { t::PRESENT_REROLL } else { t::PRESENT_FIRST }, &[("SQ", &sq)]);
    // Operate and Read surfaces build in code whatever the project records;
    // the recorded default governs Persuade and Experience.
    let mode_code = mode.filter(|m| code_led_mode(m));
    let code_led = mode_code.is_some() || build_path.map(|(v, _)| v == "code").unwrap_or(false);
    // A degraded roll is one text-only card, except the safer register,
    // whose lineup of grounded candidates plus canon is a full hand.
    let single_card = degraded && register != Some("safer");
    let comps = match (scope, single_card, code_led) {
        ("direction", true, _) => t::COMPS_DIRECTION_DEGRADED,
        ("direction", false, true) => t::COMPS_DIRECTION_CODE,
        ("direction", false, false) => t::COMPS_DIRECTION,
        (_, _, true) => t::COMPS_SURFACE_CODE,
        _ => t::COMPS_SURFACE,
    };
    let build = match (mode_code, build_path) {
        (Some(m), recorded) => {
            let recorded = match recorded {
                Some((value, source)) if value != "code" => format!(" (the recorded default {} from {} governs Persuade and Experience surfaces)", value, source),
                _ => String::new(),
            };
            fill(t::BUILD_PATH_MODE, &[("MODE", m), ("RECORDED", &recorded)])
        }
        (None, Some((value, source))) => fill(t::BUILD_PATH_RECORDED, &[("VALUE", value), ("SOURCE", source)]),
        (None, None) => t::BUILD_PATH_NONE.to_string(),
    };
    // Comps generated up front come before the wait. A code-led round's comps
    // wait for the flip --wait reports, but its sketches are written right
    // after serving, before the wait; a single text card has neither.
    let when = if scope == "direction" && single_card { t::WAIT_NOW } else if code_led { t::WAIT_AFTER_SKETCHES } else { t::WAIT_AFTER_COMPS };
    let wait = fill(t::PRESENT_WAIT, &[("SQ", &sq), ("WHEN", when)]);
    [t::PRESENTATION_HEADER, &present, comps, &wait, &build, t::PRESENT_FALLBACK].join("\n") + "\n"
}

struct ApiBudget {
    deadline: Option<Instant>,
    timeout: Duration,
}

impl ApiBudget {
    fn new(env: &Env) -> ApiBudget {
        ApiBudget { deadline: None, timeout: telemetry::api_timeout(env) }
    }
    fn remaining(&mut self) -> Duration {
        let d = *self.deadline.get_or_insert_with(|| Instant::now() + self.timeout);
        d.saturating_duration_since(Instant::now())
    }
}

fn api_base(env: &Env) -> String {
    telemetry::api_base(env)
}

pub(crate) fn card_base(env: &Env) -> String {
    env.get("IMPECCABLE_CARD_BASE").filter(|v| !v.is_empty()).cloned().unwrap_or_else(|| "https://impeccable.style/worlds/cards".to_string())
}

/// URLSearchParams serialization (application/x-www-form-urlencoded).
fn form_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn fetch_roll(env: &Env, cwd: &str, budget: &mut ApiBudget, scope: &str, key: &str, mode: Option<&str>, grain: Option<&str>, platform: Option<&str>, reroll: usize, settled: bool) -> Option<Value> {
    let mut params = vec![("scope", scope.to_string()), ("key", key.to_string()), ("reroll", reroll.to_string())];
    if let Some(m) = mode {
        params.push(("mode", m.to_string()));
    }
    if let Some(g) = grain {
        params.push(("grain", g.to_string()));
    }
    if let Some(p) = platform {
        params.push(("platform", p.to_string()));
    }
    let qs: Vec<String> = params.iter().map(|(k, v)| format!("{}={}", form_encode(k), form_encode(v))).collect();
    let url = format!("{}/roll?{}", api_base(env), qs.join("&"));
    let remaining = budget.remaining();
    if remaining.is_zero() {
        return None;
    }
    let mut req = telemetry::agent(&url, remaining).get(&url).set(telemetry::CLIENT_HEADER, &telemetry::client_header(env, cwd));
    // Opted out: the roll is still the feature, so it is requested, and the
    // server is told to record nothing for it.
    if telemetry::telemetry_disabled(env, cwd) {
        req = req.set(telemetry::TELEMETRY_HEADER, "off");
    }
    let res = req.call().ok()?;
    if res.status() < 200 || res.status() >= 300 {
        return None;
    }
    let text = res.into_string().ok()?;
    let roll: Value = serde_json::from_str(&text).ok()?;
    if !settled && roll.get("challengers")?.as_array()?.is_empty() {
        return None;
    }
    Some(roll)
}

/// The agent-run choice ping's arguments, as the `--kind` command passed them.
struct PingArgs<'a> {
    chosen_id: Option<&'a str>,
    key: Option<&'a str>,
    scope: Option<&'a str>,
    mode: Option<&'a str>,
    kind: Option<&'a str>,
    register: Option<&'a str>,
    /// `--reroll <n>` when it was a valid round (0 to 8).
    reroll: Option<usize>,
    /// `--option <n>` when it was a valid card position (0 to 15): the chosen
    /// card's zero-based position, for a card with no ping kind.
    option: Option<usize>,
}

enum PingOutcome {
    Sent,
    Skipped,
    AlreadyRecorded,
}

/// JS: pingChosen. When the seed ledger holds the round for `--from <key>`
/// (the `--reroll` round, else the latest), that record fills `reroll` and
/// `poolRevision`, a `chosenId` outside the round's dealt catalog ids is
/// dropped (the kind still goes), and a round whose choice was already sent
/// (by the decision page or an earlier ping) sends nothing. With no record
/// the arguments go as given.
fn ping_chosen(env: &Env, cwd: &str, budget: &mut ApiBudget, a: &PingArgs) -> PingOutcome {
    if telemetry::telemetry_disabled(env, cwd) {
        return PingOutcome::Skipped;
    }
    let mut chosen_id = a.chosen_id.filter(|s| !s.is_empty());
    let kind = a.kind.filter(|s| !s.is_empty());
    let register = a.register.filter(|s| !s.is_empty());
    if let Some(k) = kind {
        if !telemetry::KINDS.contains(&k) {
            return PingOutcome::Skipped;
        }
    }
    if let Some(r) = register {
        if r != "safer" && r != "bolder" {
            return PingOutcome::Skipped;
        }
    }
    // A rejected hand names no card.
    if kind == Some("reroll") {
        chosen_id = None;
    }
    if chosen_id.is_none() && kind.is_none() && a.option.is_none() {
        return PingOutcome::Skipped;
    }
    if kind == Some("challenger") && chosen_id.is_none() {
        return PingOutcome::Skipped;
    }
    let ledger = telemetry::Ledger::new(env, cwd);
    let key = a.key.filter(|k| !k.is_empty());
    let mut round = key.and_then(|k| ledger.round(k, a.reroll));
    // The page may be sending this round right now. Wait for it, bounded by
    // the page's own budget: a confirmed send makes this rerun a no-op; a
    // failed one, or one still pending past the deadline, is sent from here
    // under the same pingId, so the server can drop a double rather than
    // the report be lost.
    let pending = round.as_ref().filter(|r| r.recorded.as_deref() == Some("pending")).map(|r| (r.reroll, r.pending_at.unwrap_or(0.0)));
    if let (Some(k), Some((n, since))) = (key, pending) {
        {
            let deadline = since + telemetry::api_timeout(env).as_millis() as f64 + 1_000.0;
            while crate::util::now_ms() < deadline {
                std::thread::sleep(Duration::from_millis(100));
                round = ledger.round(k, Some(n));
                if round.as_ref().is_none_or(|x| x.recorded.as_deref() != Some("pending")) {
                    break;
                }
            }
        }
    }
    if let Some(r) = &round {
        if r.confirmed() {
            return PingOutcome::AlreadyRecorded;
        }
        if chosen_id.is_some_and(|c| !r.dealt.iter().any(|d| d == c)) {
            // Not a catalog id from this round's hand: a grounded direction's
            // name never leaves the machine. Without a kind there is nothing left.
            chosen_id = None;
            if kind.is_none() && a.option.is_none() {
                return PingOutcome::Skipped;
            }
        }
    }
    let ping = telemetry::ChoicePing {
        chosen_id: chosen_id.map(str::to_string),
        key: a.key.map(str::to_string),
        scope: a.scope.map(str::to_string),
        mode: a.mode.map(str::to_string),
        kind: kind.map(str::to_string),
        register: register.map(str::to_string),
        option: a.option,
        reroll: Some(round.as_ref().map(|r| r.reroll).or(a.reroll).unwrap_or(0)),
        pool_revision: round.as_ref().and_then(|r| r.pool_revision.clone()),
        hand_id: round.as_ref().and_then(|r| r.hand_id.clone()),
        ping_id: round.as_ref().and_then(|r| r.ping_id.clone()),
        kind_source: None,
        source: "agent",
    };
    if !telemetry::send_choice(env, cwd, &ping, budget.remaining()) {
        return PingOutcome::Skipped;
    }
    if let (Some(k), Some(r)) = (key, &round) {
        ledger.confirm(k, r.reroll, "agent", r.ping_id.as_deref());
    }
    PingOutcome::Sent
}

fn vs(v: &Value, key: &str) -> String {
    match v.get(key) {
        None => "undefined".to_string(),
        Some(Value::Null) => "null".to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => crate::critique_storage::js_string_value(other),
    }
}

/// JS: renderChallenger
fn render_challenger(env: &Env, concept: &Value, index: usize) -> String {
    let system: Vec<String> = concept
        .get("system")
        .and_then(|s| s.as_array())
        .map(|a| a.iter().map(|r| fill(t::RENDER_CHALLENGER_RULE, &[("RULE", &value_str(r))])).collect())
        .unwrap_or_default();
    let (id, board, hero) = challenger_card(env, concept);
    fill(
        t::RENDER_CHALLENGER,
        &[
            ("INDEX_PLUS_ONE", &(index + 1).to_string()),
            ("CONCEPT_FORM", &vs(concept, "form")),
            ("CONCEPT_ID", &id),
            ("CONCEPT_SPARK", &vs(concept, "spark")),
            ("SYSTEM", &system.join("\n")),
            ("CONCEPT_WEBLEVERAGE", &vs(concept, "webLeverage")),
            ("BOARD", &board),
            ("HERO", &hero),
        ],
    )
}

/// A dealt challenger's catalog id and its two card images: the QUALITY BAR
/// line prints them and the roll record carries them, from this one place.
fn challenger_card(env: &Env, concept: &Value) -> (String, String, String) {
    let cb = card_base(env);
    let id = vs(concept, "id");
    let board = concept.get("cardBoard").filter(|v| crate::staleness::js_truthy(v)).map(value_str).unwrap_or_else(|| format!("{}/{}.webp", cb, id));
    let hero = concept.get("cardHero").filter(|v| crate::staleness::js_truthy(v)).map(value_str).unwrap_or_else(|| format!("{}/{}-hero.webp", cb, id));
    (id, board, hero)
}

fn value_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".to_string(),
        other => crate::critique_storage::js_string_value(other),
    }
}

/// JS: renderComposition
fn render_composition(c: &Value, index: Option<usize>) -> String {
    let grammar: Vec<String> = c
        .get("grammar")
        .and_then(|s| s.as_array())
        .map(|a| a.iter().map(|r| fill(t::RENDER_COMPOSITION_RULE, &[("RULE", &value_str(r))])).collect())
        .unwrap_or_default();
    fill(
        t::RENDER_COMPOSITION,
        &[
            ("COMP_INDEX_PREFIX", &index.map(|i| format!("{}. ", i + 1)).unwrap_or_default()),
            ("COMPOSITION_FORM", &vs(c, "form")),
            ("COMPOSITION_ID", &vs(c, "id")),
            ("COMPOSITION_SPARK", &vs(c, "spark")),
            ("GRAMMAR", &grammar.join("\n")),
            ("COMPOSITION_WEBLEVERAGE", &vs(c, "webLeverage")),
        ],
    )
}

struct Local {
    concepts: Vec<Value>,
    compositions: Vec<Value>,
}

fn load_local(catalog_dir: &str) -> Option<Local> {
    let cat = read_concept_catalog(&jsp::join(&[catalog_dir, "concept-ingredients.json"]), &jsp::join(&[catalog_dir, "concept-reviews.json"]))?;
    let errors = validate_concept_catalog(&cat.catalog, &cat.review_data);
    if !errors.is_empty() {
        return None;
    }
    let comp = read_composition_catalog(&jsp::join(&[catalog_dir, "composition-ingredients.json"]), &jsp::join(&[catalog_dir, "composition-reviews.json"]))?;
    Some(Local { concepts: cat.concepts, compositions: comp.compositions })
}

struct RollData {
    source: String,
    pool_revision: String,
    hand_id: Option<String>,
    approved_count: String,
    catalog_count: String,
    challengers: Vec<Value>,
    compositions: Vec<Value>,
    composition_match: Option<CompositionMatch>,
}

pub struct SeedArgs {
    pub scope: Option<String>,
    pub key: String,
    pub reroll: f64,
    pub register: Option<Option<String>>, // None = not given; Some(None) = flag without value
    pub mode: Option<Option<String>>,
    pub grain: Option<Option<String>>,
    pub platform: Option<Option<String>>,
    pub candidate_count: f64,
    /// The recorded build-path default and its file (`recorded_build_path`).
    pub build_path: Option<(String, String)>,
    /// The engine generated `key` itself this run (no `--from`, no
    /// `IMPECCABLE_CONCEPT_SEED`), so it has no ledger to look for.
    pub fresh_key: bool,
    /// `--replace-world`: the user asked to replace a seeded world, so this
    /// direction roll deals catalog worlds instead of settling on it.
    pub replace_world: bool,
}

fn unit(scope: &str, salt: &str, key: &str) -> f64 {
    let d = Sha256::digest(format!("{}:{}:{}", scope, salt, key).as_bytes());
    u32::from_be_bytes([d[0], d[1], d[2], d[3]]) as f64 / 4294967295.0
}

/// What a roll leaves for its records: the catalog worlds it printed as
/// challengers (`{"id", "board", "hero"}` each), and, for a roll the API
/// dealt, the response's `poolRevision` (`None` for a local or degraded roll).
pub(crate) struct RollMeta {
    pub worlds: Vec<Value>,
    pub api: bool,
    pub pool_revision: Option<String>,
    /// The response's `handId` when well formed.
    pub hand_id: Option<String>,
}

/// JS: renderConceptSeed
/// Returns the text plus the roll's `RollMeta`, for the roll record.
fn render_concept_seed(env: &Env, cwd: &str, budget: &mut ApiBudget, a: &SeedArgs) -> Result<(String, RollMeta), String> {
    let (scope, reroll, roll, degraded, meta) = render_roll(env, cwd, budget, a)?;
    // PRESENTATION closes every roll, where a middle-truncated read still
    // reaches it, like the restated lines above it.
    let register = a.register.clone().flatten();
    let reference = match telemetry::Ledger::new(env, cwd).for_fresh_key(&a.key, a.fresh_key).reference(&a.key) {
        Some(r) => fill(t::SEED_REFERENCE, &[("REFERENCE", &r)]),
        None => t::SEED_REFERENCE_UNAVAILABLE.to_string(),
    };
    Ok((roll + &reference + &presentation_block(env, cwd, scope, reroll, degraded, register.as_deref(), a.mode.clone().flatten().as_deref(), a.build_path.as_ref()), meta))
}

/// The roll itself: (scope, re-roll round, text, degraded, records).
#[allow(clippy::type_complexity)]
fn render_roll(env: &Env, cwd: &str, budget: &mut ApiBudget, a: &SeedArgs) -> Result<(&'static str, usize, String, bool, RollMeta), String> {
    let scope = match a.scope.as_deref() {
        Some("surface") => "surface",
        Some("direction") => "direction",
        _ => return Err("concept-seed: --scope must be direction or surface".into()),
    };
    if !(a.reroll.is_finite() && a.reroll.fract() == 0.0) || a.reroll < 0.0 {
        return Err("concept-seed: --reroll must be a non-negative integer".into());
    }
    let reroll = a.reroll as usize;
    let register: Option<&str> = match &a.register {
        None => None,
        Some(Some(r)) if r == "safer" || r == "bolder" => Some(r.as_str()),
        Some(_) => return Err("concept-seed: --register must be safer or bolder".into()),
    };
    if register.is_some() && reroll < 1 {
        return Err("concept-seed: --register steers a re-roll round; pass --reroll <n> with it".into());
    }
    if register.is_some() && scope != "direction" {
        return Err("concept-seed: --register applies to direction rounds only".into());
    }
    if a.replace_world && scope != "direction" {
        return Err("concept-seed: --replace-world applies to direction rounds only".into());
    }
    let mode: Option<&str> = match &a.mode {
        None => None,
        Some(Some(m)) if SEED_MODES.contains(&m.as_str()) => Some(m.as_str()),
        Some(_) => return Err("concept-seed: --mode must be persuade, operate, read, or experience".into()),
    };
    let grain: Option<&str> = match &a.grain {
        None => None,
        Some(Some(g)) if COMPOSITION_GRAINS.contains(&g.as_str()) => Some(g.as_str()),
        Some(_) => return Err(format!("concept-seed: --grain must be one of {}", COMPOSITION_GRAINS.join(", "))),
    };
    let platform: Option<&str> = match &a.platform {
        None => None,
        Some(Some(p)) if COMPOSITION_PLATFORMS.contains(&p.as_str()) => Some(p.as_str()),
        Some(_) => return Err(format!("concept-seed: --platform must be one of {}", COMPOSITION_PLATFORMS.join(", "))),
    };
    if !(a.candidate_count.is_finite() && a.candidate_count.fract() == 0.0) || a.candidate_count < 5.0 || a.candidate_count > 7.0 {
        return Err("concept-seed: --candidate-count must be an integer from 5 to 7".into());
    }
    let candidate_count = a.candidate_count as usize;
    let key = a.key.as_str();

    let index_salt = if reroll == 0 { "index".to_string() } else { format!("index:reroll-{}", reroll) };
    let build_index = 3 + (unit(scope, &index_salt, key) * (candidate_count as f64 - 2.0)).floor() as usize;
    let mut dealt: Vec<usize> = vec![build_index];
    let want = 3.min(candidate_count);
    let mut draw = 0usize;
    while scope == "surface" && dealt.len() < want {
        let idx = 1 + (unit(scope, &format!("{}:deal-{}", index_salt, draw), key) * candidate_count as f64).floor() as usize;
        if !dealt.contains(&idx) {
            dealt.push(idx);
        }
        if draw > 64 {
            let mut f = 1;
            while dealt.len() < want {
                if !dealt.contains(&f) {
                    dealt.push(f);
                }
                f += 1;
            }
        }
        draw += 1;
    }
    let dealt_str = dealt.iter().map(|d| d.to_string()).collect::<Vec<_>>().join(", ");

    let ctx = load_context(cwd, &TargetOptions::default(), env);
    // A seeded world settles every roll until the user asks to replace it;
    // that one direction roll passes --replace-world and deals worlds again.
    let seeded = crate::context::seeded_world(ctx.design.as_deref());
    let settled_world = seeded.as_ref().filter(|_| !a.replace_world).map(|id| {
        let exit = if scope == "direction" { t::SETTLED_REPLACE_EXIT } else { "" };
        format!("WORLD: settled ({id}, seeded from the catalog). The structures below are dealt inside it; do not roll, re-pick or replace the world.{exit}\n")
    });
    let replacing = seeded.as_ref().filter(|_| a.replace_world).map(|id| fill(t::REPLACING_WORLD, &[("WORLD", id)])).unwrap_or_default();
    // Bolder deals foreign worlds, which a settled world never shows: the
    // round runs as a plain re-roll of structures and says so.
    let settled_bolder = settled_world.is_some() && register == Some("bolder");
    let round_register = if settled_bolder { None } else { register };
    let compositions_enabled = env.get("IMPECCABLE_COMPOSITIONS").map(|v| v == "1").unwrap_or(false);

    // data resolution
    let catalog_dir = env.get("IMPECCABLE_CATALOG_DIR").filter(|v| !v.is_empty()).cloned().unwrap_or_else(|| {
        crate::provider::detect(env, cwd).skill_dir.map(|d| jsp::join(&[&d, "scripts"])).unwrap_or_else(|| ".".to_string())
    });
    let data: Option<RollData> = if let Some(local) = load_local(&catalog_dir) {
        let (approved_count, challengers) = if settled_world.is_some() {
            (local.concepts.iter().filter(|c| c.get("status").and_then(Value::as_str) == Some("approved")).count(), vec![])
        } else {
            let sel = select_approved_challengers(scope, key, reroll, mode, &local.concepts)?;
            (sel.approved.len(), sel.picks)
        };
        let comps = select_approved_compositions(scope, key, reroll, mode, grain, platform, &local.compositions, 3);
        Some(RollData {
            source: "local".into(),
            pool_revision: approved_pool_revision(&local.concepts),
            hand_id: None,
            approved_count: approved_count.to_string(),
            catalog_count: local.concepts.len().to_string(),
            challengers,
            compositions: comps.picks,
            composition_match: Some(comps.match_),
        })
    } else if settled_world.is_some() && !compositions_enabled {
        // No world candidates will be printed and no composition input needs
        // the API. The grounded structural deal needs no network request.
        None
    } else {
        fetch_roll(env, cwd, budget, scope, key, mode, grain, platform, reroll, settled_world.is_some()).map(|roll| RollData {
            source: "api".into(),
            pool_revision: vs(&roll, "poolRevision"),
            hand_id: roll.get("handId").and_then(Value::as_str).map(str::to_string),
            approved_count: vs(&roll, "approvedCount"),
            catalog_count: vs(&roll, "catalogCount"),
            challengers: roll.get("challengers").and_then(|c| c.as_array()).cloned().unwrap_or_default(),
            compositions: if let Some(c) = roll.get("compositions").and_then(|c| c.as_array()) {
                c.clone()
            } else if let Some(s) = roll.get("stagings").and_then(|c| c.as_array()) {
                s.clone()
            } else if let Some(s) = roll.get("staging").filter(|v| crate::staleness::js_truthy(v)) {
                vec![s.clone()]
            } else {
                vec![]
            },
            composition_match: None,
        })
    }.or_else(|| settled_world.as_ref().map(|_| RollData {
        // A settled world needs no catalog to deal grounded structures. Use
        // the full roll's blocks rather than suggesting a network retry to
        // obtain world candidates that must never be shown here.
        source: "settled".into(),
        pool_revision: "none".into(),
        hand_id: None,
        approved_count: "0".into(),
        catalog_count: "0".into(),
        challengers: vec![],
        compositions: vec![],
        composition_match: None,
    }));

    let mode_flag = mode.map(|m| format!(" --mode {}", m)).unwrap_or_default();
    let reroll_flag = if reroll > 0 { format!(" --reroll {}", reroll) } else { String::new() };
    let register_flag = register.map(|r| format!(" --register {}", r)).unwrap_or_default() + if a.replace_world { " --replace-world" } else { "" };
    let mode_or_unscoped = mode.unwrap_or("unscoped").to_string();
    let scope_upper = scope.to_uppercase();
    let build_index_s = build_index.to_string();
    let count_s = candidate_count.to_string();
    let common: Vec<(&str, &str)> = vec![
        ("SCOPE_UPPER", &scope_upper),
        ("SCOPE", scope),
        ("KEY", key),
        ("MODE_OR_UNSCOPED", &mode_or_unscoped),
        ("MODE_FLAG", &mode_flag),
        ("REROLL_FLAG", &reroll_flag),
        ("REGISTER_FLAG", &register_flag),
        ("CANDIDATECOUNT", &count_s),
        ("BUILDINDEX", &build_index_s),
        ("DEALT_INDICES", &dealt_str),
    ];
    let promoted = if scope == "direction" { fill(t::PROMOTED_DIRECTION, &common) } else { fill(t::PROMOTED_SURFACE, &common) };
    let challenger_instruction = if scope == "direction" { t::CHALLENGER_DIRECTION.to_string() } else { t::CHALLENGER_SURFACE.to_string() };
    let authority = replacing + if scope == "direction" { t::AUTHORITY_DIRECTION } else { t::AUTHORITY_SURFACE };
    // MODE RULES ride after RICHNESS (after AUTHORITY on the degraded paths,
    // which carry no RICHNESS), on every round including re-rolls.
    let mode_block = mode.map(|m| format!("\n{}", mode_rules_block(env, cwd, m))).unwrap_or_default();
    let richness = format!("{}{}", t::RICHNESS, mode_block);
    let assigned_or_dealt = if scope == "direction" { format!("ASSIGNED INDEX: {}", build_index) } else { format!("DEALT INDICES: {} (index {} leads)", dealt_str, build_index) };
    let restated_assigned_or_dealt = if scope == "direction" {
        fill(t::RESTATED_DIRECTION, &common)
    } else {
        fill(t::RESTATED_SURFACE, &common)
    };

    let Some(data) = data else {
        let authority = format!("{}{}", authority, mode_block);
        let degraded_header = fill(t::DEGRADED_HEADER, &common);
        if register == Some("safer") {
            let mut pairs = common.clone();
            pairs.push(("DEGRADEDHEADER", &degraded_header));
            pairs.push(("AUTHORITYINSTRUCTION", &authority));
            return Ok((scope, reroll, fill(t::DEGRADED_SAFER, &pairs), true, RollMeta { worlds: vec![], api: false, pool_revision: None, hand_id: None }));
        }
        let degraded_register = if register == Some("bolder") { t::DEGRADED_BOLDER.to_string() } else { String::new() };
        let mut pairs = common.clone();
        pairs.push(("DEGRADEDHEADER", &degraded_header));
        pairs.push(("DEGRADEDREGISTER", &degraded_register));
        pairs.push(("ASSIGNED_OR_DEALT", &assigned_or_dealt));
        pairs.push(("PROMOTEDINSTRUCTION", &promoted));
        pairs.push(("AUTHORITYINSTRUCTION", &authority));
        pairs.push(("RESTATED_ASSIGNED_OR_DEALT", &restated_assigned_or_dealt));
        return Ok((scope, reroll, fill(t::DEGRADED_BODY, &pairs), true, RollMeta { worlds: vec![], api: false, pool_revision: None, hand_id: None }));
    };

    let compositions: Vec<Value> = if compositions_enabled { data.compositions.clone() } else { vec![] };
    let grain_note = match &data.composition_match {
        Some(m) if m.grain.is_some() => {
            let g = m.grain.clone().unwrap();
            let comp_len = compositions.len().to_string();
            if m.grain_available == Some(0) {
                fill(t::GRAIN_NONE_AVAIL, &[("MATCH_GRAIN", &g)])
            } else if m.at_grain == Some(0) {
                fill(t::GRAIN_NONE_AT, &[("MATCH_GRAIN", &g), ("MATCH_GRAINAVAILABLE", &m.grain_available.unwrap_or(0).to_string())])
            } else if m.at_grain.unwrap_or(0) < compositions.len() {
                fill(t::GRAIN_PARTIAL, &[("MATCH_ATGRAIN", &m.at_grain.unwrap_or(0).to_string()), ("COMPOSITIONS_LENGTH", &comp_len), ("MATCH_GRAIN", &g)])
            } else {
                String::new()
            }
        }
        _ => String::new(),
    };
    let composition_block = if !compositions.is_empty() {
        let header = if scope == "direction" {
            "FIRST-SURFACE COMPOSITION INPUTS (identity-free; test them with shortlisted worlds and keep world plus composition one decision):"
        } else {
            "COMPOSITION CHALLENGERS (identity-free; dress them in the committed visual identity before judging):"
        };
        let rendered: Vec<String> = compositions.iter().enumerate().map(|(i, c)| render_composition(c, Some(i))).collect();
        fill(t::COMPOSITION_BLOCK, &[("COMPOSITION_HEADER", header), ("COMPOSITIONS_RENDERED", &rendered.join("\n")), ("GRAINNOTE", &grain_note)])
    } else {
        String::new()
    };
    let reroll_block = if reroll > 0 {
        let tag = round_register.map(|r| format!(" ({} REGISTER, user-requested)", r.to_uppercase())).unwrap_or_default();
        let derive = if round_register.is_some() { "" } else { t::REROLL_DERIVE_TEXT };
        let unavailable = if settled_bolder { t::SETTLED_BOLDER } else { "" };
        format!("{unavailable}{}", fill(t::REROLL_BLOCK, &[("REROLL", &reroll.to_string()), ("REROLL_REGISTER_TAG", &tag), ("REROLL_DERIVE", derive)]))
    } else {
        String::new()
    };
    let telemetry_block = if data.source == "api" {
        let mut pairs = common.clone();
        pairs.push(("TELEMETRY_CHOICE", if scope == "direction" { t::TELEMETRY_CHOICE_DIRECTION } else { t::TELEMETRY_CHOICE_SURFACE }));
        fill(t::TELEMETRY_BLOCK, &pairs)
    } else {
        String::new()
    };
    let assigned_block = match round_register {
        None => fill(t::ASSIGNED_BLOCK, &[("ASSIGNED_OR_DEALT", &assigned_or_dealt), ("PROMOTEDINSTRUCTION", &promoted)]),
        Some("safer") => t::SAFER_BLOCK.to_string(),
        _ => t::BOLDER_BLOCK.to_string(),
    };
    let round_challenger_instruction = if round_register == Some("bolder") { t::BOLDER_CHALLENGER.to_string() } else { challenger_instruction };
    // The safer register spends its hand unseen, so it prints no challenger
    // and records no world.
    let mut worlds: Vec<Value> = Vec::new();
    let challenger_section = if let Some(world) = &settled_world {
        format!("{}{}", world, composition_block)
    } else if round_register == Some("safer") {
        String::new()
    } else {
        for c in &data.challengers {
            let (id, board, hero) = challenger_card(env, c);
            worlds.push(serde_json::json!({ "id": id, "board": board, "hero": hero }));
        }
        let rendered: Vec<String> = data.challengers.iter().enumerate().map(|(i, c)| render_challenger(env, c, i)).collect();
        fill(
            t::CHALLENGER_SECTION,
            &[
                ("CHALLENGERS_RENDERED", &rendered.join("\n")),
                ("COMPOSITIONBLOCK", &composition_block),
                ("ROUNDCHALLENGERINSTRUCTION", &round_challenger_instruction),
            ],
        )
    };
    let restated = match round_register {
        None => restated_assigned_or_dealt,
        Some(r) => fill(t::RESTATED_REGISTER, &[("REGISTER", r), ("KEY", key)]),
    };
    let mut pairs = common.clone();
    pairs.push(("DATA_SOURCE", &data.source));
    pairs.push(("DATA_POOLREVISION", &data.pool_revision));
    pairs.push(("DATA_APPROVEDCOUNT", &data.approved_count));
    pairs.push(("DATA_CATALOGCOUNT", &data.catalog_count));
    pairs.push(("REROLLBLOCK", &reroll_block));
    pairs.push(("ASSIGNEDBLOCK", &assigned_block));
    pairs.push(("CHALLENGERSECTION", &challenger_section));
    pairs.push(("AUTHORITYINSTRUCTION", &authority));
    pairs.push(("RICHNESSINSTRUCTION", &richness));
    pairs.push(("TELEMETRYBLOCK", &telemetry_block));
    pairs.push(("RESTATED", &restated));
    let api = data.source == "api";
    let pool_revision = Some(data.pool_revision.clone()).filter(|p| api && telemetry::valid_pool_revision(p));
    let hand_id = data.hand_id.clone().filter(|h| api && telemetry::valid_hand_id(h));
    Ok((scope, reroll, fill(t::MAIN, &pairs), false, RollMeta { worlds, api, pool_revision, hand_id }))
}


pub fn run(args: &[String], io: &mut Io) -> i32 {
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();
    let idx = |name: &str| args.iter().position(|a| a == name);
    // args[idx+1] may be undefined -> None
    let val = |name: &str| -> Option<Option<String>> { idx(name).map(|i| args.get(i + 1).cloned()) };
    let mut budget = ApiBudget::new(&env);
    // `--check-seed <reference>`: whether this machine rolled that seed, so a
    // reviewer can corroborate a brief's FORM line against the local ledger.
    if let Some(v) = val("--check-seed") {
        let v = v.unwrap_or_default();
        if v == "none" {
            let available = telemetry::seed_salt(&env, &cwd).is_some();
            io.out(if available { "SEED NONE: this machine can make seed references, so a brief written here records one; `none` means the roll was skipped.\n" } else { "SEED NONE ACCEPTED: this machine has no seed salt, so no reference can exist and the brief rightly records none.\n" });
            return if available { 1 } else { 0 };
        }
        if impeccable_common::seed::parse_reference(&v).is_none() {
            io.out("SEED UNKNOWN: not a seed reference (`seed:` and 16 hex). A raw key never belongs in a brief.\n");
            return 1;
        }
        return match telemetry::Ledger::new(&env, &cwd).resolve(&v) {
            Ok(_) => {
                io.out(&format!("SEED KNOWN: {} was rolled on this machine.\n", v));
                0
            }
            Err(_) => {
                io.out(&format!("SEED UNKNOWN: {} was not rolled on this machine (or its record is gone); corroborate it against the roll output instead.\n", v));
                1
            }
        };
    }
    let chosen = val("--chosen");
    let kind = val("--kind");
    if chosen.is_some() || kind.is_some() || idx("--option").is_some() {
        let flat = |v: Option<Option<String>>| -> Option<String> { v.flatten() };
        let (chosen, from, scope, mode, kind, register) = (flat(chosen), flat(val("--from")), flat(val("--scope")), flat(val("--mode")), flat(kind), flat(val("--register")));
        // `--reroll <n>`: the round the choice resolved on, 0 to 8; anything
        // else is ignored rather than sent.
        let reroll = flat(val("--reroll")).map(|s| crate::critique_storage::js_number(&s)).filter(|n| n.is_finite() && n.fract() == 0.0 && *n >= 0.0 && *n <= telemetry::MAX_REROLL as f64).map(|n| n as usize);
        let option = flat(val("--option")).map(|s| crate::critique_storage::js_number(&s)).filter(|n| n.is_finite() && n.fract() == 0.0 && *n >= 0.0 && *n <= telemetry::MAX_OPTION as f64).map(|n| n as usize);
        // A seed reference resolves to its key; one this machine never
        // recorded sends nothing, since the ping needs the key the roll used.
        let from = match from.as_deref().map(|f| telemetry::Ledger::new(&env, &cwd).resolve(f)) {
            Some(Err(_)) => {
                io.out("choice ping skipped\n");
                return 0;
            }
            Some(Ok(k)) => Some(k),
            None => None,
        };
        let args = PingArgs { chosen_id: chosen.as_deref(), key: from.as_deref(), scope: scope.as_deref(), mode: mode.as_deref(), kind: kind.as_deref(), register: register.as_deref(), reroll, option };
        io.out(match ping_chosen(&env, &cwd, &mut budget, &args) {
            PingOutcome::Sent => "choice recorded\n",
            PingOutcome::Skipped => "choice ping skipped\n",
            PingOutcome::AlreadyRecorded => "choice already recorded\n",
        });
        return 0;
    }
    let ctx = load_context(&cwd, &TargetOptions::default(), &env);
    if !ctx.has_product {
        io.out("NO_PRODUCT_MD: the dice stay in the cup until product truth exists. Complete the init ask round and write PRODUCT.md first (reference/init.md), then re-run this exact command. Challengers fuse their form with facts from PRODUCT.md; without it every direction is ungrounded.\n");
        return 1;
    }
    let num = |v: Option<Option<String>>| -> Option<f64> { v.map(|x| x.map(|s| crate::critique_storage::js_number(&s)).unwrap_or(f64::NAN)) };
    let supplied = match val("--from") {
        Some(Some(k)) => Some(k),
        Some(None) => Some("undefined".to_string()),
        None => env.get("IMPECCABLE_CONCEPT_SEED").filter(|v| !v.is_empty()).cloned(),
    };
    let fresh_key = supplied.is_none();
    let given = supplied.unwrap_or_else(impeccable_common::seed::new_key);
    // A seed reference (what the surface brief records) stands for the key
    // this machine rolled it from; the deal depends on the key itself.
    let ledger = telemetry::Ledger::new(&env, &cwd).for_fresh_key(&given, fresh_key);
    let key = match ledger.resolve(&given) {
        Ok(k) => k,
        Err(r) => {
            io.err(&format!("concept-seed: {} is a seed reference this machine has no record of. A reference resolves only where its roll was made (in .impeccable/questions/seeds/, which is never committed). To reproduce that deal here, pass the original key with --from; otherwise roll anew without --from.\n", r));
            return 1;
        }
    };
    let seed = SeedArgs {
        scope: match val("--scope") {
            None => Some("surface".to_string()),
            Some(v) => v, // undefined value -> None -> invalid scope
        },
        key,
        reroll: num(val("--reroll")).unwrap_or(0.0),
        register: val("--register"),
        mode: val("--mode"),
        grain: val("--grain"),
        platform: val("--platform"),
        candidate_count: num(val("--candidate-count")).unwrap_or(7.0),
        build_path: crate::context_cli::recorded_build_path(&ctx, &cwd),
        fresh_key,
        replace_world: idx("--replace-world").is_some(),
    };
    match render_concept_seed(&env, &cwd, &mut budget, &seed) {
        Ok((text, meta)) => {
            // A valid roll: the scope and re-roll round passed validation.
            // serve-question reads the record to know a surface round when
            // it serves one, and which catalog worlds were dealt, so it can
            // name their card images when the comps are due (`record_roll`).
            let scope = seed.scope.as_deref().unwrap_or("surface");
            let mode = seed.mode.clone().flatten();
            let register = seed.register.clone().flatten();
            // Telemetry off: the roll record and ledger keep only what the
            // feature needs (worlds for serve-question, the key behind the
            // reference), none of the ping's fields.
            let tracked = meta.api && !telemetry::telemetry_disabled(&env, &cwd);
            ledger.record_key(&seed.key);
            let api = tracked.then(|| crate::serve_question::ApiRoll { mode: mode.as_deref(), register: register.as_deref(), pool_revision: meta.pool_revision.as_deref(), hand_id: meta.hand_id.as_deref() });
            crate::serve_question::record_roll(&cwd, scope, ledger.reference(&seed.key).as_deref(), seed.reroll as usize, &meta.worlds, api.as_ref());
            // An API-dealt round also enters the seed ledger, which outlives
            // the roll record, for the choice ping that follows the round.
            if tracked {
                let dealt = meta.worlds.iter().filter_map(|w| w.get("id").and_then(Value::as_str)).map(str::to_string).collect();
                ledger.record_round(&seed.key, &telemetry::SeedRound { scope: scope.to_string(), reroll: seed.reroll as usize, mode, register, pool_revision: meta.pool_revision.clone(), hand_id: meta.hand_id.clone(), dealt, ..Default::default() });
            }
            if let Some(notice) = crate::serve_question::tracked_runtime_notice(&cwd) {
                io.out(&notice);
            }
            io.out(&text);
            0
        }
        Err(msg) => {
            io.err(&format!("{}\n", msg));
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MODE_FILE: &str = "# Operate mode\n\nIntro the engine ignores.\n\n## Directions\n\n- Keep standard navigation.\n\n  Indented continuation.\n\n## Comps\n- Show a working state.\n### Sub heading stays\n\n";

    /// The ledger the test runs see: the same pinned salt.
    fn tl(p: &std::path::Path) -> telemetry::Ledger {
        telemetry::Ledger::new(&Env::from([("IMPECCABLE_SEED_SALT".into(), "test-salt".into())]), &p.to_string_lossy())
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("impeccable-seed-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A project with PRODUCT.md plus a skill dir holding the given mode files.
    fn fixture(name: &str, files: &[(&str, &str)]) -> (std::path::PathBuf, std::path::PathBuf) {
        let root = temp_dir(name);
        let proj = root.join("proj");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(proj.join("PRODUCT.md"), "# Product\n\n## Users\n\nPeople.\n").unwrap();
        let skill = root.join("skill");
        std::fs::create_dir_all(skill.join("reference")).unwrap();
        for (file, body) in files {
            std::fs::write(skill.join("reference").join(format!("{}.md", file)), body).unwrap();
        }
        (proj, skill)
    }

    fn seed(proj: &std::path::Path, skill: &std::path::Path, catalog: bool, args: &[&str]) -> (i32, String) {
        let catalog_dir = if catalog {
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/concept-catalog")
        } else {
            proj.join("no-such-catalog")
        };
        let env = Env::from([
            ("IMPECCABLE_SKILL_DIR".into(), skill.to_string_lossy().into_owned()),
            ("IMPECCABLE_CATALOG_DIR".into(), catalog_dir.to_string_lossy().into_owned()),
            ("IMPECCABLE_API_URL".into(), "http://127.0.0.1:9/api".into()),
            ("IMPECCABLE_API_TIMEOUT".into(), "300".into()),
            ("IMPECCABLE_NO_TELEMETRY".into(), "1".into()),
            ("IMPECCABLE_SEED_SALT".into(), "test-salt".into()),
            ("IMPECCABLE_NO_STALENESS_CHECK".into(), "1".into()),
            ("IMPECCABLE_SELF".into(), "impeccable".into()),
        ]);
        let (mut io, cap) = Io::captured("", proj.to_path_buf(), env);
        let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        let code = run(&argv, &mut io);
        let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
        (code, out.replace('\\', "/"))
    }

    #[test]
    fn settled_rolls_replace_only_the_world_candidates() {
        let (proj, skill) = fixture("settled-roll", &[("mode-persuade", MODE_FILE)]);
        let args = ["--scope", "surface", "--mode", "persuade", "--from", "k1"];
        let (code, empty) = seed(&proj, &skill, true, &args);
        assert_eq!(code, 0);
        assert!(empty.contains("CHALLENGERS:\n"), "{empty}");
        assert!(empty.contains("     SOURCE ID: "), "{empty}");
        assert!(empty.contains("     QUALITY BAR: "), "{empty}");
        let catalog = load_local(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/concept-catalog").to_string_lossy()).unwrap();
        let before = empty.split("CHALLENGERS:\n").next().unwrap();
        let after = empty.split("PRODUCT.md and DESIGN.md constrain").nth(1).unwrap();
        // Only a seeded world settles the roll: a project with its own design
        // system keeps its challengers (new-work.md's established-world path).
        for seeded in [true] {
            if seeded {
                std::fs::write(proj.join("DESIGN.md"), "---\nworld: teletext-service\n---\n# Design\n").unwrap();
            } else {
                std::fs::remove_file(proj.join("DESIGN.md")).unwrap();
                std::fs::create_dir_all(proj.join("src")).unwrap();
                std::fs::write(proj.join("src/theme.css"), ":root { --ground: white; --ink: black; --accent: red; }\n").unwrap();
            }
            let (code, out) = seed(&proj, &skill, true, &args);
            assert_eq!(code, 0);
            let label = if seeded { "teletext-service, seeded from the catalog" } else { "this project's own design system" };
            let world = format!("WORLD: settled ({label}). The structures below are dealt inside it; do not roll, re-pick or replace the world.\n");
            assert_eq!(out, format!("{before}{world}PRODUCT.md and DESIGN.md constrain{after}"));
            for c in &catalog.concepts {
                assert!(!out.contains(&vs(c, "form")), "{out}");
            }
            for forbidden in ["CHALLENGERS:\n", "QUALITY BAR:", "SOURCE ID:", "/worlds/cards/"] {
                assert!(!out.contains(forbidden), "{out}");
            }
            let record: Value = serde_json::from_str(&std::fs::read_to_string(proj.join(".impeccable/questions/roll.json")).unwrap()).unwrap();
            assert!(record.get("worlds").is_none());
            let (code, direction) = seed(&proj, &skill, true, &["--scope", "direction", "--from", "k1"]);
            assert_eq!(code, 0);
            assert!(direction.contains(&world.replace(".\n", &format!(".{}\n", t::SETTLED_REPLACE_EXIT))), "{direction}");
            assert!(!direction.contains("CHALLENGERS:\n"));
        }
        // Once code carries a seeded world, its catalog id still names it.
        std::fs::write(proj.join("DESIGN.md"), "---\nworld: teletext-service\n---\n").unwrap();
        let (code, out) = seed(&proj, &skill, true, &args);
        assert_eq!(code, 0);
        assert!(out.contains("WORLD: settled (teletext-service, seeded from the catalog)."));
    }

    #[test]
    fn a_settled_bolder_round_runs_as_a_plain_reroll_inside_the_world() {
        // Catches: BOLDER_BLOCK forbidding grounded directions while the
        // settled world removed every challenger, leaving an empty hand.
        let (proj, skill) = fixture("settled-bolder", &[("mode-persuade", MODE_FILE)]);
        std::fs::write(proj.join("DESIGN.md"), "---\nworld: teletext-service\n---\n").unwrap();
        let (code, out) = seed(&proj, &skill, true, &["--scope", "direction", "--mode", "persuade", "--from", "k1", "--reroll", "1", "--register", "bolder"]);
        assert_eq!(code, 0);
        assert!(out.contains(t::SETTLED_BOLDER), "{out}");
        assert!(out.contains("ASSIGNED INDEX: "), "{out}");
        assert!(out.contains("WORLD: settled (teletext-service, seeded from the catalog)."), "{out}");
        for forbidden in [t::BOLDER_BLOCK, t::BOLDER_CHALLENGER, "(BOLDER REGISTER, user-requested)", "REGISTER (restated", "CHALLENGERS:\n"] {
            assert!(!out.contains(forbidden), "{forbidden}\n{out}");
        }
        // The rerun line still reproduces the round the user asked for.
        assert!(out.contains("--reroll 1 --register bolder --candidate-count"), "{out}");
    }

    #[test]
    fn replace_world_deals_worlds_again_and_says_what_the_rewrite_drops() {
        let (proj, skill) = fixture("replace-world", &[("mode-persuade", MODE_FILE)]);
        std::fs::write(proj.join("DESIGN.md"), "---\nworld: teletext-service\n---\n").unwrap();
        let args = ["--scope", "direction", "--mode", "persuade", "--from", "k1", "--replace-world"];
        let (code, out) = seed(&proj, &skill, true, &args);
        assert_eq!(code, 0);
        assert!(out.contains(&fill(t::REPLACING_WORLD, &[("WORLD", "teletext-service")])), "{out}");
        assert!(out.contains("CHALLENGERS:\n"), "{out}");
        assert!(!out.contains("WORLD: settled"), "{out}");
        assert!(out.contains("--from k1 --replace-world --candidate-count"), "{out}");
        // Bolder works again once the world is up for replacement.
        let (_, bolder) = seed(&proj, &skill, true, &["--scope", "direction", "--from", "k1", "--reroll", "1", "--register", "bolder", "--replace-world"]);
        assert!(bolder.contains(t::BOLDER_BLOCK) && !bolder.contains(t::SETTLED_BOLDER), "{bolder}");
        // A surface roll never replaces the world.
        let (code, _) = seed(&proj, &skill, true, &["--scope", "surface", "--from", "k1", "--replace-world"]);
        assert_eq!(code, 1);
        // With no seeded world the flag changes nothing but the rerun line.
        std::fs::remove_file(proj.join("DESIGN.md")).unwrap();
        let (_, plain) = seed(&proj, &skill, true, &args);
        assert!(!plain.contains("WORLD: replacing") && plain.contains("CHALLENGERS:\n"), "{plain}");
    }

    #[test]
    fn extracts_both_sections_verbatim_and_trimmed() {
        assert_eq!(extract_section(MODE_FILE, "Directions").unwrap(), "- Keep standard navigation.\n\n  Indented continuation.");
        assert_eq!(extract_section(MODE_FILE, "Comps").unwrap(), "- Show a working state.\n### Sub heading stays");
    }

    #[test]
    fn missing_or_empty_section_is_none() {
        assert_eq!(extract_section("# T\n\n## Directions\n\nx\n", "Comps"), None);
        assert_eq!(extract_section("# T\n\n## Directions\n\n\n## Comps\ny\n", "Directions"), None);
        assert_eq!(extract_section("# T\n\n### Directions\nx\n", "Directions"), None);
    }

    #[test]
    fn crlf_files_extract_like_lf() {
        let crlf = MODE_FILE.replace('\n', "\r\n");
        assert_eq!(extract_section(&crlf, "Directions"), extract_section(MODE_FILE, "Directions"));
        assert_eq!(extract_section(&crlf, "Comps"), extract_section(MODE_FILE, "Comps"));
    }

    #[test]
    fn mode_files_map_experience_to_persuade() {
        assert_eq!(mode_rules_file("persuade"), "mode-persuade");
        assert_eq!(mode_rules_file("experience"), "mode-persuade");
        assert_eq!(mode_rules_file("operate"), "mode-operate");
        assert_eq!(mode_rules_file("read"), "mode-read");
    }

    #[test]
    fn block_for_each_mode_names_its_file_and_bodies() {
        let files = [
            ("mode-persuade", "# P\n\n## Directions\nP directions.\n\n## Comps\nP comps.\n"),
            ("mode-operate", MODE_FILE),
            ("mode-read", "# R\r\n\r\n## Directions\r\nR directions.\r\n## Comps\r\nR comps.\r\n"),
        ];
        let (proj, skill) = fixture("each-mode", &files);
        let skill_s = skill.to_string_lossy().replace('\\', "/");
        for (mode, file, dir, comps) in [
            ("persuade", "mode-persuade", "P directions.", "P comps."),
            ("experience", "mode-persuade", "P directions.", "P comps."),
            ("operate", "mode-operate", "- Keep standard navigation.\n\n  Indented continuation.", "- Show a working state.\n### Sub heading stays"),
            ("read", "mode-read", "R directions.", "R comps."),
        ] {
            let (code, out) = seed(&proj, &skill, true, &["--scope", "direction", "--mode", mode, "--from", "k1"]);
            assert_eq!(code, 0, "{out}");
            let block = format!(
                "\nMODE RULES ({}, from {}/reference/{}.md). They govern this surface's directions and every comp you write or judge for it, the decision comps included; where shared guidance conflicts, these win.\nDIRECTIONS\n{}\nCOMPS\n{}\nA user- or brief-pinned decision beats the roll, always.\n",
                mode, skill_s, file, dir, comps
            );
            assert!(out.contains(&block), "{mode}: {out}");
            assert!(out.contains("behavior.\nMODE RULES ("), "block follows RICHNESS: {out}");
        }
    }

    #[test]
    fn no_mode_prints_no_block_and_richness_is_mode_neutral() {
        let (proj, skill) = fixture("no-mode", &[("mode-persuade", MODE_FILE)]);
        let (code, out) = seed(&proj, &skill, true, &["--scope", "direction", "--from", "k1"]);
        assert_eq!(code, 0, "{out}");
        assert!(!out.contains("MODE RULES"), "{out}");
        assert!(!out.contains("Persuade") && !out.contains("Operate or Read"), "{out}");
        assert!(out.contains("Keep a literal carrier only when it\nbecomes functional."), "{out}");
    }

    #[test]
    fn missing_file_or_section_prints_the_fallback_and_still_rolls() {
        let (proj, skill) = fixture("missing", &[("mode-operate", "# O\n\n## Directions\nonly directions\n")]);
        let skill_s = skill.to_string_lossy().replace('\\', "/");
        for (mode, file) in [("operate", "mode-operate"), ("read", "mode-read")] {
            let (code, out) = seed(&proj, &skill, true, &["--scope", "surface", "--mode", mode, "--from", "k1"]);
            assert_eq!(code, 0, "{out}");
            assert!(out.contains(&format!("\nMODE RULES unavailable: read {}/reference/{}.md before writing directions or comps.\n", skill_s, file)), "{out}");
            assert!(!out.contains("DIRECTIONS\n"), "{out}");
        }
    }

    #[test]
    fn rerolls_and_degraded_rolls_carry_the_block() {
        let (proj, skill) = fixture("reroll", &[("mode-persuade", MODE_FILE)]);
        let (_, out) = seed(&proj, &skill, true, &["--scope", "direction", "--mode", "persuade", "--from", "k1", "--reroll", "2", "--register", "bolder"]);
        assert!(out.contains("MODE RULES (persuade, from "), "{out}");
        let (_, out) = seed(&proj, &skill, false, &["--scope", "direction", "--mode", "experience", "--from", "k1"]);
        assert!(out.contains("source: degraded"), "{out}");
        assert!(out.contains("selected independently.\nMODE RULES (experience, from "), "block follows AUTHORITY: {out}");
        let (_, out) = seed(&proj, &skill, false, &["--scope", "direction", "--mode", "persuade", "--from", "k1", "--reroll", "1", "--register", "safer"]);
        assert!(out.contains("MODE RULES (persuade, from "), "{out}");
    }

    /// The PRESENTATION block: everything from its header to the end.
    fn presentation(out: &str) -> &str {
        let at = out.find("PRESENTATION (").unwrap_or_else(|| panic!("no PRESENTATION block: {out}"));
        &out[at..]
    }

    const PRESENT_FIRST_LINE: &str = "- Present this hand on the decision page: write the options payload (`impeccable serve-question --schema` prints its shape), run `impeccable serve-question --start --payload <file>`, and open the URL it prints for the user.";

    #[test]
    fn direction_roll_ends_with_the_presentation_block() {
        let (proj, skill) = fixture("present-direction", &[("mode-persuade", MODE_FILE)]);
        let (code, out) = seed(&proj, &skill, true, &["--scope", "direction", "--mode", "persuade", "--from", "k1"]);
        assert_eq!(code, 0, "{out}");
        let block = presentation(&out);
        let reference = tl(&proj).reference("k1").unwrap();
        assert!(out.contains(&format!("seed key k1.\nSEED REFERENCE: {reference}. Write this, never the key, wherever the seed is recorded (the surface brief's FORM line, build-phase start --direction); on this machine --from accepts it in place of the key.\nPRESENTATION (the decision round, condensed from new-work.md;")), "the reference, then the block, follow the restated line: {out}");
        let lines: Vec<&str> = block.trim_end().split('\n').collect();
        assert_eq!(lines.len(), 6, "{block}");
        assert_eq!(lines[1], PRESENT_FIRST_LINE);
        assert!(lines[2].starts_with("- With image generation, every card declares a comp under .impeccable/mocks/decision/, canon included, declined challengers excepted. Serve first"), "{block}");
        assert!(lines[2].contains("(a.png gets a.png.json)"), "{block}");
        // The wait follows comp generation, never precedes it.
        assert!(lines[3].starts_with("- After the last comp or sketch lands (at once when this round makes none), hold `impeccable serve-question --wait --key <key>`. If your shell hands back a session before --wait exits, keep polling that session until it exits; rerun --wait only after it exits 3"), "{block}");
        assert!(lines[4].starts_with("- Build path: none recorded"), "{block}");
        assert!(lines[4].contains("\"buildPath\": {\"value\": \"comp\", \"toggle\": true}"), "{block}");
        assert!(lines[5].starts_with("- The structured question tool is the fallback, never the first channel: take it when --start exits 2, when --wait exits 4"), "{block}");
        assert!(lines[5].contains("cannot hold a blocking --wait at all"), "{block}");
        assert!(lines[5].contains("asks nothing about the build path"), "{block}");
        assert!(!block.contains('\u{2014}'), "no em dashes: {block}");
        assert!(out.ends_with('\n'));
    }

    #[test]
    fn surface_roll_carries_wireframes_and_no_pick_or_canon() {
        // Persuade: the comp-led surface wording. Operate and Read surface rounds are code-led
        // (operate_and_read_surfaces_are_code_led_whatever_is_recorded).
        let (proj, skill) = fixture("present-surface", &[("mode-persuade", MODE_FILE)]);
        let (code, out) = seed(&proj, &skill, true, &["--scope", "surface", "--mode", "persuade", "--from", "k1"]);
        assert_eq!(code, 0, "{out}");
        let block = presentation(&out);
        assert!(block.contains(PRESENT_FIRST_LINE), "{block}");
        assert!(block.contains("- With image generation, each dealt card declares a comp under .impeccable/mocks/decision/; serve first"), "{block}");
        assert!(block.contains("Without image generation, each card carries an HTML sketch: one self-contained file of the first viewport only"), "{block}");
        assert!(!block.contains("canon included"), "{block}");
    }

    #[test]
    fn rerolls_deliver_through_update_on_the_same_key() {
        let (proj, skill) = fixture("present-reroll", &[("mode-persuade", MODE_FILE)]);
        for args in [
            &["--scope", "direction", "--mode", "persuade", "--from", "k1", "--reroll", "1"][..],
            &["--scope", "direction", "--mode", "persuade", "--from", "k1", "--reroll", "2", "--register", "bolder"][..],
            &["--scope", "direction", "--from", "k1", "--reroll", "1", "--register", "safer"][..],
            &["--scope", "surface", "--mode", "persuade", "--from", "k1", "--reroll", "1"][..],
        ] {
            let (code, out) = seed(&proj, &skill, true, args);
            assert_eq!(code, 0, "{out}");
            let block = presentation(&out);
            assert!(block.contains("- Re-roll round: while the page is open on a key, deliver this hand to it with `impeccable serve-question --update --key <same key> --payload <file>` and never --start a second server. A re-roll made before any page opened starts one with `impeccable serve-question --start --payload <file>`;"), "{args:?}: {block}");
            assert!(!block.contains("- Present this hand"), "{args:?}: {block}");
        }
    }

    #[test]
    fn degraded_rolls_present_on_the_page_too() {
        let (proj, skill) = fixture("present-degraded", &[("mode-persuade", MODE_FILE)]);
        let (_, out) = seed(&proj, &skill, false, &["--scope", "direction", "--mode", "persuade", "--from", "k1"]);
        assert!(out.contains("source: degraded"), "{out}");
        let block = presentation(&out);
        assert!(block.contains(PRESENT_FIRST_LINE), "{block}");
        assert!(block.contains("- This degraded hand goes on the page as a single text-only card with re-roll; it declares no comp."), "{block}");
        assert!(block.contains("- Right after serving, with no comp to generate first, hold `impeccable serve-question --wait --key <key>`."), "{block}");
        // Degraded safer keeps its lineup: the full-hand comp line, not one card.
        let (_, out) = seed(&proj, &skill, false, &["--scope", "direction", "--from", "k1", "--reroll", "1", "--register", "safer"]);
        let block = presentation(&out);
        assert!(block.contains("- Re-roll round:"), "{block}");
        assert!(!block.contains("single text-only card"), "{block}");
        assert!(block.contains("every card declares a comp"), "{block}");
        let (_, out) = seed(&proj, &skill, false, &["--scope", "direction", "--from", "k1", "--reroll", "1", "--register", "bolder"]);
        assert!(presentation(&out).contains("single text-only card"), "{out}");
        let (_, out) = seed(&proj, &skill, false, &["--scope", "surface", "--mode", "persuade", "--from", "k1"]);
        assert!(presentation(&out).contains("each dealt card declares a comp"), "{out}");
    }

    #[test]
    fn operate_and_read_surfaces_are_code_led_whatever_is_recorded() {
        let (proj, skill) = fixture("present-mode-code-led", &[("mode-operate", MODE_FILE), ("mode-read", MODE_FILE), ("mode-persuade", MODE_FILE)]);
        let dir = proj.join(".impeccable");
        std::fs::create_dir_all(&dir).unwrap();
        let roll = |scope: &str, mode: &str| seed(&proj, &skill, true, &["--scope", scope, "--mode", mode, "--from", "k1"]).1;

        // Nothing recorded: Operate and Read are code-led, Persuade and Experience keep the comp default.
        for mode in ["operate", "read"] {
            let out = roll("direction", mode);
            let block = presentation(&out);
            assert!(block.contains(&format!("- Build path: code-led. A surface in {mode} mode builds in code whatever the project records. With image generation, put \"buildPath\": {{\"value\": \"code\", \"toggle\": true}} in the payload")), "{block}");
            assert!(block.contains("never offer to record a flip made on this surface"), "{block}");
            assert!(block.contains("- Code-led round: every card but the declined challengers carries an HTML sketch"), "{block}");
            assert!(block.contains("- After the last sketch lands, hold `impeccable serve-question --wait --key <key>`."), "{block}");
            assert!(presentation(&roll("surface", mode)).contains("- Code-led round: each dealt card carries an HTML sketch"), "{mode}");
        }
        for mode in ["persuade", "experience"] {
            assert!(presentation(&roll("direction", mode)).contains("- Build path: none recorded"), "{mode}");
        }

        // A recorded comp default still governs Persuade, and is named, not followed, on Operate and Read.
        std::fs::write(dir.join("config.json"), r#"{"buildPath": "comp"}"#).unwrap();
        let out = roll("direction", "operate");
        let block = presentation(&out);
        assert!(block.contains("- Build path: code-led. A surface in operate mode builds in code whatever the project records (the recorded default comp from .impeccable/config.json governs Persuade and Experience surfaces)."), "{block}");
        assert!(block.contains("\"buildPath\": {\"value\": \"code\", \"toggle\": true}"), "{block}");
        assert!(!block.contains("Serve first, then generate each comp in reading order"), "{block}");
        assert!(presentation(&roll("direction", "persuade")).contains("- Build path: recorded default comp (from .impeccable/config.json)."));

        // A recorded code default reads the same on Operate, with nothing extra to name.
        std::fs::write(dir.join("config.json"), r#"{"buildPath": "code"}"#).unwrap();
        assert!(presentation(&roll("direction", "read")).contains("A surface in read mode builds in code whatever the project records. With image generation"));
    }

    #[test]
    fn build_path_line_names_the_recorded_default() {
        let (proj, skill) = fixture("present-build-path", &[("mode-persuade", MODE_FILE)]);
        let dir = proj.join(".impeccable");
        std::fs::create_dir_all(&dir).unwrap();
        let roll = |scope: &str| seed(&proj, &skill, true, &["--scope", scope, "--mode", "persuade", "--from", "k1"]).1;

        std::fs::write(dir.join("config.json"), r#"{"buildPath": "code"}"#).unwrap();
        let out = roll("direction");
        let block = presentation(&out);
        assert!(block.contains("- Build path: recorded default code (from .impeccable/config.json). With image generation, put \"buildPath\": {\"value\": \"code\", \"toggle\": true} in the payload; without it there is no toggle and the build is code-led. Never ask the user about the build path."), "{block}");
        assert!(block.contains("- Code-led round: every card but the declined challengers carries an HTML sketch"), "{block}");
        assert!(block.contains("only when --wait prints BUILD PATH FLIPPED"), "{block}");
        assert!(block.contains("- After the last sketch lands, hold `impeccable serve-question --wait --key <key>`."), "{block}");
        let out = roll("surface");
        assert!(presentation(&out).contains("- Code-led round: each dealt card carries an HTML sketch"), "{out}");

        // The machine-local file wins over the committed one.
        std::fs::write(dir.join("config.local.json"), r#"{"buildPath": "comp"}"#).unwrap();
        let out = roll("direction");
        let block = presentation(&out);
        assert!(block.contains("- Build path: recorded default comp (from .impeccable/config.local.json)."), "{block}");
        assert!(block.contains("\"buildPath\": {\"value\": \"comp\", \"toggle\": true}"), "{block}");
        assert!(block.contains("Serve first, then generate each comp in reading order"), "{block}");

        // Only exact comp / code count; anything else reads as unrecorded.
        std::fs::remove_file(dir.join("config.local.json")).unwrap();
        std::fs::write(dir.join("config.json"), r#"{"buildPath": "comp-first"}"#).unwrap();
        let out = roll("direction");
        assert!(presentation(&out).contains("- Build path: none recorded"), "{out}");
    }

    #[test]
    fn telemetry_pings_print_no_presentation() {
        let (proj, skill) = fixture("present-ping", &[]);
        let (_, out) = seed(&proj, &skill, true, &["--kind", "assigned", "--from", "k1", "--scope", "direction"]);
        assert!(!out.contains("PRESENTATION"), "{out}");
    }

    #[test]
    fn every_roll_records_its_scope_for_serve_question() {
        let (proj, skill) = fixture("roll-record", &[]);
        let record = proj.join(".impeccable/questions/roll.json");
        let read = || serde_json::from_str::<Value>(&std::fs::read_to_string(&record).unwrap()).unwrap();
        // Invalid arguments and telemetry pings are not rolls.
        let (code, _) = seed(&proj, &skill, true, &["--scope", "world", "--from", "k1"]);
        assert_eq!(code, 1);
        seed(&proj, &skill, true, &["--chosen", "x", "--kind", "assigned", "--from", "k1", "--scope", "surface"]);
        assert!(!record.exists());
        // A surface roll, then a direction re-roll replacing it.
        let (code, _) = seed(&proj, &skill, true, &["--scope", "surface", "--mode", "operate", "--from", "k1"]);
        assert_eq!(code, 0);
        let r = read();
        // The record names the roll by its seed reference, never its key, and holds no time.
        let k1 = tl(&proj).reference("k1").unwrap();
        assert_eq!((r["scope"].as_str(), r["seed"].as_str(), r["reroll"].as_u64()), (Some("surface"), Some(k1.as_str()), Some(0)));
        assert!(r.get("key").is_none() && r.get("at").is_none(), "{r}");
        // The record names every challenger the roll printed, with the same
        // board and hero URLs as its QUALITY BAR line.
        let (_, out) = seed(&proj, &skill, true, &["--scope", "surface", "--mode", "operate", "--from", "k1"]);
        let worlds = read()["worlds"].as_array().cloned().unwrap();
        assert_eq!(worlds.len(), out.matches("     SOURCE ID: ").count().min(out.matches("     QUALITY BAR: ").count()));
        assert!(!worlds.is_empty());
        for w in &worlds {
            let (id, board, hero) = (w["id"].as_str().unwrap(), w["board"].as_str().unwrap(), w["hero"].as_str().unwrap());
            assert!(out.contains(&format!("     SOURCE ID: {id}\n")), "{id}: {out}");
            assert!(out.contains(&format!("     QUALITY BAR: board {board} · hero {hero}")), "{id}: {out}");
        }
        // The safer register prints no challenger, so it records no world.
        seed(&proj, &skill, true, &["--scope", "direction", "--from", "k1", "--reroll", "1", "--register", "safer"]);
        assert!(read().get("worlds").is_none(), "{}", read());
        let (code, _) = seed(&proj, &skill, false, &["--scope", "direction", "--from", "k2", "--reroll", "1"]);
        assert_eq!(code, 0);
        let r = read();
        let k2 = tl(&proj).reference("k2").unwrap();
        assert_eq!((r["scope"].as_str(), r["seed"].as_str(), r["reroll"].as_u64()), (Some("direction"), Some(k2.as_str()), Some(1)));
        // A degraded roll dealt no world: the record keeps its old shape.
        assert!(r.get("worlds").is_none(), "{r}");
    }

    /// A stand-in roll API on loopback: answers `GET /api/roll` with two
    /// dealt worlds and `POST /api/chosen` with 200, and records every
    /// request as (method, url, X-Impeccable-Client, body).
    type Seen = std::sync::Arc<std::sync::Mutex<Vec<(String, String, String, String, String)>>>;
    fn roll_api() -> (String, Seen) {
        roll_api_with_compositions_only(false)
    }

    fn roll_api_with_compositions_only(compositions_only: bool) -> (String, Seen) {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}/api", server.server_addr().to_ip().unwrap().port());
        let seen: Seen = Default::default();
        let log = seen.clone();
        std::thread::spawn(move || {
            for mut req in server.incoming_requests() {
                let header = req.headers().iter().find(|h| h.field.equiv("X-Impeccable-Client")).map(|h| h.value.as_str().to_string()).unwrap_or_default();
                let mut body = String::new();
                let _ = std::io::Read::read_to_string(req.as_reader(), &mut body);
                let off = req.headers().iter().find(|h| h.field.equiv("X-Impeccable-Telemetry")).map(|h| h.value.as_str().to_string()).unwrap_or_default();
                log.lock().unwrap().push((req.method().as_str().to_string(), req.url().to_string(), header, body, off));
                let roll = serde_json::json!({
                    "poolRevision": "0123456789ab", "handId": "00112233445566778899aabbccddeeff", "approvedCount": 2, "catalogCount": 3,
                    "challengers": [
                        { "id": "teletext-service", "form": "Teletext", "spark": "s", "system": ["r"], "webLeverage": "w" },
                        { "id": "microfiche-reader", "form": "Microfiche", "spark": "s", "system": ["r"], "webLeverage": "w" }
                    ]
                });
                let roll = if compositions_only {
                    serde_json::json!({
                        "poolRevision": "0123456789ab", "handId": "00112233445566778899aabbccddeeff", "approvedCount": 2, "catalogCount": 3,
                        "compositions": [{ "id": "working-layout", "form": "Working layout", "spark": "composition evidence", "system": ["Keep the hierarchy"], "webLeverage": "Responsive structure" }]
                    })
                } else { roll };
                let text = if req.url().starts_with("/api/roll") { roll.to_string() } else { "{}".to_string() };
                let _ = req.respond(tiny_http::Response::from_string(text));
            }
        });
        (base, seen)
    }

    fn seed_api(proj: &std::path::Path, skill: &std::path::Path, base: &str, args: &[&str]) -> String {
        seed_api_options(proj, skill, base, args, false, false)
    }

    fn seed_api_options(proj: &std::path::Path, skill: &std::path::Path, base: &str, args: &[&str], compositions: bool, off: bool) -> String {
        let env = Env::from([
            ("IMPECCABLE_COMPOSITIONS".into(), if compositions { "1" } else { "0" }.into()),
            ("IMPECCABLE_NO_TELEMETRY".into(), if off { "1" } else { "0" }.into()),
            ("IMPECCABLE_SKILL_DIR".into(), skill.to_string_lossy().into_owned()),
            ("IMPECCABLE_CATALOG_DIR".into(), proj.join("no-such-catalog").to_string_lossy().into_owned()),
            ("IMPECCABLE_API_URL".into(), base.to_string()),
            ("IMPECCABLE_API_TIMEOUT".into(), "3000".into()),
            ("IMPECCABLE_TELEMETRY_CHANNEL".into(), "test".into()),
            ("HOME".into(), proj.join("home").to_string_lossy().into_owned()),
            ("USERPROFILE".into(), proj.join("home").to_string_lossy().into_owned()),
            ("IMPECCABLE_SEED_SALT".into(), "test-salt".into()),
            ("IMPECCABLE_NO_STALENESS_CHECK".into(), "1".into()),
            ("IMPECCABLE_SELF".into(), "impeccable".into()),
        ]);
        let (mut io, cap) = Io::captured("", proj.to_path_buf(), env);
        let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        assert_eq!(run(&argv, &mut io), 0);
        let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
        out
    }

    /// The bodies posted to /api/chosen, each round's random pingId masked.
    fn chosen_bodies(seen: &Seen) -> Vec<String> {
        let ping = regex::Regex::new(r#","pingId":"[0-9a-f]{32}""#).unwrap();
        seen.lock().unwrap().iter().filter(|r| r.0 == "POST").map(|r| ping.replace(&r.3, r#","pingId":"<PING>""#).into_owned()).collect()
    }

    #[test]
    fn settled_rolls_skip_world_only_api_requests_and_keep_composition_headers() {
        let (proj, skill) = fixture("settled-api", &[("mode-persuade", MODE_FILE)]);
        std::fs::write(proj.join("DESIGN.md"), "---\nworld: teletext-service\n---\n").unwrap();
        let (base, seen) = roll_api_with_compositions_only(true);
        for scope in ["surface", "direction"] {
            let out = seed_api(&proj, &skill, &base, &["--scope", scope, "--from", "k1"]);
            assert!(out.contains("WORLD: settled (teletext-service, seeded from the catalog)."));
            assert!(!out.contains("CHALLENGERS:"));
            assert!(seen.lock().unwrap().is_empty());
            assert!(out.contains("source: settled; approved pool: none; 0/0 human-approved"));
            assert!(out.contains("PRESENTATION"));
            assert!(!out.contains("rerun this command once"));
        }
        for off in [false, true] {
            let out = seed_api_options(&proj, &skill, &base, &["--scope", "surface", "--from", "k1"], true, off);
            assert!(out.contains("WORLD: settled (teletext-service, seeded from the catalog)."));
            assert!(!out.contains("QUALITY BAR:"));
            assert!(!out.contains("Microfiche"));
            assert!(out.contains("COMPOSITION CHALLENGERS (identity-free;"), "{out}");
            assert!(out.contains("Working layout"), "{out}");
            assert!(out.contains("TELEMETRY:"), "{out}");
            let req = seen.lock().unwrap().last().unwrap().clone();
            assert_eq!(req.0, "GET");
            assert!(req.2.starts_with("impeccable/"));
            assert_eq!(req.4, if off { "off" } else { "" });
        }
        assert_eq!(seen.lock().unwrap().len(), 2);
        // A server that still sends worlds cannot leak them into the roll or ledger.
        let (base, _) = roll_api();
        let out = seed_api_options(&proj, &skill, &base, &["--scope", "surface", "--from", "k2"], true, false);
        assert!(!out.contains("QUALITY BAR:"));
        assert!(!out.contains("Microfiche"));
        let round = tl(&proj).round("k2", Some(0)).unwrap();
        assert!(round.dealt.is_empty());
        assert_eq!(round.pool_revision.as_deref(), Some("0123456789ab"));
    }

    #[test]
    fn api_rolls_send_the_client_header_and_record_the_pool_revision() {
        let (proj, skill) = fixture("api-roll", &[("mode-persuade", MODE_FILE)]);
        let (base, seen) = roll_api();
        let engine = format!("impeccable/{}+engine test", env!("CARGO_PKG_VERSION"));
        let out = seed_api(&proj, &skill, &base, &["--scope", "direction", "--mode", "persuade", "--from", "k1"]);
        assert!(out.contains("source: api; approved pool: 0123456789ab"), "{out}");
        assert!(out.contains("--from k1 --scope direction --mode persuade plus what the user did:\n"), "round 0 carries no --reroll: {out}");
        let roll = seen.lock().unwrap()[0].clone();
        assert_eq!((roll.0.as_str(), roll.2.as_str(), roll.4.as_str()), ("GET", engine.as_str(), ""));
        let record: Value = serde_json::from_str(&std::fs::read_to_string(proj.join(".impeccable/questions/roll.json")).unwrap()).unwrap();
        assert_eq!(record["poolRevision"], "0123456789ab");
        assert_eq!(record["source"], "api");
        assert_eq!(record["mode"], "persuade");
        let round = tl(&proj).round("k1", Some(0)).unwrap();
        assert_eq!(round.dealt, vec!["teletext-service", "microfiche-reader"]);
        assert_eq!(round.pool_revision.as_deref(), Some("0123456789ab"));

        // A re-roll's TELEMETRY line names its round.
        let out = seed_api(&proj, &skill, &base, &["--scope", "direction", "--mode", "persuade", "--from", "k1", "--reroll", "2"]);
        assert!(out.contains("--from k1 --scope direction --mode persuade --reroll 2 plus what the user did:\n"), "{out}");
    }

    #[test]
    fn agent_pings_fill_the_round_from_the_ledger_and_send_only_dealt_ids() {
        let (proj, skill) = fixture("api-ping", &[("mode-persuade", MODE_FILE)]);
        let (base, seen) = roll_api();
        seed_api(&proj, &skill, &base, &["--scope", "direction", "--mode", "persuade", "--from", "k1"]);
        seed_api(&proj, &skill, &base, &["--scope", "direction", "--mode", "persuade", "--from", "k1", "--reroll", "1"]);
        // No --reroll: the latest round. An agent-invented id is dropped and the kind still goes.
        let out = seed_api(&proj, &skill, &base, &["--kind", "challenger", "--chosen", "challenger-teletext", "--from", "k1", "--scope", "direction", "--mode", "persuade"]);
        assert_eq!(out, "choice recorded\n");
        assert_eq!(chosen_bodies(&seen).last().unwrap(), r#"{"key":"k1","scope":"direction","mode":"persuade","kind":"challenger","reroll":1,"poolRevision":"0123456789ab","handId":"00112233445566778899aabbccddeeff","pingId":"<PING>","source":"agent"}"#);
        let post = seen.lock().unwrap().iter().rfind(|r| r.0 == "POST").cloned().unwrap();
        assert_eq!((post.1.as_str(), post.2.as_str()), ("/api/chosen", format!("impeccable/{}+engine test", env!("CARGO_PKG_VERSION")).as_str()));
        // The same round again: already sent.
        let out = seed_api(&proj, &skill, &base, &["--kind", "assigned", "--from", "k1", "--scope", "direction", "--reroll", "1"]);
        assert_eq!(out, "choice already recorded\n");
        // Round 0 by --reroll: a dealt catalog id passes.
        let out = seed_api(&proj, &skill, &base, &["--kind", "challenger", "--chosen", "microfiche-reader", "--from", "k1", "--scope", "direction", "--reroll", "0"]);
        assert_eq!(out, "choice recorded\n");
        assert_eq!(chosen_bodies(&seen).last().unwrap(), r#"{"chosenId":"microfiche-reader","key":"k1","scope":"direction","kind":"challenger","reroll":0,"poolRevision":"0123456789ab","handId":"00112233445566778899aabbccddeeff","pingId":"<PING>","source":"agent"}"#);
        // No ledger for the key: sent as given, with the --reroll round.
        let n = chosen_bodies(&seen).len();
        let out = seed_api(&proj, &skill, &base, &["--kind", "challenger", "--chosen", "own-grounded-3", "--from", "k9", "--scope", "direction", "--reroll", "3"]);
        assert_eq!(out, "choice recorded\n");
        assert_eq!(chosen_bodies(&seen)[n], r#"{"chosenId":"own-grounded-3","key":"k9","scope":"direction","kind":"challenger","reroll":3,"source":"agent"}"#);
        // An out-of-range --reroll is ignored rather than sent.
        seed_api(&proj, &skill, &base, &["--kind", "pick", "--from", "k8", "--scope", "direction", "--reroll", "12"]);
        assert_eq!(chosen_bodies(&seen).last().unwrap(), r#"{"key":"k8","scope":"direction","kind":"pick","reroll":0,"source":"agent"}"#);
    }

    #[test]
    fn agent_pings_report_rejected_hands_and_cards_by_position() {
        let (proj, skill) = fixture("api-ping-reroll", &[("mode-persuade", MODE_FILE)]);
        let (base, seen) = roll_api();
        seed_api(&proj, &skill, &base, &["--scope", "surface", "--mode", "operate", "--from", "s1"]);
        // A surface round's dealt structure other than the lead goes by position.
        let out = seed_api(&proj, &skill, &base, &["--option", "2", "--from", "s1", "--scope", "surface", "--mode", "operate"]);
        assert_eq!(out, "choice recorded\n");
        assert_eq!(chosen_bodies(&seen).last().unwrap(), r#"{"key":"s1","scope":"surface","mode":"operate","option":2,"reroll":0,"poolRevision":"0123456789ab","handId":"00112233445566778899aabbccddeeff","pingId":"<PING>","source":"agent"}"#);
        // A rejected hand: kind reroll, the steer as register, never a card id.
        seed_api(&proj, &skill, &base, &["--scope", "direction", "--from", "d1"]);
        let out = seed_api(&proj, &skill, &base, &["--kind", "reroll", "--chosen", "teletext-service", "--register", "bolder", "--from", "d1", "--scope", "direction"]);
        assert_eq!(out, "choice recorded\n");
        assert_eq!(chosen_bodies(&seen).last().unwrap(), r#"{"key":"d1","scope":"direction","kind":"reroll","register":"bolder","reroll":0,"poolRevision":"0123456789ab","handId":"00112233445566778899aabbccddeeff","pingId":"<PING>","source":"agent"}"#);
        assert_eq!(seed_api(&proj, &skill, &base, &["--kind", "assigned", "--from", "d1", "--scope", "direction"]), "choice already recorded\n");
        // The surface TELEMETRY line names the position flag and the re-roll report.
        let out = seed_api(&proj, &skill, &base, &["--scope", "surface", "--mode", "operate", "--from", "s2"]);
        assert!(out.contains("--option <n>"), "{out}");
        assert!(out.contains("--kind reroll"), "{out}");
    }

    #[test]
    fn a_seed_reference_stands_for_its_key_on_the_machine_that_rolled_it() {
        let (proj, skill) = fixture("seed-reference", &[("mode-persuade", MODE_FILE)]);
        let (base, seen) = roll_api();
        let first = seed_api(&proj, &skill, &base, &["--scope", "direction", "--mode", "persuade", "--from", "3f9a1c2e"]);
        let reference = tl(&proj).reference("3f9a1c2e").unwrap();
        assert!(first.contains(&format!("SEED REFERENCE: {reference}.")), "{first}");
        // The reference reproduces the same deal and asks the API with the real key.
        let again = seed_api(&proj, &skill, &base, &["--scope", "direction", "--mode", "persuade", "--from", &reference]);
        assert_eq!(again, first);
        assert!(seen.lock().unwrap().iter().filter(|r| r.0 == "GET").all(|r| r.1.contains("key=3f9a1c2e")), "{:?}", seen.lock().unwrap());
        // The ping by reference carries the key.
        assert_eq!(seed_api(&proj, &skill, &base, &["--kind", "assigned", "--from", &reference, "--scope", "direction"]), "choice recorded\n");
        assert!(chosen_bodies(&seen).last().unwrap().contains(r#""key":"3f9a1c2e""#));
        // A reference rolled elsewhere is refused with the way out, never rolled as a key.
        let env = Env::from([
            ("IMPECCABLE_SKILL_DIR".into(), skill.to_string_lossy().into_owned()),
            ("IMPECCABLE_NO_STALENESS_CHECK".into(), "1".into()),
            ("IMPECCABLE_SEED_SALT".into(), "test-salt".into()),
            ("HOME".into(), proj.join("home").to_string_lossy().into_owned()),
        ]);
        let (mut io, cap) = Io::captured("", proj.clone(), env);
        let unknown = tl(&proj).reference("elsewhere").unwrap();
        let argv: Vec<String> = ["--scope", "direction", "--from", unknown.as_str()].iter().map(|s| s.to_string()).collect();
        assert_eq!(run(&argv, &mut io), 1);
        let err = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
        assert!(err.contains("is a seed reference this machine has no record of") && err.contains("pass the original key with --from"), "{err}");
        let n = chosen_bodies(&seen).len();
        assert_eq!(seed_api(&proj, &skill, &base, &["--kind", "assigned", "--from", &unknown, "--scope", "direction"]), "choice ping skipped\n");
        assert_eq!(chosen_bodies(&seen).len(), n);
    }

    #[test]
    fn opted_out_rolls_still_roll_and_tell_the_server_to_record_nothing() {
        let (proj, skill) = fixture("opt-out", &[("mode-persuade", MODE_FILE)]);
        let (base, seen) = roll_api();
        let home = proj.join("home");
        std::fs::create_dir_all(home.join(".impeccable")).unwrap();
        std::fs::write(home.join(".impeccable/config.json"), r#"{"telemetry": false}"#).unwrap();
        let out = seed_api(&proj, &skill, &base, &["--scope", "direction", "--from", "k1"]);
        assert!(out.contains("source: api;"), "the roll still happens: {out}");
        let roll = seen.lock().unwrap()[0].clone();
        assert_eq!(roll.0, "GET");
        assert_eq!(roll.4, "off", "the server is told not to record it");
        // No telemetry fields are written, only the key behind the reference.
        let record: Value = serde_json::from_str(&std::fs::read_to_string(proj.join(".impeccable/questions/roll.json")).unwrap()).unwrap();
        assert!(record.get("poolRevision").is_none() && record.get("source").is_none(), "{record}");
        assert_eq!(tl(&proj).round("k1", None), None);
        assert_eq!(tl(&proj).resolve(&tl(&proj).reference("k1").unwrap()).unwrap(), "k1");
        assert_eq!(seed_api(&proj, &skill, &base, &["--kind", "assigned", "--from", "k1", "--scope", "direction"]), "choice ping skipped\n");
        assert!(chosen_bodies(&seen).is_empty());
        // DO_NOT_TRACK=0 is not an opt-out.
        std::fs::remove_file(home.join(".impeccable/config.json")).unwrap();
        assert!(!telemetry::telemetry_disabled(&Env::from([("DO_NOT_TRACK".into(), "0".into()), ("HOME".into(), home.to_string_lossy().into_owned())]), &proj.to_string_lossy()));
    }

    #[test]
    fn without_a_salt_the_roll_offers_no_reference_and_records_no_seed() {
        let (proj, skill) = fixture("no-salt", &[("mode-persuade", MODE_FILE)]);
        let home = proj.join("home");
        std::fs::create_dir_all(home.join(".impeccable")).unwrap();
        std::fs::write(home.join(".impeccable/seed-salt"), "corrupt\n").unwrap();
        let env = Env::from([
            ("IMPECCABLE_SKILL_DIR".into(), skill.to_string_lossy().into_owned()),
            ("IMPECCABLE_CATALOG_DIR".into(), std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/concept-catalog").to_string_lossy().into_owned()),
            ("IMPECCABLE_API_URL".into(), "http://127.0.0.1:9/api".into()),
            ("IMPECCABLE_NO_TELEMETRY".into(), "1".into()),
            ("IMPECCABLE_NO_STALENESS_CHECK".into(), "1".into()),
            ("HOME".into(), home.to_string_lossy().into_owned()),
            ("USERPROFILE".into(), home.to_string_lossy().into_owned()),
        ]);
        let (mut io, cap) = Io::captured("", proj.clone(), env);
        let argv: Vec<String> = ["--scope", "direction", "--from", "k1"].iter().map(|s| s.to_string()).collect();
        assert_eq!(run(&argv, &mut io), 0);
        let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
        assert!(out.contains("SEED REFERENCE: unavailable on this machine") && out.contains("`seed: none (unavailable)`") && !out.contains("SEED REFERENCE: seed:"), "{out}");
        let record: Value = serde_json::from_str(&std::fs::read_to_string(proj.join(".impeccable/questions/roll.json")).unwrap()).unwrap();
        assert!(record.get("seed").is_none() && record.get("key").is_none(), "{record}");
    }

    #[test]
    fn check_seed_corroborates_a_reference_against_this_machine() {
        let (proj, skill) = fixture("check-seed", &[("mode-persuade", MODE_FILE)]);
        let check = |v: &str| {
            let env = Env::from([("IMPECCABLE_SEED_SALT".into(), "test-salt".into()), ("HOME".into(), proj.join("home").to_string_lossy().into_owned())]);
            let (mut io, cap) = Io::captured("", proj.clone(), env);
            let code = run(&["--check-seed".to_string(), v.to_string()], &mut io);
            let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
            (code, out)
        };
        let reference = tl(&proj).reference("k1").unwrap();
        assert_eq!(check(&reference).0, 1, "not rolled yet");
        seed(&proj, &skill, true, &["--scope", "direction", "--from", "k1"]);
        let (code, out) = check(&reference);
        assert_eq!((code, out.starts_with("SEED KNOWN")), (0, true), "{out}");
        assert!(check("k1").1.starts_with("SEED UNKNOWN: not a seed reference"));
        assert_eq!(check("none").0, 1, "a salt exists here, so none means skipped");
    }

    #[test]
    fn a_key_keeps_one_salt_one_ledger_and_one_reference_across_every_salt_switch() {
        // (name, home for round 0, what changes, home for round 1)
        #[derive(Clone, Copy)]
        enum Home {
            Writable,
            Blocked,
        }
        #[derive(Clone, Copy)]
        enum Switch {
            Nothing,
            HomeSaltAppears,
            StrayProjectSalt,
        }
        let table = [
            ("project then home appears", Home::Blocked, Switch::HomeSaltAppears, Home::Writable),
            ("home then stray project", Home::Writable, Switch::StrayProjectSalt, Home::Writable),
            ("home only", Home::Writable, Switch::Nothing, Home::Writable),
            ("project only", Home::Blocked, Switch::Nothing, Home::Blocked),
            ("home becomes unusable", Home::Writable, Switch::Nothing, Home::Blocked),
        ];
        for (i, (name, before, switch, after)) in table.into_iter().enumerate() {
            let (proj, skill) = fixture(&format!("salt-table-{i}"), &[("mode-persuade", MODE_FILE)]);
            let (base, seen) = roll_api();
            // A home that cannot hold a directory stands in for a sandbox's read-only one.
            let blocked = proj.join("blocked-home");
            std::fs::write(&blocked, "").unwrap();
            let writable = proj.join("home");
            std::fs::create_dir_all(&writable).unwrap();
            let home_of = |h: Home| match h {
                Home::Writable => writable.clone(),
                Home::Blocked => blocked.clone(),
            };
            let env_for = |h: Home| {
                let h = home_of(h).to_string_lossy().into_owned();
                Env::from([
                    ("IMPECCABLE_SKILL_DIR".into(), skill.to_string_lossy().into_owned()),
                    ("IMPECCABLE_CATALOG_DIR".into(), proj.join("no-such-catalog").to_string_lossy().into_owned()),
                    ("IMPECCABLE_API_URL".into(), base.clone()),
                    ("IMPECCABLE_API_TIMEOUT".into(), "3000".into()),
                    ("IMPECCABLE_NO_STALENESS_CHECK".into(), "1".into()),
                    ("IMPECCABLE_SELF".into(), "impeccable".into()),
                    ("HOME".into(), h.clone()),
                    ("USERPROFILE".into(), h),
                ])
            };
            let call = |h: Home, args: &[&str]| -> (i32, String) {
                let (mut io, cap) = Io::captured("", proj.clone(), env_for(h));
                let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
                let code = run(&argv, &mut io);
                let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
                (code, out)
            };
            let reference_in = |out: &str| -> String {
                let line = out.lines().find(|l| l.starts_with("SEED REFERENCE: ")).unwrap_or_else(|| panic!("{name}: no reference line: {out}"));
                line.trim_start_matches("SEED REFERENCE: ").split('.').next().unwrap().to_string()
            };
            let (code, out0) = call(before, &["--scope", "direction", "--from", "k1"]);
            assert_eq!(code, 0, "{name}");
            let ref0 = reference_in(&out0);
            assert!(ref0.starts_with("seed:"), "{name}: {ref0}");
            match switch {
                Switch::Nothing => {}
                Switch::HomeSaltAppears => {
                    std::fs::create_dir_all(writable.join(".impeccable")).unwrap();
                    std::fs::write(writable.join(".impeccable/seed-salt"), "0123456789abcdef0123456789abcdef\n").unwrap();
                }
                Switch::StrayProjectSalt => {
                    std::fs::write(proj.join(".impeccable/questions/seed-salt"), "fedcba9876543210fedcba9876543210\n").unwrap();
                }
            }
            let (code, out1) = call(after, &["--scope", "direction", "--from", "k1", "--reroll", "1"]);
            assert_eq!(code, 0, "{name}");
            assert_eq!(reference_in(&out1), ref0, "{name}: one reference per key");
            let ledgers: Vec<String> = std::fs::read_dir(proj.join(".impeccable/questions/seeds")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".json")).collect();
            assert_eq!(ledgers, vec![format!("{}.json", ref0.trim_start_matches("seed:"))], "{name}: one ledger, named by the reference");
            // The reference resolves: --check-seed, and --from reproduces round 1.
            let (code, out) = call(after, &["--check-seed", &ref0]);
            assert_eq!(code, 0, "{name}: {out}");
            let (code, again) = call(after, &["--scope", "direction", "--from", &ref0, "--reroll", "1"]);
            assert_eq!((code, again == out1), (0, true), "{name}: --from by reference reproduces the deal");
            // The page claims and confirms round 1, and the agent's rerun is a no-op.
            let l = telemetry::Ledger::new(&env_for(after), &proj.to_string_lossy());
            let claimed = l.claim("k1", 1).unwrap_or_else(|| panic!("{name}: the page's claim"));
            l.confirm("k1", 1, "picker", claimed.ping_id.as_deref());
            assert_eq!(call(after, &["--kind", "assigned", "--from", &ref0, "--scope", "direction", "--reroll", "1"]).1, "choice already recorded\n", "{name}");
            // Round 0's report goes out from the agent with that round's own pingId.
            let r0 = l.round("k1", Some(0)).unwrap_or_else(|| panic!("{name}: round 0"));
            assert_eq!(call(after, &["--kind", "assigned", "--from", "k1", "--scope", "direction", "--reroll", "0"]).1, "choice recorded\n", "{name}");
            let body = seen.lock().unwrap().iter().rfind(|r| r.0 == "POST").unwrap().3.clone();
            assert!(body.contains(&format!(r#""pingId":"{}""#, r0.ping_id.unwrap())), "{name}: {body}");
        }
    }

    #[test]
    fn a_generated_key_takes_the_primary_salt_and_resolves() {
        let (proj, skill) = fixture("fresh-key", &[("mode-persuade", MODE_FILE)]);
        let (code, out) = seed(&proj, &skill, true, &["--scope", "direction"]);
        assert_eq!(code, 0, "{out}");
        let reference = out.lines().find_map(|l| l.strip_prefix("SEED REFERENCE: ")).unwrap().split('.').next().unwrap().to_string();
        let ledgers: Vec<String> = std::fs::read_dir(proj.join(".impeccable/questions/seeds")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".json")).collect();
        assert_eq!(ledgers, vec![format!("{}.json", reference.trim_start_matches("seed:"))]);
        let key = tl(&proj).resolve(&reference).unwrap();
        assert!(key.len() == 32 && key.bytes().all(|b| b.is_ascii_hexdigit()), "{key}");
        assert_eq!(tl(&proj).reference(&key).unwrap(), reference, "the searched path agrees with the fresh one");
    }
}
