#[macro_use]
extern crate objc;
pub mod commands;
pub mod error;
mod server_client;
mod launcher;

use commands::AppState;
use server_client::ServerClient;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod utils;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // rustls 0.23 当同时编译了多个 provider（ring + aws-lc-rs）时不能自动选择，
    // 必须在任何 TLS 连接前显式安装。使用 ring（轻量、广泛支持）。
    let _ = rustls::crypto::ring::default_provider().install_default();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
        .setup(|app| {
            // Register the ServerClient synchronously; lazy-connect on first use.
            let client = Arc::new(ServerClient::new());
            client.set_app_handle(app.handle().clone());
            let state = app.state::<AppState>();
            if let Ok(mut guard) = state.server_client.lock() {
                *guard = Some(client);
            }

            // Pre-warm the launcher app index in the background so the
            // first Option+Space doesn't show a blank palette. The scan
            // touches every .app bundle under /Applications and friends,
            // which can take ~100ms on a typical Mac; running it on a
            // background tokio task means the user almost never notices it.
            let prewarm_index = state.app_index.clone();
            tauri::async_runtime::spawn(async move {
                let mut index = prewarm_index.lock().await;
                let _ = index.refresh();
            });

            // Periodically refresh the running-apps cache (every 3s). The
            // launcher joins this with the static `AppIndex` to mark each
            // search result as `running`. 3 seconds is short enough that
            // freshly-launched apps show up quickly, long enough that we
            // aren't constantly shelling out to `osascript`.
            crate::launcher::spawn_running_apps_loop(
                state.running_apps.clone(),
                std::time::Duration::from_secs(3),
            );

            // Register global shortcut and launcher window blur handler
            {
                let app_handle = app.handle().clone();
                let shortcut_manager = app_handle.global_shortcut();
                let _ = shortcut_manager.on_shortcut(
                    "Option+Space",
                    move |app_handle, _shortcut, event| {
                        if event.state() == ShortcutState::Pressed {
                            if let Some(window) =
                                app_handle.get_webview_window("launcher")
                            {
                                let visible = window.is_visible().unwrap_or(false);
                                let focused = window.is_focused().unwrap_or(false);
                                if visible && focused {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                    let _ = app_handle
                                        .emit("global-shortcut", "Option+Space");
                                }
                            }
                        }
                    },
                );
            }
            if let Some(window) = app.get_webview_window("launcher") {
                let window_clone = window.clone();
                let _ = window.on_window_event(move |event| {
                    match event {
                        // Blurring away from the launcher hides it; this is the
                        // "click outside to dismiss" affordance.
                        tauri::WindowEvent::Focused(false) => {
                            let _ = window_clone.hide();
                        }
                        // Intercept the close button (red traffic light) and
                        // hide the window instead of destroying it; the user
                        // can summon the launcher again with the global
                        // shortcut or Cmd+K.
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            let _ = window_clone.hide();
                        }
                        _ => {}
                    }
                });
            }
            if let Some(window) = app.get_webview_window("workbench") {
                let window_clone = window.clone();
                let _ = window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Hide rather than close: the workbench is the
                        // primary surface and we want it to stay alive in the
                        // background so a subsequent Cmd+K can revive the
                        // launcher without losing state.
                        api.prevent_close();
                        let _ = window_clone.hide();
                    }
                });
            }
            if let Some(window) = app.get_webview_window("pages") {
                let window_clone = window.clone();
                let _ = window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // The pages window is undecorated; intercept its
                        // close button so it hides instead of being destroyed.
                        api.prevent_close();
                        let _ = window_clone.hide();
                    }
                });
            }

            // Build the system tray icon and menu. The tray gives the user
            // a way to bring the launcher / workbench back into view after
            // both windows are hidden, and a proper Quit action so the
            // app can actually exit (the workbench close button just hides).
            {
                let show_launcher_item = MenuItem::with_id(
                    app,
                    "show_launcher",
                    "Show Launcher  ⌥Space",
                    true,
                    None::<&str>,
                )?;
                let show_workbench_item = MenuItem::with_id(
                    app,
                    "show_workbench",
                    "Show Workbench",
                    true,
                    None::<&str>,
                )?;
                let quit_item = MenuItem::with_id(
                    app,
                    "quit",
                    "Quit JFlow",
                    true,
                    None::<&str>,
                )?;
                let menu = MenuBuilder::new(app)
                    .item(&show_launcher_item)
                    .item(&show_workbench_item)
                    .separator()
                    .item(&quit_item)
                    .build()?;

                // Try the dedicated tray icon first; fall back to the
                // default window icon if it's missing.
                //
                // `default_window_icon()` borrows from `app`, so its
                // `.cloned()` image is `Image<'a>` for the lifetime of
                // `app`. We `.to_owned()` to promote it to `Image<'static>`
                // before assigning to `tray_icon`; otherwise the
                // `unwrap_or_else(placeholder_icon)` call would force the
                // compiler to bridge the two lifetimes and fail.
                let tray_icon: Image<'static> = {
                    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                        .join("icons")
                        .join("32x32.png");
                    let owned_default = || {
                        app.default_window_icon()
                            .cloned()
                            .map(|img| img.to_owned())
                    };
                    if path.exists() {
                        // `from_path` returns `Image<'_>` borrowing from
                        // `path`; convert to `'static` so the tray can
                        // outlive this scope.
                        Image::from_path(&path)
                            .map(|img| img.to_owned())
                            .unwrap_or_else(|_| {
                                owned_default().unwrap_or_else(placeholder_icon)
                            })
                    } else {
                        owned_default().unwrap_or_else(placeholder_icon)
                    }
                };

                let app_handle_for_menu = app.handle().clone();
                let _tray = TrayIconBuilder::with_id("jflow-tray")
                    .icon(tray_icon)
                    .icon_as_template(false)
                    .tooltip("JFlow")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(move |app, event| match event.id().as_ref() {
                        "show_launcher" => {
                            if let Some(window) = app.get_webview_window("launcher") {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = app.emit("global-shortcut", "tray");
                            }
                        }
                        "show_workbench" => {
                            if let Some(window) = app.get_webview_window("workbench") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {
                            let _ = app_handle_for_menu;
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("launcher") {
                                let visible = window.is_visible().unwrap_or(false);
                                let focused = window.is_focused().unwrap_or(false);
                                if visible && focused {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                    let _ = app.emit("global-shortcut", "tray");
                                }
                            }
                        }
                    })
                    .build(app)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::session::begin_session,
            commands::session::begin_swarm,
            commands::session::add_swarm_member,
            commands::session::resume_session,
            commands::session::send_message,
            commands::session::cancel,
            commands::session::send_soft_interrupt,
            commands::session::set_model,
            commands::session::set_memory_enabled,
            commands::memory::get_workspace_memory_preferences,
            commands::memory::set_workspace_memory_preference,
            commands::session::get_workspace_thread_history,
            commands::session::list_sessions,
            commands::session::delete_session,
            commands::session::delete_workspace_sessions,
            commands::session::send_stdin_response,
            commands::provider::get_models,
            commands::provider::get_provider_profiles,
            commands::provider::save_provider_api_key,
            commands::provider::start_provider_auth_flow,
            commands::provider::complete_provider_auth_flow,
            commands::session::clear_chat,
            commands::session::rewind_chat,
            commands::session::set_reasoning_effort,
            commands::session::compact_context,
            commands::session::rename_session,
            commands::system::get_version_info,
            commands::provider::get_auth_status,
            commands::provider::run_auth_doctor,
            commands::provider::get_usage_info,
            commands::provider::get_external_auth_candidates,
            commands::provider::approve_external_auth_candidate,
            commands::provider::check_cursor_auth_status,
            commands::provider::run_provider_doctor,
            commands::provider::test_provider_connection,
            commands::system::get_ambient_status,
            commands::system::get_ambient_transcripts,
            commands::provider::run_auth_test,
            commands::memory::get_memory_list,
            commands::memory::search_memories,
            commands::memory::get_memory_stats,
            commands::memory::get_memory_graph,
            commands::memory::export_memories,
            commands::memory::import_memories,
            commands::memory::clear_test_memories,
            commands::system::generate_pairing_code,
            commands::system::list_paired_devices,
            commands::system::revoke_device,
            commands::system::list_background_tasks,
            commands::system::cancel_background_task,
            commands::system::get_permission_requests,
            commands::system::respond_to_permission,
            commands::system::trigger_ambient,
            commands::system::stop_ambient,
            commands::provider::add_provider_profile,
            commands::system::get_browser_status,
            commands::system::setup_browser,
            commands::system::send_transcript,
            commands::system::run_dictation,
            commands::system::list_workspace_files,
            commands::tools::list_mcp_servers,
            commands::tools::save_mcp_server,
            commands::tools::delete_mcp_server,
            commands::tools::list_skills,
            commands::tools::save_skill,
            commands::tools::delete_skill,
            commands::tools::reload_skills,
            commands::system::git_status,
            commands::launcher::execute_shell_command,
            commands::system::save_session_state,
            commands::system::get_last_session_state,
            commands::system::clear_session_state,
            commands::swarm::server_connect,
            commands::swarm::server_is_connected,
            commands::swarm::comm_spawn,
            commands::swarm::comm_stop,
            commands::swarm::comm_list,
            commands::swarm::comm_status,
            commands::swarm::comm_assign_task,
            commands::swarm::comm_approve_plan,
            commands::swarm::comm_reject_plan,
            commands::swarm::comm_message,
            commands::swarm::comm_plan_status,
            commands::swarm::comm_list_channels,
            commands::swarm::comm_read_context,
            commands::launcher::search_applications,
            commands::launcher::refresh_applications,
            commands::launcher::launch_application,
            commands::launcher::quit_application,
            commands::launcher::open_pages_window,
            commands::launcher::hide_pages_window,
            commands::launcher::drag_window,
            commands::launcher::show_launcher,
            commands::launcher::hide_launcher,
            commands::launcher::show_workbench,
            commands::launcher::hide_workbench,
            commands::launcher::minimize_window,
            commands::launcher::toggle_maximize_window,
            commands::launcher::expand_to_workbench,
            commands::config::get_config_path,
            commands::config::get_config,
            commands::config::set_config_value
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// A 1×1 transparent RGBA image used as a last-ditch tray icon. We
/// would rather show a blank square than crash the app at startup.
fn placeholder_icon() -> Image<'static> {
    Image::new_owned(vec![0, 0, 0, 0], 1, 1)
}
