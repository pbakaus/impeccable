//! Opt-in, bounded CDP response evidence. This proves observed bytes, not paint.
use base64::Engine;
use serde_json::Value;
use std::collections::HashMap;

pub(crate) const MAX_BODY: usize = 16 * 1024 * 1024;
pub(crate) const MAX_TOTAL: usize = 64 * 1024 * 1024;
const MAX_RECORDS: usize = 512;

#[derive(Debug, Clone)]
pub struct ResponseRecord {
    pub request_id: String,
    pub url: String,
    pub frame_id: String,
    pub loader_id: String,
    pub status: Option<f64>,
    pub mime_type: String,
    pub from_disk_cache: bool,
    pub from_service_worker: bool,
    pub complete: bool,
    /// CDP-decoded response payload, not HTTP transfer/compression bytes.
    pub body: Option<Vec<u8>>,
    /// CDP returned the renderer's decoded text (UTF-8), not the served bytes.
    /// Compare with `body_matches`, never `body ==` a frozen file.
    pub text: bool,
    pub unavailable_reason: Option<String>,
    /// Multiple observed requests for this URL; DOM URL alone cannot bind one.
    pub ambiguous_url: bool,
}

#[derive(Debug)]
pub struct ResponseEvidence {
    pub responses: Vec<ResponseRecord>,
    pub missing_urls: Vec<String>,
    /// Evidence is incomplete when the bounded event journal overflowed.
    pub truncated: bool,
    /// Network changed while retrieving bodies; callers must capture again.
    pub changed_during_collection: bool,
    pub revision: u64,
}

#[derive(Default)]
pub(crate) struct ResponseCapture {
    records: Vec<ResponseRecord>,
    active: HashMap<String, usize>,
    pub revision: u64,
    truncated: bool,
    body_bytes: usize,
}

/// The text Blink decodes from bytes served as `charset=utf-8`: a BOM wins over
/// the label, and invalid UTF-8 becomes U+FFFD (WHATWG maximal subparts, as
/// `from_utf8_lossy`). Other labels are not modelled, so they fail closed.
pub fn decoded_text(raw: &[u8]) -> Vec<u8> {
    let utf16 = |b: &[u8], be: bool| {
        let units: Vec<u16> = b.chunks(2).map(|c| match c {
            [x, y] => if be { u16::from_be_bytes([*x, *y]) } else { u16::from_le_bytes([*x, *y]) },
            _ => 0xFFFD,
        }).collect();
        String::from_utf16_lossy(&units).into_bytes()
    };
    match raw {
        [0xEF, 0xBB, 0xBF, rest @ ..] => String::from_utf8_lossy(rest).into_owned().into_bytes(),
        [0xFE, 0xFF, rest @ ..] => utf16(rest, true),
        [0xFF, 0xFE, rest @ ..] => utf16(rest, false),
        _ => String::from_utf8_lossy(raw).into_owned().into_bytes(),
    }
}

impl ResponseRecord {
    /// Whether the observed response is exactly `raw`: byte-for-byte when CDP
    /// returned bytes, or as the renderer's decoded text when it returned text
    /// (the only form of a text body the page consumes).
    pub fn body_matches(&self, raw: &[u8]) -> bool {
        self.body.as_deref().is_some_and(|b| if self.text { b == decoded_text(raw) } else { b == raw })
    }
}

fn string(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_owned()
}

impl ResponseCapture {
    pub fn event(&mut self, method: &str, p: &Value) {
        if !matches!(
            method,
            "Network.requestWillBeSent"
                | "Network.responseReceived"
                | "Network.loadingFinished"
                | "Network.loadingFailed"
        ) {
            return;
        }
        self.revision += 1;
        let id = string(p, "requestId");
        if id.is_empty() {
            self.truncated = true;
            return;
        }
        if method == "Network.requestWillBeSent" {
            // Redirect hops reuse a request id. Never retrieve the final body's
            // bytes on behalf of an earlier hop, even when the URL repeats.
            if let Some(old) = self.active.remove(&id) {
                self.records[old].unavailable_reason =
                    Some("request id reused or redirected".into());
            }
            if self.records.len() >= MAX_RECORDS {
                self.truncated = true;
                return;
            }
            let index = self.records.len();
            self.records.push(ResponseRecord {
                request_id: id.clone(),
                url: string(&p["request"], "url"),
                frame_id: string(p, "frameId"),
                loader_id: string(p, "loaderId"),
                status: None,
                mime_type: String::new(),
                from_disk_cache: false,
                from_service_worker: false,
                complete: false,
                body: None,
                text: false,
                unavailable_reason: None,
                ambiguous_url: false,
            });
            self.active.insert(id, index);
            return;
        }
        let Some(&i) = self.active.get(&id) else {
            return;
        };
        let r = &mut self.records[i];
        match method {
            "Network.responseReceived" => {
                let response = &p["response"];
                r.status = response["status"].as_f64();
                r.mime_type = string(response, "mimeType");
                r.from_disk_cache = response["fromDiskCache"].as_bool().unwrap_or(false);
                r.from_service_worker = response["fromServiceWorker"].as_bool().unwrap_or(false);
                if string(response, "url") != r.url {
                    r.unavailable_reason = Some("response URL differs from request".into());
                }
            }
            "Network.loadingFinished" => r.complete = true,
            "Network.loadingFailed" => {
                r.unavailable_reason = Some(format!("request failed: {}", string(p, "errorText")))
            }
            _ => {}
        }
    }

    fn matches(r: &ResponseRecord, urls: &[String], frame: &str, loader: &str) -> bool {
        !frame.is_empty()
            && !loader.is_empty()
            && r.frame_id == frame
            && r.loader_id == loader
            && urls.contains(&r.url)
    }

    pub fn urls(&self, frame: &str, loader: &str) -> Vec<String> {
        let mut urls: Vec<_> = self.records.iter().filter(|r|r.frame_id==frame && r.loader_id==loader).map(|r|r.url.clone()).collect();
        urls.sort(); urls.dedup(); urls
    }

    pub fn pending(&self, urls: &[String], frame: &str, loader: &str) -> Vec<(usize, String)> {
        self.records
            .iter()
            .enumerate()
            .filter(|(_, r)| {
                Self::matches(r, urls, frame, loader)
                    && r.complete
                    && r.status.is_some()
                    && r.body.is_none()
                    && r.unavailable_reason.is_none()
            })
            .map(|(i, r)| (i, r.request_id.clone()))
            .collect()
    }

    pub fn store_body(&mut self, index: usize, result: Result<Value, String>) {
        let r = &mut self.records[index];
        if r.unavailable_reason.is_some() {
            return;
        }
        let decoded = result.and_then(|v| {
            let body = v["body"].as_str().ok_or("CDP returned no body")?;
            let encoded = v["base64Encoded"]
                .as_bool()
                .ok_or("CDP returned no body encoding")?;
            let remaining = MAX_BODY.min(MAX_TOTAL.saturating_sub(self.body_bytes));
            if body.len()
                > if encoded {
                    remaining.div_ceil(3) * 4
                } else {
                    remaining
                }
            {
                return Err("response body exceeds capture budget".into());
            }
            let bytes = if encoded {
                base64::engine::general_purpose::STANDARD
                    .decode(body)
                    .map_err(|_| "invalid CDP body encoding".to_string())?
            } else {
                body.as_bytes().to_vec()
            };
            if bytes.len() > remaining {
                return Err("response body exceeds capture budget".into());
            }
            Ok((bytes, !encoded))
        });
        match decoded {
            Ok((bytes, text)) => {
                self.body_bytes += bytes.len();
                r.body = Some(bytes);
                r.text = text;
            }
            Err(reason) => r.unavailable_reason = Some(reason),
        }
    }

    pub fn evidence(
        &self,
        urls: &[String],
        frame: &str,
        loader: &str,
        before: u64,
    ) -> ResponseEvidence {
        let mut responses: Vec<_> = self
            .records
            .iter()
            .filter(|r| Self::matches(r, urls, frame, loader))
            .cloned()
            .collect();
        let mut counts = HashMap::new();
        for r in &responses {
            *counts.entry(r.url.clone()).or_insert(0) += 1;
        }
        for r in &mut responses {
            r.ambiguous_url = counts[&r.url] > 1;
            if r.body.is_none() && r.unavailable_reason.is_none() {
                r.unavailable_reason = Some(
                    if !r.complete {
                        "response not complete"
                    } else {
                        "response metadata or body unavailable"
                    }
                    .into(),
                );
            }
            // An unavailable record must never also expose verified bytes.
            if r.unavailable_reason.is_some() {
                r.body = None;
            }
        }
        let missing_urls = urls
            .iter()
            .filter(|u| !counts.contains_key(*u))
            .cloned()
            .collect();
        ResponseEvidence {
            responses,
            missing_urls,
            truncated: self.truncated,
            changed_during_collection: before != self.revision,
            revision: self.revision,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn request(t: &mut ResponseCapture, id: &str, url: &str) {
        t.event(
            "Network.requestWillBeSent",
            &json!({"requestId":id,"request":{"url":url},"frameId":"main","loaderId":"current"}),
        );
    }
    #[test]
    fn redirects_cannot_borrow_final_body_and_repeated_urls_remain_ambiguous() {
        let mut t = ResponseCapture::default();
        request(&mut t, "1", "asset");
        request(&mut t, "1", "asset");
        t.event("Network.responseReceived",&json!({"requestId":"1","response":{"url":"asset","status":200,"mimeType":"image/png"}}));
        t.event("Network.loadingFinished", &json!({"requestId":"1"}));
        assert_eq!(
            t.pending(&["asset".into()], "main", "current"),
            vec![(1, "1".into())]
        );
        t.store_body(1, Ok(json!({"body":"AP8=","base64Encoded":true})));
        let e = t.evidence(&["asset".into()], "main", "current", t.revision);
        assert!(e.responses.iter().all(|r| r.ambiguous_url));
        assert!(e.responses[0].body.is_none());
        assert_eq!(e.responses[1].body, Some(vec![0, 255]));
    }
    #[test]
    fn incomplete_failed_and_wrong_document_are_explicit() {
        let mut t = ResponseCapture::default();
        request(&mut t, "1", "inflight");
        request(&mut t, "2", "failed");
        t.event(
            "Network.loadingFailed",
            &json!({"requestId":"2","errorText":"blocked"}),
        );
        let urls = vec!["inflight".into(), "failed".into(), "absent".into()];
        let e = t.evidence(&urls, "main", "current", 0);
        assert!(e.changed_during_collection);
        assert!(
            e.responses
                .iter()
                .all(|r| r.body.is_none() && r.unavailable_reason.is_some())
        );
        assert_eq!(e.missing_urls, vec!["absent"]);
        assert!(
            t.evidence(&urls, "iframe", "current", 0)
                .responses
                .is_empty()
        );
        assert!(t.evidence(&urls, "main", "old", 0).responses.is_empty());
        assert!(t.evidence(&urls, "main", "", 0).responses.is_empty());
    }
    #[test]
    fn decoded_text_follows_bom_then_lossy_utf8() {
        assert_eq!(decoded_text(b"\xEF\xBB\xBFa\xE9b"), "a\u{FFFD}b".as_bytes());
        assert_eq!(decoded_text(b"\xFF\xFEa\x00"), b"a");
        assert_eq!(decoded_text(b"\xFE\xFF\x00a\x00"), "a\u{FFFD}".as_bytes());
        assert_eq!(decoded_text(b"\xF0\x9F\x98x"), "\u{FFFD}x".as_bytes());
        let mut t = ResponseCapture::default();
        request(&mut t, "1", "a.css");
        t.store_body(0, Ok(json!({"body":"\u{FFFD}","base64Encoded":false})));
        let r = &t.records[0];
        assert!(r.text && r.body_matches(b"\xE9") && r.body_matches(b"\xEF\xBB\xBF\xE9"));
        assert!(!r.body_matches(b"\xC3\xA9") && !r.body_matches(b""));
        request(&mut t, "2", "b.bin");
        t.store_body(1, Ok(json!({"body":"/Q==","base64Encoded":true})));
        assert!(t.records[1].body_matches(b"\xFD") && !t.records[1].body_matches(b"\xEF\xBF\xBD"));
    }
    #[test]
    fn limits_and_invalid_encoding_never_become_empty_verified_bodies() {
        let mut t = ResponseCapture::default();
        request(&mut t, "1", "asset");
        t.store_body(0, Ok(json!({"body":"!","base64Encoded":true})));
        assert!(t.records[0].unavailable_reason.is_some());
        request(&mut t, "2", "large");
        t.body_bytes = MAX_TOTAL;
        t.store_body(1, Ok(json!({"body":"YQ==","base64Encoded":true})));
        assert!(t.records[1].unavailable_reason.is_some());
        for i in 2..=MAX_RECORDS {
            request(&mut t, &i.to_string(), "more");
        }
        assert!(t.truncated);
        assert_eq!(t.records.len(), MAX_RECORDS);
    }
}
