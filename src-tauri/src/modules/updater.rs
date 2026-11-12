use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use super::cmd_utils::silent_command;
use super::config::{get_config_dir, read_config_from_disk};

// ============================================================================
// ЕДИНАЯ КОНФИГУРАЦИЯ ОБНОВЛЕНИЙ OMNITOOL
// ============================================================================
// При UPDATE_CHECK_ENABLED = false (или пустом GITHUB_REPO_URL) фоновые запросы
// полностью отключены, индикатор в шапке скрыт, в настройках показывается
// актуальная версия без моков и фейковых обновлений.
pub const UPDATE_CHECK_ENABLED: bool = false;
pub const GITHUB_REPO_URL: &str = ""; // Например: "https://api.github.com/repos/OmniTool/omnitool/releases/latest"

pub const CURRENT_APP_VERSION: &str = "v1.0.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckStatus {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: String,
    pub is_staged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StagedUpdateInfo {
    pub version: String,
    pub size_bytes: u64,
    pub ready: bool,
}

pub fn get_staged_dir() -> PathBuf {
    get_config_dir().join("update_staged")
}

pub fn get_staged_exe_path() -> PathBuf {
    get_staged_dir().join("omnitool.exe")
}

pub fn get_staged_manifest_path() -> PathBuf {
    get_staged_dir().join("version.json")
}

/// Очистка устаревших тестовых/мок-файлов staged обновления
pub fn clean_mock_staged() {
    let staged_dir = get_staged_dir();
    if staged_dir.exists() {
        if !UPDATE_CHECK_ENABLED {
            let _ = std::fs::remove_dir_all(&staged_dir);
        } else if let Ok(data) = std::fs::read_to_string(get_staged_manifest_path()) {
            if data.contains("v1.0.1") {
                let _ = std::fs::remove_dir_all(&staged_dir);
            }
        }
    }
}

pub fn is_staged_update_ready() -> bool {
    if !UPDATE_CHECK_ENABLED {
        return false;
    }
    let staged_exe = get_staged_exe_path();
    if staged_exe.exists() {
        if let Ok(meta) = std::fs::metadata(&staged_exe) {
            return meta.len() > 1_000_000;
        }
    }
    false
}

pub fn get_staged_version_info() -> Option<StagedUpdateInfo> {
    if !is_staged_update_ready() {
        return None;
    }

    let staged_exe = get_staged_exe_path();
    let size_bytes = std::fs::metadata(&staged_exe).map(|m| m.len()).unwrap_or(0);

    let mut version = CURRENT_APP_VERSION.to_string();
    let manifest = get_staged_manifest_path();
    if manifest.exists() {
        if let Ok(content) = std::fs::read_to_string(&manifest) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(v) = json["version"].as_str() {
                    version = v.to_string();
                }
            }
        }
    }

    Some(StagedUpdateInfo {
        version,
        size_bytes,
        ready: true,
    })
}

#[tauri::command]
pub async fn check_app_updates() -> Result<UpdateCheckStatus, String> {
    // 1. Если обновления отключены или URL репозитория пуст — отдаем актуальный статус без моков
    if !UPDATE_CHECK_ENABLED || GITHUB_REPO_URL.trim().is_empty() {
        return Ok(UpdateCheckStatus {
            has_update: false,
            current_version: CURRENT_APP_VERSION.to_string(),
            latest_version: CURRENT_APP_VERSION.to_string(),
            release_notes: String::new(),
            is_staged: false,
        });
    }

    // 2. Реальная проверка при включении UPDATE_CHECK_ENABLED и заполнении GITHUB_REPO_URL
    let is_staged = is_staged_update_ready();
    let staged_info = get_staged_version_info();

    let latest_version = if let Some(ref info) = staged_info {
        info.version.clone()
    } else {
        CURRENT_APP_VERSION.to_string()
    };

    Ok(UpdateCheckStatus {
        has_update: is_staged,
        current_version: CURRENT_APP_VERSION.to_string(),
        latest_version,
        release_notes: String::new(),
        is_staged,
    })
}

#[tauri::command]
pub fn get_staged_update() -> Option<StagedUpdateInfo> {
    if !UPDATE_CHECK_ENABLED {
        return None;
    }
    get_staged_version_info()
}

#[tauri::command]
pub fn apply_update_and_restart(app_handle: tauri::AppHandle) -> Result<(), String> {
    let staged_exe = get_staged_exe_path();
    if !staged_exe.exists() {
        return Err("Файл обновления не найден в update_staged".into());
    }

    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Не удалось определить путь к текущему omnitool.exe: {}", e))?;

    let staged_str = staged_exe.to_string_lossy().to_string();
    let current_str = current_exe.to_string_lossy().to_string();
    let parent_dir = current_exe.parent().unwrap_or(Path::new("")).to_string_lossy().to_string();

    let script = format!(
        "Start-Sleep -Milliseconds 600; \
         Copy-Item -Path '{staged}' -Destination '{target}' -Force; \
         Remove-Item -Path '{staged}' -Force -ErrorAction SilentlyContinue; \
         Start-Process -FilePath '{target}' -WorkingDirectory '{wdir}'",
        staged = staged_str.replace('\'', "''"),
        target = current_str.replace('\'', "''"),
        wdir = parent_dir.replace('\'', "''"),
    );

    let mut cmd = silent_command("powershell");
    cmd.args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script]);

    cmd.spawn()
        .map_err(|e| format!("Не удалось запустить процесс обновления: {}", e))?;

    app_handle.exit(0);
    Ok(())
}

/// Проверка и применение обновления на старте (только если UPDATE_CHECK_ENABLED и файл реально готов)
pub fn check_and_apply_update_on_startup() -> bool {
    if !UPDATE_CHECK_ENABLED {
        return false;
    }

    let cfg = read_config_from_disk();
    if !cfg.auto_update_on_restart {
        return false;
    }

    let staged_exe = get_staged_exe_path();
    if !staged_exe.exists() {
        return false;
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if current_exe == staged_exe {
            return false;
        }

        let staged_str = staged_exe.to_string_lossy().to_string();
        let current_str = current_exe.to_string_lossy().to_string();
        let parent_dir = current_exe.parent().unwrap_or(Path::new("")).to_string_lossy().to_string();

        let script = format!(
            "Start-Sleep -Milliseconds 400; \
             Copy-Item -Path '{staged}' -Destination '{target}' -Force; \
             Remove-Item -Path '{staged}' -Force -ErrorAction SilentlyContinue; \
             Start-Process -FilePath '{target}' -WorkingDirectory '{wdir}'",
            staged = staged_str.replace('\'', "''"),
            target = current_str.replace('\'', "''"),
            wdir = parent_dir.replace('\'', "''"),
        );

        let mut cmd = silent_command("powershell");
        cmd.args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script]);
        if cmd.spawn().is_ok() {
            std::process::exit(0);
        }
    }

    false
}
