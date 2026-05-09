pub mod commands;

use commands::{
    create_agent, create_agent_with_session, create_provider, setup_stdin_channel, AppState,
};
use jcode::protocol::ServerEvent;
use jcode::session::Session;
use tauri::{AppHandle, Emitter, State};

async fn init_agent_and_emit(
    app_handle: &AppHandle,
    state: &State<'_, AppState>,
    mut agent: jcode::agent::Agent,
    working_dir: Option<String>,
) -> Result<(), String> {
    let current_model = agent.provider_handle().model();
    let cancel_signal = agent.graceful_shutdown_signal();
    let (_stdin_tx, mut stdin_rx) = setup_stdin_channel(&mut agent);

    {
        let mut guard = state.agent.lock().await;
        *guard = Some(agent);
    }
    {
        let mut guard = state.cancel_signal.lock().await;
        *guard = Some(cancel_signal);
    }
    {
        let mut guard = state.model.lock().await;
        *guard = Some(current_model.clone());
    }
    if let Some(dir) = working_dir {
        let mut guard = state.working_dir.lock().await;
        *guard = Some(dir);
    }

    let handle = app_handle.clone();
    let pending = state.pending_stdin.clone();
    tokio::spawn(async move {
        while let Some(req) = stdin_rx.recv().await {
            let rid = req.request_id.clone();
            pending.lock().await.insert(rid.clone(), req.response_tx);
            handle
                .emit(
                    "server-event",
                    &serde_json::json!({
                        "type": "stdin_request",
                        "request_id": rid,
                        "prompt": req.prompt,
                        "is_password": req.is_password,
                        "tool_call_id": "",
                    }),
                )
                .ok();
        }
    });

    app_handle
        .emit(
            "server-event",
            &serde_json::json!({ "type": "connection_phase", "phase": "connected" }),
        )
        .ok();
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({ "type": "model_changed", "id": 0, "model": current_model }),
        )
        .ok();
    Ok(())
}

#[tauri::command]
async fn begin_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    working_dir: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    let provider = create_provider().await?;
    if let Some(ref model_name) = model {
        jcode::provider::set_model_with_auth_refresh(provider.as_ref(), model_name)
            .map_err(|e| format!("Failed to set model: {e}"))?;
    }
    let agent = create_agent(provider, working_dir.as_deref()).await?;
    init_agent_and_emit(&app_handle, &state, agent, working_dir).await
}

#[tauri::command]
async fn resume_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    working_dir: Option<String>,
) -> Result<(), String> {
    let session = Session::load(&session_id)
        .map_err(|e| format!("Failed to load session {}: {e}", &session_id))?;
    let provider = create_provider().await?;
    if let Some(ref saved_model) = session.model {
        let _ = jcode::provider::set_model_with_auth_refresh(provider.as_ref(), saved_model);
    }
    let agent = create_agent_with_session(provider, session, working_dir.as_deref()).await?;
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({ "type": "session", "session_id": session_id }),
        )
        .ok();
    init_agent_and_emit(&app_handle, &state, agent, working_dir).await
}

#[tauri::command]
async fn send_message(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    content: String,
    images: Option<Vec<(String, String)>>,
    system_reminder: Option<String>,
) -> Result<(), String> {
    let mut agent_guard = state.agent.lock().await;
    let mut agent = agent_guard.take().ok_or("No active session")?;
    drop(agent_guard);

    let agent_arc = state.agent.clone();
    let handle = app_handle.clone();
    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ServerEvent>();
        let rh = handle.clone();
        let reader = tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                let payload = serde_json::to_value(&event).unwrap_or_default();
                rh.emit("server-event", &payload).ok();
            }
        });
        let result = agent
            .run_once_streaming_mpsc(&content, images.unwrap_or_default(), system_reminder, tx)
            .await;
        reader.await.ok();
        {
            let mut g = agent_arc.lock().await;
            agent.graceful_shutdown_signal().reset();
            *g = Some(agent);
        }
        if let Err(e) = result {
            handle
                .emit(
                    "server-event",
                    &serde_json::json!({ "type": "error", "id": 0, "message": format!("{e:#}") }),
                )
                .ok();
        }
        handle
            .emit(
                "server-event",
                &serde_json::json!({ "type": "done", "id": 0 }),
            )
            .ok();
    });
    Ok(())
}

#[tauri::command]
async fn cancel(state: State<'_, AppState>) -> Result<(), String> {
    let guard = state.cancel_signal.lock().await;
    if let Some(signal) = guard.as_ref() {
        signal.fire();
        Ok(())
    } else {
        Err("No active agent".to_string())
    }
}

#[tauri::command]
async fn set_model(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    model: String,
) -> Result<(), String> {
    let mut guard = state.agent.lock().await;
    let agent = guard.as_mut().ok_or("No active session")?;
    agent
        .set_model(&model)
        .map_err(|e| format!("Failed to set model: {e}"))?;
    let current = agent.provider_handle().model();
    drop(guard);
    {
        let mut mg = state.model.lock().await;
        *mg = Some(current.clone());
    }
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({ "type": "model_changed", "id": 0, "model": current }),
        )
        .ok();
    Ok(())
}

#[tauri::command]
async fn list_sessions(_state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let dir = jcode::storage::jcode_dir()
        .map_err(|e| e.to_string())?
        .join("sessions");
    let mut sessions = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if stem.ends_with(".journal") {
                continue;
            }
            if let Ok(stub) = Session::load_startup_stub(stem) {
                sessions.push(serde_json::json!({
                    "id": stub.id,
                    "title": stub.display_title_or_name(),
                    "model": stub.model,
                    "provider": stub.provider_key,
                    "status": stub.status.display(),
                    "working_dir": stub.working_dir,
                }));
            }
        }
    }
    sessions.sort_by(|a, b| b["id"].as_str().cmp(&a["id"].as_str()));
    Ok(sessions)
}

#[tauri::command]
async fn send_stdin_response(
    state: State<'_, AppState>,
    request_id: String,
    input: String,
) -> Result<(), String> {
    let mut guard = state.pending_stdin.lock().await;
    if let Some(tx) = guard.remove(&request_id) {
        let _ = tx.send(input);
        Ok(())
    } else {
        Err(format!("No pending stdin request with id {}", request_id))
    }
}

#[tauri::command]
async fn get_models(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let provider = {
        let guard = state.agent.lock().await;
        let agent = guard.as_ref().ok_or("No active session")?;
        agent.provider_handle()
    };
    let _ = provider.prefetch_models().await;
    let guard = state.agent.lock().await;
    let agent = guard.as_ref().ok_or("No active session")?;
    let routes: Vec<serde_json::Value> = agent
        .model_routes()
        .into_iter()
        .filter(|r| jcode::provider::is_listable_model_name(&r.model))
        .map(|r| {
            serde_json::json!({
                "provider": r.provider,
                "model": r.model,
                "available": r.available,
                "api_method": r.api_method,
            })
        })
        .collect();
    Ok(serde_json::json!({ "routes": routes, "current": agent.provider_handle().model() }))
}

#[tauri::command]
async fn clear_chat(app_handle: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.agent.lock().await;
    let agent = guard.as_mut().ok_or("No active session")?;
    agent.clear();
    drop(guard);
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({ "type": "clear_chat" }),
        )
        .ok();
    Ok(())
}

#[tauri::command]
async fn rewind_chat(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    message_index: usize,
) -> Result<(), String> {
    let mut guard = state.agent.lock().await;
    let agent = guard.as_mut().ok_or("No active session")?;
    agent
        .rewind_to_message(message_index)
        .map_err(|e| format!("Failed to rewind: {e}"))?;
    drop(guard);
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({ "type": "rewind_chat", "message_index": message_index }),
        )
        .ok();
    Ok(())
}

#[tauri::command]
async fn set_reasoning_effort(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    effort: String,
) -> Result<(), String> {
    let mut guard = state.agent.lock().await;
    let agent = guard.as_mut().ok_or("No active session")?;
    let current = agent
        .set_reasoning_effort(&effort)
        .map_err(|e| format!("Failed to set reasoning effort: {e}"))?;
    drop(guard);
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({
                "type": "reasoning_effort_changed",
                "id": 0,
                "effort": current,
            }),
        )
        .ok();
    Ok(())
}

#[tauri::command]
async fn compact_context(app_handle: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.agent.lock().await;
    let agent = guard.as_mut().ok_or("No active session")?;
    let provider = agent.provider_fork();
    let compaction = agent.registry().compaction();
    let messages = agent.provider_messages();
    drop(guard);

    if !provider.supports_compaction() {
        app_handle
            .emit(
                "server-event",
                &serde_json::json!({
                    "type": "compact_result",
                    "id": 0,
                    "message": "Manual compaction is not available for this provider.",
                    "success": false,
                }),
            )
            .ok();
        return Ok(());
    }

    let result = match compaction.try_write() {
        Ok(mut manager) => {
            let stats = manager.stats_with(&messages);
            let status_msg = format!(
                "**Context Status:**\n\
                • Messages: {} (active), {} (total history)\n\
                • Token usage: ~{}k (estimate ~{}k) / {}k ({:.1}%)\n\
                • Has summary: {}\n\
                • Compacting: {}",
                stats.active_messages,
                stats.total_turns,
                stats.effective_tokens / 1000,
                stats.token_estimate / 1000,
                manager.token_budget() / 1000,
                stats.context_usage * 100.0,
                if stats.has_summary { "yes" } else { "no" },
                if stats.is_compacting { "in progress..." } else { "no" }
            );

            match manager.force_compact_with(&messages, provider) {
                Ok(()) => serde_json::json!({
                    "type": "compact_result",
                    "id": 0,
                    "message": format!(
                        "{}\n\n📦 **Compacting context** (manual) — summarizing older messages in the background to stay within the context window.\n\
                        The summary will be applied automatically when ready.",
                        status_msg
                    ),
                    "success": true,
                }),
                Err(reason) => serde_json::json!({
                    "type": "compact_result",
                    "id": 0,
                    "message": format!("{}\n\n⚠ **Cannot compact:** {}", status_msg, reason),
                    "success": false,
                }),
            }
        }
        Err(_) => serde_json::json!({
            "type": "compact_result",
            "id": 0,
            "message": "⚠ Cannot access compaction manager (lock held)",
            "success": false,
        }),
    };

    app_handle.emit("server-event", &result).ok();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            begin_session,
            resume_session,
            send_message,
            cancel,
            set_model,
            list_sessions,
            send_stdin_response,
            get_models,
            clear_chat,
            rewind_chat,
            set_reasoning_effort,
            compact_context,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
