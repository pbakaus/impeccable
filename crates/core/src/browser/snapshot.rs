//! The snapshot DOM and its one-shot findings run. Everything except the
//! run itself lives in `impeccable_foundation::browser::snapshot`; this
//! module re-exports it under the path callers already use and adds
//! [`collect_findings_from_snapshot`], which drives the browser driver.

pub use impeccable_foundation::browser::snapshot::*;

/// A one-shot findings run over a snapshot: parse, collect, serialize.
/// `Err(needs)` when the run asked for hit tests the snapshot lacked; supply
/// them (`hits` in the snapshot or [`SnapshotDom::add_facts`]) and run again.
pub fn collect_findings_from_snapshot(
    dom: &SnapshotDom,
    config: &super::BrowserConfig,
) -> Result<super::driver::CollectResult, Needs> {
    dom.reset_memo();
    let out = super::driver::collect_browser_findings(dom, config);
    if dom.has_needs() {
        return Err(dom.take_needs());
    }
    Ok(out)
}
