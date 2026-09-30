//! In-memory multi-session manager for TraceRelay terminal PTYs.
//!
//! # Thread Safety and Lock Boundaries
//! To guarantee responsive terminal I/O and avoid UI deadlock:
//! 1. The manager holds an `RwLock<HashMap<String, Arc<Mutex<TerminalSession>>>>`.
//! 2. PTY writing (`write_bytes`) acquires a short read-lock to clone the session `Arc`,
//!    immediately releases the manager map lock, and then acquires the per-session
//!    writer lock. It NEVER holds the manager lock during blocking I/O writes.
//! 3. Output reading operates on dedicated threads via cloned PTY reader handles.
//! 4. Closing a session atomically removes it from the manager before attempting
//!    child process termination, guaranteeing state cleanup even on partial failure.

use crate::error::{Result, TerminalError};
use crate::terminal::session::{TerminalSession, TerminalSessionParams};
use crate::terminal::shell::{build_command, resolve_shell};
use crate::terminal::types::{
    CloseTerminalSessionInput, CreateTerminalSessionInput, ResizeTerminalInput,
    TerminalSessionInfo,
};
use portable_pty::{native_pty_system, PtySize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, RwLock};
use uuid::Uuid;

/// Default terminal window dimensions when not specified.
pub const DEFAULT_COLS: u16 = 80;
pub const DEFAULT_ROWS: u16 = 24;

/// Supervises all active and in-memory terminal sessions.
#[derive(Clone)]
pub struct TerminalSessionManager {
    sessions: Arc<RwLock<HashMap<String, Arc<Mutex<TerminalSession>>>>>,
}

impl Default for TerminalSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalSessionManager {
    /// Creates a new empty `TerminalSessionManager`.
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Spawns a new PTY session and registers it in memory.
    pub fn create_session(
        &self,
        input: CreateTerminalSessionInput,
    ) -> Result<TerminalSessionInfo> {
        let cols = input.cols.unwrap_or(DEFAULT_COLS);
        let rows = input.rows.unwrap_or(DEFAULT_ROWS);

        if cols == 0 || rows == 0 {
            return Err(TerminalError::InvalidDimensions { cols, rows });
        }

        // Validate working directory if specified
        if let Some(ref dir) = input.cwd {
            let p = Path::new(dir);
            if !p.is_dir() {
                return Err(TerminalError::InvalidDirectory(dir.clone()));
            }
        }

        let shell_config = resolve_shell(input.shell_kind);
        let nonce = input
            .integration_nonce
            .or_else(|| Some(Uuid::new_v4().to_string()));
        let cmd = build_command(&shell_config, input.cwd.as_deref(), nonce.as_deref());

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TerminalError::PtyError(e.to_string()))?;

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| TerminalError::SpawnFailed(e.to_string()))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| TerminalError::PtyError(e.to_string()))?;

        let session_id = Uuid::new_v4().to_string();

        let session = TerminalSession::new(TerminalSessionParams {
            session_id: session_id.clone(),
            config: shell_config,
            cols,
            rows,
            cwd: input.cwd,
            integration_nonce: nonce,
            master: pair.master,
            writer,
            child,
        });

        let info = session.info();

        // Lock boundary: acquire map write lock strictly for insertion
        {
            let mut map = self
                .sessions
                .write()
                .map_err(|e| TerminalError::LockPoisoned(format!("sessions write lock: {e}")))?;
            map.insert(session_id, Arc::new(Mutex::new(session)));
        }

        Ok(info)
    }

    /// Writes raw byte slice to a session's PTY stdin.
    ///
    /// The manager lock is dropped before acquiring the session lock or performing I/O.
    pub fn write_bytes(&self, session_id: &str, data: &[u8]) -> Result<()> {
        let session = self.get_session_arc(session_id)?;
        let session = session
            .lock()
            .map_err(|e| TerminalError::LockPoisoned(format!("session lock error: {e}")))?;

        session.write_bytes(data)
    }

    /// Resizes a session's PTY window.
    pub fn resize(&self, input: ResizeTerminalInput) -> Result<()> {
        if input.cols == 0 || input.rows == 0 {
            return Err(TerminalError::InvalidDimensions {
                cols: input.cols,
                rows: input.rows,
            });
        }

        let session = self.get_session_arc(&input.session_id)?;
        let mut session = session
            .lock()
            .map_err(|e| TerminalError::LockPoisoned(format!("session lock error: {e}")))?;

        session.resize(input.cols, input.rows)
    }

    /// Closes a session, terminates its child process, and removes it from the manager.
    ///
    /// Returns the reaped exit code and the session's one-shot exit guard. Even if process
    /// termination fails or errors, the session is reliably removed from manager state.
    pub fn close_session(&self, session_id: &str) -> Result<(Option<i32>, Arc<AtomicBool>)> {
        let session_arc = {
            let mut map = self
                .sessions
                .write()
                .map_err(|e| TerminalError::LockPoisoned(format!("sessions write lock: {e}")))?;
            map.remove(session_id)
                .ok_or_else(|| TerminalError::SessionNotFound(session_id.to_string()))?
        };

        let mut session = session_arc
            .lock()
            .map_err(|e| TerminalError::LockPoisoned(format!("session lock error: {e}")))?;

        session.close()?;
        Ok((session.exit_code, session.exit_guard()))
    }

    /// Closes a session according to the typed input contract.
    pub fn close(&self, input: CloseTerminalSessionInput) -> Result<()> {
        self.close_session(&input.session_id).map(|_| ())
    }

    /// Closes all managed sessions in a best-effort manner during application shutdown.
    pub fn close_all_sessions(&self) {
        let session_ids: Vec<String> = match self.sessions.read() {
            Ok(map) => map.keys().cloned().collect(),
            Err(_) => return,
        };

        for id in session_ids {
            let _ = self.close_session(&id);
        }
    }

    /// Clones the output reader handle for the session.
    pub fn get_session_reader(&self, session_id: &str) -> Result<Box<dyn std::io::Read + Send>> {
        let session = self.get_session_arc(session_id)?;
        let session = session
            .lock()
            .map_err(|e| TerminalError::LockPoisoned(format!("session lock error: {e}")))?;

        session.try_clone_reader()
    }

    /// Clones the one-shot exit guard for the session.
    pub fn get_session_exit_guard(&self, session_id: &str) -> Result<Arc<AtomicBool>> {
        let session = self.get_session_arc(session_id)?;
        let session = session
            .lock()
            .map_err(|e| TerminalError::LockPoisoned(format!("session lock error: {e}")))?;

        Ok(session.exit_guard())
    }

    /// Retrieves metadata for a session.
    pub fn session_info(&self, session_id: &str) -> Result<TerminalSessionInfo> {
        let session = self.get_session_arc(session_id)?;
        let session = session
            .lock()
            .map_err(|e| TerminalError::LockPoisoned(format!("session lock error: {e}")))?;

        Ok(session.info())
    }

    /// Returns a list of metadata for all currently managed sessions.
    pub fn list_sessions(&self) -> Vec<TerminalSessionInfo> {
        let map = match self.sessions.read() {
            Ok(m) => m,
            Err(_) => return Vec::new(),
        };

        map.values()
            .filter_map(|s| s.lock().ok().map(|guard| guard.info()))
            .collect()
    }

    /// Helper to clone an `Arc<Mutex<TerminalSession>>` while holding the manager lock briefly.
    fn get_session_arc(&self, session_id: &str) -> Result<Arc<Mutex<TerminalSession>>> {
        let map = self
            .sessions
            .read()
            .map_err(|e| TerminalError::LockPoisoned(format!("sessions read lock: {e}")))?;

        map.get(session_id)
            .cloned()
            .ok_or_else(|| TerminalError::SessionNotFound(session_id.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::types::ShellKind;

    #[test]
    fn test_invalid_dimensions_error() {
        let manager = TerminalSessionManager::new();

        let res_zero_cols = manager.create_session(CreateTerminalSessionInput {
            cols: Some(0),
            rows: Some(24),
            ..Default::default()
        });
        assert!(matches!(
            res_zero_cols,
            Err(TerminalError::InvalidDimensions { cols: 0, rows: 24 })
        ));

        let res_zero_rows = manager.create_session(CreateTerminalSessionInput {
            cols: Some(80),
            rows: Some(0),
            ..Default::default()
        });
        assert!(matches!(
            res_zero_rows,
            Err(TerminalError::InvalidDimensions { cols: 80, rows: 0 })
        ));
    }

    #[test]
    fn test_invalid_working_directory() {
        let manager = TerminalSessionManager::new();

        let res = manager.create_session(CreateTerminalSessionInput {
            cwd: Some("/this/path/does/not/exist/for/tracerelay".to_string()),
            ..Default::default()
        });
        assert!(matches!(res, Err(TerminalError::InvalidDirectory(_))));
    }

    #[test]
    fn test_unknown_session_errors() {
        let manager = TerminalSessionManager::new();
        let unknown_id = "non-existent-session-id";

        assert!(matches!(
            manager.session_info(unknown_id),
            Err(TerminalError::SessionNotFound(_))
        ));

        assert!(matches!(
            manager.write_bytes(unknown_id, b"test"),
            Err(TerminalError::SessionNotFound(_))
        ));

        assert!(matches!(
            manager.resize(ResizeTerminalInput {
                session_id: unknown_id.to_string(),
                cols: 100,
                rows: 30,
            }),
            Err(TerminalError::SessionNotFound(_))
        ));

        assert!(matches!(
            manager.close(CloseTerminalSessionInput {
                session_id: unknown_id.to_string(),
            }),
            Err(TerminalError::SessionNotFound(_))
        ));
    }

    #[test]
    #[cfg(unix)]
    fn test_real_pty_session_lifecycle() {
        let manager = TerminalSessionManager::new();
        let session = manager
            .create_session(CreateTerminalSessionInput {
                shell_kind: Some(ShellKind::Sh),
                cols: Some(80),
                rows: Some(24),
                cwd: None,
                integration_nonce: None,
            })
            .expect("failed to spawn sh PTY session");

        assert_eq!(session.cols, 80);
        assert_eq!(session.rows, 24);

        // Write to session
        manager
            .write_bytes(&session.session_id, b"echo 'tracerelay'\n")
            .expect("failed to write to PTY");

        // Clone reader handle
        let reader = manager
            .get_session_reader(&session.session_id)
            .expect("failed to clone reader");
        drop(reader);

        // Resize session
        manager
            .resize(ResizeTerminalInput {
                session_id: session.session_id.clone(),
                cols: 120,
                rows: 40,
            })
            .expect("failed to resize PTY");

        let updated_info = manager
            .session_info(&session.session_id)
            .expect("failed to get updated session info");
        assert_eq!(updated_info.cols, 120);
        assert_eq!(updated_info.rows, 40);

        // Close session
        manager
            .close(CloseTerminalSessionInput {
                session_id: session.session_id.clone(),
            })
            .expect("failed to close session");

        // Verify session is no longer in manager (SessionNotFound)
        assert!(matches!(
            manager.session_info(&session.session_id),
            Err(TerminalError::SessionNotFound(_))
        ));
    }
}
