//! Mermaid ER-diagram export. Single Rust source of truth for `erDiagram` output.
//! Deterministic: stable ordering, no randomness.

use crate::model::Schema;

/// Sanitize a token (type or column name) for Mermaid attribute lines:
/// strip surrounding double-quotes, replace every run of chars NOT in
/// `[A-Za-z0-9_]` with a single `_`, trim leading/trailing `_`. Empty → `unknown`.
fn sanitize_token(raw: &str) -> String {
    let trimmed = raw.trim();
    // Strip a single pair of surrounding double-quotes.
    let unquoted = if trimmed.len() >= 2
        && trimmed.starts_with('"')
        && trimmed.ends_with('"')
    {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    };

    let mut out = String::with_capacity(unquoted.len());
    let mut prev_underscore = false;
    for c in unquoted.chars() {
        if c.is_ascii_alphanumeric() || c == '_' {
            out.push(c);
            prev_underscore = false;
        } else if !prev_underscore {
            out.push('_');
            prev_underscore = true;
        }
    }
    let trimmed_out = out.trim_matches('_');
    if trimmed_out.is_empty() {
        "unknown".to_string()
    } else {
        trimmed_out.to_string()
    }
}

/// An entity name is emitted bare if it matches `^[A-Za-z_][A-Za-z0-9_]*$`,
/// otherwise wrapped in double quotes.
fn entity_name(name: &str) -> String {
    let mut chars = name.chars();
    let safe = match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {
            chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        }
        _ => false,
    };
    if safe {
        name.to_string()
    } else {
        format!("\"{name}\"")
    }
}

/// Sanitize a free-text comment/label: replace `"` with `'`, collapse any
/// newlines (`\r`/`\n`) into single spaces.
fn sanitize_comment(note: &str) -> String {
    note.replace('"', "'")
        .replace(['\r', '\n'], " ")
}

/// Convert a `Schema` into a valid Mermaid `erDiagram` string.
pub fn to_mermaid(schema: &Schema) -> String {
    let mut out = String::from("erDiagram\n");

    for table in &schema.tables {
        // Table note → `%% <note>` comment line before the block.
        if let Some(note) = &table.note {
            let one_line = note.replace(['\r', '\n'], " ");
            out.push_str("    %% ");
            out.push_str(&one_line);
            out.push('\n');
        }

        out.push_str("    ");
        out.push_str(&entity_name(&table.name));
        out.push_str(" {\n");

        for col in &table.columns {
            let santype = sanitize_token(&col.col_type);
            let sanname = sanitize_token(&col.name);

            let mut parts: Vec<String> = vec![santype, sanname];

            let keys = match (col.pk, col.is_fk) {
                (true, true) => Some("PK, FK"),
                (true, false) => Some("PK"),
                (false, true) => Some("FK"),
                (false, false) => None,
            };
            if let Some(k) = keys {
                parts.push(k.to_string());
            }

            if let Some(note) = &col.note {
                parts.push(format!("\"{}\"", sanitize_comment(note)));
            }

            out.push_str("        ");
            out.push_str(&parts.join(" "));
            out.push('\n');
        }

        out.push_str("    }\n");
    }

    for r in &schema.refs {
        let from = entity_name(&r.from_table);
        let to = entity_name(&r.to_table);
        let label = match &r.note {
            Some(n) => sanitize_comment(n),
            None => r.from_column.clone(),
        };

        let line = match r.relation.as_str() {
            ">" => format!("    {to} ||--o{{ {from} : \"{label}\""),
            "<" => format!("    {from} ||--o{{ {to} : \"{label}\""),
            "-" => format!("    {from} ||--|| {to} : \"{label}\""),
            "<>" => format!("    {from} }}o--o{{ {to} : \"{label}\""),
            // Unknown relation kinds: default to a plain one-to-one link so
            // output stays valid Mermaid rather than emitting a broken token.
            _ => format!("    {from} ||--|| {to} : \"{label}\""),
        };
        out.push_str(&line);
        out.push('\n');
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Column, Ref, Schema, Table};

    fn col(name: &str, col_type: &str) -> Column {
        Column {
            name: name.to_string(),
            col_type: col_type.to_string(),
            pk: false,
            not_null: false,
            unique: false,
            note: None,
            is_fk: false,
        }
    }

    #[test]
    fn sanitize_token_examples() {
        assert_eq!(sanitize_token("geography(Point,4326)"), "geography_Point_4326");
        assert_eq!(sanitize_token("text[]"), "text");
        assert_eq!(sanitize_token("\"char(2)\""), "char_2");
        assert_eq!(sanitize_token("numeric(10,2)"), "numeric_10_2");
        assert_eq!(sanitize_token("vector(1024)"), "vector_1024");
        assert_eq!(sanitize_token("\"tsvector\""), "tsvector");
        assert_eq!(sanitize_token("text"), "text");
        // Empty / all-symbol → unknown.
        assert_eq!(sanitize_token(""), "unknown");
        assert_eq!(sanitize_token("()"), "unknown");
        assert_eq!(sanitize_token("\"\""), "unknown");
    }

    #[test]
    fn entity_name_quotes_unsafe() {
        assert_eq!(entity_name("users"), "users");
        assert_eq!(entity_name("_private"), "_private");
        assert_eq!(entity_name("Table1"), "Table1");
        assert_eq!(entity_name("1bad"), "\"1bad\"");
        assert_eq!(entity_name("has space"), "\"has space\"");
        assert_eq!(entity_name("weird-name"), "\"weird-name\"");
    }

    #[test]
    fn full_schema_output_exact() {
        let mut pk = col("id", "uuid");
        pk.pk = true;

        let mut fk = col("org_id", "uuid");
        fk.is_fk = true;

        let geo = col("location", "geography(Point,4326)");
        let arr = col("tags", "text[]");

        let mut noted = col("bio", "text");
        noted.note = Some("A \"quoted\"\nnote".to_string());

        let users = Table {
            name: "users".to_string(),
            note: Some("All humans\nin the system".to_string()),
            columns: vec![pk, fk, geo, arr, noted],
        };

        let orgs = Table {
            name: "organization".to_string(),
            note: None,
            columns: vec![{
                let mut c = col("id", "uuid");
                c.pk = true;
                c
            }],
        };

        let refs = vec![
            Ref {
                from_table: "users".to_string(),
                from_column: "org_id".to_string(),
                to_table: "organization".to_string(),
                to_column: "id".to_string(),
                relation: ">".to_string(),
                note: Some("employer".to_string()),
                source: "explicit".to_string(),
            },
            Ref {
                from_table: "users".to_string(),
                from_column: "org_id".to_string(),
                to_table: "organization".to_string(),
                to_column: "id".to_string(),
                relation: "<".to_string(),
                note: None,
                source: "explicit".to_string(),
            },
            Ref {
                from_table: "users".to_string(),
                from_column: "org_id".to_string(),
                to_table: "organization".to_string(),
                to_column: "id".to_string(),
                relation: "-".to_string(),
                note: None,
                source: "explicit".to_string(),
            },
            Ref {
                from_table: "users".to_string(),
                from_column: "org_id".to_string(),
                to_table: "organization".to_string(),
                to_column: "id".to_string(),
                relation: "<>".to_string(),
                note: None,
                source: "explicit".to_string(),
            },
        ];

        let schema = Schema {
            tables: vec![users, orgs],
            refs,
            groups: vec![],
        };

        let expected = "erDiagram\n\
            \x20   %% All humans in the system\n\
            \x20   users {\n\
            \x20       uuid id PK\n\
            \x20       uuid org_id FK\n\
            \x20       geography_Point_4326 location\n\
            \x20       text tags\n\
            \x20       text bio \"A 'quoted' note\"\n\
            \x20   }\n\
            \x20   organization {\n\
            \x20       uuid id PK\n\
            \x20   }\n\
            \x20   organization ||--o{ users : \"employer\"\n\
            \x20   users ||--o{ organization : \"org_id\"\n\
            \x20   users ||--|| organization : \"org_id\"\n\
            \x20   users }o--o{ organization : \"org_id\"\n";

        assert_eq!(to_mermaid(&schema), expected);
    }

    #[test]
    fn pk_and_fk_combined() {
        let mut c = col("id", "uuid");
        c.pk = true;
        c.is_fk = true;
        let t = Table {
            name: "t".to_string(),
            note: None,
            columns: vec![c],
        };
        let schema = Schema {
            tables: vec![t],
            refs: vec![],
            groups: vec![],
        };
        let out = to_mermaid(&schema);
        assert!(out.contains("uuid id PK, FK"), "got: {out}");
    }

    #[test]
    fn unsafe_entity_name_is_quoted_in_block_and_refs() {
        let t = Table {
            name: "weird name".to_string(),
            note: None,
            columns: vec![col("id", "int")],
        };
        let other = Table {
            name: "ok".to_string(),
            note: None,
            columns: vec![col("id", "int")],
        };
        let schema = Schema {
            tables: vec![t, other],
            refs: vec![Ref {
                from_table: "weird name".to_string(),
                from_column: "id".to_string(),
                to_table: "ok".to_string(),
                to_column: "id".to_string(),
                relation: ">".to_string(),
                note: None,
                source: "explicit".to_string(),
            }],
            groups: vec![],
        };
        let out = to_mermaid(&schema);
        assert!(out.contains("    \"weird name\" {\n"), "got: {out}");
        assert!(out.contains("    ok ||--o{ \"weird name\" : \"id\"\n"), "got: {out}");
    }

    #[test]
    fn ends_with_trailing_newline() {
        let schema = Schema {
            tables: vec![],
            refs: vec![],
            groups: vec![],
        };
        assert_eq!(to_mermaid(&schema), "erDiagram\n");
    }
}
