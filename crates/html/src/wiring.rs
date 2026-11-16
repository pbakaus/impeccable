//! The wiring inventory `detect --before` / `--kept` compare (#1291), read
//! from a static HTML page. Item keys, the comparison and the saved file live
//! in `impeccable_detect::wiring`; this module only walks the parsed page.
//!
//! Keys apply the HTML defaults (form method `get`, input type `text`,
//! button type `submit`) and lowercase enumerated values, so spelling out a
//! default or changing case is not a change. Attribute values are
//! JSON-quoted; `id`, test-hook and `label[for]` values are kept exactly, since
//! a script or test looks them up exactly (`href` and `src` are trimmed, as
//! URL parsing trims them). Handler and inline script bodies are hashed after their
//! whitespace is collapsed.

use impeccable_detect::wiring::{collapse_ws, quote, short_hash, WiringInventory};
use scraper::ElementRef;

use crate::dom::parse_html;

/// The attributes the inventory treats as test hooks.
pub const TEST_HOOK_ATTRS: &[&str] = &["data-testid", "data-test", "data-cy", "data-qa", "data-test-id"];

/// Input types that act as buttons rather than fields.
const BUTTON_INPUT_TYPES: &[&str] = &["submit", "reset", "button", "image"];

/// The inventory of one page's source.
pub fn wiring_inventory_source(source: &str) -> WiringInventory {
    let html = parse_html(source);
    let mut inv = WiringInventory::default();
    for node in html.tree.nodes() {
        let Some(el) = ElementRef::wrap(node) else { continue };
        collect(&el, &mut inv);
    }
    inv.sorted()
}

fn lower_attr(el: &ElementRef, name: &str) -> Option<String> {
    el.value().attr(name).map(|v| v.trim().to_ascii_lowercase())
}

fn collect(el: &ElementRef, inv: &mut WiringInventory) {
    let e = el.value();
    let tag = e.name().to_ascii_lowercase();
    let w = &mut inv.wiring;
    match tag.as_str() {
        "a" => {
            if let Some(href) = e.attr("href") {
                w.push(format!("link href={}", quote(href.trim())));
            }
        }
        "form" => {
            let action = e.attr("action").unwrap_or("").trim();
            let method = lower_attr(el, "method").filter(|m| !m.is_empty()).unwrap_or_else(|| "get".into());
            w.push(format!("form action={} method={}", quote(action), quote(&method)));
        }
        "input" => {
            let kind = lower_attr(el, "type").filter(|t| !t.is_empty()).unwrap_or_else(|| "text".into());
            if BUTTON_INPUT_TYPES.contains(&kind.as_str()) {
                let mut key = format!("button input type={}", quote(&kind));
                if let Some(name) = e.attr("name") {
                    key.push_str(&format!(" name={}", quote(name)));
                }
                w.push(key);
            } else if let Some(name) = e.attr("name") {
                let mut key = format!("field input name={} type={}", quote(name), quote(&kind));
                if kind == "radio" || kind == "checkbox" {
                    key.push_str(&format!(" value={}", quote(e.attr("value").unwrap_or("on"))));
                }
                if e.attr("required").is_some() {
                    key.push_str(" required");
                }
                w.push(key);
            }
        }
        "select" | "textarea" => {
            if let Some(name) = e.attr("name") {
                let mut key = format!("field {tag} name={}", quote(name));
                if e.attr("required").is_some() {
                    key.push_str(" required");
                }
                w.push(key);
            }
        }
        "button" => {
            let kind = lower_attr(el, "type").filter(|t| !t.is_empty()).unwrap_or_else(|| "submit".into());
            let mut key = format!("button type={}", quote(&kind));
            if let Some(name) = e.attr("name") {
                key.push_str(&format!(" name={}", quote(name)));
            }
            if let Some(value) = e.attr("value") {
                key.push_str(&format!(" value={}", quote(value)));
            }
            w.push(key);
        }
        "script" => match e.attr("src") {
            Some(src) => w.push(format!("script src={}", quote(src.trim()))),
            None => {
                let body: String = el.text().collect();
                if !collapse_ws(&body).is_empty() {
                    w.push(format!("script inline #{}", short_hash(&body)));
                }
            }
        },
        "label" => {
            if let Some(target) = e.attr("for") {
                w.push(format!("label for={}", quote(target)));
            }
        }
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
            let text: String = el.text().collect();
            inv.content.push(format!("heading {tag} {}", quote(&collapse_ws(&text))));
        }
        "img" => {
            if let Some(alt) = e.attr("alt") {
                inv.content.push(format!("image alt={}", quote(&collapse_ws(alt))));
            }
        }
        _ => {}
    }
    let mut attrs: Vec<(&str, &str)> = e.attrs().collect();
    attrs.sort();
    for (name, value) in attrs {
        let name_lower = name.to_ascii_lowercase();
        if name_lower == "id" {
            inv.wiring.push(format!("id {}", quote(value)));
        } else if TEST_HOOK_ATTRS.contains(&name_lower.as_str()) {
            inv.wiring.push(format!("test-hook {name_lower}={}", quote(value)));
        } else if name_lower.len() > 2 && name_lower.starts_with("on") {
            inv.wiring.push(format!("handler {tag} {name_lower} #{}", short_hash(value)));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_case_do_not_change_keys() {
        let a = wiring_inventory_source("<form><input name=q><button>Go</button></form>");
        let b = wiring_inventory_source("<form method=GET><input name=q type=TEXT><button type=submit>Go</button></form>");
        assert_eq!(a, b);
    }
}
