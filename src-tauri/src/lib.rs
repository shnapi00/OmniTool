mod memory;
pub mod modules;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                                memory::trim_memory();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(),
        )
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                memory::trim_memory();
            }
        })
        .setup(|app| {
            // Регистрируем глобальный хоткей для показа/скрытия
            let _ = app.global_shortcut().register("Ctrl+Shift+X");
            let _ = app.global_shortcut().register("Alt+Space");

            let show_item = MenuItem::with_id(app, "show", "Показать окно", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Скрыть в трей", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;

            let tray_menu = Menu::with_items(app, &[&show_item, &hide_item, &separator, &quit_item])?;
            let icon = app.default_window_icon().cloned();

            if let Some(ref w_icon) = icon {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_icon(w_icon.clone());
                }
            }

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .tooltip("OmniTool — Утилиты")
                .menu(&tray_menu)
                .show_menu_on_left_click(false);

            if let Some(tray_icon) = icon {
                tray_builder = tray_builder.icon(tray_icon);
            }

            // Очищаем тестовые мок-файлы update_staged если они остались
            modules::updater::clean_mock_staged();

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if modules::updater::UPDATE_CHECK_ENABLED && !modules::updater::GITHUB_REPO_URL.trim().is_empty() {
                    tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                    if let Ok(status) = modules::updater::check_app_updates().await {
                        if status.has_update && status.is_staged {
                            let _ = handle.emit("update-staged-ready", modules::updater::get_staged_update());
                        }
                    }
                }
            });

            tray_builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                            memory::trim_memory();
                        }
                    }
                    "quit" => {
                        let cfg = modules::config::read_config_from_disk();
                        if cfg.auto_update_on_restart && modules::updater::is_staged_update_ready() {
                            let _ = modules::updater::apply_update_and_restart(app.clone());
                        } else {
                            app.exit(0);
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            modules::lifecycle::app_ready,
            modules::lifecycle::minimize_window,
            modules::lifecycle::toggle_maximize_window,
            modules::lifecycle::hide_window,
            modules::lifecycle::close_window,
            modules::lifecycle::open_folder,
            modules::lifecycle::open_file,
            modules::lifecycle::delete_files,
            modules::task_manager::cancel_task,
            modules::stickers::has_builtin_tg_token,
            modules::stickers::load_sticker_pack,
            modules::stickers::fetch_sticker_bytes,
            modules::stickers::prepare_sticker_pack_dir,
            modules::stickers::save_static_sticker,
            modules::stickers::save_video_sticker,
            modules::stickers::save_tgs_animated_sticker,
            modules::stickers::download_selected_stickers,
            modules::stickers::download_stickers,
            modules::bg_remover::remove_background,
            modules::bg_remover::remove_background_base64,
            modules::media_downloader::download_media,
            modules::media_downloader::check_media_tool,
            modules::converter::convert_media,
            modules::plugins::get_installed_plugins,
            modules::plugins::execute_plugin,
            modules::plugins::execute_plugin_exec,
            modules::plugins::read_plugin_file,
            modules::plugins::write_plugin_file,
            modules::plugins::create_custom_plugin,
            modules::plugins::delete_custom_plugin,
            modules::plugins::get_plugins_folder_path,
            modules::plugins::check_runtimes_status,
            modules::plugins::install_portable_runtime,
            modules::plugins::export_plugin,
            modules::plugins::import_plugin,
            modules::plugins::check_plugin_dependencies,
            modules::plugins::install_plugin_dependencies,
            modules::ocr::recognize_text,
            modules::ocr::recognize_base64,
            modules::ocr::get_available_ocr_languages,
            modules::ocr::download_ocr_language,
            modules::settings::get_autostart,
            modules::settings::set_autostart,
            modules::settings::save_canvas_image,
            modules::settings::save_temp_image,
            modules::config::get_app_config,
            modules::config::save_app_config,
            modules::updater::check_app_updates,
            modules::updater::get_staged_update,
            modules::updater::apply_update_and_restart,
            modules::audio_extractor::probe_media_file,
            modules::audio_extractor::process_audio_extraction,
            modules::audio_extractor::add_to_soundpad,
            modules::media_compressor::probe_compressor_file,
            modules::media_compressor::compress_media,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}