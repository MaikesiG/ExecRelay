//! Shell detection, resolution, and command builder for TraceRelay.
//!
//! # Shell Selection Policy
//! - **macOS**: Use `$SHELL` if set and non-empty; otherwise fallback to `/bin/zsh`.
//! - **Windows**: Documented search order:
//!   1. `powershell.exe` (built-in Windows PowerShell)
//!   2. `pwsh.exe` (cross-platform PowerShell Core if explicitly requested or configured)
//!   3. `cmd.exe` (legacy Command Prompt if explicitly requested)
//! - **Other Unix (Linux/BSD)**: Use `$SHELL` if set and non-empty; otherwise fallback to `/bin/sh`.
//!   On Linux the user's shell is `$SHELL` only if executable, else the passwd login shell if
//!   executable, else `/bin/sh` (which has no trusted integration).
//!
//! Interactive login shells (`-l`) are spawned by default on Unix platforms. Bash with
//! trusted integration is spawned with a login-emulating `--rcfile` bootstrap instead.

use crate::terminal::types::ShellKind;
use portable_pty::CommandBuilder;
use std::env;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Resolved shell executable, flavor kind, and startup arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellConfig {
    pub executable: String,
    pub shell_kind: ShellKind,
    pub args: Vec<String>,
}

/// Resolves the shell configuration based on optional user input and system environment.
pub fn resolve_shell(requested: Option<ShellKind>) -> ShellConfig {
    resolve_shell_internal(requested, user_shell())
}

/// The user's shell. On Linux a desktop-launched app may lack `$SHELL` or carry a stale
/// one, so this uses `portable-pty`'s lookup: `$SHELL` if executable, else the passwd
/// login shell if executable, else `/bin/sh`.
#[cfg(target_os = "linux")]
fn user_shell() -> Option<String> {
    Some(CommandBuilder::new_default_prog().get_shell())
}

#[cfg(not(target_os = "linux"))]
fn user_shell() -> Option<String> {
    env::var("SHELL").ok()
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
#[cfg_attr(windows, allow(dead_code))] // The Windows default shell is fixed, not `$SHELL`.
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
  # The hooks must not depend on the user's PATH, which commands in the session can change
  # (for example `for path in ...` replaces the tied PATH array): base64 is resolved once,
  # here, and newlines are stripped in-shell instead of with tr (MACOS-PATH-001).
  typeset -g _tracerelay_base64=/usr/bin/base64
  [[ -x $_tracerelay_base64 ]] || _tracerelay_base64=${commands[base64]:-}
  _tracerelay_b64() {
    [[ -n $_tracerelay_base64 ]] || return 1
    local out
    out=$(print -rn -- "$1" | "$_tracerelay_base64") || return 1
    print -rn -- "${out//[$'\n\r']/}"
  }
  _tracerelay_precmd() {
    local ret=$?
    if [[ -n "$_tracerelay_session_nonce" ]]; then
      printf '\033]133;D;%d;aid=%s\007\033]133;A;aid=%s\007' "$ret" "$_tracerelay_session_nonce" "$_tracerelay_session_nonce"
    else
      printf '\033]133;D;%d\007\033]133;A\007' "$ret"
    fi
  }
  _tracerelay_preexec() {
    local full_cmd="$1"
    local b64_cmd
    if [[ -n "$_tracerelay_session_nonce" ]] && b64_cmd=$(_tracerelay_b64 "$full_cmd"); then
      printf '\033]133;C;aid=%s;cmd=%s\007' "$_tracerelay_session_nonce" "$b64_cmd"
    elif [[ -n "$_tracerelay_session_nonce" ]]; then
      # The hook reports its own failure so ExecRelay classifies it as an integration
      # error at the source, never by matching hook stderr text.
      printf '\033]133;C;aid=%s;err=command-encode\007' "$_tracerelay_session_nonce"
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
      b64_cmd=$(_tracerelay_b64 "$full_cmd")
      b64_cwd=$(_tracerelay_b64 "$PWD")

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
    std::fs::write(dir.join(".zshrc"), zshrc).ok()?;
    std::fs::write(dir.join(".zprofile"), zprofile).ok()?;
    std::fs::write(dir.join(".zshenv"), zshenv).ok()?;
    Some(dir)
}

/// Single-use, per-session shell bootstrap file carrying the session nonce (the Bash
/// `--rcfile` or the PowerShell integration script).
///
/// The shell deletes the file as soon as it has read it; dropping this guard removes it if
/// the shell never read it (spawn failure, early close).
pub struct ShellBootstrap {
    path: PathBuf,
}

impl ShellBootstrap {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for ShellBootstrap {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Bash startup, run from the `--rcfile` bootstrap. `--rcfile` makes Bash an interactive
/// non-login shell, so the login startup files are sourced here first, then the hooks.
const BASH_INTEGRATION: &str = r#"
if [ -r /etc/profile ]; then . /etc/profile; fi
if [ -r ~/.bash_profile ]; then . ~/.bash_profile
elif [ -r ~/.bash_login ]; then . ~/.bash_login
elif [ -r ~/.profile ]; then . ~/.profile
fi

if [[ -n "${_tracerelay_session_nonce:-}" && -z "${_TRACERELAY_BASH_HOOKS_INSTALLED:-}" ]]; then
  _TRACERELAY_BASH_HOOKS_INSTALLED=1
  # 0 = prompt ready, 1 = command line running, 2 = startup / inside PROMPT_COMMAND.
  _tracerelay_ran=2
  _tracerelay_hist_ready=""

  _tracerelay_existing_trap() {
    local spec
    spec=$(trap -p "$1")
    [[ -n "$spec" ]] || return 0
    eval "set -- $spec"
    builtin printf '%s' "$3"
  }

  # Logical command start. cmd= is omitted when the line was not added to history
  # (ignorespace, ignoredups, history off) rather than reporting a stale entry.
  _tracerelay_command_start() {
    local entry b64_cmd b64_cwd re='^ *[0-9]+[* ] (.*)$'
    b64_cwd=$(builtin printf '%s' "$PWD" | command base64 | command tr -d '\n\r')
    entry=$(HISTTIMEFORMAT= builtin history 1)
    if [[ "$entry" != "$_tracerelay_hist_ready" && "$entry" =~ $re ]]; then
      b64_cmd=$(builtin printf '%s' "${BASH_REMATCH[1]}" | command base64 | command tr -d '\n\r')
      builtin printf '\033]133;C;aid=%s;cmd=%s;cwd=%s\007' "$_tracerelay_session_nonce" "$b64_cmd" "$b64_cwd"
    else
      builtin printf '\033]133;C;aid=%s;cwd=%s\007' "$_tracerelay_session_nonce" "$b64_cwd"
    fi
  }

  # First PROMPT_COMMAND entry: ends a started command line and restores $? for the
  # user's own PROMPT_COMMAND entries.
  _tracerelay_prompt_start() {
    local ret=$?
    if [[ "$_tracerelay_ran" == 1 ]]; then
      builtin printf '\033]133;D;%d;aid=%s\007' "$ret" "$_tracerelay_session_nonce"
    fi
    _tracerelay_ran=2
    return $ret
  }

  # Last PROMPT_COMMAND entry: the prompt is about to be shown.
  _tracerelay_prompt_ready() {
    local ret=$?
    _tracerelay_hist_ready=$(HISTTIMEFORMAT= builtin history 1)
    _tracerelay_ran=0
    builtin printf '\033]133;A;aid=%s\007' "$_tracerelay_session_nonce"
    return $ret
  }

  if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
    PROMPT_COMMAND=(_tracerelay_prompt_start "${PROMPT_COMMAND[@]}" _tracerelay_prompt_ready)
  else
    PROMPT_COMMAND=$'_tracerelay_prompt_start\n'"${PROMPT_COMMAND:-}"$'\n_tracerelay_prompt_ready'
  fi
fi

if [[ -n "${_tracerelay_session_nonce:-}" && "${PROMPT_COMMAND[*]:-}" != *_tracerelay_prompt_ready* ]]; then
  # Hooks could not be installed: never emit trusted markers from this shell.
  unset _tracerelay_session_nonce
fi

if [[ -n "${_tracerelay_session_nonce:-}" && -z "${_TRACERELAY_BASH_START_INSTALLED:-}" ]]; then
  _TRACERELAY_BASH_START_INSTALLED=1
  # PS0 (Bash >= 4.4) marks every accepted command line, including bare subshells.
  # Older Bash uses a DEBUG trap chained with any existing one.
  if (( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) )) && shopt -q promptvars; then
    PS0='$(_tracerelay_command_start)${_tracerelay_noop[_tracerelay_ran=1]:-}'"${PS0:-}"
  else
    _tracerelay_debug() {
      # While a trap handler runs at the prompt, Bash 3.2 leaves BASH_COMMAND at the last
      # statement run (`return $ret` in _tracerelay_prompt_ready): not a command line.
      if [[ "$_tracerelay_ran" == 0 && "$BASH_COMMAND" != _tracerelay_* && "$BASH_COMMAND" != 'return $ret' ]]; then
        _tracerelay_ran=1
        _tracerelay_command_start
      fi
    }
    _tracerelay_user_debug_trap=$(_tracerelay_existing_trap DEBUG)
    trap '_tracerelay_debug; eval "${_tracerelay_user_debug_trap:-}"' DEBUG
  fi

  # Native Shell Policy Interception (Bash Readline / bind -x)
  _tracerelay_policy_active="${TRACERELAY_POLICY_ACTIVE:-0}"
  _capterm_pending_id=""
  _capterm_pending_buffer=""
  _capterm_pending_cwd=""

  # Handshake: hooks are installed. Emit shell capability notice and version.
  printf '\033]133;P;aid=%s;k=version;v=%s\007' "$_tracerelay_session_nonce" "$BASH_VERSION"

  if (( BASH_VERSINFO[0] >= 4 )); then
    printf '\033]133;P;aid=%s;k=capability;v=bash-readline\007' "$_tracerelay_session_nonce"

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

    bind -x '"\e[POL_ON_'${_tracerelay_session_nonce}'~": _capterm_set_policy_on'
    bind -x '"\e[POL_OFF_'${_tracerelay_session_nonce}'~": _capterm_set_policy_off'
    bind '"\e[RESUME_'${_tracerelay_session_nonce}'~": accept-line'

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
    printf '\033]133;P;aid=%s;k=capability;v=unavailable\007' "$_tracerelay_session_nonce"
  fi

  # One internal function runs the policy cancel hook and the user's INT trap, so trap
  # handler commands never look like a command line to the DEBUG fallback.
  _tracerelay_user_int_trap=$(_tracerelay_existing_trap INT)
  _tracerelay_int_trap() {
    if declare -F _capterm_bash_on_sigint >/dev/null; then
      _capterm_bash_on_sigint
    fi
    eval "${_tracerelay_user_int_trap:-}"
  }
  if [[ -n "$_tracerelay_user_int_trap" ]] || declare -F _capterm_bash_on_sigint >/dev/null; then
    trap '_tracerelay_int_trap' INT
  fi
fi
"#;

/// Writes the single-use Bash bootstrap. The nonce lives only in this 0600 file until
/// Bash reads it into a non-exported shell variable and deletes the file; it is never
/// placed in the environment or the command line.
pub fn setup_bash_integration(nonce: &str) -> Option<ShellBootstrap> {
    if !is_valid_nonce(nonce) {
        return None;
    }
    let bootstrap = ShellBootstrap {
        path: env::temp_dir().join(format!("tracerelay-bash-{}.sh", uuid::Uuid::new_v4())),
    };
    let script = format!(
        "# TraceRelay / CapTerm Bash Integration (single-use bootstrap)\n\
         _tracerelay_session_nonce='{nonce}'\n\
         command rm -f -- \"${{BASH_SOURCE[0]}}\"\n\
         {BASH_INTEGRATION}"
    );
    write_private_file(bootstrap.path(), &script).ok()?;
    Some(bootstrap)
}

/// Nonces are embedded in shell source, so only `[A-Za-z0-9_-]+` is accepted.
fn is_valid_nonce(nonce: &str) -> bool {
    !nonce.is_empty()
        && nonce
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// PowerShell integration, run by the `-Command` loader as a script block (never as a
/// script file, so ExecutionPolicy does not apply and is not changed). It runs after the
/// user's profiles and wraps two host hooks:
/// - `PSConsoleHostReadLine` (PSReadLine): returns one complete submission, multiline
///   included. A non-blank submission at the top-level prompt emits the trusted start
///   (`C`) with the command and PowerShell's own FileSystem location.
/// - `prompt`: the host calls it after every submission, including parse errors and
///   Ctrl+C-stopped pipelines, so a started command always gets its end (`D`) here.
///
/// End status (`D;<status>`), from PowerShell's own state when the prompt runs:
/// - PowerShell's history entry for this submission says `Stopped` (Ctrl+C): the native exit
///   code if `$LASTEXITCODE` changed during the command (an interrupted native program's real
///   code), otherwise no status. The engine's pipeline state is the authority here, not `$?`
///   or `$Error`: Ctrl+C that lands before any statement failed leaves `$?` true, and Ctrl+C
///   during command auto-loading leaves a `CommandNotFoundException`
///   (POWERSHELL-INTERRUPT-STATUS-001).
/// - `$?` true: `0`.
/// - `$?` false and `$LASTEXITCODE` changed to a non-zero value during the command: that
///   native exit code.
/// - `$?` false and a new `$Error` record that is not a stopped pipeline: `1`, the code
///   `powershell.exe -Command` itself exits with when its last command failed.
/// - otherwise (a native command repeating the previous non-zero code): no status, i.e.
///   unknown. Nothing is invented.
///
/// The nonce lives only in a dynamic module that is never imported; the module's functions
/// are installed as the global hooks. Without PSReadLine the hooks are not installed and no
/// handshake is emitted, so integration stays unavailable.
const POWERSHELL_INTEGRATION: &str = r#"
$readLine = Microsoft.PowerShell.Core\Get-Command -Name PSConsoleHostReadLine -CommandType Function -ErrorAction SilentlyContinue
if (-not $readLine) { return }
$null = Microsoft.PowerShell.Core\New-Module -Name ExecRelayShellIntegration -ArgumentList $nonce, $readLine.ScriptBlock, ${function:global:prompt} -ScriptBlock {
  param([string]$Nonce, [scriptblock]$UserReadLine, [scriptblock]$UserPrompt)
  $esc = [char]27
  $bel = [char]7
  $script:running = $false
  $script:startExitCode = $null
  $script:startError = $null
  $script:startHistoryId = 0

  function Get-ExecRelayBase64([string]$Text) {
    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Text))
  }

  function Get-ExecRelayLastError {
    if ($global:Error.Count -gt 0) { $global:Error[0] } else { $null }
  }

  function Get-ExecRelayLastHistory {
    Microsoft.PowerShell.Core\Get-History -Count 1 -ErrorAction SilentlyContinue
  }

  function Get-ExecRelayEndStatus([bool]$Succeeded, $ExitCode) {
    $exitCodeChanged = $ExitCode -is [int] -and -not ($script:startExitCode -is [int] -and $ExitCode -eq $script:startExitCode)
    $entry = Get-ExecRelayLastHistory
    if ($null -ne $entry -and $entry.Id -gt $script:startHistoryId -and [string]$entry.ExecutionStatus -eq 'Stopped') {
      if ($exitCodeChanged) { return ";$ExitCode" }
      return ''
    }
    if ($Succeeded) { return ';0' }
    if ($exitCodeChanged -and $ExitCode -ne 0) {
      return ";$ExitCode"
    }
    $last = Get-ExecRelayLastError
    if ($null -ne $last -and -not [object]::ReferenceEquals($last, $script:startError)) {
      $exception = if ($last -is [System.Management.Automation.ErrorRecord]) { $last.Exception } else { $last }
      if (-not ($exception -is [System.Management.Automation.PipelineStoppedException])) { return ';1' }
    }
    ''
  }

  function Invoke-ExecRelayPrompt {
    $succeeded = $global:?
    $exitCode = $global:LASTEXITCODE
    $marks = ''
    if ($NestedPromptLevel -eq 0) {
      if ($script:running) {
        $script:running = $false
        $marks += "$esc]133;D$(Get-ExecRelayEndStatus $succeeded $exitCode);aid=$Nonce$bel"
      }
      $marks += "$esc]133;A;aid=$Nonce$bel"
    }
    # Give the user's prompt the $? it would have seen without this wrapper.
    if (-not $succeeded) { Microsoft.PowerShell.Utility\Write-Error -Message '' -ErrorAction Ignore }
    if ($UserPrompt) {
      $marks + (& $UserPrompt)
    } else {
      $marks + "PS $($ExecutionContext.SessionState.Path.CurrentLocation)$('>' * ($NestedPromptLevel + 1)) "
    }
  }

  function Invoke-ExecRelayReadLine {
    $line = & $UserReadLine
    if ($NestedPromptLevel -eq 0 -and -not [string]::IsNullOrWhiteSpace($line)) {
      $marks = ''
      if ($script:running) {
        # The prompt hook was replaced: close the previous command without a status.
        $marks += "$esc]133;D;aid=$Nonce$bel"
      }
      $script:running = $true
      $script:startExitCode = $global:LASTEXITCODE
      $script:startError = Get-ExecRelayLastError
      $entry = Get-ExecRelayLastHistory
      $script:startHistoryId = if ($null -ne $entry) { $entry.Id } else { 0 }
      $location = $ExecutionContext.SessionState.Path.CurrentLocation
      $cwd = if ($location.Provider.Name -eq 'FileSystem') { ";cwd=$(Get-ExecRelayBase64 $location.ProviderPath)" } else { '' }
      $Host.UI.Write("$marks$esc]133;C;aid=$Nonce;cmd=$(Get-ExecRelayBase64 $line)$cwd$bel")
    }
    $line
  }

  Microsoft.PowerShell.Management\Set-Item -Path function:global:prompt -Value ${function:Invoke-ExecRelayPrompt} -ErrorAction Stop
  Microsoft.PowerShell.Management\Set-Item -Path function:global:PSConsoleHostReadLine -Value ${function:Invoke-ExecRelayReadLine} -ErrorAction Stop
  # Handshake: both hooks are installed.
  $Host.UI.Write("$esc]133;P;aid=$Nonce;k=version;v=$($PSVersionTable.PSVersion)$bel")
}
"#;

/// Writes the single-use PowerShell integration script and returns it with the `-Command`
/// loader. The loader carries only the file path: it reads the script, deletes the file,
/// then runs the script. The nonce is never in the environment or on the command line.
///
/// The file is created new in the per-user temp directory (`%TEMP%`, whose ACL already
/// restricts it to the user); no extra ACL is applied.
pub fn setup_powershell_integration(nonce: &str) -> Option<(ShellBootstrap, String)> {
    if !is_valid_nonce(nonce) {
        return None;
    }
    let bootstrap = ShellBootstrap {
        path: env::temp_dir().join(format!(
            "tracerelay-powershell-{}.ps1",
            uuid::Uuid::new_v4()
        )),
    };
    let path = bootstrap.path().to_str()?.replace('\'', "''");
    let script = format!(
        "# TraceRelay / ExecRelay PowerShell Integration (single-use bootstrap)\n\
         $nonce = '{nonce}'\n\
         {POWERSHELL_INTEGRATION}"
    );
    write_private_file(bootstrap.path(), &script).ok()?;
    let loader = format!(
        "& {{ $p = '{path}'; try {{ $s = [IO.File]::ReadAllText($p) }} catch {{ $s = $null }} finally {{ [IO.File]::Delete($p) }}; if ($s) {{ try {{ & ([ScriptBlock]::Create($s)) }} catch {{ }} }} }}"
    );
    Some((bootstrap, loader))
}

/// Creates a new file readable only by the current user; fails if the path exists.
fn write_private_file(path: &Path, contents: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path)?.write_all(contents.as_bytes())
}

/// Watches PTY output for the integration handshake: the first OSC 133 marker
/// authenticated with the session nonce (`;aid=<nonce>` followed by a delimiter), the
/// same exact-match rule the frontend parser applies. Bash emits it only after its hooks
/// are verified installed. Until then integration is pending, never available.
pub struct IntegrationHandshake {
    needle: Vec<u8>,
    tail: Vec<u8>,
    established: Arc<AtomicBool>,
}

impl IntegrationHandshake {
    pub fn new(nonce: &str, established: Arc<AtomicBool>) -> Self {
        Self {
            needle: format!(";aid={nonce}").into_bytes(),
            tail: Vec::new(),
            established,
        }
    }

    pub fn observe(&mut self, bytes: &[u8]) {
        if self.established.load(Ordering::SeqCst) {
            return;
        }
        let mut window = std::mem::take(&mut self.tail);
        window.extend_from_slice(bytes);
        let mut from = 0;
        while let Some(at) = window[from..]
            .windows(self.needle.len())
            .position(|w| w == self.needle)
        {
            let end = from + at + self.needle.len();
            match window.get(end) {
                Some(b';' | 0x07 | 0x1b) => {
                    self.established.store(true, Ordering::SeqCst);
                    return;
                }
                None => break,
                Some(_) => from = end,
            }
        }
        let keep = window.len().min(self.needle.len());
        self.tail = window[window.len() - keep..].to_vec();
    }
}

/// Builds a `portable_pty::CommandBuilder` configured for the session.
///
/// The integration nonce is delivered only to a shell whose trusted integration is set up;
/// other shells never receive it. The returned Bash bootstrap must outlive the spawn.
pub fn build_command(
    config: &ShellConfig,
    cwd: Option<&str>,
    integration_nonce: Option<&str>,
) -> (CommandBuilder, bool, Option<ShellBootstrap>) {
    let mut cmd = CommandBuilder::new(&config.executable);
    let mut powershell_loader = None;
    let shell_bootstrap = match (config.shell_kind, integration_nonce) {
        (ShellKind::Bash, Some(nonce)) => setup_bash_integration(nonce),
        (ShellKind::Powershell | ShellKind::Pwsh, Some(nonce)) => {
            setup_powershell_integration(nonce).map(|(bootstrap, loader)| {
                powershell_loader = Some(loader);
                bootstrap
            })
        }
        _ => None,
    };
    match (&shell_bootstrap, &powershell_loader) {
        (_, Some(loader)) => {
            cmd.args(&config.args);
            cmd.args(["-NoExit", "-Command", loader]);
        }
        (Some(bootstrap), None) => {
            cmd.arg("--rcfile");
            cmd.arg(bootstrap.path());
            cmd.arg("-i");
        }
        (None, None) => cmd.args(&config.args),
    }
    if let Some(dir) = cwd {
        let p = Path::new(dir);
        if p.is_dir() {
            cmd.cwd(p);
        }
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let shell_integration_available = match config.shell_kind {
        ShellKind::Zsh => {
            if let Some(integration_dir) = setup_zsh_integration() {
                if let Some(nonce) = integration_nonce {
                    cmd.env("TRACERELAY_SHELL_NONCE", nonce);
                }
                let orig = env::var("ZDOTDIR").unwrap_or_default();
                cmd.env("TRACERELAY_ORIG_ZDOTDIR", orig);
                cmd.env("ZDOTDIR", integration_dir.to_string_lossy().to_string());
                cmd.env("TRACERELAY_SHELL_INTEGRATION", "1");
                true
            } else {
                false
            }
        }
        ShellKind::Bash | ShellKind::Powershell | ShellKind::Pwsh if shell_bootstrap.is_some() => {
            cmd.env("TRACERELAY_SHELL_INTEGRATION", "1");
            true
        }
        _ => false,
    };

    (cmd, shell_integration_available, shell_bootstrap)
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
    #[cfg(target_os = "linux")]
    fn test_linux_user_shell_is_validated_and_integration_stays_truthful() {
        let mut builder = CommandBuilder::new_default_prog();
        builder.env("SHELL", "/nonexistent/execrelay-shell");
        let fallback = builder.get_shell();
        assert_ne!(fallback, "/nonexistent/execrelay-shell");
        assert!(Path::new(&fallback).is_file(), "fallback must be a real shell");

        builder.env("SHELL", "/bin/bash");
        assert_eq!(builder.get_shell(), "/bin/bash");
        builder.env_remove("SHELL");
        assert!(Path::new(&builder.get_shell()).is_file(), "passwd or /bin/sh fallback");

        // Terminal availability does not imply trusted integration.
        let sh = resolve_shell_internal(None, Some("/bin/sh".to_string()));
        assert_eq!(sh.shell_kind, ShellKind::Sh);
        assert!(!build_command(&sh, None, Some("nonce")).1);
        let bash = resolve_shell_internal(None, Some("/bin/bash".to_string()));
        assert_eq!(bash.shell_kind, ShellKind::Bash);
        assert!(build_command(&bash, None, Some("nonce")).1);
    }

    #[test]
    fn test_build_command_environment() {
        let config = ShellConfig {
            executable: "/bin/zsh".to_string(),
            shell_kind: ShellKind::Zsh,
            args: vec!["-l".to_string()],
        };
        let (cmd, shell_integration_available, _) = build_command(&config, None, None);
        // Ensure command has executable set
        assert_eq!(cmd.get_argv(), &["/bin/zsh", "-l"]);
        assert!(shell_integration_available);
    }

    #[test]
    fn test_unsupported_shell_reports_no_integration() {
        let config = ShellConfig {
            executable: "/bin/sh".to_string(),
            shell_kind: ShellKind::Sh,
            args: vec!["-l".to_string()],
        };
        let (cmd, shell_integration_available, _) =
            build_command(&config, None, Some("nonce"));
        assert!(!shell_integration_available);
        assert_eq!(cmd.get_env("TRACERELAY_SHELL_NONCE"), None);
    }

    #[test]
    fn test_handshake_requires_exact_nonce_and_survives_chunk_splits() {
        let established = Arc::new(AtomicBool::new(false));
        let mut handshake = IntegrationHandshake::new("n-1", Arc::clone(&established));
        handshake.observe(b"\x1b]133;P;aid=n-12\x07\x1b]133;C;aid=other\x07plain ;aid=n-1 text");
        assert!(!established.load(Ordering::SeqCst));
        handshake.observe(b"\x1b]133;P;ai");
        handshake.observe(b"d=n-1");
        assert!(!established.load(Ordering::SeqCst));
        handshake.observe(b";k=version\x07");
        assert!(established.load(Ordering::SeqCst));
    }

    #[test]
    #[cfg(unix)]
    fn test_bash_nonce_is_delivered_only_through_private_single_use_bootstrap() {
        use std::os::unix::fs::PermissionsExt;

        let config = resolve_shell_internal(Some(ShellKind::Bash), None);
        let nonce = uuid::Uuid::new_v4().to_string();
        let (cmd, available, bootstrap) = build_command(&config, None, Some(&nonce));
        let bootstrap = bootstrap.expect("bash bootstrap");
        let path = bootstrap.path().to_path_buf();

        assert!(available);
        let argv: Vec<_> = cmd.get_argv().iter().map(|a| a.to_string_lossy()).collect();
        assert_eq!(argv, ["/bin/bash", "--rcfile", &path.to_string_lossy(), "-i"]);
        assert!(argv.iter().all(|arg| !arg.contains(&nonce)));
        assert_eq!(cmd.get_env("TRACERELAY_SHELL_NONCE"), None);
        assert_eq!(cmd.get_env("BASH_ENV"), None);

        let metadata = std::fs::metadata(&path).unwrap();
        assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
        assert!(std::fs::read_to_string(&path).unwrap().contains(&nonce));

        drop(bootstrap);
        assert!(!path.exists(), "unused bootstrap must be removed");

        let (cmd, available, bootstrap) = build_command(&config, None, Some("bad'nonce"));
        assert!(!available && bootstrap.is_none());
        assert_eq!(cmd.get_argv(), &["/bin/bash", "-l"]);
    }
}
