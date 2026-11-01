//! Real-shell tests for trusted PowerShell lifecycle integration.
//!
//! On Windows these run Windows PowerShell (`powershell.exe`, the default shell) through
//! ConPTY. Elsewhere they are ignored by default; `cargo test -- --ignored` runs them
//! against a PowerShell 7 reachable as `pwsh.exe` on `PATH` (e.g. a symlink to `pwsh`),
//! which checks the integration script but is not Windows evidence.
//!
//! Commands build expected output by concatenation (`'a' + '-b'`) so the echoed input never
//! matches. The tests never print the nonce.

use crate::platform::terminal::TerminalBackend;
use crate::terminal::manager::TerminalSessionManager;
use crate::terminal::osc133_test_support::{aid, markers, render};
use crate::terminal::shell::{build_command, resolve_shell, IntegrationHandshake};
use crate::terminal::types::{
    CloseTerminalSessionInput, CreateTerminalSessionInput, ResizeTerminalInput, ShellKind,
};
use portable_pty::PtySize;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(20);

/// One submission whose first statement proves the pipeline runs before Start-Sleep does.
const SLEEP_AFTER_MARKER: &str = "Write-Output ('sleep' + '-started'); Start-Sleep -Seconds 30";

/// The shell under test: the Windows default, or PowerShell 7 elsewhere.
fn shell_kind() -> Option<ShellKind> {
    if cfg!(windows) {
        None
    } else {
        Some(ShellKind::Pwsh)
    }
}

/// A deterministic native command exiting with `code`.
fn native_exit(code: i32) -> String {
    if cfg!(windows) {
        format!("cmd.exe /c \"exit {code}\"")
    } else {
        format!("sh -c 'exit {code}'")
    }
}

/// Whether PowerShell's reported FileSystem location `reported` is the directory `expected`.
///
/// On Windows one directory has several spellings, so the paths are compared by what the
/// filesystem resolves them to, never byte for byte: `std::env::temp_dir()` can contain an
/// 8.3 short name (`C:\Users\RUNNER~1\...` on GitHub's runners) where PowerShell reports the
/// long name of the same folder (`C:\Users\runneradmin\...`), and case is not significant.
/// Elsewhere the reported location must match exactly.
fn same_directory(reported: &str, expected: &Path) -> bool {
    if cfg!(windows) {
        match (
            std::fs::canonicalize(reported),
            std::fs::canonicalize(expected),
        ) {
            (Ok(reported), Ok(expected)) => reported == expected,
            _ => false,
        }
    } else {
        Some(reported) == expected.to_str()
    }
}

#[test]
fn same_directory_accepts_only_spellings_of_the_same_folder() {
    let base = std::env::temp_dir().join(format!("execrelay ps-cwd {}", uuid::Uuid::new_v4()));
    let (dir, other) = (base.join("Folder 你好"), base.join("other"));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::create_dir_all(&other).unwrap();
    assert!(same_directory(dir.to_str().unwrap(), &dir));
    assert!(!same_directory(other.to_str().unwrap(), &dir));
    if cfg!(windows) {
        // Case and a trailing separator change the spelling, not the folder.
        let respelled = format!("{}\\", dir.to_str().unwrap().to_uppercase());
        assert!(same_directory(&respelled, &dir), "{respelled}");
    }
    std::fs::remove_dir_all(&base).ok();
}

struct PowerShell {
    manager: TerminalSessionManager,
    id: String,
    nonce: String,
    output: Arc<Mutex<Vec<u8>>>,
}

impl PowerShell {
    fn spawn(manager: &TerminalSessionManager) -> Self {
        let info = manager
            .create_session(CreateTerminalSessionInput {
                shell_kind: shell_kind(),
                ..Default::default()
            })
            .expect("failed to spawn PowerShell");
        assert!(matches!(
            info.shell_kind,
            ShellKind::Powershell | ShellKind::Pwsh
        ));
        // Truthful availability: installed but not yet confirmed by a handshake.
        assert!(info.shell_integration_pending && !info.shell_integration_available);
        let reader = manager.get_session_reader(&info.session_id).unwrap();
        let handshake = manager
            .get_session_integration_handshake(&info.session_id)
            .unwrap();
        let (replier, id) = (manager.clone(), info.session_id.clone());
        let reply = move |bytes: &[u8]| {
            let _ = replier.write_bytes(&id, bytes);
        };
        Self {
            manager: manager.clone(),
            nonce: info.integration_nonce.unwrap(),
            id: info.session_id,
            output: collect(reader, handshake, reply),
        }
    }

    /// Spawns, then waits for the handshake and the first trusted prompt.
    fn ready(manager: &TerminalSessionManager) -> Self {
        let ps = Self::spawn(manager);
        ps.wait_until("trusted handshake", |ps| {
            ps.trusted().iter().any(|m| m.starts_with("P version="))
        });
        ps.wait_until("integration available", Self::available);
        ps.wait_for_prompts(1);
        ps
    }

    fn available(&self) -> bool {
        self.manager
            .session_info(&self.id)
            .unwrap()
            .shell_integration_available
    }

    fn write(&self, bytes: &[u8]) {
        self.manager.write_bytes(&self.id, bytes).unwrap();
    }

    fn run(&self, line: &str) {
        self.write(format!("{line}\r").as_bytes());
    }

    /// Runs one line and waits for its trusted end and the prompt after it.
    fn run_and_wait(&self, line: &str) {
        let (ends, prompts) = (self.count('D'), self.count('A'));
        self.run(line);
        self.wait_for_ends(ends + 1);
        self.wait_for_prompts(prompts + 1);
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.output.lock().unwrap()).into_owned()
    }

    /// Trusted markers in order, rendered as `P k=v`, `A`, `C <cmd>|<cwd>`, `D <status>`.
    fn trusted(&self) -> Vec<String> {
        markers(&self.text())
            .into_iter()
            .filter(|fields| aid(fields) == Some(self.nonce.as_str()))
            .map(|fields| render(&fields))
            .collect()
    }

    /// Trusted command starts and ends, ignoring prompt and handshake markers.
    fn commands(&self) -> Vec<String> {
        self.trusted()
            .into_iter()
            .filter(|m| m.starts_with('C') || m.starts_with('D'))
            .collect()
    }

    fn count(&self, code: char) -> usize {
        self.trusted()
            .iter()
            .filter(|m| m.starts_with(code))
            .count()
    }

    fn wait_until(&self, what: &str, condition: impl Fn(&Self) -> bool) {
        let deadline = Instant::now() + TIMEOUT;
        while !condition(self) {
            assert!(
                Instant::now() < deadline,
                "timed out waiting for {what}; trusted: {:?}; output: {:?}",
                self.trusted(),
                self.text().replace(&self.nonce, "<nonce>")
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn wait_for_ends(&self, count: usize) {
        self.wait_until(&format!("{count} trusted command ends"), |ps| {
            ps.count('D') >= count
        });
    }

    fn wait_for_prompts(&self, count: usize) {
        self.wait_until(&format!("{count} trusted prompts"), |ps| {
            ps.count('A') >= count
        });
    }

    fn wait_for_text(&self, needle: &str) {
        self.wait_until(needle, |ps| ps.text().contains(needle));
    }

    /// Starts `command` and sends Ctrl+C once it is observably running: after `started`
    /// appears in its own output when given (never on a timer alone), then `delay` later.
    /// Returns that command's rendered end marker once the prompt is back.
    fn interrupt(&self, command: &str, started: Option<&str>, delay: Duration) -> String {
        let (starts, ends, prompts) = (self.count('C'), self.count('D'), self.count('A'));
        let from = self.output.lock().unwrap().len();
        self.run(command);
        self.wait_until("trusted start", |ps| ps.count('C') > starts);
        if let Some(needle) = started {
            self.wait_until(needle, |ps| {
                String::from_utf8_lossy(&ps.output.lock().unwrap()[from..]).contains(needle)
            });
        }
        std::thread::sleep(delay);
        self.write(&[0x03]);
        self.wait_for_ends(ends + 1);
        // Type the next command only after the prompt returns (ConPTY drops earlier input).
        self.wait_for_prompts(prompts + 1);
        let commands = self.commands();
        assert!(commands[commands.len() - 2].starts_with(&format!("C {command}|")));
        commands.last().unwrap().clone()
    }

    fn close(&self) {
        self.manager
            .close(CloseTerminalSessionInput {
                session_id: self.id.clone(),
            })
            .unwrap();
    }
}

/// Mirrors the production reader: raw output plus handshake observation.
///
/// Off Windows, PowerShell's .NET console queries the cursor (`ESC[6n`) and stalls input
/// handling until answered, which xterm.js does in the app; `reply` answers here. Windows
/// PowerShell uses console APIs instead, so nothing is written back there.
fn collect(
    mut reader: Box<dyn Read + Send>,
    mut handshake: Option<IntegrationHandshake>,
    reply: impl Fn(&[u8]) + Send + 'static,
) -> Arc<Mutex<Vec<u8>>> {
    let output = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&output);
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n @ 1..) = reader.read(&mut buf) {
            if let Some(handshake) = handshake.as_mut() {
                handshake.observe(&buf[..n]);
            }
            if cfg!(not(windows)) {
                for _ in buf[..n].windows(4).filter(|w| w == b"\x1b[6n") {
                    reply(b"\x1b[1;1R");
                }
            }
            sink.lock().unwrap().extend_from_slice(&buf[..n]);
        }
    });
    output
}

#[test]
#[cfg_attr(
    not(windows),
    ignore = "needs pwsh.exe on PATH; Windows runs powershell.exe"
)]
fn handshake_is_the_first_trusted_marker_and_basic_command_is_one_execution() {
    let manager = TerminalSessionManager::new();
    let ps = PowerShell::ready(&manager);
    let info = manager.session_info(&ps.id).unwrap();
    assert!(info.shell_integration_available && !info.shell_integration_pending);

    ps.run_and_wait("Write-Output ('trusted' + '-basic')");
    let trusted = ps.trusted();
    assert!(trusted[0].starts_with("P version="), "{trusted:?}");
    assert_eq!(trusted.iter().filter(|m| m.starts_with('P')).count(), 1);

    let commands = ps.commands();
    assert_eq!(commands.len(), 2, "{commands:?}");
    let (cmd, cwd) = commands[0][2..].split_once('|').unwrap();
    assert_eq!(cmd, "Write-Output ('trusted' + '-basic')");
    assert!(
        !cwd.is_empty(),
        "start carries PowerShell's FileSystem location"
    );
    assert_eq!(commands[1], "D 0");

    // Output lies between the trusted start and end, as Capture attributes it.
    let text = ps.text();
    let start = text.find(";cmd=").unwrap();
    let output = text.find("trusted-basic").unwrap();
    let end = text.rfind("\u{1b}]133;D;0").unwrap();
    assert!(start < output && output < end, "marker order");
    // Readiness is protocol state, never prompt text (customizable, and ConPTY may repaint
    // it in a later chunk): a trusted prompt marker follows the end, and the next
    // submission runs as its own execution.
    assert!(
        text.rfind("\u{1b}]133;A;").unwrap() > end,
        "trusted prompt after the end"
    );
    ps.run_and_wait("Write-Output ('next' + '-command')");
    assert_eq!(ps.commands().len(), 4);
    assert_eq!(ps.commands()[3], "D 0");
    ps.close();
}

#[test]
#[cfg_attr(
    not(windows),
    ignore = "needs pwsh.exe on PATH; Windows runs powershell.exe"
)]
fn end_status_follows_powershell_and_native_semantics() {
    let manager = TerminalSessionManager::new();
    let ps = PowerShell::ready(&manager);
    let lines = [
        // Non-terminating cmdlet error: $? false, new $Error record -> normalized 1.
        "Get-Item Z:\\nope".to_string(),
        // $? reflects the last statement, as in other shells.
        "Get-Item Z:\\nope; Write-Output ('after' + '-error')".to_string(),
        native_exit(7),
        // Same native code again: $LASTEXITCODE did not change -> no status claimed.
        native_exit(7),
        native_exit(0),
        "throw 'boom'".to_string(),
        // A complete line that fails to parse still ends the command.
        "Write-Output 'parse' )".to_string(),
        "Write-Output ('still' + '-alive')".to_string(),
    ];
    for line in &lines {
        ps.run_and_wait(line);
    }
    let ends: Vec<_> = ps
        .commands()
        .into_iter()
        .filter(|m| m.starts_with('D'))
        .collect();
    assert_eq!(
        ends,
        ["D 1", "D 0", "D 7", "D ?", "D 0", "D 1", "D 1", "D 0"]
    );
    ps.wait_for_text("still-alive");
    ps.close();
}

#[test]
#[cfg_attr(
    not(windows),
    ignore = "needs pwsh.exe on PATH; Windows runs powershell.exe"
)]
fn wrapper_preserves_dollar_question_and_lastexitcode_for_the_user() {
    let manager = TerminalSessionManager::new();
    let ps = PowerShell::ready(&manager);
    ps.run_and_wait(&native_exit(3));
    ps.run_and_wait("Write-Output ('lec-' + $LASTEXITCODE)");
    ps.run_and_wait("Get-Item Z:\\nope");
    ps.run_and_wait("Write-Output ('status-' + $?)");
    ps.run_and_wait("Write-Output ('matches-' + ($null -eq $Matches))");
    ps.wait_for_text("lec-3");
    ps.wait_for_text("status-False");
    ps.wait_for_text("matches-True");
    ps.close();
}

#[test]
#[cfg_attr(
    not(windows),
    ignore = "needs pwsh.exe on PATH; Windows runs powershell.exe"
)]
fn multiline_submission_is_one_execution_and_pasted_lines_are_separate() {
    let manager = TerminalSessionManager::new();
    let ps = PowerShell::ready(&manager);
    ps.write(b"if ($true) {\r  Write-Output ('multi' + '-if')\r}\r");
    ps.wait_for_ends(1);
    ps.write(b"1..3 | ForEach-Object {\r  Write-Output ('item-' + $_)\r}\r");
    ps.wait_for_ends(2);
    ps.wait_for_text("item-3");
    // A paste of two complete lines is two PowerShell submissions, not one paste event.
    ps.write(b"Write-Output ('paste' + '-one')\rWrite-Output ('paste' + '-two')\r");
    ps.wait_for_ends(4);
    ps.wait_for_text("paste-two");

    let commands = ps.commands();
    assert_eq!(commands.len(), 8, "{commands:?}");
    assert!(commands[0].starts_with("C if ($true) {\n  Write-Output ('multi' + '-if')\n}|"));
    assert!(commands[2].starts_with("C 1..3 | ForEach-Object {\n"));
    assert!(commands[4].starts_with("C Write-Output ('paste' + '-one')|"));
    assert!(commands[6].starts_with("C Write-Output ('paste' + '-two')|"));
    for end in [1, 3, 5, 7] {
        assert_eq!(commands[end], "D 0");
    }
    ps.close();
}

#[test]
#[cfg_attr(
    not(windows),
    ignore = "needs pwsh.exe on PATH; Windows runs powershell.exe"
)]
fn trusted_cwd_is_powershell_location_at_command_start() {
    let manager = TerminalSessionManager::new();
    let ps = PowerShell::ready(&manager);
    let dir = std::env::temp_dir().join(format!("execrelay ps 你好 {}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let dir_text = dir.to_str().unwrap().to_string();

    // pwsh on Linux can mis-decode non-ASCII in a session's very first input line; not
    // what this test is about, so the first line is ASCII.
    ps.run_and_wait("Write-Output ('warm' + '-up')");
    ps.run_and_wait(&format!("Set-Location -LiteralPath '{dir_text}'"));
    ps.run_and_wait("Write-Output ('cwd' + '-check')");
    ps.run_and_wait("Set-Location Env:");
    ps.run_and_wait("Write-Output ('non' + '-filesystem')");
    ps.run_and_wait("Write-Output ('你好' + ' PowerShell')");
    ps.wait_for_text("你好 PowerShell");

    let starts: Vec<_> = ps
        .commands()
        .into_iter()
        .filter(|m| m.starts_with('C'))
        .collect();
    let cwd = |i: usize| starts[i].rsplit_once('|').unwrap().1.to_string();
    assert_eq!(
        cwd(0),
        cwd(1),
        "Set-Location itself starts in the old location"
    );
    assert!(!same_directory(&cwd(1), &dir), "{starts:?}");
    assert!(same_directory(&cwd(2), &dir), "{starts:?} vs {dir:?}");
    assert!(same_directory(&cwd(3), &dir), "{starts:?} vs {dir:?}");
    // A non-FileSystem location (Env:) is not a directory: no cwd is claimed.
    assert_eq!(cwd(4), "");
    assert_eq!(starts[5], "C Write-Output ('你好' + ' PowerShell')|");
    ps.close();
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
#[cfg_attr(
    not(windows),
    ignore = "needs pwsh.exe on PATH; Windows runs powershell.exe"
)]
fn ctrl_c_ends_the_trusted_command_without_inventing_a_status() {
    let manager = TerminalSessionManager::new();
    let ps = PowerShell::ready(&manager);
    let started = Instant::now();
    // The pipeline is interrupted while Start-Sleep runs: its first statement has already
    // printed, so the interrupt cannot land during command resolution.
    let end = ps.interrupt(
        SLEEP_AFTER_MARKER,
        Some("sleep-started"),
        Duration::from_millis(200),
    );
    assert!(
        started.elapsed() < Duration::from_secs(25),
        "Ctrl+C stopped the sleep"
    );
    assert_eq!(end, "D ?", "stopped pipeline has no exit status");

    ps.run_and_wait("Write-Output ('after' + '-interrupt')");
    ps.wait_for_text("after-interrupt");
    let commands = ps.commands();
    assert!(commands[2].starts_with("C Write-Output ('after' + '-interrupt')|"));
    assert_eq!(commands[3], "D 0");
    assert_eq!(
        manager
            .get_session_lifecycle(&ps.id)
            .unwrap()
            .snapshot()
            .child,
        None
    );
    ps.close();
}

#[test]
#[cfg_attr(
    not(windows),
    ignore = "needs pwsh.exe on PATH; Windows runs powershell.exe"
)]
fn output_children_and_environment_cannot_forge_or_reveal_trusted_markers() {
    let manager = TerminalSessionManager::new();
    let ps = PowerShell::ready(&manager);
    let child = if cfg!(windows) {
        "powershell.exe"
    } else {
        "pwsh.exe"
    };
    let lines = [
        "Write-Output (\"$([char]27)]133;C;aid=forged;cmd=Zm9yZ2Vk$([char]7)\" + \"$([char]27)]133;D;0$([char]7)\")".to_string(),
        "Write-Output (\"$([char]27)]133;D;0;aid=$([char]7)\" + 'no-nonce')".to_string(),
        format!("{child} -NoLogo -NoProfile -Command \"Write-Output ('child' + '-ps')\""),
        "Write-Output ('env-' + (@(Get-ChildItem env: | Where-Object Name -like 'TRACERELAY_SHELL_NONCE').Count))".to_string(),
        "Get-ChildItem env: | Format-Table -AutoSize | Out-String -Width 4096".to_string(),
        "Write-Output ('cmdline-' + [Environment]::CommandLine)".to_string(),
        "Write-Output ('after' + '-spoof')".to_string(),
    ];
    for line in &lines {
        ps.run_and_wait(line);
    }
    ps.wait_for_text("child-ps");
    ps.wait_for_text("env-0");
    ps.wait_for_text("after-spoof");

    let text = ps.text();
    let mut without_trusted = text.clone();
    for fields in markers(&text) {
        if aid(&fields) == Some(ps.nonce.as_str()) {
            without_trusted = without_trusted.replacen(&fields.join(";"), "", 1);
        }
    }
    assert!(
        !without_trusted.contains(&ps.nonce),
        "nonce leaked into output"
    );
    // Exactly one trusted start and end per typed line: nothing from output or children.
    let commands = ps.commands();
    assert_eq!(commands.len(), lines.len() * 2, "{commands:?}");
    assert!(commands.iter().all(|m| !m.starts_with("C forged")));
    ps.close();
}

#[test]
#[cfg_attr(
    not(windows),
    ignore = "needs pwsh.exe on PATH; Windows runs powershell.exe"
)]
fn sessions_have_independent_credentials_and_lifecycles() {
    let manager = TerminalSessionManager::new();
    let first = PowerShell::ready(&manager);
    let second = PowerShell::ready(&manager);
    assert_ne!(first.nonce, second.nonce);

    first.run_and_wait("Write-Output ('first' + '-session')");
    second.run_and_wait(&native_exit(5));
    first.run_and_wait(&native_exit(6));

    assert_eq!(first.commands().len(), 4);
    assert_eq!(first.commands()[3], "D 6");
    assert_eq!(second.commands().len(), 2);
    assert_eq!(second.commands()[1], "D 5");
    for (ps, other) in [(&first, &second), (&second, &first)] {
        assert!(!ps.text().contains(&other.nonce));
        assert!(markers(&ps.text())
            .iter()
            .all(|fields| aid(fields) == Some(ps.nonce.as_str())));
    }
    first.close();
    second.close();
}

#[test]
#[cfg_attr(
    not(windows),
    ignore = "needs pwsh.exe on PATH; Windows runs powershell.exe"
)]
fn bootstrap_is_single_use_and_failed_bootstrap_degrades_to_untrusted_terminal() {
    let config = resolve_shell(shell_kind());
    let size = PtySize::default();
    for corrupt in [false, true] {
        let nonce = uuid::Uuid::new_v4().to_string();
        let (cmd, installed, bootstrap) = build_command(&config, None, Some(&nonce));
        let bootstrap = bootstrap.expect("PowerShell bootstrap");
        assert!(installed);
        let argv: Vec<_> = cmd.get_argv().iter().map(|a| a.to_string_lossy()).collect();
        assert!(
            argv.iter().all(|arg| !arg.contains(&nonce)),
            "nonce on command line"
        );
        assert_eq!(cmd.get_env("TRACERELAY_SHELL_NONCE"), None);
        assert!(std::fs::read_to_string(bootstrap.path())
            .unwrap()
            .contains(&nonce));
        if corrupt {
            std::fs::write(bootstrap.path(), "this is { not valid PowerShell").unwrap();
        }

        let backend = Arc::new(TerminalBackend::spawn(cmd, size).unwrap());
        let established = Arc::new(AtomicBool::new(false));
        let handshake = IntegrationHandshake::new(&nonce, Arc::clone(&established));
        let replier = Arc::clone(&backend);
        let reply = move |bytes: &[u8]| {
            let _ = replier.write(bytes);
        };
        let output = collect(backend.try_clone_reader().unwrap(), Some(handshake), reply);
        let wait_for = |needle: &str| {
            let deadline = Instant::now() + TIMEOUT;
            while !String::from_utf8_lossy(&output.lock().unwrap()).contains(needle) {
                assert!(
                    Instant::now() < deadline,
                    "terminal must stay usable: {needle}"
                );
                std::thread::sleep(Duration::from_millis(20));
            }
        };
        // The user's prompt is drawn with or without the integration.
        wait_for("PS ");
        backend
            .write(b"Write-Output ('terminal' + '-usable')\r")
            .unwrap();
        wait_for("terminal-usable");
        // The shell deleted the file when it read it, before any command ran.
        assert!(!bootstrap.path().exists());
        assert_eq!(established.load(Ordering::SeqCst), !corrupt);
        let text = String::from_utf8_lossy(&output.lock().unwrap()).into_owned();
        let trusted = markers(&text)
            .iter()
            .filter(|fields| aid(fields) == Some(nonce.as_str()))
            .count();
        assert_eq!(
            trusted == 0,
            corrupt,
            "no trusted lifecycle without the hooks"
        );
        backend.request_teardown();
    }
}

/// CROSSPLAT-004B real-app regression: the app's terminal is resized and xterm sends each
/// key separately. In a workspace directory, `Write-Output` and the `Get-ChildItem` forms
/// (`ls` is its alias on Windows, a native program elsewhere) must each be exactly one
/// trusted execution: start with the exact command and cwd, the output, then a closed end.
/// The raw stream (nonce redacted) is printed as evidence for `--nocapture` runs.
#[test]
#[cfg_attr(
    not(windows),
    ignore = "needs pwsh.exe on PATH; Windows runs powershell.exe"
)]
fn typed_basic_cmdlets_are_each_exactly_one_trusted_execution() {
    let manager = TerminalSessionManager::new();
    let ps = PowerShell::ready(&manager);
    manager
        .resize(ResizeTerminalInput {
            session_id: ps.id.clone(),
            cols: 120,
            rows: 40,
        })
        .unwrap();
    let dir = std::env::temp_dir().join(format!("execrelay-004b-ws-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("listed-file.txt"), "x").unwrap();
    let dir_text = dir.to_str().unwrap().to_string();
    ps.run_and_wait(&format!("Set-Location -LiteralPath '{dir_text}'"));

    for (line, output) in [
        ("Write-Output \"trusted-basic\"", "trusted-basic"),
        ("Get-ChildItem", "listed-file.txt"),
        ("ls", "listed-file.txt"),
    ] {
        let from = ps.output.lock().unwrap().len();
        let (ends, prompts) = (ps.count('D'), ps.count('A'));
        for key in line.bytes() {
            ps.write(&[key]);
            std::thread::sleep(Duration::from_millis(15));
        }
        ps.write(b"\r");
        ps.wait_for_ends(ends + 1);
        ps.wait_for_prompts(prompts + 1);

        let segment = String::from_utf8_lossy(&ps.output.lock().unwrap()[from..]).into_owned();
        eprintln!(
            "[004B trace] {line}: {:?}",
            segment.replace(&ps.nonce, "<nonce>")
        );
        let own: Vec<_> = markers(&segment)
            .into_iter()
            .filter(|fields| aid(fields) == Some(ps.nonce.as_str()))
            .map(|fields| render(&fields))
            .filter(|m| m.starts_with('C') || m.starts_with('D'))
            .collect();
        assert_eq!(own.len(), 2, "{line}: {own:?}");
        let (cmd, cwd) = own[0].rsplit_once('|').unwrap();
        assert_eq!(cmd, format!("C {line}"));
        assert!(same_directory(cwd, &dir), "{line}: cwd {cwd:?} vs {dir:?}");
        assert_eq!(own[1], "D 0", "{line}");
        let start = segment.find("\u{1b}]133;C;").unwrap();
        let end = segment.find("\u{1b}]133;D;").unwrap();
        assert!(
            segment[start..end].contains(output),
            "{line}: output must arrive between the trusted start and end"
        );
    }
    ps.close();
    std::fs::remove_dir_all(&dir).ok();
}

/// POWERSHELL-INTERRUPT-STATUS-001: Ctrl+C at any moment after the trusted start, including
/// while PowerShell is still resolving the command (auto-loading `Start-Sleep`'s module in a
/// fresh session, which leaves a `CommandNotFoundException`) or before any statement failed
/// (`$?` still true). The delays do not claim where the interrupt landed: PowerShell's own
/// history record for the submission must say `Stopped`, and then the end carries no status.
#[test]
#[cfg_attr(
    not(windows),
    ignore = "needs pwsh.exe on PATH; Windows runs powershell.exe"
)]
fn ctrl_c_at_any_point_of_a_cmdlet_never_reports_a_numeric_status() {
    for delay_ms in [0, 2, 4, 5, 10, 25, 100, 500] {
        let manager = TerminalSessionManager::new();
        let ps = PowerShell::ready(&manager);
        // Deliberately timer-based: early interrupts are what this test is about.
        let end = ps.interrupt(
            "Start-Sleep -Seconds 30",
            None,
            Duration::from_millis(delay_ms),
        );
        // While this next command runs, the last history entry is the interrupted one.
        // The literals are split so the echoed input never matches the output.
        ps.run_and_wait(
            "Write-Output ('hist' + 'ory-' + (Get-History -Count 1).ExecutionStatus + '-fin' + 'ish')",
        );
        let text = ps.text();
        let at = text.rfind("history-").unwrap() + 8;
        let status = &text[at..at + text[at..].find("-finish").unwrap()];
        assert_eq!(
            status, "Stopped",
            "PowerShell's record, Ctrl+C {delay_ms} ms after start"
        );
        assert_eq!(
            end, "D ?",
            "stopped pipeline, Ctrl+C {delay_ms} ms after start"
        );
        assert_eq!(ps.commands().last().unwrap(), "D 0");
        ps.close();
    }
}

/// A failed native command or cmdlet before the interrupted one must not lend it a status,
/// and the user's `$LASTEXITCODE` stays what the native command set.
#[test]
#[cfg_attr(
    not(windows),
    ignore = "needs pwsh.exe on PATH; Windows runs powershell.exe"
)]
fn interrupted_cmdlet_status_is_not_contaminated_by_earlier_failures() {
    let manager = TerminalSessionManager::new();
    let ps = PowerShell::ready(&manager);
    ps.run_and_wait(&native_exit(7));
    assert_eq!(ps.commands().last().unwrap(), "D 7");
    let end = ps.interrupt(SLEEP_AFTER_MARKER, Some("sleep-started"), Duration::ZERO);
    assert_eq!(end, "D ?", "stale $LASTEXITCODE 7 leaked");
    ps.run_and_wait("Get-Item Z:\\nope");
    assert_eq!(ps.commands().last().unwrap(), "D 1");
    let end = ps.interrupt(SLEEP_AFTER_MARKER, Some("sleep-started"), Duration::ZERO);
    assert_eq!(end, "D ?", "earlier cmdlet failure leaked");
    ps.run_and_wait("Write-Output ('lec-' + $LASTEXITCODE)");
    assert_eq!(ps.commands().last().unwrap(), "D 0");
    ps.wait_for_text("lec-7");
    ps.close();
}

/// An interrupted native program has a real exit code; it is reported as that code, never
/// replaced by the cmdlet rules, and the shell survives.
#[test]
#[cfg_attr(
    not(windows),
    ignore = "needs pwsh.exe on PATH; Windows runs powershell.exe"
)]
fn interrupted_native_program_reports_its_own_exit_code() {
    let manager = TerminalSessionManager::new();
    let ps = PowerShell::ready(&manager);
    // Interrupted once the program itself has printed, so it is the program that is stopped.
    let (program, started) = if cfg!(windows) {
        ("ping.exe -n 30 127.0.0.1", "Pinging")
    } else {
        (
            "sh -c 'echo native-$((1 + 1))-started; sleep 30'",
            "native-2-started",
        )
    };
    let end = ps.interrupt(program, Some(started), Duration::from_millis(200));
    ps.run_and_wait("Write-Output ('code-' + $LASTEXITCODE + '-end')");
    let text = ps.text();
    let at = text.rfind("code-").unwrap() + 5;
    let code = &text[at..at + text[at..].find("-end").unwrap()];
    assert!(code.parse::<i64>().is_ok(), "native exit code {code:?}");
    assert_eq!(end, format!("D {code}"));
    assert_eq!(ps.commands().last().unwrap(), "D 0");
    assert_eq!(
        manager
            .get_session_lifecycle(&ps.id)
            .unwrap()
            .snapshot()
            .child,
        None
    );
    ps.close();
}

/// POWERSHELL-INTERRUPT-STATUS-001, deterministic: the end-status rules themselves, run in
/// the integration's own module against PowerShell's history. A `Stopped` record for the
/// submission wins over `$?` (true or false): no status, unless the native exit code changed;
/// a `Completed` record leaves the ordinary rules (`$?` true -> 0, cmdlet failure -> 1).
#[test]
#[cfg_attr(
    not(windows),
    ignore = "needs pwsh.exe on PATH; Windows runs powershell.exe"
)]
fn end_status_rules_prefer_the_stopped_pipeline_state_over_dollar_question() {
    let manager = TerminalSessionManager::new();
    let ps = PowerShell::ready(&manager);
    // Each case: history status, $? at the prompt, $LASTEXITCODE before -> after.
    let cases = [
        ("Stopped", "$true", "$null", "$null", "[]"),
        ("Stopped", "$false", "$null", "$null", "[]"),
        ("Stopped", "$false", "3", "3", "[]"),
        ("Stopped", "$false", "$null", "130", "[;130]"),
        ("Stopped", "$true", "$null", "0", "[;0]"),
        ("Completed", "$true", "$null", "$null", "[;0]"),
        ("Completed", "$false", "$null", "7", "[;7]"),
    ];
    for (status, succeeded, before, after, expected) in cases {
        let line = format!(
            "& (${{function:prompt}}.Module) {{ \
             $script:startHistoryId = [int](Microsoft.PowerShell.Core\\Get-History -Count 1).Id; \
             $script:startExitCode = {before}; \
             Microsoft.PowerShell.Core\\Add-History -InputObject ([pscustomobject]@{{ \
             CommandLine = 'probe'; ExecutionStatus = '{status}'; \
             StartExecutionTime = [datetime]::Now; EndExecutionTime = [datetime]::Now }}); \
             Write-Output ('rule' + '-[' + (Get-ExecRelayEndStatus {succeeded} {after}) + ']-' + 'done') }}"
        );
        ps.run_and_wait(&line);
        let text = ps.text();
        let at = text.rfind("rule-").unwrap() + 5;
        let got = &text[at..at + text[at..].find("-done").unwrap()];
        assert_eq!(
            got, expected,
            "{status} / $? {succeeded} / {before} -> {after}"
        );
    }
    ps.close();
}
