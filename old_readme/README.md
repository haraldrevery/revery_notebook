# Revery Notebook — Developer README

A self-contained, browser-based Markdown editor. No build step, no npm, no framework. It is a single HTML page plus a folder of plain JavaScript and CSS files. Everything runs locally in the browser.

---

## What it does

Revery Notebook is a split-pane Markdown editor with a live rendered preview. The user types in the left pane and sees formatted output on the right in real time. It also supports:

- **LaTeX math** via KaTeX (`$...$` inline, `$$...$$` block)
- **Syntax-highlighted code blocks** via highlight.js
- **Footnotes** via markdown-it-footnote
- **YAML frontmatter** — parsed and rendered as a visual "properties" card
- **Document outline** — a heading-list side panel for navigation
- **Find & Replace** — full-text search with regex and case-sensitivity options
- **Custom undo/redo** — the browser's native undo is overridden with a hand-rolled stack
- **Autosave** — the document is continuously written to `localStorage`
- **Export** — saves the document as a `.md` or `.txt` file via the browser's download API
- **Templates** — insertable YAML and Markdown snippets
- **Bidirectional sync** — clicking a preview block jumps the editor cursor to the matching source line, and the preview scroll tracks the editor
- **Reader mode** — hides the editor for distraction-free reading
- **Dark / light theme** — follows the OS preference automatically, with no flash on load
- **i18n stub** — a `window.t()` translation helper is wired throughout the UI

---

## File structure

```
revery_notebook.html                 ← The entire app shell: HTML, all CSS, and <script> tags
jvscrpt_and_css_extra/
  markdown_editor_tmplt_list.js      ← Loaded FIRST. Defines yamlTemplates and mdTemplates arrays.
  markdown-it.min.js                 ← Markdown parser (third-party, do not edit)
  markdown-it-footnote.min.js        ← Footnote plugin (third-party, do not edit)
  katex.min.js / katex.min.css       ← Math renderer (third-party, do not edit)
  texmath.min.js / texmath.min.css   ← markdown-it ↔ KaTeX bridge (third-party)
  highlight.min.js                   ← Syntax highlighter (third-party, do not edit)
  github-dark.min.css                ← highlight.js colour theme
  markdown_editor_lang.js            ← UI language / translation strings
  markdown_editor_core.js            ← Markdown-it config, render(), word count, autosave, settings restore
  markdown_editor_undo.js            ← Custom UndoManager class + keyboard shortcuts
  markdown_editor_actions.js         ← Toolbar action definitions and all text-insertion helpers
  markdown_editor_menus.js           ← Dropdown menus, Settings panel, outline renderer, toggles
  markdown_editor_sync.js            ← Preview ↔ editor scroll sync (two algorithms)
  markdown_editor_layout.js          ← Drag-to-resize dividers, mobile view toggle
  markdown_editor_find.js            ← Find / Replace bar
image_assets/
  bg_1_web.jpg                       ← Light-theme preview background
  bg_4_web.jpg                       ← Dark-theme preview background
```

> **Load order matters.** The `<script>` tags at the bottom of the HTML must stay in the order listed above. Several files read global variables that earlier files define (e.g. `editor`, `preview`, `render`, `undoManager`). Changing the order will break things.

---

## How the scripts depend on each other

Understanding this dependency chain will save you a lot of confusion.

**`markdown_editor_tmplt_list.js`** runs first and only defines two plain arrays — `yamlTemplates` and `mdTemplates`. No DOM access. Safe to edit freely.

**`markdown_editor_core.js`** is the backbone. It:
- Creates the `md` (markdown-it) instance and wires up all plugins
- Defines global DOM references (`editor`, `preview`, `workspace`, etc.) that every other file uses
- Defines `render()`, `countWords()`, `escapeHtml()`
- Handles autosave to `localStorage` (key: `AUTOSAVE_KEY`)
- Restores the document on page load

**`markdown_editor_undo.js`** depends on `editor` and `render()` from core. It attaches `window.undoManager` and two global helpers — `window.insertWithUndo()` and `window.performTextChange()` — that actions.js calls constantly.

**`markdown_editor_actions.js`** depends on `editor`, `render()`, `countWords()`, `insertWithUndo()`, and the template arrays from `tmplt_list.js`. It implements every toolbar action (bold, italic, table insertion, date insertion, etc.) and wires up the toolbar and right-click context menu.

**`markdown_editor_menus.js`** depends on almost everything. It manages all dropdown menus, the Settings panel, the document Outline panel, Reader Mode, and mobile view. It calls `render()` and `saveEditorSettings()`.

**`markdown_editor_sync.js`** depends on `editor`, `preview`, and `render()`. It handles both the standard scroll-sync algorithm and the optional "forced sync" algorithm.

**`markdown_editor_layout.js`** only needs `editor`, `preview`, `workspace`, `divider`, and `btnView`. It manages the drag-to-resize divider and the mobile editor/preview toggle.

**`markdown_editor_find.js`** depends on `editor` and `render()`. It builds the find backdrop element and wires up all Find/Replace interactions.

---

## Where things are stored (localStorage)

The app uses two `localStorage` keys:

| Key | Contents |
|---|---|
| `revery_md_content` (the value of `AUTOSAVE_KEY` in core.js) | The raw Markdown text of the current document |
| `revery_md_settings` | A JSON blob of all user settings (theme, pane width, font sizes, etc.) |

The autosave key is defined as a constant at the top of `markdown_editor_core.js`. If you want to run two separate instances of the editor on the same domain without them overwriting each other, change `AUTOSAVE_KEY` to something unique in each copy.

---

## Adding a new content template

Open `markdown_editor_tmplt_list.js`. There are two arrays:

- `yamlTemplates` — appear in the Toolbar → Insert YAML submenu
- `mdTemplates` — appear in the Toolbar → Insert Template submenu (if you wire them up)

Each entry is a plain object:

```js
{
  label: 'My Template',   // Text shown in the menu
  content: `# My heading\n\nBody text here.\n`
}
```

The `getTodayStr()` helper at the top of the file returns today's date as `YYYY-MM-DD`. Use it inside backtick strings to get a dynamic date stamp.

---

## Changing the preview background images

In `revery_notebook.html`, search for the comment `CHANGE THESE URLS TO YOUR OWN BACKGROUND IMAGES`. You will find two CSS rules:

```css
[data-theme="dark"] #preview {
  background-image:
    linear-gradient(...),
    url('/revery_notebook/image_assets/bg_4_web.jpg');
}
[data-theme="light"] #preview {
  background-image:
    linear-gradient(...),
    url('/revery_notebook/image_assets/bg_1_web.jpg');
}
```

Replace the `url(...)` paths with your own images. The `linear-gradient` on top of each image is what controls the opacity — it overlays the background colour at nearly full opacity so the image is only subtly visible. You can adjust the opacity by changing the `--bg_oacity` CSS variable (note the intentional typo in the variable name — keep it consistent). A value closer to `0` makes the image more visible; closer to `1` makes it invisible.

---

## Adding a UI language

Open `markdown_editor_lang.js`. The file exports (or sets on `window`) a `window.t(key)` function that returns a translated string. To add a new language, add its strings to the lookup object inside that file and expose a way to switch `uiLanguage` to that locale. The language setting is persisted in `revery_md_settings` via `saveEditorSettings()`.

---

## Changing fonts

The editor uses two custom font families declared as CSS variables at the top of the `<style>` block in `revery_notebook.html`:

```css
--font-brand: 'HaraldText', Georgia, 'Times New Roman', serif;
--font-mono:  'HaraldMono', 'Courier New', Courier, monospace;
```

The first value in each list (`HaraldText`, `HaraldMono`) is a self-hosted font loaded from the site's main CSS. If you are hosting this editor elsewhere, those fonts will silently fall back to the next value in the list (Georgia and Courier New respectively). Replace the first entry with any font you load yourself, or remove it entirely to just use the system fallbacks.

---

## Changing colours and theming

All colours are CSS custom properties on `:root` in the `<style>` block inside `revery_notebook.html`. There are two sets — one for `[data-theme="dark"]` and one for `[data-theme="light"]`. The theme is set automatically from the OS preference by a tiny inline script that runs before the page paints (search for `prefers-color-scheme` in the HTML). This prevents the flash of the wrong theme on load. Do not move that script.

The key colour variables are:

| Variable | Used for |
|---|---|
| `--bg` | Page and editor background |
| `--bg-panel` | Editor pane background, modal backgrounds |
| `--bg-hover` | Hover state for buttons and menu items |
| `--border` / `--border-md` | Dividers and button borders |
| `--text` | Primary text |
| `--text-muted` | Secondary text and button labels |
| `--text-dim` | Placeholder text and pane labels |
| `--accent` | Focus rings and the active find highlight |
| `--menu-bg` | Dropdown menu background |

---

## Adjusting the render debounce delay

By default the preview re-renders 50 ms after you stop typing. For very long documents this can be slow. The user can adjust this in the Settings menu ("CPU performance delay"), but you can also change the default in `markdown_editor_core.js`:

```js
let renderDelay = 50;   // milliseconds
```

Higher values save battery and CPU on long documents but make the preview feel less live.

---

## The custom undo system

The browser's native undo/redo on `<textarea>` is unreliable when text is inserted programmatically (every toolbar action does this). So the entire undo stack is replaced by a hand-built `UndoManager` class in `markdown_editor_undo.js`.

**Never call `editor.value = ...` directly.** Always use one of these two helpers instead:

- `window.insertWithUndo(start, end, newText)` — replaces the text between `start` and `end` with `newText` and records the change in the undo stack. Use this for toolbar insertions.
- `window.performTextChange(newText, selStart, selEnd)` — replaces the entire editor content and also calls `render()`, `countWords()`, and saves to `localStorage`. Use this for whole-document operations like "Replace All".

If you write a new toolbar action and bypass these helpers, Ctrl+Z will not undo your change.

---

## The find backdrop

The Find bar highlights matches using a hidden `<div>` (called `findBackdrop`) that is positioned precisely behind the transparent `<textarea>`. It mirrors the editor's exact font, size, padding, and scroll position so that `<mark>` elements inside it appear to highlight text in the editor. If you ever change the editor's CSS (font, padding, line height) and the highlights appear slightly offset, look at `syncFindBackdrop()` in `markdown_editor_find.js` — it reads the computed style of `#editor` and applies it to the backdrop. Make sure any new CSS properties you add are also copied there.

---

## Preview → Editor click-to-sync

When you click a rendered block in the preview, the editor jumps to the corresponding source line. This works because `markdown_editor_core.js` injects a custom `source_map` rule into markdown-it that attaches `data-sl` (source line start) and `data-sl-end` (source line end) attributes to every top-level rendered element. The click handler in `markdown_editor_sync.js` reads these attributes, converts them to character offsets, and calls `editor.setSelectionRange()`.

If you add a custom markdown-it plugin that produces new block-level elements, they will not have `data-sl` attributes by default and clicking them in the preview will do nothing. This is harmless.

---

## Content Security Policy

The HTML includes a strict CSP meta tag:

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self';
           style-src 'self' 'unsafe-inline';
           font-src 'self' data:;
           img-src 'self' data:;
           script-src 'self' 'unsafe-inline';">
```

`'unsafe-inline'` is required for styles and scripts because all the CSS lives in a `<style>` block in the HTML and there is no build step to generate nonces. If you move to a proper server with a build pipeline, you can tighten this by replacing `'unsafe-inline'` with nonces or hashes.

The Markdown renderer has `html: false` set in the markdown-it config, which prevents users from injecting raw HTML into the preview. Link schemes are also validated — `javascript:` and `data:` URIs in links are silently stripped.

---

## Known limitations and gotchas

**Bundling the JS files into one file will likely break things.** A comment near the bottom of `revery_notebook.html` explains why: the browser loads separate scripts in a way that lets it resolve cross-file function calls more reliably than a single concatenated blob. Leave them as separate files.

**`localStorage` has a size cap** (usually 5–10 MB depending on the browser). For very large documents the autosave and settings save will fail silently (or show the `#size-warning` element). The user is expected to export their work to a file to recover space.

**The editor is a plain `<textarea>`.** There is no syntax highlighting in the editing pane itself — only in the rendered preview. Adding editor-side syntax highlighting would require replacing the textarea with a code-editor library (like CodeMirror or Monaco), which is a large architectural change.

**Mobile support is basic.** The layout switches to a single-pane view under 750 px, showing either the editor or the preview. The drag-to-resize divider works on touch. Most toolbar actions work fine, but the experience is not optimised for virtual keyboards.

---

## Quick checklist when something breaks

1. Open the browser console (`F12 → Console`). Almost every function has error logging.
2. Check the script load order in the HTML. The scripts at the bottom of `<body>` must load in the exact order listed.
3. If toolbar actions stop working, check `markdown_editor_actions.js`. The action dispatcher is a large `switch` statement — a missing `break` can swallow subsequent cases.
4. If the preview goes blank, check `markdown_editor_core.js` → `render()`. The try/catch will render an error message if markdown-it throws.
5. If undo behaves strangely, make sure no code is assigning `editor.value = ...` directly without setting `window.undoManager.ignoreNext = true` before and `false` after.
6. If settings do not persist between sessions, check `localStorage` in the browser's Application tab to confirm `revery_md_settings` is being written.
