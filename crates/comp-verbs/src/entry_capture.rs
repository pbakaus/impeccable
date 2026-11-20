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
/// Why a native capture produced no evidence.
#[derive(Debug)]
pub enum CaptureError {
    /// The capture could not run here: no browser could be found or started, or the
    /// project tree cannot be frozen (over the snapshot limits, or a symlink). A default
    /// capture falls back to saved screenshots; a requested one fails.
    Unavailable(String),
    /// The capture ran and refused the page. The gate fails.
    Refused(String),
}
impl From<String> for CaptureError {
    fn from(e: String) -> Self { Self::Refused(e) }
}
impl From<&str> for CaptureError {
    fn from(e: &str) -> Self { Self::Refused(e.into()) }
}
impl From<CaptureError> for String {
    fn from(e: CaptureError) -> Self { e.to_string() }
}
impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self { Self::Unavailable(e) | Self::Refused(e) => f.write_str(e) }
    }
}
impl std::error::Error for CaptureError {}
pub trait EntryRenderer {
    fn capture_entry(&self, request: &EntryRequest) -> Result<Box<dyn CapturedEntry>, CaptureError>;
}
