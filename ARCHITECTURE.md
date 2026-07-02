# Revery Notebook — Desktop Port Architecture

## Table of Contents
1. [Project Structure](#project-structure)
2. [Architecture Overview](#architecture-overview)
3. [The NativeAPI Abstraction Layer](#the-nativeapi-abstraction-layer)
4. [Boot Priority Logic](#boot-priority-logic)
5. [Project File Sidebar](#project-file-sidebar)
6. [Electron Wrapper](#electron-wrapper)
7. [Tauri Wrapper](#tauri-wrapper)
8. [Data Safety & Crash Recovery](#data-safety--crash-recovery)
9. [Security Model](#security-model)
10. [Integration Checklist](#integration-checklist)
11. [Build Instructions](#build-instructions)

---

## Project Structure

```
revery-desktop/
│
├── native_api.js            ← Unified abstraction layer (load first in <head>)
├── project_sidebar.js       ← Sidebar UI + file management logic
├── project_sidebar.css      ← Sidebar styles (append to or load after main CSS)
├── core_boot_patch.js       ← Replacement boot block for markdown_editor_core_cm.js
├── html_changes.diff        ← Annotated HTML modification guide
├── package.json             ← npm scripts for both wrappers + electron-builder config
│
├── electron/
│   ├── main.js              ← Electron main process (BrowserWindow + IPC handlers)
│   └── preload.js           ← Secure contextBridge (exposes window.electronAPI)
│
└── tauri/
    ├── Cargo.toml           ← Rust dependencies
    ├── tauri.conf.json      ← Tauri v2 configuration + FS scope
    └── src/
        └── main.rs          ← All Rust #[tauri::command] implementations
```

### Files that exist in the web project and are MODIFIED (not replaced):
| File | Change |
|---|---|
| `revery_notebook.html` | Add sidebar HTML, load new scripts/CSS (see `html_changes.diff`) |
| `markdown_editor_core_cm.js` | Replace boot block with `core_boot_patch.js` content |

### Files that are NEW (copy into `jvscrpt_and_css_extra/`):
| File | Purpose |
|---|---|
| `native_api.js` | Abstraction layer — load this first |
| `project_sidebar.js` | Sidebar logic |
| `project_sidebar.css` | Sidebar styles |

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                     Revery Notebook Frontend                   │
│  (revery_notebook.html + all existing JS/CSS — unchanged API) │
│                                                                │
│   Calls only:  window.NativeAPI.readFile(path)                │
│                window.NativeAPI.writeFile(path, content)       │
│                window.NativeAPI.openFolderDialog()             │
│                window.NativeAPI.showMessageBox(options)        │
│                window.NativeAPI.onWindowClose(callback)        │
│                         … etc.                                 │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                ┌──────────▼──────────┐
                │    native_api.js    │  ← Environment detection
                │  window.NativeAPI   │
                └──┬──────────────┬───┘
                   │              │
          Electron │              │ Tauri
                   │              │
    ┌──────────────▼──┐    ┌──────▼───────────────┐
    │  preload.js     │    │  window.__TAURI__     │
    │  contextBridge  │    │  .core.invoke(cmd)    │
    │  electronAPI.*  │    └──────┬────────────────┘
    └──────┬──────────┘          │
           │ ipcRenderer.invoke  │ invoke('rust_command')
           │                     │
    ┌──────▼──────────┐    ┌──────▼────────────────┐
    │  electron/      │    │  tauri/src/main.rs    │
    │  main.js        │    │  #[tauri::command]    │
    │  IPC Handlers   │    │  Rust FS operations   │
    └──────┬──────────┘    └──────┬────────────────┘
           │                      │
           └──────────┬───────────┘
                      │
              ┌───────▼───────┐
              │  OS File System│
              └───────────────┘
```

**Key invariant**: The frontend never imports `electron`, never calls
`ipcRenderer` directly, and never references `window.__TAURI__`. It only
ever calls `window.NativeAPI.*`.

---

## The NativeAPI Abstraction Layer

**File**: `native_api.js`

### Environment Detection
```js
const isTauri    = typeof window.__TAURI__   !== 'undefined';  // Tauri injects this
const isElectron = typeof window.electronAPI !== 'undefined';  // preload.js injects this
const ENV        = isTauri ? 'tauri' : isElectron ? 'electron' : 'web';
```

### Full API Surface

| Method | Description | Return Type |
|---|---|---|
| `openFolderDialog()` | OS folder picker dialog | `Promise<string \| null>` |
| `readDirectory(path)` | List immediate children | `Promise<DirEntry[]>` |
| `readFile(path)` | Read file as UTF-8 string | `Promise<string>` |
| `writeFile(path, content)` | Atomic write (tmp → rename) | `Promise<void>` |
| `createFile(path)` | Create empty file (error if exists) | `Promise<void>` |
| `createDirectory(path)` | Create dir + parents | `Promise<void>` |
| `renameNode(oldPath, newPath)` | Rename/move file or folder | `Promise<void>` |
| `deleteNode(path)` | Delete file or folder recursively | `Promise<void>` |
| `setVolatileContent(path, content)` | Debounced crash backup | `void` (fire-and-forget) |
| `showMessageBox(options)` | Native OS dialog | `Promise<{ response: number }>` |
| `onWindowClose(callback)` | Intercept OS close button | `void` |
| `confirmClose()` | Tell native: proceed with close | `void` |
| `watchFile(path, callback)` | Notify on external modification | `Promise<void>` |
| `unwatchFile(path)` | Stop watching | `Promise<void>` |
| `getLastOpenedFile()` | Retrieve persisted file pointer | `Promise<string \| null>` |
| `setLastOpenedFile(path)` | Persist file pointer | `Promise<void>` |
| `clearLastOpenedFile()` | Clear the persisted pointer | `Promise<void>` |
| `getAppDataPath()` | Return OS app data path | `Promise<string \| null>` |

### DirEntry Type
```ts
interface DirEntry {
  name: string;           // "notes.md"
  path: string;           // "/Users/alice/Projects/notes.md"
  type: 'file' | 'dir';
}
```

### Web Fallback Behaviour
| Method | Web behaviour |
|---|---|
| `openFolderDialog` | Uses `showDirectoryPicker()` (FSA API) if available; throws otherwise |
| `readFile` / `writeFile` | Uses FSA `FileSystemFileHandle`; requires prior `openFolderDialog` |
| `createFile/Directory`, `renameNode`, `deleteNode` | Throws `"not supported in web mode"` |
| `showMessageBox` | Degrades to browser `confirm()` / `alert()` |
| `onWindowClose` | Hooks `beforeunload` |
| `setVolatileContent` | Saves to `localStorage` as crash buffer |
| `getLastOpenedFile` / `setLastOpenedFile` | Uses `localStorage` |

---

## Boot Priority Logic

**File to modify**: `markdown_editor_core_cm.js`

Replace the existing synchronous `localStorage` boot block (lines ~524–553)
with the async IIFE from `core_boot_patch.js`.

### New Priority Order
```
1. window.NativeAPI.isDesktop === true
       └─► getLastOpenedFile() returns a path
               └─► readFile(path) succeeds   →  USE DISK CONTENT  ✓
               └─► readFile(path) fails       →  clear pointer, fall through
       └─► getLastOpenedFile() returns null   →  fall through

2. localStorage.getItem(AUTOSAVE_KEY) !== null  →  USE LOCALSTORAGE  ✓

3. Neither                                      →  SHOW WELCOME TEXT  ✓
```

### Critical: Avoiding Double-Render

The patched boot IIFE calls `render()` and `countWords()` itself. Remove
the standalone `render(); countWords();` line that sat immediately after
the old `if/else` block in the original file. The `editor.addEventListener('input', ...)` listener further down the file remains unchanged.

---

## Project File Sidebar

**File**: `project_sidebar.js` + `project_sidebar.css`

### UI Placement
```
┌─────┬─────────────────────────────────────────────┐
│ ⊟  │ File ▾  │  doc-title  │ 0 words             │  ← topbar-left
│[Sb] │ [File]                                       │
├─────┬───┬─────────────────────┬────────────────────┤
│📂 ┼ ＋ 📁 │                    │                    │  ← sidebar header
│   │ ▾ Projects              │                    │
│   │   ├─ 📄 notes.md  ●     │   EDITOR PANE      │   PREVIEW PANE
│   │   ├─ 📄 todo.md         │                    │
│   │   └─ ▸ archive/         │                    │
│   │                         │                    │
└───┴───┴─────────────────────┴────────────────────┘
 [sidebar] [sb-div] [editor-pane] [divider] [preview-pane]
```

The `●` marker indicates the currently active file (`.active` CSS class).

### File Tree Rules
- Entries are sorted: directories first, then alphabetical
- Hidden files/folders (`.dotfile`) are filtered out
- Only `.md` and `.txt` files are shown (folders always shown)
- Depth indentation: `(depth * 14 + 10)px` left padding

### Context Menu Actions

| Target | Actions |
|---|---|
| File | Open, Rename, Delete |
| Folder | New File Here, New Folder Here, Rename, Delete |

The existing `#context-menu` element from the main app is reused (no new DOM element needed).

### Unsaved Changes Guard

`window._sidebarUnsaved` is set `true` on every `editor` input event when a
file is open. Before opening a different file, the guard shows a native dialog:

```
┌─────────────────────────────────┐
│  Unsaved Changes                │
│  Do you want to save first?     │
│ [Save & Open] [Discard] [Cancel]│
└─────────────────────────────────┘
```

### Ctrl+S Behaviour (Desktop Override)

When `activeFilePath` is set, `Ctrl+S` calls `NativeAPI.writeFile()` with an
atomic tmp-rename write. The existing `localStorage`-based export shortcut in
`markdown_editor_actions_cm.js` is **not removed** — it activates only when no
desktop file is open (`activeFilePath === null`), giving seamless fallback.

You may want to add this check to the existing Ctrl+S handler in
`markdown_editor_actions_cm.js`:

```js
// In the existing Ctrl+S handler, add this guard at the TOP:
if (window.sidebarGetActiveFilePath && window.sidebarGetActiveFilePath()) {
  // Let project_sidebar.js handle the save (it's already listening)
  return;
}
// ...existing export-to-download logic below...
```

### External File Watch

When a file is opened, `NativeAPI.watchFile()` is called. If the file is
modified by another program, a dialog asks the user to reload or keep their
edits. Only one watcher is active at a time (the previously watched file is
unwatched automatically when a new file opens).

---

## Electron Wrapper

**Files**: `electron/main.js`, `electron/preload.js`

### Security Configuration

```js
// BrowserWindow webPreferences (main.js)
{
  nodeIntegration:  false,   // NEVER expose Node.js to the renderer
  contextIsolation: true,    // preload runs in an isolated context
  sandbox:          true,    // renderer process is OS-sandboxed
  webSecurity:      true,    // enforces same-origin policy
  devTools:         !app.isPackaged,  // disabled in production builds
}
```

### IPC Channel Map

| contextBridge method | ipcMain channel | main.js handler |
|---|---|---|
| `openFolderDialog()` | `dialog:open-folder` | `dialog.showOpenDialog` |
| `readDirectory(path)` | `fs:read-directory` | `fs.readdirSync` |
| `readFile(path)` | `fs:read-file` | `fs.readFileSync` (max 20 MB) |
| `writeFile(path, c)` | `fs:write-file` | atomic tmp → rename |
| `createFile(path)` | `fs:create-file` | `fs.writeFileSync('')` |
| `createDirectory(path)` | `fs:create-directory` | `fs.mkdirSync` |
| `renameNode(o, n)` | `fs:rename-node` | `fs.renameSync` |
| `deleteNode(path)` | `fs:delete-node` | `fs.rmSync` |
| `setVolatileContent(p,c)` | `fs:set-volatile-content` | write to `os.tmpdir()` |
| `showMessageBox(opts)` | `dialog:show-message-box` | `dialog.showMessageBox` |
| `confirmClose()` | `window:confirm-close` | sets `allowClose=true`, calls `win.close()` |
| `watchFile(path, cb)` | `fs:watch-file` | `fs.watch` with debounce |
| `unwatchFile(path)` | `fs:unwatch-file` | `.close()` stored watcher |
| `getLastOpenedFile()` | `settings:get-last-opened-file` | reads `userData/revery_settings.json` |
| `setLastOpenedFile(p)` | `settings:set-last-opened-file` | writes `userData/revery_settings.json` |
| `getAppDataPath()` | `app:get-data-path` | `app.getPath('userData')` |

### Window Close Flow

```
User clicks [X]
      │
      ▼
main.js 'close' event fires
      │
      ├── allowClose === true  →  proceed (window closes)
      │
      └── allowClose === false →  event.preventDefault()
                                  webContents.send('window:close-request')
                                        │
                                        ▼
                                 preload.js forwards to renderer
                                        │
                                        ▼
                               project_sidebar.js onWindowClose cb
                                        │
                                        ├── unsaved changes?  →  show dialog
                                        │         └── Cancel  →  do nothing (window stays open)
                                        │         └── Save     →  writeFile(), then confirmClose()
                                        │         └── Discard  →  confirmClose()
                                        │
                                        └── no unsaved changes  →  confirmClose()
                                                                          │
                                                                          ▼
                                                               main.js: allowClose = true
                                                               mainWindow.close()  →  app exits
```

### Settings Storage

Electron stores the `lastOpenedFile` pointer in:
`app.getPath('userData')/revery_settings.json`

| OS | Path example |
|---|---|
| macOS | `~/Library/Application Support/Revery Notebook/revery_settings.json` |
| Windows | `%APPDATA%\Revery Notebook\revery_settings.json` |
| Linux | `~/.config/Revery Notebook/revery_settings.json` |

This is separate from the app's own `localStorage` (which persists in the
Chromium profile inside userData). The two storage systems coexist without
collision.

---

## Tauri Wrapper

**Files**: `tauri/src/main.rs`, `tauri/Cargo.toml`, `tauri/tauri.conf.json`

### Rust Command Map

| `invoke()` name | Rust function | Notes |
|---|---|---|
| `open_folder_dialog` | `open_folder_dialog` | `tauri-plugin-dialog` |
| `read_directory` | `read_directory` | `fs::read_dir` |
| `read_file` | `read_file` | max 20 MB guard |
| `write_file` | `write_file` | atomic tmp → rename |
| `create_file` | `create_file` | errors if already exists |
| `create_directory` | `create_directory` | `fs::create_dir_all` |
| `rename_node` | `rename_node` | validates both paths |
| `delete_node` | `delete_node` | `fs::remove_dir_all` for dirs |
| `set_volatile_content` | `set_volatile_content` | writes to `env::temp_dir()` |
| `show_message_box` | `show_message_box` | `tauri-plugin-dialog` |
| `confirm_close` | `confirm_close` | sets `CloseAllowed` state → `window.close()` |
| `watch_file` | `watch_file` | `notify` crate, emits `file-changed` event |
| `unwatch_file` | `unwatch_file` | removes from `WatcherState` registry |
| `get_last_opened_file` | `get_last_opened_file` | reads `app_config_dir/revery_settings.json` |
| `set_last_opened_file` | `set_last_opened_file` | writes same JSON |
| `get_app_data_path` | `get_app_data_path` | `app.path().app_data_dir()` |

### Managed State

```rust
struct WatcherState {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

struct CloseAllowed(Mutex<bool>);
```

Both are registered via `.manage()` in `Builder::default()` and injected
into commands by Tauri's `State<'_, T>` extractor.

### Window Close Flow (Tauri)

```
User clicks [X]
      │
      ▼
on_window_event: CloseRequested fires
      │
      ├── CloseAllowed == true  →  proceed (no prevent_close call)
      │
      └── CloseAllowed == false →  api.prevent_close()
                                   window.emit("window-close-request", ())
                                        │
                                        ▼
                               native_api.js: __TAURI__.event.listen
                               → calls registered onWindowClose callback
                                        │
                                        ▼
                               (same flow as Electron above)
                                        │
                               confirm_close() command
                                        │
                                        ▼
                               CloseAllowed = true
                               window.close() in Rust
```

### Tauri FS Scope

`tauri.conf.json` restricts which paths the FS plugin can access:

```json
"fs": {
  "scope": {
    "allow": ["$HOME/**", "$DOCUMENT/**", "$DESKTOP/**"],
    "deny":  ["$HOME/.ssh/**", "$HOME/.gnupg/**"]
  }
}
```

Adjust `allow` to match your users' expected working directories. The custom
Rust commands use their own path validation (the `safe_path` function)
independently of this plugin scope.

---

## Data Safety & Crash Recovery

### Volatile Crash Backup

Every 2 seconds after the last keystroke, `NativeAPI.setVolatileContent(path, content)` writes a crash backup to the OS temp directory. This is separate from the primary save file.

**Electron temp path**: `os.tmpdir()/revery-volatile/<hash>.revery_volatile`  
**Tauri temp path**: `env::temp_dir()/revery-volatile/<hash>.revery_volatile`

A `.meta.json` sibling file records the original path and timestamp. On a future startup a recovery assistant could scan this directory and offer to restore unsaved work.

### Atomic Writes

`writeFile()` never writes directly to the target path. It always:
1. Writes to `<path>.revery_tmp`
2. Calls `rename()` (atomic on POSIX; best-effort on Windows NTFS)

This means a crash mid-write leaves the original file intact.

### Multi-Tab Collision (Web Mode)

The existing `window.addEventListener('storage', ...)` handler in
`markdown_editor_core_cm.js` already warns when another tab overwrites the
localStorage autosave. In desktop mode this handler fires only if the user
somehow has two browser tabs open to the same Electron renderer, which is
prevented by `app.requestSingleInstanceLock()` (add to `electron/main.js`
for production).

---

## Security Model

### Electron

| Concern | Mitigation |
|---|---|
| Node.js in renderer | `nodeIntegration: false` |
| Prototype pollution via IPC | All IPC payloads treated as untrusted; types validated in main.js handlers |
| Path traversal | `validatePath()` resolves and checks all paths before FS access |
| XSS → file read | Renderer has no direct FS access; must go through IPC |
| Oversized payloads | Files > 20 MB are rejected at the IPC handler level |
| Dialog spoofing | Only `dialog.*` APIs in main process; renderer cannot fake them |
| Acting as a browser | `will-navigate` cancels everything except same-URL reloads; `setWindowOpenHandler` denies all; links are never forwarded to the OS browser (policy: the app never opens links) |

### Tauri

| Concern | Mitigation |
|---|---|
| Arbitrary Rust command execution | Only listed commands are registered; no dynamic dispatch |
| Path traversal | `safe_path()` in every Rust command |
| FS scope bypass | Custom commands + plugin scope both validate independently |
| Oversized file reads | `meta.len() > 20 MB` guard in `read_file` |
| Unregistered IPC | Tauri rejects invocations for commands not in `generate_handler![]` |
| Acting as a browser | `navigation-guard` plugin (`on_navigation` + `is_allowed_navigation`) — only the app's own origins may load in the webview; everything else is cancelled and logged |

---

## Integration Checklist

Apply changes in this exact order:

- [ ] **Copy new files** into `jvscrpt_and_css_extra/`:
  - `native_api.js`
  - `project_sidebar.js`
  - `project_sidebar.css`

- [ ] **Modify `revery_notebook.html`** per `html_changes.diff`:
  - [ ] Change 1: load `native_api.js` after theme script in `<head>`
  - [ ] Change 2: load `project_sidebar.css` after main CSS
  - [ ] Change 3: add `#btn-sidebar` button as first child of `#topbar-left`
  - [ ] Change 4: add `#project-sidebar` + `#sidebar-divider` as first children of `#workspace`
  - [ ] Change 5: load `project_sidebar.js` as the last script before `</body>`

- [ ] **Modify `markdown_editor_core_cm.js`**:
  - [ ] Replace the boot block (lines ~524–553) with `core_boot_patch.js`
  - [ ] Remove the now-redundant standalone `render(); countWords();` line immediately after the replaced block

- [ ] **Optional: guard the existing Ctrl+S handler** in `markdown_editor_actions_cm.js` (see sidebar section above)

- [ ] **Build Electron wrapper**: `npm run build:electron`
- [ ] **Build Tauri wrapper**: `npm run build:tauri`

---

## Build Instructions

### Prerequisites

```bash
# For Electron
npm install

# For Tauri (in addition to npm install above)
# Install Rust: https://rustup.rs
rustup update stable

# Tauri CLI (via npm, already in devDependencies)
npx tauri --version
```

### Development

```bash
# Electron — opens the app directly from the source files
npm run start:electron

# Tauri — opens with hot-reload via Vite/Cargo watch
npm run start:tauri
```

### Sidebar bundle

`www/jvscrpt_and_css_extra/project_sidebar.js` is a **generated file**. The
source of truth is the ES modules in `src/sidebar/` (state, save engine,
tree, cards, file operations, drag-and-drop, watcher, lifecycle). After
editing anything there, rebuild the single-file bundle the HTML loads:

```bash
npm run build:sidebar
```

The bundle is committed so the web version and both wrappers work without a
build step. Never edit the bundle directly — the banner comment says so too.

### Production Build

```bash
# Electron — produces installers in dist-electron/
npm run build:electron

# Tauri — produces installers in tauri/target/release/bundle/
npm run build:tauri
```


If something fails (often happens after unzipping)

First:

```bash
rm -rf node_modules
```

and then:

```bash
npm install
```


### Output Artifacts

| Command | macOS | Windows | Linux |
|---|---|---|---|
| `build:electron` | `.dmg` | `.exe` (NSIS) | `.AppImage`, `.deb` |
| `build:tauri` | `.dmg`, `.app` | `.msi`, `.exe` | `.AppImage`, `.deb` |

---

## Testing

The data-safety layer is covered by automated tests. Run them before and
after touching anything in `electron/fs_core.js`, the IPC handlers in
`electron/main.js`, or the path/write helpers in `tauri/src/main.rs`.

```bash
# JS side — no dependencies beyond Node itself (node:test)
npm test

# Rust side
npm run test:rust        # = cargo test --manifest-path tauri/Cargo.toml
```

| Suite | What it proves |
|---|---|
| `test/fs_core.atomic.test.js` | Atomic write semantics: overwrite, temp cleanup, EXDEV copy fallback, snapshot restore on mid-copy failure, snapshot survival when even the restore fails |
| `test/fs_core.paths.test.js` | Path traversal / symlink-escape rejection, dropped-filename sanitisation |
| `test/fs_core.settings.test.js` | Settings corruption recovery: `.bak` fallback, quarantine of corrupt bytes, merge semantics |
| `test/fs_core.volatile.test.js` | Crash-backup lifecycle: dir safety checks, set/get/delete, prefix listing, age purge that never deletes on unreadable metadata |
| `test/crash_consistency.test.js` | A child process is SIGKILLed mid-write 12 times; the target file must always contain exactly one complete payload |
| `tauri/src/main.rs` `mod tests` | Rust twins: `safe_path`, `safe_path_inside`, `atomic_write_file`, `is_cross_device_err` |

`electron/fs_core.js` is the single source of truth for the Electron-side
atomic-write strategy — both `fs:write-file` and `dialog:save-file` call
`atomicWriteFile()`. Do not re-inline that logic into handlers; it is what
the tests pin down.

Note for VSCode users: launching the app from an integrated terminal can
inherit `ELECTRON_RUN_AS_NODE=1` from the editor, which makes
`require('electron')` return a path string and the app crash at
`app.whenReady`. Run `ELECTRON_RUN_AS_NODE= npm run start:electron` if you
hit that.

---

## Known Limitations & Future Work

1. **Tauri multi-button dialogs**: The `tauri-plugin-dialog` v2 API has
   limited support for custom button arrays. The `show_message_box` Rust
   command currently returns `response: 0` always. For production, implement
   a custom Tauri window (`tauri::WindowBuilder`) to host a small HTML
   confirmation dialog and emit the response via a Tauri event.

2. **File watcher on macOS**: `fs.watch()` in Node.js and the `notify` crate
   both use `FSEvents` on macOS, which can have a ~1s delay. Consider
   `chokidar` (Electron) or the `notify` `PollWatcher` as fallback.

3. **Single-instance lock**: Add `app.requestSingleInstanceLock()` to
   `electron/main.js` for production to prevent opening two windows.

4. **Windows atomic rename**: `fs.rename()` on Windows will fail if the
   destination exists. The current `writeFile` handler deletes the temp file
   on error. For robustness, use `fs.copyFileSync` + `fs.unlinkSync` as
   a fallback.

5. **Tauri v1 compatibility**: The Rust code targets Tauri v2. For v1,
   replace `app.path().app_config_dir()` with `app.path_resolver().app_config_dir()`,
   and use `tauri::api::dialog` instead of `tauri-plugin-dialog`.
