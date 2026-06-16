use jcode::agent::Agent;
use jcode::agent::InterruptSignal;
use jcode::provider::MultiProvider;
use jcode::provider::Provider;
use jcode::session::Session;
use jcode::tool::Registry;
use jcode::tool::StdinInputRequest;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

use crate::error::TauriError;
use crate::launcher::AppIndex;
use crate::server_client::ServerClient;
pub mod config;
pub mod env;
pub mod launcher;
pub mod memory;
pub mod provider;
pub mod session;
pub mod swarm;
pub mod system;
pub mod tools;

/// Shared cache of currently-running macOS app bundle IDs. Kept in a
/// plain `std::sync::Mutex` because it's only ever written from a
/// dedicated background thread (see `launcher::spawn_running_apps_loop`)
/// and read briefly from the async command handlers.
pub type RunningAppsCache = Arc<std::sync::Mutex<std::collections::HashSet<String>>>;

/// Typed representation of a swarm member's live status,
/// replacing the raw serde_json::Value HashMap.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwarmMemberStatus {
    pub session_id: String,
    pub status: String,
    pub detail: Option<String>,
    pub role: Option<String>,
    pub peer_count: usize,
}

/// Typed representation of a swarm plan snapshot,
/// replacing the raw serde_json::Value HashMap.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwarmPlanSnapshot {
    pub swarm_id: String,
    pub version: u64,
    pub items: Vec<serde_json::Value>,
    pub participants: Vec<String>,
    pub reason: Option<String>,
    pub ready_count: usize,
    pub active_count: usize,
    pub blocked_count: usize,
    pub completed_count: usize,
    pub next_ready_ids: Vec<String>,
    pub preview_items: Vec<serde_json::Value>,
}

/// Typed representation of a swarm plan proposal,
/// replacing the raw serde_json::Value HashMap.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwarmProposalSnapshot {
    pub swarm_id: String,
    pub proposer_session: String,
    pub proposer_name: Option<String>,
    pub summary: String,
    pub proposal_key: String,
    pub items: Vec<serde_json::Value>,
}

/// Swarm state container with typed data and consistency guarantees.
/// Replaces three independent HashMap<String, serde_json::Value> fields.
pub struct SwarmState {
    /// session_id -> member status
    pub members: HashMap<String, SwarmMemberStatus>,
    /// session_id -> plan snapshot (written for all participants)
    pub plans: HashMap<String, SwarmPlanSnapshot>,
    /// session_id -> proposal snapshot
    pub proposals: HashMap<String, SwarmProposalSnapshot>,
}

impl Default for SwarmState {
    fn default() -> Self {
        Self::new()
    }
}
impl SwarmState {
    pub fn new() -> Self {
        Self {
            members: HashMap::new(),
            plans: HashMap::new(),
            proposals: HashMap::new(),
        }
    }

    /// Insert a plan for all participating sessions.
    /// Also removes any stale proposals for those sessions.
    pub fn apply_plan(&mut self, plan: SwarmPlanSnapshot) {
        for participant_id in &plan.participants {
            self.proposals.remove(participant_id);
            self.plans.insert(participant_id.clone(), plan.clone());
        }
    }

    /// Insert a proposal (scoped to a single session).
    pub fn apply_proposal(&mut self, session_id: String, proposal: SwarmProposalSnapshot) {
        self.proposals.insert(session_id, proposal);
    }

    /// Upsert member statuses from a SwarmStatus event.
    pub fn apply_status(&mut self, members: Vec<SwarmMemberStatus>) {
        for member in members {
            self.members.insert(member.session_id.clone(), member);
        }
    }

    /// Remove all state for a session that is shutting down.
    pub fn remove_session(&mut self, session_id: &str) {
        self.members.remove(session_id);
        self.plans.remove(session_id);
        self.proposals.remove(session_id);
    }
}
pub struct SessionRuntime {
    pub session_id: String,
    pub ordinal: u64,
    pub created_at: Instant,
    pub agent: Arc<Mutex<Agent>>,
    pub cancel_signal: InterruptSignal,
    pub is_processing: Arc<Mutex<bool>>,
    pub current_tool_name: Arc<Mutex<Option<String>>>,
    pub connection_phase: Arc<Mutex<Option<String>>>,
    pub status_detail: Arc<Mutex<Option<String>>>,
}

static NEXT_RUNTIME_ORDINAL: AtomicU64 = AtomicU64::new(1);

impl SessionRuntime {
    pub fn new(session_id: String, agent: Agent, cancel_signal: InterruptSignal) -> Self {
        Self {
            session_id,
            ordinal: NEXT_RUNTIME_ORDINAL.fetch_add(1, Ordering::Relaxed),
            created_at: Instant::now(),
            agent: Arc::new(Mutex::new(agent)),
            cancel_signal,
            is_processing: Arc::new(Mutex::new(false)),
            current_tool_name: Arc::new(Mutex::new(None)),
            connection_phase: Arc::new(Mutex::new(Some("connected".to_string()))),
            status_detail: Arc::new(Mutex::new(None)),
        }
    }
}

pub struct AppState {
    pub runtimes: Arc<Mutex<HashMap<String, Arc<SessionRuntime>>>>,
    pub active_session_id: Arc<Mutex<Option<String>>>,
    pub pending_stdin:
        Arc<Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<String>>>>,
    pub swarm: Arc<Mutex<SwarmState>>,
    /// Cached MultiProvider to avoid re-creating on every begin_session.
    /// Initialized lazily on first use; shared via Arc so cloning is cheap.
    /// Call `clear_provider()` after provider config changes to force refresh.
    pub provider: tokio::sync::RwLock<Option<Arc<MultiProvider>>>,
    /// Optional server socket client for server-backed mode.
    /// Wrapped in std::sync::Mutex so it can be set after AppState is managed.
    pub server_client: Arc<std::sync::Mutex<Option<Arc<crate::server_client::ServerClient>>>>,
    /// Session IDs that are managed by the jcode server (not local agents).
    pub server_managed_sessions: Arc<Mutex<HashSet<String>>>,
    /// Application index for launcher search.
    pub app_index: Arc<Mutex<AppIndex>>,
    /// Bundle IDs of currently-running macOS applications, refreshed in
    /// the background by `launcher::spawn_running_apps_loop`. The launcher
    /// joins this set with `app_index` to mark each result as running.
    pub running_apps: RunningAppsCache,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            runtimes: Arc::new(Mutex::new(HashMap::new())),
            active_session_id: Arc::new(Mutex::new(None)),
            pending_stdin: Arc::new(Mutex::new(std::collections::HashMap::new())),
            swarm: Arc::new(Mutex::new(SwarmState::new())),
            provider: tokio::sync::RwLock::new(None),
            server_client: Arc::new(std::sync::Mutex::new(None)),
            server_managed_sessions: Arc::new(Mutex::new(HashSet::new())),
            app_index: Arc::new(Mutex::new(AppIndex::default())),
            running_apps: Arc::new(std::sync::Mutex::new(std::collections::HashSet::new())),
        }
    }

    pub async fn get_provider(&self) -> Result<Arc<MultiProvider>, TauriError> {
        {
            let guard = self.provider.read().await;
            if let Some(ref p) = *guard {
                return Ok(p.clone());
            }
        }
        let mut guard = self.provider.write().await;
        if let Some(ref p) = *guard {
            return Ok(p.clone());
        }
        let provider = MultiProvider::new();
        let arc = Arc::new(provider);
        *guard = Some(arc.clone());
        Ok(arc)
    }

    pub async fn clear_provider(&self) {
        let mut guard = self.provider.write().await;
        *guard = None;
    }
}

pub async fn create_provider() -> Result<Arc<MultiProvider>, TauriError> {
    let provider = MultiProvider::new();
    Ok(Arc::new(provider))
}

pub async fn create_agent(
    provider: Arc<dyn Provider>,
    working_dir: Option<&str>,
) -> Result<Agent, TauriError> {
    let registry = Registry::new(provider.clone()).await;
    registry
        .register_mcp_tools(None, None, Some("tauri-desktop".to_string()))
        .await;
    let mut agent = Agent::new(provider, registry);
    if let Some(dir) = working_dir {
        agent.set_working_dir(dir);
    }
    Ok(agent)
}

pub async fn create_agent_with_session(
    provider: Arc<dyn Provider>,
    session: Session,
    working_dir: Option<&str>,
) -> Result<Agent, TauriError> {
    let registry = Registry::new(provider.clone()).await;
    registry
        .register_mcp_tools(None, None, Some(session.id.clone()))
        .await;
    let mut agent = Agent::new_with_session(provider, registry, session, None);
    let dir = working_dir
        .map(|d| d.to_string())
        .or_else(|| agent.working_dir().map(|s| s.to_string()));
    if let Some(dir) = dir {
        agent.set_working_dir(&dir);
    }
    Ok(agent)
}

pub fn setup_stdin_channel(
    agent: &mut Agent,
) -> (
    tokio::sync::mpsc::UnboundedSender<StdinInputRequest>,
    tokio::sync::mpsc::UnboundedReceiver<StdinInputRequest>,
) {
    let (stdin_tx, stdin_rx) = tokio::sync::mpsc::unbounded_channel();
    agent.set_stdin_request_tx(stdin_tx.clone());
    (stdin_tx, stdin_rx)
}
/// Get the shared server client from app state, if initialized.
pub fn get_server_client(state: &tauri::State<'_, AppState>) -> Result<Arc<ServerClient>, String> {
    let guard = state.server_client.lock().map_err(|e| e.to_string())?;
    guard
        .clone()
        .ok_or_else(|| "Server client not initialized".to_string())
}
