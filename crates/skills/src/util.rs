//! fs / os helpers with the Node semantics the JS relied on. Paths are plain
//! strings joined with `/` (`impeccable_detect::jsp`), like the rest of the
//! engine.

use std::collections::HashMap;
use std::path::Path;

pub use impeccable_detect::jsp;

pub type Env = HashMap<String, String>;

/// `os.homedir()` (posix: `$HOME` first).
pub fn homedir(env: &Env) -> String {
    impeccable_context::util::homedir(env)
}

/// `os.tmpdir()`: `$TMPDIR || $TMP || $TEMP || '/tmp'`, one trailing slash
/// stripped (Windows: `$TEMP || $TMP || <SystemRoot|windir>\temp`).
pub fn tmpdir(env: &Env) -> String {
    let nonempty = |k: &str| env.get(k).filter(|v| !v.is_empty()).cloned();
    if cfg!(windows) {
        let mut dir = match nonempty("TEMP").or_else(|| nonempty("TMP")) {
            Some(v) => v,
            None => {
                let root = nonempty("SystemRoot")
                    .or_else(|| nonempty("windir"))
                    .unwrap_or_default();
                format!("{root}\\temp")
            }
        };
        // Node trims one trailing separator unless it is a drive root (`C:\`).
        if dir.len() > 1
            && (dir.ends_with('\\') || dir.ends_with('/'))
            && !dir.ends_with(":\\")
            && !dir.ends_with(":/")
        {
            dir.pop();
        }
        return dir;
    }
    let mut dir = nonempty("TMPDIR")
        .or_else(|| nonempty("TMP"))
        .or_else(|| nonempty("TEMP"))
        .unwrap_or_else(|| "/tmp".to_string());
    if dir.len() > 1 && dir.ends_with('/') {
        dir.pop();
    }
    dir
}

/// `Date.now()`.
pub fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// `fs.existsSync` (follows symlinks: a dangling link does not exist).
pub fn exists(p: &str) -> bool {
    Path::new(p).exists()
}

/// `fs.lstatSync(p)` succeeds (a dangling symlink counts).
pub fn exists_or_link(p: &str) -> bool {
    std::fs::symlink_metadata(p).is_ok()
}

/// `fs.statSync(p).isDirectory()` (follows symlinks); false on error.
pub fn is_dir(p: &str) -> bool {
    std::fs::metadata(p).map(|m| m.is_dir()).unwrap_or(false)
}

/// `fs.statSync(p).isFile()`; false on error.
pub fn is_file(p: &str) -> bool {
    std::fs::metadata(p).map(|m| m.is_file()).unwrap_or(false)
}

/// `fs.lstatSync(p).isSymbolicLink()`; false on error.
pub fn is_symlink(p: &str) -> bool {
    std::fs::symlink_metadata(p)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

/// `fs.lstatSync(p).isDirectory() && !isSymbolicLink()`.
pub fn is_real_dir(p: &str) -> bool {
    std::fs::symlink_metadata(p)
        .map(|m| m.is_dir() && !m.file_type().is_symlink())
        .unwrap_or(false)
}

/// `fs.realpathSync(p)`.
pub fn realpath(p: &str) -> Option<String> {
    std::fs::canonicalize(p)
        .ok()
        .map(|pb| pb.to_string_lossy().into_owned())
}

/// `fs.readlinkSync(p)`.
pub fn readlink(p: &str) -> Option<String> {
    std::fs::read_link(p)
        .ok()
        .map(|pb| pb.to_string_lossy().into_owned())
}

/// `fs.readdirSync(p)` entry names, sorted (the JS relied on no order the
/// caller could observe except through `listSkillTreeFiles`, which sorts).
pub fn read_dir_names(p: &str) -> Option<Vec<String>> {
    let rd = std::fs::read_dir(p).ok()?;
    let mut names: Vec<String> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    Some(names)
}

/// `fs.mkdirSync(p, {recursive: true})`.
pub fn mkdir_p(p: &str) -> Result<(), String> {
    std::fs::create_dir_all(p).map_err(|e| node_error("mkdir", p, &e))
}

/// `fs.mkdtempSync(prefix)`: creates `<prefix>` + six random [a-z0-9] chars
/// as a fresh directory (Node gives it mode 0700 on posix) and returns its
/// path.
pub fn mkdtemp(prefix: &str) -> Result<String, String> {
    for _ in 0..64 {
        let path = format!("{prefix}{}", random_suffix());
        match std::fs::create_dir(&path) {
            Ok(()) => {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700));
                }
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(node_error("mkdtemp", &path, &e)),
        }
    }
    Err(format!(
        "EEXIST: file already exists, mkdtemp '{prefix}XXXXXX'"
    ))
}

fn random_suffix() -> String {
    use std::hash::{BuildHasher, Hasher};
    // RandomState carries per-process random keys; mix in the clock so two
    // calls in one process differ.
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    h.write_u128(nanos);
    let mut v = h.finish();
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    (0..6)
        .map(|_| {
            let c = ALPHABET[(v % 36) as usize] as char;
            v /= 36;
            c
        })
        .collect()
}

/// `fs.rmSync(p, {recursive: true, force: true})`: removes a file, a symlink
/// (not its target), or a directory tree; a missing path is fine.
pub fn rm_rf(p: &str) {
    let Ok(meta) = std::fs::symlink_metadata(p) else {
        return;
    };
    if meta.is_dir() && !meta.file_type().is_symlink() {
        let _ = std::fs::remove_dir_all(p);
    } else {
        let _ = std::fs::remove_file(p);
    }
}

/// `fs.rmdirSync(p)` (non-recursive; fails when not empty). Errors ignored.
pub fn rmdir(p: &str) {
    let _ = std::fs::remove_dir(p);
}

/// `fs.readFileSync(p)` bytes.
pub fn read_bytes(p: &str) -> Result<Vec<u8>, String> {
    std::fs::read(p).map_err(|e| node_error("open", p, &e))
}

/// `fs.readFileSync(p, 'utf-8')` (lossy decode, like Node).
pub fn read_text(p: &str) -> Result<String, String> {
    read_bytes(p).map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// `fs.writeFileSync(p, data)`.
pub fn write_bytes(p: &str, data: &[u8]) -> Result<(), String> {
    std::fs::write(p, data).map_err(|e| node_error("open", p, &e))
}

/// `fs.renameSync`.
pub fn rename(from: &str, to: &str) -> Result<(), String> {
    std::fs::rename(from, to).map_err(|e| node_error("rename", from, &e))
}

/// JS: copyDirSync(src, dest): recursive copy, files by content (symlinks
/// followed). File modes are preserved (`std::fs::write` alone would drop the
/// launcher's executable bit on the way into a user project).
pub fn copy_dir(src: &str, dest: &str) -> Result<(), String> {
    mkdir_p(dest)?;
    for name in read_dir_names(src).ok_or_else(|| {
        node_error(
            "scandir",
            src,
            &std::io::Error::from(std::io::ErrorKind::NotFound),
        )
    })? {
        let s = jsp::join(&[src, &name]);
        let d = jsp::join(&[dest, &name]);
        if is_dir(&s) {
            copy_dir(&s, &d)?;
        } else {
            write_bytes(&d, &read_bytes(&s)?)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = std::fs::metadata(&s) {
                    let mode = meta.permissions().mode() & 0o7777;
                    let _ = std::fs::set_permissions(&d, std::fs::Permissions::from_mode(mode));
                }
            }
        }
    }
    Ok(())
}

/// `fs.symlinkSync(target, path, 'dir')`.
pub fn symlink_dir(target: &str, path: &str) -> Result<(), String> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, path).map_err(|e| node_error("symlink", path, &e))
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_dir(target, path).map_err(|e| node_error("symlink", path, &e))
    }
}

/// `chmod +x` (no-op off unix).
pub fn set_executable(p: &str) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let meta = std::fs::metadata(p).map_err(|e| node_error("stat", p, &e))?;
        let mut perms = meta.permissions();
        perms.set_mode(perms.mode() | 0o755);
        std::fs::set_permissions(p, perms).map_err(|e| node_error("chmod", p, &e))
    }
    #[cfg(not(unix))]
    {
        let _ = p;
        Ok(())
    }
}

/// Node's `error.message` shape for a failed fs call.
pub fn node_error(syscall: &str, p: &str, err: &std::io::Error) -> String {
    use std::io::ErrorKind;
    match err.kind() {
        ErrorKind::NotFound => format!("ENOENT: no such file or directory, {syscall} '{p}'"),
        ErrorKind::PermissionDenied => format!("EACCES: permission denied, {syscall} '{p}'"),
        ErrorKind::AlreadyExists => format!("EEXIST: file already exists, {syscall} '{p}'"),
        _ => {
            if Path::new(p).is_dir() && syscall == "open" {
                "EISDIR: illegal operation on a directory, read".to_string()
            } else {
                format!("{err}, {syscall} '{p}'")
            }
        }
    }
}

/// `JSON.stringify(v, null, 2)`.
pub fn json_pretty(v: &serde_json::Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_else(|_| "null".into())
}

/// `str.length` in UTF-16 code units.
pub fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// `str.substring(0, n)` in UTF-16 code units.
pub fn utf16_prefix(s: &str, n: usize) -> String {
    let units: Vec<u16> = s.encode_utf16().take(n).collect();
    String::from_utf16_lossy(&units)
}

/// `s.padEnd(n)`.
pub fn pad_end(s: &str, n: usize) -> String {
    let len = utf16_len(s);
    if len >= n {
        s.to_string()
    } else {
        format!("{s}{}", " ".repeat(n - len))
    }
}
