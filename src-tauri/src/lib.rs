// DedTxt — Tauri main process.
//
// This is the Rust counterpart of the old Electron main.js. It owns:
//   * the editor window
//   * the system menu (with platform-correct accelerators)
//   * file I/O (open/save dialogs + reading/writing bytes)
//   * the title bar (filename + dirty bullet)
//   * file-open events from the OS (CLI argv, macOS "Open with", second instance)
//
// The renderer (src/) calls into these via the standard Tauri invoke()
// bridge, exposed to JS through src/platform/tauri.js.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Emitter, Manager, State, WindowEvent, Wry,
};
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct AppState {
    current_path: Mutex<Option<PathBuf>>,
    dirty: Mutex<bool>,
    bypass_close: Mutex<bool>,
    // Paths waiting to be opened once the frontend signals it's ready.
    // Populated by CLI argv at launch and by macOS RunEvent::Opened.
    pending: Mutex<Vec<PathBuf>>,
}

#[derive(Serialize)]
struct OpenResult {
    ok: bool,
    #[serde(rename = "filePath", skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    canceled: Option<bool>,
    #[serde(rename = "isBinary", skip_serializing_if = "Option::is_none")]
    is_binary: Option<bool>,
    #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
    mime_type: Option<&'static str>,
    #[serde(rename = "contentBase64", skip_serializing_if = "Option::is_none")]
    content_base64: Option<String>,
}

#[derive(Serialize)]
struct SaveResult {
    ok: bool,
    #[serde(rename = "filePath", skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    canceled: Option<bool>,
}

fn make_title(path: Option<&PathBuf>, dirty: bool) -> String {
    // No file open → bare "DedTxt". Only show a name (and dirty bullets) once
    // the user has actually opened or saved a file. The dirty marker flanks
    // the filename on both sides so the unsaved state survives heavy title
    // truncation by the OS window chrome.
    match path.and_then(|p| p.file_name()).map(|n| n.to_string_lossy().to_string()) {
        Some(name) => {
            if dirty {
                format!("• {name} • — DedTxt")
            } else {
                format!("{name} — DedTxt")
            }
        }
        None => "DedTxt".to_string(),
    }
}

fn refresh_title(app: &AppHandle) {
    let state = app.state::<AppState>();
    let path = state.current_path.lock().unwrap().clone();
    let dirty = *state.dirty.lock().unwrap();
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_title(&make_title(path.as_ref(), dirty));
    }
}

fn guess_mime(path: &PathBuf) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        _ => "", // empty = unknown, try as text
    }
}

const MAX_BINARY_PREVIEW: u64 = 25 * 1024 * 1024; // 25 MB

fn read_file(path: &PathBuf) -> Result<OpenResult, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let fp = Some(path.to_string_lossy().to_string());
    let mime = guess_mime(path);

    if !mime.is_empty() {
        // Known binary type — skip the text attempt entirely.
        let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
        if meta.len() > MAX_BINARY_PREVIEW {
            return Ok(OpenResult {
                ok: true,
                file_path: fp,
                content: None,
                error: None,
                canceled: None,
                is_binary: Some(true),
                mime_type: Some(mime),
                content_base64: None,
            });
        }
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        return Ok(OpenResult {
            ok: true,
            file_path: fp,
            content: None,
            error: None,
            canceled: None,
            is_binary: Some(true),
            mime_type: Some(mime),
            content_base64: Some(STANDARD.encode(&bytes)),
        });
    }

    // Unknown extension — try UTF-8 text first.
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(OpenResult {
            ok: true,
            file_path: fp,
            content: Some(content),
            error: None,
            canceled: None,
            is_binary: None,
            mime_type: None,
            content_base64: None,
        }),
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
            // Binary content with unrecognised extension.
            let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
            if meta.len() > MAX_BINARY_PREVIEW {
                return Ok(OpenResult {
                    ok: true,
                    file_path: fp,
                    content: None,
                    error: None,
                    canceled: None,
                    is_binary: Some(true),
                    mime_type: Some("application/octet-stream"),
                    content_base64: None,
                });
            }
            let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
            Ok(OpenResult {
                ok: true,
                file_path: fp,
                content: None,
                error: None,
                canceled: None,
                is_binary: Some(true),
                mime_type: Some("application/octet-stream"),
                content_base64: Some(STANDARD.encode(&bytes)),
            })
        }
        Err(e) => Err(e.to_string()),
    }
}

fn finalize_open(app: &AppHandle, path: PathBuf) -> OpenResult {
    match read_file(&path) {
        Ok(payload) => {
            let state = app.state::<AppState>();
            *state.current_path.lock().unwrap() = Some(path);
            *state.dirty.lock().unwrap() = false;
            refresh_title(app);
            payload
        }
        Err(e) => OpenResult {
            ok: false,
            file_path: Some(path.to_string_lossy().to_string()),
            content: None,
            error: Some(e),
            canceled: None,
            is_binary: None,
            mime_type: None,
            content_base64: None,
        },
    }
}

// --- Invoke commands ------------------------------------------------------

#[tauri::command]
fn open_file(app: AppHandle) -> Result<OpenResult, String> {
    let picked = app.dialog().file().blocking_pick_file();

    match picked {
        Some(fp) => {
            let path = fp.into_path().map_err(|e| e.to_string())?;
            Ok(finalize_open(&app, path))
        }
        None => Ok(OpenResult {
            ok: false,
            file_path: None,
            content: None,
            error: None,
            canceled: Some(true),
            is_binary: None,
            mime_type: None,
            content_base64: None,
        }),
    }
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<OpenResult, String> {
    Ok(finalize_open(&app, PathBuf::from(path)))
}

fn save_to(app: &AppHandle, target: PathBuf, content: String) -> SaveResult {
    match std::fs::write(&target, content) {
        Ok(()) => {
            let state = app.state::<AppState>();
            *state.current_path.lock().unwrap() = Some(target.clone());
            *state.dirty.lock().unwrap() = false;
            refresh_title(app);
            SaveResult {
                ok: true,
                file_path: Some(target.to_string_lossy().to_string()),
                error: None,
                canceled: None,
            }
        }
        Err(e) => SaveResult {
            ok: false,
            file_path: Some(target.to_string_lossy().to_string()),
            error: Some(e.to_string()),
            canceled: None,
        },
    }
}

fn prompt_save_path(app: &AppHandle, default_name: &str) -> Option<PathBuf> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .blocking_save_file();
    picked.and_then(|fp| fp.into_path().ok())
}

#[tauri::command]
fn save_file(app: AppHandle, content: String) -> Result<SaveResult, String> {
    let existing = app.state::<AppState>().current_path.lock().unwrap().clone();
    let target = match existing {
        Some(p) => p,
        None => match prompt_save_path(&app, "Untitled.txt") {
            Some(p) => p,
            None => {
                return Ok(SaveResult {
                    ok: false,
                    file_path: None,
                    error: None,
                    canceled: Some(true),
                })
            }
        },
    };
    Ok(save_to(&app, target, content))
}

#[tauri::command]
fn set_dirty(app: AppHandle, dirty: bool) {
    let state = app.state::<AppState>();
    *state.dirty.lock().unwrap() = dirty;
    refresh_title(&app);
}

#[tauri::command]
fn confirm_close(app: AppHandle) {
    let state = app.state::<AppState>();
    *state.bypass_close.lock().unwrap() = true;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.close();
    }
}

#[tauri::command]
fn drain_pending(state: State<'_, AppState>) -> Vec<String> {
    std::mem::take(&mut *state.pending.lock().unwrap())
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

// Reset for "New": drop the current path and clear the dirty flag. The
// renderer separately clears the textarea contents; this is just the
// native-side state that follows the file.
#[tauri::command]
fn reset_state(app: AppHandle, state: State<'_, AppState>) {
    *state.current_path.lock().unwrap() = None;
    *state.dirty.lock().unwrap() = false;
    refresh_title(&app);
}

// Politely ask the window to close. Falls through the normal CloseRequested
// handler so the unsaved-changes guard still runs (unlike confirm_close,
// which explicitly bypasses it after the renderer has saved).
#[tauri::command]
fn request_close(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.close();
    }
}

// --- Setup helpers --------------------------------------------------------

fn pick_file_from_argv(argv: &[String]) -> Option<PathBuf> {
    // argv[0] is the executable. Walk the rest; first non-flag that exists wins.
    for a in argv.iter().skip(1) {
        if a.is_empty() || a.starts_with('-') {
            continue;
        }
        let pb = PathBuf::from(a);
        if pb.exists() {
            return Some(pb);
        }
    }
    None
}

fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<Wry>> {
    let new_item = MenuItemBuilder::new("New")
        .id("new")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open_item = MenuItemBuilder::new("Open\u{2026}")
        .id("open")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let save_item = MenuItemBuilder::new("Save")
        .id("save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_item)
        .item(&open_item)
        .separator()
        .item(&save_item)
        .separator()
        .close_window()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View").fullscreen().build()?;

    let window_menu = SubmenuBuilder::new(app, "Window").minimize().build()?;

    // `mut` is needed only on macOS where the App menu is prepended below.
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut top = MenuBuilder::new(app);

    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, "DedTxt")
            .about(Some(AboutMetadata {
                name: Some("DedTxt".to_string()),
                ..Default::default()
            }))
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        top = top.item(&app_menu);
    }

    // Reference AboutMetadata on non-mac too to avoid unused-import warnings.
    #[cfg(not(target_os = "macos"))]
    let _ = AboutMetadata::default();

    top.item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()
}

// --- Entry point ----------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::default();

    // Seed any CLI-passed file path into the pending queue. The frontend will
    // drain this on startup via the drain_pending command.
    if let Some(p) = pick_file_from_argv(&std::env::args().collect::<Vec<_>>()) {
        state.pending.lock().unwrap().push(p);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Bring the existing window forward...
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
            // ...and forward any file path that came in.
            if let Some(p) = pick_file_from_argv(&argv) {
                let _ = app.emit("dt://open-path", p.to_string_lossy().to_string());
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            open_file,
            open_path,
            save_file,
            set_dirty,
            confirm_close,
            drain_pending,
            reset_state,
            request_close
        ])
        .setup(|app| {
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;

            // Forward menu clicks to the frontend so renderer.js can react.
            let handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                let id = event.id().as_ref().to_string();
                let name = match id.as_str() {
                    "new" => Some("dt://menu-new"),
                    "open" => Some("dt://menu-open"),
                    "save" => Some("dt://menu-save"),
                    _ => None,
                };
                if let Some(n) = name {
                    let _ = handle.emit(n, ());
                }
            });

            // Intercept window close to confirm unsaved changes via the renderer.
            if let Some(win) = app.get_webview_window("main") {
                let h = app.handle().clone();
                win.clone().on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        let state = h.state::<AppState>();
                        let bypass = *state.bypass_close.lock().unwrap();
                        let dirty = *state.dirty.lock().unwrap();
                        if bypass || !dirty {
                            return;
                        }
                        api.prevent_close();
                        let _ = h.emit("dt://save-and-close", ());
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS-specific: "Open With … DedTxt" from Finder. Fires both at
            // launch (before window exists) and while the app is already running.
            #[cfg(target_os = "macos")]
            if let RunEvent::Opened { urls } = &event {
                let state = app.state::<AppState>();
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        // Buffer for the frontend to drain on init...
                        state.pending.lock().unwrap().push(path.clone());
                        // ...and also emit live in case it's already running.
                        let _ = app.emit("dt://open-path", path.to_string_lossy().to_string());
                    }
                }
            }

            // Silence unused-variable warnings on non-mac builds.
            let _ = (app, event);
        });
}

// --- Tests ----------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn make_title_no_file_clean() {
        assert_eq!(make_title(None, false), "DedTxt");
    }

    #[test]
    fn make_title_no_file_dirty() {
        // No name → no bullet either; the bullet only makes sense relative
        // to a named file. User asked for "nothing but DedTxt" when no file
        // is open.
        assert_eq!(make_title(None, true), "DedTxt");
    }

    #[test]
    fn make_title_with_path_clean() {
        let pb = PathBuf::from("/tmp/example.txt");
        assert_eq!(make_title(Some(&pb), false), "example.txt — DedTxt");
    }

    #[test]
    fn make_title_with_path_dirty() {
        let pb = PathBuf::from("/tmp/example.txt");
        assert_eq!(make_title(Some(&pb), true), "• example.txt • — DedTxt");
    }

    #[test]
    fn pick_file_from_argv_returns_none_for_only_exe() {
        let argv: Vec<String> = vec!["dedtxt".to_string()];
        assert_eq!(pick_file_from_argv(&argv), None);
    }

    #[test]
    fn pick_file_from_argv_skips_flags() {
        let argv: Vec<String> = vec![
            "dedtxt".to_string(),
            "--verbose".to_string(),
            "-x".to_string(),
        ];
        assert_eq!(pick_file_from_argv(&argv), None);
    }

    #[test]
    fn pick_file_from_argv_returns_none_for_nonexistent_path() {
        let argv: Vec<String> = vec![
            "dedtxt".to_string(),
            "/this/path/does/not/exist/anywhere_xyz_42.txt".to_string(),
        ];
        assert_eq!(pick_file_from_argv(&argv), None);
    }

    #[test]
    fn pick_file_from_argv_finds_existing_path() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!(
            "dedtxt_test_{}_{}.txt",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::write(&path, b"hello").expect("write tempfile");

        let argv: Vec<String> = vec![
            "dedtxt".to_string(),
            path.to_string_lossy().to_string(),
        ];
        let picked = pick_file_from_argv(&argv);
        assert_eq!(picked, Some(path.clone()));

        let _ = std::fs::remove_file(&path);
    }
}
