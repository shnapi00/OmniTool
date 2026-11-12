use std::path::Path;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use super::cmd_utils::silent_command;

#[tauri::command]
pub async fn get_autostart() -> Result<bool, String> {
    let output = silent_command("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "OmniTool",
        ])
        .output();

    match output {
        Ok(out) => Ok(out.status.success()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn set_autostart(enable: bool) -> Result<(), String> {
    if enable {
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Не удалось определить путь к исполняемому файлу: {}", e))?;
        let exe_str = exe_path.to_string_lossy();

        let val = format!("\"{}\"", exe_str);

        let output = silent_command("reg")
            .args([
                "add",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "OmniTool",
                "/t",
                "REG_SZ",
                "/d",
                &val,
                "/f",
            ])
            .output()
            .map_err(|e| format!("Не удалось добавить автозагрузку в реестр: {}", e))?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Ошибка reg add: {}", err));
        }
    } else {
        let _ = silent_command("reg")
            .args([
                "delete",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "OmniTool",
                "/f",
            ])
            .output();
    }

    Ok(())
}

#[tauri::command]
pub async fn save_canvas_image(path: String, base64_data: String) -> Result<(), String> {
    let clean_base64 = if let Some(idx) = base64_data.find(',') {
        &base64_data[idx + 1..]
    } else {
        &base64_data
    };

    let bytes = BASE64
        .decode(clean_base64.trim())
        .map_err(|e| format!("Ошибка декодирования base64: {}", e))?;

    let out_path = Path::new(&path);
    if let Some(parent) = out_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    std::fs::write(out_path, bytes)
        .map_err(|e| format!("Не удалось сохранить файл: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn save_temp_image(base64_data: String) -> Result<String, String> {
    let clean_base64 = if let Some(idx) = base64_data.find(',') {
        &base64_data[idx + 1..]
    } else {
        &base64_data
    };

    let bytes = BASE64
        .decode(clean_base64.trim())
        .map_err(|e| format!("Ошибка декодирования base64: {}", e))?;

    let temp_dir = std::env::temp_dir().join("OmniTool_temp");
    let _ = std::fs::create_dir_all(&temp_dir);
    let filename = format!(
        "clip_{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let file_path = temp_dir.join(filename);

    std::fs::write(&file_path, bytes)
        .map_err(|e| format!("Не удалось сохранить временное изображение: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}
