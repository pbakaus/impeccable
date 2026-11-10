//! Offline native integration: actual browser pixels and declared dependency failures.
use serde_json::{Value, json};
use std::{
    fs,
    path::PathBuf,
    process::{Command, Output},
    sync::atomic::{AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Fixture {
    root: PathBuf,
    project: PathBuf,
    store: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "component-native-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let project = root.join("project");
        let store = root.join("store");
        fs::create_dir_all(&project).unwrap();
        let png = impeccable_comp::png_io::encode_png(
            &impeccable_comp::raster::create_image(100, 100, [25, 90, 65, 180]),
            &[],
        )
        .unwrap();
        fs::write(project.join("art.png"), &png).unwrap();
        fs::write(project.join("comp.png"), &png).unwrap();
        fs::write(project.join("component.html"),"<!doctype html><link rel='stylesheet' href='component.css'><body><button>Book</button><svg width='30' height='30'><circle cx='15' cy='15' r='12' fill='orange'/></svg><img src='art.png' width='24' height='24'></body>").unwrap();
        fs::write(
            project.join("component.css"),
            "body{margin:0;background:#faf5ec}button{color:green}",
        )
        .unwrap();
        Self {
            root,
            project,
            store,
        }
    }
    fn manifest(&self) -> Value {
        json!({"schemaVersion":1,"id":"components","title":"Capture fixture","comp":{"path":"comp.png","width":100,"height":100},"components":[{"id":"art","name":"Cutout","medium":"Raster","note":"PNG","box":{"x":0,"y":0,"w":1,"h":1},"preview":{"kind":"image","path":"art.png"},"dependencies":[]},{"id":"code","name":"Code","medium":"HTML/CSS/SVG","note":"Actual code","box":{"x":0,"y":0,"w":1,"h":1},"preview":{"kind":"page","path":"component.html"},"dependencies":["component.css","art.png"]}]})
    }
    fn capture(&self, input: &Value) -> Output {
        fs::write(
            self.project.join("review.json"),
            serde_json::to_vec(input).unwrap(),
        )
        .unwrap();
        Command::new(env!("CARGO_BIN_EXE_impeccable"))
            .current_dir(&self.project)
            .args([
                "component-review",
                "capture",
                "--manifest",
                "review.json",
                "--store",
            ])
            .arg(&self.store)
            .output()
            .unwrap()
    }
    fn state(&self, output: &Output) -> Value {
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let reply: Value = serde_json::from_slice(&output.stdout).unwrap();
        serde_json::from_slice(
            &fs::read(
                self.store
                    .join(reply["session"].as_str().unwrap())
                    .join("current.json"),
            )
            .unwrap(),
        )
        .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
#[test]
fn captures_code_and_png_with_real_pixels_and_rejects_missing_inputs_without_replacing_review() {
    let f = Fixture::new();
    let input = f.manifest();
    let state = f.state(&f.capture(&input));
    assert_eq!(state["capture"]["schema"], "native-component-previews-v1");
    let proof = &state["capture"]["components"][1]["views"]["preview"];
    assert_eq!(proof["semanticControls"], 1);
    assert_eq!(proof["svgElements"], 1);
    assert_eq!(proof["rasterElements"], 1);
    assert!(proof["observedDependencies"]["component.css"].is_string());
    assert_eq!(state["packet"]["components"][1]["preview"]["kind"], "image");
    assert_eq!(
        state["packet"]["components"][1]["preview"]["sourceKind"],
        "page"
    );
    let view = state["packet"]["components"][1]["preview"]["url"]
        .as_str()
        .unwrap();
    let path = view.splitn(4, '/').nth(3).unwrap();
    assert!(path.starts_with("_review_captures/"));
    assert!(state["sources"].get(path).is_none());
    let repeated = f.state(&f.capture(&input));
    assert_eq!(state["packet"]["revision"], repeated["packet"]["revision"]);
    let mut missing = input.clone();
    missing["components"][1]["dependencies"] = json!(["art.png"]);
    let output = f.capture(&missing);
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("component.css"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let id = fs::read_dir(&f.store)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let after: Value = serde_json::from_slice(&fs::read(id.join("current.json")).unwrap()).unwrap();
    assert_eq!(state, after);
    fs::write(f.project.join("component.html"),"<!doctype html><script>document.body.innerHTML='different'</script><button>Fallback</button>").unwrap();
    let script = f.capture(&input);
    assert!(!script.status.success());
    assert!(String::from_utf8_lossy(&script.stderr).contains("static HTML/CSS/SVG"));
}
