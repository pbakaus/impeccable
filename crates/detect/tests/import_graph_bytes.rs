use impeccable_detect::file_system::build_import_graph_reporting;

#[test]
fn import_graph_accepts_non_utf8_bytes_and_preserves_read_errors() {
    let root = std::env::temp_dir().join(format!("impeccable-import-bytes-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let page = root.join("index.html").to_string_lossy().into_owned();
    let css = root.join("style.css").to_string_lossy().into_owned();
    let missing = root.join("missing.html").to_string_lossy().into_owned();
    std::fs::write(
        &page,
        b"<!-- Caf\xe9 -->\n<style>@import './style.css';</style>",
    )
    .unwrap();
    std::fs::write(&css, "body { color: black }").unwrap();
    let mut errors = Vec::new();
    let graph = build_import_graph_reporting(
        &[page.clone(), css.clone(), missing.clone()],
        &mut |path, error| errors.push((path.to_string(), error.kind())),
    );
    std::fs::remove_dir_all(root).unwrap();
    assert_eq!(graph, vec![(page, vec![css.clone()]), (css, vec![])]);
    assert_eq!(errors, vec![(missing, std::io::ErrorKind::NotFound)]);
}
