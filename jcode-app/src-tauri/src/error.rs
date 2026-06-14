use serde::{Serialize, Serializer};

/// Unified error type for the Tauri backend.
///
/// All command handlers return `Result<T, TauriError>` instead of ad-hoc
/// `String` errors. The type implements [`std::error::Error`], [`Display`],
/// and [`Serialize`]; Tauri serializes the display message to the frontend,
/// preserving the existing string-based contract while giving the Rust side
/// typed, composable errors.
#[derive(Debug, thiserror::Error)]
pub enum TauriError {
    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("session not found: {0}")]
    SessionNotFound(String),

    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("provider error: {0}")]
    Provider(String),

    #[error("auth error: {0}")]
    Auth(String),

    #[error("memory error: {0}")]
    Memory(String),

    #[error("launcher error: {0}")]
    Launcher(String),

    #[error("server client error: {0}")]
    ServerClient(String),

    #[error("permission denied: {0}")]
    PermissionDenied(String),

    #[error("{0}")]
    Other(String),
}

impl From<String> for TauriError {
    fn from(value: String) -> Self {
        Self::Other(value)
    }
}

/// Temporary bridge: lets legacy command handlers that still return
/// `Result<T, String>` use helpers that now return `Result<T, TauriError>`.
/// This impl will be removed once every handler is migrated.
impl From<TauriError> for String {
    fn from(value: TauriError) -> Self {
        value.to_string()
    }
}

impl From<&str> for TauriError {
    fn from(value: &str) -> Self {
        Self::Other(value.to_string())
    }
}

impl Serialize for TauriError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
