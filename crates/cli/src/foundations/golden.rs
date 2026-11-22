//! Cross revision goldens for the disk and listing scans. Run explicitly with
//! `IMPECCABLE_FOUNDATIONS_GOLDEN=/path/a:/path/b cargo test -p impeccable foundations_golden -- --ignored --nocapture`.
use super::local;
use impeccable_foundations_scan::{ListingOptions, State};
use std::collections::BTreeMap;
use std::path::Path;
use std::process::{Command, Stdio};

fn git(root: &Path, args: &[&str]) -> Vec<u8> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::inherit())
        .output()
        .expect("git");
    assert!(output.status.success(), "git {args:?}");
    output.stdout
}

fn git_blobs(root: &Path, oids: &[String]) -> Vec<Vec<u8>> {
    use std::io::{Read, Write};
    let mut child = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["cat-file", "--batch"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("git cat-file");
    let mut stdout = child.stdout.take().expect("stdout");
    let reader = std::thread::spawn(move || {
        let mut output = Vec::new();
        stdout
            .read_to_end(&mut output)
            .expect("read cat-file output");
        output
    });
    {
        let input = child.stdin.as_mut().expect("stdin");
        for oid in oids {
            writeln!(input, "{oid}").expect("write oid");
        }
    }
    drop(child.stdin.take());
    let status = child.wait().expect("wait for cat-file");
    assert!(status.success(), "git cat-file --batch");
    let output = reader.join().expect("join cat-file reader");
    let mut rest = output.as_slice();
    let mut blobs = Vec::with_capacity(oids.len());
    for _ in oids {
        let header_end = rest.iter().position(|b| *b == b'\n').expect("blob header");
        let header = std::str::from_utf8(&rest[..header_end]).expect("blob header text");
        let size: usize = header
            .split_ascii_whitespace()
            .nth(2)
            .expect("blob size")
            .parse()
            .expect("blob size");
        rest = &rest[header_end + 1..];
        blobs.push(rest[..size].to_vec());
        rest = &rest[size + 1..];
    }
    blobs
}

fn listing(root: &Path, secrets: bool) -> (BTreeMap<String, State>, usize, usize) {
    let raw = git(root, &["ls-tree", "-r", "-l", "-z", "HEAD"]);
    let mut files = Vec::new();
    let mut blobs = BTreeMap::new();
    for entry in raw.split(|b| *b == 0).filter(|e| !e.is_empty()) {
        let Some(tab) = entry.iter().position(|b| *b == b'\t') else {
            continue;
        };
        let meta = std::str::from_utf8(&entry[..tab]).expect("tree metadata");
        let path = String::from_utf8_lossy(&entry[tab + 1..]).into_owned();
        let fields: Vec<_> = meta.split_ascii_whitespace().collect();
        if fields.get(1) != Some(&"blob") {
            continue;
        }
        let size: u64 = fields[3].parse().expect("blob size");
        files.push((path.clone(), size));
        blobs.insert(path, fields[2].to_string());
    }
    let mut contents = BTreeMap::new();
    let mut max_alive = 0;
    loop {
        let out = impeccable_foundations_scan::scan_listing(
            &files,
            &contents,
            ListingOptions {
                secrets,
                ..ListingOptions::default()
            },
        );
        if out.wanted.is_empty() {
            let held = contents
                .values()
                .filter_map(Option::as_ref)
                .map(String::len)
                .sum();
            return (out.items, held, max_alive.max(held));
        }
        let wanted = out.wanted;
        let batch = wanted
            .iter()
            .map(|path| blobs[path].clone())
            .collect::<Vec<_>>();
        let blob_bytes = git_blobs(root, &batch);
        let existing = contents
            .values()
            .filter_map(Option::as_ref)
            .map(String::len)
            .sum::<usize>();
        let fetched_text = blob_bytes
            .iter()
            .filter_map(|bytes| std::str::from_utf8(bytes).ok())
            .map(str::len)
            .sum::<usize>();
        max_alive = max_alive.max(existing + fetched_text);
        for (path, bytes) in wanted.into_iter().zip(blob_bytes) {
            let text = String::from_utf8(bytes).ok();
            contents.insert(path, text);
        }
        max_alive = max_alive.max(
            contents
                .values()
                .filter_map(Option::as_ref)
                .map(String::len)
                .sum(),
        );
    }
}

#[test]
#[ignore = "run against the pinned local clones to capture cross-revision goldens"]
fn foundations_golden() {
    let roots = std::env::var("IMPECCABLE_FOUNDATIONS_GOLDEN").expect("roots env var");
    let mut output = Vec::new();
    let mut memory = Vec::new();
    for root in roots.split(':').filter(|s| !s.is_empty()) {
        let path = Path::new(root);
        let report = local::scan(path);
        let disk = serde_json::json!({
            "items": report.items.iter().map(|(k, v)| ((*k).to_string(), v.as_str())).collect::<BTreeMap<_, _>>(),
            "secrets": report.secrets.iter().map(|s| serde_json::json!({"file": s.file, "line": s.line, "kind": s.kind})).collect::<Vec<_>>(),
            "giant_files": report.giant_files,
            "empty": report.empty,
            "inline_ignores": report.inline_ignores,
            "unresolved_pages": report.unresolved_pages,
            "incomplete": report.incomplete,
        });
        let named = |items: BTreeMap<String, State>| {
            items
                .into_iter()
                .map(|(k, v)| (k, v.as_str()))
                .collect::<BTreeMap<_, _>>()
        };
        let (listing_items, held_bytes, max_alive_bytes) = listing(path, false);
        let items = named(listing_items);
        let secrets_items = named(listing(path, true).0);
        memory.push(serde_json::json!({
            "root": root,
            "held_bytes": held_bytes,
            "max_alive_bytes": max_alive_bytes,
        }));
        output.push(serde_json::json!({
            "root": root,
            "disk": disk,
            "listing_items": items,
            "listing_items_with_secrets": secrets_items,
        }));
    }
    println!(
        "FOUNDATIONS_GOLDEN_RESULTS:{}",
        serde_json::to_string(&output).unwrap()
    );
    eprintln!(
        "FOUNDATIONS_GOLDEN_MEMORY:{}",
        serde_json::to_string(&memory).unwrap()
    );
}
