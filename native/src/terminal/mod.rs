//! Terminal subsystem module for TraceRelay.
//!
//! Provides the typed protocol, shell discovery, in-memory session manager,
//! native PTY lifecycle operations, and Tauri IPC commands/event streaming.

pub mod commands;
pub mod manager;
pub mod session;
pub mod shell;
pub mod types;

pub use commands::{
    terminal_close_session, terminal_create_session, terminal_list_sessions, terminal_resize,
    terminal_session_info, terminal_write,
};
pub use manager::TerminalSessionManager;
