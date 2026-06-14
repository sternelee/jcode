use crate::commands::*;
use crate::error::TauriError;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellCommandResult {
    command: String,
    output: String,
    exit_code: Option<i32>,
    duration_ms: u64,
}
#[tauri::command]
pub async fn execute_shell_command(
    command: String,
    working_dir: Option<String>,
) -> Result<ShellCommandResult, TauriError> {
    let started = std::time::Instant::now();
    let mut cmd = std::process::Command::new("bash");
    cmd.arg("-c").arg(&command);
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if let Some(ref dir) = working_dir {
        cmd.current_dir(dir);
    }
    match cmd.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let mut combined = String::new();
            if !stdout.is_empty() {
                combined.push_str(&stdout);
            }
            if !stderr.is_empty() {
                if !combined.is_empty() && !combined.ends_with('\n') {
                    combined.push('\n');
                }
                combined.push_str("[stderr]\n");
                combined.push_str(&stderr);
            }
            // Truncate very large output
            const MAX_LEN: usize = 50_000;
            if combined.len() > MAX_LEN {
                combined.truncate(MAX_LEN);
                combined.push_str("\n… output truncated");
            }
            Ok(ShellCommandResult {
                command,
                output: combined,
                exit_code: output.status.code(),
                duration_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
            })
        }
        Err(e) => Err(TauriError::Other(format!("Failed to run command: {e}"))),
    }
}
#[tauri::command]
pub async fn search_applications(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<crate::launcher::AppInfo>, TauriError> {
    let index = state.app_index.lock().await;
    let running = state
        .running_apps
        .lock()
        .map_err(|e| TauriError::Other(format!("running-apps lock poisoned: {e}")))?;
    let results = index.search_with_running(&query, &running);
    eprintln!(
        "[launcher] search_applications(\"{query}\") -> {} results (index has {} total)",
        results.len(),
        index.all().len()
    );
    Ok(results)
}
#[tauri::command]
pub async fn refresh_applications(state: State<'_, AppState>) -> Result<(), TauriError> {
    let mut index = state.app_index.lock().await;
    index.refresh().map_err(|e| TauriError::from(e))
}
#[tauri::command]
pub async fn launch_application(
    path: String,
    args: Option<Vec<String>>,
) -> Result<(), TauriError> {
    crate::launcher::launch_application(&path, args).map_err(|e| TauriError::from(e))
}
#[tauri::command]
pub async fn quit_application(bundle_id: String) -> Result<(), TauriError> {
    crate::launcher::quit_application(&bundle_id).map_err(|e| TauriError::from(e))
}
#[tauri::command]
pub async fn show_launcher(app_handle: AppHandle) -> Result<(), TauriError> {
    if let Some(window) = app_handle.get_webview_window("launcher") {
        window.show().map_err(|e| TauriError::from(e.to_string()))?;
        window.set_focus().map_err(|e| TauriError::from(e.to_string()))?;
        // Mirror the global-hotkey behaviour: tell the launcher to reset
        // its query and re-focus the input. Without this, a Cmd+K
        // invocation from inside the workbench would show the launcher
        // but leave stale state from the previous invocation visible.
        let _ = app_handle.emit("global-shortcut", "show-launcher");
    }
    Ok(())
}
#[tauri::command]
pub async fn hide_launcher(app_handle: AppHandle) -> Result<(), TauriError> {
    if let Some(window) = app_handle.get_webview_window("launcher") {
        let _ = window.hide();
    }
    Ok(())
}
#[tauri::command]
pub async fn show_workbench(app_handle: AppHandle) -> Result<(), TauriError> {
    if let Some(window) = app_handle.get_webview_window("workbench") {
        window.show().map_err(|e| TauriError::from(e.to_string()))?;
        window.set_focus().map_err(|e| TauriError::from(e.to_string()))?;
    }
    Ok(())
}
#[tauri::command]
pub async fn hide_workbench(app_handle: AppHandle) -> Result<(), TauriError> {
    if let Some(window) = app_handle.get_webview_window("workbench") {
        let _ = window.hide();
    }
    Ok(())
}
#[tauri::command]
pub async fn expand_to_workbench(
    app_handle: AppHandle,
    payload: Option<serde_json::Value>,
) -> Result<(), TauriError> {
    if let Some(window) = app_handle.get_webview_window("launcher") {
        let _ = window.hide();
    }
    if let Some(window) = app_handle.get_webview_window("workbench") {
        window.show().map_err(|e| TauriError::from(e.to_string()))?;
        window.set_focus().map_err(|e| TauriError::from(e.to_string()))?;
    }
    if let Some(value) = payload {
        let event = match value.get("kind").and_then(|v| v.as_str()) {
            Some(kind) => format!("launcher:open-{kind}"),
            None => "launcher:open".to_string(),
        };
        let _ = app_handle.emit(&event, value);
    }
    Ok(())
}
#[tauri::command]
pub async fn hide_pages_window(app_handle: AppHandle) -> Result<(), TauriError> {
    if let Some(window) = app_handle.get_webview_window("pages") {
        window.hide().map_err(|e| TauriError::from(e.to_string()))?;
    }
    Ok(())
}
#[tauri::command]
pub async fn open_pages_window(
    app_handle: AppHandle,
    page: String,
) -> Result<(), TauriError> {
    if let Some(window) = app_handle.get_webview_window("pages") {
        window.show().map_err(|e| TauriError::from(e.to_string()))?;
        window.set_focus().map_err(|e| TauriError::from(e.to_string()))?;
        let _ = app_handle.emit("pages:navigate", page);
    }
    Ok(())
}
#[tauri::command]
pub async fn drag_window(window: tauri::WebviewWindow) -> Result<(), TauriError> {
    window.start_dragging().map_err(|e| TauriError::from(e.to_string()))
}
#[tauri::command]
pub async fn minimize_window(window: tauri::WebviewWindow) -> Result<(), TauriError> {
    window.minimize().map_err(|e| TauriError::from(e.to_string()))
}
#[tauri::command]
pub async fn toggle_maximize_window(window: tauri::WebviewWindow) -> Result<(), TauriError> {
    #[cfg(target_os = "macos")]
    {
        // NSWindow UI operations (including -zoom:) must run on the main
        // thread. Tauri async commands run on the tokio thread pool, so we
        // dispatch to the main thread via run_on_main_thread and wait for it
        // to complete with a oneshot channel.
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), TauriError>>();
        window
            .clone()
            .run_on_main_thread(move || {
                let result = (|| {
                    let ns_window_ptr = window.ns_window().map_err(|e| TauriError::from(e.to_string()))?;
                    if ns_window_ptr.is_null() {
                        return Err(TauriError::Other("native NSWindow is null".to_string()));
                    }
                    unsafe {
                        use objc::runtime::Object;
                        let ns_window = ns_window_ptr as *mut Object;
                        let _: () = msg_send![ns_window, zoom: ns_window];
                    }
                    Ok(())
                })();
                let _ = tx.send(result);
            })
            .map_err(|e| TauriError::from(e.to_string()))?;
        rx.recv().map_err(|e| TauriError::from(e.to_string()))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let maximized = window.is_maximized().map_err(|e| TauriError::from(e.to_string()))?;
        if maximized {
            window.unmaximize().map_err(|e| TauriError::from(e.to_string()))
        } else {
            window.maximize().map_err(|e| TauriError::from(e.to_string()))
        }
    }
}
