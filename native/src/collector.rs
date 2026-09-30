//! Safe non-interactive subprocess command runner for read-only evidence collectors.
//!
//! # Security & Policy Invariants
//! 1. Strictly structured invocation: takes exact executable and argument vector.
//! 2. Absolutely NO shell interpolation, `sh -c`, or command concatenation.
//! 3. Strictly limited to approved read-only programs (`git`).
//! 4. Mutating subcommands (commit, push, checkout, reset, clean, etc.) are strictly forbidden.
//! 5. Output captures are bounded to prevent memory exhaustion.
//! 6. Execution duration is measured and returned alongside exact OS exit status.

use crate::error::{Result, TerminalError};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use std::time::Instant;

/// Maximum output size in bytes captured from collector stdout/stderr (4 MiB).
pub const MAX_COLLECTOR_OUTPUT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CollectorCommandInput {
    pub program: String,
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CollectorCommandOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

const ALLOWED_PROGRAMS: &[&str] = &["git"];

const ALLOWED_GIT_SUBCOMMANDS: &[&str] = &[
    "status",
    "diff",
    "rev-parse",
    "branch",
    "log",
    "show",
    "version",
];

const DISALLOWED_MUTATING_KEYWORDS: &[&str] = &[
    "commit", "push", "pull", "checkout", "reset", "clean", "stash", "rebase",
    "merge", "cherry-pick", "revert", "tag", "clone", "init", "config",
];

/// Validates that a requested collector command complies with read-only security invariants.
pub fn validate_collector_command(input: &CollectorCommandInput) -> Result<()> {
    if !ALLOWED_PROGRAMS.contains(&input.program.as_str()) {
        return Err(TerminalError::SecurityPolicyViolation(format!(
            "Program '{}' is not permitted for evidence collection",
            input.program
        )));
    }

    if input.program == "git" {
        if input.args.is_empty() {
            return Err(TerminalError::SecurityPolicyViolation(
                "Git collector command requires a subcommand".to_string(),
            ));
        }

        let first_arg = input.args[0].as_str();
        if !ALLOWED_GIT_SUBCOMMANDS.contains(&first_arg) {
            return Err(TerminalError::SecurityPolicyViolation(format!(
                "Git subcommand '{}' is not permitted for evidence collection",
                first_arg
            )));
        }

        for arg in &input.args {
            let lower = arg.to_lowercase();
            let stripped = lower.trim_start_matches('-');
            for disallowed in DISALLOWED_MUTATING_KEYWORDS {
                if &lower == disallowed
                    || stripped == *disallowed
                    || lower.starts_with(&format!("{disallowed}="))
                    || stripped.starts_with(&format!("{disallowed}="))
                {
                    return Err(TerminalError::SecurityPolicyViolation(format!(
                        "Mutating keyword '{disallowed}' is forbidden in collector execution"
                    )));
                }
            }
        }
    }

    if let Some(ref cwd) = input.cwd {
        let p = Path::new(cwd);
        if !p.is_dir() {
            return Err(TerminalError::InvalidDirectory(cwd.clone()));
        }
    }

    Ok(())
}

/// Executes a validated read-only collector subprocess without shell interpolation.
#[tauri::command]
pub fn collector_run_command(input: CollectorCommandInput) -> Result<CollectorCommandOutput> {
    validate_collector_command(&input)?;

    let start = Instant::now();
    let mut cmd = Command::new(&input.program);
    cmd.args(&input.args);

    if let Some(ref cwd) = input.cwd {
        cmd.current_dir(cwd);
    }

    let output = cmd.output().map_err(|e| {
        TerminalError::CollectorExecutionFailed(format!("Failed to execute '{}': {e}", input.program))
    })?;

    let duration_ms = start.elapsed().as_millis() as u64;

    let stdout_bytes = if output.stdout.len() > MAX_COLLECTOR_OUTPUT_BYTES {
        &output.stdout[..MAX_COLLECTOR_OUTPUT_BYTES]
    } else {
        &output.stdout
    };

    let stderr_bytes = if output.stderr.len() > MAX_COLLECTOR_OUTPUT_BYTES {
        &output.stderr[..MAX_COLLECTOR_OUTPUT_BYTES]
    } else {
        &output.stderr
    };

    let stdout = String::from_utf8_lossy(stdout_bytes).to_string();
    let stderr = String::from_utf8_lossy(stderr_bytes).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    Ok(CollectorCommandOutput {
        exit_code,
        stdout,
        stderr,
        duration_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_allowed_git_commands() {
        assert!(validate_collector_command(&CollectorCommandInput {
            program: "git".into(),
            args: vec!["status".into(), "--porcelain=v1".into(), "-z".into()],
            cwd: None,
        })
        .is_ok());

        assert!(validate_collector_command(&CollectorCommandInput {
            program: "git".into(),
            args: vec!["rev-parse".into(), "--show-toplevel".into()],
            cwd: None,
        })
        .is_ok());

        assert!(validate_collector_command(&CollectorCommandInput {
            program: "git".into(),
            args: vec!["diff".into(), "--numstat".into()],
            cwd: None,
        })
        .is_ok());
    }

    #[test]
    fn test_validate_disallowed_programs() {
        assert!(matches!(
            validate_collector_command(&CollectorCommandInput {
                program: "sh".into(),
                args: vec!["-c".into(), "git status".into()],
                cwd: None,
            }),
            Err(TerminalError::SecurityPolicyViolation(_))
        ));

        assert!(matches!(
            validate_collector_command(&CollectorCommandInput {
                program: "bash".into(),
                args: vec!["status".into()],
                cwd: None,
            }),
            Err(TerminalError::SecurityPolicyViolation(_))
        ));
    }

    #[test]
    fn test_validate_disallowed_mutating_git_commands() {
        assert!(matches!(
            validate_collector_command(&CollectorCommandInput {
                program: "git".into(),
                args: vec!["commit".into(), "-m".into(), "test".into()],
                cwd: None,
            }),
            Err(TerminalError::SecurityPolicyViolation(_))
        ));

        assert!(matches!(
            validate_collector_command(&CollectorCommandInput {
                program: "git".into(),
                args: vec!["push".into(), "origin".into(), "main".into()],
                cwd: None,
            }),
            Err(TerminalError::SecurityPolicyViolation(_))
        ));

        assert!(matches!(
            validate_collector_command(&CollectorCommandInput {
                program: "git".into(),
                args: vec!["checkout".into(), "main".into()],
                cwd: None,
            }),
            Err(TerminalError::SecurityPolicyViolation(_))
        ));
    }
}
