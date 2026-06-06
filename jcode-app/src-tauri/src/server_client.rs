use jcode::protocol::{Request, ServerEvent};
use jcode::server::Client as JcodeClient;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, RwLock};

/// Wrapper around jcode::server::Client that handles connection,
/// request/response pairing, and background event forwarding.
pub struct ServerClient {
    inner: Arc<Mutex<Option<JcodeClient>>>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    active_session_id: Arc<RwLock<Option<String>>>,
}

impl ServerClient {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
            app_handle: Arc::new(RwLock::new(None)),
            active_session_id: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn set_active_session(&self, session_id: Option<String>) {
        let mut guard = self.active_session_id.write().await;
        *guard = session_id;
    }

    pub async fn set_app_handle(&self, handle: AppHandle) {
        let mut guard = self.app_handle.write().await;
        *guard = Some(handle);
    }

    /// Attempt to connect to the jcode server socket.
    /// Returns true if connected or already connected.
    pub async fn connect(&self) -> Result<bool, String> {
        let mut guard = self.inner.lock().await;
        if guard.is_some() {
            // Probe with ping to ensure still alive
            if let Some(ref mut client) = *guard {
                match tokio::time::timeout(std::time::Duration::from_secs(2), client.ping()).await {
                    Ok(Ok(true)) => return Ok(true),
                    _ => {
                        // Connection stale, drop and reconnect
                        *guard = None;
                    }
                }
            }
        }

        match JcodeClient::connect().await {
            Ok(client) => {
                *guard = Some(client);
                Ok(true)
            }
            Err(e) => {
                eprintln!("[server_client] connect failed: {e}");
                Ok(false)
            }
        }
    }

    /// Disconnect from the server.
    pub async fn disconnect(&self) {
        let mut guard = self.inner.lock().await;
        *guard = None;
    }

    /// Returns true if we have an active connection.
    pub async fn is_connected(&self) -> bool {
        self.inner.lock().await.is_some()
    }

    /// Send a request and wait for the matching response event.
    /// Skips acks and unrelated broadcast events.
    pub async fn request(&self, req: Request) -> Result<ServerEvent, String> {
        let request_id = req.id();
        let mut guard = self.inner.lock().await;
        let mut client = guard.as_mut().ok_or("Not connected to server")?;

        client
            .send_request(req)
            .await
            .map_err(|e| format!("Failed to send request: {e}"))?;

        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);

        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return Err("Server request timed out".to_string());
            }

            let event = tokio::time::timeout(remaining, client.read_event()).await;
            let event = event.map_err(|_| "Server read timed out".to_string())?;
            let event = event.map_err(|e| format!("Server read error: {e}"))?;

            match event {
                ServerEvent::Ack { .. } => continue,
                ServerEvent::Pong { id } if id != request_id => continue,
                // Forward broadcast events that are not tied to our request
                ref ev if Self::is_broadcast_event(ev) && Self::event_id(ev) != Some(request_id) => {
                    drop(guard);
                    Self::emit_event(&self.app_handle, &self.active_session_id, event).await;
                    guard = self.inner.lock().await;
                    client = guard.as_mut().ok_or("Not connected to server")?;
                    continue;
                }
                _ => return Ok(event),
            }
        }
    }

    /// Send a request without waiting for response (fire-and-forget)
    pub async fn send(&self, req: Request) -> Result<(), String> {
        let mut guard = self.inner.lock().await;
        let client = guard.as_mut().ok_or("Not connected to server")?;
        client
            .send_request(req)
            .await
            .map_err(|e| format!("Failed to send request: {e}"))?;
        Ok(())
    }

    /// Start a background task that reads events from the server and
    /// forwards them to the frontend as Tauri events.
    pub fn start_event_loop(&self) {
        let inner = self.inner.clone();
        let app_handle = self.app_handle.clone();
        let active_session_id = self.active_session_id.clone();

        tokio::spawn(async move {
            loop {
                // Wait until connected
                let mut client_guard = inner.lock().await;
                let client = match client_guard.as_mut() {
                    Some(c) => c,
                    None => {
                        drop(client_guard);
                        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                        continue;
                    }
                };

                // Subscribe to events
                let subscribe_result = client.subscribe().await;
                if let Err(e) = subscribe_result {
                    eprintln!("[server_client] subscribe failed: {e}");
                    drop(client_guard);
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                }

                eprintln!("[server_client] event loop started");
                drop(client_guard);

                // Read events
                loop {
                    let mut client_guard = inner.lock().await;
                    let client = match client_guard.as_mut() {
                        Some(c) => c,
                        None => break,
                    };

                    let read_result = tokio::time::timeout(
                        std::time::Duration::from_secs(60),
                        client.read_event(),
                    )
                    .await;

                    match read_result {
                        Ok(Ok(event)) => {
                            drop(client_guard);
                            Self::emit_event(&app_handle, &active_session_id, event).await;
                        }
                        Ok(Err(e)) => {
                            eprintln!("[server_client] read error: {e}");
                            drop(client_guard);
                            break;
                        }
                        Err(_) => {
                            // Timeout, just loop and check connection
                            drop(client_guard);
                        }
                    }
                }

                eprintln!("[server_client] event loop disconnected, retrying...");
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        });
    }

    fn is_broadcast_event(event: &ServerEvent) -> bool {
        matches!(
            event,
            ServerEvent::SwarmStatus { .. }
                | ServerEvent::SwarmPlan { .. }
                | ServerEvent::SwarmPlanProposal { .. }
                | ServerEvent::Notification { .. }
                | ServerEvent::SoftInterruptInjected { .. }
                | ServerEvent::MemoryInjected { .. }
                | ServerEvent::Compaction { .. }
                | ServerEvent::BatchProgress { .. }
                | ServerEvent::SidePaneImages { .. }
                | ServerEvent::Done { .. }
                | ServerEvent::Error { .. }
                | ServerEvent::TextDelta { .. }
                | ServerEvent::ToolStart { .. }
                | ServerEvent::ToolExec { .. }
                | ServerEvent::ToolDone { .. }
                | ServerEvent::ToolInput { .. }
                | ServerEvent::ConnectionPhase { .. }
                | ServerEvent::StatusDetail { .. }
                | ServerEvent::MessageEnd
                | ServerEvent::UpstreamProvider { .. }
                | ServerEvent::ConnectionType { .. }
                | ServerEvent::ModelChanged { .. }
                | ServerEvent::ReasoningEffortChanged { .. }
                | ServerEvent::ServiceTierChanged { .. }
                | ServerEvent::TransportChanged { .. }
                | ServerEvent::CompactionModeChanged { .. }
                | ServerEvent::AvailableModelsUpdated { .. }
                | ServerEvent::McpStatus { .. }
                | ServerEvent::Reloading { .. }
                | ServerEvent::ReloadProgress { .. }
                | ServerEvent::SessionRenamed { .. }
                | ServerEvent::State { .. }
                | ServerEvent::TokenUsage { .. }
                | ServerEvent::KvCacheRequest { .. }
                | ServerEvent::GeneratedImage { .. }
                | ServerEvent::InputShellResult { .. }
                | ServerEvent::Transcript { .. }
                | ServerEvent::SidePanelState { .. }
                | ServerEvent::Interrupted
        )
    }

    fn event_id(event: &ServerEvent) -> Option<u64> {
        match event {
            ServerEvent::Ack { id } => Some(*id),
            ServerEvent::Pong { id } => Some(*id),
            ServerEvent::Done { id } => Some(*id),
            ServerEvent::Error { id, .. } => Some(*id),
            ServerEvent::History { id, .. } => Some(*id),
            ServerEvent::CompactedHistory { id, .. } => Some(*id),
            ServerEvent::ModelChanged { id, .. } => Some(*id),
            ServerEvent::ReasoningEffortChanged { id, .. } => Some(*id),
            ServerEvent::ServiceTierChanged { id, .. } => Some(*id),
            ServerEvent::TransportChanged { id, .. } => Some(*id),
            ServerEvent::CompactionModeChanged { id, .. } => Some(*id),
            ServerEvent::CommContext { id, .. } => Some(*id),
            ServerEvent::CommMembers { id, .. } => Some(*id),
            ServerEvent::CommChannels { id, .. } => Some(*id),
            ServerEvent::CommSummaryResponse { id, .. } => Some(*id),
            ServerEvent::CommStatusResponse { id, .. } => Some(*id),
            ServerEvent::CommReportResponse { id, .. } => Some(*id),
            ServerEvent::CommPlanStatusResponse { id, .. } => Some(*id),
            ServerEvent::CommAssignTaskResponse { id, .. } => Some(*id),
            ServerEvent::CommTaskControlResponse { id, .. } => Some(*id),
            ServerEvent::CommContextHistory { id, .. } => Some(*id),
            ServerEvent::CommSpawnResponse { id, .. } => Some(*id),
            ServerEvent::CommAwaitMembersResponse { id, .. } => Some(*id),
            ServerEvent::SplitResponse { id, .. } => Some(*id),
            ServerEvent::CompactResult { id, .. } => Some(*id),
            ServerEvent::DebugResponse { id, .. } => Some(*id),
            ServerEvent::ClientDebugRequest { id, .. } => Some(*id),
            _ => None,
        }
    }

    async fn emit_event(
        app_handle: &RwLock<Option<AppHandle>>,
        active_session_id: &RwLock<Option<String>>,
        event: ServerEvent,
    ) {
        let guard = app_handle.read().await;
        let handle = match guard.as_ref() {
            Some(h) => h,
            None => return,
        };
        let mut payload = match serde_json::to_value(&event) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[server_client] failed to serialize event: {e}");
                return;
            }
        };

        // Inject session_id so the frontend can route events correctly.
        let sid_guard = active_session_id.read().await;
        if let Some(ref sid) = *sid_guard {
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("session_id".to_string(), serde_json::json!(sid));
            }
        }
        drop(sid_guard);

        // Emit as "server-event" for compatibility with existing frontend
        let _ = handle.emit("server-event", &payload);
    }
}
