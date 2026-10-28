//! Third-party vendors the detector names in its findings.
//!
//! A finding the site cannot fix in its own markup still reports, but it says
//! where the fix lives. Two kinds of vendor are known, each kept to the ones
//! the corpus has evidence for:
//!
//! - **Widgets** ([`WIDGET_VENDORS`]): markup a vendor script injects or a
//!   vendor stylesheet styles. Findings on it are tagged with the vendor and
//!   keep their severity, because visitors see them (corpus decision
//!   r4-p24-third-party-widget-markup).
//! - **Ad tech** ([`AD_TECH_VENDORS`], [`AD_TECH_APIS`]): uncaught errors and
//!   rejections thrown by advertising and tag scripts on pages that render
//!   fine. Those `script-error` findings are tagged and report as advisory
//!   (corpus decision r3-31-script-error-ad-tech).
//!
//! A tagged finding carries the vendor twice: at the end of its message
//! ([`tag_detail`]) and, in the CLI's JSON, as a `thirdParty` key.

use crate::browser::dom::{ancestors_inclusive, Dom, ElId};

/// How far a widget vendor's markup reaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WidgetScope {
    /// Everything under the vendor's container is the vendor's (an injected
    /// recommendation feed).
    Subtree,
    /// Only the vendor's own structural elements are the vendor's; what the
    /// site puts inside them is the site's (a carousel library's slide
    /// wrappers hold the site's own content).
    OwnElement,
}

/// A vendor whose markup is recognized by its ids and classes.
#[derive(Debug)]
pub struct WidgetVendor {
    pub name: &'static str,
    pub scope: WidgetScope,
    /// An element whose id starts with one of these is the vendor's.
    pub id_prefixes: &'static [&'static str],
    /// An element with a class token starting with one of these is the
    /// vendor's.
    pub class_prefixes: &'static [&'static str],
    /// An element with one of these exact class tokens is the vendor's.
    pub classes: &'static [&'static str],
}

/// The widget vendors, from the corpus evidence: Taboola recommendation cards
/// on ynet.co.il and climatempo.com.br (findings 110423, 110711, 123649,
/// 123650, 123679), and a Swiper carousel's vendor CSS on nubank.com.br
/// (111379, 111514). Run 28 adds four more (observations-28, section 3):
/// Slick's track and slide wrappers on lpga.or.jp (141946) and the dot
/// buttons Slick writes on jyes.com.tw (141986, 142493), SuperSlide's
/// `div.tempWrap` on scol.com.cn (141745, 141937), react-fast-marquee on
/// cnnbrasil.com.br (143060, 143061), and Kaltura's player on cencora.com
/// (143584 to 143586, 143613 to 143615). A vendor listed twice has two
/// scopes: Slick's structural wrappers hold the site's slides, while the dot
/// list is Slick's own markup down to the button.
pub const WIDGET_VENDORS: &[WidgetVendor] = &[
    WidgetVendor {
        name: "Taboola",
        scope: WidgetScope::Subtree,
        // `#taboola-mid-home-page-thumbnails-nd.trc_related_container` holds
        // `#internal_trc_<n>` and the `.trc_rbox_*` frame around the cards.
        id_prefixes: &["taboola-", "internal_trc_"],
        class_prefixes: &["trc_rbox"],
        classes: &["trc_related_container"],
    },
    WidgetVendor {
        name: "Swiper",
        scope: WidgetScope::OwnElement,
        id_prefixes: &["swiper-wrapper-"],
        class_prefixes: &[],
        classes: &["swiper", "swiper-container", "swiper-wrapper", "swiper-slide"],
    },
    WidgetVendor {
        name: "Slick",
        scope: WidgetScope::OwnElement,
        id_prefixes: &[],
        class_prefixes: &[],
        classes: &["slick-slider", "slick-list", "slick-track", "slick-slide", "slick-arrow"],
    },
    WidgetVendor {
        name: "Slick",
        scope: WidgetScope::Subtree,
        id_prefixes: &[],
        class_prefixes: &[],
        classes: &["slick-dots"],
    },
    WidgetVendor {
        name: "SuperSlide",
        scope: WidgetScope::OwnElement,
        id_prefixes: &[],
        class_prefixes: &[],
        classes: &["tempWrap"],
    },
    WidgetVendor {
        // The marquee clones and moves the site's children; what they collide
        // with or show at rest is the vendor's motion.
        name: "react-fast-marquee",
        scope: WidgetScope::Subtree,
        id_prefixes: &[],
        class_prefixes: &["rfm-"],
        classes: &[],
    },
    WidgetVendor {
        name: "Kaltura",
        scope: WidgetScope::Subtree,
        id_prefixes: &[],
        class_prefixes: &["playkit-"],
        classes: &["kaltura-player", "kaltura-player-container"],
    },
];

fn marks(dom: &dyn Dom, el: ElId, vendor: &WidgetVendor) -> bool {
    if let Some(id) = dom.attr(el, "id") {
        if vendor.id_prefixes.iter().any(|p| id.starts_with(p)) {
            return true;
        }
    }
    let class = dom.attr(el, "class").unwrap_or_default();
    class
        .split(|c: char| matches!(c, ' ' | '\t' | '\n' | '\x0C' | '\r'))
        .filter(|t| !t.is_empty())
        .any(|token| {
            vendor.classes.contains(&token) || vendor.class_prefixes.iter().any(|p| token.starts_with(p))
        })
}

/// The widget vendor whose markup `el` is, if any.
pub fn widget_vendor(dom: &dyn Dom, el: ElId) -> Option<&'static str> {
    for vendor in WIDGET_VENDORS {
        let hit = match vendor.scope {
            WidgetScope::OwnElement => marks(dom, el, vendor),
            WidgetScope::Subtree => ancestors_inclusive(dom, el)
                .into_iter()
                .any(|a| marks(dom, a, vendor)),
        };
        if hit {
            return Some(vendor.name);
        }
    }
    None
}

/// An ad-tech script host: an error thrown from a script it serves is the
/// vendor's.
#[derive(Debug)]
pub struct AdTechVendor {
    pub name: &'static str,
    /// Where the script the error was thrown from is served: a host, matching
    /// the host itself or any subdomain of it, or a host and a path prefix
    /// (`asset.chase.com/web/library/...`) for a vendor library that shares
    /// its host with the site.
    pub sources: &'static [&'static str],
    /// Prefixes of the script's file name, for a library a site serves from
    /// its own host: the file is the vendor's, a directory named after it
    /// is not.
    pub files: &'static [&'static str],
}

/// The ad-tech hosts, from the corpus evidence: AnyMind's Prebid bundle and
/// the Facebook pixel on co-trip.jp (findings 80412, 80232), a Google Tag
/// Manager tag on adm.com (87473), and OneTrust's auto-blocker on adm.com
/// (87472, 87474, 87513, 87514), the consent layer that holds ad and tracking
/// tags back and throws when it patches `document.createElement`. Product
/// analytics (PostHog) and a site's own bundles and telemetry chunks, ad
/// code served from the site's own host included, are not on the list and
/// stay first-party script errors. Run 28 adds (observations-28, section 3)
/// the nagich.co.il accessibility overlay on walla.co.il (142928, 142984) and
/// Chase's shared `Reporting.js` tag library, served from `asset.chase.com`
/// to jpmorganchase.com (143250); Prisma Media's ad core on
/// cuisineactuelle.fr throws from its Prebid call (143089, 143154), which
/// [`AD_TECH_APIS`] names. Round 13 adds Vector's visitor-identity pixel
/// (`cdn.vector.co/pixel.js`) on mercury.com, which rejects `No visitor ID
/// available` when its load is blocked or slow (findings 10133600,
/// 10133648, 10133678, 10133733, 10133748, 10133787).
pub const AD_TECH_VENDORS: &[AdTechVendor] = &[
    AdTechVendor { name: "AnyMind", sources: &["anymind360.com"], files: &[] },
    AdTechVendor { name: "Prebid", sources: &[], files: &["prebid"] },
    AdTechVendor { name: "Meta Pixel", sources: &["connect.facebook.net"], files: &[] },
    AdTechVendor { name: "Google Tag Manager", sources: &["googletagmanager.com"], files: &[] },
    AdTechVendor { name: "OneTrust", sources: &["cookielaw.org"], files: &[] },
    AdTechVendor {
        name: "Google Ads",
        sources: &["googlesyndication.com", "doubleclick.net", "googleadservices.com"],
        files: &[],
    },
    AdTechVendor { name: "Nagich", sources: &["nagich.co.il"], files: &[] },
    AdTechVendor { name: "Vector", sources: &["cdn.vector.co"], files: &[] },
    AdTechVendor {
        name: "Chase Reporting",
        sources: &["asset.chase.com/web/library/digddsautomation/reportingjs/"],
        files: &[],
    },
];

/// The lower-cased host and path of each script URL in a page error's
/// source, with any user info and port dropped from the host and the query
/// and fragment from the path (which keeps no leading `/`).
fn script_hosts(source: &str) -> Vec<(String, String)> {
    source
        .split(|c: char| c.is_whitespace() || c == ',' || c == '(' || c == ')')
        .filter_map(|token| {
            let rest = token.split_once("://")?.1;
            let rest = rest.split(['?', '#']).next().unwrap_or("");
            let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
            let host = authority.rsplit('@').next().unwrap_or("");
            let host = host.split(':').next().unwrap_or("");
            (!host.is_empty()).then(|| (host.to_ascii_lowercase(), path.to_ascii_lowercase()))
        })
        .collect()
}

/// Whether a script at `host` and `path` is served from `source`, a host
/// or a host and a path prefix (see [`AdTechVendor::sources`]).
fn served_from(host: &str, path: &str, source: &str) -> bool {
    match source.split_once('/') {
        Some((domain, prefix)) => host_is_or_under(host, domain) && path.starts_with(prefix),
        None => host_is_or_under(host, source),
    }
}

/// Whether `host` is `domain` or a subdomain of it.
fn host_is_or_under(host: &str, domain: &str) -> bool {
    host == domain
        || host.strip_suffix(domain).is_some_and(|head| head.ends_with('.'))
}

/// The lower-cased file names of the script URLs in a page error's source
/// (`at fn, https://host/dir/file.js:12:34`): the last path segment, with
/// the query, fragment and line and column numbers dropped.
fn script_file_names(source: &str) -> Vec<String> {
    source
        .split(|c: char| c.is_whitespace() || c == ',' || c == '(' || c == ')')
        .filter_map(|token| {
            let rest = token.split_once("://")?.1;
            let path = rest.split(['?', '#']).next().unwrap_or("");
            let file = path.rsplit('/').next().unwrap_or("");
            // Drop a trailing `:line:col` (or `:line`).
            let mut file = file;
            for _ in 0..2 {
                if let Some((head, tail)) = file.rsplit_once(':') {
                    if !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit()) {
                        file = head;
                    }
                }
            }
            (!file.is_empty() && path.contains('/')).then(|| file.to_ascii_lowercase())
        })
        .collect()
}

/// Ad APIs whose rejection names itself in the message: Chrome removed the
/// Topics API (`document.browsingTopics() is deprecated and has been
/// removed`, findings 65354, 65585 on co-trip.jp) and ad scripts still call
/// it; the Protected Audience calls are the same kind of rejection; AdSense
/// throws `adsbygoogle.push() error` at slots it cannot fill, and an ad core
/// calling a Prebid build that lacks a method names `_prebidjs`. Each maps to
/// the vendor it names.
pub const AD_TECH_APIS: &[(&str, &str)] = &[
    ("browsingTopics", "ad tech"),
    ("joinAdInterestGroup", "ad tech"),
    ("runAdAuction", "ad tech"),
    ("adsbygoogle", "Google Ads"),
    ("_prebidjs", "Prebid"),
];

/// The ad-tech vendor behind an uncaught page error, from where it was
/// thrown (`source`, the script URL and frame) or, failing that, the ad API
/// its message names.
pub fn ad_tech_vendor(message: &str, source: Option<&str>) -> Option<&'static str> {
    if let Some(source) = source {
        let hosts = script_hosts(source);
        let files = script_file_names(source);
        for vendor in AD_TECH_VENDORS {
            if vendor.sources.iter().any(|s| hosts.iter().any(|(h, p)| served_from(h, p, s)))
                || vendor.files.iter().any(|p| files.iter().any(|f| f.starts_with(p)))
            {
                return Some(vendor.name);
            }
        }
    }
    AD_TECH_APIS
        .iter()
        .find(|(api, _)| message.contains(api))
        .map(|(_, name)| *name)
}

/// A finding's message with the vendor named at its end.
pub fn tag_detail(detail: &str, vendor: &str) -> String {
    format!("{detail} (third-party: {vendor})")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::fake_dom::FakeDom;

    #[test]
    fn taboola_tags_its_whole_subtree() {
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        let feed = d.add(Some(body), "div");
        d.set_attr(feed, "id", "taboola-mid-home-page-thumbnails-nd");
        d.set_attr(feed, "class", "trc_related_container tbl-trecs-container");
        let card = d.add(Some(feed), "div");
        d.set_attr(card, "id", "internal_trc_2016259095");
        let button = d.add(Some(card), "button");
        assert_eq!(widget_vendor(&d, button), Some("Taboola"));
        assert_eq!(widget_vendor(&d, feed), Some("Taboola"));
        let own = d.add(Some(body), "button");
        assert_eq!(widget_vendor(&d, own), None);
    }

    #[test]
    fn swiper_tags_its_own_elements_only() {
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        let wrapper = d.add(Some(body), "div");
        d.set_attr(wrapper, "id", "swiper-wrapper-c3421110317cdd10310");
        d.set_attr(wrapper, "class", "swiper-wrapper");
        let slide = d.add(Some(wrapper), "div");
        d.set_attr(slide, "class", "swiper-slide swiper-slide-visible");
        let heading = d.add(Some(slide), "h2");
        assert_eq!(widget_vendor(&d, slide), Some("Swiper"));
        assert_eq!(widget_vendor(&d, wrapper), Some("Swiper"));
        // The site's own content inside a slide is the site's.
        assert_eq!(widget_vendor(&d, heading), None);
        // A class that only starts like Swiper's is not Swiper's.
        let other = d.add(Some(body), "div");
        d.set_attr(other, "class", "swiper-like-thing");
        assert_eq!(widget_vendor(&d, other), None);
    }

    #[test]
    fn ad_tech_hosts_match_whole_host_names() {
        let msg = "Uncaught TypeError: x is not a function";
        assert_eq!(
            ad_tech_vendor(msg, Some("at f, https://example.com/assets/googletagmanager.com-helper.js:1:2")),
            None
        );
        assert_eq!(ad_tech_vendor(msg, Some("at f, https://notgoogletagmanager.com/app.js:1:2")), None);
        // A host and path prefix matches only under that path.
        assert_eq!(
            ad_tech_vendor(msg, Some("at f, https://asset.chase.com/web/library/digddsautomation/reportingjs/Reporting.js:1:2")),
            Some("Chase Reporting")
        );
        assert_eq!(ad_tech_vendor(msg, Some("at f, https://asset.chase.com/web/app/main.js:1:2")), None);
        assert_eq!(
            ad_tech_vendor(msg, Some("at f, https://securepubads.g.doubleclick.net:443/tag/js/gpt.js:3:4")),
            Some("Google Ads")
        );
    }

    #[test]
    fn ad_tech_errors_name_their_vendor() {
        let topics = "Uncaught (in promise) NotSupportedError: Failed to execute 'browsingTopics' on 'Document': document.browsingTopics() is deprecated and has been removed.";
        assert_eq!(ad_tech_vendor(topics, None), Some("ad tech"));
        assert_eq!(
            ad_tech_vendor(topics, Some("at https://anymind360.com/js/17837/prebid_2026_9_10_16_23_39.js:89:956")),
            Some("AnyMind")
        );
        assert_eq!(
            ad_tech_vendor(
                "Uncaught TypeError: a.__fbeventsModules[e] is not a function",
                Some("at a.getFbeventsModules, https://connect.facebook.net/signals/config/1?v=2.9:20:4472")
            ),
            Some("Meta Pixel")
        );
        assert_eq!(
            ad_tech_vendor("Uncaught [object Object]", Some("at error, https://www.googletagmanager.com/gtm.js?id=GTM-X:272:504")),
            Some("Google Tag Manager")
        );
        assert_eq!(
            ad_tech_vendor(
                "Uncaught TypeError: Cannot redefine property: src",
                Some("at document.createElement, https://cdn.cookielaw.org/consent/x/OtAutoBlock.js:10:312")
            ),
            Some("OneTrust")
        );
        // Analytics and first-party code are not ad tech.
        assert_eq!(
            ad_tech_vendor(
                "[SessionRecording] must be started with a valid sessionManager.",
                Some("at get Ph, https://www.context.dev/ingest/static/1.417.1/posthog-recorder.js:1:156066")
            ),
            None
        );
        assert_eq!(ad_tech_vendor("Minified React error #418", Some("at https://example.com/app.js:1:1")), None);
        // Prebid is a library sites serve themselves: its file is the
        // vendor's wherever it is hosted, a directory named after it is not.
        assert_eq!(
            ad_tech_vendor("Uncaught Error: bidder timeout", Some("at https://cdn.example.com/prebid/prebid-9.1.js:4:2")),
            Some("Prebid")
        );
        assert_eq!(
            ad_tech_vendor("Uncaught Error: x", Some("at load, https://shop.example/assets/prebid.min.js?v=3:1:1")),
            Some("Prebid")
        );
        assert_eq!(
            ad_tech_vendor("Uncaught TypeError: cart is undefined", Some("at https://shop.example/prebid/app.js:1:1")),
            None
        );
    }

    #[test]
    fn run_28_ad_tech_hosts_name_their_vendor() {
        assert_eq!(
            ad_tech_vendor(
                "Uncaught (in promise) TypeError: ze._prebidjs.getAdserverTargetingForAdUnitCode is not a function",
                Some("at mapConversionRateInAdserverWithPrebidTargeting, https://tra.scds.pmdstatic.net/advertising-core/5/core-ads.js:1:73446")
            ),
            Some("Prebid")
        );
        assert_eq!(
            ad_tech_vendor(
                "Uncaught (in promise) TypeError: e.some is not a function",
                Some("at i, https://js.nagich.co.il/core/4.6.12/accessibility.js:1:3216")
            ),
            Some("Nagich")
        );
        assert_eq!(
            ad_tech_vendor(
                "Uncaught TypeError: Cannot convert undefined or null to object",
                Some("at o, https://asset.chase.com/web/library/digddsautomation/reportingjs/Reporting.js:1:121552")
            ),
            Some("Chase Reporting")
        );
        assert_eq!(
            ad_tech_vendor(
                "Uncaught (in promise) Error: No visitor ID available. Load may have failed.",
                Some("at https://cdn.vector.co/pixel.js:2:219512")
            ),
            Some("Vector")
        );
        // A host that only ends like Vector's is not Vector's.
        assert_eq!(ad_tech_vendor("Uncaught Error: x", Some("at https://cdn.notvector.co/app.js:1:1")), None);
        // Chase's own bundles on the same host stay first-party.
        assert_eq!(
            ad_tech_vendor("Uncaught TypeError: x is undefined", Some("at a, https://asset.chase.com/web/app/main.js:1:1")),
            None
        );
    }

    #[test]
    fn run_28_widget_vendors_tag_their_markup() {
        let mut d = FakeDom::new();
        let (_html, body) = d.with_page();
        // Slick: the list is Slick's, the site's slide content is not; the
        // dot list is Slick's down to its buttons.
        let slider = d.add(Some(body), "div");
        d.set_attr(slider, "class", "banner slick-initialized slick-slider");
        let list = d.add(Some(slider), "div");
        d.set_attr(list, "class", "slick-list draggable");
        let slide = d.add(Some(list), "div");
        d.set_attr(slide, "class", "slick-slide slick-active");
        let caption = d.add(Some(slide), "p");
        let dots = d.add(Some(slider), "ul");
        d.set_attr(dots, "class", "slick-dots");
        let dot = d.add(Some(dots), "li");
        d.set_attr(dot, "id", "slick-slide00");
        let button = d.add(Some(dot), "button");
        assert_eq!(widget_vendor(&d, list), Some("Slick"));
        assert_eq!(widget_vendor(&d, slide), Some("Slick"));
        assert_eq!(widget_vendor(&d, caption), None);
        assert_eq!(widget_vendor(&d, button), Some("Slick"));
        // SuperSlide's wrapper.
        let wrap = d.add(Some(body), "div");
        d.set_attr(wrap, "class", "tempWrap");
        let item = d.add(Some(wrap), "span");
        assert_eq!(widget_vendor(&d, wrap), Some("SuperSlide"));
        assert_eq!(widget_vendor(&d, item), None);
        // react-fast-marquee and Kaltura tag their whole subtree.
        let marquee = d.add(Some(body), "div");
        d.set_attr(marquee, "class", "rfm-marquee-container ");
        let child = d.add(Some(marquee), "div");
        d.set_attr(child, "class", "rfm-child");
        let ticker = d.add(Some(child), "span");
        assert_eq!(widget_vendor(&d, ticker), Some("react-fast-marquee"));
        let player = d.add(Some(body), "div");
        d.set_attr(player, "class", "kaltura-player embed-responsive-item");
        let area = d.add(Some(player), "div");
        d.set_attr(area, "class", "playkit-video-area");
        let video = d.add(Some(area), "video");
        assert_eq!(widget_vendor(&d, video), Some("Kaltura"));
        // Look-alike classes are not the vendors'.
        let other = d.add(Some(body), "div");
        d.set_attr(other, "class", "slick-like rfm tempwrap kaltura");
        assert_eq!(widget_vendor(&d, other), None);
    }

    #[test]
    fn tagged_detail_ends_with_the_vendor() {
        assert_eq!(
            tag_detail("10px functional text \"Learn More\" (below 11px floor)", "Taboola"),
            "10px functional text \"Learn More\" (below 11px floor) (third-party: Taboola)"
        );
    }
}
