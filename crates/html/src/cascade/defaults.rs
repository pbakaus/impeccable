//! The static cascade's tables: which properties inherit, the default
//! computed style, the CSS-name to camelCase map, and the extra named colors.
//!
//! JS: css-cascade.mjs#STATIC_INHERITED_PROPS, #STATIC_DEFAULT_STYLE,
//! #STATIC_PROP_MAP, #STATIC_NAMED_COLORS, #NAMED_COLORS, #BORDER_SHORTHAND_RE

use impeccable_core::color::Rgba;
use once_cell::sync::Lazy;
use regex::Regex;

/// JS: css-cascade.mjs#BORDER_SHORTHAND_RE
/// `/^(\d+(?:\.\d+)?)px\s+(solid|dashed|dotted|double|groove|ridge|inset|outset)\s+(.+)$/i`
pub static BORDER_SHORTHAND_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(&format!(
        r"(?is)^([0-9]+(?:\.[0-9]+)?)px{ws}+(solid|dashed|dotted|double|groove|ridge|inset|outset){ws}+(.+)$",
        ws = impeccable_core::js::WS
    ))
    .expect("BORDER_SHORTHAND_RE")
});

/// JS: css-cascade.mjs#NAMED_COLORS (the small table `normalizeColorForCheck`
/// resolves; not the shared CSS_NAMED_COLORS).
pub const NAMED_COLORS: &[(&str, [u32; 3])] = &[
    ("white", [255, 255, 255]),
    ("black", [0, 0, 0]),
    ("gray", [128, 128, 128]),
    ("grey", [128, 128, 128]),
    ("silver", [192, 192, 192]),
    ("red", [255, 0, 0]),
    ("green", [0, 128, 0]),
    ("blue", [0, 0, 255]),
    ("yellow", [255, 255, 0]),
];

/// JS: css-cascade.mjs#STATIC_INHERITED_PROPS
pub const STATIC_INHERITED_PROPS: &[&str] = &[
    "color",
    "fontFamily",
    "fontSize",
    "fontStyle",
    "fontWeight",
    "fontVariant",
    "lineHeight",
    "letterSpacing",
    "textTransform",
    "textAlign",
    "hyphens",
    "webkitHyphens",
    // visibility inherits in real CSS, and the invisible-at-rest contrast skip
    // relies on descendants of a hidden container computing as hidden. A child
    // that declares `visibility: visible` still overrides the inherited value.
    "visibility",
];

/// JS `STATIC_INHERITED_PROPS.has(prop)`.
pub fn is_static_inherited_prop(prop: &str) -> bool {
    STATIC_INHERITED_PROPS.contains(&prop)
}

/// JS: css-cascade.mjs#STATIC_DEFAULT_STYLE, in the JS object's key order
/// (the computed-style model iterates this order).
pub const STATIC_DEFAULT_STYLE: &[(&str, &str)] = &[
    ("color", "rgb(0, 0, 0)"),
    ("backgroundColor", "rgba(0, 0, 0, 0)"),
    ("backgroundImage", "none"),
    ("borderTopWidth", "0px"),
    ("borderRightWidth", "0px"),
    ("borderBottomWidth", "0px"),
    ("borderLeftWidth", "0px"),
    ("borderTopColor", "rgb(0, 0, 0)"),
    ("borderRightColor", "rgb(0, 0, 0)"),
    ("borderBottomColor", "rgb(0, 0, 0)"),
    ("borderLeftColor", "rgb(0, 0, 0)"),
    ("borderRadius", "0px"),
    ("outlineWidth", "0px"),
    ("outlineColor", "rgb(0, 0, 0)"),
    ("outlineStyle", "none"),
    ("boxShadow", "none"),
    // NOT in STATIC_INHERITED_PROPS even though text-shadow inherits in real
    // CSS: the glow check only needs to fire once, on the element that
    // declares the shadow, not on every descendant.
    ("textShadow", "none"),
    ("fontFamily", ""),
    ("fontSize", "16px"),
    ("fontStyle", "normal"),
    ("fontVariant", "normal"),
    ("fontWeight", "400"),
    ("lineHeight", "normal"),
    ("letterSpacing", "normal"),
    ("textTransform", "none"),
    ("textAlign", "start"),
    ("hyphens", "manual"),
    ("webkitHyphens", "manual"),
    ("transitionProperty", ""),
    ("transitionTimingFunction", ""),
    ("animationName", ""),
    ("animationTimingFunction", ""),
    ("webkitBackgroundClip", ""),
    ("backgroundClip", ""),
    ("width", ""),
    ("height", ""),
    ("paddingTop", "0px"),
    ("paddingRight", "0px"),
    ("paddingBottom", "0px"),
    ("paddingLeft", "0px"),
    ("marginTop", "0px"),
    ("marginRight", "0px"),
    ("marginBottom", "0px"),
    ("marginLeft", "0px"),
    ("position", "static"),
    ("visibility", "visible"),
    ("contentVisibility", "visible"),
    ("opacity", "1"),
    ("top", "auto"),
    ("right", "auto"),
    ("bottom", "auto"),
    ("left", "auto"),
    ("inset", ""),
    ("display", ""),
    ("overflow", "visible"),
    ("overflowX", "visible"),
    ("overflowY", "visible"),
];

/// JS `STATIC_DEFAULT_STYLE[prop]`; `None` when the key is absent (the JS
/// `!= null` test). Note an empty-string default is `Some("")`.
pub fn static_default_style(prop: &str) -> Option<&'static str> {
    STATIC_DEFAULT_STYLE
        .iter()
        .find(|(k, _)| *k == prop)
        .map(|(_, v)| *v)
}

/// JS: css-cascade.mjs#STATIC_PROP_MAP
pub const STATIC_PROP_MAP: &[(&str, &str)] = &[
    ("background-color", "backgroundColor"),
    ("background-image", "backgroundImage"),
    ("background-clip", "backgroundClip"),
    ("-webkit-background-clip", "webkitBackgroundClip"),
    ("border-radius", "borderRadius"),
    ("border-top-width", "borderTopWidth"),
    ("border-right-width", "borderRightWidth"),
    ("border-bottom-width", "borderBottomWidth"),
    ("border-left-width", "borderLeftWidth"),
    ("border-top-color", "borderTopColor"),
    ("border-right-color", "borderRightColor"),
    ("border-bottom-color", "borderBottomColor"),
    ("border-left-color", "borderLeftColor"),
    ("outline-width", "outlineWidth"),
    ("outline-color", "outlineColor"),
    ("outline-style", "outlineStyle"),
    ("box-shadow", "boxShadow"),
    ("text-shadow", "textShadow"),
    ("font-family", "fontFamily"),
    ("font-size", "fontSize"),
    ("font-style", "fontStyle"),
    ("font-weight", "fontWeight"),
    ("line-height", "lineHeight"),
    ("letter-spacing", "letterSpacing"),
    ("text-transform", "textTransform"),
    ("text-align", "textAlign"),
    ("hyphens", "hyphens"),
    ("-webkit-hyphens", "webkitHyphens"),
    ("transition-property", "transitionProperty"),
    ("transition-timing-function", "transitionTimingFunction"),
    ("animation-name", "animationName"),
    ("animation-timing-function", "animationTimingFunction"),
    ("width", "width"),
    ("height", "height"),
    ("padding-top", "paddingTop"),
    ("padding-right", "paddingRight"),
    ("padding-bottom", "paddingBottom"),
    ("padding-left", "paddingLeft"),
    ("margin-top", "marginTop"),
    ("margin-right", "marginRight"),
    ("margin-bottom", "marginBottom"),
    ("margin-left", "marginLeft"),
    ("position", "position"),
    ("visibility", "visibility"),
    ("opacity", "opacity"),
    ("top", "top"),
    ("right", "right"),
    ("bottom", "bottom"),
    ("left", "left"),
    ("inset", "inset"),
    ("display", "display"),
    ("overflow", "overflow"),
    ("overflow-x", "overflowX"),
    ("overflow-y", "overflowY"),
];

/// JS `STATIC_PROP_MAP[prop]`.
pub fn static_prop_map(prop: &str) -> Option<&'static str> {
    STATIC_PROP_MAP
        .iter()
        .find(|(k, _)| *k == prop)
        .map(|(_, v)| *v)
}

/// JS: css-cascade.mjs#STATIC_NAMED_COLORS. parseStaticColor tries
/// parseAnyColor first, which already resolves every name in the shared
/// CSS_NAMED_COLORS table. This fallback only carries the keywords
/// parseAnyColor deliberately returns null for: the cascade needs
/// `transparent` to read as an actual zero-alpha color.
pub const STATIC_NAMED_COLORS: &[(&str, Rgba)] = &[("transparent", Rgba::new(0.0, 0.0, 0.0, 0.0))];

/// JS `STATIC_NAMED_COLORS[name]`.
pub fn static_named_color(name: &str) -> Option<Rgba> {
    STATIC_NAMED_COLORS
        .iter()
        .find(|(k, _)| *k == name)
        .map(|(_, c)| *c)
}
