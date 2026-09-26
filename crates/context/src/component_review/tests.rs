use super::{manifest, server, store};
use serde_json::{Value, json};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);

#[test]
fn first_viewport_acceptance_closes_both_review_stages_after_later_edits() {
    let f = Fixture::new();
    let mut kit = f.manifest();
    kit["id"] = json!("kit");
    kit["stage"] = json!("components");
    // A native captured fixture; no browser or model calls in this unit test.
    let mut hero = f.manifest();
    hero["stage"] = json!("hero");
    let dir = store::prepare_captured(&f.store, &f.project, &hero, Some(&mut Native)).unwrap();
    let state = store::read(&dir.join("current.json")).unwrap();
    let receipt = store::submit(&dir, &approve(&state)).unwrap();
    assert_eq!(receipt["visualDecision"], "approved");
    fs::write(f.project.join("shared.css"), "footer{color:blue}").unwrap();
    fs::write(
        f.project.join("control.html"),
        "<button>Updated page</button>",
    )
    .unwrap();
    let result =
        super::lifecycle::inspect(&[dir.clone()], &["components".into(), "hero".into()]).unwrap();
    assert_eq!(result["status"], "accepted");
    assert_eq!(result["scope"], "first-viewport");
    assert_eq!(result["completionFeedback"], Value::Null);
    // Neither a new assembly ID nor a kit request creates a round or edits the receipt.
    hero["id"] = json!("another-assembly");
    assert_eq!(store::prepare(&f.store, &f.project, &hero).unwrap(), dir);
    assert_eq!(store::prepare(&f.store, &f.project, &kit).unwrap(), dir);
    assert_eq!(
        store::read(&dir.join("current.json")).unwrap()["receipt"],
        receipt
    );
    assert_eq!(
        super::verify::approved(&f.store, &f.project, "no-new-manifest.json").unwrap(),
        receipt
    );
}

#[test]
fn new_build_does_not_inherit_terminal_review_and_foreign_corruption_is_ignored() {
    let f=Fixture::new();
    let bad=f.store.join("a".repeat(64));fs::create_dir_all(&bad).unwrap();
    fs::write(bad.join("current.json"),"broken JSON").unwrap();
    let mut hero=f.manifest();hero["stage"]=json!("hero");
    let dir=store::prepare_captured(&f.store,&f.project,&hero,Some(&mut Native)).unwrap();
    let state=store::read(&dir.join("current.json")).unwrap();
    store::submit(&dir,&approve(&state)).unwrap();
    assert!(super::lifecycle::final_session(&f.store,&f.project.canonicalize().unwrap()).unwrap().is_some());
    fs::create_dir_all(f.project.join(".impeccable/build")).unwrap();
    fs::write(f.project.join(".impeccable/build/state.json"),r#"{"startedAt":"new-build","artifact":"index.html"}"#).unwrap();
    assert!(super::lifecycle::final_session(&f.store,&f.project.canonicalize().unwrap()).unwrap().is_none());
    let next=store::prepare(&f.store,&f.project,&hero).unwrap();
    assert_eq!(next,dir);
    let next=store::read(&next.join("current.json")).unwrap();
    assert!(next["receipt"].is_null());
    assert!(next["draft"]["decisions"].as_object().unwrap().is_empty());
    assert_eq!(next["packet"]["round"],2);
}

#[test]
fn needs_work_and_unverified_receipts_never_close_review() {
    let f = Fixture::new();
    let mut hero = f.manifest();
    hero["stage"] = json!("hero");
    let dir = store::prepare(&f.store, &f.project, &hero).unwrap();
    let state = store::read(&dir.join("current.json")).unwrap();
    store::submit(&dir, &approve(&state)).unwrap();
    assert!(!super::lifecycle::closed(
        &store::read(&dir.join("current.json")).unwrap()
    ));
    let mut state = state;
    state["capture"] = json!({"schema":"native-component-previews-v1"});
    state["receipt"] = json!({"captureVerified":true,"visualDecision":"changes-requested",
        "capture":state["capture"],"submission":{"requestId":state["packet"]["id"],"packetRevision":state["packet"]["revision"]}});
    store::write(&dir.join("current.json"), &state).unwrap();
    assert!(!super::lifecycle::closed(&state));
    let result = super::lifecycle::inspect(&[dir], &["hero".into()]).unwrap();
    assert_eq!(result["status"], "pending");
    assert!(result["completionFeedback"]
        .as_str()
        .unwrap()
        .contains("not approved"));
}

#[test]
fn hosted_capture_routes_to_the_review_tool_before_browser_or_store_access() {
    let f = Fixture::new();
    let (mut io, captured) = impeccable_common::Io::captured("", f.project.clone(),
        std::collections::HashMap::from([
            ("HOME".into(), f.root.to_string_lossy().into_owned()),
            ("IMPECCABLE_COMPONENT_REVIEW_TOOL".into(), "component_review".into()),
        ]));
    let args = vec!["capture".into(), "--manifest".into(), "review.json".into()];
    assert_eq!(super::run_with_capturer(&args, &mut io, None), 1);
    let error = String::from_utf8(captured.stderr.borrow().clone()).unwrap();
    assert!(error.contains("Call component_review with manifest_path=\"review.json\""), "{error}");
    assert!(!f.root.join(".impeccable").exists());
}
struct Fixture {
    root: PathBuf,
    project: PathBuf,
    store: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "impeccable-component-review-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let project = root.join("project");
        let store = root.join("store");
        fs::create_dir_all(&project).unwrap();
        for (name, body) in [
            ("comp.png", b"comp".as_slice()),
            ("art.png", b"art"),
            ("control.html", b"<button>Go</button>"),
            ("shared.css", b"button{color:red}"),
        ] {
            fs::write(project.join(name), body).unwrap();
        }
        Self {
            root,
            project,
            store,
        }
    }
    fn manifest(&self) -> Value {
        json!({"schemaVersion":1,"id":"hero","title":"Hero review","comp":{"path":"comp.png","width":100,"height":100},"components":[{"id":"art","name":"Art","medium":"Raster","note":"Illustration","box":{"x":0,"y":0,"w":0.5,"h":1},"preview":{"kind":"image","path":"art.png"},"dependencies":[]},{"id":"control","name":"Control","medium":"HTML","note":"Semantic control","box":{"x":0.5,"y":0,"w":0.5,"h":1},"preview":{"kind":"page","path":"control.html"},"dependencies":["shared.css"]}]})
    }
    fn prepare(&self) -> PathBuf {
        store::prepare(&self.store, &self.project, &self.manifest()).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
fn approve(state: &Value) -> Value {
    let mut decisions = serde_json::Map::new();
    for c in state["packet"]["components"].as_array().unwrap() {
        decisions.insert(
            c["id"].as_str().unwrap().into(),
            json!({"revision":c["revision"],"action":"approve","feedback":"","split":false}),
        );
    }
    json!({"schemaVersion":1,"requestId":state["packet"]["id"],"packetRevision":state["packet"]["revision"],"decisions":decisions,"missing":[],"inventoryConfirmed":true})
}
#[test]
fn immutable_snapshots_and_idempotent_feedback_survive_reload() {
    let f = Fixture::new();
    let dir = f.prepare();
    let state = store::read(&dir.join("current.json")).unwrap();
    let body = approve(&state);
    let receipt = store::submit(&dir, &body).unwrap();
    assert_eq!(store::submit(&dir, &body).unwrap(), receipt);
    assert_eq!(
        store::read(&dir.join("current.json")).unwrap()["receipt"],
        receipt
    );
    assert_eq!(receipt["reviewer"], "local-browser");
    assert_eq!(receipt["captureVerified"], false);
    let mut conflict = body;
    conflict["decisions"]["art"]["feedback"] = json!("different");
    assert!(
        store::submit(&dir, &conflict)
            .unwrap_err()
            .contains("already")
    );
}
#[test]
fn source_change_rejects_pending_approval_and_invalidates_only_affected_components() {
    let f = Fixture::new();
    let dir = f.prepare();
    let first = store::read(&dir.join("current.json")).unwrap();
    store::submit(&dir, &approve(&first)).unwrap();
    fs::write(f.project.join("art.png"), b"new art").unwrap();
    let dir = f.prepare();
    let next = store::read(&dir.join("current.json")).unwrap();
    assert_ne!(first["packet"]["revision"], next["packet"]["revision"]);
    assert!(next["draft"]["decisions"]["art"].is_null());
    assert_eq!(next["draft"]["decisions"]["control"]["action"], "approve");
    assert_eq!(next["draft"]["inventoryConfirmed"], false);
    assert!(
        store::submit(&dir, &approve(&first))
            .unwrap_err()
            .contains("stale")
    );
    fs::write(f.project.join("shared.css"), b"changed again").unwrap();
    assert!(
        store::submit(&dir, &approve(&next))
            .unwrap_err()
            .contains("stale")
    );
}
#[test]
fn missing_regions_persist_across_rounds_and_old_receipts_are_preserved() {
    let f = Fixture::new();
    let dir = f.prepare();
    let first = store::read(&dir.join("current.json")).unwrap();
    let mut body = approve(&first);
    body["missing"] = json!([{"id":"missing-1","name":"Brushwork","feedback":"Restore it","box":{"x":0.2,"y":0.2,"w":0.1,"h":0.1}}]);
    body["inventoryConfirmed"] = json!(false);
    let receipt = store::submit(&dir, &body).unwrap();
    fs::write(f.project.join("art.png"), b"repair").unwrap();
    f.prepare();
    let next = store::read(&dir.join("current.json")).unwrap();
    assert_eq!(next["draft"]["missing"], body["missing"]);
    let history = store::read(&dir.join(format!(
        "revisions/{}.json",
        first["packet"]["revision"].as_str().unwrap()
    )))
    .unwrap();
    assert_eq!(history["receipt"], receipt);
}
#[test]
fn refusal_paths_cannot_be_turned_into_approval() {
    let f = Fixture::new();
    let dir = f.prepare();
    let state = store::read(&dir.join("current.json")).unwrap();
    let mut body = approve(&state);
    body["inventoryConfirmed"] = json!(false);
    assert!(store::submit(&dir, &body).is_err());
    body["inventoryConfirmed"] = json!(true);
    body["decisions"]["art"]["action"] = json!("skip");
    assert!(store::submit(&dir, &body).is_err());
    body["decisions"]["art"]["action"] = json!("approve");
    body["decisions"]["art"]["revision"] = json!("invented");
    assert!(store::submit(&dir, &body).is_err());
    assert!(store::read(&dir.join("current.json")).unwrap()["receipt"].is_null());
}
#[test]
fn files_are_confined_and_store_is_outside_project() {
    let f = Fixture::new();
    let mut manifest = f.manifest();
    manifest["components"][0]["preview"]["path"] = json!("../outside.png");
    assert!(manifest::freeze(&f.project, &manifest).is_err());
    assert!(
        store::prepare(
            &f.project.join("forged-approvals"),
            &f.project,
            &f.manifest()
        )
        .is_err()
    );
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&f.root, f.project.join("outside")).unwrap();
        manifest["components"][0]["preview"]["path"] = json!("outside/project/art.png");
        let frozen = manifest::freeze(&f.project, &manifest);
        assert!(frozen.is_ok());
        std::os::unix::fs::symlink("/etc/hosts", f.project.join("leak")).unwrap();
        manifest["components"][0]["preview"]["path"] = json!("leak");
        assert!(manifest::freeze(&f.project, &manifest).is_err());
    }
}
#[test]
fn malformed_maps_and_cross_origin_posts_are_rejected() {
    let f = Fixture::new();
    let mut manifest = f.manifest();
    manifest["components"][0]["box"]["w"] = json!(0);
    assert!(manifest::freeze(&f.project, &manifest).is_err());
    assert!(server::authorized(
        "POST",
        Some("127.0.0.1:4321"),
        Some("http://127.0.0.1:4321"),
        Some("same-origin"),
        4321
    ));
    for origin in [None, Some("null"), Some("https://evil.example")] {
        assert!(!server::authorized(
            "POST",
            Some("127.0.0.1:4321"),
            origin,
            Some("same-origin"),
            4321
        ));
    }
    assert!(!server::authorized(
        "GET",
        Some("evil.example"),
        None,
        None,
        4321
    ));
    assert!(super::decode_path("a%20b.png").is_ok());
    assert!(super::decode_path("%00").is_err());
}

#[test]
fn prepare_cli_reports_an_existing_receipt_instead_of_requesting_review_again() {
    let f = Fixture::new();
    fs::write(
        f.project.join("review.json"),
        serde_json::to_vec(&f.manifest()).unwrap(),
    )
    .unwrap();
    let args = vec![
        "prepare".into(),
        "--manifest".into(),
        "review.json".into(),
        "--store".into(),
        f.store.to_string_lossy().into_owned(),
    ];
    let invoke = || {
        let (mut io, captured) =
            impeccable_common::Io::captured("", f.project.clone(), Default::default());
        assert_eq!(super::run(&args, &mut io), 0);
        let result = serde_json::from_slice::<Value>(&captured.stdout.borrow()).unwrap();
        result
    };
    let initial = invoke();
    assert_eq!(initial["status"], "awaiting-review");
    let dir = f.store.join(initial["session"].as_str().unwrap());
    let first = store::read(&dir.join("current.json")).unwrap();
    store::submit(&dir, &approve(&first)).unwrap();
    assert_eq!(invoke()["status"], "approved");
}

#[test]
fn repair_history_records_feedback_changes_and_removed_components() {
    let f = Fixture::new();
    let dir = f.prepare();
    let first = store::read(&dir.join("current.json")).unwrap();
    let mut body = approve(&first);
    body["decisions"]["art"]["action"] = json!("revise");
    body["decisions"]["art"]["feedback"] = json!("Preserve the motif");
    store::submit(&dir, &body).unwrap();
    fs::write(f.project.join("art.png"), b"repair").unwrap();
    f.prepare();
    let next = store::read(&dir.join("current.json")).unwrap();
    assert_eq!(next["history"]["packet"]["round"], 1);
    assert_eq!(
        next["history"]["draft"]["decisions"]["art"]["feedback"],
        "Preserve the motif"
    );
    assert_eq!(
        next["history"]["changes"]["art"]["files"],
        json!(["art.png"])
    );
    assert_eq!(next["history"]["changes"]["control"]["kind"], "unchanged");
    let mut manifest = f.manifest();
    manifest["components"].as_array_mut().unwrap().remove(1);
    store::prepare(&f.store, &f.project, &manifest).unwrap();
    let removed = store::read(&dir.join("current.json")).unwrap();
    assert_eq!(removed["history"]["removed"][0]["id"], "control");
    assert_eq!(removed["draft"]["inventoryConfirmed"], false);
}
#[test]
fn reverting_to_old_content_cannot_reuse_an_old_round_or_approval() {
    let f = Fixture::new();
    let dir = f.prepare();
    let first = store::read(&dir.join("current.json")).unwrap();
    store::submit(&dir, &approve(&first)).unwrap();
    fs::write(f.project.join("art.png"), b"repair").unwrap();
    f.prepare();
    fs::write(f.project.join("art.png"), b"art").unwrap();
    f.prepare();
    let third = store::read(&dir.join("current.json")).unwrap();
    assert_eq!(third["packet"]["round"], 3);
    assert_ne!(first["packet"]["revision"], third["packet"]["revision"]);
    assert!(store::submit(&dir, &approve(&first)).is_err());
    assert!(third["draft"]["decisions"]["art"].is_null());
    let archive = store::read(&dir.join(format!(
        "revisions/{}.json",
        first["packet"]["revision"].as_str().unwrap()
    )))
    .unwrap();
    assert_eq!(archive["packet"]["round"], 1);
    assert_eq!(archive["receipt"]["visualDecision"], "approved");
}

#[test]
fn preparing_again_before_a_reply_preserves_outstanding_feedback_and_carried_approvals() {
    let f = Fixture::new();
    let dir = f.prepare();
    let first = store::read(&dir.join("current.json")).unwrap();
    let mut body = approve(&first);
    body["decisions"]["art"]["action"] = json!("revise");
    body["decisions"]["art"]["feedback"] = json!("Keep the motif");
    store::submit(&dir, &body).unwrap();
    fs::write(f.project.join("art.png"), b"repair one").unwrap();
    f.prepare();
    fs::write(f.project.join("art.png"), b"repair two").unwrap();
    f.prepare();
    let third = store::read(&dir.join("current.json")).unwrap();
    assert_eq!(
        third["history"]["feedback"]["art"]["decision"]["feedback"],
        "Keep the motif"
    );
    assert_eq!(third["history"]["feedback"]["art"]["round"], 1);
    assert_eq!(third["history"]["changes"]["control"]["carried"], true);
    store::submit(&dir, &approve(&third)).unwrap();
    fs::write(f.project.join("art.png"), b"another version").unwrap();
    f.prepare();
    let fourth = store::read(&dir.join("current.json")).unwrap();
    assert!(fourth["history"]["feedback"]["art"].is_null());
}

#[test]
fn failed_native_capture_does_not_replace_the_current_review() {
    struct Refuse;
    impl super::capture::ComponentCapturer for Refuse {
        fn capture(
            &mut self,
            _: &mut Value,
            _: &std::collections::BTreeMap<String, Vec<u8>>,
        ) -> Result<super::capture::CapturedPreviews, String> {
            Err("missing stylesheet".into())
        }
    }
    let f = Fixture::new();
    let dir = f.prepare();
    let before = fs::read(dir.join("current.json")).unwrap();
    assert!(
        store::prepare_captured(&f.store, &f.project, &f.manifest(), Some(&mut Refuse))
            .unwrap_err()
            .contains("missing stylesheet")
    );
    assert_eq!(fs::read(dir.join("current.json")).unwrap(), before);
}
#[test]
fn producer_capture_claims_are_never_authority() {
    let f = Fixture::new();
    let mut input = f.manifest();
    input["captureVerified"] = json!(true);
    input["capture"] = json!({"schema":"native-component-previews-v1"});
    input["components"][0]["capture"] = json!({"verified":true});
    input["components"][0]["preview"]["sourceKind"] = json!("page");
    let dir = store::prepare(&f.store, &f.project, &input).unwrap();
    let state = store::read(&dir.join("current.json")).unwrap();
    assert!(state["packet"]["capture"].is_null());
    assert!(state["packet"]["components"][0]["capture"].is_null());
    assert!(state["packet"]["components"][0]["preview"]["sourceKind"].is_null());
    assert_eq!(
        store::submit(&dir, &approve(&state)).unwrap()["captureVerified"],
        false
    );
}

#[test]
fn native_capture_outputs_are_immutable_and_source_changes_invalidate_approval() {
    struct Renderer;
    impl super::capture::ComponentCapturer for Renderer {
        fn capture(
            &mut self,
            packet: &mut Value,
            _: &std::collections::BTreeMap<String, Vec<u8>>,
        ) -> Result<super::capture::CapturedPreviews, String> {
            // A trusted in-process renderer double, never a producer JSON claim.
            packet["components"][1]["preview"] = json!({"kind":"image","url":"/files/_review_captures/control.png","sourceKind":"page"});
            Ok(super::capture::CapturedPreviews {
                files: std::collections::BTreeMap::from([(
                    "_review_captures/control.png".into(),
                    b"native pixels".to_vec(),
                )]),
                evidence: json!({"schema":"native-component-previews-v1","components":[{"id":"art"},{"id":"control"}]}),
            })
        }
    }
    let f = Fixture::new();
    let dir =
        store::prepare_captured(&f.store, &f.project, &f.manifest(), Some(&mut Renderer)).unwrap();
    let state = store::read(&dir.join("current.json")).unwrap();
    store::sources_current(&state).unwrap();
    assert!(
        state["sources"]
            .get("_review_captures/control.png")
            .is_none()
    );
    let receipt = store::submit(&dir, &approve(&state)).unwrap();
    assert_eq!(receipt["captureVerified"], true);
    assert_eq!(receipt["reviewer"], "local-browser");
    fs::write(f.project.join("art.png"), b"changed").unwrap();
    assert!(store::sources_current(&state).is_err());
    store::prepare_captured(&f.store, &f.project, &f.manifest(), Some(&mut Renderer)).unwrap();
    let next = store::read(&dir.join("current.json")).unwrap();
    assert!(next["draft"]["decisions"]["art"].is_null());
    assert_eq!(next["draft"]["decisions"]["control"]["action"], "approve");
    assert_ne!(state["packet"]["revision"], next["packet"]["revision"]);
    assert_eq!(
        store::submit(&dir, &approve(&next)).unwrap()["captureVerified"],
        true
    );
}

#[test]
fn changing_manifest_without_prepare_rejects_review_submission() {
    let f = Fixture::new();
    let input = f.manifest();
    let file = f.project.join("review.json");
    fs::write(&file, serde_json::to_vec(&input).unwrap()).unwrap();
    let dir = store::prepare_file(&f.store, &f.project, "review.json", None).unwrap();
    let state = store::read(&dir.join("current.json")).unwrap();
    let mut changed = input;
    changed["components"][0]["box"]["w"] = json!(0.4);
    fs::write(&file, serde_json::to_vec(&changed).unwrap()).unwrap();
    assert!(
        store::submit(&dir, &approve(&state))
            .unwrap_err()
            .contains("stale")
    );
}

#[test]
fn versioned_packet_keeps_submitted_round_when_current_advances() {
    let f = Fixture::new();
    let dir = f.prepare();
    let state = store::read(&dir.join("current.json")).unwrap();
    let revision = state["packet"]["revision"].as_str().unwrap();
    let receipt = store::submit(&dir, &approve(&state)).unwrap();
    assert_eq!(
        server::packet_state(&dir, Some(revision)).unwrap()["receipt"],
        receipt
    );
    fs::write(f.project.join("art.png"), b"new artwork").unwrap();
    f.prepare();
    let old = server::packet_state(&dir, Some(revision)).unwrap();
    assert_eq!(old["packet"], state["packet"]);
    assert_eq!(old["receipt"], receipt);
    assert_eq!(old["historical"], true);
    assert!(old["sourceStatus"].is_null());
    assert_ne!(
        server::packet_state(&dir, None).unwrap()["packet"]["revision"],
        revision
    );
    assert!(server::packet_state(&dir, Some("../../current")).is_err());
    assert!(store::submit(&dir, &approve(&state)).is_err());
}

#[test]
fn verify_requires_native_approval_and_current_manifest_and_dependencies() {
    let f = Fixture::new();
    fs::write(f.project.join("review.json"), f.manifest().to_string()).unwrap();
    let dir = store::prepare_file(&f.store,&f.project,"review.json",Some(&mut Native)).unwrap();
    assert!(super::verify::approved(&f.store,&f.project,"review.json").is_err());
    let state = store::read(&dir.join("current.json")).unwrap();
    let mut needs_work = approve(&state);
    needs_work["decisions"]["art"]["action"] = json!("revise");
    needs_work["decisions"]["art"]["feedback"] = json!("Wrong shape");
    store::submit(&dir,&needs_work).unwrap();
    assert!(super::verify::approved(&f.store,&f.project,"review.json").is_err());
    fs::write(f.project.join("art.png"), b"repaired art").unwrap();
    let dir = store::prepare_file(&f.store,&f.project,"review.json",Some(&mut Native)).unwrap();
    let state = store::read(&dir.join("current.json")).unwrap();
    store::submit(&dir,&approve(&state)).unwrap();
    assert_eq!(super::verify::approved(&f.store,&f.project,"review.json").unwrap()["visualDecision"],"approved");
    fs::write(f.project.join("other.json"), f.manifest().to_string()).unwrap();
    assert!(super::verify::approved(&f.store,&f.project,"other.json").unwrap_err().contains("bind"));
    fs::write(f.project.join("shared.css"), b"changed after approval").unwrap();
    assert!(super::verify::approved(&f.store,&f.project,"review.json").unwrap_err().contains("changed"));
}

#[test]
fn measured_inventory_is_bound_without_repeated_author_dependencies() {
    let f = Fixture::new();
    fs::create_dir_all(f.project.join(".impeccable/build")).unwrap();
    let path = f.project.join(".impeccable/build/spec.json");
    fs::write(&path, br#"{"regions":[{"id":"art","kind":"plate"},{"id":"control","kind":"control"}]}"#).unwrap();
    let mut input = f.manifest(); input["stage"] = json!("components");
    let dir = store::prepare(&f.store, &f.project, &input).unwrap();
    let state = store::read(&dir.join("current.json")).unwrap();
    assert!(state["sources"][".impeccable/build/spec.json"].is_string());
    let mut missing = input.clone(); missing["components"].as_array_mut().unwrap().pop();
    assert!(store::prepare(&f.store, &f.project, &missing).unwrap_err().contains("omitted measured region"));
    let mut flattened = input; flattened["components"][1]["preview"] = json!({"kind":"image","path":"art.png"});
    assert!(store::prepare(&f.store, &f.project, &flattened).unwrap_err().contains("rendered code preview"));
    fs::write(path, br#"{"regions":[]}"#).unwrap();
    assert!(store::sources_current(&state).is_err());
}

#[test]
fn schema_v2_component_manifests_are_retired_but_v2_hero_still_freezes() {
    let f = Fixture::new();
    fs::create_dir_all(f.project.join(".impeccable/build")).unwrap();
    fs::write(f.project.join(".impeccable/build/spec.json"), br#"{"regions":[{"id":"art","kind":"plate"},{"id":"control","kind":"control"}]}"#).unwrap();
    let mut input = f.manifest();
    input["schemaVersion"] = json!(2);
    input["stage"] = json!("components");
    assert!(manifest::freeze(&f.project, &input).unwrap_err().contains("component-review plan"));
    input["stage"] = json!("hero");
    assert!(manifest::freeze(&f.project, &input).is_ok());
    input["stage"] = Value::Null;
    assert!(manifest::freeze(&f.project, &input).is_err());
}

#[test]
fn visual_approvals_survive_shared_source_edits_but_not_changed_scope_or_pixels() {
    struct Renderer(&'static [u8]);
    impl super::capture::ComponentCapturer for Renderer {
        fn capture(
            &mut self,
            packet: &mut Value,
            _: &std::collections::BTreeMap<String, Vec<u8>>,
        ) -> Result<super::capture::CapturedPreviews, String> {
            packet["components"][1]["preview"] = json!({"kind":"image","sourceKind":"page","url":"/files/_review_captures/control.png"});
            Ok(super::capture::CapturedPreviews {
                files: std::collections::BTreeMap::from([(
                    "_review_captures/control.png".into(),
                    self.0.to_vec(),
                )]),
                evidence: json!({"schema":"native-component-previews-v1","components":[{"id":"art"},{"id":"control","views":{"preview":{"kind":"static-code","entry":"control.html","screenshotSha256":manifest::digest(self.0),"viewport":{"width":100,"height":100,"dpr":1}}}}]}),
            })
        }
    }
    let f = Fixture::new();
    let dir = store::prepare_captured(
        &f.store,
        &f.project,
        &f.manifest(),
        Some(&mut Renderer(b"same pixels")),
    )
    .unwrap();
    let before = store::read(&dir.join("current.json")).unwrap();
    store::submit(&dir, &approve(&before)).unwrap();
    fs::write(
        f.project.join("shared.css"),
        b"button{color:red} .unrelated{color:blue}",
    )
    .unwrap();
    assert!(store::sources_current(&before).is_err());
    store::prepare_captured(
        &f.store,
        &f.project,
        &f.manifest(),
        Some(&mut Renderer(b"same pixels")),
    )
    .unwrap();
    let mut after = store::read(&dir.join("current.json")).unwrap();
    assert_ne!(
        before["packet"]["components"][1]["revision"],
        after["packet"]["components"][1]["revision"]
    );
    assert_eq!(after["draft"]["decisions"]["control"]["action"], "approve");
    assert_eq!(
        after["visualApprovalCarry"]["control"]["basis"],
        "identical-native-captures-v1"
    );
    assert!(after["receipt"].is_null());
    assert_eq!(after["history"]["changes"]["control"]["kind"], "unchanged");
    assert_eq!(after["history"]["changes"]["control"]["sourceChanged"], true);
    assert_eq!(after["history"]["changes"]["control"]["carried"], true);
    // Existing pending packets can gain carry-forward without changing their revision.
    after["draft"]["decisions"]
        .as_object_mut()
        .unwrap()
        .remove("control");
    store::write(&dir.join("current.json"), &after).unwrap();
    assert_eq!(store::refresh_approvals(&dir).unwrap(), 1);
    assert_eq!(store::refresh_approvals(&dir).unwrap(), 0);
    let carried = store::read(&dir.join("current.json")).unwrap();
    assert_eq!(carried["packet"], after["packet"]);
    assert_eq!(carried["sources"], after["sources"]);
    // Changed scope, comp, preview bytes, absent proof and corrupt blobs fail closed.
    let previous = store::read(&dir.join(format!(
        "revisions/{}.json",
        before["packet"]["revision"].as_str().unwrap()
    )))
    .unwrap();
    // Component decisions approve the isolated preview, not its contextual
    // surroundings or the dependency closure of a shared document.
    let mut component_previous = previous.clone();
    component_previous["packet"]["stage"] = json!("components");
    let mut component_current = after.clone();
    component_current["packet"]["stage"] = json!("components");
    component_current["packet"]["components"][1]["dependencies"] = json!(["shared.css", "unrelated.png"]);
    component_current["packet"]["components"][1]["context"] = json!({"kind":"image","url":"/files/unrelated-context.png"});
    component_current["capture"]["components"][1]["views"]["preview"]["rasterElements"] = json!(12);
    assert_eq!(super::visual_approval::carry(&component_previous, &mut component_current, &dir.join("blobs")), 1);
    assert_eq!(component_current["draft"]["decisions"]["control"]["action"], "approve");
    assert!(component_current["receipt"].is_null());
    for field in ["box", "medium", "note", "preview"] {
        let mut changed = component_current.clone();
        changed["draft"]["decisions"].as_object_mut().unwrap().remove("control");
        changed["packet"]["components"][1][field] = json!("changed");
        assert_eq!(super::visual_approval::carry(&component_previous, &mut changed, &dir.join("blobs")), 0, "component scope: {field}");
    }
    for field in ["box", "medium", "note", "context"] {
        let mut changed = after.clone();
        changed["packet"]["components"][1][field] = json!("changed");
        assert_eq!(
            super::visual_approval::carry(&previous, &mut changed, &dir.join("blobs")),
            0,
            "{field}"
        );
    }
    let mut changed = after.clone();
    changed["capture"] = Value::Null;
    assert_eq!(
        super::visual_approval::carry(&previous, &mut changed, &dir.join("blobs")),
        0
    );
    let mut changed = after.clone();
    changed["draft"]["decisions"]["control"] = json!({"action":"revise"});
    assert_eq!(
        super::visual_approval::carry(&previous, &mut changed, &dir.join("blobs")),
        0
    );
    let mut changed = after.clone();
    changed["capture"]["components"][1]["views"]["preview"]["viewport"]["width"] = json!(200);
    assert_eq!(super::visual_approval::carry(&previous, &mut changed, &dir.join("blobs")), 0);
    let mut unsubmitted = previous.clone();
    unsubmitted["receipt"] = Value::Null;
    assert_eq!(super::visual_approval::carry(&unsubmitted, &mut after.clone(), &dir.join("blobs")), 0);
    let pixel_path = dir.join("blobs").join(manifest::digest(b"same pixels"));
    fs::write(&pixel_path, b"corrupted capture").unwrap();
    assert_eq!(super::visual_approval::carry(&previous, &mut after.clone(), &dir.join("blobs")), 0);
    fs::write(&pixel_path, b"same pixels").unwrap();
    store::submit(&dir, &approve(&carried)).unwrap();
    store::prepare_captured(
        &f.store,
        &f.project,
        &f.manifest(),
        Some(&mut Renderer(b"different pixels")),
    )
    .unwrap();
    let changed = store::read(&dir.join("current.json")).unwrap();
    assert!(changed["draft"]["decisions"]["control"].is_null());
    store::prepare_captured(&f.store,&f.project,&f.manifest(),Some(&mut Renderer(b"same pixels"))).unwrap();
    let restored=store::read(&dir.join("current.json")).unwrap();
    assert_eq!(restored["draft"]["decisions"]["control"]["action"],"approve");
    assert!(restored["receipt"].is_null());
}

#[test]
fn review_groups_preserve_instances_and_require_a_shared_code_document() {
    let f = Fixture::new();
    fs::create_dir_all(f.project.join(".impeccable/build")).unwrap();
    fs::write(f.project.join(".impeccable/build/spec.json"), r#"{"regions":[]}"#).unwrap();
    let mut input=f.manifest(); input["stage"]=json!("components");
    input["components"][1]["reviewGroup"]=json!("Labels");
    let mut peer=input["components"][1].clone(); peer["id"]=json!("peer");
    input["components"].as_array_mut().unwrap().push(peer);
    let (packet, _) = manifest::freeze(&f.project, &input).unwrap();
    assert_eq!(packet["components"].as_array().unwrap().len(),3);
    assert_eq!(packet["components"][2]["reviewGroup"],"Labels");
    let mut invalid=input.clone();invalid["components"][0]["reviewGroup"]=json!("Labels");
    assert!(manifest::freeze(&f.project,&invalid).unwrap_err().contains("raster assets remain individual"));
    input["components"][2]["preview"]["path"]=json!("different.html");
    assert!(manifest::freeze(&f.project,&input).unwrap_err().contains("share one code document"));
}

#[test]
fn invalid_component_geometry_names_the_component_and_bounds() {
    let f = Fixture::new();
    let mut input = f.manifest();
    input["components"][0]["box"]["w"] = json!(2);
    let error = manifest::freeze(&f.project, &input).unwrap_err();
    assert!(error.contains("art") && error.contains("box") && error.contains("2") && error.contains("normalized"), "{error}");
    let mut input = f.manifest();
    let duplicate = input["components"][0].clone();
    input["components"].as_array_mut().unwrap().push(duplicate);
    let error = manifest::freeze(&f.project, &input).unwrap_err();
    assert!(error.contains("duplicate component id") && error.contains("art"), "{error}");
}

#[test]
fn component_review_refuses_groups_that_mix_measured_roles() {
    let f = Fixture::new();
    fs::create_dir_all(f.project.join(".impeccable/build")).unwrap();
    let mut input = f.manifest();
    input["stage"] = json!("components");
    input["components"][1]["reviewGroup"] = json!("peers");
    let mut peer = input["components"][1].clone(); peer["id"] = json!("peer");
    input["components"].as_array_mut().unwrap().push(peer);
    let mut spec = json!({"regions":[{"id":"control","kind":"control"},{"id":"peer","kind":"text"}]});
    let path = f.project.join(".impeccable/build/spec.json");
    fs::write(&path, spec.to_string()).unwrap();
    assert!(manifest::freeze(&f.project,&input).unwrap_err().contains("mixes region kinds"));
    spec["regions"][1]["kind"] = json!("control");
    fs::write(&path, spec.to_string()).unwrap();
    assert_eq!(manifest::freeze(&f.project,&input).unwrap().0["components"].as_array().unwrap().len(),3);
}

#[test]
fn measured_inventory_reports_all_independent_failures_before_capture() {
    let f = Fixture::new();
    fs::create_dir_all(f.project.join(".impeccable/build")).unwrap();
    fs::write(f.project.join(".impeccable/build/spec.json"), br#"{"regions":[{"id":"missing-one","kind":"plate"},{"id":"control","kind":"control"},{"id":"missing-two","kind":"text"}]}"#).unwrap();
    let mut input = f.manifest();
    input["stage"] = json!("components");
    input["components"][1]["preview"] = json!({"kind":"image","path":"art.png"});
    let error = store::prepare(&f.store, &f.project, &input).unwrap_err();
    assert!(error.contains("missing-one"));
    assert!(error.contains("missing-two"));
    assert!(error.contains("semantic region \"control\" requires a rendered code preview"));
    assert!(!f.store.exists(), "invalid inventory must not publish a review");
}

/// Behaves like the native adapter: code views become hash-named captures with proofs.
struct Native;
impl super::capture::ComponentCapturer for Native {
    fn capture(&mut self, packet: &mut Value, inputs: &std::collections::BTreeMap<String, Vec<u8>>) -> Result<super::capture::CapturedPreviews, String> {
        let (mut files, mut evidence) = (std::collections::BTreeMap::new(), vec![]);
        for c in packet["components"].as_array_mut().unwrap() {
            let path = c["preview"]["url"].as_str().unwrap().strip_prefix("/files/").unwrap().to_string();
            let proof = if c["preview"]["kind"] == "image" {
                json!({"kind":"raster-source","path":path,"sha256":manifest::digest(&inputs[&path])})
            } else {
                let png = format!("pixels of {path}").into_bytes();
                let hash = manifest::digest(&png);
                c["preview"] = json!({"kind":"image","sourceKind":"page","url":format!("/files/_review_captures/{hash}.png")});
                files.insert(format!("_review_captures/{hash}.png"), png);
                json!({"kind":"static-code","entry":path,"screenshotSha256":hash,"viewport":{"width":100,"height":100,"dpr":1}})
            };
            c["thumbnail"] = json!({"url":c["preview"]["url"]});
            evidence.push(json!({"id":c["id"],"views":{"preview":proof}}));
        }
        Ok(super::capture::CapturedPreviews { files, evidence: json!({"schema":"native-component-previews-v1","components":evidence}) })
    }
}

#[test]
fn verify_recomputes_capture_integrity_instead_of_trusting_stored_flags() {
    let f = Fixture::new();
    fs::write(f.project.join("review.json"), f.manifest().to_string()).unwrap();
    // A plain prepare with a forged capture claim and receipt flag.
    let dir = store::prepare_file(&f.store, &f.project, "review.json", None).unwrap();
    let state = store::read(&dir.join("current.json")).unwrap();
    store::submit(&dir, &approve(&state)).unwrap();
    let mut forged = store::read(&dir.join("current.json")).unwrap();
    forged["capture"] = json!({"schema":"native-component-previews-v1","components":[]});
    forged["receipt"]["capture"] = forged["capture"].clone();
    forged["receipt"]["captureVerified"] = json!(true);
    store::write(&dir.join("current.json"), &forged).unwrap();
    assert!(super::verify::approved(&f.store, &f.project, "review.json").unwrap_err().contains("not intact"));
    forged["capture"]["components"] = json!([{"id":"art"},{"id":"control"}]);
    forged["receipt"]["capture"] = forged["capture"].clone();
    store::write(&dir.join("current.json"), &forged).unwrap();
    assert!(super::verify::approved(&f.store, &f.project, "review.json").unwrap_err().contains("not intact"));
    // A genuine capture passes; dropping evidence or swapping captured pixels does not.
    fs::write(f.project.join("art.png"), b"new art").unwrap();
    let dir = store::prepare_file(&f.store, &f.project, "review.json", Some(&mut Native)).unwrap();
    let state = store::read(&dir.join("current.json")).unwrap();
    store::submit(&dir, &approve(&state)).unwrap();
    let good = store::read(&dir.join("current.json")).unwrap();
    assert_eq!(super::verify::approved(&f.store, &f.project, "review.json").unwrap()["visualDecision"], "approved");
    let mut partial = good.clone();
    partial["capture"]["components"].as_array_mut().unwrap().pop();
    partial["receipt"]["capture"] = partial["capture"].clone();
    store::write(&dir.join("current.json"), &partial).unwrap();
    assert!(super::verify::approved(&f.store, &f.project, "review.json").unwrap_err().contains("cover"));
    store::write(&dir.join("current.json"), &good).unwrap();
    let captured = good["files"].as_object().unwrap().iter().find(|(p, _)| p.starts_with("_review_captures/")).unwrap().1.as_str().unwrap();
    fs::write(dir.join("blobs").join(captured), b"swapped").unwrap();
    assert!(super::verify::approved(&f.store, &f.project, "review.json").unwrap_err().contains("pinned bytes"));
}

fn serve_in_thread(dir: &std::path::Path, idle_ms: u64) -> std::sync::mpsc::Receiver<Result<i32, String>> {
    let (tx, rx) = std::sync::mpsc::channel();
    let d = dir.to_path_buf();
    std::thread::spawn(move || {
        let (mut io, _) = impeccable_common::Io::captured("", d.clone(), Default::default());
        let limits = server::Limits { idle: std::time::Duration::from_millis(idle_ms), grace: std::time::Duration::from_millis(100) };
        tx.send(server::serve(&d, 0, &mut io, limits, None)).ok();
    });
    rx
}

#[test]
fn serve_exits_after_submission_or_idle_and_removes_its_service_record() {
    let f = Fixture::new();
    let dir = f.prepare();
    let rx = serve_in_thread(&dir, 300);
    assert_eq!(rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap(), Ok(4));
    assert!(!dir.join("service.json").exists());
    let state = store::read(&dir.join("current.json")).unwrap();
    let rx = serve_in_thread(&dir, 60_000);
    std::thread::sleep(std::time::Duration::from_millis(200));
    assert!(dir.join("service.json").exists());
    store::submit(&dir, &approve(&state)).unwrap();
    assert_eq!(rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap(), Ok(0));
    assert!(!dir.join("service.json").exists());
}

#[test]
fn status_hides_dead_servers_and_serve_refuses_sessions_without_a_browser() {
    let f = Fixture::new();
    let dir = f.prepare();
    let id = dir.file_name().unwrap().to_string_lossy().into_owned();
    store::write(&dir.join("service.json"), &json!({"url":"http://127.0.0.1:9/","pid":2147483000i64})).unwrap();
    let run = |cmd: &str, env: &[(&str, &str)]| {
        let env = env.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        let (mut io, out) = impeccable_common::Io::captured("", f.project.clone(), env);
        let args: Vec<String> = [cmd, "--session", &id, "--store", f.store.to_str().unwrap()].map(String::from).to_vec();
        let code = super::run(&args, &mut io);
        let stdout = String::from_utf8(out.stdout.borrow().clone()).unwrap();
        (code, stdout)
    };
    let (code, out) = run("status", &[]);
    assert_eq!(code, 0);
    assert_eq!(serde_json::from_str::<Value>(&out).unwrap()["service"], Value::Null);
    assert_eq!(run("serve", &[("IMPECCABLE_QUESTION_DISABLED", "1")]).0, 2);
    assert_eq!(run("serve", &[("CI", "1")]).0, 2);
}

#[test]
fn a_held_lock_is_exclusive_whatever_its_file_says() {
    let f = Fixture::new();
    let dir = f.root.join("locked");
    let held = store::lock(&dir).unwrap();
    // Contents of an old-style stale lock (dead PID) never let a second writer in.
    // Windows locks are mandatory, so the forged contents can't even be written there.
    #[cfg(unix)]
    fs::write(dir.join("review.lock"), "2147483000\n").unwrap();
    assert!(store::lock(&dir).is_err());
    drop(held);
    assert!(dir.join("review.lock").exists());
    let _again = store::lock(&dir).unwrap();
}

#[test]
fn forged_acceptance_never_closes_review_in_lifecycle() {
    let f = Fixture::new();
    let mut hero = f.manifest();
    hero["stage"] = json!("hero");
    let dir = store::prepare(&f.store, &f.project, &hero).unwrap();
    let state = store::read(&dir.join("current.json")).unwrap();
    store::submit(&dir, &approve(&state)).unwrap();
    let mut forged = store::read(&dir.join("current.json")).unwrap();
    forged["capture"] = json!({"schema":"native-component-previews-v1","components":[{"id":"art"},{"id":"control"}]});
    forged["receipt"]["capture"] = forged["capture"].clone();
    forged["receipt"]["captureVerified"] = json!(true);
    store::write(&dir.join("current.json"), &forged).unwrap();
    assert!(super::lifecycle::accepted(&forged));
    let result = super::lifecycle::inspect(&[dir.clone()], &["components".into(), "hero".into()]).unwrap();
    assert_eq!(result["status"], "pending");
    assert!(super::lifecycle::final_session(&f.store, &f.project.canonicalize().unwrap()).unwrap().is_none());
}

// ---- plan and asset review (schemaVersion 3) --------------------------------

const PLAN_SPEC: &str = r#"{"comp":"comp.png","compSize":{"width":100,"height":100},"regions":[
 {"id":"nav","kind":"chrome","note":"Top bar","box":{"x":0,"y":0,"w":1,"h":0.1}},
 {"id":"art","kind":"plate","note":"Figure","box":{"x":0.5,"y":0.1,"w":0.5,"h":0.5},"plate":"assets/art.png"},
 {"id":"photo","kind":"image","note":"Harbour photo","box":{"x":0,"y":0.6,"w":0.5,"h":0.4},"plate":"assets/photo.png"},
 {"id":"headline","kind":"text","note":"A little closer","box":{"x":0.05,"y":0.2,"w":0.4,"h":0.2}},
 {"id":"brushed-panel","kind":"chrome","note":"Brushed steel","box":{"x":0,"y":0.4,"w":0.5,"h":0.1},"flags":[{"id":"painted-pixels","message":"soft gradients"}]},
 {"id":"ground","kind":"chrome","container":true,"note":"Page ground","box":{"x":0,"y":0,"w":1,"h":1}},
 {"id":"strip","kind":"band","note":"Band","box":{"x":0,"y":0.9,"w":1,"h":0.1}},
 {"id":"table","kind":"text","codeDrawn":true,"note":"Tide table","box":{"x":0.5,"y":0.6,"w":0.5,"h":0.3}}]}"#;

impl Fixture {
    fn plan_project(&self) {
        fs::create_dir_all(self.project.join(".impeccable/build")).unwrap();
        fs::write(self.project.join(".impeccable/build/spec.json"), PLAN_SPEC).unwrap();
        fs::write(self.project.join(".impeccable/build/state.json"), r#"{"startedAt":"build-1","artifact":"index.html"}"#).unwrap();
    }
    fn plates(&self) {
        fs::create_dir_all(self.project.join("assets")).unwrap();
        fs::write(self.project.join("assets/art.png"), b"art plate").unwrap();
        fs::write(self.project.join("assets/photo.png"), b"photo plate").unwrap();
    }
    fn io(&self) -> (impeccable_common::Io, impeccable_common::Captured) {
        impeccable_common::Io::captured("", self.project.clone(), std::collections::HashMap::from([("HOME".into(), self.root.to_string_lossy().into_owned())]))
    }
    /// `component-review <args> --store <store>` with no native capturer at all.
    fn cli(&self, args: &[&str]) -> (i32, String, String) {
        let (mut io, captured) = self.io();
        let mut argv: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        argv.extend(["--store".into(), self.store.to_string_lossy().into_owned()]);
        let code = super::run_with_capturer(&argv, &mut io, None);
        let text = |b: &std::cell::RefCell<Vec<u8>>| String::from_utf8(b.borrow().clone()).unwrap();
        (code, text(&captured.stdout), text(&captured.stderr))
    }
    fn plan_round(&self) -> PathBuf {
        assert_eq!(self.cli(&["plan"]).0, 0);
        let (code, out, err) = self.cli(&["capture", "--manifest", ".impeccable/review/components.json"]);
        assert_eq!(code, 0, "{err}");
        let session: Value = serde_json::from_str(&out).unwrap();
        self.store.join(session["session"].as_str().unwrap())
    }
    fn gate(&self) -> Result<(), String> {
        super::plan::gate(&self.store, &self.project, "impeccable")
    }
}

#[test]
fn plan_refuses_listing_every_missing_plate_then_orders_roles_from_the_spec() {
    let f = Fixture::new();
    f.plan_project();
    let (code, _, err) = f.cli(&["plan"]);
    assert_eq!(code, 1);
    assert!(err.contains("2 raster region(s) lack their plate") && err.contains("art (plate): assets/art.png") && err.contains("photo (image): assets/photo.png"), "{err}");
    assert!(!f.project.join(".impeccable/review/components.json").exists());
    f.plates();
    let (code, out, err) = f.cli(&["plan"]);
    assert_eq!(code, 0, "{err}");
    assert!(out.contains("2 assets, 3 plan items (2 flagged or code-drawn), 3 code regions") && out.contains("NEXT impeccable component-review capture --manifest .impeccable/review/components.json"), "{out}");
    let packet = store::read(&f.project.join(".impeccable/review/components.json")).unwrap();
    let ids = |key: &str| packet[key].as_array().unwrap().iter().map(|c| c["id"].as_str().unwrap().to_string()).collect::<Vec<_>>();
    assert_eq!(ids("components"), ["brushed-panel", "table", "art", "photo", "nav"]);
    assert_eq!(ids("codeRegions"), ["headline", "ground", "strip"]);
    assert_eq!(packet["schemaVersion"], 3);
    assert_eq!(packet["stage"], "components");
    assert_eq!(packet["comp"], json!({"path":"comp.png","width":100,"height":100}));
    assert_eq!(packet["specSha256"], manifest::digest(PLAN_SPEC.as_bytes()));
    let c = &packet["components"];
    assert_eq!((c[0]["role"].as_str(), c[0]["name"].as_str(), c[0]["codeDrawn"].as_bool()), (Some("plan"), Some("Brushed panel"), Some(false)));
    assert_eq!(c[0]["flags"][0]["id"], "painted-pixels");
    assert_eq!(c[0]["preview"], json!({"kind":"comp-crop"}));
    assert_eq!(c[1]["codeDrawn"], true);
    assert_eq!(c[2]["preview"], json!({"kind":"image","path":"assets/art.png"}));
    assert_eq!((c[2]["role"].as_str(), c[2]["medium"].as_str()), (Some("asset"), Some("raster")));
    assert!(c[4]["flags"].is_null());
    assert_eq!(packet["codeRegions"][0], json!({"id":"headline","name":"Headline","kind":"text","box":{"x":0.05,"y":0.2,"w":0.4,"h":0.2},"note":"A little closer"}));
}

#[test]
fn plan_capture_needs_no_browser_and_approval_verifies_against_the_pinned_spec() {
    let f = Fixture::new();
    f.plan_project();
    f.plates();
    let dir = f.plan_round();
    let state = store::read(&dir.join("current.json")).unwrap();
    assert_eq!(state["capture"]["schema"], super::capture::PLAN_SCHEMA);
    let proofs = state["capture"]["components"].as_array().unwrap();
    assert_eq!(proofs[0]["views"]["preview"], json!({"kind":"comp-crop","compPath":"comp.png","compSha256":manifest::digest(b"comp"),"box":state["packet"]["components"][0]["box"]}));
    assert_eq!(proofs[2]["views"]["preview"]["kind"], "raster-source");
    assert!(state["packet"]["components"][0]["preview"]["url"].is_null());
    assert_eq!(state["packet"]["codeRegions"].as_array().unwrap().len(), 3);
    assert!(f.gate().unwrap_err().contains("not accepted"));
    let receipt = store::submit(&dir, &approve(&state)).unwrap();
    assert_eq!((receipt["visualDecision"].as_str(), receipt["captureVerified"].as_bool()), (Some("approved"), Some(true)));
    assert_eq!(super::verify::approved(&f.store, &f.project, ".impeccable/review/components.json").unwrap(), receipt);
    assert_eq!(super::lifecycle::inspect(&[dir.clone()], &["components".into()]).unwrap()["status"], "approved");
    f.gate().unwrap();
    // Stored flags are claims: a packet digest that no longer matches the pinned spec fails integrity.
    let mut forged = store::read(&dir.join("current.json")).unwrap();
    forged["packet"]["specSha256"] = json!("0".repeat(64));
    assert!(super::verify::capture_intact(&dir, &forged).unwrap_err().contains("spec digest"));
    let mut moved = store::read(&dir.join("current.json")).unwrap();
    moved["capture"]["components"][0]["views"]["preview"]["box"]["x"] = json!(0.3);
    moved["receipt"]["capture"] = moved["capture"].clone();
    assert!(super::verify::capture_intact(&dir, &moved).unwrap_err().contains("comp-crop evidence"));
    // A native-schema claim is not plan evidence.
    let mut native = store::read(&dir.join("current.json")).unwrap();
    native["capture"]["schema"] = json!(super::capture::NATIVE_SCHEMA);
    native["receipt"]["capture"] = native["capture"].clone();
    assert!(!super::lifecycle::accepted(&native));
    // A spec change after acceptance reopens the gate and needs a new round.
    let mut spec: Value = serde_json::from_str(PLAN_SPEC).unwrap();
    spec["regions"][3]["note"] = json!("A little closer to the sea");
    fs::write(f.project.join(".impeccable/build/spec.json"), spec.to_string()).unwrap();
    assert!(f.gate().unwrap_err().contains("earlier spec.json"));
    assert!(super::verify::approved(&f.store, &f.project, ".impeccable/review/components.json").is_err());
}

#[test]
fn plan_freeze_binds_the_spec_and_the_complete_inventory() {
    let f = Fixture::new();
    f.plan_project();
    f.plates();
    let packet = super::plan::build(&f.project).unwrap();
    manifest::freeze(&f.project, &packet).unwrap();
    let mut omitted = packet.clone();
    omitted["codeRegions"].as_array_mut().unwrap().remove(0);
    assert!(manifest::freeze(&f.project, &omitted).unwrap_err().contains("omitted measured region \"headline\""));
    let mut foreign = packet.clone();
    foreign["codeRegions"][0]["id"] = json!("elsewhere");
    assert!(manifest::freeze(&f.project, &foreign).unwrap_err().contains("not a measured region"));
    let mut rendered = packet.clone();
    rendered["components"][0]["preview"] = json!({"kind":"page","path":"control.html"});
    assert!(manifest::freeze(&f.project, &rendered).unwrap_err().contains("comp-crop"));
    let mut stale = packet.clone();
    stale["specSha256"] = json!("0".repeat(64));
    assert!(manifest::freeze(&f.project, &stale).unwrap_err().contains("component-review plan"));
    let mut grouped = packet;
    grouped["components"][4]["reviewGroup"] = json!("bars");
    assert!(manifest::freeze(&f.project, &grouped).unwrap_err().contains("reviewGroup"));
}

#[test]
fn reclassification_requests_changes_and_carries_unchanged_decisions_into_the_next_round() {
    let f = Fixture::new();
    f.plan_project();
    f.plates();
    let dir = f.plan_round();
    let state = store::read(&dir.join("current.json")).unwrap();
    let rev = |i: usize| state["packet"]["components"][i]["revision"].clone();
    let mut body = approve(&state);
    // revise is for assets, reclassify for plan items with a raster kind.
    body["decisions"]["brushed-panel"] = json!({"revision":rev(0),"action":"revise","feedback":"","split":false});
    assert!(store::submit(&dir, &body).unwrap_err().contains("plan item"));
    body["decisions"]["brushed-panel"] = json!({"revision":rev(0),"action":"reclassify","kind":"svg","feedback":"","split":false});
    assert!(store::submit(&dir, &body).is_err());
    body["decisions"]["art"] = json!({"revision":rev(2),"action":"reclassify","kind":"image","feedback":"","split":false});
    body["decisions"]["brushed-panel"]["kind"] = json!("texture");
    assert!(store::submit(&dir, &body).is_err(), "assets are not reclassified");
    body["decisions"]["art"] = json!({"revision":rev(2),"action":"approve","feedback":"","split":false});
    let mut unknown = body.clone();
    unknown["reclassify"] = json!([{"id":"nav","kind":"plate"}]);
    assert!(store::submit(&dir, &unknown).unwrap_err().contains("codeRegions"), "a component is decided in decisions");
    body["reclassify"] = json!([{"id":"headline","kind":"plate","feedback":"This lettering is painted"}]);
    let receipt = store::submit(&dir, &body).unwrap();
    assert_eq!(receipt["visualDecision"], "changes-requested");
    assert!(f.gate().unwrap_err().contains("requested changes"));
    // Apply the receipt: headline becomes a plate, the panel a texture.
    let mut spec: Value = serde_json::from_str(PLAN_SPEC).unwrap();
    spec["regions"][3]["kind"] = json!("plate");
    spec["regions"][3]["plate"] = json!("assets/headline.png");
    spec["regions"][4]["kind"] = json!("texture");
    spec["regions"][4]["plate"] = json!("assets/panel.png");
    spec["regions"][4].as_object_mut().unwrap().remove("flags");
    fs::write(f.project.join(".impeccable/build/spec.json"), spec.to_string()).unwrap();
    fs::write(f.project.join("assets/headline.png"), b"headline plate").unwrap();
    fs::write(f.project.join("assets/panel.png"), b"panel plate").unwrap();
    let next_dir = f.plan_round();
    assert_eq!(next_dir, dir);
    let next = store::read(&next_dir.join("current.json")).unwrap();
    assert_eq!(next["packet"]["round"], 2);
    let carried: Vec<&str> = next["draft"]["decisions"].as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(carried, ["table", "art", "photo", "nav"], "unchanged approvals carry across a spec change");
    assert_eq!(next["history"]["feedback"]["headline"]["decision"]["action"], "reclassify");
    assert_eq!(next["history"]["feedback"]["brushed-panel"]["decision"]["kind"], "texture");
    store::submit(&next_dir, &approve(&next)).unwrap();
    f.gate().unwrap();
}

#[test]
fn approving_every_component_while_reclassifying_a_code_region_is_not_approval() {
    let f = Fixture::new();
    f.plan_project();
    f.plates();
    let dir = f.plan_round();
    let state = store::read(&dir.join("current.json")).unwrap();
    let mut body = approve(&state);
    body["inventoryConfirmed"] = json!(false);
    assert!(store::submit(&dir, &body).unwrap_err().contains("confirm inventory"));
    body["reclassify"] = json!([{"id":"headline","kind":"plate"},{"id":"headline","kind":"image"}]);
    assert!(store::submit(&dir, &body).is_err(), "one reclassification per region");
    body["reclassify"] = json!([{"id":"headline","kind":"plate"}]);
    let receipt = store::submit(&dir, &body).unwrap();
    assert_eq!(receipt["visualDecision"], "changes-requested");
    assert!(super::verify::approved(&f.store, &f.project, ".impeccable/review/components.json").is_err());
    // v1/v2 reviews have no reclassification.
    let legacy = Fixture::new();
    let legacy_dir = legacy.prepare();
    let mut legacy_body = approve(&store::read(&legacy_dir.join("current.json")).unwrap());
    legacy_body["reclassify"] = json!([{"id":"art","kind":"plate"}]);
    assert!(store::submit(&legacy_dir, &legacy_body).is_err());
}
