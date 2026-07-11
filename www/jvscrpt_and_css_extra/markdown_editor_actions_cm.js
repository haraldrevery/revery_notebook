// editor-actions.js
// ── Menu Actions Definition ────────────────────────────────────────────────
const menuActions = [
  // Safely fallback to empty array if the external file didn't load
  { type: 'submenu', label: 'Insert YAML ▸', items: typeof yamlTemplates !== 'undefined' ? yamlTemplates : [], customKind: 'yaml' },
  { type: 'divider' },
  { label: 'Bold (Ctrl+B)', action: 'bold' },
  { label: 'Italic (Ctrl+I)', action: 'italic' },
  { label: 'Heading', action: 'heading' },
  { label: 'Strikethrough', action: 'strike' },
  { label: 'Code Block', action: 'code' },
  { label: 'Inline Code', action: 'inline_code' },
  { label: 'Link', action: 'link' },
  { label: 'Image', action: 'image' },
  { type: 'divider' },
  { label: 'Task List', action: 'task_list' },
  { label: 'Insert Table', action: 'table' },
  { label: 'Insert Date', action: 'insert_date' },
  { label: 'Horizontal Rule', action: 'hr' },
  { label: 'Footnote', action: 'footnote' },
  { type: 'divider' },
  { label: 'Copy MD', action: 'copy' }
];


/* Extra items that appear only in the right-click context menu.
   "Marked" = works on the currently selected text.               */
const contextMenuExtra = [
  { type: 'divider' },
  { label: 'Cut (Marked)',            action: 'ctx_cut' },
  { label: 'Copy (Marked)',           action: 'ctx_copy' },
  { label: 'Paste',                   action: 'ctx_paste' },
  { type: 'divider' },
  { label: 'Ordered List (Marked)',   action: 'list_ordered' },
  { label: 'Unordered List (Marked)', action: 'list_unordered' },
  { type: 'divider' },
  { label: 'Clear Format (Marked)',   action: 'clear_format' }
];
// Global date format setting
window.currentDateFormat = 'YYYY-MM-DD';

/* ── Global filename format setting ─────────────────────────────────────────
   Controls what suffix or prefix is appended to / prepended to the doc title
   when saving or exporting a file. Default is 'none' (just Title.md).
   Options are defined and labelled in the Settings → Filename format submenu. */
window.filenameFormat = 'none';

/* ── buildExportFilename ─────────────────────────────────────────────────────
   Constructs the final download filename from the document title, the chosen
   extension, and the active window.filenameFormat setting.
   All separators use underscores so the filename is shell-safe.
   @param  {string} baseName  – sanitised doc title (spaces→dashes, lowercase)
   @param  {string} ext       – file extension without the leading dot (md / txt)
   @return {string}           – complete filename including extension            */
function buildExportFilename(baseName, ext) {
  const now  = new Date();
  const pad  = n => String(n).padStart(2, '0');

  const yyyy = now.getFullYear();
  const MM   = pad(now.getMonth() + 1);
  const dd   = pad(now.getDate());
  const hh   = pad(now.getHours());
  const mm   = pad(now.getMinutes());
  const ss   = pad(now.getSeconds());

  /* Pre-built date / time tokens */
  const datePart     = `${yyyy}-${MM}-${dd}`;           // e.g. 2026-04-05
  const dateTimePart = `${yyyy}-${MM}-${dd}_${hh}-${mm}-${ss}`; // e.g. 2026-04-05_14-30-00
  const timePart     = `${hh}-${mm}-${ss}`;             // e.g. 14-30-00
  const compactDate  = `${yyyy}${MM}${dd}`;             // e.g. 20260405

  switch (window.filenameFormat) {
    case 'suffix_date':
      /* Title_YYYY-MM-DD.ext */
      return `${baseName}_${datePart}.${ext}`;
    case 'suffix_datetime':
      /* Title_YYYY-MM-DD_HH-MM-SS.ext */
      return `${baseName}_${dateTimePart}.${ext}`;
    case 'suffix_time':
      /* Title_HH-MM-SS.ext */
      return `${baseName}_${timePart}.${ext}`;
    case 'prefix_date':
      /* YYYY-MM-DD_Title.ext */
      return `${datePart}_${baseName}.${ext}`;
    case 'prefix_compact':
      /* YYYYMMDD_Title.ext  (compact — common in archival workflows) */
      return `${compactDate}_${baseName}.${ext}`;
    case 'none':
    default:
      /* Plain Title.ext — original default behaviour */
      return `${baseName}.${ext}`;
  }
}


// Helper for date formatting
function formatDateString(dateStr, format) {
  const [year, month, day] = dateStr.split('-');
  switch (format) {
    case 'DD/MM/YYYY': return `${day}/${month}/${year}`;
    case 'MM/DD/YYYY': return `${month}/${day}/${year}`;
    case 'Long Date': 
      const dObj = new Date(year, month - 1, day);
      let locale = 'en-US';
      if (window.uiLanguage === 'Swedish') {
        locale = 'sv-SE';
      }
      // Future languages can be easily chained here
      return dObj.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
    case 'YYYY-MM-DD':
    default:
      return `${year}-${month}-${day}`;
  }
}

// ── Action Execution System ────────────────────────────────────────────────

function wrapText(before, after = before, defaultText = "") {
  const start = editor.selectionStart;
  const end   = editor.selectionEnd;
  const selectedText = editor.value.substring(start, end) || defaultText;
  const newText = before + selectedText + after;

  insertWithUndo(start, end, newText);

  /* Re-select the inner content so the user can keep typing over it */
  editor.setSelectionRange(start + before.length, start + before.length + selectedText.length);
  render();
}

function executeAction(action) {
  const d = new Date();
  const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  switch(action) {
     // (cases 'yaml_blog' and 'yaml_llm' have been removed – they were dead code - see the template )

    case 'bold': wrapText('**'); break;
    case 'italic': wrapText('_'); break;
    case 'strike': wrapText('~~'); break;
    case 'heading': wrapText('### ', ''); break;
    case 'code': wrapText('\n\n ```\n', '\n```\n\n', 'code here'); break;
    case 'link': wrapText('[', '](url)', 'link text'); break;
    case 'inline_code': wrapText('`', '`', 'code'); break;
    case 'image': wrapText('![', '](/notebook_thumbnails/timeclock_min.jpg)', 'Placeholder Image'); break;
    case 'task_list': wrapText('- [ ] ', '', 'Task'); break;


    case 'hr': wrapText('\n---\n\n', '', ''); break;
    case 'footnote':
    wrapText('[^1]\n\n[^1]: ', '', 'Footnote description here');
    break;
    case 'insert_date': {
      mdCalViewDate = new Date(); // Reset calendar to current month on open
      renderMdCalendar();
      document.getElementById('date-picker-modal').classList.add('show');
      break;
    }
    case 'file_new': newFile(); break;


    case 'file_import': importFile(); break;
    case 'file_save_as': openSaveAsModal(); break;
    case 'file_export_md': exportFile('md'); break;
    case 'file_export_txt': exportFile('txt'); break;
    case 'file_export_html': exportHtmlFile(); break;
    case 'file_export_pdf': window.exporterOpen('pdf'); break;
    case 'file_export_tex': window.exporterOpen('latex'); break;
    case 'file_zip_export': exportProjectZip(); break;

    case 'table':
      /* Open the native-style table modal instead of unreliable prompt() dialogs */
      document.getElementById('table-modal').classList.add('show');
      document.getElementById('table-cols').focus();
      break;

/* ── Context-menu clipboard actions ───────────────────────────────────
       ctx_copy / ctx_cut  operate on the current textarea selection.
       ctx_paste           inserts at the cursor (or over the selection).

       Security note: navigator.clipboard is async and requires a secure
       context (HTTPS / localhost). The try/catch keeps things safe if the
       API is unavailable or the user denies the permission prompt.        */
    case 'ctx_paste': {
      // Helper to paste text at the current selection (replaces selected text)
      const pasteText = (text) => {
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        if (start !== end) {
          // Replace selected text
          insertWithUndo(start, end, text);
        } else {
          // Insert at cursor
          insertWithUndo(start, start, text);
        }
        render();
        countWords();
      };

      // Modern async clipboard API (requires secure context & user permission)
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.readText()
          .then(text => pasteText(text))
          .catch(err => {
            console.warn('Clipboard read failed (permission or no text):', err);
            // Fallback: use a hidden textarea to read from clipboard (legacy)
            const ta = document.createElement('textarea');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            // Execute paste command into the textarea
            document.execCommand('paste');
            const pasted = ta.value;
            document.body.removeChild(ta);
            if (pasted) pasteText(pasted);
          });
      } else {
        // Insecure context: use legacy execCommand paste
        const ta = document.createElement('textarea');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        const success = document.execCommand('paste');
        const pasted = ta.value;
        document.body.removeChild(ta);
        if (success && pasted) pasteText(pasted);
      }
      break;
    }

    case 'ctx_cut': {
      const cutStart = editor.selectionStart;
      const cutEnd   = editor.selectionEnd;
      const cutSel   = editor.value.substring(cutStart, cutEnd);
      if (!cutSel) break; // Nothing selected

      /* Single-transaction cut (G5 fix):
           1. Confirm the clipboard write succeeds.
           2. Verify the selection still matches what we captured (the
              user may have moved the cursor during an async clipboard
              wait, in which case we leave the document untouched —
              the data is on the clipboard, equivalent to a copy).
           3. Delete in ONE insertWithUndo so a single Ctrl+Z restores. */

      const performDeletion = () => {
        if (editor.selectionStart === cutStart &&
            editor.selectionEnd   === cutEnd   &&
            editor.value.substring(cutStart, cutEnd) === cutSel) {
          insertWithUndo(cutStart, cutEnd, '');
          render();
          countWords();
        }
        /* If the document moved on us, do nothing: clipboard already
           has the data, so the user effectively got a copy. Better
           than deleting the wrong region. */
      };

      const reportClipboardFailure = (logMsg) => {
        console.warn(logMsg);
      if (typeof window.showStatusWarning === 'function') {
          window.showStatusWarning('clipboard',
            'Clipboard permission denied. Nothing was cut.',
            { priority: 30, ttl: 3000 });
        }
      };

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(cutSel)
          .then(performDeletion)
          .catch(() => reportClipboardFailure('navigator.clipboard.writeText rejected.'));
      } else {
        // Insecure-context fallback: legacy synchronous clipboard.
        const ta = document.createElement('textarea');
        ta.value = cutSel;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        let success = false;
        try { success = document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta);

        if (success) {
          // The textarea trick stole focus and selection — restore them
          // so performDeletion's stability check passes.
          editor.focus();
          editor.setSelectionRange(cutStart, cutEnd);
          performDeletion();
        } else {
          reportClipboardFailure('Legacy execCommand("copy") failed.');
        }
      }
      break;
    }
    
    case 'ctx_copy': {
      const copyStart = editor.selectionStart;
      const copyEnd   = editor.selectionEnd;
      const copySel   = editor.value.substring(copyStart, copyEnd);
      if (!copySel) break; // Nothing selected

      // Helper for the legacy synchronous fallback
      const fallbackCopy = (str) => {
        const ta = document.createElement('textarea');
        ta.value = str;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        let success = false;
        try { success = document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta);
        return success;
      };

      // 1. Check if we are in a secure context with the modern API
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(copySel)
          .catch(() => {
            // Alert the user if the API rejects the promise
          if (typeof window.showStatusWarning === 'function') {
          window.showStatusWarning('clipboard',
            'Clipboard permission denied. Copy failed.',
            { priority: 30, ttl: 3000 });
        }
          });
      } else {
        // 2. Insecure context: run the legacy fallback
        if (!fallbackCopy(copySel)) {
          console.warn("Legacy clipboard copy failed.");
        }
      }
      break;
    }

    case 'copy':
      const copyText = editor.value;

      const fallbackCopy = (str) => {
        const ta = document.createElement('textarea');
        ta.value = str;
        ta.style.top = '0'; ta.style.left = '0'; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        let success = false;
        try { success = document.execCommand('copy'); } catch (err) {}
        document.body.removeChild(ta);
        return success;
      };


      const handleFeedback = (success) => {
        if (success) {
          const desktop = btnToolbar.querySelector('.btn-label-desktop');
          const mobile = btnToolbar.querySelector('.btn-label-mobile');
          if (desktop) desktop.textContent = window.t('Copied!');
          if (mobile) mobile.textContent = window.t('Copied!');
          setTimeout(() => {
            if (desktop) desktop.textContent = window.t('Toolbar ▾');
            if (mobile) mobile.textContent = window.t('Tool.');
          }, 1200);
        } else {
          console.warn("Copy MD failed.");
        }
      };

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(copyText)
          .then(() => handleFeedback(true))
          .catch(() => handleFeedback(fallbackCopy(copyText)));
      } else {
        handleFeedback(fallbackCopy(copyText));
      }
      break;

    /* ── List from marked text ──────────────────────────────────────────────
       Splits the selected text on blank lines; each non-empty block
       becomes one list item. Internal line-breaks are collapsed to a space. */
    case 'list_ordered':
    case 'list_unordered': {
      const s = editor.selectionStart;
      const e = editor.selectionEnd;
      const sel = editor.value.substring(s, e);
      if (!sel.trim()) {
        /* Nothing selected — flash the border as a hint */
        editor.style.outline = '1px solid var(--border-md)';
        setTimeout(() => editor.style.outline = '', 700);
        break;
      }
      const ordered = action === 'list_ordered';
      const chunks = sel.split(/\n[ \t]*\n+/).map(c => c.trim()).filter(Boolean);
      const listText = chunks.map((chunk, i) => {
        const line = chunk.replace(/\n+/g, ' ');
        return ordered ? `${i + 1}. ${line}` : `- ${line}`;
      }).join('\n');
      insertWithUndo(s, e, listText);
      render(); countWords();
      break;
    }

    /* ── Clear Format (Marked) ──────────────────────────────────────────────
       Strips all markdown syntax from the selected text while preserving the
       plain text content. Patterns are applied most-specific-first so that,
       e.g., bold-italic (***) is handled before bold (**) or italic (*).    */
    case 'clear_format': {
      const s   = editor.selectionStart;
      const e   = editor.selectionEnd;
      const sel = editor.value.substring(s, e);
      if (!sel.trim()) {
        /* Nothing selected — flash border as a visual hint */
        editor.style.outline = '1px solid var(--border-md)';
        setTimeout(() => editor.style.outline = '', 700);
        break;
      }

      let clean = sel;

      /* Images must come before links (more specific pattern) */
      clean = clean.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
      /* Links */
      clean = clean.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
      /* Bold + Italic: ***text*** or ___text___ */
      clean = clean.replace(/\*{3}([\s\S]+?)\*{3}/g, '$1');
      clean = clean.replace(/_{3}([\s\S]+?)_{3}/g, '$1');
      /* Bold: **text** or __text__ */
      clean = clean.replace(/\*{2}([\s\S]+?)\*{2}/g, '$1');
      clean = clean.replace(/_{2}([\s\S]+?)_{2}/g, '$1');
      /* Italic: *text* or _text_ */
      clean = clean.replace(/\*([\s\S]+?)\*/g, '$1');
      clean = clean.replace(/_([\s\S]+?)_/g, '$1');
      /* Strikethrough: ~~text~~ */
      clean = clean.replace(/~~([\s\S]+?)~~/g, '$1');
      /* Fenced code blocks (```...```) */
      clean = clean.replace(/```[a-z]*\n?([\s\S]*?)```/g, '$1');
      /* Inline code: `text` */
      clean = clean.replace(/`([^`]+)`/g, '$1');
      /* ATX headings: # Heading  →  Heading (per line) */
      clean = clean.replace(/^#{1,6}\s+/gm, '');
      /* Blockquote markers: > text */
      clean = clean.replace(/^>\s*/gm, '');
      /* Task-list checkboxes: - [ ]  or  - [x] */
      clean = clean.replace(/^([-*+]|\d+\.)\s+\[[ xX]\]\s*/gm, '');
      /* Unordered list markers: - / * / + */
      clean = clean.replace(/^[-*+]\s+/gm, '');
      /* Ordered list markers: 1. */
      clean = clean.replace(/^\d+\.\s+/gm, '');
      /* Horizontal rules (standalone lines of ---, ***, ___) */
      clean = clean.replace(/^[-*_]{3,}\s*$/gm, '');

      insertWithUndo(s, e, clean);
      render();
      countWords();
      break;
    }
  }
}


/* ── Table Generator Modal Logic ─────────────────────────────────────────── */
function buildAndInsertTable() {
  const rows = parseInt(document.getElementById('table-rows').value, 10);
  const cols = parseInt(document.getElementById('table-cols').value, 10);
  if (!rows || !cols || isNaN(rows) || isNaN(cols) || rows < 1 || cols < 1) return;

  // Enforce reasonable upper limits (matches HTML input max attributes)
  const MAX_ROWS = 100;
  const MAX_COLS = 20;
  const safeRows = Math.min(rows, MAX_ROWS);
  const safeCols = Math.min(cols, MAX_COLS);

  let table = '\n\n|';
  for (let i = 0; i < safeCols; i++) table += ` Header ${i + 1} |`;
  table += '\n|';
  for (let i = 0; i < safeCols; i++) table += ` --- |`;
  for (let r = 0; r < safeRows; r++) {
    table += '\n|';
    for (let c = 0; c < safeCols; c++) table += ` Cell |`;
  }
  table += '\n\n';

  wrapText(table, '');
  document.getElementById('table-modal').classList.remove('show');
  editor.focus();
}

/* Insert on button click */
document.getElementById('table-btn-insert').addEventListener('click', buildAndInsertTable);

/* Cancel button */
document.getElementById('table-btn-cancel').addEventListener('click', () => {
  document.getElementById('table-modal').classList.remove('show');
  editor.focus();
});

/* Allow Enter key inside the number inputs to confirm */
document.getElementById('table-rows').addEventListener('keydown', e => {
  if (e.key === 'Enter') { buildAndInsertTable(); e.preventDefault(); }
  if (e.key === 'Escape') { document.getElementById('table-modal').classList.remove('show'); editor.focus(); e.preventDefault(); }
});
document.getElementById('table-cols').addEventListener('keydown', e => {
  if (e.key === 'Enter') { buildAndInsertTable(); e.preventDefault(); }
  if (e.key === 'Escape') { document.getElementById('table-modal').classList.remove('show'); editor.focus(); e.preventDefault(); }
});


/* Export function */
async function exportFile(extension = 'md') {
  /* Sanitise the doc title: spaces to dashes, remove illegal OS characters, lowercase */
  let baseName = (docTitle.value.trim() || 'untitled').replace(/\s+/g, '-').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').toLowerCase();
  if (!baseName) baseName = 'untitled';
  /* Apply the active filename format (suffix, prefix, or plain) */
  const filename = buildExportFilename(baseName, extension);
  const mimeType = extension === 'md' ? 'text/markdown' : 'text/plain';
  const content  = editor.value;

  if (window.NativeAPI && (window.NativeAPI.env === 'electron' || window.NativeAPI.env === 'tauri')) {
    try {
      const result = await window.NativeAPI.saveFile(filename, content);
      if (result && result.saved) {
        showSavedIndicator();
      }
      // result.saved === false → user cancelled; intentionally silent.
    } catch (err) {
      console.error('[exportFile] Save failed:', err);
      try {
        await window.NativeAPI.showMessageBox({
          type:    'error',
          title:   'Export Failed',
          message: `Could not save "${filename}".`,
          detail:  String(err && err.message ? err.message : err) +
                   '\n\nYour document is unchanged. Common causes: read-only ' +
                   'destination, disk full, or another program holding the file open.',
          buttons: ['OK'],
          defaultId: 0,
        });
      } catch (dialogErr) {
        // If the dialog itself fails, the console.error above is the only
        // record. Nothing more we can do.
        console.error('[exportFile] Could not show error dialog:', dialogErr);
      }
    }
    return;
  }
  /* ── Tauri / web: blob download (Tauri auto-completes; web keeps old behaviour) ── */
  const blob    = new Blob([content], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: blobUrl, download: filename });
  a.click();

  let revoked = false;
  const revoke = () => {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(blobUrl);
    window.removeEventListener('focus', revoke);
  };
  window.addEventListener('focus', revoke, { once: true });
  setTimeout(revoke, 30000);

  /* Tauri always succeeds (auto-download); web keeps existing behaviour */
  setTimeout(() => showSavedIndicator(), 500);
}

/* ── Zip project export (desktop only) ────────────────────────────────────
   The backend owns the save dialog and reads only inside the project root;
   this side just triggers it and reports the outcome. No password option
   by design — classic zip encryption is broken and would only pretend to
   protect the notes.                                                      */
async function exportProjectZip() {
  const rootPath = (typeof window.sidebarGetRootPath === 'function')
    ? window.sidebarGetRootPath() : null;
  if (!rootPath) {
    await window.NativeAPI.showMessageBox({
      type: 'info',
      title: window.t('Zip Project Export'),
      message: window.t('Open a project folder first.'),
    });
    return;
  }
  /* The archive is built from DISK, but the active file can lag the editor
     by seconds (autosave debounce) — or indefinitely under a save-failure
     cooldown or a "Keep my version" conflict hold. A backup must contain
     the newest edits, so flush them first; if the flush fails, let the
     user decide rather than silently archiving stale bytes. */
  if (typeof window.sidebarIsDirty === 'function' && window.sidebarIsDirty()
      && typeof window.sidebarSaveActiveFile === 'function') {
    const saved = await window.sidebarSaveActiveFile();
    if (!saved) {
      const choice = await window.NativeAPI.showMessageBox({
        type: 'warning',
        title: window.t('Zip Project Export'),
        message: window.t('Your latest changes could not be saved.'),
        detail: window.t('The zip would contain the last saved version of the current file, not what is in the editor.'),
        buttons: [window.t('Export anyway'), window.t('Cancel')],
        defaultId: 1,
        cancelId: 1,
      });
      if (!choice || choice.response !== 0) return;
    }
  }
  try {
    const res = await window.NativeAPI.exportProjectZip();
    if (!res || res.canceled) return; // user backed out of the dialog — silent
    const mb = (res.bytes / (1024 * 1024)).toFixed(1);
    await window.NativeAPI.showMessageBox({
      type: 'info',
      title: window.t('Zip Project Export'),
      message: window.t('Project exported.'),
      detail: `${res.entries} ${window.t('items')} (${mb} MB)\n${res.path}`,
    });
  } catch (err) {
    await window.NativeAPI.showMessageBox({
      type: 'error',
      title: window.t('Zip Project Export'),
      message: window.t('The zip export failed.'),
      detail: String((err && err.message) || err),
    });
  }
}

/* ── HTML Prose Export ────────────────────────────────────────────────────
   Clones the live preview, strips all editor-only artefacts (copy buttons,
   source-map attributes, flash classes, inline-code wrappers), then wraps
   the result in a self-contained HTML document with minimal inline CSS.
   The YAML frontmatter block, if present, is exported as a small metadata
   table above the prose body.                                             */
async function exportHtmlFile() {
  const proseEl = preview.querySelector('.prose');
  if (!proseEl) return; // Nothing rendered yet

  /* ── 1. Clone the prose node so the live DOM is never touched ── */
  const clone = proseEl.cloneNode(true);

  /* Remove code copy buttons injected by postProcessCodeBlocks() */
  clone.querySelectorAll('.code-copy-btn').forEach(btn => btn.remove());

  /* Unwrap inline-code-wrappers: replace the span with its <code> child */
  clone.querySelectorAll('.inline-code-wrapper').forEach(wrapper => {
    const code = wrapper.querySelector('code');
    if (code) {
      wrapper.replaceWith(code);
    } else {
      wrapper.replaceWith(...wrapper.childNodes);
    }
  });

/* Strip source-map data attributes (editor-only metadata) */
  clone.querySelectorAll('[data-sl]').forEach(el => {
    el.removeAttribute('data-sl');
    el.removeAttribute('data-sl-end');
  });

  /* Remove any leftover animation classes */
  clone.querySelectorAll('.preview-flash').forEach(el => el.classList.remove('preview-flash'));

  /* Clean up KaTeX for native MathML rendering in export */
  clone.querySelectorAll('.katex').forEach(katexEl => {
    const mathTag = katexEl.querySelector('math');
    if (mathTag) {
      // KaTeX appends the raw LaTeX string as a direct text node inside <math>.
      // We iterate over direct children to remove only these raw syntax nodes.
      Array.from(mathTag.childNodes).forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
          child.remove(); 
        }
      });
      // Replace the bulky KaTeX wrappers with just the clean, native MathML tag
      katexEl.replaceWith(mathTag);
    }
  });

  /* ── 2. Build an optional YAML metadata table ── */
  let yamlBlock = '';
  const yamlPills = preview.querySelectorAll('.yaml-pill');
  if (yamlPills.length > 0) {
    const rows = Array.from(yamlPills).map(pill => {
      const key = pill.querySelector('.yaml-key')?.textContent ?? '';
      const val = pill.querySelector('.yaml-value')?.textContent ?? '';
      return `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(val)}</td></tr>`;
    }).join('\n      ');
    yamlBlock = `<table class="yaml-meta">\n      ${rows}\n    </table>\n    `;
  }

  /* ── 3. Document title ── */
  const docTitleText = docTitle.value.trim() || 'Untitled';

  /* ── 4. Inline CSS — no external dependencies ── */
  const inlineCSS = `
    :root {
      --bg: #ffffff; --text: #1a1a1a; --text-muted: #6b7280;
      --border: #e5e7eb; --code-bg: #f3f4f6;
      --pre-bg: #1e1e2e; --pre-text: #cdd6f4;
      --link: #2563eb; --accent: #6366f1;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 16px; }
    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 1.125rem; line-height: 1.75;
      color: var(--text); background: var(--bg);
      max-width: 720px; margin: 0 auto; padding: 3rem 2rem 6rem;
    }
    h1, h2, h3, h4, h5, h6 {
      font-family: system-ui, -apple-system, sans-serif;
      font-weight: 700; line-height: 1.25;
      margin-top: 2em; margin-bottom: 0.5em; color: var(--text);
    }
    h1 { font-size: 2.25rem; margin-top: 1rem; }
    h2 { font-size: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 0.25em; }
    h3 { font-size: 1.25rem; }
    h4, h5, h6 { font-size: 1rem; }
    p { margin-bottom: 1.25em; }
    a { color: var(--link); text-decoration: underline; }
    a:hover { text-decoration: none; }
    ul, ol { margin: 0 0 1.25em 1.75em; }
    li { margin-bottom: 0.25em; }
    li > ul, li > ol { margin-top: 0.25em; margin-bottom: 0; }
    blockquote {
      border-left: 4px solid var(--accent); margin: 1.5em 0;
      padding: 0.5em 1.25em; color: var(--text-muted); font-style: italic;
    }
    code {
      font-family: 'Courier New', Courier, monospace; font-size: 0.875em;
      background: var(--code-bg); padding: 0.15em 0.4em;
      border-radius: 3px; color: #d63384;
    }
    pre {
      background: var(--pre-bg); color: var(--pre-text);
      padding: 1.25em 1.5em; border-radius: 6px;
      overflow-x: auto; margin: 1.5em 0; line-height: 1.5;
    }
    pre code {
      background: none; padding: 0; color: inherit;
      font-size: 0.875rem; border-radius: 0;
    }
    table { width: 100%; border-collapse: collapse; margin: 1.5em 0; font-size: 0.95em; }
    th, td { border: 1px solid var(--border); padding: 0.5em 0.75em; text-align: left; }
    th { background: var(--code-bg); font-weight: 600; font-family: system-ui, sans-serif; }
    tr:nth-child(even) td { background: #fafafa; }
    img { max-width: 100%; height: auto; display: block; margin: 1.5em 0; border-radius: 4px; }
    hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
    .yaml-meta { margin-bottom: 2rem; border-radius: 6px; overflow: hidden; font-size: 0.85rem; }
    .yaml-meta th { text-transform: uppercase; font-size: 0.72em; letter-spacing: 0.05em; color: var(--text-muted); width: 1%; white-space: nowrap; }
    input[type="checkbox"] { margin-right: 0.4em; }
    .footnotes { border-top: 1px solid var(--border); margin-top: 3em; padding-top: 1em; font-size: 0.875rem; color: var(--text-muted); }
    .katex-display { overflow-x: auto; }
  `.replace(/^ {4}/gm, ''); // de-indent to keep the file tidy

  /* ── 5. Assemble the full document ── */
  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(docTitleText)}</title>
  <style>${inlineCSS}  </style>
</head>
<body>
  ${yamlBlock}${clone.innerHTML}
</body>
</html>`;

  /* ── 6. Build filename and trigger download (same pattern as exportFile) ── */
  let baseName = (docTitle.value.trim() || 'untitled')
    .replace(/\s+/g, '-')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .toLowerCase();
  if (!baseName) baseName = 'untitled';
  const filename = buildExportFilename(baseName, 'html');

/* ── Electron: native Save dialog gives a guaranteed success/cancel result ── */
if (window.NativeAPI && (window.NativeAPI.env === 'electron' || window.NativeAPI.env === 'tauri')) {
    try {
        const result = await window.NativeAPI.saveFile(filename, fullHtml);
      if (result && result.saved) showSavedIndicator();
    } catch (err) {
      console.error('[exportHtmlFile] Save failed:', err);
    }
    return;
  }

  /* ── Tauri / web: blob download ── */
  const blob    = new Blob([fullHtml], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: blobUrl, download: filename });
  a.click();

  let revoked = false;
  const revoke = () => {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(blobUrl);
    window.removeEventListener('focus', revoke);
  };
  window.addEventListener('focus', revoke, { once: true });
  setTimeout(revoke, 30000);
  setTimeout(() => showSavedIndicator(), 500);
}

/* ── LaTeX Prose Export ────────────────────────────────────────────────────
   Converts the current Markdown document to a minimal but fully compilable
   .tex file.  What is exported:
     • YAML frontmatter  → \title, \author, \date
     • Fenced code blocks → verbatim environments
     • Math $…$ / $$…$$ → passed through unchanged (already LaTeX)
     • Markdown tables   → tabular (labeled table_1, table_2, …)
     • Block images      → figure  (labeled image_1, image_2, …)
     • Headings, lists, blockquotes, bold, italic, strikethrough, footnotes
     • All prose LaTeX special chars are escaped                           */
/* exportLatexFile moved to markdown_editor_export.js (LaTeX project export). */
btnExport.addEventListener('click', () => exportFile('md'));

/* ── File Menu Operations ── */
let pendingFileAction = null;

function newFile() {
  /* Desktop mode: sidebar handles file creation with auto-save — no modal needed */
  if (window.sidebarCreateNewFile) {
    window.sidebarCreateNewFile();
    return;
  }
  /* Web / scratchpad mode: show the export-first modal as before */
  if (editor.value.trim().length > 0) {
    pendingFileAction = 'new';
    document.getElementById('modal-msg').innerText = window.t("Export your work using the \"Export .md\" button. Once the file is safely on your hard drive, click \"Clear Editor\".");
    document.getElementById('new-file-modal').classList.add('show');
  } else {
    executeClear();
  }
}

// Helper to handle the actual clearing of the editor
function executeClear() {
  window.replaceEditorContent('');
  docTitle.value = '';
  try {
    localStorage.removeItem('revery_md_autosave');
  } catch (e) {
    console.warn('Local storage access denied. Could not remove autosave.', e);
  }
}

/* Modal Button Event Listeners */

/* Export button: triggers the download ONLY. Does NOT clear the editor.
   The modal intentionally stays open so the user can verify the file
   landed safely on disk before committing to the destructive clear. */
document.getElementById('modal-btn-export').addEventListener('click', () => {
  exportFile('md');
  // Deliberately does NOT call executeClear() here.
});

/* Clear Editor button: the destructive action, fully decoupled from the
   export. The user clicks this themselves once satisfied. Captured
   pendingFileAction before the clear so import can still proceed. */
document.getElementById('modal-btn-clear').addEventListener('click', () => {
  const savedAction = pendingFileAction;
  executeClear();
  if (savedAction === 'import') {
    executeImport();
  }
  pendingFileAction = null;
  document.getElementById('new-file-modal').classList.remove('show');
});

document.getElementById('modal-btn-cancel').addEventListener('click', () => {
  // Do nothing except close the modal. The user's work is safe.
  pendingFileAction = null;
  document.getElementById('new-file-modal').classList.remove('show');
});


function importFile() {
  /* Desktop mode: sidebar handles import (auto-saves first, copies into folder) */
  if (window.sidebarImportFile) {
    window.sidebarImportFile();
    return;
  }
  /* Web / scratchpad mode: show the export-first modal as before */
  if (editor.value.trim().length > 0) {
    pendingFileAction = 'import';
    document.getElementById('modal-msg').innerText = window.t("Export your work using the \"Export .md\" button. Once the file is safely on your hard drive, click \"Clear Editor\" to proceed with the import.");
    document.getElementById('new-file-modal').classList.add('show');
  } else {
    executeImport();
  }
}

function executeImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.md,.txt';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;

    // Safety constraint: Prevent importing massive files that could crash the browser (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      alert("File is too large. Please select a file under 5MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = event => {
      window.replaceEditorContent(event.target.result);
      docTitle.value = file.name.replace(/\.[^/.]+$/, '');
    };

    reader.onerror = () => alert("An error occurred while reading the file.");
    // Secure reading: only reads raw text data, no execution.
    reader.readAsText(file);
  };
  input.click();
}

/* Ctrl+S Save interception
   In desktop mode (Electron/Tauri), project_sidebar.js owns Ctrl+S when a
   file is open on disk. Only fall back to the browser download export when
   no file is currently open (i.e. the user is in "scratchpad" mode).        */
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    /* Defer to sidebar save if a real file is open on disk */
    if (window.sidebarGetActiveFilePath && window.sidebarGetActiveFilePath()) {
      /* project_sidebar.js handles this via its own keydown listener */
      return;
    }
    exportFile('md');
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'b') { e.preventDefault(); executeAction('bold'); }
  if (e.ctrlKey && e.key.toLowerCase() === 'i') { e.preventDefault(); executeAction('italic'); }

  /* ── Ctrl+E → toggle Reader / Edit mode ── */
  if (e.ctrlKey && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    if (typeof toggleReaderMode === 'function') toggleReaderMode();
  }

  /* ── F11 → toggle native fullscreen (desktop only) ── */
  if (e.key === 'F11') {
    e.preventDefault();
    if (window.NativeAPI && window.NativeAPI.isDesktop &&
        typeof window.NativeAPI.toggleFullscreen === 'function') {
      window.NativeAPI.toggleFullscreen();
    }
  }

  /* ── Escape → exit fullscreen if active ──
     Note: other Escape handlers (find bar, modals) also run because
     they do not call e.stopPropagation(). This is intentional —
     pressing Escape in fullscreen closes any open overlay AND exits
     fullscreen in one gesture.                                       */
  if (e.key === 'Escape' && window.NativeAPI && window.NativeAPI.isFullscreen &&
      typeof window.NativeAPI.exitFullscreen === 'function') {
    window.NativeAPI.exitFullscreen();
  }
});


/* ── Auto-wrapping Syntax Pairs ── */
const autoWrapPairs = {
  '"': '"',
  "'": "'",
  '(': ')',
  '[': ']',
  '{': '}',
  '*': '*',
  '_': '_',
  '`': '`',
  '~': '~'
};

// Tab and auto-wrap pairs are now handled by the CM keymap in markdown_editor_cm_setup.js





/* ── Custom Calendar Logic for Insert Date ────────────────────────────────── */
let mdCalViewDate = new Date();
const MD_DAYS_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];
function getMonthNames() {
  if (window.uiLanguage === 'Swedish') {
    return ['Januari','Februari','Mars','April','Maj','Juni','Juli','Augusti','September','Oktober','November','December'];
  }
  return ['January','February','March','April','May','June','July','August','September','October','November','December'];
}

function renderMdCalendar() {
  const calEl = document.getElementById('md-cal');
  if (!calEl) return;
  
  const yr = mdCalViewDate.getFullYear();
  const mo = mdCalViewDate.getMonth();
  const firstDow = new Date(yr, mo, 1).getDay();
  const daysInMo = new Date(yr, mo + 1, 0).getDate();
  const today = new Date();


  calEl.innerHTML =
      '<div class="md-cal-nav">' +
        '<button class="md-cal-nav-btn" id="md-cal-prev">&#8249;</button>' +
        '<span class="md-cal-month-label">' + getMonthNames()[mo] + ' ' + yr + '</span>' +
        '<button class="md-cal-nav-btn" id="md-cal-next">&#8250;</button>' +
      '</div>' +
      '<div class="md-cal-grid" id="md-cal-grid"></div>';

  const grid = calEl.querySelector('#md-cal-grid');

  MD_DAYS_SHORT.forEach(d => {
      const el = document.createElement('div');
      el.className = 'md-cal-dow';
      el.textContent = d;
      grid.appendChild(el);
  });




for (let i = 0; i < firstDow; i++) {
      const blank = document.createElement('div');
      blank.className = 'md-cal-day md-other';
      blank.innerHTML = '&nbsp;'; // Prevents row height collapse
      grid.appendChild(blank);
  }

  for (let d = 1; d <= daysInMo; d++) {
      const el = document.createElement('div');
      el.className = 'md-cal-day';
      el.textContent = d;
      
      const isToday = today.getFullYear() === yr && today.getMonth() === mo && today.getDate() === d;
      if (isToday) el.classList.add('md-today');
      
      el.addEventListener('click', () => {
          // Format standard YYYY-MM-DD
          const pad = (n) => String(n).padStart(2, '0');
          const dateStr = `${yr}-${pad(mo + 1)}-${pad(d)}`;
          
          const formatted = formatDateString(dateStr, window.currentDateFormat);
          insertWithUndo(editor.selectionStart, editor.selectionEnd, formatted);
          render();
          countWords();
          
          document.getElementById('date-picker-modal').classList.remove('show');
      });
      grid.appendChild(el);
  }

  // Add trailing empty cells to ensure a fixed 6-row calendar (6 * 7 = 42 cells)
  const totalCells = 42;
  const trailingCells = totalCells - (firstDow + daysInMo);
  for (let i = 0; i < trailingCells; i++) {
      const blank = document.createElement('div');
      blank.className = 'md-cal-day md-other';
      blank.innerHTML = '&nbsp;'; // Prevents row height collapse
      grid.appendChild(blank);
  }



calEl.querySelector('#md-cal-prev').addEventListener('click', () => { mdCalViewDate = new Date(yr, mo - 1, 1); renderMdCalendar(); });
  calEl.querySelector('#md-cal-next').addEventListener('click', () => { mdCalViewDate = new Date(yr, mo + 1, 1); renderMdCalendar(); });
}

// Bind modal cancel button
document.getElementById('cal-btn-cancel').addEventListener('click', () => {
  document.getElementById('date-picker-modal').classList.remove('show');
});

/* ── Quit / Exit Workflow Logic ─────────────────────────────────────────── */
function openQuitModal() {
  const modal = document.getElementById('quit-modal');
  const step1 = document.getElementById('quit-step-1');
  const step2 = document.getElementById('quit-step-2');
  const title = document.getElementById('quit-modal-title');
  const msg = document.getElementById('quit-modal-msg');

  title.innerText = window.t('Quit Editor');
  
  // If there's text, ask if they want to save first
  if (editor.value.trim().length > 0) {
    msg.innerText = window.t('Do you want to export your current work before quitting? Unsaved text will be lost.');
    step1.style.display = 'flex';
    step2.style.display = 'none';
  } else {
    // If it's completely empty, jump straight to the Engine Stopped state
    showQuitStep2();
  }
  
  modal.classList.add('show');
}

function showQuitStep2() {
  // Turn off the "engine" safety net
  window.isQuitting = true; 
  
  document.getElementById('quit-modal-title').innerText = window.t('Engine Stopped');
  document.getElementById('quit-modal-msg').innerText = window.t('The editor engine has been safely shut down. What would you like to do next?');
  document.getElementById('quit-step-1').style.display = 'none';
  document.getElementById('quit-step-2').style.display = 'flex';
  
}

// Hook up Step 1 buttons
document.getElementById('quit-btn-save')?.addEventListener('click', async () => {
  await exportFile('md');
  showQuitStep2();
});

document.getElementById('quit-btn-nosave')?.addEventListener('click', () => {
  showQuitStep2();
});


document.getElementById('quit-btn-cancel')?.addEventListener('click', () => {
  window.isQuitting = false; // ← Restore the safety net if user cancels mid-flow
  document.getElementById('quit-modal').classList.remove('show');
});


// Hook up Step 2 buttons
document.getElementById('quit-btn-restart')?.addEventListener('click', () => {
  // Resume the editor with data intact
  window.isQuitting = false; // Restore the beforeunload safety net
  document.getElementById('quit-modal').classList.remove('show');
});

document.getElementById('quit-btn-total-reset')?.addEventListener('click', async () => {
  // Prevent the beforeunload warning while we reset
  window.isQuitting = true;

  // Remove the in-memory editor settings stored under localStorage. These
  // exist on every backend (web, Electron, Tauri) and are safe to clear.
  try {
    localStorage.removeItem('revery_md_autosave');
    localStorage.removeItem('revery_md_settings');
  } catch (e) {
    console.warn('Local storage access denied. Could not fully reset before restart.', e);
  }

  if (window.NativeAPI && typeof window.NativeAPI.clearAllSettings === 'function') {
    try {
      await window.NativeAPI.clearAllSettings();
    } catch (e) {

      console.error('Total Reset: clearAllSettings failed:', e);
      window.isQuitting = false;
      try {
        await window.NativeAPI.showMessageBox({
          type: 'error',
          title: 'Reset Failed',
          message: 'Could not clear all settings.',
          detail: String(e) + '\n\nYour data is unchanged. Try again, or check the app data folder permissions.',
          buttons: ['OK'],
          defaultId: 0,
        });
      } catch { /* dialog itself failed — nothing more we can do */ }
      return;
    }
  }

  // Reload the page – everything will be reinitialised to factory defaults
  window.location.reload();
});

// ── ADD THIS NEW BLOCK ──
document.getElementById('quit-btn-leave')?.addEventListener('click', () => {

  if (window.NativeAPI && window.NativeAPI.isDesktop
      && typeof window.sidebarHandleClose === 'function'
      && typeof window.sidebarGetActiveFilePath === 'function'
      && window.sidebarGetActiveFilePath()) {
    window.isQuitting = false;
    document.getElementById('quit-modal').classList.remove('show');
    Promise.resolve(window.sidebarHandleClose()).catch(err =>
      console.error('[Quit] Unified close failed:', err));
    return;
  }

  window.isQuitting = true;

  // No file open (scratchpad) — the user already chose export / don't-export
  // in Step 1, so a direct close is the intended behavior here.
  if (window.NativeAPI && window.NativeAPI.isDesktop && typeof window.NativeAPI.confirmClose === 'function') {
    window.NativeAPI.confirmClose();
  } else {
    // Fallback for web mode (#15: '/notebook.html' was a dead URL — 404)
    window.location.href = './index.html';
  }
});

/* ── Save As Modal Logic ─────────────────────────────────────────────────── */
function openSaveAsModal() {
  const modal = document.getElementById('save-as-modal');
  const input = document.getElementById('save-as-filename');
  
  /* Pre-fill with the sanitized current title, stripping illegal OS characters */
  let baseName = (docTitle.value.trim() || 'untitled').replace(/\s+/g, '-').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').toLowerCase();
  if (!baseName) baseName = 'untitled';
  input.value = baseName;
  
  modal.classList.add('show');
  const saveAsMsg = modal.querySelector('p');
  if (saveAsMsg) saveAsMsg.textContent = window.t('Enter filename (will be saved as .md):');
  input.focus();
  input.select();
}

async function executeSaveAs() {
  const input = document.getElementById('save-as-filename');
  let rawName = input.value.trim();
  
  /* OS-safe sanitization: Strip illegal filesystem characters but preserve international letters */
  let safeName = rawName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '');
  if (!safeName) safeName = 'untitled';
  
  /* Bypass filenameFormat settings, just append .md */
  const filename = `${safeName}.md`;
  

/* ── Electron / Tauri: native Save dialog gives a guaranteed success/cancel result ── */
if (window.NativeAPI && (window.NativeAPI.env === 'electron' || window.NativeAPI.env === 'tauri')) {
    try {

      const result = await window.NativeAPI.saveFile(filename, editor.value, { updateRoot: true });
      if (result && result.saved) {
        showSavedIndicator();
        document.getElementById('save-as-modal').classList.remove('show');
        editor.focus();
        
        // Pivot the app state if the backend returned the new file path
        if (result.filePath && typeof window.sidebarPivotToNewFile === 'function') {
          await window.sidebarPivotToNewFile(result.filePath, result.newRootPath);
        }
      }
      /* If cancelled, leave the modal open so the user can try again */
    } catch (err) {
      console.error('[executeSaveAs] Save failed:', err);
    }
    return;
  }
  /* ── Web: blob download ── */
  const blob = new Blob([editor.value], { type: 'text/markdown' });
  const blobUrl = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: blobUrl, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

  showSavedIndicator();
  document.getElementById('save-as-modal').classList.remove('show');
  editor.focus();
}
/* Event Listeners for the Modal */
document.getElementById('save-as-btn-confirm').addEventListener('click', executeSaveAs);

document.getElementById('save-as-btn-cancel').addEventListener('click', () => {
  document.getElementById('save-as-modal').classList.remove('show');
  editor.focus();
});

/* Keyboard support: Enter to confirm, Esc to close */
const saveAsInput = document.getElementById('save-as-filename');

/* CSP-compliant focus/blur styling */
saveAsInput.addEventListener('focus', () => {
  saveAsInput.style.borderColor = 'var(--accent)';
});

saveAsInput.addEventListener('blur', () => {
  saveAsInput.style.borderColor = 'var(--border-md)';
});

/* Keyboard support: Enter to confirm, Esc to close */
saveAsInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { 
    executeSaveAs(); 
    e.preventDefault(); 
  }
  if (e.key === 'Escape') { 
    document.getElementById('save-as-modal').classList.remove('show'); 
    editor.focus(); 
    e.preventDefault(); 
  }
});