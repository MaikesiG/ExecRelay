//! Shell detection, resolution, and command builder for TraceRelay.
//!
//! # Shell Selection Policy
//! - **macOS**: Use `$SHELL` if set and non-empty; otherwise fallback to `/bin/zsh`.
//! - **Windows**: Documented search order:
//!   1. `powershell.exe` (built-in Windows PowerShell)
//!   2. `pwsh.exe` (cross-platform PowerShell Core if explicitly requested or configured)
//!   3. `cmd.exe` (legacy Command Prompt if explicitly requested)
//! - **Other Unix (Linux/BSD)**: Use `$SHELL` if set and non-empty; otherwise fallback to `/bin/sh`.
//!
//! Interactive login shells (`-l`) are spawned by default on Unix platforms.

use crate::terminal::types::ShellKind;
use portable_pty::CommandBuilder;
use std::env;
use std::path::{Path, PathBuf};

/// Resolved shell executable, flavor kind, and startup arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellConfig {
    pub executable: String,
    pub shell_kind: ShellKind,
    pub args: Vec<String>,
}

/// Resolves the shell configuration based on optional user input and system environment.
pub fn resolve_shell(requested: Option<ShellKind>) -> ShellConfig {
    resolve_shell_internal(requested, env::var("SHELL").ok())
}

/// Internal shell resolution parameterized with `env_shell` for deterministic testing.
pub fn resolve_shell_internal(
    requested: Option<ShellKind>,
    env_shell: Option<String>,
) -> ShellConfig {
    // If an explicit recognized shell kind was provided (other than Default), use it:
    if let Some(kind) = requested {
        if kind != ShellKind::Default {
            return match kind {
                ShellKind::Zsh => ShellConfig {
                    executable: "/bin/zsh".to_string(),
                    shell_kind: ShellKind::Zsh,
                    args: vec!["-l".to_string()],
                },
                ShellKind::Bash => ShellConfig {
                    executable: "/bin/bash".to_string(),
                    shell_kind: ShellKind::Bash,
                    args: vec!["-l".to_string()],
                },
                ShellKind::Sh => ShellConfig {
                    executable: "/bin/sh".to_string(),
                    shell_kind: ShellKind::Sh,
                    args: vec!["-l".to_string()],
                },
                ShellKind::Powershell => ShellConfig {
                    executable: "powershell.exe".to_string(),
                    shell_kind: ShellKind::Powershell,
                    args: vec!["-NoLogo".to_string()],
                },
                ShellKind::Pwsh => ShellConfig {
                    executable: "pwsh.exe".to_string(),
                    shell_kind: ShellKind::Pwsh,
                    args: vec!["-NoLogo".to_string()],
                },
                ShellKind::Cmd => ShellConfig {
                    executable: "cmd.exe".to_string(),
                    shell_kind: ShellKind::Cmd,
                    args: vec![],
                },
                ShellKind::Default => unreachable!(),
            };
        }
    }

    #[cfg(target_os = "macos")]
    {
        let (path, kind) = match env_shell.filter(|s| !s.trim().is_empty()) {
            Some(s) => {
                let k = detect_shell_kind(&s);
                (s, k)
            }
            None => ("/bin/zsh".to_string(), ShellKind::Zsh),
        };
        ShellConfig {
            executable: path,
            shell_kind: kind,
            args: vec!["-l".to_string()],
        }
    }

    #[cfg(target_os = "windows")]
    {
        let _ = env_shell; // Unused on Windows default path
        ShellConfig {
            executable: "powershell.exe".to_string(),
            shell_kind: ShellKind::Powershell,
            args: vec!["-NoLogo".to_string()],
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let (path, kind) = match env_shell.filter(|s| !s.trim().is_empty()) {
            Some(s) => {
                let k = detect_shell_kind(&s);
                (s, k)
            }
            None => ("/bin/sh".to_string(), ShellKind::Sh),
        };
        ShellConfig {
            executable: path,
            shell_kind: kind,
            args: vec!["-l".to_string()],
        }
    }
}

/// Detects `ShellKind` from an executable file path.
pub fn detect_shell_kind(path: &str) -> ShellKind {
    let lower = path.to_lowercase();
    let file_name = Path::new(&lower)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("");

    match file_name {
        "zsh" => ShellKind::Zsh,
        "bash" => ShellKind::Bash,
        "powershell.exe" | "powershell" => ShellKind::Powershell,
        "pwsh.exe" | "pwsh" => ShellKind::Pwsh,
        "cmd.exe" | "cmd" => ShellKind::Cmd,
        "sh" => ShellKind::Sh,
        _ => ShellKind::Default,
    }
}

/// Prepares a temporary Zsh integration directory containing non-invasive hooks
/// for standard OSC 133 prompt and execution lifecycle notifications.
pub fn setup_zsh_integration() -> Option<PathBuf> {
    let dir = env::temp_dir().join("tracerelay").join("shell").join("zsh");
    if std::fs::create_dir_all(&dir).is_err() {
        return None;
    }
    let zshrc = r#"# TraceRelay / CapTerm Zsh Integration
if [[ -n "$TRACERELAY_ORIG_ZDOTDIR" ]]; then
  export ZDOTDIR="$TRACERELAY_ORIG_ZDOTDIR"
else
  unset ZDOTDIR
fi

# Capture the per-session integration nonce into a private shell-local variable
# and immediately unset it from the exported environment so child processes cannot see it.
typeset -g _tracerelay_session_nonce="${TRACERELAY_SHELL_NONCE:-}"
unset TRACERELAY_SHELL_NONCE

if [[ -f "${ZDOTDIR:-$HOME}/.zshrc" ]]; then
  source "${ZDOTDIR:-$HOME}/.zshrc"
fi

if [[ -z "$_TRACERELAY_HOOKS_INSTALLED" ]]; then
  typeset -g _TRACERELAY_HOOKS_INSTALLED=1
  _tracerelay_precmd() {
    local ret=$?
    if [[ -n "$_tracerelay_session_nonce" ]]; then
      printf '\033]133;D;%d;aid=%s\007\033]133;A;aid=%s\007' "$ret" "$_tracerelay_session_nonce" "$_tracerelay_session_nonce"
    else
      printf '\033]133;D;%d\007\033]133;A\007' "$ret"
    fi
  }
  _tracerelay_preexec() {
    if [[ -n "$_tracerelay_session_nonce" ]]; then
      printf '\033]133;C;aid=%s\007' "$_tracerelay_session_nonce"
    else
      printf '\033]133;C\007'
    fi
  }
  autoload -Uz add-zsh-hook 2>/dev/null
  if typeset -f add-zsh-hook >/dev/null 2>&1; then
    add-zsh-hook precmd _tracerelay_precmd
    add-zsh-hook preexec _tracerelay_preexec
  else
    precmd_functions+=(_tracerelay_precmd)
    preexec_functions+=(_tracerelay_preexec)
  fi

  # Native Shell Policy Interception (Zsh ZLE)
  typeset -g _tracerelay_policy_active="${TRACERELAY_POLICY_ACTIVE:-0}"
  typeset -g _capterm_pending_id=""
  typeset -g _capterm_pending_buffer=""
  typeset -g _capterm_pending_cwd=""

  if [[ -o zle ]] || [[ -n "$ZSH_VERSION" ]]; then
    zmodload -i zsh/zle 2>/dev/null

    _capterm_set_policy_on() {
      _tracerelay_policy_active=1
    }
    _capterm_set_policy_off() {
      _tracerelay_policy_active=0
    }
    zle -N _capterm_set_policy_on
    zle -N _capterm_set_policy_off

    if [[ -n "$_tracerelay_session_nonce" ]]; then
      bindkey "\e[POL_ON_${_tracerelay_session_nonce}~" _capterm_set_policy_on
      bindkey "\e[POL_OFF_${_tracerelay_session_nonce}~" _capterm_set_policy_off
    fi

    _capterm_resume_accept() {
      local current_cmd="${PREBUFFER}${BUFFER}"
      if [[ -z "$_capterm_pending_id" ]]; then
        return 1
      fi
      if [[ "$current_cmd" != "$_capterm_pending_buffer" ]]; then
        zle -M "Command line modified; approval invalidated"
        _capterm_pending_id=""
        _capterm_pending_buffer=""
        _capterm_pending_cwd=""
        return 1
      fi
      if [[ "$PWD" != "$_capterm_pending_cwd" ]]; then
        zle -M "Directory changed; approval invalidated"
        _capterm_pending_id=""
        _capterm_pending_buffer=""
        _capterm_pending_cwd=""
        return 1
      fi
      _capterm_pending_id=""
      _capterm_pending_buffer=""
      _capterm_pending_cwd=""
      zle .accept-line
    }
    zle -N _capterm_resume_accept

    if [[ -n "$_tracerelay_session_nonce" ]]; then
      bindkey "\e[RESUME_${_tracerelay_session_nonce}~" _capterm_resume_accept
    fi

    _capterm_accept_line() {
      if [[ "$_tracerelay_policy_active" != "1" || -z "$_tracerelay_session_nonce" ]]; then
        zle .accept-line
        return
      fi

      local full_cmd="${PREBUFFER}${BUFFER}"

      # Check if command is empty or whitespace only:
      if [[ -z "${full_cmd//[[:space:]]/}" ]]; then
        zle .accept-line
        return
      fi

      # Check for syntax completeness in subshell
      if ! ( eval "return 0; $full_cmd" ) >/dev/null 2>&1; then
        # Incomplete multiline command, let ZLE continue editing
        zle .accept-line
        return
      fi

      # Syntax is complete; capture state and emit trusted policy evaluation request
      local req_id="req_${RANDOM}_${SECONDS}"
      _capterm_pending_id="$req_id"
      _capterm_pending_buffer="$full_cmd"
      _capterm_pending_cwd="$PWD"

      local b64_cmd b64_cwd
      b64_cmd=$(print -rn -- "$full_cmd" | base64 | tr -d '\n\r')
      b64_cwd=$(print -rn -- "$PWD" | base64 | tr -d '\n\r')

      printf '\033]133;Q;aid=%s;id=%s;cwd=%s;cmd=%s\007' \
        "$_tracerelay_session_nonce" "$req_id" "$b64_cwd" "$b64_cmd"
    }
    zle -N accept-line _capterm_accept_line

    TRAPINT() {
      if [[ -n "$_capterm_pending_id" && -n "$_tracerelay_session_nonce" ]]; then
        printf '\033]133;Q;aid=%s;id=%s;status=cancelled\007' \
          "$_tracerelay_session_nonce" "$_capterm_pending_id"
        _capterm_pending_id=""
        _capterm_pending_buffer=""
        _capterm_pending_cwd=""
      fi
      return 130
    }
  fi
fi
"#;
    let zprofile = r#"if [[ -f "${TRACERELAY_ORIG_ZDOTDIR:-$HOME}/.zprofile" ]]; then
  source "${TRACERELAY_ORIG_ZDOTDIR:-$HOME}/.zprofile"
fi
"#;
    let zshenv = r#"if [[ -f "${TRACERELAY_ORIG_ZDOTDIR:-$HOME}/.zshenv" ]]; then
  source "${TRACERELAY_ORIG_ZDOTDIR:-$HOME}/.zshenv"
fi
"#;
    let _ = std::fs::write(dir.join(".zshrc"), zshrc);
    let _ = std::fs::write(dir.join(".zprofile"), zprofile);
    let _ = std::fs::write(dir.join(".zshenv"), zshenv);
    Some(dir)
}

/// Prepares a temporary Bash integration script containing hooks
/// for standard OSC 133 prompt and execution lifecycle notifications.
pub fn setup_bash_integration() -> Option<PathBuf> {
    let dir = env::temp_dir().join("tracerelay").join("shell").join("bash");
    if std::fs::create_dir_all(&dir).is_err() {
        return None;
    }
    let script = r#"# TraceRelay / CapTerm Bash Integration
_tracerelay_session_nonce="${TRACERELAY_SHELL_NONCE:-}"
unset TRACERELAY_SHELL_NONCE

if [[ -f "$HOME/.bashrc" ]]; then
  source "$HOME/.bashrc"
fi

if [[ -z "$_TRACERELAY_BASH_HOOKS_INSTALLED" ]]; then
  _TRACERELAY_BASH_HOOKS_INSTALLED=1
  _tracerelay_prompt_cmd() {
    local ret=$?
    if [[ -n "$_tracerelay_session_nonce" ]]; then
      printf '\033]133;D;%d;aid=%s\007\033]133;A;aid=%s\007' "$ret" "$_tracerelay_session_nonce" "$_tracerelay_session_nonce"
    else
      printf '\033]133;D;%d\007\033]133;A\007' "$ret"
    fi
  }
  PROMPT_COMMAND="_tracerelay_prompt_cmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
  if [[ -n "$_tracerelay_session_nonce" ]]; then
    trap 'printf "\033]133;C;aid=%s\007" "$_tracerelay_session_nonce"' DEBUG
  else
    trap 'printf "\033]133;C\007"' DEBUG
  fi

  # Native Shell Policy Interception (Bash Readline / bind -x)
  _tracerelay_policy_active="${TRACERELAY_POLICY_ACTIVE:-0}"
  _capterm_pending_id=""
  _capterm_pending_buffer=""
  _capterm_pending_cwd=""

  # Emit shell capability notice and version
  if [[ -n "$BASH_VERSION" && -n "$_tracerelay_session_nonce" ]]; then
    printf '\033]133;P;aid=%s;k=version;v=%s\007' "$_tracerelay_session_nonce" "$BASH_VERSION"
  fi

  if (( BASH_VERSINFO[0] >= 4 )); then
    if [[ -n "$_tracerelay_session_nonce" ]]; then
      printf '\033]133;P;aid=%s;k=capability;v=bash-readline\007' "$_tracerelay_session_nonce"
    fi

    _capterm_set_policy_on() {
      _tracerelay_policy_active=1
      bind -x '"\C-m": _capterm_bash_accept_line'
      bind -x '"\C-j": _capterm_bash_accept_line'
    }
    _capterm_set_policy_off() {
      _tracerelay_policy_active=0
      bind '"\C-m": accept-line'
      bind '"\C-j": accept-line'
    }

    if [[ -n "$_tracerelay_session_nonce" ]]; then
      bind -x '"\e[POL_ON_'${_tracerelay_session_nonce}'~": _capterm_set_policy_on'
      bind -x '"\e[POL_OFF_'${_tracerelay_session_nonce}'~": _capterm_set_policy_off'
      bind '"\e[RESUME_'${_tracerelay_session_nonce}'~": accept-line'
    fi

    _capterm_bash_accept_line() {
      if [[ "$_tracerelay_policy_active" != "1" || -z "$_tracerelay_session_nonce" ]]; then
        return 0
      fi

      local full_cmd="$READLINE_LINE"

      # Check if command is empty or whitespace only:
      if [[ -z "${full_cmd//[[:space:]]/}" ]]; then
        return 0
      fi

      # Check for syntax completeness in subshell
      if ! ( eval "return 0; $full_cmd" ) >/dev/null 2>&1; then
        # Incomplete multiline command, let user continue typing
        return 0
      fi

      # Syntax is complete; capture state and emit trusted policy evaluation request
      local req_id="req_${RANDOM}_${SECONDS}"
      _capterm_pending_id="$req_id"
      _capterm_pending_buffer="$full_cmd"
      _capterm_pending_cwd="$PWD"

      local b64_cmd b64_cwd
      b64_cmd=$(printf '%s' "$full_cmd" | base64 | tr -d '\n\r')
      b64_cwd=$(printf '%s' "$PWD" | base64 | tr -d '\n\r')

      printf '\033]133;Q;aid=%s;id=%s;cwd=%s;cmd=%s\007' \
        "$_tracerelay_session_nonce" "$req_id" "$b64_cwd" "$b64_cmd"
    }

    if [[ "$_tracerelay_policy_active" == "1" ]]; then
      _capterm_set_policy_on
    else
      _capterm_set_policy_off
    fi

    trap '_capterm_bash_on_sigint' INT
    _capterm_bash_on_sigint() {
      if [[ -n "$_capterm_pending_id" && -n "$_tracerelay_session_nonce" ]]; then
        printf '\033]133;Q;aid=%s;id=%s;status=cancelled\007' \
          "$_tracerelay_session_nonce" "$_capterm_pending_id"
        _capterm_pending_id=""
        _capterm_pending_buffer=""
        _capterm_pending_cwd=""
      fi
    }
  else
    if [[ -n "$_tracerelay_session_nonce" ]]; then
      printf '\033]133;P;aid=%s;k=capability;v=unavailable\007' "$_tracerelay_session_nonce"
    fi
  fi
fi
"#;
    let script_path = dir.join("tracerelay_bash.sh");
    let _ = std::fs::write(&script_path, script);
    Some(script_path)
}

/// Builds a `portable_pty::CommandBuilder` configured for the session.
pub fn build_command(
    config: &ShellConfig,
    cwd: Option<&str>,
    integration_nonce: Option<&str>,
) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(&config.executable);
    for arg in &config.args {
        cmd.arg(arg);
    }
    if let Some(dir) = cwd {
        let p = Path::new(dir);
        if p.is_dir() {
            cmd.cwd(p);
        }
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    if let Some(nonce) = integration_nonce {
        cmd.env("TRACERELAY_SHELL_NONCE", nonce);
    }

    match config.shell_kind {
        ShellKind::Zsh => {
            if let Some(integration_dir) = setup_zsh_integration() {
                let orig = env::var("ZDOTDIR").unwrap_or_default();
                cmd.env("TRACERELAY_ORIG_ZDOTDIR", orig);
                cmd.env("ZDOTDIR", integration_dir.to_string_lossy().to_string());
                cmd.env("TRACERELAY_SHELL_INTEGRATION", "1");
            }
        }
        ShellKind::Bash => {
            if let Some(script_path) = setup_bash_integration() {
                cmd.env("BASH_ENV", script_path.to_string_lossy().to_string());
                cmd.env("TRACERELAY_SHELL_INTEGRATION", "1");
            }
        }
        _ => {}
    }

    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_shell_kind() {
        assert_eq!(detect_shell_kind("/bin/zsh"), ShellKind::Zsh);
        assert_eq!(detect_shell_kind("/usr/local/bin/bash"), ShellKind::Bash);
        assert_eq!(detect_shell_kind("/bin/sh"), ShellKind::Sh);
        assert_eq!(detect_shell_kind("powershell.exe"), ShellKind::Powershell);
        assert_eq!(detect_shell_kind("pwsh.exe"), ShellKind::Pwsh);
        assert_eq!(detect_shell_kind("cmd.exe"), ShellKind::Cmd);
        assert_eq!(detect_shell_kind("/usr/bin/fish"), ShellKind::Default);
    }

    #[test]
    fn test_explicit_shell_override() {
        let config = resolve_shell_internal(Some(ShellKind::Bash), None);
        assert_eq!(config.executable, "/bin/bash");
        assert_eq!(config.shell_kind, ShellKind::Bash);
        assert_eq!(config.args, vec!["-l"]);

        let config_pwsh = resolve_shell_internal(Some(ShellKind::Pwsh), None);
        assert_eq!(config_pwsh.executable, "pwsh.exe");
        assert_eq!(config_pwsh.shell_kind, ShellKind::Pwsh);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_macos_shell_fallback() {
        // When SHELL is empty or None, fallback to /bin/zsh
        let fallback = resolve_shell_internal(None, None);
        assert_eq!(fallback.executable, "/bin/zsh");
        assert_eq!(fallback.shell_kind, ShellKind::Zsh);

        let empty = resolve_shell_internal(None, Some("   ".to_string()));
        assert_eq!(empty.executable, "/bin/zsh");
        assert_eq!(empty.shell_kind, ShellKind::Zsh);

        // When SHELL is specified, use it
        let custom = resolve_shell_internal(None, Some("/opt/homebrew/bin/bash".to_string()));
        assert_eq!(custom.executable, "/opt/homebrew/bin/bash");
        assert_eq!(custom.shell_kind, ShellKind::Bash);
    }

    #[test]
    fn test_build_command_environment() {
        let config = ShellConfig {
            executable: "/bin/zsh".to_string(),
            shell_kind: ShellKind::Zsh,
            args: vec!["-l".to_string()],
        };
        let cmd = build_command(&config, None, None);
        // Ensure command has executable set
        assert_eq!(cmd.get_argv(), &["/bin/zsh", "-l"]);
    }
}
