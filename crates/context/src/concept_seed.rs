//! JS: concept-seed.mjs -> `impeccable concept-seed`

use crate::catalog::*;
use crate::context::load_context;
use crate::jsp;
use crate::roll_selection::*;
use crate::seed_text as t;
use crate::target_args::TargetOptions;
use crate::util::Env;
use impeccable_common::Io;
use serde_json::{Map, Value};
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
        let ms = env.get("IMPECCABLE_API_TIMEOUT").filter(|v| !v.is_empty()).map(|v| crate::critique_storage::js_number(v)).unwrap_or(4000.0);
        let ms = if ms.is_nan() { 0.0 } else { ms.max(0.0) };
        ApiBudget { deadline: None, timeout: Duration::from_millis(ms as u64) }
    }
    fn remaining(&mut self) -> Duration {
        let d = *self.deadline.get_or_insert_with(|| Instant::now() + self.timeout);
        d.saturating_duration_since(Instant::now())
    }
}

fn api_base(env: &Env) -> String {
    let base = env.get("IMPECCABLE_API_URL").filter(|v| !v.is_empty()).cloned().unwrap_or_else(|| "https://impeccable.style/api".to_string());
    base.strip_suffix('/').unwrap_or(&base).to_string()
}

pub(crate) fn card_base(env: &Env) -> String {
    env.get("IMPECCABLE_CARD_BASE").filter(|v| !v.is_empty()).cloned().unwrap_or_else(|| "https://impeccable.style/worlds/cards".to_string())
}

fn agent(timeout: Duration) -> ureq::Agent {
    crate::http::agent_builder().timeout_connect(timeout).timeout(timeout).build()
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

fn fetch_roll(env: &Env, budget: &mut ApiBudget, scope: &str, key: &str, mode: Option<&str>, grain: Option<&str>, platform: Option<&str>, reroll: usize) -> Option<Value> {
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
    let res = agent(remaining).get(&url).call().ok()?;
    if res.status() < 200 || res.status() >= 300 {
        return None;
    }
    let text = res.into_string().ok()?;
    let roll: Value = serde_json::from_str(&text).ok()?;
    let ch = roll.get("challengers")?.as_array()?;
    if ch.is_empty() {
        return None;
    }
    Some(roll)
}

fn telemetry_disabled(env: &Env) -> bool {
    env.get("IMPECCABLE_NO_TELEMETRY").map(|v| !v.is_empty()).unwrap_or(false) || env.get("DO_NOT_TRACK").map(|v| !v.is_empty()).unwrap_or(false)
}

/// JS: pingChosen
fn ping_chosen(env: &Env, budget: &mut ApiBudget, chosen_id: Option<&str>, key: Option<&str>, scope: Option<&str>, mode: Option<&str>, kind: Option<&str>, register: Option<&str>) -> bool {
    if telemetry_disabled(env) {
        return false;
    }
    let chosen_id = chosen_id.filter(|s| !s.is_empty());
    let kind = kind.filter(|s| !s.is_empty());
    let register = register.filter(|s| !s.is_empty());
    if let Some(k) = kind {
        if !["assigned", "pick", "challenger", "canon"].contains(&k) {
            return false;
        }
    }
    if let Some(r) = register {
        if r != "safer" && r != "bolder" {
            return false;
        }
    }
    if chosen_id.is_none() && kind.is_none() {
        return false;
    }
    if (kind == Some("challenger") || kind.is_none()) && chosen_id.is_none() {
        return false;
    }
    let mut body = Map::new();
    if let Some(c) = chosen_id {
        body.insert("chosenId".into(), Value::String(c.to_string()));
    }
    // JSON.stringify omits undefined values
    if let Some(k) = key {
        body.insert("key".into(), Value::String(k.to_string()));
    }
    if let Some(s) = scope {
        body.insert("scope".into(), Value::String(s.to_string()));
    }
    if let Some(m) = mode {
        body.insert("mode".into(), Value::String(m.to_string()));
    }
    if let Some(k) = kind {
        body.insert("kind".into(), Value::String(k.to_string()));
    }
    if let Some(r) = register {
        body.insert("register".into(), Value::String(r.to_string()));
    }
    let remaining = budget.remaining();
    if remaining.is_zero() {
        return false;
    }
    let url = format!("{}/chosen", api_base(env));
    agent(remaining)
        .post(&url)
        .set("Content-Type", "application/json")
        .send_string(&serde_json::to_string(&Value::Object(body)).unwrap())
        .is_ok()
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
}

fn unit(scope: &str, salt: &str, key: &str) -> f64 {
    let d = Sha256::digest(format!("{}:{}:{}", scope, salt, key).as_bytes());
    u32::from_be_bytes([d[0], d[1], d[2], d[3]]) as f64 / 4294967295.0
}

/// JS: renderConceptSeed
/// Returns the text plus the catalog worlds the roll printed as challengers
/// (`{"id", "board", "hero"}` each), for the roll record.
fn render_concept_seed(env: &Env, cwd: &str, budget: &mut ApiBudget, a: &SeedArgs) -> Result<(String, Vec<Value>), String> {
    let (scope, reroll, roll, degraded, worlds) = render_roll(env, cwd, budget, a)?;
    // PRESENTATION closes every roll, where a middle-truncated read still
    // reaches it, like the restated lines above it.
    let register = a.register.clone().flatten();
    Ok((roll + &presentation_block(env, cwd, scope, reroll, degraded, register.as_deref(), a.mode.clone().flatten().as_deref(), a.build_path.as_ref()), worlds))
}

/// The roll itself: (scope, re-roll round, text, degraded, printed worlds).
#[allow(clippy::type_complexity)]
fn render_roll(env: &Env, cwd: &str, budget: &mut ApiBudget, a: &SeedArgs) -> Result<(&'static str, usize, String, bool, Vec<Value>), String> {
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

    // data resolution
    let catalog_dir = env.get("IMPECCABLE_CATALOG_DIR").filter(|v| !v.is_empty()).cloned().unwrap_or_else(|| {
        crate::provider::detect(env, cwd).skill_dir.map(|d| jsp::join(&[&d, "scripts"])).unwrap_or_else(|| ".".to_string())
    });
    let data: Option<RollData> = if let Some(local) = load_local(&catalog_dir) {
        let sel = select_approved_challengers(scope, key, reroll, mode, &local.concepts)?;
        let comps = select_approved_compositions(scope, key, reroll, mode, grain, platform, &local.compositions, 3);
        Some(RollData {
            source: "local".into(),
            pool_revision: approved_pool_revision(&local.concepts),
            approved_count: sel.approved.len().to_string(),
            catalog_count: local.concepts.len().to_string(),
            challengers: sel.picks,
            compositions: comps.picks,
            composition_match: Some(comps.match_),
        })
    } else {
        fetch_roll(env, budget, scope, key, mode, grain, platform, reroll).map(|roll| RollData {
            source: "api".into(),
            pool_revision: vs(&roll, "poolRevision"),
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
    };

    let mode_flag = mode.map(|m| format!(" --mode {}", m)).unwrap_or_default();
    let reroll_flag = if reroll > 0 { format!(" --reroll {}", reroll) } else { String::new() };
    let register_flag = register.map(|r| format!(" --register {}", r)).unwrap_or_default();
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
    let authority = if scope == "direction" { t::AUTHORITY_DIRECTION.to_string() } else { t::AUTHORITY_SURFACE.to_string() };
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
            return Ok((scope, reroll, fill(t::DEGRADED_SAFER, &pairs), true, vec![]));
        }
        let degraded_register = if register == Some("bolder") { t::DEGRADED_BOLDER.to_string() } else { String::new() };
        let mut pairs = common.clone();
        pairs.push(("DEGRADEDHEADER", &degraded_header));
        pairs.push(("DEGRADEDREGISTER", &degraded_register));
        pairs.push(("ASSIGNED_OR_DEALT", &assigned_or_dealt));
        pairs.push(("PROMOTEDINSTRUCTION", &promoted));
        pairs.push(("AUTHORITYINSTRUCTION", &authority));
        pairs.push(("RESTATED_ASSIGNED_OR_DEALT", &restated_assigned_or_dealt));
        return Ok((scope, reroll, fill(t::DEGRADED_BODY, &pairs), true, vec![]));
    };

    let compositions_enabled = env.get("IMPECCABLE_COMPOSITIONS").map(|v| v == "1").unwrap_or(false);
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
        let tag = register.map(|r| format!(" ({} REGISTER, user-requested)", r.to_uppercase())).unwrap_or_default();
        let derive = if register.is_some() { "" } else { t::REROLL_DERIVE_TEXT };
        fill(t::REROLL_BLOCK, &[("REROLL", &reroll.to_string()), ("REROLL_REGISTER_TAG", &tag), ("REROLL_DERIVE", derive)])
    } else {
        String::new()
    };
    let telemetry_block = if data.source == "api" { fill(t::TELEMETRY_BLOCK, &common) } else { String::new() };
    let assigned_block = match register {
        None => fill(t::ASSIGNED_BLOCK, &[("ASSIGNED_OR_DEALT", &assigned_or_dealt), ("PROMOTEDINSTRUCTION", &promoted)]),
        Some("safer") => t::SAFER_BLOCK.to_string(),
        _ => t::BOLDER_BLOCK.to_string(),
    };
    let round_challenger_instruction = if register == Some("bolder") { t::BOLDER_CHALLENGER.to_string() } else { challenger_instruction };
    // The safer register spends its hand unseen, so it prints no challenger
    // and records no world.
    let mut worlds: Vec<Value> = Vec::new();
    let challenger_section = if register == Some("safer") {
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
    let restated = match register {
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
    Ok((scope, reroll, fill(t::MAIN, &pairs), false, worlds))
}

fn random_hex8() -> String {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let mut x = (t as u64) ^ ((std::process::id() as u64) << 32) ^ 0x9E3779B97F4A7C15;
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51afd7ed558ccd);
    x ^= x >> 33;
    format!("{:08x}", (x & 0xffffffff) as u32)
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();
    let idx = |name: &str| args.iter().position(|a| a == name);
    // args[idx+1] may be undefined -> None
    let val = |name: &str| -> Option<Option<String>> { idx(name).map(|i| args.get(i + 1).cloned()) };
    let mut budget = ApiBudget::new(&env);
    let chosen = val("--chosen");
    let kind = val("--kind");
    if chosen.is_some() || kind.is_some() {
        let flat = |v: &Option<Option<String>>| -> Option<String> { v.clone().flatten() };
        let sent = ping_chosen(
            &env,
            &mut budget,
            flat(&chosen).as_deref(),
            flat(&val("--from")).as_deref(),
            flat(&val("--scope")).as_deref(),
            flat(&val("--mode")).as_deref(),
            flat(&kind).as_deref(),
            flat(&val("--register")).as_deref(),
        );
        io.out(if sent { "choice recorded\n" } else { "choice ping skipped\n" });
        return 0;
    }
    let ctx = load_context(&cwd, &TargetOptions::default(), &env);
    if !ctx.has_product {
        io.out("NO_PRODUCT_MD: the dice stay in the cup until product truth exists. Complete the init ask round and write PRODUCT.md first (reference/init.md), then re-run this exact command. Challengers fuse their form with facts from PRODUCT.md; without it every direction is ungrounded.\n");
        return 1;
    }
    let num = |v: Option<Option<String>>| -> Option<f64> { v.map(|x| x.map(|s| crate::critique_storage::js_number(&s)).unwrap_or(f64::NAN)) };
    let seed = SeedArgs {
        scope: match val("--scope") {
            None => Some("surface".to_string()),
            Some(v) => v, // undefined value -> None -> invalid scope
        },
        key: match val("--from") {
            Some(Some(k)) => k,
            Some(None) => "undefined".to_string(),
            None => env.get("IMPECCABLE_CONCEPT_SEED").filter(|v| !v.is_empty()).cloned().unwrap_or_else(random_hex8),
        },
        reroll: num(val("--reroll")).unwrap_or(0.0),
        register: val("--register"),
        mode: val("--mode"),
        grain: val("--grain"),
        platform: val("--platform"),
        candidate_count: num(val("--candidate-count")).unwrap_or(7.0),
        build_path: crate::context_cli::recorded_build_path(&ctx, &cwd),
    };
    match render_concept_seed(&env, &cwd, &mut budget, &seed) {
        Ok((text, worlds)) => {
            // A valid roll: the scope and re-roll round passed validation.
            // serve-question reads the record to know a surface round when
            // it serves one, and which catalog worlds were dealt, so it can
            // name their card images when the comps are due (`record_roll`).
            crate::serve_question::record_roll(&cwd, seed.scope.as_deref().unwrap_or("surface"), &seed.key, seed.reroll as usize, &worlds);
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
        assert!(out.contains("seed key k1.\nPRESENTATION (the decision round, condensed from new-work.md;"), "block follows the restated line: {out}");
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
        assert_eq!((r["scope"].as_str(), r["key"].as_str(), r["reroll"].as_u64()), (Some("surface"), Some("k1"), Some(0)));
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
        assert!(r["at"].as_f64().is_some_and(|at| (crate::util::now_ms() - at).abs() < 60_000.0), "{r}");
        let (code, _) = seed(&proj, &skill, false, &["--scope", "direction", "--from", "k2", "--reroll", "1"]);
        assert_eq!(code, 0);
        let r = read();
        assert_eq!((r["scope"].as_str(), r["key"].as_str(), r["reroll"].as_u64()), (Some("direction"), Some("k2"), Some(1)));
        // A degraded roll dealt no world: the record keeps its old shape.
        assert!(r.get("worlds").is_none(), "{r}");
    }
}
