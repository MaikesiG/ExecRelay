//! Real-PTY plain-Bash runtime tests through the production session manager and backend.
//!
//! These run on every Unix host (macOS and Linux). They cover the terminal runtime only:
//! PTY I/O, resize, authoritative child wait, interrupt dispatch, and teardown. They make
//! no claim about trusted shell lifecycle (OSC 133 command boundaries) on any platform.

use crate::error::TerminalError;
use crate::platform::terminal::{
    ChildWaitOutcome, DispatchOutcome, InterruptObservation, TerminalBackend, TerminalLifecycle,
};
use crate::terminal::commands::{classify_read_result, ReaderReadResult};
use crate::terminal::manager::TerminalSessionManager;
use crate::terminal::types::{
    CloseTerminalSessionInput, CreateTerminalSessionInput, ResizeTerminalInput, ShellKind,
    TerminalSessionStatus,
};
use portable_pty::{CommandBuilder, PtySize};
use std::io::Read;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(10);

/// A Bash session created through `TerminalSessionManager`, with a reader thread that
/// records PTY stream facts exactly as the production reader loop does (minus IPC emit).
struct BashSession {
    manager: TerminalSessionManager,
    id: String,
    lifecycle: TerminalLifecycle,
    output: Arc<Mutex<Vec<u8>>>,
}

impl BashSession {
    fn spawn(manager: &TerminalSessionManager, cwd: Option<String>) -> Self {
        let info = manager
            .create_session(CreateTerminalSessionInput {
                shell_kind: Some(ShellKind::Bash),
                cwd,
                ..Default::default()
            })
            .expect("failed to spawn Bash PTY session");
        assert_eq!(info.shell_kind, ShellKind::Bash);
        let lifecycle = manager.get_session_lifecycle(&info.session_id).unwrap();
        let mut reader = manager.get_session_reader(&info.session_id).unwrap();
        let output = Arc::new(Mutex::new(Vec::new()));
        let (sink, reader_lifecycle) = (Arc::clone(&output), lifecycle.clone());
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                let res = reader.read(&mut buf);
                match classify_read_result(&res) {
                    ReaderReadResult::Bytes(n) => sink.lock().unwrap().extend_from_slice(&buf[..n]),
                    ReaderReadResult::Eof | ReaderReadResult::ExpectedClose => {
                        reader_lifecycle.record_reader_eof();
                        break;
                    }
                    ReaderReadResult::UnexpectedError(message) => {
                        reader_lifecycle.record_reader_failure(message);
                        break;
                    }
                }
            }
        });
        Self {
            manager: manager.clone(),
            id: info.session_id,
            lifecycle,
            output,
        }
    }

    /// Types one line followed by Enter, as the frontend does.
    fn run(&self, line: &str) {
        self.manager
            .write_bytes(&self.id, format!("{line}\r").as_bytes())
            .expect("PTY write failed");
    }

    fn output(&self) -> String {
        String::from_utf8_lossy(&self.output.lock().unwrap()).into_owned()
    }

    /// Commands print markers with `printf '%s-%s'` so the echoed input never matches.
    fn expect_output(&self, needle: &str) {
        let deadline = Instant::now() + TIMEOUT;
        while !self.output().contains(needle) {
            assert!(
                Instant::now() < deadline,
                "timed out waiting for {needle:?}; output: {:?}",
                self.output()
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Bash's own PID, as reported by the shell through the PTY.
    fn shell_pid(&self) -> u32 {
        self.run(r#"printf '%s-%s-end\n' pid "$$""#);
        let parse = || {
            let output = self.output();
            let start = output.find("pid-")? + 4;
            let end = start + output[start..].find("-end")?;
            output[start..end].parse().ok()
        };
        wait_until(|| parse().is_some());
        parse().unwrap()
    }

    fn close(&self) {
        self.manager
            .close(CloseTerminalSessionInput {
                session_id: self.id.clone(),
            })
            .expect("failed to close session");
    }

    fn wait_for_child_outcome(&self) -> ChildWaitOutcome {
        wait_until(|| self.lifecycle.snapshot().child.is_some());
        self.lifecycle.snapshot().child.unwrap()
    }
}

fn wait_until(condition: impl Fn() -> bool) {
    let deadline = Instant::now() + TIMEOUT;
    while !condition() {
        assert!(Instant::now() < deadline, "timed out waiting for condition");
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// OS process state for `pid` (`ps` STAT column), or `None` if no such process exists.
/// A reaped child is absent; an unreaped one is still listed (as a zombie).
fn process_state(pid: u32) -> Option<String> {
    let out = Command::new("ps")
        .args(["-o", "stat=", "-p", &pid.to_string()])
        .output()
        .expect("ps failed to run");
    let state = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!state.is_empty()).then_some(state)
}

fn child_pids(parent: u32) -> Vec<u32> {
    let out = Command::new("pgrep")
        .args(["-P", &parent.to_string()])
        .output()
        .expect("pgrep failed to run");
    String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .map(|pid| pid.parse().unwrap())
        .collect()
}

fn assert_process_gone(pid: u32) {
    let deadline = Instant::now() + TIMEOUT;
    while let Some(state) = process_state(pid) {
        assert!(
            Instant::now() < deadline,
            "pid {pid} still present: {state}"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn bash_pty_reads_writes_and_survives_failed_command() {
    let manager = TerminalSessionManager::new();
    let bash = BashSession::spawn(&manager, None);

    bash.run(r"printf '%s-%s\n' linux basic-ok");
    bash.expect_output("linux-basic-ok");
    bash.run(r"printf '%s-%s\n' before failure");
    bash.run("false");
    bash.run(r"printf '%s-%s\n' after failure");
    bash.expect_output("before-failure");
    bash.expect_output("after-failure");

    assert_eq!(bash.lifecycle.snapshot().child, None);
    assert_eq!(
        manager.session_info(&bash.id).unwrap().status,
        TerminalSessionStatus::Running
    );
    bash.close();
}

/// CROSSPLAT-005: the runtime passes the program's bytes through unchanged, including
/// invalid UTF-8, control bytes and multi-byte Unicode. The echoed input carries the
/// `\xHH` escapes as text, so only the program's own output can match.
#[test]
fn arbitrary_bytes_and_unicode_pass_through_the_pty_unchanged() {
    let manager = TerminalSessionManager::new();
    let bash = BashSession::spawn(&manager, None);
    bash.run(r"printf 'bytes-\xff\xfe\x01\x1b[0m-\xe4\xbd\xa0\xe5\xa5\xbd-end\n'");
    let expected: &[u8] = b"bytes-\xff\xfe\x01\x1b[0m-\xe4\xbd\xa0\xe5\xa5\xbd-end";
    wait_until(|| {
        bash.output
            .lock()
            .unwrap()
            .windows(expected.len())
            .any(|window| window == expected)
    });
    bash.close();
}

#[test]
fn bash_pty_resize_is_observed_by_the_shell() {
    let manager = TerminalSessionManager::new();
    let bash = BashSession::spawn(&manager, None);
    bash.run(r#"printf 'size%s-%s\n' 0 "$(stty size)""#);
    bash.expect_output("size0-24 80");

    for (cycle, (rows, cols)) in [(40, 120), (30, 100), (60, 200), (24, 80)]
        .iter()
        .enumerate()
    {
        manager
            .resize(ResizeTerminalInput {
                session_id: bash.id.clone(),
                cols: *cols,
                rows: *rows,
            })
            .expect("resize failed");
        let cycle = cycle + 1;
        bash.run(&format!(r#"printf 'size%s-%s\n' {cycle} "$(stty size)""#));
        bash.expect_output(&format!("size{cycle}-{rows} {cols}"));
    }

    assert_eq!(bash.lifecycle.snapshot().child, None);
    bash.close();
}

#[test]
fn bash_exit_status_comes_from_authoritative_child_wait() {
    let manager = TerminalSessionManager::new();
    let bash = BashSession::spawn(&manager, None);
    bash.run("exit 7");

    assert_eq!(
        bash.wait_for_child_outcome(),
        ChildWaitOutcome::Exited { exit_code: 7 }
    );
    assert!(!bash.lifecycle.snapshot().teardown.requested);
}

/// Linux-only: Linux reports master EOF once the session leader closes every slave fd,
/// while it keeps running. macOS was measured not to report EOF in this scenario.
#[test]
#[cfg(target_os = "linux")]
fn pty_eof_while_child_is_alive_is_not_child_exit() {
    use crate::platform::terminal::PtyStreamState;

    let manager = TerminalSessionManager::new();
    let bash = BashSession::spawn(&manager, None);
    let pid = bash.shell_pid();
    // The session leader closes every slave fd but keeps running.
    bash.run("exec sleep 30 </dev/null >/dev/null 2>&1");

    wait_until(|| bash.lifecycle.snapshot().stream != PtyStreamState::Open);
    std::thread::sleep(Duration::from_millis(300));
    let facts = bash.lifecycle.snapshot();
    assert_eq!(facts.stream, PtyStreamState::Eof);
    assert_eq!(
        facts.child, None,
        "PTY EOF must not create child-exit evidence"
    );
    assert!(
        process_state(pid).is_some(),
        "child should still be running"
    );

    bash.close();
    assert!(matches!(
        bash.wait_for_child_outcome(),
        ChildWaitOutcome::Exited { .. }
    ));
    assert!(bash.lifecycle.snapshot().teardown.completed);
    assert_process_gone(pid);
}

#[test]
fn bash_teardown_terminates_shell_and_foreground_child() {
    let manager = TerminalSessionManager::new();
    let bash = BashSession::spawn(&manager, None);
    let pid = bash.shell_pid();
    bash.run(r"printf '%s-%s\n' sleep started; sleep 300");
    bash.expect_output("sleep-started");
    wait_until(|| !child_pids(pid).is_empty());
    let foreground = child_pids(pid);

    bash.close();
    assert!(matches!(
        bash.wait_for_child_outcome(),
        ChildWaitOutcome::Exited { .. }
    ));
    let facts = bash.lifecycle.snapshot();
    assert_eq!(facts.teardown.dispatch, Some(DispatchOutcome::Accepted));
    assert!(facts.teardown.completed);
    assert!(matches!(
        manager.session_info(&bash.id),
        Err(TerminalError::SessionNotFound(_))
    ));
    assert_process_gone(pid);
    for child in foreground {
        assert_process_gone(child);
    }
}

#[test]
fn bash_teardown_terminates_sighup_ignoring_session_leader() {
    let manager = TerminalSessionManager::new();
    let bash = BashSession::spawn(&manager, None);
    let pid = bash.shell_pid();
    bash.run(r"trap '' HUP; printf '%s-%s\n' hup ignored; while :; do sleep 1; done");
    bash.expect_output("hup-ignored");

    let started = Instant::now();
    bash.close();
    assert!(matches!(
        bash.wait_for_child_outcome(),
        ChildWaitOutcome::Exited { .. }
    ));
    assert!(started.elapsed() < Duration::from_secs(3));
    assert!(bash.lifecycle.snapshot().teardown.completed);
    assert_process_gone(pid);
}

#[test]
fn bash_interrupt_dispatch_is_not_observation_and_shell_survives() {
    let manager = TerminalSessionManager::new();
    let bash = BashSession::spawn(&manager, None);
    let pid = bash.shell_pid();
    bash.run(r"printf '%s-%s\n' sleep started; sleep 30");
    bash.expect_output("sleep-started");
    wait_until(|| !child_pids(pid).is_empty());

    manager
        .write_bytes(&bash.id, &[0x03])
        .expect("ETX dispatch failed");
    let facts = bash.lifecycle.snapshot();
    assert!(facts.interrupt.requested);
    assert_eq!(facts.interrupt.dispatch, Some(DispatchOutcome::Accepted));
    assert_eq!(facts.interrupt.observation, InterruptObservation::Unknown);
    assert_eq!(facts.child, None);

    // Shell-reported status, not backend observation: 130 = foreground job got SIGINT.
    bash.run(r#"printf 'status-%s\n' "$?""#);
    bash.expect_output("status-130");
    bash.run(r"printf '%s-%s\n' shell still-alive");
    bash.expect_output("shell-still-alive");
    assert_eq!(bash.lifecycle.snapshot().child, None);
    bash.close();
}

#[test]
fn three_bash_sessions_remain_isolated() {
    let manager = TerminalSessionManager::new();
    let a = BashSession::spawn(&manager, None);
    let b = BashSession::spawn(&manager, None);
    let c = BashSession::spawn(&manager, None);
    a.run(r"printf '%s-%s\n' session a");
    b.run(r"printf '%s-%s\n' session b");
    c.run(r"printf '%s-%s\n' session c");
    a.expect_output("session-a");
    b.expect_output("session-b");
    c.expect_output("session-c");

    manager
        .resize(ResizeTerminalInput {
            session_id: a.id.clone(),
            cols: 132,
            rows: 50,
        })
        .unwrap();
    b.run("false");
    c.run(r"printf '%s-%s\n' sleep started; sleep 30");
    c.expect_output("sleep-started");
    std::thread::sleep(Duration::from_millis(200));
    manager.write_bytes(&c.id, &[0x03]).unwrap();
    b.close();
    assert!(matches!(
        b.wait_for_child_outcome(),
        ChildWaitOutcome::Exited { .. }
    ));

    a.run(r#"printf 'size-%s\n' "$(stty size)""#);
    c.run(r#"printf 'size-%s\n' "$(stty size)""#);
    a.expect_output("size-50 132");
    c.expect_output("size-24 80");
    a.run(r"printf '%s-%s\n' a still-alive");
    c.run(r"printf '%s-%s\n' c still-alive");
    a.expect_output("a-still-alive");
    c.expect_output("c-still-alive");

    for (session, own, others) in [
        (&a, "session-a", ["session-b", "session-c"]),
        (&c, "session-c", ["session-a", "session-b"]),
    ] {
        let output = session.output();
        assert!(output.contains(own));
        assert!(others.iter().all(|other| !output.contains(other)));
        let facts = session.lifecycle.snapshot();
        assert_eq!(facts.child, None);
        assert!(!facts.teardown.requested);
    }
    assert!(!a.lifecycle.snapshot().interrupt.requested);
    assert!(c.lifecycle.snapshot().interrupt.requested);
    assert_eq!(manager.list_sessions().len(), 2);
    a.close();
    c.close();
}

#[test]
fn repeated_bash_create_close_leaves_no_process_or_session() {
    let manager = TerminalSessionManager::new();
    for cycle in 0..20 {
        let bash = BashSession::spawn(&manager, None);
        bash.run(&format!(r"printf '%s-%s\n' cycle {cycle}"));
        bash.expect_output(&format!("cycle-{cycle}"));
        let pid = bash.shell_pid();
        bash.close();
        assert!(matches!(
            bash.wait_for_child_outcome(),
            ChildWaitOutcome::Exited { .. }
        ));
        assert_process_gone(pid);
    }
    assert!(manager.list_sessions().is_empty());
}

#[test]
fn bash_starts_in_requested_cwd_with_runtime_environment() {
    let dir = std::env::temp_dir().join(format!("execrelay bash cwd {}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let manager = TerminalSessionManager::new();
    let bash = BashSession::spawn(&manager, Some(dir.to_string_lossy().into_owned()));

    bash.run(r#"printf 'cwd-%s-end\n' "$(pwd -P)""#);
    bash.run(r#"printf 'home-%s-end\n' "$HOME""#);
    bash.run(r#"printf 'term-%s-end\n' "$TERM""#);
    bash.run(r#"printf 'path-%s-end\n' "${PATH:+set}""#);
    let canonical = dir.canonicalize().unwrap();
    bash.expect_output(&format!("cwd-{}-end", canonical.display()));
    bash.expect_output(&format!("home-{}-end", std::env::var("HOME").unwrap()));
    bash.expect_output("term-xterm-256color-end");
    bash.expect_output("path-set-end");

    bash.close();
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn runtime_error_paths_are_explicit() {
    let spawn = TerminalBackend::spawn(
        CommandBuilder::new("/nonexistent/execrelay/bash"),
        PtySize::default(),
    );
    assert!(matches!(spawn, Err(TerminalError::SpawnFailed(_))));

    let manager = TerminalSessionManager::new();
    let bash = BashSession::spawn(&manager, None);
    bash.close();
    let not_found = |result| matches!(result, Err(TerminalError::SessionNotFound(_)));
    assert!(not_found(manager.write_bytes(&bash.id, b"echo late\r")));
    assert!(not_found(manager.resize(ResizeTerminalInput {
        session_id: bash.id.clone(),
        cols: 100,
        rows: 30,
    })));
    assert!(not_found(manager.close(CloseTerminalSessionInput {
        session_id: bash.id.clone(),
    })));

    // Natural exit, then teardown: no signal is dispatched to the already-reaped child.
    let exited = BashSession::spawn(&manager, None);
    exited.run("exit 3");
    assert_eq!(
        exited.wait_for_child_outcome(),
        ChildWaitOutcome::Exited { exit_code: 3 }
    );
    exited.close();
    let facts = exited.lifecycle.snapshot();
    assert!(facts.teardown.requested && facts.teardown.completed);
    assert_eq!(facts.teardown.dispatch, None);
    // The later close does not replace the shell's own exit status.
    assert_eq!(facts.child, Some(ChildWaitOutcome::Exited { exit_code: 3 }));
}
