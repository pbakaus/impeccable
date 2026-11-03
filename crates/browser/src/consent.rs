//! Known consent managers, and hiding their banners before the rule pass.
//!
//! A consent banner is not the site. At capture it covers copy a visitor
//! reads once they dismiss it, so text under it is either skipped as covered
//! or scored against the banner, and the crops show the banner instead of the
//! page. Before the reveal sweep the URL engine hides the banners and
//! backdrops of the consent managers listed here with an injected style
//! (`display: none`), and a site's own cookie notice with an inline one, and
//! undoes the scroll lock or blur they applied. It never clicks, sets a
//! cookie, or records a consent choice: the page's own state is unchanged,
//! only painted without the notice's layer.
//!
//! The list holds selectors specific to one vendor (its ids, or class names
//! carrying its name), never a generic word such as "cookie" or "banner".
//! The validity gate ([`crate::validity`]) reads the same list to recognize
//! a page that is nothing but a consent wall.
//!
//! A cookie notice a site wrote for itself is recognized by what it does
//! rather than by its names ([`cookie_notice_js`]): a fixed or page-covering
//! layer whose own text names cookies and which offers a consent choice, with
//! no field to fill in. Corpus run 1006 found three (blueeyes.com.tw,
//! searchvoro.com, ktk.de) covering about 40 findings and blurring one whole
//! site. This reverses the decision recorded below for moe.gov.sa's
//! `div.cookie-consent` (runs 42 and 43), which stayed because nothing in its
//! markup told it apart from any other dialog: its text and its choice do.
//!
//! Corpus evidence (runs 20 and 25, 848 captures of 126 sites, desktop and
//! 390px): OneTrust on 7 sites (adm.com, cisco.com, cvs.com, exxonmobil.com,
//! mckesson.com, otto.de, thecignagroup.com; `#onetrust-consent-sdk`,
//! `#onetrust-banner-sdk` and `.onetrust-pc-dark-filter` on every one),
//! Usercentrics on 2 (fedex.com, tchibo.de; `#usercentrics-cmp-ui`), and one
//! site each for Cookiebot (theagenticdatacompany.com,
//! `#CybotCookiebotDialog`), TrustArc (samsung.com, `#consent_blackbar` and
//! `#truste-consent-track`), Didomi (ladepeche.fr, `#didomi-host`), the
//! open-source Cookie Consent library (centene.com,
//! `.cc-window[aria-label="cookieconsent"]`) and Google's consent messages
//! (ynet.co.il, `.fc-ccpa-root`). The other vendors are listed from their
//! published markup and have no corpus capture yet.
//!
//! Run 35 added two. consentmanager.net on letour.fr: `div#cmpbox` with
//! `role=dialog`, rendered in the open shadow root of `div#cmpwrapper`, a
//! fixed bar over the lower 28 to 36% of the first screen. And Borlabs Cookie
//! 3 on fischundfang.de, already listed by `#BorlabsCookieBox`, left three
//! things behind once the box was hidden: its floating reopen button
//! (`#BorlabsCookieWidget`, a fixed 48px shield at the left edge), the inline
//! `overflow: hidden` on `<body>` its modal sets behind
//! `#BorlabsDialogBackdrop` (it stopped the reveal sweep from scrolling), and
//! `aria-hidden="true"` on the page wrapper (`#td-outer-wrap`) and its
//! siblings, each marked `data-borlabs-cookie-aria-hidden`.
//!
//! Runs 42 and 43 added two more. Tealium's consent prompt on telekom.de:
//! `div#__tealiumGDPRecModal`, a fixed full-screen layer (`z-index`
//! 2147483645) holding a 50% black `div.cl-outer` and the
//! `dialog#promptLayerContent` that also carries the Utiq notice
//! (`#utiqMessage`); Tealium's own script names that id and its preference
//! center's, `#__tealiumGDPRcpPrefs`. On the home page it arrived after the
//! capture and before the screenshot, so it covered nearly every crop. And
//! Transcend on verizon.com: `div#transcend-consent-manager`, a zero-size
//! fixed host on `<html>` whose open shadow root renders the banner
//! (`div#consentManagerMainDialog`, a fixed 90px bar at the foot of the first
//! screen). A site's own banner with generic classes (moe.gov.sa's
//! `div.cookie-consent`, an Alpine.js dialog) stays: nothing in its markup
//! tells it apart from any other dialog the site wrote.
//!
//! Run 1006 added Tarteaucitron on bordeaux-metropole.fr:
//! `#tarteaucitronAlertBig` (fixed, `role=dialog`, `aria-modal`, `z-index`
//! 2147483645, a yellow card in the middle of the first screen) inside the
//! zero-height `#tarteaucitronRoot`.
//!
//! Run 1004 added Enzuzo on smartbi.ca: `div#ez-cookie-notification`
//! (`enzuzo-cookiebanner-container`, `z-index` 2147483647) over the hero on
//! both widths, its preference modal `div#enzuzo-modal-wrap`, and
//! `ez-body-lock` on `<body>`, served by `app.enzuzo.com`'s
//! `__enzuzo-cookiebar.js`.

use serde_json::{json, Value};

/// One consent manager: the elements to hide and the scroll lock it applies.
#[derive(Debug, Clone, Copy)]
pub struct ConsentManager {
    pub name: &'static str,
    /// The banner, dialog, or preference-center roots.
    pub roots: &'static [&'static str],
    /// Overlays the manager lays over the page behind its dialog.
    pub backdrops: &'static [&'static str],
    /// Classes the manager puts on `<html>` to stop the page scrolling.
    pub html_lock_classes: &'static [&'static str],
    /// Classes the manager puts on `<body>` to stop the page scrolling.
    pub body_lock_classes: &'static [&'static str],
    /// Attributes the manager sets beside the `aria-hidden="true"` it puts on
    /// the page while its dialog is open, as its own record of which elements
    /// it hid. The hide step removes `aria-hidden` from exactly those
    /// elements, since the rules treat aria-hidden text as not the page's.
    pub aria_hidden_marks: &'static [&'static str],
}

/// Every known consent manager, in the order a report names them.
pub const CONSENT_MANAGERS: &[ConsentManager] = &[
    ConsentManager {
        name: "OneTrust",
        roots: &["#onetrust-consent-sdk", "#onetrust-banner-sdk", "#onetrust-pc-sdk"],
        backdrops: &[".onetrust-pc-dark-filter"],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Cookiebot",
        roots: &["#CybotCookiebotDialog"],
        backdrops: &["#CybotCookiebotDialogBodyUnderlay"],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Usercentrics",
        roots: &["#usercentrics-root", "#usercentrics-cmp-ui"],
        backdrops: &[],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "TrustArc",
        roots: &["#consent_blackbar", "#truste-consent-track", ".truste_box_overlay"],
        backdrops: &[".truste_overlay"],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Didomi",
        roots: &["#didomi-host"],
        backdrops: &[],
        html_lock_classes: &[],
        body_lock_classes: &["didomi-popup-open"],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Quantcast Choice",
        roots: &["#qc-cmp2-container", ".qc-cmp2-container"],
        backdrops: &[],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Sourcepoint",
        roots: &["[id^='sp_message_container_']"],
        backdrops: &[],
        html_lock_classes: &["sp-message-open"],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Osano",
        roots: &[".osano-cm-dialog", ".osano-cm-info-dialog"],
        backdrops: &[],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Cookie Consent",
        roots: &[".cc-window[aria-label='cookieconsent']", ".cc-window.cc-banner", ".cc-grower"],
        backdrops: &[],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "CookieYes",
        roots: &[".cky-consent-container", ".cky-modal", "#cookie-law-info-bar", "#cliSettingsPopup"],
        backdrops: &[".cky-overlay", ".cli-modal-backdrop"],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Complianz",
        roots: &["#cmplz-cookiebanner-container", ".cmplz-cookiebanner"],
        backdrops: &[".cmplz-soft-cookiewall"],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "iubenda",
        roots: &["#iubenda-cs-banner"],
        backdrops: &[],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Termly",
        roots: &["#termly-code-snippet-support"],
        backdrops: &[],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Axeptio",
        roots: &[".axeptio_mount"],
        backdrops: &["#axeptio_overlay"],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Borlabs Cookie",
        roots: &["#BorlabsCookieBox", "#BorlabsCookieBoxWrap", "#BorlabsCookieWidget"],
        backdrops: &["#BorlabsDialogBackdrop"],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &["data-borlabs-cookie-aria-hidden"],
    },
    ConsentManager {
        name: "Klaro",
        roots: &["#klaro .cookie-notice", "#klaro .cookie-modal"],
        backdrops: &[],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Cookie Notice",
        roots: &["#cookie-notice:has(#cn-notice-text)"],
        backdrops: &[],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Shopify",
        roots: &["#shopify-pc__banner", "#shopify-pc__prefs"],
        backdrops: &[],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "consentmanager",
        // Current builds render the box inside an open shadow root on
        // `#cmpwrapper`, out of reach of a document selector, so the host is
        // what is hidden; `#cmpbox` covers builds that render it in the page.
        roots: &["#cmpwrapper", "#cmpbox"],
        backdrops: &[],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Tealium",
        // The consent prompt and the preference center, as Tealium's
        // `utag.gdpr` script names them.
        roots: &["#__tealiumGDPRecModal", "#__tealiumGDPRcpPrefs"],
        backdrops: &[],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Transcend",
        // The banner renders in the open shadow root of this zero-size host.
        roots: &["#transcend-consent-manager"],
        backdrops: &[],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Enzuzo",
        // The banner and the preference modal, by the ids Enzuzo's cookie
        // bar script gives them; it locks scrolling with a class on `<body>`.
        roots: &["#ez-cookie-notification", "#enzuzo-modal-wrap"],
        backdrops: &[],
        html_lock_classes: &[],
        body_lock_classes: &["ez-body-lock"],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Tarteaucitron",
        // `#tarteaucitronRoot` is a zero-height host; inside it the fixed
        // banner (`#tarteaucitronAlertBig`, `role=dialog`, `aria-modal`), its
        // small variant, the 5px progress bar, the preference panel and its
        // backdrop, and the floating reopen icon.
        roots: &[
            "#tarteaucitronRoot",
            "#tarteaucitronAlertBig",
            "#tarteaucitronAlertSmall",
            "#tarteaucitronPercentage",
            "#tarteaucitron",
            "#tarteaucitronIcon",
        ],
        backdrops: &["#tarteaucitronBack"],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
    ConsentManager {
        name: "Google Funding Choices",
        roots: &[".fc-consent-root", ".fc-ccpa-root"],
        backdrops: &[".fc-dialog-overlay"],
        html_lock_classes: &[],
        body_lock_classes: &[],
        aria_hidden_marks: &[],
    },
];

/// The id of the style element the hide step injects.
pub const HIDE_STYLE_ID: &str = "impeccable-consent-hide";

/// Page JS: `el => bool`, whether an element marked with
/// [`INLINE_HIDE_MARK`] still carries the inline hide a pass stamped on it,
/// so lifting it shows the element as its manager left it. A manager that
/// has since set its own display keeps what it set: a different value or
/// priority, or the same `none !important` written by rewriting its style
/// attribute (closing its dialog), which leaves the attribute's text apart
/// from the declarations the stamp serialized. A rewrite that spells the
/// stamp's own serialization, or a `setProperty` of the same value, changes
/// nothing the page can observe.
pub const STAMP_IS_OURS_JS: &str = "(el => el.style.getPropertyValue('display') === 'none' && el.style.getPropertyPriority('display') === 'important' && el.getAttribute('style') === el.style.cssText)";
/// The attribute the hide step puts on an element it hid with an inline
/// `display: none !important` (a manager whose own inline `!important`
/// outranks the rule), holding the inline `display` it replaced as
/// `[value, priority]`.
pub const INLINE_HIDE_MARK: &str = "data-impeccable-consent-display";

fn managers_json() -> Value {
    Value::Array(
        CONSENT_MANAGERS
            .iter()
            .map(|m| {
                json!({
                    "name": m.name,
                    "roots": m.roots,
                    "backdrops": m.backdrops,
                    "htmlLock": m.html_lock_classes,
                    "bodyLock": m.body_lock_classes,
                    "ariaMarks": m.aria_hidden_marks,
                })
            })
            .collect(),
    )
}

/// Page JS shared by the probe and the hide step. `showing(el)` is whether an
/// element (or, for a zero-size wrapper such as `#onetrust-consent-sdk`, one
/// of its first descendants) paints a visible box.
///
/// A box with a size can still be out of every visitor's sight: a closed
/// dialog a fixed layer parks past the viewport's edge, a box wholly above
/// or beside the document, or one an ancestor's overflow clips away (a bar
/// inside a wrapper collapsed to no height). `parkedAway` rejects those, as
/// the rule pass's painted predicate does (`OutsideDocument`, `ClippedOut`).
/// An overflow clip counts only on the ancestors that clip the box: an
/// absolutely positioned box escapes the static ones between it and its
/// containing block, and a fixed box every one below the ancestor that holds
/// it (a transform, a filter, containment), or all of them when none does.
const SHOWING_JS: &str = r#"const q = s => { try { return Array.from(document.querySelectorAll(s)); } catch (e) { return []; } };
  const flatUp = n => n.assignedSlot || n.parentElement || (n.parentNode && n.parentNode.host) || null;
  // Whether a box makes a fixed descendant scroll with it (a transform, a
  // filter, layout or paint containment), as the full-page screenshot asks.
  const holdsFixed = cs => {
    const none = v => !v || v === 'none';
    return !none(cs.transform) || !none(cs.translate) || !none(cs.scale) || !none(cs.rotate)
      || !none(cs.filter) || !none(cs.backdropFilter) || !none(cs.perspective)
      || /transform|translate|scale|rotate|filter|perspective/.test(cs.willChange || '')
      || /paint|layout|strict|content/.test(cs.contain || '');
  };
  const parkedAway = (el, r) => {
    const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
    const de = document.documentElement;
    const top = a => !a || a === de || a === document.body;
    // Up the chain of boxes that hold the box, each one's clip asked: an
    // in-flow box's parent, an absolutely positioned box's nearest
    // positioned (or fixed-holding) ancestor, a fixed box's nearest
    // fixed-holding ancestor, or the viewport when it has none.
    let pos = getComputedStyle(el).position;
    let cur = el;
    let viewport = false;
    for (let n = 0; n < 60; n++) {
      let a = flatUp(cur);
      let cs = null;
      for (; !top(a) && n < 60; a = flatUp(a), n++) {
        cs = getComputedStyle(a);
        if (cs.display === 'contents') continue;
        if (pos === 'fixed' ? holdsFixed(cs) : pos === 'absolute' ? (cs.position !== 'static' || holdsFixed(cs)) : true) break;
      }
      if (top(a)) {
        viewport = pos === 'fixed' && !(document.body && holdsFixed(getComputedStyle(document.body))) && !holdsFixed(getComputedStyle(de));
        break;
      }
      const clipX = cs.overflowX !== 'visible', clipY = cs.overflowY !== 'visible';
      if (clipX || clipY) {
        const pr = a.getBoundingClientRect();
        if ((clipX && (r.right <= pr.left || r.left >= pr.right)) || (clipY && (r.bottom <= pr.top || r.top >= pr.bottom))) return true;
      }
      cur = a;
      pos = cs.position;
    }
    if (viewport) return vw > 0 && vh > 0 && (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh);
    if (r.bottom + window.scrollY <= 0) return true;
    const se = document.scrollingElement || de;
    const docW = se ? se.scrollWidth : 0;
    if (!(docW > 0) || !(vw > 0)) return false;
    const rtl = getComputedStyle(de).direction === 'rtl';
    const start = rtl ? vw - docW : 0, end = rtl ? vw : docW;
    return r.right + window.scrollX <= start || r.left + window.scrollX >= end;
  };
  const boxShows = el => {
    try {
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 1 && r.height >= 1 && !parkedAway(el, r);
    } catch (e) { return false; }
  };
  const showing = el => {
    if (!el || !el.isConnected) return false;
    // A hidden or transparent root hides everything under it, but a root at
    // `visibility: hidden` does not: a child at `visibility: visible`
    // paints, so the walk below still looks at it.
    try {
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true })) return false;
    } catch (e) {}
    if (boxShows(el)) return true;
    for (const scope of [el, el.shadowRoot]) {
      if (!scope) continue;
      const kids = scope.querySelectorAll('*');
      for (let i = 0; i < kids.length && i < 400; i++) if (boxShows(kids[i])) return true;
    }
    return false;
  };"#;

/// A probe fragment. Defines `consent` (the names of the managers whose roots
/// are showing), `consentChars` (the visible text inside those roots, shadow
/// roots included), `consentShadowChars` (the part of it `body.innerText`
/// does not see: shadow-root text, and a root outside `<body>`),
/// `consentPageShadowChars` (visible text in the page's own open shadow
/// roots, outside those roots), `consentFrames` (sizable frames inside
/// those roots) and
/// `consentOutside` (visible form controls and sizable media outside them,
/// counted up to 20).
pub fn probe_fragment() -> String {
    format!(
        r#"const consentManagers = {managers};
  {showing}
  const consent = [];
  const consentRoots = [];
  for (const m of consentManagers) {{
    let on = false;
    // Two selectors can match one node (Quantcast's id and class): it is one
    // root, counted once.
    for (const s of m.roots) for (const el of q(s)) if (showing(el)) {{ on = true; if (!consentRoots.includes(el)) consentRoots.push(el); }}
    if (on) consent.push(m.name);
  }}
  // A manager that renders into a shadow root (Usercentrics) keeps its text
  // out of the host's innerText, so each open shadow root under a root adds
  // its own.
  const visibleText = el => {{
    let text = (el.innerText || '').replace(/\s+/g, ' ').trim().length;
    const hosts = [el].concat(Array.from(el.querySelectorAll('*')).slice(0, 2000));
    for (const host of hosts) {{
      const root = host.shadowRoot;
      if (!root) continue;
      // innerText of an unrendered child (a <style>) is its source text.
      for (const child of root.children) text += shadowText(child);
    }}
    return text;
  }};
  // A `display: contents` wrapper has no box of its own; its children do.
  const shadowText = el => {{
    if (boxShows(el)) return visibleText(el);
    let n = 0;
    try {{
      if (getComputedStyle(el).display === 'contents') for (const k of el.children) n += shadowText(k);
    }} catch (e) {{}}
    return n;
  }};
  // `consentShadowChars` is the part of that text the page's own
  // `body.innerText` cannot see, so the probe adds it to the page's count and
  // the two counts describe the same text. `consentFrames` counts sizable
  // frames inside the roots: a manager that draws its message in an iframe
  // (Sourcepoint) holds text no page script can read.
  let consentChars = 0;
  let consentShadowChars = 0;
  let consentFrames = 0;
  for (const el of consentRoots) {{
    if (consentRoots.some(o => o !== el && o.contains(el))) continue;
    const all = visibleText(el);
    consentChars += all;
    // A root outside <body> (appended to <html>) is not in body.innerText
    // at all; one inside it is, all but its shadow-root text.
    const inBody = !!document.body && document.body.contains(el);
    consentShadowChars += inBody ? Math.max(0, all - (el.innerText || '').replace(/\s+/g, ' ').trim().length) : all;
    // A manager that draws its message in a frame inside its own shadow
    // root holds that frame out of `querySelectorAll`'s reach.
    const frames = [...el.querySelectorAll('iframe')];
    for (const n of [el, ...el.querySelectorAll('*')]) {{
      if (n.shadowRoot) frames.push(...n.shadowRoot.querySelectorAll('iframe'));
    }}
    for (const f of frames) {{
      if (!boxShows(f)) continue;
      const r = f.getBoundingClientRect();
      if (r.width * r.height >= {media_px}) consentFrames++;
    }}
  }}
  // Content outside the managers that is not text: a form control of any
  // size, or an image, video, canvas, SVG or frame of at least
  // {media_px} square pixels. A sign-in form or an image-first page has
  // little text of its own and is still a page.
  let consentOutside = 0;
  // `consentPageShadowChars` is the visible text in the page's own open
  // shadow roots (a web-component app), which `body.innerText` does not see
  // either: it counts as text outside the managers.
  let consentPageShadowChars = 0;
  // The page's open shadow roots, outside the managers: their form
  // controls and media are the page's as much as their text is. Roots
  // nested inside other roots (a login component in an app shell's tree)
  // count too; their text is already in the outer root's, so only the roots
  // on light-DOM hosts add text.
  const pageShadows = [];
  if (consentRoots.length && document.body) {{
    let seen = 0;
    const visitShadows = (scope, top) => {{
      const hosts = scope.querySelectorAll('*');
      for (let i = 0; i < hosts.length && seen < 30000; i++, seen++) {{
        const host = hosts[i];
        if (!host.shadowRoot || consentRoots.some(r => r.contains(host))) continue;
        pageShadows.push(host.shadowRoot);
        if (top) for (const child of host.shadowRoot.children) consentPageShadowChars += shadowText(child);
        visitShadows(host.shadowRoot, false);
      }}
    }};
    visitShadows(document.body, true);
  }}
  if (consentRoots.length) {{
    const inside = el => consentRoots.some(r => r.contains(el));
    const all = sel => {{
      const out = q(sel);
      for (const root of pageShadows) {{
        try {{ out.push(...root.querySelectorAll(sel)); }} catch (e) {{}}
      }}
      return out;
    }};
    for (const el of all({controls})) {{
      if (consentOutside >= 20) break;
      if (!inside(el) && boxShows(el)) consentOutside++;
    }}
    for (const el of all({media})) {{
      if (consentOutside >= 20) break;
      if (inside(el) || !boxShows(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height >= {media_px}) consentOutside++;
    }}
  }}"#,
        managers = managers_json(),
        showing = SHOWING_JS,
        controls = json!(OUTSIDE_CONTROLS),
        media = json!(OUTSIDE_MEDIA),
        media_px = OUTSIDE_MEDIA_MIN_AREA,
    )
}

/// Form controls that make a page more than its consent wall, wherever they
/// sit outside a manager's roots.
pub const OUTSIDE_CONTROLS: &str = "input:not([type='hidden']), select, textarea, button";
/// Media that make a page more than its consent wall, when at least
/// [`OUTSIDE_MEDIA_MIN_AREA`] square pixels (a logo is smaller).
pub const OUTSIDE_MEDIA: &str = "img, svg, video, canvas, iframe, object, embed";
pub const OUTSIDE_MEDIA_MIN_AREA: u32 = 10_000;

/// The name a site's own cookie notice is reported under, in `hidden` and
/// `consentHidden`, after the listed managers.
pub const COOKIE_NOTICE: &str = "cookie notice";
/// The attribute the hide step puts on a site's own cookie notice it hid
/// (and on the empty full-screen layer beside it), naming the element, so a
/// later pass reports it again without looking for it twice.
pub const COOKIE_NOTICE_MARK: &str = "data-impeccable-cookie-notice";
/// Most visible characters a cookie notice may carry, its preference text
/// included.
pub const COOKIE_NOTICE_MAX_TEXT: usize = 1500;
/// Least visible text the page shows outside a cookie notice for the notice
/// to be hidden: a page that is little more than its notice is a consent
/// wall, and is read as before.
pub const COOKIE_NOTICE_MIN_OUTSIDE_TEXT: usize = 200;
/// Longest control label read as a consent choice.
pub const COOKIE_NOTICE_MAX_LABEL: usize = 40;
/// Largest inline `blur()` radius a cookie lock is taken to have put on the
/// page (ktk.de: 4px); a larger one is a decoration's.
pub const COOKIE_NOTICE_MAX_BLUR_PX: f64 = 12.0;

/// Page JS that defines `cookieNotices(out)`: a cookie notice a site wrote
/// for itself, with none of a listed manager's markup, hidden the way a
/// manager's banner is. Corpus run 1006: blueeyes.com.tw's `div#cookieBanner`
/// (fixed, `z-index: 9999`, `rgba(0,0,0,0.8)`, no dialog role) over the first
/// row of buttons; searchvoro.com's `role=dialog` card (`aria-modal=false`,
/// `z-index: 95`); ktk.de's `role=dialog` box inside an absolutely positioned
/// layer the height of the document, beside an empty transparent fixed layer
/// that takes every hit test, with `filter: blur(4px)` set inline on the page
/// wrapper. The `z-index` and dialog role a notice carries vary too much to
/// read; what they share is below.
///
/// A notice is found from its choice, inward out:
/// - a **choice control**: a `button`, `[role=button]`, button input, an `a`
///   with no `href` or one that only names a fragment or `javascript:`, or an
///   element with an `onclick` or `cursor: pointer`, whose whole label (at
///   most 40 characters, case and end punctuation aside) is an accept or
///   refuse phrase (`Accept`, `Accept all`, `Reject non-essential`, `Allow
///   all cookies`, `Alle Cookies akzeptieren`, `Tout accepter`, `接受`, ... in
///   [`cookie_notice_js`]'s list). A softer label (`OK`, `Got it`, `Close`,
///   `Dismiss`, `Understood`, `Schließen`, `Fermer`, ...) counts only when the
///   notice's text is a consent sentence: a use verb before `cookie`
///   ("we use cookies", "verwendet Cookies", "utilise des cookies") or a
///   policy, settings or preferences word after it. A plain link
///   (`a[href]`) is never a choice;
/// - its **box**: the nearest ancestor of the control whose own text
///   (outside links and controls) names `cookie`, then up through every
///   ancestor that adds no text, control or media of its own, so a strip
///   inside a site header, or a bar stacked with a buy bar, is the notice
///   alone and its container stays;
/// - that box, an ancestor of it, or a box the widening passed through is
///   `position: fixed`, or `position: absolute` covering at least 90% of the
///   viewport (a layer, not the page);
/// - the control is what the page hit-tests at its centre, and is in the
///   viewport;
/// - the box holds no text field, `select`, `textarea`, password or email
///   input (checkboxes and radios are a preference pane's), no `h1` and no
///   `main`, so a sign-in or newsletter modal is never one;
/// - the box carries at most 1,500 visible characters, while the page shows
///   at least 200 outside it (a page that is only its notice is a wall, and
///   is read as before).
///
/// The box is hidden with an inline `display: none !important` and marked
/// with [`COOKIE_NOTICE_MARK`]; nothing is clicked. A lock layer beside it is
/// hidden too: a sibling `div` or `span` with no element children and no
/// text, `position: fixed`, covering at least 90% of the viewport, with no
/// background image and a fill under alpha 0.9, a positive `z-index`, and
/// what the page hit-tests at one of five points while the notice still
/// shows. When the notice covered at least half the viewport, or a lock
/// layer went with it, an inline `filter` of one `blur()` of 12px or less on
/// `html`, `body` or an element up to two levels below `body` outside the
/// notice, covering at least half the viewport, is removed (`unlocked`:
/// `filter <name>`), and so is an inline `overflow` / `overflow-y: hidden`
/// on `html` or `body` when no other dialog is showing.
fn cookie_notice_js() -> String {
    format!(
        r#"const COOKIE_MARK = {mark};
  const cookieNotices = out => {{
    const name = {name};
    const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
    const body = document.body;
    if (!body || !vw || !vh) return;
    const names = [];
    const report = n => {{ if (!names.includes(n)) names.push(n); }};
    for (const el of q('[' + COOKIE_MARK + ']')) {{
      const n = el.getAttribute(COOKIE_MARK);
      if (n && !n.startsWith('lock ')) report(n);
      // A late script may rewrite the inline style of a notice or lock this
      // pass hid; hide it again.
      try {{
        if (getComputedStyle(el).display !== 'none') {{ el.style.setProperty('display', 'none', 'important'); out.changed = true; }}
      }} catch (e) {{}}
    }}
    // A whole label that accepts or refuses, in the languages the corpus
    // reads; and the softer labels that only dismiss.
    const strict = /^(?:(?:i )?(?:accept|agree|allow|reject|refuse|decline|deny)(?: (?:all|everything))?(?: (?:cookies|all cookies|non-essential|non-essential cookies|optional cookies|necessary|necessary cookies|essential|only necessary|necessary only|essential only|and close|and continue))?|alle(?: cookies)? (?:akzeptieren|ablehnen|zulassen|erlauben)|(?:akzeptieren|ablehnen|zustimmen|zulassen|einverstanden)|(?:tout |tous )?(?:accepter|refuser)(?: tout| et fermer| les cookies| tous les cookies)?|j.accepte|(?:aceptar|rechazar)(?: todo| todas| todas las cookies| cookies)?|(?:aceitar|rejeitar|recusar)(?: todos| tudo| cookies)?|(?:accetta|accetto|rifiuta)(?: tutti| tutto| i cookie)?|(?:alles )?(?:accepteren|weigeren)|接受|全部接受|接受全部|同意|全部同意|拒絕|拒绝|全部拒绝|允許|允许|동의|모두 동의|거부|허용|すべて同意|同意する|拒否|принять|принять все|отклонить|kabul et|tümünü kabul et|reddet)$/;
    const soft = /^(?:ok|okay|ok,? got it|got it|close|dismiss|understood|i understand|continue|schlie(?:ss|ß)en|verstanden|fermer|compris|d.accord|cerrar|entendido|fechar|entendi|chiudi|ho capito|確定|确定|知道了|닫기|확인|閉じる|закрыть|понятно|tamam|kapat)$/;
    const consentSentence = t => /\b(?:we|this (?:web)?site|site|our site|uses?|using|used|use of|wir|verwende[nt]?|nutzen|nous|utilise[sz]?|utilisons|usamos|utilizamos|utilizziamo|usiamo|gebruik(?:en|t)?)\b[^.!?]{{0,80}}cookie|cookie[^.!?]{{0,80}}\b(?:polic|setting|preference|richtlinie|einstellung|politique|param|pol[ií]tica|impostazion)|使用[^。]{{0,20}}cookie|cookie[^。]{{0,20}}(?:使用|政策|偏好)|쿠키/i.test(t);
    const labelOf = c => (c.innerText || c.value || c.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.!…→›»>]+$/u, '').trim();
    const shownText = el => (el.innerText || '').replace(/\s+/g, ' ').trim();
    const range = document.createRange();
    const ownText = root => {{
      let t = '';
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(), i = 0; n && i < 4000; n = w.nextNode(), i++) {{
        const p = n.parentElement;
        if (!p || p.closest('a, button, [role=button], script, style, noscript, template')) continue;
        // Rendered text only: a hidden cookie-policy panel inside a welcome
        // wrapper does not make the wrapper a notice. The text's own boxes
        // decide, not its parent's: a `display: contents` parent has none.
        range.selectNodeContents(n);
        if (!range.getClientRects().length) continue;
        let vis = 'visible';
        try {{ vis = getComputedStyle(p).visibility; }} catch (e) {{}}
        if (vis !== 'visible') continue;
        t += ' ' + n.data;
      }}
      return t;
    }};
    const covers = (r, share) => {{
      const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      return (w * h) / (vw * vh) >= share;
    }};
    const meets = r => r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
    // What a box shows of its own: visible text, controls and media.
    const content = el => {{
      let n = 0;
      for (const c of el.querySelectorAll('a[href], button, [role=button], input:not([type=hidden]), select, textarea, img, svg, video, canvas, iframe')) if (boxShows(c)) n++;
      return shownText(el).length * 1000 + n;
    }};
    const layered = el => {{
      for (let a = el; a && a !== body && a !== document.documentElement; a = a.parentElement) {{
        let cs;
        try {{ cs = getComputedStyle(a); }} catch (e) {{ return false; }}
        if (cs.position === 'fixed') return true;
        if (cs.position === 'absolute' && covers(a.getBoundingClientRect(), 0.9)) return true;
      }}
      return false;
    }};
    const isChoice = c => {{
      if (c.matches('a[href]')) {{
        const h = c.getAttribute('href') || '';
        if (!(h === '' || h.startsWith('#') || /^javascript:/i.test(h))) return false;
      }}
      return true;
    }};
    const pageChars = shownText(body).length;
    const found = [];
    const pick = 'button, [role=button], input[type=button], input[type=submit], a, [onclick], span, div, li';
    const all = body.querySelectorAll(pick);
    for (let i = 0; i < all.length && i < 20000; i++) {{
      const c = all[i];
      if (found.some(f => f.el.contains(c)) || c.closest('[' + COOKIE_MARK + ']')) continue;
      // Only an element that acts as a control: a button of some kind, or a
      // box with a click handler or a pointer cursor whose label is a choice.
      const kind = c.matches('button, [role=button], input[type=button], input[type=submit], a, [onclick]');
      let label = '';
      if (!kind) {{
        if (c.children.length > 2 || (c.textContent || '').length > 60) continue;
        label = labelOf(c);
        if (!label || label.length > {max_label} || !(strict.test(label) || soft.test(label))) continue;
        try {{ if (getComputedStyle(c).cursor !== 'pointer') continue; }} catch (e) {{ continue; }}
        if (c.parentElement && c.parentElement.closest('button, [role=button], a, [onclick]')) continue;
      }} else {{
        if (!isChoice(c)) continue;
        label = labelOf(c);
      }}
      if (!label || label.length > {max_label}) continue;
      const isStrict = strict.test(label);
      if (!isStrict && !soft.test(label)) continue;
      if (!boxShows(c)) continue;
      const cr = c.getBoundingClientRect();
      if (!meets(cr)) continue;
      // The nearest ancestor whose own text names cookies.
      let box = c.parentElement;
      for (let k = 0; box && box !== body && k < 10 && !/cookie/i.test(ownText(box)); k++) box = box.parentElement;
      if (!box || box === body || box === document.documentElement) continue;
      if (!/cookie/i.test(ownText(box))) continue;
      if (!isStrict && !consentSentence(ownText(box))) continue;
      // Up through every ancestor that adds nothing of its own.
      const chain = [box];
      let have = content(box);
      for (let a = box.parentElement; a && a !== body && a !== document.documentElement; a = a.parentElement) {{
        const more = content(a);
        if (more !== have) break;
        chain.push(a);
        box = a;
      }}
      // On a layer: the box, an ancestor, or a box the widening passed
      // through (ktk.de's dialog sits in a layer inside a static wrapper).
      if (!chain.some(layered)) continue;
      if (!showing(box)) continue;
      const text = shownText(box);
      if (!text || text.length > {max_text}) continue;
      if (box.querySelector('h1, main, textarea, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset])')) continue;
      if (pageChars - text.length < {min_outside}) continue;
      const x = Math.min(vw - 1, Math.max(0, cr.left + cr.width / 2)), y = Math.min(vh - 1, Math.max(0, cr.top + cr.height / 2));
      const hit = document.elementFromPoint(x, y);
      if (!hit || !box.contains(hit)) continue;
      const wide = chain.some(el => covers(el.getBoundingClientRect(), 0.5)) || Array.from(box.querySelectorAll('*')).slice(0, 400).some(el => {{
        try {{ const p = getComputedStyle(el).position; return (p === 'fixed' || p === 'absolute') && covers(el.getBoundingClientRect(), 0.5); }} catch (e) {{ return false; }}
      }});
      const cls = Array.from(box.classList || []).find(k => /^[A-Za-z_][\w-]*$/.test(k));
      const n = box.tagName.toLowerCase() + (box.id ? '#' + box.id : box.getAttribute('role') ? '[role=' + box.getAttribute('role') + ']' : cls ? '.' + cls : '');
      // A lock layer beside it: empty, see-through or dimming, above the page,
      // and taking hit tests while the notice shows.
      const locks = [];
      const parent = box.parentElement;
      if (parent && parent !== document.documentElement) {{
        const points = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]].map(([px, py]) => [Math.floor(vw * px), Math.floor(vh * py)]);
        for (const sib of Array.from(parent.children)) {{
          if (sib === box || !sib.matches('div, span') || sib.children.length || shownText(sib) || sib.hasAttribute(COOKIE_MARK)) continue;
          let scs;
          try {{ scs = getComputedStyle(sib); }} catch (e) {{ continue; }}
          if (scs.position !== 'fixed' || scs.display === 'none' || !covers(sib.getBoundingClientRect(), 0.9)) continue;
          if (scs.backgroundImage !== 'none') continue;
          const m = /rgba?\(([^)]*)\)/.exec(scs.backgroundColor || '');
          const parts = m ? m[1].split(/[\s,/]+/).filter(Boolean) : [];
          const a = parts.length >= 4 ? parseFloat(parts[3]) : (m ? 1 : 0);
          if (!(a < 0.9)) continue;
          if (!(parseInt(scs.zIndex, 10) > 0)) continue;
          if (!points.some(([px, py]) => document.elementFromPoint(px, py) === sib)) continue;
          locks.push(sib);
        }}
      }}
      found.push({{ el: box, name: n, wide, locks }});
    }}
    let unblur = false;
    for (const f of found) {{
      f.el.setAttribute(COOKIE_MARK, f.name);
      f.el.style.setProperty('display', 'none', 'important');
      report(f.name);
      out.changed = true;
      for (const sib of f.locks) {{
        sib.setAttribute(COOKIE_MARK, 'lock ' + f.name);
        sib.style.setProperty('display', 'none', 'important');
      }}
      unblur = unblur || f.wide || f.locks.length > 0;
    }}
    if (!names.length) return;
    if (unblur) {{
      const notice = el => !!el.closest('[' + COOKIE_MARK + ']');
      const describe = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
      const near = [document.documentElement, body];
      for (const c of Array.from(body.children)) {{ near.push(c); for (const g of Array.from(c.children)) near.push(g); }}
      for (const el of near) {{
        // Only a box the size of the page, and only a light blur: a blurred
        // decoration or a paywalled teaser keeps its own.
        if (notice(el) || !covers(el.getBoundingClientRect(), 0.5)) continue;
        const f = el.style.getPropertyValue('filter');
        const m = /^\s*blur\(\s*([\d.]+)px\s*\)\s*$/.exec(f || '');
        if (m && parseFloat(m[1]) <= {max_blur}) {{ el.style.removeProperty('filter'); out.unlocked.push('filter ' + describe(el)); out.changed = true; }}
      }}
      const otherDialog = q('dialog[open], [aria-modal="true"], [role="dialog"], [role="alertdialog"]').some(el => !notice(el) && showing(el));
      if (!otherDialog) for (const [el, tag] of [[document.documentElement, 'html'], [body, 'body']]) {{
        for (const p of ['overflow', 'overflow-y']) {{
          if (el.style.getPropertyValue(p) === 'hidden') {{ el.style.removeProperty(p); out.unlocked.push(tag + ' style ' + p); out.changed = true; }}
        }}
      }}
    }}
    if (!out.hidden.includes(name)) out.hidden.push(name);
    out.matched[name] = (out.matched[name] || []).concat(names.filter(n => !(out.matched[name] || []).includes(n)));
  }};"#,
        mark = json!(COOKIE_NOTICE_MARK),
        name = json!(COOKIE_NOTICE),
        max_text = COOKIE_NOTICE_MAX_TEXT,
        min_outside = COOKIE_NOTICE_MIN_OUTSIDE_TEXT,
        max_label = COOKIE_NOTICE_MAX_LABEL,
        max_blur = COOKIE_NOTICE_MAX_BLUR_PX,
    )
}

/// The hide step. Idempotent: run it once before the reveal sweep and again
/// right before the capture, to catch a manager that injects its banner late.
/// Returns `{ hidden: [name], matched: { name: [selector] }, unlocked: [what],
/// changed }` for the managers it found showing this time; `changed` is
/// whether this run altered the page (a new rule, an inline hide, an unlock).
pub fn hide_js() -> String {
    format!(
        r#"(() => {{
  const managers = {managers};
  const STYLE_ID = {style_id};
  const INLINE_MARK = {inline_mark};
  {showing}
  const out = {{ hidden: [], matched: {{}}, unlocked: [], changed: false }};
  const present = [];
  for (const m of managers) {{
    const sels = m.roots.concat(m.backdrops).filter(s => q(s).length > 0);
    if (sels.length) present.push({{ m, sels }});
  }}
  {cookie_notices}
  if (!present.length) {{ cookieNotices(out); return out; }}
  let style = document.getElementById(STYLE_ID);
  // Measure with the hide rule off, so a banner the rule already hides (one
  // injected after the first pass) is still reported. Nothing paints between
  // disabling and re-enabling it: this runs in one task.
  if (style) style.disabled = true;
  // So are the inline hides an earlier pass stamped, while they are still
  // its own (a manager that has since set its own display keeps it).
  const lifted = q('[' + INLINE_MARK + ']').filter({stamp_is_ours});
  for (const el of lifted) {{
    let prev = ['', ''];
    try {{ prev = JSON.parse(el.getAttribute(INLINE_MARK)); }} catch (e) {{}}
    if (prev[0]) el.style.setProperty('display', prev[0], prev[1]); else el.style.removeProperty('display');
  }}
  const showingBackdrop = [];
  for (const {{ m, sels }} of present) {{
    const on = sels.filter(s => q(s).some(showing));
    if (on.length) {{
      out.hidden.push(m.name);
      out.matched[m.name] = on;
      if (on.some(s => m.backdrops.includes(s))) showingBackdrop.push(m.name);
    }}
  }}
  if (!style) {{
    style = document.createElement('style');
    style.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }}
  style.disabled = false;
  for (const el of lifted) el.style.setProperty('display', 'none', 'important');
  const rules = [];
  for (const {{ sels }} of present) for (const s of sels) rules.push(s + ' {{ display: none !important; }}');
  const text = rules.join('\n');
  if (style.textContent !== text) {{ style.textContent = text; out.changed = true; }}
  // A manager that sets `display` inline with !important outranks the rule.
  for (const {{ sels }} of present) for (const s of sels) for (const el of q(s)) {{
    try {{
      if (getComputedStyle(el).display !== 'none') {{
        // Kept, so a later read can see the element as the manager left it.
        if (!el.hasAttribute(INLINE_MARK)) el.setAttribute(INLINE_MARK, JSON.stringify([el.style.getPropertyValue('display'), el.style.getPropertyPriority('display')]));
        el.style.setProperty('display', 'none', 'important');
        out.changed = true;
      }}
    }} catch (e) {{}}
  }}
  // Undo the scroll lock the manager applied, and only that: its own classes
  // on <html> and <body>, and an inline overflow: hidden on either while its
  // backdrop was up (a modal consent layer locks the page that way), the
  // page is not an app shell that scrolls inside itself, and no modal of the
  // site's own is open. A site's own overflow is left alone.
  const html = document.documentElement;
  const body = document.body;
  for (const {{ m }} of present) {{
    if (!out.hidden.includes(m.name)) continue;
    for (const c of m.htmlLock) if (html.classList.contains(c)) {{ html.classList.remove(c); out.unlocked.push('html.' + c); }}
    if (body) for (const c of m.bodyLock) if (body.classList.contains(c)) {{ body.classList.remove(c); out.unlocked.push('body.' + c); }}
    // The aria-hidden the manager put on the page behind its dialog, read off
    // the manager's own mark, so an aria-hidden the site set stays.
    for (const mark of m.ariaMarks) {{
      let n = 0;
      for (const el of q('[' + mark + ']')) {{
        if (el.getAttribute('aria-hidden') === 'true') {{ el.removeAttribute('aria-hidden'); n++; }}
      }}
      if (n && !out.unlocked.includes('aria-hidden [' + mark + ']')) out.unlocked.push('aria-hidden [' + mark + ']');
    }}
  }}
  // An app shell locks <body> itself and scrolls an inner container that
  // fills the viewport. That lock is the site's, whatever the manager did,
  // so it stays.
  const appShell = () => {{
    const all = body ? body.querySelectorAll('*') : [];
    const vh = window.innerHeight || 0;
    for (let i = 0; i < all.length && i < 5000; i++) {{
      const el = all[i];
      if (el.clientHeight < vh * 0.5 || el.scrollHeight <= el.clientHeight + 1) continue;
      if (present.some(({{ sels }}) => sels.some(s => {{ try {{ return !!el.closest(s); }} catch (e) {{ return false; }} }}))) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') return true;
    }}
    return false;
  }};
  // The site's own modal, open beside the consent layer, may hold the lock
  // itself: an inline overflow: hidden is then left alone.
  const siteModal = () => q('dialog[open], [aria-modal="true"], [role="dialog"], [role="alertdialog"]').some(el =>
    !present.some(({{ sels }}) => sels.some(s => {{ try {{ return !!el.closest(s); }} catch (e) {{ return false; }} }}))
      && showing(el));
  if (showingBackdrop.length && !appShell() && !siteModal()) {{
    for (const [el, tag] of [[html, 'html'], [body, 'body']]) {{
      if (!el) continue;
      for (const p of ['overflow', 'overflow-y']) {{
        if (el.style.getPropertyValue(p) === 'hidden') {{
          el.style.removeProperty(p);
          out.unlocked.push(tag + ' style ' + p);
        }}
      }}
    }}
  }}
  if (out.unlocked.length) out.changed = true;
  cookieNotices(out);
  return out;
}})()"#,
        managers = managers_json(),
        style_id = json!(HIDE_STYLE_ID),
        inline_mark = json!(INLINE_HIDE_MARK),
        showing = SHOWING_JS,
        stamp_is_ours = STAMP_IS_OURS_JS,
        cookie_notices = cookie_notice_js(),
    )
}

/// What the hide step did over a scan: the managers it hid, the selectors
/// that matched a showing element, and the scroll locks it undid.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ConsentReport {
    /// Managers whose banner or backdrop was showing and was hidden, in
    /// [`CONSENT_MANAGERS`] order.
    pub hidden: Vec<String>,
    /// Per hidden manager, the selectors that matched a showing element.
    pub matched: Vec<(String, Vec<String>)>,
    /// The scroll locks undone (`body.didomi-popup-open`, `body style overflow`).
    pub unlocked: Vec<String>,
}

impl ConsentReport {
    /// Fold one hide-step result into the report.
    pub fn merge(&mut self, v: &Value) {
        let strs = |v: Option<&Value>| -> Vec<String> {
            v.and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
                .unwrap_or_default()
        };
        for name in strs(v.get("hidden")) {
            let sels = strs(v.get("matched").and_then(|m| m.get(&name)));
            match self.matched.iter_mut().find(|(n, _)| *n == name) {
                Some((_, have)) => {
                    for s in sels {
                        if !have.contains(&s) {
                            have.push(s);
                        }
                    }
                }
                None => self.matched.push((name.clone(), sels)),
            }
            if !self.hidden.contains(&name) {
                self.hidden.push(name);
            }
        }
        for u in strs(v.get("unlocked")) {
            if !self.unlocked.contains(&u) {
                self.unlocked.push(u);
            }
        }
        let order = |n: &String| CONSENT_MANAGERS.iter().position(|m| m.name == n).unwrap_or(usize::MAX);
        self.hidden.sort_by_key(order);
        self.matched.sort_by_key(|(n, _)| order(n));
    }

    pub fn to_value(&self) -> Value {
        let matched: serde_json::Map<String, Value> = self
            .matched
            .iter()
            .map(|(n, s)| (n.clone(), json!(s)))
            .collect();
        json!({ "hidden": self.hidden, "matched": matched, "unlocked": self.unlocked })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// No selector is a bare generic word: each names its vendor, or is an id
    /// or class the vendor's own markup carries.
    #[test]
    fn selectors_are_vendor_specific() {
        let generic = ["cookie", "cookies", "consent", "banner", "gdpr", "privacy", "cookie-banner", "cookie-consent", "consent-banner", "modal", "overlay"];
        for m in CONSENT_MANAGERS {
            for s in m.roots.iter().chain(m.backdrops) {
                let bare = s.trim_start_matches(['#', '.']).to_ascii_lowercase();
                assert!(!generic.contains(&bare.as_str()), "{}: {s} is generic", m.name);
            }
        }
    }

    #[test]
    fn every_requested_vendor_is_listed() {
        for name in [
            "OneTrust", "Cookiebot", "Usercentrics", "TrustArc", "Didomi", "Quantcast Choice", "Sourcepoint",
            "Osano", "CookieYes", "Complianz", "iubenda", "Termly", "Axeptio", "Borlabs Cookie", "Klaro",
            "Cookie Notice", "Shopify", "consentmanager", "Tealium", "Transcend", "Enzuzo", "Tarteaucitron",
        ] {
            assert!(CONSENT_MANAGERS.iter().any(|m| m.name == name), "{name}");
        }
    }

    #[test]
    fn report_merges_passes_in_list_order() {
        let mut r = ConsentReport::default();
        r.merge(&json!({ "hidden": ["Cookiebot"], "matched": { "Cookiebot": ["#CybotCookiebotDialog"] }, "unlocked": [] }));
        r.merge(&json!({
            "hidden": ["OneTrust", "Cookiebot"],
            "matched": { "OneTrust": ["#onetrust-consent-sdk"], "Cookiebot": ["#CybotCookiebotDialog", "#CybotCookiebotDialogBodyUnderlay"] },
            "unlocked": ["body style overflow"],
        }));
        assert_eq!(r.hidden, vec!["OneTrust", "Cookiebot"]);
        assert_eq!(
            r.to_value(),
            json!({
                "hidden": ["OneTrust", "Cookiebot"],
                "matched": {
                    "OneTrust": ["#onetrust-consent-sdk"],
                    "Cookiebot": ["#CybotCookiebotDialog", "#CybotCookiebotDialogBodyUnderlay"],
                },
                "unlocked": ["body style overflow"],
            })
        );
    }

    #[test]
    fn scripts_embed_every_selector() {
        let (probe, hide) = (probe_fragment(), hide_js());
        for m in CONSENT_MANAGERS {
            for s in m.roots.iter().chain(m.backdrops) {
                let quoted = serde_json::to_string(s).unwrap();
                assert!(hide.contains(&quoted), "{s}");
                assert!(probe.contains(&quoted), "{s}");
            }
        }
    }
}
