//! Port of `cli/bin/commands/ignores.mjs`: `impeccable ignores <action>`.
//! Errors the JS throws surface through `cli.js`'s catch as the message on
//! stderr with exit 1; `run` returns that exit code.

use impeccable_common::Io;
use impeccable_core::js;

use crate::config::{
    get_config_path, get_local_config_path, normalize_ignore_value, read_detection_config,
    read_raw_detection_config, synthetic_ignore_value, write_detection_config, DetectionConfig,
    IgnoreValueEntry,
};
use crate::jsp;

const USAGE: &str = "Usage: impeccable ignores <action> [options]

Manage detector ignores in .impeccable config.

Actions:
  list                                  Show merged, shared, and local ignores
  add-rule <rule> [--all-values]        Ignore a rule
  add-file <glob>                       Ignore files by glob
  add-value <rule> <value>              Ignore one rule/value pair
  remove-rule <rule>                    Remove a rule ignore
  remove-file <glob>                    Remove a file ignore
  remove-value <rule> <value>           Remove a rule/value ignore
  clear                                 Clear detector ignores in the selected scope

Scope:
  --shared                              Write .impeccable/config.json (default)
  --local                               Write .impeccable/config.local.json
  --all                                 For remove/clear, apply to shared and local

Value options:
  --file <glob>                         Scope add-value/remove-value to a file glob
  --reason <text>                       Store or update a reason on add-value

Examples:
  impeccable ignores add-file \"src/legacy/**\"
  impeccable ignores add-value overused-font Inter --reason \"Brand font\"
  impeccable ignores add-value design-system-color \"*\" --file \"src/demo.css\"
  impeccable ignores remove-value overused-font Inter
";

fn action_for(arg: &str) -> Option<&'static str> {
    Some(match js::to_lower_case(arg).as_str() {
        "status" | "ls" | "list" => "list",
        "add-rule" | "ignore-rule" => "add-rule",
        "add-file" | "ignore-file" => "add-file",
        "add-value" | "ignore-value" | "update-value" => "add-value",
        "remove-rule" | "rm-rule" => "remove-rule",
        "remove-file" | "rm-file" => "remove-file",
        "remove-value" | "rm-value" => "remove-value",
        "clear" => "clear",
        _ => return None,
    })
}

type R<T> = Result<T, String>;

struct Scope {
    local: bool,
    all: bool,
    rest: Vec<String>,
}

fn parse_scope(args: &[String], allow_all: bool) -> R<Scope> {
    let mut local = false;
    let mut shared = false;
    let mut all = false;
    let mut rest = Vec::new();
    for arg in args {
        match arg.as_str() {
            "--local" => local = true,
            "--shared" => shared = true,
            "--all" => all = true,
            _ => rest.push(arg.clone()),
        }
    }
    if [local, shared, all].iter().filter(|b| **b).count() > 1 {
        return Err(format!(
            "Pass only one scope flag: --shared{}",
            if allow_all {
                ", --local, or --all"
            } else {
                " or --local"
            }
        ));
    }
    if all && !allow_all {
        return Err("--all is only supported for remove and clear actions".to_string());
    }
    Ok(Scope { local, all, rest })
}

fn require_glob(raw: &str, flag: &str) -> R<String> {
    let glob = js::trim(raw);
    if glob.is_empty() {
        return Err(format!("{flag} requires a non-empty glob"));
    }
    if glob.starts_with("--") {
        return Err(format!("{flag} requires a glob, got the flag {glob}"));
    }
    Ok(glob.to_string())
}

struct ValueArgs {
    rule: String,
    value: String,
    files: Vec<String>,
    reason: String,
}

fn parse_value_args(args: &[String], allow_unscoped_wildcard: bool) -> R<ValueArgs> {
    let mut positionals: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    let mut reason = String::new();
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        if arg == "--reason" {
            let mut chunks = Vec::new();
            while i + 1 < args.len() && !args[i + 1].starts_with("--") {
                i += 1;
                chunks.push(args[i].clone());
            }
            reason = js::trim(&chunks.join(" ")).to_string();
        } else if let Some(v) = arg.strip_prefix("--reason=") {
            reason = js::trim(v).to_string();
        } else if arg == "--file" || arg == "--files" {
            if i + 1 >= args.len() {
                return Err(format!("{arg} requires a glob"));
            }
            i += 1;
            files.push(require_glob(&args[i], arg)?);
        } else if let Some(v) = arg.strip_prefix("--file=") {
            files.push(require_glob(v, "--file")?);
        } else if let Some(v) = arg.strip_prefix("--files=") {
            files.push(require_glob(v, "--files")?);
        } else if arg.starts_with("--") {
            return Err(format!("Unknown add-value flag: {arg}"));
        } else {
            positionals.push(arg.to_string());
        }
        i += 1;
    }
    let rule = positionals.first().cloned().unwrap_or_default();
    let value = normalize_ignore_value(&positionals.get(1..).unwrap_or(&[]).join(" "));
    if rule.is_empty() || value.is_empty() {
        return Err(
            "Pass a rule id and value, e.g. impeccable ignores add-value overused-font Inter"
                .to_string(),
        );
    }
    let mut scoped: Vec<String> = Vec::new();
    for f in files.into_iter().filter(|f| !f.is_empty()) {
        if !scoped.contains(&f) {
            scoped.push(f);
        }
    }
    scoped.sort();
    if value == "*" && scoped.is_empty() && !allow_unscoped_wildcard {
        return Err("Wildcard value ignores must be scoped with --file <glob>.".to_string());
    }
    Ok(ValueArgs {
        rule: js::to_lower_case(js::trim(&rule)),
        value,
        files: scoped,
        reason,
    })
}

fn format_values(values: &[IgnoreValueEntry]) -> String {
    if values.is_empty() {
        return "(none)".to_string();
    }
    values
        .iter()
        .map(|e| {
            let file_suffix = match &e.files {
                Some(f) if !f.is_empty() => format!(" [{}]", f.join(", ")),
                _ => String::new(),
            };
            let reason_suffix = match &e.reason {
                Some(r) if !r.is_empty() => format!(" - {r}"),
                _ => String::new(),
            };
            format!("{}={}{file_suffix}{reason_suffix}", e.rule, e.value)
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_config(label: &str, config: &DetectionConfig) -> String {
    let none_or = |v: &[String]| {
        if v.is_empty() {
            "(none)".to_string()
        } else {
            v.join(", ")
        }
    };
    [
        format!("{label}:"),
        format!("  ignoreRules:  {}", none_or(&config.ignore_rules)),
        format!("  ignoreFiles:  {}", none_or(&config.ignore_files)),
        format!("  ignoreValues: {}", format_values(&config.ignore_values)),
        format!(
            "  designSystem: {}",
            if config.design_system_enabled == Some(false) {
                "disabled"
            } else {
                "enabled"
            }
        ),
    ]
    .join("\n")
}

fn rel_or_abs(cwd: &str, target: &str) -> String {
    let rel = jsp::relative(cwd, cwd, target);
    if rel.is_empty() {
        target.to_string()
    } else {
        rel
    }
}

fn list(cwd: &str) -> String {
    let merged = read_detection_config(cwd);
    let shared = read_raw_detection_config(cwd, false);
    let local = read_raw_detection_config(cwd, true);
    [
        "Impeccable detector ignores".to_string(),
        format!("  shared file: {}", rel_or_abs(cwd, &get_config_path(cwd))),
        format!(
            "  local file:  {}",
            rel_or_abs(cwd, &get_local_config_path(cwd))
        ),
        String::new(),
        format_config("Merged", &merged),
        String::new(),
        format_config("Shared", &shared),
        String::new(),
        format_config("Local", &local),
    ]
    .join("\n")
}

fn write_scope(cwd: &str, config: &DetectionConfig, local: bool) -> R<String> {
    write_detection_config(cwd, config, local).map_err(|e| e.to_string())
}

fn parse_rule_args(args: &[String]) -> R<(String, bool)> {
    let mut positionals: Vec<String> = Vec::new();
    let mut all_values = false;
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        if arg == "--all-values" {
            all_values = true;
        } else if arg == "--reason" {
            while i + 1 < args.len() && !args[i + 1].starts_with("--") {
                i += 1;
            }
        } else if arg.starts_with("--reason=") {
            // accepted for symmetry
        } else if arg.starts_with("--") {
            return Err(format!("Unknown add-rule flag: {arg}"));
        } else {
            positionals.push(arg.to_string());
        }
        i += 1;
    }
    Ok((
        js::to_lower_case(js::trim(
            positionals.first().map(String::as_str).unwrap_or(""),
        )),
        all_values,
    ))
}

fn add_rule(cwd: &str, args: &[String]) -> R<String> {
    let scope = parse_scope(args, false)?;
    let (rule, all_values) = parse_rule_args(&scope.rest)?;
    if rule.is_empty() {
        return Err("Pass a rule id, e.g. impeccable ignores add-rule side-tab".to_string());
    }
    if rule == "overused-font" && !all_values {
        return Err("overused-font is value-specific by default. Use add-value overused-font <font>, or add-rule overused-font --all-values for broad suppression.".to_string());
    }
    let mut config = read_raw_detection_config(cwd, scope.local);
    if !config.ignore_rules.contains(&rule) {
        config.ignore_rules.push(rule.clone());
    }
    let target = write_scope(cwd, &config, scope.local)?;
    Ok(format!(
        "Added {rule} to {} detector ignoreRules ({}).",
        if scope.local { "local" } else { "shared" },
        rel_or_abs(cwd, &target)
    ))
}

fn add_file(cwd: &str, args: &[String]) -> R<String> {
    let scope = parse_scope(args, false)?;
    let glob = js::trim(scope.rest.first().map(String::as_str).unwrap_or("")).to_string();
    if glob.is_empty() {
        return Err("Pass a glob, e.g. impeccable ignores add-file \"src/legacy/**\"".to_string());
    }
    let mut config = read_raw_detection_config(cwd, scope.local);
    if !config.ignore_files.contains(&glob) {
        config.ignore_files.push(glob.clone());
    }
    let target = write_scope(cwd, &config, scope.local)?;
    Ok(format!(
        "Added {glob} to {} detector ignoreFiles ({}).",
        if scope.local { "local" } else { "shared" },
        rel_or_abs(cwd, &target)
    ))
}

fn ignore_value_key(rule: &str, value: &str, files: Option<&Vec<String>>) -> String {
    let files_key = match files {
        Some(f) if !f.is_empty() => {
            let mut s = f.clone();
            s.sort();
            s.join("\u{1f}")
        }
        _ => String::new(),
    };
    format!(
        "{}\0{}\0{}",
        js::to_lower_case(js::trim(rule)),
        normalize_ignore_value(value),
        files_key
    )
}

fn entry_key(e: &IgnoreValueEntry) -> String {
    ignore_value_key(&e.rule, &e.value, e.files.as_ref())
}

fn iso_now() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    let ms_i = ms.floor() as i64;
    let secs = ms_i.div_euclid(1000);
    let millis = ms_i.rem_euclid(1000);
    let days = secs.div_euclid(86400);
    let sod = secs.rem_euclid(86400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y,
        m,
        d,
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60,
        millis
    )
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn add_value(cwd: &str, args: &[String]) -> R<String> {
    let scope = parse_scope(args, false)?;
    let parsed = parse_value_args(&scope.rest, false)?;
    // JS: refuse inert exact entries — a value the extractor can never
    // produce for this rule would silently match nothing (issue #662).
    if parsed.value != "*" && synthetic_ignore_value(&parsed.rule, &parsed.value).is_empty() {
        return Err(format!(
            "{rule} has no extractable ignore value. Use impeccable ignores add-value {rule} \"*\" --file <glob> to suppress it in matching files.",
            rule = parsed.rule
        ));
    }
    let mut config = read_raw_detection_config(cwd, scope.local);
    let key = ignore_value_key(&parsed.rule, &parsed.value, Some(&parsed.files));
    if let Some(existing) = config
        .ignore_values
        .iter_mut()
        .find(|e| entry_key(e) == key)
    {
        if !parsed.reason.is_empty() {
            existing.reason = Some(parsed.reason.clone());
        }
        if !parsed.files.is_empty() {
            existing.files = Some(parsed.files.clone());
        }
    } else {
        config.ignore_values.push(IgnoreValueEntry {
            rule: parsed.rule.clone(),
            value: parsed.value.clone(),
            files: if parsed.files.is_empty() {
                None
            } else {
                Some(parsed.files.clone())
            },
            created_at: Some(iso_now()),
            reason: if parsed.reason.is_empty() {
                None
            } else {
                Some(parsed.reason.clone())
            },
        });
    }
    let target = write_scope(cwd, &config, scope.local)?;
    Ok(format!(
        "Added {}={} to {} detector ignoreValues ({}).",
        parsed.rule,
        parsed.value,
        if scope.local { "local" } else { "shared" },
        rel_or_abs(cwd, &target)
    ))
}

fn remove_from_scopes(
    cwd: &str,
    args: &[String],
    remover: impl Fn(&mut DetectionConfig, &[String]) -> R<usize>,
) -> R<String> {
    let scope = parse_scope(args, true)?;
    let scopes: Vec<bool> = if scope.all {
        vec![false, true]
    } else {
        vec![scope.local]
    };
    let mut removed: Vec<String> = Vec::new();
    for is_local in scopes {
        let mut config = read_raw_detection_config(cwd, is_local);
        let count = remover(&mut config, &scope.rest)?;
        if count > 0 {
            let target = write_scope(cwd, &config, is_local)?;
            removed.push(format!(
                "{count} from {} ({})",
                if is_local { "local" } else { "shared" },
                rel_or_abs(cwd, &target)
            ));
        }
    }
    Ok(if removed.is_empty() {
        "No matching detector ignore found.".to_string()
    } else {
        format!("Removed {}.", removed.join(", "))
    })
}

fn remove_rule(cwd: &str, args: &[String]) -> R<String> {
    remove_from_scopes(cwd, args, |config, rest| {
        let rule = js::to_lower_case(js::trim(rest.first().map(String::as_str).unwrap_or("")));
        if rule.is_empty() {
            return Err("Pass a rule id, e.g. impeccable ignores remove-rule side-tab".to_string());
        }
        let before = config.ignore_rules.len();
        config.ignore_rules.retain(|e| *e != rule);
        Ok(before - config.ignore_rules.len())
    })
}

fn remove_file(cwd: &str, args: &[String]) -> R<String> {
    remove_from_scopes(cwd, args, |config, rest| {
        let glob = js::trim(rest.first().map(String::as_str).unwrap_or("")).to_string();
        if glob.is_empty() {
            return Err(
                "Pass a glob, e.g. impeccable ignores remove-file \"src/legacy/**\"".to_string(),
            );
        }
        let before = config.ignore_files.len();
        config.ignore_files.retain(|e| *e != glob);
        Ok(before - config.ignore_files.len())
    })
}

fn remove_value(cwd: &str, args: &[String]) -> R<String> {
    remove_from_scopes(cwd, args, |config, rest| {
        let parsed = parse_value_args(rest, true)?;
        let key = ignore_value_key(&parsed.rule, &parsed.value, Some(&parsed.files));
        let before = config.ignore_values.len();
        config.ignore_values.retain(|e| entry_key(e) != key);
        Ok(before - config.ignore_values.len())
    })
}

fn clear(cwd: &str, args: &[String]) -> R<String> {
    let scope = parse_scope(args, true)?;
    if !scope.rest.is_empty() {
        return Err("clear does not take positional arguments".to_string());
    }
    let scopes: Vec<bool> = if scope.all {
        vec![false, true]
    } else {
        vec![scope.local]
    };
    for is_local in scopes {
        let mut config = read_raw_detection_config(cwd, is_local);
        config.ignore_rules.clear();
        config.ignore_files.clear();
        config.ignore_values.clear();
        write_scope(cwd, &config, is_local)?;
    }
    Ok(format!(
        "Cleared detector ignores in {}.",
        if scope.all {
            "shared and local config"
        } else if scope.local {
            "local config"
        } else {
            "shared config"
        }
    ))
}

/// JS: ignores.mjs#run (with cli.js's error handling folded in).
pub fn run(args: &[String], io: &mut Io) -> i32 {
    let cwd = io.cwd.to_string_lossy().into_owned();
    let action_arg = args.first().map(String::as_str).unwrap_or("list");
    let action_arg = if action_arg.is_empty() {
        "list"
    } else {
        action_arg
    };
    if action_arg == "--help" || action_arg == "-h" {
        io.out(USAGE);
        return 0;
    }
    let Some(action) = action_for(action_arg) else {
        io.err(&format!(
            "Unknown ignores action: {action_arg}. Run \"impeccable ignores --help\".\n"
        ));
        return 1;
    };
    let rest: Vec<String> = args.get(1..).unwrap_or(&[]).to_vec();
    let out = match action {
        "list" => Ok(list(&cwd)),
        "add-rule" => add_rule(&cwd, &rest),
        "add-file" => add_file(&cwd, &rest),
        "add-value" => add_value(&cwd, &rest),
        "remove-rule" => remove_rule(&cwd, &rest),
        "remove-file" => remove_file(&cwd, &rest),
        "remove-value" => remove_value(&cwd, &rest),
        _ => clear(&cwd, &rest),
    };
    match out {
        Ok(text) => {
            if !text.is_empty() {
                io.out(&format!("{text}\n"));
            }
            0
        }
        Err(message) => {
            io.err(&format!("{message}\n"));
            1
        }
    }
}
