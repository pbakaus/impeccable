//! Thin adapters over `impeccable_core::checks::measures` (`resolveVarRefs`,
//! `resolveLengthPx`) for the cascade's ordered custom-property map. The
//! pure logic lives in core; this module only bridges the map type.

use impeccable_core::checks::measures;

/// An ordered `--name -> value` map (JS `Map<string,string>`).
pub type CustomProps = indexmap::IndexMap<String, String>;

/// JS: checks.mjs#resolveVarRefs(raw, customPropMap, depth = 0), via core.
pub fn resolve_var_refs(raw: &str, custom_props: &CustomProps) -> String {
    let lookup = |name: &str| custom_props.get(name).cloned();
    measures::resolve_var_refs(raw, &lookup, 0)
}

/// JS: checks.mjs#resolveLengthPx(value, fontSizePx), via core.
pub fn resolve_length_px(value: &str, font_size_px: f64) -> Option<f64> {
    measures::resolve_length_px(Some(value), font_size_px)
}
