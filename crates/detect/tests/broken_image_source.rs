//! The source scan's `broken-image` rule: an `<img>` with no source is
//! markup, not Svelte/Astro/Vue attribute shorthand or a binding, and `<img`
//! inside a JS/TS string, template or regex literal is not markup at all.
use impeccable_detect::detect_text::{detect_text, TextOptions};

#[test]
fn source_images_distinguish_markup_from_bindings_and_code_literals() {
    let cases: &[(&str, &str, &[usize])] = &[
        ("View.svelte", include_str!("fixtures/broken-image/shorthand.svelte"), &[5, 6, 7, 11, 12]),
        ("TooltipMultiline.svelte", include_str!("fixtures/broken-image/tooltip-multiline.svelte"), &[]),
        ("TooltipSameLine.svelte", include_str!("fixtures/broken-image/tooltip-same-line.svelte"), &[]),
        // A block closer (`{/if}`) is not the start of a regex.
        ("Block.svelte", include_str!("fixtures/broken-image/block-close.svelte"), &[2]),
        // An attribute expression has no block closers: `{/` there is a regex.
        ("Title.svelte", include_str!("fixtures/broken-image/attribute-regex.svelte"), &[]),
        ("View.astro", include_str!("fixtures/broken-image/shorthand.astro"), &[4]),
        // Elements nested in an expression, with apostrophes in their text.
        ("List.astro", include_str!("fixtures/broken-image/expressions.astro"), &[4, 5]),
        // An unclosed attribute quote does not hide the rest of the file.
        ("oops.html", include_str!("fixtures/broken-image/unclosed-quote.html"), &[3]),
        ("View.vue", include_str!("fixtures/broken-image/bindings.vue"), &[7, 8]),
        ("index.html", include_str!("fixtures/broken-image/missing.html"), &[1, 2, 3, 4, 5, 7, 9, 11, 18, 24, 30]),
        ("markers.ts", include_str!("fixtures/broken-image/literals.js"), &[]),
        ("markers.js", include_str!("fixtures/broken-image/literals.js"), &[]),
        ("markers.mjs", include_str!("fixtures/broken-image/literals.js"), &[]),
        ("markers.cjs", include_str!("fixtures/broken-image/literals.js"), &[]),
        ("View.jsx", include_str!("fixtures/broken-image/elements.jsx"), &[5, 6, 11, 14, 18, 19, 21, 29]),
        ("View.tsx", include_str!("fixtures/broken-image/elements.jsx"), &[5, 6, 11, 14, 18, 19, 21, 29]),
        // JSX children text (`Don't`, a URL, `and/or`) is text, not code.
        ("Body.tsx", include_str!("fixtures/broken-image/children-text.tsx"), &[7, 10, 15]),
    ];
    for &(path, source, expected) in cases {
        let findings = detect_text(source, path, &TextOptions::default());
        let mut lines = findings.iter().filter(|f| f.antipattern == "broken-image")
            .map(|f| f.line as usize).collect::<Vec<_>>();
        lines.sort_unstable();
        assert_eq!(lines, expected, "{path}");
    }
}
