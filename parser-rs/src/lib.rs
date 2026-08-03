pub mod model;
pub mod tokenizer;
pub mod parser;
pub mod mermaid;

pub use model::{
    Column, ParseError, ParseResult, Ref, Schema, Table, TableGroup,
};
pub use mermaid::to_mermaid;

/// Parse DBML source into a `ParseResult` (fail-fast, first error only).
pub fn parse_dbml(src: &str) -> ParseResult {
    parser::parse(src)
}
