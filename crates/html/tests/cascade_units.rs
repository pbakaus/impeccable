//! Unit tests for the cascade helpers without recorded vectors. Expected
//! values were produced by running the JS `css-cascade.mjs` in Node.

use impeccable_html::cascade::checks_shim::{resolve_length_px, resolve_var_refs, CustomProps};
use impeccable_html::cascade::rules::{
    apply_static_declaration, parse_static_style_attribute, DeclMeta, SpecifiedStore,
};
use impeccable_html::cascade::values::{normalize_color_for_check, unwrap_css_at_layer};

#[test]
fn normalize_color_for_check_matches_node() {
    let cases: &[(&str, &str)] = &[
        ("#ffffff", "rgb(255, 255, 255)"),
        ("#FfF", "rgb(255, 255, 255)"),
        ("#abc", "rgb(170, 187, 204)"),
        ("  #ABCDEF  ", "rgb(171, 205, 239)"),
        ("white", "rgb(255, 255, 255)"),
        ("Black", "rgb(0, 0, 0)"),
        ("GRAY", "rgb(128, 128, 128)"),
        ("grey", "rgb(128, 128, 128)"),
        ("silver", "rgb(192, 192, 192)"),
        ("red", "rgb(255, 0, 0)"),
        ("green", "rgb(0, 128, 0)"),
        ("blue", "rgb(0, 0, 255)"),
        ("yellow", "rgb(255, 255, 0)"),
        ("purple", "purple"),
        ("rgb(1, 2, 3)", "rgb(1, 2, 3)"),
        ("oklch(50% 0.1 20)", "oklch(50% 0.1 20)"),
        ("#abcd", "#abcd"),
        ("#12345", "#12345"),
        ("", ""),
        ("   ", ""),
        ("var(--x)", "var(--x)"),
        ("transparent", "transparent"),
    ];
    for (input, expected) in cases {
        assert_eq!(
            normalize_color_for_check(input),
            *expected,
            "input {:?}",
            input
        );
    }
}

fn meta(important: bool, specificity: [u32; 3], order: i64, inline: bool) -> DeclMeta {
    DeclMeta {
        important,
        specificity,
        order,
        inline,
    }
}

#[test]
fn apply_static_declaration_matches_node() {
    let mut specified: SpecifiedStore<&str> = SpecifiedStore::new();
    let node = "n1";
    let mut apply = |prop: &str, value: &str, m: DeclMeta| {
        apply_static_declaration(&mut specified, node, prop, value, &m);
    };
    apply("margin", "0", meta(false, [0, 0, 0], 0, false));
    apply("margin-top", "5px", meta(false, [0, 1, 0], 1, false));
    apply("margin", "10px 20px", meta(false, [0, 0, 1], 2, false));
    apply("color", "red", meta(true, [0, 0, 0], 3, false));
    apply("color", "blue", meta(false, [1, 0, 0], 4, true));
    apply("background", "var(--x)", meta(false, [0, 1, 0], 5, false));
    apply("background", "none", meta(false, [0, 1, 0], 6, false));
    apply("--brand", "#fff", meta(false, [0, 1, 0], 7, false));
    apply(
        "font",
        "italic 700 12px/1.4 Inter, sans-serif",
        meta(false, [0, 1, 0], 8, false),
    );
    apply("box-sizing", "border-box", meta(false, [0, 1, 0], 9, false));
    apply("margin-top", "1px", meta(false, [0, 0, 0], 10, false));
    apply("margin-top", "2px", meta(true, [0, 0, 0], 11, false));
    apply("margin-top", "3px", meta(false, [9, 9, 9], 12, true));
    apply("outline", "0", meta(false, [0, 0, 0], 13, false));
    apply(
        "border-left",
        "3px solid teal",
        meta(false, [0, 0, 0], 14, false),
    );

    let map = specified.get(&node).expect("node entry");
    let got: Vec<(String, bool, [u32; 3], i64, bool, String)> = map
        .iter()
        .map(|(k, d)| {
            (
                k.clone(),
                d.meta.important,
                d.meta.specificity,
                d.meta.order,
                d.meta.inline,
                d.value.clone(),
            )
        })
        .collect();
    let s = |x: &str| x.to_string();
    let expected = vec![
        (s("marginTop"), true, [0, 0, 0], 11, false, s("2px")),
        (s("marginRight"), false, [0, 0, 1], 2, false, s("20px")),
        (s("marginBottom"), false, [0, 0, 1], 2, false, s("10px")),
        (s("marginLeft"), false, [0, 0, 1], 2, false, s("20px")),
        (s("color"), true, [0, 0, 0], 3, false, s("red")),
        (
            s("backgroundColor"),
            false,
            [0, 1, 0],
            6,
            false,
            s("rgba(0, 0, 0, 0)"),
        ),
        (s("backgroundImage"), false, [0, 1, 0], 6, false, s("none")),
        // Not in the JS model: the background longhands the shorthand
        // resets, stored beside its expansion (see `background_longhands`).
        (
            s("backgroundRepeat"),
            false,
            [0, 1, 0],
            6,
            false,
            s("repeat"),
        ),
        (s("backgroundSize"), false, [0, 1, 0], 6, false, s("auto")),
        (s("--brand"), false, [0, 1, 0], 7, false, s("#fff")),
        (s("fontStyle"), false, [0, 1, 0], 8, false, s("italic")),
        (s("fontWeight"), false, [0, 1, 0], 8, false, s("700")),
        (s("fontSize"), false, [0, 1, 0], 8, false, s("12px")),
        (s("lineHeight"), false, [0, 1, 0], 8, false, s("1.4")),
        (
            s("fontFamily"),
            false,
            [0, 1, 0],
            8,
            false,
            s("Inter, sans-serif"),
        ),
        (s("outlineWidth"), false, [0, 0, 0], 13, false, s("0px")),
        (s("borderLeftWidth"), false, [0, 0, 0], 14, false, s("3px")),
        (s("borderLeftColor"), false, [0, 0, 0], 14, false, s("teal")),
        (
            s("borderLeftStyle"),
            false,
            [0, 0, 0],
            14,
            false,
            s("solid"),
        ),
    ];
    assert_eq!(got, expected);
    // prop is the expanded property name
    assert_eq!(map.get("marginTop").unwrap().prop, "marginTop");
}

#[test]
fn parse_static_style_attribute_edge_cases_match_node() {
    let decls = parse_static_style_attribute(
        ": x; a:b; c: d !important ; e:f!IMPORTANT; g; h:; :i; j:k:l",
        5,
    );
    let got: Vec<(String, String, bool, i64)> = decls
        .into_iter()
        .map(|d| (d.prop, d.value, d.important, d.order))
        .collect();
    let s = |x: &str| x.to_string();
    assert_eq!(
        got,
        vec![
            (s("a"), s("b"), false, 5),
            (s("c"), s("d"), true, 6),
            (s("e"), s("f"), true, 7),
            (s("h"), s(""), false, 8),
            (s(""), s("i"), false, 9),
            (s("j"), s("k:l"), false, 10),
        ]
    );
}

#[test]
fn unwrap_css_at_layer_shapes() {
    assert_eq!(unwrap_css_at_layer(""), "");
    assert_eq!(unwrap_css_at_layer(".a{color:red}"), ".a{color:red}");
    assert_eq!(
        unwrap_css_at_layer("@layer base { .a{color:red} } .b{c:d}"),
        " .a{color:red}  .b{c:d}"
    );
    assert_eq!(
        unwrap_css_at_layer("@layer{ .a{ .n{x:y} } }@layer a.b { .c{d:e} }"),
        " .a{ .n{x:y} }  .c{d:e} "
    );
    // statement form is untouched
    assert_eq!(
        unwrap_css_at_layer("@layer a, b; .x{y:z}"),
        "@layer a, b; .x{y:z}"
    );
    // unbalanced: source unchanged
    assert_eq!(
        unwrap_css_at_layer("@layer x { .a{color:red}"),
        "@layer x { .a{color:red}"
    );
    // `@layered` does not match the word boundary
    assert_eq!(
        unwrap_css_at_layer("@layered x { .a{c:d} }"),
        "@layered x { .a{c:d} }"
    );
}

#[test]
fn checks_shim_helpers() {
    let mut props = CustomProps::new();
    props.insert("--a".into(), "var(--b)".into());
    props.insert("--b".into(), "#fff".into());
    props.insert("--loop".into(), "var(--loop)".into());
    assert_eq!(resolve_var_refs("var(--a)", &props), "#fff");
    assert_eq!(resolve_var_refs("var( --b , red )", &props), "#fff");
    assert_eq!(resolve_var_refs("var(--missing, red )", &props), "red");
    assert_eq!(
        resolve_var_refs("var(--outer, var(--inner, 0))", &props),
        "0"
    );
    assert_eq!(resolve_var_refs("var(--missing)", &props), "var(--missing)");
    assert_eq!(resolve_var_refs("var(--loop)", &props), "var(--loop)");
    assert_eq!(resolve_var_refs("plain", &props), "plain");
    assert_eq!(resolve_length_px("normal", 16.0), None);
    assert_eq!(resolve_length_px("", 16.0), None);
    assert_eq!(resolve_length_px("abc", 16.0), None);
    assert_eq!(resolve_length_px("12px", 16.0), Some(12.0));
    assert_eq!(resolve_length_px("1.5rem", 10.0), Some(24.0));
    assert_eq!(resolve_length_px("2em", 10.0), Some(20.0));
    assert_eq!(resolve_length_px("50%", 10.0), Some(5.0));
    assert_eq!(resolve_length_px("1.5", 10.0), Some(15.0));
}

#[test]
fn background_longhands_ride_beside_the_expansion() {
    use impeccable_html::cascade::shorthand::background_longhands;
    let pairs =
        |prop: &str, value: &str| -> Vec<(String, String)> { background_longhands(prop, value) };
    let own = |pairs: &[(&str, &str)]| -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    };

    // The expansion itself is pinned by the recorded vectors and stays
    // image-and-color only; repeat and size come from the side channel.
    assert_eq!(
        pairs(
            "background",
            "url(a.png) center / cover no-repeat, url(b.png)"
        ),
        own(&[
            ("backgroundRepeat", "no-repeat, repeat"),
            ("backgroundSize", "cover, auto")
        ])
    );
    // The css-tree generator glues the first keyword to the call.
    assert_eq!(
        pairs("background", "url(a.png)center/cover no-repeat"),
        own(&[
            ("backgroundRepeat", "no-repeat"),
            ("backgroundSize", "cover")
        ])
    );
    // Tokens may come before the image, and a paren in an escaped or quoted
    // url does not end the call early.
    assert_eq!(
        pairs("background", "center / 64px no-repeat url(a\\).png)"),
        own(&[
            ("backgroundRepeat", "no-repeat"),
            ("backgroundSize", "64px")
        ])
    );
    assert_eq!(
        pairs("background", "url(\"a)b.png\") repeat-x"),
        own(&[("backgroundRepeat", "repeat-x"), ("backgroundSize", "auto")])
    );
    // A size given as a function is kept for the compute loop to resolve;
    // it used to collapse to `auto`. A slash inside calc() is not the
    // position / size separator.
    assert_eq!(
        pairs(
            "background",
            "url(seal.png) no-repeat right top / var(--Seal)"
        ),
        own(&[
            ("backgroundRepeat", "no-repeat"),
            ("backgroundSize", "var(--Seal)")
        ])
    );
    assert_eq!(
        pairs("background", "url(a.png) 0 0 / calc(100% / 3) AUTO"),
        own(&[
            ("backgroundRepeat", "repeat"),
            ("backgroundSize", "calc(100% / 3) auto")
        ])
    );
    assert_eq!(
        pairs("Background-Size", "100% 32px"),
        own(&[("backgroundSize", "100% 32px")])
    );
    // A shorthand that names no image resets the image, as in CSS. The
    // expansion only does that for `background: none`.
    assert_eq!(
        pairs("background", "#fff"),
        own(&[
            ("backgroundRepeat", "repeat"),
            ("backgroundSize", "auto"),
            ("backgroundImage", "none")
        ])
    );
    assert_eq!(
        pairs("background", "transparent"),
        own(&[
            ("backgroundRepeat", "repeat"),
            ("backgroundSize", "auto"),
            ("backgroundImage", "none")
        ])
    );
    // An image function the engine does not read is an image all the same:
    // it replaces what an earlier rule set and is not cleared to `none`.
    assert_eq!(
        pairs("background", "#111 paint(dots)"),
        own(&[
            ("backgroundRepeat", "repeat"),
            ("backgroundSize", "auto"),
            ("backgroundImage", "#111 paint(dots)")
        ])
    );
    assert_eq!(
        pairs("background", "paint(var(--pattern))"),
        own(&[
            ("backgroundRepeat", "repeat"),
            ("backgroundSize", "auto"),
            ("backgroundImage", "paint(var(--pattern))")
        ])
    );
    assert_eq!(
        pairs("background", "image-set(\"a.png\" 1x) center / cover"),
        own(&[
            ("backgroundRepeat", "repeat"),
            ("backgroundSize", "cover"),
            ("backgroundImage", "image-set(\"a.png\" 1x) center / cover")
        ])
    );
    // A color named after the image, which the expansion never reads. A
    // color before the image is the expansion's, and a gradient's own stops
    // are not the background color.
    assert_eq!(
        pairs("background", "url(cutout.png) #17150f"),
        own(&[
            ("backgroundRepeat", "repeat"),
            ("backgroundSize", "auto"),
            ("backgroundColor", "#17150f")
        ])
    );
    assert_eq!(
        pairs(
            "background",
            "url(a.png), url(b.png) no-repeat rgba(0, 0, 0, 0.5)"
        ),
        own(&[
            ("backgroundRepeat", "repeat, no-repeat"),
            ("backgroundSize", "auto, auto"),
            ("backgroundColor", "rgba(0, 0, 0, 0.5)")
        ])
    );
    assert_eq!(
        pairs("background", "url(a.png) no-repeat, #17150F"),
        own(&[
            ("backgroundRepeat", "no-repeat, repeat"),
            ("backgroundSize", "auto, auto"),
            ("backgroundColor", "#17150F")
        ])
    );
    assert_eq!(
        pairs("background", "url(a.png), element(#abc)"),
        own(&[
            ("backgroundRepeat", "repeat, repeat"),
            ("backgroundSize", "auto, auto")
        ])
    );
    assert_eq!(
        pairs("background", "#111 url(a.png)"),
        own(&[("backgroundRepeat", "repeat"), ("backgroundSize", "auto")])
    );
    assert_eq!(
        pairs("background", "linear-gradient(#fff, #000)"),
        own(&[("backgroundRepeat", "repeat"), ("backgroundSize", "auto")])
    );
    assert_eq!(
        pairs("background", "Inherit"),
        own(&[
            ("backgroundRepeat", "inherit"),
            ("backgroundSize", "inherit")
        ])
    );
    assert!(pairs("background", "var(--surface)").is_empty());
    assert!(pairs("background-color", "red").is_empty());
    assert!(pairs("color", "red").is_empty());

    // Through the cascade: a later shorthand resets an earlier longhand, a
    // later longhand overrides a shorthand, and a color-only shorthand
    // clears the image an earlier rule set.
    let mut specified: SpecifiedStore<&str> = SpecifiedStore::new();
    let node = "n1";
    let value_of = |specified: &SpecifiedStore<&str>, prop: &str| -> Option<String> {
        specified
            .get(&node)
            .and_then(|map| map.get(prop))
            .map(|d| d.value.clone())
    };
    let mut order = 0;
    let mut apply = |specified: &mut SpecifiedStore<&str>, prop: &str, value: &str| {
        apply_static_declaration(
            specified,
            node,
            prop,
            value,
            &meta(false, [0, 1, 0], order, false),
        );
        order += 1;
    };
    apply(&mut specified, "background-repeat", "no-repeat");
    apply(&mut specified, "background", "url(hero.jpg) center / cover");
    apply(&mut specified, "background-size", "contain");
    assert_eq!(
        value_of(&specified, "backgroundRepeat").as_deref(),
        Some("repeat")
    );
    assert_eq!(
        value_of(&specified, "backgroundSize").as_deref(),
        Some("contain")
    );
    assert_eq!(
        value_of(&specified, "backgroundImage").as_deref(),
        Some("url(hero.jpg) center / cover")
    );
    apply(&mut specified, "background", "transparent");
    assert_eq!(
        value_of(&specified, "backgroundImage").as_deref(),
        Some("none")
    );
    assert_eq!(
        value_of(&specified, "backgroundSize").as_deref(),
        Some("auto")
    );
    // A less specific color-only shorthand does not clear a more specific
    // image: the reset obeys the same priority as everything else.
    let mut specified: SpecifiedStore<&str> = SpecifiedStore::new();
    apply_static_declaration(
        &mut specified,
        node,
        "background",
        "url(hero.jpg)",
        &meta(false, [1, 0, 0], 0, false),
    );
    apply_static_declaration(
        &mut specified,
        node,
        "background",
        "#fff",
        &meta(false, [0, 1, 0], 1, false),
    );
    assert_eq!(
        value_of(&specified, "backgroundImage").as_deref(),
        Some("url(hero.jpg)")
    );
}

#[test]
fn a_foreign_sheet_resolves_its_urls_against_itself() {
    use impeccable_html::cascade::rules::{
        collect_static_css_rules, collect_static_css_rules_from, UrlBase,
    };

    let css = concat!(
        "/* see url( for details, and url(commented.png) */\n",
        ".a { background: url(light.png) }\n",
        ".b { background: url(\"../img/hero.jpg?v=3\") no-repeat }\n",
        ".c { background-image: url('./x.webp'), url(/root.png), url(data:image/png;base64,AAAA) }\n",
        ".d { background: url(https://cdn.example.com/a.png) }\n",
        ".e { mask: url(#clip) }\n",
        ".f { background: url(\"a b (1).png\") }\n",
        ".g { content: \"url(k.png) /* not a comment */\"; background: url(g.png) }\n",
        ".h { mask: myurl(h.png); list-style: url(dot.png) }\n",
        ":root { --hero: url(\"../img/hero.jpg\") ; --tint: rgba(0, 0, 0, 0.4); --note: \"url(k.png)\" }\n",
    );
    let base = UrlBase::new("/site/css", "/site");
    let rules = collect_static_css_rules_from(css, 40, Some(&base));
    let value = |selector: &str, prop: &str| -> String {
        rules
            .iter()
            .find(|r| r.selector == selector)
            .and_then(|r| r.declarations.iter().find(|d| d.prop == prop))
            .map(|d| d.value.clone())
            .unwrap_or_default()
    };
    assert_eq!(value(".a", "background"), "url(css/light.png)");
    assert_eq!(value(".b", "background"), "url(img/hero.jpg?v=3)no-repeat");
    assert_eq!(
        value(".c", "background-image"),
        "url(css/x.webp),url(/root.png),url(data:image/png;base64,AAAA)"
    );
    assert_eq!(
        value(".d", "background"),
        "url(https://cdn.example.com/a.png)"
    );
    assert_eq!(value(".e", "mask"), "url(#clip)");
    // An escaped url is decoded by the parser, resolved, and re-escaped:
    // it is no longer left sheet-relative.
    assert_eq!(value(".f", "background"), "url(css/a\\ b\\ \\(1\\).png)");
    // A string is content, a custom function is not the url token, and
    // every real url in the sheet is resolved, whatever the property.
    assert_eq!(value(".g", "content"), "\"url(k.png) /* not a comment */\"");
    assert_eq!(value(".g", "background"), "url(css/g.png)");
    assert_eq!(value(".h", "mask"), "myurl(h.png)");
    assert_eq!(value(".h", "list-style"), "url(css/dot.png)");
    // A custom property's value is opaque to the parser. One that holds a
    // url is read as a value and resolved; any other is left as written.
    assert_eq!(value(":root", "--hero"), "url(img/hero.jpg)");
    assert_eq!(value(":root", "--tint"), "rgba(0, 0, 0, 0.4)");
    assert_eq!(value(":root", "--note"), "\"url(k.png)\"");
    // Cascade order runs on from where the stretch before it stopped.
    assert_eq!(rules.first().map(|r| r.order), Some(40));
    assert_eq!(
        rules.last().map(|r| r.order),
        Some(40 + rules.len() as i64 - 1)
    );
    // A sheet above the page walks back up, and without a base nothing is
    // touched: the plain collector is the same parse as before.
    let up = collect_static_css_rules_from(
        ".a { background: url(light.png) }",
        0,
        Some(&UrlBase::new("/site", "/site/pages")),
    );
    assert_eq!(up[0].declarations[0].value, "url(../light.png)");
    assert_eq!(
        collect_static_css_rules(css),
        collect_static_css_rules_from(css, 0, None)
    );
    assert_eq!(
        collect_static_css_rules(css)[0].declarations[0].value,
        "url(light.png)"
    );
}
