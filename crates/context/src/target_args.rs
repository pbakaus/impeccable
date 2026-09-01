//! JS: lib/target-args.mjs

#[derive(Debug, Clone, Default)]
pub struct TargetOptions {
    pub target_path: Option<String>,
}

pub const TARGET_VALUE_MISSING: &str = "--target requires a path value.";

/// JS: parseTargetPath(args, { strict })
pub fn parse_target_path(args: &[String], strict: bool) -> Result<Option<String>, String> {
    let mut target: Option<String> = None;
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if arg == "--target" || arg == "-t" {
            let next = args.get(i + 1);
            if let Some(n) = next {
                if !n.is_empty() && !n.starts_with('-') {
                    target = Some(n.clone());
                    i += 2;
                    continue;
                }
            }
            if strict {
                return Err(TARGET_VALUE_MISSING.to_string());
            }
            i += 1;
            continue;
        }
        if let Some(v) = arg.strip_prefix("--target=") {
            if !v.is_empty() {
                target = Some(v.to_string());
                i += 1;
                continue;
            }
            if strict {
                return Err(TARGET_VALUE_MISSING.to_string());
            }
        }
        i += 1;
    }
    Ok(target)
}

/// JS: parseTargetOptions
pub fn parse_target_options(args: &[String], strict: bool) -> Result<TargetOptions, String> {
    let t = parse_target_path(args, strict)?;
    Ok(TargetOptions { target_path: t.filter(|s| !s.is_empty()) })
}

/// JS: hasTargetOption
pub fn has_target_option(o: &TargetOptions) -> bool {
    matches!(&o.target_path, Some(t) if !t.trim().is_empty())
}
