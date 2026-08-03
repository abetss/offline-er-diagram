use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct Schema {
    pub tables: Vec<Table>,
    pub refs: Vec<Ref>,
    pub groups: Vec<TableGroup>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Table {
    pub name: String,
    pub note: Option<String>,
    pub columns: Vec<Column>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub name: String,
    #[serde(rename = "type")]
    pub col_type: String,
    pub pk: bool,
    pub not_null: bool, // serializes as "notNull"
    pub unique: bool,
    pub note: Option<String>,
    pub is_fk: bool, // serializes as "isFk"
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Ref {
    pub from_table: String,
    pub from_column: String,
    pub to_table: String,
    pub to_column: String,
    pub relation: String, // ">", "<", "-", "<>"
    pub note: Option<String>,
    pub source: String, // "explicit" | "inline" | "from-note"
}

#[derive(Serialize, Debug, PartialEq)]
pub struct TableGroup {
    pub name: String,
    pub tables: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct ParseError {
    pub line: u32,
    pub column: u32,
    pub message: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct ParseResult {
    pub ok: bool,
    pub schema: Option<Schema>,
    pub error: Option<ParseError>,
}
