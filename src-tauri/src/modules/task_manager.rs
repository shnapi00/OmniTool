use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

#[derive(Clone, Default)]
pub struct TaskContext {
    pub pid: Option<u32>,
    pub cleanup_files: Vec<PathBuf>,
    pub cleanup_dirs: Vec<PathBuf>,
    pub cancelled: Arc<AtomicBool>,
}

static ACTIVE_TASKS: OnceLock<Arc<Mutex<HashMap<String, TaskContext>>>> = OnceLock::new();
static CANCELLED_RECENTLY: OnceLock<Arc<Mutex<HashMap<String, Instant>>>> = OnceLock::new();

fn get_active_tasks() -> &'static Arc<Mutex<HashMap<String, TaskContext>>> {
    ACTIVE_TASKS.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

fn get_cancelled_recently() -> &'static Arc<Mutex<HashMap<String, Instant>>> {
    CANCELLED_RECENTLY.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

pub fn register_task(task_type: &str) -> Arc<AtomicBool> {
    {
        let mut rec = get_cancelled_recently().lock().unwrap();
        rec.remove(task_type);
    }
    let flag = Arc::new(AtomicBool::new(false));
    let mut map = get_active_tasks().lock().unwrap();
    map.insert(
        task_type.to_string(),
        TaskContext {
            pid: None,
            cleanup_files: Vec::new(),
            cleanup_dirs: Vec::new(),
            cancelled: flag.clone(),
        },
    );
    flag
}

pub fn update_task_pid(task_type: &str, pid: u32) {
    let mut map = get_active_tasks().lock().unwrap();
    if let Some(ctx) = map.get_mut(task_type) {
        ctx.pid = Some(pid);
    }
}

pub fn add_cleanup_file(task_type: &str, file: PathBuf) {
    let mut map = get_active_tasks().lock().unwrap();
    if let Some(ctx) = map.get_mut(task_type) {
        ctx.cleanup_files.push(file);
    }
}

pub fn add_cleanup_dir(task_type: &str, dir: PathBuf) {
    let mut map = get_active_tasks().lock().unwrap();
    if let Some(ctx) = map.get_mut(task_type) {
        ctx.cleanup_dirs.push(dir);
    }
}

pub fn unregister_task(task_type: &str) {
    let mut map = get_active_tasks().lock().unwrap();
    map.remove(task_type);
}

pub fn is_task_cancelled(task_type: &str) -> bool {
    // 1. Check recent intentional cancellations (persists for 30 seconds after cancel_task)
    {
        let mut rec = get_cancelled_recently().lock().unwrap();
        rec.retain(|_, time| time.elapsed().as_secs() < 30);
        if rec.contains_key(task_type) {
            return true;
        }
    }

    // 2. Check active task flag
    let map = get_active_tasks().lock().unwrap();
    if let Some(ctx) = map.get(task_type) {
        ctx.cancelled.load(Ordering::SeqCst)
    } else {
        false
    }
}

#[tauri::command]
pub async fn cancel_task(task_type: String) -> Result<(), String> {
    // Record into recent cancellations immediately so any concurrent/exit checks see it
    {
        let mut rec = get_cancelled_recently().lock().unwrap();
        rec.insert(task_type.clone(), Instant::now());
    }

    let ctx_opt = {
        let mut map = get_active_tasks().lock().unwrap();
        map.remove(&task_type)
    };

    if let Some(ctx) = ctx_opt {
        // 1. Mark as cancelled
        ctx.cancelled.store(true, Ordering::SeqCst);

        // 2. Kill process tree by PID if present
        if let Some(pid) = ctx.pid {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = std::process::Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .output();
            }
        }

        // 3. Small pause to allow file handles to be released by the killed process
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        // 4. Cleanup registered files
        for f in ctx.cleanup_files {
            if f.exists() {
                let _ = std::fs::remove_file(&f);
            }
        }

        // 5. Cleanup temporary / incomplete files in registered directories (.part, .ytdl, .tmp, .temp)
        for dir in ctx.cleanup_dirs {
            if dir.exists() && dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if let Some(ext) = path
                            .extension()
                            .and_then(|e| e.to_str())
                            .map(|s| s.to_lowercase())
                        {
                            if matches!(ext.as_str(), "part" | "ytdl" | "tmp" | "temp") {
                                let _ = std::fs::remove_file(&path);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}
