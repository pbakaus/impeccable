use super::ioerr;
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct FileIdentity {
    path: PathBuf,
    #[cfg(unix)]
    dev: u64,
    #[cfg(unix)]
    ino: u64,
}
pub(super) fn safe_write(
    logical: &Path,
    before: Option<&[u8]>,
    bytes: &[u8],
) -> Result<PathBuf, (&'static str, String, i32)> {
    let identity = validate_file(logical)?;
    let path = identity
        .as_ref()
        .map(|i| i.path.clone())
        .map_or_else(|| canonical_target(logical), Ok)?;
    if !target_unchanged(logical, &path, &identity, before)? {
        return Err((
            "concurrent_change",
            format!("Target changed before write: {}", logical.display()),
            4,
        ));
    }
    static NEXT_TEMP: AtomicU64 = AtomicU64::new(1);
    let parent = path
        .parent()
        .ok_or_else(|| ("unsafe_target", "Target has no parent directory".into(), 4))?;
    let temp = loop {
        let n = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(".impeccable-agents-{}-{n}.tmp", std::process::id()));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&candidate) {
            Ok(mut file) => {
                file.write_all(bytes).map_err(ioerr)?;
                file.sync_all().map_err(ioerr)?;
                if let Some(i) = identity.as_ref() {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let mode =
                            fs::metadata(&i.path).map_err(ioerr)?.permissions().mode() & 0o777;
                        fs::set_permissions(&candidate, fs::Permissions::from_mode(mode))
                            .map_err(ioerr)?;
                    }
                }
                drop(file);
                break candidate;
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(ioerr(e)),
        }
    };
    if let Err(e) = failpoint("temp_synced") {
        let _ = fs::remove_file(&temp);
        return Err(e);
    }
    if !target_unchanged(logical, &path, &identity, before)? {
        let _ = fs::remove_file(&temp);
        return Err((
            "concurrent_change",
            format!(
                "Target identity or contents changed before rename: {}",
                logical.display()
            ),
            4,
        ));
    }
    if let Err(e) = failpoint("before_rename") {
        let _ = fs::remove_file(&temp);
        return Err(e);
    }
    fs::rename(&temp, &path).map_err(ioerr)?;
    failpoint("after_rename")?;
    fs::File::open(parent)
        .and_then(|d| d.sync_all())
        .map_err(ioerr)?;
    failpoint("directory_synced")?;
    let final_bytes = fs::read(&path).map_err(ioerr)?;
    if final_bytes != bytes || canonical_target(logical)? != path {
        return Err((
            "concurrent_change",
            format!("Target verification failed after write: {}", path.display()),
            4,
        ));
    }
    failpoint("post_verify")?;
    Ok(path)
}
pub(super) fn safe_delete(
    logical: &Path,
    before: Option<&[u8]>,
) -> Result<PathBuf, (&'static str, String, i32)> {
    let identity = validate_file(logical)?;
    let path = identity
        .as_ref()
        .map(|i| i.path.clone())
        .map_or_else(|| canonical_target(logical), Ok)?;
    if fs::read(logical).ok().as_deref() != before || !identity_matches(&identity)? {
        return Err((
            "concurrent_change",
            "Target changed before delete".into(),
            4,
        ));
    }
    if before.is_none() {
        return Ok(path);
    }
    fs::remove_file(&path).map_err(ioerr)?;
    failpoint("after_delete")?;
    if let Some(parent) = path.parent() {
        fs::File::open(parent)
            .and_then(|d| d.sync_all())
            .map_err(ioerr)?;
        failpoint("delete_directory_synced")?;
    }
    if fs::symlink_metadata(&path).is_ok() {
        return Err((
            "concurrent_change",
            "Target still exists after delete".into(),
            4,
        ));
    }
    Ok(path)
}
fn identity_matches(identity: &Option<FileIdentity>) -> Result<bool, (&'static str, String, i32)> {
    let Some(identity) = identity else {
        return Ok(true);
    };
    let md = fs::metadata(&identity.path).map_err(ioerr)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(md.dev() == identity.dev && md.ino() == identity.ino)
    }
    #[cfg(not(unix))]
    {
        let _ = md;
        Ok(true)
    }
}
fn target_unchanged(
    logical: &Path,
    physical: &Path,
    identity: &Option<FileIdentity>,
    before: Option<&[u8]>,
) -> Result<bool, (&'static str, String, i32)> {
    if fs::read(logical).ok().as_deref() != before {
        return Ok(false);
    }
    match identity {
        Some(_) => Ok(identity_matches(identity)? && canonical_target(logical)? == physical),
        None => match fs::symlink_metadata(logical) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                Ok(canonical_target(logical)? == physical)
            }
            _ => Ok(false),
        },
    }
}
pub(super) fn failpoint(name: &str) -> Result<(), (&'static str, String, i32)> {
    #[cfg(test)]
    let injected = TEST_FAILPOINT.with(|v| v.get() == Some(name));
    #[cfg(not(test))]
    let injected = std::env::var("IMPECCABLE_AGENTS_FAIL_AT").ok().as_deref() == Some(name);
    if injected {
        Err(("injected_failure", format!("Injected failure at {name}"), 5))
    } else {
        Ok(())
    }
}
#[cfg(test)]
thread_local! { pub(super) static TEST_FAILPOINT: std::cell::Cell<Option<&'static str>> = const { std::cell::Cell::new(None) }; }
pub(super) fn validate_file(
    path: &Path,
) -> Result<Option<FileIdentity>, (&'static str, String, i32)> {
    match fs::symlink_metadata(path) {
        Ok(_) => {
            let physical = fs::canonicalize(path).map_err(|_| {
                (
                    "unsafe_target",
                    "Target symlink is dangling or cyclic".into(),
                    4,
                )
            })?;
            let md = fs::metadata(&physical).map_err(ioerr)?;
            if !md.is_file() {
                return Err(("unsafe_target", "Target is not a regular file".into(), 4));
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if md.uid() != libc_uid() {
                    return Err((
                        "unsafe_target",
                        "Target is not owned by current user".into(),
                        4,
                    ));
                }
                return Ok(Some(FileIdentity {
                    path: physical,
                    dev: md.dev(),
                    ino: md.ino(),
                }));
            }
            #[cfg(not(unix))]
            {
                return Ok(Some(FileIdentity { path: physical }));
            }
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => (),
        Err(e) => return Err(ioerr(e)),
    }
    let parent = path
        .parent()
        .ok_or_else(|| ("unsafe_target", "Target has no parent directory".into(), 4))?;
    let physical_parent = fs::canonicalize(parent).map_err(ioerr)?;
    let parent_md = fs::metadata(&physical_parent).map_err(ioerr)?;
    if !parent_md.is_dir() {
        return Err((
            "unsafe_target",
            "Target parent is not a directory".into(),
            4,
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if parent_md.uid() != libc_uid() {
            return Err((
                "unsafe_target",
                "Target parent is not owned by current user".into(),
                4,
            ));
        }
    }
    Ok(None)
}
pub(super) fn canonical_target(path: &Path) -> Result<PathBuf, (&'static str, String, i32)> {
    if fs::symlink_metadata(path).is_ok() {
        return fs::canonicalize(path).map_err(|_| {
            (
                "unsafe_target",
                "Target symlink is dangling or cyclic".into(),
                4,
            )
        });
    }
    let parent = path
        .parent()
        .ok_or_else(|| ("unsafe_target", "Target has no parent directory".into(), 4))?;
    let name = path
        .file_name()
        .ok_or_else(|| ("unsafe_target", "Target has no filename".into(), 4))?;
    Ok(fs::canonicalize(parent).map_err(ioerr)?.join(name))
}
#[cfg(unix)]
pub(super) fn libc_uid() -> u32 {
    extern "C" {
        fn geteuid() -> u32;
    }
    unsafe { geteuid() }
}
#[cfg(not(unix))]
pub(super) fn libc_uid() -> u32 {
    0
}
