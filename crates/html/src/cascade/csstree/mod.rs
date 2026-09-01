//! A port of the css-tree 3.2.1 subset that `collectStaticCssRules` relies
//! on: `csstree.parse(cssText, { positions: false, parseValue: true,
//! parseCustomProperty: false })` for a stylesheet, and `csstree.generate`
//! for rule preludes and declaration values. See `rules.rs` for the list of
//! css-tree behaviors the cascade port reproduces through this module.

pub mod ast;
pub mod generator;
pub mod parser;
pub mod strings;
pub mod tokenizer;

pub use ast::{Important, Node};
pub use generator::generate;
pub use parser::{parse_stylesheet, ParseError};
