//! The Foundations file checks over a checkout: the scan itself lives in
//! `impeccable-foundations-scan`; this is its disk source (one bounded,
//! offline walk of the root, capped reads, and git's tracked files under a
//! deadline). Runs in a full `detect` and `impeccable foundations` only,
//! never in the edit hook.

pub use impeccable_foundations_scan::Report;
use impeccable_foundations_scan::{Kind, Source, Tracked, MAX_BYTES, MAX_FILE, TOP_CONFIG};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const GIT_DEADLINE: Duration = Duration::from_secs(3);

pub fn scan(root: &Path) -> Report {
    impeccable_foundations_scan::scan(&Disk {
        root: root.to_path_buf(),
        top_config: false,
    })
}

struct Disk {
    root: PathBuf,
    /// A repository's top seen from a folder inside it: just its config.
    top_config: bool,
}

impl Source for Disk {
    fn files(&self) -> (Vec<String>, bool) {
        if self.top_config {
            return (self.config_files(), false);
        }
        impeccable_foundations_scan::walk(|dir, budget| {
            let entries = std::fs::read_dir(self.root.join(dir)).ok()?;
            let mut entries: Vec<_> = entries.flatten().take(budget).collect();
            entries.sort_by_key(|e| e.file_name());
            Some(
                entries
                    .into_iter()
                    .map(|e| {
                        let kind = match e.file_type() {
                            Ok(t) if t.is_dir() => Kind::Dir,
                            Ok(t) if t.is_file() => Kind::File,
                            _ => Kind::Other,
                        };
                        (e.file_name().to_string_lossy().into_owned(), kind)
                    })
                    .collect(),
            )
        })
    }

    fn read(&self, path: &str) -> Option<Vec<u8>> {
        use std::io::Read;
        let path = self.root.join(path);
        let meta = std::fs::symlink_metadata(&path).ok()?;
        if !meta.is_file() || meta.len() > MAX_FILE {
            return None;
        }
        let mut buf = Vec::new();
        std::fs::File::open(path)
            .ok()?
            .take(MAX_BYTES)
            .read_to_end(&mut buf)
            .ok()?;
        Some(buf)
    }

    fn read_whole(&self, path: &str, limit: u64) -> Option<Vec<u8>> {
        use std::io::Read;
        let path = self.root.join(path);
        if !std::fs::symlink_metadata(&path).is_ok_and(|m| m.is_file()) {
            return None;
        }
        // Look at the head first: a binary file isn't read further.
        let mut file = std::fs::File::open(path).ok()?.take(limit);
        let mut buf = Vec::new();
        (&mut file).take(8192).read_to_end(&mut buf).ok()?;
        if buf.contains(&0) {
            return Some(buf);
        }
        file.read_to_end(&mut buf).ok()?;
        Some(buf)
    }

    fn tracked(&self) -> Tracked {
        match git_ls_files(&self.root) {
            None => Tracked::NotRepo,
            Some(Err(())) => Tracked::Failed,
            Some(Ok(files)) => Tracked::Files {
                files,
                complete: true,
            },
        }
    }

    fn unread_stylesheet(&self, page: &str, doc: &impeccable_html::dom::StaticDocument) -> bool {
        let page = self.root.join(page);
        let dir = page.parent().unwrap_or(&self.root);
        impeccable_html::cascade::has_unread_stylesheet(doc, dir)
    }

    fn top(&self) -> Option<Box<dyn Source + '_>> {
        let top = repo_top(&self.root).filter(|t| !same_dir(t, &self.root))?;
        Some(Box::new(Disk {
            root: top,
            top_config: true,
        }))
    }
}

impl Disk {
    /// The CI and dependency-update config present at the root.
    fn config_files(&self) -> Vec<String> {
        let mut files: Vec<String> = TOP_CONFIG
            .iter()
            .filter(|f| self.root.join(f).is_file())
            .map(|f| f.to_string())
            .collect();
        if let Ok(entries) = std::fs::read_dir(self.root.join(".github/workflows")) {
            for e in entries.flatten().take(200) {
                let n = e.file_name().to_string_lossy().into_owned();
                if e.file_type().is_ok_and(|t| t.is_file()) {
                    files.push(format!(".github/workflows/{n}"));
                }
            }
        }
        files.sort();
        files
    }
}

/// The nearest folder at or above `root` that holds a `.git`.
fn repo_top(root: &Path) -> Option<PathBuf> {
    root.ancestors()
        .find(|d| d.join(".git").exists())
        .map(Path::to_path_buf)
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// Whether `root` or a folder above it holds a `.git`.
fn in_repo(root: &Path) -> bool {
    root.ancestors().any(|d| d.join(".git").exists())
}

/// `None` when `root` isn't in a git work tree; `Some(Err)` when git failed
/// or ran past its deadline.
fn git_ls_files(root: &Path) -> Option<Result<Vec<String>, ()>> {
    let child = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["-c", "core.fsmonitor=false", "ls-files", "-z", "--cached"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let Ok(mut child) = child else {
        return in_repo(root).then_some(Err(()));
    };
    let mut out = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        use std::io::Read;
        let mut buf = Vec::new();
        let _ = out.read_to_end(&mut buf);
        buf
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if started.elapsed() < GIT_DEADLINE => {
                std::thread::sleep(Duration::from_millis(5))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Some(Err(()));
            }
        }
    };
    let buf = reader.join().unwrap_or_default();
    if !status.success() {
        // Not a repository: fall back to the walk. A repository git failed
        // to read: nothing is proven.
        return in_repo(root).then_some(Err(()));
    }
    Some(Ok(String::from_utf8_lossy(&buf)
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    /// The host's loop over a checkout's tracked files: list, then fetch
    /// what each pass wants until it wants nothing.
    fn listing_items(dir: &Path) -> (BTreeMap<String, String>, usize) {
        let Some(Ok(tracked)) = git_ls_files(dir) else {
            panic!("a git checkout");
        };
        let files: Vec<(String, u64)> = tracked
            .into_iter()
            .map(|f| {
                let size = std::fs::metadata(dir.join(&f)).unwrap().len();
                (f, size)
            })
            .collect();
        let mut contents = BTreeMap::new();
        for pass in 1.. {
            let out = impeccable_foundations_scan::scan_listing(
                &files,
                &contents,
                impeccable_foundations_scan::ListingOptions::default(),
            );
            if out.wanted.is_empty() {
                let items = out
                    .items
                    .into_iter()
                    .map(|(id, s)| (id, s.as_str().to_string()))
                    .collect();
                return (items, pass);
            }
            for f in out.wanted {
                let text = String::from_utf8(std::fs::read(dir.join(&f)).unwrap()).ok();
                assert!(contents.insert(f, text).is_none(), "wanted twice");
            }
        }
        unreachable!()
    }

    fn git(dir: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success();
        assert!(ok, "git {args:?}");
    }

    #[test]
    fn a_tree_listing_settles_what_the_checkout_does() {
        // Catches: the listing scan (a Worker reading a repository's tree
        // and blobs) disagreeing with the CLI's scan of the same checkout.
        let stripe = format!("sk_{}_{}", "live", "4eC39HqLyjWDarjtT1zdp7dcAbCdEf12");
        let big: String = (0..1_200)
            .map(|i| format!("export const v{i} = {i};\n"))
            .collect();
        let workflow = "on:\n  pull_request:\njobs:\n  test:\n    steps:\n      - run: npm ci\n      - run: npm test\n";
        #[rustfmt::skip]
        let fixtures: Vec<Vec<(&str, String)>> = vec![
            vec![
                ("package.json", r#"{"dependencies":{"next":"15.0.0","react":"19.0.0","@sentry/nextjs":"8"},"scripts":{"dev":"next dev","test":"vitest"}}"#.into()),
                ("README.md", "```\nnpm install\nnpm run dev\n```\n".into()),
                (".github/workflows/ci.yml", workflow.into()),
                ("renovate.json", "{}".into()),
                ("Dockerfile", "FROM node\n".into()),
                ("app/icon.png", "png".into()),
                ("app/apple-icon.png", "png".into()),
                ("app/not-found.tsx", "export default () => null;\n".into()),
                ("app/privacy/page.tsx", "export default () => null;\n".into()),
                ("app/terms/page.tsx", "export default () => null;\n".into()),
                ("app/layout.tsx", "export const metadata = { openGraph: { images: ['/og.png'] } };\nconst c = 'transition duration-200 motion-reduce:transition-none';\n".into()),
                ("app/globals.css", ":root { --brand: #123456; }\n.a { color: var(--brand); }\n".into()),
                (".env", "SECRET_KEY=s3cr3tvalue\n".into()),
                ("db/migrations/001.up.sql", "create table a ();\n".into()),
                ("src/big.ts", big.clone()),
                ("node_modules/x/index.js", stripe.clone()),
                ("dist/bundle.js", "x".into()),
            ],
            vec![
                ("index.html", "<!doctype html><html><head><link rel=\"stylesheet\" href=\"style.css\"><link rel=\"icon\" href=\"/favicon.ico\"></head><body><p class=\"impeccable-ignore\">Hi</p></body></html>".into()),
                ("about/index.html", "<!doctype html><link rel=\"stylesheet\" href=\"/css/a.css\"><link rel=\"stylesheet\" href=\"../missing.css\">".into()),
                ("css/a.css", "@keyframes spin { to { opacity: 0 } }\n".into()),
                ("style.css", ".a { animation: spin 1s; }\n".into()),
                ("favicon.ico", "\0\0bin".into()),
                ("404.html", "<p>Not found</p>".into()),
                ("config.js", format!("const key = '{stripe}';\n")),
                (".hidden/notes.txt", "x".into()),
            ],
            vec![
                ("package.json", r#"{"dependencies":{"astro":"5"}}"#.into()),
                ("astro.config.mjs", "export default { srcDir: './web', publicDir: './assets' };\n".into()),
                ("web/pages/404.astro", "<h1>Lost</h1>".into()),
                ("web/pages/index.astro", "<meta property=\"og:image\" content=\"/og.png\">".into()),
                ("assets/favicon.svg", "<svg/>".into()),
                ("README.md", "Run `npm run build`.\n".into()),
            ],
        ];
        for (i, files) in fixtures.iter().enumerate() {
            let dir = std::env::temp_dir().join(format!(
                "impeccable-foundations-listing-{}-{i}",
                std::process::id()
            ));
            for (path, body) in files {
                let p = dir.join(path);
                std::fs::create_dir_all(p.parent().unwrap()).unwrap();
                std::fs::write(p, body).unwrap();
            }
            git(&dir, &["init", "-q"]);
            git(&dir, &["add", "-A", "-f"]);
            let disk: BTreeMap<String, String> = scan(&dir)
                .items
                .iter()
                .map(|(id, s)| (id.to_string(), s.as_str().to_string()))
                .collect();
            let (listing, passes) = listing_items(&dir);
            let _ = std::fs::remove_dir_all(&dir);
            assert!(disk.len() >= 4, "fixture {i} settles little: {disk:?}");
            assert!(passes > 1, "fixture {i} read nothing");
            assert_eq!(listing, disk, "fixture {i}");
        }
    }
}
