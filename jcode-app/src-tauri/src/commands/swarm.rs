use crate::commands::*;
use crate::error::TauriError;
use tauri::State;

#[tauri::command]
pub async fn server_connect(state: State<'_, AppState>) -> Result<bool, TauriError> {
    let client = {
        let guard = state.server_client.lock().map_err(|e| TauriError::from(e.to_string()))?;
        guard.clone()
    };
    if let Some(client) = client {
        client.connect().await
    } else {
        Ok(false)
    }
}
#[tauri::command]
pub async fn server_is_connected(state: State<'_, AppState>) -> Result<bool, TauriError> {
    let client = {
        let guard = state.server_client.lock().map_err(|e| TauriError::from(e.to_string()))?;
        guard.clone()
    };
    if let Some(client) = client {
        Ok(client.is_connected().await)
    } else {
        Ok(false)
    }
}
#[tauri::command]
pub async fn comm_spawn(
    state: State<'_, AppState>,
    session_id: String,
    working_dir: Option<String>,
    initial_message: Option<String>,
    model: Option<String>,
    provider_key: Option<String>,
    spawn_mode: Option<String>,
) -> Result<serde_json::Value, TauriError> {
    let client = get_server_client(&state)?;
    let req = jcode::protocol::Request::CommSpawn {
        id: 1,
        session_id,
        working_dir,
        initial_message,
        request_nonce: None,
        spawn_mode,
        model,
        provider_key,
    };
    let response = client.request(req).await?;
    match response {
        jcode::protocol::ServerEvent::CommSpawnResponse { new_session_id, .. } => {
            Ok(serde_json::json!({ "new_session_id": new_session_id }))
        }
        jcode::protocol::ServerEvent::Error { message, .. } => Err(TauriError::ServerClient(message)),
        _ => Err(TauriError::Other("Unexpected response from server".to_string())),
    }
}
#[tauri::command]
pub async fn comm_stop(
    state: State<'_, AppState>,
    session_id: String,
    target_session: String,
    force: Option<bool>,
) -> Result<(), TauriError> {
    let client = get_server_client(&state)?;
    let req = jcode::protocol::Request::CommStop {
        id: 1,
        session_id,
        target_session,
        force,
    };
    let response = client.request(req).await?;
    match response {
        jcode::protocol::ServerEvent::Ack { .. } => Ok(()),
        jcode::protocol::ServerEvent::Error { message, .. } => Err(TauriError::ServerClient(message)),
        _ => Ok(()),
    }
}
#[tauri::command]
pub async fn comm_list(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<jcode::protocol::AgentInfo>, TauriError> {
    let client = get_server_client(&state)?;
    let req = jcode::protocol::Request::CommList {
        id: 1,
        session_id,
    };
    let response = client.request(req).await?;
    match response {
        jcode::protocol::ServerEvent::CommMembers { members, .. } => Ok(members),
        jcode::protocol::ServerEvent::Error { message, .. } => Err(TauriError::ServerClient(message)),
        _ => Err(TauriError::Other("Unexpected response from server".to_string())),
    }
}
#[tauri::command]
pub async fn comm_status(
    state: State<'_, AppState>,
    session_id: String,
    target_session: String,
) -> Result<serde_json::Value, TauriError> {
    let client = get_server_client(&state)?;
    let req = jcode::protocol::Request::CommStatus {
        id: 1,
        session_id,
        target_session,
    };
    let response = client.request(req).await?;
    match response {
        jcode::protocol::ServerEvent::CommStatusResponse { snapshot, .. } => {
            Ok(serde_json::to_value(snapshot).map_err(|e| TauriError::from(e.to_string()))?)
        }
        jcode::protocol::ServerEvent::Error { message, .. } => Err(TauriError::ServerClient(message)),
        _ => Err(TauriError::Other("Unexpected response from server".to_string())),
    }
}
#[tauri::command]
pub async fn comm_assign_task(
    state: State<'_, AppState>,
    session_id: String,
    target_session: Option<String>,
    task_id: Option<String>,
    message: Option<String>,
) -> Result<serde_json::Value, TauriError> {
    let client = get_server_client(&state)?;
    let req = jcode::protocol::Request::CommAssignTask {
        id: 1,
        session_id,
        target_session,
        task_id,
        message,
    };
    let response = client.request(req).await?;
    match response {
        jcode::protocol::ServerEvent::CommAssignTaskResponse {
            task_id,
            target_session,
            ..
        } => Ok(serde_json::json!({
            "task_id": task_id,
            "target_session": target_session,
        })),
        jcode::protocol::ServerEvent::Error { message, .. } => Err(TauriError::ServerClient(message)),
        _ => Err(TauriError::Other("Unexpected response from server".to_string())),
    }
}
#[tauri::command]
pub async fn comm_approve_plan(
    state: State<'_, AppState>,
    session_id: String,
    proposer_session: String,
) -> Result<(), TauriError> {
    let client = get_server_client(&state)?;
    let req = jcode::protocol::Request::CommApprovePlan {
        id: 1,
        session_id,
        proposer_session,
    };
    let response = client.request(req).await?;
    match response {
        jcode::protocol::ServerEvent::Ack { .. } => Ok(()),
        jcode::protocol::ServerEvent::Error { message, .. } => Err(TauriError::ServerClient(message)),
        _ => Ok(()),
    }
}
#[tauri::command]
pub async fn comm_reject_plan(
    state: State<'_, AppState>,
    session_id: String,
    proposer_session: String,
    reason: Option<String>,
) -> Result<(), TauriError> {
    let client = get_server_client(&state)?;
    let req = jcode::protocol::Request::CommRejectPlan {
        id: 1,
        session_id,
        proposer_session,
        reason,
    };
    let response = client.request(req).await?;
    match response {
        jcode::protocol::ServerEvent::Ack { .. } => Ok(()),
        jcode::protocol::ServerEvent::Error { message, .. } => Err(TauriError::ServerClient(message)),
        _ => Ok(()),
    }
}
#[tauri::command]
pub async fn comm_message(
    state: State<'_, AppState>,
    from_session: String,
    message: String,
    to_session: Option<String>,
    channel: Option<String>,
    delivery: Option<String>,
    wake: Option<bool>,
) -> Result<(), TauriError> {
    let client = get_server_client(&state)?;
    let delivery_mode = delivery.and_then(|d| match d.as_str() {
        "notify" => Some(jcode::protocol::CommDeliveryMode::Notify),
        "interrupt" => Some(jcode::protocol::CommDeliveryMode::Interrupt),
        "wake" => Some(jcode::protocol::CommDeliveryMode::Wake),
        _ => None,
    });
    let req = jcode::protocol::Request::CommMessage {
        id: 1,
        from_session,
        message,
        to_session,
        channel,
        delivery: delivery_mode,
        wake,
    };
    let response = client.request(req).await?;
    match response {
        jcode::protocol::ServerEvent::Ack { .. } => Ok(()),
        jcode::protocol::ServerEvent::Error { message, .. } => Err(TauriError::ServerClient(message)),
        _ => Ok(()),
    }
}
#[tauri::command]
pub async fn comm_plan_status(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<serde_json::Value, TauriError> {
    let client = get_server_client(&state)?;
    let req = jcode::protocol::Request::CommPlanStatus {
        id: 1,
        session_id,
    };
    let response = client.request(req).await?;
    match response {
        jcode::protocol::ServerEvent::CommPlanStatusResponse { summary, .. } => {
            Ok(serde_json::to_value(summary).map_err(|e| TauriError::from(e.to_string()))?)
        }
        jcode::protocol::ServerEvent::Error { message, .. } => Err(TauriError::ServerClient(message)),
        _ => Err(TauriError::Other("Unexpected response from server".to_string())),
    }
}
#[tauri::command]
pub async fn comm_list_channels(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<jcode::protocol::SwarmChannelInfo>, TauriError> {
    let client = get_server_client(&state)?;
    let req = jcode::protocol::Request::CommListChannels {
        id: 1,
        session_id,
    };
    let response = client.request(req).await?;
    match response {
        jcode::protocol::ServerEvent::CommChannels { channels, .. } => Ok(channels),
        jcode::protocol::ServerEvent::Error { message, .. } => Err(TauriError::ServerClient(message)),
        _ => Err(TauriError::Other("Unexpected response from server".to_string())),
    }
}
#[tauri::command]
pub async fn comm_read_context(
    state: State<'_, AppState>,
    session_id: String,
    key: Option<String>,
) -> Result<serde_json::Value, TauriError> {
    let client = get_server_client(&state)?;
    let req = jcode::protocol::Request::CommRead {
        id: 1,
        session_id,
        key,
    };
    let response = client.request(req).await?;
    match response {
        jcode::protocol::ServerEvent::CommContext { entries, .. } => {
            Ok(serde_json::to_value(entries).map_err(|e| TauriError::from(e.to_string()))?)
        }
        jcode::protocol::ServerEvent::Error { message, .. } => Err(TauriError::ServerClient(message)),
        _ => Err(TauriError::Other("Unexpected response from server".to_string())),
    }
}
