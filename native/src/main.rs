#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod error;
mod collector;
mod terminal;

use collector::collector_run_command;
use terminal::{
    terminal_close_session, terminal_create_session, terminal_list_sessions, terminal_resize,
    terminal_session_info, terminal_write, TerminalSessionManager,
};

#[tauri::command]
fn select_folder() -> std::result::Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
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
    #[cfg(not(target_os = "macos"))]
    {
        Ok(None)
    }
}

#[tauri::command]
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
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("Open in Finder is only supported on macOS".to_string())
    }
}

fn main() {
    let session_manager = TerminalSessionManager::new();
    let shutdown_manager = session_manager.clone();

    let app = match tauri::Builder::default()
        .manage(session_manager)
        .invoke_handler(tauri::generate_handler![
            terminal_create_session,
            terminal_write,
            terminal_resize,
            terminal_close_session,
            terminal_session_info,
            terminal_list_sessions,
            collector_run_command,
            select_folder,
            open_in_finder,
        ])
        .build(tauri::generate_context!())
    {
        Ok(app) => app,
        Err(err) => {
            eprintln!("Fatal error while initializing ExecRelay: {err}");
            std::process::exit(1);
        }
    };

    app.run(move |_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            shutdown_manager.close_all_sessions();
        }
    });
}
