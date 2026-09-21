//! Native component previews over the shared frozen-input/CDP capture foundation.
//! This records provenance and pixels; visual acceptance remains a separate human decision.
use base64::Engine;
use impeccable_browser::{
    cdp::{Browser, Viewport},
    discovery,
    html_snapshot::HtmlSnapshot,
};
use impeccable_context::component_review::capture::{CapturedPreviews, ComponentCapturer};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc, time::Duration};

pub struct NativeComponentCapturer;
fn hash(bytes: &[u8]) -> String {
    // The PNG module and review store use the same SHA-256; avoid a second hash contract.
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}
fn source(view: &Value) -> Result<&str, String> {
    view["url"]
        .as_str()
        .and_then(|s| s.strip_prefix("/files/"))
        .ok_or_else(|| "preview needs a pinned source".into())
}
fn material(png: &[u8], format: &str) -> Result<Value, String> {
    let (image, source_format) = impeccable_comp::png_io::decode_review_image(png)?;
    let format = if format == "Captured HTML / CSS / SVG" { format } else { source_format };
    Ok(
        json!({"format":format,"width":image.width,"height":image.height,"alpha":if image.data.chunks_exact(4).any(|p|p[3]<255){"transparent"}else{"opaque"}}),
    )
}
// Region capture must not resize Chromium's surface: clipped CDP captures can
// change edge antialiasing between frames. Verify the unmodified viewport first,
// then take an integer crop from those exact pixels, without resizing.
fn crop_viewport(png: &[u8], width: u32, height: u32, clip: [f64; 4]) -> Result<Vec<u8>, String> {
    let image = impeccable_comp::png_io::decode_png(png)?.image;
    if image.width != width as usize || image.height != height as usize {
        return Err("component capture does not match the requested viewport".into());
    }
    let [x, y, w, h] = clip;
    // The manifest allows a 1e-5 normalized edge tolerance. Validate the
    // continuous box before clipping; do not rescue genuinely outside regions.
    if !clip.iter().all(|v| v.is_finite()) || x < 0. || y < 0. || w <= 0. || h <= 0.
        || x + w > width as f64 * 1.00001 || y + h > height as f64 * 1.00001 {
        return Err("component box must contain real pixels inside the viewport".into());
    }
    // Round endpoints together: round(x) + round(w) can exceed an odd-sized
    // viewport even when x + w is exactly its edge.
    let rect = impeccable_comp::raster::clamp_rect(&image, x, y, w, h);
    if rect.w == 0 || rect.h == 0 {
        return Err("component box must contain real pixels inside the viewport".into());
    }
    impeccable_comp::png_io::encode_png(&impeccable_comp::raster::crop(
        &image, rect.x as f64, rect.y as f64, rect.w as f64, rect.h as f64,
    ), &[])
}
fn render_page(
    browser: &mut Browser,
    snapshot: Arc<HtmlSnapshot>,
    width: u32,
    height: u32,
    box_: &Value,
    isolation: Option<&Value>,
    assembled: bool,
) -> Result<(Vec<u8>, Value), String> {
    let server = if assembled { snapshot.serve_assembled()? } else { snapshot.serve()? };
    let url = server.entry_url();
    let origin = url.split('/').take(3).collect::<Vec<_>>().join("/");
    let mut page = browser.new_page().map_err(|e| e.message)?;
    let result = (|| {
        page.set_viewport(Viewport { width, height })
            .map_err(|e| e.message)?;
        page.set_reduced_motion(true).map_err(|e| e.message)?;
        page.begin_response_capture().map_err(|e| e.message)?;
        page.goto(&url, "networkidle0", Duration::from_secs(20))
            .map_err(|e| e.message)?;
        let world = page.create_isolated_world().map_err(|e| e.message)?;
        let supported = r#"(()=>{if((!ASSEMBLED&&document.scripts.length)||document.querySelector('iframe,frame,object,embed,canvas'))throw Error('Component capture requires static HTML/CSS/SVG; script, frame and canvas components need a supported capture adapter.');return true;})()"#
            .replace("ASSEMBLED", if assembled { "true" } else { "false" });
        page.evaluate_value_in_world(&world, &supported).map_err(|e|e.message)?;
        let urls = page.observed_response_urls().map_err(|e| e.message)?;
        let evidence = page.response_evidence(&urls).map_err(|e| e.message)?;
        if evidence.truncated
            || evidence.changed_during_collection
            || !evidence.missing_urls.is_empty()
        {
            return Err("component network evidence is incomplete".into());
        }
        let mut responses = BTreeMap::new();
        let mut dependency_errors = std::collections::BTreeSet::new();
        for record in &evidence.responses {
            if record.url.starts_with("data:image/") {
                continue;
            }
            if record.url == format!("{origin}/favicon.ico")
                && record.status == Some(404.)
                && snapshot.bytes("favicon.ico").is_none()
            {
                continue;
            }
            let Some(target) = record.url.strip_prefix(&origin) else {
                dependency_errors.insert(format!("external dependency: {}", record.url));
                continue;
            };
            let Some(path) = snapshot.serve_path(target) else {
                dependency_errors.insert(format!("undeclared dependency: {target}"));
                continue;
            };
            let expected = snapshot.bytes(&path).ok_or("missing frozen dependency")?;
            if record.status != Some(200.)
                || !record.complete
                || record.from_service_worker
                || record.ambiguous_url
                || record.body.as_deref() != Some(expected)
            {
                dependency_errors.insert(format!("dependency did not match frozen bytes: {path}"));
                continue;
            }
            responses.insert(path, hash(expected));
        }
        if !dependency_errors.is_empty() {
            let shown = dependency_errors.iter().take(16).cloned().collect::<Vec<_>>().join("; ");
            return Err(format!("Component resources failed ({}): {shown}. Declare missing files in this component's dependencies, including files used outside its selector; check that declared files load from their pinned bytes.", dependency_errors.len()));
        }
        if !responses.contains_key(snapshot.entry()) {
            return Err("component document response is unverified".into());
        }
        let inspect = r#"(async()=>{
          await Promise.race([(async()=>{await document.fonts.ready;const failed=await Promise.all([...document.images].map(async i=>{try{await i.decode();return null;}catch{const src=i.currentSrc||i.getAttribute('src')||'(missing src)';return src.startsWith('data:')?'(inline image)':new URL(src,location.href).pathname;}}));if(failed.some(Boolean))throw Error('Images failed to decode: '+[...new Set(failed.filter(Boolean))].join(', '));})(),new Promise((_,reject)=>setTimeout(()=>reject(Error('component resources did not settle')),5000))]);
          if([...document.fonts].some(f=>f.status==='error'))throw Error('A component font failed to load.');
          if(document.getAnimations().some(a=>a.playState==='running'))throw Error('Component is animated; provide its static review state.');
          return {html:document.documentElement.outerHTML,svg:document.querySelectorAll('svg').length,images:document.images.length,controls:document.querySelectorAll('button,input,select,textarea,a[href]').length};
        })()"#.replace("ASSEMBLED", if assembled { "true" } else { "false" });
        let dom=page.evaluate_value_in_world(&world,&inspect).map_err(|e|e.message)?;
        let isolated = if let Some(targets) = isolation {
            page.set_transparent_background().map_err(|e| e.message)?;
            let script = format!("({})({})", include_str!("component_isolation.js"), targets);
            Some(page.evaluate_value_in_world(&world, &script).map_err(|e| e.message)?)
        } else { None };
        let captured_dom = page.evaluate_value_in_world(&world, "document.documentElement.outerHTML").map_err(|e| e.message)?;
        let coords = ["x", "y", "w", "h"].map(|k| box_[k].as_f64().unwrap());
        let clip = [
            coords[0] * width as f64,
            coords[1] * height as f64,
            coords[2] * width as f64,
            coords[3] * height as f64,
        ];
        if let Some(isolated) = &isolated {
            let b = &isolated["paintBounds"];
            let (x, y, w, h) = (b["x"].as_f64().unwrap(), b["y"].as_f64().unwrap(), b["width"].as_f64().unwrap(), b["height"].as_f64().unwrap());
            if x < clip[0] - 1. || y < clip[1] - 1. || x + w > clip[0] + clip[2] + 1. || y + h > clip[1] + clip[3] + 1. {
                return Err(format!("{}: review crop clips component content. Measured crop [{:.1}, {:.1}, {:.1}, {:.1}], visible content [{x:.1}, {y:.1}, {w:.1}, {h:.1}]. Check the reference region and component layout before asking the user to review it.", isolated["selector"].as_str().unwrap_or("component"), clip[0], clip[1], clip[2], clip[3]));
            }
        }
        let first = page
            .screenshot_viewport()
            .map_err(|e| e.message)?;
        let second = page
            .screenshot_viewport()
            .map_err(|e| e.message)?;
        let after = page.response_evidence(&urls).map_err(|e| e.message)?;
        if first != second || after.revision != evidence.revision || after.changed_during_collection
        {
            return Err(format!("component changed during capture (pixels: {}, network revision: {} -> {}, response mutation: {})", first != second, evidence.revision, after.revision, after.changed_during_collection));
        }
        // Identity comes from the isolated document, never a producer-written receipt.
        let unchanged = page
            .evaluate_value_in_world(&world, "document.documentElement.outerHTML")
            .map_err(|e| e.message)?;
        if unchanged != captured_dom {
            return Err("component document changed during capture".into());
        }
        let viewport_png = base64::engine::general_purpose::STANDARD
            .decode(first)
            .map_err(|e| e.to_string())?;
        let png = crop_viewport(&viewport_png, width, height, clip)?;
        let mut proof = json!({"kind":"static-code","entry":snapshot.entry(),"inputSnapshot":snapshot.digest(),"inputs":snapshot.manifest(),"observedDependencies":responses,"domSha256":hash(dom["html"].as_str().unwrap().as_bytes()),"screenshotSha256":hash(&png),"viewportScreenshotSha256":hash(&viewport_png),"cropMethod":"verified-viewport-pixels","viewport":{"width":width,"height":height,"dpr":1},"box":box_,"reducedMotion":true,"svgElements":dom["svg"],"rasterElements":dom["images"],"semanticControls":dom["controls"]});
        if let Some(isolated) = isolated {
            proof["isolation"] = isolated;
            proof["capturedDomSha256"] = json!(hash(captured_dom.as_str().unwrap().as_bytes()));
        }
        if assembled {
            proof["kind"] = json!("assembled-page");
            proof["scriptPolicy"] = json!("pinned-local-and-inline; network-api-and-workers-disabled");
        }
        Ok((png, proof))
    })();
    page.close();
    result
}
impl ComponentCapturer for NativeComponentCapturer {
    fn capture(
        &mut self,
        packet: &mut Value,
        inputs: &BTreeMap<String, Vec<u8>>,
    ) -> Result<CapturedPreviews, String> {
        let isolated = packet["schemaVersion"] == 2 && packet["stage"] == "components";
        let assembled = packet["stage"] == "hero";
        if packet["stage"] == "components" && !isolated {
            return Err("New component captures require schemaVersion 2 with preview.selector for each code component. Existing review records remain readable.".into());
        }
        let mut targets: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        if isolated {
            for c in packet["components"].as_array().ok_or("missing components")? {
                let target = if c["preview"]["kind"] == "page" { Some(&c["preview"]) }
                    else if c["context"]["kind"] == "page" { Some(&c["context"]) } else { None };
                if let Some(target) = target {
                    targets.entry(source(target)?.into()).or_default().push(json!({"id":c["id"],"selector":target["selector"]}));
                }
            }
        }
        let width = packet["comp"]["width"]
            .as_u64()
            .ok_or("missing comp width")? as u32;
        let height = packet["comp"]["height"]
            .as_u64()
            .ok_or("missing comp height")? as u32;
        if u64::from(width) * u64::from(height) > 16_000_000 {
            return Err("component viewport exceeds 16 megapixels".into());
        }
        let reference = inputs
            .get(source(&packet["comp"])?)
            .ok_or("missing approved reference")?;
        let reference_size = material(reference, "PNG")?;
        if reference_size["width"] != width || reference_size["height"] != height {
            return Err("comp dimensions do not match its image".into());
        }
        let env = std::env::vars().collect();
        let exe =
            discovery::find_browser(&env).map_err(|e| format!("browser unavailable: {e:?}"))?;
        let mut browser = Browser::launch(&exe, &[], false).map_err(|e| e.message)?;
        let version = browser.version().map_err(|e| e.message)?;
        let result = (|| {
            let mut files = BTreeMap::new();
            let mut evidence = Vec::new();
            // Reuse captures across regions sharing a source and geometry, never across changed inputs.
            let mut cache: BTreeMap<String, (Vec<u8>, Value)> = BTreeMap::new();
            for c in packet["components"]
                .as_array_mut()
                .ok_or("missing components")?
            {
                let id = c["id"].as_str().ok_or("missing component id")?.to_string();
                let mut views = serde_json::Map::new();
                // Context comes from the same frozen document, not a separately
                // authored approximation. It is never a second approval item.
                if isolated && c["preview"]["kind"] == "page" {
                    c["context"] = c["preview"].clone();
                    c["context"].as_object_mut().unwrap().remove("selector");
                    c["context"]["layering"] = json!("Context only. This decision applies to the isolated component; the assembled page is reviewed separately.");
                }
                for key in ["preview", "context"] {
                    if c.get(key).is_none() {
                        continue;
                    }
                    let path = source(&c[key])?.to_string();
                    if key == "preview" && c[key]["kind"] == "image" {
                        let bytes = inputs.get(&path).ok_or("missing raster source")?;
                        c["material"] = material(bytes, "PNG")?;
                        views.insert(
                            key.into(),
                            json!({"kind":"raster-source","path":path,"sha256":hash(bytes)}),
                        );
                        continue;
                    }
                    let mut selected = BTreeMap::new();
                    for name in c["dependencies"]
                        .as_array()
                        .ok_or("missing dependencies")?
                        .iter()
                        .filter_map(Value::as_str)
                        .chain(std::iter::once(path.as_str()))
                    {
                        selected.insert(
                            name.into(),
                            inputs.get(name).ok_or("missing pinned dependency")?.clone(),
                        );
                    }
                    let snapshot = Arc::new(HtmlSnapshot::from_pinned(path.clone(), selected)?);
                    let isolation = if isolated && key == "preview" {
                        Some(json!({"id":id,"targets":targets.get(&path).ok_or("missing component targets")?}))
                    } else { None };
                    let cache_key = format!("{}:{}:{}", snapshot.digest(), c["box"], isolation.as_ref().unwrap_or(&Value::Null));
                    let (png, proof) = if let Some(saved) = cache.get(&cache_key) {
                        saved.clone()
                    } else {
                        let captured =
                            render_page(&mut browser, snapshot, width, height, &c["box"], isolation.as_ref(), assembled)
                                .map_err(|e| format!("{id} {key}: {e}"))?;
                        cache.insert(cache_key, captured.clone());
                        captured
                    };
                    let output = format!("_review_captures/{}.png", hash(&png));
                    c[key]["url"] = json!(format!("/files/{output}"));
                    c[key]["kind"] = json!("image");
                    c[key]["sourceKind"] = json!("page");
                    if let Some(isolation) = proof.get("isolation") {
                        c[key]["isolation"] = isolation.clone();
                    }
                    if key == "preview" {
                        c["material"] = material(&png, "Captured HTML / CSS / SVG")?;
                    }
                    views.insert(key.into(), proof);
                    files.insert(output, png);
                }
                // Thumbnails must show exactly the reviewable output, not a separate producer image.
                c["thumbnail"] = json!({"url":c["preview"]["url"]});
                evidence.push(json!({"id":id,"views":views}));
            }
            Ok(CapturedPreviews {
                files,
                evidence: json!({"schema":"native-component-previews-v1","browser":version,"components":evidence,"scope":if assembled {"Pinned assembled page with local scripts, verified network inputs and stable DOM/pixels. No visual, semantic or human-identity approval."} else {"Pinned raster sources and static HTML/CSS/SVG captures. No visual, semantic or human-identity approval."}}),
            })
        })();
        browser.close();
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires Chromium"]
    fn shared_document_reports_all_missing_images_before_decode_and_names_corrupt_images() {
        let image = impeccable_comp::raster::create_image(40,40,[255,255,255,255]);
        let png = impeccable_comp::png_io::encode_png(&image,&[]).unwrap();
        let html = br#"<!doctype html><style>html,body{margin:0}#piece{width:40px;height:40px;background:red}</style><div id="piece"></div><img src="a.png"><img src="b.png">"#;
        let inputs = BTreeMap::from([("comp.png".into(),png.clone()),("index.html".into(),html.to_vec()),("a.png".into(),png), ("b.png".into(),b"not an image".to_vec())]);
        let packet = json!({"schemaVersion":2,"stage":"components","comp":{"url":"/files/comp.png","width":40,"height":40},"components":[{"id":"piece","box":{"x":0,"y":0,"w":1,"h":1},"preview":{"kind":"page","url":"/files/index.html","selector":"#piece"},"dependencies":[]}]});
        let error = NativeComponentCapturer.capture(&mut packet.clone(),&inputs).err().unwrap();
        assert!(error.contains("a.png") && error.contains("b.png") && error.contains("dependencies"), "{error}");
        assert!(!error.contains("EncodingError"), "{error}");
        let mut declared=packet;declared["components"][0]["dependencies"]=json!(["a.png","b.png"]);
        let error = NativeComponentCapturer.capture(&mut declared,&inputs).err().unwrap();
        assert!(error.contains("b.png") && !error.contains("EncodingError"), "{error}");
    }
    #[test]
    #[ignore = "requires Chromium"]
    fn assembled_page_executes_pinned_script_but_component_capture_stays_static() {
        let image = impeccable_comp::raster::Image { width:40,height:40,data:vec![255;40*40*4] };
        let reference = impeccable_comp::png_io::encode_png(&image,&[]).unwrap();
        let html = br#"<!doctype html><style>html,body{margin:0;background:red}</style><div id="piece"></div><script src="app.js"></script>"#;
        let inputs = BTreeMap::from([("comp.png".into(),reference),("index.html".into(),html.to_vec()),("app.js".into(),b"document.body.style.background='lime';document.documentElement.style.background='lime';".to_vec())]);
        let packet = json!({"schemaVersion":2,"stage":"hero","comp":{"url":"/files/comp.png","width":40,"height":40},"components":[{"id":"hero","box":{"x":0,"y":0,"w":1,"h":1},"preview":{"kind":"page","url":"/files/index.html"},"dependencies":["app.js"]}]});
        let mut hero = packet.clone();
        let captured=NativeComponentCapturer.capture(&mut hero,&inputs).unwrap();
        let path=hero["components"][0]["preview"]["url"].as_str().unwrap().strip_prefix("/files/").unwrap();
        let pixels=impeccable_comp::png_io::decode_png(&captured.files[path]).unwrap().image;
        assert_eq!(&pixels.data[..4], &[0,255,0,255]);
        let proof=&captured.evidence["components"][0]["views"]["preview"];
        assert_eq!(proof["kind"],"assembled-page");
        assert_eq!(proof["observedDependencies"]["app.js"],hash(&inputs["app.js"]));
        let mut component=packet.clone();component["stage"]=json!("components");component["components"][0]["preview"]["selector"]=json!("#piece");
        assert!(NativeComponentCapturer.capture(&mut component,&inputs).err().unwrap().contains("static HTML"));
        let mut missing=packet;missing["components"][0]["dependencies"]=json!([]);
        assert!(NativeComponentCapturer.capture(&mut missing,&inputs).is_err());
    }
    // Real browser regression: shared-document crops used to duplicate the
    // headline in its background card. Run explicitly on a browser-equipped host.
    #[test]
    #[ignore = "requires Chromium"]
    fn isolated_component_capture_keeps_layout_excludes_children_and_preserves_context() {
        let comp = impeccable_comp::raster::Image { width:100,height:100,data:vec![255;100*100*4] };
        let reference = impeccable_comp::png_io::encode_png(&comp,&[]).unwrap();
        let html = br#"<!doctype html><style>
          html,body{margin:0;background:purple} #surface{position:absolute;inset:0;background:yellow}
          #headline{position:absolute;left:10px;top:10px;width:40px;height:40px;background:red}
          #headline::before{content:'';position:absolute;left:0;top:0;width:5px;height:5px;background:cyan;visibility:visible}
          #headline::after{content:'';position:absolute;left:5px;top:0;width:5px;height:5px;background:black;visibility:hidden}
          #child{position:absolute;left:10px;top:10px;width:10px;height:10px;background:lime}
          #sibling{position:absolute;left:70px;top:70px;width:10px;height:10px;background:blue}
        </style><div id="surface"><div id="headline"><span id="child"></span></div></div><div id="sibling"></div>"#;
        let inputs = BTreeMap::from([("comp.png".into(),reference),("kit.html".into(),html.to_vec())]);
        let make = |id:&str| json!({"id":id,"box":{"x":0,"y":0,"w":1,"h":1},"preview":{"kind":"page","url":"/files/kit.html","selector":format!("#{id}")},"dependencies":[]});
        let mut packet = json!({"schemaVersion":2,"stage":"components","comp":{"url":"/files/comp.png","width":100,"height":100},"components":[make("surface"),make("headline"),make("child"),make("sibling")]});
        let captured = NativeComponentCapturer.capture(&mut packet,&inputs).unwrap();
        let pixels = |index:usize,view:&str,x:usize,y:usize| {
            let path=packet["components"][index][view]["url"].as_str().unwrap().strip_prefix("/files/").unwrap();
            let image=impeccable_comp::png_io::decode_png(&captured.files[path]).unwrap().image;
            image.data[(y*100+x)*4..(y*100+x)*4+4].to_vec()
        };
        assert_eq!(pixels(0,"preview",12,12),[255,255,0,255]); // no foreground/pseudo
        assert_eq!(pixels(0,"context",12,12),[0,255,255,255]); // real combined context
        assert_eq!(pixels(1,"preview",16,12),[255,0,0,255]); // hidden pseudo stays hidden
        assert_eq!(pixels(1,"preview",22,22),[255,0,0,255]); // independently owned child absent
        assert_eq!(pixels(1,"preview",75,75)[3],0); // sibling and page canvas absent
        assert_eq!(pixels(2,"preview",22,22),[0,255,0,255]);
        assert_eq!(pixels(2,"preview",12,12)[3],0); // parent's paint absent
        assert_eq!(packet["components"][1]["preview"]["isolation"]["excludedComponents"],json!(["child"]));
        assert_eq!(packet["components"][1]["material"]["alpha"],"transparent");
        let mut raster_child = json!({"schemaVersion":2,"stage":"components","comp":{"url":"/files/comp.png","width":100,"height":100},"components":[make("headline"),make("child")]});
        raster_child["components"][1]["preview"] = json!({"kind":"image","url":"/files/comp.png"});
        raster_child["components"][1]["context"] = json!({"kind":"page","url":"/files/kit.html","selector":"#child"});
        NativeComponentCapturer.capture(&mut raster_child,&inputs).unwrap();
        assert_eq!(raster_child["components"][0]["preview"]["isolation"]["excludedComponents"],json!(["child"]));
        for selector in ["body", "#missing", "div", "#surface"] {
            let mut broken = json!({"schemaVersion":2,"stage":"components","comp":{"url":"/files/comp.png","width":100,"height":100},"components":[make("surface"),make("headline")]});
            broken["components"][1]["preview"]["selector"]=json!(selector);
            assert!(NativeComponentCapturer.capture(&mut broken,&inputs).is_err(),"{selector}");
        }
    }
    #[test]
    fn component_edge_crops_round_endpoints_on_odd_viewports() {
        let image = impeccable_comp::raster::Image {width:3,height:3,data:(0u8..36).collect()};
        let png = impeccable_comp::png_io::encode_png(&image, &[]).unwrap();
        let crop = crop_viewport(&png,3,3,[1.5,1.5,1.5,1.5]).unwrap();
        let pixels = impeccable_comp::png_io::decode_png(&crop).unwrap().image;
        assert_eq!((pixels.width,pixels.height),(1,1));
        assert_eq!(pixels.data,image.data[32..36]);
        // Match the manifest's tolerance for normalized floating-point edges.
        let crop = crop_viewport(&png,3,3,[1.5,1.5,1.500001,1.500001]).unwrap();
        assert_eq!(impeccable_comp::png_io::decode_png(&crop).unwrap().image.data,pixels.data);
    }
    #[test]
    #[ignore = "requires Chromium"]
    fn isolated_capture_refuses_overflow_clipped_by_review_box() {
        let image=impeccable_comp::raster::create_image(200,100,[255,255,255,255]);
        let reference=impeccable_comp::png_io::encode_png(&image,&[]).unwrap();
        let html=br#"<!doctype html><style>html,body{margin:0}#nav{width:60px;height:40px}span{display:block;width:150px;height:20px;background:red}</style><nav id="nav"><span></span></nav>"#;
        let inputs=BTreeMap::from([("comp.png".into(),reference),("kit.html".into(),html.to_vec())]);
        let original=json!({"schemaVersion":2,"stage":"components","comp":{"url":"/files/comp.png","width":200,"height":100},"components":[{"id":"nav","box":{"x":0,"y":0,"w":0.3,"h":0.4},"preview":{"kind":"page","url":"/files/kit.html","selector":"#nav"},"dependencies":[]}]});
        let error=NativeComponentCapturer.capture(&mut original.clone(),&inputs).err().unwrap();
        assert!(error.contains("review crop clips component content"),"{error}");
        let mut valid=original;valid["components"][0]["box"]["w"]=json!(0.75);
        NativeComponentCapturer.capture(&mut valid,&inputs).unwrap();
    }
    #[test]
    fn component_crops_copy_verified_pixels_without_resizing_or_synthetic_edges() {
        let image = impeccable_comp::raster::Image {width:3,height:2,data:(0u8..24).collect()};
        let png = impeccable_comp::png_io::encode_png(&image, &[]).unwrap();
        let crop = crop_viewport(&png,3,2,[1.,0.,2.,2.]).unwrap();
        let pixels = impeccable_comp::png_io::decode_png(&crop).unwrap().image;
        assert_eq!((pixels.width,pixels.height),(2,2));
        assert_eq!(pixels.data,[&image.data[4..12],&image.data[16..24]].concat());
        assert!(crop_viewport(&png,3,2,[0.,0.,0.2,1.]).is_err());
        assert!(crop_viewport(&png,3,2,[2.,0.,2.,1.]).is_err());
        assert!(crop_viewport(&png,4,2,[0.,0.,1.,1.]).is_err());
    }
}
