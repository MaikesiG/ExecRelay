//! Error types for the TraceRelay native core and terminal runtime.

use std::fmt;

/// Typed errors produced by terminal operations, session management, and IPC.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum TerminalError {
    /// The specified session ID does not exist in the session manager.
    SessionNotFound(String),

    /// A PTY allocation, configuration, or resize operation failed.
    PtyError(String),

    /// An I/O error occurred during writing to or reading from the PTY.
    IoError(String),

    /// Invalid terminal dimensions were provided (e.g. 0 columns or 0 rows).
    InvalidDimensions { cols: u16, rows: u16 },

    /// Failed to locate or spawn the requested shell executable.
    SpawnFailed(String),

    /// The terminal write payload was empty.
    EmptyPayload,

    /// The terminal write payload exceeded the hard maximum size limit.
    PayloadTooLarge { size: usize, max: usize },

    /// The requested working directory does not exist or is not a directory.
    InvalidDirectory(String),

    /// An internal synchronization lock was poisoned.
    LockPoisoned(String),

    /// Failed to initialize the dedicated output reader thread.
    ReaderSetupFailed(String),

    /// A collector command was rejected for security policy reasons.
    SecurityPolicyViolation(String),

    /// A collector process execution failed.
    CollectorExecutionFailed(String),
}

impl fmt::Display for TerminalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SessionNotFound(id) => write!(f, "terminal session not found: {id}"),
            Self::PtyError(msg) => write!(f, "PTY error: {msg}"),
            Self::IoError(msg) => write!(f, "I/O error: {msg}"),
            Self::InvalidDimensions { cols, rows } => {
                write!(f, "invalid terminal dimensions: cols={cols}, rows={rows}")
            }
            Self::SpawnFailed(msg) => write!(f, "failed to spawn shell process: {msg}"),
            Self::EmptyPayload => write!(f, "terminal write payload cannot be empty"),
            Self::PayloadTooLarge { size, max } => {
                write!(
                    f,
                    "terminal write payload size ({size} bytes) exceeds maximum limit of {max} bytes"
                )
            }
            Self::InvalidDirectory(dir) => write!(f, "invalid working directory: {dir}"),
            Self::LockPoisoned(lock) => write!(f, "synchronization lock poisoned: {lock}"),
            Self::ReaderSetupFailed(msg) => write!(f, "failed to initialize output reader: {msg}"),
            Self::SecurityPolicyViolation(msg) => write!(f, "security policy violation: {msg}"),
            Self::CollectorExecutionFailed(msg) => write!(f, "collector execution failed: {msg}"),
        }
    }
}

impl std::error::Error for TerminalError {}

impl From<std::io::Error> for TerminalError {
    fn from(err: std::io::Error) -> Self {
        Self::IoError(err.to_string())
    }
}

#[cfg(test)]
impl TerminalError {
    /// Returns a stable machine-readable error code for IPC error reporting.
    pub fn error_code(&self) -> &'static str {
        match self {
            Self::SessionNotFound(_) => "SESSION_NOT_FOUND",
            Self::PtyError(_) => "PTY_ERROR",
            Self::IoError(_) => "IO_ERROR",
            Self::InvalidDimensions { .. } => "INVALID_DIMENSIONS",
            Self::SpawnFailed(_) => "SPAWN_FAILED",
            Self::EmptyPayload => "EMPTY_PAYLOAD",
            Self::PayloadTooLarge { .. } => "PAYLOAD_TOO_LARGE",
            Self::InvalidDirectory(_) => "INVALID_DIRECTORY",
            Self::LockPoisoned(_) => "LOCK_POISONED",
            Self::ReaderSetupFailed(_) => "READER_SETUP_FAILED",
            Self::SecurityPolicyViolation(_) => "SECURITY_POLICY_VIOLATION",
            Self::CollectorExecutionFailed(_) => "COLLECTOR_EXECUTION_FAILED",
        }
    }
}

pub type Result<T> = std::result::Result<T, TerminalError>;
