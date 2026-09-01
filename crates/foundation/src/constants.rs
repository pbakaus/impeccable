//! Port of `cli/engine/shared/constants.mjs`. Sets keep the JS insertion
//! order as slices so anything that iterates them matches.

/// JS `SAFE_TAGS`.
pub const SAFE_TAGS: &[&str] = &[
    "blockquote",
    "nav",
    "a",
    "input",
    "textarea",
    "select",
    "pre",
    "code",
    "span",
    "th",
    "td",
    "tr",
    "li",
    "label",
    "button",
    "hr",
    "html",
    "head",
    "body",
    "script",
    "style",
    "link",
    "meta",
    "title",
    "br",
    "img",
    "svg",
    "path",
    "circle",
    "rect",
    "line",
    "polyline",
    "polygon",
    "g",
    "defs",
    "use",
];

/// JS `BORDER_SAFE_TAGS`: `SAFE_TAGS` without `label` (card-shaped clickable
/// labels are a canonical side-tab shape and must stay detectable).
pub const BORDER_SAFE_TAGS: &[&str] = &[
    "blockquote",
    "nav",
    "a",
    "input",
    "textarea",
    "select",
    "pre",
    "code",
    "span",
    "th",
    "td",
    "tr",
    "li",
    "button",
    "hr",
    "html",
    "head",
    "body",
    "script",
    "style",
    "link",
    "meta",
    "title",
    "br",
    "img",
    "svg",
    "path",
    "circle",
    "rect",
    "line",
    "polyline",
    "polygon",
    "g",
    "defs",
    "use",
];

/// JS `OVERUSED_FONTS`.
pub const OVERUSED_FONTS: &[&str] = &[
    // Older monoculture (still ubiquitous):
    "inter",
    "roboto",
    "open sans",
    "lato",
    "montserrat",
    "arial",
    "helvetica",
    // Newer monoculture (the Anthropic-skill / Vercel / GitHub default wave):
    "fraunces",
    "instrument sans",
    "instrument serif",
    "geist",
    "geist sans",
    "geist mono",
    "mona sans",
    "plus jakarta sans",
    "space grotesk",
    "recoleta",
];

/// JS `GOOGLE_DOMAINS`.
pub const GOOGLE_DOMAINS: &[&str] = &[
    "google.com",
    "youtube.com",
    "android.com",
    "chromium.org",
    "chrome.com",
    "web.dev",
    "gstatic.com",
    "firebase.google.com",
];
/// JS `VERCEL_DOMAINS`.
pub const VERCEL_DOMAINS: &[&str] = &["vercel.com", "nextjs.org", "v0.app"];
/// JS `GITHUB_DOMAINS`.
pub const GITHUB_DOMAINS: &[&str] = &["github.com", "githubnext.com"];

/// JS `BRAND_FONT_DOMAINS`: font name -> hostname suffixes where it is allowed.
pub const BRAND_FONT_DOMAINS: &[(&str, &[&str])] = &[
    ("roboto", GOOGLE_DOMAINS),
    ("google sans", GOOGLE_DOMAINS),
    ("product sans", GOOGLE_DOMAINS),
    ("geist", VERCEL_DOMAINS),
    ("geist sans", VERCEL_DOMAINS),
    ("geist mono", VERCEL_DOMAINS),
    ("mona sans", GITHUB_DOMAINS),
];

/// JS `isBrandFontOnOwnDomain(font)`. The JS reads the global `location`;
/// here the caller passes `location.hostname` (`None` when there is no
/// `location`, i.e. outside a browser), which the JS treats as "not on its
/// own domain".
pub fn is_brand_font_on_own_domain(font: &str, hostname: Option<&str>) -> bool {
    let Some(hostname) = hostname else {
        return false;
    };
    let Some((_, allowed)) = BRAND_FONT_DOMAINS.iter().find(|(name, _)| *name == font) else {
        return false;
    };
    let host = crate::js::to_lower_case(hostname);
    allowed
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{}", suffix)))
}

/// JS `CSS_GENERIC_FONTS`. Overused-font primary selection skips only CSS
/// generics so a system stack keeps the system face as primary.
pub const CSS_GENERIC_FONTS: &[&str] = &[
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "inherit",
    "initial",
    "unset",
    "revert",
];

/// JS `GENERIC_FONTS`. Includes the CSS generics plus platform faces for
/// design-system/serif resolution.
pub const GENERIC_FONTS: &[&str] = &[
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "inherit",
    "initial",
    "unset",
    "revert",
    "system-ui",
    "ui-serif",
    "ui-sans-serif",
    "ui-monospace",
    "ui-rounded",
    "-apple-system",
    "blinkmacsystemfont",
    "segoe ui",
];

/// JS `WCAG_LARGE_TEXT_PX` = 18 * (96 / 72).
pub const WCAG_LARGE_TEXT_PX: f64 = 18.0 * (96.0 / 72.0);
/// JS `WCAG_LARGE_BOLD_TEXT_PX` = 14 * (96 / 72).
pub const WCAG_LARGE_BOLD_TEXT_PX: f64 = 14.0 * (96.0 / 72.0);

/// JS `EM_DASH_FLOOR`.
pub const EM_DASH_FLOOR: usize = 8;
/// JS `EM_DASH_CHARS_PER_DASH`.
pub const EM_DASH_CHARS_PER_DASH: usize = 500;

/// JS `KNOWN_SERIF_FONTS`.
pub const KNOWN_SERIF_FONTS: &[&str] = &[
    "fraunces",
    "recoleta",
    "newsreader",
    "playfair display",
    "playfair",
    "cormorant",
    "cormorant garamond",
    "garamond",
    "eb garamond",
    "tiempos",
    "tiempos headline",
    "tiempos text",
    "lora",
    "vollkorn",
    "spectral",
    "source serif pro",
    "source serif 4",
    "source serif",
    "ibm plex serif",
    "merriweather",
    "libre caslon",
    "libre baskerville",
    "baskerville",
    "georgia",
    "times new roman",
    "times",
    "dm serif display",
    "dm serif text",
    "instrument serif",
    "gt sectra",
    "ogg",
    "canela",
    "freight display",
    "freight text",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn border_safe_tags_is_safe_tags_minus_label() {
        let expected: Vec<&str> = SAFE_TAGS
            .iter()
            .copied()
            .filter(|t| *t != "label")
            .collect();
        assert_eq!(BORDER_SAFE_TAGS, expected.as_slice());
    }

    #[test]
    fn brand_font_domains() {
        assert!(is_brand_font_on_own_domain(
            "roboto",
            Some("Fonts.Google.com")
        ));
        assert!(is_brand_font_on_own_domain("geist", Some("vercel.com")));
        assert!(!is_brand_font_on_own_domain("geist", Some("notvercel.com")));
        assert!(!is_brand_font_on_own_domain("inter", Some("google.com")));
        assert!(!is_brand_font_on_own_domain("roboto", None));
    }
}
