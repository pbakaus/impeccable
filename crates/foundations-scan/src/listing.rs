//! The scan over a repository's tree listing and blobs, for hosts that
//! fetch files themselves and can't hand the scan a callback.

use crate::{walk, Kind, Source, State, Tracked, MAX_BYTES, MAX_FILE};
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};

/// How [`scan_listing`] reads the tree.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ListingOptions {
    /// The listing itself is incomplete (a truncated tree). Then, as after
    /// a capped walk, only items a found file proves stand: nothing fails
    /// for something missing, and no secrets pass is claimed.
    pub capped: bool,
    /// Run the secrets scan, which reads every tracked text file whole. Off,
    /// nothing is wanted for it and `secrets-out-of-repo` is left out.
    pub secrets: bool,
}

impl Default for ListingOptions {
    fn default() -> Self {
        ListingOptions {
            capped: false,
            secrets: true,
        }
    }
}

/// One pass of [`scan_listing`].
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct Outcome {
    /// Item id to state (`"checked"` or `"failing"`): the map the CLI's
    /// file checks upload. Final only once `wanted` is empty.
    pub items: BTreeMap<String, State>,
    /// Listed paths the pass tried to read that `contents` doesn't hold,
    /// sorted. Empty when the pass read everything it needed.
    pub wanted: Vec<String>,
}

/// The Foundations file checks over a repository's tree, without a
/// filesystem: the same checks, caps and ignore rules as the CLI's scan of a
/// checkout of that tree.
///
/// - `files`: every file in the tree (the tree listing is what git tracks),
///   relative, `/`-separated, with its size in bytes. The scan applies the
///   walk's own ignore rules and caps to it.
/// - `contents`: the files fetched so far, by path. `Some(text)` is the
///   whole file; `None` means fetched but binary or unreadable.
/// - `options`: see [`ListingOptions`].
///
/// The host loops: call with what it has (at first, nothing), fetch every
/// path in [`Outcome::wanted`], add them to `contents`, and call again
/// until `wanted` comes back empty. That pass's `items` is the answer.
/// Each pass is deterministic, and `wanted` only ever names listed paths
/// not yet in `contents`, so the loop ends. Files over 2 MB are never
/// wanted by the content checks (only the secrets scan reads them), and a
/// pass wants whole files for the secrets scan only up to the scan's
/// 256 MB budget, plus the one file that would end it. With
/// `options.secrets` off, no whole file is ever wanted.
pub fn scan_listing(
    files: &[(String, u64)],
    contents: &BTreeMap<String, Option<String>>,
    options: ListingOptions,
) -> Outcome {
    let listing = Listing::new(files, contents, options);
    let report = crate::scan(&listing);
    Outcome {
        items: report
            .items
            .into_iter()
            .map(|(id, s)| (id.to_string(), s))
            .collect(),
        wanted: listing.wanted.into_inner().into_iter().collect(),
    }
}

/// Where the listing's paths sit for the stylesheet test, which resolves
/// links as absolute paths.
const VIRTUAL_ROOT: &str = "/repo";

struct Listing<'a> {
    sizes: BTreeMap<&'a str, u64>,
    contents: &'a BTreeMap<String, Option<String>>,
    options: ListingOptions,
    wanted: RefCell<BTreeSet<String>>,
    /// Bytes of the whole reads wanted this pass, which the scan counts as
    /// none until they're fetched.
    pending: Cell<u64>,
    /// A wanted whole read past the secrets budget: the scan may stop
    /// there, so nothing after it is wanted this pass.
    over: Cell<bool>,
}

impl<'a> Listing<'a> {
    fn new(
        files: &'a [(String, u64)],
        contents: &'a BTreeMap<String, Option<String>>,
        options: ListingOptions,
    ) -> Self {
        Listing {
            sizes: files.iter().map(|(p, s)| (p.as_str(), *s)).collect(),
            contents,
            options,
            wanted: RefCell::default(),
            pending: Cell::default(),
            over: Cell::default(),
        }
    }

    /// A listed file's text, noting it as wanted when it isn't fetched yet.
    fn text(&self, path: &str) -> Option<&'a str> {
        match self.contents.get(path) {
            Some(text) => text.as_deref(),
            None => {
                self.wanted.borrow_mut().insert(path.to_string());
                None
            }
        }
    }

    /// The listing path behind a virtual absolute one.
    fn listed(&self, path: &str) -> Option<&str> {
        let path = path.strip_prefix(VIRTUAL_ROOT)?.strip_prefix(['/', '\\'])?;
        let path = path.replace('\\', "/");
        self.sizes.get_key_value(path.as_str()).map(|(k, _)| *k)
    }
}

impl Source for Listing<'_> {
    fn files(&self) -> (Vec<String>, bool) {
        // The folders of the tree, each with its entries in name order.
        let mut dirs: BTreeMap<&str, BTreeMap<&str, Kind>> = BTreeMap::new();
        for path in self.sizes.keys() {
            let mut dir = "";
            let mut at = 0;
            for (i, _) in path.match_indices('/') {
                let name = &path[at..i];
                dirs.entry(dir).or_default().insert(name, Kind::Dir);
                dir = &path[..i];
                at = i + 1;
            }
            dirs.entry(dir).or_default().insert(&path[at..], Kind::File);
        }
        let (files, truncated) = walk(|dir, budget| {
            dirs.get(dir).map(|entries| {
                entries
                    .iter()
                    .take(budget)
                    .map(|(n, k)| (n.to_string(), *k))
                    .collect()
            })
        });
        (files, truncated || self.options.capped)
    }

    fn read(&self, path: &str) -> Option<Vec<u8>> {
        if *self.sizes.get(path)? > MAX_FILE {
            return None;
        }
        let text = self.text(path)?.as_bytes();
        Some(text[..text.len().min(MAX_BYTES as usize)].to_vec())
    }

    fn read_whole(&self, path: &str, limit: u64) -> Option<Vec<u8>> {
        let size = *self.sizes.get(path)?;
        match self.contents.get(path) {
            Some(text) => {
                let text = text.as_deref()?.as_bytes();
                let limit = usize::try_from(limit).unwrap_or(usize::MAX);
                Some(text[..text.len().min(limit)].to_vec())
            }
            // Wanted only within the budget the scan has left (`limit` is
            // that plus one), so a pass never asks for more than the scan
            // would read, plus the one file that ends it.
            None if self.over.get() => None,
            None => {
                let pending = self.pending.get().saturating_add(size);
                self.pending.set(pending);
                self.over.set(pending >= limit);
                self.wanted.borrow_mut().insert(path.to_string());
                None
            }
        }
    }

    fn tracked(&self) -> Tracked {
        if !self.options.secrets {
            return Tracked::Unscanned;
        }
        Tracked::Files {
            files: self.sizes.keys().map(|p| p.to_string()).collect(),
            complete: !self.options.capped,
        }
    }

    fn unread_stylesheet(&self, page: &str, doc: &impeccable_html::dom::StaticDocument) -> bool {
        let dir = match page.rfind('/') {
            Some(i) => format!("{VIRTUAL_ROOT}/{}", &page[..i]),
            None => VIRTUAL_ROOT.to_string(),
        };
        let is_file = |p: &str| self.listed(p).is_some();
        // The tree's top is the repository's: resolution stops there.
        let exists = |p: &str| {
            is_file(p)
                || p.strip_prefix(VIRTUAL_ROOT)
                    .is_some_and(|r| matches!(r, "/.git" | "\\.git"))
        };
        impeccable_html::cascade::has_unread_stylesheet_in(doc, &dir, &is_file, &exists)
    }
}
