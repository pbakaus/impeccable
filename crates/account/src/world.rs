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

const USAGE: &str = "Usage: impeccable world <id> [--print]\n";

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

/// The files a seed would write, relative to the project root. Any of them
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
                io.out(USAGE);
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
    let root = io.cwd.clone();
    // Checked before any request, so an existing design system costs nothing.
    if !print {
        if let Some(found) = existing(&root) {
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
    let seed = match answer {
        Ok(v) => match parse(&id, &v) {
            Some(seed) => seed,
            None => {
                io.err("Your Impeccable account sent a world this CLI can't read. Update the Impeccable CLI and try again.\n");
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
    match write(&root, &seed) {
        Ok(()) => {
            io.out(&format!(
                "Seeded DESIGN.md from the world {} ({}). Next: ask your agent to build your next page with /impeccable. It reads DESIGN.md first.\n",
                seed.name, seed.id
            ));
            0
        }
        Err(Exists(found)) => {
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
        e => format!("Couldn't reach your Impeccable account: {e}.\n"),
    }
}

enum WriteError {
    Exists(&'static str),
    Failed(String),
}
use WriteError::{Exists, Failed};

/// Writes the sidecar, then DESIGN.md, each with create-new so a file that
/// appeared since the check (or a symlink planted in its place) is never
/// followed or replaced. A DESIGN.md that loses that race takes the sidecar
/// this run wrote back out.
fn write(root: &Path, seed: &Seed) -> Result<(), WriteError> {
    if let Some(found) = existing(root) {
        return Err(Exists(found));
    }
    let dir = root.join(".impeccable");
    match dir.symlink_metadata() {
        Ok(m) if !m.is_dir() => return Err(Failed(".impeccable is not a folder".into())),
        Ok(_) => {}
        Err(_) => std::fs::create_dir(&dir).map_err(|e| Failed(e.to_string()))?,
    }
    let mut sidecar = seed.sidecar.clone();
    sidecar.insert(
        "seededFrom".into(),
        serde_json::json!({ "world": seed.id, "name": seed.name }),
    );
    let mut sidecar_bytes =
        serde_json::to_vec_pretty(&sidecar).map_err(|e| Failed(e.to_string()))?;
    sidecar_bytes.push(b'\n');
    let sidecar_path = dir.join("design.json");
    create_new(&sidecar_path, &sidecar_bytes, ".impeccable/design.json")?;
    if let Err(e) = create_new(
        &root.join("DESIGN.md"),
        seed.design_md.as_bytes(),
        "DESIGN.md",
    ) {
        let _ = std::fs::remove_file(&sidecar_path);
        return Err(e);
    }
    Ok(())
}

fn create_new(path: &Path, bytes: &[u8], label: &'static str) -> Result<(), WriteError> {
    let mut f = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
    {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => return Err(Exists(label)),
        Err(e) => return Err(Failed(e.to_string())),
    };
    f.write_all(bytes).map_err(|e| Failed(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

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
