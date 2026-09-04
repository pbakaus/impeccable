//! The universal bundle: download / local override, zip extraction, the
//! tree-hash up-to-date check, and the copy / refresh / link / agents steps.
//! JS: skills.mjs `downloadAndExtractBundle`, `copyOrExtractLocalBundle`,
//! `extractZip`, `downloadFile`, `listSkillTreeFiles`, `normalizeForHash`,
//! `hashSkillFile`, `isUpToDate`, `copyProviderSkills`, `refreshProviderSkills`,
//! `copyProviderAgents`, `reportProviderAgents`, `isInProjectProviderLink`,
//! `resolveLinkSource`, `linkProviderSkills`.

use std::io::Read;

use impeccable_common::Io;
use once_cell::sync::Lazy;
use regex::Regex;
use sha2::{Digest, Sha256};

use crate::providers::{
    opencode_global_config_dir, provider_display_name, Scope, Sys, API_BASE, PROVIDER_DIRS,
};
use crate::util::{self, jsp};
use crate::bundle_signature::{self, TrustedKeys, MAX_SIGNATURE_BYTES};

/// Ceiling on any single download this crate performs (triage C4). The
/// launcher-only universal bundle is under 25 MB (the Cloudflare Pages file
/// cap it is served through) and a single engine binary is a few tens of MB,
/// so 256 MiB is ~10x headroom - while a compromised endpoint or MITM can no
/// longer stream unbounded bytes into memory or the staging dir.
pub const MAX_DOWNLOAD_BYTES: u64 = 256 * 1024 * 1024;

/// Extraction caps for the bundle zip (triage C4). Sized for what a skill
/// bundle legitimately holds - the tracked tree is thousands of small text
/// files, and a self-contained (engine-bundled) local zip adds ~50 MB
/// binaries per target - with roomy headroom, while a crafted archive (zip
/// bomb, absurd entry count) is rejected before it exhausts memory or disk:
/// - entry count: tracked bundles hold a few thousand files; cap 50k.
/// - per-entry uncompressed: largest legit entry is an engine binary
///   (~50 MB); cap 256 MiB.
/// - aggregate uncompressed: a self-contained bundle is ~0.5 GB, mostly
///   incompressible binaries; cap 4 GiB.
/// - compression ratio: binaries are ~1:1 and text ~5-10:1; entries over
///   1 MiB claiming better than 200:1 are treated as a bomb.
const MAX_ARCHIVE_ENTRIES: usize = 50_000;
const MAX_ENTRY_BYTES: u64 = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 200;
const RATIO_GUARD_FLOOR: u64 = 1024 * 1024;

/// In-memory GET for the small payloads (`/api/commands`, the engine binary
/// and its sidecars). Non-2xx → `HTTP <status>`. The bundle itself goes
/// through `download_file`, which streams to disk. Reads are capped at
/// [`MAX_DOWNLOAD_BYTES`]; a longer response is an error, not a truncation.
pub fn download(url: &str) -> Result<Vec<u8>, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(30))
        .build();
    match agent.get(url).call() {
        Ok(res) => {
            let mut body = Vec::new();
            res.into_reader()
                .take(MAX_DOWNLOAD_BYTES + 1)
                .read_to_end(&mut body)
                .map_err(|e| e.to_string())?;
            if body.len() as u64 > MAX_DOWNLOAD_BYTES {
                return Err(format!("response too large downloading {url} (over {MAX_DOWNLOAD_BYTES} bytes)"));
            }
            Ok(body)
        }
        Err(ureq::Error::Status(code, _)) => Err(format!("HTTP {code}")),
        Err(ureq::Error::Transport(t)) => Err(t.to_string()),
    }
}

/// What `download_file` needs from a transport hop: the status, the
/// `Location` header when redirected, and the body stream. Tests inject a
/// fake the way the JS tests injected `fetchImpl`.
pub struct FetchResponse {
    pub status: u16,
    pub location: Option<String>,
    pub body: Box<dyn Read>,
}

fn ureq_fetch(url: &str) -> Result<FetchResponse, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(120))
        .redirects(0)
        .build();
    match agent.get(url).call() {
        Ok(res) => Ok(FetchResponse {
            status: res.status(),
            location: res.header("location").map(str::to_string),
            body: Box::new(res.into_reader()),
        }),
        Err(ureq::Error::Status(code, res)) => Ok(FetchResponse {
            status: code,
            location: res.header("location").map(str::to_string),
            body: Box::new(res.into_reader()),
        }),
        Err(ureq::Error::Transport(t)) => Err(t.to_string()),
    }
}

/// JS: downloadFile(url, dest, { fetchImpl }) after #479 + af2e8b3a: manual
/// redirects (5 hops, relative Locations resolved against the current URL),
/// HTTPS only, the body streamed to `dest` opened `wx`. On failure the
/// partial file is removed unless the failure was the `wx` EEXIST itself.
pub fn download_file(url: &str, dest: &str) -> Result<(), String> {
    download_file_with(url, dest, &mut ureq_fetch)
}

pub fn download_file_with(
    url: &str,
    dest: &str,
    fetch: &mut dyn FnMut(&str) -> Result<FetchResponse, String>,
) -> Result<(), String> {
    download_file_capped(url, dest, fetch, MAX_DOWNLOAD_BYTES)
}

fn download_file_capped(
    url: &str,
    dest: &str,
    fetch: &mut dyn FnMut(&str) -> Result<FetchResponse, String>,
    max_bytes: u64,
) -> Result<(), String> {
    let mut current = url.to_string();
    let mut hops_left = 5;
    loop {
        // JS: new URL(current) throws `Invalid URL` (a TypeError) first.
        let parsed = url::Url::parse(&current).map_err(|_| "Invalid URL".to_string())?;
        if parsed.scheme() != "https" {
            return Err("Refusing non-HTTPS URL".to_string());
        }
        let res = fetch(&current)?;
        if res.status >= 300 && res.status < 400 {
            let Some(location) = res.location else {
                return Err(format!("HTTP {}", res.status));
            };
            if hops_left <= 0 {
                return Err("Too many redirects".to_string());
            }
            hops_left -= 1;
            // JS: new URL(location, current).href
            current = parsed
                .join(&location)
                .map_err(|_| "Invalid URL".to_string())?
                .to_string();
            continue;
        }
        if res.status != 200 {
            return Err(format!("HTTP {}", res.status));
        }
        // JS-PARITY: the `if (!res.body) throw new Error('Empty response
        // body')` guard has no ureq equivalent — a response always carries a
        // reader here.
        let mut file = match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dest)
        {
            Ok(f) => f,
            // EEXIST comes from the `wx` open itself: JS leaves the existing
            // file alone and rethrows.
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(util::node_error("open", dest, &e));
            }
            Err(e) => {
                util::rm_rf(dest);
                return Err(util::node_error("open", dest, &e));
            }
        };
        // Stream at most `max_bytes` to disk; a longer response is rejected
        // and the partial file removed (triage C4).
        let copied = std::io::copy(&mut res.body.take(max_bytes + 1), &mut file)
            .and_then(|n| {
                use std::io::Write;
                file.flush().map(|_| n)
            });
        match copied {
            Ok(n) if n > max_bytes => {
                drop(file);
                util::rm_rf(dest);
                return Err(format!(
                    "response too large downloading {current} (over {max_bytes} bytes)"
                ));
            }
            Ok(_) => {}
            Err(e) => {
                drop(file);
                util::rm_rf(dest);
                return Err(e.to_string());
            }
        }
        return Ok(());
    }
}

/// JS: extractZip(zipPath, targetDir), on in-memory bytes. Directory entries
/// are skipped (files create their parents); zip-slip guarded.
pub fn extract_zip(bytes: &[u8], target_dir: &str, cwd: &str) -> Result<(), String> {
    extract_zip_from(std::io::Cursor::new(bytes), target_dir, cwd)
}

/// `extract_zip` reading the archive from disk, so the bundle zip is never
/// buffered whole in memory (JS af2e8b3a streamed the download for the same
/// reason).
pub fn extract_zip_file(zip_path: &str, target_dir: &str, cwd: &str) -> Result<(), String> {
    let file = std::fs::File::open(zip_path)
        .map_err(|e| util::node_error("open", zip_path, &e))?;
    extract_zip_from(std::io::BufReader::new(file), target_dir, cwd)
}

/// Zip-slip confinement: `dest` (already resolved against `root`) is the
/// root itself or strictly under it, on a path-separator boundary. `sep` is
/// a parameter because `jsp::resolve` emits the host separator - the old
/// hardcoded `"{root}/"` comparison rejected every entry on Windows, where
/// resolve emits `\` (triage B1).
fn dest_within_root(root: &str, dest: &str, sep: &str) -> bool {
    dest == root || dest.starts_with(&format!("{root}{sep}"))
}

fn extract_zip_from<R: Read + std::io::Seek>(reader: R, target_dir: &str, cwd: &str) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(format!(
            "Refusing to extract archive with {} entries (over {MAX_ARCHIVE_ENTRIES})",
            archive.len()
        ));
    }
    let root = jsp::resolve(cwd, &[target_dir]);
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let entry_path = entry.name().to_string();
        if entry_path.ends_with('/') {
            continue;
        }
        // Bomb guards on the declared sizes (triage C4); the actual read
        // below is capped too, since headers can lie.
        let declared = entry.size();
        let compressed = entry.compressed_size().max(1);
        if declared > MAX_ENTRY_BYTES {
            return Err(format!(
                "Refusing to extract oversized entry {entry_path} ({declared} bytes, over {MAX_ENTRY_BYTES})"
            ));
        }
        if declared > RATIO_GUARD_FLOOR && declared / compressed > MAX_COMPRESSION_RATIO {
            return Err(format!(
                "Refusing to extract entry {entry_path} with a suspicious compression ratio ({declared} from {compressed} bytes)"
            ));
        }
        let dest = jsp::resolve(&root, &[&entry_path]);
        if !dest_within_root(&root, &dest, jsp::SEP) {
            return Err(format!("Refusing to extract entry outside target dir: {entry_path}"));
        }
        util::mkdir_p(&jsp::dirname(&dest))?;
        let mut data = Vec::new();
        (&mut entry)
            .take(MAX_ENTRY_BYTES + 1)
            .read_to_end(&mut data)
            .map_err(|e| e.to_string())?;
        if data.len() as u64 > MAX_ENTRY_BYTES {
            return Err(format!(
                "Refusing to extract oversized entry {entry_path} (over {MAX_ENTRY_BYTES} bytes)"
            ));
        }
        total = total.saturating_add(data.len() as u64);
        if total > MAX_TOTAL_BYTES {
            return Err(format!(
                "Refusing to extract archive over {MAX_TOTAL_BYTES} uncompressed bytes"
            ));
        }
        util::write_bytes(&dest, &data)?;
        // Preserve the zip's unix mode (std::fs::write drops it), and make
        // the launcher and staged engine binaries executable even when the
        // zip carries no unix modes (a zip built on Windows): a 0644
        // `scripts/impeccable` fails every hook and Setup call with
        // "Permission denied".
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = entry.unix_mode().unwrap_or(0) & 0o7777;
            if mode != 0 {
                let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(mode));
            } else if entry_path.ends_with("scripts/impeccable") || entry_path.contains("scripts/bin/") {
                let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
            }
        }
    }
    Ok(())
}

/// JS: downloadAndExtractBundle() after #479: a mkdtemp staging dir holds
/// both the zip and the extracted tree; any failure removes the whole
/// staging dir before rethrowing. Returns the staging dir (caller removes).
pub fn download_and_extract_bundle(sys: &Sys) -> Result<String, String> {
    if let Some(local) = sys.env.get("IMPECCABLE_BUNDLE_PATH").filter(|v| !v.is_empty()) {
        return copy_or_extract_local_bundle(sys, local);
    }
    download_remote_bundle(sys, &mut ureq_fetch, bundle_signature::trusted_keys())
}

fn download_remote_bundle(
    sys: &Sys,
    fetch: &mut dyn FnMut(&str) -> Result<FetchResponse, String>,
    keys: Result<TrustedKeys, String>,
) -> Result<String, String> {
    keys.and_then(|keys| download_and_extract_signed_bundle(sys, fetch, &keys))
        .map_err(|e| format!("{}{e}. Nothing was installed; retry or update the CLI. If this persists, report it at https://github.com/pbakaus/impeccable/issues/479", bundle_signature::ERROR_PREFIX))
}

fn download_and_extract_signed_bundle(
    sys: &Sys,
    fetch: &mut dyn FnMut(&str) -> Result<FetchResponse, String>,
    keys: &TrustedKeys,
) -> Result<String, String> {
    let tmp = util::tmpdir(&sys.env);
    let staging = util::mkdtemp(&jsp::join(&[&tmp, "impeccable-update-"]))?;
    let tmp_zip = jsp::join(&[&staging, "bundle.zip"]);
    let tmp_signature = jsp::join(&[&staging, "bundle.sig.json"]);
    let result = (|| -> Result<(), String> {
        // Resolve once, then request both assets from that exact release. Never
        // pair a latest-version lookup with a independently changing ZIP URL.
        let response = fetch(&format!("{API_BASE}/api/download/bundle/universal"))?;
        if !matches!(response.status, 301 | 302 | 303 | 307 | 308) {
            return Err(format!("Expected a signed bundle release redirect (HTTP {})", response.status));
        }
        let location = response.location.ok_or("Missing bundle release redirect")?;
        let version = bundle_signature::release_version(&location)?;
        download_file_capped(&format!("{location}.sig.json"), &tmp_signature, fetch, MAX_SIGNATURE_BYTES)?;
        download_file_with(&location, &tmp_zip, fetch)?;
        let signature = std::fs::read(&tmp_signature).map_err(|e| e.to_string())?;
        let file = std::fs::File::open(&tmp_zip).map_err(|e| e.to_string())?;
        let mut reader = std::io::BufReader::new(file);
        bundle_signature::verify_reader(&mut reader, &signature, &version, keys)?;
        // Reuse the verified file handle rather than reopening by pathname.
        use std::io::Seek;
        reader.rewind().map_err(|e| e.to_string())?;
        extract_zip_from(reader, &staging, &sys.cwd)?;
        util::rm_rf(&tmp_zip);
        util::rm_rf(&tmp_signature);
        Ok(())
    })();
    match result {
        Ok(()) => Ok(staging),
        Err(e) => {
            util::rm_rf(&staging);
            Err(e)
        }
    }
}

/// JS: copyOrExtractLocalBundle(sourceValue), the #479 shape: mkdtemp
/// staging, removed whole on failure.
fn copy_or_extract_local_bundle(sys: &Sys, source_value: &str) -> Result<String, String> {
    let source = jsp::resolve(&sys.cwd, &[source_value]);
    if !util::exists(&source) {
        return Err(format!("Local bundle not found: {source}"));
    }
    let tmp = util::tmpdir(&sys.env);
    let staging = util::mkdtemp(&jsp::join(&[&tmp, "impeccable-local-bundle-"]))?;
    let result = (|| -> Result<(), String> {
        if util::is_dir(&source) {
            util::copy_dir(&source, &staging)
        } else {
            extract_zip_file(&source, &staging, &sys.cwd)
        }
    })();
    match result {
        Ok(()) => Ok(staging),
        Err(e) => {
            util::rm_rf(&staging);
            Err(e)
        }
    }
}

/// JS: listSkillTreeFiles(root): every file, sorted, relative with `/`.
/// The engine binaries under `scripts/bin/` are excluded: they are installed
/// next to the bundle's files (see `engine_binary`) and never ship in it, so
/// they must not read as a difference from the bundle.
pub fn list_skill_tree_files(root: &str) -> Vec<String> {
    fn walk(root: &str, dir: &str, out: &mut Vec<String>) {
        let Some(names) = util::read_dir_names(dir) else { return };
        for name in names {
            let full = jsp::join(&[dir, &name]);
            let meta = match std::fs::metadata(&full) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.is_dir() {
                walk(root, &full, out);
            } else if meta.is_file() {
                let rel = jsp::relative("/", root, &full);
                if rel.starts_with("scripts/bin/") {
                    continue;
                }
                out.push(rel);
            }
        }
    }
    let mut out = Vec::new();
    if util::exists(root) {
        walk(root, root, &mut out);
    }
    out
}

static PROVIDER_PATH_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\.(claude|cursor|agents|agent|github|gemini|codex|grok|hermes|kiro|opencode|pi|qoder|trae|trae-cn|rovodev|vibe)/skills/").unwrap()
});

/// JS: normalizeForHash(content)
pub fn normalize_for_hash(content: &str) -> String {
    PROVIDER_PATH_RE.replace_all(content, ".PROVIDER/skills/").into_owned()
}

/// JS: hashSkillFile(filePath)
pub fn hash_skill_file(path: &str) -> Result<String, String> {
    let text = util::read_text(path)?;
    let mut hasher = Sha256::new();
    hasher.update(normalize_for_hash(&text).as_bytes());
    Ok(hex(&hasher.finalize()))
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// JS: isUpToDate(root, providers, bundleDir, scope, agentScope = scope).
/// `agent_scope` lets a home-rooted implicit update keep checking the user
/// agent dirs while the skill scope stays inferred (upstream d2a9efb9).
pub fn is_up_to_date(sys: &Sys, root: &str, providers: &[&str], bundle_dir: &str, scope: Option<Scope>, agent_scope: Option<Scope>) -> Result<bool, String> {
    let unique = sys.deduplicate_providers(root, providers, scope);
    if unique.is_empty() {
        return Ok(false);
    }
    for (provider, local_skills_dir) in unique {
        let bundle_skills_dir = jsp::join(&[bundle_dir, provider, "skills"]);
        // JS-PARITY: a provider with no bundled skills dir `continue`s past
        // the agents check too.
        if !util::exists(&bundle_skills_dir) {
            continue;
        }
        for name in util::read_dir_names(&bundle_skills_dir).unwrap_or_default() {
            let bundle_skill_dir = jsp::join(&[&bundle_skills_dir, &name]);
            let local_skill_dir = jsp::join(&[&local_skills_dir, &name]);
            if !util::exists(&jsp::join(&[&bundle_skill_dir, "SKILL.md"])) {
                continue;
            }
            if !util::exists(&local_skill_dir) {
                return Ok(false);
            }
            let bundle_files = list_skill_tree_files(&bundle_skill_dir);
            let local_files = list_skill_tree_files(&local_skill_dir);
            if bundle_files != local_files {
                return Ok(false);
            }
            for rel in &bundle_files {
                let b = hash_skill_file(&jsp::join(&[&bundle_skill_dir, rel]))?;
                let l = hash_skill_file(&jsp::join(&[&local_skill_dir, rel]))?;
                if b != l {
                    return Ok(false);
                }
            }
        }
        // Provider command artifacts (OpenCode's `commands/impeccable.md`) are
        // part of "current" too: an install whose skills match but whose
        // bridge is missing or drifted must refresh, otherwise
        // reinstall/update report success while the slash command stays
        // absent (#483). Only bundle-shipped files are checked, so pinned or
        // user commands never affect freshness. The commands dir sits next to
        // the matched skills dir, so deriving it from `local_skills_dir` stays
        // correct for every layout `copy_provider_commands` can write.
        let bundle_commands_dir = jsp::join(&[bundle_dir, provider, "commands"]);
        if util::exists(&bundle_commands_dir) {
            let local_commands_dir = jsp::join(&[&jsp::dirname(&local_skills_dir), "commands"]);
            for entry in util::read_dir_names(&bundle_commands_dir).unwrap_or_default() {
                let bundle_file = jsp::join(&[&bundle_commands_dir, &entry]);
                if !util::is_file(&bundle_file) {
                    continue;
                }
                let local_file = jsp::join(&[&local_commands_dir, &entry]);
                if !util::exists(&local_file) {
                    return Ok(false);
                }
                if hash_skill_file(&bundle_file)? != hash_skill_file(&local_file)? {
                    return Ok(false);
                }
            }
        }
        if !provider_agents_up_to_date(bundle_dir, root, provider, agent_scope)? {
            return Ok(false);
        }
    }
    Ok(true)
}

/// JS: isInProjectProviderLink(localSkillsDir, root, provider)
fn is_in_project_provider_link(local_skills_dir: &str, root: &str, provider: &str) -> bool {
    if !util::is_symlink(local_skills_dir) {
        return false;
    }
    let Some(target) = util::readlink(local_skills_dir) else { return false };
    let resolved_target = jsp::resolve(&jsp::dirname(local_skills_dir), &[&target]);
    PROVIDER_DIRS
        .iter()
        .filter(|other| **other != provider)
        .any(|other| resolved_target == jsp::join(&[root, other, "skills"]))
}

/// The bundle's skill directories under `<bundle>/<provider>/skills` (real
/// directories only, like `Dirent.isDirectory()`).
fn bundle_skill_dirs(src_dir: &str) -> Vec<String> {
    util::read_dir_names(src_dir)
        .unwrap_or_default()
        .into_iter()
        .filter(|name| util::is_real_dir(&jsp::join(&[src_dir, name])))
        .collect()
}

/// JS: copyProviderSkills(bundleDir, root, targets, {scope}). Returns the
/// skill directories written (the JS returned only the count).
pub fn copy_provider_skills(sys: &Sys, bundle_dir: &str, root: &str, targets: &[&str], scope: Option<Scope>) -> Result<Vec<String>, String> {
    let mut written = Vec::new();
    for provider in targets {
        let src_dir = jsp::join(&[bundle_dir, provider, "skills"]);
        if !util::exists(&src_dir) {
            continue;
        }
        let local_skills_dir = if scope == Some(Scope::User) {
            sys.user_provider_skills_dir(root, provider)
        } else {
            jsp::join(&[root, provider, "skills"])
        };
        if is_in_project_provider_link(&local_skills_dir, root, provider) {
            let _ = std::fs::remove_file(&local_skills_dir);
        }
        let skills = bundle_skill_dirs(&src_dir);
        for skill in &skills {
            let src = jsp::join(&[&src_dir, skill]);
            let dest = jsp::join(&[&local_skills_dir, skill]);
            util::rm_rf(&dest);
            util::copy_dir(&src, &dest)?;
            written.push(dest);
        }
        // Pre-#406 global OpenCode install at ~/.opencode/skills: drop exactly
        // the skills just written from the stranded location.
        if scope == Some(Scope::User) && *provider == ".opencode" {
            let legacy_dir = jsp::join(&[root, ".opencode", "skills"]);
            let migratable = util::exists(&legacy_dir)
                && !util::is_symlink(&legacy_dir)
                && util::realpath(&legacy_dir) != util::realpath(&local_skills_dir)
                && !util::exists(&jsp::join(&[root, ".git"]));
            if migratable {
                for skill in &skills {
                    util::rm_rf(&jsp::join(&[&legacy_dir, skill]));
                }
                util::rmdir(&legacy_dir);
            }
        }
    }
    Ok(written)
}

/// JS: skills.mjs#providerCommandsDir. Project installs land at
/// `<root>/<configDir>/commands`; a user-scope OpenCode install must target
/// the config dir OpenCode actually scans.
fn provider_commands_dir(sys: &Sys, root: &str, provider_entry: &str, scope: Option<Scope>) -> String {
    if scope == Some(Scope::User) {
        jsp::join(&[&opencode_global_config_dir(&sys.env, root), "commands"])
    } else {
        jsp::join(&[root, provider_entry, "commands"])
    }
}

/// JS: skills.mjs#copyProviderCommands(bundleDir, root, targets, {scope}).
///
/// OpenCode discovers custom commands from `{command,commands}/**.md` under
/// any active config dir, so this mirrors `copy_provider_skills`: project
/// scope writes `<root>/<configDir>/commands/`, user scope writes
/// `opencode_global_config_dir(home)/commands`.
///
/// Migration guard: a pre-#406 global OpenCode install at
/// `~/.opencode/commands/` is not scanned by OpenCode. After a global
/// install, the commands just written are removed from the stranded legacy
/// copy, sibling commands stay put, symlinked legacy dirs are skipped
/// (deleting through a symlink would empty the real target), and a
/// home-rooted git repo is left alone.
pub fn copy_provider_commands(sys: &Sys, bundle_dir: &str, root: &str, targets: &[&str], scope: Option<Scope>) -> usize {
    let mut written = 0usize;
    for target in targets {
        let dotted = format!(".{target}");
        let provider_entry: &str = if PROVIDER_DIRS.contains(&dotted.as_str()) {
            &dotted
        } else {
            target
        };
        let src_dir = jsp::join(&[bundle_dir, provider_entry, "commands"]);
        if !util::exists(&src_dir) {
            continue;
        }
        let local_commands_dir = provider_commands_dir(sys, root, provider_entry, scope);
        let _ = std::fs::create_dir_all(&local_commands_dir);
        let entries = util::read_dir_names(&src_dir).unwrap_or_default();
        for entry in &entries {
            let src = jsp::join(&[&src_dir, entry]);
            if !util::is_file(&src) {
                continue;
            }
            let dest = jsp::join(&[&local_commands_dir, entry]);
            util::rm_rf(&dest);
            if std::fs::copy(&src, &dest).is_ok() {
                written += 1;
            }
        }
        if scope == Some(Scope::User) && provider_entry == ".opencode" {
            let legacy_dir = jsp::join(&[root, ".opencode", "commands"]);
            let migratable = util::exists(&legacy_dir)
                && !util::is_symlink(&legacy_dir)
                && util::realpath(&legacy_dir) != util::realpath(&local_commands_dir)
                && !util::exists(&jsp::join(&[root, ".git"]));
            if migratable {
                for entry in &entries {
                    if !util::is_file(&jsp::join(&[&src_dir, entry])) {
                        continue;
                    }
                    util::rm_rf(&jsp::join(&[&legacy_dir, entry]));
                }
                util::rmdir(&legacy_dir);
            }
        }
    }
    written
}

/// JS: refreshProviderSkills(bundleDir, root, providers, scope). Returns the
/// skill directories refreshed.
pub fn refresh_provider_skills(sys: &Sys, bundle_dir: &str, root: &str, providers: &[&str], scope: Option<Scope>) -> Result<Vec<String>, String> {
    let mut updated = Vec::new();
    for (provider, local_skills_dir) in sys.deduplicate_providers(root, providers, scope) {
        let src_dir = jsp::join(&[bundle_dir, provider, "skills"]);
        if !util::exists(&src_dir) {
            continue;
        }
        for skill in bundle_skill_dirs(&src_dir) {
            let src = jsp::join(&[&src_dir, &skill]);
            let dest = jsp::join(&[&local_skills_dir, &skill]);
            if util::exists(&dest) {
                util::rm_rf(&dest);
            }
            util::copy_dir(&src, &dest)?;
            updated.push(dest);
        }
    }
    Ok(updated)
}

pub struct AgentResult {
    pub provider: &'static str,
    pub written: usize,
    pub dest_dir: String,
    pub user_dir: String,
    pub shadowed: Vec<String>,
}

struct AgentArtifact {
    ext: &'static str,
    user_dir: fn(&str) -> String,
    user_shadows_project: bool,
}

fn agent_artifact(provider: &str) -> Option<AgentArtifact> {
    match provider {
        // Claude Code's agents live at `.claude/agents/impeccable-*.md`;
        // project agents take precedence over user agents (upstream 7b945856).
        ".claude" => Some(AgentArtifact {
            ext: ".md",
            user_dir: |home| jsp::join(&[home, ".claude", "agents"]),
            user_shadows_project: false,
        }),
        ".github" => Some(AgentArtifact {
            ext: ".agent.md",
            user_dir: |home| jsp::join(&[home, ".copilot", "agents"]),
            user_shadows_project: true,
        }),
        ".cursor" => Some(AgentArtifact {
            ext: ".md",
            user_dir: |home| jsp::join(&[home, ".cursor", "agents"]),
            user_shadows_project: false,
        }),
        _ => None,
    }
}

/// JS: providerAgentsUpToDate(bundleDir, root, provider, scope): every
/// bundled agent file exists at its destination with a matching hash.
fn provider_agents_up_to_date(bundle_dir: &str, root: &str, provider: &str, scope: Option<Scope>) -> Result<bool, String> {
    let Some(artifact) = agent_artifact(provider) else {
        return Ok(true);
    };
    let src_dir = jsp::join(&[bundle_dir, provider, "agents"]);
    if !util::exists(&src_dir) {
        return Ok(true);
    }
    let dest_dir = if scope == Some(Scope::User) {
        (artifact.user_dir)(root)
    } else {
        jsp::join(&[root, provider, "agents"])
    };
    for name in util::read_dir_names(&src_dir).unwrap_or_default() {
        if !name.ends_with(artifact.ext) {
            continue;
        }
        let local_path = jsp::join(&[&dest_dir, &name]);
        if !util::exists(&local_path) {
            return Ok(false);
        }
        if hash_skill_file(&jsp::join(&[&src_dir, &name]))? != hash_skill_file(&local_path)? {
            return Ok(false);
        }
    }
    Ok(true)
}

/// JS: copyProviderAgents(bundleDir, root, providers, {scope, home})
pub fn copy_provider_agents(sys: &Sys, bundle_dir: &str, root: &str, providers: &[&'static str], scope: Option<Scope>) -> Result<Vec<AgentResult>, String> {
    let mut results = Vec::new();
    for provider in providers {
        let Some(artifact) = agent_artifact(provider) else { continue };
        let src_dir = jsp::join(&[bundle_dir, provider, "agents"]);
        if !util::exists(&src_dir) {
            continue;
        }
        let agent_files: Vec<String> = util::read_dir_names(&src_dir)
            .unwrap_or_default()
            .into_iter()
            .filter(|n| n.ends_with(artifact.ext))
            .collect();
        if agent_files.is_empty() {
            continue;
        }
        let dest_dir = if scope == Some(Scope::User) {
            (artifact.user_dir)(root)
        } else {
            jsp::join(&[root, provider, "agents"])
        };
        util::mkdir_p(&dest_dir)?;
        for name in &agent_files {
            util::write_bytes(&jsp::join(&[&dest_dir, name]), &util::read_bytes(&jsp::join(&[&src_dir, name]))?)?;
        }
        let user_dir = (artifact.user_dir)(&sys.home);
        let shadowed: Vec<String> = if artifact.user_shadows_project && scope != Some(Scope::User) {
            agent_files.iter().filter(|n| util::exists(&jsp::join(&[&user_dir, n]))).cloned().collect()
        } else {
            Vec::new()
        };
        results.push(AgentResult { provider, written: agent_files.len(), dest_dir, user_dir, shadowed });
    }
    Ok(results)
}

/// JS: reportProviderAgents(results)
pub fn report_provider_agents(sys: &Sys, io: &mut Io, results: &[AgentResult]) {
    for result in results {
        if result.written == 0 {
            continue;
        }
        io.out(&format!(
            "Installed {} agents into: {}\n",
            provider_display_name(result.provider),
            sys.format_path_for_display(&result.dest_dir)
        ));
        if !result.shadowed.is_empty() {
            io.err(&format!(
                "Warning: user-level agents in {} shadow the project copies just installed: {}.\n",
                sys.format_path_for_display(&result.user_dir),
                result.shadowed.join(", ")
            ));
            io.err("Run `npx impeccable update --user` to refresh them, or remove them so the project agents apply.\n");
        }
    }
}

pub struct LinkSource {
    pub checkout_root: String,
    pub bundle_root: String,
}

/// JS: resolveLinkSource(sourceValue, root)
pub fn resolve_link_source(source_value: Option<&str>, root: &str) -> Result<LinkSource, String> {
    let source_path = source_value.unwrap_or(".impeccable");
    let checkout_root = if jsp::is_absolute(source_path) {
        source_path.to_string()
    } else {
        jsp::resolve(root, &[source_path])
    };
    let universal_root = jsp::join(&[&checkout_root, "dist", "universal"]);
    if util::exists(&universal_root) {
        return Ok(LinkSource { checkout_root, bundle_root: universal_root });
    }
    if PROVIDER_DIRS.iter().any(|p| util::exists(&jsp::join(&[&checkout_root, p, "skills"]))) {
        return Ok(LinkSource { bundle_root: checkout_root.clone(), checkout_root });
    }
    Err(format!("Could not find compiled skills in {source_path}. Expected dist/universal/ or provider skill folders."))
}

/// JS: isSymlinkTo(dest, expectedSource)
fn is_symlink_to(dest: &str, expected_source: &str) -> bool {
    if !util::is_symlink(dest) {
        return false;
    }
    let Some(target) = util::readlink(dest) else { return false };
    let resolved_target = jsp::resolve(&jsp::dirname(dest), &[&target]);
    match (util::realpath(&resolved_target), util::realpath(expected_source)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

pub struct LinkResult {
    pub linked: usize,
    pub already: usize,
    pub skipped: usize,
}

/// JS: linkProviderSkills(bundleRoot, root, targets, {force})
pub fn link_provider_skills(io: &mut Io, bundle_root: &str, root: &str, targets: &[&str], force: bool) -> Result<LinkResult, String> {
    let mut result = LinkResult { linked: 0, already: 0, skipped: 0 };
    // JS: resolveUniqueLinkTargets
    let mut seen: Vec<String> = Vec::new();
    let mut unique: Vec<(&str, String)> = Vec::new();
    for provider in targets {
        let local_skills_dir = jsp::join(&[root, provider, "skills"]);
        util::mkdir_p(&local_skills_dir)?;
        let real = util::realpath(&local_skills_dir).unwrap_or_else(|| local_skills_dir.clone());
        if seen.contains(&real) {
            continue;
        }
        seen.push(real);
        unique.push((provider, local_skills_dir));
    }
    for (provider, local_skills_dir) in unique {
        let src_dir = jsp::join(&[bundle_root, provider, "skills"]);
        if !util::exists(&src_dir) {
            continue;
        }
        for skill in bundle_skill_dirs(&src_dir) {
            let src = jsp::join(&[&src_dir, &skill]);
            let dest = jsp::join(&[&local_skills_dir, &skill]);
            if util::exists_or_link(&dest) {
                if is_symlink_to(&dest, &src) {
                    result.already += 1;
                    continue;
                }
                if !force {
                    io.err(&format!("Skipped existing {provider}/skills/{skill}. Use --force to replace it with a link.\n"));
                    result.skipped += 1;
                    continue;
                }
                util::rm_rf(&dest);
            }
            let mut target = jsp::relative("/", &jsp::dirname(&dest), &src);
            if target.is_empty() {
                target = ".".to_string();
            }
            util::symlink_dir(&target, &dest)?;
            result.linked += 1;
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> String {
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "impeccable-bundle-{tag}-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().into_owned()
    }

    fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write as _;
        let mut buf = std::io::Cursor::new(Vec::new());
        let mut w = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in entries {
            w.start_file(*name, opts).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap();
        buf.into_inner()
    }

    #[test]
    fn extract_writes_normal_entries() {
        let dir = tmp_dir("ok");
        let bytes = zip_bytes(&[("a/x.txt", b"hello"), ("a/b/y.txt", b"world")]);
        extract_zip(&bytes, &dir, "/").unwrap();
        assert_eq!(std::fs::read_to_string(format!("{dir}/a/x.txt")).unwrap(), "hello");
        assert_eq!(std::fs::read_to_string(format!("{dir}/a/b/y.txt")).unwrap(), "world");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn extract_rejects_high_ratio_entry() {
        // 8 MiB of zeros deflates around 1000:1 - far past the 200:1 guard
        // for entries over the 1 MiB floor (triage C4 zip-bomb shape).
        let dir = tmp_dir("bomb");
        let zeros = vec![0u8; 8 * 1024 * 1024];
        let bytes = zip_bytes(&[("skills/bomb.bin", &zeros)]);
        let err = extract_zip(&bytes, &dir, "/").unwrap_err();
        assert!(err.contains("suspicious compression ratio"), "{err}");
        assert!(!std::path::Path::new(&format!("{dir}/skills/bomb.bin")).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn download_file_rejects_oversized_response() {
        // An endpoint streaming unbounded bytes must be cut off at the cap
        // and the partial file removed (triage C4).
        let dir = tmp_dir("dl");
        let dest = format!("{dir}/bundle.zip");
        let mut fetch = |_: &str| -> Result<FetchResponse, String> {
            Ok(FetchResponse {
                status: 200,
                location: None,
                body: Box::new(std::io::repeat(b'a')),
            })
        };
        let err = download_file_capped("https://x/bundle", &dest, &mut fetch, 4096).unwrap_err();
        assert!(err.contains("response too large"), "{err}");
        assert!(!std::path::Path::new(&dest).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn zip_confinement_accepts_nested_entries_on_both_separators() {
        // Unix shapes.
        assert!(dest_within_root("/tmp/stage", "/tmp/stage", "/"));
        assert!(dest_within_root("/tmp/stage", "/tmp/stage/dir/file", "/"));
        // Windows shapes (jsp resolves with `\` there): a legitimate nested
        // entry must be accepted - the hardcoded `/` rejected all of these.
        assert!(dest_within_root(r"C:\stage", r"C:\stage", r"\"));
        assert!(dest_within_root(r"C:\stage", r"C:\stage\dir\file", r"\"));
    }

    #[test]
    fn zip_confinement_rejects_escapes_on_both_separators() {
        // `..` / absolute escapes resolve outside the root.
        assert!(!dest_within_root("/tmp/stage", "/tmp/evil", "/"));
        assert!(!dest_within_root("/tmp/stage", "/etc/passwd", "/"));
        // Sibling-prefix trickery must not pass on either separator.
        assert!(!dest_within_root("/tmp/stage", "/tmp/stage-evil/file", "/"));
        assert!(!dest_within_root(r"C:\stage", r"C:\evil", r"\"));
        assert!(!dest_within_root(r"C:\stage", r"C:\Windows\System32\x", r"\"));
        assert!(!dest_within_root(r"C:\stage", r"C:\stage-evil\file", r"\"));
    }

    #[test]
    fn hash_normalizes_provider_paths() {
        assert_eq!(normalize_for_hash("x .claude/skills/y .trae-cn/skills/z .agent/skills/"), "x .PROVIDER/skills/y .PROVIDER/skills/z .PROVIDER/skills/");
        assert_eq!(normalize_for_hash(".other/skills/"), ".other/skills/");
    }

    #[test]
    fn keyring_load_failure_is_fatal_before_any_download() {
        let sys = Sys::new(Default::default(), "/".into());
        let mut fetch = |_: &str| -> Result<FetchResponse, String> {
            panic!("A failed keyring must never reach the network");
        };
        let error = download_remote_bundle(&sys, &mut fetch, Err("Invalid compiled bundle signing keyring".into())).unwrap_err();
        assert!(error.starts_with(bundle_signature::ERROR_PREFIX), "{error}");
        assert!(error.contains("Invalid compiled bundle signing keyring"), "{error}");
    }

    #[test]
    fn release_resolution_accepts_standard_redirects_only() {
        for status in [200, 300, 301, 302, 303, 304, 305, 306, 307, 308, 404] {
            let root = tmp_dir(&format!("redirect-{status}"));
            let sys = Sys::new([("TMPDIR".into(), root.clone()), ("TEMP".into(), root.clone())].into(), root.clone());
            let mut requests = 0;
            let mut fetch = |_: &str| -> Result<FetchResponse, String> {
                requests += 1;
                if requests > 1 { return Err("reached signature download".into()); }
                Ok(FetchResponse {
                    status,
                    location: Some("https://github.com/pbakaus/impeccable/releases/download/skill-v4.2.0/universal.zip".into()),
                    body: Box::new(std::io::empty()),
                })
            };
            let error = download_and_extract_signed_bundle(&sys, &mut fetch, &Default::default()).unwrap_err();
            if matches!(status, 301 | 302 | 303 | 307 | 308) {
                assert_eq!(error, "reached signature download", "HTTP {status}");
                assert_eq!(requests, 2);
            } else {
                assert!(error.contains("Expected a signed bundle release redirect"), "{error}");
                assert_eq!(requests, 1);
            }
            assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
            util::rm_rf(&root);
        }
    }

    #[test]
    fn signed_download_verifies_before_extraction_and_cleans_all_failures() {
        use ring::signature::{Ed25519KeyPair, KeyPair};
        let key = Ed25519KeyPair::from_seed_unchecked(&[7; 32]).unwrap();
        let hex = |bytes: &[u8]| bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let keys = [("test-only".into(), hex(key.public_key().as_ref()))].into();
        let zip = zip_bytes(&[(".claude/skills/impeccable/SKILL.md", b"verified skill")]);
        let digest = format!("{:x}", Sha256::digest(&zip));
        let payload = format!("impeccable-skill-bundle-v1\ntest-only\nskill-v4.2.0\nuniversal.zip\n{}\n{digest}\n", zip.len());
        let signature = serde_json::to_vec(&serde_json::json!({
            "schema": 1, "keyId": "test-only", "version": "4.2.0", "artifact": "universal.zip",
            "size": zip.len(), "sha256": digest, "signature": hex(key.sign(payload.as_bytes()).as_ref()),
        })).unwrap();
        let release = "https://github.com/pbakaus/impeccable/releases/download/skill-v4.2.0/universal.zip";
        for case in ["valid", "tampered", "missing", "oversized", "downgrade", "malformed-zip", "invalid-signature"] {
            let root = tmp_dir(case);
            let temp = format!("{root}/temp");
            std::fs::create_dir(&temp).unwrap();
            let installed = format!("{root}/existing-skill.md");
            std::fs::write(&installed, "user's existing skill").unwrap();
            let sys = Sys::new([("TMPDIR".into(), temp.clone()), ("TEMP".into(), temp.clone())].into(), root.clone());
            let mut requested = Vec::new();
            let mut fetch = |url: &str| -> Result<FetchResponse, String> {
                requested.push(url.to_string());
                let mut res = FetchResponse { status: 200, location: None, body: Box::new(std::io::Cursor::new(Vec::new())) };
                if url.ends_with("/api/download/bundle/universal") {
                    res.status = 302;
                    res.location = Some(release.into());
                } else if url == format!("{release}.sig.json") {
                    res.body = Box::new(std::io::Cursor::new(signature.clone()));
                    match case {
                        "missing" => res.status = 404,
                        "oversized" => res.body = Box::new(std::io::repeat(b' ')),
                        "downgrade" => { res.status = 302; res.location = Some("http://unsafe.test/sig".into()); }
                        "invalid-signature" => res.body = Box::new(std::io::Cursor::new(b"{}".to_vec())),
                        _ => {}
                    }
                } else if url == release {
                    let mut bytes = zip.clone();
                    if case == "tampered" { bytes[0] ^= 1; }
                    if case == "malformed-zip" { bytes = b"not even a ZIP".to_vec(); }
                    res.body = Box::new(std::io::Cursor::new(bytes));
                } else { panic!("Unexpected URL: {url}"); }
                Ok(res)
            };
            let result = download_and_extract_signed_bundle(&sys, &mut fetch, &keys);
            if case == "valid" {
                let staging = result.unwrap();
                assert_eq!(std::fs::read_to_string(format!("{staging}/.claude/skills/impeccable/SKILL.md")).unwrap(), "verified skill");
                assert!(!util::exists(&format!("{staging}/bundle.zip")));
                assert!(!util::exists(&format!("{staging}/bundle.sig.json")));
                util::rm_rf(&staging);
            } else {
                let error = result.unwrap_err();
                if case == "malformed-zip" {
                    assert!(error.contains("size"), "must reject before ZIP parsing: {error}");
                }
            }
            assert_eq!(std::fs::read_to_string(&installed).unwrap(), "user's existing skill");
            assert_eq!(std::fs::read_dir(&temp).unwrap().count(), 0, "staging leak in {case}");
            assert_eq!(requested[0], format!("{API_BASE}/api/download/bundle/universal"));
            assert_eq!(requested[1], format!("{release}.sig.json"));
            util::rm_rf(&root);
        }
    }
}
