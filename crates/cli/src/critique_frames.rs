//! Best-effort detached critique frames. No output, receipts, or retries.
use base64::Engine;
use impeccable_account::critiques::{frame_request, frame_session};
use impeccable_browser::{
    cdp::{Browser, EvalOutcome, Viewport},
    discovery,
};
use impeccable_common::Io;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};

const LIMIT: usize = 300 * 1024;

fn same_page(requested: &url::Url, final_url: &str) -> bool {
    url::Url::parse(final_url)
        .is_ok_and(|u| requested.origin() == u.origin() && requested.path() == u.path())
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let deadline = Instant::now() + Duration::from_secs(20);
    let Some(id) = args
        .first()
        .filter(|s| s.len() == 36 && s.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-'))
    else {
        return 0;
    };
    let Some(login) = args.get(1).and_then(|s| s.parse::<u64>().ok()) else {
        return 0;
    };
    let Some(url) = args
        .get(2)
        .and_then(|s| url::Url::parse(s).ok())
        .filter(|u| matches!(u.scheme(), "http" | "https") && u.host_str().is_some())
    else {
        return 0;
    };
    // The sign-in the critique uploaded under, or nothing is captured at all.
    if frame_session(io, login, deadline.saturating_duration_since(Instant::now())).is_none() {
        return 0;
    }
    let Ok(exe) = discovery::find_browser(&io.env) else {
        return 0;
    };
    let dangerous = io
        .env
        .get("PUPPETEER_DANGEROUS_NO_SANDBOX")
        .map(String::as_str)
        == Some("true");
    let Ok(mut browser) = Browser::launch_until(&exe, &[], dangerous, deadline) else {
        return 0;
    };
    let mut frames = Vec::new();
    for (viewport, width, height) in [("desktop", 1440, 900), ("phone", 390, 844)] {
        if Instant::now() >= deadline {
            break;
        }
        let Ok(mut page) = browser.new_page() else {
            break;
        };
        let capture = (|| {
            page.set_viewport(Viewport { width, height }).ok()?;
            page.goto(
                url.as_str(),
                "load",
                deadline.saturating_duration_since(Instant::now()),
            )
            .ok()?;
            // An error page is not the page: only a successful document is kept.
            let status = page.main_document_response()?["status"].as_f64()?;
            if !(200.0..300.0).contains(&status) {
                return None;
            }
            // Check after load and again after capture, so late redirects are dropped too.
            let location = |page: &mut impeccable_browser::cdp::Page<'_>| match page
                .evaluate("location.href")
                .ok()?
            {
                EvalOutcome::Value(v) => v.as_str().map(str::to_owned),
                _ => None,
            };
            if !same_page(&url, &location(&mut page)?) {
                return None;
            }
            let mut bytes = None;
            for quality in [80, 40] {
                let encoded = page.screenshot_viewport_webp(quality).ok()?;
                let decoded = base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .ok()?;
                if !decoded.is_empty() && decoded.len() <= LIMIT {
                    bytes = Some(decoded);
                    break;
                }
            }
            if !same_page(&url, &location(&mut page)?) {
                return None;
            }
            bytes
        })();
        page.close();
        if let Some(bytes) = capture {
            frames.push((viewport, width, height, bytes));
        }
    }
    // Drop kills the owned browser immediately; graceful close can wait five seconds.
    drop(browser);
    if frames.is_empty() || Instant::now() >= deadline {
        return 0;
    }
    let id = id.clone();
    let mut metadata = serde_json::Map::new();
    if let Some(label) = args.get(3) {
        metadata.insert("title".into(), label.clone().into());
    }
    impeccable_context::critique_storage::clean_report_metadata(&mut metadata);
    let label = metadata.get("title").cloned();
    // DNS in the shared HTTP stack is synchronous. Keep it off the worker's
    // main thread so even a stuck resolver cannot extend the job's lifetime.
    // Every request rechecks the sign-in and consent under the upload lock.
    let (cwd, env) = (io.cwd.clone(), io.env.clone());
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (io, _) = Io::captured("", cwd, env);
        let left = || {
            deadline
                .checked_duration_since(Instant::now())
                .filter(|d| !d.is_zero())
        };
        let mut captures = Vec::new();
        for (viewport, width, height, bytes) in frames {
            let Some(wait) = left() else { break };
            let hash = format!("{:x}", Sha256::digest(&bytes));
            let Some(reserved) = frame_request(&io, login, wait, |client, token| {
                client.post_json(
                    &format!("{}/cli/v1/critiques/captures", client.origin()),
                    token,
                    json!({"sha256": hash, "bytes": bytes.len(), "contentType": "image/webp"}),
                )
            }) else {
                return;
            };
            let reserved = match reserved {
                Ok(v) => v,
                Err(e) if e.status() == Some(429) => return,
                Err(_) => continue,
            };
            let Some(key) = reserved["key"].as_str() else {
                continue;
            };
            if let Some(upload) = reserved.get("uploadUrl") {
                let Some(upload) = upload.as_str() else {
                    continue;
                };
                let Some(wait) = left() else { break };
                match frame_request(&io, login, wait, |client, token| client.post_capture(upload, token, &bytes)) {
                    None => return,
                    Some(Ok(v)) if v["key"].as_str() == Some(key) => {}
                    Some(Err(e)) if e.status() == Some(429) => return,
                    Some(_) => continue,
                }
            }
            let mut frame =
                json!({"key": key, "viewport": viewport, "width": width, "height": height});
            if let Some(label) = &label {
                frame["label"] = label.clone();
            }
            captures.push(frame);
        }
        if !captures.is_empty() {
            if let Some(wait) = left() {
                let _ = frame_request(&io, login, wait, |client, token| {
                    client.post_json(
                        &format!("{}/cli/v1/critiques/{id}/captures", client.origin()),
                        token,
                        json!({"captures": captures}),
                    )
                });
            }
        }
        let _ = tx.send(());
    });
    let _ = rx.recv_timeout(deadline.saturating_duration_since(Instant::now()));
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn redirects_must_keep_origin_and_path() {
        let requested = url::Url::parse("https://example.com/pricing?old#one").unwrap();
        assert!(same_page(&requested, "https://example.com/pricing?new#two"));
        for other in [
            "https://example.com/login",
            "http://example.com/pricing",
            "https://other.com/pricing",
        ] {
            assert!(!same_page(&requested, other));
        }
    }
}
