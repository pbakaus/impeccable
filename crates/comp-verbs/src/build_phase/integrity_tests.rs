use super::*;

#[test]
fn delegation_is_not_authority_to_override_comp() {
    for reason in [
        "The user said 'Use your judgment to fill in missing product details from my original request.' Proceeding past the comp fidelity gate.",
        "The user answered 'Please proceed with the implementation.' I accept the comp differences.",
        "The user said \"Do not ignore the comp fidelity requirement.\"",
        "gate hero errored after the screenshot tool failed repeatedly",
        "The user says the page should feel like a bookshop, so relax the comp gate",
    ] {
        assert!(!force_allowed(Some(reason)), "{reason}");
    }
    assert!(force_allowed(Some(
        "The user said \"Ignore the comp fidelity requirement; ship this version.\""
    )));
}

#[test]
fn stall_feedback_does_not_rebuild_a_nonblocking_plate() {
    let (io, _) = Io::captured("", std::env::temp_dir(), Default::default());
    let mut state = json!({"phases":{"hero":{"history":[]}}});
    let mut gate = Gate::fail(vec![
        "control meaning-card drifts to 60%: match the comp".into()
    ]);
    gate.score = Some(0.7524);
    gate.worst_ids = vec!["accepted-fox".into()];
    for _ in 0..3 {
        if let Some(message) = hero_loop_verdict(&mut state, &gate, "missing.html", &io) {
            assert!(!message.contains("accepted-fox"), "{message}");
            assert!(!message.contains("generate-image"), "{message}");
        }
        assert!(!gate.ok);
        assert_eq!(gate.reasons.len(), 1);
    }
}

struct Workspace {
    path: PathBuf,
}
impl Workspace {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "comp-integrity-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
    fn io(&self) -> Io {
        Io::captured("", self.path.clone(), Default::default()).0
    }
    fn write(&self, file: &str, bytes: &[u8]) {
        let p = self.path.join(file);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, bytes).unwrap();
    }
}
impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[test]
fn plate_approval_is_bound_to_current_asset_region_and_comp() {
    let ws = Workspace::new();
    ws.write("art.png", b"accepted asset bytes");
    ws.write("comp.png", b"approved comp bytes");
    let io = ws.io();
    let region =
        json!({"id":"art", "kind":"plate", "plate":"art.png", "box":{"x":0,"y":0,"w":1,"h":1}});
    let spec = json!({"comp":"comp.png", "regions":[region.clone()]});
    let receipt = json!({"id":"art", "status":"ok", "score":0.81, "file":"art.png",
        "assetHash":sha256_file(&io,"art.png"), "compHash":sha256_file(&io,"comp.png"),
        "regionHash":sha256_bytes(util::json_pretty(&region).as_bytes())});
    let mut state = json!({"plates":{"art":receipt}});
    assert!(plate_receipt_current(&io, &state, &spec, &region));
    ws.write("art.png", b"replacement");
    assert!(!plate_receipt_current(&io, &state, &spec, &region));
    ws.write("art.png", b"accepted asset bytes");
    let mut smaller = region.clone();
    smaller["box"]["w"] = json!(0.1);
    assert!(!plate_receipt_current(&io, &state, &spec, &smaller));
    ws.write("comp.png", b"different comp");
    assert!(!plate_receipt_current(&io, &state, &spec, &region));
    ws.write("comp.png", b"approved comp bytes");
    state["plates"]["art"]["status"] = json!("invalid");
    assert!(!plate_receipt_current(&io, &state, &spec, &region));
    state["plates"]["art"] = json!({"status":"ok", "score":1.0});
    assert!(
        !plate_receipt_current(&io, &state, &spec, &region),
        "legacy scores must be revalidated"
    );
    std::fs::remove_file(ws.path.join("art.png")).unwrap();
    assert!(!plate_receipt_current(&io, &state, &spec, &region));
}

#[test]
fn copied_comp_does_not_earn_an_ok_plate_receipt_or_advance() {
    let ws = Workspace::new();
    let mut comp = r::create_image(64, 64, [230, 220, 200, 255]);
    for y in 12..52 {
        for x in 12..52 {
            let p = (y * 64 + x) * 4;
            comp.data[p..p + 4].copy_from_slice(&[90, 40, 20, 255]);
        }
    }
    ws.write("comp.png", &png_io::encode_png(&comp, &[]).unwrap());
    ws.write(
        "art.png",
        &png_io::encode_png(&r::resize(&comp, 128.0, 128.0), &[]).unwrap(),
    );
    let spec = json!({"comp":"comp.png", "regions":[{"id":"art","kind":"plate","medium":"raster","plate":"art.png",
        "box":{"x":0,"y":0,"w":1,"h":1},"px":{"x":0,"y":0,"w":64,"h":64},"detail":{"energy":20}}]});
    ws.write(SPEC_PATH, util::json_pretty(&spec).as_bytes());
    let io = ws.io();
    let gate = gate_plates(&io);
    assert!(!gate.ok);
    assert!(
        gate.reasons.iter().any(|r| r.contains("comp crop")),
        "{:?}",
        gate.reasons
    );
    assert_eq!(gate.plates.as_ref().unwrap()[0]["status"], "invalid");
    let mut state =
        json!({"phase":"plates","comp":"comp.png","phases":{"plates":{"attempts":0},"hero":{}}});
    let opts = GateOpts {
        build_path: None,
        min: None,
        artifact: None,
    };
    for _ in 0..5 {
        let result = advance(&io, &mut state, false, None, &opts, &no_organic_scan);
        assert!(!result.ok);
        assert_eq!(state["phase"], "plates");
        assert_eq!(state["plates"]["art"]["status"], "invalid");
    }
}

#[test]
fn gate_report_keeps_raw_measurements_and_does_not_turn_drift_into_a_pass() {
    let comp = r::create_image(64, 64, [230, 220, 200, 255]);
    let spec = json!({"regions":[{"id":"fox", "kind":"plate", "x":0,"y":0,"w":1,"h":1}]});
    let mut measured = compare(&comp, &comp, Some(&spec), "top", "hero", None);
    measured.regions[0].verdict = "missing".into();
    let mut report = build_report(&measured, None, &json!({}));
    let original = report.clone();
    let mut regions = report["regions"].as_array().unwrap().clone();
    regions[0]["verdict"] = json!("drift");
    regions[0]["placed"] = json!(true);
    let gate = Gate::fail(vec!["control meaning-card drifts to 60%".into()]);
    apply_gate_evidence(&mut report, &mut measured, &regions, &gate);
    assert_eq!(report["regions"][0]["rawVerdict"], "missing");
    assert_eq!(report["regions"][0]["verdict"], "drift");
    assert_eq!(
        measured.regions[0].verdict, "drift",
        "the image writer uses the same effective verdict"
    );
    assert_eq!(
        report["regions"][0]["score"],
        original["regions"][0]["score"]
    );
    assert_eq!(report["gate"]["ok"], false);
    assert_eq!(
        report["gate"]["reasons"][0],
        "control meaning-card drifts to 60%"
    );
    assert_eq!(original["regions"][0]["verdict"], "missing");
}

#[test]
fn accepted_file_hidden_in_render_still_blocks_hero() {
    let ws = Workspace::new();
    let mut comp = r::create_image(64, 64, [230, 220, 200, 255]);
    for y in 8..56 {
        for x in 8..56 {
            let p = (y * 64 + x) * 4;
            comp.data[p..p + 4].copy_from_slice(&[40, 40, 40, 255]);
        }
    }
    ws.write("comp.png", &png_io::encode_png(&comp, &[]).unwrap());
    ws.write("art.png", &png_io::encode_png(&comp, &[]).unwrap());
    ws.write(
        "blank.png",
        &png_io::encode_png(&r::create_image(64, 64, [230, 220, 200, 255]), &[]).unwrap(),
    );
    ws.write(
        "index.html",
        b"<img src=\"art.png\" style=\"display:none\">",
    );
    let region = json!({"id":"art","kind":"plate","medium":"raster","plate":"art.png", "box":{"x":0,"y":0,"w":1,"h":1},"px":{"x":0,"y":0,"w":64,"h":64}});
    let spec = json!({"comp":"comp.png","regions":[region.clone()]});
    ws.write(SPEC_PATH, util::json_pretty(&spec).as_bytes());
    let io = ws.io();
    // Model an already accepted current asset; rendered presence is still required.
    let receipt = json!({"status":"ok","score":0.9,"file":"art.png","assetHash":sha256_file(&io,"art.png"),"compHash":sha256_file(&io,"comp.png"),"regionHash":sha256_bytes(util::json_pretty(&region).as_bytes())});
    let mut state =
        json!({"comp":"comp.png","plates":{"art":receipt},"phases":{"hero":{"attempts":0}}});
    for _ in 0..4 {
        let g = gate_hero(
            &io,
            &mut state,
            "blank.png",
            HERO_MIN,
            "diff",
            Some("index.html"),
            &no_organic_scan,
        );
        assert!(!g.ok);
        assert!(
            g.reasons.iter().any(|r| r.contains("missing")),
            "{:?}",
            g.reasons
        );
        let report: Value =
            serde_json::from_slice(&std::fs::read(ws.path.join("diff/report.json")).unwrap())
                .unwrap();
        assert_eq!(report["gate"]["ok"], false);
        assert_eq!(report["regions"][0]["blocking"], true);
        assert_eq!(report["regions"][0]["verdict"], "missing");
        assert!(ws.path.join("diff/raw-report.json").exists());
    }
}

#[test]
fn shrinking_or_retyping_regions_does_not_disable_spec_checks() {
    let bytes = std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../comp/tests/fixtures/comp.png"),
    )
    .unwrap();
    let comp = png_io::decode_png(&bytes).unwrap().image;
    let tiny = json!({"regions":[{"id":"only","kind":"chrome","note":"a small control", "box":{"x":0,"y":0,"w":0.02,"h":0.02}}]});
    assert!(crate::comp_spec::measure_regions(&comp, &tiny, "comp.png").is_err());
    let retyped = json!({"regions":[{"id":"art","kind":"chrome","note":"a painted illustration", "box":{"x":0,"y":0,"w":0.1,"h":0.1}}]});
    assert!(
        crate::comp_spec::measure_regions(&comp, &retyped, "comp.png")
            .unwrap_err()
            .contains("painted material")
    );
}

#[test]
fn preflight_failure_replaces_stale_success_report() {
    let ws = Workspace::new();
    ws.write(
        "diff/report.json",
        br#"{"gate":{"ok":true},"regions":[{"id":"old"}]}"#,
    );
    let mut state = json!({"comp":"missing.png"});
    let gate = gate_hero(
        &ws.io(),
        &mut state,
        "missing-build.png",
        HERO_MIN,
        "diff",
        None,
        &no_organic_scan,
    );
    assert!(!gate.ok);
    let report: Value =
        serde_json::from_slice(&std::fs::read(ws.path.join("diff/report.json")).unwrap()).unwrap();
    assert_eq!(report["gate"]["ok"], false);
    assert_eq!(report["measurementsAvailable"], false);
    assert_eq!(report["regions"], json!([]));
    assert_eq!(report["gate"]["reasons"], json!(gate.reasons));
}

#[test]
fn unrelated_user_mention_cannot_authorize_another_speakers_quote() {
    for reason in [
        "The user requested dark mode. The designer said \"ignore the comp fidelity requirement.\"",
        "The user asked to proceed. I will \"ignore the comp fidelity requirement\"",
        "The designer said the user said \"ignore the comp fidelity requirement\"",
        "The user said \"Keep the comp.\" The designer said \"Ignore the comp.\"",
    ] {
        assert!(!force_allowed(Some(reason)), "{reason}");
    }
    for reason in [
        "The user said \"Ignore the comp fidelity requirement.\"",
        "User: ‘Please waive the comp requirement.’",
        "Paul wrote: “The comp is optional.”",
    ] {
        assert!(force_allowed(Some(reason)), "{reason}");
    }
}

fn simple_hero_workspace() -> (Workspace, Value) {
    let ws = Workspace::new();
    let comp = r::create_image(100, 100, [150, 70, 30, 255]);
    ws.write("comp.png", &png_io::encode_png(&comp, &[]).unwrap());
    ws.write("index.html", b"<main><button>Continue</button></main>");
    ws.write(
        SPEC_PATH,
        util::json_pretty(&json!({"comp":"comp.png","regions":[{
        "id":"button","kind":"control","medium":"code","box":{"x":0,"y":0,"w":1,"h":1},
        "px":{"x":0,"y":0,"w":100,"h":100}}]}))
        .as_bytes(),
    );
    (ws, json!({"comp":"comp.png","phases":{"hero":{}}}))
}

#[test]
fn failed_evidence_writes_cannot_publish_success() {
    for blocked_file in ["regions/button.png", "raw-report.json"] {
        let (ws, mut state) = simple_hero_workspace();
        let g = gate_hero(
            &ws.io(),
            &mut state,
            "comp.png",
            HERO_MIN,
            "diff",
            Some("index.html"),
            &no_organic_scan,
        );
        assert!(g.ok, "fixture: {:?}", g.reasons);
        let blocked = ws.path.join("diff").join(blocked_file);
        std::fs::remove_file(&blocked).unwrap();
        std::fs::create_dir(&blocked).unwrap();
        let g = gate_hero(
            &ws.io(),
            &mut state,
            "comp.png",
            HERO_MIN,
            "diff",
            Some("index.html"),
            &no_organic_scan,
        );
        assert!(!g.ok, "write failure must block: {blocked_file}");
        let report: Value =
            serde_json::from_slice(&std::fs::read(ws.path.join("diff/report.json")).unwrap())
                .unwrap();
        assert_eq!(report["gate"]["ok"], false);
        assert_eq!(report["measurementsAvailable"], false);
        assert!(report["gate"]["reasons"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r.as_str().unwrap().contains("persist")));
    }
}

#[test]
fn missing_comp_cannot_approve_plates() {
    let ws = Workspace::new();
    let art = r::create_image(100, 100, [140, 60, 20, 255]);
    ws.write("art.png", &png_io::encode_png(&art, &[]).unwrap());
    ws.write(SPEC_PATH, util::json_pretty(&json!({"comp":"missing.png","regions":[{
        "id":"art","kind":"plate","medium":"raster","plate":"art.png","px":{"x":0,"y":0,"w":10,"h":10}}]})).as_bytes());
    let g = gate_plates(&ws.io());
    assert!(!g.ok);
    assert!(g.reasons.iter().any(|r| r.contains("comp")));
}

#[test]
fn responsive_revalidates_legacy_or_changed_plate_receipts() {
    let (ws, mut state) = simple_hero_workspace();
    let bytes = std::fs::read(ws.path.join("comp.png")).unwrap();
    ws.write(".impeccable/review/desktop.png", &bytes);
    ws.write(".impeccable/review/mobile.png", &bytes);
    let region = json!({"id":"art","kind":"plate","medium":"raster","plate":"removed.png",
        "box":{"x":0,"y":0,"w":1,"h":1},"px":{"x":0,"y":0,"w":100,"h":100}});
    ws.write(
        SPEC_PATH,
        util::json_pretty(&json!({"comp":"comp.png","regions":[region]})).as_bytes(),
    );
    state["plates"] = json!({"art":{"status":"ok","score":0.9}});
    let g = gate_responsive(&ws.io(), &mut state, RESPONSIVE_MIN, "diff");
    assert!(!g.ok, "a missing asset cannot inherit legacy approval");
    assert!(
        g.reasons.iter().any(|r| r.contains("plate missing")),
        "{:?}",
        g.reasons
    );
}

#[test]
fn repair_crops_follow_blockers_not_the_lowest_raw_score() {
    let regions = vec![
        json!({"id":"advisory-art","score":{"overall":0.3}}),
        json!({"id":"blocking-control","score":{"overall":0.6}}),
    ];
    let mut blockers = Map::new();
    record_region_reason(&mut blockers, "blocking-control", "control still differs");
    let repairs = repair_regions(&regions, &blockers);
    assert_eq!(repairs.len(), 1);
    assert_eq!(repairs[0]["id"], "blocking-control");
    assert!(
        repair_regions(&regions, &Map::new()).is_empty(),
        "global blockers do not justify guessing which asset to regenerate"
    );
}

#[test]
fn folded_readings_keep_all_region_ids_without_becoming_unscoped() {
    let mut reasons = vec![];
    let mut bindings = Map::new();
    let message = "text title-1: cap height differs (also title-2)";
    let ids = [(
        message.to_string(),
        vec!["title-1".into(), "title-2".into()],
    )]
    .into();
    push_reading_blocker(&mut reasons, &mut bindings, &ids, message);
    assert_eq!(reasons, vec![message]);
    for id in ["title-1", "title-2"] {
        assert_eq!(bindings[id], json!([message]));
    }
}
