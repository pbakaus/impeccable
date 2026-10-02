#[path = "support/capture_service.rs"]
#[allow(dead_code)]
mod capture_service;
use impeccable::entry_capture::{CdpEntryRenderer, static_inventory};
use impeccable_comp::{png_io, raster};
use impeccable_comp_verbs::entry_capture::{EntryRenderer, EntryRequest, EntryStage};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
const ART: &str = "<img src='assets/art.png'>";
const STYLE: &str = "<!doctype html><style>body{margin:0;background:white}img{position:absolute;left:10vw;top:10vw;width:40vw;height:40vw}</style>";
struct Fixture(PathBuf, &'static str);
impl Fixture {
    fn new() -> Self {
        Self::with_comp(".impeccable/comp.png")
    }
    /// The comp at a project path the static inventory would otherwise serve.
    fn visible() -> Self {
        Self::with_comp("comp.png")
    }
    fn with_comp(comp_path: &'static str) -> Self {
        let p = std::env::temp_dir().join(format!(
            "native-entry-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(p.join("assets")).unwrap();
        fs::create_dir_all(p.join(".impeccable")).unwrap();
        fs::create_dir_all(p.join("node_modules")).unwrap();
        fs::write(p.join("index.html"), format!("{STYLE}{ART}")).unwrap();
        let png =
            png_io::encode_png(&raster::create_image(32, 32, [231, 60, 30, 255]), &[]).unwrap();
        fs::write(p.join("assets/art.png"), &png).unwrap();
        // The comp: white with the artwork where its region sits.
        let mut comp = raster::create_image(200, 200, [255, 255, 255, 255]);
        for y in 20..100 {
            for x in 20..100 {
                comp.data[(y * 200 + x) * 4..(y * 200 + x) * 4 + 4].copy_from_slice(&[231, 60, 30, 255]);
            }
        }
        fs::write(p.join(comp_path), png_io::encode_png(&comp, &[]).unwrap()).unwrap();
        let spec = format!(r#"{{"comp":"{comp_path}","compSize":{{"width":200,"height":200}},"regions":[{{"id":"art","medium":"raster","kind":"plate","plate":"assets/art.png","px":{{"x":20,"y":20,"w":80,"h":80}}}}]}}"#);
        fs::write(p.join(".impeccable/spec.json"), spec).unwrap();
        fs::write(p.join(".env"), "private").unwrap();
        fs::write(p.join("node_modules/secret.js"), "private").unwrap();
        fs::write(p.join("source.ts"), "not a browser script").unwrap();
        Self(p, comp_path)
    }
    fn request(&self, stage: EntryStage) -> EntryRequest {
        EntryRequest {
            root: self.0.clone(),
            artifact: "index.html".into(),
            spec: ".impeccable/spec.json".into(),
            reference: self.1.into(),
            stage,
        }
    }
    fn comp(&self) -> Vec<u8> {
        fs::read(self.0.join(self.1)).unwrap()
    }
    /// The honest page plus `extra` markup.
    fn page(&self, extra: &str) {
        fs::write(self.0.join("index.html"), format!("{STYLE}{ART}{extra}")).unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
#[test]
fn native_inventory_excludes_private_and_package_trees() {
    let f = Fixture::new();
    assert_eq!(
        static_inventory(&f.0).unwrap(),
        vec!["assets/art.png", "index.html"]
    );
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(".env", f.0.join("asset.png")).unwrap();
        assert!(static_inventory(&f.0).is_err());
    }
}
#[test]
fn entry_renderer_returns_fresh_hero_and_responsive_pixels_with_live_input_guard() {
    if impeccable_browser::discovery::find_browser(&std::env::vars().collect()).is_err() {
        eprintln!("skip: browser unavailable");
        return;
    }
    let f = Fixture::new();
    let renderer = CdpEntryRenderer;
    for stage in [EntryStage::Hero, EntryStage::Responsive] {
        let captured = renderer.capture_entry(&f.request(stage)).unwrap();
        captured.verify_current().unwrap();
        for frame in &captured.evidence().frames {
            let image = png_io::decode_png(&frame.png).unwrap().image;
            let expected = match frame.name.as_str() {
                "hero" => (200, 200),
                "desktop" => (1440, 1440),
                "mobile" => (390, 844),
                _ => panic!("unexpected frame"),
            };
            assert_eq!((image.width, image.height), expected);
            assert!(
                frame
                    .regions
                    .iter()
                    .all(|r| r.receipt["stableCapture"] == true)
            );
        }
        let before = fs::read(f.0.join("assets/art.png")).unwrap();
        fs::write(f.0.join("assets/art.png"), b"changed").unwrap();
        assert!(captured.verify_current().is_err());
        fs::write(f.0.join("assets/art.png"), before).unwrap();
    }
}

fn browser_available() -> bool {
    if impeccable_browser::discovery::find_browser(&std::env::vars().collect()).is_err() {
        eprintln!("skip: browser unavailable");
        return false;
    }
    true
}

fn refusal(renderer: &dyn EntryRenderer, f: &Fixture, stage: EntryStage) -> String {
    match renderer.capture_entry(&f.request(stage)) {
        Ok(_) => panic!("capture should be refused"),
        // Normalize separators so a Windows path in a message still matches.
        Err(e) => e.replace('\\', "/"),
    }
}

/// The issue #893 cheat: a raster page paints the comp behind its plates, so
/// the gate would grade the reference against itself. The comp is never served.
#[test]
fn raster_page_that_requests_the_comp_is_refused() {
    if !browser_available() {
        return;
    }
    for f in [Fixture::visible(), Fixture::new()] {
        let comp = f.1;
        f.page(&format!("<img src=\"{comp}\" style=\"left:0;top:0;width:100vw;height:100vh;opacity:.5\">"));
        for stage in [EntryStage::Hero, EntryStage::Responsive] {
            let e = refusal(&CdpEntryRenderer, &f, stage);
            assert!(e.contains(&format!("loads the approved comp ({comp})")), "{e}");
        }
        // A stylesheet background asks for it the same way.
        f.page(&format!("<div style=\"position:absolute;inset:0;z-index:-1;background:url('{comp}')\"></div>"));
        let e = refusal(&CdpEntryRenderer, &f, EntryStage::Hero);
        assert!(e.contains("loads the approved comp"), "{e}");
    }
}

#[test]
fn raster_page_that_loads_a_copy_of_the_comp_is_refused() {
    if !browser_available() {
        return;
    }
    let f = Fixture::visible();
    let comp = f.comp();
    // A byte copy under another name, as an image or a CSS background.
    fs::write(f.0.join("assets/backdrop.png"), &comp).unwrap();
    f.page("<img src=\"assets/backdrop.png\" style=\"left:0;top:0;width:100vw;height:100vh;z-index:-1\">");
    let e = refusal(&CdpEntryRenderer, &f, EntryStage::Hero);
    assert!(e.contains("assets/backdrop.png") && e.contains("copy of the approved reference"), "{e}");
    f.page("<div style=\"position:absolute;inset:0;z-index:-1;background:url(assets/backdrop.png)\"></div>");
    let e = refusal(&CdpEntryRenderer, &f, EntryStage::Hero);
    assert!(e.contains("assets/backdrop.png") && e.contains("copy of the approved reference"), "{e}");
    fs::remove_file(f.0.join("assets/backdrop.png")).unwrap();
    // A data URI of it in a stylesheet, wrapped across lines.
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&comp);
    let wrapped = encoded.as_bytes().chunks(76).map(|c| std::str::from_utf8(c).unwrap()).collect::<Vec<_>>().join("\n  ");
    fs::write(f.0.join("assets/site.css"), format!(".backdrop{{position:absolute;inset:0;z-index:-1;background:url(\"data:image/png;base64,\n  {wrapped}\")}}")).unwrap();
    f.page("<link rel=stylesheet href=\"assets/site.css\"><div class=backdrop></div>");
    let e = refusal(&CdpEntryRenderer, &f, EntryStage::Hero);
    assert!(e.contains("assets/site.css") && e.contains("data URI"), "{e}");
    fs::remove_file(f.0.join("assets/site.css")).unwrap();
    // Re-encoded, the bytes differ; painted outside the declared region it
    // still contradicts the spec.
    let image = png_io::decode_png(&comp).unwrap().image;
    let reencoded = png_io::encode_png(&image, &[("Comment".into(), "re-encoded".into())]).unwrap();
    assert_ne!(reencoded, comp);
    fs::write(f.0.join("assets/backdrop.png"), reencoded).unwrap();
    f.page("<img src=\"assets/backdrop.png\" style=\"left:0;top:0;width:100vw;height:100vh;z-index:-1\">");
    let e = refusal(&CdpEntryRenderer, &f, EntryStage::Hero);
    assert!(e.contains("images outside the declared raster regions cover") && e.contains("comp-spec --regions"), "{e}");
}

#[test]
fn a_plate_that_is_the_comp_is_refused_before_capture() {
    let f = Fixture::visible();
    fs::write(f.0.join("assets/art.png"), f.comp()).unwrap();
    let e = refusal(&CdpEntryRenderer, &f, EntryStage::Hero);
    assert!(e.contains("assets/art.png") && e.contains("never the comp"), "{e}");
    let spec = fs::read_to_string(f.0.join(".impeccable/spec.json")).unwrap().replace("assets/art.png", "comp.png");
    fs::write(f.0.join(".impeccable/spec.json"), spec).unwrap();
    let e = refusal(&CdpEntryRenderer, &f, EntryStage::Hero);
    assert!(e.contains("names the approved comp"), "{e}");
}

#[test]
fn honest_raster_page_with_the_comp_in_the_project_still_passes() {
    if !browser_available() {
        return;
    }
    let f = Fixture::visible();
    // An unused backup of the comp and a small logo do not block it.
    fs::create_dir_all(f.0.join("backup")).unwrap();
    fs::write(f.0.join("backup/comp-old.png"), f.comp()).unwrap();
    let logo = png_io::encode_png(&raster::create_image(8, 8, [20, 20, 20, 255]), &[]).unwrap();
    fs::write(f.0.join("assets/logo.png"), logo).unwrap();
    f.page("<img src=\"assets/logo.png\" style=\"left:auto;right:4px;top:4px;width:8px;height:8px\">");
    for stage in [EntryStage::Hero, EntryStage::Responsive] {
        let captured = CdpEntryRenderer.capture_entry(&f.request(stage)).unwrap();
        let report = &captured.evidence().report;
        let served: Vec<_> = report["servedToPage"].as_array().unwrap().iter().filter_map(|f| f["path"].as_str()).collect();
        assert!(served.contains(&"assets/art.png") && !served.contains(&"comp.png"), "{served:?}");
        let comp = report["manifest"]["files"].as_array().unwrap().iter().find(|f| f["path"] == "comp.png").unwrap();
        assert_eq!(comp["served"], false);
        for frame in &captured.evidence().frames {
            let share = report["frameProofs"][&frame.name]["rasterCoverage"]["share"].as_f64().unwrap();
            assert!(share < 0.05, "{}: {share}", frame.name);
            assert!(frame.regions.iter().all(|r| r.receipt["stableCapture"] == true && r.receipt.get("rasterCoverage").is_none()));
        }
        captured.verify_current().unwrap();
        // The comp is bound though never served: changing it invalidates the capture.
        let before = f.comp();
        fs::write(f.0.join("comp.png"), b"changed").unwrap();
        assert!(captured.verify_current().is_err());
        fs::write(f.0.join("comp.png"), before).unwrap();
    }
}

/// Mobile reflows away from the comp, so a declared plate counts nowhere there,
/// whatever its query string and whether it paints as an image or a pseudo-element.
#[test]
fn mobile_excludes_declared_plates_however_they_are_referenced() {
    if !browser_available() {
        return;
    }
    let f = Fixture::visible();
    let big = "<style>@media (max-width:500px){img,.art::before{width:80vw;height:80vw}}</style>";
    for page in [
        format!("{STYLE}{big}<img src='assets/art.png?v=2'>"),
        format!("{STYLE}{big}<div class=art></div><style>.art::before{{content:'';position:absolute;left:10vw;top:10vw;width:40vw;height:40vw;background:url(assets/art.png?v=2) 0 0/100% 100%}}</style>"),
    ] {
        fs::write(f.0.join("index.html"), &page).unwrap();
        let captured = CdpEntryRenderer.capture_entry(&f.request(EntryStage::Responsive)).unwrap();
        let share = captured.evidence().report["frameProofs"]["mobile"]["rasterCoverage"]["share"].as_f64().unwrap();
        assert!(share < 0.01, "{page}: {share}");
    }
    // An undeclared image of the same size still counts on mobile.
    let other = png_io::encode_png(&raster::create_image(32, 32, [20, 90, 200, 255]), &[]).unwrap();
    fs::write(f.0.join("assets/other.png"), other).unwrap();
    f.page(&format!("{big}<style>.m{{display:none}}@media (max-width:500px){{.m{{display:block}}}}</style><img class=m src='assets/other.png' style='left:0;top:60vw;width:80vw;height:80vw'>"));
    let e = refusal(&CdpEntryRenderer, &f, EntryStage::Responsive);
    assert!(e.contains("mobile raster capture refused") && e.contains("outside the declared raster regions"), "{e}");
}

#[test]
fn host_capture_service_refuses_a_raster_page_that_shows_the_comp() {
    if !browser_available() {
        return;
    }
    let f = Fixture::visible();
    let service = capture_service::CaptureService::start(&f.0, None);
    let remote = service.renderer();
    // Honest: crosses the transport with its coverage proofs.
    for stage in [EntryStage::Hero, EntryStage::Responsive] {
        let captured = remote.capture_entry(&f.request(stage)).unwrap();
        assert!(captured.evidence().report["servedToPage"].as_array().unwrap().iter().all(|s| s["path"] != "comp.png"));
        captured.verify_current().unwrap();
    }
    // Showing the comp by path or by copy is refused by the service.
    f.page("<img src=\"comp.png\" style=\"left:0;top:0;width:100vw;height:100vh;opacity:.5\">");
    let e = refusal(&remote, &f, EntryStage::Hero);
    assert!(e.contains("loads the approved comp (comp.png)"), "{e}");
    fs::write(f.0.join("assets/backdrop.png"), f.comp()).unwrap();
    f.page("<img src=\"assets/backdrop.png\" style=\"left:0;top:0;width:100vw;height:100vh;z-index:-1\">");
    let e = refusal(&remote, &f, EntryStage::Responsive);
    assert!(e.contains("assets/backdrop.png") && e.contains("copy of the approved reference"), "{e}");
}

#[test]
fn host_capture_service_keeps_one_receipt_per_raster_region() {
    if impeccable_browser::discovery::find_browser(&std::env::vars().collect()).is_err() {
        eprintln!("skip: browser unavailable");
        return;
    }
    let f = Fixture::new();
    let service = capture_service::CaptureService::start(&f.0, None);
    let remote = service.renderer();
    for stage in [EntryStage::Hero, EntryStage::Responsive] {
        let captured = remote.capture_entry(&f.request(stage)).unwrap();
        let evidence = captured.evidence();
        assert!(evidence.report.get("captureMethod").is_none());
        for frame in &evidence.frames {
            let ids: Vec<_> = frame.regions.iter().map(|r| r.receipt["regionId"].clone()).collect();
            assert_eq!(ids, [serde_json::json!("art")], "{}", frame.name);
        }
        captured.verify_current().unwrap();
    }
}
