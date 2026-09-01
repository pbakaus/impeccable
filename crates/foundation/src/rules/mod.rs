//! The plain-data vocabulary of the rule set: the hit and option structs the
//! element checks are written against (`types`), the selector and tag lists
//! plus text parsers the text rules share (`text`), and the HTML-pattern
//! corpora (`html_patterns`).

pub mod html_patterns;
pub mod text;
pub mod types;
