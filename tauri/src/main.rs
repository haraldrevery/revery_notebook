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

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

/// Signals the main close handler that the frontend has approved the close.
struct CloseAllowed(Mutex<bool>);
/// The active project root. Set by open_folder_dialog or set_root_path.
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

fn get_root(root_state: &State<'_, RootPath>) -> Result<std::path::PathBuf, String> {
    let guard = root_state.0.lock().unwrap_or_else(|p| p.into_inner());
    match guard.as_ref() {
        Some(p) => Ok(std::path::PathBuf::from(p)),
        None => Err("No project folder is open. Please open a folder first.".into()),
    }
}



/* ══════════════════════════════════════════════════════════════════════════
   TAURI COMMANDS  (invoked from frontend via window.__TAURI__.core.invoke)
══════════════════════════════════════════════════════════════════════════ */



/// keep async
/// Prompt the user to select a folder.  Returns the chosen path or null.
#[tauri::command]
async fn open_folder_dialog(
    app: AppHandle,
    root_state: State<'_, RootPath>,
    lock: State<'_, SettingsLock>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
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

        *root_state.0.lock().unwrap_or_else(|p| p.into_inner()) = Some(path.clone());
    }
    Ok(chosen)
}



#[tauri::command]
 fn set_root_path(
    app: AppHandle,
    path: String,
    root_state: State<'_, RootPath>,
    lock: State<'_, SettingsLock>,
) -> Result<(), String> {
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
    Ok(())
}


/// List the direct children of a directory.
#[tauri::command]
 fn read_directory(
    path: String,
    root_state: State<'_, RootPath>,
) -> Result<Vec<DirEntry>, String> {
    let root = get_root(&root_state)?;
    let dir = safe_path_inside(&path, &root)?;
    let read = fs::read_dir(&dir)
        .map_err(|e| format!("Cannot read directory: {e}"))?;

    let mut entries: Vec<DirEntry> = read
        .filter_map(|e| e.ok())
        .map(|e| {
            let file_type = e.file_type().ok();
            let is_dir    = file_type.map_or(false, |t| t.is_dir());

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
                path: {
                    let p = e.path().to_string_lossy().into_owned();
                    // On Windows, read_dir on a canonicalized (\\?\-prefixed) directory
                    // returns entry paths that also carry the \\?\ prefix.  Under verbatim
                    // path rules the Windows API does not treat '/' as a separator, which
                    // breaks the JS path-joining logic in uniqueDestPath (it always joins
                    // with '/').  Strip the prefix here so the frontend always receives
                    // ordinary Windows paths.  Internal Rust operations continue to use
                    // fully canonical paths via safe_path_inside's own canonicalize() call.
                    #[cfg(target_os = "windows")]
                    let p = p.strip_prefix(r"\\?\").map(str::to_owned).unwrap_or(p);
                    p
                },
                entry_type: if is_dir { "dir".into() } else { "file".into() },
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







/// Read a text file (max 20 MB).
#[tauri::command]
 fn read_file(path: String, root_state: State<'_, RootPath>) -> Result<String, String> {
    let root = get_root(&root_state)?;
    let p = safe_path_inside(&path, &root)?;
    let meta = fs::metadata(&p).map_err(|e| format!("Cannot stat file: {e}"))?;
    if meta.len() > 20 * 1024 * 1024 {
        return Err(format!(
            "File too large ({:.1} MB). Maximum is 20 MB.",
            meta.len() as f64 / 1_048_576.0
        ));
    }
    fs::read_to_string(&p).map_err(|e| format!("Read failed: {e}"))
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



/// Atomically write a text file.
// ── Atomic write helper ───────────────────────────────────────────────────
//
// Writes `content` to `dest` atomically by:
//   1. Writing to a sibling temp file `tmp` (same directory → same filesystem).
//   2. Renaming `tmp` → `dest` (atomic on all local FSes).
//   3. On EXDEV (cross-device rename, e.g. network share or FUSE mount),
//      falling back to: copy `tmp` → `dest`, then delete `tmp`.
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
        f.write_all(content)
            .map_err(|e| { let _ = fs::remove_file(tmp); format!("Write failed: {e}") })?;
        // FIX: Flush kernel buffers to physical disk before rename 
        // to prevent 0-byte files on power loss.
        f.sync_data()
            .map_err(|e| { let _ = fs::remove_file(tmp); format!("Sync failed: {e}") })?;
    }

// Step 2: Try atomic rename.
    match fs::rename(tmp, dest) {
        Ok(_) => {
            // Persist the directory entry change. See sync_parent_dir().
            sync_parent_dir(dest);
            return Ok(());
        }
        Err(ref e) if is_cross_device_err(e) => {
            // Fall through to copy fallback.
        }
        Err(e) => {
            let _ = fs::remove_file(tmp);
            return Err(format!("Rename failed: {e}"));
        }
    }

    // Step 3 (EXDEV fallback): backup → overwrite → clean up.
    // If the copy is interrupted mid-write, `dest` would be left truncated.
    // Snapshot `dest` first so we can restore it on failure.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let bak_name = format!("{}.{}.revery_bak", dest.file_name().unwrap_or_default().to_string_lossy(), now);
    let bak = dest.with_file_name(bak_name);

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

/// Returns true when the OS error indicates a cross-device rename (EXDEV).
/// errno 18 on Unix; 17 is a rare alias included for safety.
#[inline]
fn is_cross_device_err(e: &std::io::Error) -> bool {
    // 18 = EXDEV on Unix.  17 = ERROR_NOT_SAME_DEVICE on Windows.
    // (17 is also EEXIST on Linux, but fs::rename overwrites there
    //  so it cannot return EEXIST in this path.)
    // 32 = ERROR_SHARING_VIOLATION on Windows (antivirus / sync agent
    //      briefly holding a lock on the destination file). Safe to
    //      fall back to a copy in atomic_write_file because tmp and dest
    //      are always on the same filesystem.
    matches!(e.raw_os_error(), Some(18) | Some(17) | Some(32))
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

    // Append .revery_tmp to the full filename (not replace the extension),
    // so notes.md → notes.md.revery_tmp and notes.txt → notes.txt.revery_tmp
    // remain distinct temp files even when saved concurrently.
    use std::time::{SystemTime, UNIX_EPOCH};

let now = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_nanos();
let unique_name = format!(
    "{}.{}.tmp",
    p.file_name()
        .ok_or("Cannot write file: path has no filename component")?
        .to_string_lossy(),
    now
);
let tmp = p.with_file_name(unique_name);

atomic_write_file(&tmp, &p, content.as_bytes())
    })
    .await
    .map_err(|e| format!("Background write task failed: {e}"))?
}

/// Create an empty file (errors if it already exists).
#[tauri::command]
fn create_file(path: String, root_state: State<'_, RootPath>) -> Result<(), String> {
    let root = get_root(&root_state)?;
    let p = safe_path_inside(&path, &root)?;
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

    fs::create_dir_all(&p).map_err(|e| format!("mkdir failed: {e}"))
}




fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        // file_type() on a DirEntry does NOT follow symlinks — safe to use here.
        let file_type = entry.file_type()?;
        let dst_path = dst.join(entry.file_name());

        if file_type.is_symlink() {
            // Read the raw link target without following it, then recreate the
            // symlink at the destination. This preserves the symlink structure
            // without ever reading the target's contents.
            let link_target = fs::read_link(entry.path())?;

            #[cfg(unix)]
            std::os::unix::fs::symlink(&link_target, &dst_path)?;

            #[cfg(windows)]
            {
                // Windows needs separate calls for file vs. directory symlinks.
                // link_target.is_dir() follows the target, but only to determine
                // the symlink *type* — no content is copied regardless.
                if link_target.is_dir() {
                    std::os::windows::fs::symlink_dir(&link_target, &dst_path)?;
                } else {
                    std::os::windows::fs::symlink_file(&link_target, &dst_path)?;
                }
            }
        } else if file_type.is_dir() {
            copy_dir_all(&entry.path(), &dst_path)?;
        } else {
            fs::copy(entry.path(), &dst_path)?;
        }
    }
    Ok(())
}



#[tauri::command]
async fn rename_node(old_path: String, new_path: String, root_state: State<'_, RootPath>) -> Result<(), String> {
    let root = get_root(&root_state)?;
    let old = safe_path_inside(&old_path, &root)?;
    let new = safe_path_inside(&new_path, &root)?;

    let canonical_root = root.canonicalize().map_err(|e| format!("Cannot resolve root: {e}"))?;
    if old == canonical_root {
        return Err("Security Error: Cannot move or rename the project root folder.".into());
    }

    if !old.exists() {
        return Err(format!("Source not found: {}", old.display()));
    }
    if new.exists() {
        return Err(format!("Destination already exists: {}", new.display()));
    }

    // Wrap the heavy synchronous I/O in a blocking task so the event loop stays free
    tokio::task::spawn_blocking(move || {
        match fs::rename(&old, &new) {
            Ok(_) => Ok(()),
            Err(err) => {
                let is_cross_device = err.raw_os_error() == Some(18) // EXDEV (Unix)
                    || err.raw_os_error() == Some(17);               // rare EEXDEV alias

                if is_cross_device {
                    if old.is_dir() {
                        // ── Step 1: Copy ─────────────────────────────────────────
                        if let Err(e) = copy_dir_all(&old, &new) {
                            let _ = fs::remove_dir_all(&new);
                            return Err(format!("Cross-device folder move failed during copy: {}", e));
                        }

                        // Post-copy sanity check
                        if !new.is_dir() {
                            let _ = fs::remove_dir_all(&new);
                            return Err(format!(
                                "Cross-device copy reported success but destination \"{}\" does not \
                                exist. The original at \"{}\" has not been modified.",
                                new.display(), old.display()
                            ));
                        }

                        // ── Step 2: Delete original ───────────────────────────────
                        if let Err(rm_err) = fs::remove_dir_all(&old) {
                            if old.exists() {
                                return Err(format!(
                                    "Move incomplete: the folder was copied to \"{}\" but the \
                                     original at \"{}\" could not be fully deleted (it may be \
                                     locked). Both locations contain your data. Please verify \
                                     both paths and remove the duplicate manually. Details: {}",
                                    new.display(), old.display(), rm_err
                                ));
                            }

                            match copy_dir_all(&new, &old) {
                                Ok(_) => {
                                    let _ = fs::remove_dir_all(&new);
                                    return Err(format!(
                                        "Move failed and was rolled back: the original folder at \
                                         \"{}\" was temporarily deleted but has been restored from \
                                         the copy. No data was lost. Please try again. Details: {}",
                                        old.display(), rm_err
                                    ));
                                }
                                Err(rollback_err) => {
                                    return Err(format!(
                                        "Move partially failed: your folder was copied to \"{}\" \
                                         but the original could not be deleted and automatic \
                                         recovery also failed. \"{}\" is your only complete copy — \
                                         please move it manually to the intended location. \
                                         Delete error: {} | Recovery error: {}",
                                        new.display(), new.display(), rm_err, rollback_err
                                    ));
                                }
                            }
                        }
                        Ok(())
                    } else {
                        // ── File path ───────────────────────────────────────────

                        if let Err(e) = fs::copy(&old, &new) {
                            let _ = fs::remove_file(&new);
                            return Err(format!("Cross-device file move failed during copy: {}", e));
                        }

                        if !new.is_file() {
                            let _ = fs::remove_file(&new);
                            return Err(format!(
                                "Cross-device copy reported success but destination \"{}\" does not \
                                exist. The original at \"{}\" has not been modified.",
                                new.display(), old.display()
                            ));
                        }

                        if let Err(rm_err) = fs::remove_file(&old) {
                            if old.exists() {
                                return Err(format!(
                                    "Move incomplete: the file was copied to \"{}\" but the \
                                     original at \"{}\" could not be deleted (it may be locked). \
                                     Both locations contain your data. Please remove the duplicate \
                                     manually. Details: {}",
                                    new.display(), old.display(), rm_err
                                ));
                            }

                            match fs::copy(&new, &old) {
                                Ok(_) => {
                                    let _ = fs::remove_file(&new);
                                    return Err(format!(
                                        "Move failed and was rolled back: the original file at \
                                         \"{}\" was temporarily deleted but has been restored. \
                                         No data was lost. Please try again. Details: {}",
                                        old.display(), rm_err
                                    ));
                                }
                                Err(rollback_err) => {
                                    return Err(format!(
                                        "Move partially failed: your file was copied to \"{}\" \
                                         but the original could not be deleted and automatic \
                                         recovery also failed. \"{}\" is your only complete copy — \
                                         please move it manually to the intended location. \
                                         Delete error: {} | Recovery error: {}",
                                        new.display(), new.display(), rm_err, rollback_err
                                    ));
                                }
                            }
                        }
                        Ok(())
                    }
                } else {
                    Err(format!("Rename failed: {}", err))
                }
            }
        }
    })
    .await
    .map_err(|e| format!("Thread pool error: {}", e))? // Handle internal Tokio thread panics
}


/// Move a file or directory to the OS trash (Recycle Bin on Windows,
/// Trash on macOS, XDG Trash on Linux). Recursive for directories.
/// The user can restore the item from their system trash UI.
#[tauri::command]
fn delete_node(path: String, root_state: State<'_, RootPath>) -> Result<(), String> {
    let root = get_root(&root_state)?;
    let p = safe_path_inside(&path, &root)?;

    let canonical_root = root.canonicalize().map_err(|e| format!("Cannot resolve root: {e}"))?;
    if p == canonical_root {
        return Err("Security Error: Cannot delete the project root folder.".into());
    }

    if !p.exists() {
        return Ok(()); // Already gone — preserve idempotency
    }


    trash::delete(&p).map_err(|e| format!("Move to trash failed: {e}"))
}


#[tauri::command]
fn set_volatile_content(path: String, content: String) -> Result<(), String> {
    let volatile_dir = prepare_volatile_dir().map_err(|s| s.to_string())?;

    let _guard = VOLATILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    // Encode the original path using a deterministic FNV-1a hash
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in path.bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    let key = format!("{:016x}", hash);
    let data_file = volatile_dir.join(format!("{key}.revery_volatile"));
    let meta_file = volatile_dir.join(format!("{key}.meta.json"));

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    let data_tmp = volatile_dir.join(format!("{key}.{now}.revery_volatile.tmp"));
    atomic_write_file(&data_tmp, &data_file, content.as_bytes())?;

    let meta = serde_json::json!({
        "originalPath": path,
        "ts": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0u64),
    });
    let meta_tmp = volatile_dir.join(format!("{key}.{now}.meta.json.tmp"));
    atomic_write_file(&meta_tmp, &meta_file, meta.to_string().as_bytes())
}

#[tauri::command]
fn get_volatile_content(path: String) -> Option<serde_json::Value> {
    // If the dir failed its safety check, treat as "no backup" — same outcome
    // as the file simply not existing. Mirrors Electron's volatileDirReady=false
    // path which returns null. Callers see a clean None and proceed without
    // crash recovery (the badge has already informed the user).
    let volatile_dir = prepare_volatile_dir().ok()?;

    // Hold the same lock as writers so we never observe a "data file already
    // renamed in, meta file still in temp" half-state.
    let _guard = VOLATILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    let mut hash: u64 = 0xcbf29ce484222325;
    for b in path.bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    let key = format!("{:016x}", hash);

    let tmp_file  = volatile_dir.join(format!("{key}.revery_volatile"));
    let meta_file = volatile_dir.join(format!("{key}.meta.json"));

    let content = fs::read_to_string(&tmp_file).ok()?;
    let meta: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&meta_file).ok()?).ok()?;
    let ts = meta["ts"].as_u64().unwrap_or(0);
    Some(serde_json::json!({ "content": content, "ts": ts, "originalPath": path }))
}



#[tauri::command]
fn delete_volatile_content(path: String) -> Result<(), String> {
    // If the dir is unsafe, there's nothing of ours to delete — succeed silently.
    let volatile_dir = match prepare_volatile_dir() {
        Ok(d)  => d,
        Err(_) => return Ok(()),
    };

    let _guard = VOLATILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    let mut hash: u64 = 0xcbf29ce484222325;
    for b in path.bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    let key = format!("{:016x}", hash);

    let tmp_file  = volatile_dir.join(format!("{key}.revery_volatile"));
    let meta_file = volatile_dir.join(format!("{key}.meta.json"));

    let _ = fs::remove_file(&tmp_file);  // ignore error — may already be gone
    let _ = fs::remove_file(&meta_file);
    Ok(())
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
    use tauri_plugin_dialog::{DialogExt, FilePath};

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
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

            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let unique_name = format!("{}.{}.revery_tmp", p.file_name().ok_or("Path has no filename")?.to_string_lossy(), now);
            let tmp = p.with_file_name(unique_name);

           atomic_write_file(&tmp, &p, content.as_bytes())?;


            let new_root: Option<String> = if update_root.unwrap_or(false) {
                p.parent().and_then(|dir| {
                    let canonical = dir.canonicalize().ok()?;
                    let _ = app.asset_protocol_scope().allow_directory(&canonical, true);
                    let dir_str = canonical.to_string_lossy().into_owned();


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


///Keep async
/// Show a native OS dialog and return the button index pressed.
#[tauri::command]
async fn show_message_box(
    app: AppHandle,
    options: MessageBoxOptions,
) -> Result<MessageBoxResult, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind, MessageDialogButtons};

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
    let mut builder = app
        .dialog()
        .message(message)
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
    Ok(v["lastOpenedFile"].as_str().map(String::from))
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
    let result = v["lastRootPath"].as_str().map(String::from);

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
fn copy_into_folder(
    dest_dir: String,
    filename: String,
    content_b64: String,
    root_state: State<'_, RootPath>,
) -> Result<serde_json::Value, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let root = get_root(&root_state)?;
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
    Ok(serde_json::json!({ "name": final_name, "path": final_path.to_string_lossy() }))
}


/// Copy an existing on-disk file (dropped via Tauri's native drag-drop, which
/// gives absolute source paths) into `dest_dir` inside the root. The source
/// may live anywhere; only the DESTINATION is jailed to the root. Never
/// overwrites — collisions auto-increment to "name (1).ext".
#[tauri::command]
fn copy_path_into_folder(
    src_path: String,
    dest_dir: String,
    root_state: State<'_, RootPath>,
) -> Result<serde_json::Value, String> {
    let root = get_root(&root_state)?;

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
    Ok(serde_json::json!({ "name": final_name, "path": final_path.to_string_lossy() }))
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
fn purge_old_volatile_files() {
    // If the dir failed its safety check, do not enumerate or delete anything.
    // We don't own it — leave whatever's there alone.
    let volatile_dir = match prepare_volatile_dir() {
        Ok(d)  => d,
        Err(_) => return,
    };

    let entries = match fs::read_dir(&volatile_dir) {
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
fn list_volatile_backups(prefix: String) -> Vec<VolatileBackupInfo> {
    if prefix.is_empty() {
        return Vec::new();
    }
    let volatile_dir = match prepare_volatile_dir() {
        Ok(d)  => d,
        Err(_) => return Vec::new(),
    };
    let _guard = VOLATILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    let entries = match fs::read_dir(volatile_dir) {
        Ok(e)  => e,
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
            None    => continue, // unreadable meta — skip, never guess
        };
        if let Some(op) = meta["originalPath"].as_str() {
            if op.starts_with(prefix.as_str()) {
                out.push(VolatileBackupInfo {
                    original_path: op.to_string(),
                    ts: meta["ts"].as_u64().unwrap_or(0),
                });
            }
        }
    }
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
        .plugin(tauri_plugin_dialog::init())

        /* ── Managed state ── */
        .manage(WatcherState::default())
        .manage(CloseAllowed(Mutex::new(false)))
        .manage(RootPath(Mutex::new(None)))
        .manage(SettingsLock(Mutex::new(())))
        /* ── Window close interception ── */
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let close_allowed = window.state::<CloseAllowed>();
                if !*close_allowed.0.lock().unwrap_or_else(|p| p.into_inner()) {
                    api.prevent_close();
                    // Signal the frontend
                    let _ = window.emit("window-close-request", ());
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
            delete_node,
            copy_into_folder,
            copy_path_into_folder,
            set_volatile_content,
            get_volatile_content,
            delete_volatile_content,
            get_volatile_status,
            list_volatile_backups,
            save_file,
            show_message_box,
            confirm_close,
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

            // Purge volatile crash-backups older than 7 days.
            tauri::async_runtime::spawn(async {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                // Offload the synchronous file I/O to a blocking thread
                tokio::task::spawn_blocking(|| {
                    purge_old_volatile_files();
                }).await.unwrap();
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error while running Revery Notebook (Tauri)");
}