use impeccable::asset_capture::CdpAssetRenderer;
use impeccable_comp::{png_io, raster};
use impeccable_comp_verbs::asset_capture::{AssetCaptureRequest, AssetRenderer, CaptureBox};
use std::{
    io::{Read, Write},
    net::TcpListener,
    time::Duration,
};

#[test]
fn native_capture_distinguishes_paint_from_file_presence() {
    let env = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no browser installed");
        return;
    }
    let image = png_io::encode_png(&raster::create_image(32, 32, [231, 60, 30, 255]), &[]).unwrap();
    let wrong = png_io::encode_png(&raster::create_image(32, 32, [20, 50, 200, 255]), &[]).unwrap();
    let transparent = png_io::encode_png(&raster::create_image(32, 32, [0, 0, 0, 0]), &[]).unwrap();
    let transparent_response = transparent.clone();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let asset = image.clone();
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut bytes = [0u8; 4096];
            let n = stream.read(&mut bytes).unwrap_or(0);
            let line = String::from_utf8_lossy(&bytes[..n]);
            let path = line.split_whitespace().nth(1).unwrap_or("/");
            let (mime, body) = if path == "/transparent.png" {
                ("image/png", transparent_response.clone())
            } else if path == "/art.png" || path == "/lazy.png" {
                ("image/png", asset.clone())
            } else if path == "/collision/art.png" {
                ("image/png", wrong.clone())
            } else {
                let mode = path.trim_start_matches('/');
                let parent = match mode {
                    "hidden" => "visibility:hidden",
                    "opacity" | "pseudo-hidden" => "opacity:0",
                    "clip" => "clip-path:inset(100%)",
                    _ => "",
                };
                let position = match mode {
                    "shift" => "left:70px",
                    "footer" => "top:500px",
                    _ => "",
                };
                let img = if mode == "pseudo-url-only" {
                    "<div id=art style='position:relative;width:80px;height:80px'></div><style>#art::before{content:'';position:absolute;inset:0;background:url(/art.png) center/cover}</style>"
                } else if mode.starts_with("pseudo-") && mode != "pseudo-neighbor" {
                    "<div id=art style='position:relative;width:80px;height:80px'></div><style>#art::before{content:'';position:absolute;inset:0;background-image:linear-gradient(transparent,transparent),url(/art.png);background-size:cover}</style>"
                } else if mode == "layered-duplicate" {
                    "<div id=art style='width:80px;height:80px;background-image:url(/art.png),url(/art.png);background-size:cover'></div>"
                } else if mode == "decoration" {
                    "<img id='art' width='80' height='80' src='/transparent.png' style='background:red;box-shadow:0 0 4px blue'>"
                } else if mode == "background" {
                    "<div id='art' style='width:80px;height:80px;background:url(/art.png) center/cover'></div>"
                } else if mode == "wrong" || mode == "footer-trap" {
                    "<img id='art' width='80' height='80' src='/collision/art.png'>"
                } else {
                    "<img id='art' width='80' height='80' src='/art.png'>"
                };
                let cover = if mode == "duplicate" {
                    "<img src=/art.png style='position:absolute;inset:0;width:80px;height:80px'>"
                } else if mode == "covered" || mode == "pseudo-covered" {
                    "<div style='position:absolute;inset:0;background:white'></div>"
                } else {
                    ""
                };
                let extra = match mode {
                    "many-text-pseudos" => "<div id=text-only style='position:absolute;top:500px'></div><style>.marker::before,.marker::after{content:'x'}</style><script>for(let i=0;i<300;i++){const el=document.createElement('span');el.className='marker';document.querySelector('#text-only').append(el)}</script>",
                    "pseudo-specificity" => "<style>#art#art#art::before{background-image:url(/art.png)!important}</style>",
                    "pseudo-mutating" => "<script>setInterval(()=>{if(getComputedStyle(document.querySelector('#art'),'::before').backgroundImage.includes('none'))document.body.dataset.touched='yes'},0)</script>",
                    "pseudo-neighbor" => {
                        "<style>#art::before{content:''}</style><div style='position:absolute;left:20px;top:20px;width:80px;height:20px' class='ribbon'></div><style>.ribbon::before{content:'';position:absolute;inset:0;background-image:linear-gradient(white,white)}</style>"
                    }
                    "canvas-cover" => {
                        "<canvas id='cover' width='80' height='80' style='position:absolute;left:20px;top:20px;width:80px;height:80px'></canvas><script>const c=document.querySelector('#cover').getContext('2d');c.fillStyle='blue';c.fillRect(0,0,80,80)</script>"
                    }
                    "canvas-only" => {
                        "<canvas id='cover' width='80' height='80' style='position:absolute;left:20px;top:20px;width:80px;height:80px'></canvas><script>document.querySelector('#art').remove();const i=new Image();i.onload=()=>document.querySelector('#cover').getContext('2d').drawImage(i,0,0,80,80);i.src='/art.png'</script>"
                    }
                    "tiny-token" => "<style>#art{width:1px!important;height:1px!important}</style>",
                    "many" => {
                        "<script>for(let i=0;i<17;i++){const el=document.querySelector('#art').cloneNode(true);el.style.cssText='position:absolute;left:20px;top:20px';document.body.append(el);}</script>"
                    }
                    "closed-shadow" => {
                        "<div id=shadow style='position:absolute;left:20px;top:20px;width:80px;height:80px'></div><script>document.querySelector('#shadow').attachShadow({mode:'closed'}).innerHTML='<span>hidden tree</span>';</script>"
                    }
                    "poison" => {
                        "<script>const real=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){const r=real.call(this);return this.id==='art'?new DOMRect(r.x+100,r.y,r.width,r.height):r;};</script>"
                    }
                    "state-probe" => {
                        "<style>body[data-inspector] #art{display:none}</style><script>setInterval(()=>{if(Object.getOwnPropertyNames(window).some(k=>k.startsWith('__impeccable_capture_')))document.body.dataset.inspector='found';},0);</script>"
                    }
                    "lazy" => {
                        "<img loading=lazy src=/lazy.png style='position:absolute;top:10000px;width:80px;height:80px'>"
                    }
                    "canvas" => {
                        "<canvas style='position:absolute;left:20px;top:20px;width:80px;height:80px'></canvas>"
                    }
                    "footer-trap" => {
                        "<img src='/art.png' style='position:absolute;top:500px;left:20px;width:80px;height:80px'>"
                    }
                    "mutating" => {
                        "<script>new MutationObserver(()=>document.body.dataset.touched='yes').observe(document.querySelector('#art'),{attributes:true});</script>"
                    }
                    "ambiguous" => {
                        "<script>fetch('/art.png',{cache:'no-store'}).then(r=>r.arrayBuffer()).then(()=>document.body.dataset.fetched='yes');</script>"
                    }
                    "rotated-overlap" => "<style>#art{transform:rotate(-2.3deg);box-shadow:0 1px 4px #0005;border-radius:3.7px}#wrap::before{content:'';position:absolute;inset:-10.3px;background:url(/art.png) center/cover;opacity:.3}</style>",
                    "transition" => "<style>#art{transition:object-position 100ms linear}</style>",
                    "animated" => {
                        "<style>@keyframes slide{to{transform:translateX(20px)}}#wrap{animation:slide 2s infinite alternate}</style>"
                    }
                    _ => "",
                };
                let html = format!(
                    "<!doctype html><style>body{{margin:0;background:white}}#wrap{{position:absolute;left:20px;top:20px;width:80px;height:80px}}</style><div id='wrap' style='{parent};{position}'>{img}{cover}</div>{extra}"
                );
                ("text/html", html.into_bytes())
            };
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(&body);
        }
    });
    let mut renderer = CdpAssetRenderer::from_process_env();
    for mode in [
        "many",
        "many-text-pseudos",
        "closed-shadow",
        "poison",
        "state-probe",
        "duplicate",
        "decoration",
        "lazy",
        "baseline",
        "transition",
        "rotated-overlap",
        "hidden",
        "opacity",
        "clip",
        "covered",
        "shift",
        "footer",
        "wrong",
        "background",
        "footer-trap",
        "canvas",
        "pseudo-neighbor",
        "pseudo-background",
        "pseudo-url-only",
        "pseudo-hidden",
        "pseudo-covered",
        "pseudo-specificity",
        "pseudo-mutating",
        "layered-duplicate",
        "canvas-cover",
        "canvas-only",
        "tiny-token",
        "mutating",
        "ambiguous",
        "animated",
    ] {
        let captured = renderer
            .capture(&AssetCaptureRequest {
                url: format!("{origin}/{mode}"),
                viewport: [240, 180],
                reduced_motion: true,
                reference_bytes: image.clone(),
                asset_bytes: if mode == "decoration" {
                    transparent.clone()
                } else {
                    image.clone()
                },
                expected_box: CaptureBox {
                    x: 20.,
                    y: 20.,
                    w: 80.,
                    h: 80.,
                },
            })
            .unwrap();
        if let Ok(root) = std::env::var("IMPECCABLE_CAPTURE_TEST_OUTPUT") {
            let out = std::path::Path::new(&root).join(mode);
            std::fs::create_dir_all(&out).unwrap();
            std::fs::write(
                out.join("receipt.json"),
                serde_json::to_vec_pretty(&captured.receipt).unwrap(),
            )
            .unwrap();
            for image in &captured.images {
                std::fs::write(out.join(&image.name), &image.png).unwrap();
            }
        }
        let r = &captured.receipt;
        assert!(r["browser"]["product"].as_str().unwrap().contains("Chrome"));
        if ["canvas", "pseudo-neighbor", "canvas-cover", "canvas-only"].contains(&mode) {
            assert_eq!(r["status"], "unavailable", "{mode}: {r}");
            assert_eq!(r["stableCapture"], true, "{mode}: {r}");
            assert_eq!(r["surfaceCoverage"]["status"], "partial", "{mode}: {r}");
            assert_eq!(r["adequateVisibility"], "not-assessed", "{mode}: {r}");
            let paint = &r["combinedContribution"]["changedPixelsInRegion"];
            match mode {
                "canvas" => assert_eq!(paint, 6400),
                "canvas-cover" => assert_eq!(paint, 0),
                "pseudo-neighbor" => {
                    assert!(paint.as_u64().unwrap() > 0 && paint.as_u64().unwrap() < 6400)
                }
                "canvas-only" => assert_eq!(
                    r["combinedContribution"]["status"],
                    "no-matching-supported-instance"
                ),
                _ => unreachable!(),
            }
            continue;
        }
        if mode == "tiny-token" {
            assert_eq!(r["combinedContribution"]["changedPixelsInRegion"], 1);
            assert_eq!(r["adequateVisibility"], "not-assessed");
            assert_eq!(r["instances"][0]["boxDelta"]["w"], -79.);
            continue;
        }
        if [
            "many",
            "closed-shadow",
            "canvas",
            "mutating",
            "pseudo-specificity",
            "pseudo-mutating",
            "ambiguous",
            "animated",
        ]
        .contains(&mode)
        {
            assert_eq!(r["status"], "unavailable", "{mode}: {r}");
            continue;
        }
        assert_eq!(r["status"], "captured", "{mode}: {r}");
        let instances = r["instances"].as_array().unwrap();
        if mode == "rotated-overlap" {
            assert_eq!(instances.len(), 2);
            assert!(instances.iter().all(|i| i["restorationVerified"] == true));
            assert!(r["combinedContribution"]["changedPixelsInRegion"].as_u64().unwrap() > 0);
            continue;
        }
        if mode == "wrong" {
            assert!(instances.is_empty());
            continue;
        }
        if mode == "duplicate" || mode == "layered-duplicate" {
            assert_eq!(instances.len(), 2);
            assert!(instances.iter().all(|i| i["changedPixelsInRegion"] == 0));
            assert_eq!(r["combinedContribution"]["changedPixelsInRegion"], 6400);
            continue;
        }
        assert_eq!(instances.len(), 1, "{mode}: {r}");
        let i = &instances[0];
        if mode == "footer" || mode == "footer-trap" {
            assert_eq!(i["status"], "outside-required-region");
            continue;
        }
        assert_eq!(i["status"], "measured", "{mode}: {r}");
        let pixels = i["changedPixelsInRegion"].as_u64().unwrap();
        if ["decoration", "hidden", "opacity", "clip", "covered", "pseudo-hidden", "pseudo-covered"].contains(&mode) {
            assert_eq!(pixels, 0, "{mode}");
        } else {
            assert!(pixels > 0, "{mode}");
        }
        if mode == "shift" {
            assert_eq!(i["boxDelta"]["x"], 50.);
            assert!(pixels < 6400);
        }
        if mode == "poison" {
            assert_eq!(i["boxDelta"]["x"], 0.);
        }
        if mode == "baseline" {
            assert_eq!(pixels, 6400);
        }
    }
}
