# Revery Notebook

A Markdown notebook for students, researchers, and anyone who just wants to write.
Live preview, KaTeX math, syntax-highlighted code, project folders, and careful,
crash-safe saving. Runs three ways from one codebase:

- **Desktop app** (Electron or Tauri) — full project folders, real files on your disk.
- **Web version** — a single-document live demo that runs entirely in your browser.
  No backend, no database, no account, no telemetry.

> **Just want to use it?** Jump to [Getting Started (no coding needed)](#getting-started-no-coding-needed).
> Once the app is open, click the logo in the top bar → **User Guide** for how everything works.
> For how the code works internally, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Table of Contents

- [What It Does](#what-it-does)
- [Feature Overview](#feature-overview)
- [Getting Started (no coding needed)](#getting-started-no-coding-needed)
- [Getting Started (Developers)](#getting-started-developers)
- [Project Structure](#project-structure)
- [Third-Party Libraries](#third-party-libraries)
- [Adding Templates](#adding-templates)
- [Adding a Language](#adding-a-language)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Settings & Persistence](#settings--persistence)
- [Security Notes](#security-notes)
- [Known Limitations](#known-limitations)
- [Deployment Checklist (web version)](#deployment-checklist-web-version)

---

## What It Does

Write Markdown in the left pane, see the formatted result on the right — live, as
you type. On desktop you open a **project folder**: a file panel lists your notes,
everything is saved to real `.md` files on your disk with crash-safe atomic writes,
and you can export the whole project as a zip, a PDF, or a compile-ready LaTeX
project. The web version is the same editor with a single document autosaved to
the browser (a live demo of the software before you install it).

---

## Feature Overview

### Editing
- **CodeMirror 6** editor: syntax highlighting, undo/redo, find highlights.
- **Live Preview mode** (toggle in Settings): the document renders *inside* the
  editor, Obsidian-style — the block you are editing shows its raw markdown.
- Bold, italic, headings, strikethrough, code blocks, links, images, task
  lists, tables, horizontal rules, and footnotes from the **Toolbar** menu.
- **Path autocomplete** in link destinations (desktop): typing inside
  `![image](…)` suggests your project's folders, images, and notes.
- **YAML frontmatter autocomplete**: keys and values already used across the
  project are suggested while you edit the `---` block.

### Preview
- Rendered by **markdown-it** (footnotes, typographer) and sanitised by
  **DOMPurify**.
- **KaTeX math**: `$inline$` and `$$display$$` (multi-line supported).
- **Highlight.js** code colors with one-click copy buttons.
- YAML frontmatter renders as clickable "property pills".
- Bidirectional **scroll sync**; click any preview block to jump the editor there.
- **Reader Mode**, **Outline pane** (heading navigator), **Mobile view**.

### Projects & files (desktop)
- Project folder sidebar with file tree **and card view**, drag-and-drop move,
  multi-select, project quick-switcher, project-wide search (**Ctrl+Shift+F**).
- **Links follow renames**: renaming or moving files/folders offers to update
  every markdown link that points at them (you see the exact files first;
  Ctrl+Z reverses it, links included).
- Images: drop or paste (screenshots included) straight into a note — the file
  is copied into your project and a link is inserted.
- **Crash safety**: atomic writes (a crash can never leave a half-written
  file), plus a rolling volatile backup of unsaved keystrokes.

### Export
- **Zip Project Export** — the whole project folder as a timestamped
  `.zip` backup (`project_YYYY_MM_DD_HH_MM_SS.zip`), written atomically.
- **PDF export** — options window with front page (optional cover image),
  clickable table of contents, fonts (including your own custom fonts’ menu
  cousins in the app UI), page sizes A4/A5/A6/Letter, margins, page numbers,
  page breaks before H1/H2. Electron saves the PDF directly; Tauri and the
  browser open the system print dialog ("Save as PDF").
- **LaTeX project export** — a compile-ready folder (main.tex + images/) with
  five templates, including two styled "Revery" templates (the book one
  bundles its fonts into the zip).
- Plain `.md`, `.txt`, and `.html` export everywhere.

### Customization
- **Custom templates**: create your own YAML/markdown templates from the
  menus ("New template…"), remove them with a hover ✕.
- **Custom fonts**: import a font file or use any font installed on your
  computer (Settings → font menus → "Custom font…").
- Backgrounds (built-in or imported image) with adjustable opacity, dark/light
  theme, per-pane text sizes, **Slow Hardware Mode** for older machines.
- Interface languages: **English** and **Swedish**.

---

## Getting Started (no coding needed)

### Option 1 — The desktop app (recommended)

If you received an installer (`.exe`, `.msi`, `.AppImage`, `.deb`, `.dmg`):
run it like any other program, open the app, click **the folder button** in the
top-left, and pick (or create) a folder for your notes. That's it — your notes
are ordinary `.md` files in that folder.

### Option 2 — The web version (zero install)

1. Open the project folder you downloaded/unzipped.
2. Go into the **`www`** folder.
3. Double-click **`index.html`**. It opens in your browser and works immediately.
4. Write in the left pane. Your text autosaves to the browser — refreshing the
   page restores it. Press **Ctrl+S** to download your document as a `.md` file.

The web version holds **one document at a time** and lives only in that browser.
For folders of notes and real files, use the desktop app.

### Option 3 — Build the desktop app yourself (step by step)

You only need to do this if you weren't given an installer. It looks technical
but is just typing three commands.

1. **Install Node.js** — go to <https://nodejs.org>, download the **LTS**
   version, and install it (click next until done).
2. **Open a terminal in the project folder**:
   - *Windows*: open the folder in Explorer, click the address bar, type `cmd`, press Enter.
   - *macOS*: right-click the folder → Services → "New Terminal at Folder".
   - *Linux*: right-click inside the folder → "Open Terminal Here".
3. Type these commands, pressing Enter after each (the first one takes a few minutes):

   ```bash
   npm install
   npm run start:electron
   ```

   The app opens. To instead create a real installer for your system:

   ```bash
   npm run build:electron
   ```

   The installer appears in the `dist-electron/` folder.

**If something fails** (common after unzipping the project): delete the
`node_modules` folder and run `npm install` again.

**If the app crashes instantly when started from VS Code's terminal**: run
`ELECTRON_RUN_AS_NODE= npm run start:electron` instead (VS Code leaks a
variable that confuses Electron).

*(The Tauri build is smaller but needs the Rust toolchain too — see
[ARCHITECTURE.md → Build Instructions](ARCHITECTURE.md#build-instructions).)*

---

## Getting Started (Developers)

- The shipped app is `www/` — plain classic `<script>` files, no framework, no
  build step for day-to-day work. Serve it from any static host or open it via
  `file://`.
- Two files in `www/jvscrpt_and_css_extra/` are **generated bundles** — never
  edit them directly:
  - `codemirror-bundle.js` ← built from `build_tools/cm_entry_slim.js`
    (`cd build_tools && npm install && node build_cm.js`, then copy the output over).
  - `project_sidebar.js` ← built from the ES modules in `src/sidebar/` with
    `npm run build:sidebar` (run from the repo root).
- Script loading order in `index.html` matters — the classic scripts
  communicate through globals. See the `<script>` tags in `index.html`
  (theme → native_api → templates → renderer libs → lang → CodeMirror →
  editor core → actions → export → menus → sync → layout → find → sidebar).
- Run everything with `npm test` (Node's built-in `node:test`; the E2E suite
  boots the real app in Electron) and `npm run test:rust` for the Tauri side.
- Desktop internals (NativeAPI, IPC maps, data-safety design, build docs):
  **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## Project Structure

```
revery_notebook/
├── www/                          ← Everything the app ships (web + both wrappers)
│   ├── index.html                ← THE app. The web version opens this directly.
│   ├── pdf_print.html            ← Dedicated PDF print page (Tauri export)
│   ├── main_rn.css / prose_rn.css ← Shipped styles (generated: npm run build:css)
│   ├── fonts/ image_assets/      ← Brand fonts, background images
│   └── jvscrpt_and_css_extra/
│       ├── revery_notebook_style.css     ← App UI styles
│       ├── native_api.js                 ← Electron/Tauri/web abstraction layer
│       ├── markdown_editor_*.js          ← Editor core, menus, actions, export, sync, find…
│       ├── project_sidebar.js            ← GENERATED (source: src/sidebar/)
│       ├── codemirror-bundle.js          ← GENERATED (source: build_tools/)
│       ├── find_worker.js                ← Regex search Web Worker
│       └── markdown-it / katex / highlight.js / purify …  ← self-hosted libraries
│
├── src/sidebar/                  ← Sidebar source modules (tree, save, cards,
│                                    link_rewrite, link_complete, search, …)
├── electron/                     ← Desktop wrapper #1 (main.js, preload, fs_core, zip_core)
├── tauri/                        ← Desktop wrapper #2 (Rust; src/main.rs, capabilities)
├── build_tools/                  ← esbuild scripts for the two generated bundles
├── test/                         ← node:test suites (fs safety, zip, links, E2E)
├── svg_icons_to_use/             ← The ONLY approved icon set (Harald Revery glyphs)
├── images_for_installer/         ← Windows installer branding bitmaps
└── package.json                  ← npm scripts + electron-builder config
```

---

## Third-Party Libraries

All libraries are self-hosted (no CDN calls at runtime) to satisfy the Content
Security Policy. The full license texts are in the app: logo menu → **Legal**.

| Library | Purpose | License |
|---|---|---|
| [CodeMirror 6](https://codemirror.net/) | Editor engine (+ autocomplete) | MIT |
| [markdown-it](https://github.com/markdown-it/markdown-it) | Markdown → HTML renderer | MIT |
| [markdown-it-footnote](https://github.com/markdown-it/markdown-it-footnote) | `[^1]` footnotes | MIT |
| [KaTeX](https://katex.org/) | LaTeX math rendering | MIT |
| [markdown-it-texmath](https://github.com/goessner/markdown-it-texmath) | markdown-it ↔ KaTeX bridge | MIT |
| [Highlight.js](https://highlightjs.org/) | Code block syntax highlighting | BSD-3-Clause |
| [DOMPurify](https://github.com/cure53/DOMPurify) | HTML sanitisation (XSS protection) | Apache-2.0 / MPL-2.0 |

Interface icons are **first-party**: glyphs extracted from the Harald Revery
fonts (`svg_icons_to_use/`). No third-party icon sets.

---

## Adding Templates

**Easiest way (no code):** in the app, open Toolbar → *Insert YAML ▸* → **New
template…** (or File → *Import Template ▸* → New template…), write it, press
Create. Remove custom templates with the hover ✕.

**Built-in defaults** live in
`www/jvscrpt_and_css_extra/markdown_editor_tmplt_list.js` — two arrays
(`yamlTemplates`, `mdTemplates`) of `{ label, content }`. Edit and reload; no
build step.

---

## Adding a Language

Open `www/jvscrpt_and_css_extra/markdown_editor_lang.js`:

1. Every UI string has an entry like `"Save": { "Swedish": "Spara" }`. Add your
   language key (e.g. `"French": "…"`) to each entry — untranslated strings
   fall back to English.
2. The `uiTemplates` object at the bottom holds the long About/Legal/User Guide
   texts per language.
3. Add the language to the *Language ▸* submenu in `markdown_editor_menus.js`
   (search for `"Swedish"`).

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Save the open file (desktop) / download `.md` (web) |
| `Ctrl+B` / `Ctrl+I` | Bold / Italic |
| `Ctrl+F` | Find / Replace (regex supported, ReDoS-guarded) |
| `Ctrl+Shift+F` | Project-wide search (desktop) |
| `Enter` / `Shift+Enter` (in Find) | Next / previous match |
| `Ctrl+Z` | Undo — outside the editor it undoes the last file move/rename |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Tab` (in editor) | Insert 4 spaces |
| `Escape` | Close find bar / dialogs |

---

## Settings & Persistence

Settings and app state persist in the browser profile's `localStorage`
(the desktop apps have their own private profile, plus a small
`revery_settings.json` in the OS app-data folder for the file pointers).

Main keys: `revery_md_settings` (all Settings-menu state), `revery_md_autosave`
(web-mode document), `revery_export_settings`, `revery_custom_templates`,
`revery_custom_fonts`, `revery_custom_bg`, `revery_projects`,
`revery_root_path`, `revery_sidebar_sort`, `revery_sidebar_view`,
`revery_card_size_idx`, `revery_last_file`.

**To reset everything** use the in-app option (logo menu → Quit → Total Reset),
or clear the keys above from the browser console.

---

## Security Notes

- **Strict CSP** in all three shells — no external sources, no eval; fonts and
  images only from the app itself, `data:` URLs, and (Tauri) the asset protocol.
- **DOMPurify** sanitises all rendered markdown; URL schemes like
  `javascript:` are rejected by the link renderer.
- **The app never opens links or acts as a browser** (navigation is blocked in
  both wrappers by policy — important for the borderless UI).
- **Sandboxed renderers**: no Node in the renderer (Electron), allowlisted
  IPC/commands only, every path validated against the trusted project root on
  the backend (both wrappers).
- **ReDoS guard**: project search is substring-only; the in-document regex
  find runs in a Web Worker with a hard timeout.
- **Atomic writes everywhere** a file is written (documents, settings, zips,
  PDFs): temp file + rename, so a crash cannot corrupt existing data.

Details: [ARCHITECTURE.md → Security Model](ARCHITECTURE.md#security-model).

---

## Known Limitations

- **Web version**: one document at a time, ~5 MB localStorage budget, no
  project folders — it is the demo, the desktop app is the product.
- **Tauri PDF export**: page margins/paper size are governed by the system
  print dialog (a WebKitGTK limitation). Electron produces the pixel-exact PDF.
- **Relative images (web)** only resolve against the page URL; the desktop
  app resolves them against your project files.
- Generated bundles (`codemirror-bundle.js`, `project_sidebar.js`) must be
  rebuilt when their sources change — never edited directly.

---

## Deployment Checklist (web version)

- [ ] Copy the **entire `www/` folder** to the server (`index.html` must stay
      next to `jvscrpt_and_css_extra/`, `fonts/`, `image_assets/`).
- [ ] Serve `.js`/`.css` with correct MIME types; HTTPS recommended
      (Clipboard API needs a secure context; a fallback exists for `http://`).
- [ ] The CSP allows `img-src 'self' data:` — add domains if your users embed
      external images.
- [ ] Do not rename `jvscrpt_and_css_extra/` (script paths in `index.html`).

---

## License

- **Code** — [Apache License 2.0](LICENSE) © 2026 Harald Mark Thirslund.
  Use it, modify it, ship it; keep the [NOTICE](NOTICE) file.
- **Brand assets** — the Harald Revery fonts, background images, the
  Revery logo, the icon set (including glyph outlines embedded in source
  files), and the installer artwork are **proprietary, all rights
  reserved**. You may keep them, unmodified and in place, solely to build
  and run this software (forks included) — but you may not extract them,
  modify them, or use them in anything else. Full terms:
  [LICENSE-ASSETS](LICENSE-ASSETS). Permission requests:
  contact@haraldrevery.com.
- **Third-party libraries** ship under their own licenses — see the Legal
  page inside the app.

---

*Built by [Harald Mark Thirslund](https://haraldrevery.com) · Gothenburg, SE*
