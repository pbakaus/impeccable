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

fn card_base(env: &Env) -> String {
    env.get("IMPECCABLE_CARD_BASE").filter(|v| !v.is_empty()).cloned().unwrap_or_else(|| "https://impeccable.style/worlds/cards".to_string())
}

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(timeout).timeout(timeout).build()
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
    let cb = card_base(env);
    let id = vs(concept, "id");
    let board = concept.get("cardBoard").filter(|v| crate::staleness::js_truthy(v)).map(value_str).unwrap_or_else(|| format!("{}/{}.webp", cb, id));
    let hero = concept.get("cardHero").filter(|v| crate::staleness::js_truthy(v)).map(value_str).unwrap_or_else(|| format!("{}/{}-hero.webp", cb, id));
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
}

fn unit(scope: &str, salt: &str, key: &str) -> f64 {
    let d = Sha256::digest(format!("{}:{}:{}", scope, salt, key).as_bytes());
    u32::from_be_bytes([d[0], d[1], d[2], d[3]]) as f64 / 4294967295.0
}

/// JS: renderConceptSeed
fn render_concept_seed(env: &Env, cwd: &str, budget: &mut ApiBudget, a: &SeedArgs) -> Result<String, String> {
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
    let richness = t::RICHNESS.to_string();
    let assigned_or_dealt = if scope == "direction" { format!("ASSIGNED INDEX: {}", build_index) } else { format!("DEALT INDICES: {} (index {} leads)", dealt_str, build_index) };
    let restated_assigned_or_dealt = if scope == "direction" {
        fill(t::RESTATED_DIRECTION, &common)
    } else {
        fill(t::RESTATED_SURFACE, &common)
    };

    let Some(data) = data else {
        let degraded_header = fill(t::DEGRADED_HEADER, &common);
        if register == Some("safer") {
            let mut pairs = common.clone();
            pairs.push(("DEGRADEDHEADER", &degraded_header));
            pairs.push(("AUTHORITYINSTRUCTION", &authority));
            return Ok(fill(t::DEGRADED_SAFER, &pairs));
        }
        let degraded_register = if register == Some("bolder") { t::DEGRADED_BOLDER.to_string() } else { String::new() };
        let mut pairs = common.clone();
        pairs.push(("DEGRADEDHEADER", &degraded_header));
        pairs.push(("DEGRADEDREGISTER", &degraded_register));
        pairs.push(("ASSIGNED_OR_DEALT", &assigned_or_dealt));
        pairs.push(("PROMOTEDINSTRUCTION", &promoted));
        pairs.push(("AUTHORITYINSTRUCTION", &authority));
        pairs.push(("RESTATED_ASSIGNED_OR_DEALT", &restated_assigned_or_dealt));
        return Ok(fill(t::DEGRADED_BODY, &pairs));
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
    let challenger_section = if register == Some("safer") {
        String::new()
    } else {
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
    Ok(fill(t::MAIN, &pairs))
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
    };
    match render_concept_seed(&env, &cwd, &mut budget, &seed) {
        Ok(text) => {
            io.out(&text);
            0
        }
        Err(msg) => {
            io.err(&format!("{}\n", msg));
            1
        }
    }
}
