

# Revery Notebook — Developer Documentation

Welcome to the codebase for **Revery Notebook**! This is a vanilla HTML/CSS/JavaScript, client-side-only Markdown editor. It is designed to be lightweight, distraction-free, and privacy-focused (all data stays in the browser's `localStorage`).

If you are picking up this project to maintain or expand it, this guide will walk you through how the application is structured and where to look when you want to make changes.

## 🚀 Quick Start / Local Development

Because this app is entirely client-side, there is no build step (no Webpack, Vite, or Node.js required). 
1. Clone or download the repository.
2. Open `revery_notebook.html` in your web browser. 
3. *Note:* For some features to work perfectly (like the modern Clipboard API for copy/paste), you should serve it over a local web server rather than just a `file://` protocol. (e.g., using VS Code's "Live Server" extension or running `python -m http.server`).

## 📁 Architecture & File Structure

The application's logic is split into several distinct JavaScript files. They are loaded sequentially at the bottom of the HTML file. **Do not bundle them into a single file**, as browser parsing order can cause issues with how these specific scripts interact.

Here is what each file is responsible for:

### 1. `revery_notebook.html`
The main entry point. It contains the DOM structure (Topbar, Editor Pane, Preview Pane, Modals) and **all the CSS styling**. 
* **Look here if:** You need to change colours, adjust the layout flexbox, tweak responsive mobile media queries, or modify print styles (`@media print`).

### 2. `markdown_editor_core.js`
The heart of the application. It configures the `markdown-it` library (along with KaTeX for math and highlight.js for code) and handles the actual rendering of text into HTML.
* **Look here if:** You want to change how Markdown is parsed, adjust the word counter, modify how YAML frontmatter is displayed, or tweak the outline generation logic.

### 3. `markdown_editor_sync.js`
Handles the complex task of keeping the Markdown editor and the live Preview scrolled to the same place. 
* **Look here if:** Scroll synchronization feels misaligned or jittery. It uses `markdown-it` source maps (`data-sl` attributes) to calculate where an element in the preview corresponds to a line number in the editor. It also handles the "click a preview block to jump to the editor line" feature.

### 4. `markdown_editor_actions.js`
Contains the execution logic for all text formatting commands (Bold, Italic, Tables) and file operations.
* **Look here if:** You want to add a new Markdown shortcut, change how files are exported/named, or modify the save/load logic.

### 5. `markdown_editor_menus.js`
Manages the user interface state. It handles the dropdown menus, modals, and the `Settings` panel. It also handles persisting user preferences (font sizes, reader mode) to `localStorage`.
* **Look here if:** You want to add a new setting toggle, change dropdown behaviours, or modify how UI sizes scale.

### 6. `markdown_editor_undo.js`
A custom Undo/Redo manager. Because we manipulate the textarea's value programmatically (e.g., wrapping text in `**bold**`), the browser's native undo history breaks. This script intercepts typing and programmatic changes to build a custom history stack.
* **Look here if:** `Ctrl+Z` behaves weirdly, or if you add a new text-insertion feature and need to make sure it registers in the undo history (use `insertWithUndo()`).

### 7. `markdown_editor_find.js`
A custom Find and Replace implementation.
* **Look here if:** You want to tweak search regex. 
* **Quirk Alert:** You cannot highlight text *inside* a standard `<textarea>`. To achieve the yellow highlight effect, this script creates a transparent duplicate `div` (`#find-backdrop`) directly behind the editor, placing a `<mark>` tag exactly where the text matches. 

### 8. `markdown_editor_layout.js`
Manages the resizable panels. It handles the mouse/touch drag events for the vertical dividers between the Editor, Preview, and Outline panes.

### 9. `markdown_editor_lang.js`
The translation engine. It contains a dictionary mapping English strings to Swedish (and potentially future languages).
* **Look here if:** You need to fix a typo in a menu button, translate the app into a new language, or edit the text inside the "About" or "Legal" modals.

### 10. `markdown_editor_tmplt_list.js`
A simple data file storing the predefined templates (Recipes, To-do lists, Blog YAML frontmatter) available in the "File -> Import Template" menu.

---

## 🛠️ Third-Party Libraries

This app relies on a few robust open-source libraries, loaded locally in the `/jvscrpt_and_css_extra/` folder:
* **`markdown-it.min.js`**: The core Markdown parser.
* **`markdown-it-footnote.min.js`**: Adds `[^1]` footnote support.
* **`highlight.min.js`**: Adds syntax highlighting to code blocks.
* **`katex.min.js` & `texmath.min.js`**: Renders LaTeX math equations fast.

## 🧠 Key Development Concepts & "Gotchas"

### 1. State Management
This app does not use a framework like React or Vue. State (like whether "Reader Mode" is active) is stored in global variables (e.g., `window.previewVisible`) and synced to the DOM manually by adding/removing CSS classes or toggling `display: none`. Always ensure you update both the variable and the DOM.

### 2. Data Persistence
Everything lives in `localStorage`.
* `revery_md_autosave`: Stores the actual text the user is writing.
* `revery_md_settings`: Stores their UI preferences (font size, language, etc.).
* *Gotcha:* `localStorage` has a strict size limit (usually ~5MB). The app includes warnings when the user approaches this limit. Do not store heavy base64 images here.

### 3. Programmatic Text Insertion
If you build a feature that inserts text into the editor (like a new toolbar button), **do not** just do `editor.value += "text"`. This will break the undo history. 
Instead, always use the helper functions provided in `markdown_editor_actions.js` or `markdown_editor_undo.js`:
* `wrapText(before, after, defaultText)`
* `insertWithUndo(start, end, newText)`

### 4. The UI Scaling System
The user can independently scale the "Editor Text", "Preview Text", and "UI Menus". This is handled in `markdown_editor_menus.js` via the `applyTextSize()` and `applyUiSizeProseCompensation()` functions. It works by manipulating CSS custom properties (`--text-body`) and dynamically injecting `<style>` blocks to override hardcoded values. Be careful when adding new fixed `px` or `rem` sizes in the CSS, as they might not scale correctly unless hooked into these functions.

---

# Revery Notebook — Markdown Editor

A full-featured, client‑side Markdown editor with live preview, LaTeX support, syntax highlighting, YAML frontmatter integration, and a clean distraction‑free interface. The entire application runs in your browser and stores data locally — no server, no tracking, no external dependencies except the open‑source libraries listed below.

## Features

- **Split‑screen editing** – Resizable editor and preview panes.
- **Live preview** – Renders Markdown as you type (debounced).
- **LaTeX (KaTeX)** – Supports `$...$` inline and `$$...$$` block equations.
- **Syntax highlighting** – Powered by highlight.js for code blocks.
- **YAML frontmatter** – Displayed as clickable “pills” that jump to the source.
- **Outline navigation** – Auto‑generated from ATX headings; click to scroll.
- **Find & Replace** – Case‑sensitive, regex, and replace‑all support.
- **Undo / Redo** – Custom manager with size‑aware history.
- **File operations** – New, Import, Save As, Export as `.md` or `.txt`.
- **Templates** – Built‑in Markdown and YAML templates (Recipe, To‑do, Blog Post, etc.).
- **Reader Mode** – Full‑screen reading view with adjustable content width.
- **Mobile View** – Phone‑sized preview frame for responsive testing.
- **Mobile layout** – Adaptive topbar, collapsible outline drawer.
- **Settings persistence** – Font sizes, UI scale, language, performance delay, and more are saved in `localStorage`.
- **Print styles** – Clean, page‑break‑aware print output.
- **Auto‑save** – Drafts are saved to `localStorage` every keystroke.

## Demo & Usage

Simply open `revery_notebook.html` in any modern browser (Chrome, Firefox, Safari, Edge). No build step, no server required.

The application is fully self‑contained and works offline after the first load (provided all assets are cached).

## Project Structure

```
revery_notebook.html                         # Main HTML entry point
main.css                                     # Global site styles (outside this folder)
prose.css                                    # Preview prose styling
/revery_notebook/jvscrpt_and_css_extra/      # Editor scripts & vendor libs
    markdown_editor_core.js                  # Markdown‑it setup, render, outline, auto‑save
    markdown_editor_menus.js                 # Dropdown menus, settings, UI toggles
    markdown_editor_actions.js               # Toolbar/context menu actions (bold, table, etc.)
    markdown_editor_undo.js                  # Undo/Redo manager
    markdown_editor_sync.js                  # Preview ↔ editor scroll & click sync
    markdown_editor_layout.js                # Drag dividers, mobile view toggle
    markdown_editor_find.js                  # Find/Replace bar
    markdown_editor_lang.js                  # Translation engine (English/Swedish)
    markdown_editor_tmplt_list.js            # YAML & Markdown templates
    markdown-it.min.js                       # Markdown parser
    markdown-it-footnote.min.js              # Footnote plugin
    katex.min.js / katex.min.css             # LaTeX rendering
    texmath.min.js / texmath.min.css         # markdown‑it‑texmath plugin
    highlight.min.js / github-dark.min.css   # Code highlighting
```

> **Note:** The paths assume the HTML file is served from the root of a web server (e.g., `https://haraldrevery.com/revery_notebook.html`). If you move the files, adjust the `src` and `href` attributes accordingly.

## Dependencies (Vendor Libraries)

All third‑party libraries are included as local copies in the `jvscrpt_and_css_extra` folder. Licenses are displayed in the **Legal** modal inside the app.

| Library                | Purpose                          | License       |
|------------------------|----------------------------------|---------------|
| markdown-it v14        | Markdown parser                  | MIT           |
| markdown-it-footnote v4| Footnote support                 | MIT           |
| KaTeX                  | LaTeX math rendering             | MIT           |
| markdown-it-texmath    | Delimiter handling for KaTeX     | MIT           |
| highlight.js           | Syntax highlighting              | BSD 3‑Clause  |

## Configuration & Settings

All user preferences are stored in `localStorage` under the key `revery_md_settings`. You can reset everything by using **Total Reset** in the quit modal.

Settings include:

- UI menu size, editor/preview/outline font sizes
- Editor & preview font family (Harald, sans, serif, mono, Arial, etc.)
- Reader mode content width (10% – 100%)
- Calendar date format
- Filename format (prefix/suffix)
- Render delay (CPU performance)
- Forced preview sync
- Right‑click deactivation
- Center headings
- Language (English / Swedish)

## Maintaining & Extending

### Adding a new language

1. In `markdown_editor_lang.js`, extend `window.uiTranslations` with your language key (e.g., `"German"`).
2. For each English string, add a `"German"` translation.
3. Add your language to the `languageOptions` array inside `buildSettingsMenu()` (in `markdown_editor_menus.js`).

Example:
```js
"Markdown": { "Swedish": "Markdown", "German": "Markdown" }
```

### Adding a new template

- **Markdown templates** – edit the `mdTemplates` array in `markdown_editor_tmplt_list.js`.  
  Each item needs a `label` (shown in the menu) and `content` (the Markdown string to insert).
- **YAML templates** – edit the `yamlTemplates` array (same file).  
  They appear under **Insert YAML ▸** in the toolbar.

### Modifying the UI

- All CSS variables are defined in the `<style>` block inside `revery_notebook.html`.  
- The layout uses Flexbox. Breakpoints: `750px` for mobile, `950px` for medium screens.
- Icons are inline SVG (the ½ logo). Replace the `<svg>` content if needed.

### Adding a new toolbar action

1. Add the action’s label and `action` string to `menuActions` (in `markdown_editor_actions.js`).
2. Implement the `case` inside `executeAction()`.
3. If the action needs a custom modal, create the modal HTML in `revery_notebook.html` and add show/hide logic.

### Changing the background images

The editor preview uses background images. Replace the URLs inside the CSS:

```css
[data-theme="dark"] #preview { background-image: linear-gradient(...), url('your-dark-image.jpg'); }
[data-theme="light"] #preview { background-image: linear-gradient(...), url('your-light-image.jpg'); }
```

Same for the mobile view frame backgrounds.

## Known Limitations & Troubleshooting

- **Local storage quota** – Files larger than ~5 MB may fail to save. A warning appears near the word counter.
- **LaTeX rendering** – The dollar sign must touch the first character of the equation (no space after `$`). Use `$x^2$`, not `$ x^2 $`.
- **Mobile keyboard** – On iOS, the virtual keyboard may cover the editor; the textarea has extra bottom padding (`40vh`) to mitigate this.
- **Forced preview sync** – Can feel “janky” on very long documents. Turn it off if you prefer the standard scroll‑based sync.
- **Printing** – Works best in Chrome and Firefox. Background images are removed for print.

## Development Tips

- The code uses global functions and variables (no module bundler). Keep function names unique.
- Undo/redo is custom – be careful when programmatically changing `editor.value`; always use `insertWithUndo` or `performTextChange`.
- The preview scroll‑sync observer (`previewObserver`) is temporarily disconnected while copy buttons are injected to avoid extra scroll events.
- To debug, open the browser console. Most modules log warnings for missing translations or storage errors.

## Credits

- **Design & code** – Harald Mark Thirslund  
- **Open‑source libraries** – See the Legal modal for full licence texts.

## License (for this README)

This README is provided as documentation. The application itself is proprietary (see the Legal modal for terms). The third‑party libraries are governed by their own licences.