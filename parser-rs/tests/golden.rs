use parser_rs::parse_dbml;
use serde_json::Value;
use std::path::PathBuf;

fn fixtures_dir() -> PathBuf {
    // parser-rs/../fixtures
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("fixtures");
    p
}

fn read_fixture(name: &str) -> String {
    let mut p = fixtures_dir();
    p.push(name);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {:?}: {}", p, e))
}

fn parse_to_schema_value(dbml: &str) -> Value {
    let result = parse_dbml(dbml);
    assert!(result.ok, "expected ok:true, got error: {:?}", result.error);
    let schema = result.schema.expect("schema present when ok");
    // Serialize the schema through serde, then re-parse as Value for deep-equal.
    let s = serde_json::to_string(&schema).expect("serialize schema");
    serde_json::from_str(&s).expect("reparse schema json")
}

#[test]
fn golden_sample_deep_equals() {
    let dbml = read_fixture("sample.dbml");
    let expected: Value =
        serde_json::from_str(&read_fixture("sample.expected.json")).expect("parse expected");
    let got = parse_to_schema_value(&dbml);
    assert_eq!(got, expected, "sample.dbml schema does not match expected");
}

#[test]
fn golden_demo_deep_equals() {
    let dbml = read_fixture("demo.dbml");
    let expected: Value =
        serde_json::from_str(&read_fixture("demo.expected.json")).expect("parse expected");
    let got = parse_to_schema_value(&dbml);
    assert_eq!(got, expected, "demo.dbml schema does not match expected");
}

// Real production schema (authored for dbdiagram.io). Exercises double-quoted
// strings used as BOTH note values (`note: "..."`) and column types (`"text[]"`).
#[test]
fn care_marketplace_parses() {
    let dbml = read_fixture("care_marketplace.dbml");
    let result = parse_dbml(&dbml);
    assert!(result.ok, "expected ok:true, got error: {:?}", result.error);
    let schema = result.schema.expect("schema present when ok");

    assert_eq!(schema.tables.len(), 17, "table count");
    assert_eq!(schema.groups.len(), 8, "group count");

    let col = |table: &str, col: &str| -> (String, Option<String>) {
        let t = schema
            .tables
            .iter()
            .find(|t| t.name == table)
            .unwrap_or_else(|| panic!("table {} not found", table));
        let c = t
            .columns
            .iter()
            .find(|c| c.name == col)
            .unwrap_or_else(|| panic!("column {}.{} not found", table, col));
        (c.col_type.clone(), c.note.clone())
    };

    // Double-quoted NOTE value: inner text captured (no surrounding quotes).
    let (_, role_note) = col("users", "role");
    assert!(
        role_note.as_deref().unwrap().starts_with("CHECK role IN"),
        "role note: {:?}",
        role_note
    );

    // Double-quoted TYPES: verbatim source slice keeps the surrounding quotes.
    assert_eq!(col("caregiver_profiles", "location").0, "\"geography(Point,4326)\"");
    assert_eq!(col("caregiver_profiles", "languages").0, "\"text[]\"");
    assert_eq!(col("app_config_audit", "id").0, "\"bigint\"");
}
