# Revery Notebook

A self-hosted, browser-based Markdown editor with live preview, KaTeX math rendering, syntax highlighting, and a distraction-free reader mode. Runs entirely client-side — no backend, no database, no account required.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Feature Overview](#feature-overview)
- [Project Structure](#project-structure)
- [Third-Party Libraries](#third-party-libraries)
- [Getting Started (Beginners)](#getting-started-beginners)
- [Getting Started (Developers)](#getting-started-developers)
- [Building the CodeMirror Bundle](#building-the-codemirror-bundle)
- [Adding Templates](#adding-templates)
- [Adding a Language](#adding-a-language)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Settings & Persistence](#settings--persistence)
- [Security Notes](#security-notes)
- [Known Limitations](#known-limitations)
- [Deployment Checklist](#deployment-checklist)

---

## What It Does

Revery Notebook is a single-page Markdown editor. You open the HTML file in a browser, write in the left pane, and see a formatted preview on the right — live, as you type. Everything is saved automatically to the browser's `localStorage`, so your work survives a page refresh. When you are done you export your document as a `.md` or `.txt` file.

There is no login, no cloud sync, and no telemetry. It is intentionally simple.

---

## Feature Overview

### Editing
- **CodeMirror 6** powers the editor: syntax highlighting, undo/redo history, keyboard shortcuts, and find highlights are all handled natively by CM.
- **Bold**, **Italic**, **Headings**, **Strikethrough**, **Code Blocks**, **Inline Code**, **Links**, **Images**, **Task Lists**, **Tables**, **Horizontal Rules**, and **Footnotes** are all available from the Toolbar dropdown.
- A **right-click context menu** adds Cut / Copy / Paste (on selected text), Insert Date, convert selection to ordered or unordered list, and Clear Format.

### Preview
- **Live side-by-side preview** rendered by [markdown-it](https://github.com/markdown-it/markdown-it) with `linkify`, `typographer`, and footnote support.
- **KaTeX math**: use `$inline$` or `$$display$$` as well as `\( \)` and `\[ \]` bracket notation.
- **Syntax-highlighted code blocks** via Highlight.js with the GitHub Dark theme and one-click copy buttons on every block (and inline snippet).
- **YAML Frontmatter** is rendered as a card of clickable "property pills" at the top of the preview, rather than raw text. Clicking a pill jumps to its line in the editor.

### Scroll Sync
The editor and preview stay in sync while you scroll. Two strategies run in parallel:
- **Standard sync** — proportional line-mapping using markdown-it's `data-sl` source-map attributes.
- **Forced Preview Sync** — cursor-driven sync that can be toggled on in Settings for documents where the standard sync drifts (long documents with complex nesting). Enable it when the default feels sluggish or imprecise.

Clicking any element in the preview pane selects and highlights the corresponding source block in the editor.

### Navigation & Modes
- **Outline pane** — a living table of contents built from all `#`–`######` headings. Toggle it on via Settings. Clicking a heading scrolls both panes to it instantly.
- **Reader Mode** — hides the editor and focuses the preview in a clean reading layout. Exit with the top-bar button.
- **Mobile view** — on narrow screens the layout switches to a single-pane view with a toggle button to flip between editor and preview.

### File Operations
All file operations live under the **File** menu.

| Action | Notes |
|---|---|
| New File | Warns if there are unsaved changes |
| Import File | Opens a local `.md` or `.txt` file |
| Import Template | Choose from built-in YAML or Markdown templates |
| Save as… | Prompts for a filename, saves to `localStorage` |
| Export as .md | Downloads a `.md` file |
| Export as .txt | Downloads a plain-text file |

The export filename is built from the document title and a configurable suffix / prefix format (date, datetime, time, compact date, or none). Set it under **Settings → Filename format**.

### Find & Replace
Press **Ctrl+F** to open the find bar. Features include:
- Case-sensitive toggle (`Aa` button)
- Regular expression toggle (`.*` button) with a ReDoS safety guard
- Match counter (e.g. `3 / 14`)
- Navigate with **Enter** / **Shift+Enter** or the ↑ ↓ buttons
- Replace current match or replace all
- CM decorations highlight all matches inline in the editor

### Settings (all persisted to `localStorage`)
| Category | Options |
|---|---|
| Layout | Show/hide Preview, Show/hide Outline, Mobile View |
| Reader Mode | Padding: Default / 80% / 60% / 50% |
| Text sizes | Editor, Preview, Outline, and UI menu — each independently scalable |
| Font types | `Harald` (default), Serif, Sans-serif, Monospace (editor and preview independently) |
| Preview | Center Headers on/off |
| Scroll sync | Forced Preview Sync on/off |
| Performance | CPU render delay (50 ms – 2000 ms) |
| File export | Filename format, Calendar date format |
| Misc | Disable right-click context menu |
| Language | English, Swedish |

---

## Project Structure

```
/
├── revery_notebook.html              ← The app. Open this in a browser.
│
└── jvscrpt_and_css_extra/            ← All assets live here
    ├── revery_notebook_style.css     ← All styles for the editor UI
    ├── markdown_editor_theme.js      ← Runs before paint; sets dark/light via system pref
    ├── markdown_editor_lang.js       ← Translation engine + string table
    ├── markdown_editor_tmplt_list.js ← YAML and Markdown template definitions
    ├── codemirror-bundle.js          ← Built CM6 bundle (do not edit directly)
    ├── markdown_editor_cm_setup.js   ← Initialises the CodeMirror instance + shim
    ├── markdown_editor_core_cm.js    ← Render loop, autosave, outline, word count
    ├── markdown_editor_actions_cm.js ← Toolbar actions, export, filename builder
    ├── markdown_editor_menus.js      ← Settings menu, dropdowns, state persistence
    ├── markdown_editor_sync.js       ← Bidirectional scroll sync (editor ↔ preview)
    ├── markdown_editor_layout.js     ← Draggable dividers, mobile view toggle
    ├── markdown_editor_find_cm.js    ← Find / Replace bar logic
    │
    ├── markdown-it.min.js            ← Markdown renderer
    ├── markdown-it-footnote.min.js   ← Footnote plugin for markdown-it
    ├── katex.min.js / .css           ← Math rendering
    ├── texmath.min.js / .css         ← markdown-it ↔ KaTeX bridge
    ├── highlight.min.js              ← Code syntax highlighting
    ├── github-dark.min.css           ← Highlight.js theme
    └── purify.min.js                 ← DOMPurify HTML sanitiser

Build tooling (not deployed):
├── package.json
├── package-lock.json
├── build_cm.js                       ← esbuild script
└── cm_entry_slim.js                  ← CodeMirror 6 entry point
```

> **Beginner tip:** The only file you ever need to open in a browser is `revery_notebook.html`. Everything else is a resource it loads automatically. You do not need Node.js or a build step unless you want to update the CodeMirror bundle.

---

## Third-Party Libraries

All libraries are self-hosted (no CDN calls at runtime) to satisfy the Content Security Policy.

| Library | Purpose | License |
|---|---|---|
| [CodeMirror 6](https://codemirror.net/) | Editor engine | MIT |
| [markdown-it](https://github.com/markdown-it/markdown-it) | Markdown → HTML renderer | MIT |
| [markdown-it-footnote](https://github.com/markdown-it/markdown-it-footnote) | `[^1]` footnote syntax | MIT |
| [KaTeX](https://katex.org/) | LaTeX math rendering | MIT |
| [markdown-it-texmath](https://github.com/goessner/markdown-it-texmath) | markdown-it ↔ KaTeX bridge | MIT |
| [Highlight.js](https://highlightjs.org/) | Code block syntax highlighting | BSD-3-Clause |
| [DOMPurify](https://github.com/cure53/DOMPurify) | HTML sanitisation (XSS protection) | Apache-2.0 / MPL-2.0 |

---

## Getting Started (Beginners)

You do not need to install anything.

1. Copy the entire project folder to your web server (or open `revery_notebook.html` directly in a browser for local use).
2. Open `revery_notebook.html`. The editor loads with a short welcome note.
3. Start typing in the left pane. The right pane updates as you type.
4. Press **Ctrl+S** to download your work as a `.md` file. The filename comes from the title field in the top-left corner.
5. Your text is automatically saved to the browser each time you type, so refreshing the page will restore your last session.

**To start a new document**, use **File → New File**. You will be asked if you want to export first.

**To open an existing `.md` file**, use **File → Import File**.

---

## Getting Started (Developers)

### Prerequisites
- A static web server (Nginx, Apache, GitHub Pages, Caddy, or even Python's `http.server`)
- Node.js 18+ only if you need to rebuild the CodeMirror bundle

### Local development
Because the HTML uses `<script src="...">` tags with relative paths, it works fine when served from any static host. To run locally without a server you can use:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080/revery_notebook.html`.

### Script loading order
The scripts in `revery_notebook.html` must be loaded in this exact order. Each file depends on globals defined by those before it:

```
markdown_editor_theme.js       (inline, before <body> — prevents theme flash)
markdown_editor_tmplt_list.js  (defines yamlTemplates / mdTemplates globals)
markdown-it + plugins          (defines window.markdownit, etc.)
katex + texmath
highlight.js
purify.min.js
markdown_editor_lang.js        (defines window.t(), window.uiLanguage)
codemirror-bundle.js           (defines window.CM.*)
markdown_editor_cm_setup.js    (creates the CM instance; exposes window.editor shim)
markdown_editor_core_cm.js     (render loop, autosave — requires editor shim)
markdown_editor_actions_cm.js  (toolbar actions — requires render())
markdown_editor_menus.js       (settings menus — requires all actions)
markdown_editor_sync.js        (scroll sync — requires editor, preview)
markdown_editor_layout.js      (drag dividers — requires edPane, divider)
markdown_editor_find_cm.js     (find/replace — requires CM decorations API)
```

### `window.editor` shim
`markdown_editor_cm_setup.js` creates the CodeMirror view and exposes `window.editor` — an object with `.value` (getter/setter), `.selectionStart`, `.selectionEnd`, `.setSelectionRange()`, `.scrollTop`, `.scrollHeight`, `.clientHeight`, `.focus()`, and event listener proxies. This shim means most of the other files can talk to the editor exactly as if it were a plain `<textarea>`, making the CodeMirror integration transparent to the rest of the codebase.

---

## How to rebuild `codemirror-bundle.js`

The CodeMirror 6 bundle is checked in as `codemirror-bundle.js`. You only need to rebuild it if you add or remove CM packages.


```bash
cd build_tools/ # you have to be in the build_tools/ folder
npm install
node build_cm.js
# copy over codemirror-bundle.js tp /jvscrpt_and_css_extra/
```


Copy the resulting `codemirror-bundle.js` to `jvscrpt_and_css_extra/`.

To add a CM package, install it with `npm install @codemirror/your-package`, then export what you need from `cm_entry_slim.js` before rebuilding. Keep the entry file minimal — the current bundle is intentionally slim (language-data for fenced code block per-language colours is excluded to save size; fenced blocks still render, just without token-level colours).

---

## Adding Templates

Open `markdown_editor_tmplt_list.js`. There are two arrays:

**`yamlTemplates`** — appear under Toolbar → Insert YAML. Each entry becomes a submenu item that inserts a full YAML frontmatter block.

```js
{
  label: 'My Template',
  content: `---\ntitle: Untitled\ndate: ${getTodayStr()}\n---\n\n`
}
```

**`mdTemplates`** — appear under File → Import Template. Each entry inserts a Markdown skeleton into the editor.

```js
{
  label: 'Meeting Notes',
  content: `# Meeting Notes\n\n**Date:** \n**Attendees:**\n\n## Agenda\n- \n\n## Action Items\n- [ ] \n`
}
```

Add your entry to either array and reload the page. No rebuild required.

---

## Adding a Language

Open `markdown_editor_lang.js`. The `window.uiTranslations` object maps English strings to translations keyed by language name.

1. Pick a language name string (e.g. `"French"`).
2. For every key in `uiTranslations`, add a `"French": "..."` entry. You can skip any string you do not want to translate — untranslated strings fall back to the English key.
3. Add `"French"` to the `"Language ▸"` submenu in `markdown_editor_menus.js` (search for `"English"` and `"Swedish"` to find the right spot — it is a small array of `{ label, action }` objects).
4. Reload. The new language will appear in Settings → Language.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+S` | Export as .md |
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+F` | Open Find bar |
| `Enter` (in Find) | Next match |
| `Shift+Enter` (in Find) | Previous match |
| `Escape` | Close Find bar |
| `Ctrl+Z` | Undo (CM native) |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo (CM native) |

---

## Settings & Persistence

Two `localStorage` keys are used:

| Key | Contents |
|---|---|
| `revery_md_autosave` | The raw Markdown text of the current document |
| `revery_md_settings` | A JSON object containing all Settings menu state |

Settings include: `forcedSyncEnabled`, `previewVisible`, `outlineVisible`, `uiSize`, `editorTextSize`, `previewTextSize`, `outlineFontSize`, `readerPadding`, `editorFontType`, `previewFontType`, `uiLanguage`, `currentDateFormat`, `filenameFormat`, `renderDelay`, `savedEditorWidth`, `centerHeaders`, and `rightClickDisabled`.

**To reset everything**, open the browser console and run:
```js
localStorage.removeItem('revery_md_autosave');
localStorage.removeItem('revery_md_settings');
location.reload();
```
Or use **File → Quit → Total Reset** from inside the app.

---

## Security Notes

- **Content Security Policy** — the HTML sets a strict `<meta>` CSP: no inline scripts (except one allowlisted SHA-256 hash for the theme script), no external script sources, no `eval`.
- **DOMPurify** sanitises all markdown-it output before it touches the DOM. The `data-sl` and `data-sl-end` scroll-sync attributes are explicitly allow-listed.
- **URL sanitisation** — the markdown-it link renderer rejects `javascript:`, `data:`, and `vbscript:` schemes.
- **YAML XSS** — YAML frontmatter keys and values are HTML-escaped before being injected as pill content.
- **ReDoS guard** — the Find bar validates user-supplied regexes against a heuristic before constructing a `RegExp` object. Patterns with nested quantifiers, quantified alternation groups, or length over 100 characters are rejected with a non-blocking warning.
- **Multi-tab collision** — a `storage` event listener detects when another tab overwrites the autosave key and shows a warning banner.

---

## Known Limitations

- **5 MB storage cap** — `localStorage` is typically limited to 5 MB per origin. The editor warns at 90% capacity. For very large documents, export frequently.
- **No cloud sync** — documents only live in the browser that created them. Export your `.md` file if you need to move it or back it up.
- **Single document at a time** — the autosave key holds one document. Opening the app in a second tab with different content will produce a multi-tab warning.
- **Image display** — images in the preview use the `src` attribute as written. Relative paths will only resolve when the file is served from the correct base URL. Absolute URLs (`https://...`) always work.
- **Bundled CodeMirror** — the `codemirror-bundle.js` file is a pre-built artifact. If you upgrade a CM package, you must rebuild it with `npm run build` and re-deploy the file.

---

## Deployment Checklist

- [ ] Copy `revery_notebook.html` and the entire `jvscrpt_and_css_extra/` folder to the server.
- [ ] Ensure the server serves `.js` and `.css` files with correct MIME types.
- [ ] If using HTTPS (recommended), the Clipboard API (`navigator.clipboard`) will be available. On `http://` origins the copy-button falls back to the `execCommand` approach automatically.
- [ ] The CSP `<meta>` tag allows `img-src 'self' data:`. If your users embed external images (`![](https://...)`) you will need to add `img-src * data:` or an appropriate domain allowlist.
- [ ] If you rename the `jvscrpt_and_css_extra/` directory, update all `<script src="...">` and `<link href="...">` paths in `revery_notebook.html` accordingly.

---

*Built by [Harald Mark Thirslund](https://haraldrevery.com) · Gothenburg, SE*
