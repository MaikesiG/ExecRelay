//! Terminal subsystem module for TraceRelay.
//!
//! Provides the typed protocol, shell discovery, in-memory session manager,
//! native PTY lifecycle operations, and Tauri IPC commands/event streaming.

pub mod commands;
pub mod manager;
pub mod session;
pub mod shell;
pub mod types;

#[cfg(all(test, unix))]
mod bash_integration_tests;
#[cfg(test)]
mod osc133_test_support;
#[cfg(test)]
mod powershell_integration_tests;
#[cfg(all(test, unix))]
mod runtime_tests;
#[cfg(all(test, windows))]
mod windows_runtime_tests;

pub use commands::{
    terminal_close_session, terminal_create_session, terminal_debug_trace, terminal_list_sessions,
    terminal_resize, terminal_session_info, terminal_write,
};
pub use manager::TerminalSessionManager;
