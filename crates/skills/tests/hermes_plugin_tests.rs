//! The Hermes design-hook plugin install (#1178): Hermes loads plugins only
//! from its home dir, so project and global installs both copy there.

use impeccable_skills::hook_manifest::{copy_provider_hooks, hook_installed_for_provider};
use impeccable_skills::providers::Sys;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const PLUGIN: &str = ".hermes/plugins/impeccable-design-hook";

struct Fixture {
    root: PathBuf,
    bundle: String,
    home: String,
    project: String,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let root = std::env::temp_dir().join(format!("imp-hermes-{name}-{}-{nanos}", std::process::id()));
        let bundle = root.join("bundle");
        std::fs::create_dir_all(bundle.join(PLUGIN)).unwrap();
        std::fs::write(bundle.join(PLUGIN).join("plugin.yaml"), "name: impeccable-design-hook\n").unwrap();
        std::fs::write(bundle.join(PLUGIN).join("__init__.py"), "def register(ctx):\n    pass\n").unwrap();
        std::fs::create_dir_all(root.join("home")).unwrap();
        std::fs::create_dir_all(root.join("project")).unwrap();
        let s = |p: PathBuf| p.to_string_lossy().into_owned();
        Fixture { bundle: s(bundle), home: s(root.join("home")), project: s(root.join("project")), root }
    }

    fn sys(&self, hermes_home: Option<&str>) -> Sys {
        let mut env = HashMap::new();
        env.insert("HOME".to_string(), self.home.clone());
        env.insert("USERPROFILE".to_string(), self.home.clone());
        if let Some(h) = hermes_home {
            env.insert("HERMES_HOME".to_string(), h.to_string());
        }
        Sys::new(env, self.project.clone())
    }

    fn install(&self, sys: &Sys) -> Result<Vec<&'static str>, String> {
        copy_provider_hooks(sys, &self.bundle, &self.project, &[".hermes"], false, None, None)
    }

    fn read(&self, path: &str) -> String {
        std::fs::read_to_string(self.root.join(path)).unwrap()
    }
}

/// The installer's own "already installed" check, routed for `.hermes`.
fn installed(f: &Fixture, sys: &Sys) -> bool {
    hook_installed_for_provider(sys, &f.project, ".hermes")
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn project_install_writes_the_plugin_under_the_hermes_home() {
    let f = Fixture::new("project");
    let sys = f.sys(None);
    assert!(!installed(&f, &sys));
    assert_eq!(f.install(&sys).unwrap(), vec![".hermes"]);
    assert_eq!(f.read(&format!("home/{PLUGIN}/plugin.yaml")), "name: impeccable-design-hook\n");
    assert!(f.read(&format!("home/{PLUGIN}/__init__.py")).contains("def register"));
    assert!(!Path::new(&f.project).join(".hermes").exists(), "never a project-local plugin");
    assert!(installed(&f, &sys));
    // Idempotent.
    assert_eq!(f.install(&sys).unwrap(), vec![".hermes"]);
    assert!(f.read(&format!("home/{PLUGIN}/__init__.py")).contains("def register"));
}

#[test]
fn hermes_home_redirects_only_under_home() {
    let f = Fixture::new("hermes-home");
    let custom = f.root.join("home/custom-hermes").to_string_lossy().into_owned();
    f.install(&f.sys(Some(&custom))).unwrap();
    assert!(f.root.join("home/custom-hermes/plugins/impeccable-design-hook/__init__.py").is_file());
    assert!(!f.root.join(format!("home/{PLUGIN}")).exists());

    let outside = f.root.join("elsewhere").to_string_lossy().into_owned();
    let sys = f.sys(Some(&outside));
    f.install(&sys).unwrap();
    assert!(!f.root.join("elsewhere").exists());
    assert!(f.root.join(format!("home/{PLUGIN}/__init__.py")).is_file());
    assert!(installed(&f, &sys));
}

#[test]
fn a_partial_plugin_is_repaired() {
    let f = Fixture::new("partial");
    let sys = f.sys(None);
    std::fs::create_dir_all(f.root.join(format!("home/{PLUGIN}"))).unwrap();
    std::fs::write(f.root.join(format!("home/{PLUGIN}/plugin.yaml")), "stale\n").unwrap();
    assert!(!installed(&f, &sys));
    f.install(&sys).unwrap();
    assert_eq!(f.read(&format!("home/{PLUGIN}/plugin.yaml")), "name: impeccable-design-hook\n");
    assert!(installed(&f, &sys));
}

#[test]
fn a_bundle_without_the_plugin_is_skipped() {
    // A bundle from before the plugin, like a bundle without a provider's
    // manifest: nothing written, nothing reported.
    let f = Fixture::new("absent");
    std::fs::remove_dir_all(Path::new(&f.bundle).join(PLUGIN)).unwrap();
    let sys = f.sys(None);
    assert_eq!(f.install(&sys).unwrap(), Vec::<&str>::new());
    assert!(!f.root.join(format!("home/{PLUGIN}")).exists());
    assert!(!installed(&f, &sys));
}

#[test]
fn a_bundle_with_half_the_plugin_errors() {
    let f = Fixture::new("missing");
    std::fs::remove_file(Path::new(&f.bundle).join(PLUGIN).join("__init__.py")).unwrap();
    let sys = f.sys(None);
    let err = f.install(&sys).unwrap_err();
    assert!(err.contains("__init__.py"), "{err}");
    assert!(!f.root.join(format!("home/{PLUGIN}")).exists());
    assert!(!installed(&f, &sys));
}

/// Runs `install --providers=hermes` against a staged bundle zip, with or
/// without the plugin, and returns its stdout.
#[cfg(unix)]
fn run_hermes_install(f: &Fixture, with_plugin: bool) -> String {
    use std::io::Write as _;
    let (os, arch) = impeccable_skills::engine_binary::platform_tag().expect("supported platform");
    std::fs::create_dir_all(Path::new(&f.project).join(".git")).unwrap();
    let zip_path = f.root.join(if with_plugin { "bundle.zip" } else { "bundle-old.zip" });
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
    let plain = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let exec = plain.unix_permissions(0o755);
    let mut entries = vec![
        (".hermes/skills/impeccable/SKILL.md".to_string(), "---\nname: impeccable\n---\n", plain),
        (".hermes/skills/impeccable/scripts/impeccable".to_string(), "#!/bin/sh\nexit 0\n", exec),
        (".hermes/skills/impeccable/scripts/VERSION".to_string(), "9.9.9\n", plain),
        (format!(".hermes/skills/impeccable/scripts/bin/{os}-{arch}/impeccable"), "#!/bin/sh\nexit 0\n", exec),
    ];
    if with_plugin {
        entries.push((format!("{PLUGIN}/plugin.yaml"), "name: impeccable-design-hook\n", plain));
        entries.push((format!("{PLUGIN}/__init__.py"), "def register(ctx):\n    pass\n", plain));
    }
    for (name, body, opts) in entries {
        zip.start_file(name, opts).unwrap();
        zip.write_all(body.as_bytes()).unwrap();
    }
    zip.finish().unwrap();

    let mut env = HashMap::new();
    env.insert("HOME".to_string(), f.home.clone());
    env.insert("TMPDIR".to_string(), f.root.join("tmp").to_string_lossy().into_owned());
    env.insert("IMPECCABLE_BUNDLE_PATH".to_string(), zip_path.to_string_lossy().into_owned());
    std::fs::create_dir_all(f.root.join("tmp")).unwrap();
    let (mut io, captured) = impeccable_common::Io::captured("", PathBuf::from(&f.project), env);
    let args = ["install", "-y", "--providers=hermes", "--scope=project"].map(String::from);
    let code = impeccable_skills::run(&args, &mut io);
    let stdout = String::from_utf8_lossy(&captured.stdout.borrow()).into_owned();
    assert_eq!(code, 0, "install failed:\n{stdout}\n{}", String::from_utf8_lossy(&captured.stderr.borrow()));
    stdout
}

#[cfg(unix)]
const ENABLE_STEP: &str = "hermes plugins enable impeccable-design-hook";

/// A repeat `install` writes nothing new, yet still names the enable step
/// while the plugin is installed but not enabled, and drops it once enabled.
#[cfg(unix)]
#[test]
fn repeat_install_keeps_the_enable_step_until_it_is_taken() {
    if impeccable_skills::engine_binary::platform_tag().is_none() {
        return;
    }
    let f = Fixture::new("remind");
    assert!(run_hermes_install(&f, true).contains(ENABLE_STEP), "first install names the step");
    let repeat = run_hermes_install(&f, true);
    assert!(!repeat.contains("Installed hooks into"), "{repeat}");
    assert!(repeat.contains(ENABLE_STEP), "repeat install still names the step:\n{repeat}");
    std::fs::write(Path::new(&f.home).join(".hermes/config.yaml"), "plugins:\n  enabled:\n    - impeccable-design-hook\n  disabled: []\n").unwrap();
    assert!(!run_hermes_install(&f, true).contains(ENABLE_STEP), "an enabled plugin needs no reminder");
}

/// A bundle from before the plugin installs the skill but no plugin, so there
/// is nothing to enable and the step is never named.
#[cfg(unix)]
#[test]
fn a_bundle_without_the_plugin_names_no_enable_step() {
    if impeccable_skills::engine_binary::platform_tag().is_none() {
        return;
    }
    let f = Fixture::new("noplugin");
    let out = run_hermes_install(&f, false);
    assert!(!out.contains(ENABLE_STEP), "{out}");
    assert!(!run_hermes_install(&f, false).contains(ENABLE_STEP), "repeat install");
}
