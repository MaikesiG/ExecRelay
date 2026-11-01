#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod error;
mod collector;
mod platform;
mod terminal;

use collector::collector_run_command;
use terminal::{
    terminal_close_session, terminal_create_session, terminal_debug_trace, terminal_list_sessions,
    terminal_resize, terminal_session_info, terminal_write, TerminalSessionManager,
};

/// STATE-PERSISTENCE-SCALE-001: a graceful quit (Cmd-Q) fires no page lifecycle event and no
/// `ExitRequested`, only `Exit`. On `Exit` the frontend is asked to write pending workspace state
/// and given a short, bounded moment to do so (its flush takes milliseconds).
const EVENT_FLUSH_BEFORE_EXIT: &str = "app://flush-before-exit";
const FLUSH_BEFORE_EXIT_GRACE: std::time::Duration = std::time::Duration::from_millis(200);

/// Runs off the main thread: the dialog blocks until the user answers.
#[tauri::command(async)]
fn select_folder(app: tauri::AppHandle) -> std::result::Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        let output = std::process::Command::new("/usr/bin/osascript")
            .arg("-e")
            .arg("POSIX path of (choose folder with prompt \"Select Project Folder\")")
            .output()
            .map_err(|e| format!("Failed to run folder picker: {e}"))?;

        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let clean_path = path.trim_end_matches('/');
            if !clean_path.is_empty() {
                return Ok(Some(clean_path.to_string()));
            }
        }
        Ok(None)
    }
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        use tauri_plugin_dialog::DialogExt;
        let selected = app
            .dialog()
            .file()
            .set_title("Select Project Folder")
            .blocking_pick_folder()
            .map(|path| path.into_path().map_err(|e| format!("Invalid folder selection: {e}")))
            .transpose()?;
        platform::desktop::folder_selection(selected)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = app;
        Ok(None)
    }
}

#[tauri::command(async)]
fn open_in_finder(path: String) -> std::result::Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let p = std::path::Path::new(&path);
        if !p.exists() {
            return Err(format!("Directory does not exist: {path}"));
        }
        let status = std::process::Command::new("/usr/bin/open")
            .arg(&path)
            .status()
            .map_err(|e| format!("Failed to open in Finder: {e}"))?;

        if !status.success() {
            return Err(format!("Finder open exited with status: {status}"));
        }
        Ok(())
    }
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        platform::desktop::reveal_in_file_manager(&path)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = path;
        Err("Open in file manager is not supported on this platform".to_string())
    }
}

/// CROSSPLAT-005C: workspace-root availability check — one `is_dir` stat, no shell, no Git.
/// Async so a slow or vanished network share cannot block the main thread.
#[tauri::command(async)]
fn path_is_directory(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

fn main() {
    let session_manager = TerminalSessionManager::new();
    let shutdown_manager = session_manager.clone();

    let builder = tauri::Builder::default();
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.plugin(tauri_plugin_dialog::init());

    let app = match builder
        .manage(session_manager)
        .invoke_handler(tauri::generate_handler![
            terminal_create_session,
            terminal_write,
            terminal_debug_trace,
            terminal_resize,
            terminal_close_session,
            terminal_session_info,
            terminal_list_sessions,
            collector_run_command,
            select_folder,
            open_in_finder,
            path_is_directory,
        ])
        .build(tauri::generate_context!())
    {
        Ok(app) => app,
        Err(err) => {
            eprintln!("Fatal error while initializing ExecRelay: {err}");
            std::process::exit(1);
        }
    };

    app.run(move |app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            use tauri::{Emitter, Manager};
            if !app_handle.webview_windows().is_empty()
                && app_handle.emit(EVENT_FLUSH_BEFORE_EXIT, ()).is_ok()
            {
                std::thread::sleep(FLUSH_BEFORE_EXIT_GRACE);
            }
            shutdown_manager.close_all_sessions();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::path_is_directory;

    #[test]
    fn test_path_is_directory_only_for_existing_directories() {
        let dir = std::env::temp_dir();
        assert!(path_is_directory(dir.to_string_lossy().into_owned()));
        let file = dir.join(format!("execrelay-005c-{}.txt", std::process::id()));
        std::fs::write(&file, b"x").unwrap();
        assert!(!path_is_directory(file.to_string_lossy().into_owned()));
        std::fs::remove_file(&file).unwrap();
        assert!(!path_is_directory(file.to_string_lossy().into_owned()));
        assert!(!path_is_directory(String::new()));
    }
}
