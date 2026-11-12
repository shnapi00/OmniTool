use serde::{Deserialize, Serialize};
use std::io::BufRead;
use std::path::{Path, PathBuf};
use tauri::Emitter;
use super::cmd_utils::silent_command;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct PluginDependencies {
    pub python: Option<Vec<String>>,
    pub npm: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginDepsStatus {
    pub plugin_id: String,
    pub all_installed: bool,
    pub missing_python: Vec<String>,
    pub missing_npm: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginDepProgressEvent {
    pub plugin_id: String,
    pub percent: f64,
    pub status: String,
    pub log_chunk: String,
    pub done: bool,
    pub has_error: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginField {
    pub id: String,
    #[serde(rename = "type")]
    pub field_type: String, // "text", "file", "select", "number"
    pub label: String,
    pub placeholder: Option<String>,
    pub options: Option<Vec<String>>,
    pub default_value: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginAction {
    pub id: String,
    pub label: String,
    pub variant: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub icon: Option<String>, // Lucide icon name OR custom Data URL (SVG/PNG)
    pub description: String,
    pub version: String,
    pub fields: Option<Vec<PluginField>>,
    pub action_label: Option<String>,
    pub command: Option<String>,      // e.g. "python", "node", "powershell"
    pub script: Option<String>,       // e.g. "main.py"
    pub view: Option<String>,         // e.g. "gallery" or "terminal"
    pub actions: Option<Vec<PluginAction>>, // quick action buttons
    pub settings_label: Option<String>,    // custom label for collapsed settings accordion
    pub dependencies: Option<PluginDependencies>,
    pub custom_ui: Option<bool>,
    pub ui_entry: Option<String>,          // e.g. "index.js"
    pub permissions: Option<Vec<String>>,
    #[serde(skip_deserializing)]
    pub dir_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub success: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RuntimeInfo {
    pub installed: bool,
    pub version: String,
    pub is_portable: bool,
    pub path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RuntimesStatus {
    pub python: RuntimeInfo,
    pub node: RuntimeInfo,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RuntimeInstallProgress {
    pub runtime: String, // "python" | "node"
    pub percent: f64,
    pub status: String,
}

pub fn get_plugins_dir() -> PathBuf {
    if let Ok(app_data) = std::env::var("APPDATA") {
        PathBuf::from(app_data).join("OmniTool").join("plugins")
    } else {
        PathBuf::from("plugins")
    }
}

pub fn get_runtimes_dir() -> PathBuf {
    if let Ok(app_data) = std::env::var("APPDATA") {
        PathBuf::from(app_data).join("OmniTool").join("runtimes")
    } else {
        PathBuf::from("runtimes")
    }
}

pub fn resolve_runtime_executable(command: &str) -> String {
    let runtimes_dir = get_runtimes_dir();
    if command.eq_ignore_ascii_case("python") || command.eq_ignore_ascii_case("py") {
        let portable = runtimes_dir.join("python").join("python.exe");
        if portable.exists() {
            return portable.to_string_lossy().to_string();
        }
        return "python".to_string();
    }
    if command.eq_ignore_ascii_case("node") {
        let portable = runtimes_dir.join("node").join("node.exe");
        if portable.exists() {
            return portable.to_string_lossy().to_string();
        }
        return "node".to_string();
    }
    command.to_string()
}

#[tauri::command]
pub fn get_plugins_folder_path() -> String {
    let p = get_plugins_dir();
    let _ = std::fs::create_dir_all(&p);
    p.to_string_lossy().to_string()
}

#[tauri::command]
pub async fn get_installed_plugins() -> Result<Vec<PluginManifest>, String> {
    let mut plugins = Vec::new();
    let mut search_dirs = vec![get_plugins_dir()];

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            let app_plugins = exe_dir.join("plugins");
            if !search_dirs.contains(&app_plugins) {
                search_dirs.push(app_plugins);
            }
        }
    }

    let dev_plugins = PathBuf::from("plugins");
    if !search_dirs.contains(&dev_plugins) {
        search_dirs.push(dev_plugins);
    }

    for base_dir in &search_dirs {
        if !base_dir.exists() {
            continue;
        }

        if let Ok(entries) = std::fs::read_dir(base_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let folder_name = entry.file_name().to_string_lossy().to_string();
                    // Never load sandbox test folders as installed plugins; purge them
                    if folder_name.starts_with("__sandbox_") {
                        let _ = std::fs::remove_dir_all(&path);
                        continue;
                    }

                    let manifest_file = path.join("plugin.json");
                    if manifest_file.exists() {
                        if let Ok(content) = std::fs::read_to_string(&manifest_file) {
                            if let Ok(mut manifest) = serde_json::from_str::<PluginManifest>(&content) {
                                if manifest.id.starts_with("__sandbox_") {
                                    let _ = std::fs::remove_dir_all(&path);
                                    continue;
                                }

                                manifest.dir_path = Some(path.to_string_lossy().to_string());
                                // Auto-detect index.js if ui_entry not specified
                                if manifest.ui_entry.is_none() && path.join("index.js").exists() {
                                    manifest.ui_entry = Some("index.js".to_string());
                                    if manifest.custom_ui.is_none() {
                                        manifest.custom_ui = Some(true);
                                    }
                                }
                                // Avoid duplicate IDs
                                if !plugins.iter().any(|p: &PluginManifest| p.id == manifest.id) {
                                    plugins.push(manifest);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(plugins)
}

#[tauri::command]
pub async fn execute_plugin(
    plugin_id: String,
    args: serde_json::Value,
) -> Result<String, String> {
    let clean_id = plugin_id.trim();

    let plugin = if clean_id.starts_with("__sandbox_") {
        let sandbox_path = get_plugins_dir().join(clean_id);
        let manifest_file = sandbox_path.join("plugin.json");
        if manifest_file.exists() {
            let content = std::fs::read_to_string(&manifest_file)
                .map_err(|e| format!("Не удалось прочитать manifest песочницы {}: {}", clean_id, e))?;
            let mut m = serde_json::from_str::<PluginManifest>(&content)
                .map_err(|e| format!("Некорректный manifest песочницы: {}", e))?;
            m.dir_path = Some(sandbox_path.to_string_lossy().to_string());
            m
        } else {
            return Err(format!("Песочница плагина {} не найдена", clean_id));
        }
    } else {
        let plugins = get_installed_plugins().await?;
        plugins
            .into_iter()
            .find(|p| p.id == clean_id)
            .ok_or_else(|| format!("Плагин {} не найден", clean_id))?
    };

    let dir_path_str = plugin.dir_path.ok_or("Путь к папке плагина недоступен")?;
    let plugin_dir = Path::new(&dir_path_str);

    let command_name = plugin.command.unwrap_or_else(|| "powershell".to_string());
    let resolved_command = resolve_runtime_executable(&command_name);
    let mut cmd = silent_command(&resolved_command);
    cmd.current_dir(plugin_dir);

    if let Some(script_name) = &plugin.script {
        if command_name.eq_ignore_ascii_case("powershell") || command_name.eq_ignore_ascii_case("pwsh") {
            cmd.arg("-NoProfile").arg("-ExecutionPolicy").arg("Bypass").arg("-File").arg(plugin_dir.join(script_name));
        } else {
            cmd.arg(plugin_dir.join(script_name));
        }
    }

    match args {
        serde_json::Value::Array(arr) => {
            for v in arr {
                if let Some(s) = v.as_str() {
                    cmd.arg(s);
                } else {
                    cmd.arg(v.to_string());
                }
            }
        }
        serde_json::Value::Object(map) => {
            if let Some(action_val) = map.get("__action") {
                if let Some(s) = action_val.as_str() {
                    cmd.arg(s);
                } else {
                    cmd.arg(action_val.to_string());
                }
            }
            if let Some(fields) = &plugin.fields {
                for f in fields {
                    if let Some(val) = map.get(&f.id) {
                        let str_val = val.as_str().map(|s| s.to_string()).unwrap_or_else(|| val.to_string());
                        cmd.arg(str_val);
                    }
                }
            } else {
                for (k, v) in map {
                    if k != "__action" {
                        let str_val = v.as_str().map(|s| s.to_string()).unwrap_or_else(|| v.to_string());
                        cmd.arg(str_val);
                    }
                }
            }
        }
        _ => {}
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Не удалось выполнить {}: {}", command_name, e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!(
            "Ошибка выполнения скрипта плагина (код {}):\n{}",
            output.status.code().unwrap_or(-1),
            if !stderr.is_empty() { stderr } else { stdout }
        ));
    }

    Ok(stdout)
}

#[tauri::command]
pub async fn create_custom_plugin(
    manifest: PluginManifest,
    script_content: String,
) -> Result<String, String> {
    let clean_id = manifest.id.trim().replace(|c: char| !c.is_alphanumeric() && c != '_' && c != '-', "");
    if clean_id.is_empty() {
        return Err("ID плагина не может быть пустым".into());
    }

    let p_dir = get_plugins_dir().join(&clean_id);
    std::fs::create_dir_all(&p_dir)
        .map_err(|e| format!("Ошибка создания папки плагина: {}", e))?;

    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Ошибка сериализации манифеста: {}", e))?;

    std::fs::write(p_dir.join("plugin.json"), manifest_json)
        .map_err(|e| format!("Ошибка записи plugin.json: {}", e))?;

    if let Some(ui_entry) = &manifest.ui_entry {
        let ui_file = p_dir.join(ui_entry);
        std::fs::write(ui_file, &script_content)
            .map_err(|e| format!("Ошибка записи файла UI скрипта: {}", e))?;
    } else if manifest.custom_ui == Some(true) {
        std::fs::write(p_dir.join("index.js"), &script_content)
            .map_err(|e| format!("Ошибка записи index.js: {}", e))?;
    } else if let Some(script_name) = &manifest.script {
        let script_file = p_dir.join(script_name);
        std::fs::write(script_file, &script_content)
            .map_err(|e| format!("Ошибка записи файла скрипта: {}", e))?;
    }

    Ok(clean_id)
}

#[tauri::command]
pub async fn delete_custom_plugin(plugin_id: String) -> Result<(), String> {
    let clean_id = plugin_id.trim();
    if clean_id.is_empty() {
        return Err("ID плагина не указан".into());
    }

    let mut search_dirs = vec![get_plugins_dir()];

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            let app_plugins = exe_dir.join("plugins");
            if !search_dirs.contains(&app_plugins) {
                search_dirs.push(app_plugins);
            }
        }
    }

    let dev_plugins = PathBuf::from("plugins");
    if !search_dirs.contains(&dev_plugins) {
        search_dirs.push(dev_plugins);
    }
    let tauri_dev_plugins = PathBuf::from("src-tauri/plugins");
    if !search_dirs.contains(&tauri_dev_plugins) {
        search_dirs.push(tauri_dev_plugins);
    }

    let mut deleted = false;

    for base_dir in &search_dirs {
        if !base_dir.exists() {
            continue;
        }

        // 1. Direct folder match: base_dir/clean_id
        let direct_dir = base_dir.join(clean_id);
        if direct_dir.exists() && direct_dir.is_dir() {
            if std::fs::remove_dir_all(&direct_dir).is_ok() {
                deleted = true;
            }
        }

        // 2. Scan subdirectories in case the folder name differs from the manifest ID
        if let Ok(entries) = std::fs::read_dir(base_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let manifest_file = path.join("plugin.json");
                    if manifest_file.exists() {
                        if let Ok(content) = std::fs::read_to_string(&manifest_file) {
                            if let Ok(manifest) = serde_json::from_str::<PluginManifest>(&content) {
                                if manifest.id == clean_id {
                                    if std::fs::remove_dir_all(&path).is_ok() {
                                        deleted = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if !deleted {
        eprintln!("Plugin '{}' folder was not found or already deleted", clean_id);
    }

    Ok(())
}

async fn resolve_plugin_dir(plugin_id: &str) -> Result<PathBuf, String> {
    let clean_id = plugin_id.trim();
    if clean_id.is_empty() {
        return Err("ID плагина не указан".into());
    }

    if clean_id.starts_with("__sandbox_") {
        let sandbox_dir = get_plugins_dir().join(clean_id);
        if sandbox_dir.exists() {
            return Ok(sandbox_dir);
        }
    }

    let plugins = get_installed_plugins().await?;
    let plugin = plugins
        .into_iter()
        .find(|p| p.id == clean_id)
        .ok_or_else(|| format!("Плагин {} не найден", clean_id))?;

    let dir_path_str = plugin.dir_path.ok_or("Путь к папке плагина недоступен")?;
    Ok(PathBuf::from(dir_path_str))
}

#[tauri::command]
pub async fn read_plugin_file(
    plugin_id: String,
    filename: String,
) -> Result<String, String> {
    let plugin_dir = resolve_plugin_dir(&plugin_id).await?;

    let clean_filename = filename.trim().replace('\\', "/");
    if clean_filename.contains("..") || clean_filename.starts_with('/') {
        return Err("Недопустимый путь к файлу".into());
    }

    let target_file = plugin_dir.join(&clean_filename);
    if !target_file.exists() {
        return Err(format!("Файл '{}' не существует в папке плагина", clean_filename));
    }

    std::fs::read_to_string(&target_file)
        .map_err(|e| format!("Ошибка чтения файла '{}': {}", clean_filename, e))
}

#[tauri::command]
pub async fn write_plugin_file(
    plugin_id: String,
    filename: String,
    content: String,
) -> Result<(), String> {
    let plugin_dir = resolve_plugin_dir(&plugin_id).await?;

    let clean_filename = filename.trim().replace('\\', "/");
    if clean_filename.contains("..") || clean_filename.starts_with('/') {
        return Err("Недопустимый путь к файлу".into());
    }

    let target_file = plugin_dir.join(&clean_filename);
    if let Some(parent) = target_file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    std::fs::write(&target_file, content)
        .map_err(|e| format!("Ошибка записи файла '{}': {}", clean_filename, e))
}

#[tauri::command]
pub async fn execute_plugin_exec(
    app_handle: tauri::AppHandle,
    plugin_id: String,
    program: String,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    exec_id: Option<String>,
) -> Result<PluginExecResult, String> {
    let plugin_dir = resolve_plugin_dir(&plugin_id).await?;

    let target_cwd = if let Some(custom_cwd) = cwd {
        let p = PathBuf::from(custom_cwd);
        if p.is_absolute() { p } else { plugin_dir.join(p) }
    } else {
        plugin_dir.to_path_buf()
    };

    let prog_trimmed = program.trim();
    let args_vec = args.unwrap_or_default();

    // Determine command to run
    let local_file = plugin_dir.join(prog_trimmed);
    let mut cmd = if local_file.exists() && local_file.is_file() {
        let ext = local_file.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        match ext.as_str() {
            "py" => {
                let py = resolve_runtime_executable("python");
                let mut c = silent_command(&py);
                c.arg(&local_file);
                for a in &args_vec { c.arg(a); }
                c
            }
            "js" => {
                let node = resolve_runtime_executable("node");
                let mut c = silent_command(&node);
                c.arg(&local_file);
                for a in &args_vec { c.arg(a); }
                c
            }
            "ps1" => {
                let mut c = silent_command("powershell");
                c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
                c.arg(&local_file);
                for a in &args_vec { c.arg(a); }
                c
            }
            "bat" | "cmd" => {
                let mut c = silent_command("cmd");
                c.arg("/c").arg(&local_file);
                for a in &args_vec { c.arg(a); }
                c
            }
            _ => {
                let mut c = silent_command(&local_file);
                for a in &args_vec { c.arg(a); }
                c
            }
        }
    } else if prog_trimmed.eq_ignore_ascii_case("python") || prog_trimmed.eq_ignore_ascii_case("py") {
        let py = resolve_runtime_executable("python");
        let mut c = silent_command(&py);
        for a in &args_vec { c.arg(a); }
        c
    } else if prog_trimmed.eq_ignore_ascii_case("node") {
        let node = resolve_runtime_executable("node");
        let mut c = silent_command(&node);
        for a in &args_vec { c.arg(a); }
        c
    } else if prog_trimmed.eq_ignore_ascii_case("powershell") || prog_trimmed.eq_ignore_ascii_case("pwsh") {
        let mut c = silent_command("powershell");
        c.args(["-NoProfile", "-ExecutionPolicy", "Bypass"]);
        for a in &args_vec { c.arg(a); }
        c
    } else {
        let mut c = silent_command(prog_trimmed);
        for a in &args_vec { c.arg(a); }
        c
    };

    cmd.current_dir(&target_cwd);

    // If streaming exec_id is specified, spawn and stream output lines via events
    if let Some(eid) = exec_id {
        let mut child = cmd.spawn().map_err(|e| format!("Не удалось запустить '{}': {}", prog_trimmed, e))?;

        let stdout_lines = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let stderr_lines = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));

        let app_handle_out = app_handle.clone();
        let eid_out = eid.clone();
        let stdout_lines_clone = stdout_lines.clone();
        if let Some(stdout) = child.stdout.take() {
            std::thread::spawn(move || {
                let reader = std::io::BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    let _ = app_handle_out.emit(&format!("plugin-exec:{}:stdout", eid_out), &line);
                    if let Ok(mut l) = stdout_lines_clone.lock() {
                        l.push(line);
                    }
                }
            });
        }

        let app_handle_err = app_handle.clone();
        let eid_err = eid.clone();
        let stderr_lines_clone = stderr_lines.clone();
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                let reader = std::io::BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    let _ = app_handle_err.emit(&format!("plugin-exec:{}:stderr", eid_err), &line);
                    if let Ok(mut l) = stderr_lines_clone.lock() {
                        l.push(line);
                    }
                }
            });
        }

        let status = child.wait().map_err(|e| format!("Ошибка ожидания процесса: {}", e))?;
        let stdout_str = stdout_lines.lock().map(|l| l.join("\n")).unwrap_or_default();
        let stderr_str = stderr_lines.lock().map(|l| l.join("\n")).unwrap_or_default();
        let exit_code = status.code().unwrap_or(-1);
        let success = status.success();

        let _ = app_handle.emit(&format!("plugin-exec:{}:done", eid), serde_json::json!({
            "exit_code": exit_code,
            "success": success
        }));

        Ok(PluginExecResult {
            stdout: stdout_str,
            stderr: stderr_str,
            exit_code,
            success,
        })
    } else {
        let output = cmd.output().map_err(|e| format!("Не удалось запустить '{}': {}", prog_trimmed, e))?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let exit_code = output.status.code().unwrap_or(-1);
        let success = output.status.success();

        Ok(PluginExecResult {
            stdout,
            stderr,
            exit_code,
            success,
        })
    }
}

#[tauri::command]
pub async fn check_runtimes_status() -> Result<RuntimesStatus, String> {
    let runtimes_dir = get_runtimes_dir();

    // 1. Python check
    let portable_py = runtimes_dir.join("python").join("python.exe");
    let python_info = if portable_py.exists() {
        if let Ok(out) = silent_command(portable_py.to_string_lossy().as_ref()).arg("--version").output() {
            let ver = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let ver_err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let final_ver = if !ver.is_empty() { ver } else { ver_err };
            RuntimeInfo {
                installed: true,
                version: if final_ver.is_empty() { "Python 3.11 (Portable)".into() } else { format!("{} (Portable)", final_ver) },
                is_portable: true,
                path: Some(portable_py.to_string_lossy().to_string()),
            }
        } else {
            RuntimeInfo {
                installed: true,
                version: "Python 3.11 (Portable)".into(),
                is_portable: true,
                path: Some(portable_py.to_string_lossy().to_string()),
            }
        }
    } else {
        // System Python check
        let mut found = false;
        let mut ver_str = String::new();
        if let Ok(out) = silent_command("python").arg("--version").output() {
            if out.status.success() {
                let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if v.starts_with("Python") {
                    found = true;
                    ver_str = v;
                }
            }
        }
        if !found {
            if let Ok(out) = silent_command("py").arg("-3").arg("--version").output() {
                if out.status.success() {
                    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if v.starts_with("Python") {
                        found = true;
                        ver_str = v;
                    }
                }
            }
        }

        if found {
            RuntimeInfo {
                installed: true,
                version: ver_str,
                is_portable: false,
                path: Some("system".into()),
            }
        } else {
            RuntimeInfo {
                installed: false,
                version: String::new(),
                is_portable: false,
                path: None,
            }
        }
    };

    // 2. Node.js check
    let portable_node = runtimes_dir.join("node").join("node.exe");
    let node_info = if portable_node.exists() {
        if let Ok(out) = silent_command(portable_node.to_string_lossy().as_ref()).arg("--version").output() {
            let ver = String::from_utf8_lossy(&out.stdout).trim().to_string();
            RuntimeInfo {
                installed: true,
                version: format!("Node.js {} (Portable)", ver),
                is_portable: true,
                path: Some(portable_node.to_string_lossy().to_string()),
            }
        } else {
            RuntimeInfo {
                installed: true,
                version: "Node.js (Portable)".into(),
                is_portable: true,
                path: Some(portable_node.to_string_lossy().to_string()),
            }
        }
    } else {
        // System Node.js check
        if let Ok(out) = silent_command("node").arg("--version").output() {
            if out.status.success() {
                let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if v.starts_with('v') {
                    RuntimeInfo {
                        installed: true,
                        version: format!("Node.js {}", v),
                        is_portable: false,
                        path: Some("system".into()),
                    }
                } else {
                    RuntimeInfo { installed: false, version: String::new(), is_portable: false, path: None }
                }
            } else {
                RuntimeInfo { installed: false, version: String::new(), is_portable: false, path: None }
            }
        } else {
            RuntimeInfo { installed: false, version: String::new(), is_portable: false, path: None }
        }
    };

    Ok(RuntimesStatus {
        python: python_info,
        node: node_info,
    })
}

#[tauri::command]
pub async fn install_portable_runtime(
    app: tauri::AppHandle,
    runtime: String,
) -> Result<String, String> {
    use tauri::Emitter;
    let runtimes_dir = get_runtimes_dir();
    std::fs::create_dir_all(&runtimes_dir).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    if runtime.eq_ignore_ascii_case("python") {
        let target_dir = runtimes_dir.join("python");
        std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

        let _ = app.emit(
            "runtime-install-progress",
            RuntimeInstallProgress {
                runtime: "python".into(),
                percent: 10.0,
                status: "Загрузка Python 3.11 embed (11 МБ)...".into(),
            },
        );

        let url = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip";
        let resp = client.get(url).send().await.map_err(|e| format!("Ошибка загрузки Python: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Ошибка сервера при загрузке Python: HTTP {}", resp.status()));
        }

        let bytes = resp.bytes().await.map_err(|e| format!("Ошибка чтения данных: {}", e))?;
        let temp_zip = target_dir.join("python-embed.zip");
        std::fs::write(&temp_zip, &bytes).map_err(|e| format!("Ошибка сохранения архива: {}", e))?;

        let _ = app.emit(
            "runtime-install-progress",
            RuntimeInstallProgress {
                runtime: "python".into(),
                percent: 70.0,
                status: "Распаковка Python...".into(),
            },
        );

        let unpack = silent_command("tar.exe")
            .arg("-xf")
            .arg(&temp_zip)
            .arg("-C")
            .arg(&target_dir)
            .status();

        let _ = std::fs::remove_file(&temp_zip);

        if let Err(e) = unpack {
            return Err(format!("Ошибка распаковки Python: {}", e));
        }

        // Enable site-packages in python311._pth
        let pth_file = target_dir.join("python311._pth");
        if pth_file.exists() {
            if let Ok(content) = std::fs::read_to_string(&pth_file) {
                let updated = content.replace("#import site", "import site");
                let _ = std::fs::write(&pth_file, updated);
            }
        }

        let _ = app.emit(
            "runtime-install-progress",
            RuntimeInstallProgress {
                runtime: "python".into(),
                percent: 100.0,
                status: "Python успешно установлен".into(),
            },
        );

        Ok("Python 3.11.9 (Portable)".into())
    } else if runtime.eq_ignore_ascii_case("node") {
        let target_dir = runtimes_dir.join("node");
        std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

        let _ = app.emit(
            "runtime-install-progress",
            RuntimeInstallProgress {
                runtime: "node".into(),
                percent: 10.0,
                status: "Загрузка Node.js v20 portable (29 МБ)...".into(),
            },
        );

        let url = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip";
        let resp = client.get(url).send().await.map_err(|e| format!("Ошибка загрузки Node.js: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("Ошибка сервера при загрузке Node.js: HTTP {}", resp.status()));
        }

        let bytes = resp.bytes().await.map_err(|e| format!("Ошибка чтения данных: {}", e))?;
        let temp_zip = target_dir.join("node-portable.zip");
        std::fs::write(&temp_zip, &bytes).map_err(|e| format!("Ошибка сохранения архива: {}", e))?;

        let _ = app.emit(
            "runtime-install-progress",
            RuntimeInstallProgress {
                runtime: "node".into(),
                percent: 60.0,
                status: "Распаковка Node.js...".into(),
            },
        );

        let temp_extract = target_dir.join("temp_extract");
        let _ = std::fs::create_dir_all(&temp_extract);

        let unpack = silent_command("tar.exe")
            .arg("-xf")
            .arg(&temp_zip)
            .arg("-C")
            .arg(&temp_extract)
            .status();

        let _ = std::fs::remove_file(&temp_zip);

        if let Err(e) = unpack {
            return Err(format!("Ошибка распаковки Node.js: {}", e));
        }

        let inner = temp_extract.join("node-v20.18.0-win-x64");
        if inner.exists() {
            if let Ok(entries) = std::fs::read_dir(&inner) {
                for entry in entries.flatten() {
                    let dest = target_dir.join(entry.file_name());
                    if dest.exists() {
                        let _ = std::fs::remove_dir_all(&dest);
                        let _ = std::fs::remove_file(&dest);
                    }
                    let _ = std::fs::rename(entry.path(), dest);
                }
            }
        }
        let _ = std::fs::remove_dir_all(&temp_extract);

        let _ = app.emit(
            "runtime-install-progress",
            RuntimeInstallProgress {
                runtime: "node".into(),
                percent: 100.0,
                status: "Node.js успешно установлен".into(),
            },
        );

        Ok("Node.js v20.18.0 (Portable)".into())
    } else {
        Err(format!("Неизвестная среда: {}", runtime))
    }
}

#[tauri::command]
pub async fn export_plugin(plugin_id: String, target_path: String) -> Result<String, String> {
    let clean_id = plugin_id.trim();
    if clean_id.is_empty() {
        return Err("ID плагина не указан".into());
    }

    let plugin_dir = get_plugins_dir().join(clean_id);
    if !plugin_dir.exists() || !plugin_dir.is_dir() {
        return Err(format!("Папка плагина {} не найдена", clean_id));
    }

    let target_file = PathBuf::from(&target_path);
    if let Some(parent) = target_file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if target_file.exists() {
        let _ = std::fs::remove_file(&target_file);
    }

    let status = silent_command("tar.exe")
        .arg("-a")
        .arg("-cf")
        .arg(&target_file)
        .arg("-C")
        .arg(&plugin_dir)
        .arg(".")
        .status()
        .map_err(|e| format!("Ошибка создания архива .omniplugin: {}", e))?;

    if !status.success() {
        return Err("Не удалось упаковать плагин".into());
    }

    Ok(target_file.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn import_plugin(source_path: String) -> Result<PluginManifest, String> {
    let source_file = PathBuf::from(&source_path);
    if !source_file.exists() {
        return Err(format!("Файл {} не существует", source_path));
    }

    let temp_import = std::env::temp_dir().join(format!(
        "omni_import_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    ));
    let _ = std::fs::create_dir_all(&temp_import);

    let unpack_status = silent_command("tar.exe")
        .arg("-xf")
        .arg(&source_file)
        .arg("-C")
        .arg(&temp_import)
        .status()
        .map_err(|e| format!("Ошибка распаковки архива плагина: {}", e))?;

    if !unpack_status.success() {
        let _ = std::fs::remove_dir_all(&temp_import);
        return Err("Не удалось распаковать архив .omniplugin".into());
    }

    let mut manifest_path = temp_import.join("plugin.json");
    let mut content_dir = temp_import.clone();

    if !manifest_path.exists() {
        if let Ok(entries) = std::fs::read_dir(&temp_import) {
            for entry in entries.flatten() {
                let sub = entry.path();
                if sub.is_dir() && sub.join("plugin.json").exists() {
                    manifest_path = sub.join("plugin.json");
                    content_dir = sub;
                    break;
                }
            }
        }
    }

    if !manifest_path.exists() {
        let _ = std::fs::remove_dir_all(&temp_import);
        return Err("В архиве не найден файл манифеста plugin.json".into());
    }

    let manifest_str = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Ошибка чтения plugin.json: {}", e))?;

    let mut manifest: PluginManifest = serde_json::from_str(&manifest_str)
        .map_err(|e| format!("Некорректный формат plugin.json: {}", e))?;

    let clean_id = manifest
        .id
        .trim()
        .replace(|c: char| !c.is_alphanumeric() && c != '_' && c != '-', "");
    if clean_id.is_empty() {
        let _ = std::fs::remove_dir_all(&temp_import);
        return Err("Некорректный ID в манифесте плагина".into());
    }
    manifest.id = clean_id.clone();

    let dest_dir = get_plugins_dir().join(&clean_id);
    if dest_dir.exists() {
        let _ = std::fs::remove_dir_all(&dest_dir);
    }
    let _ = std::fs::create_dir_all(&dest_dir);

    // Copy all files
    let _ = silent_command("robocopy")
        .arg(&content_dir)
        .arg(&dest_dir)
        .arg("/E")
        .arg("/NFL")
        .arg("/NDL")
        .arg("/NJH")
        .arg("/NJS")
        .status();

    manifest.dir_path = Some(dest_dir.to_string_lossy().to_string());
    let _ = std::fs::remove_dir_all(&temp_import);

    Ok(manifest)
}

fn collect_plugin_dependencies(plugin: &PluginManifest) -> (Vec<String>, Vec<String>) {
    let mut py_pkgs = Vec::new();
    let mut npm_pkgs = Vec::new();

    // 1. Из манифеста
    if let Some(deps) = &plugin.dependencies {
        if let Some(py) = &deps.python {
            py_pkgs.extend(py.clone());
        }
        if let Some(npm) = &deps.npm {
            npm_pkgs.extend(npm.clone());
        }
    }

    if let Some(dir_str) = &plugin.dir_path {
        let plugin_dir = PathBuf::from(dir_str);

        // 2. requirements.txt
        let req_file = plugin_dir.join("requirements.txt");
        if req_file.exists() {
            if let Ok(content) = std::fs::read_to_string(&req_file) {
                for line in content.lines() {
                    let clean = line.trim();
                    if !clean.is_empty() && !clean.starts_with('#') {
                        let name = clean
                            .split(&['=', '>', '<', '~', ';'][..])
                            .next()
                            .unwrap_or(clean)
                            .trim();
                        if !name.is_empty() && !py_pkgs.contains(&name.to_string()) {
                            py_pkgs.push(name.to_string());
                        }
                    }
                }
            }
        }

        // 3. package.json
        let pkg_json = plugin_dir.join("package.json");
        if pkg_json.exists() {
            if let Ok(content) = std::fs::read_to_string(&pkg_json) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(deps_obj) = val.get("dependencies").and_then(|d| d.as_object()) {
                        for key in deps_obj.keys() {
                            if !npm_pkgs.contains(key) {
                                npm_pkgs.push(key.clone());
                            }
                        }
                    }
                }
            }
        }

        // 4. Парсинг импортов в script файле (например main.py)
        if py_pkgs.is_empty() {
            if let Some(script_name) = &plugin.script {
                if script_name.ends_with(".py") {
                    let script_path = plugin_dir.join(script_name);
                    if let Ok(content) = std::fs::read_to_string(&script_path) {
                        let std_libs = [
                            "os", "sys", "json", "time", "math", "re", "random", "datetime",
                            "pathlib", "collections", "itertools", "functools", "typing",
                            "subprocess", "hashlib", "base64", "urllib", "threading", "shutil",
                            "io", "copy", "logging", "socket", "struct", "tempfile", "traceback",
                            "uuid", "ctypes", "inspect", "enum", "dataclasses", "abc", "argparse",
                        ];

                        for line in content.lines() {
                            let trimmed = line.trim();
                            let candidate = if trimmed.starts_with("import ") {
                                trimmed.strip_prefix("import ").unwrap().split(',').next().unwrap().split_whitespace().next()
                            } else if trimmed.starts_with("from ") {
                                trimmed.strip_prefix("from ").unwrap().split_whitespace().next()
                            } else {
                                None
                            };

                            if let Some(raw_mod) = candidate {
                                let root_mod = raw_mod.split('.').next().unwrap_or("").trim();
                                if !root_mod.is_empty() && !std_libs.contains(&root_mod) {
                                    let pip_name = match root_mod {
                                        "PIL" => "pillow",
                                        "cv2" => "opencv-python",
                                        "bs4" => "beautifulsoup4",
                                        "yaml" => "pyyaml",
                                        other => other,
                                    };
                                    if !py_pkgs.iter().any(|p| p.eq_ignore_ascii_case(pip_name)) {
                                        py_pkgs.push(pip_name.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    (py_pkgs, npm_pkgs)
}

#[tauri::command]
pub async fn check_plugin_dependencies(plugin_id: String) -> Result<PluginDepsStatus, String> {
    let plugins = get_installed_plugins().await?;
    let plugin = plugins
        .into_iter()
        .find(|p| p.id == plugin_id)
        .ok_or_else(|| format!("Плагин {} не найден", plugin_id))?;

    let dir_path_str = plugin.dir_path.clone().unwrap_or_default();
    let plugin_dir = PathBuf::from(&dir_path_str);
    let runtimes_dir = get_runtimes_dir();

    let (py_pkgs, npm_pkgs) = collect_plugin_dependencies(&plugin);

    let mut missing_python = Vec::new();
    let mut missing_npm = Vec::new();

    // Проверка Python зависимостей через pip show
    if !py_pkgs.is_empty() {
        let portable_py = runtimes_dir.join("python").join("python.exe");
        let py_exe = if portable_py.exists() {
            portable_py.to_string_lossy().to_string()
        } else {
            "python".to_string()
        };

        for pkg in py_pkgs {
            let status = silent_command(&py_exe)
                .arg("-m")
                .arg("pip")
                .arg("show")
                .arg(&pkg)
                .status();

            let installed = match status {
                Ok(s) => s.success(),
                Err(_) => false,
            };
            if !installed {
                missing_python.push(pkg);
            }
        }
    }

    // Проверка NPM зависимостей
    if !npm_pkgs.is_empty() {
        let node_modules = plugin_dir.join("node_modules");
        for pkg in npm_pkgs {
            let pkg_path = node_modules.join(&pkg);
            if !pkg_path.exists() {
                missing_npm.push(pkg);
            }
        }
    }

    let all_installed = missing_python.is_empty() && missing_npm.is_empty();

    Ok(PluginDepsStatus {
        plugin_id,
        all_installed,
        missing_python,
        missing_npm,
    })
}

#[tauri::command]
pub async fn install_plugin_dependencies(
    plugin_id: String,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let plugins = get_installed_plugins().await?;
    let plugin = plugins
        .into_iter()
        .find(|p| p.id == plugin_id)
        .ok_or_else(|| format!("Плагин {} не найден", plugin_id))?;

    let dir_path_str = plugin.dir_path.clone().ok_or("Путь к плагину недоступен")?;
    let plugin_dir = PathBuf::from(&dir_path_str);
    let runtimes_dir = get_runtimes_dir();

    let (py_pkgs, npm_pkgs) = collect_plugin_dependencies(&plugin);

    let _ = app_handle.emit(
        "plugin-dep-progress",
        PluginDepProgressEvent {
            plugin_id: plugin_id.clone(),
            percent: 5.0,
            status: "Анализ окружения и зависимостей...".into(),
            log_chunk: format!("=== Проверка зависимостей для {} ===\n", plugin.name),
            done: false,
            has_error: false,
        },
    );

    let total_pkgs = py_pkgs.len() + npm_pkgs.len();
    if total_pkgs == 0 {
        let _ = app_handle.emit(
            "plugin-dep-progress",
            PluginDepProgressEvent {
                plugin_id: plugin_id.clone(),
                percent: 100.0,
                status: "Зависимости не требуются".into(),
                log_chunk: "Зависимости не требуются или уже установлены.\n".into(),
                done: true,
                has_error: false,
            },
        );
        return Ok("Зависимости не требуются".into());
    }

    let mut logs = String::new();
    let mut installed_count = 0;

    // 1. Python пакеты
    if !py_pkgs.is_empty() {
        logs.push_str("=== Установка Python зависимостей ===\n");
        let portable_py = runtimes_dir.join("python").join("python.exe");
        let py_exe = if portable_py.exists() {
            portable_py.to_string_lossy().to_string()
        } else {
            "python".to_string()
        };

        let has_pip = silent_command(&py_exe)
            .arg("-m")
            .arg("pip")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if !has_pip && portable_py.exists() {
            let _ = app_handle.emit(
                "plugin-dep-progress",
                PluginDepProgressEvent {
                    plugin_id: plugin_id.clone(),
                    percent: 10.0,
                    status: "Загрузка pip в окружение...".into(),
                    log_chunk: "Автономный pip не найден. Загрузка get-pip.py...\n".into(),
                    done: false,
                    has_error: false,
                },
            );

            let client = reqwest::Client::new();
            if let Ok(resp) = client.get("https://bootstrap.pypa.io/get-pip.py").send().await {
                if let Ok(bytes) = resp.bytes().await {
                    let get_pip_path = std::env::temp_dir().join("get-pip.py");
                    let _ = std::fs::write(&get_pip_path, &bytes);
                    let _ = silent_command(&py_exe)
                        .arg(&get_pip_path)
                        .arg("--no-warn-script-location")
                        .output();
                    let _ = std::fs::remove_file(&get_pip_path);
                    logs.push_str("pip успешно установлен в портативное окружение Python.\n");
                }
            }
        }

        for pkg in &py_pkgs {
            installed_count += 1;
            let percent = 10.0 + ((installed_count as f64) / (total_pkgs as f64)) * 80.0;

            let chunk = format!("Установка {}...\n", pkg);
            logs.push_str(&chunk);

            let _ = app_handle.emit(
                "plugin-dep-progress",
                PluginDepProgressEvent {
                    plugin_id: plugin_id.clone(),
                    percent,
                    status: format!("Установка {}...", pkg),
                    log_chunk: chunk,
                    done: false,
                    has_error: false,
                },
            );

            let mut cmd = silent_command(&py_exe);
            cmd.arg("-m")
                .arg("pip")
                .arg("install")
                .arg(pkg)
                .arg("--no-warn-script-location");
            let out = cmd.output().map_err(|e| format!("Ошибка вызова pip: {}", e))?;
            let stdout_str = String::from_utf8_lossy(&out.stdout).to_string();
            logs.push_str(&stdout_str);

            if !out.status.success() {
                let stderr_str = String::from_utf8_lossy(&out.stderr).to_string();
                logs.push_str(&stderr_str);

                let _ = app_handle.emit(
                    "plugin-dep-progress",
                    PluginDepProgressEvent {
                        plugin_id: plugin_id.clone(),
                        percent,
                        status: format!("Ошибка установки {}", pkg),
                        log_chunk: stderr_str,
                        done: false,
                        has_error: true,
                    },
                );

                return Err(format!("Не удалось установить пакет {}:\n{}", pkg, logs));
            }

            let _ = app_handle.emit(
                "plugin-dep-progress",
                PluginDepProgressEvent {
                    plugin_id: plugin_id.clone(),
                    percent,
                    status: format!("Установлен {}", pkg),
                    log_chunk: stdout_str,
                    done: false,
                    has_error: false,
                },
            );
        }
    }

    // 2. NPM пакеты
    if !npm_pkgs.is_empty() {
        logs.push_str("=== Установка Node.js / NPM зависимостей ===\n");
        let portable_npm = runtimes_dir.join("node").join("npm.cmd");
        let npm_exe = if portable_npm.exists() {
            portable_npm.to_string_lossy().to_string()
        } else {
            "npm.cmd".to_string()
        };

        for pkg in &npm_pkgs {
            installed_count += 1;
            let percent = 10.0 + ((installed_count as f64) / (total_pkgs as f64)) * 80.0;

            let chunk = format!("Установка npm пакета {}...\n", pkg);
            logs.push_str(&chunk);

            let _ = app_handle.emit(
                "plugin-dep-progress",
                PluginDepProgressEvent {
                    plugin_id: plugin_id.clone(),
                    percent,
                    status: format!("Установка {}...", pkg),
                    log_chunk: chunk,
                    done: false,
                    has_error: false,
                },
            );

            let mut cmd = silent_command(&npm_exe);
            cmd.current_dir(&plugin_dir);
            cmd.arg("install").arg(pkg).arg("--save");
            let out = cmd.output().map_err(|e| format!("Ошибка вызова npm: {}", e))?;
            let stdout_str = String::from_utf8_lossy(&out.stdout).to_string();
            logs.push_str(&stdout_str);

            if !out.status.success() {
                let stderr_str = String::from_utf8_lossy(&out.stderr).to_string();
                logs.push_str(&stderr_str);

                let _ = app_handle.emit(
                    "plugin-dep-progress",
                    PluginDepProgressEvent {
                        plugin_id: plugin_id.clone(),
                        percent,
                        status: format!("Ошибка установки {}", pkg),
                        log_chunk: stderr_str,
                        done: false,
                        has_error: true,
                    },
                );

                return Err(format!("Не удалось установить npm пакет {}:\n{}", pkg, logs));
            }

            let _ = app_handle.emit(
                "plugin-dep-progress",
                PluginDepProgressEvent {
                    plugin_id: plugin_id.clone(),
                    percent,
                    status: format!("Установлен {}", pkg),
                    log_chunk: stdout_str,
                    done: false,
                    has_error: false,
                },
            );
        }
    }

    logs.push_str("Все зависимости успешно установлены.\n");

    let _ = app_handle.emit(
        "plugin-dep-progress",
        PluginDepProgressEvent {
            plugin_id: plugin_id.clone(),
            percent: 100.0,
            status: "Все зависимости готовы".into(),
            log_chunk: "Все зависимости успешно установлены.\n".into(),
            done: true,
            has_error: false,
        },
    );

    Ok(logs)
}
