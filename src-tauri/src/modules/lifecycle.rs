use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn app_ready(app_handle: tauri::AppHandle) -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let start_minimized = args.iter().any(|arg| arg == "--minimized" || arg == "--tray");

    if !start_minimized {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    } else {
        crate::memory::trim_memory();
    }

    Ok(())
}

#[tauri::command]
pub fn minimize_window(app_handle: tauri::AppHandle) {
    if let Some(w) = app_handle.get_webview_window("main") {
        let _ = w.minimize();
    }
}

#[tauri::command]
pub fn toggle_maximize_window(app_handle: tauri::AppHandle) {
    if let Some(w) = app_handle.get_webview_window("main") {
        if w.is_maximized().unwrap_or(false) {
            let _ = w.unmaximize();
        } else {
            let _ = w.maximize();
        }
    }
}

#[tauri::command]
pub fn hide_window(app_handle: tauri::AppHandle) {
    if let Some(w) = app_handle.get_webview_window("main") {
        let _ = w.hide();
        crate::memory::trim_memory();
    }
}

#[tauri::command]
pub fn close_window(app_handle: tauri::AppHandle) {
    if let Some(w) = app_handle.get_webview_window("main") {
        let _ = w.close();
    }
}

#[tauri::command]
pub fn open_folder(path: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let mut clean_path_str = path.trim().to_string();
    if let Some(stripped) = clean_path_str.strip_prefix(r"\\?\") {
        clean_path_str = stripped.to_string();
    }

    let path_buf = std::path::PathBuf::from(&clean_path_str);
    let abs_path = if path_buf.is_relative() {
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            let str_val = clean_path_str.replace('/', "\\");
            if str_val.starts_with("Downloads\\") || str_val == "Downloads" {
                std::path::PathBuf::from(user_profile).join(str_val)
            } else {
                std::env::current_dir().unwrap_or_default().join(&path_buf)
            }
        } else {
            std::env::current_dir().unwrap_or_default().join(&path_buf)
        }
    } else {
        path_buf
    };

    if !abs_path.exists() {
        if abs_path.extension().is_none() {
            let _ = std::fs::create_dir_all(&abs_path);
        } else if let Some(parent) = abs_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
    }

    let final_path_str = abs_path.to_string_lossy().to_string();
    let final_clean = final_path_str.strip_prefix(r"\\?\").unwrap_or(&final_path_str);

    if abs_path.is_file() {
        if app_handle.opener().reveal_item_in_dir(final_clean).is_err() {
            #[cfg(target_os = "windows")]
            {
                let win_path = final_clean.replace('/', "\\");
                let _ = std::process::Command::new("explorer.exe")
                    .arg(format!("/select,{}", win_path))
                    .spawn();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = app_handle.opener().open_path(final_clean, None::<&str>);
            }
        }
    } else {
        if app_handle.opener().open_path(final_clean, None::<&str>).is_err() {
            #[cfg(target_os = "windows")]
            {
                let win_path = final_clean.replace('/', "\\");
                let _ = std::process::Command::new("explorer.exe")
                    .arg(win_path)
                    .spawn();
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn open_file(path: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let mut clean_path_str = path.trim().to_string();
    if let Some(stripped) = clean_path_str.strip_prefix(r"\\?\") {
        clean_path_str = stripped.to_string();
    }

    if app_handle.opener().open_path(&clean_path_str, None::<&str>).is_err() {
        #[cfg(target_os = "windows")]
        {
            let win_path = clean_path_str.replace('/', "\\");
            let _ = std::process::Command::new("cmd")
                .args(["/C", "start", "", &win_path])
                .spawn();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn delete_files(paths: Vec<String>) -> Result<Vec<String>, String> {
    let mut deleted = Vec::new();
    for p in paths {
        let mut clean = p.trim().to_string();
        if let Some(stripped) = clean.strip_prefix(r"\\?\") {
            clean = stripped.to_string();
        }
        let path_buf = std::path::PathBuf::from(&clean);
        if path_buf.exists() {
            let res = if path_buf.is_dir() {
                std::fs::remove_dir_all(&path_buf)
            } else {
                std::fs::remove_file(&path_buf)
            };
            if res.is_ok() {
                deleted.push(p);
            }
        }
    }
    Ok(deleted)
}
