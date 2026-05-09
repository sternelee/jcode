use jcode::agent::Agent;
use jcode::agent::InterruptSignal;
use jcode::provider::MultiProvider;
use jcode::session::Session;
use jcode::tool::Registry;
use jcode::tool::StdinInputRequest;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct AppState {
    pub agent: Arc<Mutex<Option<Agent>>>,
    pub cancel_signal: Arc<Mutex<Option<InterruptSignal>>>,
    pub model: Arc<Mutex<Option<String>>>,
    pub working_dir: Arc<Mutex<Option<String>>>,
    pub pending_stdin:
        Arc<Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<String>>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            agent: Arc::new(Mutex::new(None)),
            cancel_signal: Arc::new(Mutex::new(None)),
            model: Arc::new(Mutex::new(None)),
            working_dir: Arc::new(Mutex::new(None)),
            pending_stdin: Arc::new(Mutex::new(std::collections::HashMap::new())),
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
