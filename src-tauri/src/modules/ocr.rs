use std::path::{Path, PathBuf};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use super::cmd_utils::silent_command;

#[derive(Clone, Serialize, Deserialize)]
pub struct OcrDownloadProgress {
    pub percent: f32,
    pub lang: String,
    pub status: String,
}

fn get_app_tessdata_dir() -> PathBuf {
    let base_dir = if let Ok(app_data) = std::env::var("APPDATA") {
        PathBuf::from(app_data).join("OmniTool").join("tessdata")
    } else {
        std::env::temp_dir().join("OmniTool_tessdata")
    };
    let _ = std::fs::create_dir_all(&base_dir);
    base_dir
}

fn get_bundled_tessdata_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            dirs.push(exe_dir.join("resources").join("tessdata"));
            dirs.push(exe_dir.join("tessdata"));
        }
    }
    dirs.push(PathBuf::from("resources").join("tessdata"));
    dirs.push(PathBuf::from("src-tauri").join("resources").join("tessdata"));
    dirs.push(PathBuf::from("D:\\OmniTool\\resources\\tessdata"));
    dirs
}

fn sync_bundled_tessdata(target_dir: &Path) {
    for bundled in get_bundled_tessdata_dirs() {
        if bundled.exists() {
            if let Ok(entries) = std::fs::read_dir(&bundled) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) == Some("traineddata") {
                        let filename = entry.file_name();
                        let dest = target_dir.join(&filename);
                        if !dest.exists() {
                            let _ = std::fs::copy(&path, &dest);
                        }
                    }
                }
            }
        }
    }
}

async fn find_or_download_tesseract(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 1. Проверяем рядом с запущенным exe или в ресурсах приложения
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = [
                exe_dir.join("resources").join("tesseract").join("tesseract.exe"),
                exe_dir.join("bin").join("tesseract.exe"),
                exe_dir.join("tesseract.exe"),
            ];
            for p in &candidates {
                if p.exists() {
                    return Ok(p.clone());
                }
            }
        }
    }

    // 2. Проверяем папку %APPDATA%/OmniTool/bin/tesseract
    let app_bin_dir = if let Ok(app_data) = std::env::var("APPDATA") {
        PathBuf::from(app_data).join("OmniTool").join("bin").join("tesseract")
    } else {
        std::env::temp_dir().join("OmniTool_bin").join("tesseract")
    };
    let app_tess_exe = app_bin_dir.join("tesseract.exe");
    if app_tess_exe.exists() {
        return Ok(app_tess_exe);
    }

    // 3. Проверяем локальные пути в проекте
    let project_candidates = [
        PathBuf::from("resources/tesseract/tesseract.exe"),
        PathBuf::from("src-tauri/resources/tesseract/tesseract.exe"),
        PathBuf::from("D:\\OmniTool\\resources\\tesseract\\tesseract.exe"),
        PathBuf::from("bin/tesseract.exe"),
    ];
    for p in &project_candidates {
        if p.exists() {
            return Ok(p.clone());
        }
    }

    // 4. Проверяем PATH
    if silent_command("tesseract").arg("--version").output().is_ok() {
        return Ok(PathBuf::from("tesseract"));
    }

    // 5. Если tesseract не найден, скачиваем портативный статический релиз (2.5 МБ) в %APPDATA%
    let _ = app_handle.emit(
        "ocr-download-progress",
        OcrDownloadProgress {
            percent: 10.0,
            lang: "tesseract".into(),
            status: "Загрузка портативного ядра Tesseract (2.5 МБ)...".into(),
        },
    );

    let _ = std::fs::create_dir_all(&app_bin_dir);
    let archive_path = app_bin_dir.join("tesseract-portable.tar.gz");

    let download_url = "https://github.com/mikhailgarber/tesseract-portable/releases/download/v5.5.3_5/tesseract-5.5.3_5-x64-windows-static.tar.gz";
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Ошибка создания HTTP клиента: {}", e))?;

    let resp = client
        .get(download_url)
        .header("User-Agent", "OmniTool-Desktop")
        .send()
        .await
        .map_err(|e| format!("Не удалось скачать портативный Tesseract: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Ошибка сервера при скачивании Tesseract: HTTP {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения архива Tesseract: {}", e))?;

    std::fs::write(&archive_path, &bytes)
        .map_err(|e| format!("Не удалось сохранить архив Tesseract: {}", e))?;

    let _ = app_handle.emit(
        "ocr-download-progress",
        OcrDownloadProgress {
            percent: 75.0,
            lang: "tesseract".into(),
            status: "Распаковка Tesseract...".into(),
        },
    );

    // Распаковываем через встроенный в Windows tar.exe
    let unpack_status = silent_command("tar.exe")
        .arg("-xzf")
        .arg(&archive_path)
        .arg("-C")
        .arg(&app_bin_dir)
        .status()
        .map_err(|e| format!("Ошибка распаковки tar.exe: {}", e))?;

    let _ = std::fs::remove_file(&archive_path);

    if !unpack_status.success() {
        return Err("Не удалось распаковать архив tesseract.exe".into());
    }

    // В архиве бинарник лежит в bin/tesseract.exe
    let unpacked_exe = app_bin_dir.join("bin").join("tesseract.exe");
    if unpacked_exe.exists() {
        let _ = std::fs::copy(&unpacked_exe, &app_tess_exe);
        return Ok(app_tess_exe);
    }

    if app_tess_exe.exists() {
        return Ok(app_tess_exe);
    }

    Err("Файл tesseract.exe не найден после распаковки".into())
}

pub async fn ensure_language_model(
    lang_code: &str,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let clean_code = lang_code.trim();
    if clean_code.is_empty() {
        return Ok(());
    }

    let tessdata_dir = get_app_tessdata_dir();
    let model_file = tessdata_dir.join(format!("{}.traineddata", clean_code));
    if model_file.exists() {
        return Ok(());
    }

    let _ = app_handle.emit(
        "ocr-download-progress",
        OcrDownloadProgress {
            percent: 5.0,
            lang: clean_code.to_string(),
            status: format!("Загрузка языкового словаря: {}...", clean_code),
        },
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Ошибка HTTP клиента: {}", e))?;

    let url = format!(
        "https://github.com/tesseract-ocr/tessdata_fast/raw/main/{}.traineddata",
        clean_code
    );

    let resp = client
        .get(&url)
        .header("User-Agent", "OmniTool-Desktop")
        .send()
        .await
        .map_err(|e| format!("Не удалось подключиться для загрузки языка {}: {}", clean_code, e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Языковой пакет «{}» не найден в официальном репозитории tessdata (HTTP {})",
            clean_code,
            resp.status()
        ));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Ошибка загрузки словаря {}: {}", clean_code, e))?;

    let temp_dest = tessdata_dir.join(format!("{}.traineddata.tmp", clean_code));
    std::fs::write(&temp_dest, &bytes)
        .map_err(|e| format!("Ошибка сохранения файла словаря {}: {}", clean_code, e))?;

    std::fs::rename(&temp_dest, &model_file)
        .map_err(|e| format!("Ошибка фиксации словаря {}: {}", clean_code, e))?;

    let _ = app_handle.emit(
        "ocr-download-progress",
        OcrDownloadProgress {
            percent: 100.0,
            lang: clean_code.to_string(),
            status: format!("Языковой словарь {} готов к работе!", clean_code),
        },
    );

    Ok(())
}

fn preprocess_image_for_ocr(input_path: &Path, output_path: &Path) -> Result<(), String> {
    let mut img = image::open(input_path)
        .map_err(|e| format!("Ошибка открытия изображения для предобработки: {}", e))?;

    // Если скриншот/изображение мелкое, аккуратно масштабируем его с сохранением четкости
    let (w, h) = (img.width(), img.height());
    if w < 1200 && h < 800 {
        let new_w = (w * 2).min(2800);
        let new_h = (h * 2).min(2000);
        img = img.resize(new_w, new_h, image::imageops::FilterType::CatmullRom);
    }

    // 1. Переводим в оттенки серого (grayscale)
    let gray = img.to_luma8();

    // 2. Динамическое растяжение контраста (contrast stretch)
    let mut min_luma = 255u8;
    let mut max_luma = 0u8;
    for pixel in gray.pixels() {
        let val = pixel.0[0];
        if val < min_luma { min_luma = val; }
        if val > max_luma { max_luma = val; }
    }

    let mut enhanced = gray;
    let range = (max_luma as f32) - (min_luma as f32);
    if range > 20.0 && range < 245.0 {
        for pixel in enhanced.pixels_mut() {
            let val = pixel.0[0] as f32;
            let stretched = ((val - min_luma as f32) / range * 255.0).clamp(0.0, 255.0) as u8;
            pixel.0[0] = stretched;
        }
    }

    enhanced
        .save(output_path)
        .map_err(|e| format!("Ошибка сохранения предобработанного изображения: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn get_available_ocr_languages() -> Result<Vec<String>, String> {
    let tessdata_dir = get_app_tessdata_dir();
    sync_bundled_tessdata(&tessdata_dir);

    let mut langs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&tessdata_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("traineddata") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if stem != "osd" {
                        langs.push(stem.to_string());
                    }
                }
            }
        }
    }
    langs.sort();
    Ok(langs)
}

#[tauri::command]
pub async fn download_ocr_language(
    lang_code: String,
    app_handle: tauri::AppHandle,
) -> Result<bool, String> {
    ensure_language_model(&lang_code, &app_handle).await?;
    Ok(true)
}

#[tauri::command]
pub async fn recognize_text(
    image_path: String,
    lang: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let in_file = Path::new(&image_path);
    if !in_file.exists() {
        return Err(format!("Файл не существует: {}", image_path));
    }

    // 1. Поиск/загрузка tesseract.exe
    let tesseract_bin = find_or_download_tesseract(&app_handle).await?;

    // 2. Синхронизация и подготовка папки tessdata
    let tessdata_dir = get_app_tessdata_dir();
    sync_bundled_tessdata(&tessdata_dir);

    // 3. Определение языковой модели (по умолчанию ukr+rus+eng)
    let lang_spec = lang.unwrap_or_default().trim().to_string();
    let effective_lang = if lang_spec.is_empty() || lang_spec == "auto" {
        "ukr+rus+eng".to_string()
    } else {
        lang_spec
    };

    // 4. Проверяем и динамически докачиваем все запрошенные языковые пакеты
    let needed_langs: Vec<&str> = effective_lang
        .split(|c| c == '+' || c == ',' || c == ';')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    for code in &needed_langs {
        ensure_language_model(code, &app_handle).await?;
    }

    // 5. Предобработка изображения через крейт image
    let temp_dir = std::env::temp_dir().join("OmniTool_ocr");
    let _ = std::fs::create_dir_all(&temp_dir);
    let preprocessed_path = temp_dir.join(format!(
        "pre_{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));

    preprocess_image_for_ocr(in_file, &preprocessed_path)?;

    // 6. Запуск Tesseract OCR скрытно через Command::new (CREATE_NO_WINDOW)
    let mut cmd = silent_command(&tesseract_bin);
    cmd.arg(&preprocessed_path)
        .arg("stdout")
        .arg("--tessdata-dir")
        .arg(&tessdata_dir)
        .arg("-l")
        .arg(&effective_lang)
        .args(["--oem", "1"])
        .args(["--psm", "3"]);

    let output = cmd
        .output()
        .map_err(|e| format!("Ошибка запуска процесса Tesseract: {}", e))?;

    let _ = std::fs::remove_file(&preprocessed_path);

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() && stdout.is_empty() {
        return Err(format!("Ошибка Tesseract OCR:\n{}", stderr));
    }

    Ok(stdout)
}

#[tauri::command]
pub async fn recognize_base64(
    base64_data: String,
    lang: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let clean_base64 = if let Some(idx) = base64_data.find(',') {
        &base64_data[idx + 1..]
    } else {
        &base64_data
    };

    let bytes = BASE64
        .decode(clean_base64.trim())
        .map_err(|e| format!("Некорректный base64: {}", e))?;

    let temp_dir = std::env::temp_dir().join("OmniTool_ocr");
    let _ = std::fs::create_dir_all(&temp_dir);
    let temp_file = temp_dir.join(format!(
        "paste_{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));

    std::fs::write(&temp_file, &bytes)
        .map_err(|e| format!("Ошибка сохранения временного файла: {}", e))?;

    let res = recognize_text(temp_file.to_string_lossy().to_string(), lang, app_handle).await;
    let _ = std::fs::remove_file(&temp_file);
    res
}
