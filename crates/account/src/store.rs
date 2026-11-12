//! The credential lifecycle on disk.
//!
//! - `state.json` (private, not secret) says whether this machine is signed
//!   in, under which **generation**, with which secret **backend**, and the
//!   service's token endpoints.
//! - The secret (refresh and access token) lives in the backend pinned at
//!   sign-in: the OS keychain where there is one (macOS Keychain, Windows
//!   Credential Manager), otherwise a private file (`credentials.json`, 0600
//!   in a 0700 directory, owner and symlink checked). There is no silent
//!   switch between backends. A same-user process can read a private file.
//! - One OS lock (`lock`) covers login, logout, refresh and lease renewal.
//!   Every writer takes it, re-reads, and bumps the generation, so a writer
//!   holding an older read never overwrites a newer one.
//! - `logout` writes the signed-out state (the tombstone) first, then
//!   deletes the secret: a refresh racing it sees the tombstone and stops.

use crate::config::Account;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

const SERVICE: &str = "impeccable-cli";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    Keychain,
    File,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct State {
    #[serde(default)]
    pub foundations: bool,
    pub schema: u32,
    #[serde(default)]
    pub scopes: Vec<String>,
    pub issuer: String,
    pub generation: u64,
    pub signed_in: bool,
    pub backend: Backend,
    pub token_endpoint: String,
    #[serde(default)]
    pub revocation_endpoint: Option<String>,
    /// The generation this sign-in was made at. Token refreshes keep it, so
    /// it names one sign-in (Pro leases are bound to it); a new sign-in or a
    /// sign-out moves it.
    #[serde(default)]
    pub login: u64,
    /// The generation of the latest logout, carried through every later
    /// sign-in and refresh, so a sign-in that started before it can tell.
    #[serde(default)]
    pub signed_out_at: u64,
}

/// The most a saved secret may take: one Windows Credential Manager blob
/// (CRED_MAX_CREDENTIAL_BLOB_SIZE), the smallest of the backends.
pub const MAX_SECRET: usize = 5 * 512;

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Secret {
    pub generation: u64,
    pub refresh_token: String,
    pub access_token: String,
    /// Unix seconds.
    pub access_expires_at: u64,
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Secret {{ generation: {}, .. }}", self.generation)
    }
}

/// Which backend a new sign-in uses: `IMPECCABLE_CREDENTIAL_STORE=file` or
/// `keychain`, else the platform's keychain where it has one.
pub fn chosen_backend(env: &HashMap<String, String>) -> Result<Backend, String> {
    let backend = requested_backend(env)?;
    if backend == Backend::File {
        windows_file_backend_allowed(env)?;
    }
    Ok(backend)
}

/// Windows has no mode bits: a file is as private as the ACL it inherits.
/// The user's profile is private to that user by default, anywhere else (a
/// CI workspace, a shared drive) may not be, so the file backend is refused
/// outside it rather than written with an unknown ACL.
fn windows_file_backend_allowed(env: &HashMap<String, String>) -> Result<(), String> {
    if !cfg!(windows) {
        return Ok(());
    }
    let refuse = || {
        "On Windows, IMPECCABLE_CREDENTIAL_STORE=file needs IMPECCABLE_HOME inside your user profile"
            .to_string()
    };
    let home = crate::config::impeccable_home(env).ok_or_else(refuse)?;
    let profile = env
        .get("USERPROFILE")
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .ok_or_else(refuse)?;
    let profile = fs::canonicalize(&profile).map_err(|_| refuse())?;
    if existing_ancestor(&home).is_some_and(|h| h.starts_with(&profile)) {
        Ok(())
    } else {
        Err(refuse())
    }
}

/// The canonical form of `path`'s nearest existing ancestor, with the rest
/// appended; `None` when a component is `..` (it could climb out).
fn existing_ancestor(path: &Path) -> Option<PathBuf> {
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return None;
    }
    let mut rest = Vec::new();
    let mut cur = path;
    loop {
        if let Ok(real) = fs::canonicalize(cur) {
            return Some(rest.iter().rev().fold(real, |p, c| p.join(c)));
        }
        rest.push(cur.file_name()?.to_owned());
        cur = cur.parent()?;
    }
}

fn requested_backend(env: &HashMap<String, String>) -> Result<Backend, String> {
    match env
        .get("IMPECCABLE_CREDENTIAL_STORE")
        .map(|s| s.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("file") => Ok(Backend::File),
        Some("keychain") if keychain::AVAILABLE => Ok(Backend::Keychain),
        Some("keychain") => Err(
            "This system has no keychain the CLI can use; set IMPECCABLE_CREDENTIAL_STORE=file"
                .into(),
        ),
        Some("") | None => Ok(if keychain::AVAILABLE {
            Backend::Keychain
        } else {
            Backend::File
        }),
        Some(_) => Err("IMPECCABLE_CREDENTIAL_STORE must be file or keychain".into()),
    }
}

pub struct Store {
    pub account: Account,
    dir: PathBuf,
}

/// Held while a lifecycle step runs; the OS releases it if the process dies.
pub struct Lock(#[allow(dead_code)] fs::File);

impl Store {
    pub fn new(account: &Account) -> Store {
        Store {
            dir: account.dir(),
            account: account.clone(),
        }
    }

    /// The keychain item belongs to this store (issuer and
    /// `$IMPECCABLE_HOME`), like the lock and the generation: two homes never
    /// share one secret under two locks.
    fn keychain_account(&self) -> String {
        format!("{} {}", self.account.issuer, self.dir.display())
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn ensure_dir(&self) -> Result<(), String> {
        private_dir(&self.dir)
    }

    /// The lifecycle lock, waiting up to a minute (a refresh in flight holds
    /// it for one network round trip).
    pub fn lock(&self) -> Result<Lock, String> {
        self.lock_for(Duration::from_secs(60))
    }

    pub fn lock_for(&self, wait: Duration) -> Result<Lock, String> {
        self.ensure_dir()?;
        let f = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .no_follow()
            .open(self.dir.join("lock"))
            .map_err(|e| format!("could not open the sign-in lock: {e}"))?;
        let deadline = std::time::Instant::now() + wait;
        loop {
            match f.try_lock() {
                Ok(()) => return Ok(Lock(f)),
                Err(fs::TryLockError::WouldBlock) if std::time::Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(25))
                }
                Err(fs::TryLockError::WouldBlock) => {
                    return Err(
                        "another impeccable sign-in step is still running; retry shortly".into(),
                    )
                }
                Err(fs::TryLockError::Error(e)) => {
                    return Err(format!("could not take the sign-in lock: {e}"))
                }
            }
        }
    }

    /// Global preference, so this lock is shared across account issuers too.
    /// Uploads hold it from their final preference check through transmission.
    pub(crate) fn design_lock_for(home: &Path, wait: Duration) -> Result<Lock, String> {
        fs::create_dir_all(home).map_err(|e| e.to_string())?;
        let mut options = fs::OpenOptions::new();
        options
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .no_follow();
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options
            .open(home.join("design.lock"))
            .map_err(|e| e.to_string())?;
        let deadline = std::time::Instant::now() + wait;
        loop {
            match file.try_lock() {
                Ok(()) => return Ok(Lock(file)),
                Err(fs::TryLockError::WouldBlock) if std::time::Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10))
                }
                _ => return Err("another impeccable command is using it; try again".into()),
            }
        }
    }
    pub(crate) fn critique_lock_for(home: &Path, wait: Duration) -> Result<Lock, String> {
        fs::create_dir_all(home).map_err(|e| e.to_string())?;
        let mut options = fs::OpenOptions::new();
        options
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .no_follow();
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options
            .open(home.join("critiques.lock"))
            .map_err(|e| e.to_string())?;
        let deadline = std::time::Instant::now() + wait;
        loop {
            match file.try_lock() {
                Ok(()) => return Ok(Lock(file)),
                Err(fs::TryLockError::WouldBlock) if std::time::Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(10))
                }
                _ => return Err("critique sync lock unavailable".into()),
            }
        }
    }

    pub fn state(&self) -> Option<State> {
        self.try_state().ok().flatten()
    }

    /// [`Store::state`], with a file that is there but can't be read as an
    /// error rather than as no sign-in.
    pub fn try_state(&self) -> Result<Option<State>, String> {
        let Some(bytes) = read_private(&self.dir.join("state.json"))? else {
            return Ok(None);
        };
        let Ok(state) = serde_json::from_slice::<State>(&bytes) else {
            return Ok(None);
        };
        Ok((state.schema == 1 && state.issuer == self.account.issuer).then_some(state))
    }

    /// The secret for a signed-in state, from that state's backend only.
    pub fn secret(&self, state: &State) -> Option<Secret> {
        self.try_secret(state).ok().flatten()
    }

    /// [`Store::secret`], with a backend that refuses the read (a denied
    /// Keychain prompt, an unreadable file) as an error rather than as no
    /// sign-in.
    pub fn try_secret(&self, state: &State) -> Result<Option<Secret>, String> {
        if !state.signed_in {
            return Ok(None);
        }
        let bytes = match state.backend {
            Backend::File => read_private(&self.dir.join("credentials.json"))?,
            Backend::Keychain => keychain::get(SERVICE, &self.keychain_account())?,
        };
        Ok(bytes.and_then(|b| serde_json::from_slice(&b).ok()))
    }

    /// Background uploads must never ask for Keychain approval.
    pub(crate) fn try_secret_noninteractive(
        &self,
        state: &State,
    ) -> Result<Option<Secret>, String> {
        #[cfg(target_os = "macos")]
        if state.signed_in && state.backend == Backend::Keychain {
            return Ok(
                keychain::get_noninteractive(SERVICE, &self.keychain_account())?
                    .and_then(|b| serde_json::from_slice(&b).ok()),
            );
        }
        self.try_secret(state)
    }

    /// Write a secret and then the state naming it (caller holds the lock).
    /// The secret goes first: a rotated refresh token is never lost to a
    /// crash between the two writes.
    pub fn save(&self, _lock: &Lock, state: &State, secret: &Secret) -> Result<(), String> {
        self.ensure_dir()?;
        let bytes = serde_json::to_vec(secret).map_err(|e| e.to_string())?;
        match state.backend {
            Backend::File => write_private(&self.dir.join("credentials.json"), &bytes)?,
            Backend::Keychain => keychain::set(SERVICE, &self.keychain_account(), &bytes)?,
        }
        self.write_state(state)?;
        // A sign-in that moved to the other backend leaves nothing behind.
        let _ = self.remove_secret(Some(state.backend));
        Ok(())
    }

    /// Delete the secret from every backend except `keep`.
    fn remove_secret(&self, keep: Option<Backend>) -> Result<(), String> {
        if keep != Some(Backend::File) {
            match fs::remove_file(self.dir.join("credentials.json")) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                    return Err(format!("could not delete the stored sign-in: {e}"))
                }
                _ => {}
            }
        }
        if keychain::AVAILABLE && keep != Some(Backend::Keychain) {
            keychain::delete(SERVICE, &self.keychain_account())?;
        }
        Ok(())
    }

    pub fn write_state(&self, state: &State) -> Result<(), String> {
        self.ensure_dir()?;
        let bytes = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
        write_private(&self.dir.join("state.json"), &bytes)
    }

    /// The tombstone: signed out under a new generation, then the secret
    /// removed from every backend (caller holds the lock).
    pub fn sign_out(
        &self,
        _lock: &Lock,
        previous: Option<&State>,
        fallback: Backend,
    ) -> Result<(), String> {
        let generation = previous.map(|s| s.generation + 1).unwrap_or(1);
        let tomb = State {
            foundations: false,
            scopes: Vec::new(),
            schema: 1,
            issuer: self.account.issuer.clone(),
            generation,
            signed_out_at: generation,
            signed_in: false,
            backend: previous.map(|s| s.backend).unwrap_or(fallback),
            token_endpoint: previous
                .map(|s| s.token_endpoint.clone())
                .unwrap_or_default(),
            revocation_endpoint: previous.and_then(|s| s.revocation_endpoint.clone()),
            login: 0,
        };
        self.write_state(&tomb)?;
        self.remove_secret(None)
    }
}

/// Create (or check) a directory only this user can enter.
pub fn private_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let meta = fs::symlink_metadata(dir).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err(format!("{} is not a plain directory", dir.display()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        // SAFETY: getuid has no preconditions.
        if meta.uid() != unsafe { libc::getuid() } {
            return Err(format!("{} belongs to another user", dir.display()));
        }
        if meta.mode() & 0o777 != 0o700 {
            fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Opening never follows a final symlink (Unix), so the checks below are
/// made on the file that is read, not on a path that can be swapped.
pub(crate) trait NoFollow {
    fn no_follow(&mut self) -> &mut Self;
}

impl NoFollow for fs::OpenOptions {
    fn no_follow(&mut self) -> &mut Self {
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            self.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        self
    }
}

/// Read a private file: `None` when absent; refused when it is a symlink,
/// not a regular file, someone else's, or readable by others. The checks
/// are made on the opened handle.
pub fn read_private(path: &Path) -> Result<Option<Vec<u8>>, String> {
    use std::io::Read;
    let mut f = match fs::OpenOptions::new().read(true).no_follow().open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(format!("{} is not a plain file", path.display())),
    };
    let meta = f.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err(format!("{} is not a plain file", path.display()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        // SAFETY: getuid has no preconditions.
        if meta.uid() != unsafe { libc::getuid() } || meta.mode() & 0o077 != 0 {
            return Err(format!("{} is not private to this user", path.display()));
        }
    }
    let mut buf = Vec::new();
    Read::by_ref(&mut f)
        .take(1024 * 1024)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    Ok(Some(buf))
}

/// Replace a file with a 0600 one by rename, never following a link.
pub fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    write_private_mode(path, bytes, 0o600)
}

/// [`write_private`] with another mode (0700 for an executable). The staging
/// file is created fresh (`create_new`, no symlink followed), so nothing
/// planted at its name is written through.
pub fn write_private_mode(path: &Path, bytes: &[u8], mode: u32) -> Result<(), String> {
    #[cfg(not(unix))]
    let _ = mode;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let parent = path.parent().ok_or("no parent directory")?;
    let name = path.file_name().ok_or("no file name")?.to_string_lossy();
    let temp = parent.join(format!(
        ".{name}.{}-{}-{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0)
    ));
    let result = (|| -> std::io::Result<()> {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(mode).custom_flags(libc::O_NOFOLLOW);
        }
        let mut f = opts.open(&temp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&temp, path)?;
        // The rename itself survives a power loss only once the directory is synced.
        #[cfg(unix)]
        fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|e| format!("could not write {}: {e}", path.display()))
}

/// What a macOS keychain failure means for the person, with the way out.
/// The bare OSStatus told nobody anything: the keychain is missing in an SSH
/// session or under a changed HOME, locked without a way to ask, or the
/// person declined the prompt. The file store is the documented alternative,
/// and a sign-in remembers its store, so setting it once for `login` is enough.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn keychain_error(action: &str, code: i32) -> String {
    const FILE: &str = "To keep the sign-in in ~/.impeccable instead, run: IMPECCABLE_CREDENTIAL_STORE=file impeccable login";
    match code {
        // errSecNoDefaultKeychain; errAuthorizationCanceled, which is what a
        // write returns when HOME has no keychain (measured on macOS 27)
        -25307 | -60006 => format!(
            "macOS wouldn't let the CLI {action} its keychain here (no keychain in this session, as over SSH or with a changed HOME, or its prompt was declined). {FILE}"
        ),
        // errSecInteractionNotAllowed, errSecAuthFailed: locked, and no way to ask
        -25308 | -25293 => format!(
            "the macOS keychain is locked and can't ask to unlock here. Unlock it and try again, or {}",
            FILE.replacen("To keep", "to keep", 1)
        ),
        // errSecUserCanceled
        -128 => format!(
            "the keychain prompt was declined. Run impeccable login again and choose Allow. {FILE}"
        ),
        code => format!("keychain {action} failed ({code}). {FILE}"),
    }
}

#[cfg(target_os = "macos")]
mod keychain {
    pub const AVAILABLE: bool = true;
    use security_framework::passwords;
    // errSecItemNotFound
    const NOT_FOUND: i32 = -25300;

    pub fn get(service: &str, account: &str) -> Result<Option<Vec<u8>>, String> {
        match passwords::get_generic_password(service, account) {
            Ok(v) => Ok(Some(v)),
            Err(e) if e.code() == NOT_FOUND => Ok(None),
            Err(e) => Err(super::keychain_error("read", e.code())),
        }
    }
    pub fn get_noninteractive(service: &str, account: &str) -> Result<Option<Vec<u8>>, String> {
        use security_framework::item::{ItemClass, ItemSearchOptions, SearchResult};
        let mut options = ItemSearchOptions::new();
        options
            .class(ItemClass::generic_password())
            .service(service)
            .account(account)
            .load_data(true)
            .skip_authenticated_items(true);
        match options.search() {
            Ok(items) => Ok(items.into_iter().find_map(|item| match item {
                SearchResult::Data(bytes) => Some(bytes),
                _ => None,
            })),
            Err(e) if e.code() == NOT_FOUND => Ok(None),
            Err(e) => Err(super::keychain_error("read", e.code())),
        }
    }

    pub fn set(service: &str, account: &str, secret: &[u8]) -> Result<(), String> {
        passwords::set_generic_password(service, account, secret)
            .map_err(|e| super::keychain_error("write", e.code()))
    }
    pub fn delete(service: &str, account: &str) -> Result<(), String> {
        match passwords::delete_generic_password(service, account) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == NOT_FOUND => Ok(()),
            Err(e) => Err(super::keychain_error("delete", e.code())),
        }
    }
}

/// Windows Credential Manager, generic credentials scoped to this user.
#[cfg(windows)]
mod keychain {
    pub const AVAILABLE: bool = true;
    use std::ffi::c_void;

    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    #[repr(C)]
    struct Credential {
        flags: u32,
        kind: u32,
        target_name: *mut u16,
        comment: *mut u16,
        last_written: FileTime,
        blob_size: u32,
        blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut c_void,
        target_alias: *mut u16,
        user_name: *mut u16,
    }
    #[link(name = "advapi32")]
    extern "system" {
        fn CredWriteW(credential: *const Credential, flags: u32) -> i32;
        fn CredReadW(
            target: *const u16,
            kind: u32,
            flags: u32,
            credential: *mut *mut Credential,
        ) -> i32;
        fn CredDeleteW(target: *const u16, kind: u32, flags: u32) -> i32;
        fn CredFree(buffer: *const c_void);
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetLastError() -> u32;
    }
    const GENERIC: u32 = 1;
    const PERSIST_LOCAL_MACHINE: u32 = 2;
    const ERROR_NOT_FOUND: u32 = 1168;
    const MAX_BLOB: usize = super::MAX_SECRET;

    fn target(service: &str, account: &str) -> Vec<u16> {
        format!("{service}:{account}")
            .encode_utf16()
            .chain(Some(0))
            .collect()
    }
    pub fn get(service: &str, account: &str) -> Result<Option<Vec<u8>>, String> {
        let name = target(service, account);
        let mut out: *mut Credential = std::ptr::null_mut();
        // SAFETY: name is NUL-terminated; out is freed with CredFree below.
        unsafe {
            if CredReadW(name.as_ptr(), GENERIC, 0, &mut out) == 0 {
                let code = GetLastError();
                return if code == ERROR_NOT_FOUND {
                    Ok(None)
                } else {
                    Err(format!("credential read failed ({code})"))
                };
            }
            let c = &*out;
            let bytes = std::slice::from_raw_parts(c.blob, c.blob_size as usize).to_vec();
            CredFree(out as *const c_void);
            Ok(Some(bytes))
        }
    }
    pub fn set(service: &str, account: &str, secret: &[u8]) -> Result<(), String> {
        if secret.len() > MAX_BLOB {
            return Err("credential too large for the Windows credential store".into());
        }
        let mut name = target(service, account);
        let mut blob = secret.to_vec();
        let c = Credential {
            flags: 0,
            kind: GENERIC,
            target_name: name.as_mut_ptr(),
            comment: std::ptr::null_mut(),
            last_written: FileTime { low: 0, high: 0 },
            blob_size: blob.len() as u32,
            blob: blob.as_mut_ptr(),
            persist: PERSIST_LOCAL_MACHINE,
            attribute_count: 0,
            attributes: std::ptr::null_mut(),
            target_alias: std::ptr::null_mut(),
            user_name: std::ptr::null_mut(),
        };
        // SAFETY: every pointer outlives the call.
        if unsafe { CredWriteW(&c, 0) } == 0 {
            return Err(format!("credential write failed ({})", unsafe {
                GetLastError()
            }));
        }
        Ok(())
    }
    pub fn delete(service: &str, account: &str) -> Result<(), String> {
        let name = target(service, account);
        // SAFETY: name is NUL-terminated.
        unsafe {
            if CredDeleteW(name.as_ptr(), GENERIC, 0) == 0 {
                let code = GetLastError();
                if code != ERROR_NOT_FOUND {
                    return Err(format!("credential delete failed ({code})"));
                }
            }
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod keychain {
    pub const AVAILABLE: bool = false;
    pub fn get(_: &str, _: &str) -> Result<Option<Vec<u8>>, String> {
        Err("no keychain".into())
    }
    pub fn set(_: &str, _: &str, _: &[u8]) -> Result<(), String> {
        Err("no keychain".into())
    }
    pub fn delete(_: &str, _: &str) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod keychain_error_tests {
    use super::keychain_error;
    #[test]
    fn each_keychain_failure_says_what_happened_and_how_out() {
        let missing = keychain_error("write", -60006);
        assert!(missing.starts_with(
            "macOS wouldn't let the CLI write its keychain here (no keychain in this session"
        ));
        assert_eq!(missing, keychain_error("write", -25307));
        assert!(missing.ends_with("IMPECCABLE_CREDENTIAL_STORE=file impeccable login"));
        assert!(keychain_error("read", -25308).starts_with("the macOS keychain is locked"));
        assert!(keychain_error("read", -25308).contains("or to keep the sign-in in ~/.impeccable"));
        assert!(keychain_error("write", -128).starts_with("the keychain prompt was declined"));
        let other = keychain_error("delete", -1);
        assert!(other.starts_with("keychain delete failed (-1). To keep"));
        // Login prints "Sign-in failed: {e}." so no message may end in a period.
        for code in [-25307, -60006, -25308, -25293, -128, -1] {
            assert!(!keychain_error("write", code).ends_with('.'));
        }
    }
}

#[cfg(test)]
mod size_tests {
    use super::*;

    #[test]
    fn the_largest_sign_in_the_client_accepts_fits_windows_credential_manager() {
        // Catches (review, Greptile): tokens the client accepts that the default Windows store can't save, failing sign-in after the browser step.
        let biggest = "a".repeat(crate::http::MAX_TOKEN);
        assert!(crate::http::valid_token(&biggest));
        assert!(!crate::http::valid_token(&format!("{biggest}a")));
        let secret = Secret {
            generation: u64::MAX,
            refresh_token: biggest.clone(),
            access_token: biggest,
            access_expires_at: u64::MAX,
        };
        let bytes = serde_json::to_vec(&secret).unwrap();
        assert!(bytes.len() <= MAX_SECRET, "{} > {MAX_SECRET}", bytes.len());
    }
}
