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
│   ├── main_rn.css / prose_rn.css    ← Shipped styles, GENERATED — never edit these.
│   │                                    Source of truth: css_aesthetics/ inputs;
│   │                                    rebuild with `npm run build:css`
│   ├── fonts/ image_assets/          ← Brand fonts (woff2/ttf/otf), background images
│   └── jvscrpt_and_css_extra/
│       ├── native_api.js             ← Unified NativeAPI abstraction (Electron/Tauri/web)
│       ├── project_sidebar.js        ← GENERATED bundle — edit src/sidebar/, npm run build:sidebar
│       ├── pdf_print.js              ← Print-page logic (payload graft + print + self-close)
│       ├── find_worker.js            ← Regex search Web Worker (loaded at runtime, not a <script>)
│       └── markdown_editor_*.js      ← Editor core, menus, actions, export, sync, find, theme, lang
│
├── src/sidebar/                      ← Sidebar source modules (state, save, tree, cards,
│                                        fileops, dnd, media_ingest, search, yaml_index,
│                                        project_scan, link_complete, …). Pure + unit-tested:
│                                        paths [the ONLY path rules, incl. uniqueName], link_rewrite,
│                                        drop_transport, block_insert, eol [line-ending rules]
├── electron/
│   ├── main.js                       ← Main process wiring: window, IPC, policy
│   ├── fs_core.js                    ← Pure FS logic (atomic writes, settings store) — unit tested
│   ├── zip_core.js                   ← Dependency-free zip writer for project export — unit tested
│   └── preload.js                    ← contextBridge (exposes window.electronAPI)
├── tauri/
│   ├── Cargo.toml / tauri.conf.json  ← Rust deps, window config, CSP
│   ├── tauri.windows.conf.json       ← Windows-only override (dragDropEnabled:false) — see
│   │                                    "Media & drag-and-drop"; must mirror the main window.
│   │                                    Never pass `--config tauri/tauri.conf.json` to the CLI:
│   │                                    it is merged AFTER this file and undoes it
│   ├── capabilities/                 ← Window permission sets (main + minimal pdf-print-*)
│   └── src/main.rs                   ← #[tauri::command] implementations + tests
├── build_tools/                      ← esbuild scripts (CM bundle + sidebar bundle) +
│                                        build_css.js (Tailwind one-shot; the standalone
│                                        Tailwind binaries live here too, gitignored)
├── test/                             ← node:test suites incl. crash-consistency, paths, links,
│                                        and two Electron E2Es (web-mode find/export, desktop media)
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
| Media | `toMediaUrl(absPath)` (file:// on Electron, asset protocol on Tauri), `onNativeFileDrop` (Tauri's native drop event — subscribed only where `src/sidebar/drop_transport.js` selects the `native` transport), `listSystemFonts` (Electron/web: Local Font Access API; Tauri: Rust fontdb) |

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

### Media & drag-and-drop

One ingest, one path module, one drop transport per platform:

- **`src/sidebar/media_ingest.js`** is the only code that copies dropped or
  pasted files into the project and inserts media links. A source is either
  a DOM `File` (bytes → `copyFileIntoFolder`) or an absolute path from the
  wrapper's native drop event (`copyPathIntoFolder`); both backends create
  the destination with O_EXCL (unique `name (n).ext`, 20 MB cap, root-jailed).
  Destination folder and link base are the SAME value, `pendingNoteDir()`
  (state.js): the active note's folder, else — while an image is previewed —
  that image's folder, else the folder a first keystroke would create the
  note in (selected folder → project root). The inserted link is a normal
  undoable transaction, so it flows through autosave and, with no note open,
  through the scratchpad auto-create, which uses the same `pendingNoteDir()`.
- **Editor drops** are handled in the capture phase on the CodeMirror
  wrapper, so CodeMirror's own drop handler never sees them (it would insert
  a text file's contents or a `file://` URL). The editor accepts images only;
  other OS files get a status toast pointing at the file panel. Sidebar rows
  and cards announce themselves with the `application/x-revery-path` type
  (`SIDEBAR_ITEM_MIME`), whose value is a JSON array of every dragged file
  in tree order — a multi-selection travels as one drag
  (`setSidebarDragData`, helpers.js). Dropping it on the editor inserts one
  link per media file, each on its own line, relative to the note at drop
  time. `text/plain` still carries the markdown for external targets. There is no drop handler in the editor scripts anymore.
  In live preview a drop cannot aim at a character (the blocks are
  rendered HTML), so `window.livePreviewDropPos`
  (markdown_editor_livepreview.js) maps the point to a source line and
  the link goes in as its own paragraph after it — after the whole code
  block, table, quote or list item where splitting there would break it
  (`src/sidebar/block_insert.js`). The classic editor is unchanged.
- **`src/sidebar/drop_transport.js`** decides, once, which channel delivers
  OS files: `dom` (Electron everywhere; Tauri on Windows) or `native`
  (Tauri on Linux/macOS — WebKitGTK cannot read dropped File bytes). Exactly
  one channel copies; the other only prevents defaults. On Windows,
  `tauri/tauri.windows.conf.json` sets `dragDropEnabled:false` because wry's
  own drop target otherwise swallows every HTML5 drag inside the page
  (sidebar→editor links, drag-to-move). `test/tauri_config.test.js` pins the
  runtime rule to the config and the override to the base window (Tauri
  merges platform files with RFC 7396, which replaces the whole `windows`
  array — edit both files when the main window changes). The same merge
  bites at build time: the CLI forwards every `--config` argument as
  `TAURI_CONFIG`, which tauri-build and tauri-codegen merge AFTER the
  platform file, so `tauri build --config tauri/tauri.conf.json` shipped
  `dragDropEnabled:true` on Windows (every HTML5 drag dead AND OS drops
  ignored, since the JS listens to the DOM there). The npm scripts run the
  CLI without `--config`; the test evaluates their effective config.
- **`src/sidebar/paths.js`** holds every path rule (normalise, resolve,
  relative, encode/decode, root containment — case-insensitive for Windows
  spellings). The sidebar imports it; the editor scripts reach it as
  `window.ReveryPaths`, and the current link base as
  `window.sidebarGetLinkBaseDir()`. `resolveProjectMediaPath()` in
  core_cm.js is the single resolver behind the preview, the live-preview
  widgets and the LaTeX export; the rename-time link rewriter and the
  link-path autocomplete use the same functions, so a link means the same
  thing everywhere.
- **Clicking an image** in the panel previews it and PREPARES a note beside
  it: the editor becomes the ordinary scratchpad (no active file) holding
  the image link, `S.previewMediaPath` marks the image (tree highlight +
  note name). The first keystroke creates `<image-name>.md` next to the
  image through the normal scratchpad path (volatile crash backup, atomic
  create + write). No special mode exists in the save engine.
- Every path the Tauri backend hands to the renderer goes through
  `frontend_path()` (strips Windows `\\?\` verbatim prefixes that
  `canonicalize()` produces); Electron paths come from `path.join` on the
  realpath. `test/media_e2e.test.js` drives the whole flow in the real
  Electron main (preload + IPC) on a temporary project.

### Switching files, renaming and moving the open note

There is no "save first?" dialog: opening another file, previewing an
image, switching project or closing SAVES the open note first (through the
save queue) and aborts the switch if that save fails. A rename, move or
undo that affects the open note also lets pending saves finish first (so
no save can land on the old name), then hands over to the ONE retarget
function (`retargetActiveFile`, save.js): the path, watcher, crash backups
and any auto-save hold follow the file, and the dirty flag is left as it is
— a path change never marks unsaved edits as saved.

Typing with no note open creates one ("scratchpad", save.js). If the user
loads another document before that file exists, the typed text still goes
into the new note and the editor is left alone (the editor's document
generation, `window.getEditorDocGeneration()`, tells the two apart).

### Ctrl+S Behaviour (Desktop Override)

When `activeFilePath` is set, `Ctrl+S` calls `NativeAPI.writeFile()` with an
atomic tmp-rename write (`src/sidebar/save.js`). The `localStorage`-based
export shortcut in `markdown_editor_actions_cm.js` activates only when no
desktop file is open — it defers via `window.sidebarGetActiveFilePath()`.
Both handlers are wired; this is a description, not a to-do.

### External File Watch

When a file is opened, `NativeAPI.watchFile()` is called (one watcher at a
time). Every change event is verified under the disk lock against
`S._diskBaseline` — the exact text last read from or written to the file,
recorded by every save inside the same lock. Equal → our own write (or a
touch that changed nothing): ignored. Different from both the record and
the buffer → a real external change: the user chooses Reload / Save my
version & reload / Keep my version. There is no time window after a save in
which events are ignored (that used to let another program's change be
overwritten by the next autosave).

**Auto-save hold** (`setAutosaveHold`, save.js): background autosave never
writes a held file; an explicit save (Ctrl+S, switching files, closing)
does and lifts the hold. A sticky status message says so. Reasons:
- `conflict` — "Keep my version" (also Escape, also on a buffer without
  unsaved edits): the disk keeps the other program's version;
- `missing` — the file was deleted or moved by another program (autosave
  would recreate it); lifted automatically if it comes back unchanged;
- `unreadable` — another program rewrote it in an encoding the editor
  cannot read.
While held, the buffer is also mirrored to the durable backup slot. If the
watcher cannot start, a status message says so.

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
| Window | `window:confirm-close`, `window:close`, `window:minimize`, `window:toggle-maximize`, `window:set-fullscreen`; renderer → main (fire-and-forget): `window:close-ack`, `window:close-failed` |
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

### Close watchdog (both wrappers)

The window is frameless, and every close is handed to the page. A page
that is hung, or whose renderer died, could never answer — the window
could then only be killed. So the page acknowledges a close request at
once (preload.js / native_api.js), and the MAIN process (Electron) or Rust
(Tauri) steps in when:
- no acknowledgement arrives within 5 s → "not responding: Keep waiting /
  Force close";
- the page reports its close flow threw → "could not close normally: Keep
  open / Close anyway";
- (Electron) `render-process-gone` → "stopped: Reload editor / Close"; the
  reload's boot recovery offers the crash backup.
Every question defaults to the answer that discards nothing (in Tauri only
an explicit click on the force button closes; Enter and Escape keep the
window). Pinned by `test/close_watchdog_e2e.test.js`. macOS: every new
window starts with the close guard armed (a Dock reopen used to inherit a
stale "close allowed").

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
| Dialog / window | `show_message_box`, `confirm_close`, `close_request_ack`, `close_flow_failed`, `minimize_window`, `toggle_maximize_window`, `close_window`, `set_fullscreen`, `show_in_folder` |
| Settings | `get/set_last_opened_file`, `get/set_last_root_path`, `get/set_pending_rename`, `get/set_project_history`, `get_app_data_path`, `get_default_notes_folder`, `clear_all_settings` |
| Fonts | `list_system_fonts` (fontdb enumeration — family names only, no paths) |

**Threads.** Non-async Tauri commands run on the main thread, which also
drives the webview — slow disk work there freezes the window. Every command
that reads or writes file content, lists folders, copies, trashes or backs
up (`read_file`, `read_directory`, `write_file`, `rename_node`,
`delete_node`, `copy_*`, all crash-backup commands, the exports) is
`async` and runs its I/O on the blocking pool. The settings commands stay
synchronous ON PURPOSE: they then run in the order the renderer sends them
(several of those calls are fire-and-forget). Native dialogs are parented
to the main window (`file_dialog_for` / `message_dialog_for`), so they are
modal like Electron's.

Every path a command RETURNS (directory entries, copied-file paths,
`save_file`'s new root, the stored last root / last file) passes through
`frontend_path()`: on Windows, `canonicalize()` yields verbatim paths
(`\\?\C:\…`) under which `/` is not a separator and which defeat the
renderer's prefix and containment checks; `strip_verbatim_prefix()` (unit
tested) reduces them to ordinary spelling and leaves `\\?\Volume{…}` alone.
Internal Rust operations keep using fully canonical paths.

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

A `.meta.json` sibling file records the original path and timestamp. At
startup the boot recovery offers the last opened file's backup (and any
scratchpad backup); the 7-day purge never deletes the last opened file's
backup, since it runs on a timer, not after that offer.

### Atomic Writes

`writeFile()` never writes directly to the target path. It always:
1. Writes to a unique sibling `<name>.<unique>.revery_tmp` (both wrappers)
   and fsyncs it
2. Calls `rename()` over the target, then fsyncs the folder (POSIX)

A crash mid-write leaves the original file intact; a leftover
`.revery_tmp` is harmless.

### Text encoding, line endings, lone surrogates

- **Strict UTF-8 reads.** A file that is not valid UTF-8 (Windows-1252,
  UTF-16, …) is REFUSED with the same message on both wrappers
  (`readUtf8TextStrict` / `read_text_strict`) — never decoded lossily,
  which let the next autosave replace every non-UTF-8 byte with U+FFFD. A
  leading BOM is kept.
- **Line endings** (`src/sidebar/eol.js`). The editor always holds `\n`. A
  file that was purely CRLF is written back as CRLF; LF and mixed files are
  written as LF.
- **Lone surrogates** (e.g. a non-`u` regex replace that split an emoji)
  become U+FFFD at the NativeAPI write boundary for both wrappers (Tauri's
  IPC would otherwise reject every save of that document).

### Find & replace

Replace uses the match positions the editor shows NOW (the highlight layer
is mapped through every edit and emptied by a file switch) and verifies the
current query still matches exactly there, in full-text context, before
changing anything — a stale offset used to overwrite unrelated text, even
in another file. Replace All only applies if the text did not change while
the worker ran.

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
| FS scope bypass | There is no fs plugin: every file-system call is a custom command that validates its paths (`safe_path_inside`) |
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
tree, cards, file operations, drag-and-drop, media ingest, paths, watcher,
lifecycle). After editing anything there, rebuild the single-file bundle the
HTML loads:

```bash
npm run build:sidebar
```

The bundle is committed so the web version and both wrappers work without a
build step. Never edit the bundle directly — the banner comment says so too.

### Shipped CSS (main_rn.css / prose_rn.css)

`www/main_rn.css` and `www/prose_rn.css` are **generated files**. The source
of truth is `www/css_aesthetics/` (`input.css`, `input_prose.css`,
`theme.css`). After editing anything there, rebuild:

```bash
npm run build:css        # one-shot; dev.sh / dev.bat are the watch variants
```

Which files get scanned for Tailwind class names is declared with `@source`
directives inside the inputs (automatic detection is disabled with
`source(none)` so vendor bundles can't leak tokens into the output). The
unminified `*_max.css` twins in css_aesthetics/ are debug copies. Like the
sidebar bundle, the outputs are committed — always commit inputs and
regenerated outputs together. The Tailwind standalone binary is gitignored;
build_css.js prints the download URL if it's missing.

Two hard couplings to respect when touching prose styles: menus.js
(`applyUiSizeProseCompensation`) mirrors `.prose h1` = 3rem, `.prose h2` =
1.875rem and the `.prose-lg` base 1.125rem; and the theme system remaps the
`--tw-prose-*` variables in revery_notebook_style.css — those variable names
are a contract. Dark-palette rules in these inputs key on `.dark` (the app
theme, see [Themes](#themes)), never on `@media (prefers-color-scheme)`.

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

## Themes

`markdown_editor_theme.js` runs first in `<head>` and sets, before anything
paints: `data-theme` (selects a palette block in revery_notebook_style.css),
the `.dark` class and `color-scheme` on `<html>`.

**One dark signal.** Every rule that differs between light and dark palettes
keys on `html.dark` — in revery_notebook_style.css, the CodeMirror theme in
cm_setup.js and the Tailwind inputs. Never key a rule on a theme NAME
(`[data-theme="light"]` left Paper with a white-on-cream selection) or on
`@media (prefers-color-scheme)` (the OS setting; it painted white footnotes
on light app themes). Only the palette blocks themselves use `data-theme`.
A palette defines ALL its colors as variables — including `--bg-rgb` /
`--bg-panel-rgb` (`r, g, b` triplets the background-image overlays add
alpha to), `--selection` (editor + live preview selection tint) and
`--flash-rgb` (the preview→editor click flash, yellow in every built-in) —
and is added to `DARK_PALETTES` in theme.js if dark.

Dark-palette prose rules must stay scoped under `.prose` (or
`:is(#preview, .lp-render)`): the in-app PDF print (export.js
`printInApp`, Tauri/web) renders the preview's innerHTML — without the
`.prose` wrapper — inside the live, themed page, and an unscoped
`.dark .footnotes` rule once printed gray footnotes on white paper.

**Custom theme** (Settings → Theme → Custom theme…). The dialog in menus.js
(`openCustomThemeDialog`) has five controls, each slider changing only what it
names: base light/dark; Text color and Text saturation; Background color and
Background saturation (stored as `textHue`, `textSat`, `bgHue`, `bgSat`;
`test/custom_theme.test.js` pins that independence). theme.js's
`buildCustomPalette()` turns them into every palette variable except
`--bg_oacity`. Muted text, the highlight (`--accent`), the selection tint and
the click flash all derive from the text color, so one pick colors the whole
UI and document; in a custom theme the editor shows only that color
(`[data-custom-theme]` flattens the syntax colors, like `.dark`) and the
prose rules that force black/white are routed to `--text`. Colors are built
in OKLCH with lightness fixed per role and base, so the controls move only
hue and chroma; the text sliders' tracks are painted with the generator's own
`textColor()`, so the color shown is the color applied. The palette is set as inline
custom properties on `<html>` over its base block (`data-theme` = the base,
plus a `data-custom-theme` attribute), so the base block still supplies
`--bg_oacity` and the Background opacity override keeps working.

- Storage (`revery_md_settings`): `themeMode` holds the custom theme's BASE,
  plus `customTheme {base, textHue, textSat, bgHue, bgSat}` and
  `customThemeActive`. `normalizeCustom` also reads the earlier
  `{hue, vivid, split, tint}` layout (background hue stored as an offset).
  A build without custom themes therefore still opens readable. Both
  theme.js and menus.js validate the stored values (`normalizeCustom`),
  because an unknown `data-theme` matches no palette and empties every color.
- Every theme change restyles the whole document: about 40 ms for 20 KB of
  markdown and 1 s for 600 KB (76k elements), built-in themes included.
  The dialog therefore previews live while dragging only while one repaint
  stays under 100 ms, and otherwise applies on release.
- `test/custom_theme.test.js` checks the contrast of every control
  combination. Change the generator's numbers only with it green.

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
| `test/fs_core.volatile.test.js` | Crash-backup lifecycle: dir safety checks, set/get/delete, prefix listing, age purge that never deletes on unreadable metadata nor the kept (last-opened) backup |
| `test/fs_core.read.test.js` | Strict UTF-8 reads: valid UTF-8 / BOM / CRLF round-trip byte for byte; Windows-1252 and UTF-16 are refused and left untouched |
| `test/fs_core.rename.test.js` | The only rename-over-existing exception (case-only alias of the SAME file); two different files differing only in case are never treated as one |
| `test/eol.test.js` | Line-ending rules: which files keep CRLF, normalisation, byte-exact round-trip |
| `test/unique_name.test.js` | New/renamed/imported/moved names: case-insensitive collisions, trailing `_2024` kept, the renamed file does not block its own spelling |
| `test/data_safety_e2e.test.js` | Boots the REAL desktop app on a temp project: Replace after edits / file switch / regex context; scratchpad race; sidebar Ctrl+Z; rename during a "Keep my version" hold; open-note links follow a rename; CRLF kept; external write right after an autosave detected; a note moved away by another program not recreated |
| `test/close_watchdog_e2e.test.js` | The app can always be closed, never silently: normal close, a failing close flow, a renderer reported gone (reload offered), a hung page (force close offered after 5 s) |
| `test/crash_consistency.test.js` | A child process is SIGKILLed mid-write 12 times; the target file must always contain exactly one complete payload |
| `test/zip_core.test.js` | Zip export: archive validity (CRC + `unzip -t`), UTF-8 names, symlinks never enter the archive, destination self-exclusion, size caps, deterministic output; `buildZipFromEntries` (LaTeX-project assembler) auto parent-dirs + unsafe-name rejection |
| `test/link_rewrite.test.js` | The pure link rewriter behind rename/move link-updating: encoding round-trips (%20/%25/parens/unicode), `../` traversal, folder-prefix moves, self-moved files, fenced/inline code opacity, scheme/anchor immunity, undo (inverse-mapping) round-trip |
| `test/find_e2e.test.js` | Boots the REAL app in Electron and asserts ~19 feature suites: regex worker + ReDoS, slow-hardware mode, backgrounds pipeline, live-preview parity, YAML autocomplete, export builders (PDF/LaTeX incl. Revery templates + engine gating), custom templates, custom fonts, link-path completion gating, Advanced Options, divider/menu interaction, the PDF print page graft |
| `test/latex_compile.test.js` | Builds every document in `helpers/latex_cases.js` through the real exporter (web-mode Electron) and compiles each with pdflatex: headings after tables, false `$` spans, footnotes in headings, `[bracket]` items, deep nesting, entities, Unicode/emoji. Skipped without a display or pdflatex |
| `test/link_complete.test.js` | The link-path completion feed: desktop-only, root containment (`..` may climb, never leave; absolute/URL quiet), folders+images+notes only, decoded prefix filter with raw `rawSegLength`, `kind` per row, Windows spellings, size cap |
| `test/block_insert.test.js` | The pure paragraph inserter behind live-preview drops: blank line on each side only where missing, never glued onto text (also from a stale mid-line point), document start/end, multi-link blocks, cursor on the blank line after |
| `test/paths.test.js` | The single path-rule module behind preview, export, link rewriting, autocomplete and media ingest: normalisation, resolve/relative (incl. Windows case-insensitivity), encode/decode round-trips, root containment (sibling-prefix attack, verbatim prefix) |
| `test/tauri_config.test.js` | Pins the per-platform file-drop transport to the Tauri config: the Windows override mirrors the main window except `dragDropEnabled:false`, `drop_transport.js` agrees with it, and every npm `tauri build`/`dev` script produces that window once its `--config` arguments are merged the way tauri-codegen does; plus the sidebar drag payload's encode/decode |
| `test/media_e2e.test.js` | Boots the REAL Electron main (preload, IPC, atomic writes) on a temporary project and drives real DragEvent/ClipboardEvent drops: one encoded link per image, preview resolves it, non-media never copied, sidebar payload inserts once, a Ctrl+click multi-selection dragged from the real tree inserts one link per image on consecutive lines in tree order, image click previews from its own folder, media dropped while previewing lands beside the note it creates with every link resolving, paste, autosave, no native dialog; in live preview a sidebar image dropped on a rendered list item / code line / paragraph lands as its own paragraph after that item / after the whole fence / after the paragraph; in card view a media card owns the drag (its thumbnail `<img>` is non-draggable), so grabbing the picture carries the card payload |
| `test/livepreview_e2e.test.js` | Boots the REAL app in Electron (web mode, via the generic `test/helpers/web_e2e_main.js` + `lp_e2e_driver.js`) and drives the live preview with DOM mouse events: a click on rendered text lands on THAT word of the source (paragraph, list item, code line, table cell, lower row of a wrapped paragraph) the layout never changes while the button is down (a click's block reveals on release, and a few px of pointer jitter during a click selects nothing), CodeMirror's height map matches the screen below lists/quotes/code/tables, a click on the blank line at a block's edge reveals nothing and never scrolls, a click beside a block lands on the row at that height, a click that changes a block's height moves the side with less visible text (low on the screen it changes downward, high on the screen upward, a block taller than the screen keeps the clicked row under the pointer; also when the previously edited block re-renders above — on screen or scrolled out of view), typing and arrow keys keep the caret's line in place when blocks switch (a lazy-continuation merge, leaving a revealed block, ArrowUp into a tall paragraph without a jump), the block being edited keeps its rendered height (headings, a tight and a nested list, a quote, a wrapped paragraph — at two text sizes), images and `$$` math stay rendered under their source while edited, undrawn blocks keep their measured heights, a drag started on a rendered block selects text, a drag into a rendered block extends character by character with the covered rendered text painted (CSS Custom Highlight) while the block stays rendered, a block the range spans is marked as a unit, heads stay stable over widgets, double-click selects the word, shift-click extends, right-click places the cursor without dragging, select-all keeps spanned blocks rendered, Shift+Arrow into a rendered block paints exactly the selected characters and typing replaces them in the source, arrow keys still reveal, checkboxes and YAML pills keep their behaviour |
| `test/custom_theme.test.js` | The custom theme generator (theme.js in a vm): it sets exactly the variables every palette block defines; stored values are normalized or rejected (the earlier offset layout is converted); saturation 0 is neutral gray; each slider changes only what it names (text sliders never touch a background variable and vice versa); for every control combination (exact, via the extreme text and surface luminances, since any text color can meet any surface): text ≥ 7:1, muted text ≥ 4.5:1 (4:1 on hover), highlight ≥ 4.5:1 (3:1 on hover), editor gradient visible but gentle; selection tint visible on a dense grid; the text-slider tracks paint with the generator; boot and live switching never leave an empty palette |
| `test/theme_e2e.test.js` | Boots the REAL app (web mode) once with the OS in light mode and once in dark: every built-in palette and six custom ones are measured on screen (html.dark matches the actual background, body/footnote/editor-code contrast, visible selection, background-image overlay tinted with the palette's own `--bg`, click flashes yellow in built-ins and the highlight color in custom themes, one text color everywhere in a custom theme), identical under both OS settings; in-app PDF print stays dark-on-white under every palette; plus the custom theme dialog through the real menu: the text sliders apply the generator's color without moving the background and the background sliders leave the text alone, live preview, Escape/outside click/Cancel restore, Save stores the base + custom values, Reset, the Background opacity override stays independent |
| `tauri/src/main.rs` `mod tests` | Rust twins: `safe_path`, `safe_path_inside`, `strip_verbatim_prefix`/`frontend_path`, `atomic_write_file`, `is_cross_device_err`, zip export roundtrip/symlink-skip/self-exclusion |

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

Note: The web and Tauri version when toggling on the table of content for the pdf export most likely cause text to overlap and behave odd. This is maybe due to WebKitGTK and I can't fix it, use the Electron version if printing a non-broken pdf is important.

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

**Markdown → LaTeX rules that keep the output compiling** (all in
`buildLatexDocument`; the catalogue of documents that used to break lives
in `test/helpers/latex_cases.js` and `test/latex_compile.test.js` compiles
every one with a real pdflatex when available):
- Line endings are normalised to `\n` first; protected blocks (fences,
  math, tables, figures) become placeholders. A table's match must give
  back the newline it consumed — otherwise the next heading is glued onto
  the placeholder and printed as escaped text (`\#\# Title`).
- Inline `$…$` follows the preview's texmath rule exactly: no space just
  inside the delimiters, opener not after `\`/digit, closer not before a
  digit, never across a line. The old any-two-dollars rule made
  "costs $5 … $10" one math span; headings and `&` inside it reached TeX
  raw (`Missing $ inserted`).
- Prose goes through `latexEsc` (the ten specials) after HTML entities are
  decoded; inline order is CommonMark's (code spans, backslash escapes,
  links, emphasis with non-space edges, recursive bodies).
- Headings with footnotes emit `\section[short]{…\protect\footnote{…}}`;
  list items starting with `[` get `\item {}`; lists nest by indentation,
  capped at LaTeX's depth of 4; frontmatter `date` is escaped like title
  and author.
- Unicode: `SYMBOL_MACROS` maps comparison signs, double arrows, check
  marks, stars, boxes and Greek to macros under both engines (`amssymb`
  is in every template, including Book (Revery)); inside math the bare
  macro is used. Under pdflatex, `sanitizePdflatex` then replaces every
  remaining character its `utf8` tables lack (measured allowlist) with
  `?` and lists them in a `% NOTE:` at the top — the export always
  compiles and says what to change. XeLaTeX output is left untouched.

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

**Menu skin & keys** (shared with the link-path menu below): the
`#editor .cm-tooltip.cm-tooltip-autocomplete…` block in
`revery_notebook_style.css` skins the popup to the EDITOR — it inherits
the editor font family (`--editor-font`, custom fonts included) and
scales with the editor text size (em units off `#editor`'s inline
font-size), palette from the theme variables. The `#editor` prefix is
load-bearing: CodeMirror's base theme is scoped to a generated class on
the editor element (`.ͼ1 .cm-tooltip.cm-tooltip-autocomplete > ul`,
specificity 0,3,1), so un-prefixed rules lose silently — the menu once
shipped in the browser's generic monospace with CM's blue selection bar
for exactly that reason. Keys: menus open with nothing highlighted
(`selectOnOpen:false`) so Enter still inserts a newline; ↑/↓ highlight;
Enter accepts a highlighted row; **Tab accepts the highlighted row, or
the first row when none is highlighted** (cm_setup.js §5f, ahead of the
4-space Tab), and is swallowed rather than inserting spaces while a menu
is open; Escape closes; Ctrl+Space re-opens. The web-mode E2E checks the
computed font and selection colour, not just DOM presence.

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
  inside `![...](here)` / `[...](here)` suggests folders, images and
  notes reachable from the active note's folder, resolved with the SAME
  `paths.js` rules as the renderer (`..` climbs, never past the project
  root; absolute paths and URLs list nothing) and inserted with the same
  `encodeLinkDest` encoding. Folders first, then names; dot-entries and
  non-image/non-note files are hidden; prefix filter on the DECODED
  segment (`work%20st` matches "work stuff"); 60 rows max. Each row
  carries a `kind` (folder / image / note) rendered as a glyph from the
  app icon set (`window.sidebarIcon`, exported by the bundle). Accepting
  a folder inserts `name/` and re-opens the menu one level down; Tab
  accepts (see YAML menu keys above). Returns null in web mode (source
  inert). Unit-tested in `test/link_complete.test.js`; the desktop E2E
  (`media_e2e`) drives it through the real IPC. Note: a leading `/` is an
  absolute filesystem path here (as in the renderer), NOT "project root"
  as in VS Code/GitHub — changing that is a `paths.js` rule change that
  must land in renderer, link rewriter and completion together.
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

6. **HTML5 drag-and-drop on Windows (Tauri)** — with wry's drag-drop
   handler enabled, WebView2's drop target is replaced and no HTML5 drag
   inside the page reaches the renderer (sidebar→editor links,
   drag-to-move were dead on Windows). `tauri/tauri.windows.conf.json`
   disables it there; `src/sidebar/drop_transport.js` routes OS file drops
   through the DOM on that platform. Linux/macOS keep the native event.
   The first version of this fix never reached a binary: `npm run
   build:tauri` passed `--config tauri/tauri.conf.json`, which the build
   merges after the platform file (see "Media & drag-and-drop"). Fixed
   2026-09-13 in package.json and pinned by `test/tauri_config.test.js`;
   still unconfirmed on a real Windows build at the time of writing.

7. **Media links from the Tauri copy commands on Windows** — ✅ RESOLVED:
   `copy_into_folder`, `copy_path_into_folder` and `save_file` returned
   `\\?\`-prefixed paths, so a dropped image's link became a chain of `../`
   plus the absolute path and never rendered. All returned paths now go
   through `frontend_path()`.

8. **Both wrappers on one machine.** Electron and Tauri each prevent a
   second copy of themselves, not of each other. Running both on the same
   project gives two autosavers (the watcher then reports each other's
   writes as external changes). They share `%TEMP%/revery-volatile` with
   different backup-key hashes, so each only sees its own backups.

9. **Renderer crash reporting (Electron).** The "stopped — Reload editor"
   question relies on `render-process-gone`. On some Linux setups a crashed
   renderer is held by the system crash handler and the event is late or
   missing; the close watchdog still catches that case (a dead page cannot
   acknowledge a close). The E2E delivers the event rather than crashing.

10. **Case-only renames** (Windows/macOS) are allowed only when the backend
   proves both spellings are the same file; not exercisable on the Linux
   test machine (case-sensitive), where the guard's refusal is tested
   instead.
