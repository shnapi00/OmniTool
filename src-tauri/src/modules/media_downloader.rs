use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use super::cmd_utils::silent_command;

#[derive(Debug, Serialize, Deserialize)]
pub struct MediaDownloadResult {
    pub success: bool,
    pub output_dir: String,
    pub log: String,
    pub message: String,
}

#[derive(Clone, Serialize)]
pub struct MediaProgressPayload {
    pub percent: f32,
    pub speed: String,
    pub eta: String,
    pub status: String,
}

fn find_yt_dlp() -> Option<PathBuf> {
    // 1. Проверяем наличие рядом с запущенным exe (установленная программа) или в bin/
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = [
                exe_dir.join("yt-dlp.exe"),
                exe_dir.join("bin").join("yt-dlp.exe"),
                exe_dir.join("resources").join("bin").join("yt-dlp.exe"),
                exe_dir.join("resources").join("yt-dlp.exe"),
            ];
            for path in &candidates {
                if path.exists() {
                    return Some(path.clone());
                }
            }
        }
    }

    // 2. Проверяем PATH
    if silent_command("yt-dlp").arg("--version").output().is_ok() {
        return Some(PathBuf::from("yt-dlp"));
    }

    // 3. Проверяем локальные пути относительно текущей директории
    let local_paths = [
        PathBuf::from("yt-dlp.exe"),
        PathBuf::from("bin/yt-dlp.exe"),
        PathBuf::from("../yt-dlp.exe"),
    ];

    for path in &local_paths {
        if path.exists() {
            return Some(path.clone());
        }
    }

    None
}

#[tauri::command]
pub async fn check_media_tool() -> Result<String, String> {
    match find_yt_dlp() {
        Some(path) => {
            let output = silent_command(&path)
                .arg("--version")
                .output()
                .map_err(|e| format!("Ошибка запуска {}: {}", path.display(), e))?;
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(version)
        }
        None => Err("yt-dlp не найден. Установите через 'winget install yt-dlp' или положите yt-dlp.exe в PATH.".into()),
    }
}

fn parse_ytdlp_percent(line: &str) -> Option<f32> {
    if let Some(pos) = line.find('%') {
        let before = &line[..pos];
        if let Some(space_pos) = before.rfind(|c: char| c.is_whitespace() || c == ']') {
            let num_str = before[space_pos + 1..].trim();
            return num_str.parse::<f32>().ok();
        }
    }
    None
}

fn parse_ytdlp_part(line: &str, keyword: &str) -> String {
    if let Some(idx) = line.find(keyword) {
        let rest = &line[idx + keyword.len()..];
        let part = rest.split_whitespace().next().unwrap_or("");
        return part.to_string();
    }
    String::new()
}

fn is_pinterest_url(url: &str) -> bool {
    url.contains("pinterest.") || url.contains("pin.it")
}

async fn resolve_pinterest_url(client: &reqwest::Client, url: &str) -> String {
    if url.contains("pin.it") {
        if let Ok(resp) = client
            .get(url)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            )
            .send()
            .await
        {
            return resp.url().as_str().to_string();
        }
    }
    url.to_string()
}

fn extract_meta_tag(html: &str, property: &str) -> Option<String> {
    let mut cursor = 0;
    while let Some(meta_idx) = html[cursor..].find("<meta ") {
        let abs_meta_start = cursor + meta_idx;
        let tag_end = match html[abs_meta_start..].find('>') {
            Some(end_idx) => abs_meta_start + end_idx,
            None => break,
        };
        let tag_str = &html[abs_meta_start..=tag_end];
        cursor = tag_end + 1;

        let prop_needle1 = format!("property=\"{}\"", property);
        let prop_needle2 = format!("property='{}'", property);
        let name_needle1 = format!("name=\"{}\"", property);
        let name_needle2 = format!("name='{}'", property);

        if tag_str.contains(&prop_needle1)
            || tag_str.contains(&prop_needle2)
            || tag_str.contains(&name_needle1)
            || tag_str.contains(&name_needle2)
        {
            if let Some(c_idx) = tag_str.find("content=\"") {
                let rest = &tag_str[c_idx + 9..];
                if let Some(q_idx) = rest.find('"') {
                    let val = &rest[..q_idx];
                    if !val.is_empty() {
                        return Some(val.to_string());
                    }
                }
            } else if let Some(c_idx) = tag_str.find("content='") {
                let rest = &tag_str[c_idx + 9..];
                if let Some(q_idx) = rest.find('\'') {
                    let val = &rest[..q_idx];
                    if !val.is_empty() {
                        return Some(val.to_string());
                    }
                }
            }
        }
    }
    None
}

fn to_pinterest_original_url(url: &str) -> String {
    let sizes = ["/236x/", "/474x/", "/564x/", "/736x/", "/1200x/"];
    for size in sizes {
        if url.contains(size) {
            return url.replace(size, "/originals/");
        }
    }
    url.to_string()
}

fn extract_pin_id(url: &str) -> Option<String> {
    if let Some(idx) = url.find("/pin/") {
        let rest = &url[idx + 5..];
        let id: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if !id.is_empty() {
            return Some(id);
        }
    }
    None
}

fn extract_pinimg_from_html(html: &str) -> Option<String> {
    if let Some(idx) = html.find("https://i.pinimg.com/") {
        let rest = &html[idx..];
        if let Some(end) = rest.find(|c: char| c == '"' || c == '\'' || c == ' ' || c == '\\' || c == '<') {
            let candidate = &rest[..end];
            if candidate.ends_with(".jpg") || candidate.ends_with(".png") || candidate.ends_with(".webp") {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

async fn download_pinterest_image(
    client: &reqwest::Client,
    pin_url: &str,
    target_dir: &Path,
    app_handle: &tauri::AppHandle,
) -> Result<MediaDownloadResult, String> {
    use tauri::Emitter;

    let _ = app_handle.emit(
        "media-progress",
        MediaProgressPayload {
            percent: 20.0,
            speed: String::new(),
            eta: String::new(),
            status: "Анализ страницы публикации Pinterest...".into(),
        },
    );

    let html = client
        .get(pin_url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        )
        .header("Accept-Language", "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7")
        .send()
        .await
        .map_err(|e| format!("Не удалось загрузить страницу Pinterest: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Не удалось прочитать ответ Pinterest: {}", e))?;

    // Защита от подмены видео на превью: если страница содержит видеопоток,
    // запрещаем сохранять обложку как картинку!
    let og_type = extract_meta_tag(&html, "og:type");
    if og_type.as_deref() == Some("video") || og_type.as_deref() == Some("video.other") {
        return Err("Данная публикация Pinterest содержит видео, но медиапоток не был загружен. Сохранение статичной обложки (.jpg) заблокировано во избежание подмены контента.".into());
    }

    let img_url_opt = extract_meta_tag(&html, "og:image")
        .or_else(|| extract_meta_tag(&html, "twitter:image:src"))
        .or_else(|| extract_meta_tag(&html, "twitter:image"))
        .or_else(|| extract_pinimg_from_html(&html));

    let img_url = img_url_opt.ok_or_else(|| {
        "Не удалось обнаружить изображение на странице Pinterest. Убедитесь, что ссылка корректна и доступна.".to_string()
    })?;

    let original_url = to_pinterest_original_url(&img_url);

    let _ = app_handle.emit(
        "media-progress",
        MediaProgressPayload {
            percent: 50.0,
            speed: String::new(),
            eta: String::new(),
            status: "Загрузка изображения в оригинальном качестве...".into(),
        },
    );

    // Сначала пробуем запросить /originals/ (максимальное несжатое качество).
    // Если Pinterest возвращает 404, переключаемся на исходный high-res URL (736x).
    let mut resp_res = client.get(&original_url).send().await;
    let final_img_url = match &resp_res {
        Ok(r) if r.status().is_success() => original_url,
        _ => {
            resp_res = client.get(&img_url).send().await;
            img_url
        }
    };

    let resp = resp_res.map_err(|e| format!("Ошибка загрузки изображения с серверов Pinterest: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Pinterest вернул ошибку HTTP {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| format!("Ошибка чтения данных: {}", e))?;

    let ext = Path::new(&final_img_url)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg");

    let stem = if let Some(pin_id) = extract_pin_id(pin_url) {
        format!("pinterest_pin_{}", pin_id)
    } else {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        format!("pinterest_{}", ts)
    };

    let filename = format!("{}.{}", stem, ext);
    let file_path = target_dir.join(&filename);

    std::fs::write(&file_path, &bytes)
        .map_err(|e| format!("Не удалось сохранить файл: {}", e))?;

    let _ = app_handle.emit(
        "media-progress",
        MediaProgressPayload {
            percent: 100.0,
            speed: String::new(),
            eta: String::new(),
            status: "Завершено!".into(),
        },
    );

    let clean_saved_dir = std::fs::canonicalize(target_dir)
        .map(|p| {
            let s = p.to_string_lossy().to_string();
            s.strip_prefix(r"\\?\").map(|x| x.to_string()).unwrap_or(s)
        })
        .unwrap_or_else(|_| target_dir.to_string_lossy().to_string());

    Ok(MediaDownloadResult {
        success: true,
        output_dir: clean_saved_dir,
        log: format!("Успешно загружен арт Pinterest в максимальном разрешении: {}", filename),
        message: format!("Оригинальное изображение Pinterest сохранено ({})", filename),
    })
}

#[tauri::command]
pub async fn download_media(
    url: String,
    output_dir: String,
    audio_only: Option<bool>,
    format_type: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<MediaDownloadResult, String> {
    let clean_url = url.trim();
    if clean_url.is_empty() {
        return Err("Введите корректную ссылку на видео или публикацию".into());
    }

    let normalized_input = if !clean_url.starts_with("http://") && !clean_url.starts_with("https://") {
        format!("https://{}", clean_url)
    } else {
        clean_url.to_string()
    };

    let target_dir_str = if output_dir.trim().is_empty() {
        "Downloads".to_string()
    } else {
        output_dir.trim().to_string()
    };

    let dir_path = Path::new(&target_dir_str);
    if !dir_path.exists() {
        std::fs::create_dir_all(dir_path)
            .map_err(|e| format!("Не удалось создать папку {}: {}", target_dir_str, e))?;
    }

    let _cancel_flag = crate::modules::task_manager::register_task("downloader");
    crate::modules::task_manager::add_cleanup_dir("downloader", dir_path.to_path_buf());

    let is_pinterest = is_pinterest_url(&normalized_input);

    let http_client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Ошибка создания HTTP клиента: {}", e))?;

    // Резолвим редиректы (например pin.it/... -> pinterest.com/pin/...)
    let resolved_url = if is_pinterest {
        resolve_pinterest_url(&http_client, &normalized_input).await
    } else {
        normalized_input
    };

    let yt_dlp_bin_opt = find_yt_dlp();

    // Если это Pinterest, разделяем логику "Видео / Фото":
    // 1. Проверяем видеопоток через yt-dlp --dump-json --no-warnings.
    // 2. Если есть видео — качаем через yt-dlp как видео (MP4).
    // 3. И только если yt-dlp вернул ошибку, что видеопоток не найден — скачиваем оригинал фото через парсер.
    if is_pinterest {
        let yt_dlp_bin = yt_dlp_bin_opt.as_ref().ok_or_else(|| {
            "yt-dlp не обнаружен. Для загрузки видео и проверки публикаций Pinterest требуется установленный yt-dlp (winget install yt-dlp).".to_string()
        })?;

        use tauri::Emitter;
        let _ = app_handle.emit(
            "media-progress",
            MediaProgressPayload {
                percent: 10.0,
                speed: String::new(),
                eta: String::new(),
                status: "Проверка типа публикации Pinterest (Видео / Фото)...".into(),
            },
        );

        let probe_output = silent_command(yt_dlp_bin)
            .args(["--dump-json", "--no-warnings", "--no-playlist"])
            .arg(&resolved_url)
            .output();

        let mut is_video = false;
        let mut video_title: Option<String> = None;

        if let Ok(ref out) = probe_output {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
                    if let Some(t) = json.get("title").and_then(|v| v.as_str()) {
                        video_title = Some(t.to_string());
                    }
                    let is_vid_type = json.get("_type").and_then(|v| v.as_str()) == Some("video");
                    let ext = json.get("ext").and_then(|v| v.as_str()).unwrap_or("");
                    let vcodec = json.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
                    let has_video_format = json
                        .get("formats")
                        .and_then(|f| f.as_array())
                        .map_or(false, |formats| {
                            formats.iter().any(|item| {
                                let vc = item.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
                                (vc != "none" && !vc.is_empty())
                                    || item.get("ext").and_then(|e| e.as_str()) == Some("mp4")
                                    || item
                                        .get("protocol")
                                        .and_then(|p| p.as_str())
                                        .map_or(false, |p| p.contains("m3u8"))
                            })
                        });

                    if is_vid_type
                        || has_video_format
                        || (vcodec != "none" && !vcodec.is_empty())
                        || ext == "mp4"
                        || ext == "webm"
                        || ext == "mov"
                        || ext == "mkv"
                    {
                        is_video = true;
                    }
                } else {
                    // Код возврата 0 от yt-dlp для Pinterest означает, что видеопоток найден
                    is_video = true;
                }
            }
        }

        if is_video {
            let _ = app_handle.emit(
                "media-progress",
                MediaProgressPayload {
                    percent: 25.0,
                    speed: String::new(),
                    eta: String::new(),
                    status: "Скачивание видео Pinterest...".into(),
                },
            );

            let mut cmd = silent_command(yt_dlp_bin);
            cmd.arg("-P")
                .arg(&target_dir_str)
                .arg("--no-playlist")
                .arg("--no-warnings")
                .arg("--newline")
                .arg("-o")
                .arg("%(title).80s [%(id)s].%(ext)s");

            let fmt = format_type.as_deref().unwrap_or(if audio_only.unwrap_or(false) { "mp3" } else { "mp4" });
            match fmt {
                "mp3" => {
                    cmd.args(["-x", "--audio-format", "mp3"]);
                }
                "flac" => {
                    cmd.args(["-x", "--audio-format", "flac"]);
                }
                _ => {
                    cmd.args(["-f", "bv*+ba/b", "--merge-output-format", "mp4"]);
                }
            }
            cmd.arg(&resolved_url);

            cmd.stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());

            let mut child = match cmd.spawn() {
                Ok(c) => c,
                Err(e) => {
                    crate::modules::task_manager::unregister_task("downloader");
                    return Err(format!("Ошибка запуска yt-dlp для загрузки видео: {}", e));
                }
            };

            crate::modules::task_manager::update_task_pid("downloader", child.id());

            let stdout_opt = child.stdout.take();
            let app_handle_clone = app_handle.clone();

            let read_task = tokio::task::spawn_blocking(move || {
                let mut full_log = String::new();
                if let Some(stdout) = stdout_opt {
                    use std::io::{BufRead, BufReader};
                    let reader = BufReader::new(stdout);
                    for line in reader.lines().flatten() {
                        full_log.push_str(&line);
                        full_log.push('\n');

                        if line.contains("[download]") {
                            let percent = parse_ytdlp_percent(&line).unwrap_or(0.0);
                            let speed = parse_ytdlp_part(&line, "at ");
                            let eta = parse_ytdlp_part(&line, "ETA ");
                            let _ = app_handle_clone.emit(
                                "media-progress",
                                MediaProgressPayload {
                                    percent,
                                    speed,
                                    eta,
                                    status: line.clone(),
                                },
                            );
                        }
                    }
                }
                full_log
            });

            let status = child
                .wait()
                .map_err(|e| format!("Ошибка ожидания yt-dlp: {}", e))?;

            let stdout_log = read_task.await.unwrap_or_default();

            if crate::modules::task_manager::is_task_cancelled("downloader") {
                crate::modules::task_manager::unregister_task("downloader");
                return Err("TASK_CANCELLED_BY_USER".into());
            }

            if !status.success() {
                if crate::modules::task_manager::is_task_cancelled("downloader") {
                    crate::modules::task_manager::unregister_task("downloader");
                    return Err("TASK_CANCELLED_BY_USER".into());
                }
                crate::modules::task_manager::unregister_task("downloader");
                // Строгое разделение: ошибка видео не должна маскироваться фоллбэком на .jpg!
                return Err(format!("Не удалось скачать видео Pinterest через yt-dlp:\n{}", stdout_log));
            }

            let _ = app_handle.emit(
                "media-progress",
                MediaProgressPayload {
                    percent: 100.0,
                    speed: String::new(),
                    eta: String::new(),
                    status: "Завершено!".into(),
                },
            );

            let clean_saved_dir = std::fs::canonicalize(dir_path)
                .map(|p| {
                    let s = p.to_string_lossy().to_string();
                    s.strip_prefix(r"\\?\").map(|x| x.to_string()).unwrap_or(s)
                })
                .unwrap_or_else(|_| target_dir_str.clone());

            let title_str = video_title.unwrap_or_else(|| "видео Pinterest".to_string());
            crate::modules::task_manager::unregister_task("downloader");
            return Ok(MediaDownloadResult {
                success: true,
                output_dir: clean_saved_dir,
                log: stdout_log,
                message: format!("Видео Pinterest «{}» успешно сохранено ({})", title_str, fmt.to_uppercase()),
            });
        }

        // Если yt-dlp вернул ошибку, что медиапоток не найден (это статичная картинка-пин) -
        // только тогда скачиваем оригинальное фото в максимальном разрешении.
        return download_pinterest_image(&http_client, &resolved_url, dir_path, &app_handle).await;
    }

    // Для остальных платформ (YouTube, TikTok, VK, Rutube и т.д.)
    let yt_dlp_bin = yt_dlp_bin_opt.ok_or_else(|| {
        "Утилита yt-dlp не найдена в системе.\n\n\
        Инструкция по установке:\n\
        1. Запустите в терминале: winget install yt-dlp\n\
        Или скачайте yt-dlp.exe с github.com/yt-dlp/yt-dlp и положите в PATH."
            .to_string()
    })?;

    let mut cmd = silent_command(yt_dlp_bin);
    cmd.arg("-P")
        .arg(&target_dir_str);

    // Поддержка плейлистов YouTube и других сервисов при передаче прямой ссылки на плейлист
    let is_explicit_playlist = (resolved_url.contains("/playlist")
        || resolved_url.contains("list=PL")
        || resolved_url.contains("list=UU")
        || resolved_url.contains("list=FL")
        || resolved_url.contains("list=RD"))
        && !resolved_url.contains("watch?v=")
        && !resolved_url.contains("&v=");

    if is_explicit_playlist {
        cmd.arg("--yes-playlist");
    } else {
        cmd.arg("--no-playlist");
    }

    cmd.arg("--no-warnings")
        .arg("--newline")
        .arg("-o")
        .arg("%(title).80s [%(id)s].%(ext)s");

    let fmt = format_type.as_deref().unwrap_or(if audio_only.unwrap_or(false) { "mp3" } else { "mp4" });

    match fmt {
        "mp3" => {
            cmd.args(["-x", "--audio-format", "mp3"]);
        }
        "flac" => {
            cmd.args(["-x", "--audio-format", "flac"]);
        }
        _ => {
            cmd.args(["-f", "bv*+ba/b", "--merge-output-format", "mp4"]);
        }
    }

    cmd.arg(&resolved_url);

    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            crate::modules::task_manager::unregister_task("downloader");
            return Err(format!("Ошибка запуска процесса yt-dlp: {}", e));
        }
    };

    crate::modules::task_manager::update_task_pid("downloader", child.id());

    let stdout_opt = child.stdout.take();
    let app_handle_clone = app_handle.clone();

    let read_task = tokio::task::spawn_blocking(move || {
        let mut full_log = String::new();
        if let Some(stdout) = stdout_opt {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                full_log.push_str(&line);
                full_log.push('\n');

                if line.contains("[download]") {
                    let percent = parse_ytdlp_percent(&line).unwrap_or(0.0);
                    let speed = parse_ytdlp_part(&line, "at ");
                    let eta = parse_ytdlp_part(&line, "ETA ");
                    use tauri::Emitter;
                    let _ = app_handle_clone.emit(
                        "media-progress",
                        MediaProgressPayload {
                            percent,
                            speed,
                            eta,
                            status: line.clone(),
                        },
                    );
                }
            }
        }
        full_log
    });

    let status = child
        .wait()
        .map_err(|e| format!("Ошибка ожидания yt-dlp: {}", e))?;

    let stdout_log = read_task.await.unwrap_or_default();

    if crate::modules::task_manager::is_task_cancelled("downloader") {
        crate::modules::task_manager::unregister_task("downloader");
        return Err("TASK_CANCELLED_BY_USER".into());
    }

    if !status.success() {
        if crate::modules::task_manager::is_task_cancelled("downloader") {
            crate::modules::task_manager::unregister_task("downloader");
            return Err("TASK_CANCELLED_BY_USER".into());
        }
        crate::modules::task_manager::unregister_task("downloader");
        return Err(format!("yt-dlp завершился с ошибкой:\n{}", stdout_log));
    }

    crate::modules::task_manager::unregister_task("downloader");

    use tauri::Emitter;
    let _ = app_handle.emit(
        "media-progress",
        MediaProgressPayload {
            percent: 100.0,
            speed: String::new(),
            eta: String::new(),
            status: "Завершено!".into(),
        },
    );

    let clean_saved_dir = std::fs::canonicalize(dir_path)
        .map(|p| {
            let s = p.to_string_lossy().to_string();
            s.strip_prefix(r"\\?\").map(|x| x.to_string()).unwrap_or(s)
        })
        .unwrap_or_else(|_| target_dir_str.clone());

    Ok(MediaDownloadResult {
        success: true,
        output_dir: clean_saved_dir,
        log: stdout_log,
        message: format!("Медиа успешно загружено в формате {}", fmt.to_uppercase()),
    })
}
