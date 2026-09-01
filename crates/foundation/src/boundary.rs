//! The C-ABI between the open runtime and the closed detector.
//!
//! Three exported symbols on the closed side, one host vtable on the open
//! side, and postcard bytes everywhere in between. Everything the two sides
//! agree on lives in this module (shared by both, since the closed crate
//! depends on `impeccable-foundation` too): the ABI number, the buffer type,
//! the status codes, the function ids, the host method ids.
//!
//! Why postcard: exact `f64` bits (no NaN/Infinity loss, no shortest-repr
//! round trips), `&str` fields deserialize zero-copy on the closed side, and
//! the encoding is a pure function of the serde data model, so a type that
//! round-trips through serde round-trips through the boundary.
//!
//! Why a function-id table and not a macro: the open shims
//! (`impeccable-core`) and the closed dispatcher (`impeccable-detector-ffi`)
//! are written by hand, one line per function, and a test on each side
//! compares its table against the other's (`det_call(fn_id::TABLE, ..)`
//! returns the closed table) so the two cannot drift silently.
//!
//! ```text
//! open (impeccable-core)                      closed (impeccable-detector-ffi)
//! ──────────────────────                      ─────────────────────────────────
//! shim: encode args ─── det_call(id, args, host, ctx, &mut out) ──▶ decode, run rule
//!       decode out  ◀── status, out ──────────────────────────────── encode result
//!                                                   │ (only for &dyn Dom / &dyn StyleMap args)
//!       HostVTable.call(ctx, method, args, &mut out) ◀┘
//!       dispatch on `method` to the real &dyn Dom
//! ```

use core::ffi::c_void;

/// Bumped whenever a function id, a host method id, or the serialized shape
/// of any type crossing the boundary changes. The shim checks
/// `det_abi_version()` against this once, before the first call, and panics
/// with a clear message when the prebuilt detector was built for another ABI.
pub const ABI: u32 = 1;

/// An owned byte buffer handed across the boundary. Whoever receives a `Buf`
/// owns it and must free it through the other side's `free` (the closed
/// side's `det_free`, the host vtable's `free`). Both sides link one std and
/// one allocator today, so a cross-side free would work by accident; the
/// discipline exists so the mechanism could become a real dylib later.
#[repr(C)]
#[derive(Debug)]
pub struct Buf {
    pub ptr: *mut u8,
    pub len: usize,
    pub cap: usize,
}

impl Buf {
    pub const EMPTY: Buf = Buf { ptr: core::ptr::null_mut(), len: 0, cap: 0 };

    /// Take ownership of a `Vec` and expose it as raw parts.
    pub fn from_vec(v: Vec<u8>) -> Buf {
        let mut v = core::mem::ManuallyDrop::new(v);
        Buf { ptr: v.as_mut_ptr(), len: v.len(), cap: v.capacity() }
    }

    /// Reassemble the `Vec` this `Buf` was made from.
    ///
    /// # Safety
    /// `self` must have come from [`Buf::from_vec`] on this side of the
    /// boundary (or be `EMPTY`) and must not be used again afterwards.
    pub unsafe fn into_vec(self) -> Vec<u8> {
        if self.ptr.is_null() {
            return Vec::new();
        }
        Vec::from_raw_parts(self.ptr, self.len, self.cap)
    }

    /// Borrow the bytes without taking ownership.
    ///
    /// # Safety
    /// `ptr` must point at `len` readable bytes for the lifetime of the
    /// returned slice.
    pub unsafe fn as_slice<'a>(&self) -> &'a [u8] {
        if self.ptr.is_null() {
            &[]
        } else {
            core::slice::from_raw_parts(self.ptr, self.len)
        }
    }
}

/// How the closed side calls back into the open side. `ctx` is opaque to the
/// closed side: it points at whatever the shim keeps the real `&dyn Dom`
/// (and, for the style-map functions, the real `&dyn StyleMap`) in for the
/// duration of one `det_call`.
#[repr(C)]
pub struct HostVTable {
    /// Run host method `method` with postcard-encoded `args`; on `status::OK`
    /// the encoded result is in `out` (owned by the caller, freed via `free`).
    pub call: unsafe extern "C" fn(
        ctx: *const c_void,
        method: u32,
        args: *const u8,
        args_len: usize,
        out: *mut Buf,
    ) -> i32,
    /// Free a `Buf` the host produced.
    pub free: unsafe extern "C" fn(buf: Buf),
}

/// Status codes returned by `det_call` and `HostVTable::call`. Anything but
/// `OK` carries a UTF-8 message in `out` (possibly empty).
pub mod status {
    pub const OK: i32 = 0;
    /// The callee panicked; `out` holds the panic message.
    pub const PANIC: i32 = 1;
    /// The callee could not decode `args`: the two sides disagree on a type.
    pub const DECODE: i32 = 2;
    /// No function / method with that id.
    pub const UNKNOWN: i32 = 3;
}

/// The closed detector's exported symbols, as the shim declares them.
///
/// ```ignore
/// extern "C" {
///     fn det_abi_version() -> u32;
///     fn det_call(id: u32, args: *const u8, args_len: usize,
///                 host: *const HostVTable, ctx: *const c_void, out: *mut Buf) -> i32;
///     fn det_free(buf: Buf);
/// }
/// ```
pub mod symbols {
    pub const ABI_VERSION: &str = "det_abi_version";
    pub const CALL: &str = "det_call";
    pub const FREE: &str = "det_free";
}

/// Ids of the closed functions the open crates call. Grouped by the module
/// they come from (`0x01..` rules, `0x02..` measures, ...). Never renumber an
/// existing id; append. A renumber is an ABI bump.
pub mod fn_id {
    /// Returns the closed side's `(id, name)` table, postcard-encoded as
    /// `Vec<(u32, String)>`, so the shim's test can diff it against
    /// [`TABLE`].
    pub const TABLE: u32 = 0;
    /// `vectors::call(module, name, args_json) -> result_json` for the frozen
    /// call vectors: args are `(String, String, String)`, result a `String`.
    pub const VECTORS_CALL: u32 = 1;
    /// `KNOWN_FUNCTIONS` of the closed side: `Vec<(String, Vec<String>)>`.
    pub const VECTORS_KNOWN: u32 = 2;

    // checks::rules
    pub const RULES_CHECK_BORDERS: u32 = 0x0101;
    pub const RULES_CHECK_COLORS: u32 = 0x0102;
    pub const RULES_CHECK_HOVER_CONTRAST: u32 = 0x0103;
    pub const RULES_CHECK_ICON_TILE: u32 = 0x0104;
    pub const RULES_CHECK_ITALIC_SERIF: u32 = 0x0105;
    pub const RULES_CHECK_HERO_EYEBROW: u32 = 0x0106;
    pub const RULES_CHECK_KICKER_ABOVE_HEADING: u32 = 0x0107;
    pub const RULES_CHECK_MOTION: u32 = 0x0108;
    pub const RULES_CHECK_GLOW: u32 = 0x0109;
    pub const RULES_IS_CARD_LIKE_FROM_PROPS: u32 = 0x010a;
    pub const RULES_RESOLVE_HERO_HEADING_SIZE_PX: u32 = 0x010b;
    pub const RULES_IS_ACCENT_COLOR: u32 = 0x010c;
    pub const RULES_RESOLVE_SERIF: u32 = 0x010d;

    // checks::measures
    pub const MEASURES_CHECK_RADIAL_SPOTLIGHT: u32 = 0x0201;
    pub const MEASURES_CHECK_OVERSIZED_H1: u32 = 0x0202;
    pub const MEASURES_CHECK_GPT_THIN_BORDER_WIDE_SHADOW: u32 = 0x0203;
    pub const MEASURES_CHECK_CONTENT_HIDDEN_AT_REST: u32 = 0x0204;
    pub const MEASURES_IS_CREAM_COLOR: u32 = 0x0205;
    pub const MEASURES_CREAM_FROM_CLASS_LIST: u32 = 0x0206;
    pub const MEASURES_POSITIONED_STYLE_IMPLIES_ESCAPE: u32 = 0x0207;
    pub const MEASURES_IS_OPAQUE_DECORATED_BOX: u32 = 0x0208;

    // checks::text_rules
    pub const TEXT_IS_KICKER_CANDIDATE: u32 = 0x0301;
    pub const TEXT_IS_NUMBERED_SECTION_LABEL_CANDIDATE: u32 = 0x0302;
    pub const TEXT_CHECK_NUMBERED_SECTION_LABELS: u32 = 0x0303;
    pub const TEXT_CHECK_EM_DASH_OVERUSE: u32 = 0x0304;
    pub const TEXT_IS_REPEATED_TEXT_CONTAINER: u32 = 0x0305;

    // checks::css_scan
    pub const CSS_TEXT_HAS_DARK_ROOT_BG: u32 = 0x0401;
    pub const CSS_SCAN_GLOW: u32 = 0x0402;
    pub const CSS_SCAN_GRID_BACKGROUND: u32 = 0x0403;
    pub const CSS_SCAN_RADIAL_HALO: u32 = 0x0404;
    pub const CSS_SCAN_PSEUDO_STRIPE: u32 = 0x0405;
    pub const CSS_SCAN_INSET_STRIPE: u32 = 0x0406;
    pub const CSS_SCAN_ORGANIC_CLIP_PATH: u32 = 0x0407;
    pub const CSS_SCAN_BURIED_RASTER: u32 = 0x0408;
    pub const CSS_SCAN_MARQUEE: u32 = 0x0409;
    pub const CSS_SCAN_PULSING_DOT: u32 = 0x040a;
    pub const CSS_IS_ROUND_DOT_RADIUS: u32 = 0x040b;

    // checks::html_patterns
    pub const HTML_SCAN_SHAPE_ASSEMBLED_ILLUSTRATION: u32 = 0x0501;
    pub const HTML_BUILD_PATTERN_CORPORA: u32 = 0x0502;
    pub const HTML_CHECK_PATTERNS: u32 = 0x0503;

    // browser::driver (dom-taking)
    pub const DRIVER_COLLECT_BROWSER_FINDINGS: u32 = 0x0601;
    pub const DRIVER_SERIALIZE_FINDINGS: u32 = 0x0602;
    pub const DRIVER_SCOPED_IGNORE_ACTIVE: u32 = 0x0603;

    // browser::page_checks / element_checks (dom-taking)
    pub const PAGE_MEASURE_HIDDEN_TEXT_DOM: u32 = 0x0701;
    pub const ELEMENT_IS_RENDERED_FOR_BROWSER_RULE: u32 = 0x0702;

    // browser::visual (pure)
    pub const VISUAL_RASTER_PLAN: u32 = 0x0801;
    pub const VISUAL_RASTER_PIXEL: u32 = 0x0802;
    pub const VISUAL_PIXEL_SAMPLE: u32 = 0x0803;
    pub const VISUAL_RASTER_ERROR_REASON: u32 = 0x0804;
    pub const VISUAL_RASTER_FAILURE_SAMPLE: u32 = 0x0805;
    pub const VISUAL_RASTER_NO_CONTEXT_SAMPLE: u32 = 0x0806;
    pub const VISUAL_IMG_LOADED_SOURCE_POINT: u32 = 0x0807;
    pub const VISUAL_IMG_FINISH: u32 = 0x0808;
    pub const VISUAL_CSS_URL_NO_IMAGE: u32 = 0x0809;
    pub const VISUAL_CSS_URL_FINISH: u32 = 0x080a;
    pub const VISUAL_SAMPLE_IS_OPAQUE: u32 = 0x080b;
    pub const VISUAL_ALPHA_COMPOSITE: u32 = 0x080c;
    pub const VISUAL_UNRESOLVED_FROM_REASONS: u32 = 0x080d;
    pub const VISUAL_FINISH_ANALYSIS: u32 = 0x080e;
    pub const VISUAL_NEEDS_SCROLL_RETRY: u32 = 0x080f;
    // browser::visual (dom-taking)
    pub const VISUAL_COLLECT_CONTRAST_CANDIDATES: u32 = 0x0820;
    pub const VISUAL_COLLECT_CONTRAST_REASONS: u32 = 0x0821;
    pub const VISUAL_STACK_NODES: u32 = 0x0822;
    pub const VISUAL_IMG_SOURCE_POINT: u32 = 0x0823;
    pub const VISUAL_RASTER_SOURCE_POINT: u32 = 0x0824;
    pub const VISUAL_RASTER_FINISH: u32 = 0x0825;
    pub const VISUAL_CSS_PLAN: u32 = 0x0826;
    pub const VISUAL_CSS_URL_SOURCE_POINT: u32 = 0x0827;
    pub const VISUAL_PREPARE_ANALYSIS: u32 = 0x0828;

    /// Every id with its name, in id order. Both sides keep this table; the
    /// shim's test asserts the closed side's copy is identical.
    pub const TABLE_ENTRIES: &[(u32, &str)] = &[
        (RULES_CHECK_BORDERS, "rules::check_borders"),
        (RULES_CHECK_COLORS, "rules::check_colors"),
        (RULES_CHECK_HOVER_CONTRAST, "rules::check_hover_contrast"),
        (RULES_CHECK_ICON_TILE, "rules::check_icon_tile"),
        (RULES_CHECK_ITALIC_SERIF, "rules::check_italic_serif"),
        (RULES_CHECK_HERO_EYEBROW, "rules::check_hero_eyebrow"),
        (RULES_CHECK_KICKER_ABOVE_HEADING, "rules::check_kicker_above_heading"),
        (RULES_CHECK_MOTION, "rules::check_motion"),
        (RULES_CHECK_GLOW, "rules::check_glow"),
        (RULES_IS_CARD_LIKE_FROM_PROPS, "rules::is_card_like_from_props"),
        (RULES_RESOLVE_HERO_HEADING_SIZE_PX, "rules::resolve_hero_heading_size_px"),
        (RULES_IS_ACCENT_COLOR, "rules::is_accent_color"),
        (RULES_RESOLVE_SERIF, "rules::resolve_serif"),
        (MEASURES_CHECK_RADIAL_SPOTLIGHT, "measures::check_radial_spotlight"),
        (MEASURES_CHECK_OVERSIZED_H1, "measures::check_oversized_h1"),
        (MEASURES_CHECK_GPT_THIN_BORDER_WIDE_SHADOW, "measures::check_gpt_thin_border_wide_shadow"),
        (MEASURES_CHECK_CONTENT_HIDDEN_AT_REST, "measures::check_content_hidden_at_rest"),
        (MEASURES_IS_CREAM_COLOR, "measures::is_cream_color"),
        (MEASURES_CREAM_FROM_CLASS_LIST, "measures::cream_from_class_list"),
        (MEASURES_POSITIONED_STYLE_IMPLIES_ESCAPE, "measures::positioned_style_implies_escape"),
        (MEASURES_IS_OPAQUE_DECORATED_BOX, "measures::is_opaque_decorated_box"),
        (TEXT_IS_KICKER_CANDIDATE, "text_rules::is_kicker_candidate"),
        (TEXT_IS_NUMBERED_SECTION_LABEL_CANDIDATE, "text_rules::is_numbered_section_label_candidate"),
        (TEXT_CHECK_NUMBERED_SECTION_LABELS, "text_rules::check_numbered_section_labels"),
        (TEXT_CHECK_EM_DASH_OVERUSE, "text_rules::check_em_dash_overuse"),
        (TEXT_IS_REPEATED_TEXT_CONTAINER, "text_rules::is_repeated_text_container"),
        (CSS_TEXT_HAS_DARK_ROOT_BG, "css_scan::css_text_has_dark_root_bg"),
        (CSS_SCAN_GLOW, "css_scan::scan_css_text_for_glow"),
        (CSS_SCAN_GRID_BACKGROUND, "css_scan::scan_css_text_for_grid_background"),
        (CSS_SCAN_RADIAL_HALO, "css_scan::scan_css_text_for_radial_halo"),
        (CSS_SCAN_PSEUDO_STRIPE, "css_scan::scan_css_text_for_pseudo_stripe"),
        (CSS_SCAN_INSET_STRIPE, "css_scan::scan_css_text_for_inset_stripe"),
        (CSS_SCAN_ORGANIC_CLIP_PATH, "css_scan::scan_css_text_for_organic_clip_path"),
        (CSS_SCAN_BURIED_RASTER, "css_scan::scan_css_text_for_buried_raster"),
        (CSS_SCAN_MARQUEE, "css_scan::scan_css_text_for_marquee"),
        (CSS_SCAN_PULSING_DOT, "css_scan::scan_css_text_for_pulsing_dot"),
        (CSS_IS_ROUND_DOT_RADIUS, "css_scan::is_round_dot_radius"),
        (HTML_SCAN_SHAPE_ASSEMBLED_ILLUSTRATION, "html_patterns::scan_html_for_shape_assembled_illustration"),
        (HTML_BUILD_PATTERN_CORPORA, "html_patterns::build_html_pattern_corpora"),
        (HTML_CHECK_PATTERNS, "html_patterns::check_html_patterns"),
        (DRIVER_COLLECT_BROWSER_FINDINGS, "driver::collect_browser_findings"),
        (DRIVER_SERIALIZE_FINDINGS, "driver::serialize_findings"),
        (DRIVER_SCOPED_IGNORE_ACTIVE, "driver::scoped_ignore_active"),
        (PAGE_MEASURE_HIDDEN_TEXT_DOM, "page_checks::measure_hidden_text_dom"),
        (ELEMENT_IS_RENDERED_FOR_BROWSER_RULE, "element_checks::is_rendered_for_browser_rule"),
        (VISUAL_RASTER_PLAN, "visual::raster_plan"),
        (VISUAL_RASTER_PIXEL, "visual::raster_pixel"),
        (VISUAL_PIXEL_SAMPLE, "visual::pixel_sample"),
        (VISUAL_RASTER_ERROR_REASON, "visual::raster_error_reason"),
        (VISUAL_RASTER_FAILURE_SAMPLE, "visual::raster_failure_sample"),
        (VISUAL_RASTER_NO_CONTEXT_SAMPLE, "visual::raster_no_context_sample"),
        (VISUAL_IMG_LOADED_SOURCE_POINT, "visual::img_loaded_source_point"),
        (VISUAL_IMG_FINISH, "visual::img_finish"),
        (VISUAL_CSS_URL_NO_IMAGE, "visual::css_url_no_image"),
        (VISUAL_CSS_URL_FINISH, "visual::css_url_finish"),
        (VISUAL_SAMPLE_IS_OPAQUE, "visual::sample_is_opaque"),
        (VISUAL_ALPHA_COMPOSITE, "visual::alpha_composite"),
        (VISUAL_UNRESOLVED_FROM_REASONS, "visual::unresolved_from_reasons"),
        (VISUAL_FINISH_ANALYSIS, "visual::finish_analysis"),
        (VISUAL_NEEDS_SCROLL_RETRY, "visual::needs_scroll_retry"),
        (VISUAL_COLLECT_CONTRAST_CANDIDATES, "visual::collect_visual_contrast_candidates"),
        (VISUAL_COLLECT_CONTRAST_REASONS, "visual::collect_visual_contrast_reasons"),
        (VISUAL_STACK_NODES, "visual::stack_nodes"),
        (VISUAL_IMG_SOURCE_POINT, "visual::img_source_point"),
        (VISUAL_RASTER_SOURCE_POINT, "visual::raster_source_point"),
        (VISUAL_RASTER_FINISH, "visual::raster_finish"),
        (VISUAL_CSS_PLAN, "visual::css_plan"),
        (VISUAL_CSS_URL_SOURCE_POINT, "visual::css_url_source_point"),
        (VISUAL_PREPARE_ANALYSIS, "visual::prepare_analysis"),
    ];
}

/// Ids of the host methods the closed side calls through
/// [`HostVTable::call`]. `1..=43` are the `Dom` trait methods in declaration
/// order; `100..` are the one-method traits.
pub mod host_method {
    pub const DOM_DOCUMENT_ELEMENT: u32 = 1;
    pub const DOM_BODY: u32 = 2;
    pub const DOM_QUERY_ALL: u32 = 3;
    pub const DOM_QUERY_ONE: u32 = 4;
    pub const DOM_INNER_WIDTH: u32 = 5;
    pub const DOM_INNER_HEIGHT: u32 = 6;
    pub const DOM_SCROLL_X: u32 = 7;
    pub const DOM_SCROLL_Y: u32 = 8;
    pub const DOM_HOSTNAME: u32 = 9;
    pub const DOM_ELEMENT_FROM_POINT: u32 = 10;
    pub const DOM_ELEMENTS_FROM_POINT: u32 = 11;
    pub const DOM_CSS_ESCAPE: u32 = 12;
    pub const DOM_KEYFRAMES: u32 = 13;
    pub const DOM_DOCUMENT_HTML_FOR_PATTERNS: u32 = 14;
    pub const DOM_TAG_NAME: u32 = 15;
    pub const DOM_NAMESPACE_URI: u32 = 16;
    pub const DOM_PARENT: u32 = 17;
    pub const DOM_CHILDREN: u32 = 18;
    pub const DOM_PREVIOUS_ELEMENT_SIBLING: u32 = 19;
    pub const DOM_NEXT_ELEMENT_SIBLING: u32 = 20;
    pub const DOM_CONTAINS: u32 = 21;
    pub const DOM_MATCHES: u32 = 22;
    pub const DOM_CLOSEST: u32 = 23;
    pub const DOM_ATTR: u32 = 24;
    pub const DOM_ID_PROP: u32 = 25;
    pub const DOM_CLASS_NAME_PROP: u32 = 26;
    pub const DOM_TEXT_CONTENT: u32 = 27;
    pub const DOM_INNER_TEXT: u32 = 28;
    pub const DOM_DIRECT_TEXT_NODES: u32 = 29;
    pub const DOM_IS_CONTENT_EDITABLE: u32 = 30;
    pub const DOM_HIDDEN_PROP: u32 = 31;
    pub const DOM_STYLE: u32 = 32;
    pub const DOM_PSEUDO_STYLE: u32 = 33;
    pub const DOM_RECT: u32 = 34;
    pub const DOM_CLIENT_WIDTH: u32 = 35;
    pub const DOM_CLIENT_HEIGHT: u32 = 36;
    pub const DOM_CLIENT_LEFT: u32 = 37;
    pub const DOM_SCROLL_WIDTH: u32 = 38;
    pub const DOM_SCROLL_LEFT: u32 = 39;
    pub const DOM_OFFSET_WIDTH: u32 = 40;
    pub const DOM_OFFSET_HEIGHT: u32 = 41;
    pub const DOM_CHECK_VISIBILITY: u32 = 42;
    pub const DOM_DIRECT_TEXT_RECT: u32 = 43;

    /// `StyleMap::prop(name) -> Option<String>`.
    pub const STYLE_MAP_PROP: u32 = 100;
    /// `CustomProps::get(name) -> Option<String>`.
    pub const CUSTOM_PROPS_GET: u32 = 101;
}

/// A JSON document carried as text across the boundary.
///
/// Postcard is a pure function of the serde data model, which
/// `serde_json::Value` sits outside of: its `Deserialize` needs
/// `deserialize_any`, and postcard is not self-describing. Anything holding a
/// `Value` therefore crosses as JSON text in a `JsonBlob` instead, with the
/// rest of the payload staying in postcard so its `f64`s keep their exact
/// bits. (A `Value` can never hold a NaN or an infinity, so the JSON round
/// trip is lossless; `serde_json`'s `float_roundtrip` feature keeps the
/// finite ones exact.)
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct JsonBlob(pub String);

impl JsonBlob {
    /// Wrap a value's JSON form.
    pub fn of<T: serde::Serialize + ?Sized>(value: &T) -> JsonBlob {
        JsonBlob(serde_json::to_string(value).expect("boundary JsonBlob: value serializes to JSON"))
    }

    /// Read the blob back.
    pub fn parse<T: serde::de::DeserializeOwned>(&self) -> T {
        serde_json::from_str(&self.0).expect("boundary JsonBlob: blob parses back")
    }
}

/// The boundary form of [`crate::browser::visual::CssPlan`]: the `Value` half
/// as JSON text, everything else in postcard.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum CssPlanWire {
    Sample(JsonBlob),
    Url {
        url: String,
        size: String,
        position: String,
    },
}

impl From<crate::browser::visual::CssPlan> for CssPlanWire {
    fn from(p: crate::browser::visual::CssPlan) -> CssPlanWire {
        use crate::browser::visual::CssPlan;
        match p {
            CssPlan::Sample { sample } => CssPlanWire::Sample(JsonBlob::of(&sample)),
            CssPlan::Url {
                url,
                size,
                position,
            } => CssPlanWire::Url {
                url,
                size,
                position,
            },
        }
    }
}

impl From<CssPlanWire> for crate::browser::visual::CssPlan {
    fn from(w: CssPlanWire) -> crate::browser::visual::CssPlan {
        use crate::browser::visual::CssPlan;
        match w {
            CssPlanWire::Sample(b) => CssPlan::Sample { sample: b.parse() },
            CssPlanWire::Url {
                url,
                size,
                position,
            } => CssPlan::Url {
                url,
                size,
                position,
            },
        }
    }
}

/// The boundary form of [`crate::browser::visual::Prepared`]. The real type is
/// `#[serde(untagged)]`, which needs `deserialize_any`; this one is a plain
/// tagged enum whose `Value`s travel as JSON and whose `Rgba` keeps its exact
/// `f64` bits.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum PreparedWire {
    Early(JsonBlob),
    Ready {
        el: crate::browser::dom::ElId,
        points: Vec<JsonBlob>,
        text_color: crate::color::Rgba,
    },
}

impl From<crate::browser::visual::Prepared> for PreparedWire {
    fn from(p: crate::browser::visual::Prepared) -> PreparedWire {
        use crate::browser::visual::Prepared;
        match p {
            Prepared::Early { early } => PreparedWire::Early(JsonBlob::of(&early)),
            Prepared::Ready {
                el,
                points,
                text_color,
            } => PreparedWire::Ready {
                el,
                points: points.iter().map(JsonBlob::of).collect(),
                text_color,
            },
        }
    }
}

impl From<PreparedWire> for crate::browser::visual::Prepared {
    fn from(w: PreparedWire) -> crate::browser::visual::Prepared {
        use crate::browser::visual::Prepared;
        match w {
            PreparedWire::Early(b) => Prepared::Early { early: b.parse() },
            PreparedWire::Ready {
                el,
                points,
                text_color,
            } => Prepared::Ready {
                el,
                points: points.iter().map(|b| b.parse()).collect(),
                text_color,
            },
        }
    }
}

/// Encode a value for the boundary.
pub fn encode<T: serde::Serialize + ?Sized>(value: &T) -> Vec<u8> {
    postcard::to_allocvec(value).expect("boundary encode: every crossing type serializes")
}

/// Decode a value from the boundary. Borrowing types (`&'a str` fields with
/// `#[serde(borrow)]`) borrow from `bytes`.
pub fn decode<'a, T: serde::Deserialize<'a>>(bytes: &'a [u8]) -> Result<T, postcard::Error> {
    postcard::from_bytes(bytes)
}
