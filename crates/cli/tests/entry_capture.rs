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
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
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
        fs::write(p.join("index.html"),"<!doctype html><style>body{margin:0;background:white}img{position:absolute;left:10vw;top:10vw;width:40vw;height:40vw}</style><img src='assets/art.png'>").unwrap();
        let png =
            png_io::encode_png(&raster::create_image(32, 32, [231, 60, 30, 255]), &[]).unwrap();
        fs::write(p.join("assets/art.png"), &png).unwrap();
        fs::write(p.join(".impeccable/comp.png"), png).unwrap();
        fs::write(p.join(".impeccable/spec.json"),br#"{"comp":".impeccable/comp.png","compSize":{"width":200,"height":200},"regions":[{"id":"art","medium":"raster","kind":"plate","plate":"assets/art.png","px":{"x":20,"y":20,"w":80,"h":80}}]}"#).unwrap();
        fs::write(p.join(".env"), "private").unwrap();
        fs::write(p.join("node_modules/secret.js"), "private").unwrap();
        fs::write(p.join("source.ts"), "not a browser script").unwrap();
        Self(p)
    }
    fn request(&self, stage: EntryStage) -> EntryRequest {
        EntryRequest {
            root: self.0.clone(),
            artifact: "index.html".into(),
            spec: ".impeccable/spec.json".into(),
            reference: ".impeccable/comp.png".into(),
            stage,
        }
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
