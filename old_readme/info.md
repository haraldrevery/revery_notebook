# Revery Notebook — CodeMirror 6 Migration

## Files Changed

### New files (add to `jvscrpt_and_css_extra/`)
| File | Purpose |
|------|---------|
| `codemirror-bundle.js` | Pre-built CM 6 bundle (494 KB minified). Self-hosted, no CDN needed. |
| `markdown_editor_cm_setup.js` | Mounts the CM view; provides the `window.editor` shim + `insertWithUndo` + find-highlight API. **Load this before `markdown_editor_core_cm.js`.** |

### Replace (renamed `*_cm` variants)
| Old file | New file | What changed |
|----------|----------|--------------|
| `markdown_editor_core.js` | `markdown_editor_core_cm.js` | Removed `const editor = document.getElementById('editor')` (now the CM shim). |
| `markdown_editor_actions.js` | `markdown_editor_actions_cm.js` | Removed the `editor.addEventListener('keydown', …)` Tab/auto-wrap block — CM keymaps in `cm_setup.js` replace it. |
| `markdown_editor_find.js` | `markdown_editor_find_cm.js` | Removed entire textarea-mirror backdrop (300+ lines). Find highlights are now CM `Decoration.mark()` rendered inline. |

### Patched in-place
| File | What changed |
|------|-------------|
| `revery_notebook.html` | `<textarea id="editor">` → `<div id="cm-editor-host">`. Added two new `<script>` tags. Removed `markdown_editor_undo.js` script tag. |
| `revery_notebook_style.css` | Appended `#cm-editor-host` layout rules (flex fill, padding, scrollbar, mobile). Old `#editor` textarea rules are kept but are inert since the element no longer exists. |

### Removed entirely
| File | Why |
|------|-----|
| `markdown_editor_undo.js` | CM's built-in `history()` extension handles undo/redo natively and correctly. |

### Unchanged (drop-in replacements, no edits needed)
`markdown_editor_sync.js`, `markdown_editor_layout.js`, `markdown_editor_menus.js`,  
`markdown_editor_lang.js`, `markdown_editor_theme.js`, `markdown_editor_tmplt_list.js`

---

## What the `window.editor` shim exposes

The shim in `markdown_editor_cm_setup.js` mirrors the `<textarea>` API so all existing
scripts work without modification:

| Property / method | Maps to |
|---|---|
| `.value` get/set | `cmView.state.doc.toString()` / dispatch |
| `.selectionStart` / `.selectionEnd` | `cmView.state.selection.main.{from,to}` |
| `.setSelectionRange(from, to)` | `cmView.dispatch({ selection: … })` |
| `.focus()` | `cmView.focus()` |
| `.scrollTop` get/set | `cmView.scrollDOM.scrollTop` |
| `.scrollHeight` / `.clientHeight` | `cmView.scrollDOM.*` |
| `.style.fontSize` | Injects `<style id="_cm_font_size">` targeting `.cm-content` |
| `.classList.add/remove/contains` | `cmView.dom.classList.*` |
| `.placeholder` set | `placeholderCompartment.reconfigure(…)` |
| `.addEventListener('input', …)` | CM `updateListener` (docChanged) |
| `.addEventListener('scroll', …)` | `cmView.scrollDOM.addEventListener('scroll', …)` |
| `.addEventListener('keydown/keyup', …)` | `cmView.dom.addEventListener(…)` |
| `.addEventListener('contextmenu', …)` | `cmView.contentDOM.addEventListener(…)` |

---

## How to rebuild `codemirror-bundle.js`

```bash
cd build_tools/
npm install
node build_cm.js
cp codemirror-bundle.js ../jvscrpt_and_css_extra/
```

To add per-language syntax highlighting inside fenced code blocks (adds ~1 MB to bundle):
1. Edit `cm_entry_slim.js` — uncomment `export { languages } from '@codemirror/language-data'`
2. Edit `markdown_editor_cm_setup.js` — add `languages` to the destructure and pass `{ codeLanguages: languages }` to `markdown()`
3. Rebuild.

---

## Deployment checklist

```
jvscrpt_and_css_extra/
  codemirror-bundle.js              ← NEW
  markdown_editor_cm_setup.js       ← NEW
  markdown_editor_core_cm.js        ← replaces markdown_editor_core.js
  markdown_editor_actions_cm.js     ← replaces markdown_editor_actions.js
  markdown_editor_find_cm.js        ← replaces markdown_editor_find.js
  revery_notebook_style.css         ← patched (CSS additions appended)
  (delete markdown_editor_undo.js)  ← no longer needed

revery_notebook.html                ← patched
```
