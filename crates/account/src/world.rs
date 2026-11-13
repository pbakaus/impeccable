//! `impeccable world <id> [--print]`: seed a project's design system from a
//! world in the Impeccable catalog.
//!
//! The service renders the world as a finished DESIGN.md and sidecar
//! (`GET /cli/v1/worlds/<id>/seed`, plan-gated there), so the catalog and the
//! world-to-DESIGN.md mapping never ship in this binary. The CLI only checks
//! the answer's shape and writes it. It never overwrites: when the project
//! already has a design system it writes nothing and points at `--print`,
//! which hands the seed to the agent to merge.
use crate::config::Account;
use crate::session::{Session, SessionError};
use impeccable_common::Io;
use std::io::Write;
use std::path::Path;

/// Caps on what the service may hand back, well above a real seed.
const MAX_DESIGN_MD: usize = 256 * 1024;
const MAX_SIDECAR: usize = 256 * 1024;

const UNREADABLE: &str = "Your Impeccable account sent a world this CLI can't read. Update the Impeccable CLI and try again.\n";

const USAGE: &str = "Usage: impeccable world <id> [--print]\n";
/// `--help`: what a world is and what the verb writes, before any sign-in.
const HELP: &str = "Usage: impeccable world <id> [--print]

Starts this project from a world: a finished visual direction, with its type,
color, spacing and components. Copy the id from the world in the Impeccable
worlds catalog.

Writes DESIGN.md beside PRODUCT.md (at the project root when there is none)
and .impeccable/design.json at the project root, and your agent builds every
page in that world. It never overwrites: if the project already has a design
system, it writes nothing and tells you how to merge.

  --print   Print the seed as JSON instead of writing it (its DESIGN.md is in
            design_md), to merge into the design system you have.

Needs an Impeccable account (impeccable login). Some worlds need Pro.
";

/// The seed's DESIGN.md carrying `world: "<id>"` in its frontmatter, the line
/// every later boot and roll reads (`seeded_world`) to know the person chose
/// this world. A frontmatter without one gets it as its first key; a file
/// with no frontmatter gets one holding only that line. A frontmatter that
/// names another world, holds a value no reader accepts, or never closes
/// cannot carry it, and the seed is refused.
fn with_world_line(design_md: &str, id: &str) -> Option<String> {
    let eol = if design_md.contains("\r\n") { "\r\n" } else { "\n" };
    let line = format!("world: \"{id}\"{eol}");
    let mut lines = design_md.split_inclusive('\n');
    let first = lines.next().unwrap_or("");
    let out = if first.trim_end() == "---" {
        let mut closed = false;
        let mut named = false;
        for l in lines {
            if l.trim_end() == "---" {
                closed = true;
                break;
            }
            named |= l.starts_with("world:");
        }
        if !closed {
            return None;
        }
        if named {
            design_md.to_string()
        } else {
            format!("{first}{line}{}", &design_md[first.len()..])
        }
    } else {
        format!("---{eol}{line}---{eol}{design_md}")
    };
    (impeccable_context::context::seeded_world(Some(&out)).as_deref() == Some(id)).then_some(out)
}

/// A catalog id: lowercase letters, digits and single dashes. It goes into a
/// URL path, so nothing else is allowed through.
fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !id.starts_with('-')
        && !id.ends_with('-')
        && !id.contains("--")
}

#[derive(Debug)]
struct Seed {
    id: String,
    name: String,
    design_md: String,
    sidecar: serde_json::Map<String, serde_json::Value>,
}

fn parse(id: &str, v: &serde_json::Value) -> Option<Seed> {
    let field = |k: &str| v.get(k).and_then(|x| x.as_str());
    if field("id")? != id {
        return None;
    }
    let name = field("name")?;
    let design_md = field("design_md")?;
    let sidecar = v.get("sidecar")?.as_object()?.clone();
    let name_ok = (1..=120).contains(&name.chars().count()) && !name.chars().any(char::is_control);
    let sidecar_len = serde_json::to_vec(&sidecar).ok()?.len();
    (name_ok
        && !design_md.trim().is_empty()
        && design_md.len() <= MAX_DESIGN_MD
        && sidecar_len <= MAX_SIDECAR)
        .then(|| Seed {
            id: id.to_string(),
            name: name.to_string(),
            design_md: design_md.to_string(),
            sidecar,
        })
}

/// The design files and sidecar checked in a destination folder. Any of them
/// existing means the project already has a design system.
const TARGETS: [&str; 3] = ["DESIGN.md", "DESIGN.json", ".impeccable/design.json"];

fn existing(root: &Path) -> Option<&'static str> {
    TARGETS
        .into_iter()
        .find(|t| root.join(t).symlink_metadata().is_ok())
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let mut id = None;
    let mut print = false;
    for a in args {
        match a.as_str() {
            "--print" => print = true,
            "--help" | "-h" => {
                io.out(HELP);
                return 0;
            }
            s if s.starts_with('-') => {
                io.err(&format!("Unknown option for world: {s}\n{USAGE}"));
                return 1;
            }
            s if id.is_none() => id = Some(s.to_string()),
            _ => {
                io.err(USAGE);
                return 1;
            }
        }
    }
    let Some(id) = id else {
        io.err(USAGE);
        return 1;
    };
    if !valid_id(&id) {
        io.err(&format!(
            "\"{}\" isn't a world id. Copy the id from the world in the Impeccable worlds catalog.\n",
            id.escape_debug()
        ));
        return 1;
    }
    use impeccable_context::{context::resolve_context, jsp, target_args::TargetOptions};
    let cwd = jsp::resolve(&io.cwd.to_string_lossy(), &[]);
    let resolved = resolve_context(&cwd, &TargetOptions::default(), &io.env);
    let root = if resolved.project_root.is_empty() {
        io.cwd.clone()
    } else {
        std::path::PathBuf::from(&resolved.project_root)
    };
    // Resolve the destination once: beside a local or explicitly configured
    // product, otherwise at the project root. Inherited products need a choice.
    let design_root = if resolved.product_path.is_some() {
        std::path::PathBuf::from(&resolved.context_dir)
    } else {
        root.clone()
    };
    // Sidecars are read from project_root/.impeccable, even for fallback docs.
    let relative = |path: &Path| jsp::relative(&cwd, &cwd, &path.to_string_lossy()).replace('\\', "/");
    // Checked before any request, so an existing design system costs nothing.
    if !print {
        let configured = io.env.get("IMPECCABLE_CONTEXT_DIR")
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(|value| std::path::PathBuf::from(jsp::resolve(&cwd, &[value])));
        if !design_root.starts_with(&root) && configured.as_ref() != Some(&design_root) {
            let folder = relative(&design_root);
            io.err(&format!(
                "PRODUCT.md is in {folder}. A seed in this workspace would hide that PRODUCT.md, and a seed beside it would apply to every workspace. Run impeccable world {id} from the folder that holds PRODUCT.md to seed the whole repository, or run impeccable world {id} --print and save it where it belongs.\n"
            ));
            return 1;
        }
        let found = existing(&design_root)
            .map(|found| relative(&design_root.join(found)))
            .or_else(|| existing(&root).map(|found| relative(&root.join(found))))
            .or_else(|| resolved.design_path.as_deref().map(|found| relative(Path::new(found))));
        if let Some(found) = found {
            io.out(&format!(
                "{found} already exists, so nothing was written. To merge this world into it, run impeccable world {id} --print and fold its DESIGN.md into yours.\n"
            ));
            return 0;
        }
    }
    let account = match Account::from_env(&io.env) {
        Ok(a) => a,
        Err(e) => {
            io.err(&format!("{e}.\n"));
            return 1;
        }
    };
    let answer =
        Session::load(&account).and_then(|mut s| s.get(&format!("/cli/v1/worlds/{id}/seed")));
    let mut seed = match answer {
        Ok(v) => match parse(&id, &v) {
            Some(seed) => seed,
            None => {
                io.err(UNREADABLE);
                return 1;
            }
        },
        Err(e) => {
            io.err(&failure(&id, &e));
            return 1;
        }
    };
    if print {
        let out = serde_json::json!({
            "id": seed.id,
            "name": seed.name,
            "design_md": seed.design_md,
            "sidecar": seed.sidecar,
        });
        io.out(&format!("{out}\n"));
        return 0;
    }
    // Checked before anything is written: a seed that cannot name its world
    // would leave every later roll dealing catalog worlds and palettes.
    match with_world_line(&seed.design_md, &seed.id) {
        Some(md) => seed.design_md = md,
        None => {
            io.err(&format!(
                "The DESIGN.md your Impeccable account sent for {id} can't record which world it came from, so nothing was written. Update the Impeccable CLI and try again.\n"
            ));
            return 1;
        }
    }
    match write(&root, &design_root, &seed) {
        Ok(()) => {
            let name = &seed.name;
            let mut out = format!("{name} is now this project's design system.\n");
            if truecolor(io) {
                out.push_str(&swatches(&seed.design_md));
            }
            let design = relative(&design_root.join("DESIGN.md"));
            let sidecar = relative(&root.join(".impeccable/design.json"));
            out.push_str(&format!(
                "Wrote {design} and {sidecar}.\nNext: ask your agent for your next page, like /impeccable craft a pricing page. It builds in {name}.\n"
            ));
            io.out(&out);
            0
        }
        Err(Exists(found)) => {
            let base = if found == "DESIGN.md" || found == "DESIGN.json" { &design_root } else { &root };
            let found = relative(&base.join(found));
            io.out(&format!(
                "{found} already exists, so nothing was written. To merge this world into it, run impeccable world {id} --print and fold its DESIGN.md into yours.\n"
            ));
            0
        }
        Err(Failed(e)) => {
            io.err(&format!("Couldn't write the world's design system: {e}\n"));
            1
        }
    }
}

/// Swatches only where they render: a real terminal that says it does 24-bit
/// colour, and no NO_COLOR. Agents and pipes get the plain lines.
fn truecolor(io: &Io) -> bool {
    use std::io::IsTerminal;
    std::io::stdout().is_terminal()
        && io.env.get("NO_COLOR").is_none_or(|v| v.is_empty())
        && io.env.get("TERM").is_none_or(|t| t != "dumb")
        && io
            .env
            .get("COLORTERM")
            .is_some_and(|c| c == "truecolor" || c == "24bit")
}

/// The world's palette from the DESIGN.md frontmatter `colors:` block, as one
/// row of up to 12 swatches. Values the CLI can't read are skipped; an empty
/// row is left out.
fn swatches(design_md: &str) -> String {
    let row: String = palette(design_md)
        .into_iter()
        .take(12)
        .map(|(r, g, b)| format!("\x1b[38;2;{r};{g};{b}m\u{2588}\u{2588}\u{2588}\x1b[0m "))
        .collect();
    if row.is_empty() {
        String::new()
    } else {
        format!("  {}\n", row.trim_end())
    }
}

fn palette(design_md: &str) -> Vec<(u8, u8, u8)> {
    let Some(front) = design_md
        .strip_prefix("---\n")
        .and_then(|rest| rest.split("\n---").next())
    else {
        return Vec::new();
    };
    let mut in_colors = false;
    let mut out = Vec::new();
    for line in front.lines() {
        if !line.starts_with([' ', '\t', '#']) && !line.is_empty() {
            in_colors = line.trim_end() == "colors:";
            continue;
        }
        if !in_colors || line.trim_start().starts_with('#') {
            continue;
        }
        let Some((_, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        let value = match value.chars().next() {
            Some(q @ ('"' | '\'')) => value[1..].split(q).next().unwrap_or(""),
            _ => value.split(" #").next().unwrap_or("").trim(),
        };
        if let Some(rgb) = css_color(value) {
            out.push(rgb);
        }
    }
    out
}

/// `#rgb`, `#rrggbb` and `oklch(L[%] C H)`, the forms DESIGN.md frontmatter uses.
fn css_color(v: &str) -> Option<(u8, u8, u8)> {
    if let Some(hex) = v.strip_prefix('#') {
        let hex: String = match hex.len() {
            3 => hex.chars().flat_map(|c| [c, c]).collect(),
            6 => hex.to_string(),
            _ => return None,
        };
        let n = u32::from_str_radix(&hex, 16).ok()?;
        return Some(((n >> 16) as u8, (n >> 8) as u8, n as u8));
    }
    let inner = v.strip_prefix("oklch(")?.strip_suffix(')')?;
    let mut parts = inner.split('/').next()?.split_whitespace();
    let l = parts.next()?;
    let l = match l.strip_suffix('%') {
        Some(p) => p.parse::<f64>().ok()? / 100.0,
        None => l.parse::<f64>().ok()?,
    };
    let c: f64 = parts.next()?.parse().ok()?;
    let h: f64 = parts.next()?.trim_end_matches("deg").parse().ok()?;
    let (a, b) = (c * h.to_radians().cos(), c * h.to_radians().sin());
    let l_ = (l + 0.396_337_777_4 * a + 0.215_803_757_3 * b).powi(3);
    let m_ = (l - 0.105_561_345_8 * a - 0.063_854_172_8 * b).powi(3);
    let s_ = (l - 0.089_484_177_5 * a - 1.291_485_548 * b).powi(3);
    let lin = [
        4.076_741_662_1 * l_ - 3.307_711_591_3 * m_ + 0.230_969_929_2 * s_,
        -1.268_438_004_6 * l_ + 2.609_757_401_1 * m_ - 0.341_319_396_5 * s_,
        -0.004_196_086_3 * l_ - 0.703_418_614_7 * m_ + 1.707_614_701 * s_,
    ];
    let enc = |x: f64| {
        let x = x.clamp(0.0, 1.0);
        let s = if x <= 0.003_130_8 {
            12.92 * x
        } else {
            1.055 * x.powf(1.0 / 2.4) - 0.055
        };
        (s * 255.0).round() as u8
    };
    Some((enc(lin[0]), enc(lin[1]), enc(lin[2])))
}

fn failure(id: &str, e: &SessionError) -> String {
    use crate::http::ApiError;
    match e {
        SessionError::NotSignedIn => {
            "Using a world needs your Impeccable account. Run impeccable login, then try again.\n".into()
        }
        SessionError::Expired | SessionError::Api(ApiError::Status { status: 401, .. }) => {
            "Your sign-in expired. Run impeccable login, then try again.\n".into()
        }
        SessionError::Api(ApiError::Status { status: 403, code })
            if code.as_deref() == Some("insufficient_scope") =>
        {
            "Using a world needs a fresh sign-in. Run impeccable login, then try again.\n".into()
        }
        SessionError::Api(ApiError::Status { status: 403, .. }) => {
            format!("The world {id} needs Pro. {}\n", crate::pro::PRICING)
        }
        SessionError::Api(ApiError::Status { status: 404, .. }) => format!(
            "No world has the id {id}. Copy the id from the world in the Impeccable worlds catalog.\n"
        ),
        // The service answered, but not with JSON: the same advice as a seed
        // whose shape this CLI can't read, never "couldn't reach".
        SessionError::Api(ApiError::Network(m)) if m == crate::http::NOT_JSON => UNREADABLE.into(),
        e => format!("Couldn't reach your Impeccable account: {e}.\n"),
    }
}

enum WriteError {
    Exists(&'static str),
    Failed(String),
}
use WriteError::{Exists, Failed};

/// A directory held open, so every create and remove below is relative to the
/// folder that was checked: renaming it away or swapping in a symlink afterwards
/// cannot redirect a write or a rollback outside the project.
struct Dir {
    #[cfg(unix)]
    handle: std::fs::File,
    #[cfg(not(unix))]
    path: std::path::PathBuf,
    /// A child folder, rechecked before every create and remove in it. The
    /// root is the project itself and may legitimately sit behind a link.
    #[cfg(not(unix))]
    child: bool,
}

/// A real folder, never a symlink, a junction or another reparse point. A
/// path-held directory cannot pin the folder it checked, so the check runs
/// again right before each write; a swap inside that window is the one race
/// left where there is no `O_NOFOLLOW`.
#[cfg(not(unix))]
fn real_folder(path: &Path) -> bool {
    let Ok(m) = path.symlink_metadata() else {
        return false;
    };
    #[cfg(windows)]
    let redirect = {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    };
    #[cfg(not(windows))]
    let redirect = false;
    m.is_dir() && !m.file_type().is_symlink() && !redirect
}

impl Dir {
    /// The project root itself.
    fn root(path: &Path) -> Result<Dir, WriteError> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            let handle = std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY)
                .open(path)
                .map_err(|e| Failed(e.to_string()))?;
            Ok(Dir { handle })
        }
        #[cfg(not(unix))]
        Ok(Dir {
            path: path.to_path_buf(),
            child: false,
        })
    }

    /// A real child folder, created when absent. A symlink, a junction or a
    /// file of that name is refused, never followed.
    fn child(&self, name: &str) -> Result<Dir, WriteError> {
        let not_folder = || Failed(format!("{name} is not a folder"));
        #[cfg(unix)]
        {
            use std::os::fd::{AsRawFd, FromRawFd};
            let c = std::ffi::CString::new(name).map_err(|e| Failed(e.to_string()))?;
            // SAFETY: a live directory descriptor and a NUL-terminated name.
            unsafe { libc::mkdirat(self.handle.as_raw_fd(), c.as_ptr(), 0o777) };
            // SAFETY: as above; the descriptor returned is owned by the File.
            let fd = unsafe {
                libc::openat(
                    self.handle.as_raw_fd(),
                    c.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if fd < 0 {
                return Err(not_folder());
            }
            // SAFETY: fd was just opened and is owned by nothing else.
            Ok(Dir {
                handle: unsafe { std::fs::File::from_raw_fd(fd) },
            })
        }
        #[cfg(not(unix))]
        {
            let path = self.path.join(name);
            if path.symlink_metadata().is_err() {
                std::fs::create_dir(&path).map_err(|e| Failed(e.to_string()))?;
            }
            if !real_folder(&path) {
                return Err(not_folder());
            }
            Ok(Dir { path, child: true })
        }
    }

    /// Creates `name` here, new only (an existing file or symlink is `Exists`),
    /// and fills it. A file this call created but could not fill is removed, so
    /// a full disk never leaves a stub that blocks the next run.
    fn create(
        &self,
        name: &str,
        label: &'static str,
        fill: impl FnOnce(&mut std::fs::File) -> std::io::Result<()>,
    ) -> Result<(), WriteError> {
        let exists = |e: &std::io::Error| e.kind() == std::io::ErrorKind::AlreadyExists;
        #[cfg(unix)]
        let opened = {
            use std::os::fd::{AsRawFd, FromRawFd};
            let c = std::ffi::CString::new(name).map_err(|e| Failed(e.to_string()))?;
            // SAFETY: a live directory descriptor and a NUL-terminated name.
            let fd = unsafe {
                libc::openat(
                    self.handle.as_raw_fd(),
                    c.as_ptr(),
                    libc::O_WRONLY
                        | libc::O_CREAT
                        | libc::O_EXCL
                        | libc::O_NOFOLLOW
                        | libc::O_CLOEXEC,
                    0o644 as libc::c_uint,
                )
            };
            if fd < 0 {
                Err(std::io::Error::last_os_error())
            } else {
                // SAFETY: fd was just opened and is owned by nothing else.
                Ok(unsafe { std::fs::File::from_raw_fd(fd) })
            }
        };
        #[cfg(not(unix))]
        let opened = if self.child && !real_folder(&self.path) {
            return Err(Failed(format!("{} is not a folder", self.path.display())));
        } else {
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(self.path.join(name))
        };
        let mut file = match opened {
            Ok(f) => f,
            Err(e) if exists(&e) => return Err(Exists(label)),
            Err(e) => return Err(Failed(e.to_string())),
        };
        if let Err(e) = fill(&mut file) {
            drop(file);
            self.remove(name);
            return Err(Failed(e.to_string()));
        }
        Ok(())
    }

    /// Removes a file this run created here.
    fn remove(&self, name: &str) {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            if let Ok(c) = std::ffi::CString::new(name) {
                // SAFETY: a live directory descriptor and a NUL-terminated name.
                unsafe { libc::unlinkat(self.handle.as_raw_fd(), c.as_ptr(), 0) };
            }
        }
        #[cfg(not(unix))]
        if !self.child || real_folder(&self.path) {
            let _ = std::fs::remove_file(self.path.join(name));
        }
    }
}

/// Writes the sidecar, then DESIGN.md, each create-new inside a held
/// directory handle, so a file that appeared since the check (or a symlink
/// planted in its place, or a swapped `.impeccable`) is never followed or
/// replaced. Whatever this run created is removed again when a later step
/// fails; nothing that was there before is ever touched.
fn write(root: &Path, design_root: &Path, seed: &Seed) -> Result<(), WriteError> {
    if let Some(found) = existing(design_root).or_else(|| existing(root)) {
        return Err(Exists(found));
    }
    let mut sidecar = seed.sidecar.clone();
    sidecar.insert(
        "seededFrom".into(),
        serde_json::json!({ "world": seed.id, "name": seed.name }),
    );
    let mut sidecar_bytes =
        serde_json::to_vec_pretty(&sidecar).map_err(|e| Failed(e.to_string()))?;
    sidecar_bytes.push(b'\n');
    let top = Dir::root(root)?;
    // Walk each local component from the pinned project root. Passing a
    // multi-component path to openat would allow intermediate symlinks.
    let mut local_dir = None;
    let design_dir = if let Ok(relative) = design_root.strip_prefix(root) {
        for component in relative.components() {
            let std::path::Component::Normal(name) = component else {
                return Err(Failed("context path is not a folder".into()));
            };
            let parent = local_dir.as_ref().unwrap_or(&top);
            local_dir = Some(parent.child(&name.to_string_lossy())?);
        }
        local_dir.as_ref().unwrap_or(&top)
    } else {
        // Only an explicitly configured context directory can reach here.
        local_dir = Some(Dir::root(design_root)?);
        local_dir.as_ref().unwrap()
    };
    let dir = top.child(".impeccable")?;
    dir.create("design.json", ".impeccable/design.json", |f| {
        f.write_all(&sidecar_bytes)
    })?;
    if let Err(e) = design_dir.create("DESIGN.md", "DESIGN.md", |f| {
        f.write_all(seed.design_md.as_bytes())
    }) {
        dir.remove("design.json");
        return Err(e);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_it_could_not_fill_is_removed_and_nothing_else_is() {
        // Catches: a full disk leaving an empty DESIGN.md or design.json behind,
        // which the next run reads as an existing design system and refuses to seed.
        let root =
            std::env::temp_dir().join(format!("world-write-{}", crate::oauth::random_b64(9)));
        std::fs::create_dir_all(&root).unwrap();
        let top = Dir::root(&root).ok().unwrap();
        let full = |_: &mut std::fs::File| Err(std::io::Error::other("disk full"));
        assert!(matches!(
            top.create("DESIGN.md", "DESIGN.md", full),
            Err(Failed(_))
        ));
        assert!(!root.join("DESIGN.md").exists());
        // A file that was already there is reported, and left exactly as it was.
        std::fs::write(root.join("DESIGN.md"), "mine").unwrap();
        assert!(matches!(
            top.create("DESIGN.md", "DESIGN.md", |f| f.write_all(b"x")),
            Err(Exists("DESIGN.md"))
        ));
        assert_eq!(
            std::fs::read_to_string(root.join("DESIGN.md")).unwrap(),
            "mine"
        );
    }

    #[test]
    #[cfg(unix)]
    fn a_symlinked_impeccable_folder_is_refused_not_followed() {
        // Catches: design.json created (or rolled back) through a symlink, outside the project.
        let base = std::env::temp_dir().join(format!("world-swap-{}", crate::oauth::random_b64(9)));
        let (root, outside) = (base.join("project"), base.join("outside"));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("design.json"), "theirs").unwrap();
        std::os::unix::fs::symlink(&outside, root.join(".impeccable")).unwrap();
        let top = Dir::root(&root).ok().unwrap();
        assert!(matches!(top.child(".impeccable"), Err(Failed(_))));
        assert_eq!(
            std::fs::read_to_string(outside.join("design.json")).unwrap(),
            "theirs"
        );
    }

    #[test]
    fn the_written_design_md_always_names_its_world() {
        // Catches: a seed written without a `world:` line, so later rolls still
        // deal catalog worlds and palettes over the one the person chose.
        let w = |md: &str| with_world_line(md, "kinpaku");
        let kept = "---\nname: K\nworld: \"kinpaku\"\ncolors:\n  gold: \"#c9a227\"\n---\n# K\n";
        assert_eq!(w(kept).as_deref(), Some(kept));
        assert_eq!(
            w("---\nname: K\ncolors:\n  gold: \"#c9a227\"\n---\n# K\n").as_deref(),
            Some("---\nworld: \"kinpaku\"\nname: K\ncolors:\n  gold: \"#c9a227\"\n---\n# K\n")
        );
        assert_eq!(
            w("# K\n").as_deref(),
            Some("---\nworld: \"kinpaku\"\n---\n# K\n")
        );
        assert_eq!(
            w("---\r\nname: K\r\n---\r\n").as_deref(),
            Some("---\r\nworld: \"kinpaku\"\r\nname: K\r\n---\r\n")
        );
        // The inserted line leaves the palette readable.
        let md = w("---\ncolors:\n  gold: \"#c9a227\"\n---\n").unwrap();
        assert_eq!(palette(&md), vec![(0xc9, 0xa2, 0x27)]);
        // Another world, a value no reader accepts, an unclosed frontmatter.
        for bad in [
            "---\nworld: swiss\n---\n",
            "---\nworld: \"../x\"\n---\n",
            "---\nworld:\n---\n",
            "---\nname: K\n",
        ] {
            assert_eq!(w(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_design_file_the_context_reader_finds_anywhere_is_refused() {
        // Catches: a design system in docs/ or .agents/context/ (or the folder
        // IMPECCABLE_CONTEXT_DIR names) missed, so a new root DESIGN.md shadows it
        // on every later boot instead of the merge line offering --print.
        for (rel, extra_env) in [
            ("docs/DESIGN.md", None),
            (".agents/context/DESIGN.md", None),
            ("ctx/DESIGN.md", Some(("IMPECCABLE_CONTEXT_DIR", "ctx"))),
        ] {
            let base = std::env::temp_dir().join(format!("world-resolved-{}", crate::oauth::random_b64(9)));
            let (root, home) = (base.join("project"), base.join("home"));
            std::fs::create_dir_all(root.join(rel).parent().unwrap()).unwrap();
            std::fs::create_dir_all(&home).unwrap();
            std::fs::write(root.join(rel), "# Ours\n").unwrap();
            let home = home.to_string_lossy().into_owned();
            let mut env = std::collections::HashMap::new();
            for (k, v) in [("HOME", home.as_str()), ("USERPROFILE", home.as_str()), ("IMPECCABLE_CREDENTIAL_STORE", "file")] {
                env.insert(k.to_string(), v.to_string());
            }
            if let Some((k, v)) = extra_env {
                env.insert(k.to_string(), v.to_string());
            }
            let (mut io, cap) = Io::captured("", root.clone(), env);
            assert_eq!(run(&["kinpaku".to_string()], &mut io), 0, "{rel}");
            let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
            assert_eq!(
                out,
                format!("{rel} already exists, so nothing was written. To merge this world into it, run impeccable world kinpaku --print and fold its DESIGN.md into yours.\n"),
                "{rel}"
            );
            assert!(root.join("DESIGN.md").symlink_metadata().is_err(), "{rel}");
            assert!(root.join(".impeccable").symlink_metadata().is_err(), "{rel}");
            let _ = std::fs::remove_dir_all(&base);
        }
    }

    #[test]
    fn ids_are_url_safe_slugs_only() {
        for ok in ["kinpaku", "swiss-1960", "a", "a1-b2"] {
            assert!(valid_id(ok), "{ok}");
        }
        let long = "a".repeat(65);
        for bad in [
            "",
            "-a",
            "a-",
            "a--b",
            "A",
            "a/b",
            "..",
            "a?b",
            "a b",
            "ä",
            long.as_str(),
        ] {
            assert!(!valid_id(bad), "{bad}");
        }
    }

    #[test]
    fn the_palette_comes_from_the_frontmatter_colors_block() {
        let md = "---\nname: W\ncolors:\n  # anchors\n  gold: \"#c9a227\" # accent\n  ink: '#000'\n  white: \"oklch(100% 0 0)\"\n  black: oklch(0 0 0)\n  var: \"var(--x)\"\nrounded:\n  sm: \"#ffffff\"\n---\n# W\ncolors:\n  late: \"#123456\"\n";
        assert_eq!(
            palette(md),
            vec![(0xc9, 0xa2, 0x27), (0, 0, 0), (255, 255, 255), (0, 0, 0)]
        );
        assert!(palette("# no frontmatter\n").is_empty());
        assert_eq!(swatches("# none\n"), "");
        // A saturated oklch lands in gamut as a warm gold, not black or white.
        let (r, g, b) = css_color("oklch(84% 0.19 80.46)").unwrap();
        assert!(r > 200 && g > 150 && b < 80, "{r} {g} {b}");
    }

    #[test]
    fn a_seed_must_name_the_world_asked_for_and_stay_bounded() {
        let good =
            serde_json::json!({ "id": "w", "name": "W", "design_md": "# W\n", "sidecar": {} });
        assert!(parse("w", &good).is_some());
        let mut other = good.clone();
        other["id"] = "x".into();
        assert!(parse("w", &other).is_none());
        let mut empty = good.clone();
        empty["design_md"] = " \n".into();
        assert!(parse("w", &empty).is_none());
        let mut huge = good.clone();
        huge["design_md"] = "x".repeat(MAX_DESIGN_MD + 1).into();
        assert!(parse("w", &huge).is_none());
        let mut array = good.clone();
        array["sidecar"] = serde_json::json!([]);
        assert!(parse("w", &array).is_none());
        let mut control = good;
        control["name"] = "W\u{1b}[2J".into();
        assert!(parse("w", &control).is_none());
    }
}
