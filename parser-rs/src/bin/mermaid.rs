use std::io::Read;
use std::process;

fn main() {
    // Read from argv[1] file path, or stdin if absent.
    let src = match std::env::args().nth(1) {
        Some(path) => match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("error reading '{}': {}", path, e);
                process::exit(2);
            }
        },
        None => {
            let mut buf = String::new();
            if let Err(e) = std::io::stdin().read_to_string(&mut buf) {
                eprintln!("error reading stdin: {}", e);
                process::exit(2);
            }
            buf
        }
    };

    let result = parser_rs::parse_dbml(&src);
    if result.ok {
        let schema = result.schema.expect("ok result must carry a schema");
        print!("{}", parser_rs::to_mermaid(&schema));
    } else {
        let e = result.error.expect("failed result must carry an error");
        eprintln!("error (line {}:{}): {}", e.line, e.column, e.message);
        process::exit(1);
    }
}
