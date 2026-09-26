use super::*;

#[test]
fn completion_is_scoped_and_detects_post_finish_edits() {
    let ws = Workspace::new();
    ws.write("comp.png", b"fixture");
    ws.write("index.html", b"<main>First</main>");
    let mut io = ws.io();
    let argv = ["start", "--comp", "comp.png", "--artifact", "index.html", "--session-id", "owner"].map(String::from);
    assert_eq!(run(&argv, &mut io, &no_organic_scan), 0);
    let mut state = load_state(&io).unwrap();
    assert_eq!(state["sessionId"], "owner");
    let status = crate::completion::report(&ws.path, Some(&state), Some("owner"));
    assert_eq!(status["canContinue"], true);
    assert_eq!(crate::completion::report(&ws.path, Some(&state), Some("other"))["canContinue"], false);
    for phase in PHASES { state["phases"][phase]["status"] = json!("closed"); }
    state["phase"] = json!("review");
    state["responsiveInputSha256"] = json!(crate::completion::input_hash(&ws.path));
    save_state(&io, &state);
    let finish = ["finish", "--disposition", "ship"].map(String::from);
    assert_eq!(run(&finish, &mut io, &no_organic_scan), 0);
    let state = load_state(&io).unwrap();
    assert_eq!(crate::completion::report(&ws.path, Some(&state), Some("owner"))["status"], "complete");
    ws.write("styles.css", b"body{color:red}");
    assert_eq!(crate::completion::report(&ws.path, Some(&state), Some("owner"))["status"], "changed-after-finish");
    assert_eq!(run(&finish, &mut io, &no_organic_scan), 2);
    assert_eq!(load_state(&io).unwrap()["phase"], "responsive");
    ws.write("index.html", b"<main>Changed after finish</main>");
    assert_eq!(crate::completion::report(&ws.path, Some(&state), Some("owner"))["status"], "changed-after-finish");
}

#[test]
fn status_next_step_tracks_the_recorded_finish_and_later_entry_edits() {
    let ws = Workspace::new();
    ws.write("index.html", b"<main>Finished</main>");
    let io = ws.io();
    let mut state = json!({"phase":"review", "artifact":"index.html", "phases":{}});
    for phase in PHASES {
        state["phases"][phase] = json!({"status":"closed"});
    }
    state["finish"] = json!({"disposition":"ship", "artifactSha256":crate::completion::artifact_hash(&ws.path, &state)});
    let finished = next_instruction(&io, &state);
    assert!(finished.contains("Finish is recorded for the current entry"), "{finished}");
    assert!(!finished.contains("Spawn"));
    ws.write("index.html", b"<main>Changed after finish</main>");
    let changed = next_instruction(&io, &state);
    assert!(changed.contains("entry changed after finish"), "{changed}");
    assert!(changed.contains("build-phase finish"));
    // Reporting status does not reopen phases or silently sign the new bytes.
    assert_eq!(state["phases"]["review"]["status"], "closed");
    assert_ne!(state["finish"]["artifactSha256"], json!(crate::completion::artifact_hash(&ws.path, &state)));
    std::fs::remove_file(ws.path.join("index.html")).unwrap();
    assert!(next_instruction(&io, &state).contains("cannot be verified"));
}

#[test]
fn native_ship_rechecks_final_page_instead_of_signing_stale_phase_passes() {
    let ws = Workspace::new();
    ws.write("index.html", b"<main>Edited during final review</main>");
    let mut io = ws.io();
    let mut state = json!({"phase":"review", "capturePolicy":"native-html-v1",
        "artifact":"index.html", "comp":"comp.png", "phases":{},
        "finish":{"disposition":"ship", "artifactSha256":"old"}});
    for phase in PHASES {
        state["phases"][phase] = json!({"status":"closed", "attempts":1, "gate":{"ok":true}});
    }
    save_state(&io, &state);
    // Even apparently successful saved gates cannot stand in for a native renderer.
    assert_eq!(run(&["finish", "--disposition", "ship"].map(String::from), &mut io, &no_organic_scan), 2);
    let state = load_state(&io).unwrap();
    assert_eq!(state["phase"], "responsive");
    assert_eq!(state["phases"]["responsive"]["status"], "open");
    assert_eq!(state["phases"]["responsive"]["gate"]["ok"], false);
    assert_eq!(state["finish"]["disposition"], "fix");
    assert_ne!(crate::completion::report(&ws.path, Some(&state), None)["status"], "complete");
}

#[test]
fn ship_refuses_a_missing_required_phase() {
    let ws = Workspace::new();
    let mut io = ws.io();
    let state = json!({"phase":"review","phases":{"review":{"status":"open"}},"finish":null});
    save_state(&io, &state);
    assert_eq!(run(&["finish", "--disposition", "ship"].map(String::from), &mut io, &no_organic_scan), 2);
    assert!(load_state(&io).unwrap()["finish"].is_null());
}

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

#[test]
fn crop_command_reports_invalid_reference_and_preserves_raw_diagnostic() {
    let ws = Workspace::new();
    let comp = r::create_image(16, 16, [70, 80, 90, 255]);
    ws.write("comp.png", &png_io::encode_png(&comp, &[]).unwrap());
    let mut spec = json!({"comp":"comp.png","regions":[
        {"id":"art","kind":"plate","medium":"raster","px":{"x":0,"y":0,"w":16,"h":16}},
        {"id":"nav","kind":"chrome","px":{"x":0,"y":0,"w":16,"h":16}}]});
    ws.write(SPEC_PATH, util::json_pretty(&spec).as_bytes());
    let mut io = ws.io();
    let args = ["--crop", "art", "--out", "crop.png"].map(String::from);
    assert_eq!(crate::comp_spec::run(&args, &mut io), 2);
    assert!(!ws.path.join("crop.png").exists());
    let mut raw_args = args.to_vec();
    raw_args.push("--raw".into());
    assert_eq!(crate::comp_spec::run(&raw_args, &mut io), 0);
    let raw = png_io::decode_png(&std::fs::read(ws.path.join("crop.png")).unwrap()).unwrap();
    assert_eq!(raw.image.data, comp.data);
    assert_eq!(raw.text.get("impeccable:crop-of").unwrap(), "comp.png#art");
    assert!(!raw.text.contains_key("impeccable:reference-audit"));

    spec["regions"][1]["container"] = json!(true);
    ws.write(SPEC_PATH, util::json_pretty(&spec).as_bytes());
    assert_eq!(crate::comp_spec::run(&args, &mut io), 0);
    let prepared = png_io::decode_png(&std::fs::read(ws.path.join("crop.png")).unwrap()).unwrap();
    assert_eq!(prepared.image.data, comp.data);
    let audit: Value = serde_json::from_str(prepared.text.get("impeccable:reference-audit").unwrap()).unwrap();
    assert_eq!(audit["ignoredContainers"], json!(["nav"]));
    assert_eq!(audit["remainingPixels"], 256);
}

#[test]
fn completely_excluded_reference_is_a_spec_problem_not_an_asset_score() {
    let ws = Workspace::new();
    let mut comp = r::create_image(32, 32, [230,220,200,255]);
    r::fill_rect(&mut comp, 8., 8., 16., 16., [40.,60.,80.,255.]);
    ws.write("comp.png", &png_io::encode_png(&comp, &[]).unwrap());
    let asset = r::create_image(64, 64, [230,220,200,255]);
    ws.write("art.png", &png_io::encode_png(&asset, &[]).unwrap());
    let spec = json!({"comp":"comp.png","regions":[
        {"id":"art","kind":"plate","medium":"raster","plate":"art.png",
         "px":{"x":0,"y":0,"w":32,"h":32},"palette":[{"hex":"#e6dcc8"}]},
        {"id":"oversized-nav","kind":"chrome","medium":"code","px":{"x":0,"y":0,"w":32,"h":32}}
    ]});
    ws.write(SPEC_PATH, util::json_pretty(&spec).as_bytes());
    let gate = gate_plates(&ws.io());
    assert!(!gate.ok);
    assert!(gate.reasons.iter().any(|s|s.contains("reference") && s.contains("oversized-nav")), "{:?}", gate.reasons);
    assert!(!gate.reasons.iter().any(|s|s.contains("regenerate")), "{:?}", gate.reasons);
    let plate = &gate.plates.as_ref().unwrap()[0];
    assert!(plate["score"].is_null());
    assert_eq!(plate["reference"]["excludedPixels"], 1024);
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
        "regionHash":sha256_bytes(util::json_pretty(&region).as_bytes()),
        "referenceHash":plate_reference_hash(&spec)});
    let mut state = json!({"plates":{"art":receipt}});
    assert!(plate_receipt_current(&io, &state, &spec, &region));
    let mut changed_spec = spec.clone();
    changed_spec["regions"].as_array_mut().unwrap().push(json!({"id":"new-overlay","kind":"control","px":{"x":0,"y":0,"w":5,"h":5}}));
    assert!(!plate_receipt_current(&io, &state, &changed_spec, &region), "neighbouring exclusions invalidate approval");
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
        let result = advance(&io, &mut state, false, None, &opts, &no_organic_scan, None);
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
    let receipt = json!({"status":"ok","score":0.9,"file":"art.png","assetHash":sha256_file(&io,"art.png"),"compHash":sha256_file(&io,"comp.png"),"regionHash":sha256_bytes(util::json_pretty(&region).as_bytes()),"referenceHash":plate_reference_hash(&spec)});
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
            &no_organic_scan, None);
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
        &no_organic_scan, None);
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
fn responsive_rejects_a_contradicted_control_even_above_the_overall_bar() {
    let ws = Workspace::new();
    let mut comp = r::create_image(200, 120, [230, 220, 200, 255]);
    r::fill_rect(&mut comp, 120., 84., 60., 24., [20., 50., 80., 255.]);
    for y in (86..106).step_by(3) {
        r::fill_rect(&mut comp, 124., y as f64, 52., 1., [240., 240., 240., 255.]);
    }
    let mut changed = comp.clone();
    r::fill_rect(&mut changed, 120., 84., 60., 24., [190., 30., 100., 255.]);
    for x in (122..178).step_by(3) {
        r::fill_rect(&mut changed, x as f64, 86., 1., 20., [240., 240., 240., 255.]);
    }
    ws.write("comp.png", &png_io::encode_png(&comp, &[]).unwrap());
    ws.write(SPEC_PATH, util::json_pretty(&json!({"comp":"comp.png","regions":[{
        "id":"inquiry","kind":"control","medium":"semantic",
        "box":{"x":0.6,"y":0.7,"w":0.3,"h":0.2},
        "px":{"x":120,"y":84,"w":60,"h":24}}]})).as_bytes());
    let mut state = json!({"comp":"comp.png","phases":{}});
    for (image, accepted) in [(&comp, true), (&changed, false)] {
        let png = png_io::encode_png(image, &[]).unwrap();
        ws.write(".impeccable/review/desktop.png", &png);
        ws.write(".impeccable/review/mobile.png", &png);
        let gate = gate_responsive(&ws.io(), &mut state, RESPONSIVE_MIN, "diff", None);
        let report: Value = serde_json::from_slice(&std::fs::read(ws.path.join("diff/report.json")).unwrap()).unwrap();
        assert!(report["overall"].as_f64().unwrap() >= RESPONSIVE_MIN);
        if !accepted {
            assert_eq!(report["regions"][0]["rawVerdict"], "contradicted");
        }
        assert_eq!(gate.ok, accepted, "{report}");
        assert_eq!(report["regions"][0]["blocking"], !accepted);
        if !accepted {
            assert!(gate.reasons.iter().any(|reason| reason.contains("inquiry (control) is contradicted")));
        }
    }
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
            &no_organic_scan, None);
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
            &no_organic_scan, None);
        assert!(!g.ok, "write failure must block: {blocked_file}");
        assert_no_current_measurements(&ws);
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
    let g = gate_responsive(&ws.io(), &mut state, RESPONSIVE_MIN, "diff", None);
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

#[test]
fn responsive_failures_replace_previous_success_evidence() {
    for failure in ["missing-comp", "crop-write"] {
        let (ws, mut state) = simple_hero_workspace();
        let image = std::fs::read(ws.path.join("comp.png")).unwrap();
        ws.write(".impeccable/review/desktop.png", &image);
        ws.write(".impeccable/review/mobile.png", &image);
        let good = gate_responsive(&ws.io(), &mut state, RESPONSIVE_MIN, "diff", None);
        assert!(good.ok, "{:?}", good.reasons);
        let report: Value =
            serde_json::from_slice(&std::fs::read(ws.path.join("diff/report.json")).unwrap())
                .unwrap();
        assert_eq!(report["gate"]["ok"], true);
        assert_eq!(report["interpretation"], "responsive-gate");
        assert_eq!(report["regions"][0]["blocking"], false);
        if failure == "missing-comp" {
            std::fs::remove_file(ws.path.join("comp.png")).unwrap();
        } else {
            std::fs::remove_file(ws.path.join("diff/regions/button.png")).unwrap();
            std::fs::create_dir(ws.path.join("diff/regions/button.png")).unwrap();
        }
        let bad = gate_responsive(&ws.io(), &mut state, RESPONSIVE_MIN, "diff", None);
        assert!(!bad.ok);
        assert_no_current_measurements(&ws);
        let report: Value =
            serde_json::from_slice(&std::fs::read(ws.path.join("diff/report.json")).unwrap())
                .unwrap();
        assert_eq!(report["gate"]["ok"], false, "{failure}");
        assert_eq!(report["measurementsAvailable"], false);
        assert_eq!(report["interpretation"], "responsive-gate");
        assert_eq!(report["gate"]["reasons"], json!(bad.reasons));
    }
}

fn assert_no_current_measurements(ws: &Workspace) {
    for file in ["raw-report.json", "side-by-side.png", "heatmap.png", "regions/button.png", "regions/retired.png", "regions/nested/retired.png"] {
        assert!(!ws.path.join("diff").join(file).is_file(), "stale evidence: {file}");
    }
}

#[test]
fn failed_preflight_clears_complete_evidence_for_both_gates() {
    for responsive in [false, true] {
        let (ws, mut state) = simple_hero_workspace();
        let image = std::fs::read(ws.path.join("comp.png")).unwrap();
        ws.write(".impeccable/review/desktop.png", &image);
        ws.write(".impeccable/review/mobile.png", &image);
        let run = |state: &mut Value| if responsive {
            gate_responsive(&ws.io(), state, RESPONSIVE_MIN, "diff", None)
        } else {
            gate_hero(&ws.io(), state, "comp.png", HERO_MIN, "diff", Some("index.html"), &no_organic_scan, None)
        };
        assert!(run(&mut state).ok);
        ws.write("diff/regions/retired.png", &image);
        ws.write("diff/regions/nested/retired.png", &image);
        ws.write("diff/notes.txt", b"keep unrelated files");
        std::fs::remove_file(ws.path.join("comp.png")).unwrap();
        assert!(!run(&mut state).ok);
        assert_no_current_measurements(&ws);
        assert_eq!(std::fs::read(ws.path.join("diff/notes.txt")).unwrap(), b"keep unrelated files");
    }
}

#[test]
fn successful_repeat_removes_retired_region_crops() {
    let (ws, mut state) = simple_hero_workspace();
    ws.write("diff/regions/retired.png", b"old crop");
    let gate = gate_hero(&ws.io(), &mut state, "comp.png", HERO_MIN, "diff", Some("index.html"), &no_organic_scan, None);
    assert!(gate.ok, "{:?}", gate.reasons);
    assert!(!ws.path.join("diff/regions/retired.png").exists());
    assert!(ws.path.join("diff/regions/button.png").is_file());
}

#[cfg(unix)]
#[test]
fn artifact_cleanup_does_not_follow_region_directory_symlinks() {
    let (ws, mut state) = simple_hero_workspace();
    ws.write("elsewhere/keep.png", b"unrelated image");
    std::fs::create_dir_all(ws.path.join("diff")).unwrap();
    std::os::unix::fs::symlink(ws.path.join("elsewhere"), ws.path.join("diff/regions")).unwrap();
    let gate = gate_hero(&ws.io(), &mut state, "comp.png", HERO_MIN, "diff", Some("index.html"), &no_organic_scan, None);
    assert!(gate.ok, "{:?}", gate.reasons);
    assert_eq!(std::fs::read(ws.path.join("elsewhere/keep.png")).unwrap(), b"unrelated image");
    assert!(!ws.path.join("elsewhere/button.png").exists());
    assert!(ws.path.join("diff/regions/button.png").is_file());
}

#[cfg(unix)]
#[test]
fn artifact_cleanup_failure_blocks_the_gate() {
    use std::os::unix::fs::PermissionsExt;
    let (ws, mut state) = simple_hero_workspace();
    ws.write("diff/regions/retired.png", b"stale crop");
    let dir = ws.path.join("diff/regions");
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).unwrap();
    let gate = gate_hero(&ws.io(), &mut state, "comp.png", HERO_MIN, "diff", Some("index.html"), &no_organic_scan, None);
    if dir.exists() { std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap(); }
    assert!(!gate.ok);
    assert!(gate.reasons.iter().any(|r| r.contains("cannot clear comparison artifacts")), "{:?}", gate.reasons);
    let report: Value = serde_json::from_slice(&std::fs::read(ws.path.join("diff/report.json")).unwrap()).unwrap();
    assert_eq!(report["measurementsAvailable"], false);
    assert_eq!(report["gate"]["ok"], false);
    assert_no_current_measurements(&ws);
    let quarantine = ws.path.join(report["artifactCleanup"]["quarantine"]["artifacts"]["regions"].as_str().expect("cleanup failure must identify quarantined evidence"));
    assert!(quarantine.join("retired.png").is_file());
    assert_eq!(report["artifactCleanup"]["quarantine"]["errors"], json!([]));
    std::fs::set_permissions(quarantine, std::fs::Permissions::from_mode(0o755)).unwrap();
}


#[test]
fn transformed_comp_crop_cannot_become_a_plate_by_drifting_below_similarity_threshold() {
    let ws = Workspace::new();
    let mut reference = r::create_image(32, 32, [240, 230, 210, 255]);
    r::fill_rect(&mut reference, 2., 3., 10., 20., [20., 70., 140., 255.]);
    ws.write("comp.png", &png_io::encode_png(&reference, &[]).unwrap());
    // Deliberately different pixels: the crop marker is evidence independently
    // of a perceptual-similarity threshold or a new embedded generation prompt.
    let transformed = r::create_image(64, 64, [30, 100, 60, 255]);
    ws.write("plate.png", &png_io::encode_png(&transformed, &[
        ("impeccable:crop-of".into(), "comp.png#photo".into()),
        ("impeccable:prompt".into(), "A freshly generated photograph".into()),
    ]).unwrap());
    ws.write(SPEC_PATH, util::json_pretty(&json!({"comp":"comp.png","regions":[
        {"id":"photo","kind":"plate","medium":"raster","plate":"plate.png",
         "px":{"x":0,"y":0,"w":32,"h":32}}
    ]})).as_bytes());
    let gate = gate_plates(&ws.io());
    assert!(!gate.ok);
    assert!(gate.reasons.iter().any(|r|r.contains("records a comp crop")), "{:?}", gate.reasons);
}

#[test]
fn caller_supplied_fake_metadata_cannot_bypass_the_crop_check() {
    let ws = Workspace::new();
    let mut reference = r::create_image(32, 32, [240, 230, 210, 255]);
    r::fill_rect(&mut reference, 2., 3., 10., 20., [20., 70., 140., 255.]);
    ws.write("comp.png", &png_io::encode_png(&reference, &[]).unwrap());
    ws.write("plate.png", &png_io::encode_png(&reference, &[
        ("impeccable:fake".into(), "1".into()),
        ("impeccable:prompt".into(), "A generated production plate".into()),
    ]).unwrap());
    ws.write(SPEC_PATH, util::json_pretty(&json!({"comp":"comp.png","regions":[
        {"id":"photo","kind":"plate","medium":"raster","plate":"plate.png",
         "px":{"x":0,"y":0,"w":32,"h":32}}
    ]})).as_bytes());
    let gate = gate_plates(&ws.io());
    assert!(!gate.ok);
    assert!(gate.reasons.iter().any(|reason| reason.contains("is the comp crop")), "{:?}", gate.reasons);
}

#[test]
fn stripped_blurred_shifted_comp_pixels_cannot_pass_with_a_generation_prompt() {
    let ws=Workspace::new();
    ws.write("comp.png", include_bytes!("../../../comp/tests/fixtures/comp-copy/reference.png"));
    let changed=png_io::decode_png(include_bytes!("../../../comp/tests/fixtures/comp-copy/transformed.png")).unwrap().image;
    ws.write("plate.png", &png_io::encode_png(&changed,&[("impeccable:prompt".into(),"High resolution photography".into())]).unwrap());
    ws.write(SPEC_PATH,util::json_pretty(&json!({"comp":"comp.png","regions":[
        {"id":"photo","kind":"plate","medium":"raster","plate":"plate.png","px":{"x":0,"y":0,"w":128,"h":96}}
    ]})).as_bytes());
    let gate=gate_plates(&ws.io());
    assert!(!gate.ok);
    assert!(gate.reasons.iter().any(|r|r.contains("registered RGB pixels match")),"{:?}",gate.reasons);
    assert_eq!(gate.plates.unwrap()[0]["status"],"invalid");
    // Texture patches are explicitly allowed by new-work.md. Fidelity checks
    // still apply, but this source-pixel prohibition must not apply to them.
    ws.write(SPEC_PATH,util::json_pretty(&json!({"comp":"comp.png","regions":[
        {"id":"material","kind":"texture","medium":"raster","plate":"plate.png","px":{"x":0,"y":0,"w":128,"h":96}}
    ]})).as_bytes());
    let texture_gate = gate_plates(&ws.io());
    assert!(!texture_gate.reasons.iter().any(|r|r.contains("is the comp crop")),"{:?}",texture_gate.reasons);
}

#[test]
fn rejected_region_revision_cannot_advance_using_an_older_spec() {
    let ws = Workspace::new();
    let image = r::create_image(64,64,[80,100,120,255]);
    ws.write("comp.png", &png_io::encode_png(&image, &[]).unwrap());
    let input = json!({"regions":[{"id":"photo","kind":"image","bleed":true,
        "pixelBox":{"x":0,"y":0,"w":64,"h":64},"note":"Full frame photograph"}]});
    ws.write("regions.json",input.to_string().as_bytes());
    let mut io=ws.io();
    let args=["--comp","comp.png","--regions","regions.json"].map(String::from);
    assert_eq!(crate::comp_spec::run(&args,&mut io),0);
    let state=json!({"comp":"comp.png"});
    assert!(gate_spec(&io,&state).ok);
    let measured=std::fs::read(ws.path.join(SPEC_PATH)).unwrap();
    ws.write("regions.json",b"{bad json");
    assert_eq!(crate::comp_spec::run(&args,&mut io),1);
    assert_eq!(std::fs::read(ws.path.join(SPEC_PATH)).unwrap(),measured);
    let gate=gate_spec(&io,&state);
    assert!(!gate.ok,"a rejected edit must not silently reuse the last measured map");
    assert!(gate.reasons.join(" ").contains("regions.json"));
    assert!(gate_plates(&io).reasons.join(" ").contains("regions.json"));
    ws.write("regions.json",input.to_string().as_bytes());
    assert!(gate_spec(&io,&state).ok);
    std::fs::remove_file(ws.path.join("regions.json")).unwrap();
    assert!(!gate_spec(&io,&state).ok);
}

#[test]
fn automatic_bands_are_a_draft_not_a_build_spec() {
    let ws=Workspace::new();
    let mut image=r::create_image(128,128,[255,255,255,255]);
    for y in (5..100).step_by(6) { r::fill_rect(&mut image,10.,y as f64,100.,3.,[0.,0.,0.,255.]); }
    ws.write("comp.png",&png_io::encode_png(&image,&[]).unwrap());
    let mut io=ws.io();
    let args=["--comp","comp.png","--auto"].map(String::from);
    assert_eq!(crate::comp_spec::run(&args,&mut io),0,"auto must produce a usable draft even on a busy comp");
    let draft=ws.path.join(".impeccable/build/regions.draft.json");
    assert!(draft.exists());
    assert_eq!(crate::comp_spec::run(&["--comp","comp.png","--regions",".impeccable/build/regions.draft.json"].map(String::from),&mut io),1);
    assert!(!ws.path.join(SPEC_PATH).exists());
    assert!(!gate_spec(&io,&json!({"comp":"comp.png"})).ok);
    ws.write(SPEC_PATH,&std::fs::read(&draft).unwrap());
    assert!(!gate_spec(&io,&json!({"comp":"comp.png"})).ok,"copying a draft to the spec path cannot validate it");
    ws.write(SPEC_PATH,b"previous accepted spec");
    assert_eq!(crate::comp_spec::run(&args,&mut io),1,"do not overwrite an edited draft");
    assert_eq!(std::fs::read(ws.path.join(SPEC_PATH)).unwrap(),b"previous accepted spec");
}

#[test]
fn degenerate_or_out_of_frame_boxes_are_refused() {
    let comp = r::create_image(100, 100, [255, 255, 255, 255]);
    for b in [json!({"x":0.5,"y":0.5,"w":0,"h":0}), json!({"x":0.5,"y":0.5,"w":-0.2,"h":0.1}),
        json!({"x":0.95,"y":0,"w":0.2,"h":0.1}), json!({"x":-0.1,"y":0,"w":0.2,"h":0.1}),
        json!({"x":0.5,"y":0.5,"w":0.004,"h":0.1}), json!({"x":0.5,"y":0.5,"w":0.1})] {
        let input = json!({"allowUncovered":true,"regions":[{"id":"nav","kind":"chrome","note":"top navigation bar","box":b}]});
        assert!(crate::comp_spec::measure_regions(&comp, &input, "comp.png").unwrap_err().contains("box"), "{b}");
    }
    let ok = json!({"allowUncovered":true,"regions":[{"id":"nav","kind":"chrome","note":"top navigation bar","box":{"x":0,"y":0,"w":1,"h":0.1}}]});
    assert!(crate::comp_spec::measure_regions(&comp, &ok, "comp.png").is_ok());
    let ws = Workspace::new();
    ws.write(SPEC_PATH, util::json_pretty(&json!({"comp":"comp.png","regions":[{"id":"nav","kind":"chrome",
        "note":"top navigation bar","box":{"x":0.5,"y":0.5,"w":0,"h":0},"px":{"x":50,"y":50,"w":0,"h":0}}]})).as_bytes());
    assert!(!gate_spec(&ws.io(), &json!({"comp":"comp.png"})).ok, "an older degenerate spec cannot close the phase");
}

#[test]
fn undrafted_bands_and_unknown_kinds_are_not_an_element_map() {
    let ws = Workspace::new();
    let mut image = r::create_image(128, 128, [255, 255, 255, 255]);
    for y in (5..100).step_by(6) { r::fill_rect(&mut image, 10., y as f64, 100., 3., [0., 0., 0., 255.]); }
    ws.write("comp.png", &png_io::encode_png(&image, &[]).unwrap());
    let mut io = ws.io();
    assert_eq!(crate::comp_spec::run(&["--comp", "comp.png", "--auto"].map(String::from), &mut io), 0);
    let mut draft: Value = serde_json::from_slice(&std::fs::read(ws.path.join(".impeccable/build/regions.draft.json")).unwrap()).unwrap();
    draft.as_object_mut().unwrap().remove("draft");
    draft["allowUncovered"] = json!(true);
    ws.write("regions.json", draft.to_string().as_bytes());
    let args = ["--comp", "comp.png", "--regions", "regions.json"].map(String::from);
    assert_eq!(crate::comp_spec::run(&args, &mut io), 1, "deleting the draft flag does not name the elements");
    assert!(!gate_spec(&io, &json!({"comp":"comp.png"})).ok);
    // A spec measured before bands needed notes still cannot close the phase.
    let mut legacy = draft.clone();
    legacy["comp"] = json!("comp.png");
    ws.write(SPEC_PATH, util::json_pretty(&legacy).as_bytes());
    assert!(!gate_spec(&io, &json!({"comp":"comp.png"})).ok);
    for kind in [json!("chrom"), Value::Null] {
        let input = json!({"allowUncovered":true,"regions":[{"id":"nav","kind":kind,"note":"top navigation bar","box":{"x":0,"y":0,"w":1,"h":0.1}}]});
        assert!(crate::comp_spec::measure_regions(&image, &input, "comp.png").unwrap_err().contains("kind"));
    }
    // Refined map: named elements plus a noted band still measures and passes.
    let refined = json!({"allowUncovered":true,"regions":[
        {"id":"list","kind":"chrome","note":"striped rule list of the index","container":true,"box":{"x":0,"y":0,"w":1,"h":0.8}},
        {"id":"footer","kind":"band","note":"empty footer ground band","box":{"x":0,"y":0.8,"w":1,"h":0.2}}]});
    ws.write("regions.json", refined.to_string().as_bytes());
    assert_eq!(crate::comp_spec::run(&args, &mut io), 0);
    assert!(gate_spec(&io, &json!({"comp":"comp.png"})).ok);
    let only_bands = json!({"allowUncovered":true,"regions":[{"id":"all","kind":"band","note":"the whole page as one band","box":{"x":0,"y":0,"w":1,"h":1}}]});
    ws.write("regions.json", only_bands.to_string().as_bytes());
    assert_eq!(crate::comp_spec::run(&args, &mut io), 0);
    assert!(!gate_spec(&io, &json!({"comp":"comp.png"})).ok, "bands alone are not an element map");
}

#[test]
fn quoted_plate_force_holds_for_the_same_bytes_but_not_a_changed_plate() {
    let ws = Workspace::new();
    let mut comp = r::create_image(64, 64, [230, 220, 200, 255]);
    r::fill_rect(&mut comp, 12., 12., 40., 40., [90., 40., 20., 255.]);
    ws.write("comp.png", &png_io::encode_png(&comp, &[]).unwrap());
    ws.write("art.png", &png_io::encode_png(&r::resize(&comp, 128.0, 128.0), &[]).unwrap());
    let spec = json!({"comp":"comp.png", "regions":[{"id":"art","kind":"plate","medium":"raster","plate":"art.png",
        "box":{"x":0,"y":0,"w":1,"h":1},"px":{"x":0,"y":0,"w":64,"h":64},"detail":{"energy":20}}]});
    ws.write(SPEC_PATH, util::json_pretty(&spec).as_bytes());
    let io = ws.io();
    let mut state = json!({"phase":"plates","comp":"comp.png","phases":{"plates":{"attempts":0},"hero":{}}});
    let opts = GateOpts { build_path: None, min: None, artifact: None };
    let reason = "The user said \"Ignore the comp fidelity requirement; ship this version.\"";
    let result = advance(&io, &mut state, true, Some(reason), &opts, &no_organic_scan, None);
    assert!(result.ok && result.forced);
    assert_eq!(state["phase"], "hero");
    assert!(revalidate_plates(&io, &mut state, Some(&spec)).is_none(), "the recorded force covers these plate bytes");
    assert!(state["plates"]["art"]["forced"].is_object());
    ws.write("art.png", &png_io::encode_png(&r::resize(&comp, 130.0, 130.0), &[]).unwrap());
    let failure = revalidate_plates(&io, &mut state, Some(&spec)).expect("a changed plate is revalidated");
    assert!(failure.reasons.iter().any(|r| r.contains("comp crop")), "{:?}", failure.reasons);
    assert!(state["plates"]["art"]["forced"].is_null());
}

#[test]
fn page_work_waits_for_the_plan_and_asset_review_of_the_current_spec() {
    let ws = Workspace::new();
    let home = ws.path.join("home");
    std::fs::create_dir_all(&home).unwrap();
    let project = ws.path.join("project");
    let write = |file: &str, bytes: &[u8]| { let p = project.join(file); std::fs::create_dir_all(p.parent().unwrap()).unwrap(); std::fs::write(p, bytes).unwrap(); };
    write("comp.png", b"comp");
    write("art.png", b"plate");
    write(SPEC_PATH, br#"{"comp":"comp.png","compSize":{"width":64,"height":64},"regions":[{"id":"art","kind":"plate","medium":"raster","plate":"art.png","note":"Figure","box":{"x":0,"y":0,"w":1,"h":1}}]}"#);
    let io_with = |extra: &[(&str, &str)]| {
        let mut env: std::collections::HashMap<String, String> = [("HOME".to_string(), home.to_string_lossy().into_owned())].into();
        env.extend(extra.iter().map(|(k, v)| (k.to_string(), v.to_string())));
        Io::captured("", project.clone(), env)
    };
    let (io, _) = io_with(&[]);
    let why = plan_review_refusal(&io).expect("no review exists yet");
    assert!(why.contains("not accepted") && why.contains("impeccable component-review plan"), "{why}");
    // advance from plates carries the refusal with the plate readings.
    let mut state = json!({"phase":"plates","comp":"comp.png","phases":{"plates":{"attempts":0},"hero":{}}});
    let opts = GateOpts { build_path: None, min: None, artifact: None };
    let result = advance(&io, &mut state, false, None, &opts, &no_organic_scan, None);
    assert!(!result.ok && result.reasons.iter().any(|r| r.contains("plan and asset review")), "{:?}", result.reasons);
    assert_eq!(state["phase"], "plates");
    // record hero refuses before measuring anything.
    write(".impeccable/build/state.json", br#"{"phase":"hero","startedAt":"s","phases":{"hero":{}}}"#);
    let (mut io, captured) = io_with(&[]);
    assert_eq!(run(&["record", "hero"].map(String::from), &mut io, &no_organic_scan), 1);
    let err = String::from_utf8(captured.stderr.borrow().clone()).unwrap();
    assert!(err.contains("record hero refused") && err.contains("component-review capture --manifest .impeccable/review/components.json"), "{err}");
    // A hosted session fails closed: no named sessions, or sessions without an accepted review.
    let (hosted, _) = io_with(&[("IMPECCABLE_COMPONENT_REVIEW_TOOL", "component_review")]);
    assert!(plan_review_refusal(&hosted).unwrap().contains("must set IMPECCABLE_COMPONENT_REVIEW_SESSIONS"));
    let (hosted, _) = io_with(&[("IMPECCABLE_COMPONENT_REVIEW_TOOL", "component_review"), ("IMPECCABLE_COMPONENT_REVIEW_PENDING", "0")]);
    assert!(plan_review_refusal(&hosted).is_some(), "the retired pending flag opens nothing");
    let empty = ws.path.join("host-session");
    std::fs::create_dir_all(&empty).unwrap();
    let (hosted, _) = io_with(&[("IMPECCABLE_COMPONENT_REVIEW_TOOL", "component_review"), ("IMPECCABLE_COMPONENT_REVIEW_SESSIONS", empty.to_str().unwrap())]);
    assert!(plan_review_refusal(&hosted).is_some());
    // A spec with nothing to decide has no review to wait for.
    write(SPEC_PATH, br#"{"comp":"comp.png","regions":[{"id":"copy","kind":"text","note":"Body","box":{"x":0,"y":0,"w":1,"h":1}}]}"#);
    assert!(plan_review_refusal(&io_with(&[]).0).is_none());
}

struct ReviewedCapture(crate::entry_capture::EntryEvidence, Option<crate::entry_capture::ApprovedReference>);
impl CapturedEntry for ReviewedCapture {
    fn approved_reference(&self) -> Option<&crate::entry_capture::ApprovedReference> { self.1.as_ref() }
    fn evidence(&self) -> &crate::entry_capture::EntryEvidence { &self.0 }
    fn verify_current(&self) -> Result<(), String> { Ok(()) }
}
/// Stands in for the reviewed native renderer: `approved` is what the user accepted.
struct ReviewedRenderer { hero: Vec<u8>, approved: Option<Vec<u8>> }
impl EntryRenderer for ReviewedRenderer {
    fn capture_entry(&self, _: &EntryRequest) -> Result<Box<dyn CapturedEntry>, String> {
        let frame = crate::entry_capture::FrameEvidence { name: "hero".into(), png: self.hero.clone(), regions: vec![] };
        Ok(Box::new(ReviewedCapture(crate::entry_capture::EntryEvidence { report: json!({}), frames: vec![frame] },
            self.approved.clone().map(|png| crate::entry_capture::ApprovedReference { png, proof: json!({"schema": "test-review"}) }))))
    }
}

/// A comp with a striped headline and a dark plate; `restyled` turns the headline's stripes
/// (a contradicted text reading), `plate_shown` decides whether the plate renders.
fn reviewed_hero(restyled: bool, plate_shown: bool) -> Image {
    let mut img = r::create_image(200, 120, [230, 220, 200, 255]);
    if plate_shown {
        r::fill_rect(&mut img, 18., 18., 44., 44., [40., 40., 40., 255.]);
        for y in (20..60).step_by(4) { r::fill_rect(&mut img, 20., y as f64, 40., 2., [200., 120., 60., 255.]); }
    }
    r::fill_rect(&mut img, 120., 84., 60., 24., [20., 50., 80., 255.]);
    if restyled {
        for x in (122..178).step_by(3) { r::fill_rect(&mut img, x as f64, 86., 1., 20., [240., 240., 240., 255.]); }
    } else {
        for y in (86..106).step_by(3) { r::fill_rect(&mut img, 124., y as f64, 52., 1., [240., 240., 240., 255.]); }
    }
    img
}

fn run_reviewed_hero(capture: &Image, approved: Option<&Image>, html: &str) -> (Gate, Value) {
    let ws = Workspace::new();
    let comp = reviewed_hero(false, true);
    let png = |i: &Image| png_io::encode_png(i, &[]).unwrap();
    ws.write("comp.png", &png(&comp));
    ws.write("art.png", &png(&r::crop(&comp, 10., 10., 60., 60.)));
    ws.write("index.html", html.as_bytes());
    let art = json!({"id":"art","kind":"plate","medium":"raster","plate":"art.png","note":"dark printed square",
        "box":{"x":0.05,"y":0.0833,"w":0.3,"h":0.5},"px":{"x":10,"y":10,"w":60,"h":60}});
    let spec = json!({"comp":"comp.png","regions":[art.clone(), {"id":"headline","kind":"text","medium":"semantic","note":"striped headline lettering",
        "type":{},"box":{"x":0.6,"y":0.7,"w":0.3,"h":0.2},"px":{"x":120,"y":84,"w":60,"h":24}}]});
    ws.write(SPEC_PATH, util::json_pretty(&spec).as_bytes());
    let io = ws.io();
    let receipt = json!({"status":"ok","score":0.9,"file":"art.png","assetHash":sha256_file(&io,"art.png"),"compHash":sha256_file(&io,"comp.png"),"regionHash":sha256_bytes(util::json_pretty(&art).as_bytes()),"referenceHash":plate_reference_hash(&spec)});
    let mut state = json!({"comp":"comp.png","capturePolicy":"native-html-v1","plates":{"art":receipt},"phases":{"hero":{}}});
    let renderer = ReviewedRenderer { hero: png(capture), approved: approved.map(png) };
    let gate = gate_hero(&io, &mut state, "unused.png", HERO_MIN, "diff", Some("index.html"), &no_organic_scan, Some(&renderer));
    let report = serde_json::from_slice(&std::fs::read(ws.path.join("diff/report.json")).unwrap()).unwrap();
    (gate, report)
}

const REVIEWED_PAGE: &str = "<main><img src=\"art.png\"><h1>Headline</h1></main>";

#[test]
fn accepted_first_viewport_review_turns_a_contradicted_text_region_into_an_advisory() {
    let current = reviewed_hero(true, true);
    let contradicted = |g: &Gate| g.reasons.iter().any(|r| r.contains("headline (text) is contradicted"));
    let (unreviewed, _) = run_reviewed_hero(&current, None, REVIEWED_PAGE);
    assert!(contradicted(&unreviewed), "{:?}", unreviewed.reasons);
    let (reviewed, report) = run_reviewed_hero(&current, Some(&current), REVIEWED_PAGE);
    assert!(!contradicted(&reviewed), "{:?}", reviewed.reasons);
    assert!(reviewed.advisories.iter().any(|a| a.contains("accepted in the first-viewport review") && a.contains("headline")), "{:?}", reviewed.advisories);
    assert_eq!(report["humanHeroReview"]["acceptedRegions"], json!(["headline"]));
    assert_eq!(report["humanHeroReview"]["proof"]["schema"], "test-review");
}

#[test]
fn stale_first_viewport_approval_waives_nothing() {
    // The user approved a different rendering of the headline than the one captured now.
    let (gate, report) = run_reviewed_hero(&reviewed_hero(true, true), Some(&reviewed_hero(false, true)), REVIEWED_PAGE);
    assert!(!gate.ok);
    assert!(gate.reasons.iter().any(|r| r.contains("headline (text) is contradicted")), "{:?}", gate.reasons);
    assert!(!gate.advisories.iter().any(|a| a.contains("first-viewport review")), "{:?}", gate.advisories);
    assert_eq!(report["humanHeroReview"]["acceptedRegions"], json!([]));
}

#[test]
fn accepted_first_viewport_review_keeps_material_vetoes() {
    // An inline SVG drawing blocks even though the user approved exactly this capture.
    let current = reviewed_hero(true, true);
    let svg = format!("{REVIEWED_PAGE}<svg width=\"400\" height=\"300\" viewBox=\"0 0 400 300\">{}</svg>",
        (0..12).map(|i| format!("<path d=\"M{i} 0 C {} 40 80 {} 120 {i} S 200 90 240 {}\"/>", i * 7, i * 9, i * 11)).collect::<String>());
    let (gate, _) = run_reviewed_hero(&current, Some(&current), &svg);
    assert!(!gate.ok);
    assert!(gate.reasons.iter().any(|r| r.contains("inline SVG")), "{:?}", gate.reasons);
    assert!(!gate.reasons.iter().any(|r| r.contains("headline (text) is contradicted")), "{:?}", gate.reasons);
    // A plate that does not render stays missing, approved or not.
    let blank = reviewed_hero(true, false);
    let (gate, report) = run_reviewed_hero(&blank, Some(&blank), REVIEWED_PAGE);
    assert!(!gate.ok, "{report}");
    assert!(gate.reasons.iter().any(|r| r.contains("region art is missing")), "{:?}", gate.reasons);
    // And an unreferenced plate refuses before any comparison.
    let (gate, _) = run_reviewed_hero(&current, Some(&current), "<main><h1>Headline</h1></main>");
    assert!(gate.reasons.iter().any(|r| r.contains("is not referenced")), "{:?}", gate.reasons);
}

#[test]
fn third_failed_hero_attempt_sends_the_agent_to_the_first_viewport_review() {
    let ws = Workspace::new();
    let io = ws.io();
    let mut state = json!({"phases":{"hero":{}}});
    let mut gate = Gate::fail(vec!["hero overall 61% < 80%".into()]);
    gate.score = Some(0.61);
    assert!(hero_loop_verdict(&mut state, &gate, "index.html", &io).is_none());
    gate.reasons = vec!["region headline (text) is contradicted".into()];
    assert!(hero_loop_verdict(&mut state, &gate, "index.html", &io).is_none());
    let third = hero_loop_verdict(&mut state, &gate, "index.html", &io).unwrap();
    assert!(third.starts_with("The hero gate has failed three attempts in a row. Stop iterating and present the first-viewport review"), "{third}");
    assert!(hero_loop_verdict(&mut state, &gate, "index.html", &io).unwrap().starts_with("The same hero gate checks remain unresolved"));
    let mut passed = Gate::fail(vec![]);
    passed.ok = true;
    passed.score = Some(0.9);
    assert!(hero_loop_verdict(&mut state, &passed, "index.html", &io).is_none());
}
