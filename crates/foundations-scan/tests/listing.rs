//! `scan_listing` as a host drives it: fetch what each pass wants until it
//! wants nothing. (The CLI's own tests check it against a disk scan of the
//! same checkout.)
use impeccable_foundations_scan::{
    scan_listing, ListingOptions, ListingScan, Outcome, State, MAX_FILE,
};
use std::collections::BTreeMap;

fn settle(tree: &[(&str, &str)], options: ListingOptions) -> (Outcome, usize) {
    let files: Vec<(String, u64)> = tree
        .iter()
        .map(|(p, t)| (p.to_string(), t.len() as u64))
        .collect();
    let mut contents = BTreeMap::new();
    for pass in 1..10 {
        let out = scan_listing(&files, &contents, options);
        if out.wanted.is_empty() {
            return (out, pass);
        }
        for path in &out.wanted {
            let text = tree.iter().find(|(p, _)| p == path).expect("listed").1;
            contents.insert(path.clone(), Some(text.to_string()));
        }
    }
    panic!("never settled");
}

const TREE: &[(&str, &str)] = &[
    (
        "package.json",
        r#"{"dependencies":{"react":"19.0.0"},"scripts":{"dev":"vite"}}"#,
    ),
    ("README.md", "```\nnpm install\nnpm run dev\n```\n"),
    (
        ".github/workflows/ci.yml",
        "on: [push]\njobs:\n  test:\n    steps:\n      - run: npm test\n",
    ),
    ("index.html", "<!doctype html><p>Hi</p>"),
    ("src/app.css", ".a { transition: opacity 1s; }\n"),
    ("node_modules/left-pad/index.js", "module.exports = 1;\n"),
];

#[test]
fn a_host_loop_settles_and_never_fetches_ignored_files() {
    // Catches: a pass that wants files the walk ignores, wants one twice, or
    // never settles.
    let (out, passes) = settle(TREE, ListingOptions::default());
    assert!(passes > 1);
    assert_eq!(out.items.get("ci-runs-tests"), Some(&State::Checked));
    assert_eq!(out.items.get("readme-runs"), Some(&State::Checked));
    assert_eq!(out.items.get("reduced-motion"), Some(&State::Failing));
    assert_eq!(out.items.get("secrets-out-of-repo"), Some(&State::Checked));
    let first = scan_listing(
        &TREE
            .iter()
            .map(|(p, t)| (p.to_string(), t.len() as u64))
            .collect::<Vec<_>>(),
        &BTreeMap::new(),
        ListingOptions::default(),
    );
    assert!(
        first.wanted.iter().all(|p| !p.starts_with("node_modules/")),
        "{:?}",
        first.wanted
    );
    assert_eq!(
        serde_json::to_value(&out).unwrap()["items"]["ci-runs-tests"],
        "checked"
    );
}

#[test]
fn a_capped_listing_fails_nothing_on_absence() {
    // Catches: a truncated tree failing items whose evidence may sit in the
    // part not listed, or passing the secrets scan over a partial list.
    let (out, _) = settle(
        TREE,
        ListingOptions {
            capped: true,
            ..ListingOptions::default()
        },
    );
    assert_eq!(out.items.get("ci-runs-tests"), Some(&State::Checked));
    for id in [
        "reduced-motion",
        "readme-runs",
        "secrets-out-of-repo",
        "app-icons",
    ] {
        assert_eq!(out.items.get(id), None, "{id}: {:?}", out.items);
    }
}

#[test]
fn a_pass_wants_no_more_than_the_secrets_budget() {
    // Catches: the first pass asking a host to fetch every tracked file
    // whatever their combined size, when the scan would stop at its budget.
    let mb = 1024 * 1024;
    let files: Vec<(String, u64)> = ["a.txt", "b.txt", "c.txt"]
        .iter()
        .map(|p| (p.to_string(), 200 * mb))
        .collect();
    let out = scan_listing(&files, &BTreeMap::new(), ListingOptions::default());
    assert_eq!(out.wanted, ["a.txt", "b.txt"]);
}

#[test]
fn secrets_off_reads_nothing_whole_and_claims_no_secrets_item() {
    // Catches: a host that turned the secrets scan off still fetching every
    // tracked file for it, or getting a secrets state it never paid for.
    let mut tree = TREE.to_vec();
    tree.push((".env", "SECRET_KEY=s3cr3tvalue\n"));
    let off = ListingOptions {
        secrets: false,
        ..ListingOptions::default()
    };
    let files: Vec<(String, u64)> = tree
        .iter()
        .map(|(p, t)| (p.to_string(), t.len() as u64))
        .collect();
    // The content checks alone never read `.env`; only the secrets scan does.
    let on = scan_listing(&files, &BTreeMap::new(), ListingOptions::default());
    assert!(on.wanted.iter().any(|p| p == ".env"), "{:?}", on.wanted);
    let first = scan_listing(&files, &BTreeMap::new(), off);
    assert!(
        !first.wanted.iter().any(|p| p == ".env"),
        "{:?}",
        first.wanted
    );
    let (without, _) = settle(&tree, off);
    let (mut with, _) = settle(&tree, ListingOptions::default());
    assert_eq!(
        with.items.remove("secrets-out-of-repo"),
        Some(State::Failing)
    );
    assert_eq!(without.items.get("secrets-out-of-repo"), None);
    assert_eq!(without.items, with.items);
}

#[test]
fn streaming_scan_keeps_facts_instead_of_ui_file_text() {
    let text = format!(
        ".x {{ transition: opacity 1s; }}\n{}",
        ".x { color: #123456; }\n".repeat(40)
    );
    let files: Vec<(String, u64)> = (0..64)
        .map(|i| (format!("src/styles/{i}.css"), text.len() as u64))
        .collect();
    let contents: BTreeMap<String, String> = files
        .iter()
        .map(|(path, _)| (path.clone(), text.clone()))
        .collect();
    let mut scan = ListingScan::new(
        &files,
        ListingOptions {
            secrets: false,
            ..ListingOptions::default()
        },
    );
    let mut final_out = None;
    for _ in 0..8 {
        let out = scan.pass();
        if out.wanted.is_empty() {
            final_out = Some(out);
            break;
        }
        for path in out.wanted {
            scan.add(&path, contents.get(&path).map(String::as_str));
        }
    }
    let out = final_out.expect("streaming listing settles");
    assert!(out.items.contains_key("design-tokens"));
    assert!(scan.held_bytes() < contents.values().map(String::len).sum::<usize>() / 2);
}

#[test]
fn streaming_scan_does_not_request_oversized_content_files() {
    let files = vec![("src/large.ts".to_string(), MAX_FILE + 1)];
    let scan = ListingScan::new(
        &files,
        ListingOptions {
            secrets: false,
            ..ListingOptions::default()
        },
    );

    assert!(scan.pass().wanted.is_empty());
}
