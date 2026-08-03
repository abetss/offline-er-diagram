use parser_rs::parse_dbml;

// §4.3 from-note dedup: an explicit (or inline) ref suppresses a duplicate
// from-note ref with the same (fromTable, fromColumn, toTable, toColumn).
#[test]
fn from_note_dedup_explicit_wins() {
    let dbml = "\
Table subscriptions {
  id uuid [pk]
  user_id uuid [note: 'FK -> users.id (the seeker)']
}

Ref: subscriptions.user_id > users.id
";
    let r = parse_dbml(dbml);
    assert!(r.ok, "error: {:?}", r.error);
    let schema = r.schema.unwrap();
    // Only the explicit ref survives; the from-note duplicate is dropped.
    assert_eq!(schema.refs.len(), 1, "from-note dup should be removed");
    assert_eq!(schema.refs[0].source, "explicit");
    assert_eq!(schema.refs[0].from_table, "subscriptions");
    assert_eq!(schema.refs[0].from_column, "user_id");
    assert_eq!(schema.refs[0].to_table, "users");
    assert_eq!(schema.refs[0].to_column, "id");
    // The column keeps isFk true and its full note text.
    let col = &schema.tables[0].columns[1];
    assert!(col.is_fk);
    assert_eq!(col.note.as_deref(), Some("FK -> users.id (the seeker)"));
}

#[test]
fn from_note_dedup_inline_wins() {
    let dbml = "\
Table t {
  a uuid [ref: > other.id, note: 'FK -> other.id extra']
}
";
    let r = parse_dbml(dbml);
    assert!(r.ok, "error: {:?}", r.error);
    let schema = r.schema.unwrap();
    assert_eq!(schema.refs.len(), 1, "from-note dup should be removed");
    assert_eq!(schema.refs[0].source, "inline");
}

// Alias resolution: an `as` alias used in a ref endpoint resolves to the
// canonical table name; Schema never contains the alias.
#[test]
fn alias_resolution_in_refs() {
    let dbml = "\
Table users as u {
  id uuid [pk]
}

Table orders {
  id uuid [pk]
  user_id uuid
}

Ref: orders.user_id > u.id
";
    let r = parse_dbml(dbml);
    assert!(r.ok, "error: {:?}", r.error);
    let schema = r.schema.unwrap();
    // canonical table name, never "u"
    assert!(schema.tables.iter().all(|t| t.name != "u"));
    assert_eq!(schema.refs.len(), 1);
    assert_eq!(schema.refs[0].to_table, "users", "alias must resolve to canonical");
    // users.id is the referenced side, so NOT a FK; orders.user_id IS the FK.
    let users = schema.tables.iter().find(|t| t.name == "users").unwrap();
    assert!(!users.columns[0].is_fk);
    let orders = schema.tables.iter().find(|t| t.name == "orders").unwrap();
    let user_id = orders.columns.iter().find(|c| c.name == "user_id").unwrap();
    assert!(user_id.is_fk);
}

#[test]
fn alias_resolution_in_from_table() {
    // alias on the FROM side of a ref resolves too
    let dbml = "\
Table accounts as acc {
  id uuid [pk]
  owner uuid
}

Ref: acc.owner > people.id
";
    let r = parse_dbml(dbml);
    assert!(r.ok, "error: {:?}", r.error);
    let schema = r.schema.unwrap();
    assert_eq!(schema.refs[0].from_table, "accounts");
}

// §1.1 triple-quote dedent: leading newline dropped, min-indent stripped,
// trailing whitespace trimmed.
#[test]
fn triple_quote_dedent() {
    let dbml = "Table t {
  id uuid [pk]

  Note: '''
    line one
      line two
    line three
  '''
}
";
    let r = parse_dbml(dbml);
    assert!(r.ok, "error: {:?}", r.error);
    let schema = r.schema.unwrap();
    // min indent across non-empty lines is 4 spaces; "line two" keeps its extra 2.
    let note = schema.tables[0].note.as_deref().unwrap();
    assert_eq!(note, "line one\n  line two\nline three");
}

// A double-quoted token is an identifier in TYPE position (verbatim slice keeps
// the quotes) AND a string value in NOTE position (inner text). Same column
// uses both forms, mirroring dbdiagram's leniency.
#[test]
fn double_quoted_type_and_note() {
    let dbml = "\
Table t {
  loc \"geography(Point,4326)\" [note: \"CHECK loc IS NOT NULL\"]
}
";
    let r = parse_dbml(dbml);
    assert!(r.ok, "error: {:?}", r.error);
    let schema = r.schema.unwrap();
    let col = &schema.tables[0].columns[0];
    assert_eq!(col.col_type, "\"geography(Point,4326)\"", "quoted type kept verbatim");
    assert_eq!(col.note.as_deref(), Some("CHECK loc IS NOT NULL"), "quoted note inner text");
}
