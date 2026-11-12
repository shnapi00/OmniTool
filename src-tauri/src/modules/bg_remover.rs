use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Instant;
use ndarray::Array4;
use ort::environment::Environment;
use ort::session::Session;
use ort::value::Tensor;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

#[derive(Debug, Serialize, Deserialize)]
pub struct BgRemovalResult {
    pub success: bool,
    pub output_path: String,
    pub orig_path: Option<String>,
    pub processing_time_ms: u64,
    pub method: String,
    pub message: String,
}

static ORT_ENV: OnceLock<Arc<Environment>> = OnceLock::new();

fn get_environment() -> Result<Arc<Environment>, String> {
    if let Some(env) = ORT_ENV.get() {
        return Ok(env.clone());
    }

    let env = ort::init()
        .with_name("OmniTool_AI")
        .build()
        .map_err(|e| format!("Ошибка инициализации ONNX Runtime: {}", e))?;

    let arc_env = Arc::new(env);
    let _ = ORT_ENV.set(arc_env.clone());
    Ok(arc_env)
}

async fn find_or_download_model() -> Result<PathBuf, String> {
    // 1. Проверяем папку models рядом с exe
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = [
                exe_dir.join("resources").join("u2netp.onnx"),
                exe_dir.join("models").join("u2netp.onnx"),
                exe_dir.join("resources").join("models").join("u2netp.onnx"),
                exe_dir.join("u2netp.onnx"),
            ];
            for path in &candidates {
                if path.exists() {
                    return Ok(path.clone());
                }
            }
        }
    }

    // 2. Проверяем локальные пути в проекте
    let project_paths = [
        PathBuf::from("resources/u2netp.onnx"),
        PathBuf::from("src-tauri/resources/u2netp.onnx"),
        PathBuf::from("models/u2netp.onnx"),
        PathBuf::from("src-tauri/models/u2netp.onnx"),
        PathBuf::from("u2netp.onnx"),
        PathBuf::from("../u2netp.onnx"),
    ];

    for path in &project_paths {
        if path.exists() {
            return Ok(path.clone());
        }
    }

    // 3. Проверяем %LOCALAPPDATA%\OmniTool\models\u2netp.onnx
    if let Ok(app_data) = std::env::var("LOCALAPPDATA") {
        let app_model = PathBuf::from(app_data).join("OmniTool").join("models").join("u2netp.onnx");
        if app_model.exists() {
            return Ok(app_model);
        }

        // Если файл отсутствует, скачиваем его
        if let Some(parent) = app_model.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let model_url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx";
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| format!("Ошибка создания HTTP клиента: {}", e))?;

        let resp = client.get(model_url).send().await
            .map_err(|e| format!("Не удалось скачать модель нейросети: {}", e))?;

        if resp.status().is_success() {
            let bytes = resp.bytes().await.map_err(|e| format!("Ошибка загрузки модели: {}", e))?;
            std::fs::write(&app_model, &bytes)
                .map_err(|e| format!("Ошибка сохранения модели: {}", e))?;
            return Ok(app_model);
        }
    }

    Err("Файл модели u2netp.onnx не найден".into())
}

/// Быстрый сепарабельный 2D Box Filter с корректной обработкой краев
fn box_filter_2d(src: &[f32], w: usize, h: usize, r: usize) -> Vec<f32> {
    if w == 0 || h == 0 {
        return Vec::new();
    }
    let mut temp = vec![0.0f32; w * h];
    let mut dst = vec![0.0f32; w * h];

    // Горизонтальный проход
    for y in 0..h {
        let row_offset = y * w;
        let mut sum = 0.0f32;
        let right_lim = r.min(w.saturating_sub(1));
        for x in 0..=right_lim {
            sum += src[row_offset + x];
        }
        let mut left_x: usize = 0;
        let mut right_x = right_lim;

        for x in 0..w {
            let count = (right_x - left_x + 1) as f32;
            temp[row_offset + x] = sum / count;

            if x + r + 1 < w {
                right_x += 1;
                sum += src[row_offset + right_x];
            }
            if x >= r {
                sum -= src[row_offset + left_x];
                left_x += 1;
            }
        }
    }

    // Вертикальный проход
    for x in 0..w {
        let mut sum = 0.0f32;
        let bottom_lim = r.min(h.saturating_sub(1));
        for y in 0..=bottom_lim {
            sum += temp[y * w + x];
        }
        let mut top_y: usize = 0;
        let mut bottom_y = bottom_lim;

        for y in 0..h {
            let count = (bottom_y - top_y + 1) as f32;
            dst[y * w + x] = sum / count;

            if y + r + 1 < h {
                bottom_y += 1;
                sum += temp[bottom_y * w + x];
            }
            if y >= r {
                sum -= temp[top_y * w + x];
                top_y += 1;
            }
        }
    }

    dst
}

/// Guided Filter (He et al.) для устранения обгрызенных краев и извлечения тонких деталей (волосы/шерсть/контуры)
fn apply_guided_filter(
    guide: &[f32],
    input_mask: &[f32],
    w: usize,
    h: usize,
    r: usize,
    eps: f32,
) -> Vec<f32> {
    let n = w * h;

    let mean_i = box_filter_2d(guide, w, h, r);
    let mean_p = box_filter_2d(input_mask, w, h, r);

    let mut ip = vec![0.0f32; n];
    let mut ii = vec![0.0f32; n];
    for i in 0..n {
        ip[i] = guide[i] * input_mask[i];
        ii[i] = guide[i] * guide[i];
    }

    let mean_ip = box_filter_2d(&ip, w, h, r);
    let mean_ii = box_filter_2d(&ii, w, h, r);

    let mut a = vec![0.0f32; n];
    let mut b = vec![0.0f32; n];

    for i in 0..n {
        let cov_ip = mean_ip[i] - mean_i[i] * mean_p[i];
        let var_i = (mean_ii[i] - mean_i[i] * mean_i[i]).max(0.0);
        let a_val = cov_ip / (var_i + eps);
        let b_val = mean_p[i] - a_val * mean_i[i];
        a[i] = a_val;
        b[i] = b_val;
    }

    let mean_a = box_filter_2d(&a, w, h, r);
    let mean_b = box_filter_2d(&b, w, h, r);

    let mut q = vec![0.0f32; n];
    for i in 0..n {
        let val = mean_a[i] * guide[i] + mean_b[i];
        let orig_p = input_mask[i];

        // В уверенных областях сохраняем контраст
        let refined = if orig_p < 0.03 {
            val.min(orig_p * 2.5)
        } else if orig_p > 0.97 {
            val.max(0.96)
        } else {
            val
        };

        q[i] = refined.clamp(0.0, 1.0);
    }

    q
}

/// Основной внутренний пайплайн инференса U2Net и постобработки через Guided Filter
fn process_image_removal(
    dyn_img: image::DynamicImage,
    out_path: &Path,
    model_path: &Path,
) -> Result<u64, String> {
    let start = Instant::now();
    let (orig_w, orig_h) = (dyn_img.width(), dyn_img.height());
    if orig_w == 0 || orig_h == 0 {
        return Err("Изображение имеет нулевой размер".into());
    }

    // Ресайз для инференса U2Net (320x320)
    let resized = dyn_img.resize_exact(320, 320, image::imageops::FilterType::Triangle);
    let rgb = resized.to_rgb8();

    // Подготовка тензора [1, 3, 320, 320] с ImageNet нормализацией
    let mut input_array = Array4::<f32>::zeros((1, 3, 320, 320));
    for y in 0..320 {
        for x in 0..320 {
            let p = rgb.get_pixel(x, y);
            let r = (p[0] as f32 / 255.0 - 0.485) / 0.229;
            let g = (p[1] as f32 / 255.0 - 0.456) / 0.224;
            let b = (p[2] as f32 / 255.0 - 0.406) / 0.225;
            input_array[[0, 0, y as usize, x as usize]] = r;
            input_array[[0, 1, y as usize, x as usize]] = g;
            input_array[[0, 2, y as usize, x as usize]] = b;
        }
    }

    let env = get_environment()?;
    let mut session = Session::builder(&env)
        .map_err(|e| format!("Ошибка создания сессии ONNX: {}", e))?
        .commit_from_file(model_path)
        .map_err(|e| format!("Ошибка загрузки модели ONNX: {}", e))?;

    let input_tensor = Tensor::from_array(input_array)
        .map_err(|e| format!("Ошибка создания тензора: {}", e))?;

    let outputs = session.run(ort::inputs![input_tensor])
        .map_err(|e| format!("Ошибка инференса нейросети: {}", e))?;

    let (_, raw_slice) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("Ошибка извлечения маски: {}", e))?;

    if raw_slice.len() < 320 * 320 {
        return Err("Некорректный размер выходного тензора модели".into());
    }

    // Нормализация выходной маски (0.0 .. 1.0)
    let mask_slice = &raw_slice[0..320 * 320];
    let mut min_val = f32::MAX;
    let mut max_val = f32::MIN;
    for &v in mask_slice {
        if v < min_val { min_val = v; }
        if v > max_val { max_val = v; }
    }
    let range = (max_val - min_val).max(1e-6);

    let mut norm_mask_320 = vec![0.0f32; 320 * 320];
    for i in 0..320 * 320 {
        norm_mask_320[i] = (mask_slice[i] - min_val) / range;
    }

    let w_usize = orig_w as usize;
    let h_usize = orig_h as usize;

    // 1. Билинейная интерполяция маски U2Net до полного разрешения оригинала
    let mut upsampled_mask = vec![0.0f32; w_usize * h_usize];
    for y in 0..orig_h {
        let gy = (y as f32 + 0.5) * (320.0 / orig_h as f32) - 0.5;
        let y0 = (gy.floor() as isize).clamp(0, 319) as usize;
        let y1 = (y0 + 1).min(319);
        let fy = (gy - y0 as f32).clamp(0.0, 1.0);

        for x in 0..orig_w {
            let gx = (x as f32 + 0.5) * (320.0 / orig_w as f32) - 0.5;
            let x0 = (gx.floor() as isize).clamp(0, 319) as usize;
            let x1 = (x0 + 1).min(319);
            let fx = (gx - x0 as f32).clamp(0.0, 1.0);

            let v00 = norm_mask_320[y0 * 320 + x0];
            let v10 = norm_mask_320[y0 * 320 + x1];
            let v01 = norm_mask_320[y1 * 320 + x0];
            let v11 = norm_mask_320[y1 * 320 + x1];

            let top = v00 * (1.0 - fx) + v10 * fx;
            let bottom = v01 * (1.0 - fx) + v11 * fx;
            upsampled_mask[y as usize * w_usize + x as usize] = top * (1.0 - fy) + bottom * fy;
        }
    }

    // 2. Подготовка карты яркости (Guide luminance) из исходного изображения
    let mut orig_rgba = dyn_img.to_rgba8();
    let mut guide = vec![0.0f32; w_usize * h_usize];
    for y in 0..orig_h {
        for x in 0..orig_w {
            let p = orig_rgba.get_pixel(x, y);
            let lum = (0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32) / 255.0;
            guide[y as usize * w_usize + x as usize] = lum;
        }
    }

    // 3. Применение Guided Filter для восстановления тонких волокон, шерсти и сглаживания краев
    // Радиус окна пропорционален разрешению (обычно от 6 до 16 пикселей)
    let radius = (orig_w.min(orig_h) as usize / 100).clamp(6, 16);
    let refined_alpha = apply_guided_filter(&guide, &upsampled_mask, w_usize, h_usize, radius, 1e-3);

    // 4. Запись результирующего альфа-канала
    for y in 0..orig_h {
        for x in 0..orig_w {
            let idx = y as usize * w_usize + x as usize;
            let a = (refined_alpha[idx] * 255.0).round().clamp(0.0, 255.0) as u8;
            orig_rgba.get_pixel_mut(x, y)[3] = a;
        }
    }

    if let Some(parent) = out_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    orig_rgba
        .save_with_format(out_path, image::ImageFormat::Png)
        .map_err(|e| format!("Не удалось сохранить результат: {}", e))?;

    let elapsed = start.elapsed().as_millis() as u64;
    Ok(elapsed)
}

#[tauri::command]
pub async fn remove_background(
    input_path: String,
    output_path: String,
) -> Result<BgRemovalResult, String> {
    let in_path = Path::new(&input_path);
    if !in_path.exists() {
        return Err(format!("Исходный файл не найден: {}", input_path));
    }

    let temp_dir = std::env::var("LOCALAPPDATA")
        .map(|p| PathBuf::from(p).join("OmniTool").join("temp"))
        .unwrap_or_else(|_| std::env::temp_dir().join("omnitool"));
    let _ = std::fs::create_dir_all(&temp_dir);
    let timestamp = Instant::now().elapsed().as_nanos();

    // Не сохраняем в папку пользователя автоматически!
    // Сохраняем результат исключительно во временный файл для рендеринга на Canvas.
    let out_path: PathBuf = if output_path.trim().is_empty() {
        temp_dir.join(format!("nobg_preview_{}.png", timestamp))
    } else {
        PathBuf::from(output_path.trim())
    };

    let _cancel_flag = crate::modules::task_manager::register_task("bg_remover");
    crate::modules::task_manager::add_cleanup_file("bg_remover", out_path.clone());

    let model_path = match find_or_download_model().await {
        Ok(m) => m,
        Err(e) => {
            crate::modules::task_manager::unregister_task("bg_remover");
            return Err(e);
        }
    };

    let dyn_img = match image::open(in_path) {
        Ok(img) => img,
        Err(e) => {
            crate::modules::task_manager::unregister_task("bg_remover");
            return Err(format!("Не удалось прочитать изображение: {}", e));
        }
    };

    let elapsed = match process_image_removal(dyn_img, &out_path, &model_path) {
        Ok(el) => el,
        Err(e) => {
            let _ = std::fs::remove_file(&out_path);
            crate::modules::task_manager::unregister_task("bg_remover");
            return Err(e);
        }
    };

    if crate::modules::task_manager::is_task_cancelled("bg_remover") {
        let _ = std::fs::remove_file(&out_path);
        crate::modules::task_manager::unregister_task("bg_remover");
        return Err("TASK_CANCELLED_BY_USER".into());
    }

    crate::modules::task_manager::unregister_task("bg_remover");

    Ok(BgRemovalResult {
        success: true,
        output_path: out_path.to_string_lossy().to_string(),
        orig_path: Some(in_path.to_string_lossy().to_string()),
        processing_time_ms: elapsed,
        method: "U2Net + Guided Matting Filter".into(),
        message: format!("Фон успешно удален за {} мс с улучшением краев", elapsed),
    })
}

#[tauri::command]
pub async fn remove_background_base64(
    base64_data: String,
) -> Result<BgRemovalResult, String> {
    let clean_base64 = if let Some(idx) = base64_data.find(',') {
        &base64_data[idx + 1..]
    } else {
        &base64_data
    };

    let bytes = BASE64
        .decode(clean_base64.trim())
        .map_err(|e| format!("Ошибка декодирования base64: {}", e))?;

    let dyn_img = image::load_from_memory(&bytes)
        .map_err(|e| format!("Ошибка парсинга изображения из буфера: {}", e))?;

    let temp_dir = std::env::var("LOCALAPPDATA")
        .map(|p| PathBuf::from(p).join("OmniTool").join("temp"))
        .unwrap_or_else(|_| std::env::temp_dir().join("omnitool"));

    let _ = std::fs::create_dir_all(&temp_dir);
    let timestamp = Instant::now().elapsed().as_nanos();
    let orig_saved_path = temp_dir.join(format!("clipboard_orig_{}.png", timestamp));
    let _ = dyn_img.save_with_format(&orig_saved_path, image::ImageFormat::Png);
    let out_path = temp_dir.join(format!("clipboard_nobg_{}.png", timestamp));

    let _cancel_flag = crate::modules::task_manager::register_task("bg_remover");
    crate::modules::task_manager::add_cleanup_file("bg_remover", out_path.clone());
    crate::modules::task_manager::add_cleanup_file("bg_remover", orig_saved_path.clone());

    let model_path = match find_or_download_model().await {
        Ok(m) => m,
        Err(e) => {
            let _ = std::fs::remove_file(&orig_saved_path);
            crate::modules::task_manager::unregister_task("bg_remover");
            return Err(e);
        }
    };

    let elapsed = match process_image_removal(dyn_img, &out_path, &model_path) {
        Ok(el) => el,
        Err(e) => {
            let _ = std::fs::remove_file(&out_path);
            let _ = std::fs::remove_file(&orig_saved_path);
            crate::modules::task_manager::unregister_task("bg_remover");
            return Err(e);
        }
    };

    if crate::modules::task_manager::is_task_cancelled("bg_remover") {
        let _ = std::fs::remove_file(&out_path);
        let _ = std::fs::remove_file(&orig_saved_path);
        crate::modules::task_manager::unregister_task("bg_remover");
        return Err("TASK_CANCELLED_BY_USER".into());
    }

    crate::modules::task_manager::unregister_task("bg_remover");

    Ok(BgRemovalResult {
        success: true,
        output_path: out_path.to_string_lossy().to_string(),
        orig_path: Some(orig_saved_path.to_string_lossy().to_string()),
        processing_time_ms: elapsed,
        method: "U2Net + Guided Matting Filter".into(),
        message: format!("Скриншот из буфера обработан за {} мс", elapsed),
    })
}
