//! Terminal session representation managing PTY handles and child process lifecycle.

use crate::error::{Result, TerminalError};
use crate::platform::terminal::{TerminalBackend, TerminalLifecycle};
use crate::terminal::shell::{IntegrationHandshake, ShellBootstrap, ShellConfig};
use crate::terminal::types::{ShellKind, TerminalSessionInfo, TerminalSessionStatus};
use portable_pty::PtySize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Initialization parameters for constructing a `TerminalSession`.
pub struct TerminalSessionParams {
    pub session_id: String,
    pub config: ShellConfig,
    pub cols: u16,
    pub rows: u16,
    pub cwd: Option<String>,
    pub integration_nonce: Option<String>,
    pub shell_integration_installed: bool,
    pub shell_bootstrap: Option<ShellBootstrap>,
    pub backend: TerminalBackend,
}

/// An active or terminated terminal session with dedicated PTY handles.
pub struct TerminalSession {
    pub session_id: String,
    pub shell: String,
    pub shell_kind: ShellKind,
    pub status: TerminalSessionStatus,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    pub exit_code: Option<i32>,
    pub integration_nonce: Option<String>,
    /// Trusted integration was set up for the launched shell (pending its handshake).
    pub shell_integration_installed: bool,
    /// Set by the output reader once the authenticated handshake is observed.
    integration_established: Arc<AtomicBool>,
    pub exit_guard: Arc<AtomicBool>,
    /// Held so an unread single-use bootstrap is removed with the session.
    _shell_bootstrap: Option<ShellBootstrap>,
    backend: TerminalBackend,
}

impl TerminalSession {
    /// Constructs a new `TerminalSession` from initialized PTY handles and configuration.
    pub fn new(params: TerminalSessionParams) -> Self {
        Self {
            session_id: params.session_id,
            shell: params.config.executable,
            shell_kind: params.config.shell_kind,
            status: TerminalSessionStatus::Running,
            cwd: params.cwd,
            cols: params.cols,
            rows: params.rows,
            exit_code: None,
            integration_nonce: params.integration_nonce,
            shell_integration_installed: params.shell_integration_installed,
            integration_established: Arc::new(AtomicBool::new(false)),
            exit_guard: Arc::new(AtomicBool::new(false)),
            _shell_bootstrap: params.shell_bootstrap,
            backend: params.backend,
        }
    }

    /// Returns a serializable summary of the session.
    pub fn info(&self) -> TerminalSessionInfo {
        let established = self.integration_established.load(Ordering::SeqCst);
        TerminalSessionInfo {
            session_id: self.session_id.clone(),
            shell: self.shell.clone(),
            shell_kind: self.shell_kind,
            status: self.status,
            cwd: self.cwd.clone(),
            cols: self.cols,
            rows: self.rows,
            exit_code: self.exit_code,
            integration_nonce: self.integration_nonce.clone(),
            shell_integration_available: self.shell_integration_installed && established,
            shell_integration_pending: self.shell_integration_installed && !established,
        }
    }

    /// Writes raw byte data to the PTY stdin without holding manager-level locks.
    pub fn write_bytes(&self, data: &[u8]) -> Result<()> {
        if self.status == TerminalSessionStatus::Exited {
            return Err(TerminalError::IoError(
                "cannot write to an exited terminal session".to_string(),
            ));
        }

        if data == [0x03] {
            self.backend.dispatch_interrupt().map(|_| ())
        } else {
            self.backend.write(data)
        }
    }

    /// Resizes the PTY window dimensions.
    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<()> {
        if cols == 0 || rows == 0 {
            return Err(TerminalError::InvalidDimensions { cols, rows });
        }

        self.backend.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        self.cols = cols;
        self.rows = rows;
        Ok(())
    }

    /// Obtains a cloned reader handle for reading PTY output on a background thread.
    pub fn try_clone_reader(&self) -> Result<Box<dyn std::io::Read + Send>> {
        self.backend.try_clone_reader()
    }

    /// Returns a handshake watcher for the output reader, if integration was installed.
    pub fn integration_handshake(&self) -> Option<IntegrationHandshake> {
        match (&self.integration_nonce, self.shell_integration_installed) {
            (Some(nonce), true) => Some(IntegrationHandshake::new(
                nonce,
                Arc::clone(&self.integration_established),
            )),
            _ => None,
        }
    }

    /// Returns a clone of the one-shot exit guard for this session.
    pub fn exit_guard(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.exit_guard)
    }

    /// Returns the shared platform lifecycle fact store for reader/wait coordination.
    pub fn lifecycle(&self) -> TerminalLifecycle {
        self.backend.lifecycle()
    }

    /// Requests child teardown; the backend waiter records the authoritative exit status.
    pub fn close(&mut self) -> Result<()> {
        self.status = TerminalSessionStatus::Exited;

        self.backend.request_teardown();
        Ok(())
    }
}
