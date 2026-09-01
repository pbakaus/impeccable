//! JS: live/vocabulary.mjs and live/ui-surfaces.mjs. The command palette the
//! server serializes into `/live.js`, the protocol enums the validator and
//! the server share, and the Live chrome inventory.

use serde_json::{json, Value};

const ICON_ATTRS: &str = r#"width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block""#;

/// (value, label, icon body between `<svg ...>` and `</svg>`)
const COMMANDS: [(&str, &str, &str); 12] = [
    (
        "impeccable",
        "Freeform",
        r#"<path d="M4 20l4-1L18 9l-3-3L5 16z"/><path d="M14 7l3 3"/>"#,
    ),
    (
        "bolder",
        "Bolder",
        r#"<rect x="6" y="12" width="4" height="7" rx="0.5"/><rect x="14" y="5" width="4" height="14" rx="0.5"/>"#,
    ),
    (
        "quieter",
        "Quieter",
        r#"<rect x="6" y="5" width="4" height="14" rx="0.5"/><rect x="14" y="12" width="4" height="7" rx="0.5"/>"#,
    ),
    (
        "distill",
        "Distill",
        r#"<path d="M4 5h16l-6 8v7l-4-2v-5z"/>"#,
    ),
    (
        "polish",
        "Polish",
        r#"<path d="M15 3l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/><path d="M7 13l0.6 1.8 1.8 0.6-1.8 0.6-0.6 1.8-0.6-1.8-1.8-0.6 1.8-0.6z"/>"#,
    ),
    (
        "typeset",
        "Typeset",
        r#"<path d="M5 6h14" stroke-width="2.6"/><path d="M5 12h9" stroke-width="1.9"/><path d="M5 18h5" stroke-width="1.3"/>"#,
    ),
    (
        "colorize",
        "Colorize",
        r#"<circle cx="9" cy="10" r="5"/><circle cx="15" cy="10" r="5"/><circle cx="12" cy="15" r="5"/>"#,
    ),
    (
        "layout",
        "Layout",
        r#"<rect x="3" y="4" width="8" height="16" rx="0.5"/><rect x="13" y="4" width="8" height="7" rx="0.5"/><rect x="13" y="13" width="8" height="7" rx="0.5"/>"#,
    ),
    (
        "adapt",
        "Adapt",
        r#"<rect x="2.5" y="5" width="12" height="11" rx="1"/><line x1="2.5" y1="19" x2="14.5" y2="19"/><rect x="16.5" y="8" width="5" height="11" rx="1"/>"#,
    ),
    (
        "animate",
        "Animate",
        r#"<path d="M3 18c4-4 6-10 10-10"/><path d="M13 8c3 0 5 5 8 10"/><circle cx="13" cy="8" r="1.6" fill="currentColor" stroke="none"/>"#,
    ),
    (
        "delight",
        "Delight",
        r#"<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>"#,
    ),
    (
        "overdrive",
        "Overdrive",
        r#"<path d="M13 3L5 13h5l-1 8 9-12h-6z"/>"#,
    ),
];

/// JS: LIVE_COMMANDS as the JSON array the server serializes.
pub fn live_commands() -> Value {
    Value::Array(
        COMMANDS
            .iter()
            .map(|(value, label, body)| {
                json!({
                    "value": value,
                    "label": label,
                    "icon": format!("<svg {}>{}</svg>", ICON_ATTRS, body),
                })
            })
            .collect(),
    )
}

/// JS: VISUAL_ACTIONS (palette order).
pub const VISUAL_ACTIONS: [&str; 12] = [
    "impeccable",
    "bolder",
    "quieter",
    "distill",
    "polish",
    "typeset",
    "colorize",
    "layout",
    "adapt",
    "animate",
    "delight",
    "overdrive",
];

/// JS: AGENT_PHASES
pub const AGENT_PHASES: [&str; 8] = [
    "picked_up",
    "scaffolding",
    "source_ready",
    "scaffold_fallback",
    "generation_ready",
    "first_reviewable",
    "second_reviewable",
    "all_variants_ready",
];

/// JS: VARIANT_PROGRESS_CHECKPOINT_REASONS
pub const VARIANT_PROGRESS_CHECKPOINT_REASONS: [&str; 2] = ["variants_progress", "variants_ready"];

/// JS: LIVE_CHROME_MOUNT_CONTRACT
pub const LIVE_CHROME_MOUNT_CONTRACT: [&str; 4] = ["root", "transport", "state", "actions"];

const LIVE_UI_PREFIX: &str = "impeccable-live";

const SURFACES: [(&str, &[&str]); 14] = [
    (
        "global-bottom-bar",
        &[
            "global-bar",
            "global-bar-brand",
            "pick-toggle",
            "insert-toggle",
            "detect-toggle",
            "detect-badge",
            "design-toggle",
            "page-chat",
            "page-chat-input",
            "page-chat-voice",
            "page-chat-send",
        ],
    ),
    ("pending-copy-edit-dock", &["pending-dock"]),
    (
        "element-selection-chrome",
        &[
            "highlight",
            "tooltip",
            "bar",
            "selection-pill",
            "input",
            "configure-voice",
            "configure-bar-tooltip",
        ],
    ),
    ("action-picker", &["picker"]),
    ("edit-chrome", &["edit-badge"]),
    ("generating-row", &["bar", "shader"]),
    ("variant-cycling-row", &["bar", "params-panel"]),
    ("variant-params-panel", &["params-panel"]),
    ("saving-confirmed-rows", &["bar"]),
    (
        "insert-mode-chrome",
        &[
            "insert-line",
            "insert-placeholder",
            "placeholder-resize",
            "insert-input",
            "insert-voice",
            "insert-create",
            "insert-create-tooltip",
        ],
    ),
    (
        "annotation-chrome",
        &["annot", "annot-svg", "annot-pins", "annot-clear"],
    ),
    ("design-system-panel", &["design-host"]),
    ("toasts-and-errors", &["toast", "mount-error"]),
    ("css-isolation-boundary", &["root"]),
];

/// JS: LIVE_UI_SURFACES as JSON.
pub fn live_ui_surfaces() -> Value {
    Value::Array(
        SURFACES
            .iter()
            .map(|(key, ids)| {
                json!({
                    "key": key,
                    "ids": ids.iter().map(|s| format!("{}-{}", LIVE_UI_PREFIX, s)).collect::<Vec<_>>(),
                })
            })
            .collect(),
    )
}
