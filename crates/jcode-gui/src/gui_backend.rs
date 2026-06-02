//! `GuiBackend` — boots the in-process `jcode-app-core::Server` and
//! exposes a `jcode_app_core::inproc_client::InprocClient` to the
//! Makepad main thread.
//!
//! Architecture
//! ============
//!
//! ```text
//!  ┌──────────────── jcode-gui process ────────────────┐
//!  │ main thread (Makepad event loop)                 │
//!  │   App { backend: Arc<GuiBackend>, ... }          │
//!  │   GUI_STATE  ◀──read by widgets in draw_walk     │
//!  │       ▲                                           │
//!  │       │   drain on every frame                    │
//!  │       │                                           │
//!  │   InprocClient.try_next_event()                   │
//!  │       │                                           │
//!  │       │   mpsc::UnboundedReceiver<ServerEvent>    │
//!  │       │                                           │
//!  │  worker thread (own tokio runtime)                │
//!  │   Server::new_with_paths(provider, sock, dbg)     │
//!  │   Server::run().await                             │
//!  │      ├─ background tasks (ambient, MCP, …)        │
//!  │      ├─ main + debug accept loops                 │
//!  │      └─ InprocClient's server-stream task         │
//!  │          (handle_client over the paired stream)   │
//!  └───────────────────────────────────────────────────┘
//! ```
//!
//! Socket paths are derived from a per-process tempdir, so multiple
//! `jcode-gui` instances never collide with each other or with a
//! system `jcode serve` running on the default socket.

use anyhow::{Context, Result};
use jcode_app_core::inproc_client::InprocClient;
use jcode_app_core::provider::Provider;
use jcode_app_core::server::Server;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use tokio::sync::Mutex;

/// Handle to the in-process server. Cheap to clone (it's just two
/// `Arc`s and a `JoinHandle`).
pub struct GuiBackend {
    /// Shared with the worker thread. Used only for diagnostics.
    pub server: Arc<Server>,
    /// The in-process client shared between the main thread (event
    /// drain) and the worker task (request sends). Wrapped in a
    /// `tokio::sync::Mutex` so both can take a `&mut` without
    /// fighting the borrow checker.
    pub client: Arc<Mutex<InprocClient>>,
    socket_path: PathBuf,
    debug_socket_path: PathBuf,
    worker: Option<JoinHandle<()>>,
    /// `true` once the worker thread has finished `Server::run` and
    /// cleaned up the sockets. The main thread's `try_next_event`
    /// will start returning `None`.
    stopped: Arc<AtomicBool>,
}

impl GuiBackend {
    /// Boot the in-process server. Returns once the worker thread
    /// is live; the main thread can then immediately use
    /// `self.client` to subscribe and fetch history.
    ///
    /// `provider` is the AI provider the server will use to drive
    /// models. The provider-selection logic lives in
    /// `crate::provider_init`.
    pub async fn start(provider: Arc<dyn Provider>) -> Result<Arc<Self>> {
        // Per-process tempdir for the GUI's server socket. We do *not*
        // touch `~/.jcode/...` here so the GUI never collides with a
        // running system `jcode serve` on the default socket path.
        let pid = std::process::id();
        let dir = std::env::temp_dir().join(format!("jcode-gui-{pid}"));
        std::fs::create_dir_all(&dir)
            .with_context(|| format!("failed to create GUI server tempdir {}", dir.display()))?;
        let socket_path = dir.join("jcode.sock");
        let debug_socket_path = dir.join("jcode-debug.sock");

        // Build the Server on the calling (main) thread so that we
        // can hold an Arc to it and hand it to both the worker and
        // the InprocClient. Server::new_with_paths only allocates
        // state; the bind happens later inside Server::run on the
        // worker.
        let server = Arc::new(Server::new_with_paths(
            provider,
            socket_path.clone(),
            debug_socket_path.clone(),
        ));

        // Build the InprocClient *before* the worker starts so the
        // first frame of the GUI can immediately subscribe and
        // request history. The handle_client task on the server
        // side starts as soon as we call InprocClient::start.
        let client = Arc::clone(&server)
            .inproc_client()
            .context("failed to start in-process server client")?;
        let client = Arc::new(Mutex::new(client));

        // Hand the server Arc to the worker. The worker owns the
        // tokio runtime and calls Server::run, which blocks on
        // tokio::join!(main_handle, debug_handle) and only returns
        // when the GUI shuts down.
        let server_for_worker = Arc::clone(&server);
        let socket_path_worker = socket_path.clone();
        let debug_socket_path_worker = debug_socket_path.clone();
        let stopped = Arc::new(AtomicBool::new(false));
        let stopped_for_worker = Arc::clone(&stopped);
        let worker = std::thread::Builder::new()
            .name("jcode-gui-server".to_string())
            .spawn(move || {
                let rt = match tokio::runtime::Builder::new_multi_thread()
                    .worker_threads(2)
                    .enable_all()
                    .build()
                {
                    Ok(rt) => rt,
                    Err(e) => {
                        eprintln!("jcode-gui: failed to build server runtime: {e}");
                        return;
                    }
                };
                rt.block_on(async move {
                    if let Err(e) = server_for_worker.run().await {
                        jcode_app_core::logging::error(&format!(
                            "jcode-gui: server run failed: {e}"
                        ));
                    }
                    // Cleanup so the tempdir is reusable on next
                    // start. Server::run removes sockets on graceful
                    // shutdown, but force-remove here too in case
                    // the run path bailed early.
                    remove_socket_quietly(&socket_path_worker);
                    remove_socket_quietly(&debug_socket_path_worker);
                    stopped_for_worker.store(true, Ordering::Release);
                });
            })
            .context("failed to spawn jcode-gui server worker thread")?;

        // We do not block on any "ready" handshake: the InprocClient
        // is fully usable as soon as the worker exists. Server::run
        // failure shows up as `is_stopped()` flipping to true after
        // the tokio runtime reports the bind error.
        Ok(Arc::new(Self {
            server,
            client,
            socket_path,
            debug_socket_path,
            worker: Some(worker),
            stopped,
        }))
    }

    /// Drain all pending server events and hand them to
    /// `apply_event`. Returns `true` if at least one event was
    /// delivered, `false` if the queue was empty. The Makepad main
    /// loop calls this every frame.
    ///
    /// Uses `try_lock` on the shared `Mutex` so the call returns
    /// immediately when the worker is mid-send; missed events are
    /// picked up on the next frame.
    pub fn poll<F>(&self, mut apply_event: F) -> bool
    where
        F: FnMut(&jcode_app_core::protocol::ServerEvent),
    {
        let Ok(mut client) = self.client.try_lock() else {
            // Worker is mid-send. Skip this frame; the worker will
            // be done in a few µs and the next frame picks up
            // everything.
            return false;
        };
        let mut got_any = false;
        while let Some(ev) = client.try_next_event() {
            got_any = true;
            apply_event(&ev);
        }
        got_any
    }

    /// Has the worker thread exited?
    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::Acquire)
    }

    /// Stop the server: drop the InprocClient (which closes its
    /// end of the paired stream, causing `handle_client` to exit)
    /// and join the worker thread. The tempdir is removed by the
    /// worker before it returns.
    pub fn stop(mut self: Arc<Self>) -> Result<()> {
        // Replace the live client with a no-op one; this drops the
        // writer and sends EOF to the server-side read task in
        // handle_client, which then returns.
        if let Some(state) = Arc::get_mut(&mut self) {
            *state.client.try_lock().expect("client is in use") =
                InprocClient::empty_for_shutdown();
            if let Some(worker) = state.worker.take() {
                let _ = worker.join();
            }
        } else {
            // Not uniquely held — fall back to just dropping the
            // InprocClient and joining the worker without the
            // shutdown handshake. The worker is the only other
            // holder and will exit when the GUI closes.
            if let Some(worker) = Arc::get_mut(&mut self).and_then(|s| s.worker.take()) {
                let _ = worker.join();
            }
        }
        // Best-effort cleanup of the per-process tempdir.
        if let Some(parent) = self.socket_path.parent() {
            let _ = std::fs::remove_dir_all(parent);
        }
        Ok(())
    }

    /// Where the GUI's server is listening on disk. Mainly for
    /// diagnostics / debug menus.
    pub fn socket_path(&self) -> &std::path::Path {
        &self.socket_path
    }

    pub fn debug_socket_path(&self) -> &std::path::Path {
        &self.debug_socket_path
    }
}

/// Best-effort remove of a socket file. Silently swallows errors — we
/// only call this on shutdown where a failure to unlink is a soft
/// "the next start will deal with it" condition, not a real error.
fn remove_socket_quietly(path: &Path) {
    let _ = std::fs::remove_file(path);
}
