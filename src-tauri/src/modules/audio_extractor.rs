use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use super::cmd_utils::silent_command;

#[derive(Debug, Serialize, Deserialize)]
pub struct MediaInfo {
    pub filename: String,
    pub size_bytes: u64,
    pub size_formatted: String,
    pub duration_seconds: f64,
    pub duration_formatted: String,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub has_audio: bool,
    pub has_video: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AudioExtractOptions {
    pub input_path: String,
    pub output_path: Option<String>,
    pub mode: String, // "extract" | "mute"
    pub audio_format: Option<String>, // "original" | "mp3" | "wav" | "flac"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AudioExtractResult {
    pub success: bool,
    pub output_path: String,
    pub message: String,
    pub mode: String,
}

fn find_binary(bin_name: &str) -> Option<PathBuf> {
    let exe_with_ext = if cfg!(windows) {
        format!("{}.exe", bin_name)
    } else {
        bin_name.to_string()
    };

    // 1. Check next to running exe or in bin/ / resources/
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

    // 2. Check system PATH
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

#[tauri::command]
pub async fn probe_media_file(input_path: String) -> Result<MediaInfo, String> {
    let in_file = Path::new(&input_path);
    if !in_file.exists() {
        return Err(format!("File does not exist: {}", input_path));
    }

    let filename = in_file
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    let meta = std::fs::metadata(in_file).map_err(|e| e.to_string())?;
    let size_bytes = meta.len();
    let size_formatted = format_bytes(size_bytes);

    let mut duration_seconds = 0.0;
    let mut video_codec = None;
    let mut audio_codec = None;
    let mut has_audio = false;
    let mut has_video = false;

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
                        for s in streams {
                            let codec_type = s.get("codec_type").and_then(|c| c.as_str()).unwrap_or("");
                            let codec_name = s.get("codec_name").and_then(|c| c.as_str()).map(|n| n.to_string());

                            if codec_type == "video" && video_codec.is_none() {
                                video_codec = codec_name;
                                has_video = true;
                            } else if codec_type == "audio" && audio_codec.is_none() {
                                audio_codec = codec_name;
                                has_audio = true;
                            }
                        }
                    }

                    if let Some(dur_str) = json.get("format").and_then(|f| f.get("duration")).and_then(|d| d.as_str()) {
                        if let Ok(dur) = dur_str.parse::<f64>() {
                            duration_seconds = dur;
                        }
                    }
                }
            }
        }
    }

    Ok(MediaInfo {
        filename,
        size_bytes,
        size_formatted,
        duration_seconds,
        duration_formatted: format_duration(duration_seconds),
        video_codec,
        audio_codec,
        has_audio,
        has_video,
    })
}

#[tauri::command]
pub async fn process_audio_extraction(
    options: AudioExtractOptions,
) -> Result<AudioExtractResult, String> {
    let in_file = Path::new(&options.input_path);
    if !in_file.exists() {
        return Err(format!("File does not exist: {}", options.input_path));
    }

    let ffmpeg_bin = match find_binary("ffmpeg") {
        Some(bin) => bin,
        None => {
            return Err("FFmpeg not found. Please install FFmpeg (e.g. 'winget install Gyan.FFmpeg')".into());
        }
    };

    let parent_dir = in_file.parent().unwrap_or_else(|| Path::new("."));
    let stem = in_file.file_stem().and_then(|s| s.to_str()).unwrap_or("output");

    let is_mute_mode = options.mode.trim().to_lowercase() == "mute";

    let out_file: PathBuf = if let Some(ref custom_out) = options.output_path {
        let trimmed = custom_out.trim();
        if trimmed.is_empty() {
            if is_mute_mode {
                let orig_ext = in_file.extension().and_then(|e| e.to_str()).unwrap_or("mp4");
                parent_dir.join(format!("{}_muted.{}", stem, orig_ext))
            } else {
                let fmt = options.audio_format.as_deref().unwrap_or("original").to_lowercase();
                let ext = match fmt.as_str() {
                    "mp3" => "mp3",
                    "wav" => "wav",
                    "flac" => "flac",
                    _ => "m4a", // Default for original
                };
                parent_dir.join(format!("{}_audio.{}", stem, ext))
            }
        } else {
            PathBuf::from(trimmed)
        }
    } else if is_mute_mode {
        let orig_ext = in_file.extension().and_then(|e| e.to_str()).unwrap_or("mp4");
        parent_dir.join(format!("{}_muted.{}", stem, orig_ext))
    } else {
        let fmt = options.audio_format.as_deref().unwrap_or("original").to_lowercase();
        let ext = if fmt == "original" {
            // Probe audio codec to choose optimal matching container
            let mut detected_ext = "m4a";
            if let Some(ffprobe_bin) = find_binary("ffprobe") {
                if let Ok(out) = silent_command(ffprobe_bin)
                    .args([
                        "-v", "quiet",
                        "-select_streams", "a:0",
                        "-show_entries", "stream=codec_name",
                        "-of", "default=noprint_wrappers=1:nokey=1",
                        &options.input_path,
                    ])
                    .output()
                {
                    let codec = String::from_utf8_lossy(&out.stdout).trim().to_lowercase();
                    match codec.as_str() {
                        "aac" => detected_ext = "m4a",
                        "mp3" => detected_ext = "mp3",
                        "opus" => detected_ext = "opus",
                        "vorbis" => detected_ext = "ogg",
                        "flac" => detected_ext = "flac",
                        "alac" => detected_ext = "m4a",
                        "ac3" => detected_ext = "ac3",
                        "eac3" => detected_ext = "eac3",
                        c if c.starts_with("pcm") => detected_ext = "wav",
                        _ => detected_ext = "m4a",
                    }
                }
            }
            detected_ext
        } else {
            match fmt.as_str() {
                "mp3" => "mp3",
                "wav" => "wav",
                "flac" => "flac",
                _ => "m4a",
            }
        };
        parent_dir.join(format!("{}_audio.{}", stem, ext))
    };

    let _cancel_flag = crate::modules::task_manager::register_task("audio_extractor");
    crate::modules::task_manager::add_cleanup_file("audio_extractor", out_file.clone());

    let mut cmd = silent_command(ffmpeg_bin);
    cmd.arg("-y");
    cmd.args(["-i", &options.input_path]);

    if is_mute_mode {
        // Strip audio, copy video stream without re-encoding
        cmd.args(["-an", "-c:v", "copy"]);
    } else {
        // Extract audio
        let fmt = options.audio_format.as_deref().unwrap_or("original").to_lowercase();
        cmd.arg("-vn");
        match fmt.as_str() {
            "original" => {
                cmd.args(["-c:a", "copy"]);
            }
            "mp3" => {
                cmd.args(["-c:a", "libmp3lame", "-b:a", "320k"]);
            }
            "wav" => {
                cmd.args(["-c:a", "pcm_s16le"]);
            }
            "flac" => {
                cmd.args(["-c:a", "flac"]);
            }
            _ => {
                cmd.args(["-c:a", "copy"]);
            }
        }
    }

    cmd.arg(&out_file);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            crate::modules::task_manager::unregister_task("audio_extractor");
            return Err(format!("Failed to start FFmpeg: {}", e));
        }
    };

    crate::modules::task_manager::update_task_pid("audio_extractor", child.id());

    let status = match child.wait() {
        Ok(s) => s,
        Err(e) => {
            crate::modules::task_manager::unregister_task("audio_extractor");
            return Err(format!("Error waiting for FFmpeg: {}", e));
        }
    };

    if crate::modules::task_manager::is_task_cancelled("audio_extractor") {
        let _ = std::fs::remove_file(&out_file);
        crate::modules::task_manager::unregister_task("audio_extractor");
        return Err("TASK_CANCELLED_BY_USER".into());
    }

    if !status.success() {
        let _ = std::fs::remove_file(&out_file);
        if crate::modules::task_manager::is_task_cancelled("audio_extractor") {
            crate::modules::task_manager::unregister_task("audio_extractor");
            return Err("TASK_CANCELLED_BY_USER".into());
        }
        crate::modules::task_manager::unregister_task("audio_extractor");
        return Err("FFmpeg process failed to complete operation".into());
    }

    crate::modules::task_manager::unregister_task("audio_extractor");

    Ok(AudioExtractResult {
        success: true,
        output_path: out_file.to_string_lossy().to_string(),
        message: if is_mute_mode {
            "Audio removed successfully".to_string()
        } else {
            "Audio extracted successfully".to_string()
        },
        mode: if is_mute_mode { "mute".to_string() } else { "extract".to_string() },
    })
}

#[cfg(windows)]
fn is_soundpad_running() -> bool {
    let output = super::cmd_utils::silent_command("tasklist")
        .args(["/FI", "IMAGENAME eq Soundpad.exe", "/NH"])
        .output();
    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
        return text.contains("soundpad.exe");
    }
    false
}

#[cfg(windows)]
fn find_soundpad_exe() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(r"C:\Program Files\Soundpad\Soundpad.exe"),
        PathBuf::from(r"C:\Program Files (x86)\Soundpad\Soundpad.exe"),
        PathBuf::from(r"C:\Program Files (x86)\Steam\steamapps\common\Soundpad\Soundpad.exe"),
        PathBuf::from(r"D:\SteamLibrary\steamapps\common\Soundpad\Soundpad.exe"),
        PathBuf::from(r"E:\SteamLibrary\steamapps\common\Soundpad\Soundpad.exe"),
    ];
    for p in &candidates {
        if p.exists() {
            return Some(p.clone());
        }
    }
    None
}

#[cfg(windows)]
async fn send_to_soundpad_pipe_async(clean_path: &str) -> Result<String, String> {
    use tokio::net::windows::named_pipe::ClientOptions;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use std::time::Duration;

    let pipe_path = r"\\.\pipe\sp_remote_control";
    let mut client = ClientOptions::new()
        .open(pipe_path)
        .map_err(|e| format!("PIPE_OPEN_FAILED: {}", e))?;

    let cmd = format!("DoAddSound(\"{}\")\n", clean_path);
    client
        .write_all(cmd.as_bytes())
        .await
        .map_err(|e| format!("PIPE_WRITE_FAILED: {}", e))?;

    client
        .flush()
        .await
        .map_err(|e| format!("PIPE_FLUSH_FAILED: {}", e))?;

    let mut buf = [0u8; 1024];
    let timeout_res = tokio::time::timeout(Duration::from_millis(1500), client.read(&mut buf)).await;
    match timeout_res {
        Ok(Ok(n)) if n > 0 => {
            let resp = String::from_utf8_lossy(&buf[..n]).trim().to_string();
            Ok(resp)
        }
        _ => Ok("R-200".to_string()),
    }
}

#[tauri::command]
pub async fn add_to_soundpad(file_path: String) -> Result<String, String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }

    let abs_path = path.canonicalize().unwrap_or(path);
    let abs_path_str = abs_path.to_string_lossy().to_string();
    let clean_path = abs_path_str.trim_start_matches(r"\\?\");

    #[cfg(windows)]
    {
        // 1. Try named pipe
        let pipe_res = send_to_soundpad_pipe_async(clean_path).await;
        match pipe_res {
            Ok(resp) => {
                if resp.starts_with("R-403") {
                    return Err("SOUNDPAD_TRIAL_RESTRICTION".to_string());
                }
                if resp.starts_with("R-") && !resp.starts_with("R-200") {
                    return Err(format!("Soundpad error: {}", resp));
                }
                return Ok(format!("Sound added to Soundpad: {}", resp));
            }
            Err(_pipe_err) => {
                // Pipe failed. Fallback: check if Soundpad process is running
                if is_soundpad_running() {
                    // Try CLI invocation if binary can be located
                    if let Some(exe_path) = find_soundpad_exe() {
                        let cli_cmd = format!("DoAddSound(\"{}\")", clean_path);
                        let spawn_res = super::cmd_utils::silent_command(&exe_path)
                            .args(["-rc", &cli_cmd])
                            .spawn();
                        if let Ok(mut child) = spawn_res {
                            let _ = child.wait();
                            return Ok("Sound added via Soundpad CLI".to_string());
                        }
                    }
                    return Err("SOUNDPAD_PIPE_UNAVAILABLE".to_string());
                } else {
                    return Err("SOUNDPAD_NOT_RUNNING".to_string());
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        Err("Soundpad is only supported on Windows".to_string())
    }
}
