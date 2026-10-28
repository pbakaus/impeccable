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
        (
            s("backgroundPosition"),
            false,
            [0, 1, 0],
            6,
            false,
            s("0% 0%"),
        ),
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
            ("backgroundSize", "cover, auto"),
            ("backgroundPosition", "center, 0% 0%")
        ])
    );
    // The css-tree generator glues the first keyword to the call.
    assert_eq!(
        pairs("background", "url(a.png)center/cover no-repeat"),
        own(&[
            ("backgroundRepeat", "no-repeat"),
            ("backgroundSize", "cover"),
            ("backgroundPosition", "center")
        ])
    );
    // Tokens may come before the image, and a paren in an escaped or quoted
    // url does not end the call early.
    assert_eq!(
        pairs("background", "center / 64px no-repeat url(a\\).png)"),
        own(&[
            ("backgroundRepeat", "no-repeat"),
            ("backgroundSize", "64px"),
            ("backgroundPosition", "center")
        ])
    );
    assert_eq!(
        pairs("background", "url(\"a)b.png\") repeat-x"),
        own(&[
            ("backgroundRepeat", "repeat-x"),
            ("backgroundSize", "auto"),
            ("backgroundPosition", "0% 0%")
        ])
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
            ("backgroundRepeat", "from-shorthand(no-repeat right top/var(--Seal))"),
            ("backgroundSize", "from-shorthand(no-repeat right top/var(--Seal))"),
            ("backgroundPosition", "from-shorthand(no-repeat right top/var(--Seal))"),
            ("backgroundOrigin", "from-shorthand(no-repeat right top/var(--Seal))"),
            ("backgroundClip", "from-shorthand(no-repeat right top/var(--Seal))"),
            ("backgroundAttachment", "from-shorthand(no-repeat right top/var(--Seal))")
        ])
    );
    assert_eq!(
        pairs("background", "url(a.png) 0 0 / calc(100% / 3) AUTO"),
        own(&[
            ("backgroundRepeat", "repeat"),
            ("backgroundSize", "calc(100% / 3) auto"),
            ("backgroundPosition", "0 0")
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
            ("backgroundPosition", "0% 0%"),
            ("backgroundImage", "none")
        ])
    );
    assert_eq!(
        pairs("background", "transparent"),
        own(&[
            ("backgroundRepeat", "repeat"),
            ("backgroundSize", "auto"),
            ("backgroundPosition", "0% 0%"),
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
            ("backgroundPosition", "0% 0%"),
            ("backgroundImage", "#111 paint(dots)")
        ])
    );
    assert_eq!(
        pairs("background", "paint(var(--pattern))"),
        own(&[
            ("backgroundRepeat", "repeat"),
            ("backgroundSize", "auto"),
            ("backgroundPosition", "0% 0%"),
            ("backgroundImage", "paint(var(--pattern))")
        ])
    );
    assert_eq!(
        pairs("background", "image-set(\"a.png\" 1x) center / cover"),
        own(&[
            ("backgroundRepeat", "repeat"),
            ("backgroundSize", "cover"),
            ("backgroundPosition", "center"),
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
            ("backgroundPosition", "0% 0%"),
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
            ("backgroundPosition", "0% 0%, 0% 0%"),
            ("backgroundColor", "rgba(0, 0, 0, 0.5)")
        ])
    );
    assert_eq!(
        pairs("background", "url(a.png) no-repeat, #17150F"),
        own(&[
            ("backgroundRepeat", "no-repeat, repeat"),
            ("backgroundSize", "auto, auto"),
            ("backgroundPosition", "0% 0%, 0% 0%"),
            ("backgroundColor", "#17150F")
        ])
    );
    assert_eq!(
        pairs("background", "url(a.png), element(#abc)"),
        own(&[
            ("backgroundRepeat", "repeat, repeat"),
            ("backgroundSize", "auto, auto"),
            ("backgroundPosition", "0% 0%, 0% 0%")
        ])
    );
    assert_eq!(
        pairs("background", "#111 url(a.png)"),
        own(&[
            ("backgroundRepeat", "repeat"),
            ("backgroundSize", "auto"),
            ("backgroundPosition", "0% 0%")
        ])
    );
    assert_eq!(
        pairs("background", "linear-gradient(#fff, #000)"),
        own(&[
            ("backgroundRepeat", "repeat"),
            ("backgroundSize", "auto"),
            ("backgroundPosition", "0% 0%")
        ])
    );
    assert_eq!(
        pairs("background", "Inherit"),
        own(&[
            ("backgroundRepeat", "inherit"),
            ("backgroundSize", "inherit"),
            ("backgroundPosition", "inherit")
        ])
    );
    // `initial`, `unset`, and `revert` are the longhands' initial values;
    // `inherit` is for the compute loop.
    assert_eq!(
        pairs("background-repeat", "initial"),
        own(&[("backgroundRepeat", "repeat")])
    );
    assert_eq!(
        pairs("background-size", "UNSET"),
        own(&[("backgroundSize", "auto")])
    );
    assert_eq!(
        pairs("background", "revert"),
        own(&[
            ("backgroundRepeat", "repeat"),
            ("backgroundSize", "auto"),
            ("backgroundPosition", "0% 0%")
        ])
    );
    assert_eq!(
        pairs("background-blend-mode", "multiply, screen"),
        own(&[("backgroundBlendMode", "multiply, screen")])
    );
    // The css-tree generator glues tokens the tokenizer can tell apart: a
    // value that round-tripped through the parser carries no space after a
    // `)` or a `%`, or before a `#`. Each glued component is still read.
    assert_eq!(
        pairs(
            "background",
            "#17150f url(light.png)center/100% 100%no-repeat"
        ),
        own(&[
            ("backgroundRepeat", "no-repeat"),
            ("backgroundSize", "100% 100%"),
            ("backgroundPosition", "center")
        ])
    );
    assert_eq!(
        pairs("background", "url(icon.png)no-repeat#17150f"),
        own(&[
            ("backgroundRepeat", "no-repeat"),
            ("backgroundSize", "auto"),
            ("backgroundPosition", "0% 0%"),
            ("backgroundColor", "#17150f")
        ])
    );
    assert_eq!(
        pairs("background", "url(icon.png)var(--tile)"),
        own(&[
            ("backgroundRepeat", "from-shorthand(var(--tile))"),
            ("backgroundSize", "from-shorthand(var(--tile))"),
            ("backgroundPosition", "from-shorthand(var(--tile))"),
            ("backgroundOrigin", "from-shorthand(var(--tile))"),
            ("backgroundClip", "from-shorthand(var(--tile))"),
            ("backgroundAttachment", "from-shorthand(var(--tile))"),
            ("backgroundColor", "var(--tile)")
        ])
    );
    assert_eq!(
        pairs("background", "url(a.png)0 200px/100%100%no-repeat"),
        own(&[
            ("backgroundRepeat", "no-repeat"),
            ("backgroundSize", "100% 100%"),
            ("backgroundPosition", "0 200px")
        ])
    );
    // The generator escapes a `(` in a file name; the escaped paren opens
    // no call, so the keywords after it are still read, in one layer and
    // across a list.
    assert_eq!(
        pairs("background", "url(icon\\(1.png) no-repeat #111"),
        own(&[
            ("backgroundRepeat", "no-repeat"),
            ("backgroundSize", "auto"),
            ("backgroundPosition", "0% 0%"),
            ("backgroundColor", "#111")
        ])
    );
    assert_eq!(
        pairs("background", "url(a\\(1.png) no-repeat, url(b.png) center / cover"),
        own(&[
            ("backgroundRepeat", "no-repeat, repeat"),
            ("backgroundSize", "auto, cover"),
            ("backgroundPosition", "0% 0%, center")
        ])
    );
    // A bare `var()` after the image is stored as the color too, the one
    // slot the expansion never reads on that side; the layer it stands in
    // is stored whole in every other slot, marked, for the re-read once it
    // resolves. A `var()` inside another function marks the layer the same
    // way.
    assert_eq!(
        pairs("background", "url(icon.png) no-repeat var(--brand)"),
        own(&[
            ("backgroundRepeat", "from-shorthand(no-repeat var(--brand))"),
            ("backgroundSize", "from-shorthand(no-repeat var(--brand))"),
            ("backgroundPosition", "from-shorthand(no-repeat var(--brand))"),
            ("backgroundOrigin", "from-shorthand(no-repeat var(--brand))"),
            ("backgroundClip", "from-shorthand(no-repeat var(--brand))"),
            ("backgroundAttachment", "from-shorthand(no-repeat var(--brand))"),
            ("backgroundColor", "var(--brand)")
        ])
    );
    assert_eq!(
        pairs("background", "url(icon.png)var(--x)"),
        own(&[
            ("backgroundRepeat", "from-shorthand(var(--x))"),
            ("backgroundSize", "from-shorthand(var(--x))"),
            ("backgroundPosition", "from-shorthand(var(--x))"),
            ("backgroundOrigin", "from-shorthand(var(--x))"),
            ("backgroundClip", "from-shorthand(var(--x))"),
            ("backgroundAttachment", "from-shorthand(var(--x))"),
            ("backgroundColor", "var(--x)"),
        ])
    );
    // A whole final layer that is a `var()` is unknown paint beneath the
    // image, as before, not its color.
    assert_eq!(
        pairs("background", "url(a.png), var(--brand)"),
        own(&[
            ("backgroundRepeat", "repeat, from-shorthand(var(--brand))"),
            ("backgroundSize", "auto, from-shorthand(var(--brand))"),
            ("backgroundPosition", "0% 0%, from-shorthand(var(--brand))"),
            ("backgroundOrigin", "padding-box, from-shorthand(var(--brand))"),
            ("backgroundClip", "border-box, from-shorthand(var(--brand))"),
            ("backgroundAttachment", "scroll, from-shorthand(var(--brand))"),
        ])
    );
    // A literal color beside the `var()` is the color, whichever comes
    // first, and a fallback inside a `var()` is not one.
    assert_eq!(
        pairs("background", "url(hero.jpg) #17150f var(--tile)"),
        own(&[
            ("backgroundRepeat", "from-shorthand(#17150f var(--tile))"),
            ("backgroundSize", "from-shorthand(#17150f var(--tile))"),
            ("backgroundPosition", "from-shorthand(#17150f var(--tile))"),
            ("backgroundOrigin", "from-shorthand(#17150f var(--tile))"),
            ("backgroundClip", "from-shorthand(#17150f var(--tile))"),
            ("backgroundAttachment", "from-shorthand(#17150f var(--tile))"),
            ("backgroundColor", "#17150f"),
        ])
    );
    assert_eq!(
        pairs("background", "url(hero.jpg) var(--tile) rgba(0, 0, 0, 0.5)"),
        own(&[
            ("backgroundRepeat", "from-shorthand(var(--tile) rgba(0, 0, 0, 0.5))"),
            ("backgroundSize", "from-shorthand(var(--tile) rgba(0, 0, 0, 0.5))"),
            ("backgroundPosition", "from-shorthand(var(--tile) rgba(0, 0, 0, 0.5))"),
            ("backgroundOrigin", "from-shorthand(var(--tile) rgba(0, 0, 0, 0.5))"),
            ("backgroundClip", "from-shorthand(var(--tile) rgba(0, 0, 0, 0.5))"),
            ("backgroundAttachment", "from-shorthand(var(--tile) rgba(0, 0, 0, 0.5))"),
            ("backgroundColor", "rgba(0, 0, 0, 0.5)"),
        ])
    );
    assert_eq!(
        pairs("background", "url(hero.jpg) var(--brand, #fff)"),
        own(&[
            ("backgroundRepeat", "from-shorthand(var(--brand, #fff))"),
            ("backgroundSize", "from-shorthand(var(--brand, #fff))"),
            ("backgroundPosition", "from-shorthand(var(--brand, #fff))"),
            ("backgroundOrigin", "from-shorthand(var(--brand, #fff))"),
            ("backgroundClip", "from-shorthand(var(--brand, #fff))"),
            ("backgroundAttachment", "from-shorthand(var(--brand, #fff))"),
            ("backgroundColor", "var(--brand, #fff)"),
        ])
    );
    assert_eq!(
        pairs("background", "url(a.png) rgb(var(--r) 0 0)"),
        own(&[
            ("backgroundRepeat", "from-shorthand(rgb(var(--r) 0 0))"),
            ("backgroundSize", "from-shorthand(rgb(var(--r) 0 0))"),
            ("backgroundPosition", "from-shorthand(rgb(var(--r) 0 0))"),
            ("backgroundOrigin", "from-shorthand(rgb(var(--r) 0 0))"),
            ("backgroundClip", "from-shorthand(rgb(var(--r) 0 0))"),
            ("backgroundAttachment", "from-shorthand(rgb(var(--r) 0 0))")
        ])
    );
    // A bare `var()` in a shorthand may hold the repeat, the position, the
    // color, or more: the layer is stored whole in every slot, marked, and
    // each slot re-reads it once the compute loop resolves it.
    assert_eq!(
        pairs("background", "url(icon.png) var(--repeat)"),
        own(&[
            ("backgroundRepeat", "from-shorthand(var(--repeat))"),
            ("backgroundSize", "from-shorthand(var(--repeat))"),
            ("backgroundPosition", "from-shorthand(var(--repeat))"),
            ("backgroundOrigin", "from-shorthand(var(--repeat))"),
            ("backgroundClip", "from-shorthand(var(--repeat))"),
            ("backgroundAttachment", "from-shorthand(var(--repeat))"),
            ("backgroundColor", "var(--repeat)"),
        ])
    );
    assert_eq!(
        pairs("background", "var(--brand) url(a.png) center no-repeat"),
        own(&[
            ("backgroundRepeat", "from-shorthand(var(--brand) center no-repeat)"),
            ("backgroundSize", "from-shorthand(var(--brand) center no-repeat)"),
            ("backgroundPosition", "from-shorthand(var(--brand) center no-repeat)"),
            ("backgroundOrigin", "from-shorthand(var(--brand) center no-repeat)"),
            ("backgroundClip", "from-shorthand(var(--brand) center no-repeat)"),
            ("backgroundAttachment", "from-shorthand(var(--brand) center no-repeat)"),
        ])
    );
    // The position keeps its lengths and functions for the sampler to
    // judge; the longhand resets like the others.
    assert_eq!(
        pairs("background", "url(a.png) 0 200px / 100% 100% no-repeat"),
        own(&[
            ("backgroundRepeat", "no-repeat"),
            ("backgroundSize", "100% 100%"),
            ("backgroundPosition", "0 200px")
        ])
    );
    assert_eq!(
        pairs("background", "url(a.png) calc(50% - 10px) bottom 1rem"),
        own(&[
            ("backgroundRepeat", "repeat"),
            ("backgroundSize", "auto"),
            ("backgroundPosition", "calc(50% - 10px) bottom 1rem")
        ])
    );
    // A `var()` directly before the size slash travels with the slash and
    // the size however the value was spaced, so the re-read sees them as
    // one token.
    assert_eq!(
        pairs("background", "url(a.png) var(--pos)/100% 100% no-repeat"),
        own(&[
            ("backgroundRepeat", "from-shorthand(var(--pos)/100% 100% no-repeat)"),
            ("backgroundSize", "from-shorthand(var(--pos)/100% 100% no-repeat)"),
            ("backgroundPosition", "from-shorthand(var(--pos)/100% 100% no-repeat)"),
            ("backgroundOrigin", "from-shorthand(var(--pos)/100% 100% no-repeat)"),
            ("backgroundClip", "from-shorthand(var(--pos)/100% 100% no-repeat)"),
            ("backgroundAttachment", "from-shorthand(var(--pos)/100% 100% no-repeat)")
        ])
    );
    assert_eq!(
        pairs("background", "url(a.png) var(--pos) / cover"),
        own(&[
            ("backgroundRepeat", "from-shorthand(var(--pos)/cover)"),
            ("backgroundSize", "from-shorthand(var(--pos)/cover)"),
            ("backgroundPosition", "from-shorthand(var(--pos)/cover)"),
            ("backgroundOrigin", "from-shorthand(var(--pos)/cover)"),
            ("backgroundClip", "from-shorthand(var(--pos)/cover)"),
            ("backgroundAttachment", "from-shorthand(var(--pos)/cover)")
        ])
    );
    // What the walk reads a resolved color slot as when the `var()` held
    // geometry instead.
    use impeccable_html::cascade::shorthand::names_background_geometry;
    for geometry in [
        "no-repeat",
        "repeat-x",
        "center",
        "0 200px",
        "center/cover",
        "right top / 100% auto",
        "fixed",
        "border-box",
    ] {
        assert!(names_background_geometry(geometry), "{geometry}");
    }
    for color in ["#17150f", "rgb(0 0 0 / 50%)", "red", "url(a.png)", "", "var(--x)"] {
        assert!(!names_background_geometry(color), "{color}");
    }
    assert_eq!(
        pairs("background", "url(a.png) center /cover no-repeat"),
        own(&[
            ("backgroundRepeat", "no-repeat"),
            ("backgroundSize", "cover"),
            ("backgroundPosition", "center")
        ])
    );
    assert_eq!(
        pairs("background-position", "Center"),
        own(&[("backgroundPosition", "Center")])
    );
    assert_eq!(
        pairs("background-position", "initial"),
        own(&[("backgroundPosition", "0% 0%")])
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

#[test]
fn a_longhand_is_read_through_the_same_ungluing_as_the_shorthand() {
    use impeccable_html::cascade::shorthand::background_longhands;
    let own = |pairs: &[(&str, &str)]| -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    };
    // The css-tree generator writes `100% auto` as `100%auto` and `0% 50%`
    // as `0%50%`; each component is still read, per layer.
    assert_eq!(
        background_longhands("background-size", "100%auto"),
        own(&[("backgroundSize", "100% auto")])
    );
    assert_eq!(
        background_longhands("background-size", "100%auto, cover"),
        own(&[("backgroundSize", "100% auto, cover")])
    );
    assert_eq!(
        background_longhands("background-position", "0%50%"),
        own(&[("backgroundPosition", "0% 50%")])
    );
    assert_eq!(
        background_longhands("background-repeat", "no-repeat repeat"),
        own(&[("backgroundRepeat", "no-repeat repeat")])
    );
    assert_eq!(
        background_longhands("background-size", "var(--w)"),
        own(&[("backgroundSize", "var(--w)")])
    );
    assert_eq!(
        background_longhands("background-size", "initial"),
        own(&[("backgroundSize", "auto")])
    );
}

#[test]
fn a_box_keyword_in_the_shorthand_is_the_origin_and_the_clip() {
    use impeccable_html::cascade::shorthand::background_longhands;
    let own = |pairs: &[(&str, &str)]| -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    };
    // One box keyword in a layer sets its origin and its clip, two set the
    // origin then the clip; a layer that names none is `padding-box` /
    // `border-box` beside one that does; a shorthand with no box keyword
    // in any layer leaves both alone.
    assert_eq!(
        background_longhands("background", "url(a.png) no-repeat content-box"),
        own(&[
            ("backgroundRepeat", "no-repeat"),
            ("backgroundSize", "auto"),
            ("backgroundPosition", "0% 0%"),
            ("backgroundOrigin", "content-box"),
            ("backgroundClip", "content-box"),
        ])
    );
    assert_eq!(
        background_longhands("background", "url(a.png) border-box content-box, url(b.png)"),
        own(&[
            ("backgroundRepeat", "repeat, repeat"),
            ("backgroundSize", "auto, auto"),
            ("backgroundPosition", "0% 0%, 0% 0%"),
            ("backgroundOrigin", "border-box, padding-box"),
            ("backgroundClip", "content-box, border-box"),
        ])
    );
    // A layer holding a `var()` is stored whole in every slot, as the
    // shorthand's own, marked: once resolved, each slot re-reads the layer
    // with the shorthand grammar and takes what it names, the default when
    // it names nothing there.
    assert_eq!(
        background_longhands("background", "#111 url(icon.png) var(--pos) var(--tile)"),
        own(&[
            ("backgroundRepeat", "from-shorthand(#111 var(--pos) var(--tile))"),
            ("backgroundSize", "from-shorthand(#111 var(--pos) var(--tile))"),
            ("backgroundPosition", "from-shorthand(#111 var(--pos) var(--tile))"),
            ("backgroundOrigin", "from-shorthand(#111 var(--pos) var(--tile))"),
            ("backgroundClip", "from-shorthand(#111 var(--pos) var(--tile))"),
            ("backgroundAttachment", "from-shorthand(#111 var(--pos) var(--tile))"),
        ])
    );
    // The literal tokens beside it travel with it, in source order, so the
    // re-read sees them where they stood.
    assert_eq!(
        background_longhands("background", "#111 url(light.png) 0 var(--y) no-repeat"),
        own(&[
            ("backgroundRepeat", "from-shorthand(#111 0 var(--y) no-repeat)"),
            ("backgroundSize", "from-shorthand(#111 0 var(--y) no-repeat)"),
            ("backgroundPosition", "from-shorthand(#111 0 var(--y) no-repeat)"),
            ("backgroundOrigin", "from-shorthand(#111 0 var(--y) no-repeat)"),
            ("backgroundClip", "from-shorthand(#111 0 var(--y) no-repeat)"),
            ("backgroundAttachment", "from-shorthand(#111 0 var(--y) no-repeat)"),
        ])
    );
    assert_eq!(
        background_longhands("background", "#111 url(light.png) var(--x) no-repeat"),
        own(&[
            ("backgroundRepeat", "from-shorthand(#111 var(--x) no-repeat)"),
            ("backgroundSize", "from-shorthand(#111 var(--x) no-repeat)"),
            ("backgroundPosition", "from-shorthand(#111 var(--x) no-repeat)"),
            ("backgroundOrigin", "from-shorthand(#111 var(--x) no-repeat)"),
            ("backgroundClip", "from-shorthand(#111 var(--x) no-repeat)"),
            ("backgroundAttachment", "from-shorthand(#111 var(--x) no-repeat)"),
        ])
    );
    assert_eq!(
        background_longhands("background", "#111 url(light.png) var(--y) 0 no-repeat"),
        own(&[
            ("backgroundRepeat", "from-shorthand(#111 var(--y) 0 no-repeat)"),
            ("backgroundSize", "from-shorthand(#111 var(--y) 0 no-repeat)"),
            ("backgroundPosition", "from-shorthand(#111 var(--y) 0 no-repeat)"),
            ("backgroundOrigin", "from-shorthand(#111 var(--y) 0 no-repeat)"),
            ("backgroundClip", "from-shorthand(#111 var(--y) 0 no-repeat)"),
            ("backgroundAttachment", "from-shorthand(#111 var(--y) 0 no-repeat)"),
        ])
    );
    assert_eq!(
        background_longhands("background", "url(a.png) content-box var(--v)"),
        own(&[
            ("backgroundRepeat", "from-shorthand(content-box var(--v))"),
            ("backgroundSize", "from-shorthand(content-box var(--v))"),
            ("backgroundPosition", "from-shorthand(content-box var(--v))"),
            ("backgroundOrigin", "from-shorthand(content-box var(--v))"),
            ("backgroundClip", "from-shorthand(content-box var(--v))"),
            ("backgroundAttachment", "from-shorthand(content-box var(--v))"),
            ("backgroundColor", "var(--v)"),
        ])
    );
    assert_eq!(
        background_longhands("background", "url(a.png) no-repeat"),
        own(&[
            ("backgroundRepeat", "no-repeat"),
            ("backgroundSize", "auto"),
            ("backgroundPosition", "0% 0%"),
        ])
    );
    assert_eq!(
        background_longhands("background-origin", "content-box"),
        own(&[("backgroundOrigin", "content-box")])
    );
    assert_eq!(
        background_longhands("background-origin", "initial"),
        own(&[("backgroundOrigin", "padding-box")])
    );
}

/// A box shorthand read from a stylesheet with a negative side and an
/// unresolved `var()` expands to four sides: the var() stays whole for the
/// later resolution and the negative side keeps its sign.
#[test]
fn stylesheet_margin_shorthand_keeps_negative_and_var_sides() {
    use impeccable_html::cascade::rules::collect_static_css_rules;
    let rules = collect_static_css_rules(".a{margin:0 var(--pull) 0 -8px}.b{margin:0 -8px 0 0}");
    let mut specified: SpecifiedStore<&str> = SpecifiedStore::new();
    for (i, (node, rule)) in ["a", "b"].iter().zip(&rules).enumerate() {
        for d in &rule.declarations {
            apply_static_declaration(&mut specified, *node, &d.prop, &d.value, &meta(false, [0, 1, 0], i as i64, false));
        }
    }
    let sides = |node: &str| -> Vec<String> {
        let map = specified.get(&node).expect("node entry");
        ["marginTop", "marginRight", "marginBottom", "marginLeft"]
            .iter()
            .map(|k| map.get(*k).map(|d| d.value.clone()).unwrap_or_default())
            .collect()
    };
    assert_eq!(sides("a"), vec!["0", "var(--pull)", "0", "-8px"]);
    assert_eq!(sides("b"), vec!["0", "-8px", "0", "0"]);
}
