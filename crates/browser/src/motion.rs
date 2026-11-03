//! Internal motion evidence capture. The skill reviewer supplies the craft verdict.
use crate::{
    BrowserEngine,
    cdp::{CdpError, Page, Viewport},
};
use base64::Engine;
use impeccable_common::Io;
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

const HELP: &str = "Usage: impeccable motion-capture <url> --click <selector> | --steps <json-file> --out-dir <dir> [--region <selector|[x,y,width,height]>] [--frames 7] [--reduced-motion]\nSteps: [{\"click\":\"#toggle\"},{\"hover\":\"#card\"},{\"press\":\"Enter\"},{\"wait\":100}]\n";
const STATE: &str = "globalThis.__impeccableMotion";
fn err(e: impl std::fmt::Display) -> CdpError {
    CdpError::new(e.to_string())
}
fn number(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.)
}

struct Options {
    url: String,
    steps: Vec<Value>,
    region: Option<String>,
    out: PathBuf,
    frames: usize,
    reduce: bool,
}
fn options(args: &[String], cwd: &Path) -> Result<Options, CdpError> {
    let mut o = Options {
        url: args.first().cloned().ok_or_else(|| err(HELP))?,
        steps: vec![],
        region: None,
        out: PathBuf::new(),
        frames: 7,
        reduce: false,
    };
    let parsed = url::Url::parse(&o.url).map_err(err)?;
    if !matches!(parsed.scheme(), "http" | "https" | "file") {
        return Err(err("URL must use http, https, or file"));
    }
    let mut i = 1;
    while i < args.len() {
        let flag = &args[i];
        i += 1;
        if flag == "--reduced-motion" {
            o.reduce = true;
            continue;
        }
        let value = args
            .get(i)
            .ok_or_else(|| err(format!("Missing value for {flag}")))?;
        i += 1;
        match flag.as_str() {
            "--click" if o.steps.is_empty() => o.steps = vec![json!({"click":value})],
            "--steps" if o.steps.is_empty() => {
                o.steps = serde_json::from_slice(&std::fs::read(cwd.join(value)).map_err(err)?)
                    .map_err(err)?
            }
            "--out-dir" => o.out = cwd.join(value),
            "--region" => o.region = Some(value.clone()),
            "--frames" => o.frames = value.parse().map_err(err)?,
            _ => return Err(err(format!("Unknown or duplicate option: {flag}"))),
        }
    }
    if o.out.as_os_str().is_empty()
        || o.steps.is_empty()
        || o.steps.len() > 20
        || !(3..=15).contains(&o.frames)
    {
        return Err(err(HELP));
    }
    for step in &o.steps {
        let obj = step
            .as_object()
            .ok_or_else(|| err("Each step must be an object"))?;
        if obj.len() != 1 {
            return Err(err("Each step must have one action"));
        }
        let (key, value) = obj.iter().next().unwrap();
        match key.as_str() {
            "click" | "hover" if value.as_str().is_some_and(|v| !v.is_empty()) => {}
            "press"
                if value.as_str().is_some_and(|v| {
                    matches!(
                        v,
                        "Enter"
                            | " "
                            | "Space"
                            | "Tab"
                            | "Escape"
                            | "ArrowUp"
                            | "ArrowDown"
                            | "ArrowLeft"
                            | "ArrowRight"
                    )
                }) => {}
            "wait" if value.as_u64().is_some_and(|v| v <= 2000) => {}
            _ => {
                return Err(err(
                    "Invalid motion step (wait must be 0–2000 ms; press supports navigation keys)",
                ));
            }
        }
    }
    Ok(o)
}

fn action(page: &mut Page<'_>, step: &Value) -> Result<(), CdpError> {
    if let Some(ms) = step["wait"].as_u64() {
        std::thread::sleep(Duration::from_millis(ms));
        return Ok(());
    }
    if let Some(key) = step["press"].as_str() {
        let (key, code, n) = match key {
            "Enter" => ("Enter", "Enter", 13),
            " " | "Space" => (" ", "Space", 32),
            "Tab" => ("Tab", "Tab", 9),
            "Escape" => ("Escape", "Escape", 27),
            "ArrowLeft" => ("ArrowLeft", "ArrowLeft", 37),
            "ArrowUp" => ("ArrowUp", "ArrowUp", 38),
            "ArrowRight" => ("ArrowRight", "ArrowRight", 39),
            _ => ("ArrowDown", "ArrowDown", 40),
        };
        page.motion_command("Input.dispatchKeyEvent",json!({"type":"keyDown","key":key,"code":code,"windowsVirtualKeyCode":n,"text":if key=="Enter" {"\r"} else if key==" " {" "} else {""}}))?;
        page.motion_command(
            "Input.dispatchKeyEvent",
            json!({"type":"keyUp","key":key,"code":code,"windowsVirtualKeyCode":n}),
        )?;
    } else {
        let selector = step.get("click").or_else(|| step.get("hover")).unwrap();
        let point=page.evaluate_value(&format!("(()=>{{const e=document.querySelector({selector});if(!e)throw Error('Interaction selector not found');const r=e.getBoundingClientRect();if(!r.width||!r.height)throw Error('Interaction target has no box');return {{x:r.x+r.width/2,y:r.y+r.height/2}};}})()"))?;
        let x = number(&point["x"]);
        let y = number(&point["y"]);
        if !(0.0..1000.).contains(&x) || !(0.0..760.).contains(&y) {
            return Err(err("Interaction target is outside the capture viewport"));
        }
        page.motion_command(
            "Input.dispatchMouseEvent",
            json!({"type":"mouseMoved","x":x,"y":y}),
        )?;
        if step.get("click").is_some() {
            for kind in ["mousePressed", "mouseReleased"] {
                page.motion_command(
                    "Input.dispatchMouseEvent",
                    json!({"type":kind,"x":x,"y":y,"button":"left","clickCount":1}),
                )?;
            }
        }
    }
    Ok(())
}

struct Capture {
    frames: Vec<Value>,
    images: Vec<String>,
    meta: Value,
    region: Value,
}
fn record(
    o: &Options,
    env: &std::collections::HashMap<String, String>,
    reduce: bool,
    screenshots: bool,
) -> Result<Capture, CdpError> {
    let mut browser = BrowserEngine::new(env.clone())
        .launch()
        .map_err(|e| err(e.message))?;
    let mut page = browser.new_page()?;
    page.set_viewport(Viewport {
        width: 1000,
        height: 760,
    })?;
    page.set_reduced_motion(reduce)?;
    page.goto(&o.url, "load", Duration::from_secs(30))?;
    page.evaluate_value("document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))")?;
    // Capture the resting state, not an unrelated entrance half-way through.
    page.evaluate_value("Promise.race([Promise.all(document.getAnimations().filter(a=>a.playState==='running').map(a=>a.finished.catch(()=>{}))),new Promise((_,reject)=>setTimeout(()=>reject(Error('Page did not reach rest before the interaction')),10000))])")?;
    let region=match &o.region {
        None=>json!([0,0,1000,760]),
        Some(s)=>match serde_json::from_str::<Value>(s) {
            Ok(v) if v.is_array()=>v,
            _=>page.evaluate_value(&format!("(()=>{{const e=document.querySelector({});if(!e)throw Error('Capture region not found');const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}})()",json!(s)))?,
        }
    };
    let r = region.as_array().ok_or_else(|| err("Invalid region"))?;
    if r.len() != 4
        || r.iter().any(|v| v.as_f64().is_none())
        || number(&r[0]) < 0.
        || number(&r[1]) < 0.
        || number(&r[2]) < 1.
        || number(&r[3]) < 1.
        || number(&r[0]) + number(&r[2]) > 1000.
        || number(&r[1]) + number(&r[3]) > 760.
    {
        return Err(err(
            "Region must be a positive rectangle within the 1000×760 viewport",
        ));
    }
    page.evaluate_value(include_str!("motion.js"))?;
    page.motion_command("Animation.enable", json!({}))?;
    page.motion_command("Animation.setPlaybackRate", json!({"playbackRate":0}))?;
    let mut capture = Capture {
        frames: vec![],
        images: vec![],
        meta: Value::Null,
        region,
    };
    sample(&mut page, &mut capture, "before", 0., screenshots)?;
    for step in &o.steps {
        action(&mut page, step)?;
    }
    capture.meta = page.evaluate_value(&format!("{STATE}.ready()"))?;
    let duration = number(&capture.meta["duration"]);
    for i in 0..o.frames {
        let time = (duration - 0.01).max(0.) * i as f64 / (o.frames - 1) as f64;
        page.evaluate_value(&format!("{STATE}.seek({time})"))?;
        sample(
            &mut page,
            &mut capture,
            if i == 0 {
                "first"
            } else if i == o.frames - 1 {
                "last"
            } else {
                "middle"
            },
            time,
            screenshots,
        )?;
    }
    page.motion_command("Animation.setPlaybackRate", json!({"playbackRate":1}))?;
    page.evaluate_value(&format!("{STATE}.finish()"))?;
    sample(
        &mut page,
        &mut capture,
        "settled",
        duration + 250.,
        screenshots,
    )?;
    page.close();
    browser.close();
    Ok(capture)
}
fn document_region(region: &Value, scroll: &Value) -> (f64, f64, f64, f64) {
    (
        number(&region[0]) + number(&scroll[0]),
        number(&region[1]) + number(&scroll[1]),
        number(&region[2]),
        number(&region[3]),
    )
}
fn sample(
    page: &mut Page<'_>,
    capture: &mut Capture,
    label: &str,
    time: f64,
    screenshots: bool,
) -> Result<(), CdpError> {
    let mut frame = page.evaluate_value(&format!("{STATE}.snapshot({})", capture.region))?;
    frame["index"] = json!(capture.frames.len());
    frame["timeMs"] = json!(time);
    frame["phase"] = json!(label);
    frame["image"] = json!(format!("frame-{:02}.png", capture.frames.len()));
    let clip = document_region(&capture.region, &frame["scroll"]);
    capture.frames.push(frame);
    if screenshots {
        capture
            .images
            .push(page.screenshot_clip(clip.0, clip.1, clip.2, clip.3)?);
    }
    Ok(())
}
fn delta(a: &Value, b: &Value) -> f64 {
    (0..4)
        .map(|i| (number(&a["box"][i]) - number(&b["box"][i])).abs())
        .fold(0., f64::max)
        .max((number(&a["opacity"]) - number(&b["opacity"])).abs() * 100.)
}
fn element<'a>(frame: &'a Value, id: &Value) -> Option<&'a Value> {
    frame["elements"]
        .as_array()?
        .iter()
        .find(|e| e["id"] == *id)
}
fn finding(kind: &str, el: &Value, frame: &Value, magnitude: f64) -> Value {
    json!({"kind":kind,"element":el["selector"],"frameIndex":frame["index"],"timeMs":frame["timeMs"],"magnitude":magnitude})
}
fn visible_content_change(before: &Value, after: &Value, a: &Value, b: &Value) -> bool {
    if number(&a["opacity"]) <= 0.02 || number(&b["opacity"]) <= 0.02 {
        return false;
    }
    if a["content"] != b["content"] {
        return true;
    }
    let empty = vec![];
    let old = a["children"].as_array().unwrap_or(&empty);
    let new = b["children"].as_array().unwrap_or(&empty);
    old.iter()
        .filter(|id| !new.contains(id))
        .any(|id| element(before, id).is_some_and(|e| number(&e["opacity"]) > 0.02))
        || new
            .iter()
            .filter(|id| !old.contains(id))
            .any(|id| element(after, id).is_some_and(|e| number(&e["opacity"]) > 0.02))
}
/// Deterministic heuristics over recorded element and overlap evidence; no browser needed.
pub fn analyze(frames: &[Value]) -> Vec<Value> {
    let mut findings = vec![];
    if frames.len() < 4 {
        return findings;
    }
    let last = frames.len() - 1;
    for (i, kind) in [(1, "start-jump"), (last, "end-jump")] {
        // During a View Transition the new DOM is hidden under captured old/new
        // pseudo-elements. Its immediate layout/content update is not painted.
        if i == 1 && frames[i]["viewTransition"] == true {
            continue;
        }
        for b in frames[i]["elements"].as_array().into_iter().flatten() {
            if let Some(a) = element(&frames[i - 1], &b["id"]) {
                let d = delta(a, b);
                if d > 2. {
                    findings.push(finding(kind, b, &frames[i], d));
                } else if i == last
                    && a["content"] != b["content"]
                    && number(&a["opacity"]) > 0.02
                    && number(&b["opacity"]) > 0.02
                {
                    findings.push(finding(kind, b, &frames[i], 1.));
                }
            } else if b["pseudo"] != true
                && number(&b["opacity"]) > 0.02
                && !frames[i - 1]["outsideIds"]
                    .as_array()
                    .is_some_and(|ids| ids.contains(&b["id"]))
            {
                findings.push(finding(kind, b, &frames[i], 1.));
            }
        }
        for a in frames[i - 1]["elements"].as_array().into_iter().flatten() {
            if a["pseudo"] != true
                && number(&a["opacity"]) > 0.02
                && element(&frames[i], &a["id"]).is_none()
                && !frames[i]["outsideIds"]
                    .as_array()
                    .is_some_and(|ids| ids.contains(&a["id"]))
            {
                findings.push(finding(kind, a, &frames[i], 1.));
            }
        }
    }
    for e in frames[1]["elements"].as_array().into_iter().flatten() {
        let samples: Vec<_> = frames.iter().map(|f| element(f, &e["id"])).collect();
        for i in 1..last {
            let Some(b) = samples[i] else {
                continue;
            };
            if number(&b["clipped"]) > 0.02
                && number(&b["opacity"]) > 0.02
                && samples[0].is_some_and(|v| number(&v["clipped"]) < 0.01)
                && samples[last].is_some_and(|v| number(&v["clipped"]) < 0.01)
            {
                findings.push(finding(
                    "clipped-midway",
                    b,
                    &frames[i],
                    number(&b["clipped"]),
                ));
            }
            if let Some(a) = samples[i - 1] {
                let moving = (1..last - 1).any(|j| {
                    samples[j]
                        .zip(samples[j + 1])
                        .is_some_and(|(a, b)| delta(a, b) > 2.)
                });
                let moving = moving
                    || b["ancestors"].as_array().into_iter().flatten().any(|id| {
                        (1..last - 1).any(|j| {
                            element(&frames[j], id)
                                .zip(element(&frames[j + 1], id))
                                .is_some_and(|(a, b)| delta(a, b) > 2.)
                        })
                    });
                if visible_content_change(&frames[i - 1], &frames[i], a, b)
                    && moving
                    && frames[i]["viewTransition"] != true
                {
                    findings.push(finding("content-swap", b, &frames[i], 1.));
                }
            }
            if i >= 2 && i + 1 < last {
                if let (Some(a), Some(prev), Some(next)) =
                    (samples[i - 1], samples[i - 2], samples[i + 1])
                {
                    let d = delta(a, b);
                    if d > 8. && d > 4. * delta(prev, a).max(delta(b, next)).max(1.) {
                        findings.push(finding("mid-step", b, &frames[i], d));
                    }
                }
            }
        }
    }
    let mut orders = std::collections::BTreeMap::new();
    for frame in frames {
        if let Some(paint) = frame["paint"].as_object() {
            for (pair, top) in paint {
                if orders.insert(pair, top).is_some_and(|old| old != top) {
                    if let Some(el) = element(frame, top) {
                        findings.push(finding("paint-order-flip", el, frame, 1.));
                    }
                }
            }
        }
    }
    findings
}
fn spatial_span(frames: &[Value], selector: &Value) -> f64 {
    let samples: Vec<_> = frames
        .iter()
        .skip(1)
        .take(frames.len().saturating_sub(2))
        .filter_map(|f| {
            f["elements"]
                .as_array()?
                .iter()
                .find(|e| e["selector"] == *selector)
        })
        .collect();
    (0..4)
        .map(|i| {
            let values: Vec<_> = samples.iter().map(|e| number(&e["box"][i])).collect();
            if values.is_empty() {
                0.
            } else {
                values.iter().copied().fold(f64::NEG_INFINITY, f64::max)
                    - values.iter().copied().fold(f64::INFINITY, f64::min)
            }
        })
        .fold(0., f64::max)
}
fn reduced_findings(capture: &Capture, baseline: &Capture) -> Vec<Value> {
    let duration = number(&baseline.meta["duration"]);
    if duration < 100. || number(&capture.meta["duration"]) < duration * 0.9 {
        return vec![];
    }
    capture.frames[1]["elements"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|el| {
            let normal = spatial_span(&baseline.frames, &el["selector"]);
            let reduced = spatial_span(&capture.frames, &el["selector"]);
            (normal > 2. && reduced >= normal * 0.9).then(|| {
                finding(
                    "reduced-motion-ignored",
                    el,
                    &capture.frames[1],
                    number(&capture.meta["duration"]) / duration,
                )
            })
        })
        .collect()
}
fn write_evidence(out: &Path, capture: &Capture, report: &Value) -> Result<(), CdpError> {
    std::fs::create_dir_all(out).map_err(err)?;
    let mut images = vec![];
    for (i, encoded) in capture.images.iter().enumerate() {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(err)?;
        images.push(image::load_from_memory(&bytes).map_err(err)?.to_rgba8());
        std::fs::write(out.join(format!("frame-{i:02}.png")), bytes).map_err(err)?;
    }
    let first = images.first().ok_or_else(|| err("No motion frames"))?;
    let (width, height) = first.dimensions();
    let columns = 3;
    let rows = (images.len() as u32).div_ceil(columns);
    let mut strip = image::RgbaImage::new(width * columns, height * rows);
    for (i, img) in images.iter().enumerate() {
        image::imageops::overlay(
            &mut strip,
            img,
            (i as u32 % columns * width) as i64,
            (i as u32 / columns * height) as i64,
        );
    }
    strip.save(out.join("filmstrip.png")).map_err(err)?;
    let data = serde_json::to_string(&capture.images).map_err(err)?;
    let html = format!(
        r#"<!doctype html><meta charset="utf-8"><title>Motion evidence</title><style>body{{font:16px system-ui;background:#202020;color:white;margin:24px}}img{{display:block;max-width:100%;margin-top:16px}}input{{width:min(800px,90vw)}}</style><h1>Motion evidence</h1><label>Frame <output id="label"></output><br><input id="scrub" type="range" min="0" max="{}" value="0" step="1"></label><img id="frame" alt="Captured motion frame"><script>const images={data};const phases={};const scrub=document.getElementById('scrub'),frame=document.getElementById('frame'),label=document.getElementById('label');function show(){{const i=Number(scrub.value);frame.src='data:image/png;base64,'+images[i];label.textContent=i+' · '+phases[i].phase+' · '+phases[i].timeMs.toFixed(2)+' ms';}}scrub.oninput=show;show();</script>"#,
        images.len() - 1,
        serde_json::to_string(
            &capture
                .frames
                .iter()
                .map(|f| json!({"phase":f["phase"],"timeMs":f["timeMs"]}))
                .collect::<Vec<_>>()
        )
        .map_err(err)?
    );
    std::fs::write(out.join("index.html"), html).map_err(err)?;
    // Write the manifest last, so a failed capture never advertises valid evidence.
    std::fs::write(
        out.join("report.json"),
        serde_json::to_vec_pretty(report).map_err(err)?,
    )
    .map_err(err)?;
    Ok(())
}
pub fn run(args: &[String], io: &mut Io) -> i32 {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        io.out(HELP);
        return 0;
    }
    let result = (|| {
        let o = options(args, &io.cwd)?;
        // Invalidate the previous manifest before attempting to replace evidence.
        let manifest = o.out.join("report.json");
        if manifest.exists() {
            std::fs::remove_file(&manifest).map_err(err)?;
        }
        let baseline = if o.reduce {
            Some(record(&o, &io.env, false, false)?)
        } else {
            None
        };
        let capture = record(&o, &io.env, o.reduce, true)?;
        let mut findings = if number(&capture.meta["duration"]) > 0. {
            analyze(&capture.frames)
        } else {
            vec![]
        };
        if let Some(base) = &baseline {
            findings.extend(reduced_findings(&capture, base));
        }
        let report = json!({"schemaVersion":1,"reducedMotion":o.reduce,"viewport":{"width":1000,"height":760},"region":capture.region,"interaction":o.steps,"durationMs":capture.meta["duration"],"animations":capture.meta["animations"],"baselineDurationMs":baseline.as_ref().map(|b|&b.meta["duration"]),"frames":capture.frames,"findings":findings,"limitations":["Fixed viewport and region; sampled frames are evidence, not a proof of smoothness.","View Transition pseudo-element boxes are computed-style estimates; inspect the filmstrip for actual paint.","JavaScript timers are not scrubbed. Long-running and newly chained animations require a separate capture.","Clip paths, masks, canvas, cross-origin frames and closed shadow roots require visual review."]});
        write_evidence(&o.out, &capture, &report)?;
        io.out(&format!(
            "{}\n",
            serde_json::to_string(&report).map_err(err)?
        ));
        io.err(&format!(
            "Motion capture: {} frames, {} findings. Evidence: {}\n",
            capture.frames.len(),
            report["findings"].as_array().unwrap().len(),
            o.out.display()
        ));
        Ok::<(), CdpError>(())
    })();
    match result {
        Ok(()) => 0,
        Err(e) => {
            io.err(&format!("Motion capture: {}\n", e.message));
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn frame(index: usize, x: f64, opacity: f64, content: &str, clipped: f64) -> Value {
        json!({"index":index,"timeMs":index*100,"viewTransition":false,"paint":{},"elements":[{"id":1,"selector":"#card","box":[x,0,100,100],"opacity":opacity,"content":content,"clipped":clipped}]})
    }
    #[test]
    fn motion_continuity_boundaries_and_smooth_control() {
        let smooth: Vec<_> = [0., 0., 10., 20., 30., 30.]
            .into_iter()
            .enumerate()
            .map(|(i, x)| frame(i, x, 1., "card", 0.))
            .collect();
        assert!(analyze(&smooth).is_empty());
        let mut frames = smooth.clone();
        frames[1]["elements"][0]["opacity"] = json!(0.5);
        assert!(
            analyze(&frames)
                .iter()
                .any(|f| f["kind"] == "start-jump" && f["frameIndex"] == 1)
        );
        let mut frames = smooth;
        frames[5]["elements"][0]["box"][0] = json!(45.);
        assert!(
            analyze(&frames)
                .iter()
                .any(|f| f["kind"] == "end-jump" && f["magnitude"] == 15.)
        );
    }
    #[test]
    fn motion_midway_content_clip_and_paint() {
        let mut frames: Vec<_> = [0., 0., 1., 50., 51., 51.]
            .into_iter()
            .enumerate()
            .map(|(i, x)| {
                frame(
                    i,
                    x,
                    1.,
                    if i == 0 { "old" } else { "new" },
                    if i == 3 { 0.5 } else { 0. },
                )
            })
            .collect();
        frames[0]["paint"] = json!({"1:2":2});
        frames[3]["paint"] = json!({"1:2":1});
        let findings = analyze(&frames);
        for kind in [
            "mid-step",
            "content-swap",
            "clipped-midway",
            "paint-order-flip",
        ] {
            assert!(
                findings.iter().any(|f| f["kind"] == kind),
                "{kind}: {findings:?}"
            );
        }
    }
    #[test]
    fn motion_boundary_presence_and_content() {
        let frames: Vec<_> = (0..5).map(|i| frame(i, 0., 1., "card", 0.)).collect();
        let mut removed = frames.clone();
        removed[4]["elements"] = json!([]);
        assert!(analyze(&removed).iter().any(|f| f["kind"] == "end-jump"));
        let mut appeared = frames.clone();
        appeared[0]["elements"] = json!([]);
        assert!(analyze(&appeared).iter().any(|f| f["kind"] == "start-jump"));
        let mut swapped = frames;
        swapped[4]["elements"][0]["content"] = json!("replacement");
        assert!(analyze(&swapped).iter().any(|f| f["kind"] == "end-jump"));
    }
    #[test]
    fn motion_fading_in_new_content_is_not_an_instant_swap() {
        let mut frames: Vec<_> = [0., 0., 10., 20., 30., 30.]
            .into_iter()
            .enumerate()
            .map(|(i, x)| frame(i, x, 1., "", 0.))
            .collect();
        frames[0]["elements"][0]["children"] = json!([]);
        for (i, frame) in frames.iter_mut().enumerate().skip(1) {
            frame["elements"][0]["children"] = json!([2]);
            frame["elements"].as_array_mut().unwrap().push(json!({"id":2,"selector":"#copy","box":[0,0,100,100],"opacity":([0.,0.,0.3,0.6,1.,1.][i]),"content":"New content","clipped":0}));
        }
        assert!(!analyze(&frames).iter().any(|f| f["kind"] == "content-swap"));
    }
    #[test]
    fn motion_reduced_checks_distance_and_duration() {
        let capture = |distance: f64, duration: f64| Capture {
            frames: [0., 0., distance / 2., distance, distance]
                .into_iter()
                .enumerate()
                .map(|(i, x)| frame(i, x, 1., "card", 0.))
                .collect(),
            images: vec![],
            meta: json!({"duration":duration}),
            region: json!([0, 0, 100, 100]),
        };
        let baseline = capture(100., 600.);
        assert_eq!(
            reduced_findings(&capture(100., 600.), &baseline)[0]["kind"],
            "reduced-motion-ignored"
        );
        assert!(reduced_findings(&capture(10., 600.), &baseline).is_empty());
        assert!(reduced_findings(&capture(100., 100.), &baseline).is_empty());
        assert!(reduced_findings(&capture(0., 600.), &baseline).is_empty());
    }
    #[test]
    fn motion_capture_region_follows_scrolled_viewport_coordinates() {
        assert_eq!(
            document_region(&json!([20, 30, 400, 200]), &json!([10, 500])),
            (30., 530., 400., 200.)
        );
    }
    #[test]
    fn motion_rejects_invalid_options_before_launch() {
        for args in [
            vec![
                "https://example.test",
                "--click",
                "#a",
                "--out-dir",
                "out",
                "--frames",
                "2",
            ],
            vec!["javascript:alert(1)", "--click", "#a", "--out-dir", "out"],
            vec!["https://example.test", "--click", "#a"],
        ] {
            assert!(
                options(
                    &args.into_iter().map(String::from).collect::<Vec<_>>(),
                    Path::new("/tmp")
                )
                .is_err()
            );
        }
    }
}
