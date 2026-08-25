use std::fs::OpenOptions;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);

fn log_line(msg: &str) {
    let dir = dirs_next_log_dir();
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("nexo-desktop.log");
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "[{}] {}", chrono_like_now(), msg);
    }
}

fn dirs_next_log_dir() -> std::path::PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("Nexo")
}

fn chrono_like_now() -> String {
    // timestamp simples sem crate extra
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "?".into())
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.set_title("Nexo");
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    ALLOW_EXIT.store(true, Ordering::SeqCst);
    log_line("quit_app invoked");
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log_line("starting Nexo Desktop");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            log_line("second instance → focusing main window");
            show_main(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .invoke_handler(tauri::generate_handler![quit_app])
        .setup(|app| {
            // Sempre mostrar a janela ao abrir
            show_main(app.handle());
            log_line("main window shown");

            let show_i = MenuItem::with_id(app, "show", "Abrir Nexo", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Sair do Nexo", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Nexo")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        ALLOW_EXIT.store(true, Ordering::SeqCst);
                        log_line("tray quit");
                        app.exit(0);
                    }
                    "show" => show_main(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }

            match tray.build(app) {
                Ok(_) => log_line("tray ok"),
                Err(e) => log_line(&format!("tray failed (continuing): {e}")),
            }

            if let Some(window) = app.get_webview_window("main") {
                let window_ = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        // X → bandeja (só se não estiver saindo de verdade)
                        if !ALLOW_EXIT.load(Ordering::SeqCst) {
                            api.prevent_close();
                            let _ = window_.hide();
                            log_line("window hidden to tray");
                        }
                    }
                });
            }

            // Se abriu com --autostart, inicia minimizado na bandeja
            let autostart = std::env::args().any(|a| a == "--autostart");
            if autostart {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                    log_line("autostart → hidden to tray");
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            log_line(&format!("fatal: {e}"));
            #[cfg(windows)]
            {
                use std::os::windows::ffi::OsStrExt;
                let text: Vec<u16> = std::ffi::OsStr::new(&format!(
                    "O Nexo nao conseguiu iniciar.\n\n{e}\n\nVeja o log em:\n%LOCALAPPDATA%\\Nexo\\nexo-desktop.log"
                ))
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
                let title: Vec<u16> = std::ffi::OsStr::new("Nexo")
                    .encode_wide()
                    .chain(std::iter::once(0))
                    .collect();
                unsafe {
                    windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(
                        std::ptr::null_mut(),
                        text.as_ptr(),
                        title.as_ptr(),
                        0x10, // MB_ICONERROR
                    );
                }
            }
            std::process::exit(1);
        });
}
