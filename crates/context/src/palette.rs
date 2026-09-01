//! JS: palette.mjs -> `impeccable palette`

use crate::palette_data::{Seed, SEEDS, TEMPLATE};
use crate::util::to_fixed;
use impeccable_common::Io;
use sha2::{Digest, Sha256};

fn hash_unit(key: &str) -> f64 {
    let d = Sha256::digest(key.as_bytes());
    let n = u32::from_be_bytes([d[0], d[1], d[2], d[3]]);
    n as f64 / 4294967296.0
}

/// JS: Math.random() substitute; only used with no key.
fn random_unit() -> f64 {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let mut x = (t as u64) ^ (std::process::id() as u64).wrapping_mul(0x9E3779B97F4A7C15);
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51afd7ed558ccd);
    x ^= x >> 33;
    (x >> 11) as f64 / (1u64 << 53) as f64
}

fn bucket_of(s: &Seed) -> i64 {
    // Math.floor(((H % 360) + 360) % 360 / 30)
    let h = s.h % 360.0;
    let h = (h + 360.0) % 360.0;
    (h / 30.0).floor() as i64
}

fn weighted_pick(unit: f64) -> &'static Seed {
    let mut counts: std::collections::HashMap<i64, usize> = std::collections::HashMap::new();
    for s in SEEDS {
        *counts.entry(bucket_of(s)).or_insert(0) += 1;
    }
    let weights: Vec<f64> = SEEDS.iter().map(|s| 1.0 / counts[&bucket_of(s)] as f64).collect();
    // JS reduce((a,b)=>a+b, 0): sequential sum
    let mut total = 0.0;
    for w in &weights {
        total += w;
    }
    let mut target = unit * total;
    for (i, s) in SEEDS.iter().enumerate() {
        target -= weights[i];
        if target < 0.0 {
            return s;
        }
    }
    &SEEDS[SEEDS.len() - 1]
}

fn hue_word(h: f64) -> &'static str {
    if h < 15.0 || h >= 345.0 {
        "pure red"
    } else if h < 35.0 {
        "warm red / crimson"
    } else if h < 55.0 {
        "warm coral / burnt orange"
    } else if h < 80.0 {
        "orange / honey"
    } else if h < 105.0 {
        "warm amber / honey-gold"
    } else if h < 135.0 {
        "yellow-green / olive"
    } else if h < 170.0 {
        "green"
    } else if h < 200.0 {
        "teal"
    } else if h < 230.0 {
        "sky blue"
    } else if h < 265.0 {
        "cobalt / indigo"
    } else if h < 295.0 {
        "violet / purple"
    } else if h < 330.0 {
        "magenta / pink"
    } else {
        "deep pink / rose"
    }
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let mut id: Option<String> = None;
    let mut from: Option<String> = None;
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        let next = args.get(i + 1).filter(|n| !n.is_empty());
        if a == "--id" && next.is_some() {
            id = next.cloned();
            i += 2;
            continue;
        } else if a == "--from" && next.is_some() {
            from = next.cloned();
            i += 2;
            continue;
        }
        i += 1;
    }
    let seed: &Seed = if let Some(id) = id.filter(|s| !s.is_empty()) {
        match SEEDS.iter().find(|s| s.id == id) {
            Some(s) => s,
            None => {
                io.err(&format!("no seed with id \"{}\"\n", id));
                return 2;
            }
        }
    } else {
        let env_from = io.env.get("IMPECCABLE_PALETTE_SEED").cloned().filter(|s| !s.is_empty());
        let key = from.filter(|s| !s.is_empty()).or(env_from);
        let unit = match key {
            Some(k) => hash_unit(&k),
            None => random_unit(),
        };
        weighted_pick(unit)
    };
    let mood_hint = if seed.mood.is_empty() { String::new() } else { format!(" (one read: \"{}\")", seed.mood) };
    let strategy_hint = if seed.strategy.is_empty() { String::new() } else { format!("\n  - one example strategy: {}", seed.strategy) };
    let oklch = format!("oklch({} {} {})", to_fixed(seed.l, 3), to_fixed(seed.c, 3), to_fixed(seed.h, 1));
    let out = TEMPLATE
        .replacen("{ID}", seed.id, 1)
        .replacen("{OKLCH}", &oklch, 1)
        .replacen("{HUEWORD}", hue_word(seed.h), 1)
        .replacen("{MOOD}", &mood_hint, 1)
        .replacen("{HDEG}", &to_fixed(seed.h, 0), 1)
        .replacen("{STRATEGY}", &strategy_hint, 1);
    io.out(&out);
    0
}
