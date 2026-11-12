use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use super::cmd_utils::silent_command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub language: String,
    pub auto_update_on_restart: bool,
    pub close_to_tray: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            language: "ru".to_string(),
            auto_update_on_restart: true,
            close_to_tray: true,
        }
    }
}

pub fn get_config_dir() -> PathBuf {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        PathBuf::from(local).join("OmniTool")
    } else {
        PathBuf::from("C:\\OmniTool")
    }
}

pub fn get_config_path() -> PathBuf {
    get_config_dir().join("config.json")
}

pub fn read_config_from_disk() -> AppConfig {
    let path = get_config_path();
    if path.exists() {
        if let Ok(data) = std::fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<AppConfig>(&data) {
                return cfg;
            }
        }
    }

    // Попробуем прочитать язык из реестра HKCU\Software\OmniTool
    let mut cfg = AppConfig::default();
    if let Ok(out) = silent_command("reg")
        .args(["query", r"HKCU\Software\OmniTool", "/v", "Language"])
        .output()
    {
        if out.status.success() {
            let str_val = String::from_utf8_lossy(&out.stdout);
            for lang in &["ru", "uk", "en", "de", "pl", "ja"] {
                if str_val.to_lowercase().contains(lang) {
                    cfg.language = lang.to_string();
                    break;
                }
            }
        }
    }
    cfg
}

pub fn write_config_to_disk(cfg: &AppConfig) -> Result<(), String> {
    let dir = get_config_dir();
    let _ = std::fs::create_dir_all(&dir);
    let path = get_config_path();

    let json = serde_json::to_string_pretty(cfg)
        .map_err(|e| format!("Ошибка сериализации конфига: {}", e))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Ошибка записи конфига {}: {}", path.display(), e))?;

    // Также обновляем реестр HKCU\Software\OmniTool
    let _ = silent_command("reg")
        .args([
            "add",
            r"HKCU\Software\OmniTool",
            "/v",
            "Language",
            "/d",
            &cfg.language,
            "/f",
        ])
        .output();

    Ok(())
}

#[tauri::command]
pub fn get_app_config() -> AppConfig {
    read_config_from_disk()
}

#[tauri::command]
pub fn save_app_config(config: AppConfig) -> Result<(), String> {
    write_config_to_disk(&config)
}
