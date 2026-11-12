use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use super::cmd_utils::silent_command;

#[derive(Debug, Serialize, Deserialize)]
pub struct ConversionResult {
    pub success: bool,
    pub output_path: String,
    pub message: String,
}

fn find_ffmpeg() -> Option<PathBuf> {
    // 1. Проверяем наличие рядом с запущенным exe или в bin/
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = [
                exe_dir.join("ffmpeg.exe"),
                exe_dir.join("bin").join("ffmpeg.exe"),
                exe_dir.join("resources").join("bin").join("ffmpeg.exe"),
                exe_dir.join("resources").join("ffmpeg.exe"),
            ];
            for path in &candidates {
                if path.exists() {
                    return Some(path.clone());
                }
            }
        }
    }

    // 2. Проверяем системный PATH
    if silent_command("ffmpeg").arg("-version").output().is_ok() {
        return Some(PathBuf::from("ffmpeg"));
    }

    None
}

#[tauri::command]
pub async fn convert_media(
    input_path: String,
    output_path: String,
    target_format: String,
    start_time: Option<String>,
    end_time: Option<String>,
) -> Result<ConversionResult, String> {
    let in_file = Path::new(&input_path);
    if !in_file.exists() {
        return Err(format!("Исходный файл не существует: {}", input_path));
    }

    let fmt = target_format.trim().to_lowercase();
    let out_file: PathBuf = if output_path.trim().is_empty() {
        let parent = in_file.parent().unwrap_or_else(|| Path::new("."));
        let stem = in_file.file_stem().and_then(|s| s.to_str()).unwrap_or("converted");
        parent.join(format!("{}.{}", stem, fmt))
    } else {
        PathBuf::from(output_path.trim())
    };

    let _cancel_flag = crate::modules::task_manager::register_task("converter");
    crate::modules::task_manager::add_cleanup_file("converter", out_file.clone());

    let has_trim = start_time.as_ref().map_or(false, |s| !s.trim().is_empty())
        || end_time.as_ref().map_or(false, |e| !e.trim().is_empty());

    // 1. Если это конвертация между простыми изображениями (PNG, JPG, WebP) без тримминга
    let is_img_input = matches!(
        in_file.extension().and_then(|e| e.to_str()).map(|s| s.to_lowercase()).as_deref(),
        Some("png") | Some("jpg") | Some("jpeg") | Some("webp")
    );
    let is_img_output = matches!(fmt.as_str(), "png" | "jpg" | "jpeg" | "webp");

    if is_img_input && is_img_output && !has_trim {
        let img = match image::open(in_file) {
            Ok(im) => im,
            Err(e) => {
                crate::modules::task_manager::unregister_task("converter");
                return Err(format!("Ошибка чтения изображения: {}", e));
            }
        };

        let img_fmt = match fmt.as_str() {
            "png" => image::ImageFormat::Png,
            "jpg" | "jpeg" => image::ImageFormat::Jpeg,
            "webp" => image::ImageFormat::WebP,
            _ => image::ImageFormat::Png,
        };

        if let Err(e) = img.save_with_format(&out_file, img_fmt) {
            crate::modules::task_manager::unregister_task("converter");
            return Err(format!("Ошибка сохранения {}: {}", out_file.display(), e));
        }

        crate::modules::task_manager::unregister_task("converter");

        return Ok(ConversionResult {
            success: true,
            output_path: out_file.to_string_lossy().to_string(),
            message: format!("Изображение сконвертировано в {} через встроенный рантайм", fmt.to_uppercase()),
        });
    }

    // 2. Для видео, аудио и GIF используем FFmpeg
    let ffmpeg_bin = match find_ffmpeg() {
        Some(bin) => bin,
        None => {
            crate::modules::task_manager::unregister_task("converter");
            return Err("Для конвертации видео, аудио и создания GIF требуется FFmpeg.\n\
            Установите его через 'winget install Gyan.FFmpeg' или поместите ffmpeg.exe в папку программы."
                .to_string());
        }
    };

    let mut cmd = silent_command(ffmpeg_bin);
    cmd.arg("-y");

    // Тримминг начала (быстрый seek до ввода)
    if let Some(ref st) = start_time {
        let s = st.trim();
        if !s.is_empty() {
            cmd.args(["-ss", s]);
        }
    }

    // Тримминг конца
    if let Some(ref et) = end_time {
        let e = et.trim();
        if !e.is_empty() {
            cmd.args(["-to", e]);
        }
    }

    cmd.args(["-i", &input_path]);

    // Особый высококачественный пресет для GIF
    if fmt == "gif" {
        cmd.args([
            "-vf",
            "fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
        ]);
    }

    cmd.arg(&out_file.to_string_lossy().to_string());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            crate::modules::task_manager::unregister_task("converter");
            return Err(format!("Не удалось запустить FFmpeg: {}", e));
        }
    };

    crate::modules::task_manager::update_task_pid("converter", child.id());

    let status = match child.wait() {
        Ok(s) => s,
        Err(e) => {
            crate::modules::task_manager::unregister_task("converter");
            return Err(format!("Ошибка ожидания FFmpeg: {}", e));
        }
    };

    if crate::modules::task_manager::is_task_cancelled("converter") {
        let _ = std::fs::remove_file(&out_file);
        crate::modules::task_manager::unregister_task("converter");
        return Err("TASK_CANCELLED_BY_USER".into());
    }

    if !status.success() {
        let _ = std::fs::remove_file(&out_file);
        if crate::modules::task_manager::is_task_cancelled("converter") {
            crate::modules::task_manager::unregister_task("converter");
            return Err("TASK_CANCELLED_BY_USER".into());
        }
        crate::modules::task_manager::unregister_task("converter");
        return Err("Ошибка при выполнении конвертации FFmpeg".into());
    }

    crate::modules::task_manager::unregister_task("converter");

    Ok(ConversionResult {
        success: true,
        output_path: out_file.to_string_lossy().to_string(),
        message: format!("Файл успешно перекодирован в {}", fmt.to_uppercase()),
    })
}
