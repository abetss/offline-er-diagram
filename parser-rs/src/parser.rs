use std::collections::HashMap;

use regex::Regex;

use crate::model::{Column, ParseError, ParseResult, Ref, Schema, Table, TableGroup};
use crate::tokenizer::{tokenize, TokKind, Token};

struct Parser<'a> {
    src: &'a str,
    toks: Vec<Token>,
    i: usize,
    // alias -> canonical table name
    aliases: HashMap<String, String>,
    // canonical table names + aliases seen (for duplicate detection)
    table_names: HashMap<String, ()>,
    tables: Vec<Table>,
    refs: Vec<Ref>,
    groups: Vec<TableGroup>,
}

// EOF sentinel line/col info comes from the last token or (1,1).
impl<'a> Parser<'a> {
    fn new(src: &'a str, toks: Vec<Token>) -> Self {
        Parser {
            src,
            toks,
            i: 0,
            aliases: HashMap::new(),
            table_names: HashMap::new(),
            tables: Vec::new(),
            refs: Vec::new(),
            groups: Vec::new(),
        }
    }

    fn peek(&self) -> Option<&Token> {
        self.toks.get(self.i)
    }

    fn peek_kind(&self) -> Option<&TokKind> {
        self.toks.get(self.i).map(|t| &t.kind)
    }

    fn advance(&mut self) -> Option<Token> {
        let t = self.toks.get(self.i).cloned();
        if t.is_some() {
            self.i += 1;
        }
        t
    }

    fn eof_pos(&self) -> (u32, u32) {
        match self.toks.last() {
            Some(t) => (t.line, t.column),
            None => (1, 1),
        }
    }

    // Skip NEWLINE tokens (used at top level and to collapse blank lines).
    fn skip_newlines(&mut self) {
        while matches!(self.peek_kind(), Some(TokKind::Newline)) {
            self.i += 1;
        }
    }

    fn err(&self, message: String, line: u32, column: u32) -> ParseError {
        ParseError { line, column, message }
    }

    fn err_at_tok(&self, message: String, tok: &Token) -> ParseError {
        ParseError {
            line: tok.line,
            column: tok.column,
            message,
        }
    }

    fn err_eof(&self, message: String) -> ParseError {
        let (line, column) = self.eof_pos();
        ParseError { line, column, message }
    }

    // ---- top level ----

    fn parse_document(&mut self) -> Result<(), ParseError> {
        loop {
            self.skip_newlines();
            let tok = match self.peek() {
                Some(t) => t.clone(),
                None => break,
            };

            if tok.kind != TokKind::Ident {
                return Err(self.err_at_tok(
                    format!("Unexpected '{}' at top level", tok.value),
                    &tok,
                ));
            }

            let lower = tok.value.to_lowercase();
            match lower.as_str() {
                "table" => self.parse_table()?,
                "ref" => self.parse_ref_stmt_or_block()?,
                "tablegroup" => self.parse_table_group()?,
                "project" => self.skip_named_block("project")?,
                "enum" => self.skip_named_block("enum")?,
                "note" => self.parse_top_level_note()?,
                _ => {
                    return Err(self.err_at_tok(
                        format!("Unexpected '{}' at top level", tok.value),
                        &tok,
                    ));
                }
            }
        }
        Ok(())
    }

    // ---- Table ----

    fn parse_table(&mut self) -> Result<(), ParseError> {
        self.advance(); // "Table"
        self.skip_newlines();

        let name_tok = self.expect_ident("table name")?;
        // 2-part schema.table => error
        if matches!(self.peek_kind(), Some(TokKind::Dot)) {
            let dot = self.peek().unwrap().clone();
            return Err(self.err_at_tok(
                "Schema-qualified names are not supported".to_string(),
                &dot,
            ));
        }
        let table_name = name_tok.value.clone();

        // optional alias
        let mut alias: Option<String> = None;
        if let Some(t) = self.peek() {
            if t.kind == TokKind::Ident && t.value.eq_ignore_ascii_case("as") {
                self.advance(); // "as"
                let alias_tok = self.expect_ident("alias")?;
                alias = Some(alias_tok.value.clone());
            }
        }

        // optional settings [...]
        if matches!(self.peek_kind(), Some(TokKind::LBracket)) {
            self.skip_bracket_settings()?;
        }

        // duplicate name / alias detection
        if self.table_names.contains_key(&table_name) {
            return Err(self.err_at_tok(
                format!("Duplicate table name '{}'", table_name),
                &name_tok,
            ));
        }
        self.table_names.insert(table_name.clone(), ());
        if let Some(a) = &alias {
            if self.table_names.contains_key(a) {
                return Err(self.err_at_tok(
                    format!("Duplicate table name '{}'", a),
                    &name_tok,
                ));
            }
            self.table_names.insert(a.clone(), ());
            self.aliases.insert(a.clone(), table_name.clone());
        }

        self.skip_newlines();
        let open = self.expect(TokKind::LBrace, "'{'")?;

        let mut columns: Vec<Column> = Vec::new();
        let mut table_note: Option<String> = None;

        loop {
            self.skip_newlines();
            match self.peek() {
                None => {
                    return Err(self.err_eof(format!(
                        "Unterminated {{ (opened at line {})",
                        open.line
                    )));
                }
                Some(t) if t.kind == TokKind::RBrace => {
                    self.advance();
                    break;
                }
                Some(t) if t.kind == TokKind::Ident => {
                    let word = t.value.clone();
                    let lw = word.to_lowercase();
                    if lw == "note" {
                        // could be `Note: '...'`
                        // peek ahead: Note Colon String
                        let is_table_note = matches!(
                            self.toks.get(self.i + 1).map(|x| &x.kind),
                            Some(TokKind::Colon)
                        );
                        if is_table_note {
                            let note = self.parse_table_note()?;
                            if table_note.is_some() {
                                let nt = self.toks.get(self.i.saturating_sub(1));
                                let (l, c) = nt.map(|x| (x.line, x.column)).unwrap_or((1, 1));
                                return Err(self.err(
                                    "Second table note".to_string(),
                                    l,
                                    c,
                                ));
                            }
                            table_note = Some(note);
                            continue;
                        }
                        // else fall through: a column literally named "note"
                    }
                    if lw == "indexes" {
                        // Indexes { ... } skip
                        self.advance(); // "Indexes"
                        self.skip_newlines();
                        let ob = self.expect(TokKind::LBrace, "'{'")?;
                        self.skip_balanced_braces(ob.line)?;
                        continue;
                    }
                    // otherwise a column line
                    let (col, col_refs) = self.parse_column_line(&table_name)?;
                    columns.push(col);
                    for r in col_refs {
                        self.refs.push(r);
                    }
                }
                Some(t) => {
                    let tc = t.clone();
                    return Err(self.err_at_tok(
                        format!("Unexpected '{}' in table body", tc.value),
                        &tc,
                    ));
                }
            }
        }

        self.tables.push(Table {
            name: table_name,
            note: table_note,
            columns,
        });
        Ok(())
    }

    fn parse_table_note(&mut self) -> Result<String, ParseError> {
        self.advance(); // "Note"
        self.expect(TokKind::Colon, "':'")?;
        let s = self.expect_string("note string")?;
        Ok(s.value.clone())
    }

    // Returns the column plus any inline/from-note refs it produces (in emission order).
    fn parse_column_line(&mut self, table_name: &str) -> Result<(Column, Vec<Ref>), ParseError> {
        let name_tok = self.expect_ident("column name")?;
        let col_name = name_tok.value.clone();

        // schema.table style on column name? col_name only; a Dot here would mean
        // a malformed column — but grammar only forbids schema-qualified table names.
        // Type must follow.
        let type_tok = match self.peek() {
            Some(t) if t.kind == TokKind::Ident => t.clone(),
            _ => {
                return Err(self.err_at_tok(
                    format!("Column '{}' is missing a type", col_name),
                    &name_tok,
                ));
            }
        };
        // Consume type ident; capture verbatim slice through optional (params).
        self.advance(); // type ident
        let type_start = type_tok.start;
        let mut type_end = type_tok.end;
        if matches!(self.peek_kind(), Some(TokKind::LParen)) {
            let open = self.advance().unwrap(); // '('
            // consume up to matching ')'
            loop {
                match self.peek() {
                    None => {
                        return Err(self.err_eof(format!(
                            "Unterminated ( (opened at line {})",
                            open.line
                        )));
                    }
                    Some(t) if t.kind == TokKind::RParen => {
                        let close = self.advance().unwrap();
                        type_end = close.end;
                        break;
                    }
                    _ => {
                        self.advance();
                    }
                }
            }
        }
        let col_type = self.src[type_start..type_end].to_string();

        let mut col = Column {
            name: col_name.clone(),
            col_type,
            pk: false,
            not_null: false,
            unique: false,
            note: None,
            is_fk: false,
        };
        let mut refs: Vec<Ref> = Vec::new();

        // optional settings
        if matches!(self.peek_kind(), Some(TokKind::LBracket)) {
            self.parse_column_settings(table_name, &col_name, &mut col, &mut refs)?;
        }

        // Note: the column line must terminate at a NEWLINE, EOF, or the closing
        // brace of the table. We don't require an explicit NEWLINE token because
        // the top of the loop skips them; any leftover token would surface as an
        // "Unexpected ... in table body" on the next iteration.
        Ok((col, refs))
    }

    fn parse_column_settings(
        &mut self,
        table_name: &str,
        col_name: &str,
        col: &mut Column,
        refs: &mut Vec<Ref>,
    ) -> Result<(), ParseError> {
        self.advance(); // '['
        loop {
            let tok = match self.peek() {
                Some(t) => t.clone(),
                None => {
                    return Err(self.err_eof("Unterminated [ (opened earlier)".to_string()));
                }
            };
            match tok.kind {
                TokKind::RBracket => {
                    self.advance();
                    break;
                }
                TokKind::Comma => {
                    self.advance();
                    continue;
                }
                TokKind::Ident => {
                    let word = tok.value.clone();
                    let lw = word.to_lowercase();
                    match lw.as_str() {
                        "pk" => {
                            self.advance();
                            col.pk = true;
                        }
                        "primary" => {
                            // primary key
                            self.advance();
                            // expect "key"
                            match self.peek() {
                                Some(t) if t.kind == TokKind::Ident && t.value.eq_ignore_ascii_case("key") => {
                                    self.advance();
                                    col.pk = true;
                                }
                                _ => {
                                    return Err(self.err_at_tok(
                                        format!("Unknown column setting '{}'", word),
                                        &tok,
                                    ));
                                }
                            }
                        }
                        "not" => {
                            self.advance();
                            match self.peek() {
                                Some(t) if t.kind == TokKind::Ident && t.value.eq_ignore_ascii_case("null") => {
                                    self.advance();
                                    col.not_null = true;
                                }
                                _ => {
                                    return Err(self.err_at_tok(
                                        format!("Unknown column setting '{}'", word),
                                        &tok,
                                    ));
                                }
                            }
                        }
                        "null" => {
                            self.advance();
                            // no-op
                        }
                        "unique" => {
                            self.advance();
                            col.unique = true;
                        }
                        "increment" => {
                            self.advance();
                            // discarded
                        }
                        "default" => {
                            self.advance();
                            self.expect(TokKind::Colon, "':'")?;
                            // value: STRING | NUMBER | IDENT | FUNCEXPR — discard
                            match self.peek() {
                                Some(t)
                                    if matches!(
                                        t.kind,
                                        TokKind::String
                                            | TokKind::Number
                                            | TokKind::Ident
                                            | TokKind::FuncExpr
                                    ) =>
                                {
                                    self.advance();
                                }
                                Some(t) => {
                                    let tc = t.clone();
                                    return Err(self.err_at_tok(
                                        "Expected default value".to_string(),
                                        &tc,
                                    ));
                                }
                                None => {
                                    return Err(self.err_eof("Expected default value".to_string()));
                                }
                            }
                        }
                        "note" => {
                            self.advance();
                            self.expect(TokKind::Colon, "':'")?;
                            let s = self.expect_string("note string")?;
                            col.note = Some(s.value.clone());
                        }
                        "ref" => {
                            self.advance();
                            self.expect(TokKind::Colon, "':'")?;
                            let r = self.parse_inline_ref(table_name, col_name)?;
                            refs.push(r);
                        }
                        _ => {
                            return Err(self.err_at_tok(
                                format!("Unknown column setting '{}'", word),
                                &tok,
                            ));
                        }
                    }
                }
                _ => {
                    return Err(self.err_at_tok(
                        format!("Unknown column setting '{}'", tok.value),
                        &tok,
                    ));
                }
            }
        }
        Ok(())
    }

    // inline ref: relation qualified  ->  ref: > table.col
    fn parse_inline_ref(&mut self, table_name: &str, col_name: &str) -> Result<Ref, ParseError> {
        let rel_tok = match self.peek() {
            Some(t) if t.kind == TokKind::Rel => self.advance().unwrap(),
            Some(t) => {
                let tc = t.clone();
                return Err(self.err_at_tok(
                    "Expected relation operator".to_string(),
                    &tc,
                ));
            }
            None => {
                return Err(self.err_eof("Expected relation operator".to_string()));
            }
        };
        let relation = rel_tok.value.clone();
        let (to_table, to_col) = self.parse_qualified()?;
        Ok(Ref {
            from_table: table_name.to_string(),
            from_column: col_name.to_string(),
            to_table,
            to_column: to_col,
            relation,
            note: None,
            source: "inline".to_string(),
        })
    }

    // qualified := IDENT "." IDENT  (3-part => error)
    fn parse_qualified(&mut self) -> Result<(String, String), ParseError> {
        let a = self.expect_ident("identifier")?;
        self.expect(TokKind::Dot, "'.'")?;
        let b = self.expect_ident("identifier")?;
        // 3-part?
        if matches!(self.peek_kind(), Some(TokKind::Dot)) {
            let dot = self.peek().unwrap().clone();
            return Err(self.err_at_tok(
                "Schema-qualified names are not supported".to_string(),
                &dot,
            ));
        }
        Ok((a.value.clone(), b.value.clone()))
    }

    // ---- Ref ----

    fn parse_ref_stmt_or_block(&mut self) -> Result<(), ParseError> {
        self.advance(); // "Ref"
        // optional ref name IDENT (not "as"/keyword sensitive here; just an IDENT
        // that is not ':' or '{').
        if let Some(t) = self.peek() {
            if t.kind == TokKind::Ident {
                self.advance(); // discard ref name
            }
        }

        match self.peek() {
            Some(t) if t.kind == TokKind::Colon => {
                self.advance(); // ':'
                // Guard against composite: '(' means composite FK.
                self.check_composite()?;
                let r = self.parse_ref_body_explicit()?;
                // optional ref settings
                let note = if matches!(self.peek_kind(), Some(TokKind::LBracket)) {
                    self.parse_ref_settings()?
                } else {
                    None
                };
                self.refs.push(Ref { note, ..r });
                Ok(())
            }
            Some(t) if t.kind == TokKind::LBrace => {
                let open = self.advance().unwrap(); // '{'
                loop {
                    self.skip_newlines();
                    match self.peek() {
                        None => {
                            return Err(self.err_eof(format!(
                                "Unterminated {{ (opened at line {})",
                                open.line
                            )));
                        }
                        Some(t) if t.kind == TokKind::RBrace => {
                            self.advance();
                            break;
                        }
                        _ => {
                            self.check_composite()?;
                            let r = self.parse_ref_body_explicit()?;
                            let note = if matches!(self.peek_kind(), Some(TokKind::LBracket)) {
                                self.parse_ref_settings()?
                            } else {
                                None
                            };
                            self.refs.push(Ref { note, ..r });
                        }
                    }
                }
                Ok(())
            }
            Some(t) => {
                let tc = t.clone();
                Err(self.err_at_tok(
                    format!("Unexpected '{}' at top level", tc.value),
                    &tc,
                ))
            }
            None => Err(self.err_eof("Unexpected end of input after 'Ref'".to_string())),
        }
    }

    fn check_composite(&self) -> Result<(), ParseError> {
        if let Some(t) = self.peek() {
            if t.kind == TokKind::LParen {
                return Err(self.err_at_tok(
                    "Composite foreign keys are not supported".to_string(),
                    t,
                ));
            }
        }
        Ok(())
    }

    // ref_body := qualified relation qualified
    fn parse_ref_body_explicit(&mut self) -> Result<Ref, ParseError> {
        let (from_table, from_col) = self.parse_qualified()?;
        let rel_tok = match self.peek() {
            Some(t) if t.kind == TokKind::Rel => self.advance().unwrap(),
            Some(t) => {
                let tc = t.clone();
                return Err(self.err_at_tok(
                    "Expected relation operator".to_string(),
                    &tc,
                ));
            }
            None => {
                return Err(self.err_eof("Expected relation operator".to_string()));
            }
        };
        let relation = rel_tok.value.clone();
        self.check_composite()?;
        let (to_table, to_col) = self.parse_qualified()?;
        Ok(Ref {
            from_table,
            from_column: from_col,
            to_table,
            to_column: to_col,
            relation,
            note: None,
            source: "explicit".to_string(),
        })
    }

    // ref_settings: [ note: '...' | (delete|update): IDENT , ... ] -> returns note if any
    fn parse_ref_settings(&mut self) -> Result<Option<String>, ParseError> {
        self.advance(); // '['
        let mut note: Option<String> = None;
        loop {
            let tok = match self.peek() {
                Some(t) => t.clone(),
                None => return Err(self.err_eof("Unterminated [ (opened earlier)".to_string())),
            };
            match tok.kind {
                TokKind::RBracket => {
                    self.advance();
                    break;
                }
                TokKind::Comma => {
                    self.advance();
                }
                TokKind::Ident => {
                    let lw = tok.value.to_lowercase();
                    match lw.as_str() {
                        "note" => {
                            self.advance();
                            self.expect(TokKind::Colon, "':'")?;
                            let s = self.expect_string("note string")?;
                            note = Some(s.value.clone());
                        }
                        "delete" | "update" => {
                            self.advance();
                            self.expect(TokKind::Colon, "':'")?;
                            // value IDENT (cascade etc.) — discard
                            self.expect_ident("cascade action")?;
                        }
                        _ => {
                            return Err(self.err_at_tok(
                                format!("Unknown column setting '{}'", tok.value),
                                &tok,
                            ));
                        }
                    }
                }
                _ => {
                    return Err(self.err_at_tok(
                        format!("Unknown column setting '{}'", tok.value),
                        &tok,
                    ));
                }
            }
        }
        Ok(note)
    }

    // ---- TableGroup ----

    fn parse_table_group(&mut self) -> Result<(), ParseError> {
        self.advance(); // "TableGroup"
        self.skip_newlines();
        let name_tok = self.expect_ident("group name")?;
        let name = name_tok.value.clone();

        // optional settings
        if matches!(self.peek_kind(), Some(TokKind::LBracket)) {
            self.skip_bracket_settings()?;
        }

        self.skip_newlines();
        let open = self.expect(TokKind::LBrace, "'{'")?;

        let mut members: Vec<String> = Vec::new();
        loop {
            self.skip_newlines();
            match self.peek() {
                None => {
                    return Err(self.err_eof(format!(
                        "Unterminated {{ (opened at line {})",
                        open.line
                    )));
                }
                Some(t) if t.kind == TokKind::RBrace => {
                    self.advance();
                    break;
                }
                Some(t) if t.kind == TokKind::Ident => {
                    members.push(t.value.clone());
                    self.advance();
                }
                Some(t) => {
                    let tc = t.clone();
                    return Err(self.err_at_tok(
                        format!("Unexpected '{}' in table group", tc.value),
                        &tc,
                    ));
                }
            }
        }

        self.groups.push(TableGroup { name, tables: members });
        Ok(())
    }

    // ---- skipped constructs ----

    // Project IDENT? { ... } / Enum IDENT { ... }
    fn skip_named_block(&mut self, _kind: &str) -> Result<(), ParseError> {
        self.advance(); // keyword
        // optional name IDENT
        if let Some(t) = self.peek() {
            if t.kind == TokKind::Ident {
                self.advance();
            }
        }
        // optional settings
        if matches!(self.peek_kind(), Some(TokKind::LBracket)) {
            self.skip_bracket_settings()?;
        }
        self.skip_newlines();
        let open = self.expect(TokKind::LBrace, "'{'")?;
        self.skip_balanced_braces(open.line)
    }

    // top-level `Note IDENT { ... }` (sticky note) OR `Note name: '...'` sticky note.
    fn parse_top_level_note(&mut self) -> Result<(), ParseError> {
        self.advance(); // "Note"
        // optional name IDENT
        if let Some(t) = self.peek() {
            if t.kind == TokKind::Ident {
                self.advance();
            }
        }
        match self.peek() {
            Some(t) if t.kind == TokKind::LBrace => {
                let open = self.advance().unwrap();
                self.skip_balanced_braces(open.line)
            }
            Some(t) if t.kind == TokKind::Colon => {
                self.advance();
                self.expect_string("note string")?;
                Ok(())
            }
            Some(t) => {
                let tc = t.clone();
                Err(self.err_at_tok(
                    format!("Unexpected '{}' at top level", tc.value),
                    &tc,
                ))
            }
            None => Err(self.err_eof("Unexpected end of input after 'Note'".to_string())),
        }
    }

    // Skip a `[...]` settings group (already at '['). Contents ignored.
    fn skip_bracket_settings(&mut self) -> Result<(), ParseError> {
        let open = self.advance().unwrap(); // '['
        let mut depth = 1;
        loop {
            match self.peek() {
                None => {
                    return Err(self.err(
                        format!("Unterminated [ (opened at line {})", open.line),
                        open.line,
                        open.column,
                    ));
                }
                Some(t) if t.kind == TokKind::LBracket => {
                    depth += 1;
                    self.advance();
                }
                Some(t) if t.kind == TokKind::RBracket => {
                    depth -= 1;
                    self.advance();
                    if depth == 0 {
                        break;
                    }
                }
                _ => {
                    self.advance();
                }
            }
        }
        Ok(())
    }

    // Skip to matching `}` (already consumed the opening '{'; open_line for errors).
    fn skip_balanced_braces(&mut self, open_line: u32) -> Result<(), ParseError> {
        let mut depth = 1;
        loop {
            match self.peek() {
                None => {
                    return Err(self.err_eof(format!(
                        "Unterminated {{ (opened at line {})",
                        open_line
                    )));
                }
                Some(t) if t.kind == TokKind::LBrace => {
                    depth += 1;
                    self.advance();
                }
                Some(t) if t.kind == TokKind::RBrace => {
                    depth -= 1;
                    self.advance();
                    if depth == 0 {
                        break;
                    }
                }
                _ => {
                    self.advance();
                }
            }
        }
        Ok(())
    }

    // ---- token helpers ----

    fn expect(&mut self, kind: TokKind, what: &str) -> Result<Token, ParseError> {
        match self.peek() {
            Some(t) if t.kind == kind => Ok(self.advance().unwrap()),
            Some(t) => {
                let tc = t.clone();
                Err(self.err_at_tok(format!("Expected {}", what), &tc))
            }
            None => Err(self.err_eof(format!("Expected {}", what))),
        }
    }

    fn expect_ident(&mut self, what: &str) -> Result<Token, ParseError> {
        match self.peek() {
            Some(t) if t.kind == TokKind::Ident => Ok(self.advance().unwrap()),
            Some(t) => {
                let tc = t.clone();
                Err(self.err_at_tok(format!("Expected {}", what), &tc))
            }
            None => Err(self.err_eof(format!("Expected {}", what))),
        }
    }

    // Accepts a single/triple-quoted STRING or a double-quoted token (an Ident
    // flagged `dquoted`). dbdiagram treats `"..."` as a valid string value in
    // note/default positions; its value is the inner text. See tokenizer.
    fn expect_string(&mut self, what: &str) -> Result<Token, ParseError> {
        match self.peek() {
            Some(t) if t.kind == TokKind::String => Ok(self.advance().unwrap()),
            Some(t) if t.kind == TokKind::Ident && t.dquoted => Ok(self.advance().unwrap()),
            Some(t) => {
                let tc = t.clone();
                Err(self.err_at_tok(format!("Expected {}", what), &tc))
            }
            None => Err(self.err_eof(format!("Expected {}", what))),
        }
    }
}

// ---- FK-in-note extraction (§6) ----

fn fk_regex() -> Regex {
    // (?:^|[^A-Za-z0-9_]) FK \s* (->|→) \s* (ident).(ident)
    Regex::new(r"(?i)(?:^|[^A-Za-z0-9_])fk\s*(?:->|\x{2192})\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)")
        .expect("valid FK regex")
}

// ---- post passes ----

fn resolve_alias(aliases: &HashMap<String, String>, name: &str) -> String {
    aliases.get(name).cloned().unwrap_or_else(|| name.to_string())
}

fn run(src: &str) -> Result<Schema, ParseError> {
    let toks = tokenize(src)?;
    let mut p = Parser::new(src, toks);
    p.parse_document()?;

    let aliases = p.aliases.clone();
    let re = fk_regex();

    // §4.4 ordering: inline and from-note refs sit at their column's position;
    // explicit Ref statements sit at their statement position (after the tables in
    // normal DBML). Rebuild the ordered refs list by walking columns in document
    // order, emitting inline then from-note per column, then explicit refs in the
    // source order they were collected.
    let mut inline_by_col: HashMap<(String, String), Vec<Ref>> = HashMap::new();
    let mut explicit_refs: Vec<Ref> = Vec::new();
    for r in p.refs.drain(..) {
        match r.source.as_str() {
            "inline" => {
                inline_by_col
                    .entry((r.from_table.clone(), r.from_column.clone()))
                    .or_default()
                    .push(r);
            }
            _ => explicit_refs.push(r),
        }
    }

    let mut ordered: Vec<Ref> = Vec::new();
    for table in &p.tables {
        for col in &table.columns {
            // inline refs at this column
            if let Some(v) = inline_by_col.remove(&(table.name.clone(), col.name.clone())) {
                for mut r in v {
                    r.to_table = resolve_alias(&aliases, &r.to_table);
                    r.from_table = resolve_alias(&aliases, &r.from_table);
                    ordered.push(r);
                }
            }
            // from-note ref at this column
            if let Some(note_text) = &col.note {
                if let Some(caps) = re.captures(note_text) {
                    let m = caps.get(0).unwrap();
                    let to_table_raw = caps.get(1).unwrap().as_str().to_string();
                    let to_col = caps.get(2).unwrap().as_str().to_string();
                    // remainder after the matched table.col
                    let remainder = note_text[m.end()..].trim();
                    let ref_note = if remainder.is_empty() {
                        None
                    } else {
                        Some(remainder.to_string())
                    };
                    ordered.push(Ref {
                        from_table: resolve_alias(&aliases, &table.name),
                        from_column: col.name.clone(),
                        to_table: resolve_alias(&aliases, &to_table_raw),
                        to_column: to_col,
                        relation: ">".to_string(),
                        note: ref_note,
                        source: "from-note".to_string(),
                    });
                }
            }
        }
    }
    for mut r in explicit_refs {
        r.to_table = resolve_alias(&aliases, &r.to_table);
        r.from_table = resolve_alias(&aliases, &r.from_table);
        ordered.push(r);
    }

    // §4.3 from-note dedup: drop from-note refs whose (from_table, from_column,
    // to_table, to_column) matches an existing explicit/inline ref.
    let mut keyset: std::collections::HashSet<(String, String, String, String)> =
        std::collections::HashSet::new();
    for r in &ordered {
        if r.source == "explicit" || r.source == "inline" {
            keyset.insert((
                r.from_table.clone(),
                r.from_column.clone(),
                r.to_table.clone(),
                r.to_column.clone(),
            ));
        }
    }
    let mut deduped: Vec<Ref> = Vec::new();
    for r in ordered {
        if r.source == "from-note" {
            let k = (
                r.from_table.clone(),
                r.from_column.clone(),
                r.to_table.clone(),
                r.to_column.clone(),
            );
            if keyset.contains(&k) {
                continue;
            }
        }
        deduped.push(r);
    }
    let refs = deduped;

    // §4.2 notNull normalization: pk implies not_null.
    let mut tables = p.tables;
    for t in &mut tables {
        for c in &mut t.columns {
            if c.pk {
                c.not_null = true;
            }
        }
    }

    // §4.1 isFk derivation.
    let mut fk_set: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    for r in &refs {
        match r.relation.as_str() {
            ">" => {
                fk_set.insert((r.from_table.clone(), r.from_column.clone()));
            }
            "<" => {
                fk_set.insert((r.to_table.clone(), r.to_column.clone()));
            }
            "-" => {
                fk_set.insert((r.from_table.clone(), r.from_column.clone()));
            }
            "<>" => {
                fk_set.insert((r.from_table.clone(), r.from_column.clone()));
                fk_set.insert((r.to_table.clone(), r.to_column.clone()));
            }
            _ => {}
        }
    }
    for t in &mut tables {
        for c in &mut t.columns {
            if fk_set.contains(&(t.name.clone(), c.name.clone())) {
                c.is_fk = true;
            }
        }
    }

    Ok(Schema {
        tables,
        refs,
        groups: p.groups,
    })
}

pub fn parse(src: &str) -> ParseResult {
    match run(src) {
        Ok(schema) => ParseResult {
            ok: true,
            schema: Some(schema),
            error: None,
        },
        Err(error) => ParseResult {
            ok: false,
            schema: None,
            error: Some(error),
        },
    }
}
