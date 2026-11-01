//! Linux and Windows desktop integration: folder-picker results and reveal-in-file-manager.
//!
//! The folder dialog itself is Tauri's dialog plugin (GTK on Linux, the system folder dialog
//! on Windows); this module only turns its result into the IPC value. The Linux file manager
//! is reached through `xdg-open`, the freedesktop launcher; Windows uses File Explorer
//! (`explorer.exe`). Both are invoked directly with the path as one argument and no shell.

#[cfg(any(target_os = "linux", target_os = "windows", test))]
use std::path::Path;
use std::path::PathBuf;
#[cfg(any(target_os = "linux", target_os = "windows", test))]
use std::process::Command;

#[cfg(target_os = "linux")]
const FILE_MANAGER_LAUNCHER: &str = "xdg-open";

/// Converts a folder-dialog result into the IPC value: `None` when cancelled, an error
/// when the selected path cannot be represented as UTF-8 (never a lossy path).
pub fn folder_selection(selected: Option<PathBuf>) -> Result<Option<String>, String> {
    match selected {
        None => Ok(None),
        Some(path) => path
            .into_os_string()
            .into_string()
            .map(Some)
            .map_err(|_| "Selected folder path is not valid UTF-8".to_string()),
    }
}

/// Opens `path` in the desktop's file manager. Failures are returned, never panicked.
#[cfg(target_os = "linux")]
pub fn reveal_in_file_manager(path: &str) -> Result<(), String> {
    reveal_with(FILE_MANAGER_LAUNCHER, path)
}

#[cfg(target_os = "linux")]
fn reveal_command(launcher: &str, path: &Path) -> Command {
    let mut command = Command::new(launcher);
    command.arg(path);
    command
}

#[cfg(target_os = "linux")]
fn reveal_with(launcher: &str, path: &str) -> Result<(), String> {
    let path = Path::new(path);
    if !path.is_dir() {
        return Err(format!("Directory does not exist: {}", path.display()));
    }
    let status = reveal_command(launcher, path).status().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("No file manager launcher found ({launcher} is not installed)")
        } else {
            format!("Failed to open file manager: {e}")
        }
    })?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{launcher} exited with status: {status}"))
    }
}

/// Opens `path` in File Explorer. Failures to start Explorer are returned, never panicked.
///
/// Explorer's exit code does not report success (it is 1 for a folder it opened), so it is
/// not waited for: a started Explorer is the success.
#[cfg(target_os = "windows")]
pub fn reveal_in_file_manager(path: &str) -> Result<(), String> {
    let path = explorer_path(path);
    if !path.is_dir() {
        return Err(format!("Directory does not exist: {}", path.display()));
    }
    explorer_command(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open File Explorer: {e}"))
}

/// Git for Windows reports repository roots with `/` separators, which Explorer does not
/// reliably accept; `/` cannot occur in a Windows file name, so it is always a separator.
#[cfg(any(target_os = "windows", test))]
fn explorer_path(path: &str) -> PathBuf {
    PathBuf::from(path.replace('/', "\\"))
}

/// `%SystemRoot%\explorer.exe` when known, so `PATH` cannot substitute another program.
#[cfg(any(target_os = "windows", test))]
fn explorer_command(path: &Path) -> Command {
    let program = std::env::var_os("SystemRoot")
        .map(|root| PathBuf::from(root).join("explorer.exe"))
        .unwrap_or_else(|| PathBuf::from("explorer.exe"));
    let mut command = Command::new(program);
    command.arg(path);
    command
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    #[test]
    fn cancelled_selection_is_none() {
        assert_eq!(folder_selection(None), Ok(None));
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn selection_keeps_spaces_and_non_ascii_exactly() {
        let path = PathBuf::from("/home/user/my project/données");
        assert_eq!(
            folder_selection(Some(path)),
            Ok(Some("/home/user/my project/données".to_string()))
        );
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn non_utf8_selection_is_an_error_not_a_lossy_path() {
        use std::os::unix::ffi::OsStrExt;
        let path = PathBuf::from(OsStr::from_bytes(b"/tmp/bad-\xff-name"));
        assert!(folder_selection(Some(path)).is_err());
    }

    #[test]
    #[cfg(windows)]
    fn windows_selection_keeps_drive_letter_spaces_and_non_ascii_exactly() {
        let path = PathBuf::from(r"C:\Users\maike\My Project\données 你好");
        assert_eq!(
            folder_selection(Some(path)),
            Ok(Some(r"C:\Users\maike\My Project\données 你好".to_string()))
        );
    }

    #[test]
    #[cfg(windows)]
    fn windows_unpaired_surrogate_selection_is_an_error_not_a_lossy_path() {
        use std::os::windows::ffi::OsStringExt;
        let mut wide: Vec<u16> = r"C:\bad-".encode_utf16().collect();
        wide.push(0xD800);
        let path = PathBuf::from(std::ffi::OsString::from_wide(&wide));
        assert!(folder_selection(Some(path)).is_err());
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn reveal_passes_the_path_as_one_literal_argument() {
        let path = Path::new("/tmp/dir with spaces; $(touch pwned) 'quoted'");
        let command = reveal_command(FILE_MANAGER_LAUNCHER, path);
        assert_eq!(command.get_program(), OsStr::new("xdg-open"));
        let args: Vec<_> = command.get_args().collect();
        assert_eq!(args, [path.as_os_str()]);
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn reveal_failures_are_errors_not_panics() {
        let dir = std::env::temp_dir();
        let dir = dir.to_str().unwrap();
        assert!(reveal_with("/nonexistent/execrelay-launcher", dir)
            .unwrap_err()
            .contains("not installed"));
        assert!(reveal_with("false", dir).unwrap_err().contains("exited with status"));
        assert_eq!(reveal_with("true", dir), Ok(()));
        assert!(reveal_with("true", "/nonexistent/execrelay-dir")
            .unwrap_err()
            .contains("does not exist"));
    }

    #[test]
    fn explorer_gets_the_path_as_one_literal_argument_with_windows_separators() {
        for (input, expected) in [
            (r"C:\Users\maike\Documents", r"C:\Users\maike\Documents"),
            (
                r"C:\Users\maike\Documents\My Test Folder",
                r"C:\Users\maike\Documents\My Test Folder",
            ),
            (
                r"C:\Users\maike\Documents\测试 文件夹",
                r"C:\Users\maike\Documents\测试 文件夹",
            ),
            (
                r"C:\work\a & b (copy) 'x' %PATH% ^ ; $(y)",
                r"C:\work\a & b (copy) 'x' %PATH% ^ ; $(y)",
            ),
            // `git rev-parse --show-toplevel` output on Windows.
            (
                "C:/Users/maike/Documents/My Test Folder",
                r"C:\Users\maike\Documents\My Test Folder",
            ),
        ] {
            let path = explorer_path(input);
            let command = explorer_command(&path);
            let program = Path::new(command.get_program());
            assert_eq!(program.file_name(), Some(OsStr::new("explorer.exe")));
            let args: Vec<_> = command.get_args().collect();
            assert_eq!(args, [OsStr::new(expected)], "{input}");
        }
    }

    #[test]
    #[cfg(windows)]
    fn windows_explorer_is_the_system_explorer_and_missing_folders_are_errors() {
        let command = explorer_command(Path::new(r"C:\"));
        let system_root = std::env::var_os("SystemRoot").expect("SystemRoot");
        assert_eq!(
            Path::new(command.get_program()),
            PathBuf::from(system_root).join("explorer.exe")
        );
        assert!(reveal_in_file_manager(r"C:\nonexistent\execrelay dir")
            .unwrap_err()
            .contains("does not exist"));
    }
}
