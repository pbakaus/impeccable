//! The scan over a repository's tree listing and blobs, for hosts that
//! fetch files themselves and can't hand the scan a callback.

use crate::{walk, Kind, Source, State, Tracked, MAX_BYTES, MAX_FILE};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

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
/// - `capped`: the listing itself is incomplete (a truncated tree). Then,
///   as after a capped walk, only items a found file proves stand: nothing
///   fails for something missing, and no secrets pass is claimed.
///
/// The host loops: call with what it has (at first, nothing), fetch every
/// path in [`Outcome::wanted`], add them to `contents`, and call again
/// until `wanted` comes back empty. That pass's `items` is the answer.
/// Each pass is deterministic, and `wanted` only ever names listed paths
/// not yet in `contents`, so the loop ends. Files over 2 MB are never
/// wanted by the content checks (only the secrets scan reads them).
pub fn scan_listing(
    files: &[(String, u64)],
    contents: &BTreeMap<String, Option<String>>,
    capped: bool,
) -> Outcome {
    let listing = Listing::new(files, contents, capped);
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
    capped: bool,
    wanted: RefCell<BTreeSet<String>>,
}

impl<'a> Listing<'a> {
    fn new(
        files: &'a [(String, u64)],
        contents: &'a BTreeMap<String, Option<String>>,
        capped: bool,
    ) -> Self {
        Listing {
            sizes: files.iter().map(|(p, s)| (p.as_str(), *s)).collect(),
            contents,
            capped,
            wanted: RefCell::default(),
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
        let (files, truncated) = walk(|dir| {
            dirs.get(dir)
                .map(|entries| entries.iter().map(|(n, k)| (n.to_string(), *k)).collect())
        });
        (files, truncated || self.capped)
    }

    fn read(&self, path: &str) -> Option<Vec<u8>> {
        if *self.sizes.get(path)? > MAX_FILE {
            return None;
        }
        let text = self.text(path)?.as_bytes();
        Some(text[..text.len().min(MAX_BYTES as usize)].to_vec())
    }

    fn read_whole(&self, path: &str, limit: u64) -> Option<Vec<u8>> {
        self.sizes.get(path)?;
        let text = self.text(path)?.as_bytes();
        let limit = usize::try_from(limit).unwrap_or(usize::MAX);
        Some(text[..text.len().min(limit)].to_vec())
    }

    fn tracked(&self) -> Tracked {
        Tracked::Files {
            files: self.sizes.keys().map(|p| p.to_string()).collect(),
            complete: !self.capped,
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
