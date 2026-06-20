use grep_regex::RegexMatcher;
use grep_searcher::{SearcherBuilder, sinks::UTF8};
use ignore::WalkBuilder;
use serde_json::json;
use std::path::Path;
use tauri::{Emitter, Window};

#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("invalid regex: {0}")]
    InvalidRegex(String),
}

impl serde::Serialize for SearchError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

#[tauri::command]
pub async fn search_files(window: Window, keyword: String, path: String) -> Result<(), SearchError> {
    if keyword.trim().is_empty() {
        return Ok(());
    }
    let matcher = RegexMatcher::new(&keyword).map_err(|e| SearchError::InvalidRegex(e.to_string()))?;

    std::thread::spawn(move || {
        let base = Path::new(&path);
        let walker = WalkBuilder::new(base)
            .hidden(false)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .build();

        for result in walker {
            let entry = match result {
                Ok(e) => e,
                Err(_) => continue,
            };
            let ft = match entry.file_type() {
                Some(ft) => ft,
                None => continue,
            };
            if !ft.is_file() {
                continue;
            }
            let file_path = entry.path().to_path_buf();
            let relative = file_path.strip_prefix(base).unwrap_or(&file_path);
            let mut searcher = SearcherBuilder::new().build();
            let _ = searcher.search_path(
                &matcher,
                &file_path,
                UTF8(|line_num, line| {
                    let _ = window.emit(
                        "search-result",
                        json!({
                            "path": file_path.to_string_lossy(),
                            "relative": relative.to_string_lossy(),
                            "line": line_num,
                            "text": line.trim_end(),
                        }),
                    );
                    Ok(true)
                }),
            );
        }
        let _ = window.emit("search-done", json!({"path": path, "keyword": keyword}));
    });

    Ok(())
}
