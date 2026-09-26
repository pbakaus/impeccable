//! Browser adapters return fresh in-process evidence; producer JSON is never capture authority.
use serde_json::Value;
use std::collections::BTreeMap;
pub struct CapturedPreviews {
    pub files: BTreeMap<String, Vec<u8>>,
    pub evidence: Value,
}
pub trait ComponentCapturer {
    /// Replace preview URLs in a frozen packet with native captures. Only pinned
    /// input bytes may be rendered; output files use reserved capture paths.
    fn capture(
        &mut self,
        packet: &mut Value,
        inputs: &BTreeMap<String, Vec<u8>>,
    ) -> Result<CapturedPreviews, String>;
}

pub const NATIVE_SCHEMA: &str = "native-component-previews-v1";
pub const PLAN_SCHEMA: &str = "plan-review-proof-v1";
/// The evidence schema a packet must carry: the plan review is proven without a browser.
pub fn schema_for(packet: &Value) -> &'static str {
    if packet["schemaVersion"] == 3 { PLAN_SCHEMA } else { NATIVE_SCHEMA }
}
pub fn verified(state: &Value) -> bool {
    state["capture"]["schema"] == schema_for(&state["packet"])
}

/// Proof for the plan and asset review: raster assets are their pinned source
/// bytes, plan items are a box on the pinned comp. No browser, no rendering.
pub struct PlanCapturer;
impl ComponentCapturer for PlanCapturer {
    fn capture(&mut self, packet: &mut Value, inputs: &BTreeMap<String, Vec<u8>>) -> Result<CapturedPreviews, String> {
        use super::manifest::digest;
        use serde_json::json;
        if packet["schemaVersion"] != 3 {
            return Err("the plan capturer only proves schemaVersion 3 packets".into());
        }
        let source = |view: &Value| -> Result<String, String> {
            view["url"].as_str().and_then(|u| u.strip_prefix("/files/")).map(String::from).ok_or_else(|| "preview is not pinned".into())
        };
        let comp_path = source(&packet["comp"])?;
        let comp = inputs.get(&comp_path).ok_or("missing approved reference")?;
        if impeccable_comp::png_io::is_png(comp) && comp.len() >= 24
            && (u64::from(u32::from_be_bytes(comp[16..20].try_into().unwrap())) != packet["comp"]["width"].as_u64().unwrap_or(0)
                || u64::from(u32::from_be_bytes(comp[20..24].try_into().unwrap())) != packet["comp"]["height"].as_u64().unwrap_or(0))
        {
            return Err("comp dimensions do not match its image".into());
        }
        let comp_hash = digest(comp);
        let mut evidence = Vec::new();
        for c in packet["components"].as_array_mut().ok_or("missing components")? {
            let proof = if c["preview"]["kind"] == "comp-crop" {
                json!({"kind":"comp-crop","compPath":comp_path,"compSha256":comp_hash,"box":c["box"]})
            } else {
                let path = source(&c["preview"])?;
                let bytes = inputs.get(&path).ok_or("missing raster source")?;
                c["thumbnail"] = json!({"url":c["preview"]["url"]});
                json!({"kind":"raster-source","path":path,"sha256":digest(bytes)})
            };
            evidence.push(json!({"id":c["id"],"views":{"preview":proof}}));
        }
        Ok(CapturedPreviews { files: BTreeMap::new(), evidence: json!({"schema":PLAN_SCHEMA,"components":evidence,
            "scope":"Pinned raster sources and comp-crop geometry. No browser capture; no visual, semantic or human-identity approval."}) })
    }
}
