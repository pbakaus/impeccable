//! Page receipts shared by CLI uploads.
use crate::config::Account;
use impeccable_common::Io;

pub fn page(account: &Account, page: &str, label: Option<&str>) -> Option<String> {
    let mut url = url::Url::parse(&format!("{}/-/{page}", account.home_url()?)).ok()?;
    if let Some(label) = label {
        url.query_pairs_mut().append_pair("repo", label);
    }
    Some(url.into())
}

thread_local! {
    static JSON_RECEIPTS: std::cell::RefCell<Option<Vec<String>>> = const { std::cell::RefCell::new(None) };
}

/// Collect page receipts while a machine-output command runs. Other notices
/// still obey the caller's quiet flag; no receipt text enters its streams.
pub fn capture<T>(run: impl FnOnce() -> T) -> (T, Vec<String>) {
    JSON_RECEIPTS.with(|receipts| *receipts.borrow_mut() = Some(Vec::new()));
    let result = run();
    let urls = JSON_RECEIPTS.with(|receipts| receipts.borrow_mut().take().unwrap_or_default());
    (result, urls)
}

pub fn saved(io: &mut Io, url: Option<String>, quiet: bool) {
    if let Some(url) = url {
        let captured = JSON_RECEIPTS.with(|receipts| {
            if let Some(urls) = receipts.borrow_mut().as_mut() {
                urls.push(url.clone());
                true
            } else { false }
        });
        if !captured && !quiet {
            io.err(&format!("Saved to Impeccable: {url}\n"));
        }
    }
}

pub fn failed(io: &mut Io, what: &str, quiet: bool) {
    if !quiet {
        io.err(&format!("Not saved to Impeccable: {what}. Run it again to save it.\n"));
    }
}

/// One plain line for an upload that didn't land: what, why in the person's words, and the one step.
pub fn failed_upload(io: &mut Io, what: &str, error: &crate::http::ApiError, quiet: bool) {
    if quiet { return; }
    use crate::http::ApiError::{Network, Status};
    let (why, step) = match error {
        Network(_) => ("Impeccable couldn't be reached", "Run it again to save it."),
        Status { status: 401, .. } => ("your sign-in has expired", "Run npx impeccable login."),
        Status { status: 429, .. } => ("too many uploads just now", "Run it again later to save it."),
        Status { .. } => ("Impeccable had a problem", "Run it again to save it."),
    };
    io.err(&format!("{what} not saved to Impeccable: {why}. {step}\n"));
}
