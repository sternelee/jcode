use crate::error::TauriError;
use jcode::protocol::{Request, ServerEvent};
use jcode::transport::WriteHalf;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;
/// Wrapper around a jcode server connection that handles event reading,
/// request/response pairing, and background event forwarding.
pub struct ServerClient {
    writer: Arc<Mutex<Option<WriteHalf>>>,
    pending_requests: Arc<Mutex<HashMap<u64, tokio::sync::mpsc::UnboundedSender<ServerEvent>>>>,
    app_handle: Arc<std::sync::RwLock<Option<AppHandle>>>,
    active_session_id: Arc<std::sync::RwLock<Option<String>>>,
    reader_running: Arc<AtomicBool>,
}

impl ServerClient {
    pub fn new() -> Self {
        Self {
            writer: Arc::new(Mutex::new(None)),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            app_handle: Arc::new(std::sync::RwLock::new(None)),
            active_session_id: Arc::new(std::sync::RwLock::new(None)),
            reader_running: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn set_active_session(&self, session_id: Option<String>) {
        let mut guard = self.active_session_id.write().unwrap();
        *guard = session_id;
    }

    pub fn set_app_handle(&self, handle: AppHandle) {
        let mut guard = self.app_handle.write().unwrap();
        *guard = Some(handle);
    }

    /// Attempt to connect to the jcode server socket.
    /// Returns true if connected or already connected.
    pub async fn connect(&self) -> Result<bool, TauriError> {
        {
            let guard = self.writer.lock().await;
            if guard.is_some() {
                return Ok(true);
            }
        }

        let socket_path = jcode::server::socket_path();
        let was_stale = jcode::server::reap_stale_socket_if_dead(&socket_path).await;
        if was_stale {
            eprintln!("[server_client] reaped stale socket at {}", socket_path.display());
        }

        let stream = jcode::server::connect_socket(&socket_path)
            .await
            .map_err(|e| TauriError::Other(format!("Failed to connect to server: {e}")))?;
        let (read_half, write_half) = stream.into_split();

        *self.writer.lock().await = Some(write_half);

        if !self.reader_running.swap(true, Ordering::SeqCst) {
            let pending = self.pending_requests.clone();
            let app_handle = self.app_handle.clone();
            let active_session_id = self.active_session_id.clone();
            let writer = self.writer.clone();
            let reader_running = self.reader_running.clone();

            tokio::spawn(async move {
                let mut reader = BufReader::new(read_half);
                let mut line = String::new();
                loop {
                    line.clear();
                    let read_result = tokio::time::timeout(
                        std::time::Duration::from_secs(60),
                        reader.read_line(&mut line),
                    )
                    .await;

                    match read_result {
                        Ok(Ok(0)) => {
                            eprintln!("[server_client] event loop: EOF");
                            let _ = writer.lock().await.take();
                            break;
                        }
                        Ok(Ok(_)) => {
                            let event: ServerEvent = match serde_json::from_str(&line) {
                                Ok(e) => e,
                                Err(e) => {
                                    eprintln!("[server_client] failed to parse event: {e}");
                                    continue;
                                }
                            };

                            let request_id = Self::event_id(&event);
                            let mut handled = false;
                            if let Some(id) = request_id {
                                let mut pending_guard = pending.lock().await;
                                if let Some(tx) = pending_guard.get(&id) {
                                    if tx.send(event.clone()).is_err() {
                                        pending_guard.remove(&id);
                                    } else {
                                        handled = true;
                                    }
                                }
                            }

                            if !handled {
                                Self::emit_event(&app_handle, &active_session_id, event);
                            }
                        }
                        Ok(Err(e)) => {
                            eprintln!("[server_client] event loop read error: {e}");
                            let _ = writer.lock().await.take();
                            break;
                        }
                        Err(_) => {
                            // Timeout — check if we were explicitly disconnected
                            if writer.lock().await.is_none() {
                                break;
                            }
                        }
                    }
                }
                reader_running.store(false, Ordering::SeqCst);
                eprintln!("[server_client] event loop disconnected");
            });
        }

        Ok(true)
    }

    /// Disconnect from the server.
    pub async fn disconnect(&self) {
        let mut guard = self.writer.lock().await;
        *guard = None;
    }

    /// Returns true if we have an active connection.
    pub async fn is_connected(&self) -> bool {
        self.writer.lock().await.is_some()
    }

    /// Send a request and wait for the matching response event.
    /// The event loop routes matching events here instead of forwarding
    /// them to the frontend. Acks are skipped automatically.
    pub async fn request(&self, req: Request) -> Result<ServerEvent, TauriError> {
        let request_id = req.id();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

        {
            let mut pending = self.pending_requests.lock().await;
            pending.insert(request_id, tx);
        }

        self.send(req).await?;

        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);

        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                self.pending_requests.lock().await.remove(&request_id);
                return Err(TauriError::Other("Server request timed out".to_string()));
            }

            match tokio::time::timeout(remaining, rx.recv()).await {
                Ok(Some(event)) => match event {
                    ServerEvent::Ack { .. } => continue,
                    _ => {
                        self.pending_requests.lock().await.remove(&request_id);
                        return Ok(event);
                    }
                },
                Ok(None) => {
                    return Err(TauriError::Other("Response channel closed".to_string()));
                }
                Err(_) => {
                    self.pending_requests.lock().await.remove(&request_id);
                    return Err(TauriError::Other("Server request timed out".to_string()));
                }
            }
        }
    }

    /// Send a request without waiting for response (fire-and-forget).
    /// Events generated by this request are read by the background event
    /// loop and forwarded to the frontend.
    pub async fn send(&self, req: Request) -> Result<(), TauriError> {
        let json = serde_json::to_string(&req).map_err(|e| TauriError::from(e.to_string()))? + "\n";
        let mut guard = self.writer.lock().await;
        let writer = guard.as_mut().ok_or_else(|| TauriError::Other("Not connected to server".to_string()))?;
        writer
            .write_all(json.as_bytes())
            .await
            .map_err(|e| TauriError::Other(format!("Failed to write request: {e}")))?;
        Ok(())
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

    fn emit_event(
        app_handle: &Arc<std::sync::RwLock<Option<AppHandle>>>,
        active_session_id: &Arc<std::sync::RwLock<Option<String>>>,
        event: ServerEvent,
    ) {
        let handle = match app_handle.read().unwrap().as_ref() {
            Some(h) => h.clone(),
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
        if let Some(ref sid) = *active_session_id.read().unwrap() {
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("session_id".to_string(), serde_json::json!(sid));
            }
        }

        let _ = handle.emit("server-event", &payload);
    }
}
