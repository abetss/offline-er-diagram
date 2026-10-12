// Tauri v2 app shell. Hosts the Rust parser as a single command (design.md §4):
// frontend adapters/tauri.ts calls invoke('parse_dbml', { text }) → ParseResult (serde JSON).

#[tauri::command]
fn parse_dbml(text: String) -> parser_rs::ParseResult {
    parser_rs::parse_dbml(&text)
}

#[tauri::command]
fn to_mermaid(text: String) -> Result<String, String> {
    let result = parser_rs::parse_dbml(&text);
    match result.schema {
        Some(schema) => Ok(parser_rs::to_mermaid(&schema)),
        None => Err(result
            .error
            .map(|e| format!("line {}:{}: {}", e.line, e.column, e.message))
            .unwrap_or_else(|| "parse failed".into())),
    }
}

/// A DBML file handed to the app on the command line: its path (for the tab title) and contents.
#[derive(Clone, serde::Serialize)]
struct CliFile {
    path: String,
    text: String,
}

struct CliSchema(Option<CliFile>);

fn read_cli_file<I: IntoIterator<Item = String>>(args: I) -> Option<CliFile> {
    let path = args.into_iter().skip(1).find(|a| !a.starts_with('-'))?;
    let text = std::fs::read_to_string(&path).ok()?;
    Some(CliFile { path, text })
}

#[tauri::command]
fn cli_schema(state: tauri::State<CliSchema>) -> Option<CliFile> {
    state.0.clone()
}

#[derive(serde::Serialize)]
struct FolderFiles {
    path: String,
    files: Vec<CliFile>,
    errors: Vec<String>,
}

fn read_dbml_folder(root: &std::path::Path) -> Result<FolderFiles, String> {
    let mut result = FolderFiles {
        path: root.to_string_lossy().into_owned(),
        files: Vec::new(),
        errors: Vec::new(),
    };
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) => {
                let message = format!("{}: {error}", dir.display());
                if dir == root {
                    return Err(message);
                }
                result.errors.push(message);
                continue;
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    result.errors.push(format!("{}: {error}", dir.display()));
                    continue;
                }
            };
            let path = entry.path();
            let kind = match entry.file_type() {
                Ok(kind) => kind,
                Err(error) => {
                    result.errors.push(format!("{}: {error}", path.display()));
                    continue;
                }
            };
            if kind.is_dir() {
                pending.push(path);
            } else if kind.is_file()
                && path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("dbml"))
            {
                match std::fs::read_to_string(&path) {
                    Ok(text) => result.files.push(CliFile {
                        path: path.to_string_lossy().into_owned(),
                        text,
                    }),
                    Err(error) => result.errors.push(format!("{}: {error}", path.display())),
                }
            }
        }
    }
    result.files.sort_by(|a, b| a.path.cmp(&b.path));
    result.errors.sort();
    Ok(result)
}

#[tauri::command]
async fn open_dbml_folder() -> Result<Option<FolderFiles>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(path) = rfd::FileDialog::new()
            .set_title("Open folder of DBML files")
            .pick_folder()
        else {
            return Ok(None);
        };
        read_dbml_folder(&path).map(Some)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn save_export_to(
    dir: &std::path::Path,
    name: &str,
    kind: &str,
    data: &str,
) -> Result<std::path::PathBuf, String> {
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let safe = if safe.is_empty() {
        "diagram".to_string()
    } else {
        safe
    };
    let path = dir.join(format!("{safe}.{kind}"));
    match kind {
        "svg" | "mmd" | "mermaid" => {
            std::fs::write(&path, data.as_bytes()).map_err(|e| e.to_string())?
        }
        "png" => {
            use base64::Engine;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(data.trim())
                .map_err(|e| e.to_string())?;
            std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        }
        _ => return Err(format!("unknown kind {kind}")),
    }
    Ok(path)
}

#[tauri::command]
fn save_export(name: String, kind: String, data: String) -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let dir = std::path::Path::new(&home).join("Downloads");
    save_export_to(&dir, &name, &kind, &data).map(|p| p.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Emitter;
    let cli = read_cli_file(std::env::args().collect::<Vec<_>>());
    tauri::Builder::default()
        // Single-instance: a second `dbml open <file>` while the app is running forwards its argv
        // here (this callback runs in the FIRST instance) instead of spawning a second window.
        // We read the file and emit it to the frontend, which opens it as a new tab.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(file) = read_cli_file(argv) {
                let _ = app.emit("open-file", file);
            }
        }))
        .manage(CliSchema(cli))
        .invoke_handler(tauri::generate_handler![
            parse_dbml,
            to_mermaid,
            cli_schema,
            open_dbml_folder,
            save_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{parse_dbml, read_cli_file, read_dbml_folder, save_export_to};

    fn folder_test_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("dbml_folder_{name}_{}", std::process::id()))
    }

    #[test]
    fn read_folder_opens_only_dbml_files_including_subfolders() {
        let dir = folder_test_path("mixed");
        let nested = dir.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(dir.join("schema.dbml"), "Table top {\n id int\n}").unwrap();
        std::fs::write(nested.join("schema.DBML"), "Table child {\n id int\n}").unwrap();
        std::fs::write(dir.join("empty.dbml"), "").unwrap();
        std::fs::write(dir.join("notes.txt"), "not DBML").unwrap();
        std::fs::write(dir.join("schema.dbml.bak"), "backup").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&dir, nested.join("loop")).unwrap();

        let result = read_dbml_folder(&dir).unwrap();
        let paths: Vec<_> = result
            .files
            .iter()
            .map(|file| std::path::Path::new(&file.path).strip_prefix(&dir).unwrap())
            .collect();
        assert_eq!(
            paths,
            [
                std::path::Path::new("empty.dbml"),
                std::path::Path::new("nested/schema.DBML"),
                std::path::Path::new("schema.dbml"),
            ]
        );
        assert_eq!(result.files[0].text, "");
        assert_eq!(result.files[1].text, "Table child {\n id int\n}");
        assert_eq!(result.files[2].text, "Table top {\n id int\n}");
        assert!(result.errors.is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn read_folder_keeps_readable_files_when_another_file_fails() {
        let dir = folder_test_path("unreadable");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("good.dbml"), "Table t {\n id int\n}").unwrap();
        std::fs::write(dir.join("bad.dbml"), [0xff, 0xfe]).unwrap();

        let result = read_dbml_folder(&dir).unwrap();
        assert_eq!(result.files.len(), 1);
        assert!(result.files[0].path.ends_with("good.dbml"));
        assert_eq!(result.errors.len(), 1);
        assert!(result.errors[0].contains("bad.dbml"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn read_folder_handles_empty_and_missing_folders() {
        let dir = folder_test_path("empty");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("notes.txt"), "notes").unwrap();
        let result = read_dbml_folder(&dir).unwrap();
        assert!(result.files.is_empty());
        assert!(result.errors.is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(read_dbml_folder(&dir).is_err());
    }

    #[test]
    fn parse_dbml_command_returns_one_table() {
        let result = parse_dbml("Table t {\n id int\n}".into());
        assert!(result.ok, "expected ok:true, got error: {:?}", result.error);
        let schema = result.schema.expect("ok result must carry a schema");
        assert_eq!(schema.tables.len(), 1, "expected exactly 1 table");
        assert_eq!(schema.tables[0].name, "t");
    }

    #[test]
    fn read_cli_file_reads_path_and_text_skips_flags_and_missing() {
        let dir = std::env::temp_dir().join("dbml_read_cli_file_test");
        std::fs::create_dir_all(&dir).expect("mkdir temp");
        let file = dir.join("schema.dbml");
        let content = "Table u {\n id int\n}";
        std::fs::write(&file, content).expect("write temp dbml");
        let tmp_path = file.to_string_lossy().into_owned();

        // A plain file path arg yields both the path (for the tab title) and the file contents.
        let got = read_cli_file(vec!["prog".to_string(), tmp_path.clone()]).expect("some file");
        assert_eq!(got.path, tmp_path);
        assert_eq!(got.text, content);

        // A leading -flag arg is skipped, then the file path is read.
        let got_flag = read_cli_file(vec![
            "prog".to_string(),
            "-open".to_string(),
            tmp_path.clone(),
        ])
        .expect("some file");
        assert_eq!(got_flag.path, tmp_path);
        assert_eq!(got_flag.text, content);

        // A missing file path yields None.
        let missing = dir
            .join("does_not_exist.dbml")
            .to_string_lossy()
            .into_owned();
        let got_missing = read_cli_file(vec!["prog".to_string(), missing]);
        assert!(got_missing.is_none(), "missing file must yield None");

        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn save_export_to_writes_svg_and_rejects_unknown_kind() {
        let dir = std::env::temp_dir().join("dbml_save_export_test");
        std::fs::create_dir_all(&dir).expect("mkdir temp");

        let svg = "<svg></svg>";
        let path = save_export_to(&dir, "my diagram", "svg", svg).expect("svg write ok");
        assert!(path.exists(), "svg file should exist at {path:?}");
        let written = std::fs::read_to_string(&path).expect("read svg back");
        assert_eq!(written, svg);
        // Non-alphanumeric chars are sanitized to underscores.
        assert_eq!(
            path.file_name().unwrap().to_string_lossy(),
            "my_diagram.svg"
        );

        // mmd is written as UTF-8 text (round-trips including non-ASCII).
        let mmd = "erDiagram\n    users {\n        text café\n    }\n";
        let mmd_path = save_export_to(&dir, "diag", "mmd", mmd).expect("mmd write ok");
        assert!(mmd_path.exists(), "mmd file should exist at {mmd_path:?}");
        let mmd_written = std::fs::read_to_string(&mmd_path).expect("read mmd back as utf-8");
        assert_eq!(mmd_written, mmd);
        assert_eq!(mmd_path.file_name().unwrap().to_string_lossy(), "diag.mmd");

        // mermaid kind is also UTF-8 text.
        let mer_path = save_export_to(&dir, "diag2", "mermaid", mmd).expect("mermaid write ok");
        let mer_written = std::fs::read_to_string(&mer_path).expect("read mermaid back as utf-8");
        assert_eq!(mer_written, mmd);

        // Unknown kind → Err.
        let err = save_export_to(&dir, "d", "xml", "data");
        assert!(err.is_err(), "unknown kind must be an error");

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&mmd_path);
        let _ = std::fs::remove_file(&mer_path);
    }
}
