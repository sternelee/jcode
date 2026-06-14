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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_includes_variant_context() {
        let err = TauriError::SessionNotFound("foo".to_string());
        assert!(err.to_string().contains("foo"));
        assert!(err.to_string().starts_with("session not found"));
    }

    #[test]
    fn serializes_to_display_string() {
        let err = TauriError::InvalidInput("bad input".to_string());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"invalid input: bad input\"");
    }

    #[test]
    fn converts_from_string_and_str() {
        let from_string: TauriError = "hello".to_string().into();
        assert!(matches!(from_string, TauriError::Other(s) if s == "hello"));

        let from_str: TauriError = "world".into();
        assert!(matches!(from_str, TauriError::Other(s) if s == "world"));
    }

    #[test]
    fn io_error_converts_via_from() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "missing");
        let err: TauriError = io_err.into();
        assert!(matches!(err, TauriError::Io(_)));
        assert!(err.to_string().contains("missing"));
    }
}
