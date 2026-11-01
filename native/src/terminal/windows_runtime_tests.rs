//! Real-ConPTY Windows PowerShell runtime tests through the production session manager
//! and backend.
//!
//! These run only on Windows. They cover the terminal runtime only: ConPTY I/O, resize,
//! authoritative child wait, interrupt dispatch (ETX through ConPTY input), and teardown.
//! Trusted PowerShell lifecycle (OSC 133 command boundaries) is covered by
//! `powershell_integration_tests`.

use crate::platform::terminal::{
    ChildWaitOutcome, DispatchOutcome, PtyStreamState, TerminalBackend, TerminalLifecycle,
};
use crate::terminal::commands::{classify_read_result, ReaderReadResult};
use crate::terminal::manager::TerminalSessionManager;
use crate::terminal::shell::{build_command, resolve_shell};
use crate::terminal::types::{
    CloseTerminalSessionInput, CreateTerminalSessionInput, ResizeTerminalInput, ShellKind,
    TerminalSessionStatus,
};
use portable_pty::{CommandBuilder, PtySize};
use std::io::Read;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(15);

/// A default-shell session created through `TerminalSessionManager`, with a reader thread
/// that records ConPTY stream facts exactly as the production reader loop does (minus IPC).
struct PowerShellSession {
    manager: TerminalSessionManager,
    id: String,
    lifecycle: TerminalLifecycle,
    output: Arc<Mutex<Vec<u8>>>,
}

impl PowerShellSession {
    fn spawn(manager: &TerminalSessionManager) -> Self {
        let info = manager
            .create_session(CreateTerminalSessionInput::default())
            .expect("failed to spawn default ConPTY session");
        assert_eq!(info.shell_kind, ShellKind::Powershell);
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
            .expect("ConPTY write failed");
    }

    fn output(&self) -> String {
        String::from_utf8_lossy(&self.output.lock().unwrap()).into_owned()
    }

    /// Commands build markers by concatenation (`'a' + '-b'`) so the echoed input never matches.
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

    /// Bytes received so far; output arriving later starts at this offset.
    fn output_len(&self) -> usize {
        self.output.lock().unwrap().len()
    }

    /// Waits for a default PowerShell prompt (`PS <location>>`) in output after `from`.
    fn expect_prompt_after(&self, from: usize) {
        let deadline = Instant::now() + TIMEOUT;
        loop {
            let later = String::from_utf8_lossy(&self.output.lock().unwrap()[from..]).into_owned();
            if later.find("PS ").is_some_and(|at| later[at..].contains('>')) {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for a prompt; output since offset: {later:?}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// PowerShell's own PID, as reported by the shell through ConPTY in response to this call.
    fn shell_pid(&self) -> u32 {
        let from = self.output_len();
        self.run("Write-Output ('pid-' + $PID + '-end')");
        let parse = || {
            let output = String::from_utf8_lossy(&self.output.lock().unwrap()[from..]).into_owned();
            output.match_indices("pid-").find_map(|(at, _)| {
                let rest = &output[at + 4..];
                rest[..rest.find("-end")?].parse().ok()
            })
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

#[test]
fn default_windows_shell_is_powershell_with_trusted_integration_bootstrap() {
    let config = resolve_shell(None);
    assert_eq!(config.executable, "powershell.exe");
    assert_eq!(config.shell_kind, ShellKind::Powershell);

    // Installed only: availability waits for the shell's handshake (CROSSPLAT-004B).
    let (cmd, integration, bootstrap) = build_command(&config, None, Some("nonce"));
    assert!(integration);
    assert!(bootstrap.is_some());
    let argv: Vec<_> = cmd.get_argv().iter().map(|a| a.to_string_lossy()).collect();
    assert_eq!(
        argv[..4],
        ["powershell.exe", "-NoLogo", "-NoExit", "-Command"]
    );
    assert_eq!(argv.len(), 5);
    assert_eq!(cmd.get_env("TRACERELAY_SHELL_NONCE"), None);
}

#[test]
fn conpty_child_exit_is_observed_without_any_reader_or_stream_eof() {
    let mut command = CommandBuilder::new("cmd.exe");
    command.args(["/c", "exit 9"]);
    let backend = TerminalBackend::spawn(
        command,
        PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        },
    )
    .expect("ConPTY spawn failed");
    let lifecycle = backend.lifecycle();
    // Drain output so closing the pseudoconsole cannot block, without recording stream facts.
    let mut reader = backend.try_clone_reader().unwrap();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while matches!(reader.read(&mut buf), Ok(n) if n > 0) {}
    });

    wait_until(|| lifecycle.snapshot().child.is_some());
    let facts = lifecycle.snapshot();
    assert_eq!(facts.child, Some(ChildWaitOutcome::Exited { exit_code: 9 }));
    // No reader recorded stream facts: the exit came from the child handle, not the stream.
    assert_eq!(facts.stream, PtyStreamState::Open);
}

#[test]
fn powershell_conpty_reads_writes_and_survives_failed_command() {
    let manager = TerminalSessionManager::new();
    let ps = PowerShellSession::spawn(&manager);

    ps.run("Write-Output ('windows' + '-basic-ok')");
    ps.expect_output("windows-basic-ok");
    ps.run("cmd.exe /c exit 3");
    ps.run("Write-Output ('after' + '-failure-' + $LASTEXITCODE)");
    ps.expect_output("after-failure-3");

    assert_eq!(ps.lifecycle.snapshot().child, None);
    assert_eq!(
        manager.session_info(&ps.id).unwrap().status,
        TerminalSessionStatus::Running
    );
    ps.close();
}

#[test]
fn powershell_conpty_resize_is_observed_by_the_shell() {
    let manager = TerminalSessionManager::new();
    let ps = PowerShellSession::spawn(&manager);
    let size = "$Host.UI.RawUI.WindowSize.Width + 'x' + $Host.UI.RawUI.WindowSize.Height";
    ps.run(&format!("Write-Output ('size0-' + {size})"));
    ps.expect_output("size0-80x24");

    for (cycle, (rows, cols)) in [(40, 120), (30, 100), (24, 80)].iter().enumerate() {
        manager
            .resize(ResizeTerminalInput {
                session_id: ps.id.clone(),
                cols: *cols,
                rows: *rows,
            })
            .expect("resize failed");
        let cycle = cycle + 1;
        ps.run(&format!("Write-Output ('size{cycle}-' + {size})"));
        ps.expect_output(&format!("size{cycle}-{cols}x{rows}"));
    }

    assert_eq!(ps.lifecycle.snapshot().child, None);
    ps.close();
}

#[test]
fn powershell_exit_status_comes_from_authoritative_child_wait() {
    let manager = TerminalSessionManager::new();
    let ps = PowerShellSession::spawn(&manager);
    ps.run("exit 7");

    assert_eq!(
        ps.wait_for_child_outcome(),
        ChildWaitOutcome::Exited { exit_code: 7 }
    );
    assert!(!ps.lifecycle.snapshot().teardown.requested);
}

/// Ctrl+C reaches ConPTY as ETX input, exactly as xterm `onData` sends it. A foreground
/// command that would otherwise run 30 s must stop well within the timeout, the same
/// PowerShell process must return to its prompt, and a new command must then run.
///
/// The next command is typed only after the prompt returns: on real Windows ARM64, input
/// written while the console was still handling Ctrl+C was discarded.
#[test]
fn ctrl_c_etx_interrupts_foreground_command_and_shell_survives() {
    let manager = TerminalSessionManager::new();
    let ps = PowerShellSession::spawn(&manager);
    let shell_pid = ps.shell_pid();

    for (label, command) in [
        ("native", "ping.exe -n 30 127.0.0.1"),
        ("cmdlet", "Start-Sleep -Seconds 30"),
    ] {
        ps.run(&format!("Write-Output ('{label}' + '-started'); {command}"));
        ps.expect_output(&format!("{label}-started"));
        std::thread::sleep(Duration::from_millis(500));

        let before_interrupt = ps.output_len();
        manager.write_bytes(&ps.id, &[0x03]).expect("ETX write failed");
        let interrupt = ps.lifecycle.snapshot().interrupt;
        assert!(interrupt.requested);
        assert_eq!(interrupt.dispatch, Some(DispatchOutcome::Accepted));
        ps.expect_prompt_after(before_interrupt);

        ps.run(&format!("Write-Output ('{label}' + '-after-interrupt')"));
        ps.expect_output(&format!("{label}-after-interrupt"));
        assert_eq!(ps.lifecycle.snapshot().child, None, "shell must survive Ctrl+C");
    }
    assert_eq!(ps.shell_pid(), shell_pid, "Ctrl+C must not replace the shell");
    ps.close();
}

#[test]
fn close_terminates_powershell_and_completes_teardown() {
    let manager = TerminalSessionManager::new();
    let ps = PowerShellSession::spawn(&manager);
    ps.run("Write-Output ('ready' + '-to-close')");
    ps.expect_output("ready-to-close");
    ps.close();

    // `portable-pty` tears down with TerminateProcess(handle, 1).
    assert_eq!(
        ps.wait_for_child_outcome(),
        ChildWaitOutcome::Exited { exit_code: 1 }
    );
    let teardown = ps.lifecycle.snapshot().teardown;
    assert!(teardown.requested && teardown.completed);
    assert_eq!(teardown.dispatch, Some(DispatchOutcome::Accepted));
    // Dropping the session closes the pseudoconsole, which ends the output stream.
    wait_until(|| ps.lifecycle.snapshot().stream != PtyStreamState::Open);
}

#[test]
fn concurrent_conpty_sessions_are_independent() {
    let manager = TerminalSessionManager::new();
    let first = PowerShellSession::spawn(&manager);
    let second = PowerShellSession::spawn(&manager);
    assert_ne!(first.id, second.id);

    first.run("Write-Output ('first' + '-alive')");
    second.run("Write-Output ('second' + '-alive')");
    first.expect_output("first-alive");
    second.expect_output("second-alive");
    assert!(!first.output().contains("second-alive"));

    first.run("exit 4");
    assert_eq!(
        first.wait_for_child_outcome(),
        ChildWaitOutcome::Exited { exit_code: 4 }
    );
    second.run("Write-Output ('second' + '-still-alive')");
    second.expect_output("second-still-alive");
    assert_eq!(second.lifecycle.snapshot().child, None);

    // A replacement session after a shell exit, as Enter-to-restart creates one.
    let replacement = PowerShellSession::spawn(&manager);
    replacement.run("Write-Output ('replacement' + '-alive')");
    replacement.expect_output("replacement-alive");
    second.close();
    replacement.close();
}
