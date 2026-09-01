//! The snapshot DOM and its one-shot findings run. The snapshot itself is
//! open (`impeccable_foundation::browser::snapshot`); the run below drives the
//! closed driver through the shim, so the memo reset and the needs handshake
//! stay on this side of the boundary.

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
