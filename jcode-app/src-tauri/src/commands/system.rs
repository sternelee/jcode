use crate::commands::*;
use crate::error::TauriError;
use tauri::{AppHandle, Emitter, State};
use crate::commands::session::send_message;
#[tauri::command]
pub async fn list_background_tasks() -> Result<Vec<serde_json::Value>, TauriError> {
    use jcode::background::global;
    let tasks = global().list().await;
    tasks
        .into_iter()
        .map(|task| serde_json::to_value(task).map_err(|e| TauriError::from(e.to_string())))
        .collect()
}
#[tauri::command]
pub async fn cancel_background_task(task_id: String) -> Result<bool, TauriError> {
    jcode::background::global()
        .cancel(&task_id)
        .await
        .map_err(|e| TauriError::Other(format!("Failed to cancel task: {e}")))
}
#[tauri::command]
pub fn generate_pairing_code() -> Result<String, TauriError> {
    let mut registry = jcode::gateway::DeviceRegistry::load();
    let code = registry.generate_pairing_code();
    Ok(code)
}
#[tauri::command]
pub fn list_paired_devices() -> Result<serde_json::Value, TauriError> {
    let registry = jcode::gateway::DeviceRegistry::load();
    let devices: Vec<serde_json::Value> = registry
        .devices
        .into_iter()
        .map(|d| {
            serde_json::json!({
                "id": d.id,
                "name": d.name,
                "paired_at": d.paired_at,
                "last_seen": d.last_seen,
            })
        })
        .collect();
    Ok(serde_json::json!({ "devices": devices }))
}
#[tauri::command]
pub fn revoke_device(device_id: String) -> Result<(), TauriError> {
    let mut registry = jcode::gateway::DeviceRegistry::load();
    registry.devices.retain(|d| d.id != device_id);
    registry
        .save()
        .map_err(|e| TauriError::Other(format!("Failed to save device registry: {e}")))
}
#[tauri::command]
pub fn get_ambient_status() -> Result<serde_json::Value, TauriError> {
    use jcode::ambient::{AmbientManager, AmbientStatus};
    let manager =
        AmbientManager::new().map_err(|e| TauriError::Other(format!("Failed to load ambient manager: {e}")))?;
    let state = manager.state();
    let queue = manager.queue();

    let status_label = match &state.status {
        AmbientStatus::Idle => "idle",
        AmbientStatus::Running { .. } => "running",
        AmbientStatus::Scheduled { .. } => "scheduled",
        AmbientStatus::Paused { .. } => "paused",
        AmbientStatus::Disabled => "disabled",
    };

    let next_wake = match &state.status {
        AmbientStatus::Scheduled { next_wake } => Some(next_wake.to_rfc3339()),
        _ => None,
    };

    let scheduled_items: Vec<serde_json::Value> = queue
        .items()
        .iter()
        .map(|item| {
            serde_json::json!({
                "id": item.id,
                "scheduled_for": item.scheduled_for.to_rfc3339(),
                "context": item.context,
                "priority": match item.priority {
                    jcode::ambient::Priority::Low => "low",
                    jcode::ambient::Priority::Normal => "normal",
                    jcode::ambient::Priority::High => "high",
                },
                "target": match &item.target {
                    jcode::ambient::ScheduleTarget::Ambient => serde_json::json!({"kind": "ambient"}),
                    jcode::ambient::ScheduleTarget::Session { session_id } => serde_json::json!({"kind": "session", "session_id": session_id}),
                    jcode::ambient::ScheduleTarget::Spawn { parent_session_id } => serde_json::json!({"kind": "spawn", "parent_session_id": parent_session_id}),
                },
                "created_by_session": item.created_by_session,
                "task_description": item.task_description,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "enabled": AmbientManager::is_enabled(),
        "status": status_label,
        "next_wake": next_wake,
        "last_run": state.last_run.as_ref().map(|dt| dt.to_rfc3339()),
        "last_summary": state.last_summary,
        "last_compactions": state.last_compactions,
        "last_memories_modified": state.last_memories_modified,
        "total_cycles": state.total_cycles,
        "scheduled_count": scheduled_items.len(),
        "scheduled_items": scheduled_items,
    }))
}
#[tauri::command]
pub fn get_ambient_transcripts() -> Result<serde_json::Value, TauriError> {
    use jcode::ambient::VisibleCycleContext;
    let mut transcripts: Vec<serde_json::Value> = Vec::new();

    let dir = jcode::storage::jcode_dir()
        .map_err(|e| TauriError::from(e.to_string()))?
        .join("ambient")
        .join("transcripts");
    if dir.exists() {
        let mut entries: Vec<_> = std::fs::read_dir(&dir)
            .map_err(|e| TauriError::from(e.to_string()))?
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().extension().and_then(|ext| ext.to_str()) == Some("json"))
            .collect();
        entries.sort_by_key(|a| {
            std::cmp::Reverse(
                a.metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
            )
        });

        for entry in entries.into_iter().take(10) {
            let content = std::fs::read_to_string(entry.path()).unwrap_or_default();
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) {
                transcripts.push(value);
            }
        }
    }

    let visible_cycle = VisibleCycleContext::load().ok();

    Ok(serde_json::json!({
        "transcripts": transcripts,
        "visible_cycle": visible_cycle.map(|ctx| serde_json::json!({
            "system_prompt": ctx.system_prompt,
            "initial_message": ctx.initial_message,
        })),
    }))
}
#[tauri::command]
pub fn get_version_info() -> Result<serde_json::Value, TauriError> {
    Ok(serde_json::json!({
        "version": option_env!("JCODE_VERSION").unwrap_or("unknown"),
        "semver": option_env!("JCODE_SEMVER").unwrap_or("unknown"),
        "base_semver": option_env!("JCODE_BASE_SEMVER").unwrap_or("unknown"),
        "update_semver": option_env!("JCODE_UPDATE_SEMVER").unwrap_or("unknown"),
        "git_hash": option_env!("JCODE_GIT_HASH").unwrap_or("unknown"),
        "git_tag": option_env!("JCODE_GIT_TAG").unwrap_or("unknown"),
        "git_date": option_env!("JCODE_GIT_DATE").unwrap_or("unknown"),
        "release_build": option_env!("JCODE_RELEASE_BUILD").is_some(),
    }))
}
#[tauri::command]
pub async fn get_permission_requests() -> Result<serde_json::Value, TauriError> {
    let safety = jcode::safety::SafetySystem::new();
    let requests = safety.pending_requests();
    let items: Vec<serde_json::Value> = requests
        .iter()
        .map(|req| {
            serde_json::json!({
                "id": req.id,
                "action": req.action,
                "description": req.description,
                "rationale": req.rationale,
                "urgency": format!("{:?}", req.urgency).to_lowercase(),
                "wait": req.wait,
                "created_at": req.created_at.to_rfc3339(),
                "context": req.context,
            })
        })
        .collect();
    Ok(serde_json::json!({ "requests": items }))
}
#[tauri::command]
pub async fn respond_to_permission(
    request_id: String,
    approved: bool,
    message: Option<String>,
) -> Result<(), TauriError> {
    let safety = jcode::safety::SafetySystem::new();
    safety
        .record_decision(&request_id, approved, "desktop", message)
        .map_err(|e| TauriError::from(e.to_string()))
}
#[tauri::command]
pub async fn send_transcript(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    text: String,
    mode: String,
) -> Result<(), TauriError> {
    const TRANSCRIPTION_PREFIX: &str = "[transcription]";
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(TauriError::Other("Transcript text is empty".to_string()));
    }

    let effective_text = if mode == "send" {
        let trimmed_start = trimmed.trim_start();
        if trimmed_start.starts_with(TRANSCRIPTION_PREFIX)
            || trimmed_start.starts_with('/')
            || trimmed_start.starts_with('!')
        {
            trimmed.to_string()
        } else {
            format!("{} {}", TRANSCRIPTION_PREFIX, trimmed_start)
        }
    } else {
        trimmed.to_string()
    };

    if mode == "send" {
        let session_id = state
            .active_session_id
            .lock()
            .await
            .clone()
            .ok_or_else(|| TauriError::Other("No active session".to_string()))?;
        return send_message(
            app_handle,
            state,
            session_id,
            effective_text,
            Some(vec![]),
            None,
        )
        .await;
    } else {
        app_handle
            .emit(
                "server-event",
                &serde_json::json!({
                    "type": "transcript",
                    "text": effective_text,
                    "mode": mode,
                }),
            )
            .map_err(|e| TauriError::from(e.to_string()))?;
    }
    Ok(())
}
#[tauri::command]
pub async fn get_browser_status() -> Result<serde_json::Value, TauriError> {
    match jcode::browser::ensure_browser_ready_noninteractive().await {
        Ok(status) => Ok(serde_json::json!({
            "backend": status.backend,
            "browser": status.browser,
            "setup_complete": status.setup_complete,
            "binary_installed": status.binary_installed,
            "responding": status.responding,
            "compatible": status.compatible,
            "missing_actions": status.missing_actions,
            "ready": status.ready,
        })),
        Err(e) => Err(TauriError::Other(format!("Browser status check failed: {e}"))),
    }
}
#[tauri::command]
pub async fn setup_browser() -> Result<String, TauriError> {
    match jcode::browser::ensure_browser_setup().await {
        Ok(log) => Ok(log),
        Err(e) => Err(TauriError::Other(format!("Browser setup failed: {e}"))),
    }
}
#[tauri::command]
pub async fn save_session_state(session_id: String, working_dir: Option<String>) -> Result<(), TauriError> {
    let state = serde_json::json!({
        "session_id": session_id,
        "working_dir": working_dir,
        "saved_at": chrono::Utc::now().to_rfc3339(),
    });
    let path = jcode::storage::jcode_dir()
        .map_err(|e| TauriError::from(e.to_string()))?
        .join("desktop_app_state.json");
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&state).unwrap_or_default(),
    )
    .map_err(|e| TauriError::from(e.to_string()))
}
#[tauri::command]
pub async fn get_last_session_state() -> Result<Option<serde_json::Value>, TauriError> {
    let path = jcode::storage::jcode_dir()
        .map_err(|e| TauriError::from(e.to_string()))?
        .join("desktop_app_state.json");
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path).map_err(|e| TauriError::from(e.to_string()))?;
    let state: serde_json::Value = serde_json::from_str(&text).map_err(|e| TauriError::from(e.to_string()))?;
    Ok(Some(state))
}
#[tauri::command]
pub async fn clear_session_state() -> Result<(), TauriError> {
    let path = jcode::storage::jcode_dir()
        .map_err(|e| TauriError::from(e.to_string()))?
        .join("desktop_app_state.json");
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}
#[tauri::command]
pub async fn run_dictation() -> Result<serde_json::Value, TauriError> {
    let run = jcode::dictation::run_configured()
        .await
        .map_err(|e| TauriError::from(e.to_string()))?;
    let mode_str = match run.mode {
        jcode::protocol::TranscriptMode::Insert => "insert",
        jcode::protocol::TranscriptMode::Append => "append",
        jcode::protocol::TranscriptMode::Replace => "replace",
        jcode::protocol::TranscriptMode::Send => "send",
    };
    Ok(serde_json::json!({
        "text": run.text,
        "mode": mode_str,
    }))
}
#[tauri::command]
pub async fn list_workspace_files(working_dir: Option<String>) -> Result<Vec<String>, TauriError> {
    let root = working_dir.as_deref().unwrap_or(".");
    let mut files = Vec::new();

    fn should_ignore(name: &str) -> bool {
        name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "dist"
            || name == "build"
            || name == "__pycache__"
            || name == "venv"
            || name == ".venv"
            || name == "vendor"
    }

    fn collect_files(path: &std::path::Path, prefix: &str, depth: usize, out: &mut Vec<String>) {
        if depth > 4 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(path) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if should_ignore(&name) {
                continue;
            }
            let full = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", prefix, name)
            };
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_file() {
                out.push(full);
            } else if meta.is_dir() {
                collect_files(&entry.path(), &full, depth + 1, out);
            }
        }
    }

    collect_files(std::path::Path::new(root), "", 0, &mut files);
    files.sort();
    Ok(files)
}
#[tauri::command]
pub async fn git_status(working_dir: Option<String>) -> Result<String, TauriError> {
    let output = tokio::process::Command::new("git")
        .arg("status")
        .arg("--short")
        .arg("--branch")
        .current_dir(working_dir.as_deref().unwrap_or("."))
        .output()
        .await
        .map_err(|e| TauriError::Other(format!("Failed to run git status: {e}")))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(TauriError::Other(format!("git status failed: {stderr}")));
    }
    Ok(if stdout.trim().is_empty() {
        "Working tree clean".to_string()
    } else {
        stdout.trim().to_string()
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub staged: String,
    pub unstaged: String,
}

#[tauri::command]
pub async fn git_diff(working_dir: Option<String>) -> Result<GitDiffResult, TauriError> {
    let dir = working_dir.as_deref().unwrap_or(".");

    let staged = tokio::process::Command::new("git")
        .args(["diff", "--cached"])
        .current_dir(dir)
        .output()
        .await
        .map_err(|e| TauriError::Other(format!("Failed to run git diff --cached: {e}")))?;

    let unstaged = tokio::process::Command::new("git")
        .arg("diff")
        .current_dir(dir)
        .output()
        .await
        .map_err(|e| TauriError::Other(format!("Failed to run git diff: {e}")))?;

    Ok(GitDiffResult {
        staged: String::from_utf8_lossy(&staged.stdout).to_string(),
        unstaged: String::from_utf8_lossy(&unstaged.stdout).to_string(),
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

#[tauri::command]
pub async fn git_log(
    working_dir: Option<String>,
    count: Option<usize>,
) -> Result<Vec<GitLogEntry>, TauriError> {
    let dir = working_dir.as_deref().unwrap_or(".");
    let n = count.unwrap_or(20).to_string();

    let output = tokio::process::Command::new("git")
        .args(["log", &format!("--format=%H%x00%h%x00%an%x00%aI%x00%s"), "-n", &n])
        .current_dir(dir)
        .output()
        .await
        .map_err(|e| TauriError::Other(format!("Failed to run git log: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(TauriError::Other(format!("git log failed: {stderr}")));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let entries: Vec<GitLogEntry> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\0').collect();
            if parts.len() >= 5 {
                Some(GitLogEntry {
                    hash: parts[0].to_string(),
                    short_hash: parts[1].to_string(),
                    author: parts[2].to_string(),
                    date: parts[3].to_string(),
                    message: parts[4..].join("\0"),
                })
            } else {
                None
            }
        })
        .collect();

    Ok(entries)
}

#[tauri::command]
pub async fn trigger_ambient() -> Result<(), TauriError> {
    let mut state = jcode::ambient::AmbientState::load().unwrap_or_default();
    if matches!(
        state.status,
        jcode::ambient::AmbientStatus::Scheduled { .. } | jcode::ambient::AmbientStatus::Idle
    ) {
        state.status = jcode::ambient::AmbientStatus::Idle;
    }
    state.save().map_err(|e| TauriError::from(e.to_string()))
}
#[tauri::command]
pub async fn stop_ambient() -> Result<(), TauriError> {
    let mut state = jcode::ambient::AmbientState::load().unwrap_or_default();
    state.status = jcode::ambient::AmbientStatus::Disabled;
    state.save().map_err(|e| TauriError::from(e.to_string()))
}
