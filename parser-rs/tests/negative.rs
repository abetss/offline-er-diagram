use parser_rs::parse_dbml;

// One test per grammar §9 row: assert ok:false, the error line, and message.

fn expect_error(dbml: &str, line: u32, message: &str) {
    let r = parse_dbml(dbml);
    assert!(!r.ok, "expected ok:false for input:\n{}", dbml);
    assert!(r.schema.is_none(), "schema must be None on error");
    let e = r.error.expect("error present when !ok");
    assert_eq!(e.line, line, "wrong error line for input:\n{}", dbml);
    assert_eq!(e.message, message, "wrong error message for input:\n{}", dbml);
}

#[test]
fn unknown_top_level_construct() {
    expect_error("Widget foo {\n}\n", 1, "Unexpected 'Widget' at top level");
}

#[test]
fn schema_qualified_table_name() {
    expect_error(
        "Table public.users {\n  id uuid\n}\n",
        1,
        "Schema-qualified names are not supported",
    );
}

#[test]
fn schema_qualified_ref_name() {
    // 3-part qualified in a ref
    expect_error(
        "Ref: public.users.id > accounts.id\n",
        1,
        "Schema-qualified names are not supported",
    );
}

#[test]
fn composite_foreign_keys() {
    expect_error(
        "Ref: (a, b) > (c, d)\n",
        1,
        "Composite foreign keys are not supported",
    );
}

#[test]
fn unknown_column_setting() {
    expect_error(
        "Table t {\n  id int [bogus]\n}\n",
        2,
        "Unknown column setting 'bogus'",
    );
}

#[test]
fn unterminated_string() {
    expect_error(
        "Table t {\n  id int [note: 'oops]\n}\n",
        2,
        "Unterminated string (opened at line 2)",
    );
}

#[test]
fn duplicate_table_name() {
    expect_error(
        "Table t {\n  id int\n}\nTable t {\n  id int\n}\n",
        4,
        "Duplicate table name 't'",
    );
}

#[test]
fn column_missing_type() {
    expect_error("Table t {\n  id\n}\n", 2, "Column 'id' is missing a type");
}
