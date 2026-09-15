//! Offline diagnostic using a frozen static entry. Not a production CLI verb.
//! cargo run -p impeccable --example capture_snapshot -- request.json new-output-dir
use impeccable::{
    asset_capture::CdpAssetRenderer,
    capture_snapshot::{HtmlSnapshot, SnapshotSelection},
};
use serde_json::Value;
use std::{fs, path::Path, sync::Arc};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.len() != 3 {
        return Err("expected request.json and a new output directory".into());
    }
    let config: Value = serde_json::from_slice(&fs::read(&args[1])?)?;
    let text = |key: &str| config[key].as_str().ok_or_else(|| format!("missing {key}"));
    let snapshot = Arc::new(HtmlSnapshot::freeze(SnapshotSelection {
        root: text("root")?.into(),
        entry: text("entry")?.into(),
        served: serde_json::from_value(config["served"].clone())?,
        bound: serde_json::from_value(config["bound"].clone())?,
    })?);
    let regions: Vec<String> = if config["regions"].is_array() {
        serde_json::from_value(config["regions"].clone())?
    } else {
        vec![text("region")?.into()]
    };
    let captures = snapshot.capture_regions_at_viewport(
        &mut CdpAssetRenderer::from_process_env(),
        text("spec")?,
        &regions.iter().map(String::as_str).collect::<Vec<_>>(),
        config["reducedMotion"]
            .as_bool()
            .ok_or("missing reducedMotion")?,
        serde_json::from_value(config["viewport"].clone()).ok(),
    )?;
    let out = Path::new(&args[2]);
    fs::create_dir(out)?;
    let mut summaries = Vec::new();
    for (index, capture) in captures.into_iter().enumerate() {
        let destination = if regions.len() == 1 {
            out.to_path_buf()
        } else {
            let p = out.join(format!("region-{index}"));
            fs::create_dir(&p)?;
            p
        };
        for image in capture.images {
            fs::write(destination.join(image.name), image.png)?;
        }
        fs::write(
            destination.join("receipt.json"),
            serde_json::to_vec_pretty(&capture.receipt)?,
        )?;
        summaries.push(serde_json::json!({"region":regions[index],"status":capture.receipt["status"],"reason":capture.receipt["reason"],"output":destination}));
    }
    println!(
        "{}",
        serde_json::json!({"snapshot":snapshot.digest(),"regions":summaries})
    );
    Ok(())
}
