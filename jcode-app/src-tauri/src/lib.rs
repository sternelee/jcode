pub mod commands;

use commands::{create_agent_with_session, create_provider, AppState};
use jcode::cli::login::scriptable::{complete_scriptable_login_data, start_scriptable_login_data};
use jcode::cli::login::LoginOptions;

use jcode::protocol::ServerEvent;
use jcode::provider::Provider;
use jcode::provider_catalog::resolve_login_provider;
use jcode::session::Session;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};


mod utils;
use utils::*;

#[tauri::command]
async fn begin_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    working_dir: Option<String>,
    model: Option<String>,
    memory_enabled: Option<bool>,
    role_name: Option<String>,
    profile_id: Option<String>,
) -> Result<String, String> {
    let provider = state.get_provider().await?.fork();
    if let Some(ref model_name) = model {
        let model_arg = if let Some(pid) = profile_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            format!("{}:{}", pid, model_name)
        } else {
            model_name.clone()
        };
        jcode::provider::set_model_with_auth_refresh(provider.as_ref(), &model_arg)
            .map_err(|e| format!("Failed to set model: {e}"))?;
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
struct SwarmMemberRequest {
    role_name: String,
    model: Option<String>,
    profile_id: Option<String>,
}

/// Transactionally create a swarm: coordinator + members.
/// If any member fails, all created sessions are rolled back.
#[tauri::command]
async fn begin_swarm(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    working_dir: Option<String>,
    coordinator_model: Option<String>,
    coordinator_profile_id: Option<String>,
    memory_enabled: Option<bool>,
    members: Vec<SwarmMemberRequest>,
) -> Result<Vec<String>, String> {

    let provider = state.get_provider().await?;

    // -- Coordinator --
    let coordinator_provider = provider.fork();
    if let Some(ref model_name) = coordinator_model {
        let model_arg = if let Some(pid) = coordinator_profile_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            format!("{}:{}", pid, model_name)
        } else {
            model_name.clone()
        };
        jcode::provider::set_model_with_auth_refresh(coordinator_provider.as_ref(), &model_arg)
            .map_err(|e| format!("Failed to set coordinator model: {e}"))?;
    }

    let mut coordinator_session = Session::create(None, None);
    coordinator_session.working_dir = working_dir.clone();
    coordinator_session.model = Some(provider.model());
    coordinator_session.provider_key = jcode::session::derive_session_provider_key(provider.name());

    let mut coordinator_agent = create_agent_with_session(coordinator_provider, coordinator_session, working_dir.as_deref()).await?;
    let resolved_memory_enabled = memory_enabled.unwrap_or_else(|| {
        jcode::config::Config::resolve_workspace_memory_enabled(working_dir.as_deref())
    });
    coordinator_agent.set_memory_enabled(resolved_memory_enabled);

    let coordinator_runtime = register_runtime_and_emit(&app_handle, &state, coordinator_agent).await?;
    let coordinator_id = coordinator_runtime.session_id.clone();
    let mut created_ids = vec![coordinator_id];
    // -- Members (concurrent for performance) --
    let runtimes = state.runtimes.clone();
    let swarm = state.swarm.clone();
    let mut member_futures = Vec::with_capacity(members.len());
    for member in members {
        let app_handle = app_handle.clone();
        let working_dir = working_dir.clone();
        let resolved_memory_enabled = resolved_memory_enabled;
        let role_name = member.role_name.clone();
        let model = member.model.clone();
        let profile_id = member.profile_id.clone();
        let runtimes = runtimes.clone();
        let swarm = swarm.clone();
        member_futures.push(async move {
            let provider = create_provider().await?;
            if let Some(ref model_name) = model {
                let model_arg = if let Some(pid) = profile_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                    format!("{}:{}", pid, model_name)
                } else {
                    model_name.clone()
                };
                jcode::provider::set_model_with_auth_refresh(provider.as_ref(), &model_arg)
                    .map_err(|e| format!("Swarm creation failed for member '{}': {}.", role_name, e))?;
            }

            let mut session = Session::create(None, None);
            session.working_dir = working_dir.clone();
            session.model = Some(provider.model());
            session.provider_key = jcode::session::derive_session_provider_key(provider.name());
            session.rename_title(Some(role_name.clone()));

            let mut agent = create_agent_with_session(provider, session, working_dir.as_deref()).await
                .map_err(|e| format!("Swarm creation failed for member '{}': {}.", role_name, e))?;
            agent.set_memory_enabled(resolved_memory_enabled);

            // Build a temporary AppState view for register_runtime_and_emit
            let task_state = AppState {
                runtimes,
                active_session_id: Arc::new(tokio::sync::Mutex::new(None)),
                pending_stdin: Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
                swarm,
                provider: tokio::sync::RwLock::new(None),
            };
            let runtime = register_runtime_and_emit(&app_handle, &task_state, agent).await
                .map_err(|e| format!("Swarm creation failed for member '{}': {}.", role_name, e))?;
            Ok::<String, String>(runtime.session_id.clone())
        });
    }

    let member_results: Vec<Result<String, String>> = futures::future::join_all(member_futures).await;
    let mut member_ids = Vec::with_capacity(member_results.len());
    for result in member_results {
        match result {
            Ok(id) => member_ids.push(id),
            Err(e) => {
                // Rollback coordinator + all successfully created members
                for id in &created_ids {
                    let _ = delete_session_artifacts(id);
                    let _ = state.runtimes.lock().await.remove(id);
                    state.swarm.lock().await.remove_session(id);
                }
                for id in &member_ids {
                    let _ = delete_session_artifacts(id);
                    let _ = state.runtimes.lock().await.remove(id);
                    state.swarm.lock().await.remove_session(id);
                }
                return Err(format!("{} All sessions rolled back.", e));
            }
        }
    }
    created_ids.extend(member_ids);

    Ok(created_ids)
}


#[tauri::command]
async fn resume_session(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    working_dir: Option<String>,
) -> Result<(), String> {
    if let Some(runtime) = state.runtimes.lock().await.get(&session_id).cloned() {
        {
            let mut active = state.active_session_id.lock().await;
            *active = Some(session_id);
        }
        app_handle
            .emit(
                "server-event",
                &serde_json::json!({ "type": "connection_phase", "phase": "connected" }),
            )
            .ok();
        emit_runtime_snapshot(&app_handle, &runtime).await?;
        return Ok(());
    }

    let session = Session::load(&session_id)
        .map_err(|e| format!("Failed to load session {}: {e}", &session_id))?;
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
    register_runtime_and_emit(&app_handle, &state, agent).await.map(|_| ())
}

#[tauri::command]
async fn send_message(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    content: String,
    images: Option<Vec<(String, String)>>,
    system_reminder: Option<String>,
) -> Result<(), String> {
    eprintln!("[send_message] → session={} content={:?}",
        session_id,
        content.chars().take(60).collect::<String>());

    // 若 runtime 不在内存（Swarm 模式下历史会话尚未加载），则静默从磁盘加载
    let runtime = match get_or_load_session_runtime(&app_handle, &state, &session_id).await {
        Ok(rt) => {
            eprintln!("[send_message] runtime ready (session={})", session_id);
            rt
        }
        Err(e) => {
            eprintln!("[send_message] ERROR: runtime not found: {e}");
            return Err(e);
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
                        let (ready_count, active_count, blocked_count, completed_count, next_ready_ids, preview_items) =
                            summarize_swarm_plan_items(
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
                                items: items.iter().map(|item| serde_json::json!({
                                    "id": item.id,
                                    "content": item.content,
                                    "status": item.status,
                                    "priority": item.priority,
                                    "subsystem": item.subsystem,
                                    "file_scope": item.file_scope,
                                    "blocked_by": item.blocked_by,
                                    "assigned_to": item.assigned_to,
                                })).collect(),
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
                                items: items.iter().map(|item| serde_json::json!({
                                    "id": item.id,
                                    "content": item.content,
                                    "status": item.status,
                                    "priority": item.priority,
                                    "subsystem": item.subsystem,
                                    "file_scope": item.file_scope,
                                    "blocked_by": item.blocked_by,
                                    "assigned_to": item.assigned_to,
                                })).collect(),
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
                eprintln!("[send_message] emit event type={} session={}",
                    payload.get("type").and_then(|v| v.as_str()).unwrap_or("?"),
                    sid);
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
        eprintln!("[send_message] agent run finished session={} ok={}",
            session_id_for_spawn, result.is_ok());
        reader.await.ok();
        runtime.cancel_signal.reset();
        *runtime.is_processing.lock().await = false;
        *runtime.current_tool_name.lock().await = None;

        if let Err(e) = result {
            eprintln!("[send_message] agent ERROR session={}: {e:#}", session_id_for_spawn);
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
async fn cancel(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let runtime = get_runtime_by_session_id(&state, &session_id).await?;
    runtime.cancel_signal.fire();
    Ok(())
}

#[tauri::command]
async fn send_soft_interrupt(
    state: State<'_, AppState>,
    session_id: String,
    content: String,
    urgent: bool,
) -> Result<(), String> {
    let runtime = get_runtime_by_session_id(&state, &session_id).await?;
    runtime
        .agent
        .lock()
        .await
        .queue_soft_interrupt(content, urgent, jcode::agent::SoftInterruptSource::User);
    Ok(())
}


#[tauri::command]
async fn set_model(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    model: String,
    profile_id: Option<String>,
) -> Result<(), String> {
    let runtime = get_runtime_by_session_id(&state, &session_id).await?;
    let mut guard = runtime.agent.lock().await;
    let model_arg = if let Some(pid) = profile_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        format!("{}:{}", pid, model)
    } else {
        model
    };
    guard
        .set_model(&model_arg)
        .map_err(|e| format!("Failed to set model: {e}"))?;
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
async fn set_memory_enabled(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    enabled: bool,
) -> Result<(), String> {
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

#[tauri::command]
async fn get_workspace_memory_preferences() -> Result<serde_json::Value, String> {
    let cfg = jcode::config::Config::load();
    Ok(serde_json::json!({
        "default_enabled": cfg.workspace_memory.default_enabled.unwrap_or(cfg.features.memory),
        "workspaces": cfg.workspace_memory.workspaces,
    }))
}

#[tauri::command]
async fn set_workspace_memory_preference(
    working_dir: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    jcode::config::Config::set_workspace_memory_enabled(working_dir.as_deref(), enabled)
        .map_err(|e| format!("Failed to save workspace memory preference: {e}"))
}

#[tauri::command]
fn get_memory_list(
    scope: String,
    tag: Option<String>,
) -> Result<serde_json::Value, String> {
    use jcode::memory::MemoryManager;
    let manager = MemoryManager::new();
    let mut all_memories: Vec<serde_json::Value> = Vec::new();

    if scope == "all" || scope == "project" {
        if let Ok(graph) = manager.load_project_graph() {
            for entry in graph.all_memories() {
                all_memories.push(memory_entry_to_json(entry));
            }
        }
    }
    if scope == "all" || scope == "global" {
        if let Ok(graph) = manager.load_global_graph() {
            for entry in graph.all_memories() {
                all_memories.push(memory_entry_to_json(entry));
            }
        }
    }

    if let Some(tag_filter) = tag {
        all_memories.retain(|m| {
            m.get("tags")
                .and_then(|t| t.as_array())
                .map(|arr| arr.iter().any(|t| t.as_str() == Some(&tag_filter)))
                .unwrap_or(false)
        });
    }

    // Sort by updated_at descending
    all_memories.sort_by(|a, b| {
        let a_ts = a.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
        let b_ts = b.get("updated_at").and_then(|v| v.as_str()).unwrap_or("");
        b_ts.cmp(a_ts)
    });

    Ok(serde_json::json!({ "memories": all_memories }))
}

fn memory_entry_to_json(entry: &jcode::memory_types::MemoryEntry) -> serde_json::Value {
    serde_json::json!({
        "id": entry.id,
        "category": entry.category.to_string(),
        "content": entry.content,
        "tags": entry.tags,
        "created_at": entry.created_at.to_rfc3339(),
        "updated_at": entry.updated_at.to_rfc3339(),
        "access_count": entry.access_count,
        "source": entry.source,
        "trust": format!("{:?}", entry.trust).to_lowercase(),
        "strength": entry.strength,
        "active": entry.active,
        "superseded_by": entry.superseded_by,
        "confidence": entry.confidence,
        "effective_confidence": entry.effective_confidence(),
    })
}

#[tauri::command]
fn search_memories(query: String, semantic: bool) -> Result<serde_json::Value, String> {
    use jcode::memory::MemoryManager;
    let manager = MemoryManager::new();
    let mut results: Vec<serde_json::Value> = Vec::new();

    if semantic {
        match manager.find_similar(&query, 0.3, 20) {
            Ok(found) => {
                for (entry, score) in found {
                    let mut json = memory_entry_to_json(&entry);
                    if let Some(obj) = json.as_object_mut() {
                        obj.insert("score".to_string(), serde_json::json!(score));
                    }
                    results.push(json);
                }
            }
            Err(e) => return Err(format!("Semantic search failed: {e}")),
        }
    } else {
        match manager.search(&query) {
            Ok(found) => {
                for entry in found {
                    results.push(memory_entry_to_json(&entry));
                }
            }
            Err(e) => return Err(format!("Keyword search failed: {e}")),
        }
    }

    Ok(serde_json::json!({ "results": results }))
}

#[tauri::command]
fn get_memory_stats() -> Result<serde_json::Value, String> {
    use jcode::memory::MemoryManager;
    let manager = MemoryManager::new();
    let mut project_count = 0usize;
    let mut global_count = 0usize;
    let mut total_tags = std::collections::HashSet::<String>::new();
    let mut categories: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    if let Ok(graph) = manager.load_project_graph() {
        project_count = graph.memory_count();
        for entry in graph.all_memories() {
            for tag in &entry.tags {
                total_tags.insert(tag.clone());
            }
            *categories.entry(entry.category.to_string()).or_default() += 1;
        }
    }

    if let Ok(graph) = manager.load_global_graph() {
        global_count = graph.memory_count();
        for entry in graph.all_memories() {
            for tag in &entry.tags {
                total_tags.insert(tag.clone());
            }
            *categories.entry(entry.category.to_string()).or_default() += 1;
        }
    }

    Ok(serde_json::json!({
        "project_count": project_count,
        "global_count": global_count,
        "total": project_count + global_count,
        "unique_tags": total_tags.len(),
        "categories": categories,
    }))
}

#[tauri::command]
fn get_memory_graph() -> Result<serde_json::Value, String> {
    use jcode::memory::MemoryManager;
    use jcode::tui::info_widget::build_graph_topology;

    let manager = MemoryManager::new();

    let project_graph = manager.load_project_graph().ok();
    let global_graph = manager.load_global_graph().ok();

    let (nodes, edges) = build_graph_topology(project_graph.as_ref(), global_graph.as_ref());

    // GraphNode and GraphEdge already derive Serialize (see jcode-tui-core).
    let node_values: Vec<serde_json::Value> = nodes
        .into_iter()
        .map(|n| {
            serde_json::json!({
                "id": n.id,
                "label": n.label,
                "kind": n.kind,
                "is_memory": n.is_memory,
                "is_active": n.is_active,
                "confidence": n.confidence,
                "degree": n.degree,
            })
        })
        .collect();

    let edge_values: Vec<serde_json::Value> = edges
        .into_iter()
        .map(|e| {
            serde_json::json!({
                "source": e.source,
                "target": e.target,
                "kind": e.kind,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "nodes": node_values,
        "edges": edge_values,
    }))
}

#[tauri::command]
fn export_memories(path: String) -> Result<(), String> {
    use jcode::memory::MemoryManager;
    let manager = MemoryManager::new();

    let project_graph = manager
        .load_project_graph()
        .map_err(|e| format!("Failed to load project memories: {e}"))?;
    let global_graph = manager
        .load_global_graph()
        .map_err(|e| format!("Failed to load global memories: {e}"))?;

    let export = serde_json::json!({
        "version": 1,
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "project_memories": project_graph.all_memories().collect::<Vec<_>>(),
        "global_memories": global_graph.all_memories().collect::<Vec<_>>(),
    });

    std::fs::write(
        &path,
        serde_json::to_string_pretty(&export).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to write export file: {e}"))?;

    Ok(())
}

#[tauri::command]
fn import_memories(path: String) -> Result<serde_json::Value, String> {
    use jcode::memory::MemoryManager;
    let manager = MemoryManager::new();

    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read import file: {e}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse import file: {e}"))?;

    let mut project_count = 0usize;
    let mut global_count = 0usize;

    if let Some(entries) = value.get("project_memories").and_then(|v| v.as_array()) {
        let mut graph = manager
            .load_project_graph()
            .map_err(|e| format!("Failed to load project graph: {e}"))?;
        for entry_value in entries {
            if let Ok(entry) =
                serde_json::from_value::<jcode::memory_types::MemoryEntry>(entry_value.clone())
            {
                manager.upsert_memory_in_graph(&mut graph, entry);
                project_count += 1;
            }
        }
        manager
            .save_project_graph(&graph)
            .map_err(|e| format!("Failed to save project graph: {e}"))?;
    }

    if let Some(entries) = value.get("global_memories").and_then(|v| v.as_array()) {
        let mut graph = manager
            .load_global_graph()
            .map_err(|e| format!("Failed to load global graph: {e}"))?;
        for entry_value in entries {
            if let Ok(entry) =
                serde_json::from_value::<jcode::memory_types::MemoryEntry>(entry_value.clone())
            {
                manager.upsert_memory_in_graph(&mut graph, entry);
                global_count += 1;
            }
        }
        manager
            .save_global_graph(&graph)
            .map_err(|e| format!("Failed to save global graph: {e}"))?;
    }

    Ok(serde_json::json!({
        "project_count": project_count,
        "global_count": global_count,
    }))
}

#[tauri::command]
async fn list_background_tasks() -> Result<Vec<serde_json::Value>, String> {
    use jcode::background::global;
    let tasks = global().list().await;
    tasks
        .into_iter()
        .map(|task| serde_json::to_value(task).map_err(|e| e.to_string()))
        .collect()
}

#[tauri::command]
async fn cancel_background_task(task_id: String) -> Result<bool, String> {
    jcode::background::global()
        .cancel(&task_id)
        .await
        .map_err(|e| format!("Failed to cancel task: {e}"))
}

#[tauri::command]
fn generate_pairing_code() -> Result<String, String> {
    let mut registry = jcode::gateway::DeviceRegistry::load();
    let code = registry.generate_pairing_code();
    Ok(code)
}

#[tauri::command]
fn list_paired_devices() -> Result<serde_json::Value, String> {
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
fn revoke_device(device_id: String) -> Result<(), String> {
    let mut registry = jcode::gateway::DeviceRegistry::load();
    registry.devices.retain(|d| d.id != device_id);
    registry
        .save()
        .map_err(|e| format!("Failed to save device registry: {e}"))
}

#[tauri::command]
async fn run_auth_test(state: State<'_, AppState>, provider_id: Option<String>) -> Result<serde_json::Value, String> {
    let provider = state.get_provider().await?;
    
    // If a specific provider_id is given, try to set a model from that provider
    // to ensure we're testing the right provider.
    if let Some(pid) = provider_id.as_deref().filter(|s| !s.is_empty()) {
        let _ = jcode::provider::set_model_with_auth_refresh(provider.as_ref(), pid);
    }

    let prefetch_result = provider.prefetch_models().await;
    let routes = provider.model_routes();
    let available_count = routes.iter().filter(|r| r.available).count();
    let total_count = routes.len();
    let current_model = provider.model();
    let provider_name = provider.name().to_string();

    match prefetch_result {
        Ok(()) => Ok(serde_json::json!({
            "success": true,
            "provider": provider_name,
            "model": current_model,
            "total_routes": total_count,
            "available_routes": available_count,
            "detail": format!("Provider '{}' prefetch succeeded. {}/{} routes available.", provider_name, available_count, total_count),
        })),
        Err(e) => Ok(serde_json::json!({
            "success": false,
            "provider": provider_name,
            "model": current_model,
            "total_routes": total_count,
            "available_routes": available_count,
            "error": format!("{e:#}"),
            "detail": format!("Provider '{}' prefetch failed: {e:#}", provider_name),
        })),
    }
}

#[tauri::command]
fn get_ambient_status() -> Result<serde_json::Value, String> {
    use jcode::ambient::{AmbientManager, AmbientStatus};
    let manager = AmbientManager::new().map_err(|e| format!("Failed to load ambient manager: {e}"))?;
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
fn get_ambient_transcripts() -> Result<serde_json::Value, String> {
    use jcode::ambient::VisibleCycleContext;
    let mut transcripts: Vec<serde_json::Value> = Vec::new();

    let dir = jcode::storage::jcode_dir()
        .map_err(|e| e.to_string())?
        .join("ambient")
        .join("transcripts");
    if dir.exists() {
        let mut entries: Vec<_> = std::fs::read_dir(&dir)
            .map_err(|e| e.to_string())?
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry.path().extension().and_then(|ext| ext.to_str()) == Some("json")
            })
            .collect();
        entries.sort_by_key(|a| std::cmp::Reverse(a.metadata().and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH)));

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
fn get_version_info() -> Result<serde_json::Value, String> {
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
fn run_auth_doctor() -> Result<serde_json::Value, String> {
    let status = jcode::auth::AuthStatus::check();
    let validation = jcode::auth::validation::load_all();
    let providers = jcode::provider_catalog::auth_status_login_providers();

    let mut provider_reports = Vec::new();
    let mut needs_attention_count = 0usize;

    for provider in providers {
        let assessment = status.assessment_for_provider(provider);
        let validation_result = validation.get(provider.id).map(|r| r.summary.as_str());
        let needs_attn = jcode::auth::doctor::needs_attention(&assessment, validation_result);
        if needs_attn {
            needs_attention_count += 1;
        }
        let diagnostics = jcode::auth::doctor::diagnostics(provider, &assessment, validation_result);
        let actions = jcode::auth::doctor::recommended_actions(provider, &assessment, validation_result);

        provider_reports.push(serde_json::json!({
            "id": provider.id,
            "display_name": provider.display_name,
            "status": match assessment.state {
                jcode::auth::AuthState::Available => "available",
                jcode::auth::AuthState::Expired => "expired",
                jcode::auth::AuthState::NotConfigured => "not_configured",
            },
            "configured": matches!(assessment.state, jcode::auth::AuthState::Available),
            "needs_attention": needs_attn,
            "method_detail": assessment.method_detail,
            "credential_source": assessment.credential_source.label(),
            "credential_source_detail": assessment.credential_source_detail,
            "expiry_confidence": assessment.expiry_confidence.label(),
            "refresh_support": assessment.refresh_support.label(),
            "validation_method": assessment.validation_method.label(),
            "last_validation": assessment.last_validation.as_ref().map(|r| serde_json::json!({
                "checked_at_ms": r.checked_at_ms,
                "success": r.success,
                "summary": r.summary,
                "provider_smoke_ok": r.provider_smoke_ok,
                "tool_smoke_ok": r.tool_smoke_ok,
            })),
            "last_refresh": assessment.last_refresh.as_ref().map(|r| serde_json::json!({
                "last_attempt_ms": r.last_attempt_ms,
                "last_success_ms": r.last_success_ms,
                "last_error": r.last_error,
            })),
            "diagnostics": diagnostics,
            "recommended_actions": actions,
        }));
    }

    Ok(serde_json::json!({
        "needs_attention_count": needs_attention_count,
        "provider_count": provider_reports.len(),
        "providers": provider_reports,
    }))
}

#[tauri::command]
fn get_auth_status() -> Result<serde_json::Value, String> {
    let status = jcode::auth::AuthStatus::check();
    let validation = jcode::auth::validation::load_all();
    let providers = jcode::provider_catalog::auth_status_login_providers();
    let reports: Vec<serde_json::Value> = providers
        .into_iter()
        .map(|provider| {
            let assessment = status.assessment_for_provider(provider);
            let state_label = match assessment.state {
                jcode::auth::AuthState::Available => "available",
                jcode::auth::AuthState::Expired => "expired",
                jcode::auth::AuthState::NotConfigured => "not_configured",
            };
            serde_json::json!({
                "id": provider.id.to_string(),
                "display_name": provider.display_name.to_string(),
                "status": state_label,
                "health": assessment.health_summary(),
                "method": assessment.method_detail,
                "configured": matches!(assessment.state, jcode::auth::AuthState::Available),
                "auth_kind": provider.auth_kind.label(),
                "recommended": provider.recommended,
                "validation": validation.get(provider.id).map(|record| record.summary.clone()),
            })
        })
        .collect();
    Ok(serde_json::json!({
        "any_available": status.has_any_available(),
        "providers": reports,
    }))
}

#[tauri::command]
async fn get_usage_info() -> Result<serde_json::Value, String> {
    let providers = jcode::usage::fetch_all_provider_usage().await;
    let reports: Vec<serde_json::Value> = providers
        .into_iter()
        .map(|provider| {
            serde_json::json!({
                "provider_name": provider.provider_name,
                "limits": provider.limits.into_iter().map(|limit| serde_json::json!({
                    "name": limit.name,
                    "usage_percent": limit.usage_percent,
                    "resets_at": limit.resets_at,
                })).collect::<Vec<_>>(),
                "extra_info": provider.extra_info.into_iter().map(|(k, v)| serde_json::json!([k, v])).collect::<Vec<_>>(),
                "hard_limit_reached": provider.hard_limit_reached,
                "error": provider.error,
            })
        })
        .collect();
    Ok(serde_json::json!({ "providers": reports }))
}

#[tauri::command]
async fn get_external_auth_candidates() -> Result<serde_json::Value, String> {
    let candidates = jcode::external_auth::pending_external_auth_review_candidates()
        .map_err(|e| format!("Failed to check external auth sources: {e}"))?;
    let items: Vec<serde_json::Value> = candidates
        .iter()
        .enumerate()
        .map(|(index, candidate): (usize, &_)| {
            serde_json::json!({
                "index": index,
                "provider_summary": candidate.provider_summary(),
                "source_name": candidate.source_name(),
                "path": candidate.path().display().to_string(),
            })
        })
        .collect();
    Ok(serde_json::json!({ "candidates": items, "total": items.len() }))
}

#[tauri::command]
async fn approve_external_auth_candidate(index: usize) -> Result<serde_json::Value, String> {
    let candidates = jcode::external_auth::pending_external_auth_review_candidates()
        .map_err(|e| format!("Failed to check external auth sources: {e}"))?;
    if index >= candidates.len() {
        return Err(format!(
            "Invalid candidate index {index} (only {} available)",
            candidates.len()
        ));
    }
    let candidate = &candidates[index];
    jcode::external_auth::approve_external_auth_review_candidate(candidate)
        .map_err(|e| format!("Failed to import auth source: {e}"))?;
    let validation: String = jcode::external_auth::validate_external_auth_review_candidate(candidate)
        .await
        .unwrap_or_else(|e| format!("Imported but validation failed: {e}"));
    jcode::auth::AuthStatus::invalidate_cache();
    Ok(serde_json::json!({
        "imported": true,
        "provider": candidate.provider_summary(),
        "detail": validation,
    }))
}

#[tauri::command]
async fn check_cursor_auth_status() -> Result<serde_json::Value, String> {
    let has_api_key = jcode::auth::cursor::has_cursor_api_key();
    let has_native = jcode::auth::cursor::has_cursor_native_auth();
    let has_vscdb = jcode::auth::cursor::has_cursor_vscdb_token();
    let has_auth_file = jcode::auth::cursor::has_cursor_auth_file_token();
    let preferred_source = jcode::auth::cursor::preferred_external_auth_source()
        .map(|s| s.display_name().to_string());
    Ok(serde_json::json!({
        "has_api_key": has_api_key,
        "has_native_auth": has_native,
        "has_vscdb_token": has_vscdb,
        "has_auth_file_token": has_auth_file,
        "preferred_source": preferred_source,
        "available": has_api_key || has_native,
    }))
}

#[tauri::command]
async fn run_provider_doctor(
    provider_id: String,
    model: Option<String>,
    tier: Option<String>,
) -> Result<serde_json::Value, String> {
    use jcode::auth::provider_e2e::{DoctorTier, run_provider_e2e};
    use jcode::provider_catalog;

    // Try to find by id first, then by display_name (case-insensitive)
    let provider_id_lower = provider_id.to_ascii_lowercase();
    let profile = provider_catalog::openai_compatible_profiles()
        .iter()
        .find(|p| {
            p.id == provider_id
                || p.display_name.to_ascii_lowercase() == provider_id_lower
                || p.id == provider_id_lower
        })
        .ok_or_else(|| format!("Provider '{provider_id}' not found or not OpenAI-compatible"))?;

    let doctor_tier = match tier.as_deref() {
        Some("offline") => DoctorTier::Offline,
        Some("catalog") => DoctorTier::Catalog,
        Some("full") => DoctorTier::Full,
        _ => DoctorTier::Catalog,
    };

    // Try to load API key from env or config
    let api_key = provider_catalog::load_api_key_from_env_or_config(
        profile.api_key_env,
        profile.env_file,
    );

    let api_key_ref = api_key.as_deref().filter(|k| !k.trim().is_empty());

    if doctor_tier.requires_api_key() && api_key_ref.is_none() {
        return Err(format!(
            "Provider '{provider_id}' requires an API key for {:?} tier",
            doctor_tier
        ));
    }

    let report = run_provider_e2e(*profile, api_key_ref, model.as_deref(), doctor_tier)
        .await
        .map_err(|e| format!("Provider doctor failed: {e}"))?;

    Ok(serde_json::json!({
        "provider_id": report.provider_id,
        "provider_label": report.provider_label,
        "model": report.model,
        "tier": report.tier.as_str(),
        "tier_passed": report.tier_passed,
        "strict_passed": report.strict_passed,
        "checks": report.checks.iter().map(|check| {
            serde_json::json!({
                "checkpoint": check.checkpoint,
                "label": check.label,
                "status": match check.status {
                    jcode::live_tests::LiveVerificationStageStatus::Passed => "passed",
                    jcode::live_tests::LiveVerificationStageStatus::Failed => "failed",
                    jcode::live_tests::LiveVerificationStageStatus::Skipped => "skipped",
                    jcode::live_tests::LiveVerificationStageStatus::Blocked => "blocked",
                    jcode::live_tests::LiveVerificationStageStatus::NotRun => "not_run",
                },
                "detail": check.detail,
            })
        }).collect::<Vec<_>>(),
        "spend": report.spend.to_json(),
        "spend_summary": report.spend.human_summary(),
    }))
}

#[tauri::command]
async fn test_provider_connection(
    provider_id: String,
) -> Result<serde_json::Value, String> {
    use jcode::auth::live_provider_probes::fetch_live_openai_compatible_models;
    use jcode::provider_catalog;

    // Try to find by id first, then by display_name (case-insensitive)
    let provider_id_lower = provider_id.to_ascii_lowercase();
    let profile = provider_catalog::openai_compatible_profiles()
        .iter()
        .find(|p| {
            p.id == provider_id
                || p.display_name.to_ascii_lowercase() == provider_id_lower
                || p.id == provider_id_lower
        })
        .ok_or_else(|| format!("Provider '{provider_id}' not found or not OpenAI-compatible"))?;

    let api_key = provider_catalog::load_api_key_from_env_or_config(
        profile.api_key_env,
        profile.env_file,
    );

    let api_key = api_key
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| format!("No API key found for '{provider_id}'"))?;

    let start = std::time::Instant::now();
    let models = fetch_live_openai_compatible_models(*profile, &api_key)
        .await
        .map_err(|e| format!("Connection test failed: {e}"))?;
    let elapsed = start.elapsed();

    Ok(serde_json::json!({
        "provider_id": provider_id,
        "model_count": models.len(),
        "models": models.iter().take(10).collect::<Vec<_>>(),
        "elapsed_ms": elapsed.as_millis() as u64,
        "success": true,
    }))
}

fn delete_session_artifacts(session_id: &str) -> Result<(), String> {
    let session_path = jcode::session::session_path(session_id)
        .map_err(|e| format!("Failed to resolve session path for {session_id}: {e}"))?;
    if session_path.exists() {
        fs::remove_file(&session_path)
            .map_err(|e| format!("Failed to remove {}: {e}", session_path.display()))?;
    }

    let journal_path = jcode::session::session_journal_path(session_id)
        .map_err(|e| format!("Failed to resolve journal path for {session_id}: {e}"))?;
    if journal_path.exists() {
        fs::remove_file(&journal_path)
            .map_err(|e| format!("Failed to remove {}: {e}", journal_path.display()))?;
    }

    Ok(())
}

#[tauri::command]
async fn rename_session(session_id: String, title: String) -> Result<(), String> {
    let session_path = jcode::session::session_path(&session_id)
        .map_err(|e| format!("Failed to resolve session path for {session_id}: {e}"))?;
    if !session_path.exists() {
        return Err(format!("Session file not found for {session_id}"));
    }

    let raw = fs::read_to_string(&session_path)
        .map_err(|e| format!("failed to read {}: {e}", session_path.display()))?;
    let mut value: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("failed to parse {}: {e}", session_path.display()))?;

    value["custom_title"] = serde_json::json!(title.trim());

    fs::write(&session_path, serde_json::to_string_pretty(&value).unwrap_or_default())
        .map_err(|e| format!("failed to write {}: {e}", session_path.display()))?;

    Ok(())
}

#[tauri::command]
async fn delete_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    if let Some(runtime) = state.runtimes.lock().await.get(&session_id).cloned() {
        if *runtime.is_processing.lock().await {
            return Err("Cannot delete a running session.".to_string());
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

    delete_session_artifacts(&session_id)
}

#[tauri::command]
async fn delete_workspace_sessions(
    state: State<'_, AppState>,
    working_dir: Option<String>,
) -> Result<serde_json::Value, String> {
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
        return Err(format!(
            "Cannot delete workspace while active/running sessions exist: {}",
            blocked_sessions.join(", ")
        ));
    }

    let dir = jcode::storage::jcode_dir()
        .map_err(|e| e.to_string())?
        .join("sessions");
    if !dir.exists() {
        return Ok(serde_json::json!({ "deleted_count": 0, "deleted_ids": Vec::<String>::new() }));
    }

    let candidates = fs::read_dir(&dir)
        .map_err(|e| format!("failed to read {}: {e}", dir.display()))?
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
async fn get_workspace_thread_history(
    working_dir: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let workspace_key = working_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("default")
        .to_string();
    let dir = jcode::storage::jcode_dir()
        .map_err(|e| e.to_string())?
        .join("sessions");
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut candidates = fs::read_dir(&dir)
        .map_err(|e| format!("failed to read {}: {e}", dir.display()))?
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
        let role_name = summary
            .get("role_name")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty());
        messages.extend(workspace_history_messages(&session, session_id, role_name));
    }

    messages.sort_by(|a, b| {
        let a_ts = a.get("timestamp").and_then(Value::as_i64).unwrap_or(i64::MIN);
        let b_ts = b.get("timestamp").and_then(Value::as_i64).unwrap_or(i64::MIN);
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
async fn list_sessions(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let dir = jcode::storage::jcode_dir()
        .map_err(|e| e.to_string())?
        .join("sessions");
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut candidates = fs::read_dir(&dir)
        .map_err(|e| format!("failed to read {}: {e}", dir.display()))?
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
        *live_workspace_counts.entry(working_dir.clone()).or_insert(0) += 1;
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
                            summary["subtitle"] = serde_json::json!(format!("{} · {}", member.status, model));
                        }
                        if let Some(ref detail) = member.detail {
                            if !detail.is_empty() {
                                let current_detail = summary
                                    .get("detail")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default();
                                summary["detail"] = serde_json::json!(if current_detail.contains(detail.as_str()) {
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
                            summary["swarm_peer_count"] = serde_json::json!(plan.participants.len());
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
                    let swarm_peer_count = *live_workspace_counts.get(&working_dir_key).unwrap_or(&0);
                    if swarm_peer_count >= 2 {
                        summary["swarm_enabled"] = serde_json::json!(true);
                        summary["swarm_peer_count"] = serde_json::json!(swarm_peer_count);
                        summary["swarm_role"] = serde_json::json!(if workspace_coordinators.get(&working_dir_key) == Some(&session_id) {
                            "coordinator"
                        } else {
                            "agent"
                        });
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
                        if let Some(detail) = status_detail.clone().filter(|value| !value.trim().is_empty()) {
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
                                    _ => summary.get("subtitle").and_then(Value::as_str).unwrap_or("ready").to_string(),
                                });
                            }
                        }
                        if let Some(detail) = status_detail.filter(|value| !value.trim().is_empty()) {
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
    let (raw_routes, current_provider_name) = if let Ok(runtime) = active_runtime(&state).await {
        let provider = { runtime.agent.lock().await.provider_handle() };
        let _ = provider.prefetch_models().await;
        let guard = runtime.agent.lock().await;
        let raw_routes = guard
            .model_routes()
            .into_iter()
            .filter(|r| jcode::provider::is_listable_model_name(&r.model))
            .collect::<Vec<_>>();
        let current = {
            let name = guard.provider_handle().name().to_string();
            if name.eq_ignore_ascii_case("openrouter") {
                std::env::var("JCODE_OPENROUTER_CACHE_NAMESPACE")
                    .ok()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(name)
            } else {
                name
            }
        };
        (raw_routes, Some(current))
    } else {
        // No active session — create a temporary provider so users can still
        // browse and configure providers from the model picker.
        let provider = jcode::provider::MultiProvider::new();
        let _ = provider.prefetch_models().await;
        let raw_routes = provider
            .model_routes()
            .into_iter()
            .filter(|r| jcode::provider::is_listable_model_name(&r.model))
            .collect::<Vec<_>>();
        (raw_routes, None)
    };

    let routes: Vec<serde_json::Value> = raw_routes.iter().cloned().map(serialize_model_route).collect();
    let providers = provider_entries_from_routes(&raw_routes, current_provider_name.as_deref());
    Ok(serde_json::json!({
        "routes": routes,
        "providers": providers,
        "current": current_provider_name.as_deref().unwrap_or(""),
    }))
}

#[tauri::command]
async fn save_provider_api_key(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: Option<String>,
    provider_id: String,
    api_key: String,
    region: Option<String>,
    api_base: Option<String>,
) -> Result<(), String> {
    let trimmed_key = api_key.trim();
    if trimmed_key.is_empty() {
        return Err("API key cannot be empty".to_string());
    }

    match provider_id.as_str() {
        "openrouter" => {
            jcode::cli::provider_init::save_named_api_key(
                "openrouter.env",
                "OPENROUTER_API_KEY",
                trimmed_key,
            )
            .map_err(|e| format!("Failed to save OpenRouter API key: {e}"))?;
        }
        "openai-api" => {
            jcode::cli::provider_init::save_named_api_key("openai.env", "OPENAI_API_KEY", trimmed_key)
                .map_err(|e| format!("Failed to save OpenAI API key: {e}"))?;
        }
        "cursor" => {
            jcode::cli::provider_init::save_named_api_key("cursor.env", "CURSOR_API_KEY", trimmed_key)
                .map_err(|e| format!("Failed to save Cursor API key: {e}"))?;
        }
        "jcode" => {
            jcode::cli::provider_init::save_named_api_key(
                jcode::subscription_catalog::JCODE_ENV_FILE,
                jcode::subscription_catalog::JCODE_API_KEY_ENV,
                trimmed_key,
            )
            .map_err(|e| format!("Failed to save Jcode API key: {e}"))?;

            if let Some(api_base) = api_base.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
                jcode::provider_catalog::save_env_value_to_env_file(
                    jcode::subscription_catalog::JCODE_API_BASE_ENV,
                    jcode::subscription_catalog::JCODE_ENV_FILE,
                    Some(api_base),
                )
                .map_err(|e| format!("Failed to save Jcode API base: {e}"))?;
                jcode::env::set_var(jcode::subscription_catalog::JCODE_API_BASE_ENV, api_base);
            }
        }
        "bedrock" => {
            let region = region
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("us-east-2");
            jcode::cli::provider_init::save_named_api_key(
                jcode::provider::bedrock::ENV_FILE,
                jcode::provider::bedrock::API_KEY_ENV,
                trimmed_key,
            )
            .map_err(|e| format!("Failed to save Bedrock API key: {e}"))?;
            jcode::provider_catalog::save_env_value_to_env_file(
                jcode::provider::bedrock::REGION_ENV,
                jcode::provider::bedrock::ENV_FILE,
                Some(region),
            )
            .map_err(|e| format!("Failed to save Bedrock region: {e}"))?;
            jcode::env::set_var(jcode::provider::bedrock::REGION_ENV, region);
        }
        provider_id => {
            // Generic handler for OpenAI-compatible providers (deepseek, togetherai, etc.)
            let descriptor = jcode::provider_catalog::resolve_login_provider(provider_id)
                .ok_or_else(|| format!("Inline API key save is not supported for provider `{provider_id}`"))?;
            if let jcode::provider_catalog::LoginProviderTarget::OpenAiCompatible(profile) = descriptor.target {
                let resolved = jcode::provider_catalog::resolve_openai_compatible_profile(profile);
                jcode::cli::provider_init::save_named_api_key(
                    &resolved.env_file,
                    &resolved.api_key_env,
                    trimmed_key,
                )
                .map_err(|e| format!("Failed to save {} API key: {e}", resolved.display_name))?;
            } else {
                return Err(format!("Inline API key save is not supported for provider `{provider_id}`"));
            }
        }
    }

    jcode::auth::AuthStatus::invalidate_cache();
    state.clear_provider().await;
    refresh_active_runtime_auth(&app_handle, &state, session_id.as_deref()).await?;
    Ok(())
}

#[tauri::command]
async fn start_provider_auth_flow(provider_id: String) -> Result<serde_json::Value, String> {
    let provider = resolve_login_provider(&provider_id)
        .ok_or_else(|| format!("Unknown provider: {provider_id}"))?;
    let options = LoginOptions {
        print_auth_url: true,
        json: true,
        ..Default::default()
    };
    let prompt = start_scriptable_login_data(provider, None, &options)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(prompt).map_err(|e| e.to_string())
}

#[tauri::command]
async fn complete_provider_auth_flow(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: Option<String>,
    provider_id: String,
    input_kind: String,
    input: Option<String>,
) -> Result<serde_json::Value, String> {
    let provided_input = match input_kind.as_str() {
        "complete" => None,
        "callback_url" => {
            let value = input
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Callback URL is required".to_string())?;
            Some(jcode::cli::login::ProvidedAuthInput::CallbackUrl(value.to_string()))
        }
        "auth_code" => {
            let value = input
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Authorization code is required".to_string())?;
            Some(jcode::cli::login::ProvidedAuthInput::AuthCode(value.to_string()))
        }
        "auth_code_or_callback_url" => {
            let value = input
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Callback URL or authorization code is required".to_string())?;
            if value.contains("://") || value.contains("code=") || value.contains("state=") {
                Some(jcode::cli::login::ProvidedAuthInput::CallbackUrl(value.to_string()))
            } else {
                Some(jcode::cli::login::ProvidedAuthInput::AuthCode(value.to_string()))
            }
        }
        other => return Err(format!("Unsupported auth completion kind `{other}`")),
    };

    let provider = resolve_login_provider(&provider_id)
        .ok_or_else(|| format!("Unknown provider: {provider_id}"))?;
    let options = LoginOptions {
        complete: input_kind == "complete",
        json: true,
        ..Default::default()
    };
    let (success, _) = complete_scriptable_login_data(provider, None, &options, provided_input)
        .await
        .map_err(|e| e.to_string())?;
    jcode::auth::AuthStatus::invalidate_cache();
    refresh_active_runtime_auth(&app_handle, &state, session_id.as_deref()).await?;
    serde_json::to_value(success).map_err(|e| e.to_string())
}

#[tauri::command]
async fn clear_chat(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let runtime = get_runtime_by_session_id(&state, &session_id).await?;
    let mut guard = runtime.agent.lock().await;
    guard.clear();
    drop(guard);
    app_handle
        .emit(
            "server-event",
            &serde_json::json!({ "type": "clear_chat", "session_id": session_id }),
        )
        .ok();
    Ok(())
}

#[tauri::command]
async fn rewind_chat(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    message_index: usize,
) -> Result<(), String> {
    let runtime = get_runtime_by_session_id(&state, &session_id).await?;
    let mut guard = runtime.agent.lock().await;
    guard
        .rewind_to_message(message_index)
        .map_err(|e| format!("Failed to rewind: {e}"))?;
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
async fn set_reasoning_effort(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    effort: String,
) -> Result<(), String> {
    let runtime = get_runtime_by_session_id(&state, &session_id).await?;
    let mut guard = runtime.agent.lock().await;
    let current = guard
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
                "session_id": session_id,
            }),
        )
        .ok();
    Ok(())
}

#[tauri::command]
async fn compact_context(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
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

#[tauri::command]
async fn get_permission_requests() -> Result<serde_json::Value, String> {
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
async fn respond_to_permission(
    request_id: String,
    approved: bool,
    message: Option<String>,
) -> Result<(), String> {
    let safety = jcode::safety::SafetySystem::new();
    safety
        .record_decision(&request_id, approved, "desktop", message)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_provider_profile(
    name: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
    auth: Option<String>,
) -> Result<serde_json::Value, String> {
    use jcode::cli::commands::provider_setup::{ProviderAddOptions, configure_provider_profile};
    let auth_arg = auth.as_deref().and_then(|a| match a {
        "bearer" => Some(jcode::cli::args::ProviderAuthArg::Bearer),
        "api-key" => Some(jcode::cli::args::ProviderAuthArg::ApiKey),
        "none" => Some(jcode::cli::args::ProviderAuthArg::None),
        _ => None,
    });
    let options = ProviderAddOptions {
        name,
        base_url,
        model,
        context_window: None,
        api_key_env: None,
        api_key,
        api_key_stdin: false,
        no_api_key: false,
        auth: auth_arg,
        auth_header: None,
        env_file: None,
        set_default: false,
        overwrite: false,
        provider_routing: false,
        model_catalog: false,
        json: false,
    };
    let report = configure_provider_profile(options).map_err(|e: anyhow::Error| e.to_string())?;
    Ok(serde_json::json!({
        "profile": report.profile,
        "config_path": report.config_path,
        "api_base": report.api_base,
        "model": report.model,
        "api_key_stored": report.api_key_stored,
        "auth": report.auth,
        "default_set": report.default_set,
    }))
}

#[tauri::command]
async fn send_transcript(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    text: String,
    mode: String,
) -> Result<(), String> {
    const TRANSCRIPTION_PREFIX: &str = "[transcription]";
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Transcript text is empty".to_string());
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
            .ok_or("No active session")?;
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
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn get_browser_status() -> Result<serde_json::Value, String> {
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
        Err(e) => Err(format!("Browser status check failed: {e}")),
    }
}

#[tauri::command]
async fn setup_browser() -> Result<String, String> {
    match jcode::browser::ensure_browser_setup().await {
        Ok(log) => Ok(log),
        Err(e) => Err(format!("Browser setup failed: {e}")),
    }
}

#[tauri::command]
async fn save_session_state(session_id: String, working_dir: Option<String>) -> Result<(), String> {
    let state = serde_json::json!({
        "session_id": session_id,
        "working_dir": working_dir,
        "saved_at": chrono::Utc::now().to_rfc3339(),
    });
    let path = jcode::storage::jcode_dir()
        .map_err(|e| e.to_string())?
        .join("desktop_app_state.json");
    std::fs::write(&path, serde_json::to_string_pretty(&state).unwrap_or_default())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_last_session_state() -> Result<Option<serde_json::Value>, String> {
    let path = jcode::storage::jcode_dir()
        .map_err(|e| e.to_string())?
        .join("desktop_app_state.json");
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let state: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(Some(state))
}

#[tauri::command]
async fn clear_session_state() -> Result<(), String> {
    let path = jcode::storage::jcode_dir()
        .map_err(|e| e.to_string())?
        .join("desktop_app_state.json");
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

#[tauri::command]
async fn run_dictation() -> Result<serde_json::Value, String> {
    let run = jcode::dictation::run_configured()
        .await
        .map_err(|e| e.to_string())?;
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
async fn list_workspace_files(working_dir: Option<String>) -> Result<Vec<String>, String> {
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
        let Ok(entries) = std::fs::read_dir(path) else { return };
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
async fn git_status(working_dir: Option<String>) -> Result<String, String> {
    let output = tokio::process::Command::new("git")
        .arg("status")
        .arg("--short")
        .arg("--branch")
        .current_dir(working_dir.as_deref().unwrap_or("."))
        .output()
        .await
        .map_err(|e| format!("Failed to run git status: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(format!("git status failed: {stderr}"));
    }
    Ok(if stdout.trim().is_empty() {
        "Working tree clean".to_string()
    } else {
        stdout.trim().to_string()
    })
}

#[tauri::command]
async fn trigger_ambient() -> Result<(), String> {
    let mut state = jcode::ambient::AmbientState::load().unwrap_or_default();
    if matches!(
        state.status,
        jcode::ambient::AmbientStatus::Scheduled { .. } | jcode::ambient::AmbientStatus::Idle
    ) {
        state.status = jcode::ambient::AmbientStatus::Idle;
    }
    state.save().map_err(|e| e.to_string())
}

#[tauri::command]
async fn stop_ambient() -> Result<(), String> {
    let mut state = jcode::ambient::AmbientState::load().unwrap_or_default();
    state.status = jcode::ambient::AmbientStatus::Disabled;
    state.save().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // rustls 0.23 当同时编译了多个 provider（ring + aws-lc-rs）时不能自动选择，
    // 必须在任何 TLS 连接前显式安装。使用 ring（轻量、广泛支持）。
    let _ = rustls::crypto::ring::default_provider().install_default();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .setup(|app| {
            if let Ok(app_data_dir) = app.path().app_data_dir() {
                std::env::set_var("JCODE_HOME", app_data_dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            begin_session,
            begin_swarm,
            resume_session,
            send_message,
            cancel,
            send_soft_interrupt,
            set_model,
            set_memory_enabled,
            get_workspace_memory_preferences,
            set_workspace_memory_preference,
            get_workspace_thread_history,
            list_sessions,
            delete_session,
            delete_workspace_sessions,
            send_stdin_response,
            get_models,
            save_provider_api_key,
            start_provider_auth_flow,
            complete_provider_auth_flow,
            clear_chat,
            rewind_chat,
            set_reasoning_effort,
            compact_context,
            rename_session,
            get_version_info,
            get_auth_status,
            run_auth_doctor,
            get_usage_info,
            get_external_auth_candidates,
            approve_external_auth_candidate,
            check_cursor_auth_status,
            run_provider_doctor,
            test_provider_connection,
            get_ambient_status,
            get_ambient_transcripts,
            run_auth_test,
            get_memory_list,
            search_memories,
            get_memory_stats,
            get_memory_graph,
            export_memories,
            import_memories,
            generate_pairing_code,
            list_paired_devices,
            revoke_device,
            list_background_tasks,
            cancel_background_task,
            get_permission_requests,
            respond_to_permission,
            trigger_ambient,
            stop_ambient,
            add_provider_profile,
            get_browser_status,
            setup_browser,
            send_transcript,
            run_dictation,
            list_workspace_files,
            git_status,
            save_session_state,
            get_last_session_state,
            clear_session_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
