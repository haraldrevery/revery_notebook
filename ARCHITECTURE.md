# Revery Notebook — Desktop Port Architecture

## Table of Contents
1. [Project Structure](#project-structure)
2. [Architecture Overview](#architecture-overview)
3. [The NativeAPI Abstraction Layer](#the-nativeapi-abstraction-layer)
4. [Boot Priority Logic](#boot-priority-logic)
5. [Project File Sidebar](#project-file-sidebar)
   - [Window Layout: Widths & Top Bar](#window-layout-widths--top-bar)
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
│       ├── markdown_editor_yaml.js   ← The ONE YAML frontmatter reader (window.ReveryYaml): Properties
│       │                                sheet, export metadata, autocomplete index — unit tested
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
| Filesystem | `openFolderDialog`, `setRootPath` (resolves to the root's canonical spelling), `readDirectory`, `readFile`, `writeFile` (atomic), `createFile`, `createDirectory`, `renameNode`, `deleteNode`, `canonicalEntryPath`, `copyFileIntoFolder`/`copyIntoFolder`, `copyPathIntoFolder` |
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
  path: string;           // "/Users/alice/Projects/notes.md" — canonical spelling
  type: 'file' | 'dir';   // a link (to a file OR a folder) is 'file'
  link?: boolean;         // symbolic link / junction (desktop backends)
  mtime?: number; ctime?: number;
}
```
`path` is the folder's realpath plus the entry's own name — the same
spelling `setRootPath` returns for the root and `canonicalEntryPath`
returns for any entry. A link is never walked into (it is listed as a
file), and moving, renaming or deleting it acts on the link itself.

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

**The last project cannot be opened** (a drive that is not connected, a
folder moved or renamed): the user is told ("Could Not Open Project") and
the app starts with no project. Text typed then has no note, so its crash
backup is its only copy: it is kept under a scratchpad key and mirrored to
the reboot-safe slot (`save.js` input listener, `_durableMirrorKey`). Open
Folder / a recent project keeps it on screen and creates its note in that
project (`fileops.switchProject` → `hasTextWithoutProject` →
`resumeScratchpadAfterSwitch`); New File and Import only say "No Folder
Open". Before, the start was silent, the text had no backup, Open Folder
emptied the editor and Import replaced it without asking. Otherwise the
next start offers the backup ("Recover unsaved text?").

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
- Card view navigation: a path bar (project root › … › current folder) when
  it fits the panel's width, else "← Back" + the current folder's name
  (re-checked when the panel is resized). Every ancestor segment and the
  Back button are drop targets: dropping cards there moves them up. Nothing
  above the project root is ever offered (`cards.js` NAVIGATION BAR)
- The card view's folder is remembered per project (`card_memory.js`, in
  localStorage like the view mode): a restart or a project switch reopens
  the folder it showed — else the last note's folder, else the root — and
  in card view the selected folder (where New File and new notes go)
  follows it. A remembered folder that is gone falls back to the nearest
  folder above it that still exists (`renderCards`). It used to open at
  the root at every start while the editor reopened the last note
- Links (symlinks/junctions) show the link glyph and are never walked into

### Context Menu Actions (translated EN/SV)

| Target | Actions |
|---|---|
| Text file | Open, Rename, Move to…, (Move up one level), Show in Explorer, Delete |
| Media file | Preview, Rename, Move to…, (Move up one level), Show in Explorer, Delete |
| Other file | Rename, Move to…, (Move up one level), Show in Explorer, Delete |
| Link | Rename, Move to…, (Move up one level), Show in Explorer, Delete (the link only) |
| Folder | New File Here, New Folder Here, Rename, Move to…, (Move up one level), Show in Explorer, Delete |
| Multi-selection | Rename N items…, Move to…, (Move up one level), Delete N items |
| Empty space | New File, New Folder |

"Move up one level" appears only when the items share one folder below the
project root. "Move to…" opens a folder picker (filterable, ↑/↓/Enter/Esc;
never the moved folder or anything below it; the current folder shown
disabled; links and dot-folders never offered; capped at 3000 folders with
a note). Both end in the same `moveNodes` as a drag-and-drop.

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
  The copy runs BEFORE the link is inserted and can take seconds, so the
  drop/paste position is held by an editor anchor
  (`window.anchorEditorRange`, cm_setup.js section 1b), not by offsets: it
  follows every edit made meanwhile and dies with its document. A note
  replaced meanwhile gets no link (a status message names the added files);
  a pasted-over selection is replaced only while it still holds the text it
  held at paste time, otherwise the link is inserted beside it. Plain
  offsets used to put the link into the note opened meanwhile, and to
  replace whatever text had moved under the old selection (typing after a
  paste destroyed text). `test/deferred_edits_e2e.test.js` pins both.
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

### Moving, renaming and deleting — the rules

Every move, rename, undo and delete (sidebar, card view, "Move to…", the
title bar) follows the same rules; the backends enforce them again
(`fs_core.renameEntry` / `trashableEntry`, Rust `rename_entry_blocking` /
`delete_node_blocking`, unit-tested on both sides):

- **Entries, never link targets.** The parent folder is resolved, the
  entry's own name is not (`validateEntryInside` / `safe_entry_inside`).
  Moving a link moves the link; deleting it trashes the link. A RELATIVE
  link is never moved to another folder (it would point somewhere else);
  renaming it in place is fine. The project root is never an entry.
- **Never overwrite, never copy-then-delete.** An existing destination
  (a dangling link included) is refused, except the same entry under a
  case-only different spelling. A move to another drive/volume is refused
  with a message — there is no copy fallback any more (it could leave a
  half-emptied original; in Tauri it could also merge into an existing
  folder because errno 17 was taken for "cross-device" on Unix, where it
  is EEXIST). A folder never moves into itself.
- **Windows transient locks** (antivirus, indexer, a watcher being closed)
  are retried up to three times (0.1/0.2/0.4 s), re-checking the
  destination each time; a rename happens completely or not at all.
- **One name rule** (`paths.checkEntryName`, mirrored by
  `fs_core.checkEntryName` and Rust `check_entry_name`): no empty names,
  separators or control characters, no leading dot (it would hide the
  item), no leading space or trailing dot/space, no Windows device names
  (CON, NUL, COM1, … also with an extension), not ending like Revery's
  safety files, at most 255 bytes. Applied to every NEW name (rename,
  multi-rename, title rename, new file/folder, import); a pure move keeps
  its name. A file keeps its extension unless the user typed the same one
  or another one of the same kind (`paths.renamedFileName`: "Meeting
  26.09.2026" stays a note). New folder refuses a name that exists.
- **Path identity.** The renderer adopts the canonical root
  (`setRootPath`'s answer) and canonical note paths (`openFile`, boot,
  Save As via `canonicalEntryPath`); "same location?" questions go through
  `paths.samePath` / `isInsideRoot`, and child paths are built in the
  listing's own separator style (`joinPath`, `parentPathOf`,
  `remapUnder`). A root opened through a link used to make a file dropped
  on its own folder become name_2.
- **State follows.** `remapPathState` moves the selected folder, the card
  view's folder, expanded folders, the previewed image and the selection
  anchor along with every record; `forgetDeletedPathState` falls back to
  the parent after a delete.
- **One operation at a time** (`S._operationLock`); a second one shows
  "Busy — try again in a moment." instead of vanishing.
- **Undo / redo** (moves/renames, 30 deep each; `fileops.stepFileHistory`)
  run from Ctrl+Z and Ctrl+Y / Ctrl+Shift+Z only while the user works in
  the file panel (`save.js sidebarUndoAllowed`: not in the editor, not in
  any text field, no dialog open, last press/focus in the panel) and say
  what they did. Both use the operation's own safety (lock, open note
  saved first, disk lock, retarget). Each entry remembers what happened
  to the links when it ran (`links`): 'updated' → undo/redo follow again
  without asking; 'declined' → links are never touched (a silent pass used
  to "fix" the moved notes' correct relative links into broken ones);
  otherwise links made since are offered with the usual question. Only
  what actually moved goes to the other stack. A new operation clears
  redo; a delete, a project change and Save As to another folder clear
  both (a deleted item's name can be reused by a new item).
- **Failures are reported** (move/rename/delete/undo dialogs list each
  item and the reason); the multi-delete question says "Move … to Trash".

### Switching files, renaming and moving the open note

There is no "save first?" dialog: opening another file, previewing an
image, switching project or closing SAVES the open note first (through the
save queue) and aborts the switch if that save fails. Every opener goes
through ONE function, `replaceOpenDocument(prepare, apply)` (save.js): save
the open note, run the opener's own awaiting (`prepare`, e.g. reading the
next note), then swap the document in a SYNCHRONOUS `apply` — right after a
last check that the open note has no unsaved edits. An edit that arrived
while saving or preparing (a dropped image's link landing after its copy,
an edit while the folder picker is open) is saved and the switch prepared
again; it used to be replaced unseen, kept only in a crash backup that is
never offered for a note that is not the last one opened. The folder
picker (`dialog:open-folder` / `open_folder_dialog`) only AUTHORIZES the
chosen folder; `setRootPath` switches the root after the old note is saved
(the picker used to switch it at once, so that save failed with "escapes
project root"). A rename, move or
undo that affects the open note also lets pending saves finish first (so
no save can land on the old name), then hands over to the ONE retarget
function (`retargetActiveFile`, save.js): the path, watcher, crash backups
and any auto-save hold follow the file, and the dirty flag is left as it is
— a path change never marks unsaved edits as saved.

The file-system part of every move, rename (title bar included), undo and
delete runs INSIDE the save engine's disk lock (`fileops.inDiskLock`,
`save._enqueueDiskOp`): a save already queued lands before it, and a save
that captured the old path but runs after it is skipped
(`_goneActivePaths` → `'deferred-gone'`) and rescheduled for wherever the
note is now — it used to recreate the note at its old place, or resurrect
a deleted one (in Tauri, commands are not ordered, so even an explicit
write could land after the rename). When the open note is involved, its
watcher is stopped first and awaited (on Windows an open handle inside a
folder can block renaming it) and started again afterwards. Deleting the
open note (or a folder around it) first SAVES it, exactly as opening
another note would, so the copy in the Trash holds the latest text; then it
is closed. Nothing is deleted when that save fails or stops (another
program changed the file: its question comes up), nor while auto-save is
paused for the note — the version on screen is not on disk then, and a
status message says to save or resolve it first. Never put a dialog
inside the disk lock: saves would wait on it.

**Import** (sidebar) decodes strictly (`src/sidebar/import_text.js`): UTF-8
as is (a BOM kept), UTF-16 with a byte-order mark converted, anything else
refused with a message — `FileReader.readAsText` used to put U+FFFD in
place of every byte of a Windows-1252 file. A failed write is reported and
leaves no empty file behind.

**Total Reset** (Quit → Engine Stopped) saves the open note first when it
has unsaved edits, and does nothing — back to the editor, with a status
message — when that save fails or auto-save is paused for the note: the
reset reloads the app and forgets the last-opened note, so edits waiting
for autosave used to vanish without their crash backup ever being offered.
"Export & Continue" moves on only when the export was actually written.

Typing with no note open creates one ("scratchpad", save.js). Text typed
before that note exists is unsaved work like a dirty note's:
`replaceOpenDocument` (and New File / Import, via `saveBeforeLeaving`)
first waits for the note to be created — or creates it at once — and binds
it, then switches. If the note cannot be created (read-only folder, full
disk) the switch stops and says so ("Could Not Create File": the text
stays; "Save as..." saves it elsewhere). Such text used to be replaced like
an empty editor, its only copy a backup in the OS temp dir. While its note
is missing, that backup is also mirrored to the durable slot (reboot-safe;
boot recovery reads both), and a Save As of the text retires both. If a
document is swapped in some other way before the file exists, the typed
text still goes into the new note and the editor is left alone (the
editor's document generation, `window.getEditorDocGeneration()`, tells the
two apart).

**Project switches** (`switchProject`, fileops.js) empty the editor, then
make the backend switch root. Text typed in between is only backed up
(`S._projectSwitch`) and gets its note in the project that is open
afterwards — it used to be created in the project being left and stay
bound there, every save failing as "outside the project root". A folder
that cannot be opened (a recent project on an unplugged drive) leaves the
current project open, says why ("Could Not Open Folder"), and reopens the
note that was open; this used to reach only the console, the editor left
empty.

**Title renames and switching notes.** Renaming the open note in the title
field starts when the field loses focus — typically to the very click that
opens another note — or on Enter. A BACKGROUND autosave never applies a
title while the field still has focus (it used to rename the file to the
half-typed name, and pop up "Invalid Name" for a partial "v1."); explicit
saves (Ctrl+S, switching, closing) do. Everything that puts another document in the editor
(`openFile`, the media/unsupported previews, folder and project switches,
Save As) first awaits `waitForTitleRename()`, so the rename finishes on the
note it belongs to. `retargetActiveFile` only moves the OPEN note (it
returns false otherwise), and a save whose text belongs to a document that
has since left the editor (document generation changed) is dropped
(`'deferred-replaced'`). Before this (audit 2026-09-27), a rename finishing
after the switch pointed autosave at the renamed file while the editor
showed the other note — the next keystroke replaced the renamed note's
text; reliably so on slow disks, where the rename's fsync'd writes take
longer than a click.

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
version & reload / Keep my version. The question appears unasked, often
mid-typing, so its default (Enter, and Space where the dialog focuses it)
never discards: with unsaved edits it is "Save my version & reload" (both
versions kept, each in its own file); without, "Reload from disk" (nothing
to lose). It used to be "Reload from disk" in both cases, which dropped
the unsaved edits. There is no time window after a save in
which events are ignored (that used to let another program's change be
overwritten by the next autosave).

**Checked again before every write.** The watcher's event arrives ~300 ms
after another program's write (debounce); an autosave landing in between
used to overwrite that write unasked. `saveActiveFile` therefore compares
the disk with the record inside the disk lock, right before writing
(`compareDiskWithBaseline`, shared with the watcher): a changed or
unreadable file is never written — the save stops (`'deferred-verify'`)
and hands over to the watcher's own check (`checkActiveFileOnDisk`), which
asks the usual question. A vanished file is not recreated by a BACKGROUND
save (it gets the `missing` hold — on Tauri, whose watcher reports no
deletions, this is how a deleted note is noticed); an explicit save still
recreates it. An explicit save of a held file skips the check (the user
already chose their version). Closing while the question is pending keeps
the window open (no "discard?" dialog on top). The same check covers the
watcher's silent times: network shares without change notifications, a
watcher that died, the pause around the app's own file operations.

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

## Window Layout: Widths & Top Bar

One rule throughout: **sizes the user chose are pixels that a window
resize never changes; when the window is too small they give way on
screen only, and come back when there is room.** The saved values are
never rewritten by a resize.

**Text columns** (menus.js `applyColumnWidths`, `ColumnWidths`).
Settings → *Reading width* (preview, reader mode, live preview) and
*Editor width* (classic editor) store the TEXT width in px, or Full
(`readingWidthPx` / `editingWidthPx`, `null` = Full), plus the last
dragged width as a *Custom* row. The stylesheet caps each surface with
`--reader-max-width` / `--editor-max-width`; live preview and the classic
editor carry their side margins inside the capped box and add them back
in their `max-width: calc()`, so one setting gives the same text width in
LP and reader mode. Side margins (`--read-gutter`) are 52px on a roomy
pane and shrink to 20px (5% of the pane, container units) on a narrow
one, so a pane loses margin before it loses text. Settings saved before
the px model (window/pane percentages, "Fixed width") are converted once
against `screen.availWidth` and written back (`migrateLegacy`).

**Panes.** The dragged editor/preview split (`savedEditorWidth`) and the
sidebar width are px. The editor pane may shrink (`flex: 0 1 auto`) once
the preview is at its 200px min-width, and the sidebar's `max-width`
leaves both panes their minimums, so no saved width can push a pane or
the divider off a smaller window.

**Top bar** (layout.js "Top bar fit"). Labels never wrap. Instead of
width breakpoints (the bar's content depends on UI size, language, word
counter, status notices, logo position), a controller measures the two
button groups and applies the first state that fits: hide Export →
narrower title → short labels → minimal title → hide Outline, with the
logo centred while possible and slid aside otherwise; the last resort
narrows the title to the exact shortfall and right-aligns the row so the
window controls stay visible.

**Phone layout** (≤ 820px; also the desktop app, whose minimum window is
640). One pane at a time, chosen by `body[data-view]` (editor | preview |
sidebar). Its rules live in one place, `syncPhoneView()` in layout.js: on
the desktop layout the view is always `editor` (live preview's pane rules
key on `[data-view="preview"]`), and on a phone reader mode is always the
preview view. The view toggle names the view it switches to and follows
the attribute. The desktop app keeps its window controls in this layout;
the project-sidebar button exists only there. Status warnings: the top
bar's `#size-warning` is hidden in every phone view, so
`_renderStatusWarning` (core_cm.js) also writes the text to
`#phone-status`, a bar under the header shown only in this layout.
Submenus open on a tap: a tap's compatibility `mouseenter` and
`mouseleave` are ignored (`attachSubmenuHandlers`, menus.js) and its
click toggles. Hover-open plus click-toggle shut every submenu on touch,
and the accordion's own layout shift under the finger fired a
`mouseleave` that shut it 80 ms later. Every menu opens with its
submenus collapsed (`smartPositionDropdown`). Phone menus sit under the
header's measured bottom, 16px from the sides, and long submenu entries
wrap. About / Legal / User Guide are capped to the window (their text
area scrolls) and also close on Escape or a backdrop tap. The Outline
drawer has one close path, `closeMobileOutline` (menus.js), which also
drops its inline position. It closes on a scrim tap, a picked heading,
any view change and a widen. Crossing 820px either way also rebuilds
the Settings menu, whose entries depend on the layout. On a phone the
Preview view always shows the preview, even with Show Preview off. The
desktop "Mobile View" frame applies only in the desktop layout. Find,
Undo and Redo are in the Toolbar menu for keyboardless devices; Undo and
Redo are CodeMirror's own history commands, text only.
`test/phone_e2e.test.js` covers it at 390px.

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
| FS | `fs:read-directory`, `fs:read-file` (20 MB cap), `fs:write-file` (atomic via `fs_core.atomicWriteFile`), `fs:create-file`, `fs:create-directory` (name rule), `fs:rename-node` (`fs_core.renameEntry`), `fs:delete-node` (→ trash, the entry itself), `fs:canonical-entry`, `fs:copy-into-folder`, `fs:set-root-path` (trustedRoots-verified on the real folder; returns the canonical root) |
| Crash backup | `fs:set/get/delete-volatile-content`, `fs:get-volatile-status`, `fs:list-volatile-backups` |
| Watch | `fs:watch-file`, `fs:unwatch-file` |
| Dialogs | `dialog:open-folder`, `dialog:save-file`, `dialog:show-message-box` — file dialogs open where the user last was this session (since Electron 43 one without a folder opens in Downloads, and the OS no longer remembers the last folder) |
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
  reload's boot recovery offers the crash backup;
- the page answers, but its close flow waits on a save that never ends (a
  network drive that stopped answering): the page runs ONE close flow at a
  time (`sidebarHandleClose`, lifecycle.js). After a second a status line
  says it is saving; a further close request is ignored until the save has
  run for 5 s, then reported as a failed close → "could not close
  normally: Keep open / Close anyway". Time spent asking the user (discard?)
  never counts.
The title-bar close button sends the same close REQUEST as Alt+F4
(`NativeAPI.closeWindow()`), so all of the above covers it too. It used to
call the close flow directly — outside the watchdog, and closing the window
without saving whenever that flow threw.
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
| FS | `open_folder_dialog`, `set_root_path` (returns the canonical root), `read_directory`, `read_file` (20 MB guard), `write_file` (atomic), `create_file`, `create_directory` (name rule), `rename_node` (`rename_entry_blocking`), `delete_node` (→ system trash via `trash` crate, the entry itself), `canonical_entry_path`, `copy_into_folder`, `copy_path_into_folder`, `save_file` |
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

A `.meta.json` sibling file records the original path, the timestamp and
the **base**: the fingerprint (`src/sidebar/fingerprint.js`) of the disk
version the backed-up text was edited from — `S._diskBaseline`, taken
together with the text (`save.js noteBackupBase`), never when a debounced
write happens. At startup the boot recovery offers the last opened file's
backup (and any scratchpad backup); the 7-day purge never deletes the last
opened file's backup, since it runs on a timer, not after that offer.

**The recovery question** (lifecycle.js) has three answers: Restore / Save
as a copy / Discard. Only an explicit click on Discard deletes the backup.
Escape (and closing the dialog) saves the backup as a separate file beside
the note (`<name>_recovered.md`, never overwriting); a doubtful backup
makes that the recommended default too: much shorter than the file, or
**made on top of another version than the file now holds** (its base ≠ the
file's fingerprint — another program, a sync service, another device, or
"Keep my version" changed the file after the text was made; Restore would
replace that newer text). Only backups without a base (written by older
versions) still fall back to comparing timestamps, which a sync tool that
keeps the other device's modification time defeats — Enter then used to
restore over the newer file. A blank backup only offers "Keep saved
version".

Backups never come back after the user discarded them or resolved them
elsewhere: "Reload from disk" deletes the backup of the edits it discards
(and a debounced write of it still waiting); `writeVolatileNow` supersedes
a debounced write of the same path (its text is the current one), so a
backup taken while a save was in flight cannot land afterwards with the
older base. A version kept with **"Keep my version" on a note without
unsaved edits** exists only in the editor: closing keeps its snapshot
(offered at the next start, as a copy by default), leaving the note saves
it as `<name>_local.md` first unless the file holds it again
(`save.js keptVersionOnScreen`), and a rename moves its snapshot along
(`retargetActiveFile`). All copies are written by one helper
(`helpers.saveTextBesideNote`: free name, exclusive create, the empty file
of a failed write removed).
When the last note cannot be opened at all (deleted or moved while the
app was closed, no longer UTF-8, too large), its backup is offered as a new
note that then opens — the start used to show the welcome text and forget
the backup. Recovered files get a short name (≤ 150 bytes; a very long
note name falls back to plain `recovered.md`).

### Atomic Writes

`writeFile()` never writes directly to the target path. It always:
1. Writes to a unique sibling `<name>.<unique>.revery_tmp` (both wrappers)
   and fsyncs it
2. Calls `rename()` over the target, then fsyncs the folder (POSIX)

A crash mid-write leaves the original file intact; a leftover
`.revery_tmp` is harmless.

**Locks are retried, never copied over.** Another program that briefly
holds the file (antivirus scanning the new temp file, a sync client, the
indexer) makes the rename fail on Windows with EPERM/EACCES/EBUSY (raw
5/32/33). On Linux and macOS the SMB client reports a file open on another
computer of the share (a NAS, a Windows share) as EBUSY (errno 16); EPERM
and EACCES there are real permission errors and fail at once. The rename is
retried after 0.1/0.2/0.4 s — the same policy as
entry renames (`fs_core.isTransientLock` + `LOCK_RETRY_DELAYS_MS`, Rust
`classify_rename_error` + `retry_rename_on_lock`). A lock that does not let
go fails the save with the old file intact ("another program is using it,
or it is read-only"). Both wrappers used to answer EBUSY / sharing
violation with the cross-device fallback — an in-place copy that a crash
can leave half-written — and failed at once on EPERM. Only a real
cross-device error (EXDEV; Windows ERROR_NOT_SAME_DEVICE) still copies,
with the `.revery_bak` snapshot described below; for a sibling temp file it
cannot occur on ordinary mounts.

Every byte is written before the fsync: `write(2)` may write fewer bytes
than asked on a nearly full disk, and `fs.writeSync` then just returns the
smaller count. Electron's `writeAllSync` (fs_core.js) keeps writing until
all bytes are down, so the real error (ENOSPC/EFBIG) surfaces and the old
file stays — a single `writeSync` used to rename a truncated temp file over
the note and report success. Tauri's `write_all` always looped.

**Temp names are bounded.** The temp file (and the EXDEV snapshot) starts
with the note's name, cut to at most 100 bytes on a character boundary
(`tempSiblingPath` / Rust `temp_sibling`), then `.<unique>.revery_tmp`. The
FULL name used to be kept, so a note using the 255-byte name limit (76 CJK
characters are enough) could be created but never saved.

**Permission bits are kept** (POSIX): the temp file takes over the mode of
the file it replaces before its bytes are written (`existingModeBits` /
Rust `keep_permissions_of`). The rename publishes a NEW file, which used to
get the default mode: a private 0600 note became readable by other users
after one save. Best effort, never fails a save; not done on Windows (the
mode there is only the read-only flag, and copying it would make the next
save fail). Owner, group, extended attributes and Windows ACLs are not
carried over.

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

The web autosave write rides the render debounce, which the CPU-delay
setting can stretch to seconds, and a phone may discard a backgrounded
tab before it fires. So a *pending* write is flushed on
`visibilitychange` → hidden and on `pagehide` (`flushWebAutosave`).
Only a pending one: a tab with no unwritten typing never writes on hide,
so it cannot overwrite another tab's newer autosave, and neither can
its old debounce timer after a flush. `test/web_autosave_e2e.test.js`
pins both directions.

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
| Acting as a browser | `will-navigate` cancels everything except same-URL reloads (the target comes from `details.url`, the page's own URL from the webContents — `event.sender` no longer exists on Electron's details object, and reading it threw an uncaught exception on every reload, e.g. Total Reset); `setWindowOpenHandler` denies all; links are never forwarded to the OS browser (policy: the app never opens links) |
| Unsupported Electron | Electron 44 (supported: the three latest majors). Electron 41 had been without security fixes since 25 Aug 2026 |

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
| `build:electron` | `.dmg` | `.exe` (NSIS assisted wizard, branded) + portable `.exe` | `.deb` |
| `build:tauri` | `.dmg`, `.app` | `.msi` (WiX, branded), `.exe` (NSIS, branded) | `.AppImage`, `.deb`, `.rpm` |

**No Electron AppImage.** Chromium's sandbox needs unprivileged user
namespaces, which Ubuntu 23.10+/24.04+ (and Mint 22, Pop!_OS 24.04 …) only
grant to programs with an AppArmor profile. The Electron `.deb` installs one
(and falls back to the setuid `chrome-sandbox` where namespaces are missing
entirely); an AppImage cannot, so it aborted at start there ("The SUID
sandbox helper binary was found, but is not configured correctly"), with no
window and no message. A launcher that starts the AppImage without the
Chromium sandbox on those systems was considered and not taken: weaker
isolation for a renderer that displays untrusted documents, and a custom
build step to maintain. On Ubuntu and its derivatives the Electron `.deb`
keeps the full sandbox; other distributions use the Tauri build
(`.AppImage`, `.rpm` — on a system with that restriction it starts WebKit
without its own sandbox, see `fn main` in `main.rs`).

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

## Text Typography (fonts, sizes, spacing)

Settings → **Editor font…** / **Preview font…** open one popup per pane
(`openFontSettings`, `markdown_editor_menus.js`) with the pane's font,
size, line height and letter spacing, and Reset. Live preview renders
with the PREVIEW settings (font, size, spacing and line height on
`.cm-content`), so there the Editor row opens the Preview popup (with a
note), just as the editor bar's −/+ buttons change the preview size.

**One registry, one setter.** `Typography` (window.ReveryTypography)
holds the defaults, the size steps (`SIZES`, shared with the −/+
buttons), the built-in fonts and their CSS stacks, the slider ranges and
the checks every stored value passes on load (a bad value keeps the
default; spacing snaps onto the slider grid). Every change goes through
`setPaneTypography(pane, patch, {save})`: check, apply only the part that
changed (a slider step must not re-read the custom-font store, which can
hold MBs), persist. `window.setEditorTextSize/setPreviewTextSize` and
the −/+ buttons are thin wrappers. `applyTypography()` re-applies
everything (custom font added/removed, UI size).

**CodeMirror re-measures after every change** (`typographyChanged` →
`remeasureEditorText`). CodeMirror only re-measures by itself when its
scroller resizes, so after a CSS-only size or font change its line-height
map was stale: the first click in the classic editor landed 4–6 lines
from the pointer (and the caret, so the typing, went there), and live
preview's map was ~400 px off. The re-measure runs as a microtask (after
the change, before any event can reach the editor, once per burst);
`coordsAtPos` flushes it synchronously, and CodeMirror's own measure loop
repeats until the layout stops moving.

**CSS variables** (set on `<html>` only when not at the default, so the
default look is the designed one):

| Variable | Read by | Default |
|---|---|---|
| `--editor-font` / `--preview-font` | `#editor`; prose + live preview `.cm-content` | Harald (`--font-brand`) |
| `--editor-line-scale` | `#editor .cm-content`: `calc(var(--editor-line) * scale)` | 1 (`--editor-line` 1.4, phones 1.24) |
| `--preview-line-scale` | prose `p`/`li` and live preview `.cm-content` (× `--text-line-row-space`) | 1 |
| `--editor-letter-offset` | `#editor`: `calc(0.01em + offset)` | 0em |
| `--preview-letter-spacing` | prose text + live preview `.cm-content` | unset (Harald: body tracking) / `normal` (other fonts); with an offset: `calc(base + offset)` |

Line height and letter spacing are INHERITED properties: they are only
ever set on the text surfaces, never on `html`/`body`. `--text-line-row-space`
itself is left alone because main_rn.css also gives it to `body` (every
menu would follow). The PDF export's in-app print path lays its document
out inside the live page (`printInApp`), so a leak would print. The phone
classic editor has its own `--editor-line` (it used to borrow the
preview's variable). Live preview's raw lines scale by the same factors as
the rendered blocks, so an edited block keeps its rendered height at
every slider position (checked at both ends). **Word spacing was left
out on purpose**: CodeMirror lines are `white-space: break-spaces` (the
space at each wrap point takes width, word spacing included) while
rendered paragraphs are `normal`, so a revealed paragraph grew a row; and
CSS `word-spacing` only affects U+0020/U+00A0.

**The popup** is not modal: its overlay has `pointer-events: none`, so
the text stays scrollable and the −/+ buttons keep working while it is
open (the popup shows their change, `fontPopupRefresh`). A click
elsewhere closes it (a click, not a press, so scrolling a phone screen
never does), except on the −/+ buttons, the phone view toggle and inside
another dialog (the custom-font importer opens on top). Escape closes an
open list first, then the popup. Controls apply AND save at once; a
slider applies while dragged and saves on release, and stops applying
mid-drag when one step takes over 100 ms (a long document). A double
click on a slider resets it to its default; on touch, two taps under
250 ms each and within 350 ms count too (iOS fires no `dblclick`; a drag
is never a tap). The number beside a slider is a text field: Enter or
leaving it applies the typed value (comma decimals, clamped, snapped;
for line height `130`/`130%` is a percentage and a bare 0.8–2 the
factor), Escape undoes the typing. On phones the panel lifts above the
on-screen keyboard (`visualViewport`: browsers shrink only the visual
viewport, so a bottom panel would sit behind it). Desktop:
docked in a top corner over the half of the window that is not the text
being changed; a short window scrolls the panel. Phones (≤820px): a
bottom panel, at most 55vh. Both lists open INLINE (in the panel's flow),
because the panel scrolls and would clip a floating list.

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
alpha to), `--doc-text` (the document's text — editor, preview, live
preview — `var(--text)` in every built-in; menus and dialogs use `--text`),
`--selection` (editor + live preview selection tint) and
`--flash-rgb` (the preview→editor click flash, yellow in every built-in) —
and is added to `DARK_PALETTES` in theme.js if dark.

Dark-palette prose rules must stay scoped under `.prose` (or
`:is(#preview, .lp-render)`): the in-app PDF print (export.js
`printInApp`, Tauri/web) renders the preview's innerHTML — without the
`.prose` wrapper — inside the live, themed page, and an unscoped
`.dark .footnotes` rule once printed gray footnotes on white paper.

**Custom theme** (Settings → Theme → Custom theme…). The dialog in menus.js
(`openCustomThemeDialog`) has six controls, each changing only what it
names: base light/dark; Text color and Text saturation; Vivid text;
Background color and Background saturation (stored as `textHue`, `textSat`,
`vividText`, `bgHue`, `bgSat`; `test/custom_theme.test.js` pins that
independence). theme.js's
`buildCustomPalette()` turns them into every palette variable except
`--bg_oacity`. Muted text, the highlight (`--accent`), the selection tint and
the click flash all derive from the text color, so one pick colors the whole
UI and document; in a custom theme the editor shows only that color
(`[data-custom-theme]` flattens the syntax colors, like `.dark`) and the
prose rules that force black/white are routed to `--doc-text`. Colors are
built in OKLCH with lightness fixed per UI text role and base, so the
controls move only hue and chroma; Text saturation scales the chroma sRGB can
actually show at that hue and lightness, so no part of the slider is flat.
That fixed lightness is also why some hues can't be strong (dark red tops out
at pale pink #ffc8c0): with **Vivid text** on, `--doc-text` walks from the UI
text's gray toward the hue's most saturated shade that keeps 4.5:1 (WCAG AA)
against the document surfaces (bg and the editor gradient) for EVERY
background position, so the background sliders still never move it. Menus
and dialogs keep the 7:1 `--text`, so the UI stays readable enough to find
the way out. The text sliders' tracks are painted with the generator's own
`docTextColor()`, so the color shown is the color applied. A custom dark
base starts the editor gradient lighter than `--bg` (~1.15:1 to its end;
built-in Dark's 1.06:1 near black reads as flat), so the solid editor
background uses `--bg`, not `--editor-bg-start`. In live preview the editor
pane shows the preview's texture overlay instead, so "Editor gradient bg"
has no effect there (any theme). The palette is set as inline
custom properties on `<html>` over its base block (`data-theme` = the base,
plus a `data-custom-theme` attribute), so the base block still supplies
`--bg_oacity` and the Background opacity override keeps working.

- Storage (`revery_md_settings`): `themeMode` holds the custom theme's BASE,
  plus `customTheme {base, textHue, textSat, bgHue, bgSat, vividText}` and
  `customThemeActive`. `normalizeCustom` also reads the earlier
  `{hue, vivid, split, tint}` layout (background hue stored as an offset; its
  numeric `vivid` was the text saturation, not Vivid text).
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
npm test                 # `pretest` first installs the Electron binary: since
                         # Electron 42, `npm install` no longer downloads it

# Rust side
npm run test:rust        # = cargo test --manifest-path tauri/Cargo.toml
```

| Suite | What it proves |
|---|---|
| `test/fs_core.atomic.test.js` | Atomic write semantics: overwrite, temp cleanup, EXDEV copy fallback, snapshot restore on mid-copy failure, snapshot survival when even the restore fails; a Windows lock is retried (0.1/0.2/0.4 s) and one that does not let go fails with the old file intact; EBUSY is retried the same way on Linux/macOS (SMB) and never answered with a copy, while EPERM there fails at once; short writes are completed, a short write followed by ENOSPC fails with the target untouched, a zero-progress write cannot loop, and a REAL kernel short write (`ulimit -f`, Linux) is reported instead of truncating; a note name near the 255-byte limit saves (bounded temp names, whole characters), and the permission bits of the replaced file are kept |
| `test/fs_core.paths.test.js` | Path traversal / symlink-escape rejection, dropped-filename sanitisation |
| `test/fs_core.settings.test.js` | Settings corruption recovery: `.bak` fallback, quarantine of corrupt bytes, merge semantics |
| `test/fs_core.volatile.test.js` | Crash-backup lifecycle: dir safety checks, set/get/delete, prefix listing, age purge that never deletes on unreadable metadata nor the kept (last-opened) backup; the base travels with its own text (per directory, newest snapshot wins), unusable bases are not recorded, backups from before the field read with base null |
| `test/fingerprint.test.js` | The backup base fingerprint: equal text → equal fingerprint (versioned format), every kind of change a note sees (newline, CRLF, BOM, case, swapped lines, one character, emoji) → another one, no collisions over 20 000 similar notes, only `v1` values accepted, a ~10 M-character note in well under 2 s |
| `test/card_memory.test.js` | The card view's per-project folder memory: malformed storage dropped, only a folder inside its project offered, Windows spellings case-insensitive, one entry per project, newest first, bounded |
| `test/backup_safety_e2e.test.js` | Boots the REAL desktop app across several SESSIONS of one profile (restart = reload, crash = killed renderer; `helpers/restart_e2e_main.js` + `restart_e2e_driver.js`, which can change files as a sync tool would, keeping an old modification time): "Keep my version" then close/crash → Enter keeps both versions (the newer file is never restored over); "Reload from disk" then a crash → the discarded edits never come back; typing during a slow save then a crash → plain Restore, no false "changed" warning; "Keep my version" then opening another note → `<name>_local.md` (none when the file holds it again); a rename moves the kept version's backup; "Save my version & reload" |
| `test/card_restore_e2e.test.js` | Same multi-session harness: a restart reopens the card view's folder and New File goes there; a folder removed meanwhile falls back to the nearest existing one (New File follows); nothing remembered → the last note's folder; each project keeps its own folder across project switches |
| `test/fs_core.read.test.js` | Strict UTF-8 reads: valid UTF-8 / BOM / CRLF round-trip byte for byte; Windows-1252 and UTF-16 are refused and left untouched |
| `test/fs_core.rename.test.js` | The only rename-over-existing exception (case-only alias of the SAME file); two different files differing only in case are never treated as one |
| `test/fs_core.entry.test.js` | Entry operations (`validateEntryInside`, `renameEntry`, `trashableEntry`): a link is the link, never its target (also one pointing outside); nothing behind an outside link is reachable; a symlinked root resolves to the real spelling; never overwrites (a dangling link included); absolute links move as links, relative ones are refused across folders; into-itself / root / bad names refused, a pure move keeps a legacy name; EXDEV refused with nothing changed; EBUSY is never a copy (retried on every platform, then it fails); the Windows retry, and a destination appearing during it is never overwritten; `checkEntryName` agrees with the renderer's |
| `test/entry_names.test.js` | The one name rule (`checkEntryName` reasons, Windows device names, byte length), `sanitizeEntryName`, the rename extension rule (`renamedFileName`: "Meeting 26.09.2026" keeps ".md", note ↔ note and image ↔ image only, extensionless names kept), `samePath` / `pathKey`, `joinPath` / `parentPathOf` / `remapUnder` in the listing's own spelling |
| `test/file_history_e2e.test.js` | Boots the REAL Electron app twice on a temp project. History run: links the user DECLINED on a move are never touched by Ctrl+Z / Ctrl+Y (undo used to break the moved note's relative links); accepted links follow undo and redo unasked; Ctrl+Y / Ctrl+Shift+Z in the title or editor never move files, in the panel they redo; a new operation ends the redo chain; a delete ends the history; autosave never renames to a title still being typed; "File Changed Externally" defaults to "Save my version & reload" with unsaved edits, "Reload from disk" without. No-project run (last project folder missing): "Could Not Open Project" at start, typed text gets a crash backup, New File / Import leave it alone, Open Folder keeps it and gives it a note there |
| `test/file_ops_e2e.test.js` | Boots the REAL Electron app twice on a temp project (a recorder replaces the system trash): card-view path bar and its root-segment drop, the narrow-panel "← Back" drop target, nothing above the root; "Move to…" (picker rules, the link update still runs) and "Move up one level"; Ctrl+Z in the title never undoes a file move, after working in the panel it does (with a status message); links moved as links, a relative link not moved away, deleting a link trashes the link; rename rules and refusals; the open note's folder moved while a save is queued (save lands first, later typing saved at the new place, old folder never recreated); the open note deleted with a save in flight (the save lands first, never resurrected); multi-delete wording. Second run with the project opened through a symlink: canonical root and note, no name_2 on a drop into the own folder, no escape above the root |
| `test/eol.test.js` | Line-ending rules: which files keep CRLF, normalisation, byte-exact round-trip |
| `test/unique_name.test.js` | New/renamed/imported/moved names: case-insensitive collisions, trailing `_2024` kept, the renamed file does not block its own spelling |
| `test/data_safety_e2e.test.js` | Boots the REAL desktop app on a temp project: Replace after edits / file switch / regex context; scratchpad race (the switch waits for the note); sidebar Ctrl+Z; rename during a "Keep my version" hold; open-note links follow a rename; CRLF kept; external write right after an autosave detected; a note moved away by another program not recreated |
| `test/save_race_e2e.test.js` | Boots the REAL desktop app: renaming the open note in the title and clicking another note while the rename runs (the renamed note keeps its text, the opened note gets the typing); another program's write just before an autosave, and just before Ctrl+S (never overwritten unasked: one "File Changed Externally" question, both versions survive); a note moved away just before an autosave (not recreated in the background, Ctrl+S still can); closing right after an external write (the window stays open at that question) |
| `test/recovery_e2e.test.js` | Boots the REAL desktop app six times with a crash backup waiting: Escape saves it as `note_recovered.md` (it used to delete it), Restore and an explicit Discard do exactly that, Enter on a backup older than the file keeps both, a last note that is gone gets its backup offered, saved as a new note and opened (or discarded on request) |
| `test/import_text.test.js` | The import decoder: UTF-8 exact (BOM kept), UTF-16 LE/BE with a BOM converted, Windows-1252 bytes / unpaired surrogates / odd UTF-16 lengths / a UTF-32 BOM refused |
| `test/user_ops_e2e.test.js` | Boots the REAL desktop app (the system Trash replaced by a private folder): deleting the open note with unsaved edits puts them in the Trash copy; deleting, or a Total Reset, while auto-save is paused does nothing (and says so); import refuses Windows-1252, converts UTF-16, reports a failed write with nothing left behind; "Export & Continue" with the dialog cancelled stays on step one; a Total Reset with unsaved edits saves them, then reloads (this also pins the navigation guard, which crashed on reloads) |
| `test/close_watchdog_e2e.test.js` | The app can always be closed, never silently: normal close, a failing close flow, a renderer reported gone (reload offered), a hung page (force close offered after 5 s), a close stuck on a save through the title-bar button (a second close is ignored, a status line shows, one after 5 s of saving asks "Close anyway") |
| `test/crash_consistency.test.js` | A child process is SIGKILLed mid-write 12 times; the target file must always contain exactly one complete payload |
| `test/zip_core.test.js` | Zip export: archive validity (CRC + `unzip -t`), UTF-8 names, symlinks never enter the archive, destination self-exclusion, size caps, deterministic output; `buildZipFromEntries` (LaTeX-project assembler) auto parent-dirs + unsafe-name rejection |
| `test/link_rewrite.test.js` | The pure link rewriter behind rename/move link-updating: encoding round-trips (%20/%25/parens/unicode), `../` traversal, folder-prefix moves, self-moved files, fenced/inline code opacity, scheme/anchor immunity, undo (inverse-mapping) round-trip |
| `test/find_e2e.test.js` | Boots the REAL app in Electron and asserts ~19 feature suites: regex worker + ReDoS, slow-hardware mode, backgrounds pipeline, live-preview parity, YAML autocomplete, export builders (PDF/LaTeX incl. Revery templates + engine gating), custom templates, custom fonts, link-path completion gating, Advanced Options, divider/menu interaction, the PDF print page graft |
| `test/latex_compile.test.js` | Builds every document in `helpers/latex_cases.js` through the real exporter (web-mode Electron) and compiles each with pdflatex: headings after tables, false `$` spans, footnotes in headings, `[bracket]` items, deep nesting, entities, Unicode/emoji. Skipped without a display or pdflatex |
| `test/link_complete.test.js` | The link-path completion feed: desktop-only, root containment (`..` may climb, never leave; absolute/URL quiet), folders+images+notes only, decoded prefix filter with raw `rawSegLength`, `kind` per row, Windows spellings, size cap |
| `test/block_insert.test.js` | The pure paragraph inserter behind live-preview drops: blank line on each side only where missing, never glued onto text (also from a stale mid-line point), document start/end, multi-link blocks, cursor on the blank line after |
| `test/paths.test.js` | The single path-rule module behind preview, export, link rewriting, autocomplete and media ingest: normalisation, resolve/relative (incl. Windows case-insensitivity), encode/decode round-trips, root containment (sibling-prefix attack, verbatim prefix) |
| `test/tauri_config.test.js` | Pins the per-platform file-drop transport to the Tauri config: the Windows override mirrors the main window except `dragDropEnabled:false`, `drop_transport.js` agrees with it, and every npm `tauri build`/`dev` script produces that window once its `--config` arguments are merged the way tauri-codegen does; plus the sidebar drag payload's encode/decode |
| `test/deferred_edits_e2e.test.js` | Boots the REAL desktop app and pins edits that land after an await: an image dropped on a note, then another note opened before its copy finished — the link never goes into the other note and the user is told; an image pasted over a selection, then typing elsewhere or over it — exactly the selection is replaced, typed text is kept; an edit landing while the next note is read is saved into its own note before the switch; an edit arriving while the folder picker is open is saved into the OLD project; a note that cannot be read leaves the open note in place; text typed with no note open whose note cannot be created is not replaced by opening another note (told, reboot-safe backup written, note created first once possible); text typed during a project switch gets its note in the project opened and saves there; a recent project whose folder is gone leaves the project and the open note in place, with a message; New File while the open note cannot be saved creates nothing. Paths use the root's own separator (runs on Windows) |
| `test/media_e2e.test.js` | Boots the REAL Electron main (preload, IPC, atomic writes) on a temporary project and drives real DragEvent/ClipboardEvent drops: one encoded link per image, preview resolves it, non-media never copied, sidebar payload inserts once, a Ctrl+click multi-selection dragged from the real tree inserts one link per image on consecutive lines in tree order, image click previews from its own folder, media dropped while previewing lands beside the note it creates with every link resolving, paste, autosave, no native dialog; in live preview a sidebar image dropped on a rendered list item / code line / paragraph lands as its own paragraph after that item / after the whole fence / after the paragraph; in card view a media card owns the drag (its thumbnail `<img>` is non-draggable), so grabbing the picture carries the card payload |
| `test/livepreview_e2e.test.js` | Boots the REAL app in Electron (web mode, via the generic `test/helpers/web_e2e_main.js` + `lp_e2e_driver.js`) and drives the live preview with DOM mouse events: a click on rendered text lands on THAT word of the source (paragraph, list item, code line, table cell, lower row of a wrapped paragraph) the layout never changes while the button is down (a click's block reveals on release, and a few px of pointer jitter during a click selects nothing), CodeMirror's height map matches the screen below lists/quotes/code/tables, a click on the blank line at a block's edge reveals nothing and never scrolls, a click beside a block lands on the row at that height, a click that changes a block's height moves the side with less visible text (low on the screen it changes downward, high on the screen upward, a block taller than the screen keeps the clicked row under the pointer; also when the previously edited block re-renders above — on screen or scrolled out of view), typing and arrow keys keep the caret's line in place when blocks switch (a lazy-continuation merge, leaving a revealed block, ArrowUp into a tall paragraph without a jump), the block being edited keeps its rendered height (headings, a tight and a nested list, a quote, a wrapped paragraph — at two text sizes), images and `$$` math stay rendered under their source while edited, undrawn blocks keep their measured heights, a drag started on a rendered block selects text, a drag into a rendered block extends character by character with the covered rendered text painted (CSS Custom Highlight) while the block stays rendered, a block the range spans is marked as a unit, heads stay stable over widgets, double-click selects the word, shift-click extends, right-click places the cursor without dragging, select-all keeps spanned blocks rendered, Shift+Arrow into a rendered block paints exactly the selected characters and typing replaces them in the source, arrow keys still reveal, checkboxes and YAML pills keep their behaviour |
| `test/custom_theme.test.js` | The custom theme generator (theme.js in a vm): it sets exactly the variables every palette block defines; stored values are normalized or rejected (the earlier offset layout is converted); saturation 0 is neutral gray; each control changes only what it names (text sliders never touch a background variable and vice versa; Vivid text changes only `--doc-text`); no part of the Text saturation slider is flat; Vivid text makes dark red red; for every control combination (exact, via the extreme text and surface luminances, since any text color can meet any surface): text ≥ 7:1, muted text ≥ 4.5:1 (4:1 on hover), highlight ≥ 4.5:1 (3:1 on hover), vivid document text ≥ 4.5:1 on bg and both gradient ends, editor gradient visible but gentle (≥ 1.12:1 on dark bases); selection tint visible on a dense grid; the text-slider tracks paint with the generator; boot and live switching never leave an empty palette |
| `test/theme_e2e.test.js` | Boots the REAL app (web mode) once with the OS in light mode and once in dark: every built-in palette and six custom ones are measured on screen (html.dark matches the actual background, body/footnote/editor-code contrast, visible selection, background-image overlay tinted with the palette's own `--bg`, click flashes yellow in built-ins and the highlight color in custom themes, one text color everywhere in a custom theme — the document on `--doc-text`, menus on `--text`, separate only with Vivid text — and the solid editor background equals `--bg`), identical under both OS settings; in-app PDF print stays dark-on-white under every palette, Vivid text included; plus the custom theme dialog through the real menu: the text sliders apply the generator's color without moving the background and the background sliders leave the text alone, Vivid text changes only the document text, live preview, Escape/outside click/Cancel restore, Save stores the base + custom values, Reset, the Background opacity override stays independent |
| `test/typography_e2e.test.js` | Boots the REAL app (web mode) at a desktop, a phone and a short landscape size: after −/+ or a font change the first click in the classic editor lands on the line under the pointer and live preview's height map matches the screen; Settings has the two font rows; the popup's lists and sliders apply and save (a slider saves on release), the −/+ buttons update an open popup, spacing never reaches menus or a page-level element (the PDF print root), Reset, Escape, click-outside, custom fonts added/deleted from inside it, live preview opens the Preview popup; damaged stored values keep their defaults; the phone bottom panel and the short window keep Close reachable |
| `tauri/src/main.rs` `mod tests` | Rust twins: `safe_path`, `safe_path_inside`, `safe_entry_inside` (links as links, symlinked root), `rename_entry_blocking` (no overwrite, dangling link kept, relative link refused, into-itself/bad names), `case_only_alias_in_listing`, `classify_rename_error` (pins errno 17 = EEXIST on Unix), `check_entry_name` (same table as the renderer), `strip_verbatim_prefix`/`frontend_path`, `atomic_write_file`, `retry_rename_on_lock` (a brief Windows lock is retried, a lasting one ends as a failure; off Windows only EBUSY is retried), zip export roundtrip/symlink-skip/self-exclusion, crash backups (`write_backup_to`/`read_backup_from`: key stability, the recorded base, older metas without one) |

`electron/fs_core.js` is the single source of truth for the Electron-side
atomic-write strategy — both `fs:write-file` and `dialog:save-file` call
`atomicWriteFile()`. Do not re-inline that logic into handlers; it is what
the tests pin down.

Every desktop E2E harness (`test/helpers/*_e2e_main.js`) points
`os.tmpdir()` at a private folder before loading `electron/main.js`: the
real main purges crash backups older than 7 days 5 s after start, and a
test run must never touch the developer's real `revery-volatile` folder.
They also turn a main-process exception into an immediate `E2E-FAIL` with
its stack: Electron's default handler shows a modal error box, which
blocks the run (and appears on the developer's desktop).

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
`window.sidebarYamlIndex` from `src/sidebar/yaml_index.js`, which reads
each note's frontmatter through `window.ReveryYaml` (the same reader as the
Properties sheet and the exports — see below) and caches the result **per file by mtime** —
rebuilds only re-read changed files. File enumeration comes from
`src/sidebar/project_scan.js` (`listProjectTextFiles`): a **shared,
TTL-cached primitive intended for reuse** — a future project-wide search
should consume it rather than growing its own walker. Caps: 800 files,
1 MB/file, 200 keys, 300 values per key. Web mode indexes the current
document only. Read-only by construction.

**One reading of YAML** (`markdown_editor_yaml.js`, `window.ReveryYaml`,
tests in `test/yaml_reader.test.js`): the Properties sheet (preview,
reader mode, live preview), the LaTeX/PDF/HTML export metadata and the
autocomplete index all read frontmatter here, so they agree on what a
note says. Writing styles converge: quoted or not, `[a, b]`, a block list,
or — under a LIST KEY (tags, categories, keywords, aliases, authors…) — a
plain `a, b` are the same value; any other key keeps a comma value whole.
Lines a YAML parser would read differently (`title: Note: part 2`,
`Issue #5`, `key:value`, duplicates, tabs…) are flagged on the sheet with
a ⚠ tooltip — display only. The autocomplete re-reads the token under
the cursor when a suggestion is ACCEPTED (the menu stays open while the
user types; filtering continues after a click-open) and quotes a value
plain YAML cannot hold (`quoteValue`).

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
  on custom rows; built-ins are untouchable. Inserting never breaks the
  note's frontmatter (`insertTemplate`, menus.js): a YAML template merges
  only the missing keys into an existing block, a markdown template goes
  below the frontmatter, and a custom YAML template must have `---` fences.
- **Custom fonts** (`markdown_editor_menus.js`): the Font list of the
  font popup (Settings → Editor font… / Preview font…) ends with
  "Custom font…". Two kinds — imported font FILES (data-URL
  `@font-face` in one regenerated `<style id="custom-fonts-css">`, family
  `RvCustom-<id>`) and INSTALLED fonts by name (CSS resolves any installed
  family; the picker list comes from `NativeAPI.listSystemFonts()` —
  Local Font Access API on Electron/web, Rust fontdb on Tauri — rendered
  as an app-styled menu, never a native datalist). Stored
  under `revery_custom_fonts`; all application flows through
  `applyFontTypes()` (`fontStack`), so live-preview parity, outline, KaTeX
  sizing and the Harald bold-underline rule handle customs automatically.
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

4. **Windows atomic rename** — ✅ RESOLVED (revised 2026-09-27): a rename
   blocked by another program is retried and then FAILS with the old file
   intact (see Atomic Writes). The earlier "resolution" answered EBUSY /
   sharing violation with an in-place copy — the lock Windows reports when
   antivirus scans the fresh temp file — which a crash could leave
   half-written. Only real cross-device errors still copy (with the
   `.revery_bak` snapshot). A program that holds a note open for long
   without FILE_SHARE_DELETE therefore blocks saving it until it lets go
   (the save failure is shown; autosave pauses 30 s). The same retry
   covers EBUSY on Linux/macOS (a note on an SMB share open elsewhere),
   which failed at once there.

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
   proves both spellings are the same entry (Electron: same device + file
   ID via lstat; Tauri: the folder listing holds one entry, not two);
   not exercisable on the Linux test machine (case-sensitive), where the
   guard's refusal and the pure listing decision are tested instead.

11. **Check-then-rename window.** Both backends check that a destination
   is free and then rename; `rename` itself replaces an existing FILE on
   every OS, so another program creating that exact name in the
   microseconds between would be overwritten. Closing it needs a
   no-replace rename (renameat2/renamex_np/MoveFileEx without
   REPLACE_EXISTING), which Node does not expose and which could not be
   built and tested for Windows/macOS here. Folders are not at risk
   (renaming onto a non-empty folder fails).

12. **Relative links INSIDE a moved folder** that point outside it break,
   as in every file manager (a relative link moved on its own is refused).
   No data is touched; undo moves the folder back.

13. **Moves to another drive/volume are refused** (no copy fallback).
   Inside one project this needs a mount point in the project tree.

14. **Windows behaviour still to confirm on a real Windows machine**: that
   moving the folder of the open note now succeeds in both wrappers (the
   watcher is stopped first; transient locks are retried), and the
   "Delete" of a junction removes only the junction.
