#[path = "../../account/tests/support/fake.rs"]
mod fake;
use fake::{browser, Fake};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    time::Duration,
};

const SEED: &str = "/cli/v1/worlds/kinpaku/seed";

fn project(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "world-cli-{name}-{}",
        impeccable_account::oauth::random_b64(9)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn run(env: &HashMap<String, String>, cwd: &Path, args: &[&str]) -> Output {
    let mut c = Command::new(env!("CARGO_BIN_EXE_impeccable"));
    c.args(args)
        .env_clear()
        .envs(env)
        .env("IMPECCABLE_NO_STALENESS_CHECK", "1")
        .env("IMPECCABLE_NO_UPDATE_CHECK", "1")
        .env("IMPECCABLE_NO_TELEMETRY", "1")
        .current_dir(cwd)
        .stdin(Stdio::null());
    for key in ["PATH", "SystemRoot", "TEMP", "TMP"] {
        if let Ok(v) = std::env::var(key) {
            c.env(key, v);
        }
    }
    c.output().unwrap()
}

fn signed_in(name: &str) -> (Fake, HashMap<String, String>) {
    let f = Fake::start();
    let env = f.env(name);
    impeccable_account::login(&env, &mut |u| browser(u), Duration::from_secs(10)).unwrap();
    (f, env)
}

fn seed_body() -> String {
    serde_json::json!({
        "id": "kinpaku",
        "name": "Kinpaku",
        "design_md": "# Kinpaku\n\nGold leaf on lacquer.\n",
        "sidecar": { "schemaVersion": 1, "colors": { "gold": "#c9a227" } },
    })
    .to_string()
}

fn text(b: &[u8]) -> String {
    String::from_utf8_lossy(b).into_owned()
}

fn monorepo(name: &str) -> (PathBuf, PathBuf) {
    let dir = project(name);
    let cwd = dir.join("apps/web/src");
    std::fs::create_dir_all(&cwd).unwrap();
    std::fs::write(dir.join("package.json"), r#"{"workspaces":["apps/*"]}"#).unwrap();
    std::fs::write(dir.join("apps/web/package.json"), r#"{"name":"web"}"#).unwrap();
    (dir, cwd)
}

#[test]
fn seeds_workspace_root_from_nested_cwd_and_context_reads_it() {
    let (f, env) = signed_in("world-workspace");
    f.route("GET", SEED, 200, vec![], seed_body());
    let (dir, cwd) = monorepo("workspace");
    let out = run(&env, &cwd, &["world", "kinpaku"]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert!(dir.join("apps/web/DESIGN.md").exists());
    assert!(dir.join("apps/web/.impeccable/design.json").exists());
    assert!(!cwd.join("DESIGN.md").exists());
    assert!(text(&out.stdout).contains("Wrote ../DESIGN.md and ../.impeccable/design.json."));
    let out = run(&env, &cwd, &["context"]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert!(text(&out.stdout).contains("SEEDED_WORLD:"), "{}", text(&out.stdout));
    std::fs::remove_dir_all(dir).unwrap();
}

fn seeds_beside_fallback_product(folder: &str, env_override: bool) {
    let (f, mut env) = signed_in("world-fallback-product");
    f.route("GET", SEED, 200, vec![], seed_body());
    let dir = project("fallback-product");
    let context_dir = dir.join(folder);
    std::fs::create_dir_all(&context_dir).unwrap();
    let product = "# PRODUCT.md\n\nA catalog for independent goldsmiths.\n";
    std::fs::write(context_dir.join("PRODUCT.md"), product).unwrap();
    if env_override {
        env.insert("IMPECCABLE_CONTEXT_DIR".into(), context_dir.to_string_lossy().into_owned());
    }
    let out = run(&env, &dir, &["world", "kinpaku"]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    // Boot from the same cwd must retain product truth as well as the world.
    let out = run(&env, &dir, &["context"]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    let boot = text(&out.stdout);
    assert!(boot.contains(product.trim()), "{boot}");
    assert!(!boot.contains("NO_PRODUCT_MD"), "{boot}");
    assert!(boot.contains("SEEDED_WORLD:"), "{boot}");
    assert!(context_dir.join("DESIGN.md").exists());
    let sidecar: serde_json::Value = serde_json::from_slice(
        &std::fs::read(dir.join(".impeccable/design.json")).unwrap(),
    ).unwrap();
    assert_eq!(sidecar["seededFrom"]["world"], "kinpaku");
    assert!(!dir.join("DESIGN.md").exists());
    assert!(!context_dir.join(".impeccable/design.json").exists());
    assert_eq!(std::fs::read_to_string(context_dir.join("PRODUCT.md")).unwrap(), product);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn seeds_beside_docs_product_and_context_reads_both() {
    seeds_beside_fallback_product("docs", false);
}

#[test]
fn seeds_beside_agents_context_product_and_context_reads_both() {
    seeds_beside_fallback_product(".agents/context", false);
}

#[test]
fn seeds_beside_env_context_product_and_context_reads_both() {
    seeds_beside_fallback_product("custom-context", true);
}

#[test]
fn existing_workspace_sidecar_blocks_seed_from_nested_cwd() {
    let (f, env) = signed_in("world-workspace-existing");
    f.route("GET", SEED, 200, vec![], seed_body());
    let (dir, cwd) = monorepo("workspace-existing");
    let sidecar = dir.join("apps/web/.impeccable/design.json");
    std::fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
    std::fs::write(&sidecar, "{}").unwrap();
    let out = run(&env, &cwd, &["world", "kinpaku"]);
    assert!(out.status.success());
    assert!(text(&out.stdout).starts_with("../.impeccable/design.json already exists"));
    assert_eq!(f.hits(SEED), 0);
    assert!(!cwd.join("DESIGN.md").exists());
    assert_eq!(std::fs::read_to_string(sidecar).unwrap(), "{}");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn seeds_design_md_and_a_marked_sidecar_then_names_the_next_step() {
    let (f, mut env) = signed_in("world-seed");
    f.route("GET", SEED, 200, vec![], seed_body());
    let dir = project("seed");
    // A truecolor terminal setting alone never puts escapes into a pipe: agents read plain lines.
    env.insert("COLORTERM".into(), "truecolor".into());
    let out = run(&env, &dir, &["world", "kinpaku"]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert_eq!(
        text(&out.stdout),
        "Kinpaku is now this project's design system.\nWrote DESIGN.md and .impeccable/design.json.\nNext: ask your agent for your next page, like /impeccable craft a pricing page. It builds in Kinpaku.\n"
    );
    // The world line every later boot and roll settles on, added when the seed has none.
    assert_eq!(
        std::fs::read_to_string(dir.join("DESIGN.md")).unwrap(),
        "---\nworld: \"kinpaku\"\n---\n# Kinpaku\n\nGold leaf on lacquer.\n"
    );
    let sidecar: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.join(".impeccable/design.json")).unwrap())
            .unwrap();
    assert_eq!(sidecar["colors"]["gold"], "#c9a227");
    assert_eq!(sidecar["seededFrom"]["world"], "kinpaku");
}

#[test]
fn an_existing_design_system_is_never_touched_and_print_hands_over_the_seed() {
    let (f, env) = signed_in("world-existing");
    f.route("GET", SEED, 200, vec![], seed_body());
    for existing in ["DESIGN.md", ".impeccable/design.json"] {
        let dir = project("existing");
        std::fs::create_dir_all(dir.join(".impeccable")).unwrap();
        std::fs::write(dir.join(existing), "mine\n").unwrap();
        let out = run(&env, &dir, &["world", "kinpaku"]);
        assert!(out.status.success());
        assert_eq!(
            text(&out.stdout),
            format!("{existing} already exists, so nothing was written. To merge this world into it, run impeccable world kinpaku --print and fold its DESIGN.md into yours.\n")
        );
        assert_eq!(
            std::fs::read_to_string(dir.join(existing)).unwrap(),
            "mine\n"
        );
        assert!(!dir.join("DESIGN.md").exists() || existing == "DESIGN.md");
    }
    // The check costs no request.
    assert_eq!(f.hits(SEED), 0);
    let dir = project("print");
    std::fs::write(dir.join("DESIGN.md"), "mine\n").unwrap();
    let out = run(&env, &dir, &["world", "kinpaku", "--print"]);
    assert!(out.status.success());
    let printed: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(printed["name"], "Kinpaku");
    assert_eq!(printed["design_md"], "# Kinpaku\n\nGold leaf on lacquer.\n");
    assert_eq!(
        std::fs::read_to_string(dir.join("DESIGN.md")).unwrap(),
        "mine\n"
    );
}

#[test]
#[cfg(unix)]
fn a_planted_symlink_is_never_followed() {
    let (f, env) = signed_in("world-symlink");
    f.route("GET", SEED, 200, vec![], seed_body());
    let dir = project("symlink");
    let victim = dir.join("victim.txt");
    std::fs::write(&victim, "keep\n").unwrap();
    std::os::unix::fs::symlink(&victim, dir.join("DESIGN.md")).unwrap();
    let out = run(&env, &dir, &["world", "kinpaku"]);
    assert!(out.status.success());
    assert!(text(&out.stdout).starts_with("DESIGN.md already exists"));
    assert_eq!(std::fs::read_to_string(&victim).unwrap(), "keep\n");
}

#[test]
fn service_answers_map_to_one_actionable_line_each() {
    let (f, env) = signed_in("world-errors");
    let dir = project("errors");
    let cases = [
        (403, r#"{"error":"insufficient_scope"}"#, "Using a world needs a fresh sign-in. Run impeccable login, then try again.\n"),
        (403, r#"{"error":"forbidden","reason":"pro_required"}"#, "The world kinpaku needs Pro. See impeccable.style/pricing\n"),
        (404, r#"{"error":"not_found"}"#, "No world has the id kinpaku. Copy the id from the world in the Impeccable worlds catalog.\n"),
        (200, "<html>maintenance</html>", "Your Impeccable account sent a world this CLI can't read. Update the Impeccable CLI and try again.\n"),
        (200, r##"{"id":"other","name":"X","design_md":"# X","sidecar":{}}"##, "Your Impeccable account sent a world this CLI can't read. Update the Impeccable CLI and try again.\n"),
        (200, r##"{"id":"kinpaku","name":"K","design_md":"---\nworld: swiss\n---\n# K\n","sidecar":{}}"##, "The DESIGN.md your Impeccable account sent for kinpaku can't record which world it came from, so nothing was written. Update the Impeccable CLI and try again.\n"),
    ];
    for (status, body, line) in cases {
        f.route("GET", SEED, status, vec![], body);
        let out = run(&env, &dir, &["world", "kinpaku"]);
        assert!(!out.status.success(), "{status} {body}");
        assert_eq!(text(&out.stderr), line, "{status} {body}");
        assert!(!dir.join("DESIGN.md").exists());
        assert!(!dir.join(".impeccable/design.json").exists());
    }
}

#[test]
fn signed_out_and_bad_ids_never_reach_the_service() {
    let f = Fake::start();
    let env = f.env("world-signed-out");
    let dir = project("signed-out");
    let out = run(&env, &dir, &["world", "kinpaku"]);
    assert_eq!(
        text(&out.stderr),
        "Using a world needs your Impeccable account. Run impeccable login, then try again.\n"
    );
    let out = run(&env, &dir, &["world", "../etc"]);
    assert_eq!(
        text(&out.stderr),
        "\"../etc\" isn't a world id. Copy the id from the world in the Impeccable worlds catalog.\n"
    );
    assert_eq!(f.hits(SEED), 0);
}
