use crate::commands::*;
use crate::error::TauriError;
use crate::utils::*;
use jcode::protocol::ServerEvent;
use jcode::provider::Provider;
use jcode::session::Session;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
#[tauri::command]
pub async fn begin_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    working_dir: Option<String>,
    model: Option<String>,
    memory_enabled: Option<bool>,
    role_name: Option<String>,
    profile_id: Option<String>,
    force_provider: Option<bool>,
) -> Result<String, TauriError> {
    let provider = state.get_provider().await?.fork();
    if let Some(ref model_name) = model {
        let model_arg = if let Some(pid) = profile_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            format!("{}:{}", pid, model_name)
        } else {
            model_name.clone()
        };
        jcode::provider::set_model_with_auth_refresh(provider.as_ref(), &model_arg)
            .map_err(|e| TauriError::Other(format!("Failed to set model: {e}")))?;
        if force_provider.unwrap_or(false) {
            provider.lock_active_provider();
        }
    }

    let mut session = Session::create(None, None);
    session.working_dir = working_dir.clone();
    session.model = Some(provider.model());
    session.provider_key = jcode::session::derive_session_provider_key(provider.name());
    if let Some(name) = role_name {
        session.rename_title(Some(name));
    }

    let mut agent = create_agent_with_session(provider, session, working_dir.as_deref()).await?;
    let resolved_memory_enabled = memory_enabled.unwrap_or_else(|| {
        jcode::config::Config::resolve_workspace_memory_enabled(working_dir.as_deref())
    });
    agent.set_memory_enabled(resolved_memory_enabled);

    let runtime = register_runtime_and_emit(&app_handle, &state, agent).await?;
    Ok(runtime.session_id.clone())
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmMemberRequest {
    role_name: String,
    model: Option<String>,
    /// Optional provider key. When set, the member is created on this
    /// OpenAI-compatible profile id). Falls back to `profile_id` for
    /// backward compatibility with existing clients.
    #[serde(default)]
    provider_key: Option<String>,
    /// Deprecated alias for `provider_key`. Kept for clients that still
    /// pass the older field name. When both are set, `provider_key` wins.
    #[serde(default)]
    profile_id: Option<String>,
}
#[tauri::command]
pub async fn begin_swarm(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    working_dir: Option<String>,
    coordinator_model: Option<String>,
    coordinator_profile_id: Option<String>,
    memory_enabled: Option<bool>,
    members: Vec<SwarmMemberRequest>,
) -> Result<Vec<String>, TauriError> {
    let provider = state.get_provider().await?;

    // -- Coordinator --
    let coordinator_provider = provider.fork();
    if let Some(ref model_name) = coordinator_model {
        let model_arg = if let Some(pid) = coordinator_profile_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            format!("{}:{}", pid, model_name)
        } else {
            model_name.clone()
        };
        jcode::provider::set_model_with_auth_refresh(coordinator_provider.as_ref(), &model_arg)
            .map_err(|e| TauriError::Other(format!("Failed to set coordinator model: {e}")))?;
    }

    let mut coordinator_session = Session::create(None, None);
    coordinator_session.working_dir = working_dir.clone();
    coordinator_session.model = Some(coordinator_provider.model());
    coordinator_session.provider_key =
        jcode::session::derive_session_provider_key(coordinator_provider.name());
    coordinator_session.rename_title(Some("Coordinator".to_string()));
    coordinator_session
        .save()
        .map_err(|e| TauriError::Other(format!("Failed to persist coordinator session: {e}")))?;

    let mut coordinator_agent = create_agent_with_session(
        coordinator_provider,
        coordinator_session,
        working_dir.as_deref(),
    )
    .await?;
    let resolved_memory_enabled = memory_enabled.unwrap_or_else(|| {
        jcode::config::Config::resolve_workspace_memory_enabled(working_dir.as_deref())
    });
    coordinator_agent.set_memory_enabled(resolved_memory_enabled);

    let coordinator_runtime =
        register_runtime_and_emit(&app_handle, &state, coordinator_agent).await?;
    let coordinator_id = coordinator_runtime.session_id.clone();
    let mut created_ids = vec![coordinator_id];
    // -- Members --
    for member in members {
        let role_name = member.role_name.clone();
        let model = member.model.clone();
        let provider_key = member
            .provider_key
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or_else(|| {
                member
                    .profile_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            });

        let create_result = async {
            let provider = create_provider().await?;
            if let Some(ref model_name) = model {
                let model_arg = if let Some(ref pk) = provider_key {
                    format!("{}:{}", pk, model_name)
                } else {
                    model_name.clone()
                };
                jcode::provider::set_model_with_auth_refresh(provider.as_ref(), &model_arg)
                    .map_err(|e| {
                        format!("Swarm creation failed for member '{}': {}.", role_name, e)
                    })?;
            }

            let mut session = Session::create(None, None);
            session.working_dir = working_dir.clone();
            session.model = Some(provider.model());
            session.provider_key = jcode::session::derive_session_provider_key(provider.name());
            session.rename_title(Some(role_name.clone()));
            session.save().map_err(|e| {
                TauriError::Other(format!(
                    "Failed to persist member session '{}': {}",
                    role_name, e
                ))
            })?;

            let mut agent = create_agent_with_session(provider, session, working_dir.as_deref())
                .await
                .map_err(|e| {
                    TauriError::Other(format!(
                        "Swarm creation failed for member '{}': {}.",
                        role_name, e
                    ))
                })?;
            agent.set_memory_enabled(resolved_memory_enabled);

            let runtime = register_runtime_and_emit_with_active(&app_handle, &state, agent, false)
                .await
                .map_err(|e| {
                    TauriError::Other(format!(
                        "Swarm creation failed for member '{}': {}.",
                        role_name, e
                    ))
                })?;
            Ok::<String, TauriError>(runtime.session_id.clone())
        }
        .await;

        match create_result {
            Ok(id) => created_ids.push(id),
            Err(e) => {
                {
                    let mut active = state.active_session_id.lock().await;
                    for id in &created_ids {
                        if active.as_deref() == Some(id) {
                            *active = None;
                        }
                    }
                }
                for id in &created_ids {
                    let _ = delete_session_artifacts(id);
                    let _ = state.runtimes.lock().await.remove(id);
                    state.swarm.lock().await.remove_session(id);
                }
                return Err(TauriError::Other(format!(
                    "{} All sessions rolled back.",
                    e
                )));
            }
        }
    }

    Ok(created_ids)
}
#[tauri::command]
pub async fn add_swarm_member(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    working_dir: Option<String>,
    role_name: String,
    model: Option<String>,
    provider_key: Option<String>,
    memory_enabled: Option<bool>,
) -> Result<String, TauriError> {
    let trimmed_provider_key = provider_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let provider = create_provider().await?;
    if let Some(ref model_name) = model {
        let model_arg = if let Some(ref pk) = trimmed_provider_key {
            format!("{}:{}", pk, model_name)
        } else {
            model_name.clone()
        };
        jcode::provider::set_model_with_auth_refresh(provider.as_ref(), &model_arg)
            .map_err(|e| TauriError::Other(format!("Failed to set swarm member model: {e}")))?;
    }

    let mut session = Session::create(None, None);
    session.working_dir = working_dir.clone();
    session.model = Some(provider.model());
    session.provider_key = jcode::session::derive_session_provider_key(provider.name());
    session.rename_title(Some(role_name.clone()));
    session.save().map_err(|e| {
        TauriError::Other(format!(
            "Failed to persist member session '{}': {}",
            role_name, e
        ))
    })?;

    let mut agent = create_agent_with_session(provider, session, working_dir.as_deref()).await?;
    let resolved_memory_enabled = memory_enabled.unwrap_or_else(|| {
        jcode::config::Config::resolve_workspace_memory_enabled(working_dir.as_deref())
    });
    agent.set_memory_enabled(resolved_memory_enabled);

    let runtime = register_runtime_and_emit_with_active(&app_handle, &state, agent, false).await?;
    Ok(runtime.session_id.clone())
}
#[tauri::command]
pub async fn resume_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    working_dir: Option<String>,
) -> Result<(), TauriError> {
    if let Some(runtime) = state.runtimes.lock().await.get(&session_id).cloned() {
        {
            let mut active = state.active_session_id.lock().await;
            *active = Some(session_id.clone());
        }
        app_handle
            .emit(
                "server-event",
                &serde_json::json!({ "type": "connection_phase", "phase": "connected", "session_id": &session_id }),
            )
            .ok();
        emit_runtime_snapshot(&app_handle, &runtime).await?;
        return Ok(());
    }

    // Try server-backed resume first if a server connection is available.
    if let Ok(client) = get_server_client(&state) {
        let req = jcode::protocol::Request::ResumeSession {
            id: 1,
            session_id: session_id.clone(),
            client_instance_id: None,
            client_has_local_history: false,
            allow_session_takeover: false,
        };
        match client.request(req).await {
            Ok(jcode::protocol::ServerEvent::History { .. }) => {
                eprintln!(
                    "[resume_session] server resume succeeded for {}",
                    session_id
                );
                client.set_active_session(Some(session_id.clone()));
                state
                    .server_managed_sessions
                    .lock()
                    .await
                    .insert(session_id.clone());
                {
                    let mut active = state.active_session_id.lock().await;
                    *active = Some(session_id.clone());
                }
                // The History response was consumed by request(); emit it manually so
                // the frontend receives the full payload via the normal event pipeline.
                // Re-fetch the session from disk to build a local snapshot for the UI.
                if let Ok(session) = Session::load(&session_id) {
                    let messages = desktop_history_messages(&session);
                    let provider = state.get_provider().await?.fork();
                    if let Some(ref saved_model) = session.model {
                        let model_arg = if let Some(ref pk) = session.provider_key {
                            format!("{}:{}", pk, saved_model)
                        } else {
                            saved_model.clone()
                        };
                        let _ = jcode::provider::set_model_with_auth_refresh(
                            provider.as_ref(),
                            &model_arg,
                        );
                    }
                    app_handle
                        .emit(
                            "server-event",
                            &serde_json::json!({
                                "type": "connection_phase",
                                "phase": "connected",
                                "session_id": &session_id,
                            }),
                        )
                        .ok();
                    app_handle
                        .emit(
                            "server-event",
                            &serde_json::json!({
                                "type": "history",
                                "id": 0,
                                "session_id": session_id.clone(),
                                "messages": messages,
                                "images": Vec::<serde_json::Value>::new(),
                                "provider_name": infer_provider_name_from_model(provider.name(), &provider.model()),
                                "provider_model": provider.model(),
                                "available_models": provider.available_models_display(),
                                "available_model_routes": Vec::<jcode::provider::ModelRoute>::new(),
                                "all_sessions": Vec::<String>::new(),
                                "reasoning_effort": provider.reasoning_effort(),
                                "connection_type": None::<String>,
                                "status_detail": None::<String>,
                                "memory_enabled": true,
                            }),
                        )
                        .ok();
                }
                return Ok(());
            }
            Ok(other) => {
                eprintln!(
                    "[resume_session] unexpected server response for {}: {:?}",
                    session_id, other
                );
            }
            Err(e) => {
                eprintln!(
                    "[resume_session] server resume failed for {}: {}, falling back to local",
                    session_id, e
                );
            }
        }
    }

    let session = Session::load(&session_id)
        .map_err(|e| TauriError::Other(format!("Failed to load session {}: {e}", &session_id)))?;
    let provider = state.get_provider().await?.fork();
    if let Some(ref saved_model) = session.model {
        let model_arg = if let Some(ref pk) = session.provider_key {
            format!("{}:{}", pk, saved_model)
        } else {
            saved_model.clone()
        };
        let _ = jcode::provider::set_model_with_auth_refresh(provider.as_ref(), &model_arg);
    }

    let agent = create_agent_with_session(provider, session, working_dir.as_deref()).await?;
    register_runtime_and_emit(&app_handle, &state, agent)
        .await
        .map(|_| ())
        .map_err(|e| TauriError::from(e))
}
#[tauri::command]
pub async fn send_message(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    content: String,
    images: Option<Vec<(String, String)>>,
    system_reminder: Option<String>,
) -> Result<(), TauriError> {
    eprintln!(
        "[send_message] → session={} content={:?}",
        session_id,
        content.chars().take(60).collect::<String>()
    );

    // Server-managed session: forward message to the jcode server.
    if state
        .server_managed_sessions
        .lock()
        .await
        .contains(&session_id)
    {
        let client = get_server_client(&state)?;
        client.set_active_session(Some(session_id.clone()));
        let req = jcode::protocol::Request::Message {
            id: 1,
            content,
            images: images.unwrap_or_default(),
            system_reminder,
        };
        client.send(req).await?;
        return Ok(());
    }

    // 若 runtime 不在内存（Swarm 模式下历史会话尚未加载），则静默从磁盘加载
    let runtime = match get_or_load_session_runtime(&app_handle, &state, &session_id).await {
        Ok(rt) => {
            eprintln!("[send_message] runtime ready (session={})", session_id);
            rt
        }
        Err(e) => {
            eprintln!("[send_message] ERROR: runtime not found: {e}");
            return Err(TauriError::from(e));
        }
    };
    {
        let mut processing = runtime.is_processing.lock().await;
        *processing = true;
    }
    {
        let mut tool = runtime.current_tool_name.lock().await;
        *tool = None;
    }

    let handle = app_handle.clone();
    let swarm = state.swarm.clone();
    let session_id_for_spawn = session_id.clone();
    tokio::spawn(async move {
        // Capture workspace_id early so we can emit unified workspace events.
        let workspace_id = runtime
            .agent
            .lock()
            .await
            .working_dir()
            .map(|s| s.to_string());

        // Emit user_message workspace event so the frontend virtual thread
        // receives it from a single backend source (prevents frontend mirroring
        // drift / duplication).
        if let Some(ref wd) = workspace_id {
            handle
                .emit(
                    "workspace-event",
                    &serde_json::json!({
                        "type": "user_message",
                        "workspace_id": wd,
                        "content": content,
                        "session_id": session_id_for_spawn,
                    }),
                )
                .ok();
        }

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ServerEvent>();
        let runtime_for_reader = runtime.clone();
        let rh = handle.clone();
        let sid = session_id_for_spawn.clone();
        let swarm_for_reader = swarm.clone();
        let reader = tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                match &event {
                    ServerEvent::ToolStart { name, .. } => {
                        *runtime_for_reader.current_tool_name.lock().await = Some(name.clone());
                        *runtime_for_reader.is_processing.lock().await = true;
                    }
                    ServerEvent::ToolDone { .. } => {
                        *runtime_for_reader.current_tool_name.lock().await = None;
                    }
                    ServerEvent::StatusDetail { detail } => {
                        *runtime_for_reader.status_detail.lock().await = Some(detail.clone());
                    }
                    ServerEvent::ConnectionPhase { phase } => {
                        *runtime_for_reader.connection_phase.lock().await = Some(phase.clone());
                    }
                    ServerEvent::Done { .. } | ServerEvent::Interrupted => {
                        *runtime_for_reader.is_processing.lock().await = false;
                        *runtime_for_reader.current_tool_name.lock().await = None;
                    }
                    ServerEvent::Error { .. } => {
                        *runtime_for_reader.is_processing.lock().await = false;
                        *runtime_for_reader.current_tool_name.lock().await = None;
                    }
                    ServerEvent::SwarmStatus { members } => {
                        let peer_count = members.len();
                        let mut guard = swarm_for_reader.lock().await;
                        let mut statuses = Vec::new();
                        for m in members {
                            if m.session_id == runtime_for_reader.session_id {
                                *runtime_for_reader.status_detail.lock().await = m.detail.clone();
                            }
                            statuses.push(crate::commands::SwarmMemberStatus {
                                session_id: m.session_id.clone(),
                                status: m.status.clone(),
                                detail: m.detail.clone(),
                                role: m.role.clone(),
                                peer_count,
                            });
                        }
                        guard.apply_status(statuses);
                    }
                    ServerEvent::SwarmPlan {
                        swarm_id,
                        version,
                        items,
                        participants,
                        reason,
                        summary,
                    } => {
                        let item_values = items
                            .iter()
                            .map(|item| {
                                serde_json::json!({
                                    "id": item.id,
                                    "content": item.content,
                                    "status": item.status,
                                    "priority": item.priority,
                                    "subsystem": item.subsystem,
                                    "file_scope": item.file_scope,
                                    "blocked_by": item.blocked_by,
                                    "assigned_to": item.assigned_to,
                                })
                            })
                            .collect::<Vec<_>>();
                        let (
                            ready_count,
                            active_count,
                            blocked_count,
                            completed_count,
                            next_ready_ids,
                            preview_items,
                        ) = summarize_swarm_plan_items(
                            swarm_id,
                            *version,
                            participants.clone(),
                            reason.clone(),
                            item_values,
                            summary.as_ref(),
                        );
                        let participant_ids = if participants.is_empty() {
                            vec![runtime_for_reader.session_id.clone()]
                        } else {
                            participants.clone()
                        };
                        swarm_for_reader.lock().await.apply_plan(
                            crate::commands::SwarmPlanSnapshot {
                                swarm_id: swarm_id.clone(),
                                version: *version,
                                items: items
                                    .iter()
                                    .map(|item| {
                                        serde_json::json!({
                                            "id": item.id,
                                            "content": item.content,
                                            "status": item.status,
                                            "priority": item.priority,
                                            "subsystem": item.subsystem,
                                            "file_scope": item.file_scope,
                                            "blocked_by": item.blocked_by,
                                            "assigned_to": item.assigned_to,
                                        })
                                    })
                                    .collect(),
                                participants: participant_ids.clone(),
                                reason: reason.clone(),
                                ready_count,
                                active_count,
                                blocked_count,
                                completed_count,
                                next_ready_ids,
                                preview_items,
                            },
                        );
                    }
                    ServerEvent::SwarmPlanProposal {
                        swarm_id,
                        proposer_session,
                        proposer_name,
                        items,
                        summary,
                        proposal_key,
                    } => {
                        swarm_for_reader.lock().await.apply_proposal(
                            runtime_for_reader.session_id.clone(),
                            crate::commands::SwarmProposalSnapshot {
                                swarm_id: swarm_id.clone(),
                                proposer_session: proposer_session.clone(),
                                proposer_name: proposer_name.clone(),
                                summary: summary.clone(),
                                proposal_key: proposal_key.clone(),
                                items: items
                                    .iter()
                                    .map(|item| {
                                        serde_json::json!({
                                            "id": item.id,
                                            "content": item.content,
                                            "status": item.status,
                                            "priority": item.priority,
                                            "subsystem": item.subsystem,
                                            "file_scope": item.file_scope,
                                            "blocked_by": item.blocked_by,
                                            "assigned_to": item.assigned_to,
                                        })
                                    })
                                    .collect(),
                            },
                        );
                    }
                    _ => {}
                }

                // Emit all events with session_id so the frontend can route them
                // to the correct session state.
                let mut payload = serde_json::to_value(&event).unwrap_or_default();
                if let Some(obj) = payload.as_object_mut() {
                    obj.insert("session_id".to_string(), serde_json::json!(sid));
                }
                eprintln!(
                    "[send_message] emit event type={} session={}",
                    payload.get("type").and_then(|v| v.as_str()).unwrap_or("?"),
                    sid
                );
                rh.emit("server-event", &payload).ok();

                // Unified workspace-event emit: backend is the single source of
                // truth for what appears in the virtual workspace thread.
                if let Some(ref wd) = workspace_id {
                    let mut wp = payload.clone();
                    if let Some(obj) = wp.as_object_mut() {
                        obj.insert("workspace_id".to_string(), serde_json::json!(wd));
                        obj.insert("source_session_id".to_string(), serde_json::json!(sid));
                    }
                    rh.emit("workspace-event", &wp).ok();
                }
            }
        });

        let result = runtime
            .agent
            .lock()
            .await
            .run_once_streaming_mpsc(&content, images.unwrap_or_default(), system_reminder, tx)
            .await;
        eprintln!(
            "[send_message] agent run finished session={} ok={}",
            session_id_for_spawn,
            result.is_ok()
        );
        reader.await.ok();
        runtime.cancel_signal.reset();
        *runtime.is_processing.lock().await = false;
        *runtime.current_tool_name.lock().await = None;

        if let Err(e) = result {
            eprintln!(
                "[send_message] agent ERROR session={}: {e:#}",
                session_id_for_spawn
            );
            handle
                .emit(
                    "server-event",
                    &serde_json::json!({ "type": "error", "session_id": session_id_for_spawn, "id": 0, "message": format!("{e:#}") }),
                )
                .ok();
        }
        handle
            .emit(
                "server-event",
                &serde_json::json!({ "type": "done", "session_id": session_id_for_spawn, "id": 0 }),
            )
            .ok();
    });
    Ok(())
}
#[tauri::command]
pub async fn cancel(state: State<'_, AppState>, session_id: String) -> Result<(), TauriError> {
    if state
        .server_managed_sessions
        .lock()
        .await
        .contains(&session_id)
    {
        let client = get_server_client(&state)?;
        let req = jcode::protocol::Request::Cancel { id: 1 };
        client.send(req).await?;
        return Ok(());
    }
    let runtime = get_runtime_by_session_id(&state, &session_id).await?;
    runtime.cancel_signal.fire();
    Ok(())
}
#[tauri::command]
pub async fn send_soft_interrupt(
    state: State<'_, AppState>,
    session_id: String,
    content: String,
    urgent: bool,
) -> Result<(), TauriError> {
    if state
        .server_managed_sessions
        .lock()
        .await
        .contains(&session_id)
    {
        let client = get_server_client(&state)?;
        let req = jcode::protocol::Request::SoftInterrupt {
            id: 1,
            content,
            urgent,
        };
        client.send(req).await?;
        return Ok(());
    }
    let runtime = get_runtime_by_session_id(&state, &session_id).await?;
    runtime.agent.lock().await.queue_soft_interrupt(
        content,
        urgent,
        jcode::agent::SoftInterruptSource::User,
    );
    Ok(())
}
#[tauri::command]
pub async fn set_model(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    model: String,
    profile_id: Option<String>,
) -> Result<(), TauriError> {
    if state
        .server_managed_sessions
        .lock()
        .await
        .contains(&session_id)
    {
        let client = get_server_client(&state)?;
        let model_arg = if let Some(pid) = profile_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            format!("{}:{}", pid, model)
        } else {
            model
        };
        let req = jcode::protocol::Request::SetModel {
            id: 1,
            model: model_arg,
        };
        client.send(req).await?;
        return Ok(());
    }
    let runtime = get_runtime_by_session_id(&state, &session_id).await?;
    let mut guard = runtime.agent.lock().await;
    let model_arg = if let Some(pid) = profile_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        format!("{}:{}", pid, model)
    } else {
        model
    };
    guard
        .set_model(&model_arg)
        .map_err(|e| TauriError::Other(format!("Failed to set model: {e}")))?;
    let provider = guard.provider_handle();
    let current = provider.model();
    let provider_name = infer_provider_name_from_model(provider.name(), &current);
    drop(guard);
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({
                "type": "model_changed",
                "id": 0,
                "model": current,
                "provider_name": provider_name,
                "session_id": session_id
            }),
        )
        .ok();
    Ok(())
}
#[tauri::command]
pub async fn set_memory_enabled(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    enabled: bool,
) -> Result<(), TauriError> {
    let runtime = get_runtime_by_session_id(&state, &session_id).await?;
    let mut guard = runtime.agent.lock().await;
    guard.set_memory_enabled(enabled);
    drop(guard);
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({ "type": "memory_feature_changed", "enabled": enabled, "session_id": session_id }),
        )
        .ok();
    Ok(())
}
fn delete_session_artifacts(session_id: &str) -> Result<(), TauriError> {
    let session_path = jcode::session::session_path(session_id).map_err(|e| {
        TauriError::Other(format!(
            "Failed to resolve session path for {session_id}: {e}"
        ))
    })?;
    if session_path.exists() {
        fs::remove_file(&session_path).map_err(|e| {
            TauriError::Other(format!("Failed to remove {}: {e}", session_path.display()))
        })?;
    }

    let journal_path = jcode::session::session_journal_path(session_id).map_err(|e| {
        TauriError::Other(format!(
            "Failed to resolve journal path for {session_id}: {e}"
        ))
    })?;
    if journal_path.exists() {
        fs::remove_file(&journal_path).map_err(|e| {
            TauriError::Other(format!("Failed to remove {}: {e}", journal_path.display()))
        })?;
    }

    Ok(())
}
#[tauri::command]
pub async fn rename_session(
    state: State<'_, AppState>,
    session_id: String,
    title: String,
) -> Result<(), TauriError> {
    if state
        .server_managed_sessions
        .lock()
        .await
        .contains(&session_id)
    {
        let client = get_server_client(&state)?;
        let req = jcode::protocol::Request::RenameSession {
            id: 1,
            title: Some(title.trim().to_string()),
        };
        client.send(req).await?;
        return Ok(());
    }
    let session_path = jcode::session::session_path(&session_id).map_err(|e| {
        TauriError::Other(format!(
            "Failed to resolve session path for {session_id}: {e}"
        ))
    })?;
    if !session_path.exists() {
        return Err(TauriError::Other(format!(
            "Session file not found for {session_id}"
        )));
    }

    let raw = fs::read_to_string(&session_path).map_err(|e| {
        TauriError::Other(format!("failed to read {}: {e}", session_path.display()))
    })?;
    let mut value: Value = serde_json::from_str(&raw).map_err(|e| {
        TauriError::Other(format!("failed to parse {}: {e}", session_path.display()))
    })?;

    value["custom_title"] = serde_json::json!(title.trim());

    fs::write(
        &session_path,
        serde_json::to_string_pretty(&value).unwrap_or_default(),
    )
    .map_err(|e| TauriError::Other(format!("failed to write {}: {e}", session_path.display())))?;

    Ok(())
}
#[tauri::command]
pub async fn delete_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), TauriError> {
    if let Some(runtime) = state.runtimes.lock().await.get(&session_id).cloned() {
        if *runtime.is_processing.lock().await {
            return Err(TauriError::Other(
                "Cannot delete a running session.".to_string(),
            ));
        }
    }

    // If this is the active session, clear it first so deletion succeeds.
    {
        let mut active = state.active_session_id.lock().await;
        if active.as_deref() == Some(session_id.as_str()) {
            *active = None;
        }
    }

    state.runtimes.lock().await.remove(&session_id);
    state.swarm.lock().await.remove_session(&session_id);
    state
        .server_managed_sessions
        .lock()
        .await
        .remove(&session_id);

    delete_session_artifacts(&session_id)
}
#[tauri::command]
pub async fn delete_workspace_sessions(
    state: State<'_, AppState>,
    working_dir: Option<String>,
) -> Result<serde_json::Value, TauriError> {
    let workspace_key = working_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("default")
        .to_string();
    let active_session_id = state.active_session_id.lock().await.clone();
    let live_runtimes = state.runtimes.lock().await.clone();

    let mut blocked_sessions = Vec::new();
    let mut runtime_sessions_to_remove = Vec::new();
    for (session_id, runtime) in &live_runtimes {
        let runtime_working_dir = runtime
            .agent
            .try_lock()
            .ok()
            .and_then(|agent| agent.working_dir().map(str::to_string))
            .unwrap_or_else(|| "default".to_string());
        if runtime_working_dir != workspace_key {
            continue;
        }
        let is_processing = *runtime.is_processing.lock().await;
        let is_active = active_session_id.as_deref() == Some(session_id.as_str());
        if is_processing || is_active {
            blocked_sessions.push(session_id.clone());
        } else {
            runtime_sessions_to_remove.push(session_id.clone());
        }
    }

    if !blocked_sessions.is_empty() {
        return Err(TauriError::Other(format!(
            "Cannot delete workspace while active/running sessions exist: {}",
            blocked_sessions.join(", ")
        )));
    }

    let dir = jcode::storage::jcode_dir()
        .map_err(|e| TauriError::from(e.to_string()))?
        .join("sessions");
    if !dir.exists() {
        return Ok(serde_json::json!({ "deleted_count": 0, "deleted_ids": Vec::<String>::new() }));
    }

    let candidates = fs::read_dir(&dir)
        .map_err(|e| TauriError::Other(format!("failed to read {}: {e}", dir.display())))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| session_file_candidate(entry.path()))
        .collect::<Vec<_>>();

    let mut deleted_ids = Vec::new();
    for candidate in candidates {
        let Ok(Some(summary)) = load_session_sidebar_summary(&candidate.path) else {
            continue;
        };
        let Some(session_id) = summary.get("id").and_then(Value::as_str) else {
            continue;
        };
        let summary_workspace = summary
            .get("working_dir")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("default");
        if summary_workspace != workspace_key {
            continue;
        }
        delete_session_artifacts(session_id)?;
        deleted_ids.push(session_id.to_string());
    }

    {
        let mut runtimes = state.runtimes.lock().await;
        for session_id in &runtime_sessions_to_remove {
            runtimes.remove(session_id);
        }
    }
    {
        let mut swarm = state.swarm.lock().await;
        for session_id in &deleted_ids {
            swarm.remove_session(session_id);
        }
    }

    Ok(serde_json::json!({
        "deleted_count": deleted_ids.len(),
        "deleted_ids": deleted_ids,
    }))
}
#[tauri::command]
pub async fn get_workspace_thread_history(
    working_dir: Option<String>,
) -> Result<Vec<serde_json::Value>, TauriError> {
    let workspace_key = working_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("default")
        .to_string();
    let dir = jcode::storage::jcode_dir()
        .map_err(|e| TauriError::from(e.to_string()))?
        .join("sessions");
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut candidates = fs::read_dir(&dir)
        .map_err(|e| TauriError::Other(format!("failed to read {}: {e}", dir.display())))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| session_file_candidate(entry.path()))
        .collect::<Vec<_>>();
    candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.modified));

    let mut messages = Vec::new();
    for candidate in candidates {
        let Ok(Some(summary)) = load_session_sidebar_summary(&candidate.path) else {
            continue;
        };
        let summary_workspace = summary
            .get("working_dir")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("default");
        if summary_workspace != workspace_key {
            continue;
        }
        let Some(session_id) = summary.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Ok(session) = Session::load(session_id) else {
            continue;
        };
        if !matches!(session.status, jcode::session::SessionStatus::Active) {
            continue;
        }
        let role_name = summary
            .get("role_name")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty());
        messages.extend(workspace_history_messages(&session, session_id, role_name));
    }

    messages.sort_by(|a, b| {
        let a_ts = a
            .get("timestamp")
            .and_then(Value::as_i64)
            .unwrap_or(i64::MIN);
        let b_ts = b
            .get("timestamp")
            .and_then(Value::as_i64)
            .unwrap_or(i64::MIN);
        a_ts.cmp(&b_ts).then_with(|| {
            a.get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .cmp(b.get("id").and_then(Value::as_str).unwrap_or_default())
        })
    });

    Ok(messages)
}
#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, TauriError> {
    let dir = jcode::storage::jcode_dir()
        .map_err(|e| TauriError::from(e.to_string()))?
        .join("sessions");
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut candidates = fs::read_dir(&dir)
        .map_err(|e| TauriError::Other(format!("failed to read {}: {e}", dir.display())))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| session_file_candidate(entry.path()))
        .collect::<Vec<_>>();
    candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.modified));

    let live_runtimes = state.runtimes.lock().await.clone();
    let swarm_state = state.swarm.lock().await;
    let live_swarm_members = &swarm_state.members;
    let live_swarm_plans = &swarm_state.plans;
    let live_swarm_proposals = &swarm_state.proposals;
    let mut live_workspace_counts: HashMap<String, usize> = HashMap::new();
    let mut workspace_coordinators: HashMap<String, String> = HashMap::new();
    let mut workspace_ordinals: HashMap<String, u64> = HashMap::new();
    for runtime in live_runtimes.values() {
        let working_dir = runtime
            .agent
            .try_lock()
            .ok()
            .and_then(|agent| agent.working_dir().map(str::to_string))
            .unwrap_or_else(|| "default".to_string());
        *live_workspace_counts
            .entry(working_dir.clone())
            .or_insert(0) += 1;
        let current_best = workspace_ordinals.get(&working_dir).copied();
        if current_best.is_none() || runtime.ordinal < current_best.unwrap_or(u64::MAX) {
            workspace_ordinals.insert(working_dir.clone(), runtime.ordinal);
            workspace_coordinators.insert(working_dir, runtime.session_id.clone());
        }
    }

    let mut sessions = Vec::new();
    for candidate in candidates {
        match load_session_sidebar_summary(&candidate.path) {
            Ok(Some(mut summary)) => {
                let status = summary
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                if status.eq_ignore_ascii_case("closed") {
                    continue;
                }
                if let Some(session_id) = summary
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                {
                    let working_dir_key = summary
                        .get("working_dir")
                        .and_then(Value::as_str)
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or("default")
                        .to_string();
                    if let Some(member) = live_swarm_members.get(&session_id) {
                        summary["status"] = serde_json::json!(member.status);
                        if let Some(model) = summary.get("model").and_then(Value::as_str) {
                            summary["subtitle"] =
                                serde_json::json!(format!("{} · {}", member.status, model));
                        }
                        if let Some(ref detail) = member.detail {
                            if !detail.is_empty() {
                                let current_detail = summary
                                    .get("detail")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default();
                                summary["detail"] = serde_json::json!(if current_detail
                                    .contains(detail.as_str())
                                {
                                    current_detail.to_string()
                                } else if current_detail.is_empty() {
                                    detail.clone()
                                } else {
                                    format!("{current_detail} · {detail}")
                                });
                            }
                        }
                        if let Some(ref role) = member.role {
                            summary["swarm_role"] = serde_json::json!(role);
                        }
                        if member.peer_count >= 2 {
                            summary["swarm_enabled"] = serde_json::json!(true);
                            summary["swarm_peer_count"] = serde_json::json!(member.peer_count);
                        }
                    }
                    if let Some(plan) = live_swarm_plans.get(&session_id) {
                        summary["swarm_id"] = serde_json::json!(plan.swarm_id);
                        if plan.participants.len() >= 2 {
                            summary["swarm_enabled"] = serde_json::json!(true);
                            summary["swarm_peer_count"] =
                                serde_json::json!(plan.participants.len());
                        }
                        summary["swarm_plan"] = serde_json::json!({
                            "swarm_id": plan.swarm_id,
                            "version": plan.version,
                            "item_count": plan.items.len(),
                            "participant_ids": plan.participants,
                            "participant_count": plan.participants.len(),
                            "reason": plan.reason,
                            "ready_count": plan.ready_count,
                            "active_count": plan.active_count,
                            "blocked_count": plan.blocked_count,
                            "completed_count": plan.completed_count,
                            "next_ready_ids": plan.next_ready_ids,
                            "items_preview": plan.preview_items,
                        });
                    }
                    if let Some(proposal) = live_swarm_proposals.get(&session_id) {
                        summary["swarm_id"] = serde_json::json!(proposal.swarm_id);
                        summary["swarm_proposal"] = serde_json::json!({
                            "swarm_id": proposal.swarm_id,
                            "proposer_session": proposal.proposer_session,
                            "proposer_name": proposal.proposer_name,
                            "summary": proposal.summary,
                            "proposal_key": proposal.proposal_key,
                            "item_count": proposal.items.len(),
                            "items_preview": proposal.items,
                        });
                    }
                    let swarm_peer_count =
                        *live_workspace_counts.get(&working_dir_key).unwrap_or(&0);
                    if swarm_peer_count >= 2 {
                        summary["swarm_enabled"] = serde_json::json!(true);
                        summary["swarm_peer_count"] = serde_json::json!(swarm_peer_count);
                        summary["swarm_role"] = serde_json::json!(if workspace_coordinators
                            .get(&working_dir_key)
                            == Some(&session_id)
                        {
                            "coordinator"
                        } else {
                            "agent"
                        });
                        if summary.get("role_name").and_then(Value::as_str).is_none() {
                            if let Some(role_name) = summary
                                .get("custom_title")
                                .and_then(Value::as_str)
                                .filter(|value| !value.trim().is_empty())
                            {
                                summary["role_name"] = serde_json::json!(role_name);
                            }
                        }
                    }
                    if let Some(runtime) = live_runtimes.get(&session_id) {
                        let is_processing = *runtime.is_processing.lock().await;
                        let current_tool_name = runtime.current_tool_name.lock().await.clone();
                        let status_detail = runtime.status_detail.lock().await.clone();
                        let connection_phase = runtime.connection_phase.lock().await.clone();
                        let live_phase = live_phase_label(
                            is_processing,
                            current_tool_name.as_deref(),
                            connection_phase.as_deref(),
                            status_detail.as_deref(),
                        );
                        summary["live_processing"] = serde_json::json!(is_processing);
                        summary["live_phase"] = serde_json::json!(live_phase);
                        if let Some(tool_name) = current_tool_name.clone() {
                            summary["live_tool_name"] = serde_json::json!(tool_name);
                        }
                        if let Some(detail) = status_detail
                            .clone()
                            .filter(|value| !value.trim().is_empty())
                        {
                            summary["live_status_detail"] = serde_json::json!(detail.clone());
                        }
                        if is_processing {
                            summary["status"] = serde_json::json!(match live_phase {
                                "chunking" => "chunking",
                                _ => "running",
                            });
                            summary["subtitle"] = serde_json::json!(match live_phase {
                                "chunking" => "running · chunking".to_string(),
                                "tool" => match current_tool_name.as_deref() {
                                    Some(tool) => format!("running · {tool}"),
                                    None => "running · tool".to_string(),
                                },
                                "thinking" => "running · thinking".to_string(),
                                _ => "running".to_string(),
                            });
                        } else {
                            // Not processing — override stale "active" status from session file
                            summary["status"] = serde_json::json!("ready");
                            if swarm_peer_count >= 2 {
                                summary["subtitle"] = serde_json::json!(match live_phase {
                                    "waiting" => "swarm · waiting".to_string(),
                                    _ => summary
                                        .get("subtitle")
                                        .and_then(Value::as_str)
                                        .unwrap_or("ready")
                                        .to_string(),
                                });
                            }
                        }
                        if let Some(detail) = status_detail.filter(|value| !value.trim().is_empty())
                        {
                            let current_detail = summary
                                .get("detail")
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            summary["detail"] = serde_json::json!(if current_detail.is_empty() {
                                detail
                            } else {
                                format!("{current_detail} · {detail}")
                            });
                        }
                    }
                }
                sessions.push(summary)
            }
            Ok(None) => {}
            Err(error) => eprintln!(
                "desktop-app: skipped session {}: {error}",
                candidate.path.display()
            ),
        }
    }

    // If connected to a jcode server, merge server-side sessions and mark
    // server-managed sessions so the UI can distinguish them.
    if let Ok(client) = get_server_client(&state) {
        let req = jcode::protocol::Request::GetHistory { id: 1 };
        if let Ok(jcode::protocol::ServerEvent::History {
            all_sessions,
            server_name,
            server_icon,
            ..
        }) = client.request(req).await
        {
            let existing_ids: std::collections::HashSet<String> = sessions
                .iter()
                .filter_map(|s| s.get("id").and_then(Value::as_str).map(String::from))
                .collect();

            for session_id in &all_sessions {
                if existing_ids.contains(session_id) {
                    // Mark existing session as server-managed
                    if let Some(summary) = sessions
                        .iter_mut()
                        .find(|s| s.get("id").and_then(Value::as_str) == Some(session_id.as_str()))
                    {
                        summary["server_managed"] = serde_json::json!(true);
                        if let Some(ref name) = server_name {
                            summary["server_name"] = serde_json::json!(name);
                        }
                        if let Some(ref icon) = server_icon {
                            summary["server_icon"] = serde_json::json!(icon);
                        }
                    }
                } else {
                    // Server-only session: load from disk if available
                    let path = dir.join(format!("{session_id}.json"));
                    if let Ok(Some(mut summary)) = load_session_sidebar_summary(&path) {
                        summary["server_managed"] = serde_json::json!(true);
                        if let Some(ref name) = server_name {
                            summary["server_name"] = serde_json::json!(name);
                        }
                        if let Some(ref icon) = server_icon {
                            summary["server_icon"] = serde_json::json!(icon);
                        }
                        sessions.push(summary);
                    }
                }
            }
        }
    }

    Ok(sessions)
}
#[tauri::command]
pub async fn send_stdin_response(
    state: State<'_, AppState>,
    request_id: String,
    input: String,
) -> Result<(), TauriError> {
    let active = state.active_session_id.lock().await.clone();
    if let Some(ref session_id) = active {
        if state
            .server_managed_sessions
            .lock()
            .await
            .contains(session_id)
        {
            let client = get_server_client(&state)?;
            let req = jcode::protocol::Request::StdinResponse {
                id: 1,
                request_id,
                input,
            };
            client.send(req).await?;
            return Ok(());
        }
    }
    let mut guard = state.pending_stdin.lock().await;
    if let Some(tx) = guard.remove(&request_id) {
        let _ = tx.send(input);
        Ok(())
    } else {
        Err(TauriError::Other(format!(
            "No pending stdin request with id {}",
            request_id
        )))
    }
}
#[tauri::command]
pub async fn clear_chat(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), TauriError> {
    if state
        .server_managed_sessions
        .lock()
        .await
        .contains(&session_id)
    {
        let client = get_server_client(&state)?;
        let req = jcode::protocol::Request::Clear { id: 1 };
        client.send(req).await?;
        return Ok(());
    }

    // In swarm/workspace mode, clear every session that shares the same
    // working directory so the whole thread is wiped.
    let target_session = jcode::session::Session::load(&session_id)
        .map_err(|e| TauriError::Other(format!("Failed to load session: {e}")))?;
    let workspace = target_session.working_dir;

    let runtimes = state.runtimes.lock().await;
    let peers: Vec<(String, Arc<SessionRuntime>)> = if let Some(ref wd) = workspace {
        runtimes
            .iter()
            .filter(|(id, _)| {
                jcode::session::Session::load(id)
                    .map(|s| s.working_dir.as_ref() == Some(wd))
                    .unwrap_or(false)
            })
            .map(|(id, r)| (id.clone(), r.clone()))
            .collect()
    } else {
        vec![(
            session_id.clone(),
            runtimes
                .get(&session_id)
                .cloned()
                .ok_or_else(|| format!("session {} not found", session_id))?,
        )]
    };
    drop(runtimes);

    for (sid, rt) in peers {
        let mut guard: tokio::sync::MutexGuard<'_, jcode::agent::Agent> = rt.agent.lock().await;
        guard.clear();
        drop(guard);
        app_handle
            .emit(
                "server-event",
                &serde_json::json!({ "type": "clear_chat", "session_id": sid }),
            )
            .ok();
    }
    Ok(())
}
#[tauri::command]
pub async fn rewind_chat(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    message_index: usize,
) -> Result<(), TauriError> {
    if state
        .server_managed_sessions
        .lock()
        .await
        .contains(&session_id)
    {
        let client = get_server_client(&state)?;
        let req = jcode::protocol::Request::Rewind {
            id: 1,
            message_index,
        };
        client.send(req).await?;
        return Ok(());
    }
    let runtime = get_runtime_by_session_id(&state, &session_id).await?;
    let mut guard = runtime.agent.lock().await;
    guard
        .rewind_to_message(message_index)
        .map_err(|e| TauriError::Other(format!("Failed to rewind: {e}")))?;
    drop(guard);
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({ "type": "rewind_chat", "message_index": message_index, "session_id": session_id }),
        )
        .ok();
    Ok(())
}
#[tauri::command]
pub async fn set_reasoning_effort(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    effort: String,
) -> Result<(), TauriError> {
    if state
        .server_managed_sessions
        .lock()
        .await
        .contains(&session_id)
    {
        let client = get_server_client(&state)?;
        let req = jcode::protocol::Request::SetReasoningEffort {
            id: 1,
            effort,
            target_session_id: None,
        };
        client.send(req).await?;
        return Ok(());
    }
    let runtime = get_runtime_by_session_id(&state, &session_id).await?;
    let mut guard = runtime.agent.lock().await;
    let current = guard
        .set_reasoning_effort(&effort)
        .map_err(|e| TauriError::Other(format!("Failed to set reasoning effort: {e}")))?;
    drop(guard);
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({
                "type": "reasoning_effort_changed",
                "id": 0,
                "effort": current,
                "session_id": session_id,
            }),
        )
        .ok();
    Ok(())
}
#[tauri::command]
pub async fn compact_context(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), TauriError> {
    if state
        .server_managed_sessions
        .lock()
        .await
        .contains(&session_id)
    {
        let client = get_server_client(&state)?;
        let req = jcode::protocol::Request::Compact { id: 1 };
        client.send(req).await?;
        return Ok(());
    }
    let runtime = get_runtime_by_session_id(&state, &session_id).await?;
    let mut guard = runtime.agent.lock().await;
    let provider = guard.provider_fork();
    let compaction = guard.registry().compaction();
    let messages = guard.provider_messages();
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
                    "session_id": session_id,
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
                if stats.is_compacting {
                    "in progress..."
                } else {
                    "no"
                }
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
                    "session_id": &session_id,
                }),
                Err(reason) => serde_json::json!({
                    "type": "compact_result",
                    "id": 0,
                    "message": format!("{}\n\n⚠ **Cannot compact:** {}", status_msg, reason),
                    "success": false,
                    "session_id": &session_id,
                }),
            }
        }
        Err(_) => serde_json::json!({
            "type": "compact_result",
            "id": 0,
            "message": "⚠ Cannot access compaction manager (lock held)",
            "success": false,
            "session_id": &session_id,
        }),
    };

    app_handle.emit("server-event", &result).ok();
    Ok(())
}
