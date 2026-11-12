#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

// Встроенный архив с приложением и базовыми ресурсами
static PAYLOAD_BYTES: &[u8] = include_bytes!("../payload.zip");

static CANCELLED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
struct ProgressPayload {
    percent: u32,
    message: String,
}

#[derive(Clone, Serialize)]
struct ExistingInstallInfo {
    install_path: String,
    is_installed: bool,
}

fn silent_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd
}

fn get_config_dir() -> PathBuf {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        PathBuf::from(local).join("OmniTool")
    } else {
        PathBuf::from("C:\\OmniTool")
    }
}

fn get_config_path() -> PathBuf {
    get_config_dir().join("config.json")
}

#[tauri::command]
fn get_app_mode() -> String {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--uninstall" || a == "-u") {
        return "uninstall".to_string();
    }
    if let Ok(exe) = std::env::current_exe() {
        let name = exe.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
        if name.contains("uninstall") {
            return "uninstall".to_string();
        }
    }
    "install".to_string()
}

#[tauri::command]
fn detect_system_language() -> String {
    // 1. Из config.json
    let cfg_path = get_config_path();
    if cfg_path.exists() {
        if let Ok(data) = std::fs::read_to_string(&cfg_path) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&data) {
                if let Some(l) = val["language"].as_str() {
                    let l_low = l.to_lowercase();
                    if ["ru", "uk", "en", "de", "pl", "ja"].contains(&l_low.as_str()) {
                        return l_low;
                    }
                }
            }
        }
    }

    // 2. Из реестра HKCU\Software\OmniTool
    if let Ok(out) = silent_command("reg").args(["query", r"HKCU\Software\OmniTool", "/v", "Language"]).output() {
        if out.status.success() {
            let str_val = String::from_utf8_lossy(&out.stdout).to_lowercase();
            for lang in &["ru", "uk", "en", "de", "pl", "ja"] {
                if str_val.contains(lang) {
                    return lang.to_string();
                }
            }
        }
    }

    // 3. Из языка Windows UI
    if let Ok(out) = silent_command("powershell")
        .args(["-NoProfile", "-Command", "[System.Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName"])
        .output()
    {
        if out.status.success() {
            let lang_code = String::from_utf8_lossy(&out.stdout).trim().to_lowercase();
            if ["ru", "uk", "en", "de", "pl", "ja"].contains(&lang_code.as_str()) {
                return lang_code;
            }
        }
    }

    "ru".to_string()
}

#[tauri::command]
fn save_installer_language(lang: String) -> Result<(), String> {
    let cfg_dir = get_config_dir();
    let _ = std::fs::create_dir_all(&cfg_dir);
    let cfg_path = get_config_path();

    let mut map = serde_json::Map::new();
    if cfg_path.exists() {
        if let Ok(data) = std::fs::read_to_string(&cfg_path) {
            if let Ok(serde_json::Value::Object(existing)) = serde_json::from_str(&data) {
                map = existing;
            }
        }
    }

    map.insert("language".to_string(), serde_json::Value::String(lang.clone()));
    if !map.contains_key("auto_update_on_restart") {
        map.insert("auto_update_on_restart".to_string(), serde_json::Value::Bool(true));
    }
    if !map.contains_key("close_to_tray") {
        map.insert("close_to_tray".to_string(), serde_json::Value::Bool(true));
    }

    let _ = std::fs::write(&cfg_path, serde_json::to_string_pretty(&map).unwrap_or_default());

    let _ = silent_command("reg")
        .args(["add", r"HKCU\Software\OmniTool", "/v", "Language", "/d", &lang, "/f"])
        .output();

    Ok(())
}

#[tauri::command]
fn check_existing_install() -> ExistingInstallInfo {
    // 1. Проверяем ключ Uninstall в реестре
    let uninst_key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\OmniTool";
    if let Ok(out) = silent_command("reg").args(["query", uninst_key, "/v", "InstallLocation"]).output() {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                if line.contains("InstallLocation") {
                    let parts: Vec<&str> = line.split("REG_SZ").collect();
                    if parts.len() > 1 {
                        let path_str = parts[1].trim();
                        let p = PathBuf::from(path_str);
                        if p.join("omnitool.exe").exists() {
                            return ExistingInstallInfo {
                                install_path: path_str.to_string(),
                                is_installed: true,
                            };
                        }
                    }
                }
            }
        }
    }

    // 2. Проверяем стандартный каталог %LOCALAPPDATA%\OmniTool
    let default_path = PathBuf::from(get_default_install_dir());
    if default_path.join("omnitool.exe").exists() {
        return ExistingInstallInfo {
            install_path: default_path.to_string_lossy().to_string(),
            is_installed: true,
        };
    }

    ExistingInstallInfo {
        install_path: default_path.to_string_lossy().to_string(),
        is_installed: false,
    }
}

#[tauri::command]
fn get_default_install_dir() -> String {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        PathBuf::from(local_app_data).join("OmniTool").to_string_lossy().to_string()
    } else {
        "C:\\OmniTool".to_string()
    }
}

fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // 1. Попытка через curl.exe
    let curl_res = silent_command("curl.exe")
        .args([
            "-L",
            "--fail",
            "--silent",
            "--show-error",
            "--connect-timeout", "15",
            "--max-time", "600",
            "-o",
            &dest.to_string_lossy(),
            url,
        ])
        .output();

    if let Ok(out) = curl_res {
        if out.status.success() && dest.exists() && std::fs::metadata(dest).map(|m| m.len() > 0).unwrap_or(false) {
            return Ok(());
        }
    }

    // 2. Резервный метод через PowerShell
    let ps_script = format!(
        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13; \
         $wc = New-Object System.Net.WebClient; \
         $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OmniToolSetup'); \
         $wc.DownloadFile('{}', '{}')",
        url.replace('\'', "''"),
        dest.to_string_lossy().replace('\'', "''")
    );

    let ps_res = silent_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps_script])
        .output()
        .map_err(|e| format!("PowerShell error: {}", e))?;

    if ps_res.status.success() && dest.exists() && std::fs::metadata(dest).map(|m| m.len() > 0).unwrap_or(false) {
        return Ok(());
    }

    let err_msg = String::from_utf8_lossy(&ps_res.stderr);
    Err(format!("Не удалось скачать {}: {}", url, err_msg.trim()))
}

fn is_vc_redist_installed() -> bool {
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    let dll_path = PathBuf::from(system_root).join("System32").join("msvcp140_1.dll");
    if !dll_path.exists() {
        return false;
    }

    let keys = [
        r"HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\X64",
    ];

    for key in keys {
        if let Ok(out) = silent_command("reg").args(["query", key, "/v", "Installed"]).output() {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout);
                if s.contains("0x1") || s.contains(" 1") {
                    return true;
                }
            }
        }
    }
    true
}

fn is_webview2_installed() -> bool {
    let uninst_keys = [
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft EdgeWebView",
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft EdgeWebView",
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft EdgeWebView",
    ];

    for key in uninst_keys {
        if let Ok(out) = silent_command("reg").args(["query", key]).output() {
            if out.status.success() {
                return true;
            }
        }
    }

    let client_keys = [
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        r"HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-9D47-474D-CE3358F81B56}",
    ];

    for key in client_keys {
        if let Ok(out) = silent_command("reg").args(["query", key]).output() {
            if out.status.success() {
                return true;
            }
        }
    }

    let check_paths = [
        r"C:\Program Files (x86)\Microsoft\EdgeWebView\Application",
        r"C:\Program Files\Microsoft\EdgeWebView\Application",
    ];

    for p in check_paths {
        if Path::new(p).exists() {
            return true;
        }
    }

    false
}

fn find_local_binary(name: &str) -> Option<PathBuf> {
    let output = silent_command("where.exe").arg(name).output().ok()?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                let p = PathBuf::from(trimmed);
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }
    None
}

fn extract_ffmpeg_from_zip(zip_path: &Path, bin_dir: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path)
        .map_err(|e| format!("Не удалось открыть архив FFmpeg: {}", e))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Не удалось прочесть архив FFmpeg: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)
            .map_err(|e| format!("Ошибка чтения файла #{} из архива: {}", i, e))?;
        let name = entry.name().to_string();

        if name.ends_with("ffmpeg.exe") {
            let dest = bin_dir.join("ffmpeg.exe");
            let mut out = std::fs::File::create(&dest)
                .map_err(|e| format!("Ошибка создания {}: {}", dest.display(), e))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("Ошибка записи {}: {}", dest.display(), e))?;
        } else if name.ends_with("ffprobe.exe") {
            let dest = bin_dir.join("ffprobe.exe");
            let mut out = std::fs::File::create(&dest)
                .map_err(|e| format!("Ошибка создания {}: {}", dest.display(), e))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("Ошибка записи {}: {}", dest.display(), e))?;
        }
    }

    Ok(())
}

fn make_windows_shortcut(target_exe: &Path, shortcut_path: &Path) -> Result<(), String> {
    if let Some(parent) = shortcut_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let script = format!(
        "$WshShell = New-Object -ComObject WScript.Shell; \
         $Shortcut = $WshShell.CreateShortcut('{}'); \
         $Shortcut.TargetPath = '{}'; \
         $Shortcut.WorkingDirectory = '{}'; \
         $Shortcut.IconLocation = '{},0'; \
         $Shortcut.Save()",
        shortcut_path.to_string_lossy().replace('\'', "''"),
        target_exe.to_string_lossy().replace('\'', "''"),
        target_exe.parent().unwrap_or(Path::new("")).to_string_lossy().replace('\'', "''"),
        target_exe.to_string_lossy().replace('\'', "''")
    );

    let output = silent_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| format!("Ошибка создания ярлыка: {}", e))?;

    if !output.status.success() {
        return Err("Не удалось сохранить ярлык через PowerShell".into());
    }

    Ok(())
}

fn setup_uninstaller_binary_and_registry(target_dir: &Path, target_exe: &Path) {
    // 1. Копируем сам инсталлер как полноценный графический uninstall.exe
    let uninst_exe = target_dir.join("uninstall.exe");
    if let Ok(cur_exe) = std::env::current_exe() {
        if cur_exe.exists() && cur_exe != uninst_exe {
            let _ = std::fs::copy(&cur_exe, &uninst_exe);
        }
    }

    // Удаляем устаревший .cmd файл если он остался от старой версии
    let old_cmd = target_dir.join("uninstall.cmd");
    if old_cmd.exists() {
        let _ = std::fs::remove_file(old_cmd);
    }

    // 2. Регистрируем в реестре Windows «Установка и удаление программ»
    let uninst_key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\OmniTool";
    let uninst_cmd = format!("\"{}\" --uninstall", uninst_exe.to_string_lossy());
    let exe_str = target_exe.to_string_lossy().to_string();
    let dir_str = target_dir.to_string_lossy().to_string();

    let reg_commands = [
        ["add", uninst_key, "/v", "DisplayName", "/d", "OmniTool", "/f"],
        ["add", uninst_key, "/v", "DisplayVersion", "/d", "1.0.0", "/f"],
        ["add", uninst_key, "/v", "Publisher", "/d", "OmniTool", "/f"],
        ["add", uninst_key, "/v", "InstallLocation", "/d", &dir_str, "/f"],
        ["add", uninst_key, "/v", "DisplayIcon", "/d", &format!("{},0", exe_str), "/f"],
        ["add", uninst_key, "/v", "UninstallString", "/d", &uninst_cmd, "/f"],
        ["add", uninst_key, "/v", "QuietUninstallString", "/d", &format!("\"{}\" --uninstall --quiet", uninst_exe.to_string_lossy()), "/f"],
    ];

    for args in reg_commands {
        let _ = silent_command("reg").args(args).output();
    }
}

#[tauri::command]
fn cancel_installation(target_dir: String) {
    CANCELLED.store(true, Ordering::SeqCst);
    let p = PathBuf::from(target_dir);
    if p.exists() {
        let _ = std::fs::remove_dir_all(&p);
    }
}

async fn check_and_install_prerequisites(app_handle: &tauri::AppHandle) -> Result<(), String> {
    // VC++ Redistributable
    if !is_vc_redist_installed() {
        let _ = app_handle.emit("install-progress", ProgressPayload {
            percent: 10,
            message: "Установка системных компонентов (VC++ Runtime)...".into(),
        });

        let temp_vc = std::env::temp_dir().join("vc_redist.x64.exe");
        if download_file("https://aka.ms/vs/17/release/vc_redist.x64.exe", &temp_vc).is_ok() {
            if CANCELLED.load(Ordering::SeqCst) {
                let _ = std::fs::remove_file(&temp_vc);
                return Err("Установка отменена".into());
            }
            if let Ok(status) = silent_command(&temp_vc)
                .args(["/install", "/quiet", "/norestart"])
                .status()
            {
                let code = status.code().unwrap_or(-1);
                if code == 0 || code == 3010 || code == 1638 {
                    // Success
                }
            }
            let _ = std::fs::remove_file(&temp_vc);
        }
    }

    if CANCELLED.load(Ordering::SeqCst) {
        return Err("Установка отменена".into());
    }

    // Microsoft Edge WebView2
    if !is_webview2_installed() {
        let _ = app_handle.emit("install-progress", ProgressPayload {
            percent: 18,
            message: "Установка Microsoft Edge WebView2...".into(),
        });

        let temp_wv = std::env::temp_dir().join("MicrosoftEdgeWebview2Setup.exe");
        if download_file("https://go.microsoft.com/fwlink/p/?LinkId=2124703", &temp_wv).is_ok() {
            if CANCELLED.load(Ordering::SeqCst) {
                let _ = std::fs::remove_file(&temp_wv);
                return Err("Установка отменена".into());
            }
            let _ = silent_command(&temp_wv)
                .args(["/silent", "/install"])
                .status();
            let _ = std::fs::remove_file(&temp_wv);
        }
    }

    Ok(())
}

async fn check_and_download_utilities(bin_dir: &Path, resources_dir: &Path, app_handle: &tauri::AppHandle) -> Result<(), String> {
    // 1. yt-dlp.exe
    let yt_dlp_dest = bin_dir.join("yt-dlp.exe");
    if !yt_dlp_dest.exists() {
        if let Some(local_yt) = find_local_binary("yt-dlp") {
            let _ = std::fs::copy(&local_yt, &yt_dlp_dest);
        } else {
            let _ = app_handle.emit("install-progress", ProgressPayload {
                percent: 65,
                message: "Загрузка компонентов yt-dlp...".into(),
            });
            let _ = download_file("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe", &yt_dlp_dest);
        }
    }

    if CANCELLED.load(Ordering::SeqCst) {
        return Err("Отменено пользователем".into());
    }

    // 2. FFmpeg & FFprobe
    let ffmpeg_dest = bin_dir.join("ffmpeg.exe");
    let ffprobe_dest = bin_dir.join("ffprobe.exe");
    if !ffmpeg_dest.exists() || !ffprobe_dest.exists() {
        let local_ff = find_local_binary("ffmpeg");
        let local_pr = find_local_binary("ffprobe");

        if let (Some(ff), Some(pr)) = (local_ff, local_pr) {
            let _ = std::fs::copy(ff, &ffmpeg_dest);
            let _ = std::fs::copy(pr, &ffprobe_dest);
        } else {
            let _ = app_handle.emit("install-progress", ProgressPayload {
                percent: 75,
                message: "Загрузка компонентов FFmpeg...".into(),
            });

            let temp_ff_zip = std::env::temp_dir().join("ffmpeg-essentials.zip");
            if download_file("https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip", &temp_ff_zip).is_ok() {
                let _ = extract_ffmpeg_from_zip(&temp_ff_zip, bin_dir);
                let _ = std::fs::remove_file(&temp_ff_zip);
            }
        }
    }

    if CANCELLED.load(Ordering::SeqCst) {
        return Err("Отменено пользователем".into());
    }

    // 3. u2netp.onnx (AI Background Removal Model)
    let u2netp_dest = resources_dir.join("u2netp.onnx");
    if !u2netp_dest.exists() {
        let _ = app_handle.emit("install-progress", ProgressPayload {
            percent: 85,
            message: "Загрузка модели u2netp.onnx...".into(),
        });
        let _ = download_file("https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx", &u2netp_dest);
    }

    Ok(())
}

fn restore_shortcuts(dest_path: &Path, main_exe: &Path, create_shortcut: bool) {
    if let Ok(app_data) = std::env::var("APPDATA") {
        let start_menu = PathBuf::from(app_data)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
            .join("OmniTool.lnk");
        let _ = make_windows_shortcut(main_exe, &start_menu);
    }

    if create_shortcut {
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            let desktop_shortcut = PathBuf::from(user_profile)
                .join("Desktop")
                .join("OmniTool.lnk");
            let _ = make_windows_shortcut(main_exe, &desktop_shortcut);
        }
    }

    setup_uninstaller_binary_and_registry(dest_path, main_exe);
}

#[tauri::command]
async fn install_app(
    target_dir: String,
    create_shortcut: bool,
    lang: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    CANCELLED.store(false, Ordering::SeqCst);
    let dest_path = PathBuf::from(&target_dir);

    let _ = save_installer_language(lang);

    // 1. Пререквизиты
    let _ = app_handle.emit("install-progress", ProgressPayload {
        percent: 5,
        message: "Проверка системных компонентов...".into(),
    });
    check_and_install_prerequisites(&app_handle).await?;

    // 2. Создание каталогов
    let bin_dir = dest_path.join("bin");
    let resources_dir = dest_path.join("resources");
    let _ = std::fs::create_dir_all(&dest_path);
    let _ = std::fs::create_dir_all(&bin_dir);
    let _ = std::fs::create_dir_all(&resources_dir);

    // 3. Распаковка файлов
    let _ = app_handle.emit("install-progress", ProgressPayload {
        percent: 30,
        message: "Распаковка файлов программы...".into(),
    });

    let cursor = Cursor::new(PAYLOAD_BYTES);
    let mut zip = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("Ошибка чтения встроенного архива: {}", e))?;

    let total_files = zip.len();
    for i in 0..total_files {
        if CANCELLED.load(Ordering::SeqCst) {
            let _ = std::fs::remove_dir_all(&dest_path);
            return Err("Установка отменена".into());
        }

        let mut file = zip.by_index(i)
            .map_err(|e| format!("Ошибка извлечения #{}: {}", i, e))?;

        let file_name = file.name().to_string();
        let out_path = dest_path.join(&file_name);

        if file.is_dir() {
            let _ = std::fs::create_dir_all(&out_path);
        } else {
            if let Some(parent) = out_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let mut out_file = std::fs::File::create(&out_path)
                .map_err(|e| format!("Ошибка создания {}: {}", out_path.display(), e))?;
            std::io::copy(&mut file, &mut out_file)
                .map_err(|e| format!("Ошибка записи {}: {}", out_path.display(), e))?;
        }

        let p = 30 + ((i as f32 / total_files as f32) * 30.0) as u32;
        let _ = app_handle.emit("install-progress", ProgressPayload {
            percent: p,
            message: "Распаковка файлов программы...".into(),
        });
    }

    // 4. Утилиты
    check_and_download_utilities(&bin_dir, &resources_dir, &app_handle).await?;

    // 5. Ярлыки и деинсталлятор
    let main_exe = dest_path.join("omnitool.exe");
    restore_shortcuts(&dest_path, &main_exe, create_shortcut);

    let _ = app_handle.emit("install-progress", ProgressPayload {
        percent: 100,
        message: "Установка успешно завершена".into(),
    });

    Ok(())
}

#[tauri::command]
async fn repair_app(
    target_dir: String,
    create_shortcut: bool,
    lang: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    CANCELLED.store(false, Ordering::SeqCst);
    let dest_path = PathBuf::from(&target_dir);

    let _ = save_installer_language(lang);

    // 1. Проверка системных компонентов
    let _ = app_handle.emit("install-progress", ProgressPayload {
        percent: 10,
        message: "Проверка системных компонентов (VC++, WebView2)...".into(),
    });
    check_and_install_prerequisites(&app_handle).await?;

    // 2. Создание каталогов если отсутствуют
    let bin_dir = dest_path.join("bin");
    let resources_dir = dest_path.join("resources");
    let _ = std::fs::create_dir_all(&dest_path);
    let _ = std::fs::create_dir_all(&bin_dir);
    let _ = std::fs::create_dir_all(&resources_dir);

    // 3. Восстановление файлов ядра (НЕ ТРОГАЯ plugins/ и config.json)
    let _ = app_handle.emit("install-progress", ProgressPayload {
        percent: 30,
        message: "Восстановление целостности файлов приложения...".into(),
    });

    let cursor = Cursor::new(PAYLOAD_BYTES);
    let mut zip = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("Ошибка чтения встроенного архива: {}", e))?;

    let total_files = zip.len();
    for i in 0..total_files {
        if CANCELLED.load(Ordering::SeqCst) {
            return Err("Восстановление отменено".into());
        }

        let mut file = zip.by_index(i)
            .map_err(|e| format!("Ошибка извлечения #{}: {}", i, e))?;

        let file_name = file.name().to_string();

        // Защита пользовательских данных: никогда не перезаписывать папку plugins/ и config.json при починке
        if file_name.starts_with("plugins/") || file_name == "config.json" {
            continue;
        }

        let out_path = dest_path.join(&file_name);

        if file.is_dir() {
            let _ = std::fs::create_dir_all(&out_path);
        } else {
            if let Some(parent) = out_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let mut out_file = std::fs::File::create(&out_path)
                .map_err(|e| format!("Ошибка восстановления {}: {}", out_path.display(), e))?;
            std::io::copy(&mut file, &mut out_file)
                .map_err(|e| format!("Ошибка записи {}: {}", out_path.display(), e))?;
        }

        let p = 30 + ((i as f32 / total_files as f32) * 30.0) as u32;
        let _ = app_handle.emit("install-progress", ProgressPayload {
            percent: p,
            message: "Восстановление файлов программы...".into(),
        });
    }

    // 4. Проверка и докачка недостающих бинарников
    check_and_download_utilities(&bin_dir, &resources_dir, &app_handle).await?;

    // 5. Восстановление ярлыков и деинсталлятора
    let main_exe = dest_path.join("omnitool.exe");
    restore_shortcuts(&dest_path, &main_exe, create_shortcut);

    let _ = app_handle.emit("install-progress", ProgressPayload {
        percent: 100,
        message: "Восстановление успешно завершено".into(),
    });

    Ok(())
}

#[tauri::command]
async fn uninstall_app(
    target_dir: String,
    keep_plugins: bool,
    keep_deps: bool,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let dest_path = PathBuf::from(&target_dir);

    // 1. Завершение запущенных процессов OmniTool
    let _ = app_handle.emit("install-progress", ProgressPayload {
        percent: 15,
        message: "Завершение запущенных процессов OmniTool...".into(),
    });

    let _ = silent_command("taskkill")
        .args(["/f", "/im", "omnitool.exe"])
        .output();
    std::thread::sleep(std::time::Duration::from_millis(500));

    // 2. Удаление ярлыков
    let _ = app_handle.emit("install-progress", ProgressPayload {
        percent: 35,
        message: "Удаление ярлыков с рабочего стола и меню Пуск...".into(),
    });

    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        let desk_lnk = PathBuf::from(user_profile).join("Desktop").join("OmniTool.lnk");
        let _ = std::fs::remove_file(desk_lnk);
    }
    if let Ok(app_data) = std::env::var("APPDATA") {
        let menu_lnk = PathBuf::from(app_data)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
            .join("OmniTool.lnk");
        let _ = std::fs::remove_file(menu_lnk);
    }

    // 3. Удаление файлов программы
    let _ = app_handle.emit("install-progress", ProgressPayload {
        percent: 60,
        message: "Удаление файлов приложения...".into(),
    });

    let main_exe = dest_path.join("omnitool.exe");
    let _ = std::fs::remove_file(main_exe);

    // Папка bin (ffmpeg, yt-dlp)
    if !keep_deps {
        let bin_dir = dest_path.join("bin");
        let _ = std::fs::remove_dir_all(bin_dir);
        let res_dir = dest_path.join("resources");
        let _ = std::fs::remove_dir_all(res_dir);
    }

    // Папка plugins
    if !keep_plugins {
        let plugins_dir = dest_path.join("plugins");
        let _ = std::fs::remove_dir_all(plugins_dir);
        let cfg_file = get_config_path();
        let _ = std::fs::remove_file(cfg_file);
    }

    // Удаляем остальные временные файлы, кроме запущенного uninstall.exe
    if let Ok(entries) = std::fs::read_dir(&dest_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
            if file_name.starts_with("uninstall") {
                continue;
            }
            if path.is_file() {
                let _ = std::fs::remove_file(path);
            } else if path.is_dir() {
                if file_name == "plugins" && keep_plugins {
                    continue;
                }
                if (file_name == "bin" || file_name == "resources") && keep_deps {
                    continue;
                }
                let _ = std::fs::remove_dir_all(path);
            }
        }
    }

    // 4. Очистка реестра
    let _ = app_handle.emit("install-progress", ProgressPayload {
        percent: 85,
        message: "Очистка записей в реестре...".into(),
    });

    let uninst_key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\OmniTool";
    let _ = silent_command("reg").args(["delete", uninst_key, "/f"]).output();
    let run_key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    let _ = silent_command("reg").args(["delete", run_key, "/v", "OmniTool", "/f"]).output();

    // 5. Настройка самоудаления исполняемого файла деинсталлятора
    let _ = app_handle.emit("install-progress", ProgressPayload {
        percent: 95,
        message: "Завершение деинсталляции...".into(),
    });

    if let Ok(cur_exe) = std::env::current_exe() {
        let cur_exe_str = cur_exe.to_string_lossy().to_string();
        let target_dir_str = dest_path.to_string_lossy().to_string();

        let ps_cleanup = format!(
            "Start-Sleep -Seconds 1; \
             Remove-Item -Path '{exe}' -Force -ErrorAction SilentlyContinue; \
             if (!(Get-ChildItem -Path '{dir}' -ErrorAction SilentlyContinue | Measure-Object).Count) {{ \
                 Remove-Item -Path '{dir}' -Recurse -Force -ErrorAction SilentlyContinue \
             }}",
            exe = cur_exe_str.replace('\'', "''"),
            dir = target_dir_str.replace('\'', "''"),
        );

        let mut cmd = silent_command("powershell");
        cmd.args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &ps_cleanup]);
        let _ = cmd.spawn();
    }

    let _ = app_handle.emit("install-progress", ProgressPayload {
        percent: 100,
        message: "OmniTool успешно удалён".into(),
    });

    Ok(())
}

#[tauri::command]
fn launch_installed_app(target_dir: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let target_path = PathBuf::from(&target_dir);
    let exe_path = target_path.join("omnitool.exe");
    if !exe_path.exists() {
        return Err(format!("Файл не найден: {}", exe_path.display()));
    }

    let mut cmd = silent_command(&exe_path);
    cmd.current_dir(&target_path);
    let _ = cmd.spawn();
    app_handle.exit(0);
    Ok(())
}

#[tauri::command]
fn drag_installer(win: tauri::WebviewWindow) -> Result<(), String> {
    win.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn close_installer(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

#[tauri::command]
fn minimize_installer(app_handle: tauri::AppHandle) {
    if let Some(win) = app_handle.get_webview_window("main") {
        let _ = win.minimize();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(w_icon) = app.default_window_icon() {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_icon(w_icon.clone());
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_mode,
            detect_system_language,
            save_installer_language,
            check_existing_install,
            get_default_install_dir,
            install_app,
            repair_app,
            uninstall_app,
            cancel_installation,
            launch_installed_app,
            close_installer,
            minimize_installer,
            drag_installer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running custom installer");
}
