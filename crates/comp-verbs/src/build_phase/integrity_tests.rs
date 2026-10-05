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
    assert!(changed.contains("changed after finish (index.html)"), "{changed}");
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
        if let Some(message) = hero_loop_verdict(&mut state, &gate, "missing.html", &io, false) {
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
    // advance from hero applies the same check, so a spec change after the plates closed cannot slip past it.
    let mut state = json!({"phase":"hero","comp":"comp.png","phases":{"plates":{"status":"closed"},"hero":{"attempts":0}}});
    let result = advance(&io, &mut state, false, None, &opts, &no_organic_scan, None);
    assert!(!result.ok && result.reasons.iter().any(|r| r.contains("plan and asset review")), "{:?}", result.reasons);
    // A plates advance forced with a quoted downgrade waived the review; the hero phase honours that.
    let mut forced = json!({"phase":"hero","comp":"comp.png","phases":{"plates":{"status":"closed","forced":{"reason":"quoted"}},"hero":{"attempts":0}}});
    assert!(hero_plan_review_refusal(&io, &forced).is_none());
    let result = advance(&io, &mut forced, false, None, &opts, &no_organic_scan, None);
    assert!(!result.reasons.iter().any(|r| r.contains("plan and asset review")), "{:?}", result.reasons);
    // A hosted session fails closed: no named sessions, or sessions without an accepted review.
    let (hosted, _) = io_with(&[("IMPECCABLE_COMPONENT_REVIEW_TOOL", "component_review")]);
    let why = plan_review_refusal(&hosted).unwrap();
    assert!(why.contains("harness configuration problem") && why.contains("do not set environment variables"), "{why}");
    let (hosted, _) = io_with(&[("IMPECCABLE_COMPONENT_REVIEW_TOOL", "component_review"), ("IMPECCABLE_COMPONENT_REVIEW_SESSIONS", "")]);
    let why = plan_review_refusal(&hosted).unwrap();
    assert!(why.contains("is not accepted for this build") && why.contains("Call component_review") && !why.contains("IMPECCABLE_COMPONENT_REVIEW_SESSIONS"), "{why}");
    let (hosted, _) = io_with(&[("IMPECCABLE_COMPONENT_REVIEW_TOOL", "component_review"), ("IMPECCABLE_COMPONENT_REVIEW_PENDING", "0")]);
    assert!(plan_review_refusal(&hosted).is_some(), "the retired pending flag opens nothing");
    let empty = ws.path.join("host-session");
    std::fs::create_dir_all(&empty).unwrap();
    let (hosted, _) = io_with(&[("IMPECCABLE_COMPONENT_REVIEW_TOOL", "component_review"), ("IMPECCABLE_COMPONENT_REVIEW_SESSIONS", empty.to_str().unwrap())]);
    assert!(plan_review_refusal(&hosted).is_some());
    // A spec with nothing to decide has no review to wait for.
    write(SPEC_PATH, br#"{"comp":"comp.png","regions":[{"id":"copy","kind":"text","note":"Body","box":{"x":0,"y":0,"w":1,"h":1}}]}"#);
    assert!(plan_review_refusal(&io_with(&[]).0).is_none());
    // The hosted gate reads the same spec: no host acceptance is demanded for a review
    // `component-review plan` refuses to write, with the sessions empty or unnamed.
    let (hosted, _) = io_with(&[("IMPECCABLE_COMPONENT_REVIEW_TOOL", "component_review"), ("IMPECCABLE_COMPONENT_REVIEW_SESSIONS", "")]);
    assert!(plan_review_refusal(&hosted).is_none());
    let (hosted, _) = io_with(&[("IMPECCABLE_COMPONENT_REVIEW_TOOL", "component_review")]);
    assert!(plan_review_refusal(&hosted).is_none());
}

struct ReviewedCapture(crate::entry_capture::EntryEvidence, Option<crate::entry_capture::ApprovedReference>);
impl CapturedEntry for ReviewedCapture {
    fn approved_reference(&self) -> Option<&crate::entry_capture::ApprovedReference> { self.1.as_ref() }
    fn evidence(&self) -> &crate::entry_capture::EntryEvidence { &self.0 }
    fn verify_current(&self) -> Result<(), String> { Ok(()) }
}
/// Stands in for the reviewed native renderer: `approved` is what the user accepted.
struct ReviewedRenderer { hero: Vec<u8>, approved: Option<Vec<u8>>, report: Value }
impl EntryRenderer for ReviewedRenderer {
    fn capture_entry(&self, _: &EntryRequest) -> Result<Box<dyn CapturedEntry>, String> {
        let frame = crate::entry_capture::FrameEvidence { name: "hero".into(), png: self.hero.clone(), regions: vec![] };
        Ok(Box::new(ReviewedCapture(crate::entry_capture::EntryEvidence { report: self.report.clone(), frames: vec![frame] },
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
    run_reviewed_hero_min(capture, approved, html, HERO_MIN)
}

fn run_reviewed_hero_min(capture: &Image, approved: Option<&Image>, html: &str, min: f64) -> (Gate, Value) {
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
    let renderer = ReviewedRenderer { hero: png(capture), approved: approved.map(png), report: json!({}) };
    let gate = gate_hero(&io, &mut state, "unused.png", min, "diff", Some("index.html"), &no_organic_scan, Some(&renderer));
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
    assert!(hero_loop_verdict(&mut state, &gate, "index.html", &io, false).is_none());
    gate.reasons = vec!["region headline (text) is contradicted".into()];
    assert!(hero_loop_verdict(&mut state, &gate, "index.html", &io, false).is_none());
    let third = hero_loop_verdict(&mut state, &gate, "index.html", &io, false).unwrap();
    assert!(third.starts_with("The hero gate has failed three attempts in a row. Stop iterating and present the first-viewport review"), "{third}");
    assert!(hero_loop_verdict(&mut state, &gate, "index.html", &io, false).unwrap().starts_with("The same hero gate checks remain unresolved"));
    let mut passed = Gate::fail(vec![]);
    passed.ok = true;
    passed.score = Some(0.9);
    assert!(hero_loop_verdict(&mut state, &passed, "index.html", &io, false).is_none());
}

#[test]
fn third_failed_hero_attempt_after_acceptance_asks_to_restore_not_to_review_again() {
    // The review store hands back the accepted session, so asking for a new review would loop.
    let ws = Workspace::new();
    let io = ws.io();
    let mut state = json!({"phases":{"hero":{}}});
    let mut gate = Gate::fail(vec!["the hero capture no longer matches the first viewport the user accepted".into()]);
    gate.score = Some(0.61);
    for _ in 0..2 { assert!(hero_loop_verdict(&mut state, &gate, "index.html", &io, true).is_none()); }
    let third = hero_loop_verdict(&mut state, &gate, "index.html", &io, true).unwrap();
    assert!(third.contains("already accepted a first viewport") && third.contains("Restore what they accepted"), "{third}");
    assert!(!third.contains("present the first-viewport review"), "{third}");
}

#[test]
fn accepted_first_viewport_turns_the_overall_bar_into_an_advisory() {
    // A tiled ground can never land on the comp's repeats: the bar fails on a correct page.
    let current = reviewed_hero(true, true);
    let bar = |g: &Gate| g.reasons.iter().any(|r| r.starts_with("hero overall"));
    let (unreviewed, _) = run_reviewed_hero_min(&current, None, REVIEWED_PAGE, 0.999);
    assert!(bar(&unreviewed), "{:?}", unreviewed.reasons);
    let (accepted, report) = run_reviewed_hero_min(&current, Some(&current), REVIEWED_PAGE, 0.999);
    assert!(accepted.ok, "{:?}", accepted.reasons);
    assert!(accepted.advisories[0].starts_with("The user accepted this first viewport in the review"), "{:?}", accepted.advisories);
    assert!(accepted.advisories.iter().any(|a| a.starts_with("(advisory, first viewport accepted) hero overall")), "{:?}", accepted.advisories);
    assert_eq!(report["humanHeroReview"]["viewportAccepted"], true);
    // A stale approval (another rendering) closes nothing.
    let (stale, report) = run_reviewed_hero_min(&current, Some(&reviewed_hero(false, true)), REVIEWED_PAGE, 0.999);
    assert!(!stale.ok && !bar(&stale), "{:?}", stale.reasons);
    assert!(stale.reasons[0].starts_with("the hero capture no longer matches the first viewport the user accepted") && stale.reasons[0].contains("changed since the acceptance: headline") && stale.reasons[0].ends_with("Restore what the user accepted; until then the readings apply.") && !stale.reasons[0].contains("review"), "{:?}", stale.reasons);
    assert!(stale.advisories.iter().any(|a| a.starts_with("(measured) hero overall")), "the raw score is kept as a measurement: {:?}", stale.advisories);
    assert_eq!(report["humanHeroReview"]["viewportAccepted"], false);
    // The material veto still blocks under an accepted, below-bar viewport.
    let blank = reviewed_hero(true, false);
    let (missing, _) = run_reviewed_hero_min(&blank, Some(&blank), REVIEWED_PAGE, 0.999);
    assert!(!missing.ok);
    assert_eq!(missing.reasons.iter().filter(|r| !r.contains("region art is missing")).count(), 0, "only the material veto blocks: {:?}", missing.reasons);
}

struct DesktopRenderer { desktop: Vec<u8>, approved: Option<Vec<u8>> }
impl EntryRenderer for DesktopRenderer {
    fn capture_entry(&self, _: &EntryRequest) -> Result<Box<dyn CapturedEntry>, String> {
        let frame = |name: &str| crate::entry_capture::FrameEvidence { name: name.into(), png: self.desktop.clone(), regions: vec![] };
        Ok(Box::new(ReviewedCapture(crate::entry_capture::EntryEvidence { report: json!({}), frames: vec![frame("desktop"), frame("mobile")] },
            self.approved.clone().map(|png| crate::entry_capture::ApprovedReference { png, proof: json!({"schema": "test-review"}) }))))
    }
}

#[test]
fn responsive_does_not_relitigate_an_accepted_first_viewport_score() {
    let ws = Workspace::new();
    let comp = reviewed_hero(false, false);
    let png = |i: &Image| png_io::encode_png(i, &[]).unwrap();
    ws.write("comp.png", &png(&comp));
    ws.write("index.html", b"<main><h1>Headline</h1></main>");
    ws.write(SPEC_PATH, util::json_pretty(&json!({"comp":"comp.png","regions":[{"id":"headline","kind":"control","medium":"semantic","note":"striped headline lettering",
        "box":{"x":0.6,"y":0.7,"w":0.3,"h":0.2},"px":{"x":120,"y":84,"w":60,"h":24}}]})).as_bytes());
    let current = reviewed_hero(true, false);
    let run = |approved: Option<&Image>| {
        let mut state = json!({"comp":"comp.png","capturePolicy":"native-html-v1","phases":{}});
        gate_responsive(&ws.io(), &mut state, 0.999, "diff", Some(&DesktopRenderer { desktop: png(&current), approved: approved.map(png) }))
    };
    let unreviewed = run(None);
    assert!(!unreviewed.ok && unreviewed.reasons.iter().any(|r| r.contains("scores")), "{:?}", unreviewed.reasons);
    // Accepted, then shared CSS changed without changing the first viewport: the renderer
    // still hands over the approval and the pixels still match, so the waiver holds.
    let accepted = run(Some(&current));
    assert!(accepted.ok, "{:?}", accepted.reasons);
    assert!(accepted.advisories.iter().any(|a| a.starts_with("(advisory, first viewport accepted) the desktop capture scores")), "{:?}", accepted.advisories);
    // A later edit that changes the first viewport: the acceptance lapses and the gate says so.
    let lapsed = run(Some(&comp));
    assert!(!lapsed.ok);
    assert!(lapsed.reasons.iter().any(|r| r.starts_with("the desktop capture no longer matches the first viewport the user accepted") && r.ends_with("Restore what the user accepted; until then the readings apply.")), "{:?}", lapsed.reasons);
    assert!(!lapsed.reasons.iter().any(|r| r.contains("does not survive a common desktop width")), "{:?}", lapsed.reasons);
}

/// A code-led first viewport (an Operate dashboard's header, headline and a
/// control) with no raster region: the native renderer returns frames without
/// region receipts, and the gate reads the same text and control regions.
fn text_only_hero(restyled: bool) -> Image {
    let mut img = r::create_image(240, 160, [244, 244, 240, 255]);
    r::fill_rect(&mut img, 16., 16., 120., 28., [24., 28., 36., 255.]);
    if restyled {
        for x in (18..134).step_by(3) { r::fill_rect(&mut img, x as f64, 18., 1., 24., [240., 240., 240., 255.]); }
    } else {
        for y in (18..42).step_by(3) { r::fill_rect(&mut img, 20., y as f64, 112., 1., [240., 240., 240., 255.]); }
    }
    r::fill_rect(&mut img, 160., 116., 64., 24., [30., 90., 200., 255.]);
    img
}

fn run_text_only_hero(capture: &Image, approved: Option<&Image>) -> (Gate, Value) {
    run_text_only_hero_on(&text_only_hero(false), capture, approved)
}

fn run_text_only_hero_on(comp: &Image, capture: &Image, approved: Option<&Image>) -> (Gate, Value) {
    let ws = Workspace::new();
    let png = |i: &Image| png_io::encode_png(i, &[]).unwrap();
    ws.write("comp.png", &png(comp));
    ws.write("index.html", b"<main><h1>Revenue</h1><button>Export</button></main>");
    let spec = json!({"comp":"comp.png","compSize":{"width":240,"height":160},"regions":[
        {"id":"headline","kind":"text","medium":"semantic","note":"striped headline lettering","type":{},
         "box":{"x":0.0667,"y":0.1,"w":0.5,"h":0.175},"px":{"x":16,"y":16,"w":120,"h":28}},
        {"id":"export","kind":"control","medium":"semantic","note":"blue export button",
         "box":{"x":0.6667,"y":0.725,"w":0.2667,"h":0.15},"px":{"x":160,"y":116,"w":64,"h":24}}]});
    ws.write(SPEC_PATH, util::json_pretty(&spec).as_bytes());
    let io = ws.io();
    let mut state = json!({"comp":"comp.png","capturePolicy":"native-html-v1","phases":{"hero":{}}});
    let renderer = ReviewedRenderer { hero: png(capture), approved: approved.map(png), report: json!({"captureMethod":"assembled-page-viewport"}) };
    let gate = gate_hero(&io, &mut state, "unused.png", HERO_MIN, "diff", Some("index.html"), &no_organic_scan, Some(&renderer));
    let report = serde_json::from_slice(&std::fs::read(ws.path.join("diff/report.json")).unwrap()).unwrap();
    (gate, report)
}

#[test]
fn text_only_first_viewport_gets_region_readings_from_the_native_frame() {
    // The comp itself: the gate measures and passes with no raster region at all.
    let (gate, report) = run_text_only_hero(&text_only_hero(false), None);
    assert!(gate.ok, "{:?}", gate.reasons);
    assert!(gate.score.is_some_and(|s| s >= HERO_MIN), "{:?}", gate.score);
    let ids: Vec<_> = report["regions"].as_array().unwrap().iter().filter_map(|r| r["id"].as_str()).collect();
    assert!(ids.contains(&"headline") && ids.contains(&"export"), "{ids:?}");
    // No raster region: the report must not claim the presence checks ran.
    let scope = report["nativeCapture"]["integrityScope"].as_str().unwrap();
    assert!(scope.contains("no raster presence") && !scope.starts_with("rendered presence"), "{scope}");
    assert!(report["nativeCapture"]["framePolicy"].is_null(), "{report}");
    // A restyled headline is read as a text reading, not as a capture failure.
    let (gate, _) = run_text_only_hero(&text_only_hero(true), None);
    assert!(!gate.ok);
    assert!(gate.reasons.iter().any(|r| r.contains("headline (text) is contradicted")), "{:?}", gate.reasons);
    assert!(!gate.reasons.iter().any(|r| r.contains("capture unavailable")), "{:?}", gate.reasons);
}

#[test]
fn accepted_review_of_a_text_only_first_viewport_lets_it_pass() {
    let current = text_only_hero(true);
    let (gate, report) = run_text_only_hero(&current, Some(&current));
    assert!(gate.ok, "{:?}", gate.reasons);
    assert!(gate.advisories.iter().any(|a| a.contains("first viewport accepted") || a.contains("accepted in the first-viewport review")), "{:?}", gate.advisories);
    assert_eq!(report["humanHeroReview"]["viewportAccepted"], true, "{report}");
    // A stale approval (a different rendering) still waives nothing.
    let (gate, report) = run_text_only_hero(&current, Some(&text_only_hero(false)));
    assert!(!gate.ok);
    assert_eq!(report["humanHeroReview"]["viewportAccepted"], false, "{report}");
}

/// A menu column ending in a sign-off line near the bottom of the first viewport.
/// `push` moves the column's rows down progressively and the sign-off by the full
/// amount, as a px floor on the menu's type does at a narrower desktop width.
fn menu_page(push: f64, height: usize, sign_off: bool) -> Image {
    let mut img = r::create_image(400, height, [240, 240, 236, 255]);
    for i in 0..8 {
        let y = 40.0 + i as f64 * 34.0 + push * (i as f64 / 8.0);
        r::fill_rect(&mut img, 220.0, y, 120.0 + (i % 3) as f64 * 20.0, 10.0, [20.0, 20.0, 20.0, 255.0]);
    }
    if sign_off {
        for k in 0..6 {
            r::fill_rect(&mut img, 230.0 + k as f64 * 22.0, 330.0 + push, 14.0, 18.0, [20.0, 20.0, 20.0, 255.0]);
        }
    }
    img
}

fn menu_workspace() -> Workspace {
    let ws = Workspace::new();
    ws.write("comp.png", &png_io::encode_png(&menu_page(0.0, 360, true), &[]).unwrap());
    ws.write(SPEC_PATH, util::json_pretty(&json!({"comp":"comp.png","regions":[
        {"id":"menu","kind":"chrome","medium":"semantic","note":"ruled menu rows","box":{"x":0.54,"y":0.1,"w":0.42,"h":0.78},"px":{"x":216,"y":36,"w":168,"h":281}},
        {"id":"sign-off","kind":"text","medium":"semantic","note":"sign-off line","type":{},"box":{"x":0.555,"y":0.9111,"w":0.35,"h":0.0611},"px":{"x":222,"y":328,"w":140,"h":22}}]})).as_bytes());
    ws.write(".impeccable/review/mobile.png", &png_io::encode_png(&menu_page(0.0, 360, true), &[]).unwrap());
    ws
}

#[test]
fn responsive_calls_a_region_pushed_below_the_first_viewport_displaced_not_missing() {
    let ws = menu_workspace();
    let mut state = json!({"comp":"comp.png","phases":{}});
    // A full-page desktop capture: the sign-off is there, 40px lower, past the frame.
    ws.write(".impeccable/review/desktop.png", &png_io::encode_png(&menu_page(40.0, 480, true), &[]).unwrap());
    let gate = gate_responsive(&ws.io(), &mut state, 0.1, "diff", None);
    assert!(!gate.ok);
    let reason = gate.reasons.iter().find(|r| r.contains("sign-off")).unwrap();
    assert!(reason.contains("is displaced, not missing") && reason.contains("about 40px lower") && reason.contains("400x360 first viewport"), "{reason}");
    assert!(!gate.reasons.iter().any(|r| r.contains("is missing")), "{:?}", gate.reasons);
    assert_eq!(gate.worst_crops[0]["verdict"], "displaced");
    assert_eq!(gate.worst_crops[0]["file"], "diff/regions/sign-off.png");
    let report: Value = serde_json::from_slice(&std::fs::read(ws.path.join("diff/report.json")).unwrap()).unwrap();
    let region = report["regions"].as_array().unwrap().iter().find(|r| r["id"] == "sign-off").unwrap().clone();
    assert_eq!(region["verdict"], "displaced");
    assert!(matches!(region["rawVerdict"].as_str(), Some("missing" | "contradicted")), "{region}");
    assert_eq!(region["displacement"]["dy"], 40.0);
    assert_eq!(region["blocking"], true);
    // A native frame is the first viewport alone: the column above says where it went.
    ws.write(".impeccable/review/desktop.png", &png_io::encode_png(&menu_page(40.0, 360, true), &[]).unwrap());
    let gate = gate_responsive(&ws.io(), &mut state, 0.1, "diff", None);
    let reason = gate.reasons.iter().find(|r| r.contains("sign-off")).unwrap();
    assert!(reason.contains("is displaced, not missing: the content above it in its column sits about"), "{reason}");
    // Gone is still missing.
    ws.write(".impeccable/review/desktop.png", &png_io::encode_png(&menu_page(0.0, 360, false), &[]).unwrap());
    let gate = gate_responsive(&ws.io(), &mut state, 0.1, "diff", None);
    assert!(gate.reasons.iter().any(|r| r == "at desktop width, region sign-off is missing"), "{:?}", gate.reasons);
    assert_eq!(gate.worst_crops[0]["verdict"], "missing");
}

#[test]
fn a_missing_control_does_not_borrow_its_identical_neighbour() {
    // Two identical icon controls 24px apart; the lower one is gone at desktop width.
    let ws = Workspace::new();
    let icon = |img: &mut Image, y: f64| for k in 0..3 { r::fill_rect(img, 40. + k as f64 * 10., y, 6., 14., [20., 20., 20., 255.]); };
    let mut comp = r::create_image(200, 200, [240, 240, 236, 255]);
    icon(&mut comp, 100.);
    icon(&mut comp, 124.);
    let mut desktop = r::create_image(200, 200, [240, 240, 236, 255]);
    icon(&mut desktop, 100.);
    let png = |i: &Image| png_io::encode_png(i, &[]).unwrap();
    ws.write("comp.png", &png(&comp));
    ws.write(".impeccable/review/desktop.png", &png(&desktop));
    ws.write(".impeccable/review/mobile.png", &png(&desktop));
    ws.write(SPEC_PATH, util::json_pretty(&json!({"comp":"comp.png","regions":[
        {"id":"first","kind":"control","medium":"semantic","note":"first icon control","box":{"x":0.19,"y":0.49,"w":0.16,"h":0.09},"px":{"x":38,"y":98,"w":32,"h":18}},
        {"id":"second","kind":"control","medium":"semantic","note":"second icon control","box":{"x":0.19,"y":0.61,"w":0.16,"h":0.09},"px":{"x":38,"y":122,"w":32,"h":18}}]})).as_bytes());
    let mut state = json!({"comp":"comp.png","phases":{}});
    let gate = gate_responsive(&ws.io(), &mut state, 0.1, "diff", None);
    assert!(gate.reasons.iter().any(|r| r == "at desktop width, region second is missing"), "{:?} {:?}", gate.reasons, gate.advisories);
    // Two distinct controls that both moved down a row: the first lands in the
    // second's old box, which the second no longer occupies, so it is found.
    let bars = |img: &mut Image, y: f64| r::fill_rect(img, 40., y + 12., 26., 2., [20., 20., 20., 255.]);
    let mut comp = r::create_image(200, 200, [240, 240, 236, 255]);
    icon(&mut comp, 100.);
    bars(&mut comp, 124.);
    let mut desktop = r::create_image(200, 200, [240, 240, 236, 255]);
    icon(&mut desktop, 124.);
    bars(&mut desktop, 148.);
    ws.write("comp.png", &png(&comp));
    ws.write(".impeccable/review/desktop.png", &png(&desktop));
    let gate = gate_responsive(&ws.io(), &mut state, 0.1, "diff", None);
    let report: Value = serde_json::from_slice(&std::fs::read(ws.path.join("diff/report.json")).unwrap()).unwrap();
    assert!(!gate.reasons.iter().any(|r| r.contains("region first is missing")), "{:?} {}", gate.reasons, report["regions"]);
    assert!(gate.advisories.iter().any(|a| a.contains("region first sits about 24px lower")), "{:?}", gate.advisories);
}

#[test]
fn responsive_reads_a_region_shifted_inside_the_first_viewport_as_drift() {
    let ws = menu_workspace();
    let mut state = json!({"comp":"comp.png","phases":{}});
    let mut moved = menu_page(0.0, 360, false);
    for k in 0..6 {
        r::fill_rect(&mut moved, 230.0 + k as f64 * 22.0, 306.0, 14.0, 18.0, [20.0, 20.0, 20.0, 255.0]);
    }
    ws.write(".impeccable/review/desktop.png", &png_io::encode_png(&moved, &[]).unwrap());
    let gate = gate_responsive(&ws.io(), &mut state, 0.1, "diff", None);
    assert!(gate.ok, "{:?}", gate.reasons);
    assert!(gate.advisories.iter().any(|a| a.starts_with("(advisory, still inside the first viewport) at desktop width, region sign-off sits about 24px higher")), "{:?}", gate.advisories);
}

#[test]
fn a_present_plate_off_its_box_at_desktop_width_is_drift_not_missing() {
    let ws = Workspace::new();
    let comp = reviewed_hero(false, true);
    let png = |i: &Image| png_io::encode_png(i, &[]).unwrap();
    ws.write("comp.png", &png(&comp));
    ws.write("art.png", &png(&r::crop(&comp, 10., 10., 60., 60.)));
    let art = json!({"id":"art","kind":"plate","medium":"raster","plate":"art.png","note":"dark printed square",
        "box":{"x":0.05,"y":0.0833,"w":0.3,"h":0.5},"px":{"x":10,"y":10,"w":60,"h":60}});
    let spec = json!({"comp":"comp.png","regions":[art.clone()]});
    ws.write(SPEC_PATH, util::json_pretty(&spec).as_bytes());
    let io = ws.io();
    let receipt = json!({"status":"ok","score":0.9,"file":"art.png","assetHash":sha256_file(&io,"art.png"),"compHash":sha256_file(&io,"comp.png"),"regionHash":sha256_bytes(util::json_pretty(&art).as_bytes()),"referenceHash":plate_reference_hash(&spec)});
    let mut state = json!({"comp":"comp.png","plates":{"art":receipt},"phases":{}});
    // The plate renders 16px lower and to the right of its box: present, shifted.
    let mut desktop = reviewed_hero(false, false);
    r::blit(&mut desktop, &r::crop(&comp, 10., 10., 60., 60.), 26., 26.);
    ws.write(".impeccable/review/desktop.png", &png(&desktop));
    ws.write(".impeccable/review/mobile.png", &png(&desktop));
    let gate = gate_responsive(&io, &mut state, 0.1, "diff", None);
    assert!(!gate.reasons.iter().any(|r| r.contains("art is missing")), "{:?}", gate.reasons);
    let report: Value = serde_json::from_slice(&std::fs::read(ws.path.join("diff/report.json")).unwrap()).unwrap();
    assert_eq!(report["regions"][0]["verdict"], "drift", "{report}");
    assert!(gate.advisories.iter().any(|a| a.contains("art")), "{:?}", gate.advisories);
}

/// The responsive workspace of the accepted-review tests: one striped control
/// region and a quiet chrome strip the approved screenshot can differ in.
fn reviewed_desktop_workspace() -> Workspace {
    let ws = Workspace::new();
    let comp = reviewed_hero(false, false);
    ws.write("comp.png", &png_io::encode_png(&comp, &[]).unwrap());
    ws.write("index.html", b"<main><h1>Headline</h1></main>");
    ws.write(SPEC_PATH, util::json_pretty(&json!({"comp":"comp.png","regions":[
        {"id":"headline","kind":"control","medium":"semantic","note":"striped headline lettering","box":{"x":0.6,"y":0.7,"w":0.3,"h":0.2},"px":{"x":120,"y":84,"w":60,"h":24}},
        {"id":"strip","kind":"chrome","medium":"semantic","note":"quiet top strip","box":{"x":0.05,"y":0.05,"w":0.4,"h":0.4},"px":{"x":10,"y":6,"w":80,"h":48}}]})).as_bytes());
    ws
}

fn run_reviewed_desktop(ws: &Workspace, current: &Image, approved: Option<&Image>, min: f64) -> (Gate, Value) {
    let png = |i: &Image| png_io::encode_png(i, &[]).unwrap();
    let mut state = json!({"comp":"comp.png","capturePolicy":"native-html-v1","phases":{}});
    let gate = gate_responsive(&ws.io(), &mut state, min, "diff", Some(&DesktopRenderer { desktop: png(current), approved: approved.map(png) }));
    let report = serde_json::from_slice(&std::fs::read(ws.path.join("diff/report.json")).unwrap()).unwrap();
    (gate, report)
}

#[test]
fn a_lapsed_acceptance_is_named_even_above_the_bar() {
    let ws = reviewed_desktop_workspace();
    // Above the bar, but the control is contradicted and the user accepted another rendering.
    let (gate, _) = run_reviewed_desktop(&ws, &reviewed_hero(true, false), Some(&reviewed_hero(false, false)), 0.1);
    assert!(!gate.ok);
    assert!(gate.reasons[0].starts_with("the desktop capture no longer matches the first viewport the user accepted") && gate.reasons[0].contains("changed since the acceptance: headline"), "{:?}", gate.reasons);
    assert!(gate.reasons.iter().any(|r| r.contains("headline (control) is contradicted")), "{:?}", gate.reasons);
    // Nothing else blocking: the lapse is still said, as an advisory.
    let mut quiet = reviewed_hero(false, false);
    r::fill_rect(&mut quiet, 14., 10., 70., 40., [30., 30., 30., 255.]);
    let (gate, _) = run_reviewed_desktop(&ws, &reviewed_hero(false, false), Some(&quiet), 0.1);
    assert!(gate.ok, "{:?}", gate.reasons);
    assert!(gate.advisories[0].starts_with("(advisory) the desktop capture no longer matches the first viewport the user accepted") && gate.advisories[0].contains("strip"), "{:?}", gate.advisories);
}

#[test]
fn an_accepted_control_carries_to_desktop_width_like_text() {
    let ws = reviewed_desktop_workspace();
    // The user accepted this control's restyle; the strip differs, so the viewport as a whole is not accepted.
    let current = reviewed_hero(true, false);
    let mut approved = current.clone();
    r::fill_rect(&mut approved, 14., 10., 70., 40., [30., 30., 30., 255.]);
    let (gate, report) = run_reviewed_desktop(&ws, &current, Some(&approved), 0.1);
    assert!(!gate.reasons.iter().any(|r| r.contains("headline (control) is contradicted")), "{:?}", gate.reasons);
    assert!(gate.advisories.iter().any(|a| a.starts_with("(advisory, accepted in the first-viewport review) at desktop width, region headline (control) is contradicted")), "{:?}", gate.advisories);
    assert_eq!(report["humanTextReview"]["acceptedRegions"], json!(["headline"]));
    assert_eq!(report["humanTextReview"]["viewportAccepted"], false);
}

#[test]
fn the_approved_screenshot_is_compared_at_the_desktop_frame_size() {
    // The user approved the first viewport at the comp's size; the desktop frame is
    // smaller and renders the same page proportionally. Neither side is upscaled.
    let ws = reviewed_desktop_workspace();
    let approved = reviewed_hero(true, false);
    let frame = r::resize(&approved, 150., 90.);
    let (gate, report) = run_reviewed_desktop(&ws, &frame, Some(&approved), 0.999);
    assert_eq!(report["humanTextReview"]["comparison"]["compSize"], "150x90", "{report}");
    assert_eq!(report["humanTextReview"]["comparison"]["referenceSize"], "200x120");
    assert_eq!(report["humanTextReview"]["viewportAccepted"], true, "{report}");
    assert!(gate.ok, "{:?}", gate.reasons);
}

#[test]
fn responsive_failures_print_crops_and_escalate_after_three_attempts() {
    let ws = menu_workspace();
    ws.write(".impeccable/review/desktop.png", &png_io::encode_png(&menu_page(40.0, 480, true), &[]).unwrap());
    ws.write(".impeccable/build/state.json", util::json_pretty(&json!({"comp":"comp.png","phase":"responsive","phases":{"responsive":{"status":"open","attempts":0,"notes":[]}}})).as_bytes());
    let advance = || {
        let (mut io, out) = Io::captured("", ws.path.clone(), Default::default());
        let code = run(&["advance".to_string(), "--min".into(), "0.1".into()], &mut io, &no_organic_scan);
        let text = String::from_utf8(out.stdout.borrow().clone()).unwrap();
        (code, text)
    };
    let (code, first) = advance();
    assert_eq!(code, 2);
    assert!(first.contains("LOOK FIRST") && first.contains(".impeccable/review/diff/desktop/regions/sign-off.png   sign-off: displaced"), "{first}");
    assert!(first.contains("A region scored displaced is present but pushed out of the first viewport"), "{first}");
    assert!(!first.contains("failed 3 attempts"), "{first}");
    advance();
    let (_, third) = advance();
    assert!(third.contains("- The responsive gate has failed 3 attempts in a row. Stop iterating and present the first-viewport review"), "{third}");
    let state: Value = serde_json::from_slice(&std::fs::read(ws.path.join(".impeccable/build/state.json")).unwrap()).unwrap();
    assert_eq!(state["phases"]["responsive"]["history"].as_array().unwrap().len(), 3);
    assert_eq!(state["phases"]["responsive"]["status"], "open");
}

#[test]
fn responsive_escalation_after_acceptance_routes_to_the_user_not_a_new_review() {
    let mut state = json!({"phases":{"responsive":{}}});
    let mut gate = Gate::fail(vec!["at desktop width, region sign-off is displaced, not missing".into()]);
    gate.score = Some(0.8);
    for _ in 0..2 { assert!(responsive_loop_verdict(&mut state, &gate, true, "impeccable").is_none()); }
    let third = responsive_loop_verdict(&mut state, &gate, true, "impeccable").unwrap();
    assert!(third.contains("already accepted a first viewport") && third.contains("impeccable build-phase advance --force --reason") && third.contains("not a fix round"), "{third}");
    assert!(!third.contains("present the first-viewport review"), "{third}");
    // The example it gives is a reason force accepts.
    let example = third.split("for example: ").nth(1).unwrap().split(')').next().unwrap();
    assert!(force_allowed(Some(example)), "{example}");
    // A pass in between resets the run of failures.
    let mut passed = Gate::fail(vec![]);
    passed.ok = true;
    passed.score = Some(0.9);
    assert!(responsive_loop_verdict(&mut state, &passed, true, "impeccable").is_none());
    assert!(responsive_loop_verdict(&mut state, &gate, true, "impeccable").is_none());
}

#[test]
fn responsive_next_names_the_frame_the_gate_actually_diffs() {
    let (io, _) = Io::captured("", std::env::temp_dir(), Default::default());
    let native = next_instruction(&io, &json!({"phase":"responsive","breakpoint":"1536x1024","capturePolicy":"native-html-v1"}));
    assert!(native.contains("a 1440x960 desktop first viewport") && !native.contains("desktop.png"), "{native}");
    let saved = next_instruction(&io, &json!({"phase":"responsive","breakpoint":"1536x1024"}));
    assert!(saved.contains("the first viewport of desktop.png (its top 1440x960"), "{saved}");
}

/// A native renderer that binds the files it read, like the real one: its
/// evidence report carries the `inputs.json` manifest of the current bytes.
/// `changed_during` stands in for an edit landing while the capture ran.
struct ManifestRenderer { desktop: Vec<u8>, changed_during: Option<&'static str> }
struct ManifestCapture(crate::entry_capture::EntryEvidence, crate::entry_capture::ApprovedReference, Option<&'static str>);
impl CapturedEntry for ManifestCapture {
    fn approved_reference(&self) -> Option<&crate::entry_capture::ApprovedReference> { Some(&self.1) }
    fn evidence(&self) -> &crate::entry_capture::EntryEvidence { &self.0 }
    fn verify_current(&self) -> Result<(), String> {
        self.2.map_or(Ok(()), |file| Err(format!("capture input changed: {file}")))
    }
}
impl EntryRenderer for ManifestRenderer {
    fn capture_entry(&self, request: &EntryRequest) -> Result<Box<dyn CapturedEntry>, String> {
        let files: Vec<Value> = ["index.html", "fonts/face.ttf"].iter().map(|path| {
            let bytes = std::fs::read(request.root.join(path)).unwrap();
            json!({"path": path, "sha256": sha256_bytes(&bytes), "bytes": bytes.len(), "served": true})
        }).collect();
        let report = json!({"schema":"native-entry-capture-v1","inputSnapshot":"test",
            "manifest":{"schema":"native-html-input-snapshot-v1","entry":"index.html","files":files}});
        let frame = |name: &str| crate::entry_capture::FrameEvidence { name: name.into(), png: self.desktop.clone(), regions: vec![] };
        Ok(Box::new(ManifestCapture(crate::entry_capture::EntryEvidence { report, frames: vec![frame("desktop"), frame("mobile")] },
            crate::entry_capture::ApprovedReference { png: self.desktop.clone(), proof: json!({"schema": "test-review"}) }, self.changed_during)))
    }
}

/// A comp-led native build with every phase closed and the review open, the
/// page accepted at the first viewport so the final recheck passes on fidelity.
fn finished_native_workspace() -> (Workspace, Vec<u8>) {
    let ws = reviewed_desktop_workspace();
    ws.write("fonts/face.ttf", b"font v1");
    let mut state = json!({"phase":"review", "capturePolicy":"native-html-v1", "artifact":"index.html",
        "comp":"comp.png", "sessionId":"owner", "startedAt":"build-one", "phases":{}});
    for phase in PHASES { state["phases"][phase] = json!({"status":"closed", "attempts":1, "gate":{"ok":true}}); }
    state["phases"]["review"]["status"] = json!("open");
    save_state(&ws.io(), &state);
    let desktop = png_io::encode_png(&reviewed_hero(true, false), &[]).unwrap();
    (ws, desktop)
}

#[test]
fn native_ship_binds_every_captured_input_and_a_later_edit_voids_it_until_recaptured() {
    let (ws, desktop) = finished_native_workspace();
    let renderer = ManifestRenderer { desktop, changed_during: None };
    let mut io = ws.io();
    let ship = ["finish", "--disposition", "ship"].map(String::from);
    assert_eq!(run_with_renderer(&ship, &mut io, &no_organic_scan, Some(&renderer)), 0);
    let state = load_state(&io).unwrap();
    let inputs = state["finish"]["captureInputs"].as_array().unwrap();
    assert_eq!(inputs.iter().map(|f| f["path"].as_str().unwrap()).collect::<Vec<_>>(), ["index.html", "fonts/face.ttf"]);
    let report = crate::completion::report(&ws.path, Some(&state), Some("owner"));
    assert_eq!(report["status"], "complete");
    let next = next_instruction(&io, &state);
    assert!(next.starts_with("Finish is recorded for the current entry.") && next.contains("a fix for a hook finding included, voids it")
        && next.contains("build-phase finish --disposition ship again") && next.contains("re-captures the current files natively"), "{next}");

    // A font the page loads changes after ship: the entry bytes are the same,
    // but the shipped page is not the one the final capture saw.
    ws.write("fonts/face.ttf", b"font v2");
    let report = crate::completion::report(&ws.path, Some(&state), Some("owner"));
    assert_eq!(report["status"], "changed-after-finish");
    assert_eq!(report["changedSinceFinish"], json!(["fonts/face.ttf"]));
    assert_eq!(report["canContinue"], true);
    let next = next_instruction(&io, &state);
    assert!(next.contains("A file the final check bound changed after finish (fonts/face.ttf)") && next.contains("build-phase finish --disposition ship again"), "{next}");
    ws.write("index.html", b"<main><h1>Headline, fixed after ship</h1></main>");
    let report = crate::completion::report(&ws.path, Some(&state), Some("owner"));
    assert_eq!(report["changedSinceFinish"], json!(["index.html", "fonts/face.ttf"]));
    // A deleted entry is a change the manifest names, not an unverifiable finish.
    std::fs::remove_file(ws.path.join("index.html")).unwrap();
    let report = crate::completion::report(&ws.path, Some(&state), Some("owner"));
    assert_eq!(report["status"], "changed-after-finish");
    assert_eq!(report["changedSinceFinish"], json!(["index.html", "fonts/face.ttf"]));
    ws.write("index.html", b"<main><h1>Headline, fixed after ship</h1></main>");

    // Recording ship again re-captures the current files and binds them.
    assert_eq!(run_with_renderer(&ship, &mut io, &no_organic_scan, Some(&renderer)), 0);
    let state = load_state(&io).unwrap();
    assert_eq!(crate::completion::report(&ws.path, Some(&state), Some("owner"))["status"], "complete");
    assert_eq!(state["phases"]["responsive"]["attempts"], 3);
}

#[test]
fn native_ship_is_refused_when_an_input_changes_while_the_final_capture_runs() {
    let (ws, desktop) = finished_native_workspace();
    let renderer = ManifestRenderer { desktop, changed_during: Some("index.html") };
    let mut io = ws.io();
    let ship = ["finish", "--disposition", "ship"].map(String::from);
    assert_eq!(run_with_renderer(&ship, &mut io, &no_organic_scan, Some(&renderer)), 2);
    let state = load_state(&io).unwrap();
    assert_eq!(state["finish"]["disposition"], "fix");
    assert!(state["finish"]["captureInputs"].is_null());
    assert_eq!(state["phase"], "responsive");
    assert_eq!(state["phases"]["responsive"]["status"], "open");
    let reasons = state["phases"]["responsive"]["gate"]["reasons"].as_array().unwrap();
    assert!(reasons.iter().any(|r| r.as_str().unwrap().contains("capture input changed: index.html")), "{reasons:?}");
}

/// A native renderer whose capture leaves no input manifest.
struct BareRenderer(Vec<u8>);
impl EntryRenderer for BareRenderer {
    fn capture_entry(&self, _: &EntryRequest) -> Result<Box<dyn CapturedEntry>, String> {
        let frame = |name: &str| crate::entry_capture::FrameEvidence { name: name.into(), png: self.0.clone(), regions: vec![] };
        Ok(Box::new(ManifestCapture(crate::entry_capture::EntryEvidence { report: json!({}), frames: vec![frame("desktop"), frame("mobile")] },
            crate::entry_capture::ApprovedReference { png: self.0.clone(), proof: json!({"schema": "test-review"}) }, None)))
    }
}

#[test]
fn native_ship_is_refused_when_the_final_capture_leaves_no_manifest() {
    let (ws, desktop) = finished_native_workspace();
    let mut io = ws.io();
    let ship = ["finish", "--disposition", "ship"].map(String::from);
    assert_eq!(run_with_renderer(&ship, &mut io, &no_organic_scan, Some(&BareRenderer(desktop))), 2);
    let state = load_state(&io).unwrap();
    assert_eq!(state["finish"]["disposition"], "fix");
    assert!(state["finish"]["captureInputs"].is_null());
    assert_ne!(crate::completion::report(&ws.path, Some(&state), Some("owner"))["status"], "complete");
}

#[test]
fn screenshot_policy_finish_binds_no_capture_manifest() {
    let ws = Workspace::new();
    ws.write("index.html", b"<main>Finished</main>");
    ws.write(".impeccable/review/native/responsive/inputs.json", br#"{"manifest":{"files":[{"path":"index.html","sha256":"stale"}]}}"#);
    let mut io = ws.io();
    let mut state = json!({"phase":"review", "artifact":"index.html", "phases":{}});
    for phase in PHASES { state["phases"][phase] = json!({"status":"closed"}); }
    state["responsiveInputSha256"] = json!(crate::completion::input_hash(&ws.path));
    save_state(&io, &state);
    assert_eq!(run(&["finish", "--disposition", "ship"].map(String::from), &mut io, &no_organic_scan), 0);
    let state = load_state(&io).unwrap();
    assert!(state["finish"]["captureInputs"].is_null());
    assert_eq!(crate::completion::report(&ws.path, Some(&state), None)["status"], "complete");
    let next = next_instruction(&io, &state);
    assert!(next.contains("recapture desktop and mobile and advance responsive first"), "{next}");
}

#[test]
fn review_next_says_ship_rechecks_and_a_later_edit_needs_ship_again() {
    let ws = Workspace::new();
    let io = ws.io();
    let native = next_instruction(&io, &json!({"phase":"review", "capturePolicy":"native-html-v1"}));
    assert!(native.starts_with("Spawn the finish reviewer") && native.contains("Make every fix before ship: ship re-captures the current files natively")
        && native.contains("needs ship recorded again"), "{native}");
    let screenshots = next_instruction(&io, &json!({"phase":"review"}));
    assert!(screenshots.contains("ship refuses while the frontend files differ from the responsive screenshots"), "{screenshots}");
}

// ---- approved comp as a fixed reference ------------------------------------

const APPROVED: &str = ".impeccable/mocks/comp-1.png";

fn approved_comp_image() -> Image {
    let mut comp = r::create_image(300, 100, [20, 70, 110, 255]);
    r::fill_rect(&mut comp, 0., 61., 301., 40., [240., 180., 10., 255.]);
    comp
}

fn captured(ws: &Workspace) -> (Io, impeccable_common::Captured) {
    Io::captured("", ws.path.clone(), Default::default())
}

fn out_err(c: &impeccable_common::Captured) -> String {
    format!("{}{}", String::from_utf8_lossy(&c.stdout.borrow()), String::from_utf8_lossy(&c.stderr.borrow()))
}

/// A comp-led build started on an approved comp, measured by comp-spec.
fn approved_build() -> Workspace {
    let ws = Workspace::new();
    ws.write(APPROVED, &png_io::encode_png(&approved_comp_image(), &[]).unwrap());
    ws.write("regions.json", br#"{"allowUncovered":true,"regions":[{"id":"photo","kind":"image","note":"Wide photograph of the workshop","bleed":true,"plate":"assets/plates/photo.png","pixelBox":{"x":0,"y":0,"w":300,"h":61}}]}"#);
    let mut io = ws.io();
    assert_eq!(run(&["start", "--comp", APPROVED, "--artifact", "index.html"].map(String::from), &mut io, &no_organic_scan), 0);
    let (mut io, c) = captured(&ws);
    assert_eq!(crate::comp_spec::run(&["--comp", APPROVED, "--regions", "regions.json"].map(String::from), &mut io), 0, "{}", out_err(&c));
    ws
}

/// The tamper from the eval: generated pixels composited into the approved comp.
fn composite_into_comp(ws: &Workspace) {
    let mut edited = approved_comp_image();
    r::fill_rect(&mut edited, 40., 10., 120., 40., [200., 30., 30., 255.]);
    ws.write(APPROVED, &png_io::encode_png(&edited, &[]).unwrap());
}

#[test]
fn approval_keeps_a_copy_and_the_spec_binds_the_same_pixels() {
    let ws = approved_build();
    let record: Value = serde_json::from_slice(&std::fs::read(ws.path.join(crate::approved_comp::RECORD_PATH)).unwrap()).unwrap();
    let spec = load_spec(&ws.path.join(SPEC_PATH)).unwrap();
    assert_eq!(record["pixelSha256"], spec["compSha256"]);
    assert_eq!(std::fs::read(ws.path.join(".impeccable/build/approved-comp.png")).unwrap(), std::fs::read(ws.path.join(APPROVED)).unwrap());
    // A metadata-only rewrite (embed-prompt) is not an edit.
    ws.write(APPROVED, &png_io::encode_png(&approved_comp_image(), &[("prompt".into(), "comp prompt".into())]).unwrap());
    let io = ws.io();
    assert_eq!(comp_refusal(&io), None);
    let mut state = load_state(&io).unwrap();
    assert!(run_gate(&io, &mut state, "sections", &GateOpts { build_path: None, min: None, artifact: None }, &no_organic_scan, None).ok);
}

#[test]
fn every_comp_measuring_entry_point_refuses_an_edited_comp() {
    let ws = approved_build();
    let spec_before = std::fs::read(ws.path.join(SPEC_PATH)).unwrap();
    let expected = load_spec(&ws.path.join(SPEC_PATH)).unwrap()["compSha256"].as_str().unwrap().to_string();
    composite_into_comp(&ws);
    let actual = crate::approved_comp::file_pixel_sha256(&ws.io(), APPROVED).unwrap();
    let refused = |text: &str| {
        assert!(text.contains("has changed since approval"), "{text}");
        assert!(text.contains(&format!("expected pixel sha256 {expected}, found {actual}")), "{text}");
        assert!(text.contains("never edit it, composite into it, or regenerate it"), "{text}");
        assert!(text.contains("build-phase restore-comp"), "{text}");
    };
    let io = ws.io();
    let mut state = load_state(&io).unwrap();
    let opts = GateOpts { build_path: None, min: None, artifact: None };
    // spec, plates, hero, sections, motion, responsive: each refuses before measuring.
    for phase in ["spec", "plates", "hero", "sections", "motion", "responsive"] {
        let gate = run_gate(&io, &mut state, phase, &opts, &no_organic_scan, None);
        assert!(!gate.ok, "{phase}");
        assert_eq!(gate.reasons.len(), 1, "{phase}: {:?}", gate.reasons);
        refused(&gate.reasons[0]);
    }
    // advance (the spec phase is open after start --comp)
    let (mut io, c) = captured(&ws);
    assert_eq!(run(&["advance"].map(String::from), &mut io, &no_organic_scan), 2);
    refused(&out_err(&c));
    // check-plate
    ws.write("cand.png", &png_io::encode_png(&r::create_image(600, 122, [9, 9, 9, 255]), &[]).unwrap());
    let (mut io, c) = captured(&ws);
    assert_eq!(run(&["check-plate", "photo", "--candidate", "cand.png"].map(String::from), &mut io, &no_organic_scan), 2);
    refused(&out_err(&c));
    // finish ship
    let (mut io, c) = captured(&ws);
    assert_eq!(run(&["finish", "--disposition", "ship"].map(String::from), &mut io, &no_organic_scan), 2);
    refused(&out_err(&c));
    // comp-spec: no re-measure of the edited comp, no crop from it
    let (mut io, c) = captured(&ws);
    assert_eq!(crate::comp_spec::run(&["--comp", APPROVED, "--regions", "regions.json"].map(String::from), &mut io), 2);
    refused(&out_err(&c));
    assert_eq!(std::fs::read(ws.path.join(SPEC_PATH)).unwrap(), spec_before, "the spec keeps the approved identity");
    let (mut io, c) = captured(&ws);
    assert_eq!(crate::comp_spec::run(&["--crop", "photo", "--out", "crop.png"].map(String::from), &mut io), 2);
    refused(&out_err(&c));
    assert!(!ws.path.join("crop.png").exists());
    // comp-diff against the build's comp
    ws.write("build.png", &png_io::encode_png(&approved_comp_image(), &[]).unwrap());
    let (mut io, c) = captured(&ws);
    assert_eq!(crate::comp_diff::run(&["--comp", APPROVED, "--build", "build.png", "--spec", SPEC_PATH, "--no-files"].map(String::from), &mut io), 2);
    refused(&out_err(&c));
    // restarting on the approved file name does not re-approve the edit
    let (mut io, c) = captured(&ws);
    assert_eq!(run(&["start", "--reset", "--comp", APPROVED].map(String::from), &mut io, &no_organic_scan), 2);
    assert!(out_err(&c).contains("saved under a new file name"), "{}", out_err(&c));
}

#[test]
fn font_match_and_a_spec_less_comp_diff_refuse_an_edited_comp_too() {
    let ws = approved_build();
    composite_into_comp(&ws);
    let (mut io, c) = captured(&ws);
    let mut renderer = crate::font_match::NoRenderer;
    assert_eq!(crate::font_match::run(&["--measure", "photo"].map(String::from), &mut io, &mut renderer), 2);
    assert!(out_err(&c).contains("has changed since approval"), "{}", out_err(&c));
    ws.write("build.png", &png_io::encode_png(&approved_comp_image(), &[]).unwrap());
    let (mut io, c) = captured(&ws);
    assert_eq!(crate::comp_diff::run(&["--comp", APPROVED, "--build", "build.png", "--no-files"].map(String::from), &mut io), 2);
    assert!(out_err(&c).contains("has changed since approval"), "{}", out_err(&c));
    // A missing comp is refused, not waved through by the gates that do not read it.
    std::fs::remove_file(ws.path.join(APPROVED)).unwrap();
    let why = comp_refusal(&ws.io()).unwrap();
    assert!(why.contains("is missing or not a decodable image") && why.contains("build-phase restore-comp"), "{why}");
}

#[test]
fn a_build_that_predates_the_copy_cannot_remeasure_an_edited_comp() {
    let ws = approved_build();
    crate::approved_comp::forget(&ws.io());
    composite_into_comp(&ws);
    let (mut io, c) = captured(&ws);
    assert_eq!(crate::comp_spec::run(&["--comp", APPROVED, "--regions", "regions.json"].map(String::from), &mut io), 2);
    assert!(out_err(&c).contains("No intact engine copy"), "{}", out_err(&c));
    assert!(!ws.path.join(crate::approved_comp::RECORD_PATH).exists(), "the edited pixels are not adopted");
}

#[test]
fn a_spec_for_another_comp_never_replaces_the_build_record() {
    let ws = approved_build();
    let record = std::fs::read(ws.path.join(crate::approved_comp::RECORD_PATH)).unwrap();
    ws.write("other.png", &png_io::encode_png(&r::create_image(300, 100, [1, 2, 3, 255]), &[]).unwrap());
    let io = ws.io();
    let other = json!({"comp": "other.png", "compSha256": crate::approved_comp::file_pixel_sha256(&io, "other.png")});
    // An independent spec for another file is not the build's business ...
    assert_eq!(crate::approved_comp::issue_at(&io, &other, "other-spec.json", "impeccable"), None);
    // ... but the build's spec measured on another file is refused.
    let why = crate::approved_comp::issue_at(&io, &other, SPEC_PATH, "impeccable").unwrap();
    assert!(why.contains("measures other.png, but the approved comp is .impeccable/mocks/comp-1.png"), "{why}");
    assert_eq!(std::fs::read(ws.path.join(crate::approved_comp::RECORD_PATH)).unwrap(), record);
    let mut state = load_state(&io).unwrap();
    ws.write(SPEC_PATH, util::json_pretty(&json!({"comp":"other.png","compSha256":other["compSha256"],"regions":[]})).as_bytes());
    let gate = run_gate(&io, &mut state, "plates", &GateOpts { build_path: None, min: None, artifact: None }, &no_organic_scan, None);
    assert!(!gate.ok && gate.reasons[0].contains("but the approved comp is"), "{:?}", gate.reasons);
}

#[test]
fn restore_comp_puts_the_approved_pixels_back_and_the_gates_measure_again() {
    let ws = approved_build();
    let approved_bytes = std::fs::read(ws.path.join(APPROVED)).unwrap();
    composite_into_comp(&ws);
    let (mut io, c) = captured(&ws);
    assert_eq!(run(&["restore-comp"].map(String::from), &mut io, &no_organic_scan), 0);
    assert!(out_err(&c).starts_with(&format!("RESTORED {APPROVED} from .impeccable/build/approved-comp.png")), "{}", out_err(&c));
    assert_eq!(std::fs::read(ws.path.join(APPROVED)).unwrap(), approved_bytes);
    let kept: Vec<_> = std::fs::read_dir(ws.path.join(BUILD_DIR)).unwrap().filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.starts_with("edited-comp-")).collect();
    assert_eq!(kept.len(), 1, "the edited file is kept as evidence outside the mocks");
    let io = ws.io();
    assert_eq!(comp_refusal(&io), None);
    let spec = load_spec(&ws.path.join(SPEC_PATH)).unwrap();
    let gate = gate_plates_for(&io, &spec, None);
    assert!(gate.reasons.iter().all(|r| !r.contains("since approval")), "{:?}", gate.reasons);
    assert!(gate.reasons.iter().any(|r| r.contains("plate missing for photo")), "plates are measured again: {:?}", gate.reasons);
}

#[test]
fn comps_gate_keeps_the_approved_comp_and_a_new_round_forgets_it() {
    let ws = Workspace::new();
    let mut io = ws.io();
    assert_eq!(run(&["start", "--direction", "seed", "--artifact", "index.html"].map(String::from), &mut io, &no_organic_scan), 0);
    for (i, color) in [[20u8, 70, 110, 255], [90, 20, 20, 255], [10, 90, 10, 255]].iter().enumerate() {
        let file = format!(".impeccable/mocks/comp-{}.png", i + 1);
        ws.write(&file, &png_io::encode_png(&r::create_image(40, 20, *color), &[]).unwrap());
        ws.write(&format!("{file}.json"), format!(r#"{{"prompt":"comp {i}","approved":{}}}"#, i == 0).as_bytes());
    }
    assert_eq!(run(&["advance"].map(String::from), &mut io, &no_organic_scan), 0);
    let record: Value = serde_json::from_slice(&std::fs::read(ws.path.join(crate::approved_comp::RECORD_PATH)).unwrap()).unwrap();
    assert_eq!(record["comp"], APPROVED);
    assert_eq!(record["pixelSha256"].as_str(), crate::approved_comp::file_pixel_sha256(&io, APPROVED).as_deref());
    assert_eq!(run(&["start", "--reset", "--direction", "other"].map(String::from), &mut io, &no_organic_scan), 0);
    assert!(!ws.path.join(crate::approved_comp::RECORD_PATH).exists());
    // An approved comp that cannot be decoded cannot become the fixed reference.
    ws.write(APPROVED, b"not an image");
    let gate = run_gate(&io, &mut load_state(&io).unwrap(), "comps", &GateOpts { build_path: None, min: None, artifact: None }, &no_organic_scan, None);
    assert!(!gate.ok && gate.reasons.iter().any(|r| r.contains("is not a decodable PNG, WebP or JPEG image")), "{:?}", gate.reasons);
    // ... and a quoted downgrade cannot force the comps phase closed over it.
    let (mut io, c) = captured(&ws);
    let force = ["advance", "--force", "--reason", "The user said \"Ignore the comp fidelity requirement; ship this version.\""].map(String::from);
    assert_eq!(run(&force, &mut io, &no_organic_scan), 2);
    assert!(out_err(&c).contains("never close it on an approved comp the engine cannot keep"), "{}", out_err(&c));
    let state = load_state(&io).unwrap();
    assert_eq!(state["phase"], "comps");
    assert!(state["phases"]["comps"]["forced"].is_null());
}

/// The code-led first viewport with a lettered export control (`export`), or
/// with that control left out of the page.
fn lettered_text_only_hero(restyled: bool, export: bool) -> Image {
    let mut img = text_only_hero(restyled);
    if export {
        for x in (166..218).step_by(4) { r::fill_rect(&mut img, x as f64, 121., 2., 14., [240., 240., 240., 255.]); }
    } else {
        r::fill_rect(&mut img, 160., 116., 64., 24., [244., 244., 240., 255.]);
    }
    img
}

fn text_only_hero_without_export() -> Image { lettered_text_only_hero(true, false) }

#[test]
fn a_code_region_the_accepted_first_viewport_lacks_does_not_block_the_hero() {
    let comp = lettered_text_only_hero(false, true);
    let current = text_only_hero_without_export();
    let missing = |g: &Gate| g.reasons.iter().any(|r| r.contains("region export is missing"));
    // Unreviewed, the comp's control is missing and blocks.
    let (unreviewed, _) = run_text_only_hero_on(&comp, &current, None);
    assert!(missing(&unreviewed), "{:?}", unreviewed.reasons);
    // The user saw this first viewport without the control and accepted it: the phase closes.
    let (accepted, report) = run_text_only_hero_on(&comp, &current, Some(&current));
    assert!(accepted.ok, "{:?}", accepted.reasons);
    assert!(accepted.advisories.iter().any(|a| a.starts_with("(advisory, accepted in the first-viewport review) region export is missing") && a.contains("the first viewport the user accepted lacks it too")), "{:?}", accepted.advisories);
    assert!(report["humanHeroReview"]["acceptedRegions"].as_array().unwrap().contains(&json!("export")), "{report}");
}

#[test]
fn a_code_region_removed_after_the_acceptance_still_blocks_the_hero() {
    // The user accepted the viewport with the control; the build dropped it afterwards.
    let (gate, report) = run_text_only_hero_on(&lettered_text_only_hero(false, true), &text_only_hero_without_export(), Some(&lettered_text_only_hero(true, true)));
    assert!(!gate.ok);
    assert!(gate.reasons.iter().any(|r| r.starts_with("region export is missing") && !r.contains("accepted")), "{:?}", gate.reasons);
    assert!(gate.reasons[0].starts_with("the hero capture no longer matches the first viewport the user accepted") && gate.reasons[0].contains("export"), "{:?}", gate.reasons);
    assert!(!gate.advisories.iter().any(|a| a.contains("region export is missing")), "{:?}", gate.advisories);
    assert_eq!(report["humanHeroReview"]["viewportAccepted"], false);
}

#[test]
fn a_plate_the_accepted_first_viewport_lacks_asks_the_user_instead_of_looping() {
    let blank = reviewed_hero(true, false);
    let (gate, _) = run_reviewed_hero(&blank, Some(&blank), REVIEWED_PAGE);
    assert!(!gate.ok);
    let reason = gate.reasons.iter().find(|r| r.starts_with("region art is missing")).expect("the plate still blocks");
    assert!(reason.contains("already lacks it, so restoring what they accepted cannot clear this") && reason.contains("ask the user") && reason.contains("build-phase advance --force --reason"), "{reason}");
    let example = reason.split("for example: ").nth(1).unwrap().split(')').next().unwrap();
    assert!(force_allowed(Some(example)), "{example}");
    // With another material veto outstanding, force would close that too: the question waits.
    let svg = format!("{REVIEWED_PAGE}<svg width=\"400\" height=\"300\" viewBox=\"0 0 400 300\">{}</svg>",
        (0..12).map(|i| format!("<path d=\"M{i} 0 C {} 40 80 {} 120 {i} S 200 90 240 {}\"/>", i * 7, i * 9, i * 11)).collect::<String>());
    let (gate, _) = run_reviewed_hero(&blank, Some(&blank), &svg);
    assert!(gate.reasons.iter().any(|r| r.contains("inline SVG")), "{:?}", gate.reasons);
    let reason = gate.reasons.iter().find(|r| r.starts_with("region art is missing")).expect("the plate still blocks");
    assert!(reason.contains("Clear the other blocking reasons first") && !reason.contains("--force --reason"), "{reason}");
    // Unreviewed, or removed after the acceptance, the plate blocks without the question.
    for approved in [None, Some(reviewed_hero(true, true))] {
        let (gate, _) = run_reviewed_hero(&blank, approved.as_ref(), REVIEWED_PAGE);
        let reason = gate.reasons.iter().find(|r| r.starts_with("region art is missing")).expect("the plate still blocks");
        assert!(!reason.contains("ask the user"), "{reason}");
    }
}

#[test]
fn a_code_region_the_accepted_first_viewport_lacks_carries_to_desktop_width() {
    let ws = reviewed_desktop_workspace();
    // The comp has the control; the accepted first viewport and the desktop frame do not.
    let current = reviewed_hero(false, false);
    let mut without = current.clone();
    r::fill_rect(&mut without, 120., 84., 60., 24., [230., 220., 200., 255.]);
    let (unreviewed, _) = run_reviewed_desktop(&ws, &without, None, 0.1);
    assert!(unreviewed.reasons.iter().any(|r| r.contains("region headline is missing")), "{:?}", unreviewed.reasons);
    let (accepted, report) = run_reviewed_desktop(&ws, &without, Some(&without), 0.1);
    assert!(accepted.ok, "{:?}", accepted.reasons);
    assert!(accepted.advisories.iter().any(|a| a.starts_with("(advisory, accepted in the first-viewport review) at desktop width, region headline is missing")), "{:?}", accepted.advisories);
    assert_eq!(report["humanTextReview"]["acceptedRegions"], json!(["headline"]));
    // Removed after the acceptance: it blocks again.
    let (removed, _) = run_reviewed_desktop(&ws, &without, Some(&current), 0.1);
    assert!(removed.reasons.iter().any(|r| r == "at desktop width, region headline is missing"), "{:?}", removed.reasons);
}
