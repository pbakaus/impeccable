//! A first viewport built entirely in code (no raster region) through the real
//! browser: native capture, the hero gate's readings, and an accepted review.
use impeccable::entry_capture::CdpEntryRenderer;
use impeccable::reviewed_entry::ReviewedEntryRenderer;
use impeccable_comp::{png_io, raster};
use impeccable_common::Io;
use impeccable_comp_verbs::asset_capture::capture_sha256;
use impeccable_comp_verbs::build_phase;
use impeccable_comp_verbs::entry_capture::{EntryRenderer, EntryRequest, EntryStage};
use serde_json::{Value, json};
#[path = "support/capture_service.rs"]
#[allow(dead_code)]
mod capture_service;
use capture_service::CaptureService;
use std::{
    fs,
    path::PathBuf,
    collections::HashMap,
    sync::atomic::{AtomicUsize, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

static NEXT: AtomicUsize = AtomicUsize::new(0);
const SPEC: &str = ".impeccable/build/spec.json";
const PAGE: &str = "<!doctype html><style>html,body{margin:0;background:#f4f4f0;font:16px/1.2 sans-serif}\
header{position:absolute;left:16px;top:16px;width:208px;height:24px;background:#181c24}\
h1{position:absolute;left:16px;top:64px;width:208px;height:40px;margin:0;background:#1e5ac8}</style>\
<header></header><h1></h1>";

struct Fixture {
    dir: PathBuf,
    project: PathBuf,
    home: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "text-only-entry-{}-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let project = dir.join("project");
        let home = dir.join("home");
        fs::create_dir_all(project.join(".impeccable/build")).unwrap();
        fs::create_dir_all(project.join(".impeccable/review")).unwrap();
        fs::create_dir_all(&home).unwrap();
        fs::write(project.join("index.html"), PAGE).unwrap();
        let comp = png_io::encode_png(&raster::create_image(240, 160, [244, 244, 240, 255]), &[]).unwrap();
        fs::write(project.join("comp.png"), comp).unwrap();
        let spec = json!({"comp":"comp.png","compSize":{"width":240,"height":160},"regions":[
            {"id":"topbar","kind":"text","medium":"semantic","note":"dark top bar with the product name","type":{},
             "box":{"x":16./240.,"y":0.1,"w":208./240.,"h":0.15},"px":{"x":16,"y":16,"w":208,"h":24}},
            {"id":"headline","kind":"text","medium":"semantic","note":"blue headline block","type":{},
             "box":{"x":16./240.,"y":0.4,"w":208./240.,"h":0.25},"px":{"x":16,"y":64,"w":208,"h":40}}]});
        fs::write(project.join(SPEC), serde_json::to_vec_pretty(&spec).unwrap()).unwrap();
        Self { dir, project, home }
    }
    fn request(&self, stage: EntryStage) -> EntryRequest {
        EntryRequest {
            root: self.project.clone(),
            artifact: "index.html".into(),
            spec: SPEC.into(),
            reference: "comp.png".into(),
            stage,
        }
    }
    /// `build-phase` in process, the way the binary wires it for a standalone
    /// native build. Only the verb's own environment names the temporary home;
    /// the browser launches from the real process environment.
    fn run(&self, args: &[&str]) -> (i32, String) {
        let renderer = ReviewedEntryRenderer::local(&self.project, Some(&self.home));
        self.run_with(args, &renderer)
    }
    fn run_with(&self, args: &[&str], renderer: &dyn EntryRenderer) -> (i32, String) {
        let env = HashMap::from([
            ("HOME".to_string(), self.home.display().to_string()),
            ("USERPROFILE".to_string(), self.home.display().to_string()),
            ("IMPECCABLE_NATIVE_CAPTURE".to_string(), "1".to_string()),
        ]);
        let (mut io, captured) = Io::captured("", self.project.clone(), env);
        let argv: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        let code = build_phase::run_with_renderer(&argv, &mut io, &build_phase::no_organic_scan, Some(renderer));
        drop(io);
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&captured.stdout.borrow()),
            String::from_utf8_lossy(&captured.stderr.borrow())
        );
        (code, text)
    }
    fn record_hero(&self) -> (bool, String, Value) {
        let renderer = ReviewedEntryRenderer::local(&self.project, Some(&self.home));
        self.record_hero_with(&renderer)
    }
    fn record_hero_with(&self, renderer: &dyn EntryRenderer) -> (bool, String, Value) {
        let (code, text) = self.run_with(&["record", "hero", "--min", "0.95"], renderer);
        let report = fs::read(self.project.join(".impeccable/review/diff/hero/report.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or(Value::Null);
        (code == 0, text, report)
    }
    /// The local review store entry for an approved assembled first viewport,
    /// in the shape the component-review capture writes.
    /// Where the local review store keeps this project's first-viewport review.
    fn session(&self) -> PathBuf {
        let project = self.project.canonicalize().unwrap();
        let key = capture_sha256(format!("{}\0hero", project.display()).as_bytes());
        self.home.join(".impeccable/component-reviews").join(key)
    }
    fn approve(&self, screenshot: &[u8]) {
        fs::write(self.project.join(".impeccable/review/hero.json"), br#"{"id":"hero"}"#).unwrap();
        let session = self.session();
        fs::create_dir_all(session.join("blobs")).unwrap();
        let png = capture_sha256(screenshot);
        fs::write(session.join("blobs").join(&png), screenshot).unwrap();
        let sources = json!({
            "index.html": capture_sha256(&fs::read(self.project.join("index.html")).unwrap()),
            "comp.png": capture_sha256(&fs::read(self.project.join("comp.png")).unwrap()),
        });
        let capture = json!({"schema":"native-component-previews-v1","components":[{"views":{"preview":{"kind":"assembled-page","entry":"index.html","viewport":{"width":240,"height":160,"dpr":1},"screenshotSha256":png}}}]});
        let state = json!({"sources":sources,"files":{"preview.png":png},"capture":capture,
            "packet":{"stage":"hero","id":"hero","revision":"rev","comp":{"width":240,"height":160,"url":"/files/rev/comp.png"},
                "components":[{"box":{"x":0,"y":0,"w":1,"h":1},"preview":{"sourceKind":"page","url":"/files/rev/preview.png"}}]},
            "receipt":{"visualDecision":"approved","captureVerified":true,"capture":capture,"submission":{"requestId":"hero","packetRevision":"rev"}}});
        fs::write(session.join("current.json"), serde_json::to_vec(&state).unwrap()).unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn browser_available() -> bool {
    if impeccable_browser::discovery::find_browser(&std::env::vars().collect()).is_err() {
        eprintln!("skip: browser unavailable");
        return false;
    }
    true
}

#[test]
fn text_only_entry_captures_every_frame_without_region_receipts() {
    if !browser_available() {
        return;
    }
    let f = Fixture::new();
    for stage in [EntryStage::Hero, EntryStage::Responsive] {
        let captured = CdpEntryRenderer.capture_entry(&f.request(stage)).unwrap();
        captured.verify_current().unwrap();
        let evidence = captured.evidence();
        assert_eq!(evidence.report["captureMethod"], "assembled-page-viewport");
        let names: Vec<_> = evidence.frames.iter().map(|f| f.name.as_str()).collect();
        match stage {
            EntryStage::Hero => assert_eq!(names, ["hero"]),
            EntryStage::Responsive => assert_eq!(names, ["desktop", "mobile"]),
        }
        for frame in &evidence.frames {
            assert!(frame.regions.is_empty());
            let image = png_io::decode_png(&frame.png).unwrap().image;
            let expected = match frame.name.as_str() {
                "hero" => (240, 160),
                "desktop" => (1440, 960),
                "mobile" => (390, 844),
                _ => unreachable!(),
            };
            assert_eq!((image.width, image.height), expected);
            assert_eq!(evidence.report["frameProofs"][&frame.name]["kind"], "assembled-page");
            if frame.name == "hero" {
                // The headline block is drawn where the page puts it.
                let p = (80 * image.width + 120) * 4;
                assert_eq!(&image.data[p..p + 3], &[0x1e, 0x5a, 0xc8]);
            }
        }
        // Any bound input that changes invalidates the capture.
        fs::write(f.project.join("index.html"), format!("{PAGE}<p>edited</p>")).unwrap();
        assert!(captured.verify_current().is_err());
        fs::write(f.project.join("index.html"), PAGE).unwrap();
    }
}

#[test]
fn hero_gate_reads_a_text_only_first_viewport_and_honours_an_accepted_review() {
    if !browser_available() {
        return;
    }
    let f = Fixture::new();
    // Comp and build both set the top bar and headline as lettering, the comp in
    // horizontal strokes and the build in vertical ones, so the build's text
    // regions read as contradicted while no ink is invented.
    let strokes = |angle: &str| PAGE
        .replace("background:#181c24", &format!("background:repeating-linear-gradient({angle},#181c24 0 2px,#f4f4f0 2px 4px)"))
        .replace("background:#1e5ac8", &format!("background:repeating-linear-gradient({angle},#1e5ac8 0 2px,#f4f4f0 2px 4px)"));
    fs::write(f.project.join("index.html"), strokes("180deg")).unwrap();
    let comp = CdpEntryRenderer.capture_entry(&f.request(EntryStage::Hero)).unwrap().evidence().frames[0].png.clone();
    fs::write(f.project.join("comp.png"), comp).unwrap();
    let lettered = strokes("90deg");
    fs::write(f.project.join("index.html"), &lettered).unwrap();
    let hero = CdpEntryRenderer.capture_entry(&f.request(EntryStage::Hero)).unwrap().evidence().frames[0].png.clone();
    let (code, text) = f.run(&["start", "--comp", "comp.png", "--artifact", "index.html"]);
    assert_eq!(code, 0, "{text}");

    // The gate measures the page and fails on its readings, not on capture.
    let (ok, text, report) = f.record_hero();
    assert!(!ok, "{text}");
    assert!(!text.contains("capture unavailable"), "{text}");
    assert!(report["regions"].as_array().is_some_and(|r| r.iter().any(|r| r["id"] == "headline")), "{report}");
    assert_eq!(report["nativeCapture"]["inputs"]["captureMethod"], "assembled-page-viewport");

    // The same page accepted by the user in the first-viewport review binds by
    // pixels and ends the numeric fight; the material gates still ran.
    f.approve(&hero);
    let (ok, text, report) = f.record_hero();
    assert!(ok, "{text}");
    assert_eq!(report["humanHeroReview"]["viewportAccepted"], true, "{report}");
    assert_eq!(report["nativeCapture"]["inputs"]["humanTextReview"]["schema"], "human-assembled-reference-v1");

    // A visible change after acceptance lapses it again.
    fs::write(f.project.join("index.html"), lettered.replace("top:64px", "top:112px")).unwrap();
    let (ok, text, report) = f.record_hero();
    assert!(!ok, "{text}");
    assert_eq!(report["humanHeroReview"]["viewportAccepted"], false, "{report}");
}

#[test]
fn reviewed_renderer_binds_an_approved_text_only_viewport() {
    if !browser_available() {
        return;
    }
    let f = Fixture::new();
    let hero = CdpEntryRenderer.capture_entry(&f.request(EntryStage::Hero)).unwrap().evidence().frames[0].png.clone();
    f.approve(&hero);
    let renderer = ReviewedEntryRenderer::local(&f.project, Some(&f.home));
    let captured = renderer.capture_entry(&f.request(EntryStage::Hero)).unwrap();
    let approved = captured.approved_reference().expect("approved viewport binds");
    assert_eq!(approved.proof["schema"], "human-assembled-reference-v1");
    // Same capture method, same page: the approved pixels are the current frame's.
    let a = png_io::decode_png(&approved.png).unwrap().image;
    let b = png_io::decode_png(&captured.evidence().frames[0].png).unwrap().image;
    assert_eq!((a.width, a.height, &a.data), (b.width, b.height, &b.data));
    captured.verify_current().unwrap();
}

fn refusal(f: &Fixture) -> String {
    match CdpEntryRenderer.capture_entry(&f.request(EntryStage::Hero)) {
        Ok(_) => panic!("capture should be refused"),
        Err(e) => e,
    }
}

#[test]
fn text_only_page_cannot_show_the_comp_instead_of_drawing_it() {
    if !browser_available() {
        return;
    }
    let f = Fixture::new();
    let comp = fs::read(f.project.join("comp.png")).unwrap();
    // The bound comp is never served: an <img> of it is refused, not matched.
    fs::write(f.project.join("index.html"), "<!doctype html><style>body{margin:0}</style><img src=\"comp.png\" style=\"display:block\">").unwrap();
    let e = refusal(&f);
    assert!(e.contains("loads the approved comp"), "{e}");
    // A byte copy at another path is refused before the browser opens.
    fs::create_dir_all(f.project.join("assets")).unwrap();
    fs::write(f.project.join("assets/copy.png"), &comp).unwrap();
    fs::write(f.project.join("index.html"), "<!doctype html><img src=\"assets/copy.png\">").unwrap();
    let e = refusal(&f);
    assert!(e.contains("assets/copy.png") && e.contains("copy of the approved reference"), "{e}");
    fs::remove_file(f.project.join("assets/copy.png")).unwrap();
    // So is the comp inlined as a data URI.
    use base64::Engine;
    let uri = base64::engine::general_purpose::STANDARD.encode(&comp);
    fs::write(f.project.join("index.html"), format!("<!doctype html><img src=\"data:image/png;base64,{uri}\">")).unwrap();
    let e = refusal(&f);
    assert!(e.contains("index.html") && e.contains("data URI"), "{e}");
}

#[test]
fn text_only_page_cannot_show_the_approved_screenshot() {
    if !browser_available() {
        return;
    }
    let f = Fixture::new();
    let hero = CdpEntryRenderer.capture_entry(&f.request(EntryStage::Hero)).unwrap().evidence().frames[0].png.clone();
    f.approve(&hero);
    fs::create_dir_all(f.project.join("assets")).unwrap();
    fs::write(f.project.join("assets/shot.png"), &hero).unwrap();
    fs::write(f.project.join("index.html"), "<!doctype html><style>body{margin:0}img{display:block}</style><img src=\"assets/shot.png\">").unwrap();
    let renderer = ReviewedEntryRenderer::local(&f.project, Some(&f.home));
    let e = match renderer.capture_entry(&f.request(EntryStage::Hero)) {
        Ok(_) => panic!("a page showing the approved screenshot must be refused"),
        Err(e) => e,
    };
    assert!(e.contains("assets/shot.png") && e.contains("approved reference"), "{e}");
}

#[test]
fn text_only_page_is_served_the_hero_review_dependencies() {
    if !browser_available() {
        return;
    }
    let f = Fixture::new();
    fs::write(f.project.join("style.css"), "h1{outline:0}").unwrap();
    fs::write(f.project.join("extra.js"), "document.body.dataset.extra='1';").unwrap();
    let manifest = |deps: &[&str]| {
        json!({"schemaVersion":2,"stage":"hero","id":"hero","title":"Hero","comp":{"path":"comp.png","width":240,"height":160},
            "components":[{"id":"page","name":"Page","box":{"x":0,"y":0,"w":1,"h":1},"preview":{"kind":"page","path":"index.html"},"dependencies":deps}]})
    };
    fs::write(f.project.join("index.html"), format!("{PAGE}<link rel=stylesheet href=\"style.css\"><script src=\"extra.js\"></script>")).unwrap();
    // Before any review names the entry, the static inventory is served.
    let captured = CdpEntryRenderer.capture_entry(&f.request(EntryStage::Hero)).unwrap();
    assert_eq!(captured.evidence().report["dependencyPolicy"], "static-inventory");
    // The review declared only the stylesheet: the script is undeclared, as in the review.
    fs::write(f.project.join(".impeccable/review/hero.json"), serde_json::to_vec(&manifest(&["style.css"])).unwrap()).unwrap();
    let e = refusal(&f);
    assert!(e.contains("undeclared dependency: /extra.js"), "{e}");
    // Declared, it loads; the manifest is bound to the capture.
    fs::write(f.project.join(".impeccable/review/hero.json"), serde_json::to_vec(&manifest(&["style.css", "extra.js"])).unwrap()).unwrap();
    let captured = CdpEntryRenderer.capture_entry(&f.request(EntryStage::Hero)).unwrap();
    assert_eq!(captured.evidence().report["dependencyPolicy"], "hero-review-manifest");
    let served: Vec<_> = captured.evidence().report["servedToPage"].as_array().unwrap().iter().filter_map(|f| f["path"].as_str()).collect();
    assert_eq!(served, ["extra.js", "index.html", "style.css"]);
    captured.verify_current().unwrap();
    fs::write(f.project.join(".impeccable/review/hero.json"), serde_json::to_vec(&manifest(&["style.css"])).unwrap()).unwrap();
    assert!(captured.verify_current().is_err());
    // A declared dependency outside the static inventory is never served.
    fs::write(f.project.join(".impeccable/review/hero.json"), serde_json::to_vec(&manifest(&[".env"])).unwrap()).unwrap();
    let e = refusal(&f);
    assert!(e.contains(".env") && e.contains("never served"), "{e}");
}

fn capture_with(f: &Fixture, html: &str) -> Result<(), String> {
    fs::write(f.project.join("index.html"), html).unwrap();
    CdpEntryRenderer.capture_entry(&f.request(EntryStage::Hero)).map(|_| ())
}

#[test]
fn unused_backup_of_the_comp_does_not_block_an_honest_page() {
    if !browser_available() {
        return;
    }
    let f = Fixture::new();
    fs::create_dir_all(f.project.join("backup")).unwrap();
    fs::copy(f.project.join("comp.png"), f.project.join("backup/comp-old.png")).unwrap();
    capture_with(&f, PAGE).unwrap();
    // Loading that same backup is refused.
    let e = capture_with(&f, &format!("{PAGE}<img src=\"backup/comp-old.png\" style=\"width:8px\">")).unwrap_err();
    assert!(e.contains("backup/comp-old.png") && e.contains("copy of the approved reference"), "{e}");
}

#[test]
fn wrapped_data_uri_of_the_comp_is_refused() {
    if !browser_available() {
        return;
    }
    let f = Fixture::new();
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(fs::read(f.project.join("comp.png")).unwrap());
    let wrapped = encoded.as_bytes().chunks(76).map(|c| std::str::from_utf8(c).unwrap()).collect::<Vec<_>>().join("\n  ");
    let e = capture_with(&f, &format!("<!doctype html><img style=\"width:8px\" src=\"data:image/png;base64,\n  {wrapped}\">")).unwrap_err();
    assert!(e.contains("index.html") && e.contains("data URI"), "{e}");
}

#[test]
fn large_images_contradict_a_spec_without_raster_regions_but_logos_do_not() {
    if !browser_available() {
        return;
    }
    let f = Fixture::new();
    fs::create_dir_all(f.project.join("assets")).unwrap();
    // The comp re-encoded (same pixels, different bytes) evades every byte check,
    // so the coverage rule is what refuses it.
    let comp = png_io::decode_png(&fs::read(f.project.join("comp.png")).unwrap()).unwrap().image;
    let reencoded = png_io::encode_png(&comp, &[("Comment".into(), "re-encoded".into())]).unwrap();
    assert_ne!(reencoded, fs::read(f.project.join("comp.png")).unwrap());
    fs::write(f.project.join("assets/reencoded.png"), reencoded).unwrap();
    let e = capture_with(&f, "<!doctype html><style>body{margin:0}img{display:block;width:240px;height:160px}</style><img src=\"assets/reencoded.png\">").unwrap_err();
    assert!(e.contains("images cover 100% of the viewport") && e.contains("declares no raster region"), "{e}");
    // A chart exported as an image is a raster region, not code.
    let chart = png_io::encode_png(&raster::create_image(120, 80, [30, 90, 200, 255]), &[]).unwrap();
    fs::write(f.project.join("assets/chart.png"), chart).unwrap();
    let e = capture_with(&f, &format!("{PAGE}<img src=\"assets/chart.png\" style=\"position:absolute;left:100px;top:40px;width:120px;height:80px\">")).unwrap_err();
    assert!(e.contains("img") && e.contains("25%") && e.contains("declare the image as a raster region"), "{e}");
    // As a CSS background it is the same material.
    let e = capture_with(&f, &format!("{PAGE}<div style=\"position:absolute;left:100px;top:40px;width:120px;height:80px;background:url(assets/chart.png)\"></div>")).unwrap_err();
    assert!(e.contains("background"), "{e}");
    // A small logo is fine.
    let logo = png_io::encode_png(&raster::create_image(16, 16, [200, 60, 30, 255]), &[]).unwrap();
    fs::write(f.project.join("assets/logo.png"), logo).unwrap();
    capture_with(&f, &format!("{PAGE}<img src=\"assets/logo.png\" style=\"position:absolute;right:8px;top:8px;width:16px;height:16px\">")).unwrap();
}

#[test]
fn coverage_counts_only_the_image_area_that_is_painted() {
    if !browser_available() {
        return;
    }
    let f = Fixture::new();
    fs::create_dir_all(f.project.join("assets")).unwrap();
    let big = png_io::encode_png(&raster::create_image(240, 160, [30, 90, 200, 255]), &[]).unwrap();
    fs::write(f.project.join("assets/big.png"), big).unwrap();
    let wide = png_io::encode_png(&raster::create_image(240, 8, [30, 90, 200, 255]), &[]).unwrap();
    fs::write(f.project.join("assets/wide.png"), wide).unwrap();
    let icon = png_io::encode_png(&raster::create_image(16, 16, [30, 90, 200, 255]), &[]).unwrap();
    fs::write(f.project.join("assets/icon.png"), icon).unwrap();
    let full = "style=\"display:block;width:240px;height:160px\"";
    // Clipped to a 12px strip by its overflow parent: 7.5% painted.
    capture_with(&f, &format!("{PAGE}<div style=\"position:absolute;left:0;top:140px;width:240px;height:12px;overflow:hidden\"><img src=\"assets/big.png\" {full}></div>")).unwrap();
    // An absolutely positioned image escapes a static overflow wrapper, so it is not clipped by it.
    let e = capture_with(&f, &format!("{PAGE}<div style=\"width:10px;height:10px;overflow:hidden\"><img src=\"assets/big.png\" style=\"position:absolute;left:0;top:0;width:240px;height:160px\"></div>")).unwrap_err();
    assert!(e.contains("images cover 100%"), "{e}");
    // Under a transparent ancestor, or hidden, it paints nothing.
    capture_with(&f, &format!("{PAGE}<div style=\"opacity:0\"><img src=\"assets/big.png\" {full}></div>")).unwrap();
    capture_with(&f, &format!("{PAGE}<img src=\"assets/big.png\" style=\"visibility:hidden;position:absolute;left:0;top:0;width:240px;height:160px\">")).unwrap();
    // Letterboxed: only the picture counts, not its box.
    capture_with(&f, &format!("{PAGE}<img src=\"assets/wide.png\" style=\"position:absolute;left:0;top:0;width:240px;height:160px;object-fit:contain\">")).unwrap();
    capture_with(&f, &format!("{PAGE}<img src=\"assets/icon.png\" style=\"position:absolute;left:0;top:0;width:240px;height:160px;object-fit:scale-down\">")).unwrap();
    // Stretched (the default fill), the same picture covers the frame.
    let e = capture_with(&f, &format!("{PAGE}<img src=\"assets/wide.png\" style=\"position:absolute;left:0;top:0;width:240px;height:160px\">")).unwrap_err();
    assert!(e.contains("images cover 100%"), "{e}");
}

#[test]
fn svg_fragment_masks_and_patterns_are_code_not_raster() {
    if !browser_available() {
        return;
    }
    let f = Fixture::new();
    let svg = "<svg width=\"0\" height=\"0\" style=\"position:absolute\"><defs>\
        <mask id=\"m\" maskContentUnits=\"objectBoundingBox\"><rect width=\"1\" height=\"1\" fill=\"white\"/></mask>\
        <pattern id=\"p\" width=\"8\" height=\"8\" patternUnits=\"userSpaceOnUse\"><rect width=\"4\" height=\"4\" fill=\"#1e5ac8\"/></pattern></defs></svg>";
    let masked = format!("{svg}<div style=\"position:absolute;left:0;top:0;width:240px;height:160px;background:#181c24;mask-image:url(#m);-webkit-mask-image:url(#m)\"></div>");
    capture_with(&f, &format!("{PAGE}{masked}")).unwrap();
    let patterned = format!("{svg}<svg style=\"position:absolute;left:0;top:0\" width=\"240\" height=\"160\"><rect width=\"240\" height=\"160\" fill=\"url(#p)\"/></svg>");
    capture_with(&f, &format!("{PAGE}{patterned}")).unwrap();
    // Gradients, vector filters, clips, symbols and markers reached by fragment
    // are code too, through every reference property at once.
    let vector = "<svg width=\"0\" height=\"0\" style=\"position:absolute\"><defs>\
        <mask id=\"m\" maskContentUnits=\"objectBoundingBox\"><rect width=\"1\" height=\"1\" fill=\"white\"/></mask>\
        <pattern id=\"p\" width=\"8\" height=\"8\" patternUnits=\"userSpaceOnUse\"><rect width=\"4\" height=\"4\" fill=\"url(#g)\"/></pattern>\
        <linearGradient id=\"g\"><stop offset=\"0\" stop-color=\"#1e5ac8\"/><stop offset=\"1\" stop-color=\"#181c24\"/></linearGradient>\
        <filter id=\"f\"><feTurbulence baseFrequency=\"0.05\"/><feGaussianBlur stdDeviation=\"2\"/></filter>\
        <clipPath id=\"c\"><circle cx=\"120\" cy=\"80\" r=\"70\"/></clipPath>\
        <symbol id=\"s\" viewBox=\"0 0 10 10\"><path d=\"M0 0L10 10\" stroke=\"url(#g)\"/></symbol>\
        <marker id=\"k\" markerWidth=\"4\" markerHeight=\"4\"><circle cx=\"2\" cy=\"2\" r=\"2\" fill=\"url(#p)\"/></marker></defs></svg>";
    let drawn = format!("{vector}<svg style=\"position:absolute;left:0;top:0\" width=\"240\" height=\"160\">\
        <rect width=\"240\" height=\"160\" fill=\"url(#p)\" stroke=\"url(#g)\" stroke-width=\"10\" filter=\"url(#f)\" clip-path=\"url(#c)\" mask=\"url(#m)\"/>\
        <use href=\"#s\" width=\"240\" height=\"160\"/><path d=\"M0 0L240 160\" stroke=\"#181c24\" marker-start=\"url(#k)\"/></svg>\
        <div style=\"position:absolute;left:0;top:0;width:240px;height:160px;background:linear-gradient(#1e5ac8,#181c24);filter:url(#f);clip-path:url(#c);mask-image:url(#m);-webkit-mask-image:url(#m)\"></div>");
    capture_with(&f, &format!("{PAGE}{drawn}")).unwrap();
}

#[test]
fn svg_definitions_holding_raster_content_count_through_their_references() {
    if !browser_available() {
        return;
    }
    let f = Fixture::new();
    fs::create_dir_all(f.project.join("assets")).unwrap();
    let big = png_io::encode_png(&raster::create_image(240, 160, [30, 90, 200, 255]), &[]).unwrap();
    fs::write(f.project.join("assets/big.png"), big).unwrap();
    // The <image> inside each definition has no rendered box of its own, so the
    // element that references the definition is what paints the picture.
    let defs = "<svg width=\"0\" height=\"0\" style=\"position:absolute\"><defs>\
        <mask id=\"m\" maskContentUnits=\"objectBoundingBox\"><image href=\"assets/big.png\" width=\"1\" height=\"1\" preserveAspectRatio=\"none\"/></mask>\
        <pattern id=\"p\" width=\"240\" height=\"160\" patternUnits=\"userSpaceOnUse\"><image href=\"assets/big.png\" width=\"240\" height=\"160\"/></pattern>\
        <pattern id=\"nested\" width=\"8\" height=\"8\" patternUnits=\"userSpaceOnUse\"><rect width=\"8\" height=\"8\" fill=\"url(#p)\"/></pattern>\
        <filter id=\"f\" x=\"0\" y=\"0\" width=\"1\" height=\"1\"><feImage href=\"assets/big.png\" preserveAspectRatio=\"none\"/></filter>\
        <symbol id=\"s\" viewBox=\"0 0 240 160\"><image href=\"assets/big.png\" width=\"240\" height=\"160\"/></symbol></defs></svg>";
    let full = "position:absolute;left:0;top:0;width:240px;height:160px";
    let svg = |inner: &str| format!("{PAGE}{defs}<svg style=\"position:absolute;left:0;top:0\" width=\"240\" height=\"160\">{inner}</svg>");
    // A raster mask over a flat block shows the picture through the mask.
    let e = capture_with(&f, &format!("{PAGE}{defs}<div style=\"{full};background:#181c24;mask-image:url(#m);-webkit-mask-image:url(#m)\"></div>")).unwrap_err();
    assert!(e.contains("images cover 100% of the viewport") && e.contains("mask"), "{e}");
    // A pattern holding an image, as fill, through a nested pattern, and as stroke.
    let e = capture_with(&f, &svg("<rect width=\"240\" height=\"160\" fill=\"url(#p)\"/>")).unwrap_err();
    assert!(e.contains("images cover 100% of the viewport") && e.contains("rect fill"), "{e}");
    let e = capture_with(&f, &svg("<rect width=\"240\" height=\"160\" fill=\"url(#nested)\"/>")).unwrap_err();
    assert!(e.contains("rect fill"), "{e}");
    let e = capture_with(&f, &svg("<line x1=\"0\" y1=\"80\" x2=\"240\" y2=\"80\" stroke=\"url(#p)\" stroke-width=\"160\"/>")).unwrap_err();
    assert!(e.contains("line stroke"), "{e}");
    // An feImage filter paints its image over the filter region of an empty box.
    let e = capture_with(&f, &format!("{PAGE}{defs}<div style=\"{full};filter:url(#f)\"></div>")).unwrap_err();
    assert!(e.contains("images cover 100% of the viewport") && e.contains("filter"), "{e}");
    // A symbol holding an image, drawn through use.
    let e = capture_with(&f, &svg("<use href=\"#s\" width=\"240\" height=\"160\"/>")).unwrap_err();
    assert!(e.contains("use href"), "{e}");
    // A use of a vector symbol that passes the raster pattern down as its fill.
    let e = capture_with(&f, &svg("<symbol id=\"square\" viewBox=\"0 0 240 160\"><rect width=\"240\" height=\"160\"/></symbol><use href=\"#square\" width=\"240\" height=\"160\" fill=\"url(#p)\"/>")).unwrap_err();
    assert!(e.contains("use fill"), "{e}");
    // A thin line stretched sideways paints a wide stroke.
    let e = capture_with(&f, &svg("<g transform=\"scale(100 1)\"><line x1=\"1.2\" y1=\"0\" x2=\"1.2\" y2=\"160\" stroke=\"url(#p)\" stroke-width=\"2.4\"/></g>")).unwrap_err();
    assert!(e.contains("line stroke"), "{e}");
    // A filter region in inches cannot be resolved here, so it counts the viewport;
    // a pseudo-element's filter counts its region too.
    let e = capture_with(&f, &format!("{PAGE}{defs}<svg width=\"0\" height=\"0\" style=\"position:absolute\"><filter id=\"inch\" filterUnits=\"userSpaceOnUse\" x=\"-1in\" y=\"-1in\" width=\"5in\" height=\"5in\"><feImage href=\"assets/big.png\"/></filter></svg>\
        <div style=\"position:absolute;left:100px;top:60px;width:4px;height:4px;filter:url(#inch)\"></div>")).unwrap_err();
    assert!(e.contains("images cover 100% of the viewport") && e.contains("div filter"), "{e}");
    let e = capture_with(&f, &format!("{PAGE}{defs}<svg width=\"0\" height=\"0\" style=\"position:absolute\"><filter id=\"wide\" x=\"-20\" y=\"-20\" width=\"40\" height=\"40\"><feImage href=\"assets/big.png\"/></filter></svg>\
        <style>.dot::before{{content:'';position:absolute;left:100px;top:60px;width:10px;height:10px;filter:url(#wide)}}</style><div class=\"dot\"></div>")).unwrap_err();
    assert!(e.contains("::before filter"), "{e}");
    // The same raster pattern on a logo-sized shape stays under the limit.
    capture_with(&f, &svg("<rect width=\"16\" height=\"16\" fill=\"url(#p)\"/>")).unwrap();
}

#[test]
fn host_capture_service_carries_a_text_only_hero_and_binds_its_accepted_review() {
    if !browser_available() {
        return;
    }
    let f = Fixture::new();
    let strokes = |angle: &str| PAGE
        .replace("background:#181c24", &format!("background:repeating-linear-gradient({angle},#181c24 0 2px,#f4f4f0 2px 4px)"))
        .replace("background:#1e5ac8", &format!("background:repeating-linear-gradient({angle},#1e5ac8 0 2px,#f4f4f0 2px 4px)"));
    fs::write(f.project.join("index.html"), strokes("180deg")).unwrap();
    let comp = CdpEntryRenderer.capture_entry(&f.request(EntryStage::Hero)).unwrap().evidence().frames[0].png.clone();
    fs::write(f.project.join("comp.png"), comp).unwrap();
    fs::write(f.project.join("index.html"), strokes("90deg")).unwrap();
    let hero = CdpEntryRenderer.capture_entry(&f.request(EntryStage::Hero)).unwrap().evidence().frames[0].png.clone();
    let (code, text) = f.run(&["start", "--comp", "comp.png", "--artifact", "index.html"]);
    assert_eq!(code, 0, "{text}");

    // The host owns the service and selects the review session before the build.
    let service = CaptureService::start(&f.project, Some(&f.session()));
    let remote = service.renderer();

    // Both stages cross the transport with receipt-free frames.
    for (stage, names) in [(EntryStage::Hero, &["hero"][..]), (EntryStage::Responsive, &["desktop", "mobile"][..])] {
        let captured = remote.capture_entry(&f.request(stage)).unwrap();
        let evidence = captured.evidence();
        assert_eq!(evidence.report["captureMethod"], "assembled-page-viewport");
        assert_eq!(evidence.report["captureService"]["schema"], "native-capture-service-v1");
        assert_eq!(evidence.report["dependencyPolicy"], "static-inventory");
        assert!(evidence.report["servedToPage"].as_array().is_some_and(|s| !s.is_empty()));
        assert_eq!(evidence.frames.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), names);
        for frame in &evidence.frames {
            assert!(frame.regions.is_empty());
            assert!(evidence.report["frameProofs"][&frame.name]["rasterCoverage"]["share"].as_f64().is_some());
        }
        captured.verify_current().unwrap();
    }

    // record hero reaches the gate's readings instead of failing at capture.
    let (ok, text, report) = f.record_hero_with(&remote);
    assert!(!ok, "{text}");
    assert!(!text.contains("capture unavailable") && !text.contains("invalid native capture"), "{text}");
    assert_eq!(report["nativeCapture"]["inputs"]["captureMethod"], "assembled-page-viewport");
    assert_eq!(report["nativeCapture"]["inputs"]["humanTextReview"]["status"], "not-current");

    // The user accepts that first viewport; through the service it binds and passes.
    f.approve(&hero);
    let (ok, text, report) = f.record_hero_with(&remote);
    assert!(ok, "{text}");
    assert_eq!(report["humanHeroReview"]["viewportAccepted"], true, "{report}");
    assert_eq!(report["nativeCapture"]["inputs"]["humanTextReview"]["schema"], "human-assembled-reference-v1");

    // The host audit matches the saved receipt-free evidence against its own capture.
    let audit = service.post("/audit", &json!({"stage":"hero"}));
    assert_eq!(audit["ok"], true, "{audit}");
    let saved: Vec<_> = audit["savedEvidence"].as_array().unwrap().iter().filter_map(|e| e["path"].as_str()).collect();
    for name in ["inputs.json", "human-approved.png", "hero.png", "hero-observations.json"] {
        assert!(saved.contains(&format!(".impeccable/review/native/hero/{name}").as_str()), "{saved:?}");
    }
    assert_eq!(fs::read_to_string(f.project.join(".impeccable/review/native/hero/hero-observations.json")).unwrap().trim(), "[]");
}

#[test]
fn capture_clock_is_pinned_and_an_approved_review_lends_its_instant() {
    if !browser_available() {
        return;
    }
    use impeccable::entry_capture::CaptureClock;
    let f = Fixture::new();
    // The bars' widths follow the hour, as a page that prints "open now" does:
    // one through `new Date()`, one through an argument-less Intl format.
    fs::write(f.project.join("index.html"), format!("{PAGE}<script>const h=new Date().getUTCHours();const p=new Intl.DateTimeFormat('en-US',{{timeZone:'UTC',hour:'numeric',hourCycle:'h23'}}).formatToParts().find(x=>x.type==='hour').value;document.querySelector('h1').style.width=(new Date().constructor===Date&&new Date(0) instanceof Date?16+h*8:4)+'px';document.querySelector('header').style.width=(16+Number(p)*8)+'px';</script>")).unwrap();
    let at = |hour: u64| CaptureClock { epoch_ms: (1_790_000_000_000u64 / 86_400_000 * 86_400_000 + hour * 3_600_000) as f64, from_review: false };
    let frame = |clock: CaptureClock| {
        let captured = CdpEntryRenderer.capture_at(&f.request(EntryStage::Hero), &[], clock).unwrap();
        assert_eq!(captured.evidence().report["clock"]["pinnedEpochMs"].as_f64(), Some(clock.epoch_ms));
        captured.evidence().frames[0].png.clone()
    };
    let (two, two_again, nine) = (frame(at(2)), frame(at(2)), frame(at(9)));
    assert_eq!(two, two_again, "the same instant renders the same page");
    assert_ne!(two, nine, "the pinned instant is the one the page sees");
    // An approval captured at a pinned instant hands that instant to the gate's capture.
    f.approve(&two);
    let path = f.session().join("current.json");
    let mut state: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    for pointer in ["/capture/components/0/views/preview", "/receipt/capture/components/0/views/preview"] {
        state.pointer_mut(pointer).unwrap()["clock"] = json!({"pinnedEpochMs": at(2).epoch_ms as i64});
    }
    fs::write(&path, serde_json::to_vec(&state).unwrap()).unwrap();
    let renderer = ReviewedEntryRenderer::local(&f.project, Some(&f.home));
    let captured = renderer.capture_entry(&f.request(EntryStage::Hero)).unwrap();
    let report = &captured.evidence().report;
    assert_eq!(report["clock"]["source"], "approved-review", "{report}");
    assert_eq!(report["clock"]["pinnedEpochMs"].as_f64(), Some(at(2).epoch_ms));
    assert_eq!(captured.evidence().frames[0].png, two);
}
