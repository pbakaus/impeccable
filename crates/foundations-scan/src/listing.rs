//! The scan over a repository's tree listing and blobs, for hosts that
//! fetch files themselves and can't hand the scan a callback.

use crate::{
    walk, FactRead, FileFacts, Kind, SecretFacts, SecretRead, Source, State, Tracked, MAX_BYTES,
    MAX_FILE, MAX_WHOLE_BYTES, MAX_WHOLE_FILES,
};
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};

/// Options shared by [`scan_listing`] and [`ListingScan`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ListingOptions {
    /// The listing itself is incomplete (a truncated tree). Then, as after
    /// a capped walk, only items a found file proves stand: nothing fails
    /// for something missing, and no secrets pass is claimed.
    pub capped: bool,
    /// Run the secrets scan. `ListingScan` summarizes each supplied file and
    /// keeps only redacted locations; off, `secrets-out-of-repo` is left out.
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
    let mut scan = ListingScan::new(files, options);
    for (path, text) in contents {
        scan.add(path, text.as_deref());
    }
    scan.pass()
}

/// An incremental scan for hosts that fetch file blobs themselves. `add`
/// summarizes each supplied file immediately and drops its input text. The
/// README command check currently needs the root README whole; at most 128
/// structural files and 4 MiB total can be retained. Every other file becomes
/// bounded per-file facts instead of whole text.
pub struct ListingScan {
    files: Vec<(String, u64)>,
    file_sizes: BTreeMap<String, u64>,
    options: ListingOptions,
    facts: BTreeMap<String, Option<FileFacts>>,
    secret_facts: BTreeMap<String, Option<SecretFacts>>,
    whole_files: usize,
    whole_bytes: usize,
    held_fact_bytes: usize,
    max_alive_bytes: usize,
    max_text_bytes_alive: usize,
}

impl ListingScan {
    /// Start a scan over a complete (possibly capped) tree listing.
    pub fn new(files: &[(String, u64)], options: ListingOptions) -> Self {
        ListingScan {
            files: files.to_vec(),
            file_sizes: files.iter().cloned().collect(),
            options,
            facts: BTreeMap::new(),
            secret_facts: BTreeMap::new(),
            whole_files: 0,
            whole_bytes: 0,
            held_fact_bytes: 0,
            max_alive_bytes: 0,
            max_text_bytes_alive: 0,
        }
    }

    /// Summarize one fetched path. Text is inspected synchronously and then
    /// dropped; only a bounded structural subset remains whole.
    pub fn add(&mut self, path: &str, text: Option<&str>) {
        let Some(size) = self.file_sizes.get(path) else {
            return;
        };
        if self.facts.contains_key(path) {
            return;
        }
        let stylesheet_unresolved = *size <= MAX_FILE
            && text.is_some_and(|text| {
                matches!(crate::ext(path), "html" | "htm")
                    && text.to_ascii_lowercase().contains("<link")
                    && listing_unread_stylesheet(&self.file_sizes, path, text)
            });
        let mut fact = text
            .filter(|text| *size <= MAX_FILE && !text.as_bytes().iter().take(8192).any(|b| *b == 0))
            .map(|text| FileFacts::from_text(path, text, stylesheet_unresolved));
        let whole_candidate_bytes = fact
            .as_ref()
            .and_then(|fact| fact.whole.as_ref())
            .map_or(0, |text| text.len());
        self.max_text_bytes_alive = self.max_text_bytes_alive.max(
            self.whole_bytes
                .saturating_add(text.map_or(0, str::len))
                .saturating_add(whole_candidate_bytes),
        );
        if let Some(fact) = fact.as_mut() {
            let bytes = fact.whole.as_ref().map_or(0, |text| text.len());
            if bytes > 0
                && (self.whole_files >= MAX_WHOLE_FILES
                    || self.whole_bytes + bytes > MAX_WHOLE_BYTES)
            {
                fact.whole = None;
            } else if bytes > 0 {
                self.whole_files += 1;
                self.whole_bytes += bytes;
            }
            self.held_fact_bytes += fact.estimated_bytes();
        }
        let secret_facts = if self.options.secrets {
            text.map(|text| SecretFacts::from_text(path, text))
        } else {
            None
        };
        if let Some(facts) = &secret_facts {
            self.held_fact_bytes += facts.estimated_bytes();
        }
        let entry_bytes =
            path.len() + std::mem::size_of::<String>() + 3 * std::mem::size_of::<usize>();
        self.held_fact_bytes += entry_bytes;
        if self.options.secrets {
            self.held_fact_bytes += entry_bytes;
        }
        let transient = self.held_fact_bytes + text.map_or(0, str::len);
        self.max_alive_bytes = self.max_alive_bytes.max(transient);
        self.facts.insert(path.to_string(), fact);
        if self.options.secrets {
            self.secret_facts.insert(path.to_string(), secret_facts);
        }
    }

    /// Run one pass. Fetch every returned path, call [`Self::add`], and
    /// repeat until `wanted` is empty. The final pass's `items` are stable.
    pub fn pass(&self) -> Outcome {
        let listing = Listing::new(&self.files, &self.facts, &self.secret_facts, self.options);
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

    /// Estimated bytes of retained facts and whole text after the latest add.
    pub fn held_bytes(&self) -> usize {
        self.held_fact_bytes
    }

    /// Largest estimated total while adding files, including the input text
    /// borrowed by `add`.
    pub fn max_alive_bytes(&self) -> usize {
        self.max_alive_bytes
    }

    /// Largest number of text bytes alive during `add`, including the
    /// incoming text and any bounded whole text copied into a structural fact.
    pub fn max_text_bytes_alive(&self) -> usize {
        self.max_text_bytes_alive
    }
}

/// Where the listing's paths sit for the stylesheet test, which resolves
/// links as absolute paths.
const VIRTUAL_ROOT: &str = "/repo";

struct Listing<'a> {
    sizes: BTreeMap<&'a str, u64>,
    facts: &'a BTreeMap<String, Option<FileFacts>>,
    secret_facts: &'a BTreeMap<String, Option<SecretFacts>>,
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
        facts: &'a BTreeMap<String, Option<FileFacts>>,
        secret_facts: &'a BTreeMap<String, Option<SecretFacts>>,
        options: ListingOptions,
    ) -> Self {
        Listing {
            sizes: files.iter().map(|(p, s)| (p.as_str(), *s)).collect(),
            facts,
            secret_facts,
            options,
            wanted: RefCell::default(),
            pending: Cell::default(),
            over: Cell::default(),
        }
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
        self.facts
            .get(path)?
            .as_ref()?
            .whole
            .as_ref()
            .map(|text| text.as_bytes()[..text.len().min(MAX_BYTES as usize)].to_vec())
    }

    fn file_facts(&self, path: &str) -> FactRead {
        let Some(size) = self.sizes.get(path) else {
            return FactRead::Unreadable;
        };
        if *size > MAX_FILE {
            return FactRead::Unreadable;
        }
        match self.facts.get(path) {
            Some(Some(facts)) => FactRead::Present(facts.clone()),
            Some(None) => FactRead::Unreadable,
            None => {
                self.wanted.borrow_mut().insert(path.to_string());
                FactRead::Missing
            }
        }
    }

    fn read_whole(&self, path: &str, limit: u64) -> Option<Vec<u8>> {
        let _ = (path, limit);
        None
    }

    fn secret_read(&self, path: &str, left: u64) -> SecretRead {
        let Some(size) = self.sizes.get(path).copied() else {
            return SecretRead::Skipped { read_bytes: 0 };
        };
        match self.secret_facts.get(path) {
            Some(Some(facts)) => {
                let read_limit = left.saturating_add(1);
                let head_len = size.min(read_limit).min(8192) as usize;
                if facts.nul_at.is_some_and(|at| at < head_len) {
                    return SecretRead::Skipped {
                        read_bytes: head_len as u64,
                    };
                }
                if size > left {
                    return SecretRead::OverBudget {
                        read_bytes: read_limit,
                    };
                }
                SecretRead::Text {
                    read_bytes: facts.bytes,
                    facts: facts.clone(),
                }
            }
            Some(None) => SecretRead::Skipped { read_bytes: 0 },
            None if self.over.get() => SecretRead::Skipped { read_bytes: 0 },
            None => {
                let pending = self.pending.get().saturating_add(size);
                self.pending.set(pending);
                self.over.set(pending >= left.saturating_add(1));
                self.wanted.borrow_mut().insert(path.to_string());
                SecretRead::Missing
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
        listing_unread_stylesheet_doc(|path| self.sizes.contains_key(path), page, doc)
    }
}

fn listing_unread_stylesheet(sizes: &BTreeMap<String, u64>, page: &str, text: &str) -> bool {
    let doc = impeccable_html::dom::StaticDocument::parse(text);
    listing_unread_stylesheet_doc(|path| sizes.contains_key(path), page, &doc)
}

fn listing_unread_stylesheet_doc(
    listed: impl Fn(&str) -> bool,
    page: &str,
    doc: &impeccable_html::dom::StaticDocument,
) -> bool {
    let dir = match page.rfind('/') {
        Some(i) => format!("{VIRTUAL_ROOT}/{}", &page[..i]),
        None => VIRTUAL_ROOT.to_string(),
    };
    let is_file = |path: &str| {
        path.strip_prefix(VIRTUAL_ROOT)
            .and_then(|path| path.strip_prefix(['/', '\\']))
            .map(|path| path.replace('\\', "/"))
            .is_some_and(|path| listed(path.as_str()))
    };
    let exists = |path: &str| {
        is_file(path)
            || path
                .strip_prefix(VIRTUAL_ROOT)
                .is_some_and(|r| matches!(r, "/.git" | "\\.git"))
    };
    impeccable_html::cascade::has_unread_stylesheet_in(doc, &dir, &is_file, &exists)
}
