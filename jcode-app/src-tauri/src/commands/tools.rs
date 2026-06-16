use crate::error::TauriError;

fn load_mcp_from_value(value: &serde_json::Value) -> Vec<serde_json::Value> {
    let servers_obj = value
        .get("servers")
        .or_else(|| value.get("mcpServers"))
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    let mut servers = Vec::new();
    for (name, server_value) in servers_obj {
        let url = server_value
            .get("url")
            .and_then(|v| v.as_str())
            .map(String::from);
        let command = server_value
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let args = server_value
            .get("args")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let env = server_value
            .get("env")
            .and_then(|v| v.as_object())
            .map(|obj| {
                obj.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect::<std::collections::HashMap<String, String>>()
            })
            .unwrap_or_default();
        let shared = server_value
            .get("shared")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let mut out = serde_json::json!({
            "name": name,
            "shared": shared,
        });
        if let Some(url) = url {
            out["url"] = serde_json::json!(url);
        } else {
            out["command"] = serde_json::json!(command);
            out["args"] = serde_json::json!(args);
            if !env.is_empty() {
                out["env"] = serde_json::json!(env);
            }
        }
        servers.push(out);
    }
    servers
}
fn load_mcp_from_path(path: &std::path::Path) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    if !path.exists() {
        return out;
    }
    if let Ok(content) = std::fs::read_to_string(path) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) {
            out.extend(load_mcp_from_value(&value));
        }
    }
    out
}
fn scan_skills_from_dir(dir: &std::path::Path) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    if !dir.exists() {
        return out;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let skill_file = path.join("SKILL.md");
            let skill_file_lower = path.join("skill.md");
            let target = if skill_file.exists() {
                skill_file
            } else {
                skill_file_lower
            };
            if target.exists() {
                if let Ok(skill) = jcode::skill::SkillRegistry::parse_skill(&target) {
                    out.push(serde_json::json!({
                        "name": skill.name,
                        "description": skill.description,
                        "allowed_tools": skill.allowed_tools,
                        "path": skill.path.to_string_lossy(),
                    }));
                }
            }
        } else if path.extension().is_some_and(|e| e == "md") {
            if let Ok(skill) = jcode::skill::SkillRegistry::parse_skill(&path) {
                out.push(serde_json::json!({
                    "name": skill.name,
                    "description": skill.description,
                    "allowed_tools": skill.allowed_tools,
                    "path": skill.path.to_string_lossy(),
                }));
            }
        }
    }
    out
}
/// Resolve the user's CLI-level ~/.jcode directory, bypassing any JCODE_HOME
/// override that the desktop app may have set.
fn user_jcode_dir() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".jcode"))
}
#[tauri::command]
pub async fn list_mcp_servers() -> Result<Vec<serde_json::Value>, TauriError> {
    let mut all_servers = Vec::new();

    // 1. Desktop app's isolated config (JCODE_HOME)
    let app_jcode = jcode::storage::jcode_dir().map_err(|e| TauriError::from(e.to_string()))?;
    all_servers.extend(load_mcp_from_path(&app_jcode.join("mcp.json")));

    // 2. User's CLI-level ~/.jcode/mcp.json (fallback)
    if let Some(user_jcode) = user_jcode_dir() {
        all_servers.extend(load_mcp_from_path(&user_jcode.join("mcp.json")));
    }

    // 3. Project-local .jcode/mcp.json
    all_servers.extend(load_mcp_from_path(std::path::Path::new(".jcode/mcp.json")));

    // 4. Project-local .claude/mcp.json
    all_servers.extend(load_mcp_from_path(std::path::Path::new(".claude/mcp.json")));

    // 5. Global ~/.claude/mcp.json
    if let Ok(claude_mcp) = jcode::storage::user_home_path(".claude/mcp.json") {
        all_servers.extend(load_mcp_from_path(&claude_mcp));
    }

    Ok(all_servers)
}
#[tauri::command]
pub async fn list_skills() -> Result<Vec<serde_json::Value>, TauriError> {
    let mut skills_out = Vec::new();

    // 1. Desktop app's isolated config (JCODE_HOME)
    let app_jcode = jcode::storage::jcode_dir().map_err(|e| TauriError::from(e.to_string()))?;
    skills_out.extend(scan_skills_from_dir(&app_jcode.join("skills")));

    // 2. User's CLI-level ~/.jcode/skills/ (fallback)
    if let Some(user_jcode) = user_jcode_dir() {
        skills_out.extend(scan_skills_from_dir(&user_jcode.join("skills")));
    }

    // 3. Project-local .jcode/skills/
    skills_out.extend(scan_skills_from_dir(std::path::Path::new(".jcode/skills")));

    // 4. Global ~/.claude/skills/
    if let Ok(claude_skills) = jcode::storage::user_home_path(".claude/skills") {
        skills_out.extend(scan_skills_from_dir(&claude_skills));
    }

    Ok(skills_out)
}
#[tauri::command]
pub async fn reload_skills() -> Result<usize, TauriError> {
    let registry = jcode::skill::SkillRegistry::shared_registry();
    let mut guard = registry.write().await;
    guard
        .reload_all()
        .map_err(|e| TauriError::from(e.to_string()))
}
#[tauri::command]
pub async fn save_mcp_server(
    name: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    env: Option<std::collections::HashMap<String, String>>,
    url: Option<String>,
    shared: bool,
) -> Result<(), TauriError> {
    let jcode_dir = user_jcode_dir()
        .ok_or_else(|| TauriError::Other("Cannot resolve home directory".to_string()))?;
    let mcp_path = jcode_dir.join("mcp.json");

    let mut value = if mcp_path.exists() {
        std::fs::read_to_string(&mcp_path)
            .ok()
            .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
            .unwrap_or_else(|| serde_json::json!({"servers": {}}))
    } else {
        serde_json::json!({"servers": {}})
    };

    let obj = value
        .as_object_mut()
        .ok_or_else(|| TauriError::Other("Invalid mcp.json root".to_string()))?;

    // Determine which key to use (preserve existing)
    let key = if obj.contains_key("mcpServers") && !obj.contains_key("servers") {
        "mcpServers"
    } else {
        "servers"
    };

    let servers = obj
        .entry(key)
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| TauriError::Other("Invalid servers object".to_string()))?;

    let server_val = if let Some(url) = url {
        serde_json::json!({
            "url": url,
            "shared": shared,
        })
    } else {
        let mut val = serde_json::json!({
            "command": command.unwrap_or_default(),
            "args": args.unwrap_or_default(),
            "shared": shared,
        });
        if let Some(env) = env {
            if !env.is_empty() {
                val["env"] = serde_json::json!(env);
            }
        }
        val
    };

    servers.insert(name, server_val);

    let content =
        serde_json::to_string_pretty(&value).map_err(|e| TauriError::from(e.to_string()))?;
    std::fs::write(&mcp_path, content).map_err(|e| TauriError::from(e.to_string()))?;
    Ok(())
}
#[tauri::command]
pub async fn delete_mcp_server(name: String) -> Result<(), TauriError> {
    let jcode_dir = user_jcode_dir()
        .ok_or_else(|| TauriError::Other("Cannot resolve home directory".to_string()))?;
    let mcp_path = jcode_dir.join("mcp.json");

    if !mcp_path.exists() {
        return Ok(());
    }

    let content =
        std::fs::read_to_string(&mcp_path).map_err(|e| TauriError::from(e.to_string()))?;
    let mut value: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| TauriError::from(e.to_string()))?;

    let obj = value
        .as_object_mut()
        .ok_or_else(|| TauriError::Other("Invalid mcp.json root".to_string()))?;
    for key in &["servers", "mcpServers"] {
        if let Some(serde_json::Value::Object(servers)) = obj.get_mut(*key) {
            servers.remove(&name);
        }
    }

    let content =
        serde_json::to_string_pretty(&value).map_err(|e| TauriError::from(e.to_string()))?;
    std::fs::write(&mcp_path, content).map_err(|e| TauriError::from(e.to_string()))?;
    Ok(())
}
#[tauri::command]
pub async fn save_skill(
    name: String,
    description: String,
    allowed_tools: Option<Vec<String>>,
    content: String,
) -> Result<(), TauriError> {
    let jcode_dir = user_jcode_dir()
        .ok_or_else(|| TauriError::Other("Cannot resolve home directory".to_string()))?;
    let skills_dir = jcode_dir.join("skills");
    let skill_dir = skills_dir.join(&name);
    std::fs::create_dir_all(&skill_dir).map_err(|e| TauriError::from(e.to_string()))?;

    let file_path = skill_dir.join("SKILL.md");
    let mut file_content = String::new();
    file_content.push_str("---\n");
    file_content.push_str(&format!("name: {}\n", name));
    file_content.push_str(&format!("description: {}\n", description));
    if let Some(tools) = allowed_tools {
        file_content.push_str(&format!("allowed-tools: {}\n", tools.join(", ")));
    }
    file_content.push_str("---\n\n");
    file_content.push_str(&content);

    std::fs::write(&file_path, file_content).map_err(|e| TauriError::from(e.to_string()))?;

    // Reload shared registry so changes are visible immediately
    let registry = jcode::skill::SkillRegistry::shared_registry();
    let mut guard = registry.write().await;
    let _ = guard.reload_all();

    Ok(())
}
#[tauri::command]
pub async fn delete_skill(name: String) -> Result<(), TauriError> {
    let jcode_dir = user_jcode_dir()
        .ok_or_else(|| TauriError::Other("Cannot resolve home directory".to_string()))?;
    let skills_dir = jcode_dir.join("skills");

    // Try deleting the directory first, then a direct .md file
    let skill_dir = skills_dir.join(&name);
    let skill_file = skills_dir.join(format!("{}.md", name));

    let removed = if skill_dir.exists() {
        std::fs::remove_dir_all(&skill_dir).map_err(|e| TauriError::from(e.to_string()))?;
        true
    } else if skill_file.exists() {
        std::fs::remove_file(&skill_file).map_err(|e| TauriError::from(e.to_string()))?;
        true
    } else {
        false
    };

    if removed {
        let registry = jcode::skill::SkillRegistry::shared_registry();
        let mut guard = registry.write().await;
        guard
            .reload_all()
            .map_err(|e| TauriError::from(e.to_string()))?;
    }

    Ok(())
}
