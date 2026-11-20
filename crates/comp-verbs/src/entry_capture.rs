//! Native capture boundary for build-phase. Receipts are audit output, never inputs.
use crate::asset_capture::AssetCapture;
use serde_json::Value;
use std::path::PathBuf;

#[derive(Clone, Copy)]
pub enum EntryStage {
    Hero,
    Responsive,
}
pub struct EntryRequest {
    pub root: PathBuf,
    pub artifact: String,
    pub spec: String,
    pub reference: String,
    pub stage: EntryStage,
}
pub struct FrameEvidence {
    pub name: String,
    pub png: Vec<u8>,
    pub regions: Vec<AssetCapture>,
}
pub struct EntryEvidence {
    pub report: Value,
    pub frames: Vec<FrameEvidence>,
}
pub struct ApprovedReference { pub png: Vec<u8>, pub proof: Value }
pub trait CapturedEntry {
    fn approved_reference(&self) -> Option<&ApprovedReference> { None }
    fn evidence(&self) -> &EntryEvidence;
    /// Recheck original bytes while this in-process capture still owns its snapshot.
    fn verify_current(&self) -> Result<(), String>;
}
pub trait EntryRenderer {
    fn capture_entry(&self, request: &EntryRequest) -> Result<Box<dyn CapturedEntry>, String>;
}
