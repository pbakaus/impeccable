//! Port of `cli/engine/cli/main.mjs`: `detectCli()`, the text formatter, and
//! stdin dispatch.

use std::io::Write;

use impeccable_common::Io;
use impeccable_core::findings::Finding;
use impeccable_core::registry::{filter_by_scopes, rule_scopes};
use serde_json::Value;

use crate::config::{
    filter_detection_findings, read_detection_config, should_ignore_detection_file, DetectionConfig,
};
use crate::design_system::{load_design_system_for_target, DesignSystemCache};
use crate::detect_text::{detect_text, TextOptions};
use crate::engines::{EngineError, Engines, ScanOptions};
use crate::file_system::{
    build_import_graph, detect_framework_config, is_html_path, is_port_listening, walk_dir,
};
use crate::jsp;
use crate::util::{exists, re, read_text, D};

pub const USAGE: &str = "Usage: impeccable detect [options] [file-or-dir-or-url...]

Scan files or URLs for UI anti-patterns and design quality issues.

Options:
  --json              Output results as JSON
  --quiet             In text mode, only print the final findings count
  --scope <name>      Only report rules in the given design domain
                      (type, layout). Comma-separated.
  --viewport <WxH>    Browser viewport for URL scans (default 1280x800),
                      e.g. --viewport 390x844 for a mobile-width pass
  --no-config         Do not apply project config, detector ignores, inline
                      ignore comments, or DESIGN.md
  --no-inline-ignores Do not honor in-file impeccable-disable* ignore comments
  --no-design-system  Do not load local DESIGN.md / .impeccable/design.json context
  --no-advisory       Suppress advisory findings entirely (e.g. em-dash overuse)
  --help              Show this help message

Advisory findings:
  Some rules are advisory: detected and listed in a separate section, but never
  counted as failures and never changing the exit code. They stay out of the
  failure count so they never block automation. --no-advisory hides them.

Project config:
  Respects .impeccable/config.json and .impeccable/config.local.json detector
  settings: detector.ignoreRules, detector.ignoreFiles, detector.ignoreValues,
  and detector.designSystem.enabled.

Inline ignores:
  In-file comments waive a finding where it lives and travel with the file:
    <!-- impeccable-disable overused-font -- exported brand doc -->
    .brand { font-family: Inter } /* impeccable-disable-line overused-font */
    // impeccable-disable-next-line bounce-easing: intentional bounce
  impeccable-disable applies to the whole file; -line / -next-line are scoped.
  List one or more rule ids (comma-separated), or omit them / use * for all.

Detection modes:
  HTML files     Static HTML/CSS analysis (default, catches linked CSS)
  Non-HTML files Regex pattern matching (CSS, JSX, TSX, etc.)
  URLs           Puppeteer full browser rendering (auto-detected;
                 http(s):// and file:// URLs)

Examples:
  impeccable detect src/
  impeccable detect index.html
  impeccable detect https://example.com
  impeccable detect --json .
  impeccable detect --no-config src/
";

fn format_finding_summary(count: usize) -> String {
    format!(
        "{count} anti-pattern{} found.",
        if count == 1 { "" } else { "s" }
    )
}

fn is_advisory(f: &Finding) -> bool {
    f.advisory == Some(true)
}

fn partition_advisory(findings: &[Finding]) -> (Vec<&Finding>, Vec<&Finding>) {
    let mut primary = Vec::new();
    let mut advisory = Vec::new();
    for f in findings {
        if is_advisory(f) {
            advisory.push(f);
        } else {
            primary.push(f);
        }
    }
    (primary, advisory)
}

/// JS `dim(text)`: ANSI dim only when stderr is a TTY.
fn dim(text: &str, stderr_tty: bool) -> String {
    if stderr_tty {
        format!("\x1b[2m{text}\x1b[0m")
    } else {
        text.to_string()
    }
}

fn imported_by(f: &Finding) -> Vec<String> {
    match f.extras.get("importedBy") {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect(),
        _ => vec![],
    }
}

fn format_findings_body(findings: &[&Finding]) -> Vec<String> {
    let mut grouped: Vec<(String, Vec<&Finding>)> = Vec::new();
    for f in findings {
        if let Some(slot) = grouped.iter_mut().find(|(k, _)| *k == f.file) {
            slot.1.push(f);
        } else {
            grouped.push((f.file.clone(), vec![f]));
        }
    }
    let mut out = Vec::new();
    for (file, items) in grouped {
        let importers = imported_by(items[0]);
        let import_note = if importers.is_empty() {
            String::new()
        } else {
            format!(" (imported by {})", importers.join(", "))
        };
        out.push(format!("\n{file}{import_note}"));
        for item in items {
            let line = if item.line != 0.0 && !item.line.is_nan() {
                format!(
                    "line {}: ",
                    impeccable_core::js::number_to_string(item.line)
                )
            } else {
                String::new()
            };
            out.push(format!("  {line}[{}] {}", item.antipattern, item.snippet));
            out.push(format!("    → {}", item.description));
        }
    }
    out
}

fn format_advisory_section(advisory: &[&Finding], stderr_tty: bool) -> String {
    if advisory.is_empty() {
        return String::new();
    }
    let mut lines = vec![format!(
        "\n{}",
        dim("── Advisory (not counted as failures) ──", stderr_tty)
    )];
    for line in format_findings_body(advisory) {
        lines.push(dim(&line, stderr_tty));
    }
    lines.push(dim(
        &format!(
            "\n{} advisory note{}. Suppress with --no-advisory.",
            advisory.len(),
            if advisory.len() == 1 { "" } else { "s" }
        ),
        stderr_tty,
    ));
    lines.join("\n")
}

/// JS: main.mjs#formatFindings
pub fn format_findings(findings: &[Finding], json_mode: bool, stderr_tty: bool) -> String {
    if json_mode {
        return serde_json::to_string_pretty(findings).unwrap_or_else(|_| "[]".into());
    }
    let (primary, advisory) = partition_advisory(findings);
    let mut out = format_findings_body(&primary);
    out.push(format!("\n{}", format_finding_summary(primary.len())));
    let section = format_advisory_section(&advisory, stderr_tty);
    if !section.is_empty() {
        out.push(section);
    }
    out.join("\n")
}

/// The reasons `detectCli` stops before scanning: an exit code the router
/// returns as-is.
struct Exit(i32);

struct Ctx<'a> {
    io: &'a mut Io,
    engines: &'a Engines<'a>,
    cwd: String,
    home: String,
    config: DetectionConfig,
    json_mode: bool,
    quiet_mode: bool,
    design_system_enabled: bool,
    base: ScanOptions,
    cache: DesignSystemCache,
    stdin_tty: bool,
}

impl<'a> Ctx<'a> {
    fn scan_options_for(&mut self, local_path: Option<&str>) -> ScanOptions {
        let (Some(local_path), true) = (local_path, self.design_system_enabled) else {
            return self.base.clone();
        };
        match load_design_system_for_target(
            local_path,
            Some(&mut self.cache),
            &self.cwd,
            &self.home,
        ) {
            Some(ds) => ScanOptions {
                design_system: Some(ds),
                ..self.base.clone()
            },
            None => self.base.clone(),
        }
    }

    fn detect_local_file(
        &mut self,
        file_path: &str,
        options: &ScanOptions,
    ) -> Result<Vec<Finding>, EngineError> {
        if is_html_path(file_path) {
            return self
                .engines
                .html
                .detect_html(file_path, options, &mut *self.io.stderr);
        }
        let content = read_text(file_path).ok_or_else(|| {
            EngineError::new(format!(
                "ENOENT: no such file or directory, open '{file_path}'"
            ))
        })?;
        Ok(detect_text(
            &content,
            file_path,
            &TextOptions {
                profile: options.profile.as_deref(),
                design_system: options.design_system.as_deref(),
                inline_ignores: options.inline_ignores,
            },
        ))
    }

    fn handle_stdin(&mut self) -> Result<Vec<Finding>, EngineError> {
        let input = self.io.stdin().to_string();
        if let Ok(parsed) = serde_json::from_str::<Value>(&input) {
            let fp = parsed
                .get("tool_input")
                .and_then(|t| t.get("file_path"))
                .and_then(|f| f.as_str())
                .map(|s| s.to_string());
            if let Some(fp) = fp {
                if !fp.is_empty() && exists(&fp) {
                    let opts = self.scan_options_for(Some(&fp));
                    return self.detect_local_file(&fp, &opts);
                }
            }
        }
        let opts = self.scan_options_for(None);
        Ok(detect_text(
            &input,
            "<stdin>",
            &TextOptions {
                profile: opts.profile.as_deref(),
                design_system: opts.design_system.as_deref(),
                inline_ignores: opts.inline_ignores,
            },
        ))
    }
}

re!(VIEWPORT_RE, format!("^({D}{{2,5}})[xX]({D}{{2,5}})$"));
re!(URL_RE, "^(?i:https?|file)://");
re!(FILE_URL_RE, "^(?i:file):");

/// `fileURLToPath` for the `file:` URLs the CLI accepts; None when it can't map.
fn file_url_to_local_path(url: &str) -> Option<String> {
    let rest = url.get(5..)?; // after "file:"
    let path = if let Some(r) = rest.strip_prefix("//") {
        // file://host/path: only an empty host or localhost maps on posix.
        let (host, p) = match r.find('/') {
            Some(i) => (&r[..i], &r[i..]),
            None => (r, ""),
        };
        if !host.is_empty() && host != "localhost" && !cfg!(windows) {
            return None;
        }
        p.to_string()
    } else {
        rest.to_string()
    };
    if path.is_empty() {
        return None;
    }
    let decoded = crate::config::decode_uri_component(&path);
    if decoded.contains('\0') {
        return None;
    }
    if cfg!(windows) {
        // Node win32 fileURLToPath: `/C:/x` -> `C:\x` (drive letter required
        // for a hostless URL; `file://host/share/x` -> `\\host\share\x`).
        let mut host = String::new();
        if let Some(r) = rest.strip_prefix("//") {
            host = match r.find('/') {
                Some(i) => r[..i].to_string(),
                None => r.to_string(),
            };
        }
        let win = decoded.replace('/', "\\");
        if !host.is_empty() && host != "localhost" {
            return Some(format!("\\\\{host}{win}"));
        }
        let b = win.as_bytes();
        // Expect `\X:` after decoding.
        if b.len() < 3 || b[0] != b'\\' || !b[1].is_ascii_alphabetic() || b[2] != b':' {
            return None;
        }
        return Some(win[1..].to_string());
    }
    Some(decoded)
}

/// JS: main.mjs#detectCli. `args` are the argv after the `detect` verb (the
/// leading `detect` the JS strips itself is also stripped here).
pub fn run_detect(args: &[String], io: &mut Io, engines: &Engines) -> i32 {
    match detect_cli(args, io, engines) {
        Ok(code) => code,
        Err(Exit(code)) => code,
    }
}

fn detect_cli(args_in: &[String], io: &mut Io, engines: &Engines) -> Result<i32, Exit> {
    let mut args: Vec<String> = args_in
        .iter()
        .map(|a| match a.as_str() {
            "-json" => "--json".to_string(),
            "-fast" => "--fast".to_string(),
            _ => a.clone(),
        })
        .collect();
    if args.first().map(String::as_str) == Some("detect") {
        args.remove(0);
    }
    let has = |args: &[String], flag: &str| args.iter().any(|a| a == flag);
    let json_mode = has(&args, "--json");
    let quiet_mode = has(&args, "--quiet");
    let help_mode = has(&args, "--help");
    let no_advisory = has(&args, "--no-advisory");
    if has(&args, "--fast") {
        io.err("Note: --fast is deprecated and ignored. The full scan is fast now and runs every rule.\n");
    }
    if has(&args, "--gpt") || has(&args, "--gemini") {
        io.err("Note: --gpt and --gemini are deprecated and ignored. Generated-UI tells now run by default.\n");
    }
    let config_enabled = !has(&args, "--no-config");
    let cwd = io.cwd.to_string_lossy().into_owned();
    let detection_config = if config_enabled {
        read_detection_config(&cwd)
    } else {
        DetectionConfig::raw()
    };
    let scopes_valid = rule_scopes().join(", ");
    let mut scopes: Vec<String> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let inline = args[i].starts_with("--scope=");
        if args[i] != "--scope" && !inline {
            i += 1;
            continue;
        }
        let value: Option<String> = if inline {
            Some(args[i]["--scope=".len()..].to_string())
        } else {
            args.get(i + 1).cloned()
        };
        let parsed: Vec<String> = match value {
            Some(v) if !v.starts_with("--") => v
                .split(',')
                .map(|s| impeccable_core::js::trim(s).to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            _ => vec![],
        };
        if parsed.is_empty() {
            io.err(&format!(
                "Error: --scope requires a value. Valid scopes: {scopes_valid}\n"
            ));
            return Err(Exit(1));
        }
        scopes.extend(parsed);
        let n = if inline { 1 } else { 2 };
        for _ in 0..n {
            if i < args.len() {
                args.remove(i);
            }
        }
    }
    let mut viewport: Option<(u32, u32)> = None;
    let mut i = 0;
    while i < args.len() {
        let inline = args[i].starts_with("--viewport=");
        if args[i] != "--viewport" && !inline {
            i += 1;
            continue;
        }
        let value: String = if inline {
            args[i]["--viewport=".len()..].to_string()
        } else {
            args.get(i + 1).cloned().unwrap_or_default()
        };
        let Some(m) = VIEWPORT_RE.captures(&value) else {
            io.err("Error: --viewport requires a WxH value, e.g. --viewport 390x844\n");
            return Err(Exit(1));
        };
        viewport = Some((m[1].parse().unwrap_or(0), m[2].parse().unwrap_or(0)));
        let n = if inline { 1 } else { 2 };
        for _ in 0..n {
            if i < args.len() {
                args.remove(i);
            }
        }
    }
    let valid = rule_scopes();
    let unknown: Vec<&String> = scopes
        .iter()
        .filter(|s| !valid.contains(&s.as_str()))
        .collect();
    if !unknown.is_empty() {
        let list: Vec<&str> = unknown.iter().map(|s| s.as_str()).collect();
        io.err(&format!(
            "Error: unknown --scope value(s): {}. Valid scopes: {scopes_valid}\n",
            list.join(", ")
        ));
        return Err(Exit(1));
    }
    let design_system_enabled = config_enabled
        && !has(&args, "--no-design-system")
        && detection_config.design_system_not_disabled();
    let inline_ignores_enabled = config_enabled && !has(&args, "--no-inline-ignores");
    let base = ScanOptions {
        inline_ignores: inline_ignores_enabled,
        design_system: None,
        viewport,
        profile: None,
    };
    let targets: Vec<String> = args
        .iter()
        .filter(|a| !a.starts_with("--"))
        .cloned()
        .collect();

    if help_mode {
        io.out(USAGE);
        return Ok(0);
    }

    let stdin_tty = io.stdin_is_tty;
    let stderr_tty = stderr_is_tty();
    let home = io
        .home()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut ctx = Ctx {
        io,
        engines,
        cwd: cwd.clone(),
        home,
        config: detection_config,
        json_mode,
        quiet_mode,
        design_system_enabled,
        base,
        cache: DesignSystemCache::new(),
        stdin_tty,
    };

    let mut all: Vec<Finding> = Vec::new();
    if !stdin_tty && targets.is_empty() {
        all = ctx.handle_stdin().map_err(|e| fatal(ctx.io, e))?;
    } else {
        let paths: Vec<String> = if targets.is_empty() {
            vec![cwd.clone()]
        } else {
            targets.clone()
        };
        let url_count = paths.iter().filter(|p| URL_RE.is_match(p)).count();
        let shared = if url_count > 1 {
            engines.url.and_then(|u| u.open_shared())
        } else {
            None
        };
        let result = scan_targets(&mut ctx, &paths, shared.as_deref(), &mut all);
        if let Some(s) = shared {
            s.close();
        }
        result?;
    }

    all = filter_detection_findings(all, &ctx.config);
    let scope_refs: Vec<&str> = scopes.iter().map(|s| s.as_str()).collect();
    all = filter_by_scopes(all, &scope_refs, |f: &Finding| f.antipattern.as_str());
    if no_advisory {
        all.retain(|f| !is_advisory(f));
    }
    let (primary, advisory) = partition_advisory(&all);
    let (primary_len, advisory_len) = (primary.len(), advisory.len());
    if !all.is_empty() {
        if json_mode {
            let text = format_findings(&all, true, stderr_tty);
            ctx.io.out(&format!("{text}\n"));
        } else if quiet_mode {
            ctx.io
                .err(&format!("{}\n", format_finding_summary(primary_len)));
            if advisory_len > 0 {
                let note = dim(
                    &format!(
                        "{advisory_len} advisory note{} (not counted).",
                        if advisory_len == 1 { "" } else { "s" }
                    ),
                    stderr_tty,
                );
                ctx.io.err(&format!("{note}\n"));
            }
        } else {
            let text = format_findings(&all, false, stderr_tty);
            ctx.io.err(&format!("{text}\n"));
        }
        return Ok(if primary_len > 0 { 2 } else { 0 });
    }
    if json_mode {
        ctx.io.out("[]\n");
    }
    Ok(0)
}

/// An engine error outside a per-URL try: the JS lets it propagate to
/// `cli.js`, which prints the message and exits 1.
fn fatal(io: &mut Io, e: EngineError) -> Exit {
    io.err(&format!("{}\n", e.message));
    Exit(1)
}

fn scan_targets(
    ctx: &mut Ctx,
    paths: &[String],
    shared: Option<&dyn crate::engines::SharedBrowser>,
    all: &mut Vec<Finding>,
) -> Result<(), Exit> {
    for target in paths {
        if URL_RE.is_match(target) {
            let url_options = if FILE_URL_RE.is_match(target) {
                let local = file_url_to_local_path(target);
                ctx.scan_options_for(local.as_deref())
            } else {
                ctx.base.clone()
            };
            let result = match (shared, ctx.engines.url) {
                (Some(s), _) => s.detect_url(target, &url_options),
                (None, Some(u)) => u.detect_url(target, &url_options),
                (None, None) => crate::engines::UrlEngine::detect_url(
                    &crate::engines::MissingUrlEngine,
                    target,
                    &url_options,
                ),
            };
            match result {
                Ok(f) => all.extend(f),
                Err(e) => ctx.io.err(&format!("Error: {}\n", e.message)),
            }
            continue;
        }
        let resolved = jsp::resolve(&ctx.cwd, &[target]);
        let Ok(stat) = std::fs::metadata(&resolved) else {
            ctx.io.err(&format!("Warning: cannot access {target}\n"));
            continue;
        };
        if stat.is_dir() {
            if !ctx.json_mode && !ctx.quiet_mode {
                if let Some(fw) = detect_framework_config(&resolved) {
                    let probe = is_port_listening(fw.port, Some(fw.fingerprint));
                    let msg = if probe.listening && probe.matched {
                        format!(
                            "\n{} dev server detected on localhost:{}.\nFor more accurate results, scan the running site:\n  npx impeccable detect http://localhost:{}\n\n",
                            fw.name, fw.port, fw.port
                        )
                    } else if probe.listening && !probe.matched {
                        format!(
                            "\n{} project detected ({}).\nPort {} is in use by another service. Start the {} dev server and scan via URL for best results.\n\n",
                            fw.name,
                            jsp::basename(&fw.config_path),
                            fw.port,
                            fw.name
                        )
                    } else {
                        format!(
                            "\n{} project detected ({}).\nStart the dev server and scan via URL for best results:\n  npx impeccable detect http://localhost:{}\n\n",
                            fw.name,
                            jsp::basename(&fw.config_path),
                            fw.port
                        )
                    };
                    ctx.io.err(&msg);
                }
            }
            let cwd = ctx.cwd.clone();
            let files: Vec<String> = walk_dir(&resolved)
                .into_iter()
                .filter(|f| !should_ignore_detection_file(f, &cwd, &ctx.config))
                .collect();
            let html_count = files.iter().filter(|f| is_html_path(f)).count();
            if files.len() > 50 && ctx.stdin_tty && !ctx.json_mode && !ctx.quiet_mode {
                ctx.io.err(&format!(
                    "\nFound {} files ({} HTML) in {}.\nScanning may take a while{}.\nTarget a specific subdirectory to narrow scope.\n",
                    files.len(),
                    html_count,
                    target,
                    if html_count > 10 { " (static HTML/CSS processes each HTML file individually)" } else { "" }
                ));
                if !confirm(ctx.io, "Continue?") {
                    ctx.io.err("Aborted.\n");
                    return Err(Exit(0));
                }
            }
            let graph = build_import_graph(&files);
            let mut imported_by_map: Vec<(String, Vec<String>)> = Vec::new();
            for (importer, imports) in &graph {
                for imported in imports {
                    if let Some(slot) = imported_by_map.iter_mut().find(|(k, _)| k == imported) {
                        if !slot.1.contains(importer) {
                            slot.1.push(importer.clone());
                        }
                    } else {
                        imported_by_map.push((imported.clone(), vec![importer.clone()]));
                    }
                }
            }
            for file in &files {
                let opts = ctx.scan_options_for(Some(file));
                let mut file_findings = ctx
                    .detect_local_file(file, &opts)
                    .map_err(|e| fatal(ctx.io, e))?;
                if let Some((_, importers)) = imported_by_map.iter().find(|(k, _)| k == file) {
                    if !importers.is_empty() {
                        let names: Vec<Value> = importers
                            .iter()
                            .map(|f| Value::String(jsp::basename(f)))
                            .collect();
                        for f in &mut file_findings {
                            f.extras
                                .insert("importedBy".into(), Value::Array(names.clone()));
                        }
                    }
                }
                all.extend(file_findings);
            }
        } else if stat.is_file() {
            let cwd = ctx.cwd.clone();
            if should_ignore_detection_file(&resolved, &cwd, &ctx.config) {
                continue;
            }
            let opts = ctx.scan_options_for(Some(&resolved));
            let f = ctx
                .detect_local_file(&resolved, &opts)
                .map_err(|e| fatal(ctx.io, e))?;
            all.extend(f);
        }
    }
    Ok(())
}

/// JS `confirm(question)`: readline on a TTY stdin, prompt to stderr.
fn confirm(io: &mut Io, question: &str) -> bool {
    io.err(&format!("{question} [Y/n] "));
    let _ = io.stderr.flush();
    let mut answer = String::new();
    // Only reached when stdin is a TTY, so a direct line read is what the
    // JS readline does too.
    let _ = std::io::stdin().read_line(&mut answer);
    let a = impeccable_core::js::trim(&answer);
    a.is_empty() || a.eq_ignore_ascii_case("y") || a.eq_ignore_ascii_case("yes")
}

fn stderr_is_tty() -> bool {
    #[cfg(unix)]
    {
        extern "C" {
            fn isatty(fd: i32) -> i32;
        }
        unsafe { isatty(2) == 1 }
    }
    #[cfg(not(unix))]
    {
        std::io::IsTerminal::is_terminal(&std::io::stderr())
    }
}
