//! Regression tests for the Muse bundle layout (Greptile review on
//! PR #1505): the build emits Muse skills under
//! `<bundle>/workspace/custom-skills`, not `<bundle>/workspace/skills`.
//! The bundle readers (`copy_provider_skills`, `refresh_provider_skills`,
//! `is_up_to_date`) must use that layout, and Muse's destination is
//! always the global `~/workspace/custom-skills` — Muse has no
//! project-level skills folder.

use std::collections::HashMap;

use impeccable_common::{jsp, Io};
use impeccable_skills::bundle::{copy_provider_skills, is_up_to_date, link_provider_skills, refresh_provider_skills};
use impeccable_skills::providers::{is_user_only_provider, skills_dir_name, Scope, Sys};

fn temp_root(name: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("impeccable-{name}-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp root");
    let real = dir.canonicalize().unwrap().to_string_lossy().into_owned();
    real.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(real)
}

fn write(path: &str, content: &str) {
    let p = std::path::Path::new(path);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, content).unwrap();
}

fn exists(path: &str) -> bool {
    std::path::Path::new(path).exists()
}

fn sys_with(home: &str) -> Sys {
    let mut env: HashMap<String, String> = HashMap::new();
    env.insert("HOME".into(), home.to_string());
    env.insert("USERPROFILE".into(), home.to_string());
    Sys::new(env, home.to_string())
}

fn bundle_with_muse_skill(bundle: &str, body: &str) {
    write(&format!("{bundle}/workspace/custom-skills/impeccable/SKILL.md"), body);
    write(&format!("{bundle}/workspace/custom-skills/impeccable/reference/polish.md"), "polish\n");
}

const SKILL: &str = "---\nname: impeccable\ndescription: design\n---\nbody\n";

#[test]
fn muse_layout_helpers() {
    assert_eq!(skills_dir_name("workspace"), "custom-skills");
    assert_eq!(skills_dir_name(".claude"), "skills");
    assert!(is_user_only_provider("workspace"));
    assert!(!is_user_only_provider(".claude"));
}

#[test]
fn copy_installs_muse_from_the_custom_skills_bundle_dir() {
    let root = temp_root("muse-copy");
    let bundle = format!("{root}/bundle");
    let home = format!("{root}/home");
    std::fs::create_dir_all(&home).unwrap();
    bundle_with_muse_skill(&bundle, SKILL);
    let sys = sys_with(&home);

    let written = copy_provider_skills(&sys, &bundle, &home, &["workspace"], Some(Scope::User)).unwrap();
    assert_eq!(written.len(), 1);
    assert!(exists(&format!("{home}/workspace/custom-skills/impeccable/SKILL.md")));
    assert!(exists(&format!("{home}/workspace/custom-skills/impeccable/reference/polish.md")));
    assert!(!exists(&format!("{home}/workspace/skills")));
}

#[test]
fn is_up_to_date_actually_compares_muse_files() {
    let root = temp_root("muse-fresh");
    let bundle = format!("{root}/bundle");
    let home = format!("{root}/home");
    std::fs::create_dir_all(&home).unwrap();
    bundle_with_muse_skill(&bundle, SKILL);
    let sys = sys_with(&home);

    // Nothing installed yet: not current. (Before the fix the reader looked
    // in workspace/skills, found no bundle dir, skipped the provider, and
    // reported current without comparing a single file.)
    assert!(!is_up_to_date(&sys, &home, &["workspace"], &bundle, Some(Scope::User), Some(Scope::User)).unwrap());

    copy_provider_skills(&sys, &bundle, &home, &["workspace"], Some(Scope::User)).unwrap();
    assert!(is_up_to_date(&sys, &home, &["workspace"], &bundle, Some(Scope::User), Some(Scope::User)).unwrap());

    // Drifted content is not current.
    write(&format!("{home}/workspace/custom-skills/impeccable/SKILL.md"), "drifted\n");
    assert!(!is_up_to_date(&sys, &home, &["workspace"], &bundle, Some(Scope::User), Some(Scope::User)).unwrap());
}

#[test]
fn refresh_updates_the_muse_skill() {
    let root = temp_root("muse-refresh");
    let bundle = format!("{root}/bundle");
    let home = format!("{root}/home");
    std::fs::create_dir_all(&home).unwrap();
    bundle_with_muse_skill(&bundle, SKILL);
    let sys = sys_with(&home);
    copy_provider_skills(&sys, &bundle, &home, &["workspace"], Some(Scope::User)).unwrap();

    bundle_with_muse_skill(&bundle, "---\nname: impeccable\ndescription: design\n---\nnew body\n");
    let updated = refresh_provider_skills(&sys, &bundle, &home, &["workspace"], Some(Scope::User)).unwrap();
    assert_eq!(updated.len(), 1);
    let installed = std::fs::read_to_string(format!("{home}/workspace/custom-skills/impeccable/SKILL.md")).unwrap();
    assert!(installed.contains("new body"));
}

#[test]
fn project_scope_still_lands_muse_in_the_global_dir() {
    let root = temp_root("muse-project");
    let bundle = format!("{root}/bundle");
    let home = format!("{root}/home");
    let project = format!("{root}/project");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::create_dir_all(&project).unwrap();
    bundle_with_muse_skill(&bundle, SKILL);
    let sys = sys_with(&home);

    // Candidates exist only at user scope: at project scope there are
    // none, so a global install cannot hide a missing project install.
    // (The expected path is built with jsp::join: a literal `/` string
    // does not match the joined path on Windows.)
    assert!(sys.provider_skills_dir_candidates(&project, "workspace", Some(Scope::Project)).is_empty());
    assert_eq!(
        sys.provider_skills_dir_candidates(&home, "workspace", Some(Scope::User)),
        vec![jsp::join(&[&home, "workspace", "custom-skills"])]
    );

    // A mixed project-scope install writes Muse globally, never into
    // <project>/workspace/skills, which Muse does not read.
    let written = copy_provider_skills(&sys, &bundle, &project, &["workspace"], Some(Scope::Project)).unwrap();
    assert_eq!(written.len(), 1);
    assert!(exists(&format!("{home}/workspace/custom-skills/impeccable/SKILL.md")));
    assert!(!exists(&format!("{project}/workspace")));
}

#[cfg(unix)]
#[test]
fn link_lands_muse_in_the_global_dir() {
    let root = temp_root("muse-link");
    let bundle = format!("{root}/bundle");
    let home = format!("{root}/home");
    let project = format!("{root}/project");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::create_dir_all(&project).unwrap();
    bundle_with_muse_skill(&bundle, SKILL);
    let sys = sys_with(&home);

    let mut env: HashMap<String, String> = HashMap::new();
    env.insert("HOME".into(), home.clone());
    env.insert("USERPROFILE".into(), home.clone());
    let (mut io, _captured) = Io::captured("", std::path::PathBuf::from(&project), env);

    // Link is a project-rooted command, but Muse reads only
    // ~/workspace/custom-skills: the link must land there, never in
    // <project>/workspace/custom-skills.
    let result = link_provider_skills(&sys, &mut io, &bundle, &project, &["workspace"], false).unwrap();
    assert_eq!(result.linked, 1);
    let dest = format!("{home}/workspace/custom-skills/impeccable");
    let is_link = std::fs::symlink_metadata(&dest).map(|m| m.file_type().is_symlink()).unwrap_or(false);
    assert!(is_link, "expected a symlink at {dest}");
    assert!(exists(&format!("{dest}/SKILL.md")));
    assert!(!exists(&format!("{project}/workspace")));
}

#[cfg(unix)]
#[test]
fn copy_preserves_a_linked_muse_install() {
    let root = temp_root("muse-copy-link");
    let bundle = format!("{root}/bundle");
    let checkout = format!("{root}/checkout");
    let home = format!("{root}/home");
    let project = format!("{root}/project");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::create_dir_all(&project).unwrap();
    bundle_with_muse_skill(&bundle, SKILL);
    bundle_with_muse_skill(&checkout, "---\nname: impeccable\ndescription: design\n---\ncheckout body\n");
    let sys = sys_with(&home);

    let mut env: HashMap<String, String> = HashMap::new();
    env.insert("HOME".into(), home.clone());
    env.insert("USERPROFILE".into(), home.clone());
    let (mut io, _captured) = Io::captured("", std::path::PathBuf::from(&project), env);

    // `link --providers=muse`: the global skill dir is a symlink into
    // the checkout.
    let linked = link_provider_skills(&sys, &mut io, &checkout, &project, &["workspace"], false).unwrap();
    assert_eq!(linked.linked, 1);

    // A mixed project-scope install now discovers no Muse at project
    // scope, so the copy step runs for Muse too. It must not replace
    // the link with downloaded files.
    let written = copy_provider_skills(&sys, &bundle, &project, &["workspace"], Some(Scope::Project)).unwrap();
    assert!(written.is_empty());
    let dest = format!("{home}/workspace/custom-skills/impeccable");
    let is_link = std::fs::symlink_metadata(&dest).map(|m| m.file_type().is_symlink()).unwrap_or(false);
    assert!(is_link, "expected the link at {dest} to survive the copy");
    let installed = std::fs::read_to_string(format!("{dest}/SKILL.md")).unwrap();
    assert!(installed.contains("checkout body"));
}
