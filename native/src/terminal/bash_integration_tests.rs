//! Real-PTY tests for trusted Bash shell lifecycle integration (macOS and Linux).
//!
//! These tests check what real Bash emits through the production command builder and
//! backend; they never print the nonce.

use crate::platform::terminal::{InterruptObservation, TerminalBackend};
use crate::terminal::manager::TerminalSessionManager;
use crate::terminal::osc133_test_support::{aid, markers, render};
use crate::terminal::shell::{
    build_command, resolve_shell_internal, IntegrationHandshake, ShellBootstrap,
};
use crate::terminal::types::{CloseTerminalSessionInput, CreateTerminalSessionInput, ShellKind};
use portable_pty::PtySize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(10);

/// A Bash session plus its PTY output, through the manager or (for custom `HOME`
/// fixtures) through `build_command` + `TerminalBackend` directly.
struct Bash {
    nonce: String,
    output: Arc<Mutex<Vec<u8>>>,
    manager: Option<(TerminalSessionManager, String)>,
    backend: Option<TerminalBackend>,
    bootstrap: Option<PathBuf>,
    _bootstrap_guard: Option<ShellBootstrap>,
    /// Handshake flag for backend-only sessions (manager sessions report it in info).
    established: Arc<AtomicBool>,
}

impl Bash {
    fn spawn(manager: &TerminalSessionManager) -> Self {
        let info = manager
            .create_session(CreateTerminalSessionInput {
                shell_kind: Some(ShellKind::Bash),
                ..Default::default()
            })
            .expect("failed to spawn Bash");
        // Truthful availability: installed but not yet confirmed by a handshake.
        assert!(info.shell_integration_pending && !info.shell_integration_available);
        let reader = manager.get_session_reader(&info.session_id).unwrap();
        let handshake = manager
            .get_session_integration_handshake(&info.session_id)
            .unwrap();
        Self {
            nonce: info.integration_nonce.unwrap(),
            output: collect(reader, handshake),
            manager: Some((manager.clone(), info.session_id)),
            backend: None,
            bootstrap: None,
            _bootstrap_guard: None,
            established: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Spawns integrated Bash with `HOME` pointing at a fixture, optionally replacing the
    /// bootstrap content to simulate broken bootstrap material.
    fn spawn_with_home(home: &Path, corrupt_bootstrap: bool) -> Self {
        let nonce = uuid::Uuid::new_v4().to_string();
        let config = resolve_shell_internal(Some(ShellKind::Bash), None);
        let (mut cmd, available, guard) = build_command(&config, None, Some(&nonce));
        assert!(available);
        let guard = guard.unwrap();
        if corrupt_bootstrap {
            std::fs::write(guard.path(), "if then fi ((\n").unwrap();
        }
        cmd.env("HOME", home);
        let backend = TerminalBackend::spawn(cmd, PtySize::default()).unwrap();
        let established = Arc::new(AtomicBool::new(false));
        let handshake = IntegrationHandshake::new(&nonce, Arc::clone(&established));
        Self {
            nonce,
            output: collect(backend.try_clone_reader().unwrap(), Some(handshake)),
            established,
            manager: None,
            bootstrap: Some(guard.path().to_path_buf()),
            backend: Some(backend),
            _bootstrap_guard: Some(guard),
        }
    }

    /// Whether ExecRelay currently reports trusted integration as available.
    fn available(&self) -> bool {
        match &self.manager {
            Some((manager, id)) => {
                manager
                    .session_info(id)
                    .unwrap()
                    .shell_integration_available
            }
            None => self.established.load(Ordering::SeqCst),
        }
    }

    fn write(&self, bytes: &[u8]) {
        match (&self.manager, &self.backend) {
            (Some((manager, id)), _) => manager.write_bytes(id, bytes).unwrap(),
            (_, Some(backend)) => backend.write(bytes).unwrap(),
            _ => unreachable!(),
        }
    }

    fn run(&self, line: &str) {
        self.write(format!("{line}\r").as_bytes());
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

    fn wait_until(&self, what: &str, condition: impl Fn(&Self) -> bool) {
        let deadline = Instant::now() + TIMEOUT;
        while !condition(self) {
            assert!(
                Instant::now() < deadline,
                "timed out waiting for {what}; trusted: {:?}",
                self.trusted()
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn wait_for_ends(&self, count: usize) {
        self.wait_until(&format!("{count} trusted command ends"), |bash| {
            bash.trusted().iter().filter(|m| m.starts_with('D')).count() >= count
        });
    }

    fn wait_for_text(&self, needle: &str) {
        self.wait_until(needle, |bash| bash.text().contains(needle));
    }

    /// Trusted command starts and ends after the handshake, ignoring prompt markers.
    fn commands(&self) -> Vec<String> {
        self.trusted()
            .into_iter()
            .filter(|m| m.starts_with('C') || m.starts_with('D'))
            .collect()
    }

    fn close(&self) {
        if let Some((manager, id)) = &self.manager {
            manager
                .close(CloseTerminalSessionInput {
                    session_id: id.clone(),
                })
                .unwrap();
        }
        if let Some(backend) = &self.backend {
            backend.request_teardown();
        }
    }
}

/// Mirrors the production reader: raw output plus handshake observation.
fn collect(
    mut reader: Box<dyn Read + Send>,
    mut handshake: Option<IntegrationHandshake>,
) -> Arc<Mutex<Vec<u8>>> {
    let output = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&output);
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n @ 1..) = reader.read(&mut buf) {
            if let Some(handshake) = handshake.as_mut() {
                handshake.observe(&buf[..n]);
            }
            sink.lock().unwrap().extend_from_slice(&buf[..n]);
        }
    });
    output
}

/// Bash >= 4.4 marks lines with PS0 (including bare subshells); older Bash uses DEBUG.
fn bash_has_ps0() -> bool {
    let out = std::process::Command::new("/bin/bash")
        .args([
            "-c",
            "(( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) ))",
        ])
        .status()
        .unwrap();
    out.success()
}

fn handshake(bash: &Bash) {
    bash.wait_until("trusted handshake", |bash| {
        bash.trusted().iter().any(|m| m.starts_with("P version="))
    });
    bash.wait_until("integration available", Bash::available);
    bash.wait_until("first trusted prompt", |bash| {
        bash.trusted().iter().any(|m| m == "A")
    });
}

fn temp_home(files: &[(&str, &str)]) -> PathBuf {
    let home = std::env::temp_dir().join(format!("execrelay-bash-home-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&home).unwrap();
    for (name, contents) in files {
        std::fs::write(home.join(name), contents).unwrap();
    }
    home
}

#[test]
fn handshake_is_the_first_trusted_marker_and_occurs_once() {
    let manager = TerminalSessionManager::new();
    let bash = Bash::spawn(&manager);
    handshake(&bash);
    let info = manager
        .session_info(&bash.manager.as_ref().unwrap().1)
        .unwrap();
    assert!(info.shell_integration_available && !info.shell_integration_pending);
    bash.run("true");
    bash.wait_for_ends(1);

    let trusted = bash.trusted();
    assert!(trusted[0].starts_with("P version="), "{trusted:?}");
    assert_eq!(
        trusted
            .iter()
            .filter(|m| m.starts_with("P version="))
            .count(),
        1
    );
    bash.close();
}

#[test]
fn trusted_lifecycle_reports_command_status_and_continues_after_failure() {
    let manager = TerminalSessionManager::new();
    let bash = Bash::spawn(&manager);
    handshake(&bash);
    let cwd = {
        bash.run("true");
        bash.wait_for_ends(1);
        bash.commands()[0].split('|').nth(1).unwrap().to_string()
    };

    for line in [
        "echo linux-trusted-one",
        "false",
        "echo linux-trusted-after-failure",
        "echo one && echo two",
        "false || echo recovered",
        r"printf 'a\nb\n' | grep b",
        r"printf 'a\n' | grep zzz",
        r#"for i in 1 2; do echo "$i"; done"#,
        "function er_test_fn(){ echo function-ok; }; er_test_fn",
        "sh -c 'exit 7'",
        "x=$(echo sub); echo \"$x\"",
    ] {
        bash.run(line);
    }
    bash.wait_for_ends(12);
    bash.wait_for_text("function-ok");

    let expected: Vec<String> = [
        ("true", 0),
        ("echo linux-trusted-one", 0),
        ("false", 1),
        ("echo linux-trusted-after-failure", 0),
        ("echo one && echo two", 0),
        ("false || echo recovered", 0),
        (r"printf 'a\nb\n' | grep b", 0),
        (r"printf 'a\n' | grep zzz", 1),
        (r#"for i in 1 2; do echo "$i"; done"#, 0),
        ("function er_test_fn(){ echo function-ok; }; er_test_fn", 0),
        ("sh -c 'exit 7'", 7),
        ("x=$(echo sub); echo \"$x\"", 0),
    ]
    .iter()
    .flat_map(|(cmd, status)| [format!("C {cmd}|{cwd}"), format!("D {status}")])
    .collect();
    assert_eq!(bash.commands(), expected);
    bash.close();
}

#[test]
fn trusted_lifecycle_covers_multiline_heredoc_paste_and_subshell() {
    let manager = TerminalSessionManager::new();
    let bash = Bash::spawn(&manager);
    handshake(&bash);

    bash.write(b"if true; then\recho multi\rfi\r");
    bash.write(b"cat <<'EOF'\rhere-doc-body\rEOF\r");
    // One paste containing two command lines.
    bash.write(b"echo pasted-one\recho pasted-two\r");
    bash.wait_for_ends(4);
    if bash_has_ps0() {
        bash.run("( echo subshell-ok )");
        bash.run("(exit 7)");
        bash.wait_for_ends(6);
    }

    let commands = bash.commands();
    let starts: Vec<_> = commands
        .iter()
        .filter_map(|m| m.strip_prefix("C "))
        .map(|m| m.split('|').next().unwrap())
        .collect();
    let ends: Vec<_> = commands.iter().filter(|m| m.starts_with('D')).collect();
    assert_eq!(starts[0], "if true; then echo multi; fi");
    assert!(starts[1].starts_with("cat <<'EOF'"));
    assert_eq!(&starts[2..4], ["echo pasted-one", "echo pasted-two"]);
    assert_eq!(&ends[..4], ["D 0", "D 0", "D 0", "D 0"]);
    if bash_has_ps0() {
        assert_eq!(&starts[4..], ["( echo subshell-ok )", "(exit 7)"]);
        assert_eq!(&ends[4..], ["D 0", "D 7"]);
    }
    assert_eq!(starts.len(), ends.len(), "one end per start: {commands:?}");
    bash.close();
}

#[test]
fn trusted_cwd_follows_the_shell() {
    let spaced = std::env::temp_dir().join(format!("execrelay bash cwd {}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&spaced).unwrap();
    let manager = TerminalSessionManager::new();
    let bash = Bash::spawn(&manager);
    handshake(&bash);

    bash.run("cd /tmp");
    bash.run("pwd");
    bash.run(&format!("cd '{}'", spaced.display()));
    bash.run("pwd");
    bash.wait_for_ends(4);

    let cwds: Vec<String> = bash
        .commands()
        .iter()
        .filter_map(|m| m.strip_prefix("C "))
        .map(|m| m.split('|').nth(1).unwrap().to_string())
        .collect();
    assert_eq!(cwds[1], "/tmp");
    assert_eq!(cwds[2], "/tmp");
    assert_eq!(cwds[3], spaced.display().to_string());
    bash.close();
    std::fs::remove_dir_all(&spaced).unwrap();
}

#[test]
fn ctrl_c_ends_the_trusted_command_and_the_shell_survives() {
    let manager = TerminalSessionManager::new();
    let bash = Bash::spawn(&manager);
    handshake(&bash);
    bash.run("sleep 30");
    bash.wait_until("sleep start", |bash| {
        bash.commands().iter().any(|m| m.starts_with("C sleep 30"))
    });
    std::thread::sleep(Duration::from_millis(300));

    let (manager_ref, id) = bash.manager.as_ref().unwrap();
    manager_ref.write_bytes(id, &[0x03]).unwrap();
    bash.wait_for_ends(1);
    let lifecycle = manager_ref.get_session_lifecycle(id).unwrap();
    assert_eq!(
        lifecycle.snapshot().interrupt.observation,
        InterruptObservation::Unknown
    );
    assert_eq!(lifecycle.snapshot().child, None);

    bash.run("echo shell-still-alive");
    bash.wait_for_ends(2);
    let commands = bash.commands();
    assert_eq!(commands[1], "D 130");
    assert!(commands[2].starts_with("C echo shell-still-alive|"));
    assert_eq!(commands[3], "D 0");
    bash.close();
}

/// Regression for the CROSSPLAT-003A finding: the nonce was exported to every child and
/// child `bash -c` sourced the hooks and emitted nonce-tagged markers.
#[test]
fn children_cannot_obtain_the_nonce_or_emit_trusted_markers() {
    let manager = TerminalSessionManager::new();
    let bash = Bash::spawn(&manager);
    handshake(&bash);

    let lines = [
        r#"sh -c 'printf "env-nonce-[%s]\n" "$(printenv TRACERELAY_SHELL_NONCE)"'"#,
        "env | grep -c TRACERELAY_SHELL_NONCE",
        "bash -c 'echo child-bash'",
        r#"bash -c 'printf "child-osc-%s\n" done; printf "\033]133;D;0\007"'"#,
        r"printf '\033]133;C;aid=forged-nonce;cmd=Zm9yZ2Vk\007\033]133;D;0\007'",
        "echo after-spoof",
    ];
    for line in lines {
        bash.run(line);
    }
    bash.wait_for_ends(lines.len());
    bash.wait_for_text("after-spoof");
    #[cfg(target_os = "linux")]
    {
        // The nonce is not in the shell's initial environment either (/proc/<pid>/environ).
        bash.run(r#"printf 'environ-%s\n' "$(tr '\0' '\n' < /proc/$$/environ | grep -c TRACERELAY_SHELL_NONCE)""#);
        bash.wait_for_ends(lines.len() + 1);
        bash.wait_for_text("environ-0");
    }

    let text = bash.text();
    assert!(text.contains("env-nonce-[]"));
    assert!(text.contains("child-bash") && text.contains("child-osc-done"));
    assert!(
        !text.contains("bind: warning"),
        "child bash must not load the hooks"
    );
    // The nonce appears nowhere except inside the shell's own trusted markers.
    let mut without_trusted = text.clone();
    for fields in markers(&text) {
        if aid(&fields) == Some(bash.nonce.as_str()) {
            without_trusted = without_trusted.replacen(&fields.join(";"), "", 1);
        }
    }
    assert!(
        !without_trusted.contains(&bash.nonce),
        "nonce leaked into output"
    );
    // Exactly one trusted start and end per typed line: nothing from children or spoofs.
    let commands = bash.commands();
    let starts = commands.iter().filter(|m| m.starts_with('C')).count();
    let ends = commands.iter().filter(|m| m.starts_with('D')).count();
    assert_eq!((starts, ends), (commands.len() / 2, commands.len() / 2));
    assert!(commands.iter().all(|m| !m.starts_with("C forged")));
    bash.close();
}

#[test]
fn sessions_have_independent_credentials() {
    let manager = TerminalSessionManager::new();
    let sessions: Vec<Bash> = (0..3).map(|_| Bash::spawn(&manager)).collect();
    for bash in &sessions {
        handshake(bash);
    }
    assert_ne!(sessions[0].nonce, sessions[1].nonce);
    assert_ne!(sessions[1].nonce, sessions[2].nonce);
    assert_ne!(sessions[0].nonce, sessions[2].nonce);

    // Replay A's credential inside B: it is A's marker, so B treats it as untrusted.
    let a_nonce = sessions[0].nonce.clone();
    sessions[1].run(&format!(r"printf '\033]133;C;aid=%s\007' '{a_nonce}'"));
    for (i, bash) in sessions.iter().enumerate() {
        bash.run(&format!("echo session-{i}"));
    }
    // B ran one extra command line (the replay).
    let extra = |i: usize| usize::from(i == 1);
    for (i, bash) in sessions.iter().enumerate() {
        bash.wait_for_ends(1 + extra(i));
    }
    sessions[0].close();
    for (i, bash) in sessions.iter().enumerate().skip(1) {
        bash.run(&format!("echo session-{i}-after-close"));
        bash.wait_for_ends(2 + extra(i));
    }

    for (i, bash) in sessions.iter().enumerate() {
        let starts: Vec<_> = bash
            .commands()
            .into_iter()
            .filter(|m| m.starts_with('C'))
            .collect();
        assert!(starts
            .iter()
            .all(|m| m.contains(&format!("session-{i}")) || m.contains("printf")));
        assert!(!bash
            .text()
            .contains(&format!("echo session-{}", (i + 1) % 3)));
    }
    let b_starts = sessions[1]
        .commands()
        .iter()
        .filter(|m| m.starts_with('C'))
        .count();
    assert_eq!(
        b_starts, 3,
        "replayed A marker must not add a trusted start in B"
    );
    for bash in &sessions[1..] {
        bash.close();
    }
}

#[test]
fn user_startup_files_prompt_command_debug_trap_and_aliases_are_preserved() {
    let home = temp_home(&[
        (".bash_profile", ". ~/.bashrc\n"),
        (
            ".bashrc",
            "touch \"$HOME/bashrc-ran\"\n\
             PS1='custom-prompt> '\n\
             PROMPT_COMMAND='_u_status=$?; _u_prompts=$((${_u_prompts:-0}+1))'\n\
             trap '_u_debug=$((${_u_debug:-0}+1))' DEBUG\n\
             alias er_alias='echo alias-ok'\n\
             trap 'echo user-int-trap-ran' INT\n",
        ),
    ]);
    let bash = Bash::spawn_with_home(&home, false);
    handshake(&bash);
    assert!(
        !bash.bootstrap.as_ref().unwrap().exists(),
        "bootstrap must self-delete"
    );
    assert!(home.join("bashrc-ran").exists());

    bash.run("false");
    bash.run(r#"printf 'user-pc-saw-%s\n' "$_u_status""#);
    bash.run(r#"printf 'user-debug-ran-%s\n' "$(( ${_u_debug:-0} > 0 ))""#);
    bash.run("er_alias");
    bash.run(r#"printf 'hooks-%s\n' "$(declare -p PROMPT_COMMAND | grep -o _tracerelay_prompt_start | wc -l | tr -d ' ')""#);
    bash.wait_for_ends(5);
    bash.wait_for_text("hooks-1");

    let text = bash.text();
    assert!(text.contains("custom-prompt> "));
    assert!(text.contains("user-pc-saw-1"));
    assert!(text.contains("user-debug-ran-1"));
    assert!(text.contains("alias-ok"));
    assert_eq!(
        bash.commands()
            .iter()
            .filter(|m| m.starts_with('C'))
            .count(),
        5,
        "one trusted start per command, no phantom starts from user PROMPT_COMMAND"
    );

    // Plain interactive Bash runs an INT trap on Ctrl+C at the prompt; that still
    // happens, and an abandoned line creates no command start or end.
    bash.write(b"partial-line");
    std::thread::sleep(Duration::from_millis(300));
    bash.write(&[0x03]);
    bash.wait_for_text("user-int-trap-ran");
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(bash.commands().len(), 10, "{:?}", bash.commands());
    bash.close();
    std::fs::remove_dir_all(&home).unwrap();
}

#[test]
fn integration_without_user_startup_files_and_with_array_prompt_command() {
    let empty = temp_home(&[]);
    let bash = Bash::spawn_with_home(&empty, false);
    handshake(&bash);
    bash.run("true");
    bash.wait_for_ends(1);
    bash.close();

    if bash_has_ps0() {
        let home = temp_home(&[(
            ".bash_profile",
            "PROMPT_COMMAND=('_u_first=$?' '_u_second=1')\nPS0='user-ps0-ran\\n'\n",
        )]);
        let bash = Bash::spawn_with_home(&home, false);
        handshake(&bash);
        bash.run("false");
        bash.run(r#"printf 'array-pc-%s-%s\n' "$_u_first" "$_u_second""#);
        bash.wait_for_ends(2);
        bash.wait_for_text("array-pc-1-1");
        assert!(
            bash.text().contains("user-ps0-ran"),
            "user PS0 must still be shown"
        );
        assert_eq!(bash.commands()[1], "D 1");
        bash.close();
        std::fs::remove_dir_all(&home).unwrap();
    }
    std::fs::remove_dir_all(&empty).unwrap();
}

#[test]
fn failed_integration_degrades_to_an_untrusted_working_terminal() {
    // Hooks cannot be installed (readonly PROMPT_COMMAND): no trusted marker at all.
    let home = temp_home(&[(".bash_profile", "readonly PROMPT_COMMAND='true'\n")]);
    let bash = Bash::spawn_with_home(&home, false);
    bash.run(r"printf '%s-%s\n' readonly terminal-works");
    bash.wait_for_text("readonly-terminal-works");
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(bash.trusted(), Vec::<String>::new());
    assert!(!bash.available());
    bash.close();

    // Invalid bootstrap material: Bash still starts, nothing is trusted.
    let bash = Bash::spawn_with_home(&home, true);
    bash.run(r"printf '%s-%s\n' corrupt terminal-works");
    bash.wait_for_text("corrupt-terminal-works");
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(bash.trusted(), Vec::<String>::new());
    assert!(!bash.available());
    bash.close();
    std::fs::remove_dir_all(&home).unwrap();

    // Unusable nonce: integration is reported unavailable and the shell is plain Bash.
    let manager = TerminalSessionManager::new();
    let info = manager
        .create_session(CreateTerminalSessionInput {
            shell_kind: Some(ShellKind::Bash),
            integration_nonce: Some("not a safe nonce".into()),
            ..Default::default()
        })
        .unwrap();
    assert!(!info.shell_integration_available && !info.shell_integration_pending);
    manager
        .close(CloseTerminalSessionInput {
            session_id: info.session_id,
        })
        .unwrap();
}

#[test]
fn natural_exit_adds_no_command_end() {
    let manager = TerminalSessionManager::new();
    let bash = Bash::spawn(&manager);
    handshake(&bash);
    let (manager_ref, id) = bash.manager.as_ref().unwrap();
    let lifecycle = manager_ref.get_session_lifecycle(id).unwrap();
    bash.run("exit");
    bash.wait_until("child exit", |_| lifecycle.snapshot().child.is_some());
    std::thread::sleep(Duration::from_millis(300));

    let commands = bash.commands();
    assert_eq!(commands.len(), 1, "{commands:?}");
    assert!(commands[0].starts_with("C exit|"));
}

#[test]
fn repeated_sessions_handshake_once_with_fresh_credentials() {
    let manager = TerminalSessionManager::new();
    let mut nonces = std::collections::HashSet::new();
    for cycle in 0..20 {
        let bash = Bash::spawn(&manager);
        handshake(&bash);
        bash.run(&format!("echo cycle-{cycle}"));
        bash.wait_for_ends(1);
        let handshakes = bash
            .trusted()
            .iter()
            .filter(|m| m.starts_with("P version="))
            .count();
        assert_eq!(handshakes, 1);
        assert!(nonces.insert(bash.nonce.clone()), "credential reused");
        bash.close();
    }
    assert!(manager.list_sessions().is_empty());
}

/// `--rcfile` makes Bash non-login, so the bootstrap emulates login startup. User files
/// must be chosen exactly as `bash -l` chooses them, each sourced once.
#[test]
fn login_startup_files_match_bash_login_selection_and_run_once() {
    let log = "printf '%s\\n' \"$1\" >> \"$HOME/startup.log\"";
    for files in [
        &[".bash_profile", ".bash_login", ".profile"][..],
        &[".bash_login", ".profile"][..],
        &[".profile"][..],
    ] {
        let fixture: Vec<(String, String)> = files
            .iter()
            .map(|name| {
                let extra = if *name == ".bash_profile" {
                    ". ~/.bashrc\n"
                } else {
                    ""
                };
                (name.to_string(), format!("set -- {name}; {log}\n{extra}"))
            })
            .chain([(".bashrc".to_string(), format!("set -- .bashrc; {log}\n"))])
            .collect();
        let refs: Vec<(&str, &str)> = fixture
            .iter()
            .map(|(n, c)| (n.as_str(), c.as_str()))
            .collect();
        let reference = temp_home(&refs);
        let status = std::process::Command::new("/bin/bash")
            .args(["-l", "-c", "true"])
            .env("HOME", &reference)
            .status()
            .unwrap();
        assert!(status.success());
        let expected = std::fs::read_to_string(reference.join("startup.log")).unwrap();

        let home = temp_home(&refs);
        let bash = Bash::spawn_with_home(&home, false);
        handshake(&bash);
        let actual = std::fs::read_to_string(home.join("startup.log")).unwrap();
        assert_eq!(actual, expected, "startup files for {files:?}");
        bash.close();
        std::fs::remove_dir_all(&reference).unwrap();
        std::fs::remove_dir_all(&home).unwrap();
    }
}
