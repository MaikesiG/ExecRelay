//! TraceRelay Terminal Protocol Types
//!
//! # Protocol Synchronization Notice
//! The Rust types defined here must remain strictly synchronized with the TypeScript
//! types in `app/src/features/terminal/types.ts`. All structs use `#[serde(rename_all = "camelCase")]`
//! to ensure transparent serialization across the Tauri IPC boundary.

use serde::{Deserialize, Serialize};

/// Supported or auto-detected shell flavors.
///
/// Maps directly to `ShellKind` in `app/src/features/terminal/types.ts`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ShellKind {
    #[default]
    Default,
    Zsh,
    Bash,
    Powershell,
    Pwsh,
    Cmd,
    Sh,
}

/// Terminal session lifecycle states.
///
/// Maps directly to `TerminalSessionStatus` in `app/src/features/terminal/types.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalSessionStatus {
    Starting,
    Running,
    Exited,
    Error,
}

/// Summary metadata for an active or historical terminal session.
///
/// Maps directly to `TerminalSessionInfo` in `app/src/features/terminal/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionInfo {
    pub session_id: String,
    pub shell: String,
    pub shell_kind: ShellKind,
    pub status: TerminalSessionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integration_nonce: Option<String>,
}

/* ========================================================================== */
/* Tauri Command Input Payloads                                               */
/* ========================================================================== */

/// Transferable payload for terminal write operations containing raw bytes.
///
/// The wire representation is strictly a byte/numeric array (`Vec<u8>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BytePayload {
    Bytes(Vec<u8>),
}

impl BytePayload {
    /// Returns the data as a byte slice.
    pub fn as_bytes(&self) -> &[u8] {
        match self {
            Self::Bytes(b) => b.as_slice(),
        }
    }
}

impl From<Vec<u8>> for BytePayload {
    fn from(bytes: Vec<u8>) -> Self {
        Self::Bytes(bytes)
    }
}

impl From<&[u8]> for BytePayload {
    fn from(bytes: &[u8]) -> Self {
        Self::Bytes(bytes.to_vec())
    }
}

/// Request payload for the `terminal_create_session` command.
///
/// Maps directly to `CreateTerminalSessionInput` in `app/src/features/terminal/types.ts`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalSessionInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shell_kind: Option<ShellKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cols: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integration_nonce: Option<String>,
}

/// Request payload for the `terminal_write` command.
///
/// Maps directly to `WriteTerminalInput` in `app/src/features/terminal/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTerminalInput {
    pub session_id: String,
    pub data: BytePayload,
}

/// Request payload for the `terminal_resize` command.
///
/// Maps directly to `ResizeTerminalInput` in `app/src/features/terminal/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeTerminalInput {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

/// Request payload for the `terminal_close_session` command.
///
/// Maps directly to `CloseTerminalSessionInput` in `app/src/features/terminal/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseTerminalSessionInput {
    pub session_id: String,
}

/* ========================================================================== */
/* Tauri Streaming Event Payloads                                             */
/* ========================================================================== */

/// Output payload emitted on the `terminal://output` event.
///
/// Maps directly to `TerminalOutputEvent` in `app/src/features/terminal/types.ts`.
/// PTY output is retained as raw bytes without UTF-8 or ANSI decoding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub data: Vec<u8>,
}

/// Termination reason for session exit events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExitReason {
    Exited,
    Closed,
    ReaderEof,
    ChildWaitError,
}

/// Termination payload emitted on the `terminal://exit` event.
///
/// Maps directly to `TerminalExitEvent` in `app/src/features/terminal/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub reason: ExitReason,
}

/// Operation during which an error occurred.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalErrorOperation {
    Create,
    Read,
    Write,
    Resize,
    Close,
    Emit,
}

/// Error payload emitted on the `terminal://error` event.
///
/// Maps directly to `TerminalErrorEvent` in `app/src/features/terminal/types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalErrorEvent {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub code: String,
    pub message: String,
    pub operation: TerminalErrorOperation,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_kind_serialization() {
        assert_eq!(serde_json::to_string(&ShellKind::Zsh).unwrap(), "\"zsh\"");
        assert_eq!(
            serde_json::to_string(&ShellKind::Powershell).unwrap(),
            "\"powershell\""
        );
        assert_eq!(
            serde_json::to_string(&ShellKind::Default).unwrap(),
            "\"default\""
        );
    }

    #[test]
    fn test_session_info_camel_case_serialization() {
        let info = TerminalSessionInfo {
            session_id: "test-session-123".to_string(),
            shell: "/bin/zsh".to_string(),
            shell_kind: ShellKind::Zsh,
            status: TerminalSessionStatus::Running,
            cwd: Some("/path/to/project".to_string()),
            cols: 80,
            rows: 24,
            exit_code: None,
            integration_nonce: None,
        };

        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"sessionId\":\"test-session-123\""));
        assert!(json.contains("\"shellKind\":\"zsh\""));
        assert!(json.contains("\"status\":\"running\""));
        assert!(!json.contains("session_id"));
        assert!(!json.contains("shell_kind"));
    }

    #[test]
    fn test_byte_payload_deserialization() {
        // As numeric array of bytes (canonical wire representation)
        let json_bytes = r#"{"sessionId":"123","data":[101,99,104,111]}"#;
        let input_bytes: WriteTerminalInput = serde_json::from_str(json_bytes).unwrap();
        assert_eq!(input_bytes.data.as_bytes(), b"echo");

        // String text must be rejected under the canonical raw-byte contract
        let json_text = r#"{"sessionId":"123","data":"echo\n"}"#;
        assert!(serde_json::from_str::<WriteTerminalInput>(json_text).is_err());
    }

    #[test]
    fn test_event_payloads_serialization() {
        let raw_bytes = vec![0x00, 0x1b, 0xff, 0x80, b'A'];
        let output_event = TerminalOutputEvent {
            session_id: "sess-1".to_string(),
            data: raw_bytes.clone(),
        };
        let json = serde_json::to_string(&output_event).unwrap();
        let deserialized: TerminalOutputEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.data, raw_bytes);

        let exit_event = TerminalExitEvent {
            session_id: "sess-1".to_string(),
            exit_code: Some(0),
            reason: ExitReason::Closed,
        };
        let exit_json = serde_json::to_string(&exit_event).unwrap();
        assert!(exit_json.contains("\"reason\":\"closed\""));
        assert!(exit_json.contains("\"exitCode\":0"));

        let error_event = TerminalErrorEvent {
            session_id: Some("sess-1".to_string()),
            code: "IO_ERROR".to_string(),
            message: "Read error".to_string(),
            operation: TerminalErrorOperation::Read,
        };
        let error_json = serde_json::to_string(&error_event).unwrap();
        assert!(error_json.contains("\"operation\":\"read\""));
    }
}
