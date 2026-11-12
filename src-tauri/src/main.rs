// Prevents console window on Windows in both debug and release
#![windows_subsystem = "windows"]

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let timestamp = chrono_or_time_str();
        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "Unknown panic payload".to_string()
        };

        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());

        let msg = format!(
            "=== OmniTool Crash Report ===\nTime: {}\nLocation: {}\nMessage: {}\n\nFull: {}\n",
            timestamp, location, payload, info
        );

        // 1. Попытка записать crash.log рядом с исполняемым файлом
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(parent) = exe_path.parent() {
                let _ = std::fs::write(parent.join("crash.log"), &msg);
            }
        }

        // 2. Попытка записать в %LOCALAPPDATA%\OmniTool\crash.log
        if let Ok(app_data) = std::env::var("LOCALAPPDATA") {
            let log_dir = std::path::PathBuf::from(app_data).join("OmniTool");
            let _ = std::fs::create_dir_all(&log_dir);
            let _ = std::fs::write(log_dir.join("crash.log"), &msg);
        }

        eprintln!("{}", msg);
    }));

    // Автоматическая установка обновления при перезапуске (если staged и включен тоггл)
    let _ = omnitool_lib::modules::updater::check_and_apply_update_on_startup();

    omnitool_lib::run();
}

fn chrono_or_time_str() -> String {
    format!("{:?}", std::time::SystemTime::now())
}
