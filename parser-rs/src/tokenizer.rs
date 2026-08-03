use crate::model::ParseError;

#[derive(Debug, Clone, PartialEq)]
pub enum TokKind {
    Ident,   // bareword or double-quoted; value = inner text
    String,  // single- or triple-quoted; value = processed text
    FuncExpr, // backtick; value = inner text
    Number,  // value = literal
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    LParen,
    RParen,
    Colon,
    Comma,
    Dot,
    Rel, // relation op: ">", "<", "-", "<>"; value = the op
    Newline,
}

#[derive(Debug, Clone)]
pub struct Token {
    pub kind: TokKind,
    pub value: String,
    pub line: u32,
    pub column: u32,
    // Byte offset of the first char in the source (for verbatim slicing of column types).
    pub start: usize,
    // Byte offset just past the last char.
    pub end: usize,
    // True only for a double-quoted token. Such a token is an Ident (usable in
    // name/type position) but is ALSO acceptable as a string value (note/default),
    // mirroring dbdiagram's leniency. See parser::expect_string.
    pub dquoted: bool,
}

struct Lexer<'a> {
    src: &'a str,
    bytes: &'a [u8],
    pos: usize,  // byte offset
    line: u32,   // 1-based
    col: u32,    // 1-based
    // bracket depth for [] and (); NEWLINE suppressed while > 0
    group_depth: u32,
}

impl<'a> Lexer<'a> {
    fn new(src: &'a str) -> Self {
        Lexer {
            src,
            bytes: src.as_bytes(),
            pos: 0,
            line: 1,
            col: 1,
            group_depth: 0,
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn peek2(&self) -> Option<u8> {
        self.bytes.get(self.pos + 1).copied()
    }

    fn peek3(&self) -> Option<u8> {
        self.bytes.get(self.pos + 2).copied()
    }

    // Advance one byte, updating line/col. Assumes ASCII bytes for column math on
    // multi-byte sequences: we advance byte-by-byte but only bump col on char
    // boundaries. To keep it simple and correct for line/col, we advance whole chars.
    fn bump_char(&mut self) {
        if self.pos >= self.bytes.len() {
            return;
        }
        let ch_len = utf8_len(self.bytes[self.pos]);
        let is_newline = self.bytes[self.pos] == b'\n';
        self.pos += ch_len;
        if is_newline {
            self.line += 1;
            self.col = 1;
        } else {
            self.col += 1;
        }
    }

    fn err(&self, message: String, line: u32, column: u32) -> ParseError {
        ParseError { line, column, message }
    }
}

fn utf8_len(b: u8) -> usize {
    if b < 0x80 {
        1
    } else if b >> 5 == 0b110 {
        2
    } else if b >> 4 == 0b1110 {
        3
    } else if b >> 3 == 0b11110 {
        4
    } else {
        1
    }
}

fn is_ident_start(b: u8) -> bool {
    b == b'_' || b.is_ascii_alphabetic()
}

fn is_ident_continue(b: u8) -> bool {
    b == b'_' || b.is_ascii_alphanumeric()
}

pub fn tokenize(src: &str) -> Result<Vec<Token>, ParseError> {
    let mut lx = Lexer::new(src);
    let mut out: Vec<Token> = Vec::new();

    loop {
        let b = match lx.peek() {
            Some(b) => b,
            None => break,
        };

        // Whitespace (spaces/tabs/CR) — discarded.
        if b == b' ' || b == b'\t' || b == b'\r' {
            lx.bump_char();
            continue;
        }

        // Newline.
        if b == b'\n' {
            let line = lx.line;
            let col = lx.col;
            let start = lx.pos;
            lx.bump_char();
            if lx.group_depth == 0 {
                out.push(Token {
                    kind: TokKind::Newline,
                    value: "\n".to_string(),
                    line,
                    column: col,
                    start,
                    end: start + 1,
                    dquoted: false,
                });
            }
            continue;
        }

        // Line comment `//` — discard to EOL.
        if b == b'/' && lx.peek2() == Some(b'/') {
            while let Some(c) = lx.peek() {
                if c == b'\n' {
                    break;
                }
                lx.bump_char();
            }
            continue;
        }

        // Block comment `/* */` — discard (non-nesting).
        if b == b'/' && lx.peek2() == Some(b'*') {
            let open_line = lx.line;
            let open_col = lx.col;
            lx.bump_char(); // '/'
            lx.bump_char(); // '*'
            loop {
                match lx.peek() {
                    None => {
                        return Err(lx.err(
                            format!("Unterminated block comment (opened at line {})", open_line),
                            open_line,
                            open_col,
                        ));
                    }
                    Some(b'*') if lx.peek2() == Some(b'/') => {
                        lx.bump_char();
                        lx.bump_char();
                        break;
                    }
                    _ => lx.bump_char(),
                }
            }
            continue;
        }

        let tok_line = lx.line;
        let tok_col = lx.col;
        let tok_start = lx.pos;

        // Triple-quoted string.
        if b == b'\'' && lx.peek2() == Some(b'\'') && lx.peek3() == Some(b'\'') {
            let value = lex_triple_string(&mut lx, tok_line, tok_col)?;
            out.push(Token {
                kind: TokKind::String,
                value,
                line: tok_line,
                column: tok_col,
                start: tok_start,
                end: lx.pos,
                dquoted: false,
            });
            continue;
        }

        // Single-quoted string.
        if b == b'\'' {
            let value = lex_single_string(&mut lx, tok_line, tok_col)?;
            out.push(Token {
                kind: TokKind::String,
                value,
                line: tok_line,
                column: tok_col,
                start: tok_start,
                end: lx.pos,
                dquoted: false,
            });
            continue;
        }

        // Double-quoted token: an Ident (name/type position) that is ALSO
        // acceptable as a string value (note/default position) — dquoted flag set.
        if b == b'"' {
            let value = lex_quoted_ident(&mut lx, tok_line, tok_col)?;
            out.push(Token {
                kind: TokKind::Ident,
                value,
                line: tok_line,
                column: tok_col,
                start: tok_start,
                end: lx.pos,
                dquoted: true,
            });
            continue;
        }

        // Backtick FUNCEXPR.
        if b == b'`' {
            lx.bump_char(); // opening `
            let inner_start = lx.pos;
            loop {
                match lx.peek() {
                    None | Some(b'\n') => {
                        return Err(lx.err(
                            format!("Unterminated backtick expression (opened at line {})", tok_line),
                            tok_line,
                            tok_col,
                        ));
                    }
                    Some(b'`') => break,
                    _ => lx.bump_char(),
                }
            }
            let inner = lx.src[inner_start..lx.pos].to_string();
            lx.bump_char(); // closing `
            out.push(Token {
                kind: TokKind::FuncExpr,
                value: inner,
                line: tok_line,
                column: tok_col,
                start: tok_start,
                end: lx.pos,
                dquoted: false,
            });
            continue;
        }

        // Number: -?[0-9]+(\.[0-9]+)?  (leading '-' only if followed by a digit;
        // otherwise '-' is the relation op).
        if b.is_ascii_digit() || (b == b'-' && lx.peek2().map_or(false, |c| c.is_ascii_digit())) {
            if b == b'-' {
                lx.bump_char();
            }
            while lx.peek().map_or(false, |c| c.is_ascii_digit()) {
                lx.bump_char();
            }
            if lx.peek() == Some(b'.') && lx.peek2().map_or(false, |c| c.is_ascii_digit()) {
                lx.bump_char(); // '.'
                while lx.peek().map_or(false, |c| c.is_ascii_digit()) {
                    lx.bump_char();
                }
            }
            let value = lx.src[tok_start..lx.pos].to_string();
            out.push(Token {
                kind: TokKind::Number,
                value,
                line: tok_line,
                column: tok_col,
                start: tok_start,
                end: lx.pos,
                dquoted: false,
            });
            continue;
        }

        // Bareword ident / keyword.
        if is_ident_start(b) {
            lx.bump_char();
            while lx.peek().map_or(false, is_ident_continue) {
                lx.bump_char();
            }
            let value = lx.src[tok_start..lx.pos].to_string();
            out.push(Token {
                kind: TokKind::Ident,
                value,
                line: tok_line,
                column: tok_col,
                start: tok_start,
                end: lx.pos,
                dquoted: false,
            });
            continue;
        }

        // Relation op `<>` (longest match before `<`).
        if b == b'<' && lx.peek2() == Some(b'>') {
            lx.bump_char();
            lx.bump_char();
            out.push(Token {
                kind: TokKind::Rel,
                value: "<>".to_string(),
                line: tok_line,
                column: tok_col,
                start: tok_start,
                end: lx.pos,
                dquoted: false,
            });
            continue;
        }

        // Single-char symbols and relation ops.
        let single: Option<(TokKind, &str)> = match b {
            b'{' => Some((TokKind::LBrace, "{")),
            b'}' => Some((TokKind::RBrace, "}")),
            b'[' => Some((TokKind::LBracket, "[")),
            b']' => Some((TokKind::RBracket, "]")),
            b'(' => Some((TokKind::LParen, "(")),
            b')' => Some((TokKind::RParen, ")")),
            b':' => Some((TokKind::Colon, ":")),
            b',' => Some((TokKind::Comma, ",")),
            b'.' => Some((TokKind::Dot, ".")),
            b'>' => Some((TokKind::Rel, ">")),
            b'<' => Some((TokKind::Rel, "<")),
            b'-' => Some((TokKind::Rel, "-")),
            _ => None,
        };

        if let Some((kind, s)) = single {
            match kind {
                TokKind::LBracket | TokKind::LParen => lx.group_depth += 1,
                TokKind::RBracket | TokKind::RParen => {
                    if lx.group_depth > 0 {
                        lx.group_depth -= 1;
                    }
                }
                _ => {}
            }
            lx.bump_char();
            out.push(Token {
                kind,
                value: s.to_string(),
                line: tok_line,
                column: tok_col,
                start: tok_start,
                end: lx.pos,
                dquoted: false,
            });
            continue;
        }

        // Unknown byte.
        let ch: char = lx.src[lx.pos..].chars().next().unwrap_or('?');
        return Err(lx.err(
            format!("Unexpected character '{}'", ch),
            tok_line,
            tok_col,
        ));
    }

    Ok(out)
}

fn lex_single_string(lx: &mut Lexer, open_line: u32, open_col: u32) -> Result<String, ParseError> {
    lx.bump_char(); // opening '
    let mut val = String::new();
    loop {
        match lx.peek() {
            None | Some(b'\n') => {
                return Err(lx.err(
                    format!("Unterminated string (opened at line {})", open_line),
                    open_line,
                    open_col,
                ));
            }
            Some(b'\'') => {
                lx.bump_char(); // closing '
                return Ok(val);
            }
            Some(b'\\') => {
                // escapes: \' -> ' ; \\ -> \ ; other -> literal backslash + next char.
                lx.bump_char(); // consume backslash
                match lx.peek() {
                    Some(b'\'') => {
                        val.push('\'');
                        lx.bump_char();
                    }
                    Some(b'\\') => {
                        val.push('\\');
                        lx.bump_char();
                    }
                    Some(_) => {
                        val.push('\\');
                        // push the actual next char (may be multibyte)
                        let start = lx.pos;
                        lx.bump_char();
                        val.push_str(&lx.src[start..lx.pos]);
                    }
                    None => {
                        return Err(lx.err(
                            format!("Unterminated string (opened at line {})", open_line),
                            open_line,
                            open_col,
                        ));
                    }
                }
            }
            Some(_) => {
                let start = lx.pos;
                lx.bump_char();
                val.push_str(&lx.src[start..lx.pos]);
            }
        }
    }
}

fn lex_triple_string(lx: &mut Lexer, open_line: u32, open_col: u32) -> Result<String, ParseError> {
    // consume opening '''
    lx.bump_char();
    lx.bump_char();
    lx.bump_char();
    let inner_start = lx.pos;
    loop {
        match lx.peek() {
            None => {
                return Err(lx.err(
                    format!("Unterminated string (opened at line {})", open_line),
                    open_line,
                    open_col,
                ));
            }
            Some(b'\'') if lx.peek2() == Some(b'\'') && lx.peek3() == Some(b'\'') => {
                let raw = lx.src[inner_start..lx.pos].to_string();
                lx.bump_char();
                lx.bump_char();
                lx.bump_char();
                return Ok(process_triple(&raw));
            }
            _ => lx.bump_char(),
        }
    }
}

// §1.1 triple-quote post-processing: drop leading \n, dedent by min leading
// spaces over non-empty lines, trim trailing whitespace/newlines.
fn process_triple(raw: &str) -> String {
    let s = raw.strip_prefix('\n').unwrap_or(raw);
    let lines: Vec<&str> = s.split('\n').collect();

    let min_indent = lines
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start_matches(' ').len())
        .min()
        .unwrap_or(0);

    let dedented: Vec<String> = lines
        .iter()
        .map(|l| {
            if l.len() >= min_indent {
                l[min_indent..].to_string()
            } else {
                l.to_string()
            }
        })
        .collect();

    dedented
        .join("\n")
        .trim_end_matches(|c: char| c.is_whitespace())
        .to_string()
}

fn lex_quoted_ident(lx: &mut Lexer, open_line: u32, open_col: u32) -> Result<String, ParseError> {
    lx.bump_char(); // opening "
    let mut val = String::new();
    loop {
        match lx.peek() {
            None | Some(b'\n') => {
                return Err(lx.err(
                    format!("Unterminated string (opened at line {})", open_line),
                    open_line,
                    open_col,
                ));
            }
            Some(b'"') => {
                lx.bump_char();
                return Ok(val);
            }
            Some(_) => {
                let start = lx.pos;
                lx.bump_char();
                val.push_str(&lx.src[start..lx.pos]);
            }
        }
    }
}
