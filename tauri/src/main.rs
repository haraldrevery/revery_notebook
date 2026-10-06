// tauri/src/main.rs — Revery Notebook Tauri v2 Backend
//
// Exposes Rust commands that back the window.NativeAPI.tauriImpl in
// native_api.js. Commands are registered with tauri::generate_handler![]
// and invoked from the frontend via window.__TAURI__.core.invoke().
//
// Security:
//   - All file paths are canonicalized and validated before use
//   - File size is capped at 20 MB on read
//   - Path traversal attacks are blocked by scope checks
//   - Volatile writes go to the OS temp directory only
//
// Dependencies (Cargo.toml):
//   tauri        = { version = "2", features = ["macos-private-api"] }
//   tauri-plugin-dialog = "2"
//   serde        = { version = "1", features = ["derive"] }
//   serde_json   = "1"
//   tokio        = { version = "1", features = ["full"] }
//   notify       = "6"
//   once_cell    = "1"
//   base64       = "0.21"

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, State,
};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};


/* ══════════════════════════════════════════════════════════════════════════
   SHARED STATE
══════════════════════════════════════════════════════════════════════════ */


const WATCH_DEBOUNCE_MS: u64 = 300;

struct WatchDebounce {
    /// None = idle. Some(t) = a burst is pending; emit once now >= t.
    deadline: std::sync::Mutex<Option<std::time::Instant>>,
    /// Cleared on unwatch/re-watch so a pending emit can never fire for a
    /// watcher that no longer exists.
    alive: std::sync::atomic::AtomicBool,
}

/// Registry of active file watchers. Maps absolute path → entry.
/// Keeping the watcher handle alive keeps the watcher running.
struct WatchEntry {
    _watcher: RecommendedWatcher,
    debounce: std::sync::Arc<WatchDebounce>,
}

struct WatcherState {
    watchers: Mutex<HashMap<String, WatchEntry>>,
}

static VOLATILE_LOCK: Mutex<()> = Mutex::new(());

/* ══════════════════════════════════════════════════════════════════════════
   VOLATILE DIRECTORY — preparation chokepoint
   ══════════════════════════════════════════════════════════════════════════
   The volatile dir lives in /tmp on Unix — a shared namespace where another
   local user, or a hostile script, could pre-plant a symlink or a directory
   they own. Every volatile read/write/delete MUST go through the path that
   prepare_volatile_dir() verifies and returns. Direct calls to
   std::env::temp_dir().join("revery-volatile") from a #[tauri::command]
   handler are a regression — see audit Cluster C #3.

   The verification runs exactly once per process. Subsequent calls return
   the cached Result. We deliberately cache the failure outcome too: if the
   dir was unsafe at startup, retrying mid-session won't make it safe.
   ══════════════════════════════════════════════════════════════════════════ */
static VOLATILE_DIR_STATE: std::sync::OnceLock<Result<std::path::PathBuf, String>>
    = std::sync::OnceLock::new();

/// Returns the verified volatile directory, or an error explaining why it
/// can't be used. Errors are stable across the process lifetime.
fn prepare_volatile_dir() -> Result<&'static std::path::PathBuf, &'static str> {
    let result = VOLATILE_DIR_STATE.get_or_init(|| {
        let dir = std::env::temp_dir().join("revery-volatile");

        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            use std::os::unix::fs::MetadataExt;
            use std::os::unix::fs::PermissionsExt;

            // Step 1: Create with restrictive perms. recursive(true) is
            // idempotent — succeeds if the dir already exists, but does NOT
            // change perms in that case. We re-tighten in step 4.
            if let Err(e) = std::fs::DirBuilder::new()
                .recursive(true)
                .mode(0o700)
                .create(&dir)
            {
                return Err(format!("Cannot create volatile dir: {e}"));
            }

            // Step 2: lstat (NOT stat) so a pre-planted symlink can't fool
            // us by resolving to a directory we don't actually own.
            let st = match std::fs::symlink_metadata(&dir) {
                Ok(m)  => m,
                Err(e) => return Err(format!("Cannot stat volatile dir: {e}")),
            };

            if st.file_type().is_symlink() {
                return Err(format!(
                    "Volatile path is a symlink — refusing to follow: {}",
                    dir.display()
                ));
            }
            if !st.is_dir() {
                return Err(format!(
                    "Volatile path exists but is not a directory: {}",
                    dir.display()
                ));
            }

            // Step 3: Owner check. If another local user owns this directory,
            // refuse — writing user notes there would expose them.
            let our_uid = nix_uid();
            if st.uid() != our_uid {
                return Err(format!(
                    "Volatile dir is owned by uid={}, not the current user (uid={}). \
                     Refusing to use.",
                    st.uid(), our_uid
                ));
            }

            // Step 4: Permissions must be exactly 0o700. If they aren't,
            // tighten — chmod will succeed because step 3 confirmed we own it.
            if (st.mode() & 0o777) != 0o700 {
                if let Err(e) = std::fs::set_permissions(
                    &dir,
                    std::fs::Permissions::from_mode(0o700),
                ) {
                    return Err(format!(
                        "Volatile dir has unsafe permissions (mode={:o}) and could not be \
                         tightened: {e}",
                        st.mode() & 0o777
                    ));
                }
            }
        }

        #[cfg(not(unix))]
        {
            // Windows: no Unix mode bits, no real "owner" concept for the user
            // temp dir. Rely on the OS user-profile temp dir's default ACLs.
            if let Err(e) = std::fs::create_dir_all(&dir) {
                return Err(format!("Cannot create volatile dir: {e}"));
            }
            // Confirm it's a directory and not, say, a junction to elsewhere.
            match std::fs::metadata(&dir) {
                Ok(m) if m.is_dir() => {}
                Ok(_)  => return Err(format!(
                    "Volatile path exists but is not a directory: {}", dir.display()
                )),
                Err(e) => return Err(format!("Cannot stat volatile dir: {e}")),
            }
        }

        Ok(dir)
    });

    result.as_ref().map_err(|s| s.as_str())
}

/// Helper: return the current process's effective UID via libc. We avoid
/// adding the `nix` crate; the libc call is FFI but trivially safe — it
/// takes no args and returns a u32-equivalent that cannot fail.
#[cfg(unix)]
fn nix_uid() -> u32 {
    // SAFETY: getuid() is a thread-safe libc function with no preconditions
    // and no out-params. It cannot fail.
    unsafe { libc::geteuid() }
}

/* ══════════════════════════════════════════════════════════════════════════
   DURABLE (REBOOT-SAFE) BACKUP DIRECTORY
   ══════════════════════════════════════════════════════════════════════════
   The volatile dir above lives in the OS temp dir — RAM-backed tmpfs on
   modern Linux, which keeps the high-frequency crash backup wear-free but
   means it does NOT survive a reboot. The rare autosave-suspended states
   (external-change conflict hold, save-failure cooldown) additionally
   snapshot to this directory under the app data dir: real disk, written at
   a throttled cadence by the renderer. Unlike /tmp this is not a shared
   namespace, so the ownership/symlink ceremony above is unnecessary —
   create-with-tight-perms is enough. Same once-per-process caching.      */
static DURABLE_DIR_STATE: std::sync::OnceLock<Result<std::path::PathBuf, String>>
    = std::sync::OnceLock::new();

fn prepare_durable_dir(app: &AppHandle) -> Result<&'static std::path::PathBuf, &'static str> {
    let result = DURABLE_DIR_STATE.get_or_init(|| {
        let base = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
        let dir = base.join("crash-backups");
        fs::create_dir_all(&dir).map_err(|e| format!("Cannot create durable backup dir: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
        }
        Ok(dir)
    });
    result.as_ref().map_err(|s| s.as_str())
}

/* ── Backup primitives, parameterized by directory ──────────────────────
   Both the volatile (temp) and durable (app data) locations use the SAME
   on-disk format: <fnv1a(path)>.revery_volatile + <key>.meta.json
   { originalPath, ts, base? }. Keep the key and file naming stable —
   existing users' backups must remain readable across updates. `base`
   (optional): the fingerprint of the disk version the text was edited
   from; start-up recovery compares it with the file to tell unsaved edits
   from a file that was changed since (src/sidebar/fingerprint.js). Older
   backups have none. MIRROR of setVolatileContent / getVolatileContent in
   electron/fs_core.js. Callers hold VOLATILE_LOCK.                       */

/// A base is a short string the renderer computed; anything else is
/// dropped (the backup then counts as one without a base).
fn valid_backup_base(base: Option<&str>) -> Option<&str> {
    base.filter(|b| !b.is_empty() && b.len() <= 200)
}

fn backup_key(path: &str) -> String {
    // Deterministic FNV-1a hash of the original path.
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in path.bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}

fn write_backup_to(dir: &Path, path: &str, content: &str, base: Option<&str>) -> Result<(), String> {
    let key = backup_key(path);
    let data_file = dir.join(format!("{key}.revery_volatile"));
    let meta_file = dir.join(format!("{key}.meta.json"));

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    // Data first (see fs_core.js): a crash between the two writes can only
    // pair the new text with an OLDER base — recovery then defaults to
    // keeping both, never to restoring over a changed file.
    let data_tmp = dir.join(format!("{key}.{now}.revery_volatile.tmp"));
    atomic_write_file(&data_tmp, &data_file, content.as_bytes())?;

    let mut meta = serde_json::json!({
        "originalPath": path,
        "ts": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0u64),
    });
    if let Some(b) = valid_backup_base(base) {
        meta["base"] = serde_json::Value::String(b.to_string());
    }
    let meta_tmp = dir.join(format!("{key}.{now}.meta.json.tmp"));
    atomic_write_file(&meta_tmp, &meta_file, meta.to_string().as_bytes())
}

/// Returns (content, ts, base) for the backup of `path` in `dir`, if present.
fn read_backup_from(dir: &Path, path: &str) -> Option<(String, u64, Option<String>)> {
    let key = backup_key(path);
    let data_file = dir.join(format!("{key}.revery_volatile"));
    let meta_file = dir.join(format!("{key}.meta.json"));

    let content = fs::read_to_string(&data_file).ok()?;
    let meta: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&meta_file).ok()?).ok()?;
    let ts = meta["ts"].as_u64().unwrap_or(0);
    let base = valid_backup_base(meta["base"].as_str()).map(str::to_string);
    Some((content, ts, base))
}

fn delete_backup_from(dir: &Path, path: &str) {
    let key = backup_key(path);
    let _ = fs::remove_file(dir.join(format!("{key}.revery_volatile")));
    let _ = fs::remove_file(dir.join(format!("{key}.meta.json")));
}

fn list_backups_from(dir: &Path, prefix: &str) -> Vec<VolatileBackupInfo> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<VolatileBackupInfo> = Vec::new();
    for entry in entries.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".meta.json") {
            continue;
        }
        let meta: serde_json::Value = match fs::read_to_string(entry.path())
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
        {
            Some(v) => v,
            None => continue, // unreadable meta — skip, never guess
        };
        if let Some(op) = meta["originalPath"].as_str() {
            if op.starts_with(prefix) {
                out.push(VolatileBackupInfo {
                    original_path: op.to_string(),
                    ts: meta["ts"].as_u64().unwrap_or(0),
                });
            }
        }
    }
    out
}

/// Every backup location that passed its safety check, volatile first.
fn backup_dirs(app: &AppHandle) -> Vec<&'static std::path::PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(d) = prepare_volatile_dir() {
        dirs.push(d);
    }
    if let Ok(d) = prepare_durable_dir(app) {
        dirs.push(d);
    }
    dirs
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

/// Signals the main close handler that the frontend has approved the close.
struct CloseAllowed(Mutex<bool>);

/// Close watchdog state (see arm_close_watchdog): the generation of the
/// latest close request, the latest generation the page acknowledged, and
/// whether a watchdog question is on screen (one at a time).
#[derive(Default)]
struct CloseWatch {
    requested:   std::sync::atomic::AtomicU64,
    acked:       std::sync::atomic::AtomicU64,
    dialog_open: std::sync::atomic::AtomicBool,
}
/// The active project root. Set only by set_root_path (open_folder_dialog
/// merely authorizes a folder) and by a Save As that opts into a new root.
/// All FS commands enforce that paths stay inside this root.
struct RootPath(Mutex<Option<String>>);
/// Serializes access to the revery_settings.json file to prevent data loss.


/* ══════════════════════════════════════════════════════════════════════════
   DATA TRANSFER TYPES
══════════════════════════════════════════════════════════════════════════ */

#[derive(Serialize)]
struct DirEntry {
    name: String,
    path: String,
    #[serde(rename = "type")]
    entry_type: String, // "file" | "dir"
    /// A symbolic link (or junction), listed as "file" so it is never walked
    /// into; moving or deleting it acts on the link itself.
    link: bool,
    mtime: f64,         // ms since epoch (modification time)
    ctime: f64,         // ms since epoch (creation/birth time; falls back to mtime on Linux)
}

#[derive(Serialize, Deserialize)]
struct MessageBoxOptions {
    #[serde(rename = "type", default)]
    dialog_type: String,
    #[serde(default)]
    buttons: Vec<String>,
    #[serde(default)]
    title: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    detail: String,
    #[serde(rename = "defaultId", default)]
    default_id: Option<usize>,
}

#[derive(Serialize)]
struct MessageBoxResult {
    response: usize,
}
#[derive(Serialize)]
struct SaveFileResult {
    saved: bool,
    #[serde(rename = "filePath", skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    #[serde(rename = "newRootPath", skip_serializing_if = "Option::is_none")]
    new_root_path: Option<String>,
}

/* ══════════════════════════════════════════════════════════════════
   PATH UTILITIES
══════════════════════════════════════════════════════════════════════════ */

/// Resolves and validates a path.  Returns an error string on failure so
/// Tauri can propagate it to the frontend as a rejected invoke promise.
fn safe_path(raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() {
        return Err("Path must not be empty".into());
    }
    if raw.contains('\0') {
        return Err("Path contains null byte".into());
    }
    // We resolve without requiring the path to exist (for creates)
    Ok(PathBuf::from(raw))
}

/// Like safe_path but also enforces that the resolved path stays inside root.
fn safe_path_inside(raw: &str, root: &Path) -> Result<PathBuf, String> {
    let p = safe_path(raw)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve root: {e}"))?;

    let check = if p.exists() {
        // Existing path: full canonicalize (resolves symlinks, normalises '..')
        p.canonicalize()
            .map_err(|e| format!("Cannot resolve path: {e}"))?
    } else {
        // New path (may not exist yet, including multi-level new directories).
        // Walk up the ancestry to find the deepest existing ancestor, canonicalize
        // that real anchor, then re-attach the non-existing tail components.
        // This preserves symlink-escape protection while avoiding the ENOENT that
        // canonicalize() returns when the parent itself doesn't exist yet.
        let mut existing = p.clone();
        let mut tail: Vec<std::ffi::OsString> = Vec::new();
        loop {
            if existing.exists() {
                break;
            }
            let name = existing
                .file_name()
                .ok_or_else(|| format!("Cannot resolve ancestor of: {}", p.display()))?
                .to_owned();
            tail.push(name);
            existing = existing
                .parent()
                .ok_or_else(|| format!("Path has no resolvable ancestor: {}", p.display()))?
                .to_path_buf();
        }
        let mut resolved = existing
            .canonicalize()
            .map_err(|e| format!("Cannot resolve ancestor: {e}"))?;
        // Re-attach tail in original top-down order (it was built bottom-up)
        for component in tail.into_iter().rev() {
            resolved.push(component);
        }
        resolved
    };

    if !check.starts_with(&canonical_root) {
        return Err(format!("Path escapes project root: {}", check.display()));
    }
    Ok(check)
}

/* ══════════════════════════════════════════════════════════════════════════
   PATHS HANDED TO THE FRONTEND
   The renderer does its path math on '/'-joined strings (relative links,
   root containment, tree state). Every path that crosses the command
   boundary must therefore be an ORDINARY OS path. On Windows, std's
   canonicalize() returns verbatim paths (`\\?\C:\...`, `\\?\UNC\srv\...`);
   under verbatim rules '/' is not a separator, and a `//?/` prefix defeats
   every prefix comparison in the renderer (a dropped image's link became a
   chain of `../` plus the absolute path and never rendered).
   strip_verbatim_prefix is the pure rule (unit-tested on every OS; mirrors
   the `dunce` crate: only prefixes whose remainder is a valid plain path
   are removed, `\\?\Volume{..}` stays). frontend_path applies it where such
   prefixes can arise and is the ONLY way a command may return a path.
══════════════════════════════════════════════════════════════════════════ */
fn strip_verbatim_prefix(p: &str) -> String {
    if let Some(rest) = p.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = p.strip_prefix(r"\\?\") {
        let bytes = rest.as_bytes();
        let is_drive = bytes.len() >= 2
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes.len() == 2 || bytes[2] == b'\\');
        if is_drive {
            return rest.to_string();
        }
    }
    p.to_string()
}

fn frontend_path(p: &Path) -> String {
    let s = p.to_string_lossy().into_owned();
    if cfg!(target_os = "windows") { strip_verbatim_prefix(&s) } else { s }
}

/* ── Native dialogs are attached to the main window ─────────────────────
   Without a parent the pickers and message boxes were free-floating: the
   user could keep typing in the editor underneath. Save As then wrote the
   text as it was when the dialog opened (edits made meanwhile were marked
   saved), and the folder picker dropped them. With the main window as
   parent they are modal, like Electron's (which always passes the window).
   Falls back to a parentless dialog if the main window is gone. */
fn file_dialog_for(app: &AppHandle) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    use tauri_plugin_dialog::DialogExt;
    let builder = app.dialog().file();
    match app.get_webview_window("main") {
        Some(w) => builder.set_parent(&w),
        None => builder,
    }
}

fn message_dialog_for(
    app: &AppHandle,
    message: impl Into<String>,
) -> tauri_plugin_dialog::MessageDialogBuilder<tauri::Wry> {
    use tauri_plugin_dialog::DialogExt;
    let builder = app.dialog().message(message);
    match app.get_webview_window("main") {
        Some(w) => builder.parent(&w),
        None => builder,
    }
}

fn get_root(root_state: &State<'_, RootPath>) -> Result<std::path::PathBuf, String> {
    let guard = root_state.0.lock().unwrap_or_else(|p| p.into_inner());
    match guard.as_ref() {
        Some(p) => Ok(std::path::PathBuf::from(p)),
        None => Err("No project folder is open. Please open a folder first.".into()),
    }
}

/* ══════════════════════════════════════════════════════════════════════════
   NAVIGATION POLICY
   The app must never open links or act as a browser (CLAUDE.md "Must fix").
   The preview's click guard blocks link clicks in the renderer; this
   allowlist is the platform-level backstop for every other navigation
   vector (dropped URLs, location assignment, window.open). Only the app's
   own origins may load in the webview:
     tauri://localhost            production on Linux/macOS
     http(s)://tauri.localhost    production on Windows (WebView2)
     http://localhost:1420        the devUrl from tauri.conf.json
     about:blank                  transient WebView2 init navigation
══════════════════════════════════════════════════════════════════════════ */
fn is_allowed_navigation(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => match url.host_str() {
            Some("tauri.localhost") => true,
            Some("localhost") => url.port() == Some(1420),
            _ => false,
        },
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}



/* ══════════════════════════════════════════════════════════════════════════
   TAURI COMMANDS  (invoked from frontend via window.__TAURI__.core.invoke)
══════════════════════════════════════════════════════════════════════════ */



/// keep async
/// Prompt the user to select a folder.  Returns the chosen path or null.
/// The folder is AUTHORIZED (trusted root) but not yet the project root:
/// the renderer first saves the note that is open in the current project,
/// then switches with set_root_path. Switching here made that save fail
/// ("escapes project root") for edits that arrived while the dialog was
/// open. Mirrors dialog:open-folder (Electron).
#[tauri::command]
async fn open_folder_dialog(
    app: AppHandle,
    lock: State<'_, SettingsLock>,
) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    file_dialog_for(&app)
        .set_title("Open Project Folder")
        .pick_folder(move |p| { let _ = tx.send(p); });
    let result = rx.await.unwrap_or(None);
    let chosen = result.map(|p| {
        use tauri_plugin_dialog::FilePath;
        match p {
            FilePath::Path(pb) => pb.to_string_lossy().into_owned(),
            FilePath::Url(u)   => u.to_string(),
        }
    });


    if let Some(ref path) = chosen {
        if let Ok(canonical) = std::path::PathBuf::from(path).canonicalize() {
            let _ = app.asset_protocol_scope().allow_directory(&canonical, true);

            // Register this path as a backend-verified trusted root through
            // the settings chokepoint. The chokepoint:
            //   - acquires SettingsLock internally (do NOT pre-acquire it here)
            //   - recovers transparently from .bak on corruption
            //   - refreshes .bak after a successful write
            let new_trust = path.clone();
            let _ = update_settings(&app, &lock.0, move |settings| {
                let mut trusted = settings["trustedRoots"]
                    .as_array().cloned().unwrap_or_default();
                let path_val = serde_json::Value::String(new_trust);
                if trusted.contains(&path_val) {
                    return false;
                }
                trusted.push(path_val);
                if let Some(obj) = settings.as_object_mut() {
                    obj.insert(
                        "trustedRoots".to_string(),
                        serde_json::Value::Array(trusted),
                    );
                }
                true
            });
        }
    }
    Ok(chosen)
}



#[tauri::command]
 fn set_root_path(
    app: AppHandle,
    path: String,
    root_state: State<'_, RootPath>,
    lock: State<'_, SettingsLock>,
) -> Result<String, String> {
    let p = safe_path(&path)?;
    let canonical = p.canonicalize()
        .map_err(|e| format!("Cannot resolve root path: {e}"))?;
    if !canonical.is_dir() {
        return Err(format!("Not a directory: {}", canonical.display()));
    }

    // Security check: Only grant asset protocol scope if the path was previously verified 
    // by the backend natively. The frontend CANNOT modify the trustedRoots array.
let settings = read_settings(&app, &lock.0)?;
let is_trusted = settings["trustedRoots"]
    .as_array()
    .map(|arr| arr.iter().any(|item| {
        item.as_str()
            .and_then(|s| std::path::PathBuf::from(s).canonicalize().ok())
            .map(|c| c == canonical)
            .unwrap_or(false)
    }))
    .unwrap_or(false);

    if !is_trusted {
        // Mirrors the Electron handler at main.js:430. A renderer that has
        // been hijacked (or a user-edited settings file) must not be able
        // to point the project root at arbitrary disk locations.
        return Err(
            "Security Error: This folder has not been authorized by the user.".into()
        );
    }

    let _ = app.asset_protocol_scope().allow_directory(&canonical, true);
    *root_state.0.lock().unwrap_or_else(|p| p.into_inner()) = Some(canonical.to_string_lossy().into_owned());
    // The renderer adopts this CANONICAL spelling as its project root: every
    // entry read_directory returns is spelled that way, and a root opened
    // through a symlink, junction or mapped drive spelled differently made
    // its "same folder?" checks fail (a file dropped into its own folder
    // was renamed to name_2). Mirrors fs:set-root-path (Electron).
    Ok(frontend_path(&canonical))
}


/* ── Off the UI thread ───────────────────────────────────────────────────
   Non-async Tauri commands run on the MAIN thread, which also drives the
   webview: slow disk work there freezes the whole window (on a slow disk,
   Windows may even offer to kill the "not responding" app). Every command
   that reads or writes file content, lists folders, copies up to 20 MB or
   fsyncs therefore runs on the blocking pool. The settings commands stay
   synchronous ON PURPOSE: they run in the order the renderer sends them,
   and several of those calls are fire-and-forget — as async tasks they
   could complete out of order and leave a stale value behind. */

/// List the direct children of a directory.
#[tauri::command]
async fn read_directory(
    path: String,
    root_state: State<'_, RootPath>,
) -> Result<Vec<DirEntry>, String> {
    let root = get_root(&root_state)?;
    tokio::task::spawn_blocking(move || read_directory_blocking(path, root))
        .await
        .map_err(|e| format!("Background listing task failed: {e}"))?
}

fn read_directory_blocking(path: String, root: PathBuf) -> Result<Vec<DirEntry>, String> {
    let dir = safe_path_inside(&path, &root)?;
    let read = fs::read_dir(&dir)
        .map_err(|e| format!("Cannot read directory: {e}"))?;

    let mut entries: Vec<DirEntry> = read
        .filter_map(|e| e.ok())
        .map(|e| {
            let file_type = e.file_type().ok();
            let is_dir    = file_type.map_or(false, |t| t.is_dir());
            let is_link   = file_type.map_or(false, |t| t.is_symlink());

            /* Fetch timestamps — failures produce 0 (graceful degradation) */
            let meta  = e.metadata().ok();
            let mtime = meta.as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64() * 1000.0)
                .unwrap_or(0.0);
            /* birthtime is unavailable on Linux; fall back to mtime */
            let ctime = meta.as_ref()
                .and_then(|m| m.created().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64() * 1000.0)
                .unwrap_or(mtime);

            DirEntry {
                name: e.file_name().to_string_lossy().into_owned(),
                // read_dir on a canonicalized directory yields canonical entry
                // paths — on Windows \\?\-prefixed. See frontend_path.
                path: frontend_path(&e.path()),
                entry_type: if is_dir { "dir".into() } else { "file".into() },
                link: is_link,
                mtime,
                ctime,
            }
        })
        .collect();

    // Directories first, then alphabetical
    entries.sort_by(|a, b| {
        let type_ord = b.entry_type.cmp(&a.entry_type); // "file" < "dir" reversed
        if type_ord != std::cmp::Ordering::Equal {
            type_ord
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(entries)
}







/// Refusal message for files that are not valid UTF-8. Must stay identical
/// to NOT_UTF8_MESSAGE in electron/fs_core.js — the renderer sees the same
/// text from both backends.
const NOT_UTF8_MESSAGE: &str = "Read failed: this file is not valid UTF-8 text \
     (it may use another encoding). It was not opened, so it has not been changed.";

/// Strict UTF-8 read. read_to_string already refuses invalid UTF-8 (never
/// decodes lossily, so a legacy-encoded file can't be damaged by a later
/// save); this only gives that refusal the shared, readable message. A
/// leading BOM is kept as U+FEFF, so BOM files are written back unchanged.
fn read_text_strict(p: &Path) -> Result<String, String> {
    fs::read_to_string(p).map_err(|e| {
        if e.kind() == std::io::ErrorKind::InvalidData {
            NOT_UTF8_MESSAGE.to_string()
        } else {
            format!("Read failed: {e}")
        }
    })
}

/// Read a text file (max 20 MB). Runs on the blocking pool (see "Off the
/// UI thread").
#[tauri::command]
async fn read_file(path: String, root_state: State<'_, RootPath>) -> Result<String, String> {
    let root = get_root(&root_state)?;
    tokio::task::spawn_blocking(move || {
        let p = safe_path_inside(&path, &root)?;
        let meta = fs::metadata(&p).map_err(|e| format!("Cannot stat file: {e}"))?;
        if meta.len() > 20 * 1024 * 1024 {
            return Err(format!(
                "File too large ({:.1} MB). Maximum is 20 MB.",
                meta.len() as f64 / 1_048_576.0
            ));
        }
        read_text_strict(&p)
    })
    .await
    .map_err(|e| format!("Background read task failed: {e}"))?
}

/// Atomic settings write: write to a sibling tmp file then rename.
/// Settings always live in app_config_dir on the same filesystem,
/// so EXDEV cannot happen and we don't need the copy fallback.
/// Crash between the write and rename leaves the *previous* settings
/// intact rather than producing a 0-byte file.
fn atomic_write_settings(dest: &Path, content: &[u8]) -> Result<(), String> {
    let tmp_name = format!(
        "{}.{}.revery_settings_tmp",
        dest.file_name().unwrap_or_default().to_string_lossy(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let tmp = dest.with_file_name(tmp_name);


    {
        let mut f = fs::File::create(&tmp)
            .map_err(|e| format!("Cannot create settings temp: {e}"))?;
        f.write_all(content)
            .map_err(|e| { let _ = fs::remove_file(&tmp); format!("Settings write failed: {e}") })?;
        f.flush()
            .map_err(|e| { let _ = fs::remove_file(&tmp); format!("Settings flush failed: {e}") })?;
        // Flush kernel buffers to physical disk before the rename.
        // Without this, power loss between write and rename can produce a
        // renamed-but-empty revery_settings.json. Mirrors atomic_write_file().
        f.sync_data()
            .map_err(|e| { let _ = fs::remove_file(&tmp); format!("Settings sync failed: {e}") })?;
    }

    fs::rename(&tmp, dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Settings rename failed: {e}")
    })?;

    sync_parent_dir(dest);
    Ok(())
}

/* ── Settings backup / corruption recovery ─────────────────────────────
   Mirrors the JS helpers in electron/main.js. Single source of truth
   for "how do I read/write revery_settings.json without losing data
   when the file is corrupt".

   - read_settings_raw     : classify main file (absent | ok | corrupt)
   - try_load_settings_bak : read+parse the .bak sibling, or None
   - quarantine_corrupt_settings : rename corrupt main → corrupt-<ts>.json
   - refresh_settings_bak  : atomically replace .bak with given bytes
   - load_settings_for_read  : caller wants to read; recover silently from .bak
   - load_settings_for_write : caller is about to merge+write; recover from
       .bak (preferred) or quarantine + start fresh.
   All callers MUST hold SettingsLock for the duration. ── */

enum SettingsState {
    Absent,
    Ok(serde_json::Value),
    Corrupt,
}

fn settings_bak_path(config_path: &Path) -> PathBuf {
    let mut s = config_path.as_os_str().to_owned();
    s.push(".bak");
    PathBuf::from(s)
}

fn read_settings_raw(config_path: &Path) -> SettingsState {
    if !config_path.exists() {
        return SettingsState::Absent;
    }
    let raw = match fs::read_to_string(config_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[revery] Could not read settings file: {e}");
            return SettingsState::Corrupt;
        }
    };
    if raw.is_empty() {
        return SettingsState::Corrupt;
    }
    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(v) if v.is_object() => SettingsState::Ok(v),
        _ => SettingsState::Corrupt,
    }
}

fn try_load_settings_bak(config_path: &Path) -> Option<serde_json::Value> {
    let bak = settings_bak_path(config_path);
    let raw = fs::read_to_string(&bak).ok()?;
    if raw.is_empty() {
        return None;
    }
    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(v) if v.is_object() => Some(v),
        _ => None,
    }
}

/// Rename a corrupt main settings file out of the way. Best-effort: errors logged, not propagated.
fn quarantine_corrupt_settings(config_path: &Path) {
    if !config_path.exists() {
        return;
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let parent = match config_path.parent() {
        Some(p) => p,
        None => return,
    };
    let quarantine = parent.join(format!("revery_settings.corrupt-{ts}.json"));
    match fs::rename(config_path, &quarantine) {
        Ok(_) => eprintln!(
            "[revery] Quarantined corrupt settings → {}",
            quarantine.display()
        ),
        Err(e) => eprintln!("[revery] Could not quarantine corrupt settings: {e}"),
    }
}

/// Atomically refresh .bak with the bytes we just wrote to main. Best-effort.
fn refresh_settings_bak(config_path: &Path, content: &[u8]) {
    let bak = settings_bak_path(config_path);
    if let Err(e) = atomic_write_settings(&bak, content) {
        eprintln!("[revery] Could not refresh settings .bak: {e}");
    }
}

/// Read settings for read-only use. On corruption, transparently recovers
/// from .bak; if that also fails, returns an empty object (legacy behavior).
/// Caller must hold SettingsLock.
fn load_settings_for_read(config_path: &Path) -> serde_json::Value {
    match read_settings_raw(config_path) {
        SettingsState::Ok(v) => v,
        SettingsState::Absent => serde_json::json!({}),
        SettingsState::Corrupt => {
            try_load_settings_bak(config_path).unwrap_or_else(|| serde_json::json!({}))
        }
    }
}

/// Internal: load settings for a write, reporting whether recovery occurred.
/// `recovery_happened == true` means the caller MUST write the result back,
/// even if no logical change is needed — otherwise the recovered .bak content
/// is lost (the corrupt main file was already quarantined out of the way).
///
/// Renamed from `load_settings_for_write` to force a compile error at any
/// site that previously called it directly. All callers must now go through
/// `update_settings()` — see audit Cluster A.
fn load_settings_recovering(config_path: &Path) -> (serde_json::Value, bool) {
    match read_settings_raw(config_path) {
        SettingsState::Ok(v) => (v, false),
        SettingsState::Absent => (serde_json::json!({}), false),
        SettingsState::Corrupt => {
            let recovered = try_load_settings_bak(config_path);
            quarantine_corrupt_settings(config_path);
            match recovered {
                Some(v) => {
                    eprintln!("[revery] Settings file was corrupt; recovered from .bak.");
                    (v, true)
                }
                None => {
                    eprintln!(
                        "[revery] Settings file is corrupt and .bak is unavailable. Starting fresh."
                    );
                    (serde_json::json!({}), true)
                }
            }
        }
    }
}


/* ══════════════════════════════════════════════════════════════════════════
   SETTINGS I/O — public chokepoints
   ══════════════════════════════════════════════════════════════════════════
   These two functions are the ONLY sanctioned way for command handlers to
   read or modify revery_settings.json. Direct calls to fs::read_to_string,
   serde_json::from_str, atomic_write_settings, refresh_settings_bak, or
   load_settings_recovering from outside this section are a regression —
   see audit Cluster A (#1, #2).

   Concurrency: each chokepoint acquires SettingsLock internally for the
   duration of its operation. Callers MUST NOT pre-acquire the lock — that
   would deadlock.
   ══════════════════════════════════════════════════════════════════════════ */

/// CHOKEPOINT — read settings.
/// Returns parsed settings JSON. Falls back to `.bak` transparently if the
/// main file is corrupt; never propagates a parse error for that case. Only
/// returns `Err` if the OS config dir cannot be located.
fn read_settings(
    app: &AppHandle,
    settings_lock: &Mutex<()>,
) -> Result<serde_json::Value, String> {
    let _guard = settings_lock.lock().unwrap_or_else(|p| p.into_inner());
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No config dir: {e}"))?;
    let config_path = config_dir.join("revery_settings.json");
    Ok(load_settings_for_read(&config_path))
}

/// CHOKEPOINT — atomic read-modify-write of settings.
///
/// Steps performed under SettingsLock, in order:
///   1. Read main file; on corruption, recover from `.bak` and quarantine
///      the corrupt main file.
///   2. Hand the loaded JSON object to `mutator`.
///   3. If the mutator returned `true` OR recovery happened, write the
///      result atomically and refresh `.bak`.
///
/// Returns `Ok(true)` if a write was performed, `Ok(false)` if no write was
/// needed, or `Err(_)` if any I/O step failed.
///
/// The "recovery happened" branch is the load-bearing fix: without it,
/// a mutator that returns `false` after `.bak` was loaded would leave the
/// recovered content only in memory. The next read would see the quarantined
/// (now-absent) main file and return `{}`, silently losing every key.
fn update_settings<F>(
    app: &AppHandle,
    settings_lock: &Mutex<()>,
    mutator: F,
) -> Result<bool, String>
where
    F: FnOnce(&mut serde_json::Value) -> bool,
{
    let _guard = settings_lock.lock().unwrap_or_else(|p| p.into_inner());
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No config dir: {e}"))?;
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Cannot create config dir: {e}"))?;
    let config_path = config_dir.join("revery_settings.json");

    let (mut settings, recovery_happened) = load_settings_recovering(&config_path);
    let mutator_changed = mutator(&mut settings);

    if !mutator_changed && !recovery_happened {
        return Ok(false);
    }

    let bytes = settings.to_string();
    atomic_write_settings(&config_path, bytes.as_bytes())?;
    refresh_settings_bak(&config_path, bytes.as_bytes());
    Ok(true)
}



/* ── Temporary sibling names ─────────────────────────────────────────────
   The temp file (and the EXDEV snapshot) sits beside the file it replaces
   and starts with its name, so a leftover is recognisable — but with at
   most TEMP_NAME_PREFIX_BYTES bytes of it. A note may use the whole
   255-byte name limit, and "<full name>.<nanos>.revery_tmp" was then too
   long to create: such a note could never be saved (ENAMETOOLONG on every
   autosave). ~100 + 40 bytes also fits tighter filesystem limits
   (eCryptfs: 143). The cut never splits a character, and a per-process
   sequence number keeps two notes that share a long prefix from ever
   sharing a temp name. MIRROR of fs_core.tempSiblingPath (Electron). */
const TEMP_NAME_PREFIX_BYTES: usize = 100;

fn temp_name_prefix(name: &str) -> &str {
    if name.len() <= TEMP_NAME_PREFIX_BYTES {
        return name;
    }
    let mut end = TEMP_NAME_PREFIX_BYTES;
    while !name.is_char_boundary(end) {
        end -= 1;
    }
    &name[..end]
}

fn temp_sibling(dest: &Path, tag: &str) -> PathBuf {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let name = dest
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    dest.with_file_name(format!("{}.{}_{}.{}", temp_name_prefix(&name), nanos, seq, tag))
}

/// Give the new file the permission bits of the file it replaces (Unix).
/// The rename publishes a NEW file, which used to get the default mode — a
/// private 0600 note became readable by other users after its first save.
/// Windows: nothing is copied (the mode there is only the read-only flag,
/// and a read-only temp file would make the next save fail). Best effort:
/// never fails the save. MIRROR of fs_core existingModeBits/applyModeBits.
fn keep_permissions_of(dest: &Path, f: &fs::File) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(dest) {
            let mode = meta.permissions().mode() & 0o7777;
            if f.set_permissions(fs::Permissions::from_mode(mode)).is_err() {
                // setuid/setgid can be refused: keep the rest
                if let Err(e) = f.set_permissions(fs::Permissions::from_mode(mode & 0o777)) {
                    eprintln!("[revery] could not keep the file permissions (non-fatal): {e}");
                }
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (dest, f);
    }
}

/// Run `rename` again while it fails with a transient lock (see
/// classify_rename_error), waiting LOCK_RETRY_DELAYS_MS in between; the last error is returned for the
/// caller to classify. A rename happens completely or not at all, so a
/// retry can never leave a partial state. `sleep` exists for the tests.
fn retry_rename_on_lock(
    mut rename: impl FnMut() -> std::io::Result<()>,
    windows: bool,
    mut sleep: impl FnMut(u64),
) -> std::io::Result<()> {
    let mut attempt = 0;
    loop {
        match rename() {
            Ok(()) => return Ok(()),
            Err(e) if attempt < LOCK_RETRY_DELAYS_MS.len()
                && classify_rename_error(e.raw_os_error(), windows) == RenameErrorKind::TransientLock =>
            {
                sleep(LOCK_RETRY_DELAYS_MS[attempt]);
                attempt += 1;
            }
            Err(e) => return Err(e),
        }
    }
}

/// Atomically write a text file.
// ── Atomic write helper ───────────────────────────────────────────────────
//
// Writes `content` to `dest` atomically by:
//   1. Writing to a sibling temp file `tmp` (same directory → same filesystem).
//   2. Renaming `tmp` → `dest` (atomic on all local FSes). A transient
//      lock (antivirus scanning the temp file, a sync client, a file open on
//      another computer of an SMB share) is retried; one that does not let
//      go FAILS the write, old file intact.
//      It used to be answered with an in-place copy (ERROR_SHARING_VIOLATION
//      counted as "cross-device"), which a crash could leave half-written.
//   3. Only on a real cross-device error (classify_rename_error), falling
//      back to: copy `tmp` → `dest`, then delete `tmp`.
//
// SAFETY: On fallback copy failure, we clean up `tmp` but NEVER delete `dest`.
// If `dest` was an existing file, deleting it on a failed overwrite would
// guarantee 100% data loss. The user keeps whatever was there before.
fn atomic_write_file(tmp: &Path, dest: &Path, content: &[u8]) -> Result<(), String> {
// Step 1: Write to temp file. Scoped so the handle is closed before rename
    // (required on Windows, which locks open files).
    {
        let mut f = fs::File::create(tmp)
            .map_err(|e| format!("Cannot create temp file: {e}"))?;
        keep_permissions_of(dest, &f);
        f.write_all(content)
            .map_err(|e| { let _ = fs::remove_file(tmp); format!("Write failed: {e}") })?;
        // FIX: Flush kernel buffers to physical disk before rename 
        // to prevent 0-byte files on power loss.
        f.sync_data()
            .map_err(|e| { let _ = fs::remove_file(tmp); format!("Sync failed: {e}") })?;
    }

// Step 2: Try atomic rename.
    let renamed = retry_rename_on_lock(
        || fs::rename(tmp, dest),
        cfg!(windows),
        |ms| std::thread::sleep(std::time::Duration::from_millis(ms)),
    );
    match renamed {
        Ok(()) => {
            // Persist the directory entry change. See sync_parent_dir().
            sync_parent_dir(dest);
            return Ok(());
        }
        Err(e) => match classify_rename_error(e.raw_os_error(), cfg!(windows)) {
            RenameErrorKind::CrossDevice => {
                // Fall through to copy fallback.
            }
            RenameErrorKind::TransientLock => {
                let _ = fs::remove_file(tmp);
                let name = dest.file_name().unwrap_or_default().to_string_lossy().into_owned();
                return Err(format!(
                    "\"{name}\" could not be replaced: another program is using it, or it \
                     is read-only ({e}). The file on disk was not changed."
                ));
            }
            RenameErrorKind::Other => {
                let _ = fs::remove_file(tmp);
                return Err(format!("Rename failed: {e}"));
            }
        },
    }

    // Step 3 (EXDEV fallback): backup → overwrite → clean up.
    // If the copy is interrupted mid-write, `dest` would be left truncated.
    // Snapshot `dest` first so we can restore it on failure.
    let bak = temp_sibling(dest, "revery_bak");

    let has_bak = dest.exists();
    if has_bak {
        if let Err(e) = fs::copy(dest, &bak) {
            let _ = fs::remove_file(tmp);
            return Err(format!("EXDEV fallback aborted: cannot create backup: {e}"));
        }
    }

    if let Err(copy_err) = fs::copy(tmp, dest) {
        let mut restored = false;
        if has_bak {
            restored = fs::copy(&bak, dest).is_ok();
            if restored {
                let _ = fs::remove_file(&bak);
            }
        }
        let _ = fs::remove_file(tmp);
        if has_bak && !restored {
            // The kept snapshot matches /\.revery_bak$/ and is surfaced by
            // the boot-time orphan report (reportBakOrphans) on next launch.
            return Err(format!(
                "Cross-device write failed during copy (EXDEV): {copy_err}. \
                 The file may be incomplete. A snapshot of the previous \
                 content was preserved at \"{}\" — rename it over the \
                 original to recover.",
                bak.display()
            ));
        }
        return Err(format!(
            "Cross-device write failed during copy (EXDEV): {copy_err}"
        ));
    }

    // FIX: Force sync the copied destination file before considering it a success
    if let Ok(f) = fs::File::open(dest) {
        let _ = f.sync_data();
    }

    // Success — clean up both temp files.
    let _ = fs::remove_file(tmp);
    if has_bak {
        let _ = fs::remove_file(&bak);
    }

    sync_parent_dir(dest);
    Ok(())



}

#[inline]
fn sync_parent_dir(file_path: &Path) {
    #[cfg(unix)]
    {
        if let Some(parent) = file_path.parent() {
            // Open parent as a directory handle; on Linux this requires
            // O_RDONLY which is what File::open uses by default.
            match fs::File::open(parent) {
                Ok(dir_fd) => {
                    if let Err(e) = dir_fd.sync_all() {
                        eprintln!(
                            "[revery] sync_parent_dir({}) failed (non-fatal): {e}",
                            parent.display()
                        );
                    }
                }
                Err(e) => {
                    eprintln!(
                        "[revery] could not open parent dir for fsync ({}): {e}",
                        parent.display()
                    );
                }
            }
        }
    }
    #[cfg(not(unix))]
    {
        // Windows / other: NTFS journals dir entries with file content,
        // so this is a no-op. Suppress the unused-arg warning.
        let _ = file_path;
    }
}

/// Atomically write a text file.
#[tauri::command]
 async fn write_file(path: String, content: String, root_state: State<'_, RootPath>) -> Result<(), String> {
    // #4: sync commands run on the MAIN thread in Tauri v2, so the double
    // fsync below froze the UI on slow disks. Only the lock-read of the
    // root stays here; all disk work (incl. safe_path_inside's
    // canonicalization walk) moves to the blocking pool. Cross-call
    // ordering for the volatile/crash-backup machinery is guaranteed
    // JS-side by _enqueueVolatileOp in native_api.js — do not remove one
    // without the other.
    let root = get_root(&root_state)?;
    tokio::task::spawn_blocking(move || {
        let p = safe_path_inside(&path, &root)?;

        p.file_name().ok_or("Cannot write file: path has no filename component")?;
        // Same ".revery_tmp" suffix as Electron and save_file, so a temp file
        // left behind by a crash is recognisable as ours on either wrapper;
        // its name is bounded (see temp_sibling).
        let tmp = temp_sibling(&p, "revery_tmp");
        atomic_write_file(&tmp, &p, content.as_bytes())
    })
    .await
    .map_err(|e| format!("Background write task failed: {e}"))?
}

/// The last component of a path the app is about to create must pass the
/// one name rule (check_entry_name).
fn check_new_name(p: &Path) -> Result<(), String> {
    let name = p.file_name().unwrap_or_default().to_string_lossy().into_owned();
    match check_entry_name(&name) {
        Some(why) => Err(format!("Invalid name \"{name}\" ({why}).")),
        None => Ok(()),
    }
}

/// Create an empty file (errors if it already exists).
#[tauri::command]
fn create_file(path: String, root_state: State<'_, RootPath>) -> Result<(), String> {
    let root = get_root(&root_state)?;
    let p = safe_path_inside(&path, &root)?;
    check_new_name(&p)?;
    // create_new(true) = O_EXCL: existence check and creation are one atomic
    // OS operation. The previous exists() → File::create pair had a TOCTOU
    // gap in which File::create silently truncated a file created in between.
    //
    // ERROR CONTRACT: on collision this command MUST return a message
    // containing "File already exists:" — createNewFile's retry loop in
    // project_sidebar.js detects collisions via the substring
    // 'already exists'. Mapping ErrorKind::AlreadyExists explicitly pins
    // that contract instead of trusting the OS error text. Keep main.js
    // fs:create-file in sync.
    match fs::OpenOptions::new().write(true).create_new(true).open(&p) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            Err(format!("File already exists: {}", p.display()))
        }
        Err(e) => Err(format!("Create failed: {e}")),
    }
}


/// Create a directory (and any missing parents).
#[tauri::command]
 fn create_directory(path: String, root_state: State<'_, RootPath>) -> Result<(), String> {
    let root = get_root(&root_state)?;
    let p = safe_path_inside(&path, &root)?;
    check_new_name(&p)?;

    fs::create_dir_all(&p).map_err(|e| format!("mkdir failed: {e}"))
}




/* ══════════════════════════════════════════════════════════════════════════
   DIRECTORY ENTRIES — what rename, move and "Move to Trash" act on
   safe_path_inside canonicalizes the WHOLE path, the last component
   included: right for reading and writing content, wrong for acting on an
   entry. For a symbolic link (or junction) it named the link's TARGET, so
   moving a link moved the folder it pointed to and deleting it trashed
   that folder. An entry is resolved like this instead: its PARENT folder
   canonicalized (it must lie inside the project), its own name appended
   untouched. The result is the link itself, and it is the same spelling
   read_directory hands out for every entry. Mirrors
   fs_core.validateEntryInside (Electron).
   ══════════════════════════════════════════════════════════════════════════ */
fn safe_entry_inside(raw: &str, root: &Path) -> Result<PathBuf, String> {
    let p = safe_path(raw)?;
    let not_entry = || format!("Security Error: Not a file or folder inside the project: {raw}");
    let name = p.file_name().ok_or_else(not_entry)?.to_owned();
    let parent = p.parent().filter(|q| !q.as_os_str().is_empty()).ok_or_else(not_entry)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve root: {e}"))?;
    let real_parent = safe_path_inside(&parent.to_string_lossy(), root)?;
    let entry = real_parent.join(&name);
    if entry == canonical_root || !entry.starts_with(&canonical_root) {
        return Err(format!("Security Error: Path escapes project root: {}", p.display()));
    }
    Ok(entry)
}

/// Does the entry exist? symlink_metadata: a dangling link exists too
/// (`Path::exists` follows links and answered "no" — a rename would then
/// have replaced the link).
fn lexists(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok()
}

/// The one rule for names the app gives a file or folder. MIRROR of
/// checkEntryName in src/sidebar/paths.js and fs_core.js: None when the
/// name is fine, else the reason key (see paths.js for what each means).
fn check_entry_name(name: &str) -> Option<&'static str> {
    if name.trim().is_empty() {
        return Some("empty");
    }
    if name == "." || name == ".." {
        return Some("invalid");
    }
    if name.chars().any(|c| (c as u32) < 0x20 || c == '\u{7f}' || c == '/' || c == '\\') {
        return Some("invalid");
    }
    if name.starts_with('.') {
        return Some("hidden");
    }
    if name.ends_with('.') || name.ends_with(' ') || name.starts_with(' ') {
        return Some("edge");
    }
    if is_windows_device_name(name) {
        return Some("device");
    }
    let lower = name.to_lowercase();
    if lower.ends_with(".revery_tmp") || lower.ends_with(".revery_bak") {
        return Some("internal");
    }
    if name.len() > 255 {
        return Some("long");
    }
    None
}

/// CON, PRN, AUX, NUL, COM0-9/¹²³, LPT0-9/¹²³, CONIN$, CONOUT$ — the part
/// before the first dot, any case ("nul.md" is reserved too).
fn is_windows_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_lowercase();
    if matches!(stem.as_str(), "con" | "prn" | "aux" | "nul" | "conin$" | "conout$") {
        return true;
    }
    let chars: Vec<char> = stem.chars().collect();
    if chars.len() != 4 {
        return false;
    }
    let prefix: String = chars[..3].iter().collect();
    (prefix == "com" || prefix == "lpt")
        && (chars[3].is_ascii_digit() || matches!(chars[3], '\u{b9}' | '\u{b2}' | '\u{b3}'))
}

/// Case-only alias decision from the folder listing: renaming `old_name`
/// to `new_name` (equal ignoring case) targets the SAME entry unless the
/// folder holds two distinct entries spelled exactly like each — then the
/// filesystem is case-sensitive and `new_name` is another item that must
/// never be overwritten. Pure, so it is testable on any filesystem.
fn case_only_alias_in_listing(old_name: &str, new_name: &str, listing: &[String]) -> bool {
    if old_name == new_name || old_name.to_lowercase() != new_name.to_lowercase() {
        return false;
    }
    let exact_old = listing.iter().any(|n| n == old_name);
    let exact_new = listing.iter().any(|n| n == new_name);
    !(exact_old && exact_new)
}

fn is_case_only_alias(old: &Path, new: &Path) -> bool {
    let (Some(op), Some(np)) = (old.parent(), new.parent()) else { return false };
    if op != np {
        return false;
    }
    let (Some(on), Some(nn)) = (old.file_name(), new.file_name()) else { return false };
    let Ok(rd) = fs::read_dir(op) else { return false };
    let listing: Vec<String> = rd
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    case_only_alias_in_listing(&on.to_string_lossy(), &nn.to_string_lossy(), &listing)
}

/// Where a rename of the entry `old` to the entry `new` goes: Ok(Some(new)),
/// Ok(None) when there is nothing to do (same entry, same spelling), Err
/// when `new` is taken by a DIFFERENT entry — never overwritten.
fn resolve_rename_target(old: &Path, new: &Path) -> Result<Option<PathBuf>, String> {
    if old == new {
        return Ok(None);
    }
    if !lexists(new) || is_case_only_alias(old, new) {
        return Ok(Some(new.to_path_buf()));
    }
    Err(format!("Destination already exists: {}", new.display()))
}

/// '..' / '.' resolved lexically, like Node's path.resolve.
fn lexical_join(base: &Path, rel: &Path) -> PathBuf {
    let mut out = base.to_path_buf();
    for c in rel.components() {
        match c {
            std::path::Component::ParentDir => { out.pop(); }
            std::path::Component::CurDir => {}
            std::path::Component::Normal(s) => out.push(s),
            _ => {}
        }
    }
    out
}

/// Would moving the link `src` to `dest` change what it points to? Only a
/// RELATIVE link moved to another folder (its target is resolved from the
/// folder it sits in). Such a move is refused. A link whose target cannot
/// be read is treated as "would change" — when unsure, do not move it.
fn link_move_changes_target(src: &Path, dest: &Path) -> bool {
    let Ok(md) = fs::symlink_metadata(src) else { return false };
    if !md.file_type().is_symlink() {
        return false;
    }
    let Ok(target) = fs::read_link(src) else { return true };
    if target.is_absolute() {
        return false;
    }
    match (src.parent(), dest.parent()) {
        (Some(a), Some(b)) => lexical_join(a, &target) != lexical_join(b, &target),
        _ => true,
    }
}

#[derive(Debug, PartialEq)]
enum RenameErrorKind {
    CrossDevice,
    TransientLock,
    Other,
}

/// Classify a failed rename by its raw OS error. Cross-device is EXDEV (18)
/// on Linux/macOS but ERROR_NOT_SAME_DEVICE (17) on Windows — 17 on Unix is
/// EEXIST, which the old code mistook for "cross-device" and answered by
/// copying INTO an existing folder (overwriting same-named files) and then
/// deleting the original. Transient locks: on Windows ACCESS_DENIED 5,
/// SHARING_VIOLATION 32, LOCK_VIOLATION 33; on Linux/macOS EBUSY 16, which
/// the SMB client reports when the server refuses a file another computer
/// has open (EPERM/EACCES there are real permission errors). Mirror of
/// isTransientLock in electron/fs_core.js.
fn classify_rename_error(raw: Option<i32>, windows: bool) -> RenameErrorKind {
    match (raw, windows) {
        (Some(17), true) | (Some(18), false) => RenameErrorKind::CrossDevice,
        (Some(5) | Some(32) | Some(33), true) | (Some(16), false) => RenameErrorKind::TransientLock,
        _ => RenameErrorKind::Other,
    }
}

/// Waits between attempts when a rename meets a TransientLock — the ONE
/// policy for every rename (atomic_write_file, rename_entry_blocking).
/// MIRROR of LOCK_RETRY_DELAYS_MS in electron/fs_core.js.
const LOCK_RETRY_DELAYS_MS: [u64; 3] = [100, 200, 400];

/// Rename or move one entry inside the project. Never overwrites, never
/// copies, never deletes (mirror of fs_core.renameEntry):
///   • both paths are ENTRIES: a link moves as a link, its target untouched;
///   • an existing destination is refused, except the same entry under a
///     case-only different spelling;
///   • a new name must pass check_entry_name (a pure move keeps its name);
///   • a folder never moves into itself; a relative link never moves to
///     another folder;
///   • another drive or volume is REFUSED. The old copy-then-delete
///     fallback could leave a half-emptied original, and (see
///     classify_rename_error) could merge into an existing folder;
///   • a transient lock (classify_rename_error) is retried a few times — a
///     rename happens completely or not at all, so a retry cannot leave a
///     partial state.
fn rename_entry_blocking(old_path: &str, new_path: &str, root: &Path) -> Result<(), String> {
    let old = safe_entry_inside(old_path, root)?;
    let new = safe_entry_inside(new_path, root)?;
    let shown = old.file_name().unwrap_or_default().to_string_lossy().into_owned();

    if !lexists(&old) {
        return Err(format!("Source not found: {}", old.display()));
    }
    if old.file_name() != new.file_name() {
        let name = new.file_name().unwrap_or_default().to_string_lossy().into_owned();
        if let Some(why) = check_entry_name(&name) {
            return Err(format!("Invalid name \"{name}\" ({why})."));
        }
    }
    if new != old && new.starts_with(&old) {
        return Err(format!("Cannot move \"{shown}\" into itself."));
    }
    let target = match resolve_rename_target(&old, &new)? {
        Some(t) => t,
        None => return Ok(()),
    };
    if link_move_changes_target(&old, &target) {
        return Err(format!(
            "\"{shown}\" is a relative link. Moving it to another folder would change what it points to, so it was not moved."
        ));
    }

    let mut attempt = 0;
    loop {
        match fs::rename(&old, &target) {
            Ok(()) => return Ok(()),
            Err(err) => match classify_rename_error(err.raw_os_error(), cfg!(windows)) {
                RenameErrorKind::CrossDevice => {
                    return Err(format!(
                        "\"{shown}\" cannot be moved to another drive or volume from Revery (nothing was changed). Use your file manager for that move."
                    ));
                }
                RenameErrorKind::TransientLock if attempt < LOCK_RETRY_DELAYS_MS.len() => {
                    std::thread::sleep(std::time::Duration::from_millis(LOCK_RETRY_DELAYS_MS[attempt]));
                    attempt += 1;
                    if !lexists(&old) {
                        return Err(format!("Source not found: {}", old.display()));
                    }
                    if lexists(&target) && !is_case_only_alias(&old, &target) {
                        return Err(format!("Destination already exists: {}", target.display()));
                    }
                }
                _ => return Err(format!("Rename failed: {err}")),
            },
        }
    }
}

#[tauri::command]
async fn rename_node(old_path: String, new_path: String, root_state: State<'_, RootPath>) -> Result<(), String> {
    let root = get_root(&root_state)?;
    // Heavy I/O off the UI thread (see "Off the UI thread").
    tokio::task::spawn_blocking(move || rename_entry_blocking(&old_path, &new_path, &root))
        .await
        .map_err(|e| format!("Thread pool error: {}", e))?
}

/// The canonical spelling of an entry inside the project (see
/// safe_entry_inside) — the renderer normalises paths that did not come
/// from a folder listing (the restored last file, Save As).
#[tauri::command]
async fn canonical_entry_path(path: String, root_state: State<'_, RootPath>) -> Result<String, String> {
    let root = get_root(&root_state)?;
    tokio::task::spawn_blocking(move || safe_entry_inside(&path, &root).map(|p| frontend_path(&p)))
        .await
        .map_err(|e| format!("Thread pool error: {}", e))?
}


/// Move a file, folder or link to the OS trash (Recycle Bin on Windows,
/// Trash on macOS, XDG Trash on Linux). Recursive for directories.
/// The user can restore the item from their system trash UI.
#[tauri::command]
async fn delete_node(path: String, root_state: State<'_, RootPath>) -> Result<(), String> {
    let root = get_root(&root_state)?;
    tokio::task::spawn_blocking(move || delete_node_blocking(path, root))
        .await
        .map_err(|e| format!("Background trash task failed: {e}"))?
}

fn delete_node_blocking(path: String, root: PathBuf) -> Result<(), String> {
    // The ENTRY: deleting a link trashes the link, never its target (the
    // trash crate itself canonicalizes only the parent folder). The project
    // root is never an entry.
    let p = safe_entry_inside(&path, &root)?;

    if !lexists(&p) {
        return Ok(()); // Already gone — preserve idempotency
    }

    trash::delete(&p).map_err(|e| format!("Move to trash failed: {e}"))
}


/// Crash backup write (two atomic writes, four fsyncs — every couple of
/// seconds while typing): on the blocking pool, never the UI thread.
/// Ordering between backup calls is guaranteed JS-side (_enqueueVolatileOp
/// awaits each one); VOLATILE_LOCK serializes against get/list/purge.
/// `base`: the fingerprint of the disk version the text was edited from
/// (stored with the backup; see write_backup_to). Absent from older callers.
#[tauri::command]
async fn set_volatile_content(path: String, content: String, base: Option<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let volatile_dir = prepare_volatile_dir().map_err(|s| s.to_string())?;
        let _guard = VOLATILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        write_backup_to(volatile_dir, &path, &content, base.as_deref())
    })
    .await
    .map_err(|e| format!("Background backup task failed: {e}"))?
}

/// Durable (reboot-safe) snapshot under the app data dir. Written by the
/// renderer only for the autosave-suspended states (conflict hold, save-
/// failure cooldown) — see prepare_durable_dir(). Same on-disk format as
/// the volatile slot; recovery reads both via get_volatile_content.
#[tauri::command]
async fn set_durable_backup(app: AppHandle, path: String, content: String, base: Option<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let durable_dir = prepare_durable_dir(&app).map_err(|s| s.to_string())?;
        let _guard = VOLATILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        write_backup_to(durable_dir, &path, &content, base.as_deref())
    })
    .await
    .map_err(|e| format!("Background backup task failed: {e}"))?
}

/// Async so a read never waits for VOLATILE_LOCK (held by a backup write
/// doing fsyncs) on the UI thread.
#[tauri::command]
async fn get_volatile_content(app: AppHandle, path: String) -> Option<serde_json::Value> {
    let joined = tokio::task::spawn_blocking(move || {
        // Consult every backup location that passed its safety check and return
        // the NEWEST snapshot (the durable slot can outlive a reboot that wiped
        // the tmpfs-backed volatile one). An unavailable dir is treated as "no
        // backup there" — mirrors Electron's volatileDirReady=false path.
        // Hold the same lock as writers so we never observe a "data file already
        // renamed in, meta file still in temp" half-state.
        let _guard = VOLATILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        let mut best: Option<(String, u64, Option<String>)> = None;
        for dir in backup_dirs(&app) {
            if let Some((content, ts, base)) = read_backup_from(dir, &path) {
                if best.as_ref().map_or(true, |(_, best_ts, _)| ts > *best_ts) {
                    best = Some((content, ts, base));
                }
            }
        }
        // The base travels with its own text: the newest snapshot's.
        best.map(|(content, ts, base)| {
            serde_json::json!({ "content": content, "ts": ts, "originalPath": path, "base": base })
        })
    })
    .await;
    joined.unwrap_or_else(|e| {
        eprintln!("[revery] backup read task failed: {e}");
        None
    })
}



#[tauri::command]
async fn delete_volatile_content(app: AppHandle, path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        // Clear ALL backup locations; an unavailable dir has nothing of ours.
        let _guard = VOLATILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        for dir in backup_dirs(&app) {
            delete_backup_from(dir, &path);
        }
    })
    .await
    .map_err(|e| format!("Background backup task failed: {e}"))
}


/// Show a native OS "Save As" dialog, write the file atomically, and return
/// the chosen path.  Returns { saved: false } if the user cancels.
/// Note: this command intentionally has no root-scope restriction — the path
/// comes directly from the OS dialog, not from the renderer.
#[tauri::command]
async fn save_file(
    app: AppHandle,
    filename: String,
    content: String,
    #[allow(unused_variables)]
    update_root: Option<bool>,   // true → Save As behaviour; false/None → export only
    root_state: State<'_, RootPath>,
    lock: State<'_, SettingsLock>,
) -> Result<SaveFileResult, String> {
    use tauri_plugin_dialog::FilePath;

    let (tx, rx) = tokio::sync::oneshot::channel();
    file_dialog_for(&app)
        .set_title("Save As")
        .add_filter("Markdown", &["md", "txt"])
        .set_file_name(&filename)
        .save_file(move |p| {
            let _ = tx.send(p);
        });

    let result = rx.await.unwrap_or(None);

    match result {
        None => Ok(SaveFileResult { saved: false, file_path: None, new_root_path: None }),
        Some(chosen) => {
            let path_str = match chosen {
                FilePath::Path(pb) => pb.to_string_lossy().into_owned(),
                FilePath::Url(u)   => u.to_string(),
            };


            let p = safe_path(&path_str)?;

            p.file_name().ok_or("Path has no filename")?;
            let tmp = temp_sibling(&p, "revery_tmp");

           atomic_write_file(&tmp, &p, content.as_bytes())?;


            let new_root: Option<String> = if update_root.unwrap_or(false) {
                p.parent().and_then(|dir| {
                    let canonical = dir.canonicalize().ok()?;
                    let _ = app.asset_protocol_scope().allow_directory(&canonical, true);
                    let dir_str = frontend_path(&canonical);


                    let new_trust = dir_str.clone();
                    let _ = update_settings(&app, &lock.0, move |settings| {
                        let mut trusted = settings["trustedRoots"]
                            .as_array().cloned().unwrap_or_default();
                        let path_val = serde_json::Value::String(new_trust);
                        if trusted.contains(&path_val) {
                            return false;
                        }
                        trusted.push(path_val);
                        if let Some(obj) = settings.as_object_mut() {
                            obj.insert(
                                "trustedRoots".to_string(),
                                serde_json::Value::Array(trusted),
                            );
                        }
                        true
                    });

                    // Update in-memory root state AFTER trust is durable on disk.
                    *root_state.0.lock().unwrap_or_else(|p| p.into_inner())
                        = Some(dir_str.clone());
                    Some(dir_str)
                })
            } else {
                None
            };


            Ok(SaveFileResult { saved: true, file_path: Some(path_str), new_root_path: new_root })

        }
    }
}


/* ══════════════════════════════════════════════════════════════════════════
   ZIP PROJECT EXPORT
   Reads only inside the trusted project root; the destination comes
   exclusively from the OS save dialog (never the renderer). No password
   option by design: classic zip encryption is cryptographically broken
   and would only pretend to protect the notes.
══════════════════════════════════════════════════════════════════════════ */

#[derive(Serialize)]
struct ZipExportResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    ok: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    canceled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    entries: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes: Option<u64>,
}

const ZIP_MAX_ENTRIES: usize = 65_000; // classic zip limit is 65535 (no zip64)
const ZIP_MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;

/// Recursively collect project entries for zip export.
/// Symlinks are SKIPPED (symlink_metadata, never followed) so a link inside
/// the project can never leak content from outside the root into the
/// archive. `exclude` is the destination zip itself, for when the user
/// saves the archive inside their own project folder.
/// File mtime → zip DOS timestamp, LOCAL wall clock — the same convention
/// as the Electron exporter's dosDateTime(), so backups made by either
/// installer carry identical, real modification times (the sidebar sorts
/// by mtime; a restored backup must not scramble that order). The DOS
/// format spans 1980–2107: the year is clamped like Electron's floor, and
/// anything still unrepresentable falls back to the zip epoch rather than
/// failing a backup over one odd mtime.
fn zip_datetime_from(t: std::time::SystemTime) -> zip::DateTime {
    use chrono::{Datelike, Timelike};
    let dt: chrono::DateTime<chrono::Local> = t.into();
    zip::DateTime::from_date_and_time(
        dt.year().clamp(1980, 2107) as u16,
        dt.month() as u8,
        dt.day() as u8,
        dt.hour() as u8,
        dt.minute() as u8,
        (dt.second().min(59)) as u8, // chrono leap second 60 is out of DOS range
    )
    .unwrap_or_default()
}

fn walk_project_for_zip(
    dir: &Path,
    rel: &str,
    exclude: Option<&Path>,
    files: &mut Vec<(String, PathBuf, std::time::SystemTime)>,
    dirs: &mut Vec<(String, std::time::SystemTime)>,
    total_bytes: &mut u64,
) -> Result<(), String> {
    let read = std::fs::read_dir(dir)
        .map_err(|e| format!("Could not read {}: {e}", dir.display()))?;
    let mut children: Vec<_> = read.filter_map(|e| e.ok()).collect();
    children.sort_by_key(|e| e.file_name()); // deterministic archive layout

    for entry in children {
        let path = entry.path();
        let meta = match std::fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(_) => continue, // vanished mid-walk — skip, never fail the export
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if let Some(ex) = exclude {
            if path == ex {
                continue;
            }
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let rel_child = if rel.is_empty() { name } else { format!("{rel}/{name}") };

        // Real mtime for the archive entry (parity with the Electron
        // exporter, which stores st.mtime). Non-fatal if unreadable.
        let mtime = meta.modified().unwrap_or_else(|_| std::time::SystemTime::now());

        if meta.is_dir() {
            dirs.push((rel_child.clone(), mtime));
            if files.len() + dirs.len() > ZIP_MAX_ENTRIES {
                return Err(format!(
                    "Project has too many items for zip export (limit {ZIP_MAX_ENTRIES})."
                ));
            }
            walk_project_for_zip(&path, &rel_child, exclude, files, dirs, total_bytes)?;
        } else if meta.is_file() {
            *total_bytes += meta.len();
            if *total_bytes > ZIP_MAX_TOTAL_BYTES {
                return Err("Project is too large for zip export (limit 512 MB).".into());
            }
            files.push((rel_child, path, mtime));
            if files.len() + dirs.len() > ZIP_MAX_ENTRIES {
                return Err(format!(
                    "Project has too many items for zip export (limit {ZIP_MAX_ENTRIES})."
                ));
            }
        }
        // other kinds (sockets, fifos…) are silently skipped
    }
    Ok(())
}

/// Build the archive bytes for a project root (deflate via the zip crate).
fn build_project_zip(
    root: &Path,
    exclude: Option<&Path>,
) -> Result<(Vec<u8>, usize, u64), String> {
    use std::io::Write;

    let mut files: Vec<(String, PathBuf, std::time::SystemTime)> = Vec::new();
    let mut dirs: Vec<(String, std::time::SystemTime)> = Vec::new();
    let mut total: u64 = 0;
    walk_project_for_zip(root, "", exclude, &mut files, &mut dirs, &mut total)?;

    let base_opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));

    // Directory entries first — preserves empty folders on extract.
    for (d, mtime) in &dirs {
        w.add_directory(d, base_opts.last_modified_time(zip_datetime_from(*mtime)))
            .map_err(|e| format!("zip dir entry failed: {e}"))?;
    }
    for (rel, abs, mtime) in &files {
        w.start_file(rel, base_opts.last_modified_time(zip_datetime_from(*mtime)))
            .map_err(|e| format!("zip entry failed: {e}"))?;
        let data = std::fs::read(abs)
            .map_err(|e| format!("Could not read {}: {e}", abs.display()))?;
        w.write_all(&data)
            .map_err(|e| format!("zip write failed: {e}"))?;
    }
    let cursor = w.finish().map_err(|e| format!("zip finish failed: {e}"))?;
    Ok((cursor.into_inner(), files.len() + dirs.len(), total))
}

/// UTC date stamp YYYY-MM-DD for the default filename (parity with the
/// Electron side's toISOString().slice(0,10)). Civil-from-days algorithm —
/// avoids pulling in a chrono dependency for one string.
fn today_stamp_utc() -> String {
    let days = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() / 86_400) as i64;
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe as i64 + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

/// Second-resolution LOCAL wall-clock stamp (YYYY_MM_DD_HH_MM_SS) for the
/// project-zip backup filename: users who zip-export as a backup can read
/// exactly when each one was made, and every export gets a unique default
/// name so backups never overwrite each other. Mirrors the Electron side.
fn now_stamp_local() -> String {
    chrono::Local::now().format("%Y_%m_%d_%H_%M_%S").to_string()
}

/// Export the whole project as a .zip. Async like save_file: the dialog is
/// awaited, and the walk+deflate runs on a blocking thread so the UI stays
/// responsive. Written atomically — a crash can never leave a truncated
/// archive at the destination.
#[tauri::command]
async fn export_project_zip(
    app: AppHandle,
    root_state: State<'_, RootPath>,
) -> Result<ZipExportResult, String> {
    use tauri_plugin_dialog::FilePath;

    let root = root_state
        .0
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
        .ok_or("No project folder is open. Please open a folder first.")?;
    let root_pb = PathBuf::from(&root);
    let folder_name = root_pb
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "project".into());

    let (tx, rx) = tokio::sync::oneshot::channel();
    file_dialog_for(&app)
        .set_title("Zip Project Export")
        .add_filter("Zip Archive", &["zip"])
        .set_file_name(&format!("{}_{}.zip", folder_name, now_stamp_local()))
        .save_file(move |p| {
            let _ = tx.send(p);
        });

    let chosen = match rx.await.unwrap_or(None) {
        None => {
            return Ok(ZipExportResult {
                ok: None,
                canceled: Some(true),
                path: None,
                entries: None,
                bytes: None,
            })
        }
        Some(c) => c,
    };
    let path_str = match chosen {
        FilePath::Path(pb) => pb.to_string_lossy().into_owned(),
        FilePath::Url(u) => u.to_string(),
    };
    let dest = safe_path(&path_str)?;

    let root_for_task = root_pb.clone();
    let dest_for_task = dest.clone();
    let (zip_bytes, entries, bytes) = tauri::async_runtime::spawn_blocking(move || {
        build_project_zip(&root_for_task, Some(dest_for_task.as_path()))
    })
    .await
    .map_err(|e| format!("zip task failed: {e}"))??;

    dest.file_name().ok_or("Path has no filename")?;
    let tmp = temp_sibling(&dest, "revery_tmp");
    atomic_write_file(&tmp, &dest, &zip_bytes)?;

    Ok(ZipExportResult {
        ok: Some(true),
        canceled: None,
        path: Some(path_str),
        entries: Some(entries),
        bytes: Some(bytes),
    })
}

/* ── LaTeX project export (zip) ──────────────────────────────────────────
   main.tex plus the referenced images under images/. Every image path is
   validated against the trusted root before reading — the renderer picks
   archive names, never filesystem locations. Same dialog + atomic-write
   pattern as the project zip.                                          */

#[derive(serde::Deserialize)]
struct LatexImage {
    #[serde(rename = "srcPath")]
    src_path: String,
    #[serde(rename = "zipName")]
    zip_name: String,
}

#[derive(serde::Deserialize)]
struct LatexSection {
    name: String,
    content: String,
}

/// Build a zip from in-memory (name, bytes) entries with deflate.
fn build_zip_from_entries(entries: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> {
    use std::io::Write;
    // In-memory entries have no source mtime; stamp them with "now" —
    // parity with the Electron exporter — instead of the crate's 1980
    // epoch default, so extracted files carry a meaningful date.
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .last_modified_time(zip_datetime_from(std::time::SystemTime::now()));
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let mut dirs: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for (name, _) in entries {
        if name.is_empty() || name.starts_with('/') || name.contains("..") || name.contains('\u{0}') {
            return Err(format!("Unsafe zip entry name: {name}"));
        }
        let parts: Vec<&str> = name.split('/').collect();
        for i in 1..parts.len() {
            dirs.insert(parts[..i].join("/"));
        }
    }
    for d in &dirs {
        w.add_directory(d, opts).map_err(|e| format!("zip dir failed: {e}"))?;
    }
    for (name, data) in entries {
        w.start_file(name, opts).map_err(|e| format!("zip entry failed: {e}"))?;
        w.write_all(data).map_err(|e| format!("zip write failed: {e}"))?;
    }
    let cursor = w.finish().map_err(|e| format!("zip finish failed: {e}"))?;
    Ok(cursor.into_inner())
}

/// System font FAMILY names for the custom-font picker. WebKitGTK has no
/// Local Font Access API, so enumeration happens here. Read-only by
/// construction: names only, no filesystem paths cross the IPC boundary.
#[tauri::command]
async fn list_system_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let mut names: Vec<String> = db
            .faces()
            .filter_map(|f| f.families.first().map(|(name, _)| name.clone()))
            .collect();
        names.sort();
        names.dedup();
        names
    })
    .await
    .map_err(|e| format!("font enumeration failed: {e}"))
}

#[tauri::command]
async fn export_latex_zip(
    app: AppHandle,
    tex: String,
    images: Vec<LatexImage>,
    base_name: Option<String>,
    bundle_fonts: Option<Vec<String>>,
    sections: Option<Vec<LatexSection>>,
    root_state: State<'_, RootPath>,
) -> Result<ZipExportResult, String> {
    use tauri_plugin_dialog::FilePath;

    let mut entries: Vec<(String, Vec<u8>)> = vec![("main.tex".into(), tex.into_bytes())];
    if !images.is_empty() {
        let root = get_root(&root_state)?;
        for img in &images {
            if img.zip_name.is_empty()
                || img.zip_name.contains('/')
                || img.zip_name.contains('\\')
                || img.zip_name.contains("..")
            {
                return Err(format!("Invalid image name in export: {}", img.zip_name));
            }
            let safe = safe_path_inside(&img.src_path, &root)?;
            let meta = std::fs::metadata(&safe)
                .map_err(|e| format!("Cannot read image {}: {e}", img.zip_name))?;
            if !meta.is_file() || meta.len() > 20 * 1024 * 1024 {
                return Err(format!("Image too large or not a file: {}", img.zip_name));
            }
            let data = std::fs::read(&safe)
                .map_err(|e| format!("Cannot read image {}: {e}", img.zip_name))?;
            entries.push((format!("images/{}", img.zip_name), data));
        }
    }

    /* Split-section files. The renderer sends bare slugs; the archive
       path is constructed HERE, so an entry can never escape sections/. */
    for sec in sections.unwrap_or_default().into_iter().take(300) {
        if sec.name.is_empty()
            || sec.name.len() > 60
            || !sec.name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err(format!("Invalid section name in export: {}", sec.name));
        }
        if sec.content.len() > 2 * 1024 * 1024 {
            return Err(format!("Section too large: {}", sec.name));
        }
        entries.push((format!("sections/{}.tex", sec.name), sec.content.into_bytes()));
    }

    /* Bundle brand fonts a template requests. The frontend may only name
       fonts from this fixed allowlist; the bytes are compiled into the
       binary (include_bytes!), never read from an arbitrary path. */
    for font_id in bundle_fonts.unwrap_or_default() {
        let data: &[u8] = match font_id.as_str() {
            "HaraldReveryTextFont.ttf" => &include_bytes!("../../www/fonts/HaraldReveryTextFont.ttf")[..],
            "HaraldReveryMonoFont.ttf" => &include_bytes!("../../www/fonts/HaraldReveryMonoFont.ttf")[..],
            other => return Err(format!("Font not allowed for export: {other}")),
        };
        entries.push((font_id, data.to_vec()));
    }

    let base = base_name
        .map(|b| b.trim().replace(['<', '>', ':', '"', '/', '\\', '|', '?', '*'], ""))
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| "latex-project".into());

    let (tx, rx) = tokio::sync::oneshot::channel();
    file_dialog_for(&app)
        .set_title("Export LaTeX Project")
        .add_filter("Zip Archive", &["zip"])
        .set_file_name(&format!("{}_{}.zip", base, today_stamp_utc()))
        .save_file(move |p| {
            let _ = tx.send(p);
        });

    let chosen = match rx.await.unwrap_or(None) {
        None => {
            return Ok(ZipExportResult {
                ok: None,
                canceled: Some(true),
                path: None,
                entries: None,
                bytes: None,
            })
        }
        Some(c) => c,
    };
    let path_str = match chosen {
        FilePath::Path(pb) => pb.to_string_lossy().into_owned(),
        FilePath::Url(u) => u.to_string(),
    };
    let dest = safe_path(&path_str)?;

    let total: u64 = entries.iter().map(|(_, d)| d.len() as u64).sum();
    let count = entries.len();
    let zip_bytes = build_zip_from_entries(&entries)?;

    dest.file_name().ok_or("Path has no filename")?;
    let tmp = temp_sibling(&dest, "revery_tmp");
    atomic_write_file(&tmp, &dest, &zip_bytes)?;

    Ok(ZipExportResult {
        ok: Some(true),
        canceled: None,
        path: Some(path_str),
        entries: Some(count),
        bytes: Some(total),
    })
}


///Keep async
/// Show a native OS dialog and return the button index pressed.
#[tauri::command]
async fn show_message_box(
    app: AppHandle,
    options: MessageBoxOptions,
) -> Result<MessageBoxResult, String> {
    use tauri_plugin_dialog::{MessageDialogKind, MessageDialogButtons};

    // FIX #4: Tauri v2's MessageDialogButtons has no variant for 3+ custom labels.
    // Reject early and loudly so a future caller discovers the problem immediately
    // rather than silently losing a button (e.g. a Cancel option on a destructive dialog).
    if options.buttons.len() > 2 {
        return Err(format!(
            "show_message_box: {} buttons requested but Tauri v2 supports \
             at most 2 custom labels (OkCancelCustom). Reduce to 2 buttons.",
            options.buttons.len()
        ));
    }

    let kind = match options.dialog_type.as_str() {
        "error"   => MessageDialogKind::Error,
        "warning" => MessageDialogKind::Warning,
        _         => MessageDialogKind::Info,
    };

    let message = if options.detail.is_empty() {
        options.message.clone()
    } else {
        format!("{}\n\n{}", options.message, options.detail)
    };



    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = message_dialog_for(&app, message)
        .title(options.title)
        .kind(kind);

    if options.buttons.len() == 2 {
        builder = builder.buttons(MessageDialogButtons::OkCancelCustom(
            options.buttons[0].clone(),
            options.buttons[1].clone(),
        ));
    } else if options.buttons.len() == 1 {
        builder = builder.buttons(MessageDialogButtons::OkCustom(
            options.buttons[0].clone()
        ));
    }

    builder.show(move |ok| { let _ = tx.send(ok); });

    // On unexpected channel failure, default to ok=false (response 1 = Cancel/safe action).
    let ok = rx.await.unwrap_or(false);

    // ok=true  → first button  → response 0
    // ok=false → second button, Escape, or OS close → response 1
    Ok(MessageBoxResult { response: if ok { 0 } else { 1 } })
}


/// Frontend calls this to approve the pending window close.
///
/// Uses destroy() rather than close() so we don't re-enter the
/// CloseRequested → prevent_close cycle and don't depend on the
/// CloseAllowed flag propagating between threads. By the time the
/// frontend has called this, all close-time logic (autosave, quit
/// modal, etc.) has already completed.
///
/// We still set CloseAllowed=true as a safety belt for any other
/// code path (e.g. the OS-native X button) that goes through the
/// CloseRequested handler before reaching this command.
#[tauri::command]
fn confirm_close(
    app: AppHandle,
    close_allowed: State<'_, CloseAllowed>,
) -> Result<(), String> {
    *close_allowed.0.lock().unwrap_or_else(|p| p.into_inner()) = true;
    if let Some(window) = app.get_webview_window("main") {
        window.destroy().map_err(|e| format!("Destroy failed: {e}"))?;
    }
    Ok(())
}


/* ══════════════════════════════════════════════════════════════════════════
   CLOSE WATCHDOG
   Every close is handed to the page, which saves and then calls
   confirm_close. A page that is hung, or whose web process died, can never
   answer — and the frameless window offers no other way out. The page
   acknowledges a close request at once (close_request_ack, native_api.js);
   if no acknowledgement arrives within CLOSE_ACK_TIMEOUT, or the page
   reports that its close flow failed (close_flow_failed), the user is
   asked here in Rust, which does not depend on the page. Only an explicit
   click on the force button closes: Enter picks the first (safe) button,
   and Escape / the dialog's own close button report plain Cancel (rfd),
   which keeps the window. Mirrors electron/main.js.
══════════════════════════════════════════════════════════════════════════ */
const CLOSE_ACK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

fn arm_close_watchdog(app: AppHandle, generation: u64) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(CLOSE_ACK_TIMEOUT).await;
        let answered = app.state::<CloseWatch>()
            .acked.load(std::sync::atomic::Ordering::SeqCst) >= generation;
        let closing = *app.state::<CloseAllowed>().0.lock().unwrap_or_else(|p| p.into_inner());
        if answered || closing {
            return;
        }
        ask_force_close(
            &app,
            "Revery Notebook is not responding",
            "The editor did not answer the close request. Your text was last saved by \
             autosave and a crash backup is kept, but typing from the last few seconds \
             may be lost if you force close."
                .to_string(),
            "Keep waiting",
            "Force close",
        );
    });
}

fn ask_force_close(app: &AppHandle, title: &str, message: String, keep_label: &str, force_label: &str) {
    use std::sync::atomic::Ordering::SeqCst;
    use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogKind, MessageDialogResult};

    if app.state::<CloseWatch>().dialog_open.swap(true, SeqCst) {
        return; // a question is already on screen
    }
    let app2 = app.clone();
    let force = force_label.to_string();
    message_dialog_for(app, message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(keep_label.to_string(), force.clone()))
        .show_with_result(move |result| {
            app2.state::<CloseWatch>().dialog_open.store(false, SeqCst);
            let forced = matches!(&result, MessageDialogResult::Custom(label) if *label == force);
            if forced {
                *app2.state::<CloseAllowed>().0.lock().unwrap_or_else(|p| p.into_inner()) = true;
                if let Some(w) = app2.get_webview_window("main") {
                    let _ = w.destroy();
                }
            }
        });
}

/// The page received a close request and is handling it (sent by
/// native_api.js before it runs the close flow). Disarms the watchdog.
#[tauri::command]
fn close_request_ack(watch: State<'_, CloseWatch>) {
    let current = watch.requested.load(std::sync::atomic::Ordering::SeqCst);
    watch.acked.fetch_max(current, std::sync::atomic::Ordering::SeqCst);
}

/// The page's close flow threw: the window would stay open with no normal
/// way to close it. Ask whether to close anyway (default: keep it open).
#[tauri::command]
fn close_flow_failed(app: AppHandle, message: String) {
    let detail: String = message.chars().take(500).collect();
    ask_force_close(
        &app,
        "Revery Notebook could not close normally",
        format!(
            "An error stopped the normal close:\n{detail}\n\nClose anyway? Changes since the \
             last autosave may be lost."
        ),
        "Keep open",
        "Close anyway",
    );
}

/// Start watching a file for external changes.
/// Emits a 'file-changed' event to the frontend on modification.
///
/// Implementation note: we watch the PARENT directory non-recursively and
/// filter events by filename — NOT the file itself. Watching a file directly
/// causes Linux inotify (and equivalent on macOS/Windows) to attach to the
/// file's inode. Our atomic-rename writes (`tmp → safe`) replace the inode,
/// orphaning the watcher: every subsequent external change is invisible.
/// Watching the parent directory is stable across atomic replacements.
#[tauri::command]
fn watch_file(
    app: AppHandle,
    path: String,
    state: State<'_, WatcherState>,
    root_state: State<'_, RootPath>,
) -> Result<(), String> {
    let root = get_root(&root_state)?;
    let p = safe_path_inside(&path, &root)?;
    let registry_key    = path.clone();
    let path_for_event  = path.clone();

    let parent = p
        .parent()
        .ok_or_else(|| format!("Path has no parent directory: {}", p.display()))?
        .to_path_buf();
    let target_filename = p
        .file_name()
        .ok_or_else(|| format!("Path has no filename component: {}", p.display()))?
        .to_owned();
    let app_clone = app.clone();

    let debounce = std::sync::Arc::new(WatchDebounce {
        deadline: std::sync::Mutex::new(None),
        alive:    std::sync::atomic::AtomicBool::new(true),
    });
    let debounce_for_cb = std::sync::Arc::clone(&debounce);

    let mut watcher = notify::recommended_watcher(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                // Filter: ignore events that don't touch our target file.
                // notify v6 always populates `paths` for filesystem events.
                let touches_target = event
                    .paths
                    .iter()
                    .any(|ep| ep.file_name() == Some(target_filename.as_os_str()));
                if !touches_target {
                    return;
                }

                let is_change = matches!(
                    event.kind,
                    EventKind::Modify(_) | EventKind::Create(_)
                );
                if is_change {
                    /* Trailing-edge debounce: every event pushes the deadline
                       out by WATCH_DEBOUNCE_MS; only the FIRST event of a
                       burst spawns the single emitter thread, which sleeps
                       until the deadline stops moving, then emits once. */
                    let spawn_emitter = {
                        let mut dl = debounce_for_cb.deadline.lock()
                            .unwrap_or_else(|p| p.into_inner());
                        let was_idle = dl.is_none();
                        *dl = Some(std::time::Instant::now()
                            + std::time::Duration::from_millis(WATCH_DEBOUNCE_MS));
                        was_idle
                    };
                    if spawn_emitter {
                        let st   = std::sync::Arc::clone(&debounce_for_cb);
                        let app  = app_clone.clone();
                        let path = path_for_event.clone();
                        std::thread::spawn(move || {
                            loop {
                                let target = {
                                    let dl = st.deadline.lock()
                                        .unwrap_or_else(|p| p.into_inner());
                                    match *dl { Some(t) => t, None => return }
                                };
                                let now = std::time::Instant::now();
                                if now >= target { break; }
                                std::thread::sleep(target - now);
                            }
                            {
                                let mut dl = st.deadline.lock()
                                    .unwrap_or_else(|p| p.into_inner());
                                *dl = None; // burst over — back to idle
                            }
                            if !st.alive.load(std::sync::atomic::Ordering::SeqCst) {
                                return; // watcher was removed mid-burst
                            }
                            let _ = app.emit(
                                "file-changed",
                                serde_json::json!({
                                    "path":      path,
                                    "eventType": "modify"
                                }),
                            );
                        });
                    }
                }
            }
        },
    )
    .map_err(|e| format!("Watcher creation failed: {e}"))?;

    watcher
        .watch(&parent, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Watch failed: {e}"))?;

    let mut watchers = state.watchers.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(old) = watchers.insert(registry_key, WatchEntry { _watcher: watcher, debounce }) {
        old.debounce.alive.store(false, std::sync::atomic::Ordering::SeqCst);
    }
    Ok(())
}

/// Stop watching a file.
/// No root/path validation here ON PURPOSE: this only removes an entry from
/// the in-memory registry and never touches the filesystem, so there is no
/// traversal surface. Validating against the CURRENT root made unwatching a
/// previous project's file fail after a root switch, leaking the native
/// watcher (and its inotify fd) for the rest of the session.
/// The key must be the exact string watch_file registered — see registry_key.
#[tauri::command]
fn unwatch_file(
    path: String,
    state: State<'_, WatcherState>,
) -> Result<(), String> {
    if let Some(entry) = state.watchers.lock().unwrap_or_else(|p| p.into_inner()).remove(&path) {
        entry.debounce.alive.store(false, std::sync::atomic::Ordering::SeqCst);
    }
    Ok(())
}


/// Retrieve the path of the last opened file (stored in app config).
#[tauri::command]
fn get_last_opened_file(
    app: AppHandle,
    lock: State<'_, SettingsLock>,
) -> Result<Option<String>, String> {
    let v = read_settings(&app, &lock.0)?;
    // Stored strings may predate frontend_path (a Save As on Windows could
    // persist a verbatim root); normalising on the way out heals them.
    Ok(v["lastOpenedFile"].as_str().map(|s| frontend_path(Path::new(s))))
}



/// Persist the last opened file path.
#[tauri::command]
fn set_last_opened_file(
    app: AppHandle,
    path: Option<String>,
    lock: State<'_, SettingsLock>,
) -> Result<(), String> {
    let new_value = match path {
        Some(p) => serde_json::Value::String(p),
        None    => serde_json::Value::Null,
    };
    update_settings(&app, &lock.0, move |settings| {
        if let Some(obj) = settings.as_object_mut() {
            obj.insert("lastOpenedFile".to_string(), new_value);
            true
        } else {
            false
        }
    })?;
    Ok(())
}


#[tauri::command]
fn clear_all_settings(
    app: AppHandle,
    lock: State<'_, SettingsLock>,
) -> Result<(), String> {
    // Preserve folder-access state on Total Reset. Clearing trustedRoots
    // would revoke the asset-protocol scope granted via the open-folder
    // dialog; clearing lastRootPath / projectHistory would make the app
    // forget every project the user had open. Total Reset is for editor
    // preferences/state, not for re-onboarding folder access.
    const PRESERVE: &[&str] = &[
        "lastRootPath",
        "projectHistory",
        "trustedRoots",
        "trustedRootsMigrated",
    ];

    update_settings(&app, &lock.0, |settings| {
        // Snapshot the values we want to keep (if present) before wiping.
        let preserved: Vec<(String, serde_json::Value)> = settings
            .as_object()
            .map(|obj| {
                PRESERVE
                    .iter()
                    .filter_map(|k| obj.get(*k).map(|v| ((*k).to_string(), v.clone())))
                    .collect()
            })
            .unwrap_or_default();

        // Rebuild the settings object containing only preserved keys.
        let mut new_obj = serde_json::Map::new();
        for (k, v) in preserved {
            new_obj.insert(k, v);
        }
        *settings = serde_json::Value::Object(new_obj);
        true
    })?;
    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct PendingRename {
    from: String,
    to:   String,
    ts:   u64,
}

/// Retrieve the in-flight rename journal entry, if any.
#[tauri::command]
fn get_pending_rename(
    app: AppHandle,
    lock: State<'_, SettingsLock>,
) -> Result<Option<PendingRename>, String> {
    let v = read_settings(&app, &lock.0)?;
    let pr = v.get("pendingRename").cloned().unwrap_or(serde_json::Value::Null);
    if pr.is_null() {
        return Ok(None);
    }
    // Defensive parse — if the stored value is malformed (e.g. settings
    // tampering or schema drift), treat as absent rather than erroring.
    Ok(serde_json::from_value::<PendingRename>(pr).ok())
}

/// Persist (or clear) the in-flight rename journal entry.
#[tauri::command]
fn set_pending_rename(
    app: AppHandle,
    journal: Option<PendingRename>,
    lock: State<'_, SettingsLock>,
) -> Result<(), String> {
    let new_value = match journal {
        Some(j) => serde_json::to_value(j)
            .unwrap_or(serde_json::Value::Null),
        None    => serde_json::Value::Null,
    };
    update_settings(&app, &lock.0, move |settings| {
        if let Some(obj) = settings.as_object_mut() {
            obj.insert("pendingRename".to_string(), new_value);
            true
        } else {
            false
        }
    })?;
    Ok(())
}

/// Retrieve the last opened project root folder (stored in app config).
#[tauri::command]
fn get_last_root_path(
    app: AppHandle,
    lock: State<'_, SettingsLock>,
) -> Result<Option<String>, String> {
    let v = read_settings(&app, &lock.0)?;
    let result = v["lastRootPath"].as_str().map(|s| frontend_path(Path::new(s)));

    // XSS mitigation (unchanged): lastRootPath is attacker-controllable via
    // set_last_root_path. Validate against trustedRoots before granting scope.
    if let Some(ref saved_path) = result {
        if let Ok(canonical) = std::path::PathBuf::from(saved_path).canonicalize() {
            let is_trusted = v["trustedRoots"]
                .as_array()
                .map(|arr| arr.iter().any(|item| {
                    item.as_str()
                        .and_then(|s| std::path::PathBuf::from(s).canonicalize().ok())
                        .map(|c| c == canonical)
                        .unwrap_or(false)
                }))
                .unwrap_or(false);

            if is_trusted && canonical.is_dir() {
                let _ = app.asset_protocol_scope().allow_directory(&canonical, true);
            }
        }
    }
    Ok(result)
}

/// Persist the last opened project root folder.
#[tauri::command]
fn set_last_root_path(
    app: AppHandle,
    path: Option<String>,
    lock: State<'_, SettingsLock>,
) -> Result<(), String> {
    let new_value = match path {
        Some(p) => serde_json::Value::String(p),
        None    => serde_json::Value::Null,
    };
    update_settings(&app, &lock.0, move |settings| {
        if let Some(obj) = settings.as_object_mut() {
            obj.insert("lastRootPath".to_string(), new_value);
            true
        } else {
            false
        }
    })?;
    Ok(())
}

/// Retrieve the project history list (stored in app config as a JSON array).
#[tauri::command]
fn get_project_history(
    app: AppHandle,
    lock: State<'_, SettingsLock>,
) -> Result<Vec<serde_json::Value>, String> {
    let v = read_settings(&app, &lock.0)?;
    Ok(v["projectHistory"].as_array().cloned().unwrap_or_default())
}


/// Persist the project history list (receives a JSON-encoded string from JS).
#[tauri::command]
fn set_project_history(
    app: AppHandle,
    history: String,
    lock: State<'_, SettingsLock>,
) -> Result<(), String> {
    // Parse the incoming JSON-encoded string OUTSIDE the mutator so that a
    // malformed payload doesn't trigger a settings write at all.
    let parsed: serde_json::Value =
        serde_json::from_str(&history).unwrap_or(serde_json::json!([]));

    update_settings(&app, &lock.0, move |settings| {
        if let Some(obj) = settings.as_object_mut() {
            obj.insert("projectHistory".to_string(), parsed);
            true
        } else {
            false
        }
    })?;
    Ok(())
}


/// Reveal a file or folder in the OS file manager.
///   macOS   → `open -R <path>`   (Finder, item selected)
///   Windows → `explorer /select,<path>`
///   Linux   → `xdg-open <parent-dir>`  (no universal "select" API)
#[tauri::command]
 fn show_in_folder(path: String, root_state: State<'_, RootPath>) -> Result<(), String> {
    let root = get_root(&root_state)?;
    let p = safe_path_inside(&path, &root)?;


    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&p)
            .spawn()
            .map_err(|e| format!("open -R failed: {e}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        // /select, highlights the item inside Explorer
        let select_arg = format!("/select,{}", p.display());
        std::process::Command::new("explorer")
            .arg(&select_arg)
            .spawn()
            .map_err(|e| format!("explorer /select failed: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        // xdg-open doesn't support item selection; open the parent directory
        let parent = p.parent().unwrap_or(p.as_path());
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("xdg-open failed: {e}"))?;
    }

    Ok(())
}


/// Return the app data directory path (for diagnostics).
#[tauri::command]
 fn get_app_data_path(app: AppHandle) -> Result<String, String> {
    app.path().app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("No app data dir: {e}"))
}


/// Return the default notes folder path (~/Documents/revery_notebook_notes)
/// and ensure it exists on disk.
#[tauri::command]
 fn get_default_notes_folder(app: AppHandle, lock: State<'_, SettingsLock>) -> Result<String, String> {
    let docs = app.path().document_dir()
        .map_err(|e| format!("Cannot locate Documents dir: {e}"))?;
    let notes = docs.join("revery_notebook_notes");
    fs::create_dir_all(&notes)
        .map_err(|e| format!("Cannot create default notes folder: {e}"))?;

    if let Ok(canonical) = notes.canonicalize() {
            let _ = app.asset_protocol_scope().allow_directory(&canonical, true);

            // Register this backend-generated path as a trusted root through the
            // settings chokepoint. The previous raw fs::read_to_string fell back
            // to {} on corruption (destroying lastOpenedFile / lastRootPath /
            // projectHistory) and never refreshed .bak afterwards — both fixed
            // by routing through update_settings.
            let new_trust = notes.to_string_lossy().into_owned();
            let _ = update_settings(&app, &lock.0, move |settings| {
                let mut trusted = settings["trustedRoots"]
                    .as_array().cloned().unwrap_or_default();
                let path_val = serde_json::Value::String(new_trust);
                if trusted.contains(&path_val) {
                    return false;
                }
                trusted.push(path_val);
                if let Some(obj) = settings.as_object_mut() {
                    obj.insert(
                        "trustedRoots".to_string(),
                        serde_json::Value::Array(trusted),
                    );
                }
                true
            });
        }
    Ok(notes.to_string_lossy().into_owned())
}


/* ── Window control commands ─────────────────────────────────────────────
   These back NativeAPI.minimizeWindow / toggleMaximizeWindow / closeWindow
   in native_api.js.  The close command re-enters the existing CloseRequested
   flow so the frontend's quit-confirmation modal still fires.             */

/// Minimize the main window to the taskbar / dock.
#[tauri::command]
 fn minimize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| format!("Minimize failed: {e}"))
}

/// Toggle between maximized and restored state.
#[tauri::command]
 fn toggle_maximize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|e| format!("is_maximized failed: {e}"))? {
        window.unmaximize().map_err(|e| format!("Unmaximize failed: {e}"))
    } else {
        window.maximize().map_err(|e| format!("Maximize failed: {e}"))
    }
}

/* ── The OS asks the app to quit (Linux, macOS) ─────────────────────────
   SIGTERM (logging out, shutting down, `kill`), SIGHUP (the terminal that
   started the app closed) and SIGINT (Ctrl+C) used to end the process at
   once: typing from the last moments (autosave runs 1.5 s after the last
   keystroke) was lost, without a crash backup. They now start the normal
   close, exactly like the window's close button: the page saves, keeps a
   crash backup of anything it could not save, then confirms
   (confirm_close). The close watchdog covers a page that does not answer.
   Electron behaves the same way on its own. Signals arriving while that
   close runs are ignored — the session manager's SIGKILL after its
   timeout stays the last resort, so nothing is cut short mid-save. No
   window (yet, or any more): nothing can be unsaved — exit at once. */
#[cfg(unix)]
fn close_on_quit_signals(app: AppHandle) {
    use tokio::signal::unix::{signal, SignalKind};
    tauri::async_runtime::spawn(async move {
        let (mut term, mut hup, mut int) = match (
            signal(SignalKind::terminate()),
            signal(SignalKind::hangup()),
            signal(SignalKind::interrupt()),
        ) {
            (Ok(t), Ok(h), Ok(i)) => (t, h, i),
            _ => {
                // Handlers not installed: the signals keep their default
                // action (the OS ends the app as before).
                eprintln!("[revery] could not watch quit signals");
                return;
            }
        };
        let mut closing = false;
        loop {
            tokio::select! {
                _ = term.recv() => {}
                _ = hup.recv() => {}
                _ = int.recv() => {}
            }
            if closing {
                eprintln!("[revery] quit signal ignored: the close is already running");
                continue;
            }
            closing = true;
            match app.get_webview_window("main") {
                Some(w) => {
                    if let Err(e) = w.close() {
                        eprintln!("[revery] close on quit signal failed ({e}); exiting");
                        app.exit(0);
                    }
                }
                None => app.exit(0),
            }
        }
    });
}

/// Request a window close.  Because CloseAllowed is still false this re-enters
/// on_window_event → CloseRequested → emits 'window-close-request' to the
/// frontend, which shows the quit-confirmation modal just like the OS button.
#[tauri::command]
 fn close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| format!("Close failed: {e}"))
}

/// Enter or exit native OS fullscreen mode.
/// Called from the frontend on F11 / Escape.
#[tauri::command]
 fn set_fullscreen(window: tauri::WebviewWindow, fullscreen: bool) -> Result<(), String> {
    window
        .set_fullscreen(fullscreen)
        .map_err(|e| format!("set_fullscreen failed: {e}"))
}



/// Reduce a dropped file's name to a safe basename (no path components).
fn sanitize_drop_filename(raw: &str) -> Result<String, String> {
    // Strip any directory parts a malicious drag might smuggle in.
    let base = raw.rsplit(|c| c == '/' || c == '\\').next().unwrap_or("").trim();
    if base.is_empty() || base == "." || base == ".." {
        return Err("Invalid file name".into());
    }
    if base.contains('\0') {
        return Err("File name contains null byte".into());
    }
    if base.chars().any(|c| c.is_control()) {
        return Err("File name contains control characters".into());
    }
    Ok(base.to_string())
}

/// Split "name.ext" → ("name", ".ext"). Dotfiles (".gitignore") have no ext.
fn split_name_ext(name: &str) -> (String, String) {
    match name.rfind('.') {
        Some(idx) if idx > 0 => (name[..idx].to_string(), name[idx..].to_string()),
        _ => (name.to_string(), String::new()),
    }
}

/// Copy a dropped file's bytes (base64) into `dest_dir` inside the root.
/// Never overwrites: a colliding name auto-increments to "name (1).ext".
/// Returns the file name actually written.
#[tauri::command]
async fn copy_into_folder(
    dest_dir: String,
    filename: String,
    content_b64: String,
    root_state: State<'_, RootPath>,
) -> Result<serde_json::Value, String> {
    let root = get_root(&root_state)?;
    tokio::task::spawn_blocking(move || copy_into_folder_blocking(dest_dir, filename, content_b64, root))
        .await
        .map_err(|e| format!("Background copy task failed: {e}"))?
}

fn copy_into_folder_blocking(
    dest_dir: String,
    filename: String,
    content_b64: String,
    root: PathBuf,
) -> Result<serde_json::Value, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let dir = safe_path_inside(&dest_dir, &root)?;
    if !dir.is_dir() {
        return Err(format!("Destination is not a folder: {}", dir.display()));
    }

    let name = sanitize_drop_filename(&filename)?;

    // Cheap guard before allocating the decoded buffer (b64 ≈ 1.33× bytes).
    if content_b64.len() as u64 > 28 * 1024 * 1024 {
        return Err("File too large. Max is 20 MB.".into());
    }
    let bytes = STANDARD
        .decode(content_b64.as_bytes())
        .map_err(|e| format!("Could not decode file data: {e}"))?;
    if bytes.len() as u64 > 20 * 1024 * 1024 {
        return Err(format!(
            "File too large ({:.1} MB). Max is 20 MB.",
            bytes.len() as f64 / 1024.0 / 1024.0
        ));
    }

    let (base, ext) = split_name_ext(&name);

    // Atomically claim a unique name with O_EXCL (create_new) — race-free.
    let mut counter = 0usize;
    let final_path;
    let mut file;
    loop {
        let candidate_name = if counter == 0 {
            name.clone()
        } else {
            format!("{base} ({counter}){ext}")
        };
        // Defense in depth: re-validate the assembled path stays in root.
        let checked = safe_path_inside(&dir.join(&candidate_name).to_string_lossy(), &root)?;
        match fs::OpenOptions::new().write(true).create_new(true).open(&checked) {
            Ok(f) => { file = f; final_path = checked; break; }
            Err(ref e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                counter += 1;
                if counter > 9999 {
                    return Err("Too many name collisions in destination folder".into());
                }
            }
            Err(e) => return Err(format!("Cannot create file: {e}")),
        }
    }

    // Write durably. On failure, remove the brand-new partial file — since it
    // was just created with O_EXCL, deleting it can never lose existing data.
    let result = (|| -> Result<(), String> {
        file.write_all(&bytes).map_err(|e| format!("Write failed: {e}"))?;
        file.sync_all().map_err(|e| format!("Sync failed: {e}"))?;
        Ok(())
    })();
    if let Err(e) = result {
        drop(file);
        let _ = fs::remove_file(&final_path);
        return Err(e);
    }
    drop(file);
    sync_parent_dir(&final_path);

    let final_name = final_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or(name);
    Ok(serde_json::json!({ "name": final_name, "path": frontend_path(&final_path) }))
}


/// Copy an existing on-disk file (dropped via Tauri's native drag-drop, which
/// gives absolute source paths) into `dest_dir` inside the root. The source
/// may live anywhere; only the DESTINATION is jailed to the root. Never
/// overwrites — collisions auto-increment to "name (1).ext".
#[tauri::command]
async fn copy_path_into_folder(
    src_path: String,
    dest_dir: String,
    root_state: State<'_, RootPath>,
) -> Result<serde_json::Value, String> {
    let root = get_root(&root_state)?;
    tokio::task::spawn_blocking(move || copy_path_into_folder_blocking(src_path, dest_dir, root))
        .await
        .map_err(|e| format!("Background copy task failed: {e}"))?
}

fn copy_path_into_folder_blocking(
    src_path: String,
    dest_dir: String,
    root: PathBuf,
) -> Result<serde_json::Value, String> {
    let dir = safe_path_inside(&dest_dir, &root)?;
    if !dir.is_dir() {
        return Err(format!("Destination is not a folder: {}", dir.display()));
    }

    // Source: arbitrary location, but must exist and be a regular file.
    let src = std::path::PathBuf::from(&src_path);
    let meta = fs::metadata(&src).map_err(|e| format!("Cannot read source: {e}"))?;
    if !meta.is_file() {
        return Err(format!("Not a file (folders can't be dropped): {}", src.display()));
    }
    if meta.len() > 20 * 1024 * 1024 {
        return Err(format!(
            "File too large ({:.1} MB). Max is 20 MB.",
            meta.len() as f64 / 1024.0 / 1024.0
        ));
    }

    let raw_name = src
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or_else(|| "Source has no file name".to_string())?;
    let name = sanitize_drop_filename(&raw_name)?;
    let (base, ext) = split_name_ext(&name);

    let bytes = fs::read(&src).map_err(|e| format!("Read failed: {e}"))?;

    // Atomically claim a unique name with O_EXCL — race-free, never overwrites.
    let mut counter = 0usize;
    let final_path;
    let mut file;
    loop {
        let candidate_name = if counter == 0 {
            name.clone()
        } else {
            format!("{base} ({counter}){ext}")
        };
        let checked = safe_path_inside(&dir.join(&candidate_name).to_string_lossy(), &root)?;
        match fs::OpenOptions::new().write(true).create_new(true).open(&checked) {
            Ok(f) => { file = f; final_path = checked; break; }
            Err(ref e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                counter += 1;
                if counter > 9999 {
                    return Err("Too many name collisions in destination folder".into());
                }
            }
            Err(e) => return Err(format!("Cannot create file: {e}")),
        }
    }

    let result = (|| -> Result<(), String> {
        file.write_all(&bytes).map_err(|e| format!("Write failed: {e}"))?;
        file.sync_all().map_err(|e| format!("Sync failed: {e}"))?;
        Ok(())
    })();
    if let Err(e) = result {
        drop(file);
        let _ = fs::remove_file(&final_path);
        return Err(e);
    }
    drop(file);
    sync_parent_dir(&final_path);

    let final_name = final_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or(name);
    Ok(serde_json::json!({ "name": final_name, "path": frontend_path(&final_path) }))
}









/* ══════════════════════════════════════════════════════════════════════════
   MAIN ENTRY POINT
══════════════════════════════════════════════════════════════════════════ */
struct SettingsLock(Mutex<()>);


#[cfg(target_os = "linux")]
fn needs_webkit_sandbox_disable() -> bool {
    std::fs::read_to_string("/proc/sys/kernel/apparmor_restrict_unprivileged_userns")
        .map(|s| s.trim() == "1")
        .unwrap_or(false)
}


/// Deletes volatile crash-backup pairs older than 7 days.
/// Mirrors Electron's `purgeOldVolatileFiles()` in main.js.
/// Called once at startup (deferred 5 s) so the renderer's crash-recovery
/// check has time to consume recent backups before this runs.
fn purge_old_volatile_files(app: &AppHandle) {
    // The last opened file's backup is exempt: the renderer's boot recovery
    // offers exactly that one, and this purge runs on a timer, not after it.
    // Mirrors Electron's purgeOldVolatileFiles keep list.
    let keep: Vec<String> = read_settings(app, &app.state::<SettingsLock>().0)
        .ok()
        .and_then(|v| v["lastOpenedFile"].as_str().map(|s| s.to_string()))
        .into_iter()
        .collect();
    // backup_dirs() only returns directories that passed their safety check —
    // never enumerate or delete inside a dir we don't own.
    for dir in backup_dirs(app) {
        purge_backups_in(dir, &keep);
    }
}

fn purge_backups_in(volatile_dir: &Path, keep: &[String]) {
    let entries = match fs::read_dir(volatile_dir) {
        Ok(e)  => e,
        Err(_) => return,
    };

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    const MAX_AGE_MS: u64 = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

    for entry in entries.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().into_owned();

        // Only inspect meta files; skip data files and in-progress .tmp files.
        // The paired .revery_volatile data file is derived from the meta name.
        if !name.ends_with(".meta.json") {
            continue;
        }

        let meta_file = entry.path();
        let data_file = volatile_dir.join(name.replace(".meta.json", ".revery_volatile"));

        let _guard = VOLATILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        // Parse meta — skip this pair on any read/parse error. Never delete
        // a file we cannot positively identify as an old Revery backup.
        let meta: serde_json::Value = match fs::read_to_string(&meta_file)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
        {
            Some(v) => v,
            None    => continue,
        };

        let ts = match meta["ts"].as_u64() {
            Some(t) => t,
            None    => continue, // Malformed ts — leave it alone
        };

        if now_ms.saturating_sub(ts) < MAX_AGE_MS {
            continue; // Young enough — leave it alone.
        }

        if let Some(op) = meta["originalPath"].as_str() {
            if keep.iter().any(|k| k == op) {
                continue; // Pending recovery offer — leave it alone.
            }
        }

        let _ = fs::remove_file(&meta_file);
        let _ = fs::remove_file(&data_file);
    }
}


/// Returns whether the volatile directory passed its startup safety check.
/// On false, `error` describes why — surfaced in the renderer's status badge.
#[derive(Serialize)]
struct VolatileStatus {
    ready: bool,
    error: Option<String>,
}

#[tauri::command]
fn get_volatile_status() -> VolatileStatus {
    match prepare_volatile_dir() {
        Ok(_)  => VolatileStatus { ready: true,  error: None },
        Err(e) => VolatileStatus { ready: false, error: Some(e.to_string()) },
    }
}

/// One entry returned by list_volatile_backups.
#[derive(Serialize)]
struct VolatileBackupInfo {
    #[serde(rename = "originalPath")]
    original_path: String,
    ts: u64,
}


#[tauri::command]
async fn list_volatile_backups(app: AppHandle, prefix: String) -> Vec<VolatileBackupInfo> {
    tokio::task::spawn_blocking(move || list_volatile_backups_blocking(&app, &prefix))
        .await
        .unwrap_or_else(|e| {
            eprintln!("[revery] backup listing task failed: {e}");
            Vec::new()
        })
}

fn list_volatile_backups_blocking(app: &AppHandle, prefix: &str) -> Vec<VolatileBackupInfo> {
    if prefix.is_empty() {
        return Vec::new();
    }
    let _guard = VOLATILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    // Merge every backup location, keeping only the newest entry per
    // originalPath (a file can have both a volatile and a durable snapshot).
    let mut by_path: HashMap<String, u64> = HashMap::new();
    for dir in backup_dirs(app) {
        for info in list_backups_from(dir, prefix) {
            let e = by_path.entry(info.original_path).or_insert(0);
            if info.ts > *e {
                *e = info.ts;
            }
        }
    }
    let mut out: Vec<VolatileBackupInfo> = by_path
        .into_iter()
        .map(|(original_path, ts)| VolatileBackupInfo { original_path, ts })
        .collect();
    out.sort_by(|a, b| b.ts.cmp(&a.ts)); // newest first
    out
}

fn main() {
    // Prevent silent WebKit2GTK crashes on Linux (Wayland / Nvidia setups)
    if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
    // Disable the WebKit sandbox ONLY when AppArmor is actively restricting
    // unprivileged user namespaces (Ubuntu 24.04+, Mint 22+). On every other
    // Linux system the sandbox works correctly and stays on. On macOS and
    // Windows this env var is ignored, but we cfg-gate it for clarity.
    // The user can still override (in either direction) by setting the var
    // before launch — we only touch it if it's currently unset.
    #[cfg(target_os = "linux")]
    {
        if std::env::var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS").is_err()
            && needs_webkit_sandbox_disable()
        {
            std::env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");
            eprintln!(
                "[revery] AppArmor is restricting unprivileged user namespaces; \
                 disabling the WebKit sandbox so the app can launch. Consider \
                 installing an AppArmor profile to restore sandboxing."
            );
        }
    }      
    // Fixes blank screen/silent crashes on newer Linux distros (Ubuntu 24.04 / Mint 22+)
    if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    // Force X11 backend – avoids Wayland compatibility issues on Cinnamon/Mint
    if std::env::var("GDK_BACKEND").is_err() {
        std::env::set_var("GDK_BACKEND", "x11");
    }
    // Disable Wayland in WebKit itself (additional safeguard)
    if std::env::var("WEBKIT_DISABLE_WAYLAND").is_err() {
        std::env::set_var("WEBKIT_DISABLE_WAYLAND", "1");
    }

tauri::Builder::default()
        /* ── Single instance ── (registered first, per plugin docs)
           Two instances would be two autosave writers and two file
           watchers on the same project. A second launch exits itself and
           this callback brings the existing window to front instead.    */
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        /* ── Navigation guard ── (see is_allowed_navigation above)
           A plugin's on_navigation hook applies to every webview, including
           the config-created main window, which WebviewWindowBuilder's own
           hook cannot reach. Returning false cancels the navigation.      */
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("navigation-guard")
                .on_navigation(|_webview, url| {
                    let allowed = is_allowed_navigation(url);
                    if !allowed {
                        eprintln!("[revery] Blocked navigation to external URL: {url}");
                    }
                    allowed
                })
                .build(),
        )

        /* ── Managed state ── */
        .manage(WatcherState::default())
        .manage(CloseAllowed(Mutex::new(false)))
        .manage(CloseWatch::default())
        .manage(RootPath(Mutex::new(None)))
        .manage(SettingsLock(Mutex::new(())))
        /* ── Window close interception ── */
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Only the main window drives the quit-confirmation flow.
                // Auxiliary windows (e.g. the PDF print window) must close
                // freely — otherwise afterprint / their title-bar X would be
                // prevented and would spuriously fire the quit modal.
                if window.label() != "main" {
                    return;
                }
                let close_allowed = window.state::<CloseAllowed>();
                if !*close_allowed.0.lock().unwrap_or_else(|p| p.into_inner()) {
                    api.prevent_close();
                    // Signal the frontend, and arm the close watchdog: a page
                    // that is hung or whose web process died never answers.
                    let generation = window.state::<CloseWatch>()
                        .requested.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                    let _ = window.emit("window-close-request", ());
                    arm_close_watchdog(window.app_handle().clone(), generation);
                }
            }
        })

        /* ── Command handlers ── */
 .invoke_handler(tauri::generate_handler![
            open_folder_dialog,
            set_root_path,   
            read_directory,
            read_file,
            write_file,
            create_file,
            create_directory,
            rename_node,
            canonical_entry_path,
            delete_node,
            copy_into_folder,
            copy_path_into_folder,
            set_volatile_content,
            set_durable_backup,
            get_volatile_content,
            delete_volatile_content,
            get_volatile_status,
            list_volatile_backups,
            save_file,
            export_project_zip,
            export_latex_zip,
            list_system_fonts,
            show_message_box,
            confirm_close,
            close_request_ack,
            close_flow_failed,
            watch_file,
            unwatch_file,
            get_last_opened_file,
            set_last_opened_file,
            clear_all_settings,
            get_pending_rename,
            set_pending_rename,
            get_last_root_path,
            set_last_root_path,
            get_project_history,
            set_project_history,
            get_app_data_path,
            get_default_notes_folder,
            show_in_folder,
            minimize_window,
            toggle_maximize_window,
            close_window,
            set_fullscreen,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            
            #[cfg(target_os = "macos")]
            {
                let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
            }
            
            #[cfg(not(target_os = "macos"))]
            {
                let _ = window.set_decorations(false);
            }

            // Logging out / shutting down closes like the close button.
            #[cfg(unix)]
            close_on_quit_signals(app.handle().clone());

            // Purge crash-backups (volatile AND durable) older than 7 days.
            let purge_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                // Offload the synchronous file I/O to a blocking thread
                tokio::task::spawn_blocking(move || {
                    purge_old_volatile_files(&purge_handle);
                }).await.unwrap();
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error while running Revery Notebook (Tauri)");
}
/* ══════════════════════════════════════════════════════════════════════════
   TESTS — pure helpers only (no Tauri runtime required).
   Run with: cargo test --manifest-path tauri/Cargo.toml
══════════════════════════════════════════════════════════════════════════ */
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Fresh unique directory under the OS temp dir for each test.
    fn test_dir(label: &str) -> PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "revery-rs-test-{}-{}-{}",
            std::process::id(),
            label,
            n
        ));
        fs::create_dir_all(&dir).expect("create test dir");
        dir
    }

    /* ── frontend_path / strip_verbatim_prefix ─────────────────────── */

    #[test]
    fn verbatim_drive_prefix_is_stripped() {
        assert_eq!(strip_verbatim_prefix(r"\\?\C:\Users\h\notes\a.png"), r"C:\Users\h\notes\a.png");
        assert_eq!(strip_verbatim_prefix(r"\\?\d:\x"), r"d:\x");
        assert_eq!(strip_verbatim_prefix(r"\\?\C:"), "C:");
    }

    #[test]
    fn verbatim_unc_prefix_becomes_plain_unc() {
        assert_eq!(strip_verbatim_prefix(r"\\?\UNC\server\share\a.png"), r"\\server\share\a.png");
    }

    #[test]
    fn non_plain_verbatim_paths_are_left_alone() {
        // No plain-path spelling exists for these; stripping would corrupt them.
        let vol = r"\\?\Volume{b75e2c83-0000-0000-0000-602f00000000}\x";
        assert_eq!(strip_verbatim_prefix(vol), vol);
        assert_eq!(strip_verbatim_prefix(r"\\?\pipe\name"), r"\\?\pipe\name");
    }

    #[test]
    fn ordinary_paths_are_unchanged() {
        assert_eq!(strip_verbatim_prefix(r"C:\Users\h\a.png"), r"C:\Users\h\a.png");
        assert_eq!(strip_verbatim_prefix(r"\\server\share\a.png"), r"\\server\share\a.png");
        assert_eq!(strip_verbatim_prefix("/home/u/notes/a.png"), "/home/u/notes/a.png");
        assert_eq!(strip_verbatim_prefix(""), "");
    }

    #[test]
    fn frontend_path_is_identity_for_plain_paths_on_every_os() {
        let p = Path::new("/home/u/notes/a.png");
        assert_eq!(frontend_path(p), p.to_string_lossy());
    }

    #[test]
    fn frontend_path_round_trips_through_read_dir() {
        // The invariant the renderer relies on: an entry listed by
        // read_directory equals dir + name in ordinary spelling.
        let root = test_dir("frontend-path");
        fs::write(root.join("a.md"), "x").unwrap();
        let canonical_root = root.canonicalize().unwrap();
        let entry = fs::read_dir(&canonical_root).unwrap().next().unwrap().unwrap();
        let shown = frontend_path(&entry.path());
        assert!(!shown.starts_with(r"\\?\"), "{shown}");
        assert!(shown.ends_with("a.md"), "{shown}");
        fs::remove_dir_all(&root).ok();
    }

    /* ── safe_path ─────────────────────────────────────────────────── */

    #[test]
    fn safe_path_rejects_empty() {
        assert!(safe_path("").is_err());
    }

    #[test]
    fn safe_path_rejects_null_byte() {
        assert!(safe_path("/tmp/a\0b").is_err());
    }

    #[test]
    fn safe_path_accepts_normal_paths() {
        assert_eq!(safe_path("/tmp/x.md").unwrap(), PathBuf::from("/tmp/x.md"));
    }

    /* ── safe_path_inside ──────────────────────────────────────────── */

    #[test]
    fn inside_accepts_existing_file_in_root() {
        let root = test_dir("inside-ok");
        let file = root.join("note.md");
        fs::write(&file, "x").unwrap();
        let got = safe_path_inside(file.to_str().unwrap(), &root).unwrap();
        assert_eq!(got, root.canonicalize().unwrap().join("note.md"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn inside_accepts_new_nested_path() {
        let root = test_dir("inside-nested");
        let target = root.join("new_a").join("new_b").join("note.md");
        let got = safe_path_inside(target.to_str().unwrap(), &root).unwrap();
        assert!(got.starts_with(root.canonicalize().unwrap()));
        assert!(got.ends_with(Path::new("new_a/new_b/note.md")));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn inside_rejects_dotdot_escape() {
        let root = test_dir("inside-escape");
        let evil = format!("{}/../evil.md", root.to_str().unwrap());
        assert!(safe_path_inside(&evil, &root).is_err());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn inside_rejects_absolute_path_outside_root() {
        let root = test_dir("inside-abs");
        let outside = test_dir("inside-abs-outside");
        let target = outside.join("f.md");
        assert!(safe_path_inside(target.to_str().unwrap(), &root).is_err());
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[cfg(unix)]
    #[test]
    fn inside_rejects_symlink_escape() {
        let root = test_dir("inside-symlink");
        let outside = test_dir("inside-symlink-outside");
        let link = root.join("sneaky");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        let target = link.join("f.md");
        assert!(safe_path_inside(target.to_str().unwrap(), &root).is_err());
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    /* ── atomic_write_file ─────────────────────────────────────────── */

    #[test]
    fn atomic_write_creates_file_and_removes_tmp() {
        let dir = test_dir("aw-create");
        let dest = dir.join("note.md");
        let tmp = dir.join("note.md.test_tmp");
        atomic_write_file(&tmp, &dest, b"hello world").unwrap();
        assert_eq!(fs::read_to_string(&dest).unwrap(), "hello world");
        assert!(!tmp.exists(), "temp file must not survive a successful write");
        // No stray .revery_bak either
        let strays: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name() != "note.md")
            .collect();
        assert!(strays.is_empty(), "no leftovers expected: {strays:?}");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn atomic_write_replaces_existing_content() {
        let dir = test_dir("aw-replace");
        let dest = dir.join("note.md");
        fs::write(&dest, "OLD").unwrap();
        let tmp = dir.join("note.md.test_tmp");
        atomic_write_file(&tmp, &dest, "NEW ünïcode 📝".as_bytes()).unwrap();
        assert_eq!(fs::read_to_string(&dest).unwrap(), "NEW ünïcode 📝");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn atomic_write_fails_cleanly_when_tmp_dir_missing() {
        let dir = test_dir("aw-fail");
        let dest = dir.join("note.md");
        fs::write(&dest, "OLD").unwrap();
        // tmp in a directory that does not exist → File::create fails
        let tmp = dir.join("no-such-subdir").join("note.md.test_tmp");
        assert!(atomic_write_file(&tmp, &dest, b"NEW").is_err());
        assert_eq!(
            fs::read_to_string(&dest).unwrap(),
            "OLD",
            "failed write must leave the destination untouched"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /* ── temp_sibling / keep_permissions_of ────────────────────────── */

    #[test]
    fn temp_names_keep_a_short_whole_character_prefix() {
        let dir = test_dir("tmpname");
        let short = temp_sibling(&dir.join("note.md"), "revery_tmp");
        let s = short.file_name().unwrap().to_string_lossy().into_owned();
        assert!(s.starts_with("note.md.") && s.ends_with(".revery_tmp"), "{s}");
        // 'ab' + 3-byte characters: the 100-byte cut lands inside a character.
        for long in [format!("ab{}.md", "会".repeat(80)), format!("x{}.md", "📝".repeat(60))] {
            let t = temp_sibling(&dir.join(&long), "revery_tmp");
            let t = t.file_name().unwrap().to_string_lossy().into_owned();
            let prefix = &t[..t.find('.').unwrap()];
            assert!(prefix.len() <= TEMP_NAME_PREFIX_BYTES, "{t}");
            assert!(prefix.len() > TEMP_NAME_PREFIX_BYTES - 4, "as much as fits: {t}");
            assert!(long.starts_with(prefix), "a prefix of the name: {t}");
            assert!(t.ends_with(".revery_tmp") && t.len() < 160, "{t}");
        }
        // Two temp names for one file in the same instant never collide.
        assert_ne!(temp_sibling(&dir.join("n.md"), "revery_tmp"), temp_sibling(&dir.join("n.md"), "revery_tmp"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn atomic_write_saves_a_note_whose_name_is_near_the_limit() {
        let dir = test_dir("aw-longname");
        let dest = dir.join(format!("{}.md", "会議".repeat(38))); // 231 bytes
        fs::write(&dest, "OLD").unwrap();
        atomic_write_file(&temp_sibling(&dest, "revery_tmp"), &dest, b"NEW").unwrap();
        assert_eq!(fs::read_to_string(&dest).unwrap(), "NEW");
        let strays: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path() != dest)
            .collect();
        assert!(strays.is_empty(), "no leftovers expected: {strays:?}");
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_keeps_the_permission_bits() {
        use std::os::unix::fs::PermissionsExt;
        let dir = test_dir("aw-mode");
        let dest = dir.join("note.md");
        for mode in [0o600u32, 0o640, 0o755] {
            fs::write(&dest, "OLD").unwrap();
            fs::set_permissions(&dest, fs::Permissions::from_mode(mode)).unwrap();
            atomic_write_file(&temp_sibling(&dest, "revery_tmp"), &dest, b"NEW").unwrap();
            assert_eq!(fs::metadata(&dest).unwrap().permissions().mode() & 0o777, mode, "mode {mode:o}");
            assert_eq!(fs::read_to_string(&dest).unwrap(), "NEW");
        }
        fs::remove_dir_all(&dir).ok();
    }

    /* ── retry_rename_on_lock (atomic_write_file's publish step) ───── */

    fn failing(raws: Vec<i32>) -> impl FnMut() -> std::io::Result<()> {
        let mut left = raws.into_iter();
        move || match left.next() {
            Some(raw) => Err(std::io::Error::from_raw_os_error(raw)),
            None => Ok(()),
        }
    }

    #[test]
    fn a_brief_windows_lock_is_retried_until_the_rename_happens() {
        let mut waits = Vec::new();
        let r = retry_rename_on_lock(failing(vec![32, 5]), true, |ms| waits.push(ms));
        assert!(r.is_ok());
        assert_eq!(waits, vec![100, 200]);
    }

    #[test]
    fn a_lock_that_does_not_let_go_ends_as_a_transient_lock_error() {
        let mut waits = Vec::new();
        let err = retry_rename_on_lock(failing(vec![32; 9]), true, |ms| waits.push(ms)).unwrap_err();
        assert_eq!(waits, LOCK_RETRY_DELAYS_MS.to_vec());
        // ...which atomic_write_file reports as a failure — never a copy.
        assert_eq!(classify_rename_error(err.raw_os_error(), true), RenameErrorKind::TransientLock);
    }

    #[test]
    fn no_retry_for_windows_lock_codes_off_windows_or_for_other_errors() {
        let mut waits = Vec::new();
        assert!(retry_rename_on_lock(failing(vec![32]), false, |ms| waits.push(ms)).is_err());
        assert!(retry_rename_on_lock(failing(vec![13]), false, |ms| waits.push(ms)).is_err()); // EACCES
        assert!(retry_rename_on_lock(failing(vec![18]), false, |ms| waits.push(ms)).is_err());
        assert!(retry_rename_on_lock(failing(vec![17]), true, |ms| waits.push(ms)).is_err());
        assert!(retry_rename_on_lock(failing(vec![16]), true, |ms| waits.push(ms)).is_err());
        assert!(waits.is_empty());
    }

    #[test]
    fn ebusy_off_windows_is_retried_like_a_windows_lock() {
        // Linux/macOS SMB client: the server refuses a file open elsewhere.
        let mut waits = Vec::new();
        assert!(retry_rename_on_lock(failing(vec![16, 16]), false, |ms| waits.push(ms)).is_ok());
        assert_eq!(waits, vec![100, 200]);
        waits.clear();
        let err = retry_rename_on_lock(failing(vec![16; 9]), false, |ms| waits.push(ms)).unwrap_err();
        assert_eq!(waits, LOCK_RETRY_DELAYS_MS.to_vec());
        assert_eq!(classify_rename_error(err.raw_os_error(), false), RenameErrorKind::TransientLock);
    }

    /* ── is_allowed_navigation ─────────────────────────────────────── */

    fn nav(url: &str) -> bool {
        is_allowed_navigation(&tauri::Url::parse(url).unwrap())
    }

    #[test]
    fn navigation_allows_own_origins() {
        assert!(nav("tauri://localhost/index.html")); // Linux/macOS prod
        assert!(nav("http://tauri.localhost/index.html")); // Windows prod
        assert!(nav("https://tauri.localhost/index.html"));
        assert!(nav("http://localhost:1420/")); // devUrl
        assert!(nav("about:blank")); // transient WebView2 init
    }

    #[test]
    fn navigation_blocks_external_urls() {
        assert!(!nav("https://example.com/"));
        assert!(!nav("http://example.com/phish"));
        assert!(!nav("https://localhost.evil.com/"));
        assert!(!nav("http://localhost:8080/")); // wrong port
        assert!(!nav("http://localhost/")); // no port
    }

    #[test]
    fn navigation_blocks_non_web_schemes() {
        assert!(!nav("file:///etc/passwd"));
        assert!(!nav("javascript:alert(1)"));
        assert!(!nav("data:text/html,<h1>x</h1>"));
        assert!(!nav("asset://localhost/some/file.png")); // subresource-only scheme
        assert!(!nav("about:config"));
    }

    /* ── zip project export ────────────────────────────────────────── */

    fn zip_fixture(label: &str) -> PathBuf {
        let root = test_dir(label);
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::create_dir_all(root.join("empty")).unwrap();
        fs::write(root.join("note.md"), "# Hello\n\nworld").unwrap();
        fs::write(root.join("sub/inner.md"), "nested content").unwrap();
        fs::write(root.join("sub/ÅÄÖ anteckning.md"), "åäö unicode").unwrap();
        root
    }

    #[test]
    fn zip_roundtrip_preserves_files_and_empty_dirs() {
        let root = zip_fixture("zip-roundtrip");
        let (bytes, entries, total) = build_project_zip(&root, None).unwrap();
        assert_eq!(entries, 5); // 2 dirs + 3 files
        assert!(total > 0);

        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(names.contains(&"empty/".to_string()), "empty dir preserved: {names:?}");
        assert!(names.contains(&"sub/ÅÄÖ anteckning.md".to_string()), "utf-8 name: {names:?}");

        use std::io::Read;
        let mut content = String::new();
        archive.by_name("sub/ÅÄÖ anteckning.md").unwrap()
            .read_to_string(&mut content).unwrap();
        assert_eq!(content, "åäö unicode");
    }

    #[cfg(unix)]
    #[test]
    fn zip_skips_symlinks() {
        let root = zip_fixture("zip-symlink");
        std::os::unix::fs::symlink("/etc/passwd", root.join("evil-link")).unwrap();
        std::os::unix::fs::symlink("/etc", root.join("evil-dir")).unwrap();
        let (bytes, entries, _) = build_project_zip(&root, None).unwrap();
        assert_eq!(entries, 5, "links must not add entries");
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        for i in 0..archive.len() {
            let name = archive.by_index(i).unwrap().name().to_string();
            assert!(!name.contains("evil"), "symlink leaked into archive: {name}");
        }
    }

    #[test]
    fn zip_excludes_destination_inside_project() {
        let root = zip_fixture("zip-exclude");
        let dest = root.join("export.zip");
        fs::write(&dest, "pretend older export").unwrap();
        let (bytes, entries, _) = build_project_zip(&root, Some(dest.as_path())).unwrap();
        assert_eq!(entries, 5, "the destination zip itself must be excluded");
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        for i in 0..archive.len() {
            let name = archive.by_index(i).unwrap().name().to_string();
            assert_ne!(name, "export.zip");
        }
    }

    #[test]
    fn zip_from_entries_roundtrip_with_auto_dirs() {
        let entries = vec![
            ("main.tex".to_string(), b"\\documentclass{article}".to_vec()),
            ("images/pic one.png".to_string(), vec![0x89, 0x50, 0x4E, 0x47]),
        ];
        let bytes = build_zip_from_entries(&entries).unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(names.contains(&"images/".to_string()), "{names:?}");
        assert!(names.contains(&"main.tex".to_string()));
        use std::io::Read;
        let mut tex = String::new();
        archive.by_name("main.tex").unwrap().read_to_string(&mut tex).unwrap();
        assert!(tex.starts_with("\\documentclass"));
    }

    #[test]
    fn zip_from_entries_rejects_unsafe_names() {
        assert!(build_zip_from_entries(&[("../evil".to_string(), vec![1])]).is_err());
        assert!(build_zip_from_entries(&[("/abs".to_string(), vec![1])]).is_err());
    }

    /* Backups must carry REAL modification times (the sidebar sorts by
       mtime — restoring a backup stamped with the zip crate's 1980 epoch
       default would scramble that order). The fixture files were written
       moments ago, so their entries must carry a current-era year, both
       for the project walk (real file mtimes) and the in-memory entries
       zip (stamped "now", parity with the Electron exporter). */
    #[test]
    fn zip_entries_carry_real_mtimes() {
        let root = zip_fixture("zip-mtime");
        let (bytes, _, _) = build_project_zip(&root, None).unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        for name in ["note.md", "sub/inner.md", "empty/"] {
            let entry = archive.by_name(name).unwrap();
            let dt = entry
                .last_modified()
                .unwrap_or_else(|| panic!("{name} has no timestamp"));
            assert!(dt.year() >= 2024, "{name} stamped {} — 1980-epoch default leaked", dt.year());
        }

        let bytes = build_zip_from_entries(&[("main.tex".to_string(), b"x".to_vec())]).unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let dt = archive.by_name("main.tex").unwrap().last_modified().unwrap();
        assert!(dt.year() >= 2024, "entries zip stamped {}", dt.year());
    }

    /* ── crash-backup primitives (shared by volatile + durable dirs) ── */

    #[test]
    fn backup_roundtrip_and_key_stability() {
        let dir = test_dir("backup-roundtrip");
        // The key must stay FNV-1a of the path — existing users' backups
        // (written by older builds with the inline hash) must stay readable.
        assert_eq!(backup_key("/home/u/note.md").len(), 16);

        write_backup_to(&dir, "/home/u/note.md", "hello world", None).unwrap();
        let (content, ts, base) = read_backup_from(&dir, "/home/u/note.md").unwrap();
        assert_eq!(content, "hello world");
        assert!(ts > 0);
        assert_eq!(base, None, "no base given → none recorded");

        // Listing sees it; a non-matching prefix filters it out.
        assert_eq!(list_backups_from(&dir, "/home/u").len(), 1);
        assert_eq!(list_backups_from(&dir, "/elsewhere").len(), 0);

        delete_backup_from(&dir, "/home/u/note.md");
        assert!(read_backup_from(&dir, "/home/u/note.md").is_none());
    }

    #[test]
    fn backup_records_the_base_it_was_edited_from() {
        let dir = test_dir("backup-base");
        let base = "v1:11:0123456789abcdef";
        write_backup_to(&dir, "/n.md", "edited text", Some(base)).unwrap();
        let (content, _, got) = read_backup_from(&dir, "/n.md").unwrap();
        assert_eq!(content, "edited text");
        assert_eq!(got.as_deref(), Some(base));
        // The meta keeps the fields every reader (and older builds) expect.
        let meta: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(dir.join(format!("{}.meta.json", backup_key("/n.md")))).unwrap(),
        ).unwrap();
        assert_eq!(meta["originalPath"], "/n.md");
        assert!(meta["ts"].as_u64().unwrap() > 0);
        assert_eq!(meta["base"], base);

        // A later write replaces the base along with the text — or drops it.
        write_backup_to(&dir, "/n.md", "newer", None).unwrap();
        let (content, _, got) = read_backup_from(&dir, "/n.md").unwrap();
        assert_eq!((content.as_str(), got), ("newer", None));

        // Nothing unusable is recorded: empty or oversized bases are dropped.
        write_backup_to(&dir, "/n.md", "x", Some("")).unwrap();
        assert_eq!(read_backup_from(&dir, "/n.md").unwrap().2, None);
        let huge = "v".repeat(201);
        write_backup_to(&dir, "/n.md", "x", Some(&huge)).unwrap();
        assert_eq!(read_backup_from(&dir, "/n.md").unwrap().2, None);

        // A backup written by an older build (meta without "base") still reads.
        fs::write(dir.join(format!("{}.meta.json", backup_key("/old.md"))),
                  r#"{"originalPath":"/old.md","ts":5}"#).unwrap();
        fs::write(dir.join(format!("{}.revery_volatile", backup_key("/old.md"))), "old text").unwrap();
        assert_eq!(read_backup_from(&dir, "/old.md"), Some(("old text".to_string(), 5, None)));
    }

    #[test]
    fn backup_dirs_are_independent() {
        // Same original path in two locations (volatile + durable in prod):
        // each dir holds its own snapshot; newest-wins merging happens in
        // the command layer on top of these primitives.
        let a = test_dir("backup-dir-a");
        let b = test_dir("backup-dir-b");
        write_backup_to(&a, "/n.md", "older", None).unwrap();
        write_backup_to(&b, "/n.md", "newer", None).unwrap();
        assert_eq!(read_backup_from(&a, "/n.md").unwrap().0, "older");
        assert_eq!(read_backup_from(&b, "/n.md").unwrap().0, "newer");
        delete_backup_from(&a, "/n.md");
        assert!(read_backup_from(&b, "/n.md").is_some(), "delete must be per-dir");
    }

    /* ── strict text read ──────────────────────────────────────────── */

    #[test]
    fn read_text_strict_refuses_non_utf8_and_leaves_file_alone() {
        let dir = test_dir("read-strict");
        let ansi = dir.join("ansi.txt");
        let bytes = [0x48u8, 0xE5, 0x6C, 0x6C, 0xF6]; // "Hållö" in Windows-1252
        fs::write(&ansi, bytes).unwrap();
        assert_eq!(read_text_strict(&ansi).unwrap_err(), NOT_UTF8_MESSAGE);
        assert_eq!(fs::read(&ansi).unwrap(), bytes, "refused file must be untouched");

        let utf16 = dir.join("utf16.txt");
        fs::write(&utf16, [0xFFu8, 0xFE, 0x48, 0x00, 0x69, 0x00]).unwrap();
        assert_eq!(read_text_strict(&utf16).unwrap_err(), NOT_UTF8_MESSAGE);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_text_strict_keeps_bom_and_crlf() {
        let dir = test_dir("read-bom");
        let bom = dir.join("bom.md");
        fs::write(&bom, b"\xEF\xBB\xBF# T\xC3\xA5\r\n").unwrap();
        assert_eq!(read_text_strict(&bom).unwrap(), "\u{FEFF}# Tå\r\n");
        assert!(read_text_strict(&dir.join("missing.md")).unwrap_err().starts_with("Read failed:"));
        fs::remove_dir_all(&dir).ok();
    }

    /* ── entries: rename / move / trash (safe_entry_inside & co.) ───── */

    /// A project under a fresh temp dir: root/real/inside.md, root/sub,
    /// root/a.md and base/outside/secret.md. Returns (base, canonical root).
    fn entry_fixture(label: &str) -> (PathBuf, PathBuf) {
        let base = test_dir(label).canonicalize().unwrap();
        let root = base.join("proj");
        fs::create_dir_all(root.join("real").join("deep")).unwrap();
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("real").join("inside.md"), "inside").unwrap();
        fs::write(root.join("a.md"), "a").unwrap();
        fs::create_dir_all(base.join("outside")).unwrap();
        fs::write(base.join("outside").join("secret.md"), "secret").unwrap();
        (base, root)
    }
    fn s(p: &Path) -> String { p.to_string_lossy().into_owned() }

    #[test]
    fn rename_target_free_taken_and_same() {
        let (base, root) = entry_fixture("rt");
        let a = root.join("a.md");
        assert_eq!(resolve_rename_target(&a, &root.join("b.md")).unwrap(), Some(root.join("b.md")));
        assert_eq!(resolve_rename_target(&a, &a).unwrap(), None);
        fs::write(root.join("b.md"), "b").unwrap();
        assert!(resolve_rename_target(&a, &root.join("b.md")).is_err());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn case_only_alias_is_decided_from_the_listing() {
        // Case-insensitive disk: one entry, any spelling → the same entry.
        assert!(case_only_alias_in_listing("notes.md", "Notes.md", &["notes.md".into()]));
        // Case-sensitive disk with two items → never the same, never overwritten.
        assert!(!case_only_alias_in_listing("Note.md", "note.md", &["Note.md".into(), "note.md".into()]));
        // Not a case-only change, or no change at all.
        assert!(!case_only_alias_in_listing("a.md", "b.md", &["a.md".into()]));
        assert!(!case_only_alias_in_listing("a.md", "a.md", &["a.md".into()]));
    }

    #[test]
    fn rename_never_targets_a_different_existing_file() {
        let (base, root) = entry_fixture("rt-clash");
        fs::write(root.join("Note.md"), "one").unwrap();
        fs::write(root.join("note.md"), "two").unwrap();
        if fs::read_to_string(root.join("Note.md")).unwrap() == "two" {
            // Case-insensitive filesystem (Windows, macOS): one file, not two.
            fs::remove_dir_all(&base).ok();
            return;
        }
        let err = rename_entry_blocking(&s(&root.join("Note.md")), &s(&root.join("note.md")), &root);
        assert!(err.is_err());
        assert_eq!(fs::read_to_string(root.join("note.md")).unwrap(), "two");
        assert_eq!(fs::read_to_string(root.join("Note.md")).unwrap(), "one");
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn classify_rename_error_pins_the_errno_17_bug() {
        // Unix 17 is EEXIST — NOT cross-device (the old code copied into the
        // existing folder, then deleted the original).
        assert_eq!(classify_rename_error(Some(17), false), RenameErrorKind::Other);
        assert_eq!(classify_rename_error(Some(18), false), RenameErrorKind::CrossDevice);
        assert_eq!(classify_rename_error(Some(17), true), RenameErrorKind::CrossDevice);
        assert_eq!(classify_rename_error(Some(18), true), RenameErrorKind::Other);
        assert_eq!(classify_rename_error(Some(32), true), RenameErrorKind::TransientLock);
        assert_eq!(classify_rename_error(Some(5), true), RenameErrorKind::TransientLock);
        assert_eq!(classify_rename_error(Some(32), false), RenameErrorKind::Other);
        assert_eq!(classify_rename_error(Some(16), false), RenameErrorKind::TransientLock);
        assert_eq!(classify_rename_error(Some(16), true), RenameErrorKind::Other);
        assert_eq!(classify_rename_error(Some(13), false), RenameErrorKind::Other);
        assert_eq!(classify_rename_error(None, false), RenameErrorKind::Other);
        #[cfg(unix)]
        {
            assert_eq!(libc::EXDEV, 18);
            assert_eq!(libc::EEXIST, 17);
            assert_eq!(libc::EBUSY, 16);
            assert_eq!(libc::EACCES, 13);
        }
    }

    #[test]
    fn check_entry_name_matches_the_renderer_rule() {
        for ok in ["notes.md", "Meeting 26.09.2026.md", "README", "con-notes.md", "Ärende.md"] {
            assert_eq!(check_entry_name(ok), None, "{ok}");
        }
        let cases: &[(&str, &str)] = &[
            ("", "empty"), ("  ", "empty"), (".", "invalid"), ("..", "invalid"), ("a/b", "invalid"),
            ("a\\b", "invalid"), ("x\u{1}", "invalid"), (".hidden", "hidden"), ("notes.", "edge"),
            ("notes ", "edge"), (" x", "edge"), ("CON", "device"), ("aux.md", "device"),
            ("com\u{b9}", "device"), ("conout$", "device"), ("nul.tar.gz", "device"), ("lpt9", "device"),
            ("x.revery_tmp", "internal"), ("x.REVERY_BAK", "internal"),
        ];
        for (name, why) in cases {
            assert_eq!(check_entry_name(name), Some(*why), "{name:?}");
        }
        assert_eq!(check_entry_name(&"a".repeat(255)), None);
        assert_eq!(check_entry_name(&"a".repeat(256)), Some("long"));
        assert_eq!(check_entry_name(&"å".repeat(128)), Some("long"));
    }

    #[test]
    fn root_and_outside_are_never_entries() {
        let (base, root) = entry_fixture("entry-root");
        assert!(safe_entry_inside(&s(&root), &root).is_err());
        assert!(safe_entry_inside(&s(&base.join("outside").join("secret.md")), &root).is_err());
        assert_eq!(safe_entry_inside(&s(&root.join("a.md")), &root).unwrap(), root.join("a.md"));
        assert_eq!(safe_entry_inside(&s(&root.join("sub").join("new.md")), &root).unwrap(), root.join("sub").join("new.md"));
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn rename_moves_a_file_and_refuses_bad_names_and_self_moves() {
        let (base, root) = entry_fixture("rn-basic");
        rename_entry_blocking(&s(&root.join("a.md")), &s(&root.join("sub").join("a.md")), &root).unwrap();
        assert_eq!(fs::read_to_string(root.join("sub").join("a.md")).unwrap(), "a");
        assert!(rename_entry_blocking(&s(&root.join("real")), &s(&root.join("real").join("deep").join("real")), &root).is_err());
        assert!(rename_entry_blocking(&s(&root.join("sub").join("a.md")), &s(&root.join("sub").join(".a.md")), &root).is_err());
        assert!(rename_entry_blocking(&s(&root.join("sub").join("a.md")), &s(&root.join("sub").join("nul.md")), &root).is_err());
        assert!(rename_entry_blocking(&s(&root), &s(&root.join("sub").join("x")), &root).is_err());
        assert_eq!(fs::read_to_string(root.join("real").join("inside.md")).unwrap(), "inside");
        // A pure move keeps an existing name the rule would refuse today.
        fs::write(root.join("aux.md"), "legacy").unwrap();
        rename_entry_blocking(&s(&root.join("aux.md")), &s(&root.join("sub").join("aux.md")), &root).unwrap();
        fs::remove_dir_all(&base).ok();
    }

    #[cfg(unix)]
    #[test]
    fn links_are_moved_and_resolved_as_links_never_their_targets() {
        use std::os::unix::fs::symlink;
        let (base, root) = entry_fixture("rn-links");
        symlink("real", root.join("rel")).unwrap();
        symlink(root.join("real"), root.join("abs")).unwrap();
        symlink(base.join("outside"), root.join("out")).unwrap();
        symlink("missing", root.join("sub").join("dangling.md")).unwrap();

        // The entry is the link itself, even when it points outside.
        assert_eq!(safe_entry_inside(&s(&root.join("rel")), &root).unwrap(), root.join("rel"));
        assert_eq!(safe_entry_inside(&s(&root.join("out")), &root).unwrap(), root.join("out"));
        assert!(safe_entry_inside(&s(&root.join("out").join("secret.md")), &root).is_err());

        // Absolute link: moves as a link; the target folder stays put.
        rename_entry_blocking(&s(&root.join("abs")), &s(&root.join("sub").join("abs")), &root).unwrap();
        assert!(fs::symlink_metadata(root.join("sub").join("abs")).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(root.join("real").join("inside.md")).unwrap(), "inside");

        // Relative link: renamed in place yes, moved to another folder no.
        assert!(rename_entry_blocking(&s(&root.join("rel")), &s(&root.join("sub").join("rel")), &root).is_err());
        assert!(fs::symlink_metadata(root.join("rel")).unwrap().file_type().is_symlink());
        rename_entry_blocking(&s(&root.join("rel")), &s(&root.join("rel2")), &root).unwrap();
        assert_eq!(fs::read_to_string(root.join("rel2").join("inside.md")).unwrap(), "inside");

        // A dangling link at the destination is never replaced.
        assert!(rename_entry_blocking(&s(&root.join("a.md")), &s(&root.join("sub").join("dangling.md")), &root).is_err());
        assert!(fs::symlink_metadata(root.join("sub").join("dangling.md")).unwrap().file_type().is_symlink());

        // A root opened through a symlink resolves to the real spelling.
        let alias = base.join("alias");
        symlink(&root, &alias).unwrap();
        assert_eq!(safe_entry_inside(&s(&alias.join("a.md")), &alias).unwrap(), root.join("a.md"));
        fs::remove_dir_all(&base).ok();
    }

    /* ── backup purge keep list ────────────────────────────────────── */

    #[test]
    fn purge_keeps_listed_paths_and_deletes_other_old_pairs() {
        let dir = test_dir("purge-keep");
        write_backup_to(&dir, "/n/keep.md", "k", None).unwrap();
        write_backup_to(&dir, "/n/old.md", "o", Some("v1:1:0000000000000001")).unwrap();
        write_backup_to(&dir, "/n/young.md", "y", None).unwrap();
        // Age two pairs far past the 7-day limit (ts = 1 ms after epoch).
        for p in ["/n/keep.md", "/n/old.md"] {
            let meta = dir.join(format!("{}.meta.json", backup_key(p)));
            fs::write(&meta, serde_json::json!({ "originalPath": p, "ts": 1u64 }).to_string()).unwrap();
        }
        purge_backups_in(&dir, &["/n/keep.md".to_string()]);
        assert_eq!(read_backup_from(&dir, "/n/keep.md").unwrap().0, "k", "kept despite age");
        assert!(read_backup_from(&dir, "/n/old.md").is_none(), "old pair purged");
        assert_eq!(read_backup_from(&dir, "/n/young.md").unwrap().0, "y", "young pair kept");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn zip_datetime_conversion_clamps_out_of_range() {
        // Pre-DOS-epoch mtime (e.g. a file dated 1970) must clamp, not fail.
        let dt = zip_datetime_from(std::time::UNIX_EPOCH);
        assert_eq!(dt.year(), 1980);
        // A current time round-trips with real components.
        let now = zip_datetime_from(std::time::SystemTime::now());
        assert!(now.year() >= 2024);
    }

    #[test]
    fn zip_today_stamp_shape() {
        let s = today_stamp_utc();
        assert_eq!(s.len(), 10, "{s}");
        assert_eq!(&s[4..5], "-");
        assert_eq!(&s[7..8], "-");
        let year: i32 = s[0..4].parse().unwrap();
        assert!((2024..2100).contains(&year), "{s}");
    }
}
