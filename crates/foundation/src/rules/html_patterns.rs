//! The corpora the HTML-pattern scan is run against. Building them and
//! scanning them lives in the detector.

use serde::{Deserialize, Serialize};

/// JS `{ styleText, classText }`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct HtmlPatternCorpora {
    pub style_text: String,
    pub class_text: String,
}
