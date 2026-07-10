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
revery_notebook/
│
├── www/                              ← Everything the app ships (web + both wrappers)
│   ├── index.html                    ← The ONLY app shell (web, Electron and Tauri)
│   ├── pdf_print.html                ← Dedicated PDF print page (Tauri export path)
│   ├── revery_notebook.html          ← Legacy redirect stub for old web bookmarks
│   ├── main.css / prose.css          ← Shipped styles. Historically Tailwind output;
│   │                                    the Tailwind pipeline is dead — these are
│   │                                    HAND-MAINTAINED now (css_aesthetics/ is archival)
│   ├── fonts/ image_assets/          ← Brand fonts (woff2/ttf/otf), background images
│   └── jvscrpt_and_css_extra/
│       ├── native_api.js             ← Unified NativeAPI abstraction (Electron/Tauri/web)
│       ├── project_sidebar.js        ← GENERATED bundle — edit src/sidebar/, npm run build:sidebar
│       ├── pdf_print.js              ← Print-page logic (payload graft + print + self-close)
│       ├── find_worker.js            ← Regex search Web Worker (loaded at runtime, not a <script>)
│       └── markdown_editor_*.js      ← Editor core, menus, actions, export, sync, find, theme, lang
│
├── src/sidebar/                      ← Sidebar source modules (state, save, tree, cards,
│                                        fileops, dnd, search, yaml_index, project_scan,
│                                        link_rewrite [pure, unit-tested], link_complete, …)
├── electron/
│   ├── main.js                       ← Main process wiring: window, IPC, policy
│   ├── fs_core.js                    ← Pure FS logic (atomic writes, settings store) — unit tested
│   ├── zip_core.js                   ← Dependency-free zip writer for project export — unit tested
│   └── preload.js                    ← contextBridge (exposes window.electronAPI)
├── tauri/
│   ├── Cargo.toml / tauri.conf.json  ← Rust deps, window config, CSP
│   ├── capabilities/                 ← Window permission sets (main + minimal pdf-print-*)
│   └── src/main.rs                   ← #[tauri::command] implementations + tests
├── build_tools/                      ← esbuild scripts (CM bundle + sidebar bundle)
├── test/                             ← node:test suites incl. crash-consistency, links and E2E
├── svg_icons_to_use/                 ← The ONLY approved icon source (Harald Revery glyphs)
├── images_for_installer/             ← Windows installer branding bitmaps (NSIS/WiX specs)
└── package.json                      ← npm scripts + electron-builder config (incl. NSIS wizard)
```

> Historical note: this document originally described a porting kit
> (core_boot_patch.js, html_changes.diff, project_sidebar.css). That
> integration was completed long ago — the sidebar now lives in
> `src/sidebar/` and everything above reflects the real tree.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                     Revery Notebook Frontend                   │
│  (index.html + all existing JS/CSS — unchanged API) │
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

### Full API Surface (grouped)

| Group | Methods |
|---|---|
| Filesystem | `openFolderDialog`, `setRootPath`, `readDirectory`, `readFile`, `writeFile` (atomic), `createFile`, `createDirectory`, `renameNode`, `deleteNode`, `copyFileIntoFolder`/`copyIntoFolder`, `copyPathIntoFolder` |
| Crash backup | `setVolatileContent`, `getVolatileContent`, `deleteVolatileContent`, `getVolatileStatus`, `listVolatileBackups`, `checkVolatileStartup` |
| Watching | `watchFile`, `unwatchFile` (per-path serialized so watch/unwatch can never race) |
| Dialogs / window | `showMessageBox` (multi-button routed through an in-page HTML dialog on Tauri), `onWindowClose`, `confirmClose`, `minimizeWindow`, `toggleMaximizeWindow`, `closeWindow`, `setFullscreen`, `showInExplorer` |
| Settings / pointers | `getLastOpenedFile`/`setLastOpenedFile`/`clearLastOpenedFile`, `getLastRootPath`/`setLastRootPath`, `getPendingRename`/`setPendingRename`, `getProjectHistory`/`setProjectHistory`, `getAppDataPath`, `getDefaultNotesFolder`, `clearAllSettings` |
| Export | `exportProjectZip` (no args — backend owns source root and destination), `exportLatexZip(tex, images, baseName, bundleFonts)`, `exportPdf(html, opts)` (Electron only — `null` elsewhere), `exportPdfWindow(html)` (Tauri only — dedicated print window) |
| Media | `toMediaUrl(absPath)` (file:// on Electron, asset protocol on Tauri), `onNativeFileDrop`, `listSystemFonts` (Electron/web: Local Font Access API; Tauri: Rust fontdb) |

Feature detection is by METHOD PRESENCE, not by environment name: e.g. the
exporter checks `typeof NativeAPI.exportPdf === 'function'` (Electron direct
PDF) and falls to `exportPdfWindow` (Tauri) and finally the in-page print
path (web). New platform-specific features must follow this pattern.

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

**Implemented in**: `markdown_editor_core_cm.js` (boot IIFE) +
`src/sidebar/lifecycle.js` (project restore, pending-rename reconciliation).

### Priority Order
```
1. window.NativeAPI.isDesktop === true
       └─► getLastOpenedFile() returns a path
               └─► readFile(path) succeeds   →  USE DISK CONTENT  ✓
               └─► readFile(path) fails       →  clear pointer, fall through
       └─► getLastOpenedFile() returns null   →  fall through

2. localStorage.getItem(AUTOSAVE_KEY) !== null  →  USE LOCALSTORAGE  ✓

3. Neither                                      →  SHOW WELCOME TEXT  ✓
```

On desktop the sidebar boot additionally restores the last project root
(`getLastRootPath()` → `setRootPath()`, backend-verified against
`trustedRoots`), seeds the project quick-switch history, reconciles any
pending rename that was interrupted by a crash, and offers recovery when
volatile crash-backups from an interrupted save are found. The boot IIFE
calls `render()`/`countWords()` itself — there is deliberately no second
standalone render call.

---

## Project File Sidebar

**Files**: `src/sidebar/*` (source modules) → bundled to
`www/jvscrpt_and_css_extra/project_sidebar.js` by `npm run build:sidebar`.
Styles live in the main stylesheet + styles injected by
`src/sidebar/dialogs.js`.

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
- Entries are sorted by the user's chosen sort (name/modified/created, asc/desc);
  directories first
- Hidden files/folders (`.dotfile`) are filtered out
- ALL file types are shown, categorized by extension (`getFileCategory`):
  `text` (.md/.txt — openable), `media` (images — previewable), `other`
  (shown dimmed/orange, not openable)
- A card view (with text/image previews) can replace the tree; drag-and-drop
  moves files/folders; multi-select supports bulk rename/delete/move

### Context Menu Actions (translated EN/SV)

| Target | Actions |
|---|---|
| Text file | Open, Rename, Show in Explorer, Delete |
| Media file | Preview, Rename, Show in Explorer, Delete |
| Other file | Rename, Show in Explorer, Delete |
| Folder | New File Here, New Folder Here, Rename, Show in Explorer, Delete |
| Multi-selection | Rename N items…, Delete N items |
| Empty space | New File, New Folder |

### Links Follow Renames

Every rename/move path (single rename, multi-rename, drag-move, undo) runs
the link updater: `src/sidebar/link_rewrite.js` — a PURE, unit-tested module
(`test/link_rewrite.test.js`) — resolves every markdown link with the same
semantics as the renderer and rewrites only links that resolved to a moved
path. The user confirms first (dialog lists the exact files); the active
document is edited in the editor buffer (undoable), other files through the
atomic write path; undo re-runs the rewriter with the inverse mapping.

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
atomic tmp-rename write (`src/sidebar/save.js`). The `localStorage`-based
export shortcut in `markdown_editor_actions_cm.js` activates only when no
desktop file is open — it defers via `window.sidebarGetActiveFilePath()`.
Both handlers are wired; this is a description, not a to-do.

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

### IPC Channel Map (grouped; every channel type-validates its payload)

| Group | Channels |
|---|---|
| FS | `fs:read-directory`, `fs:read-file` (20 MB cap), `fs:write-file` (atomic via `fs_core.atomicWriteFile`), `fs:create-file`, `fs:create-directory`, `fs:rename-node`, `fs:delete-node` (→ trash), `fs:copy-into-folder`, `fs:set-root-path` (trustedRoots-verified) |
| Crash backup | `fs:set/get/delete-volatile-content`, `fs:get-volatile-status`, `fs:list-volatile-backups` |
| Watch | `fs:watch-file`, `fs:unwatch-file` |
| Dialogs | `dialog:open-folder`, `dialog:save-file`, `dialog:show-message-box` |
| Export | `project:export-zip` (no renderer args), `export:pdf` (temp file → hidden sandboxed window → `printToPDF` → atomic write), `export:latex-zip` (image paths root-validated; `bundleFonts` allowlisted) |
| Window | `window:confirm-close`, `window:close`, `window:minimize`, `window:toggle-maximize`, `window:set-fullscreen` |
| Settings | `settings:get/set-last-opened-file`, `settings:get/set-last-root-path`, `settings:get/set-pending-rename`, `settings:get/set-project-history`, `settings:clear-all` |
| Misc | `app:get-data-path`, `app:get-default-notes-folder`, `shell:show-in-folder` |

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

### Rust Command Map (registered in `generate_handler![]`)

| Group | Commands |
|---|---|
| FS | `open_folder_dialog`, `set_root_path`, `read_directory`, `read_file` (20 MB guard), `write_file` (atomic), `create_file`, `create_directory`, `rename_node`, `delete_node` (→ system trash via `trash` crate), `copy_into_folder`, `copy_path_into_folder`, `save_file` |
| Crash backup | `set_volatile_content`, `get_volatile_content`, `delete_volatile_content`, `get_volatile_status`, `list_volatile_backups` |
| Watch | `watch_file` / `unwatch_file` (`notify` crate → `file-changed` events) |
| Export | `export_project_zip` (no renderer args; `zip` crate, atomic write), `export_latex_zip` (per-image root validation + allowlisted `bundle_fonts` via `include_bytes!`) |
| Dialog / window | `show_message_box`, `confirm_close`, `minimize_window`, `toggle_maximize_window`, `close_window`, `set_fullscreen`, `show_in_folder` |
| Settings | `get/set_last_opened_file`, `get/set_last_root_path`, `get/set_pending_rename`, `get/set_project_history`, `get_app_data_path`, `get_default_notes_folder`, `clear_all_settings` |
| Fonts | `list_system_fonts` (fontdb enumeration — family names only, no paths) |

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

### Tauri Scopes & Capabilities (actual model)

There is NO fs-plugin scope — all filesystem access goes through the custom
commands above, each of which validates paths itself (`safe_path` /
`safe_path_inside` against the managed project root).

- **Asset protocol**: enabled with an EMPTY static scope. When a project
  root is opened, Rust grants it dynamically
  (`app.asset_protocol_scope().allow_directory(...)`) — but ONLY for roots
  present in the backend-owned `trustedRoots` list, which the renderer
  cannot modify. This is how project images render (`toMediaUrl` →
  `convertFileSrc`).
- **Capabilities** (`tauri/capabilities/`): the `main` window gets
  `core:default` + window-drag + create-webview-window; the transient PDF
  print windows (`pdf-print-*` glob) get a minimal close-only capability —
  they render user document content and deliberately have no broad command
  surface.

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

Historical — the integration this checklist described was completed. The
sidebar is developed in `src/sidebar/` and bundled by
`npm run build:sidebar`; data-safety logic lives in `electron/fs_core.js`
and `tauri/src/main.rs` and is covered by the test suites (see Testing).

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
| `build:electron` | `.dmg` | `.exe` (NSIS assisted wizard, branded) + portable `.exe` | `.AppImage`, `.deb` |
| `build:tauri` | `.dmg`, `.app` | `.msi` (WiX, branded), `.exe` (NSIS, branded) | `.AppImage`, `.deb` |

Windows installer branding comes from `images_for_installer/` (spec-exact
BMPs for NSIS header/sidebar and WiX banner/dialog). **Version numbers**
live in three places that must be bumped together for a release:
`package.json` (Electron), `tauri/tauri.conf.json` (Tauri bundles),
`tauri/Cargo.toml` (crate) — plus the human-facing strings in
`www/index.html` (JSON-LD `softwareVersion`) and the About text in
`markdown_editor_lang.js`.

---

## Slow Hardware Mode

Settings → "Slow Hardware Mode" (persisted as `slowHardwareMode` in
`revery_md_settings`; canonical setter `window.setSlowHardwareMode()` in
markdown_editor_menus.js). One switch for machines with slow disks, little
RAM, or weak CPUs/GPUs. **It only reduces work frequency and visual load —
every disk write keeps the identical atomic-write + fsync durability.**

| Lever | Normal | Slow mode | Where |
|---|---|---|---|
| Sidebar auto-save debounce / forced | 1.5 s / 10 s | 4 s / 20 s | src/sidebar/save.js |
| Crash-backup debounce / forced | 2 s / 15 s | 5 s / 30 s | native_api.js |
| Preview render debounce | user setting | floored at 400 ms | core_cm.js + sync.js |
| Background image | user choice | suppressed (choice kept) | menus.js applyBackground |
| Card view text previews / image thumbs | loaded | skipped (icons only) | src/sidebar/cards.js |
| Tree render chunk size | 100 rows/yield | 40 rows/yield | src/sidebar/tree.js |

Every consumer reads `window.slowHardwareMode` at call time, so toggling
applies immediately. The only safety trade-off is the crash-backup window:
a hard crash mid-typing can lose ~5 s of keystrokes instead of ~2 s (the
saved file itself is never at risk).

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
| `test/zip_core.test.js` | Zip export: archive validity (CRC + `unzip -t`), UTF-8 names, symlinks never enter the archive, destination self-exclusion, size caps, deterministic output; `buildZipFromEntries` (LaTeX-project assembler) auto parent-dirs + unsafe-name rejection |
| `test/link_rewrite.test.js` | The pure link rewriter behind rename/move link-updating: encoding round-trips (%20/%25/parens/unicode), `../` traversal, folder-prefix moves, self-moved files, fenced/inline code opacity, scheme/anchor immunity, undo (inverse-mapping) round-trip |
| `test/find_e2e.test.js` | Boots the REAL app in Electron and asserts ~19 feature suites: regex worker + ReDoS, slow-hardware mode, backgrounds pipeline, live-preview parity, YAML autocomplete, export builders (PDF/LaTeX incl. Revery templates + engine gating), custom templates, custom fonts, link-path completion gating, Advanced Options, divider/menu interaction, the PDF print page graft |
| `tauri/src/main.rs` `mod tests` | Rust twins: `safe_path`, `safe_path_inside`, `atomic_write_file`, `is_cross_device_err`, zip export roundtrip/symlink-skip/self-exclusion |

`electron/fs_core.js` is the single source of truth for the Electron-side
atomic-write strategy — both `fs:write-file` and `dialog:save-file` call
`atomicWriteFile()`. Do not re-inline that logic into handlers; it is what
the tests pin down.

### Zip Project Export

File menu → *Zip Project Export* (desktop only; the entry is omitted in
web mode). The renderer calls `NativeAPI.exportProjectZip()` with **no
arguments**: the backend uses its own trusted project root as the
source and a native save dialog for the destination, so the renderer
can neither choose what is read nor where it is written. The walk
skips symlinks (a link inside the project can never leak outside
content into the archive), excludes the destination zip itself, and
enforces caps (65,000 entries / 512 MB — no zip64) with clear errors.
Electron builds the archive in `electron/zip_core.js` (dependency-free
PKZIP writer over node's zlib); Tauri uses the `zip` crate
(deflate-only features). Both write the archive through their atomic
write path, so a crash cannot leave a truncated zip. There is **no
password option** by design: classic zip encryption is broken, and a
fake lock would be worse than none.

### PDF & LaTeX Export

File menu → *Export as .pdf* / *LaTeX project (.zip)* open one options
popup (`markdown_editor_export.js` — the exporters were split out here so
`actions_cm.js` stays lean; option state lives in its own localStorage
key `revery_export_settings`).

**PDF** uses the PRINT pipeline, not a JS PDF library: the document is
built from the preview's own rendered HTML (KaTeX→MathML, hljs colors),
with the options applied as print CSS. Options: front page (title/author,
optional cover image — a built-in background texture or an imported one —
centered/corner layout, never numbered), clickable TOC, article/book
margins, font (Harald fonts get their brand treatment: bold renders
underlined, math scaled 0.7×), 8–18 pt, A4/A5/A6/Letter, page numbers,
optional page breaks before every H1/H2.

Three delivery paths, feature-detected in `runPdfExport`:
- **Electron** (`exportPdf` → `export:pdf`): HTML with a `<base href>` at
  the app's `www/` (code-color theme + brand fonts resolve) is written to
  a unique temp file, loaded in a hidden sandboxed window, `printToPDF`
  with `preferCSSPageSize` (+ minimal page-number footer template) → a
  vector, selectable PDF, written atomically. Pixel-exact reference path.
- **Tauri** (`exportPdfWindow`): the SAME standalone document is staged in
  localStorage and opened in a dedicated `pdf-print-<ts>` WebviewWindow
  (`pdf_print.html`/`pdf_print.js` grafts it wholesale via DOMParser —
  never document.write, which is a parser no-op — then `window.print()` →
  GTK dialog "Print to File"). This is the ONLY approach that renders
  correctly on WebKitGTK (iframe printing, in-app `@media print`, and
  native WebKitPrintOperation all failed); on failure the user gets a
  clear error dialog — there is deliberately NO fallback to a worse
  renderer. Unique labels prevent close/create races; the window runs
  under a minimal close-only capability. Page margins/paper are governed
  by the GTK dialog (WebKitGTK limitation — documented in the User Guide).
- **Web** (`printInApp`): the export document is injected into the live
  page under `#export-print-root` + `body.exporting-pdf` print rules and
  `window.print()` opens the browser dialog. Browsers are Chromium/Gecko,
  so the WebKitGTK cascade problem does not apply.

The E2E suite pins the print page's graft behavior (payload replaces the
page wholesale, title adopted, visible error without a payload).

**LaTeX project (.zip)**: the markdown→LaTeX converter plus every
referenced project image, rewritten to `images/<name>` (deduped,
LaTeX-safe names) so the archive is compile-ready. Templates come from a
registry (`LATEX_TEMPLATES`): Article/Report/Book (classic) plus
**Book (Revery)** (extbook, titlesec styling, the brand fonts BUNDLED
into the zip via an allowlist + `include_bytes!` on the Rust side) and
**Homework (Revery)**. Each template declares its supported engines —
the modal's Engine dropdown filters the Template list, so a fontspec
template can never be exported for pdflatex. Options: title page, TOC on
its own page, page breaks before H1/H2. The backend re-validates every
image path against the trusted root before reading; fonts can only come
from the fixed allowlist. Web mode falls back to a single-`.tex` download.

### YAML Frontmatter Autocomplete

Editing the frontmatter block suggests the keys and values used across
the project (first-party `@codemirror/autocomplete`; the source in
`markdown_editor_cm_setup.js` gates itself to the frontmatter region, so
the engine is inert everywhere else — always on, no setting). Data feed:
`window.sidebarYamlIndex` from `src/sidebar/yaml_index.js`, which parses
each note's frontmatter and caches the result **per file by mtime** —
rebuilds only re-read changed files. File enumeration comes from
`src/sidebar/project_scan.js` (`listProjectTextFiles`): a **shared,
TTL-cached primitive intended for reuse** — a future project-wide search
should consume it rather than growing its own walker. Caps: 800 files,
1 MB/file, 200 keys, 300 values per key. Web mode indexes the current
document only. Read-only by construction.

### Project Search

The sidebar's magnifier (icon: the 🔍 glyph extracted from the Harald
Revery Mono font as an SVG path — brand-consistent and immune to emoji
font fallback) or Ctrl+Shift+F searches every `.md`/`.txt` in the
project. `src/sidebar/search.js` consumes the shared
`project_scan.js` primitive (as designed) and caches file bodies
per-path by mtime with a 24 MB lid. Matching is case-insensitive
substring — deliberately NOT regex, so the project-wide path never
needs a ReDoS story (the in-document find bar covers regex, with its
worker + timeout). Results are DOM-built (never innerHTML — names and
snippets are untrusted), capped at 5/file and 200 total; clicking one
opens the file and selects the match, re-locating it if the file
changed since the scan. Read-only.

Note for VSCode users: launching the app from an integrated terminal can
inherit `ELECTRON_RUN_AS_NODE=1` from the editor, which makes
`require('electron')` return a path string and the app crash at
`app.whenReady`. Run `ELECTRON_RUN_AS_NODE= npm run start:electron` if you
hit that.

---

## User-Extensible Content (templates, fonts) & Editor Assists

- **Custom templates** (`markdown_editor_tmplt_list.js`): user-created
  YAML/markdown templates stored under `revery_custom_templates`
  ({v:1, yaml:[], md:[]}, validated on load, caps, duplicate-name
  rejection). Menus offer "New template…" (creation modal) and a hover ✕
  on custom rows; built-ins are untouchable.
- **Custom fonts** (`markdown_editor_menus.js`): the Editor/Preview font
  menus end with "Custom font…". Two kinds — imported font FILES (data-URL
  `@font-face` in one regenerated `<style id="custom-fonts-css">`, family
  `RvCustom-<id>`) and INSTALLED fonts by name (CSS resolves any installed
  family; the picker list comes from `NativeAPI.listSystemFonts()` —
  Local Font Access API on Electron/web, Rust fontdb on Tauri — rendered
  as an app-styled menu, never a native datalist). Stored
  under `revery_custom_fonts`; all application flows through
  `applyFontTypes()`, so live-preview parity, outline, KaTeX sizing and
  the Harald bold-underline rule handle customs automatically.
- **Link-path autocomplete** (`src/sidebar/link_complete.js` + a second
  CodeMirror completion source in `markdown_editor_cm_setup.js`): typing
  inside `![...](here)` suggests folders/media/notes, resolved with the
  SAME `resolveRel` semantics as the renderer and root-contained;
  accepting a folder descends. Returns null in web mode (source inert).
- **i18n conventions**: every user-visible string goes through
  `window.t()`; interpolations use `{n}`/`{name}` placeholder keys +
  `.replace()` so Swedish word order stays natural. Brand names and the
  crash-recovery technical detail text are deliberately untranslated.
- **Icons policy**: interface icons come ONLY from `svg_icons_to_use/`
  (Harald Revery font glyph extracts). `src/sidebar/icons.js` is generated
  from them; no third-party icon sets (the licence page carries no icon
  attribution).

---

## Known Limitations & Future Work

1. **Tauri multi-button dialogs** — ✅ RESOLVED: native_api.js routes every
   dialog with more than one button through an in-page HTML dialog
   (`showHtmlMessageBox`) that honors `defaultId`/`cancelId`; the Rust
   native dialog is only used for single-button notices.

2. **File watcher on macOS**: `fs.watch()` in Node.js and the `notify` crate
   both use `FSEvents` on macOS, which can have a ~1s delay. Consider
   `chokidar` (Electron) or the `notify` `PollWatcher` as fallback.

3. **Single-instance lock** — ✅ RESOLVED: `app.requestSingleInstanceLock()`
   in electron/main.js and `tauri-plugin-single-instance` in the Tauri
   builder; a second launch exits and focuses the existing window.

4. **Windows atomic rename** — ✅ RESOLVED: `atomicWriteFile` in
   electron/fs_core.js (and `atomic_write_file` in tauri/src/main.rs) fall
   back on EXDEV/EBUSY to a copy with a `.revery_bak` snapshot that is only
   deleted after the copy verifiably succeeded; covered by unit tests.

5. **Tauri v1 compatibility**: The Rust code targets Tauri v2. For v1,
   replace `app.path().app_config_dir()` with `app.path_resolver().app_config_dir()`,
   and use `tauri::api::dialog` instead of `tauri-plugin-dialog`.
