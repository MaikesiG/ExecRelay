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
use crate::platform::terminal::{TerminalBackend, TerminalLifecycle};
use crate::terminal::session::{TerminalSession, TerminalSessionParams};
use crate::terminal::shell::{build_command, resolve_shell, IntegrationHandshake};
use crate::terminal::types::{
    CloseTerminalSessionInput, CreateTerminalSessionInput, ResizeTerminalInput,
    TerminalSessionInfo,
};
use portable_pty::PtySize;
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
        let (cmd, shell_integration_installed, shell_bootstrap) =
            build_command(&shell_config, input.cwd.as_deref(), nonce.as_deref());

        #[cfg(debug_assertions)]
        {
            let integration_path = match shell_config.shell_kind {
                crate::terminal::types::ShellKind::Zsh => Some(
                    std::env::temp_dir()
                        .join("tracerelay")
                        .join("shell")
                        .join("zsh")
                        .join(".zshrc"),
                ),
                _ => shell_bootstrap
                    .as_ref()
                    .map(|bootstrap| bootstrap.path().to_path_buf()),
            };
            eprintln!(
                "[ExecRelay shell] session=<redacted> shell={} argv={:?} integrationInstalled={} integrationFile={}",
                shell_config.executable,
                cmd.get_argv(),
                shell_integration_installed,
                integration_path
                    .as_ref()
                    .map(|path| path.display().to_string())
                    .unwrap_or_else(|| "<none>".to_string()),
            );
        }

        let backend = TerminalBackend::spawn(
            cmd,
            PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            },
        )?;

        let session_id = Uuid::new_v4().to_string();

        let session = TerminalSession::new(TerminalSessionParams {
            session_id: session_id.clone(),
            config: shell_config,
            cols,
            rows,
            cwd: input.cwd,
            integration_nonce: nonce,
            shell_integration_installed,
            shell_bootstrap,
            backend,
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
    /// Even if process termination dispatch fails, the session is reliably removed from
    /// manager state. The backend waiter remains authoritative for eventual child outcome.
    pub fn close_session(&self, session_id: &str) -> Result<()> {
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

        session.close()
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

    /// Clones the shared lifecycle facts for reader and child-exit coordination.
    pub fn get_session_lifecycle(&self, session_id: &str) -> Result<TerminalLifecycle> {
        let session = self.get_session_arc(session_id)?;
        let session = session
            .lock()
            .map_err(|e| TerminalError::LockPoisoned(format!("session lock error: {e}")))?;

        Ok(session.lifecycle())
    }

    /// Returns the integration handshake watcher for the session's output reader.
    pub fn get_session_integration_handshake(
        &self,
        session_id: &str,
    ) -> Result<Option<IntegrationHandshake>> {
        let session = self.get_session_arc(session_id)?;
        let session = session
            .lock()
            .map_err(|e| TerminalError::LockPoisoned(format!("session lock error: {e}")))?;

        Ok(session.integration_handshake())
    }

    /// Removes a naturally completed session after authoritative child wait observation.
    pub fn remove_after_child_wait(&self, session_id: &str) {
        if let Ok(mut map) = self.sessions.write() {
            map.remove(session_id);
        }
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
    #[cfg(unix)]
    use crate::terminal::types::{ShellKind, TerminalSessionStatus};

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

    #[test]
    #[cfg(unix)]
    fn test_interrupt_dispatch_does_not_manufacture_exit_observation() {
        let manager = TerminalSessionManager::new();
        let session = manager
            .create_session(CreateTerminalSessionInput {
                shell_kind: Some(ShellKind::Sh),
                ..Default::default()
            })
            .expect("failed to spawn sh PTY session");

        manager
            .write_bytes(&session.session_id, &[0x03])
            .expect("failed to dispatch ETX to PTY");

        let info = manager
            .session_info(&session.session_id)
            .expect("failed to inspect session after ETX dispatch");
        assert_eq!(info.status, TerminalSessionStatus::Running);
        assert_eq!(info.exit_code, None);

        manager
            .close(CloseTerminalSessionInput {
                session_id: session.session_id,
            })
            .expect("failed to close session after ETX dispatch");
    }

    #[test]
    #[cfg(unix)]
    fn test_multiple_real_sessions_remain_isolated_during_cleanup() {
        let manager = TerminalSessionManager::new();
        let first = manager
            .create_session(CreateTerminalSessionInput {
                shell_kind: Some(ShellKind::Sh),
                ..Default::default()
            })
            .expect("failed to spawn first sh PTY session");
        let second = manager
            .create_session(CreateTerminalSessionInput {
                shell_kind: Some(ShellKind::Sh),
                ..Default::default()
            })
            .expect("failed to spawn second sh PTY session");

        manager
            .close(CloseTerminalSessionInput {
                session_id: first.session_id.clone(),
            })
            .expect("failed to close first session");

        assert!(matches!(
            manager.session_info(&first.session_id),
            Err(TerminalError::SessionNotFound(_))
        ));
        assert_eq!(
            manager
                .session_info(&second.session_id)
                .expect("second session was affected by first cleanup")
                .status,
            TerminalSessionStatus::Running
        );
        manager
            .write_bytes(&second.session_id, b"echo isolated\n")
            .expect("second session writer stopped working");

        manager
            .close(CloseTerminalSessionInput {
                session_id: second.session_id,
            })
            .expect("failed to close second session");
    }

    #[test]
    #[cfg(unix)]
    fn test_real_child_wait_observes_exit_status_independently() {
        use crate::platform::terminal::ChildWaitOutcome;
        use std::time::Duration;

        let manager = TerminalSessionManager::new();
        let session = manager
            .create_session(CreateTerminalSessionInput {
                shell_kind: Some(ShellKind::Sh),
                ..Default::default()
            })
            .expect("failed to spawn sh PTY session");
        let lifecycle = manager
            .get_session_lifecycle(&session.session_id)
            .expect("failed to get lifecycle facts");
        // Drain output as the runtime reader does; an exiting PTY session leader can
        // otherwise block on unread tty output and never reach wait.
        let mut reader = manager
            .get_session_reader(&session.session_id)
            .expect("failed to clone reader");
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while matches!(reader.read(&mut buf), Ok(n) if n > 0) {}
        });

        manager
            .write_bytes(&session.session_id, b"exit 7\n")
            .expect("failed to ask child shell to exit");

        let facts = lifecycle.wait_for_exit_event(Duration::from_secs(2));
        assert_eq!(facts.child, Some(ChildWaitOutcome::Exited { exit_code: 7 }));
    }

    #[test]
    #[cfg(unix)]
    fn test_real_teardown_completes_after_authoritative_wait() {
        use crate::platform::terminal::ChildWaitOutcome;
        use std::time::Duration;

        let manager = TerminalSessionManager::new();
        let session = manager
            .create_session(CreateTerminalSessionInput {
                shell_kind: Some(ShellKind::Sh),
                ..Default::default()
            })
            .expect("failed to spawn sh PTY session");
        let lifecycle = manager
            .get_session_lifecycle(&session.session_id)
            .expect("failed to get lifecycle facts");

        manager
            .close(CloseTerminalSessionInput {
                session_id: session.session_id,
            })
            .expect("failed to request session teardown");

        let facts = lifecycle.wait_for_exit_event(Duration::from_secs(2));
        assert!(facts.teardown.requested);
        assert!(facts.teardown.completed);
        assert!(matches!(facts.child, Some(ChildWaitOutcome::Exited { .. })));
    }

    #[test]
    #[cfg(unix)]
    fn test_real_teardown_terminates_child_that_ignores_sighup() {
        use std::time::{Duration, Instant};

        let manager = TerminalSessionManager::new();
        let session = manager
            .create_session(CreateTerminalSessionInput {
                shell_kind: Some(ShellKind::Sh),
                ..Default::default()
            })
            .expect("failed to spawn sh PTY session");
        let lifecycle = manager
            .get_session_lifecycle(&session.session_id)
            .expect("failed to get lifecycle facts");

        manager
            .write_bytes(
                &session.session_id,
                b"exec sh -c 'trap \"\" HUP; while :; do sleep 1; done'\n",
            )
            .expect("failed to replace session leader with a SIGHUP-ignoring process");
        std::thread::sleep(Duration::from_millis(500));

        manager
            .close(CloseTerminalSessionInput {
                session_id: session.session_id,
            })
            .expect("failed to request session teardown");

        let deadline = Instant::now() + Duration::from_secs(3);
        while lifecycle.snapshot().child.is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        let facts = lifecycle.snapshot();
        assert!(
            facts.child.is_some(),
            "teardown left a SIGHUP-ignoring session leader running"
        );
        assert!(facts.teardown.completed);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_real_zsh_integration_emits_complete_logical_commands() {
        use std::io::Read;
        use std::sync::mpsc;
        use std::time::Duration;

        const NONCE: &str = "capture-command-r2-native-test";
        const PRINTF_COMMAND: &str = "printf '%s\\n' \\\n  \"one\" \\\n  \"two\" \\\n  \"three\"";
        const PRINTF_COMMAND_B64: &str =
            "cHJpbnRmICclc1xuJyBcCiAgIm9uZSIgXAogICJ0d28iIFwKICAidGhyZWUi";
        const PIPELINE_COMMAND: &str = "printf 'c\\na\\nb\\n' |\nsort |\nhead -n 2";
        const PIPELINE_COMMAND_B64: &str =
            "cHJpbnRmICdjXG5hXG5iXG4nIHwKc29ydCB8CmhlYWQgLW4gMg==";

        let manager = TerminalSessionManager::new();
        let session = manager
            .create_session(CreateTerminalSessionInput {
                shell_kind: Some(ShellKind::Zsh),
                cols: Some(100),
                rows: Some(30),
                cwd: None,
                integration_nonce: Some(NONCE.to_string()),
            })
            .expect("failed to spawn the real zsh PTY integration path");

        assert_eq!(session.shell, "/bin/zsh");
        assert_eq!(session.shell_kind, ShellKind::Zsh);
        assert!(session.shell_integration_pending && !session.shell_integration_available);

        let mut reader = manager
            .get_session_reader(&session.session_id)
            .expect("failed to clone the real zsh PTY reader");
        let (output_tx, output_rx) = mpsc::channel();
        let reader_thread = std::thread::spawn(move || {
            let mut output = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        output.extend_from_slice(&chunk[..n]);
                        let text = String::from_utf8_lossy(&output);
                        if text.matches("\u{1b}]133;C;").count() >= 2
                            && text.matches("\u{1b}]133;D;").count() >= 3
                        {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let _ = output_tx.send(output);
        });

        let input = format!(
            "{}\r{}\r",
            PRINTF_COMMAND.replace('\n', "\r"),
            PIPELINE_COMMAND.replace('\n', "\r"),
        );
        manager
            .write_bytes(&session.session_id, input.as_bytes())
            .expect("failed to write logical commands to the real zsh PTY");

        let output = output_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("timed out waiting for real zsh integration markers");
        let output = String::from_utf8_lossy(&output);

        assert_eq!(output.matches("\u{1b}]133;C;").count(), 2);
        assert!(output.contains(&format!(
            "\u{1b}]133;C;aid={NONCE};cmd={PRINTF_COMMAND_B64}\u{7}"
        )));
        assert!(output.contains(&format!(
            "\u{1b}]133;C;aid={NONCE};cmd={PIPELINE_COMMAND_B64}\u{7}"
        )));
        assert!(output.matches(&format!("\u{1b}]133;D;0;aid={NONCE}\u{7}")).count() >= 2);
        assert!(output.contains("one\r\ntwo\r\nthree"));
        assert!(output.contains("a\r\nb"));

        manager
            .close(CloseTerminalSessionInput {
                session_id: session.session_id,
            })
            .expect("failed to close real zsh integration test session");
        reader_thread
            .join()
            .expect("real zsh integration reader thread panicked");
    }

    /// MACOS-PATH-001: a real trusted zsh, started through the production command builder
    /// with the app's inherited environment and with a Finder-style minimal PATH, resolves
    /// the system tools, keeps the system directories on PATH, and its trusted start marker
    /// does not depend on PATH: after a command replaces PATH (`for path in ...` assigns the
    /// tied array), the hook still reports the exact command and prints no error.
    #[test]
    #[cfg(target_os = "macos")]
    fn test_real_zsh_session_path_and_trusted_hooks_survive_a_replaced_path() {
        use crate::platform::terminal::TerminalBackend;
        use crate::terminal::osc133_test_support::{aid, b64, field, markers};
        use crate::terminal::shell::{build_command, resolve_shell_internal};
        use std::io::Read;
        use std::time::{Duration, Instant};

        const NONCE: &str = "macos-path-001-test";
        let config = resolve_shell_internal(Some(ShellKind::Zsh), None);
        for minimal_parent_path in [false, true] {
            let (mut cmd, installed, _) = build_command(&config, None, Some(NONCE));
            assert!(installed);
            if minimal_parent_path {
                cmd.env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
            }
            cmd.env("HISTFILE", "/dev/null");
            let backend = TerminalBackend::spawn(cmd, PtySize::default()).unwrap();
            let output = Arc::new(Mutex::new(Vec::new()));
            let (sink, mut reader) = (Arc::clone(&output), backend.try_clone_reader().unwrap());
            std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                while let Ok(n @ 1..) = reader.read(&mut buf) {
                    sink.lock().unwrap().extend_from_slice(&buf[..n]);
                }
            });
            let text = || String::from_utf8_lossy(&output.lock().unwrap()).into_owned();
            let wait_for = |needle: &str| {
                let deadline = Instant::now() + Duration::from_secs(15);
                while !text().contains(needle) {
                    assert!(
                        Instant::now() < deadline,
                        "timed out waiting for {needle:?}: {:?}",
                        text()
                    );
                    std::thread::sleep(Duration::from_millis(20));
                }
            };
            let after_clobber = "print -r -- after-$((40 + 2))-clobber";
            for line in [
                "print -r -- \"path-[$PATH]-end\"",
                "for tool in base64 tr grep head; do print -r -- \"$tool=$(command -v $tool)\"; done",
                "print -rn -- 'ok' | base64 | tr 'a-z' 'A-Z'; print -r -- '-encoded'",
                "printf 'b\\na\\nc\\n' | grep -v c | head -n 1 | tr 'a-z' 'A-Z'; print -r -- '-piped'",
                "for path in /nonexistent; do :; done",
                after_clobber,
            ] {
                backend.write(format!("{line}\r").as_bytes()).unwrap();
            }
            wait_for("after-42-clobber");
            let out = text();

            let path_value = &out[out.rfind("path-[").unwrap() + 6..out.rfind("]-end").unwrap()];
            for dir in ["/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
                assert!(
                    path_value.split(':').any(|d| d == dir),
                    "{dir} missing from {path_value}"
                );
            }
            for tool in ["base64", "tr", "grep", "head"] {
                assert!(
                    out.contains(&format!("{tool}=/")),
                    "{tool} did not resolve: {out:?}"
                );
            }
            assert!(out.contains("B2S=\r\n-encoded"), "{out:?}");
            assert!(out.contains("B\r\n-piped"), "{out:?}");
            assert!(!out.contains("command not found"), "{out:?}");
            assert!(!out.contains("_tracerelay"), "hook error: {out:?}");
            let last_start = markers(&out)
                .into_iter()
                .rfind(|fields| fields[0] == "C" && aid(fields) == Some(NONCE))
                .unwrap();
            assert_eq!(
                field(&last_start, "cmd=").map(b64).as_deref(),
                Some(after_clobber)
            );
            backend.request_teardown();
        }
    }

    /// EXECUTION-ERROR-MODEL-001: when the trusted zsh hook cannot encode the command, it
    /// reports its own failure in the trusted start marker (`err=command-encode`) instead of
    /// emitting an empty or missing payload, and the command's own trusted exit status is
    /// still reported unchanged.
    #[test]
    #[cfg(target_os = "macos")]
    fn test_real_zsh_hook_reports_its_own_encode_failure() {
        use crate::platform::terminal::TerminalBackend;
        use crate::terminal::osc133_test_support::{aid, field, markers};
        use crate::terminal::shell::{build_command, resolve_shell_internal};
        use std::io::Read;
        use std::time::{Duration, Instant};

        const NONCE: &str = "execution-error-model-001-test";
        let config = resolve_shell_internal(Some(ShellKind::Zsh), None);
        let (mut cmd, installed, _) = build_command(&config, None, Some(NONCE));
        assert!(installed);
        cmd.env("HISTFILE", "/dev/null");
        let backend = TerminalBackend::spawn(cmd, PtySize::default()).unwrap();
        let output = Arc::new(Mutex::new(Vec::new()));
        let (sink, mut reader) = (Arc::clone(&output), backend.try_clone_reader().unwrap());
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n @ 1..) = reader.read(&mut buf) {
                sink.lock().unwrap().extend_from_slice(&buf[..n]);
            }
        });
        let text = || String::from_utf8_lossy(&output.lock().unwrap()).into_owned();
        // Unset, then unrunnable encoder; each following command's start marker must say so.
        for line in [
            "_tracerelay_base64=",
            "false",
            "_tracerelay_base64=/nonexistent/base64",
            "print -r -- done-$((40 + 2))",
        ] {
            backend.write(format!("{line}\r").as_bytes()).unwrap();
        }
        let deadline = Instant::now() + Duration::from_secs(15);
        while !(text().contains("done-42")
            && text()
                .matches(&format!("\u{1b}]133;D;0;aid={NONCE}"))
                .count()
                >= 4)
        {
            assert!(Instant::now() < deadline, "timed out: {:?}", text());
            std::thread::sleep(Duration::from_millis(20));
        }
        let out = text();
        let trusted: Vec<_> = markers(&out)
            .into_iter()
            .filter(|fields| aid(fields) == Some(NONCE))
            .collect();
        let starts: Vec<_> = trusted.iter().filter(|fields| fields[0] == "C").collect();
        assert_eq!(starts.len(), 4, "{out:?}");
        assert!(field(starts[0], "cmd=").is_some() && field(starts[0], "err=").is_none());
        for start in &starts[1..] {
            assert_eq!(field(start, "err="), Some("command-encode"), "{out:?}");
            assert!(field(start, "cmd=").is_none(), "{out:?}");
        }
        // The user command's failure is reported as-is: `false` still ends with exit 1.
        let ends: Vec<_> = trusted
            .iter()
            .filter(|fields| fields[0] == "D")
            .map(|fields| fields[1].clone())
            .collect();
        assert!(
            ends.ends_with(&["0".into(), "1".into(), "0".into(), "0".into()]),
            "{ends:?}"
        );
        backend.request_teardown();
    }
}
