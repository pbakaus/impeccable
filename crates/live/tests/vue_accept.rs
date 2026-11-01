use impeccable_common::Io;
use impeccable_live::{event_validation, live_accept};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

const SOURCE: &str = include_str!("../../../tests/fixtures/live-vue-accept/StatusCard.vue");
const MARKUP: &str = "  <section class=\"card\" @click=\"increment\">\n    <p>{{ label }}: {{ count }}</p>\n  </section>";
static NEXT: AtomicU64 = AtomicU64::new(0);

struct Fixture(PathBuf);
impl Fixture {
    fn new(source: &str, variant: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "impeccable-vue-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(dir.join("node_modules/.impeccable-live/ab12cd34")).unwrap();
        fs::write(dir.join("package.json"), "{\"type\":\"module\"}").unwrap();
        if let Ok(modules) = std::env::var("IMPECCABLE_TEST_VUE_MODULES") {
            // Forward to the real compiler without privileged Windows symlinks.
            let compiler = dir.join("node_modules/@vue/compiler-sfc");
            fs::create_dir_all(&compiler).unwrap();
            let target = PathBuf::from(modules).join("@vue/compiler-sfc");
            fs::write(
                compiler.join("index.js"),
                format!("module.exports = require({});", json!(target)),
            )
            .unwrap();
        }
        fs::write(dir.join("StatusCard.vue"), source).unwrap();
        let session = dir.join("node_modules/.impeccable-live/ab12cd34");
        let start = source
            .lines()
            .position(|line| line.contains("<section"))
            .unwrap()
            + 1;
        fs::write(session.join("manifest.json"), json!({
            "id":"ab12cd34", "previewMode":"vue-component", "count":1,
            "sourceFile":"StatusCard.vue", "componentDir":"node_modules/.impeccable-live/ab12cd34",
            "sourceStartLine": start, "sourceEndLine":start+2, "originalMarkup": MARKUP,
        }).to_string()).unwrap();
        fs::write(session.join("v1.vue"), variant).unwrap();
        fs::write(
            session.join("params.json"),
            json!({"1":[{"id":"space","kind":"range","default":8}]}).to_string(),
        )
        .unwrap();
        Self(dir)
    }
    fn accept(&self, variant: &str) -> (i32, Value) {
        self.accept_params(variant, "{\"space\":23}")
    }
    fn accept_params(&self, variant: &str, params: &str) -> (i32, Value) {
        let (mut io, cap) = Io::captured("", self.0.clone(), HashMap::new());
        let code = live_accept::run(
            &[
                "--id",
                "ab12cd34",
                "--variant",
                variant,
                "--param-values",
                params,
            ]
            .map(str::to_owned),
            &mut io,
        );
        let text = String::from_utf8(cap.stdout.borrow().clone()).unwrap();
        (
            code,
            serde_json::from_str(&text).unwrap_or_else(|_| json!({"stdout":text})),
        )
    }
    fn source(&self) -> String {
        fs::read_to_string(self.0.join("StatusCard.vue")).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn variant(style: &str) -> String {
    format!("<template>\n{MARKUP}\n</template>\n<style {style}>\n.card {{ padding: calc(var(--p-space, 8) * 1px); color: red; }}\n</style>")
}

#[test]
fn vue_accept_preserves_tuned_values_scripts_and_bindings() {
    let fixture = Fixture::new(
        SOURCE,
        &variant("scoped").replace("class=\"card\"", "class=\"card chosen\""),
    );
    let (_, result) = fixture.accept("1");
    assert_eq!(result["handled"], true, "{result}");
    assert_ne!(result["mode"], "error", "{result}");
    let source = fixture.source();
    assert!(source.contains("class=\"card chosen\""), "{source}");
    assert!(source.contains("padding: calc(23 * 1px)"), "{source}");
    assert!(!source.contains("var(--p-space"));
    assert_eq!(
        source.split("<template>").next(),
        SOURCE.split("<template>").next()
    );
    for binding in ["@click=\"increment\"", "{{ label }}", "{{ count }}"] {
        assert!(source.contains(binding));
    }
    assert_eq!(source.matches(".card {").count(), 1, "{source}");
    assert!(!fixture
        .0
        .join("node_modules/.impeccable-live/ab12cd34")
        .exists());
    let (_, repeated) = fixture.accept("1");
    assert_eq!(repeated["alreadyApplied"], true, "{repeated}");
}

#[test]
fn vue_accept_keeps_global_styles_and_writes_to_a_scoped_block() {
    for source in [
        SOURCE.replace("<style scoped>", "<style>"),
        format!("{SOURCE}\n<style>body {{ margin: 0; }}</style>\n"),
    ] {
        let original_global = source.rsplit("<style>").next().unwrap().to_string();
        let fixture = Fixture::new(&source, &variant("scoped"));
        let (_, result) = fixture.accept("1");
        assert_ne!(result["mode"], "error", "{result}");
        let accepted = fixture.source();
        assert!(accepted.contains("<style scoped>"), "{accepted}");
        assert!(accepted.contains("padding: calc(23 * 1px)"), "{accepted}");
        assert!(
            accepted.contains(&format!("<style>{original_global}")),
            "global CSS changed: {accepted}"
        );
    }
}

#[test]
fn vue_accept_refuses_unscoped_variant_css_without_writing() {
    let fixture = Fixture::new(SOURCE, &variant(""));
    let (_, result) = fixture.accept("1");
    assert_eq!(result["mode"], "error", "{result}");
    assert!(
        result["error"].as_str().unwrap_or("").contains("scoped"),
        "{result}"
    );
    assert_eq!(fixture.source(), SOURCE);
}

#[test]
fn vue_accept_refuses_style_preprocessors_without_writing() {
    for lang in ["sass", "scss", "less", "stylus"] {
        let fixture = Fixture::new(SOURCE, &variant(&format!("scoped lang=\"{lang}\"")));
        let (_, result) = fixture.accept("1");
        assert_eq!(result["mode"], "error", "{result}");
        assert!(
            result["error"].as_str().unwrap_or("").contains(lang),
            "{result}"
        );
        assert_eq!(fixture.source(), SOURCE);
    }
}

#[test]
fn vue_accept_rejects_stale_source_without_writing() {
    let fixture = Fixture::new(SOURCE, &variant("scoped"));
    let changed = SOURCE.replace("{{ count }}", "{{ count + 1 }}");
    fs::write(fixture.0.join("StatusCard.vue"), &changed).unwrap();
    let (_, result) = fixture.accept("1");
    assert_eq!(result["mode"], "error", "{result}");
    assert!(
        result["error"].as_str().unwrap_or("").contains("changed"),
        "{result}"
    );
    assert_eq!(fixture.source(), changed);
}

#[test]
fn vue_accept_rejects_variant_zero() {
    let fixture = Fixture::new(SOURCE, &variant("scoped"));
    assert_eq!(fixture.accept("0").0, 1);
    assert!(event_validation::validate_event(
        &json!({"type":"accept","id":"ab12cd34","variantId":"0"})
    )
    .is_some());
    assert_eq!(fixture.source(), SOURCE);
}

#[test]
fn vue_accept_rejects_script_edits_and_missing_behavior() {
    for selected in [
        format!(
            "{}\n<script setup>const count = 99;</script>",
            variant("scoped")
        ),
        variant("scoped").replace("@click=\"increment\"", ""),
        variant("scoped").replace("{{ count }}", "0"),
        variant("scoped").replace("<p>", "<p v-if=\"missingValue\">"),
    ] {
        let fixture = Fixture::new(SOURCE, &selected);
        let (_, result) = fixture.accept("1");
        assert_eq!(result["mode"], "error", "{result}");
        assert_eq!(fixture.source(), SOURCE);
        assert!(fixture
            .0
            .join("node_modules/.impeccable-live/ab12cd34")
            .exists());
    }
}

#[test]
fn vue_accept_rejects_global_css_escape_without_writing() {
    let selected = variant("scoped").replace(".card {", ":global(body) {");
    let fixture = Fixture::new(SOURCE, &selected);
    let (_, result) = fixture.accept("1");
    assert_eq!(result["mode"], "error", "{result}");
    assert_eq!(fixture.source(), SOURCE);
}

#[test]
fn vue_accept_rejects_malformed_parameters_without_using_defaults() {
    let fixture = Fixture::new(SOURCE, &variant("scoped"));
    let (_, result) = fixture.accept_params("1", "{bad-json");
    assert_eq!(result["mode"], "error", "{result}");
    assert!(
        result["error"]
            .as_str()
            .unwrap_or("")
            .contains("parameter values"),
        "{result}"
    );
    assert_eq!(fixture.source(), SOURCE);
}

#[test]
fn vue_accept_bakes_range_steps_and_toggle_without_preview_selectors() {
    let selected = variant("scoped").replace("</style>", ".card[data-p-face=\"serif\"] { font-family: serif; }\n.card[data-p-bold] { font-weight: 700; }\n</style>");
    let fixture = Fixture::new(SOURCE, &selected);
    fs::write(
        fixture
            .0
            .join("node_modules/.impeccable-live/ab12cd34/params.json"),
        json!({"1":[
            {"id":"space","kind":"range","default":8},
            {"id":"face","kind":"steps","default":"sans"},
            {"id":"bold","kind":"toggle","default":false}
        ]})
        .to_string(),
    )
    .unwrap();
    let (_, result) = fixture.accept_params("1", "{\"space\":23,\"face\":\"serif\",\"bold\":true}");
    assert_ne!(result["mode"], "error", "{result}");
    let accepted = fixture.source();
    for value in ["calc(23 * 1px)", "font-family: serif", "font-weight: 700"] {
        assert!(accepted.contains(value), "{accepted}");
    }
    assert!(!accepted.contains("data-p-"), "{accepted}");
}

#[test]
fn vue_accept_refuses_multiple_scoped_blocks_without_reordering_css() {
    let source = format!("{SOURCE}\n<style scoped>.other {{ color: blue; }}</style>");
    let fixture = Fixture::new(&source, &variant("scoped"));
    let (_, result) = fixture.accept("1");
    assert_eq!(result["mode"], "error", "{result}");
    assert!(
        result["error"]
            .as_str()
            .unwrap_or("")
            .contains("scoped CSS block"),
        "{result}"
    );
    assert_eq!(fixture.source(), source);
}

#[test]
fn vue_accept_preserves_unicode_source_offsets() {
    let source = SOURCE.replace("<script>\n", "<script>\n// 状態 🚀\n");
    let fixture = Fixture::new(&source, &variant("scoped"));
    let (_, result) = fixture.accept("1");
    assert_ne!(result["mode"], "error", "{result}");
    let accepted = fixture.source();
    assert_eq!(
        accepted.split("<template>").next(),
        source.split("<template>").next()
    );
    assert!(accepted.contains("padding: calc(23 * 1px)"), "{accepted}");
}

#[test]
fn vue_scaffold_is_opt_in_and_preserves_source() {
    use impeccable_live::{live_wrap, svelte_component};
    let fixture = Fixture::new(SOURCE, &variant("scoped"));
    fs::remove_dir_all(fixture.0.join("node_modules/.impeccable-live/ab12cd34")).unwrap();
    let mut env = HashMap::new();
    assert!(!impeccable_live::vue_component::enabled(
        "StatusCard.vue",
        &env
    ));
    env.insert("IMPECCABLE_LIVE_VUE_COMPONENT".to_string(), "1".to_string());
    let (mut io, cap) = Io::captured("", fixture.0.clone(), env);
    assert_eq!(
        live_wrap::run(
            &[
                "--id",
                "ab12cd34",
                "--count",
                "1",
                "--file",
                "StatusCard.vue",
                "--classes",
                "card",
                "--tag",
                "section"
            ]
            .map(str::to_owned),
            &mut io
        ),
        0,
        "{}",
        String::from_utf8_lossy(&cap.stderr.borrow())
    );
    let value: Value = serde_json::from_slice(&cap.stdout.borrow()).unwrap();
    assert_eq!(value["previewMode"], "vue-component", "{value}");
    assert_eq!(fixture.source(), SOURCE);
    assert!(fixture
        .0
        .join("node_modules/.impeccable-live/ab12cd34/v1.vue")
        .exists());
    let check = svelte_component::compile_check_variants("ab12cd34", fixture.0.to_str().unwrap());
    assert_eq!(check["ok"], true, "{check}");
    assert_eq!(check["checked"], 1);
}
