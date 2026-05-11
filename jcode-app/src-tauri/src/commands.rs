use jcode::agent::Agent;
use jcode::agent::InterruptSignal;
use jcode::provider::MultiProvider;
use jcode::session::Session;
use jcode::tool::Registry;
use jcode::tool::StdinInputRequest;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

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
    pub live_swarm_members: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    pub live_swarm_plans: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    pub live_swarm_proposals: Arc<Mutex<HashMap<String, serde_json::Value>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            runtimes: Arc::new(Mutex::new(HashMap::new())),
            active_session_id: Arc::new(Mutex::new(None)),
            pending_stdin: Arc::new(Mutex::new(std::collections::HashMap::new())),
            live_swarm_members: Arc::new(Mutex::new(HashMap::new())),
            live_swarm_plans: Arc::new(Mutex::new(HashMap::new())),
            live_swarm_proposals: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub async fn create_provider() -> Result<Arc<MultiProvider>, String> {
    let provider = MultiProvider::new();
    Ok(Arc::new(provider))
}

pub async fn create_agent(
    provider: Arc<MultiProvider>,
    working_dir: Option<&str>,
) -> Result<Agent, String> {
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
    provider: Arc<MultiProvider>,
    session: Session,
    working_dir: Option<&str>,
) -> Result<Agent, String> {
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
