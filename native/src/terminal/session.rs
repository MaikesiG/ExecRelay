//! Terminal session representation managing PTY handles and child process lifecycle.

use crate::error::{Result, TerminalError};
use crate::terminal::shell::ShellConfig;
use crate::terminal::types::{ShellKind, TerminalSessionInfo, TerminalSessionStatus};
use portable_pty::{Child, MasterPty, PtySize};
use std::io::Write;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

/// Initialization parameters for constructing a `TerminalSession`.
pub struct TerminalSessionParams {
    pub session_id: String,
    pub config: ShellConfig,
    pub cols: u16,
    pub rows: u16,
    pub cwd: Option<String>,
    pub integration_nonce: Option<String>,
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
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
    pub exit_guard: Arc<AtomicBool>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
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
            exit_guard: Arc::new(AtomicBool::new(false)),
            master: Arc::new(Mutex::new(params.master)),
            writer: Arc::new(Mutex::new(params.writer)),
            child: Arc::new(Mutex::new(params.child)),
        }
    }

    /// Returns a serializable summary of the session.
    pub fn info(&self) -> TerminalSessionInfo {
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
        }
    }

    /// Writes raw byte data to the PTY stdin without holding manager-level locks.
    pub fn write_bytes(&self, data: &[u8]) -> Result<()> {
        if self.status == TerminalSessionStatus::Exited {
            return Err(TerminalError::IoError(
                "cannot write to an exited terminal session".to_string(),
            ));
        }

        let mut writer = self
            .writer
            .lock()
            .map_err(|e| TerminalError::LockPoisoned(format!("failed to acquire writer lock: {e}")))?;

        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }

    /// Resizes the PTY window dimensions.
    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<()> {
        if cols == 0 || rows == 0 {
            return Err(TerminalError::InvalidDimensions { cols, rows });
        }

        let master = self
            .master
            .lock()
            .map_err(|e| TerminalError::LockPoisoned(format!("failed to acquire master lock: {e}")))?;

        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TerminalError::PtyError(e.to_string()))?;

        self.cols = cols;
        self.rows = rows;
        Ok(())
    }

    /// Obtains a cloned reader handle for reading PTY output on a background thread.
    pub fn try_clone_reader(&self) -> Result<Box<dyn std::io::Read + Send>> {
        let master = self
            .master
            .lock()
            .map_err(|e| TerminalError::LockPoisoned(format!("failed to acquire master lock: {e}")))?;

        master
            .try_clone_reader()
            .map_err(|e| TerminalError::PtyError(e.to_string()))
    }

    /// Returns a clone of the one-shot exit guard for this session.
    pub fn exit_guard(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.exit_guard)
    }

    /// Closes the session, terminates the child process, and records the exit status.
    pub fn close(&mut self) -> Result<()> {
        self.status = TerminalSessionStatus::Exited;

        if let Ok(mut child) = self.child.lock() {
            // Attempt termination; process might already be dead
            let _ = child.kill();
            if let Ok(Some(status)) = child.try_wait() {
                self.exit_code = Some(status.exit_code() as i32);
            }
        }

        Ok(())
    }
}
