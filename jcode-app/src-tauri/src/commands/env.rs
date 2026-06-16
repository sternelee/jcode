use crate::error::TauriError;

#[derive(serde::Serialize)]
pub struct EnvFileEntry {
    pub key: String,
    pub value: String,
}

#[derive(serde::Serialize)]
pub struct EnvFileInfo {
    pub file_name: String,
    pub entries: Vec<EnvFileEntry>,
}

/// Lists all `.env` files in the jcode config directory along with their
/// key/value entries. Values are returned as-is; the frontend masks secrets.
#[tauri::command]
pub async fn list_env_files() -> Result<Vec<EnvFileInfo>, TauriError> {
    let config_dir = jcode::storage::app_config_dir()
        .map_err(|e| TauriError::Other(format!("Failed to resolve config dir: {e}")))?;

    let mut files: Vec<EnvFileInfo> = Vec::new();
    let entries = std::fs::read_dir(&config_dir).map_err(|e| TauriError::Io(e))?;

    for entry in entries {
        let entry = entry.map_err(|e| TauriError::Io(e))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("env") {
            continue;
        }
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        let file_entries = parse_env_content(&content);
        files.push(EnvFileInfo {
            file_name,
            entries: file_entries,
        });
    }

    files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(files)
}

/// Sets or deletes an environment variable in the named `.env` file under the
/// jcode config directory. Passing `None` (or an empty string) for `value`
/// removes the key from the file and the current process environment.
#[tauri::command]
pub async fn set_env_value(
    file_name: String,
    key: String,
    value: Option<String>,
) -> Result<(), TauriError> {
    let value_ref = value.as_deref().filter(|s| !s.is_empty());
    jcode::provider_catalog::save_env_value_to_env_file(&key, &file_name, value_ref)
        .map_err(|e| TauriError::Other(format!("Failed to update env value: {e}")))?;
    Ok(())
}

fn parse_env_content(content: &str) -> Vec<EnvFileEntry> {
    let mut result = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once('=') {
            result.push(EnvFileEntry {
                key: key.trim().to_string(),
                value: value.trim().to_string(),
            });
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_env_content_skips_comments_and_blank_lines() {
        let content = "\n# secret\nFOO=bar\n  BAZ = qux \n";
        let entries = parse_env_content(content);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].key, "FOO");
        assert_eq!(entries[0].value, "bar");
        assert_eq!(entries[1].key, "BAZ");
        assert_eq!(entries[1].value, "qux");
    }
}
