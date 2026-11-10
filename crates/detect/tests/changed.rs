//! `detect --changed` scans the UI files git reports as changed: tracked
//! files modified against HEAD and untracked files git does not ignore,
//! under cwd, as if each had been passed as a file argument.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::process::Command;

use impeccable_common::Io;
use impeccable_detect::cli::run_detect;
use impeccable_detect::{Engines, MissingHtmlEngine};

/// A CSS line every scan flags (overused-font), so the files a scan read
/// show up in its findings.
const FLAGGED: &str = ".a { font-family: Inter, sans-serif; }\n";

fn tmp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("impeccable-changed-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(dir: &Path, rel: &str, text: &str) {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}

/// git isolated from the user's config: no signing, hooks, or fsmonitor.
fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"])
        .args(["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "init.defaultBranch=main"])
        .args(args)
        .current_dir(dir)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .unwrap();
    assert!(status.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&status.stderr));
}

fn run(cwd: &Path, flags: &[&str]) -> (i32, String, String) {
    let mut args: Vec<String> = flags.iter().map(|s| s.to_string()).collect();
    args.insert(0, "--no-design-system".into());
    let (mut io, cap) = Io::captured("", cwd.to_path_buf(), HashMap::new());
    let engines = Engines { html: &MissingHtmlEngine, url: None };
    let code = run_detect(&args, &mut io, &engines);
    let out = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
    let err = String::from_utf8(cap.stderr.borrow().clone()).unwrap();
    (code, out, err)
}

/// The distinct files a `--json` scan reported, relative to `root`.
fn files(root: &Path, json: &str) -> BTreeSet<String> {
    let root = std::fs::canonicalize(root).unwrap();
    let v: serde_json::Value = serde_json::from_str(json).unwrap();
    v.as_array()
        .unwrap()
        .iter()
        .map(|f| {
            let file = PathBuf::from(f["file"].as_str().unwrap());
            let file = std::fs::canonicalize(&file).unwrap_or(file);
            file.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/")
        })
        .collect()
}

/// A repo with one commit, then every kind of change on top of it.
fn repo(name: &str) -> PathBuf {
    let dir = tmp(name);
    write(&dir, "src/clean.css", FLAGGED);
    write(&dir, "src/modified.css", ".m { color: red; }\n");
    write(&dir, "src/staged.css", ".s { color: red; }\n");
    write(&dir, "src/deleted.css", FLAGGED);
    write(&dir, "src/old-name.css", FLAGGED);
    write(&dir, "app/web/page.css", ".p { color: red; }\n");
    write(&dir, ".gitignore", "ignored/\n");
    git(&dir, &["init", "-q"]);
    git(&dir, &["add", "."]);
    git(&dir, &["commit", "-qm", "init"]);
    write(&dir, "src/modified.css", FLAGGED);
    write(&dir, "src/staged.css", FLAGGED);
    git(&dir, &["add", "src/staged.css"]);
    std::fs::remove_file(dir.join("src/deleted.css")).unwrap();
    git(&dir, &["mv", "src/old-name.css", "src/new-name.css"]);
    write(&dir, "src/Untracked.jsx", &format!("export const U = () => <style>{{`{}`}}</style>;\n", FLAGGED.trim()));
    write(&dir, "src/notes.md", "font-family: Inter\n");
    write(&dir, "ignored/gitignored.css", FLAGGED);
    write(&dir, "src/bundle.min.css", FLAGGED);
    write(&dir, "node_modules/pkg/x.css", FLAGGED);
    write(&dir, "app/web/page.css", FLAGGED);
    dir
}

#[test]
fn scans_exactly_the_changed_ui_files() {
    let dir = repo("scan");
    let (code, out, err) = run(&dir, &["--json", "--changed"]);
    assert_eq!(code, 2, "{err}");
    let want: BTreeSet<String> = [
        "app/web/page.css",
        "src/Untracked.jsx",
        "src/modified.css",
        "src/new-name.css",
        "src/staged.css",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    assert_eq!(files(&dir, &out), want);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn output_matches_the_same_files_passed_as_arguments() {
    let dir = repo("same");
    let (_, changed, _) = run(&dir, &["--json", "--changed"]);
    // In git's order: paths sorted by bytes.
    let (_, explicit, _) = run(
        &dir,
        &["--json", "app/web/page.css", "src/Untracked.jsx", "src/modified.css", "src/new-name.css", "src/staged.css"],
    );
    assert_eq!(changed, explicit);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_subdirectory_scans_only_its_own_changes() {
    let dir = repo("subdir");
    let (code, out, err) = run(&dir.join("app/web"), &["--json", "--changed"]);
    assert_eq!(code, 2, "{err}");
    assert_eq!(files(&dir, &out), BTreeSet::from(["app/web/page.css".to_string()]));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn honors_ignore_files_config() {
    let dir = repo("ignorefiles");
    write(&dir, ".impeccable/config.json", r#"{ "detector": { "ignoreFiles": ["app/**"] } }"#);
    let (_, out, _) = run(&dir, &["--json", "--changed"]);
    let got = files(&dir, &out);
    assert!(!got.contains("app/web/page.css"), "{got:?}");
    assert!(got.contains("src/modified.css"), "{got:?}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_clean_tree_is_a_clean_scan() {
    let dir = tmp("clean");
    write(&dir, "src/a.css", FLAGGED);
    git(&dir, &["init", "-q"]);
    git(&dir, &["add", "."]);
    git(&dir, &["commit", "-qm", "init"]);
    // A changed file that is not UI does not count.
    write(&dir, "README.md", "notes\n");
    assert_eq!(run(&dir, &["--json", "--changed"]), (0, "[]\n".into(), String::new()));
    assert_eq!(run(&dir, &["--changed"]), (0, String::new(), "No changed UI files to scan.\n".into()));
    assert_eq!(run(&dir, &["--quiet", "--changed"]), (0, String::new(), String::new()));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn outside_a_git_work_tree_exits_2() {
    let dir = tmp("norepo");
    write(&dir, "a.css", FLAGGED);
    // The temp dir must not sit inside some other checkout.
    let inside = Command::new("git")
        .args(["rev-parse", "--is-inside-work-tree"])
        .current_dir(&dir)
        .output()
        .unwrap();
    if inside.status.success() {
        eprintln!("skipping: the temp dir is inside a git work tree");
        return;
    }
    let (code, out, err) = run(&dir, &["--json", "--changed"]);
    assert_eq!(code, 2);
    assert_eq!(out, "");
    assert!(err.starts_with("Error: --changed reads the changed files from git"), "{err}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn takes_no_targets() {
    let dir = repo("targets");
    let (code, out, err) = run(&dir, &["--changed", "src"]);
    assert_eq!((code, out.as_str()), (1, ""));
    assert_eq!(err, "Error: --changed scans the files git reports as changed and takes no file, URL, or --cdp targets\n");
    let _ = std::fs::remove_dir_all(&dir);
}
