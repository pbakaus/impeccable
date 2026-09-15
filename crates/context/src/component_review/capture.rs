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
