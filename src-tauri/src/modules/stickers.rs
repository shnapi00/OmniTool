use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use crate::modules::cmd_utils::silent_command;

include!(concat!(env!("OUT_DIR"), "/embedded_token.rs"));

/// Проверка наличия встроенного зашифрованного токена бота
#[tauri::command]
pub fn has_builtin_tg_token() -> bool {
    has_default_token()
}

fn get_effective_bot_token(user_token: Option<&str>) -> Result<String, &'static str> {
    if let Some(t) = user_token {
        let trimmed = t.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    let default_tok = get_default_token();
    let trimmed = default_tok.trim().to_string();
    if !trimmed.is_empty() {
        return Ok(trimmed);
    }

    Err("Укажите токен Telegram-бота в настройках приложения")
}

fn find_binary(bin_name: &str) -> Option<PathBuf> {
    let exe_with_ext = if cfg!(windows) {
        format!("{}.exe", bin_name)
    } else {
        bin_name.to_string()
    };

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = [
                exe_dir.join(&exe_with_ext),
                exe_dir.join("bin").join(&exe_with_ext),
                exe_dir.join("resources").join("bin").join(&exe_with_ext),
                exe_dir.join("resources").join(&exe_with_ext),
            ];
            for path in &candidates {
                if path.exists() {
                    return Some(path.clone());
                }
            }
        }
    }

    if silent_command(bin_name).arg("-version").output().is_ok() {
        return Some(PathBuf::from(bin_name));
    }

    None
}

fn random_id() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn convert_video_sticker_file(temp_webm: &Path, final_file: &Path, format: &str) -> Result<(), String> {
    let ffmpeg_bin = find_binary("ffmpeg").ok_or_else(|| "FFmpeg не найден в системе".to_string())?;

    if format.to_lowercase() == "gif" {
        let mut cmd = silent_command(&ffmpeg_bin);
        cmd.args([
            "-y",
            "-c:v", "libvpx-vp9",
            "-i", &temp_webm.to_string_lossy(),
            "-filter_complex", "[0:v] fps=25,split [a][b];[a] palettegen=reserve_transparent=on:transparency_color=ffffff [p];[b][p] paletteuse=alpha_threshold=128",
            "-loop", "0",
            "-an",
            &final_file.to_string_lossy(),
        ]);
        let res = cmd.status();
        if res.is_err() || !res.unwrap().success() {
            let status2 = silent_command(&ffmpeg_bin)
                .args([
                    "-y",
                    "-i", &temp_webm.to_string_lossy(),
                    "-filter_complex", "[0:v] fps=25,split [a][b];[a] palettegen=reserve_transparent=on:transparency_color=ffffff [p];[b][p] paletteuse=alpha_threshold=128",
                    "-loop", "0",
                    "-an",
                    &final_file.to_string_lossy(),
                ])
                .status();
            if status2.is_err() || !status2.unwrap().success() {
                return Err("Ошибка конвертации видео в GIF через FFmpeg".into());
            }
        }
    } else {
        let mut cmd = silent_command(&ffmpeg_bin);
        cmd.args([
            "-y",
            "-c:v", "libvpx-vp9",
            "-i", &temp_webm.to_string_lossy(),
            "-c:v", "libwebp",
            "-lossless", "0",
            "-q:v", "75",
            "-loop", "0",
            "-an",
            "-pix_fmt", "yuva420p",
            &final_file.to_string_lossy(),
        ]);
        let res = cmd.status();
        if res.is_err() || !res.unwrap().success() {
            let status2 = silent_command(&ffmpeg_bin)
                .args([
                    "-y",
                    "-i", &temp_webm.to_string_lossy(),
                    "-c:v", "libwebp",
                    "-lossless", "0",
                    "-q:v", "75",
                    "-loop", "0",
                    "-an",
                    "-pix_fmt", "yuva420p",
                    &final_file.to_string_lossy(),
                ])
                .status();
            if status2.is_err() || !status2.unwrap().success() {
                return Err("Ошибка конвертации видео в WebP через FFmpeg".into());
            }
        }
    }
    Ok(())
}

fn convert_frames_to_animated(temp_folder: &Path, final_file: &Path, fps: u32, format: &str) -> Result<(), String> {
    let ffmpeg_bin = find_binary("ffmpeg").ok_or_else(|| "FFmpeg не найден в системе".to_string())?;
    let frames_pattern = temp_folder.join("frame_%03d.png");
    let fps_str = fps.max(1).to_string();

    if format.to_lowercase() == "gif" {
        let status = silent_command(&ffmpeg_bin)
            .args([
                "-y",
                "-framerate", &fps_str,
                "-i", &frames_pattern.to_string_lossy(),
                "-filter_complex", "[0:v] split [a][b];[a] palettegen=reserve_transparent=on:transparency_color=ffffff [p];[b][p] paletteuse=alpha_threshold=128",
                "-loop", "0",
                &final_file.to_string_lossy(),
            ])
            .status();
        if status.is_err() || !status.unwrap().success() {
            return Err("Ошибка сборки GIF из кадров через FFmpeg".into());
        }
    } else {
        let status = silent_command(&ffmpeg_bin)
            .args([
                "-y",
                "-framerate", &fps_str,
                "-i", &frames_pattern.to_string_lossy(),
                "-c:v", "libwebp",
                "-lossless", "0",
                "-q:v", "75",
                "-loop", "0",
                "-pix_fmt", "yuva420p",
                &final_file.to_string_lossy(),
            ])
            .status();
        if status.is_err() || !status.unwrap().success() {
            return Err("Ошибка сборки WebP из кадров через FFmpeg".into());
        }
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StickerDownloadResult {
    pub success: bool,
    pub pack_name: String,
    pub title: String,
    pub count: usize,
    pub saved_dir: String,
    pub message: String,
}

#[derive(Clone, Serialize)]
struct ProgressPayload {
    pub current: usize,
    pub total: usize,
    pub status: String,
}

#[derive(Deserialize)]
struct TgResponse<T> {
    ok: bool,
    description: Option<String>,
    result: Option<T>,
}

#[derive(Deserialize)]
struct TgThumb {
    file_id: String,
}

#[derive(Deserialize)]
struct TgSticker {
    file_id: String,
    emoji: Option<String>,
    is_animated: Option<bool>,
    is_video: Option<bool>,
    thumbnail: Option<TgThumb>,
    thumb: Option<TgThumb>,
}

impl TgSticker {
    pub fn get_thumb_id(&self) -> Option<String> {
        self.thumbnail
            .as_ref()
            .map(|t| t.file_id.clone())
            .or_else(|| self.thumb.as_ref().map(|t| t.file_id.clone()))
    }
}

#[derive(Deserialize)]
struct TgStickerSet {
    name: String,
    title: String,
    is_animated: Option<bool>,
    is_video: Option<bool>,
    stickers: Vec<TgSticker>,
}

#[derive(Deserialize)]
struct TgFile {
    #[allow(dead_code)]
    file_id: String,
    file_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StickerPreviewItem {
    pub index: usize,
    pub file_id: String,
    pub thumb_id: Option<String>,
    pub emoji: Option<String>,
    pub is_animated: bool,
    pub is_video: bool,
    pub preview_url: String,
    pub raw_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StickerPackInfo {
    pub name: String,
    pub title: String,
    pub total: usize,
    pub stickers: Vec<StickerPreviewItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SelectedStickerItem {
    pub file_id: String,
    pub thumb_id: Option<String>,
    #[serde(default)]
    pub is_animated: bool,
    #[serde(default)]
    pub is_video: bool,
}

fn clean_pack_name(input: &str) -> String {
    let mut clean = input.trim().to_string();
    if clean.contains("addstickers/") {
        if let Some(part) = clean.split("addstickers/").last() {
            clean = part.split('?').next().unwrap_or(part).trim().to_string();
        }
    } else if clean.starts_with("t.me/") {
        if let Some(part) = clean.split('/').last() {
            clean = part.split('?').next().unwrap_or(part).trim().to_string();
        }
    }
    clean
}

async fn get_file_path(client: &reqwest::Client, token: &str, file_id: &str) -> Option<String> {
    let get_file_url = format!(
        "https://api.telegram.org/bot{}/getFile?file_id={}",
        token, file_id
    );
    for _ in 0..3 {
        if let Ok(resp) = client.get(&get_file_url).send().await {
            if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
                tokio::time::sleep(std::time::Duration::from_millis(350)).await;
                continue;
            }
            if let Ok(tg_file) = resp.json::<TgResponse<TgFile>>().await {
                if let Some(res) = tg_file.result {
                    return res.file_path;
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    None
}

/// Получение метаданных и списка превью стикеров из пака
#[tauri::command]
pub async fn load_sticker_pack(
    token: Option<String>,
    pack_name: String,
) -> Result<StickerPackInfo, String> {
    let clean_token_owned = get_effective_bot_token(token.as_deref()).map_err(|e| e.to_string())?;
    let clean_token = clean_token_owned.as_str();

    let clean_pack = clean_pack_name(&pack_name);
    if clean_pack.is_empty() {
        return Err("Укажите имя стикерпака или ссылку".into());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Ошибка создания HTTP клиента: {}", e))?;

    let set_url = format!(
        "https://api.telegram.org/bot{}/getStickerSet?name={}",
        clean_token, clean_pack
    );

    let res = client
        .get(&set_url)
        .send()
        .await
        .map_err(|e| format!("Сетевая ошибка при обращении к Telegram Bot API: {}", e))?;

    let tg_set_res: TgResponse<TgStickerSet> = res
        .json()
        .await
        .map_err(|e| format!("Не удалось распарсить ответ Telegram: {}", e))?;

    if !tg_set_res.ok || tg_set_res.result.is_none() {
        let desc = tg_set_res
            .description
            .unwrap_or_else(|| "Стикерпак не найден. Проверьте правильность названия или ссылки.".into());
        return Err(format!("Ошибка Telegram API: {}", desc));
    }

    let sticker_set = tg_set_res.result.unwrap();
    let total = sticker_set.stickers.len();
    if total == 0 {
        return Err("В этом стикерпаке нет стикеров".into());
    }

    // Параллельное получение file_path для каждого стикера (до 20 одновременных запросов)
    let semaphore = Arc::new(Semaphore::new(20));
    let mut join_set = JoinSet::new();

    let set_is_animated = sticker_set.is_animated.unwrap_or(false);
    let set_is_video = sticker_set.is_video.unwrap_or(false);

    for (idx, sticker) in sticker_set.stickers.into_iter().enumerate() {
        let sem = semaphore.clone();
        let client_clone = client.clone();
        let token_owned = clean_token.to_string();

        let thumb_id = sticker.get_thumb_id();
        let emoji = sticker.emoji;
        let is_animated = sticker.is_animated.unwrap_or(false) || set_is_animated;
        let is_video = sticker.is_video.unwrap_or(false) || set_is_video;
        let file_id = sticker.file_id;
        let thumb_id_for_item = thumb_id.clone();

        join_set.spawn(async move {
            let _permit = sem.acquire().await.ok();
            let (preview_url, raw_url) = if is_animated {
                let r_path = get_file_path(&client_clone, &token_owned, &file_id).await;
                let p_path = if let Some(ref tid) = thumb_id_for_item {
                    get_file_path(&client_clone, &token_owned, tid).await
                } else {
                    None
                };

                let r_url = r_path
                    .map(|p| format!("https://api.telegram.org/file/bot{}/{}", token_owned, p))
                    .unwrap_or_default();
                let p_url = p_path
                    .map(|p| format!("https://api.telegram.org/file/bot{}/{}", token_owned, p))
                    .unwrap_or_default();

                let final_p_url = if !p_url.is_empty() { p_url } else { r_url.clone() };
                (final_p_url, r_url)
            } else if is_video {
                let r_path = get_file_path(&client_clone, &token_owned, &file_id).await;
                let p_path = if let Some(ref tid) = thumb_id_for_item {
                    get_file_path(&client_clone, &token_owned, tid).await
                } else {
                    None
                };

                let r_url = r_path
                    .map(|p| format!("https://api.telegram.org/file/bot{}/{}", token_owned, p))
                    .unwrap_or_default();
                let p_url = p_path
                    .map(|p| format!("https://api.telegram.org/file/bot{}/{}", token_owned, p))
                    .unwrap_or_default();

                let final_p_url = if !p_url.is_empty() { p_url } else { r_url.clone() };
                (final_p_url, r_url)
            } else {
                let r_path = get_file_path(&client_clone, &token_owned, &file_id).await;
                let r_url = r_path
                    .map(|p| format!("https://api.telegram.org/file/bot{}/{}", token_owned, p))
                    .unwrap_or_default();
                (r_url.clone(), r_url)
            };

            StickerPreviewItem {
                index: idx + 1,
                file_id,
                thumb_id: thumb_id_for_item,
                emoji,
                is_animated,
                is_video,
                preview_url,
                raw_url,
            }
        });
    }

    let mut stickers = Vec::with_capacity(total);
    while let Some(res) = join_set.join_next().await {
        if let Ok(item) = res {
            stickers.push(item);
        }
    }

    stickers.sort_by_key(|s| s.index);

    Ok(StickerPackInfo {
        name: sticker_set.name,
        title: sticker_set.title,
        total,
        stickers,
    })
}

/// Загрузка сырых байтов файла стикера (для распаковки TGS Lottie JSON без ограничений CORS)
#[tauri::command]
pub async fn fetch_sticker_bytes(
    token: Option<String>,
    file_id: String,
) -> Result<Vec<u8>, String> {
    let clean_token_owned = get_effective_bot_token(token.as_deref()).map_err(|e| e.to_string())?;
    let clean_token = clean_token_owned.as_str();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Ошибка создания HTTP клиента: {}", e))?;

    if let Some(path) = get_file_path(&client, clean_token, &file_id).await {
        let download_url = format!("https://api.telegram.org/file/bot{}/{}", clean_token, path);
        let resp = client
            .get(&download_url)
            .send()
            .await
            .map_err(|e| format!("Ошибка загрузки файла стикера: {}", e))?;

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Ошибка чтения данных: {}", e))?;

        Ok(bytes.to_vec())
    } else {
        Err("Не удалось получить путь к файлу стикера в Telegram".into())
    }
}

/// Подготовка целевой директории для стикерпака
#[tauri::command]
pub async fn prepare_sticker_pack_dir(
    pack_name: String,
    output_dir: String,
) -> Result<String, String> {
    let clean_pack = clean_pack_name(&pack_name);
    let base_dir = if output_dir.trim().is_empty() {
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            std::path::PathBuf::from(user_profile).join("Downloads").join("Stickers")
        } else {
            std::path::PathBuf::from("Downloads").join("Stickers")
        }
    } else {
        let p = std::path::PathBuf::from(output_dir.trim());
        if p.is_relative() {
            let str_val = output_dir.trim().replace('/', "\\");
            if str_val.starts_with("Downloads\\") || str_val == "Downloads" {
                if let Ok(user_profile) = std::env::var("USERPROFILE") {
                    std::path::PathBuf::from(user_profile).join(str_val)
                } else {
                    std::env::current_dir().unwrap_or_default().join(p)
                }
            } else {
                std::env::current_dir().unwrap_or_default().join(p)
            }
        } else {
            p
        }
    };

    let target_dir = base_dir.join(&clean_pack);
    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Не удалось создать директорию {}: {}", target_dir.display(), e))?;

    let abs_target_dir_str = std::fs::canonicalize(&target_dir)
        .map(|p| {
            let s = p.to_string_lossy().to_string();
            s.strip_prefix(r"\\?\").map(|x| x.to_string()).unwrap_or(s)
        })
        .unwrap_or_else(|_| target_dir.to_string_lossy().to_string());

    Ok(abs_target_dir_str)
}

/// Сохранение статичного стикера в чистый прозрачный PNG (1 файл)
#[tauri::command]
pub async fn save_static_sticker(
    token: Option<String>,
    file_id: String,
    target_dir: String,
    index: usize,
) -> Result<String, String> {
    let clean_token_owned = get_effective_bot_token(token.as_deref()).map_err(|e| e.to_string())?;
    let clean_token = clean_token_owned.as_str();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Ошибка создания HTTP клиента: {}", e))?;

    let remote_path = get_file_path(&client, clean_token, &file_id)
        .await
        .ok_or_else(|| "Не удалось получить путь к файлу стикера в Telegram".to_string())?;

    let download_url = format!("https://api.telegram.org/file/bot{}/{}", clean_token, remote_path);
    let resp = client.get(&download_url).send().await.map_err(|e| e.to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

    let final_path = Path::new(&target_dir).join(format!("{:03}.png", index));

    let img = image::load_from_memory(&bytes)
        .map_err(|e| format!("Ошибка декодирования изображения: {}", e))?;
    img.save_with_format(&final_path, image::ImageFormat::Png)
        .map_err(|e| format!("Ошибка сохранения PNG: {}", e))?;

    Ok(final_path.to_string_lossy().to_string())
}

/// Сохранение видеостикера (.webm) с конвертацией в анимированный WebP/GIF с альфа-каналом (1 файл)
#[tauri::command]
pub async fn save_video_sticker(
    token: Option<String>,
    file_id: String,
    target_dir: String,
    index: usize,
    format: Option<String>,
) -> Result<String, String> {
    let clean_token_owned = get_effective_bot_token(token.as_deref()).map_err(|e| e.to_string())?;
    let clean_token = clean_token_owned.as_str();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Ошибка создания HTTP клиента: {}", e))?;

    let remote_path = get_file_path(&client, clean_token, &file_id)
        .await
        .ok_or_else(|| "Не удалось получить путь к файлу стикера в Telegram".to_string())?;

    let download_url = format!("https://api.telegram.org/file/bot{}/{}", clean_token, remote_path);
    let resp = client.get(&download_url).send().await.map_err(|e| e.to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

    let temp_webm = std::env::temp_dir().join(format!("omni_vid_{}_{}_{}.webm", index, std::process::id(), random_id()));
    std::fs::write(&temp_webm, &bytes).map_err(|e| e.to_string())?;

    let fmt = format.as_deref().unwrap_or("webp");
    let ext = if fmt.to_lowercase() == "gif" { "gif" } else { "webp" };
    let final_path = Path::new(&target_dir).join(format!("{:03}.{}", index, ext));

    let res = convert_video_sticker_file(&temp_webm, &final_path, fmt);
    let _ = std::fs::remove_file(&temp_webm);

    res?;
    Ok(final_path.to_string_lossy().to_string())
}

/// Сохранение векторного Lottie (.tgs) из отрендеренных прозрачных кадров в анимированный WebP/GIF (1 файл)
#[tauri::command]
pub async fn save_tgs_animated_sticker(
    target_dir: String,
    index: usize,
    frames: Vec<String>,
    fps: u32,
    format: Option<String>,
) -> Result<String, String> {
    if frames.is_empty() {
        return Err("Нет кадров для сборки анимации".into());
    }

    let temp_folder = std::env::temp_dir().join(format!("omni_tgs_{}_{}_{}", index, std::process::id(), random_id()));
    std::fs::create_dir_all(&temp_folder).map_err(|e| e.to_string())?;

    for (i, frame_str) in frames.iter().enumerate() {
        let b64 = if let Some(pos) = frame_str.find(',') {
            &frame_str[pos + 1..]
        } else {
            frame_str.as_str()
        };
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(b64.trim())
            .map_err(|e| format!("Base64 decode error frame {}: {}", i, e))?;
        let frame_path = temp_folder.join(format!("frame_{:03}.png", i + 1));
        std::fs::write(&frame_path, decoded).map_err(|e| e.to_string())?;
    }

    let fmt = format.as_deref().unwrap_or("webp");
    let ext = if fmt.to_lowercase() == "gif" { "gif" } else { "webp" };
    let final_path = Path::new(&target_dir).join(format!("{:03}.{}", index, ext));

    let res = convert_frames_to_animated(&temp_folder, &final_path, fps, fmt);
    let _ = std::fs::remove_dir_all(&temp_folder);

    res?;
    Ok(final_path.to_string_lossy().to_string())
}

/// Выборочное скачивание отмеченных пользователем стикеров (без дублирования файлов)
#[tauri::command]
pub async fn download_selected_stickers(
    token: Option<String>,
    pack_name: String,
    output_dir: String,
    selected_stickers: Option<Vec<SelectedStickerItem>>,
    selected_file_ids: Option<Vec<String>>,
    animated_format: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<StickerDownloadResult, String> {
    let items: Vec<SelectedStickerItem> = if let Some(stickers) = selected_stickers {
        stickers
    } else if let Some(ids) = selected_file_ids {
        ids.into_iter()
            .map(|id| SelectedStickerItem {
                file_id: id,
                thumb_id: None,
                is_animated: false,
                is_video: false,
            })
            .collect()
    } else {
        return Err("Не выбрано ни одного стикера для скачивания".into());
    };

    if items.is_empty() {
        return Err("Не выбрано ни одного стикера для скачивания".into());
    }

    let clean_token_owned = get_effective_bot_token(token.as_deref()).map_err(|e| e.to_string())?;
    let clean_token = clean_token_owned.as_str();

    let clean_pack = clean_pack_name(&pack_name);
    let base_dir = if output_dir.trim().is_empty() {
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            std::path::PathBuf::from(user_profile).join("Downloads").join("Stickers")
        } else {
            std::path::PathBuf::from("Downloads").join("Stickers")
        }
    } else {
        let p = std::path::PathBuf::from(output_dir.trim());
        if p.is_relative() {
            let str_val = output_dir.trim().replace('/', "\\");
            if str_val.starts_with("Downloads\\") || str_val == "Downloads" {
                if let Ok(user_profile) = std::env::var("USERPROFILE") {
                    std::path::PathBuf::from(user_profile).join(str_val)
                } else {
                    std::env::current_dir().unwrap_or_default().join(p)
                }
            } else {
                std::env::current_dir().unwrap_or_default().join(p)
            }
        } else {
            p
        }
    };

    let target_dir = base_dir.join(&clean_pack);
    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Не удалось создать директорию {}: {}", target_dir.display(), e))?;

    let abs_target_dir_str = std::fs::canonicalize(&target_dir)
        .map(|p| {
            let s = p.to_string_lossy().to_string();
            s.strip_prefix(r"\\?\").map(|x| x.to_string()).unwrap_or(s)
        })
        .unwrap_or_else(|_| target_dir.to_string_lossy().to_string());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Ошибка создания HTTP клиента: {}", e))?;

    let anim_fmt = animated_format.as_deref().unwrap_or("webp");
    let total = items.len();
    let mut saved_count = 0;

    for (idx, item) in items.iter().enumerate() {
        let current = idx + 1;
        let _ = app_handle.emit(
            "sticker-progress",
            ProgressPayload {
                current,
                total,
                status: format!("Скачивание: {} из {}...", current, total),
            },
        );

        if item.is_video {
            // Видеостикер (.webm) -> конвертируем в анимированный WebP / GIF с альфа-каналом (1 файл)
            if let Some(remote_path) = get_file_path(&client, clean_token, &item.file_id).await {
                let download_url = format!("https://api.telegram.org/file/bot{}/{}", clean_token, remote_path);
                if let Ok(bytes_res) = client.get(&download_url).send().await {
                    if let Ok(bytes) = bytes_res.bytes().await {
                        let temp_webm = std::env::temp_dir().join(format!("omni_vid_{}_{}_{}.webm", current, std::process::id(), random_id()));
                        if std::fs::write(&temp_webm, &bytes).is_ok() {
                            let ext = if anim_fmt.to_lowercase() == "gif" { "gif" } else { "webp" };
                            let final_path = target_dir.join(format!("{:03}.{}", current, ext));
                            if convert_video_sticker_file(&temp_webm, &final_path, anim_fmt).is_ok() {
                                saved_count += 1;
                            }
                            let _ = std::fs::remove_file(&temp_webm);
                        }
                    }
                }
            }
        } else if item.is_animated {
            // Векторный стикер без предварительных кадров: конвертируем миниатюру в чистый PNG (1 файл, без мусора .tgs)
            let target_thumb_id = item.thumb_id.as_deref().unwrap_or(&item.file_id);
            if let Some(thumb_remote_path) = get_file_path(&client, clean_token, target_thumb_id).await {
                let thumb_url = format!("https://api.telegram.org/file/bot{}/{}", clean_token, thumb_remote_path);
                if let Ok(thumb_res) = client.get(&thumb_url).send().await {
                    if let Ok(thumb_bytes) = thumb_res.bytes().await {
                        let png_path = target_dir.join(format!("{:03}.png", current));
                        if let Ok(img) = image::load_from_memory(&thumb_bytes) {
                            if img.save_with_format(&png_path, image::ImageFormat::Png).is_ok() {
                                saved_count += 1;
                            }
                        }
                    }
                }
            }
        } else {
            // Статический WebP стикер: скачиваем и конвертируем в чистый прозрачный PNG
            if let Some(remote_path) = get_file_path(&client, clean_token, &item.file_id).await {
                let download_url = format!(
                    "https://api.telegram.org/file/bot{}/{}",
                    clean_token, remote_path
                );

                if let Ok(bytes_res) = client.get(&download_url).send().await {
                    if let Ok(bytes) = bytes_res.bytes().await {
                        let png_path = target_dir.join(format!("{:03}.png", current));

                        match image::load_from_memory(&bytes) {
                            Ok(img) => {
                                if img.save_with_format(&png_path, image::ImageFormat::Png).is_ok() {
                                    saved_count += 1;
                                }
                            }
                            Err(_) => {
                                let mut fallback_ok = false;
                                if let Some(ref tid) = item.thumb_id {
                                    if let Some(thumb_remote) =
                                        get_file_path(&client, clean_token, tid).await
                                    {
                                        let t_url = format!(
                                            "https://api.telegram.org/file/bot{}/{}",
                                            clean_token, thumb_remote
                                        );
                                        if let Ok(tb_res) = client.get(&t_url).send().await {
                                            if let Ok(tb) = tb_res.bytes().await {
                                                if let Ok(img) = image::load_from_memory(&tb) {
                                                    if img
                                                        .save_with_format(
                                                            &png_path,
                                                            image::ImageFormat::Png,
                                                        )
                                                        .is_ok()
                                                    {
                                                        saved_count += 1;
                                                        fallback_ok = true;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                if !fallback_ok {
                                    let raw_ext = Path::new(&remote_path)
                                        .extension()
                                        .and_then(|e| e.to_str())
                                        .unwrap_or("webp");
                                    let raw_path =
                                        target_dir.join(format!("{:03}.{}", current, raw_ext));
                                    if std::fs::write(&raw_path, &bytes).is_ok() {
                                        saved_count += 1;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let _ = app_handle.emit(
        "sticker-progress",
        ProgressPayload {
            current: total,
            total,
            status: "Готово!".into(),
        },
    );

    Ok(StickerDownloadResult {
        success: true,
        pack_name: clean_pack.clone(),
        title: clean_pack,
        count: saved_count,
        saved_dir: abs_target_dir_str,
        message: format!("Успешно скачано: {} стикеров", saved_count),
    })
}

/// Для обратной совместимости: пакетное скачивание всего пака
#[tauri::command]
pub async fn download_stickers(
    token: Option<String>,
    pack_name: String,
    output_dir: String,
    app_handle: tauri::AppHandle,
) -> Result<StickerDownloadResult, String> {
    let pack_info = load_sticker_pack(token.clone(), pack_name.clone()).await?;
    let all_items: Vec<SelectedStickerItem> = pack_info
        .stickers
        .into_iter()
        .map(|s| SelectedStickerItem {
            file_id: s.file_id,
            thumb_id: s.thumb_id,
            is_animated: s.is_animated,
            is_video: s.is_video,
        })
        .collect();
    download_selected_stickers(
        token,
        pack_name,
        output_dir,
        Some(all_items),
        None,
        None,
        app_handle,
    )
    .await
}
