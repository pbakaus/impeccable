//! Offline diagnostic driver; not a production CLI verb or approval authority.
//! cargo run -p impeccable --example capture_asset -- request.json new-output-dir
use impeccable::asset_capture::CdpAssetRenderer;
use impeccable_comp_verbs::asset_capture::{AssetCaptureRequest, AssetRenderer};
use serde_json::Value;
use std::{fs, path::Path};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 3 {
        return Err("expected request.json and a new output directory".into());
    }
    let config: Value = serde_json::from_slice(&fs::read(&args[1])?)?;
    let text = |key: &str| config[key].as_str().ok_or_else(|| format!("missing {key}"));
    let request = AssetCaptureRequest {
        url: text("url")?.into(),
        viewport: serde_json::from_value(config["viewport"].clone())?,
        reduced_motion: config["reducedMotion"]
            .as_bool()
            .ok_or("missing reducedMotion")?,
        expected_box: serde_json::from_value(config["expectedBox"].clone())?,
        reference_bytes: fs::read(text("referencePath")?)?,
        asset_bytes: fs::read(text("assetPath")?)?,
    };
    let result = CdpAssetRenderer::from_process_env().capture(&request)?;
    let out = Path::new(&args[2]);
    fs::create_dir(out)?;
    for image in result.images {
        fs::write(out.join(image.name), image.png)?;
    }
    fs::write(
        out.join("receipt.json"),
        serde_json::to_vec_pretty(&result.receipt)?,
    )?;
    println!(
        "{}",
        serde_json::json!({"status":result.receipt["status"],"reason":result.receipt["reason"],"output":out})
    );
    Ok(())
}
