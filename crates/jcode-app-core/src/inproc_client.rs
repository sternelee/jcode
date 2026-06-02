//! In-process client for `jcode-app-core::Server`.
//!
//! `InprocClient` is a lightweight client that talks to a `Server` *in the
//! same process*, with no Unix-socket hop. It uses `transport::stream_pair()`
//! to obtain a paired `Stream`: one half is fed to the server-side
//! `handle_client` loop, the other half is held by the GUI and speaks the
//! same newline-delimited JSON line protocol that `Client` does.
//!
//! Internally, a dedicated tokio task drains the client-side stream and
//! forwards decoded `ServerEvent`s to an `mpsc::UnboundedReceiver<ServerEvent>`,
//! which the GUI polls on its main thread. This keeps the read side
//! non-blocking — the GUI's frame loop calls `try_next_event` and gets
//! `None` when no events are pending.
//!
//! Construction: see [`Server::inproc_client`].

use super::server::Server;
use crate::protocol::{Request, ServerEvent};
use crate::transport::{WriteHalf, stream_pair};
use anyhow::Result;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

/// In-process client for the server running in this same process.
///
/// `InprocClient` is `Send` but not `Sync` — keep one per UI surface and
/// drive it from a single task (e.g. the Makepad main thread).
pub struct InprocClient {
    writer: WriteHalf,
    next_id: u64,
    event_rx: mpsc::UnboundedReceiver<ServerEvent>,
    /// Set when the read-side task has terminated (server stream closed
    /// or panicked). The GUI can show this as a banner.
    read_task_exited: bool,
}

impl InprocClient {
    /// Spin up an in-process client for `server`. The server-side half of
    /// the paired stream is dispatched to `handle_client` on the same
    /// tokio runtime that owns the server. A second task drains the
    /// client-side stream and pumps decoded events into an mpsc the GUI
    /// can poll.
    pub fn start(server: &Arc<Server>) -> Result<Self> {
        let (server_stream, client_stream) = stream_pair()
            .map_err(|e| anyhow::anyhow!("failed to create in-process stream pair: {e}"))?;
        let runtime = server.runtime_handle();
        tokio::spawn(async move {
            runtime
                .run_client_stream(server_stream, "Inproc client error", false)
                .await;
        });
        let (reader, writer) = client_stream.into_split();
        let reader = BufReader::new(reader);

        // Spawn a task that owns the reader. It decodes newline-delimited
        // JSON `ServerEvent`s and forwards them to the mpsc receiver the
        // GUI holds. When the server stream closes (EOF), the task ends
        // and the receiver naturally drains.
        let (tx, rx) = mpsc::unbounded_channel::<ServerEvent>();
        tokio::spawn(async move {
            let mut lines = reader.lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        let trimmed = line.trim_end();
                        if trimmed.is_empty() {
                            continue;
                        }
                        match serde_json::from_str::<ServerEvent>(trimmed) {
                            Ok(ev) => {
                                if tx.send(ev).is_err() {
                                    // Receiver dropped — GUI went away.
                                    break;
                                }
                            }
                            Err(err) => {
                                crate::logging::warn(&format!(
                                    "InprocClient: failed to decode ServerEvent: {err}"
                                ));
                            }
                        }
                    }
                    Ok(None) => break, // EOF
                    Err(err) => {
                        crate::logging::warn(&format!(
                            "InprocClient: read error from server stream: {err}"
                        ));
                        break;
                    }
                }
            }
        });

        Ok(Self {
            writer,
            next_id: 1,
            event_rx: rx,
            read_task_exited: false,
        })
    }

    /// Construct a no-op `InprocClient` whose only purpose is to be
    /// dropped on shutdown. The writer is `None`; calls to `submit`
    /// or any of the request helpers will fail with a clear error
    /// instead of panicking.
    ///
    /// Used by the GUI to take ownership of the live `InprocClient`
    /// out of `GuiBackend` when stopping — the writer half is the
    /// only thing keeping the server-side `handle_client` task
    /// alive, so dropping it cleanly signals EOF to the server.
    pub fn empty_for_shutdown() -> Self {
        let (_tx, rx) = mpsc::unbounded_channel::<ServerEvent>();
        // The writer is unreachable from the public API after this
        // point; mark the read-side as already-exited so any
        // subsequent `try_next_event` is a no-op.
        Self {
            writer: dummy_writer(),
            next_id: 1,
            event_rx: rx,
            read_task_exited: true,
        }
    }
    /// Allocate the next request id.
    pub fn next_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// Submit a fully-built `Request` to the server. Returns once the
    /// bytes are flushed to the server-side half of the paired stream.
    /// The caller is responsible for correlating the request id (which
    /// lives inside the `Request` value) with subsequent
    /// `ServerEvent::Ack` / `ServerEvent::Done` / `ServerEvent::Error`
    /// events delivered by `next_event` / `try_next_event`.
    pub async fn submit(&mut self, request: Request) -> Result<()> {
        if self.read_task_exited {
            anyhow::bail!("InprocClient: server stream is closed");
        }
        let json = serde_json::to_string(&request)? + "\n";
        self.writer.write_all(json.as_bytes()).await?;
        Ok(())
    }

    /// Block until the next server event arrives. Prefer `try_next_event`
    /// in any UI loop; this one is for tests and one-shot fetchers.
    pub async fn next_event(&mut self) -> Result<ServerEvent> {
        self.event_rx
            .recv()
            .await
            .ok_or_else(|| anyhow::anyhow!("InprocClient: server stream closed"))
    }

    /// Non-blocking poll. Returns the next queued event, or `None` if
    /// none is ready. The Makepad frame loop calls this every frame.
    pub fn try_next_event(&mut self) -> Option<ServerEvent> {
        match self.event_rx.try_recv() {
            Ok(ev) => Some(ev),
            Err(mpsc::error::TryRecvError::Empty) => None,
            Err(mpsc::error::TryRecvError::Disconnected) => {
                self.read_task_exited = true;
                None
            }
        }
    }

    /// True once the read-side task has terminated (server disconnected
    /// or the server-side `handle_client` returned).
    pub fn is_disconnected(&self) -> bool {
        self.read_task_exited
    }

    // ── Convenience wrappers that mirror Client::* ─────────────────────
    //
    // Each wrapper mints a fresh id via `next_id()` and embeds it into
    // the `Request`, then returns it so the caller can correlate the
    // response events. The full list is kept short on purpose — only
    // the requests the GUI actually fires. Add more as the UI grows.

    /// Send a `Message` request; returns the request id.
    pub async fn send_message(&mut self, content: &str) -> Result<u64> {
        let id = self.next_id();
        self.submit(Request::Message {
            id,
            content: content.to_string(),
            images: vec![],
            system_reminder: None,
        })
        .await?;
        Ok(id)
    }

    /// Subscribe to live events. Returns the request id; the resulting
    /// events come back through `next_event` / `try_next_event`.
    pub async fn subscribe(&mut self) -> Result<u64> {
        self.subscribe_with_options(None, None, None, false, false).await
    }

    pub async fn subscribe_with_options(
        &mut self,
        working_dir: Option<String>,
        selfdev: Option<bool>,
        target_session_id: Option<String>,
        client_has_local_history: bool,
        allow_session_takeover: bool,
    ) -> Result<u64> {
        let id = self.next_id();
        self.submit(Request::Subscribe {
            id,
            working_dir,
            selfdev,
            target_session_id,
            client_instance_id: None,
            client_has_local_history,
            allow_session_takeover,
        })
        .await?;
        Ok(id)
    }

    /// Request the current conversation history. Returns the `History`
    /// server event (skipping any `Ack` frames in between).
    pub async fn get_history_event(&mut self) -> Result<ServerEvent> {
        let id = self.next_id();
        self.submit(Request::GetHistory { id }).await?;
        for _ in 0..64 {
            let ev = self.next_event().await?;
            if matches!(ev, ServerEvent::Ack { .. }) {
                continue;
            }
            return Ok(ev);
        }
        anyhow::bail!("InprocClient: GetHistory response not received");
    }

    /// Resume a session by id; the next `History` event will populate
    /// the UI.
    pub async fn resume_session_with_options(
        &mut self,
        session_id: &str,
        client_has_local_history: bool,
        allow_session_takeover: bool,
    ) -> Result<u64> {
        let id = self.next_id();
        self.submit(Request::ResumeSession {
            id,
            session_id: session_id.to_string(),
            client_instance_id: None,
            client_has_local_history,
            allow_session_takeover,
        })
        .await?;
        Ok(id)
    }

    /// `Clear` the current conversation history.
    pub async fn clear(&mut self) -> Result<u64> {
        let id = self.next_id();
        self.submit(Request::Clear { id }).await?;
        Ok(id)
    }

    /// Cancel the in-flight `Message` request with the given id.
    pub async fn cancel(&mut self, id: u64) -> Result<u64> {
        self.submit(Request::Cancel { id }).await?;
        Ok(id)
    }

    /// Inject a soft interrupt.
    pub async fn soft_interrupt(&mut self, content: &str, urgent: bool) -> Result<u64> {
        let id = self.next_id();
        self.submit(Request::SoftInterrupt {
            id,
            content: content.to_string(),
            urgent,
        })
        .await?;
        Ok(id)
    }

    /// Switch to `model` (a model id known to the active provider).
    pub async fn set_model(&mut self, model: &str) -> Result<u64> {
        let id = self.next_id();
        self.submit(Request::SetModel {
            id,
            model: model.to_string(),
        })
        .await?;
        Ok(id)
    }

    /// Cycle to the next/previous model in the provider's catalogue.
    pub async fn cycle_model(&mut self, direction: i8) -> Result<u64> {
        let id = self.next_id();
        self.submit(Request::CycleModel { id, direction }).await?;
        Ok(id)
    }

    /// Ask the server to refresh its model catalogue.
    pub async fn refresh_models(&mut self) -> Result<u64> {
        let id = self.next_id();
        self.submit(Request::RefreshModels { id }).await?;
        Ok(id)
    }

    /// Notify the server that authentication state changed (e.g. after
    /// `/login` or `/logout`).
    pub async fn notify_auth_changed(&mut self) -> Result<u64> {
        let id = self.next_id();
        self.submit(Request::NotifyAuthChanged {
            id,
            provider: None,
            auth: None,
        })
        .await?;
        Ok(id)
    }

    /// Force-reload the server (exec-based self-reload).
    pub async fn reload(&mut self) -> Result<u64> {
        let id = self.next_id();
        self.submit(Request::Reload { id, force: true }).await?;
        Ok(id)
    }
}

impl Server {
    /// Construct an in-process client. The server-side half of the paired
    /// stream is fed to the standard `handle_client` loop. Use this in
    /// product surfaces that embed the server in-process (e.g.
    /// `jcode-gui`); remote TUI clients should keep using
    /// `Client::connect` over a Unix socket.
    pub fn inproc_client(self: &Arc<Self>) -> Result<InprocClient> {
        InprocClient::start(self)
    }
}

/// Build a `WriteHalf` we can keep as a placeholder but never write
/// to. We construct a real paired stream and immediately drop the
/// read end — the write end stays usable (it just sends to a sink
/// nobody reads from). `submit` short-circuits before reaching it
/// when `read_task_exited` is set, so the dummy is never written to
/// in normal shutdown paths.
fn dummy_writer() -> WriteHalf {
    let (_reader, writer) = stream_pair()
        .expect("failed to create in-process stream pair for dummy writer")
        .1
        .into_split();
    writer
}
