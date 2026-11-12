use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Emitter;
use super::cmd_utils::silent_command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressorProbeResult {
    pub filename: String,
    pub file_type: String, // "video" | "image"
    pub size_bytes: u64,
    pub size_formatted: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub resolution_formatted: String,
    pub duration_seconds: Option<f64>,
    pub duration_formatted: String,
    #[serde(default)]
    pub has_audio: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CompressOptions {
    pub input_path: String,
    pub output_path: Option<String>,
    pub target_size_value: f64,
    pub target_size_unit: String, // "MB" | "KB"
    pub save_next_to_original: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CompressResult {
    pub success: bool,
    pub output_path: String,
    pub original_size_bytes: u64,
    pub original_size_formatted: String,
    pub compressed_size_bytes: u64,
    pub compressed_size_formatted: String,
    pub ratio_percent: f64,
    pub message: String,
}

#[derive(Clone, Serialize)]
pub struct CompressProgressPayload {
    pub percent: f64,
    pub pass: Option<u32>,
    pub stage: String,
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

fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.0} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

fn format_duration(seconds: f64) -> String {
    let total_secs = seconds.round() as u64;
    let hrs = total_secs / 3600;
    let mins = (total_secs % 3600) / 60;
    let secs = total_secs % 60;

    if hrs > 0 {
        format!("{:02}:{:02}:{:02}", hrs, mins, secs)
    } else {
        format!("{:02}:{:02}", mins, secs)
    }
}

fn is_image_ext(ext: &str) -> bool {
    matches!(
        ext.to_lowercase().as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "bmp" | "tiff"
    )
}

fn parse_time_seconds(time_str: &str) -> Option<f64> {
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() == 3 {
        let hrs: f64 = parts[0].parse().ok()?;
        let mins: f64 = parts[1].parse().ok()?;
        let secs: f64 = parts[2].parse().ok()?;
        Some(hrs * 3600.0 + mins * 60.0 + secs)
    } else {
        None
    }
}

#[tauri::command]
pub async fn probe_compressor_file(input_path: String) -> Result<CompressorProbeResult, String> {
    let in_file = Path::new(&input_path);
    if !in_file.exists() {
        return Err(format!("Файл не существует: {}", input_path));
    }

    let filename = in_file
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    let meta = std::fs::metadata(in_file).map_err(|e| e.to_string())?;
    let size_bytes = meta.len();
    let size_formatted = format_bytes(size_bytes);

    let ext = in_file
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // 1. Try Image inspection
    if is_image_ext(&ext) {
        if let Ok((w, h)) = image::image_dimensions(in_file) {
            return Ok(CompressorProbeResult {
                filename,
                file_type: "image".to_string(),
                size_bytes,
                size_formatted,
                width: Some(w),
                height: Some(h),
                resolution_formatted: format!("{}×{}", w, h),
                duration_seconds: None,
                duration_formatted: "—".to_string(),
                has_audio: Some(false),
            });
        }
    }

    // 2. Video / FFprobe inspection
    let mut width = None;
    let mut height = None;
    let mut duration_seconds = None;
    let mut has_audio = None;

    if let Some(ffprobe_bin) = find_binary("ffprobe") {
        let output = silent_command(ffprobe_bin)
            .args([
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                &input_path,
            ])
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&out.stdout) {
                    if let Some(streams) = json.get("streams").and_then(|s| s.as_array()) {
                        let mut found_audio = false;
                        for s in streams {
                            let codec_type = s.get("codec_type").and_then(|c| c.as_str()).unwrap_or("");
                            if codec_type == "video" && width.is_none() {
                                width = s.get("width").and_then(|w| w.as_u64()).map(|w| w as u32);
                                height = s.get("height").and_then(|h| h.as_u64()).map(|h| h as u32);
                            } else if codec_type == "audio" {
                                found_audio = true;
                            }
                        }
                        has_audio = Some(found_audio);
                    }

                    if let Some(dur_str) = json.get("format").and_then(|f| f.get("duration")).and_then(|d| d.as_str()) {
                        if let Ok(dur) = dur_str.parse::<f64>() {
                            duration_seconds = Some(dur);
                        }
                    }
                }
            }
        }
    }

    let resolution_formatted = match (width, height) {
        (Some(w), Some(h)) => format!("{}×{}", w, h),
        _ => "—".to_string(),
    };

    let (dur_formatted, file_type) = if let Some(dur) = duration_seconds {
        (format_duration(dur), "video".to_string())
    } else if is_image_ext(&ext) {
        ("—".to_string(), "image".to_string())
    } else {
        ("—".to_string(), "video".to_string())
    };

    Ok(CompressorProbeResult {
        filename,
        file_type,
        size_bytes,
        size_formatted,
        width,
        height,
        resolution_formatted,
        duration_seconds,
        duration_formatted: dur_formatted,
        has_audio,
    })
}

#[tauri::command]
pub async fn compress_media(
    app_handle: tauri::AppHandle,
    options: CompressOptions,
) -> Result<CompressResult, String> {
    let in_file = Path::new(&options.input_path);
    if !in_file.exists() {
        return Err(format!("Файл не найден: {}", options.input_path));
    }

    let orig_meta = std::fs::metadata(in_file).map_err(|e| e.to_string())?;
    let orig_size = orig_meta.len();

    if options.target_size_value <= 0.0 {
        return Err("Целевой размер должен быть больше нуля".into());
    }

    let target_bytes = match options.target_size_unit.trim().to_uppercase().as_str() {
        "B" | "BYTE" | "BYTES" => options.target_size_value.round().max(1.0) as u64,
        "KB" => (options.target_size_value * 1024.0).round().max(1.0) as u64,
        _ => (options.target_size_value * 1024.0 * 1024.0).round().max(1.0) as u64,
    };

    let parent_dir = in_file.parent().unwrap_or_else(|| Path::new("."));
    let stem = in_file
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("media");
    let ext = in_file
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let is_image = is_image_ext(&ext);

    // Determine output path
    let out_file = if options.save_next_to_original {
        let out_ext = if is_image {
            match ext.as_str() {
                "png" | "webp" => ext.as_str(),
                _ => "jpg",
            }
        } else {
            "mp4"
        };
        parent_dir.join(format!("{}_compressed.{}", stem, out_ext))
    } else if let Some(custom) = &options.output_path {
        PathBuf::from(custom)
    } else {
        let out_ext = if is_image { "jpg" } else { "mp4" };
        parent_dir.join(format!("{}_compressed.{}", stem, out_ext))
    };

    // Ensure output does not match input directly
    let final_out_file = if out_file == in_file {
        parent_dir.join(format!("{}_compressed.{}", stem, if is_image { "jpg" } else { "mp4" }))
    } else {
        out_file
    };

    if is_image {
        compress_image_impl(&app_handle, in_file, &final_out_file, target_bytes).await?;
    } else {
        compress_video_impl(&app_handle, in_file, &final_out_file, target_bytes).await?;
    }

    if !final_out_file.exists() {
        return Err("Выходной файл не был создан".into());
    }

    let final_meta = std::fs::metadata(&final_out_file).map_err(|e| e.to_string())?;
    let compressed_size = final_meta.len();

    let ratio_percent = if orig_size > 0 {
        ((compressed_size as f64 - orig_size as f64) / orig_size as f64) * 100.0
    } else {
        0.0
    };

    let _ = app_handle.emit(
        "compressor-progress",
        CompressProgressPayload {
            percent: 100.0,
            pass: None,
            stage: "done".to_string(),
        },
    );

    Ok(CompressResult {
        success: true,
        output_path: final_out_file.to_string_lossy().to_string(),
        original_size_bytes: orig_size,
        original_size_formatted: format_bytes(orig_size),
        compressed_size_bytes: compressed_size,
        compressed_size_formatted: format_bytes(compressed_size),
        ratio_percent,
        message: format!("Сжатие завершено: {}", format_bytes(compressed_size)),
    })
}

async fn compress_video_impl(
    app_handle: &tauri::AppHandle,
    in_file: &Path,
    out_file: &Path,
    target_bytes: u64,
) -> Result<(), String> {
    let ffmpeg_bin = find_binary("ffmpeg").ok_or_else(|| "FFmpeg не найден в системе".to_string())?;
    let probe = probe_compressor_file(in_file.to_string_lossy().to_string()).await?;

    let duration = probe.duration_seconds.unwrap_or(1.0).max(0.1);

    // Dynamic container overhead reserve:
    // MP4 container overhead (ftyp, moov, trak atoms) without metadata (-map_metadata -1) is ~1.2 KB to 2 KB.
    // At ultra-small targets (< 50 KB), reserve 15% (bounded between 400 B and 1500 B).
    // At normal targets, reserve 3% for container overhead.
    let container_reserve_bytes = if target_bytes < 50_000 {
        ((target_bytes as f64 * 0.15).max(400.0).min(1500.0)) as u64
    } else {
        (target_bytes as f64 * 0.03) as u64
    };

    let usable_bytes = target_bytes.saturating_sub(container_reserve_bytes).max(100);
    let target_bps = (usable_bytes as f64 * 8.0) / duration;

    // Adaptive audio allocation:
    // 1. Lower threshold for complete audio cutoff (-an):
    //    - Only cut audio if the input file has no audio stream (probe.has_audio == Some(false))
    //    - Or target file size is under ~15-20 KB (target_bytes < 16_000)
    //    - Or total target_bps < 12_000.0 (12 kbps)
    // 2. Otherwise aggressively compress audio instead of dropping it:
    //    - target_bps in [12_000 .. 24_000): mono 10k (-ac 1 -ar 16000 -b:a 10k)
    //    - target_bps in [24_000 .. 40_000): mono 16k (-ac 1 -ar 16000 -b:a 16k)
    //    - target_bps in [40_000 .. 120_000): mono 24k (-ac 1 -ar 22050 -b:a 24k)
    //    - target_bps in [120_000 .. 300_000): stereo 48k (-ac 2 -ar 32000 -b:a 48k)
    //    - target_bps in [300_000 .. 600_000): 96k (-b:a 96k)
    //    - target_bps >= 600_000: 128k (-b:a 128k)
    let is_source_silent = probe.has_audio == Some(false);
    let should_disable_audio = is_source_silent || target_bytes < 16_000 || target_bps < 12_000.0;

    let (has_audio, audio_args, audio_bps) = if should_disable_audio {
        (false, vec!["-an".to_string()], 0.0)
    } else if target_bps < 24_000.0 {
        (
            true,
            vec![
                "-c:a".to_string(), "aac".to_string(),
                "-ac".to_string(), "1".to_string(),
                "-ar".to_string(), "16000".to_string(),
                "-b:a".to_string(), "10k".to_string(),
            ],
            10_000.0,
        )
    } else if target_bps < 40_000.0 {
        (
            true,
            vec![
                "-c:a".to_string(), "aac".to_string(),
                "-ac".to_string(), "1".to_string(),
                "-ar".to_string(), "16000".to_string(),
                "-b:a".to_string(), "16k".to_string(),
            ],
            16_000.0,
        )
    } else if target_bps < 120_000.0 {
        (
            true,
            vec![
                "-c:a".to_string(), "aac".to_string(),
                "-ac".to_string(), "1".to_string(),
                "-ar".to_string(), "22050".to_string(),
                "-b:a".to_string(), "24k".to_string(),
            ],
            24_000.0,
        )
    } else if target_bps < 300_000.0 {
        (
            true,
            vec![
                "-c:a".to_string(), "aac".to_string(),
                "-ac".to_string(), "2".to_string(),
                "-ar".to_string(), "32000".to_string(),
                "-b:a".to_string(), "48k".to_string(),
            ],
            48_000.0,
        )
    } else if target_bps < 600_000.0 {
        (
            true,
            vec![
                "-c:a".to_string(), "aac".to_string(),
                "-b:a".to_string(), "96k".to_string(),
            ],
            96_000.0,
        )
    } else {
        (
            true,
            vec![
                "-c:a".to_string(), "aac".to_string(),
                "-b:a".to_string(), "128k".to_string(),
            ],
            128_000.0,
        )
    };

    // 3. Subtract audio bitrate from total target_bps budget so video does not exceed file size limit
    let video_bps = if has_audio {
        (target_bps - audio_bps).max(2_000.0)
    } else {
        target_bps.max(1_000.0)
    };

    // Adaptive resolution scaling and FPS reduction based on actual video bitrate:
    let (target_max_w, target_fps): (Option<u32>, Option<u32>) = if video_bps >= 2_000_000.0 {
        (Some(1920), None)
    } else if video_bps >= 1_000_000.0 {
        (Some(1280), None)
    } else if video_bps >= 500_000.0 {
        (Some(854), Some(30))
    } else if video_bps >= 250_000.0 {
        (Some(640), Some(24))
    } else if video_bps >= 100_000.0 {
        (Some(426), Some(18))
    } else if video_bps >= 45_000.0 {
        (Some(256), Some(12)) // 144p
    } else if video_bps >= 18_000.0 {
        (Some(192), Some(8))
    } else if video_bps >= 6_000.0 {
        (Some(128), Some(5))  // 72p with 5 fps
    } else {
        (Some(64), Some(1))   // 36p with 1 fps for extreme minimums
    };

    let mut vf_filters = Vec::new();

    // Resolution scaling: ensure even dimensions (divisible by 2 for libx264)
    if let (Some(orig_w), Some(orig_h)) = (probe.width, probe.height) {
        if let Some(max_w) = target_max_w {
            let max_dim = orig_w.max(orig_h);
            if max_dim > max_w {
                if orig_w >= orig_h {
                    let w = ((max_w / 2) * 2).max(32);
                    vf_filters.push(format!("scale={}:-2", w));
                } else {
                    let w = ((((orig_w as f64 / orig_h as f64) * max_w as f64).round() as u32 / 2) * 2).max(32);
                    vf_filters.push(format!("scale={}:-2", w));
                }
            } else {
                vf_filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2".to_string());
            }
        } else {
            vf_filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2".to_string());
        }
    } else if let Some(max_w) = target_max_w {
        vf_filters.push(format!("scale=trunc(min({}\\,iw)/2)*2:-2", max_w));
    } else {
        vf_filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2".to_string());
    }

    if let Some(fps) = target_fps {
        vf_filters.push(format!("fps={}", fps));
    }

    let vf_string = if vf_filters.is_empty() {
        None
    } else {
        Some(vf_filters.join(","))
    };

fn monitor_process_stderr(
    stderr: std::process::ChildStderr,
    app_handle: tauri::AppHandle,
    duration: f64,
    pass: u32,
    base_pct: f64,
    scale_pct: f64,
    stage: &'static str,
) -> (std::sync::Arc<std::sync::Mutex<Vec<String>>>, std::thread::JoinHandle<()>) {
    let err_lines = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let err_lines_clone = err_lines.clone();

    let handle = std::thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stderr);
        let mut buf = Vec::new();
        let mut byte = [0u8; 1];

        while let Ok(1) = reader.read(&mut byte) {
            let b = byte[0];
            if b == b'\r' || b == b'\n' {
                if !buf.is_empty() {
                    if let Ok(line) = std::str::from_utf8(&buf) {
                        let trimmed = line.trim();
                        if let Some(idx) = trimmed.find("time=") {
                            let sub = &trimmed[idx + 5..];
                            let t_str = sub.split_whitespace().next().unwrap_or("");
                            if let Some(secs) = parse_time_seconds(t_str) {
                                let pct = ((secs / duration) * scale_pct + base_pct).min(base_pct + scale_pct);
                                let _ = app_handle.emit(
                                    "compressor-progress",
                                    CompressProgressPayload {
                                        percent: pct,
                                        pass: Some(pass),
                                        stage: stage.to_string(),
                                    },
                                );
                            }
                        }
                        if !trimmed.is_empty() {
                            if let Ok(mut l) = err_lines_clone.lock() {
                                if l.len() >= 20 {
                                    l.remove(0);
                                }
                                l.push(trimmed.to_string());
                            }
                        }
                    }
                    buf.clear();
                }
            } else {
                buf.push(b);
            }
        }
        if !buf.is_empty() {
            if let Ok(line) = std::str::from_utf8(&buf) {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    if let Ok(mut l) = err_lines_clone.lock() {
                        if l.len() >= 20 {
                            l.remove(0);
                        }
                        l.push(trimmed.to_string());
                    }
                }
            }
        }
    });

    (err_lines, handle)
}

fn run_single_pass_fallback(
    app_handle: &tauri::AppHandle,
    ffmpeg_bin: &Path,
    in_file: &Path,
    out_file: &Path,
    video_bps: f64,
    preset: &str,
    has_audio: bool,
    audio_args: &[String],
    vf_string: Option<&str>,
    duration: f64,
) -> Result<(), String> {
    let _ = app_handle.emit(
        "compressor-progress",
        CompressProgressPayload {
            percent: 10.0,
            pass: Some(1),
            stage: "single_pass".to_string(),
        },
    );

    let mut cmd = silent_command(ffmpeg_bin);
    cmd.stdout(std::process::Stdio::null());
    cmd.arg("-y");
    cmd.args(["-i", &in_file.to_string_lossy()]);
    cmd.args(["-c:v", "libx264"]);
    cmd.args(["-b:v", &format!("{:.0}", video_bps)]);
    cmd.args(["-preset", preset]);
    cmd.args(["-map_metadata", "-1"]);
    cmd.args(["-map_chapters", "-1"]);
    if has_audio {
        for arg in audio_args {
            cmd.arg(arg);
        }
    } else {
        cmd.arg("-an");
    }
    if let Some(s) = vf_string {
        cmd.args(["-vf", s]);
    }
    if video_bps < 100_000.0 {
        cmd.args(["-maxrate", &format!("{:.0}", video_bps * 1.3)]);
        cmd.args(["-bufsize", &format!("{:.0}", video_bps * 2.0)]);
    }
    cmd.args(["-movflags", "+faststart"]);
    cmd.arg(out_file);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let _ = std::fs::remove_file(out_file);
            crate::modules::task_manager::unregister_task("compressor");
            return Err(format!("Не удалось запустить FFmpeg: {}", e));
        }
    };

    crate::modules::task_manager::update_task_pid("compressor", child.id());

    let (err_lines, thread_handle) = if let Some(stderr) = child.stderr.take() {
        let (lines, h) = monitor_process_stderr(stderr, app_handle.clone(), duration, 1, 10.0, 88.0, "compressing");
        (Some(lines), Some(h))
    } else {
        (None, None)
    };

    let status = match child.wait() {
        Ok(s) => s,
        Err(e) => {
            let _ = std::fs::remove_file(out_file);
            crate::modules::task_manager::unregister_task("compressor");
            return Err(format!("Ошибка ожидания FFmpeg: {}", e));
        }
    };

    if let Some(h) = thread_handle {
        let _ = h.join();
    }

    if crate::modules::task_manager::is_task_cancelled("compressor") {
        let _ = std::fs::remove_file(out_file);
        crate::modules::task_manager::unregister_task("compressor");
        return Err("TASK_CANCELLED_BY_USER".into());
    }

    if !status.success() {
        let _ = std::fs::remove_file(out_file);
        crate::modules::task_manager::unregister_task("compressor");
        let last_err = err_lines
            .and_then(|l| l.lock().ok().map(|lines| lines.join("\n")))
            .unwrap_or_default();
        return Err(if last_err.is_empty() {
            "Ошибка при сжатии FFmpeg".to_string()
        } else {
            format!("Ошибка FFmpeg: {}", last_err)
        });
    }

    crate::modules::task_manager::unregister_task("compressor");
    Ok(())
}

    let preset = if video_bps < 250_000.0 { "veryslow" } else { "slow" };

    let temp_dir = std::env::temp_dir();
    let rand_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let passlog_prefix = format!("omni_2pass_{}", rand_id);
    let passlog_path = temp_dir.join(&passlog_prefix);
    let passlog_str = passlog_path.to_string_lossy().to_string();

    let cleanup_passlogs = {
        let temp_dir = temp_dir.clone();
        let passlog_prefix = passlog_prefix.clone();
        move || {
            if let Ok(entries) = std::fs::read_dir(&temp_dir) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with(&passlog_prefix) {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }
    };

    let _cancel_flag = crate::modules::task_manager::register_task("compressor");
    crate::modules::task_manager::add_cleanup_file("compressor", out_file.to_path_buf());

    // --- PASS 1 ---
    let _ = app_handle.emit(
        "compressor-progress",
        CompressProgressPayload {
            percent: 5.0,
            pass: Some(1),
            stage: "pass_1".to_string(),
        },
    );

    let mut cmd1 = silent_command(&ffmpeg_bin);
    cmd1.stdout(std::process::Stdio::null());
    cmd1.arg("-y");
    cmd1.args(["-i", &in_file.to_string_lossy()]);
    cmd1.args(["-c:v", "libx264"]);
    cmd1.args(["-b:v", &format!("{:.0}", video_bps)]);
    cmd1.args(["-preset", preset]);
    cmd1.args(["-pass", "1"]);
    cmd1.args(["-passlogfile", &passlog_str]);
    cmd1.args(["-map_metadata", "-1"]);
    cmd1.arg("-an");
    if let Some(ref s) = vf_string {
        cmd1.args(["-vf", s]);
    }
    if video_bps < 100_000.0 {
        cmd1.args(["-maxrate", &format!("{:.0}", video_bps * 1.3)]);
        cmd1.args(["-bufsize", &format!("{:.0}", video_bps * 2.0)]);
    }
    cmd1.args(["-f", "null"]);

    #[cfg(target_os = "windows")]
    cmd1.arg("NUL");
    #[cfg(not(target_os = "windows"))]
    cmd1.arg("/dev/null");

    let mut child1 = match cmd1.spawn() {
        Ok(c) => c,
        Err(e) => {
            cleanup_passlogs();
            crate::modules::task_manager::unregister_task("compressor");
            return Err(format!("Не удалось запустить FFmpeg (Pass 1): {}", e));
        }
    };

    crate::modules::task_manager::update_task_pid("compressor", child1.id());

    let (err_lines1, thread1) = if let Some(stderr) = child1.stderr.take() {
        let (lines, h) = monitor_process_stderr(stderr, app_handle.clone(), duration, 1, 5.0, 44.0, "pass_1");
        (Some(lines), Some(h))
    } else {
        (None, None)
    };

    let status1 = match child1.wait() {
        Ok(s) => s,
        Err(e) => {
            cleanup_passlogs();
            if let Some(h) = thread1 {
                let _ = h.join();
            }
            crate::modules::task_manager::unregister_task("compressor");
            return Err(format!("Ошибка ожидания FFmpeg (Pass 1): {}", e));
        }
    };

    if let Some(h) = thread1 {
        let _ = h.join();
    }

    if crate::modules::task_manager::is_task_cancelled("compressor") {
        cleanup_passlogs();
        crate::modules::task_manager::unregister_task("compressor");
        return Err("TASK_CANCELLED_BY_USER".into());
    }

    if !status1.success() {
        cleanup_passlogs();
        let last_err = err_lines1
            .and_then(|l| l.lock().ok().map(|lines| lines.join("\n")))
            .unwrap_or_default();
        eprintln!("Pass 1 failed ({}), falling back to single-pass encoding...", last_err);

        return run_single_pass_fallback(
            app_handle,
            &ffmpeg_bin,
            in_file,
            out_file,
            video_bps,
            preset,
            has_audio,
            &audio_args,
            vf_string.as_deref(),
            duration,
        );
    }

    // --- PASS 2 ---
    let _ = app_handle.emit(
        "compressor-progress",
        CompressProgressPayload {
            percent: 50.0,
            pass: Some(2),
            stage: "pass_2".to_string(),
        },
    );

    let mut cmd2 = silent_command(&ffmpeg_bin);
    cmd2.stdout(std::process::Stdio::null());
    cmd2.arg("-y");
    cmd2.args(["-i", &in_file.to_string_lossy()]);
    cmd2.args(["-c:v", "libx264"]);
    cmd2.args(["-b:v", &format!("{:.0}", video_bps)]);
    cmd2.args(["-preset", preset]);
    cmd2.args(["-pass", "2"]);
    cmd2.args(["-passlogfile", &passlog_str]);
    cmd2.args(["-map_metadata", "-1"]);
    cmd2.args(["-map_chapters", "-1"]);
    if has_audio {
        for arg in &audio_args {
            cmd2.arg(arg);
        }
    } else {
        cmd2.arg("-an");
    }
    if let Some(ref s) = vf_string {
        cmd2.args(["-vf", s]);
    }
    if video_bps < 100_000.0 {
        cmd2.args(["-maxrate", &format!("{:.0}", video_bps * 1.3)]);
        cmd2.args(["-bufsize", &format!("{:.0}", video_bps * 2.0)]);
    }
    cmd2.args(["-movflags", "+faststart"]);
    cmd2.arg(out_file);

    let mut child2 = match cmd2.spawn() {
        Ok(c) => c,
        Err(e) => {
            cleanup_passlogs();
            let _ = std::fs::remove_file(out_file);
            crate::modules::task_manager::unregister_task("compressor");
            return Err(format!("Не удалось запустить FFmpeg (Pass 2): {}", e));
        }
    };

    crate::modules::task_manager::update_task_pid("compressor", child2.id());

    let (err_lines2, thread2) = if let Some(stderr) = child2.stderr.take() {
        let (lines, h) = monitor_process_stderr(stderr, app_handle.clone(), duration, 2, 50.0, 48.0, "pass_2");
        (Some(lines), Some(h))
    } else {
        (None, None)
    };

    let status2 = match child2.wait() {
        Ok(s) => s,
        Err(e) => {
            cleanup_passlogs();
            if let Some(h) = thread2 {
                let _ = h.join();
            }
            let _ = std::fs::remove_file(out_file);
            crate::modules::task_manager::unregister_task("compressor");
            return Err(format!("Ошибка ожидания FFmpeg (Pass 2): {}", e));
        }
    };

    cleanup_passlogs();

    if let Some(h) = thread2 {
        let _ = h.join();
    }

    if crate::modules::task_manager::is_task_cancelled("compressor") {
        let _ = std::fs::remove_file(out_file);
        crate::modules::task_manager::unregister_task("compressor");
        return Err("TASK_CANCELLED_BY_USER".into());
    }

    if !status2.success() {
        let _ = std::fs::remove_file(out_file);
        let last_err = err_lines2
            .and_then(|l| l.lock().ok().map(|lines| lines.join("\n")))
            .unwrap_or_default();
        eprintln!("Pass 2 failed ({}), falling back to single-pass encoding...", last_err);

        return run_single_pass_fallback(
            app_handle,
            &ffmpeg_bin,
            in_file,
            out_file,
            video_bps,
            preset,
            has_audio,
            &audio_args,
            vf_string.as_deref(),
            duration,
        );
    }

    crate::modules::task_manager::unregister_task("compressor");
    Ok(())
}

async fn compress_image_impl(
    app_handle: &tauri::AppHandle,
    in_file: &Path,
    out_file: &Path,
    target_bytes: u64,
) -> Result<(), String> {
    let _cancel_flag = crate::modules::task_manager::register_task("compressor");
    crate::modules::task_manager::add_cleanup_file("compressor", out_file.to_path_buf());

    let _ = app_handle.emit(
        "compressor-progress",
        CompressProgressPayload {
            percent: 15.0,
            pass: None,
            stage: "optimizing_image".to_string(),
        },
    );

    let original_img = image::open(in_file).map_err(|e| format!("Не удалось загрузить изображение: {}", e))?;

    let out_ext = out_file
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg")
        .to_lowercase();

    let mut best_bytes: Option<Vec<u8>> = None;

    // Downscale factors to try down to 1% for extreme size compression
    let scales: [f64; 11] = [1.0, 0.85, 0.70, 0.50, 0.35, 0.25, 0.15, 0.10, 0.05, 0.02, 0.01];

    let mut progress_pct: f64 = 20.0;

    for &factor in &scales {
        if crate::modules::task_manager::is_task_cancelled("compressor") {
            crate::modules::task_manager::unregister_task("compressor");
            return Err("TASK_CANCELLED_BY_USER".into());
        }

        let current_img = if (factor - 1.0f64).abs() < f64::EPSILON {
            original_img.clone()
        } else {
            let nw = ((original_img.width() as f64) * factor).round() as u32;
            let nh = ((original_img.height() as f64) * factor).round() as u32;
            original_img.resize(nw.max(1), nh.max(1), image::imageops::FilterType::CatmullRom)
        };

        // Binary search on quality [1 .. 95]
        let mut low = 1u8;
        let mut high = 95u8;
        let mut found_for_scale = false;

        while low <= high {
            if crate::modules::task_manager::is_task_cancelled("compressor") {
                crate::modules::task_manager::unregister_task("compressor");
                return Err("TASK_CANCELLED_BY_USER".into());
            }

            let mid = (low + high) / 2;
            let encoded = encode_image_buffer(&current_img, &out_ext, mid)?;

            progress_pct = f64::min(progress_pct + 3.0, 90.0);
            let _ = app_handle.emit(
                "compressor-progress",
                CompressProgressPayload {
                    percent: progress_pct,
                    pass: None,
                    stage: "optimizing_image".to_string(),
                },
            );

            if (encoded.len() as u64) <= target_bytes {
                best_bytes = Some(encoded);
                found_for_scale = true;
                low = mid + 1; // Try higher quality
            } else {
                if mid <= 1 {
                    break;
                }
                high = mid - 1; // Try lower quality
            }
        }

        if found_for_scale {
            break;
        }
    }

    // Fallback: if even at 1% scale and quality 1 it couldn't fit, use minimum possible dimensions
    let final_bytes = match best_bytes {
        Some(b) => b,
        None => {
            let min_img = original_img.resize(16, 16, image::imageops::FilterType::Triangle);
            encode_image_buffer(&min_img, &out_ext, 1)?
        }
    };

    std::fs::write(out_file, &final_bytes).map_err(|e| format!("Не удалось сохранить файл: {}", e))?;

    crate::modules::task_manager::unregister_task("compressor");
    Ok(())
}

fn encode_image_buffer(
    img: &image::DynamicImage,
    ext: &str,
    quality: u8,
) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();

    match ext {
        "png" => {
            // If PNG, attempt lossless encoding
            let mut cursor = std::io::Cursor::new(&mut buf);
            img.write_to(&mut cursor, image::ImageFormat::Png)
                .map_err(|e| format!("PNG encoding error: {}", e))?;
        }
        "webp" => {
            // Check if ffmpeg is available for lossy webp with quality
            if let Some(ffmpeg_bin) = find_binary("ffmpeg") {
                // Write temp png, convert via ffmpeg to webp in memory or temp
                let temp_dir = std::env::temp_dir();
                let rand_num = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
                let temp_in = temp_dir.join(format!("omni_temp_in_{}.png", rand_num));
                let temp_out = temp_dir.join(format!("omni_temp_out_{}.webp", rand_num));

                if img.save_with_format(&temp_in, image::ImageFormat::Png).is_ok() {
                    let status = silent_command(&ffmpeg_bin)
                        .args([
                            "-y",
                            "-i",
                            &temp_in.to_string_lossy(),
                            "-quality",
                            &quality.to_string(),
                            &temp_out.to_string_lossy(),
                        ])
                        .status();

                    let _ = std::fs::remove_file(&temp_in);

                    if let Ok(st) = status {
                        if st.success() && temp_out.exists() {
                            if let Ok(data) = std::fs::read(&temp_out) {
                                let _ = std::fs::remove_file(&temp_out);
                                return Ok(data);
                            }
                        }
                    }
                    let _ = std::fs::remove_file(&temp_out);
                }
            }

            // Fallback: encode as WebP lossless via image crate
            let mut cursor = std::io::Cursor::new(&mut buf);
            img.write_to(&mut cursor, image::ImageFormat::WebP)
                .map_err(|e| format!("WebP encoding error: {}", e))?;
        }
        _ => {
            // Default to JPEG encoding with exact quality (1..=100)
            let rgb = img.to_rgb8();
            let mut cursor = std::io::Cursor::new(&mut buf);
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, quality.clamp(1, 100));
            encoder
                .encode(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
                .map_err(|e| format!("JPEG encoding error: {}", e))?;
        }
    }

    Ok(buf)
}
