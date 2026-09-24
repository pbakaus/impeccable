//! Diagnostic asset capture over isolated Chromium. No approval policy lives here.
use base64::Engine;
use impeccable_browser::{
    cdp::{Browser, IsolatedWorld, Page, Viewport},
    discovery,
    response_capture::ResponseEvidence,
};
use impeccable_comp::{png_io, raster::Image};
use impeccable_comp_verbs::asset_capture::{
    AssetCapture, AssetCaptureRequest, AssetRenderer, CaptureImage, capture_sha256 as hash,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub struct CdpAssetRenderer {
    env: HashMap<String, String>,
}
impl CdpAssetRenderer {
    pub fn from_process_env() -> Self {
        Self {
            env: std::env::vars().collect(),
        }
    }
}
impl AssetRenderer for CdpAssetRenderer {
    fn capture(&mut self, request: &AssetCaptureRequest) -> Result<AssetCapture, String> {
        self.capture_batch(std::slice::from_ref(request))?
            .into_iter()
            .next()
            .ok_or_else(|| "capture returned no evidence".into())
    }
    fn capture_batch(
        &mut self,
        requests: &[AssetCaptureRequest],
    ) -> Result<Vec<AssetCapture>, String> {
        if requests.is_empty() || requests.len() > 32 {
            return Err("capture batch must contain 1 to 32 regions".into());
        }
        let request = &requests[0];
        for item in requests {
            item.validate()?;
            if item.url != request.url
                || item.viewport != request.viewport
                || item.reduced_motion != request.reduced_motion
                || item.reference_bytes != request.reference_bytes
            {
                return Err(
                    "capture batch requires one URL, viewport, reference and motion setting".into(),
                );
            }
        }
        let exe = discovery::find_browser(&self.env)
            .map_err(|e| format!("browser unavailable: {e:?}"))?;
        // Image suppression must restore exact pixels. GPU tile rasterization can
        // round resampled pixels differently after an otherwise identical repaint.
        // Disable partial raster too: reusing invalidated tiles can change antialiasing
        // even with software rasterization. Never substitute a pixel tolerance.
        let mut browser = Browser::launch(&exe, &["--disable-gpu-rasterization".into(), "--disable-partial-raster".into()], false)
            .map_err(|e| e.message)?;
        let browser_version = browser.version().map_err(|e| e.message)?;
        let result = (|| {
            let mut page = browser.new_page().map_err(|e| e.message)?;
            page.set_viewport(Viewport {
                width: request.viewport[0],
                height: request.viewport[1],
            })
            .map_err(|e| e.message)?;
            page.set_reduced_motion(request.reduced_motion)
                .map_err(|e| e.message)?;
            page.begin_response_capture().map_err(|e| e.message)?;
            page.goto(&request.url, "load", Duration::from_secs(30))
                .map_err(|e| e.message)?;
            let world = page.create_isolated_world().map_err(|e| e.message)?;
            let stylesheet = page.create_capture_stylesheet(&world).map_err(|e| e.message)?;
            let mut capture = CapturePage {
                page: &mut page,
                world,
                started: Instant::now(),
                stylesheet,
            };
            // A timeout is an error, never readiness. No resource is fetched again.
            eval(
                &mut capture,
                r#"Promise.race([(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(i=>{const b=i.getBoundingClientRect();return b.width>0&&b.height>0&&b.x<innerWidth&&b.y<innerHeight&&b.right>0&&b.bottom>0;}).map(i=>i.decode().catch(()=>{})));return true;})(),new Promise((_,reject)=>setTimeout(()=>reject(Error('capture resources did not settle')),5000))])"#,
            )?;
            let key = format!(
                "__impeccable_capture_{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            );
            let key = serde_json::to_string(&key).unwrap();
            eval(
                &mut capture,
                &format!("({})({key})", include_str!("asset_capture.js")),
            )?;
            let result: Result<Vec<AssetCapture>, String> = (|| {
                let mut attempts = Vec::new();
                let mut anchor: Option<Value> = None;
                for attempt in 1..=3 {
                    let mut results = Vec::new();
                    for item in requests {
                        results.push(capture_page(&mut capture, item, &key)?);
                    }
                    // Every region must belong to the same settled document and pixels.
                    let first = &results[0].receipt;
                    let identity = |r: &Value| {
                        json!([r["domSha256"], r["captureDocument"], r["networkRevision"]])
                    };
                    if anchor.is_none() {
                        anchor = Some(identity(first));
                    }
                    let same_identity = results.iter().all(|r| {
                        ["domSha256", "captureDocument", "networkRevision"]
                            .iter()
                            .all(|k| !r.receipt[*k].is_null())
                            && Some(identity(&r.receipt)) == anchor
                    });
                    let stable = same_identity
                        && results.iter().all(|r| {
                            r.receipt["stableCapture"] == true
                                && [
                                    "domSha256",
                                    "screenshotSha256",
                                    "captureDocument",
                                    "networkRevision",
                                ]
                                .iter()
                                .all(|k| r.receipt[*k] == first[*k])
                        });
                    attempts.push(json!({"attempt":attempt,"stable":stable,
                    "regions":results.iter().map(|r|json!({"status":r.receipt["status"],"reason":r.receipt["reason"],
                        "screenshotSha256":r.receipt["screenshotSha256"],"domSha256":r.receipt["domSha256"],"networkRevision":r.receipt["networkRevision"]})).collect::<Vec<_>>() }));
                    // Style interventions can invalidate Chromium's raster cache.
                    // Retry the whole batch on the same frozen page; never mix regions
                    // across attempts or relax exact DOM/pixel/network restoration.
                    let raster_retry = same_identity
                        && results
                            .iter()
                            .any(|r| r.receipt["retryableRasterInvalidation"] == true)
                        && results.iter().all(|r| {
                            r.receipt["stableCapture"] == true
                                || r.receipt["retryableRasterInvalidation"] == true
                        });
                    if !stable && raster_retry && attempt < 3 {
                        continue;
                    }
                    let complete =
                        stable && results.iter().all(|r| r.receipt["status"] == "captured");
                    for r in &mut results {
                        r.receipt["batchStabilityVerified"] = json!(stable);
                        r.receipt["batchAttempts"] = json!(attempts);
                    }
                    if !complete && requests.len() > 1 {
                        results = results
                        .into_iter()
                        .map(|mut r| {
                            r.receipt["individualCaptureStatus"] = r.receipt["status"].clone();
                            r.receipt["individualCaptureReason"] = r.receipt["reason"].clone();
                            unavailable(
                                r,
                                if stable {"batch has incomplete surface coverage; stable known-raster observations retained"} else {"batch did not retain one stable document"},
                            )
                        })
                        .collect();
                    }
                    return Ok(results);
                }
                unreachable!("bounded capture loop always returns its final attempt")
            })();
            // Restore even on a failed screenshot/evaluation, then destroy the isolated page.
            let _ = capture.set_stylesheet("");
            let _ = eval(
                &mut capture,
                &format!(
                    "(()=>{{globalThis[{key}]?.restore();delete globalThis[{key}];return true;}})()"
                ),
            );
            drop(capture);
            page.close();
            result
        })();
        browser.close();
        result.map(|captures| {
            captures
                .into_iter()
                .map(|mut capture| {
                    capture.receipt["browser"] = browser_version.clone();
                    capture.receipt["rasterization"] = json!("software");
                    capture.receipt["partialRaster"] = json!(false);
                    capture.receipt["nativeVersion"] = json!(env!("CARGO_PKG_VERSION"));
                    capture.receipt["batchSize"] = json!(requests.len());
                    capture
                })
                .collect()
        })
    }
}
struct CapturePage<'p, 'b> {
    page: &'p mut Page<'b>,
    world: IsolatedWorld,
    started: Instant,
    stylesheet: String,
}
impl<'p, 'b> std::ops::Deref for CapturePage<'p, 'b> {
    type Target = Page<'b>;
    fn deref(&self) -> &Self::Target {
        self.page
    }
}
impl<'p, 'b> std::ops::DerefMut for CapturePage<'p, 'b> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.page
    }
}

impl CapturePage<'_, '_> {
    fn set_stylesheet(&mut self, text: &str) -> Result<(), String> {
        self.check_budget()?;
        self.page.set_capture_stylesheet(&self.world, &self.stylesheet, text).map_err(|e| e.message)
    }
    fn check_budget(&self) -> Result<(), String> {
        if self.started.elapsed() > Duration::from_secs(60) {
            Err("capture exceeded 60-second command-boundary budget".into())
        } else {
            Ok(())
        }
    }
    fn coverage(&mut self) -> Result<Value, String> {
        self.check_budget()?;
        self.page
            .capture_dom_coverage(&self.world)
            .map_err(|e| e.message)
    }
}
fn eval(page: &mut CapturePage<'_, '_>, js: &str) -> Result<Value, String> {
    page.check_budget()?;
    page.page
        .evaluate_value_in_world(&page.world, js)
        .map_err(|e| e.message)
}
fn scan(page: &mut CapturePage<'_, '_>, key: &str) -> Result<Value, String> {
    let retained = eval(page, &format!("(globalThis[{key}].active?.expected||[]).filter(r=>r.pseudo).map(r=>({{index:r.index,pseudo:r.pseudo.slice(2)}}))"))?;
    let retained = retained.as_array().ok_or("capture pseudo identities unavailable")?;
    let pseudos = page.page.capture_pseudo_geometry(&page.world, retained).map_err(|e| e.message)?;
    eval(page, &format!("(()=>{{globalThis[{key}].pseudos={pseudos};return globalThis[{key}].scan();}})()"))
}
fn screenshot(
    page: &mut CapturePage<'_, '_>,
    r: &AssetCaptureRequest,
) -> Result<(Vec<u8>, Image), String> {
    let encoded = page.screenshot_viewport().map_err(|e| e.message)?;
    let png = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| e.to_string())?;
    let image = png_io::decode_png(&png)
        .map_err(|e| format!("screenshot decode: {e:?}"))?
        .image;
    if image.width != r.viewport[0] as usize || image.height != r.viewport[1] as usize {
        return Err("screenshot dimensions differ from viewport".into());
    }
    Ok((png, image))
}
fn overlaps(b: &Value, r: &AssetCaptureRequest) -> bool {
    let v = |k: &str| b[k].as_f64().unwrap_or(0.);
    let e = r.expected_box;
    v("w") > 0.
        && v("h") > 0.
        && v("x") < e.x + e.w
        && v("y") < e.y + e.h
        && v("x") + v("w") > e.x
        && v("y") + v("h") > e.y
}
fn urls(s: &Value) -> Vec<String> {
    let mut result = Vec::new();
    for row in s["rows"].as_array().into_iter().flatten() {
        if let Some(u) = row["url"].as_str() {
            if !result.iter().any(|v| v == u) {
                result.push(u.to_owned());
            }
        }
    }
    result
}
fn evidence(page: &mut CapturePage<'_, '_>, urls: &[String]) -> Result<ResponseEvidence, String> {
    page.response_evidence(urls).map_err(|e| e.message)
}
fn stable_network(e: &ResponseEvidence, revision: u64) -> bool {
    !e.truncated && !e.changed_during_collection && e.revision == revision
}
fn state_reason(s: &Value, r: &AssetCaptureRequest) -> Option<String> {
    if s["sameNodes"] != true {
        return Some("DOM nodes changed".into());
    }
    if s["runningAnimations"].as_u64().unwrap_or(1) > 0 {
        return Some("running page animation".into());
    }
    let v = &s["viewport"];
    if v["width"] != r.viewport[0]
        || v["height"] != r.viewport[1]
        || v["dpr"] != 1.
        || v["scrollX"] != 0.
        || v["scrollY"] != 0.
    {
        return Some("viewport, scale or scroll changed".into());
    }
    None
}
fn receipt(r: &AssetCaptureRequest) -> Value {
    json!({
        "schema":"native-asset-capture-diagnostic-v2","inspectionWorld":"isolated","status":"unavailable","requestedUrl":r.url,"reducedMotion":r.reduced_motion,
        "viewport":{"width":r.viewport[0],"height":r.viewport[1],"dpr":1},"expectedBox":r.expected_box,
        "referenceSha256":hash(&r.reference_bytes),"assetSha256":hash(&r.asset_bytes),
        "adequateVisibility":"not-assessed","instances":[],"scope":"Diagnostic evidence only. Observed identity, geometry and paint contribution do not establish fidelity, adequate visibility or generation provenance."
    })
}
fn unavailable(mut out: AssetCapture, reason: impl Into<String>) -> AssetCapture {
    out.receipt["status"] = json!("unavailable");
    out.receipt["reason"] = json!(reason.into());
    out
}
fn static_raster(bytes: &[u8]) -> bool {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return true;
    }
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return false;
    }
    // APNG has an acTL chunk. Read chunk boundaries, not incidental payload text.
    let mut p = 8;
    while p + 12 <= bytes.len() {
        let len = u32::from_be_bytes(bytes[p..p + 4].try_into().unwrap()) as usize;
        if &bytes[p + 4..p + 8] == b"acTL" {
            return false;
        }
        let Some(next) = p.checked_add(12).and_then(|x| x.checked_add(len)) else {
            return false;
        };
        if next > bytes.len() {
            return false;
        }
        if &bytes[p + 4..p + 8] == b"IEND" {
            return true;
        }
        p = next;
    }
    false
}
fn changed_pixels(a: &Image, b: &Image, r: &AssetCaptureRequest) -> (u64, u64) {
    let e = r.expected_box;
    let mut region = 0;
    let mut total = 0;
    for y in 0..a.height {
        for x in 0..a.width {
            let p = (y * a.width + x) * 4;
            if a.data[p..p + 4] != b.data[p..p + 4] {
                total += 1;
                // Pixel centers define the fixed reference-owned sampling region.
                if x as f64 + 0.5 >= e.x
                    && x as f64 + 0.5 < e.x + e.w
                    && y as f64 + 0.5 >= e.y
                    && y as f64 + 0.5 < e.y + e.h
                {
                    region += 1;
                }
            }
        }
    }
    (region, total)
}
fn capture_page(
    page: &mut CapturePage<'_, '_>,
    r: &AssetCaptureRequest,
    key: &str,
) -> Result<AssetCapture, String> {
    let mut out = AssetCapture {
        receipt: receipt(r),
        images: Vec::new(),
    };
    let coverage = page.coverage()?;
    out.receipt["domCoverage"] = coverage.clone();
    out.receipt["limits"] =
        json!({"nativeDomNodes":5000,"matchingInstances":16,"commandBoundaryBudgetSeconds":60});
    if coverage["closedShadowRoots"].as_u64().unwrap_or(1) > 0 {
        return Ok(unavailable(
            out,
            "authored closed shadow content is unsupported",
        ));
    }
    let mut settled = None;
    let mut settling_checks = Vec::new();
    for attempt in 0..3 {
        let s = scan(page, key)?;
        if let Some(reason) = state_reason(&s, r) {
            out.receipt["unsupported"] = s["unsupported"].clone();
            return Ok(unavailable(out, reason));
        }
        let mut list = urls(&s);
        if !list.contains(&r.url) {
            list.push(r.url.clone());
        }
        let e = evidence(page, &list)?;
        let (png, first) = screenshot(page, r)?;
        let middle = scan(page, key)?;
        let (second_png, second) = screenshot(page, r)?;
        let after = scan(page, key)?;
        let end = evidence(page, &list)?;
        let (changed_in_region, changed_in_viewport) = changed_pixels(&first, &second, r);
        settling_checks.push(json!({"attempt":attempt+1,"domBeforeAfterStable":s==middle && s==after,
            "pixelsStable":first.data==second.data,"changedPixelsInRegion":changed_in_region,"changedPixelsInViewport":changed_in_viewport,
            "networkStable":stable_network(&end,e.revision),"networkRevisionBefore":e.revision,"networkRevisionAfter":end.revision,
            "networkChangedDuringCollection":e.changed_during_collection}));
        out.receipt["settlingChecks"] = json!(settling_checks);
        out.receipt["settlingResponses"] = json!(end.responses.iter().map(|e|json!({"url":e.url,"status":e.status,"bytes":e.body.as_ref().map(Vec::len),"unavailable":e.unavailable_reason,"fromDiskCache":e.from_disk_cache})).collect::<Vec<_>>());
        if attempt == 2
            && (s != middle
                || s != after
                || first.data != second.data
                || !stable_network(&end, e.revision)
                || e.changed_during_collection)
        {
            out.images.push(CaptureImage {
                name: "unsettled-before.png".into(),
                png: png.clone(),
            });
            out.images.push(CaptureImage {
                name: "unsettled-after.png".into(),
                png: second_png,
            });
        }
        if s == middle
            && s == after
            && first.data == second.data
            && stable_network(&end, e.revision)
            && !e.changed_during_collection
        {
            settled = Some((s, png, first, end, list));
            break;
        }
    }
    let Some((baseline, png, pixels, network, list)) = settled else {
        out.receipt["settlingResources"] = eval(
            page,
            "performance.getEntriesByType('resource').slice(-128).map(r=>({name:r.name,initiatorType:r.initiatorType,startTime:r.startTime,duration:r.duration}))",
        )?;
        return Ok(unavailable(
            out,
            "page did not settle within three capture checks",
        ));
    };
    let document: Vec<_> = network
        .responses
        .iter()
        .filter(|e| e.url == r.url)
        .collect();
    if document.len() == 1 && !document[0].ambiguous_url && document[0].unavailable_reason.is_none()
    {
        out.receipt["documentResponseSha256"] = json!(document[0].body.as_deref().map(hash));
        // True when CDP reported decoded text: the hash covers `decoded_text(served)`.
        out.receipt["documentResponseText"] = json!(document[0].text);
        out.receipt["captureDocument"] = json!({"requestId":document[0].request_id,"frameId":document[0].frame_id,"loaderId":document[0].loader_id});
    }
    out.receipt["screenshotSha256"] = json!(hash(&png));
    out.receipt["screenshot"] = json!("baseline.png");
    out.receipt["domSha256"] = json!(hash(baseline["dom"].as_str().unwrap_or("").as_bytes()));
    out.receipt["resolvedUrl"] = baseline["url"].clone();
    out.receipt["networkRevision"] = json!(network.revision);
    out.images.push(CaptureImage {
        name: "baseline.png".into(),
        png,
    });
    let unsupported: Vec<Value> = baseline["unsupported"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| overlaps(&item["box"], r))
        .cloned()
        .collect();
    out.receipt["unsupported"] = json!(unsupported);
    out.receipt["surfaceCoverage"] = json!({"status":if unsupported.is_empty(){"complete-for-supported-main-dom-surface-types"}else{"partial"},
        "unmeasuredSurfaces":unsupported,"scope":"Main-DOM IMG and supported URL background layers, including native measured pseudo-elements. Neighboring unknown surfaces cannot supply required-artwork evidence."});
    let expected = hash(&r.asset_bytes);
    let matching = baseline["rows"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|row| {
            overlaps(&row["box"], r)
                && network.responses.iter().any(|e| {
                    Some(e.url.as_str()) == row["url"].as_str()
                        && e.body_matches(&r.asset_bytes)
                })
        })
        .count();
    if matching > 16 {
        return Ok(unavailable(out, "capture exceeds 16 matching instances"));
    }

    let mut bindings = Vec::new();
    let mut instances = Vec::new();
    let mut unresolved = false;
    let mut group = Vec::new();
    for row in baseline["rows"].as_array().into_iter().flatten() {
        let candidates: Vec<_> = network
            .responses
            .iter()
            .filter(|e| e.url == row["url"].as_str().unwrap_or(""))
            .collect();
        let response = if candidates.len() == 1
            && !candidates[0].ambiguous_url
            && candidates[0].unavailable_reason.is_none()
        {
            Some(candidates[0])
        } else {
            None
        };
        let body = response.and_then(|e| e.body.as_deref());
        let body_hash = body.map(hash);
        let in_region = overlaps(&row["box"], r);
        let supported = body.map(static_raster).unwrap_or(false) && row["decoded"] != false;
        bindings.push(json!({"element":row,"responseSha256":body_hash,"supportedStaticRaster":supported,
            "responseCandidates":candidates.iter().map(|e|json!({"requestId":e.request_id,"frameId":e.frame_id,"loaderId":e.loader_id,"status":e.status,"mimeType":e.mime_type,"ambiguousUrl":e.ambiguous_url,"unavailableReason":e.unavailable_reason,"fromDiskCache":e.from_disk_cache,"fromServiceWorker":e.from_service_worker})).collect::<Vec<_>>()}));
        if in_region && !supported {
            unresolved = true;
        }
        if body_hash.as_deref() != Some(expected.as_str()) {
            continue;
        }
        let b = &row["box"];
        let e = r.expected_box;
        let mut instance = json!({"element":row,"responseSha256":body_hash,
            "status":"outside-required-region","boxDelta":{"x":b["x"].as_f64().unwrap_or(0.)-e.x,"y":b["y"].as_f64().unwrap_or(0.)-e.y,"w":b["w"].as_f64().unwrap_or(0.)-e.w,"h":b["h"].as_f64().unwrap_or(0.)-e.h}});
        if !in_region {
            instances.push(instance);
            continue;
        }
        if !supported {
            instance["status"] = json!("unavailable");
            instances.push(instance);
            continue;
        }
        let item = json!({"index":row["index"],"kind":row["kind"],"pseudo":row["pseudo"],"layer":row["layer"]});
        group.push(item.clone());
        let (without, without_pixels) = match intervene(
            page,
            r,
            key,
            &baseline,
            &pixels,
            network.revision,
            &list,
            &json!([item]),
            &mut out.images,
        ) {
            Ok(v) => v,
            Err(failure) => {
                out.receipt["retryableRasterInvalidation"] = json!(failure.raster_only);
                out.receipt["interventionResources"] = eval(
                    page,
                    "performance.getEntriesByType('resource').slice(-128).map(r=>({name:r.name,initiatorType:r.initiatorType,startTime:r.startTime,duration:r.duration}))",
                )?;
                return Ok(unavailable(out, failure.reason));
            }
        };
        let (changed, total) = changed_pixels(&pixels, &without_pixels, r);
        let name = format!("without-{}.png", instances.len());
        instance["status"] = json!("measured");
        instance["changedPixelsInRegion"] = json!(changed);
        instance["changedPixelsInViewport"] = json!(total);
        instance["suppressedScreenshot"] = json!(name);
        instance["suppressedScreenshotSha256"] = json!(hash(&without));
        instance["restorationVerified"] = json!(true);
        out.images.push(CaptureImage { name, png: without });
        instances.push(instance);
    }
    // Individual marginal contributions can all be zero for identical stacked
    // copies. Measure their union as well, excluding out-of-region instances.
    if group.len() > 1 {
        let (without, without_pixels) = match intervene(
            page,
            r,
            key,
            &baseline,
            &pixels,
            network.revision,
            &list,
            &json!(group),
            &mut out.images,
        ) {
            Ok(v) => v,
            Err(failure) => {
                out.receipt["retryableRasterInvalidation"] = json!(failure.raster_only);
                out.receipt["interventionResources"] = eval(
                    page,
                    "performance.getEntriesByType('resource').slice(-128).map(r=>({name:r.name,initiatorType:r.initiatorType,startTime:r.startTime,duration:r.duration}))",
                )?;
                return Ok(unavailable(out, failure.reason));
            }
        };
        let (changed, total) = changed_pixels(&pixels, &without_pixels, r);
        out.receipt["combinedContribution"] = json!({"status":"measured","instanceCount":group.len(),"changedPixelsInRegion":changed,"changedPixelsInViewport":total,"suppressedScreenshot":"without-combined.png","suppressedScreenshotSha256":hash(&without),"restorationVerified":true});
        out.images.push(CaptureImage {
            name: "without-combined.png".into(),
            png: without,
        });
    } else if let Some(instance) = instances.iter().find(|i| i["status"] == "measured") {
        out.receipt["combinedContribution"] = json!({"status":"measured","instanceCount":1,"changedPixelsInRegion":instance["changedPixelsInRegion"],"changedPixelsInViewport":instance["changedPixelsInViewport"],"suppressedScreenshot":instance["suppressedScreenshot"],"suppressedScreenshotSha256":instance["suppressedScreenshotSha256"],"restorationVerified":true});
    } else {
        out.receipt["combinedContribution"] =
            json!({"status":"no-matching-supported-instance","instanceCount":0});
    }
    out.receipt["resourceBindings"] = json!(bindings);
    out.receipt["instances"] = json!(instances);
    let (_, final_pixels) = screenshot(page, r)?;
    if scan(page, key)? != baseline
        || final_pixels.data != pixels.data
        || !stable_network(&evidence(page, &list)?, network.revision)
    {
        return Ok(unavailable(out, "page changed by final capture check"));
    }
    let final_coverage = page.coverage()?;
    if final_coverage != coverage {
        return Ok(unavailable(
            out,
            "native DOM coverage changed during capture",
        ));
    }
    // Unknown neighboring renderers do not prevent an exact intervention on
    // an observed PNG. Preserve that scoped evidence while keeping the broader
    // capture unavailable; it is not a pass or an exhaustive surface census.
    out.receipt["stableCapture"] = json!(true);
    out.receipt["knownRasterEvidence"] = json!({"status":"measured","adequateVisibility":"not-assessed","inventoryCoverage":if unresolved || !unsupported.is_empty(){"partial"}else{"supported-main-dom-types"}});
    if !unsupported.is_empty() {
        return Ok(unavailable(
            out,
            "unsupported rendered surface in required region; known raster contribution measured separately",
        ));
    }
    if unresolved {
        return Ok(unavailable(
            out,
            "resource identity, decode or format unavailable in required region",
        ));
    }
    out.receipt["status"] = json!("captured");
    out.receipt["stableCapture"] = json!(true);
    Ok(out)
}

struct InterventionFailure {
    reason: String,
    raster_only: bool,
}
impl From<String> for InterventionFailure {
    fn from(reason: String) -> Self {
        Self {
            reason,
            raster_only: false,
        }
    }
}
impl From<&str> for InterventionFailure {
    fn from(reason: &str) -> Self {
        reason.to_string().into()
    }
}

fn intervene(
    page: &mut CapturePage<'_, '_>,
    r: &AssetCaptureRequest,
    key: &str,
    baseline: &Value,
    pixels: &Image,
    revision: u64,
    list: &[String],
    items: &Value,
    diagnostics: &mut Vec<CaptureImage>,
) -> Result<(Vec<u8>, Image), InterventionFailure> {
    let before = scan(page, key)?;
    let (_, before_pixels) = screenshot(page, r)?;
    if &before != baseline
        || before_pixels.data != pixels.data
        || !stable_network(&evidence(page, list)?, revision)
    {
        return Err("page changed before intervention".into());
    }
    let suppressed = eval(page, &format!("globalThis[{key}].suppressMany({items})"));
    let intervention: Result<(Vec<u8>, Image), String> = (|| {
        let suppressed = suppressed?;
        page.set_stylesheet(suppressed["rules"].as_str().ok_or("capture suppression rules unavailable")?)?;
        eval(page, &format!("globalThis[{key}].settle()"))?;
        eval(page, &format!("globalThis[{key}].verifySuppression()"))?;
        let (without, without_pixels) = screenshot(page, r)?;
        let during = scan(page, key)?;
        if during["dom"] != suppressed["dom"]
            || during["layout"] != baseline["layout"]
            || suppressed["layout"] != baseline["layout"]
            || during["pseudoLayout"] != baseline["pseudoLayout"]
            || during["sameNodes"] != true
            || during["runningAnimations"].as_u64().unwrap_or(1) > 0
        {
            return Err("page, layout or animation changed during intervention".into());
        }
        Ok((without, without_pixels))
    })();
    let stylesheet_restore = page.set_stylesheet("");
    eval(
        page,
        &format!("(()=>{{globalThis[{key}].restore();return globalThis[{key}].settle();}})()"),
    )?;
    stylesheet_restore?;
    let result = intervention?;
    let restored_dom = scan(page, key)?;
    let (restored_png, restored_pixels) = screenshot(page, r)?;
    let restored_network = evidence(page, list)?;
    if &restored_dom != baseline
        || restored_pixels.data != pixels.data
        || !stable_network(&restored_network, revision)
    {
        diagnostics.push(CaptureImage {
            name: "restoration-failed.png".into(),
            png: restored_png,
        });
        return Err(InterventionFailure {
            raster_only: &restored_dom == baseline && stable_network(&restored_network, revision),
            reason: format!(
                "intervention did not restore stable page and network (DOM {}, pixels {}, network revision {} -> {}, truncated {}, changed while reading {})",
                &restored_dom == baseline,
                restored_pixels.data == pixels.data,
                revision,
                restored_network.revision,
                restored_network.truncated,
                restored_network.changed_during_collection
            ),
        });
    }
    Ok(result)
}
