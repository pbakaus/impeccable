//! Offline transport client: records the same audit files as the shared native gate.
use impeccable::capture_service::RemoteEntryRenderer;
use impeccable_comp_verbs::entry_capture::{EntryRenderer,EntryRequest,EntryStage};
use std::{fs,path::PathBuf};
fn main()->Result<(),Box<dyn std::error::Error>>{
 let stage=std::env::args().nth(1).unwrap_or_else(||"hero".into());
 let renderer=RemoteEntryRenderer::from_env(&std::env::vars().collect())?.ok_or("service not configured")?;
 let capture=renderer.capture_entry(&EntryRequest{root:std::env::current_dir()?,artifact:"index.html".into(),spec:"spec.json".into(),reference:"comp.png".into(),stage:if stage=="responsive"{EntryStage::Responsive}else{EntryStage::Hero}})?;
 let base=PathBuf::from(format!(".impeccable/review/native/{stage}"));fs::create_dir_all(&base)?;
 fs::write(base.join("inputs.json"),serde_json::to_vec(&capture.evidence().report)?)?;
 for f in &capture.evidence().frames{
  fs::write(base.join(format!("{}.png",f.name)),&f.png)?;
  let observations:Vec<_>=f.regions.iter().map(|r|r.receipt.clone()).collect();
  fs::write(base.join(format!("{}-observations.json",f.name)),serde_json::to_vec(&observations)?)?;
 }
 capture.verify_current()?; println!("{}",serde_json::json!({"status":"captured","id":capture.evidence().report["captureService"]["id"]}));Ok(())
}
