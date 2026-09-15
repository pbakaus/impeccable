//! Diagnostic capture contract. Browser implementation is injected by the CLI.
//! A captured contribution is evidence, never an approval or fidelity score.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct CaptureBox {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub struct AssetCaptureRequest {
    pub url: String,
    pub viewport: [u32; 2],
    pub reduced_motion: bool,
    pub reference_bytes: Vec<u8>,
    pub asset_bytes: Vec<u8>,
    /// Reference-owned region in viewport CSS pixels, with DPR fixed at one.
    pub expected_box: CaptureBox,
}

pub struct CaptureImage {
    pub name: String,
    pub png: Vec<u8>,
}
pub struct AssetCapture {
    pub receipt: Value,
    pub images: Vec<CaptureImage>,
}

pub trait AssetRenderer {
    /// Errors and unavailable receipts cannot satisfy a build obligation.
    fn capture(&mut self, request: &AssetCaptureRequest) -> Result<AssetCapture, String>;
    /// One document/session for all regions. Adapters must opt in explicitly;
    /// looping single captures would destroy shared-document evidence.
    fn capture_batch(
        &mut self,
        _requests: &[AssetCaptureRequest],
    ) -> Result<Vec<AssetCapture>, String> {
        Err("renderer does not support shared-document batch capture".into())
    }
}

pub fn capture_sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

impl AssetCaptureRequest {
    pub fn validate(&self) -> Result<(), String> {
        let b = self.expected_box;
        if self.viewport.contains(&0) || self.viewport.iter().any(|v| *v > 4096) {
            return Err("capture viewport must be between 1 and 4096 pixels per axis".into());
        }
        if ![b.x, b.y, b.w, b.h].iter().all(|n| n.is_finite())
            || b.x < 0.
            || b.y < 0.
            || b.w <= 0.
            || b.h <= 0.
            || b.x + b.w > self.viewport[0] as f64
            || b.y + b.h > self.viewport[1] as f64
        {
            return Err("reference region must be finite, positive and inside the viewport".into());
        }
        if self.asset_bytes.is_empty()
            || self.asset_bytes.len() > 16 * 1024 * 1024
            || self.reference_bytes.is_empty()
            || self.reference_bytes.len() > 64 * 1024 * 1024
        {
            return Err("reference or asset bytes missing or above capture budget".into());
        }
        Ok(())
    }
}
