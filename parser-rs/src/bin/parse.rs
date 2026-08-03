use std::process;

fn main() {
    let path = match std::env::args().nth(1) {
        Some(p) => p,
        None => {
            eprintln!("usage: parse <file.dbml>");
            process::exit(2);
        }
    };
    let src = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error reading '{}': {}", path, e);
            process::exit(2);
        }
    };
    let result = parser_rs::parse_dbml(&src);
    // Canonical compact JSON.
    let json = serde_json::to_string(&result).expect("serialize ParseResult");
    println!("{}", json);
}
