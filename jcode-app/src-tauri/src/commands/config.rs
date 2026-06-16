use crate::error::TauriError;
use serde_json;

/// Returns the path to the active `config.toml` file.
#[tauri::command]
pub async fn get_config_path() -> Result<String, TauriError> {
    jcode::config::Config::path()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| {
            TauriError::Other("No config path available (JCODE_HOME not set)".to_string())
        })
}

/// Returns the resolved config as a JSON value.
#[tauri::command]
pub async fn get_config() -> Result<serde_json::Value, TauriError> {
    let cfg = jcode::config::Config::load();
    serde_json::to_value(&cfg).map_err(TauriError::Serialization)
}

/// Sets a config value at a dotted key path (e.g. `features.memory`,
/// `agents.swarm_model`, `compaction.mode`) and persists it to `config.toml`.
///
/// Sending `null` as the value deletes the key.
#[tauri::command]
pub async fn set_config_value(key: String, value: serde_json::Value) -> Result<(), TauriError> {
    let path = jcode::config::Config::path()
        .ok_or_else(|| TauriError::Other("No config path available".to_string()))?;
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let mut root: toml::Value = if content.trim().is_empty() {
        toml::Value::Table(toml::Table::new())
    } else {
        toml::from_str(&content)
            .map_err(|e| TauriError::Other(format!("Failed to parse config.toml: {e}")))?
    };

    let segments: Vec<&str> = key.split('.').collect();
    if segments.is_empty() {
        return Err(TauriError::InvalidInput(
            "Key must not be empty".to_string(),
        ));
    }

    set_toml_value(&mut root, &segments, json_to_toml(&value))?;

    let new_content = toml::to_string_pretty(&root)
        .map_err(|e| TauriError::Other(format!("Failed to serialize config: {e}")))?;
    std::fs::write(&path, &new_content).map_err(|e| TauriError::Io(e))?;
    jcode::config::Config::invalidate_cache();
    Ok(())
}

fn set_toml_value(
    root: &mut toml::Value,
    path: &[&str],
    value: Option<toml::Value>,
) -> Result<(), TauriError> {
    let table = root
        .as_table_mut()
        .ok_or_else(|| TauriError::Other(format!("Cannot set nested key on non-table value")))?;

    if path.len() == 1 {
        match value {
            Some(v) => {
                table.insert(path[0].to_string(), v);
            }
            None => {
                table.remove(path[0]);
            }
        }
    } else {
        let child = table
            .entry(path[0].to_string())
            .or_insert_with(|| toml::Value::Table(toml::Table::new()));
        set_toml_value(child, &path[1..], value)?;
    }
    Ok(())
}

/// Converts a `serde_json::Value` to an `Option<toml::Value>`.
/// Returns `None` for JSON null (which signals key deletion).
fn json_to_toml(v: &serde_json::Value) -> Option<toml::Value> {
    match v {
        serde_json::Value::Null => None,
        serde_json::Value::Bool(b) => Some(toml::Value::Boolean(*b)),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Some(toml::Value::Integer(i))
            } else if let Some(f) = n.as_f64() {
                Some(toml::Value::Float(f))
            } else {
                Some(toml::Value::String(n.to_string()))
            }
        }
        serde_json::Value::String(s) => Some(toml::Value::String(s.clone())),
        serde_json::Value::Array(arr) => {
            let toml_arr: Vec<toml::Value> = arr.iter().filter_map(|v| json_to_toml(v)).collect();
            Some(toml::Value::Array(toml_arr))
        }
        serde_json::Value::Object(obj) => {
            let mut table = toml::Table::new();
            for (k, v) in obj {
                if let Some(tv) = json_to_toml(v) {
                    table.insert(k.clone(), tv);
                }
            }
            Some(toml::Value::Table(table))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_json_to_toml_scalars() {
        assert_eq!(
            json_to_toml(&serde_json::json!(true)),
            Some(toml::Value::Boolean(true))
        );
        assert_eq!(
            json_to_toml(&serde_json::json!(42i64)),
            Some(toml::Value::Integer(42))
        );
        assert_eq!(
            json_to_toml(&serde_json::json!("hello")),
            Some(toml::Value::String("hello".to_string()))
        );
        assert_eq!(json_to_toml(&serde_json::Value::Null), None);
    }

    #[test]
    fn test_json_to_toml_array() {
        let result = json_to_toml(&serde_json::json!([1, 2, 3]));
        assert_eq!(
            result,
            Some(toml::Value::Array(vec![
                toml::Value::Integer(1),
                toml::Value::Integer(2),
                toml::Value::Integer(3),
            ]))
        );
    }

    #[test]
    fn test_set_toml_value_simple() {
        let mut root = toml::Value::Table(toml::Table::new());
        set_toml_value(
            &mut root,
            &["features"],
            Some(toml::Value::Table(toml::Table::new())),
        )
        .unwrap();
        set_toml_value(
            &mut root,
            &["features", "memory"],
            Some(toml::Value::Boolean(true)),
        )
        .unwrap();

        let tbl = root.as_table().unwrap();
        let features = tbl.get("features").unwrap().as_table().unwrap();
        assert_eq!(features.get("memory").unwrap().as_bool(), Some(true));
    }

    #[test]
    fn test_set_toml_value_delete() {
        let mut root = toml::Value::Table(toml::Table::new());
        set_toml_value(&mut root, &["key"], Some(toml::Value::String("val".into()))).unwrap();
        assert!(root.as_table().unwrap().contains_key("key"));

        set_toml_value(&mut root, &["key"], None).unwrap();
        assert!(!root.as_table().unwrap().contains_key("key"));
    }
}
