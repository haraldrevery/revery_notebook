// editor-core.js (no highlight.js)
// ── Markdown-it setup  ──────────────────────────────────────────────────────
/* 
const md = window.markdownit({ html: false, linkify: true, typographer: true, breaks: false });
md.use(window.markdownitFootnote); 
*/




// editor-core.js (with highlight.js)
// ── Markdown-it setup start ──────────────────────────────────────────────────────
const md = window.markdownit({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value;
      } catch (__) {}
    }
    return ''; // use external default escaping
  }
});
md.use(window.markdownitFootnote);

// ── Markdown-it setup end ──────────────────────────────────────────────────────





// Safely initialize the texmath (KaTeX) plugin if it loaded correctly.
if (typeof texmath !== 'undefined' && typeof katex !== 'undefined') {
  md.use(texmath, {
    engine: katex,
     // Supports $$...$$ and $...$ (dollars) AND \[...\] and \(...\) (brackets)
    delimiters: ['dollars', 'brackets'],
    katexOptions: { throwOnError: false },
    strict: false          // ← allows spaces around math content
  });
}


/* ── Force preview images to fill the prose container width (this is and odd thing... ducktape solution for image renderer) ── */
const defaultImageRenderer = md.renderer.rules.image;
md.renderer.rules.image = function (tokens, idx, options, env, self) {
  tokens[idx].attrSet('class', 'preview-image-full');
  
  // Add data-src to safely pass paths (like C:/ or asset://) through DOMPurify
  const src = tokens[idx].attrGet('src');
  if (src) {
    tokens[idx].attrSet('data-src', src);
  }
  
  return defaultImageRenderer(tokens, idx, options, env, self);
};

/* ── Resolve a relative path against a base directory ─────────────────────
   Handles ../ traversal correctly on both Unix and Windows paths.          */
function resolveRelPath(baseDir, relPath) {
  // Normalise separators
  baseDir = baseDir.replace(/\\/g, '/').replace(/\/$/, '');
  relPath = relPath.replace(/\\/g, '/');
  if (!relPath || relPath.startsWith('http') || relPath.startsWith('data:')
      || relPath.startsWith('file:') || relPath.startsWith('asset:')) {
    return relPath; // already absolute/URL — leave untouched
  }
  if (relPath.startsWith('/')) return relPath; // absolute Unix path
  if (/^[a-zA-Z]:\//.test(relPath)) return relPath; // absolute Windows path

  const parts = baseDir.split('/');


  for (const seg of relPath.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/**
 * postProcessImages() — called after every render().
 *
 * Walks every <img> in the preview pane.  For images with a relative src
 * (i.e. anything that is NOT already an absolute URL or data URI) it:
 *   1. Resolves the path against the currently active file's directory
 *      (or rootPath as a fallback when no file is open).
 *   2. Converts the absolute filesystem path to a URL the webview can load:
 *        Electron → file:// URL
 *        Tauri    → asset:// URL via window.__TAURI__.core.convertFileSrc
 *
 * This fixes the Tauri "no images" bug (images resolve against tauri://localhost,
 * not the filesystem) and the Electron "absolute-path-only" bug.
 */
/* `root` defaults to the preview pane; live preview passes its own
   rendered block so both surfaces share one pipeline. */
/* ── YAML "Properties" pill box ─────────────────────────────────────────
   Shared by the classic preview (render() above) and the live preview's
   frontmatter widget (markdown_editor_livepreview.js), so both surfaces
   render YAML identically. `baseOffset` = doc offset of the first
   frontmatter line (keeps the pills' data-start/data-end source map).
   All keys/values pass through escapeHtml — frontmatter is untrusted. */
function buildYamlRenderHtml(yamlContent, baseOffset) {
  let pills = '';
  let lineStart = baseOffset;

  yamlContent.split('\n').forEach(line => {
    const parts = line.split(':');
    if (parts.length >= 2) {
      const key = escapeHtml(parts[0].trim());
      const val = escapeHtml(parts.slice(1).join(':').trim());
      const startChar = lineStart;
      const endChar   = lineStart + line.length;
      pills += `<div class="yaml-pill" data-start="${startChar}" data-end="${endChar}"><span class="yaml-key">${key}:</span><span class="yaml-value">${val}</span></div>`;
    }
    lineStart += line.length + 1; // +1 for the newline character
  });

  if (!pills) return '';
  const propertiesLabel = window.t('Properties');
  return `<div class="yaml-render"><div class="yaml-render-title">${propertiesLabel}</div><div class="yaml-pill-container">${pills}</div></div>`;
}

function postProcessImages(root) {
  root = root || preview;
  if (!window.NativeAPI || !window.NativeAPI.isDesktop) return;

  // Determine the base directory for resolving relative image paths.
  const activePath =
    (typeof window.sidebarGetActiveFilePath === 'function')
      ? window.sidebarGetActiveFilePath()
      : null;
  const rootPath =
    (typeof window.sidebarGetRootPath === 'function')
      ? window.sidebarGetRootPath()
      : null;

  const baseDir = activePath
    ? activePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
    : (rootPath || '').replace(/\\/g, '/');

  if (!baseDir) return; // nothing to resolve against

    root.querySelectorAll('img').forEach(img => {
    // Rely on data-src first, as DOMPurify may have stripped the original src
    let src = img.getAttribute('data-src') || img.getAttribute('src');
    if (!src) return;
    // Skip anything that is already an absolute URL or data URI
    if (/^(https?:|data:|file:|asset:|tauri:)/.test(src)) return;
    /* Markdown link destinations are percent-encoded (spaces, non-ASCII —
       both ours via mediaMarkdown and markdown-it's own normalization).
       Decode to the real on-disk name BEFORE resolving, or the wrappers
       would look for a literal "%20" file (Tauri's asset protocol would
       even double-encode it). Undecodable %-sequences stay raw. */
    try { src = decodeURIComponent(src); } catch (_) { /* keep raw */ }
    const absolutePath = resolveRelPath(baseDir, src);

    // ── Root-containment guard ─────────────────────────────────────────
    // Reject any resolved path that escapes the project root.
    // Tauri is already protected by the asset-protocol scope, but Electron
    // serves unrestricted file:// URLs so we must enforce this ourselves.
    if (rootPath) {
      const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/$/, '');
      const normalizedAbs  = absolutePath.replace(/\\/g, '/');
      if (!normalizedAbs.startsWith(normalizedRoot + '/') &&
           normalizedAbs !== normalizedRoot) {
        return; // Path escapes project root — skip this image
      }
    } else {
      // No project root known — cannot verify containment, skip to be safe.
      return;
    }
    // ──────────────────────────────────────────────────────────────────

    img.src = window.NativeAPI.toMediaUrl(absolutePath);
  });
}



/* ── image thing breaks here, but also can't risk exploits... ── */
const _safeSchemes = ['http:', 'https:', 'mailto:', 'ftp:'];
const _dangerousSchemes = ['javascript:', 'data:', 'vbscript:'];

function sanitizeUrl(url) {
  if (!url) return '';
  // Strip leading control characters (ASCII 0–31, 127) and spaces
  let cleaned = url.replace(/^[\x00-\x20\x7F]+/, '');
  if (!cleaned) return '';

  const schemeMatch = cleaned.match(/^([a-z][a-z0-9+\-.]*):/i);
  if (!schemeMatch) {
    // No scheme → relative URL, safe to return as is
    return cleaned;
  }

  const scheme = schemeMatch[1].toLowerCase() + ':';
  if (_safeSchemes.includes(scheme)) {
    return cleaned;
  }
  if (_dangerousSchemes.includes(scheme)) {
    return ''; // reject dangerous schemes
  }
  // Unknown scheme (tel:, magnet:, etc.) – allow
  return cleaned;
}

md.normalizeLink = sanitizeUrl;
md.validateLink = (url) => sanitizeUrl(url) !== '';










/* ── Preview→Editor source-map ... ── */
md.core.ruler.push('source_map', function (state) {
  state.tokens.forEach(function (token) {
    if (token.map && token.level === 0) {
      token.attrSet('data-sl',     String(token.map[0]));
      token.attrSet('data-sl-end', String(token.map[1]));
    }
  });
});

// ── DOM References ─────────────────────────────────────────────────────────
// editor is now window.editor (the CM shim defined in markdown_editor_cm_setup.js)
const preview   = document.getElementById('preview');
const empty     = document.getElementById('preview-empty');
const wordcount = document.getElementById('wordcount');
const sizeWarning = document.getElementById('size-warning');
const _statusSlots = new Map(); // name → { text, priority, timer }

function _renderStatusWarning() {
  if (!sizeWarning) return;
  let top = null;
  for (const slot of _statusSlots.values()) {
    if (!top || slot.priority > top.priority) top = slot;
  }
  if (top) {
    sizeWarning.textContent  = top.text;   // textContent only — no HTML injection
    sizeWarning.style.display = 'inline';
  } else {
    sizeWarning.textContent  = '';
    sizeWarning.style.display = 'none';
  }
}

function showStatusWarning(name, text, opts) {
  const { priority = 0, ttl = 0 } = opts || {};
  const existing = _statusSlots.get(name);
  if (existing && existing.timer) clearTimeout(existing.timer);
  const slot = { text, priority, timer: null };
  if (ttl > 0) {
    slot.timer = setTimeout(() => {
      _statusSlots.delete(name);
      _renderStatusWarning();
    }, ttl);
  }
  _statusSlots.set(name, slot);
  _renderStatusWarning();
}

function clearStatusWarning(name) {
  const existing = _statusSlots.get(name);
  if (existing && existing.timer) clearTimeout(existing.timer);
  _statusSlots.delete(name);
  _renderStatusWarning();
}

window.showStatusWarning  = showStatusWarning;
window.clearStatusWarning = clearStatusWarning;
const docTitle  = document.getElementById('doc-title');
const btnExport = document.getElementById('btn-export');
const btnToolbar= document.getElementById('btn-toolbar');
const toolbarDropdown = document.getElementById('toolbar-dropdown');
const contextMenu= document.getElementById('context-menu');
const btnView   = document.getElementById('btn-toggle-view');
const divider   = document.getElementById('divider');
const edPane    = document.getElementById('editor-pane');
const prPane    = document.getElementById('preview-pane');
const workspace = document.getElementById('workspace');
const html      = document.documentElement;

/* ── Debounce state ── */
let renderDelay = 50;   // ms — adjustable via Settings → CPU save delay
let renderTimer = null;

/* ── HTML Escaping Helper ── */
function escapeHtml(unsafe) {
  return (unsafe || '')
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ── Render & YAML parsing ── */
function render() {
  /* ── Non-text file selected in sidebar — show a placeholder message ── */
  if (window._showingUnsupportedFile) {
    if (preview.contains(empty)) preview.removeChild(empty);
    preview.innerHTML =
      '<div class="prose prose-lg max-w-none mx-auto" style="padding-top:2rem">' +
      '<p style="color:var(--text-muted,#888);font-style:italic">' +
      'Non-supported file format.<br>' +
      'This file type cannot be opened in the editor. ' +
      'You can still move, rename, or delete it from the file navigator.' +
      '</p></div>';
    return;
  }

  let raw = editor.value;
  if (!raw.trim()) { preview.innerHTML = ''; preview.appendChild(empty); return; }
  if (preview.contains(empty)) preview.removeChild(empty);

  let yamlHtml = '';
  // Check for YAML Frontmatter
  const yamlMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (yamlMatch) {
    // Shared builder — the live preview renders the SAME pill box.
    yamlHtml = buildYamlRenderHtml(yamlMatch[1], raw.indexOf('\n') + 1);
    raw = raw.replace(yamlMatch[0], ''); // Remove from MD parsing
  }

let rendered = '';
  try {
    rendered = md.render(raw);
    
    // Sanitize the rendered markdown output to prevent XSS
    if (window.DOMPurify) {
      rendered = window.DOMPurify.sanitize(rendered, {
        // Explicitly allow your custom scroll-sync data attributes and original image paths
        ADD_ATTR: ['data-sl', 'data-sl-end', 'data-src']
      });
    } else {
      console.warn("DOMPurify not loaded. Relying strictly on markdown-it escaping.");
    }
} catch (err) {
    console.error("Markdown rendering failed:", err);
    rendered = `<div class="render-error-message"><strong>Render Error:</strong> ${escapeHtml(err.message)}</div>`;
  }







  
/* FIX: Cache the scroll position before wiping the DOM.
     When innerHTML is completely replaced, browsers natively reset
     the container's scrollTop to 0. KaTeX equations are highly nested,
     making this layout collapse extremely jarring. */
  const currentScroll = preview.scrollTop;

  preview.innerHTML = yamlHtml + '<div class="prose prose-lg max-w-none mx-auto">' + rendered + '</div>';

  /* FIX: Restore the scroll position immediately after DOM insertion */
  preview.scrollTop = currentScroll;

 renderOutline();        // Keep the outline in sync with the document
  
  postProcessCodeBlocks(); // Inject copy buttons into code blocks
  postProcessImages();     // Fix local image paths for Electron / Tauri
}



/* ── Code block copy buttons ──────────────────────────────────────────────
   Called after every render(). Injects a "Copy" button into each block-
   level <pre> and each inline <code> element in the preview pane.
   For block code the button sits in the upper-right corner of the <pre>.
   For inline code a wrapper span is used so the button can be positioned
   above the snippet without disturbing text flow.                         */
/* `root` defaults to the preview pane; live preview passes its own
   rendered block so both surfaces share one pipeline. */
function postProcessCodeBlocks(root) {
  root = root || preview;
  /* ── 1. Block code (pre > code) ── */
  root.querySelectorAll('pre').forEach(pre => {
    /* Skip if this pre already has a copy button (e.g. after a re-render
       that reused the same DOM node — shouldn't happen but guards against it) */
    if (pre.querySelector('.code-copy-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.title = 'Copy code to clipboard';

    btn.addEventListener('click', e => {
      /* Prevent the preview→editor click-to-sync handler from firing */
      e.stopPropagation();
      const codeEl = pre.querySelector('code');
      const text   = codeEl ? codeEl.innerText : pre.innerText;
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
        btn.classList.add('is-copied');
        setTimeout(() => btn.classList.remove('is-copied'), 1600);
      } else {
        console.warn("Copy failed.");
        // Optionally trigger a visual error state here if you add one to CSS
      }
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
        .then(() => handleFeedback(true))
        .catch(() => handleFeedback(fallbackCopy(text)));
    } else {
      handleFeedback(fallbackCopy(text));
    }

      
    });

    pre.appendChild(btn);
  });

  /* ── 2. Inline code (code NOT inside a pre) ── */
  root.querySelectorAll('code').forEach(code => {
  /* Skip block code and already-wrapped inline code */
  if (code.closest('pre'))                   return;
  if (code.closest('.inline-code-wrapper'))  return;

  /* Wrap the <code> in a span so we can absolutely-position the button */
  const wrapper = document.createElement('span');
  wrapper.className = 'inline-code-wrapper';
  code.parentNode.insertBefore(wrapper, code);
  wrapper.appendChild(code);

  const btn = document.createElement('button');
  btn.className = 'code-copy-btn';
  btn.title = 'Copy to clipboard';

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const text = code.innerText;

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
        /* Same class-toggle pattern — avoids characterData mutations that
           would trigger the scroll-sync observer in editor-sync.js.      */
        btn.classList.add('is-copied');
        setTimeout(() => { btn.classList.remove('is-copied'); }, 1600);
      } else {
        console.warn("Inline code copy failed.");
      }
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
        .then(() => handleFeedback(true))
        .catch(() => handleFeedback(fallbackCopy(text)));
    } else {
      handleFeedback(fallbackCopy(text));
    }
  });

  wrapper.appendChild(btn);
});
}


/* ── Word count ── */
function countWords() {
  const txt = editor.value.trim();
  
  // Update word count
  if (!txt) { 
    wordcount.textContent = '0 words'; 
  } else {
    const w = txt.split(/\s+/).filter(Boolean).length;
    const wordLabel = w === 1 ? window.t('word') : window.t('words');
    wordcount.textContent = w.toLocaleString() + ' ' + wordLabel;
  }

  // Check file size limit (5MB) to warn user before localStorage fails
    if (sizeWarning) {
    // new Blob(...).size reliably gets the byte size (UTF-8) of the string
    const byteSize = new TextEncoder().encode(editor.value).length;
    const limitBytes = 5 * 1024 * 1024; // 5MB
    const thresholdBytes = limitBytes * 0.9; // 90% of 5MB (4.5MB)
    
    if (byteSize >= thresholdBytes) {
      showStatusWarning('filesize',
        'File is over 4.5MB in size, be aware of a 5MB max limit due to data losses!',
        { priority: 50 }); // sticky while the document stays large
    } else {
      clearStatusWarning('filesize'); // clears ONLY this slot, not others
    }
  }
}

/* ── Save Indicator ───────────────────────────────────────────────────────
   Briefly replaces the word counter with a green "File saved" message,
   then restores the normal word count after 2 seconds.                    */
let savedIndicatorTimer = null;
function showSavedIndicator() {
  /* Cancel any previous timer so rapid saves don't stack */
  clearTimeout(savedIndicatorTimer);
  // Temporarily ensure word counter is visible to show the saved message
  const wasHidden = wordcount.style.display === 'none';
  if (wasHidden) {
    wordcount.style.display = '';
  }
  wordcount.textContent = window.t('File saved');
  wordcount.style.color  = '#22c55e'; /* green-500 */
  savedIndicatorTimer = setTimeout(() => {
    wordcount.style.color = '';
    countWords();
    // Restore the word counter visibility based on user setting
    applyWordCountVisibility();
  }, 2000);
}

/* ── Outline Navigation ───────────────────────────────────────────────────
   Parses all ATX headings (# through ######) from the raw markdown and
   populates the #outline-nav panel. YAML frontmatter lines are skipped.
   Each item is indented by heading level so hierarchy is visually clear.  */
function renderOutline() {
  const outlineNav = document.getElementById('outline-nav');
  if (!outlineNav) return;

/* Only update the DOM when the pane is actually visible — avoids
     layout work when the outline is hidden.                          */
  const outlinePane = document.getElementById('outline-pane');
  const isMobileOpen = document.body.classList.contains('mobile-outline-open');
  if (!outlinePane || (!isMobileOpen && outlinePane.style.display === 'none')) return;

  const raw = editor.value;
  
  // Prevent expensive O(n) line scans and DOM rebuilds if text hasn't changed
  if (window.lastOutlineRaw === raw) return;
  window.lastOutlineRaw = raw;

  const lines = raw.split('\n');

  /* Determine how many lines are consumed by YAML frontmatter so we
     can compute the correct raw-editor line index for scrolling.    */
  let yamlLineCount = 0;
  const yamlMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---/);

  if (yamlMatch) {
    yamlLineCount = (yamlMatch[0].match(/\n/g) || []).length;
  }
  const startLine = yamlLineCount; // first content line index

  /* Collect all ATX headings with their raw editor line index */
  const headers = [];
  for (let i = startLine; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headers.push({ level: match[1].length, text: match[2].trim(), lineIndex: i });
    }
  }

  // Create a signature of the current headings to avoid destroying the DOM if nothing changed structurally
  const currentSignature = headers.map(h => `${h.level}:${h.text}`).join('|');
  if (window.lastOutlineSignature === currentSignature) {
    // Only update line indices to prevent UI flickering/blinking
    const buttons = outlineNav.querySelectorAll('.outline-item');
    if (buttons.length === headers.length) {
      headers.forEach((h, i) => {
        buttons[i].dataset.line = h.lineIndex;
      });
      updateActiveOutline();
      return;
    }
  }
  window.lastOutlineSignature = currentSignature;

  /* Rebuild the outline panel contents */
  outlineNav.innerHTML = '';

  if (headers.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'outline-empty';
    empty.textContent = window.t('No headings');
    outlineNav.appendChild(empty);
    return;
  }

  headers.forEach(h => {
    const btn = document.createElement('button');
    btn.className = 'outline-item outline-h' + h.level;
    btn.textContent = h.text;
    btn.title = h.text; // tooltip for long headings that overflow
    btn.dataset.line = h.lineIndex; // Link the button to the source line
    btn.addEventListener('click', () => scrollToHeading(h.lineIndex));
    outlineNav.appendChild(btn);
  });
  
  // Trigger highlight check to select the active section immediately
  updateActiveOutline();
}

/* ── scrollToHeading ──────────────────────────────────────────────────────
   Given a raw editor line index, scrolls both the editor textarea and the
   preview pane to that heading, selects it in the editor, and flashes the
   matching preview element for visual feedback.                           */
function scrollToHeading(lineIndex) {
  const raw   = editor.value;
  const lines = raw.split('\n');

  /* ── 1. Select the heading in the editor ── */
  let charStart = 0;
  for (let i = 0; i < lineIndex && i < lines.length; i++) {
    charStart += lines[i].length + 1; // +1 for the \n
  }
  const charEnd = charStart + (lines[lineIndex] ? lines[lineIndex].length : 0);

  /* Live preview: the outline must NAVIGATE, not edit — selecting the
     heading would flip its rendered block to raw markdown, and the
     ratio-scroll below is meaningless against rendered block heights.
     Scroll precisely via CM and leave selection and focus untouched.
     ONLY when the editor is the visible surface: in Reader mode (and the
     mobile Preview view) the editor is hidden and the PREVIEW must
     scroll — fall through to the classic path for those.              */
  if (document.body.classList.contains('live-preview-active')
      && !document.body.classList.contains('reader-mode-active')
      && document.body.dataset.view !== 'preview'
      && window.cmView && window.CM && CM.EditorView) {
    window.cmView.dispatch({
      effects: CM.EditorView.scrollIntoView(charStart, { y: 'start', yMargin: 60 }),
    });
    /* Highlight the clicked section immediately, same as the classic
       path does via the preview scroll. */
    window.isNavigatingOutline = true;
    clearTimeout(window.outlineNavTimer);
    window.outlineNavTimer = setTimeout(() => { window.isNavigatingOutline = false; }, 300);
    updateActiveOutline(lineIndex);
    return;
  }

  /* Scroll editor so the heading sits near the top of the viewport */
  const totalLines  = lines.length || 1;
  const scrollRatio = lineIndex / totalLines;
  editor.scrollTop  = Math.max(0, editor.scrollHeight * scrollRatio - editor.clientHeight * 0.12);
  editor.focus();
  editor.setSelectionRange(charStart, charEnd);

  /* ── 2. Scroll the preview to the matching block ── */
  /* Convert raw editor line → markdown-it source-map line (subtract YAML) */
  let yamlOffset = 0;
      const yamlMatch = editor.value.match(/^---\r?\n[\s\S]*?\r?\n---/);

  if (yamlMatch) {
    yamlOffset = (yamlMatch[0].match(/\n/g) || []).length;
  }
  const mdLine = Math.max(0, lineIndex - yamlOffset);

  /* Find the preview block whose data-sl most closely matches mdLine.
     Headings always get their own block token, so this will be exact. */
  const blocks = Array.from(preview.querySelectorAll('[data-sl]'));
  let targetBlock = null;
  for (const block of blocks) {
    const sl = parseInt(block.getAttribute('data-sl'), 10);
    if (sl === mdLine) { targetBlock = block; break; }
    if (sl <= mdLine)    targetBlock = block; // keep the closest-before match
  }

  if (targetBlock) {
      /* Scroll the preview so the heading appears near the top */
      const previewRect = preview.getBoundingClientRect();
      const blockTop    = targetBlock.getBoundingClientRect().top - previewRect.top + preview.scrollTop;
      preview.scrollTop = Math.max(0, blockTop - 20);

      /* Flash the heading element for visual feedback */
      targetBlock.classList.remove('preview-flash');
      void targetBlock.offsetWidth; // force reflow to restart animation
      targetBlock.classList.add('preview-flash');
      targetBlock.addEventListener('animationend',
        () => targetBlock.classList.remove('preview-flash'), { once: true });
    }

    /* Force highlight of the clicked outline item and temporarily block scroll events from resetting it */
    window.isNavigatingOutline = true;
    clearTimeout(window.outlineNavTimer);
    window.outlineNavTimer = setTimeout(() => { window.isNavigatingOutline = false; }, 300);
    updateActiveOutline(lineIndex);
}


const AUTOSAVE_KEY = 'revery_md_autosave';

(async function bootLoadContent() {
  /* ── Attempt 1: Desktop — Delegated to project_sidebar.js ── */
  if (window.NativeAPI && window.NativeAPI.isDesktop) {
    // Exit early to prevent flashing stale web localStorage or starter text.
    // project_sidebar.js now owns all file loading and crash recovery.
    return; 
  }


  /* ── Attempt 2: Web — load from localStorage ── */
  let savedContent = null;
  try {
    savedContent = localStorage.getItem(AUTOSAVE_KEY);
  } catch (e) {
    console.warn('[Boot] localStorage access denied. Auto-load skipped.', e);
  }

 let initialText = "";
  if (savedContent !== null) {
    initialText = savedContent;
  } else {
    /* ── Attempt 3: Starter welcome content ── */
    initialText = `# Revery Notebook

A place to write digital notes, free from distractions and to keep the _thoughts-to-computer text_ process in one continuous flow. A markdown editor with the iconic ½ font.

---

## Quick Guide

In the upper right corner, settings can be personalized. You can adjust the various sizes for the interface elements and tune the performance for your hardware. Press \`CTRL+S\` to download your work as a \`.md\` file, using the name specified in the upper-left corner. In the settings you can also set how the file name prefix/suffix should be named.

More information, click the ½ logo in the center top of the screen.

---
###### - Harald Revery
`;
  }

  // Use replaceEditorContent to prevent the initial load from entering the undo history
  if (typeof window.replaceEditorContent === 'function') {
    window.replaceEditorContent(initialText);
  } else {
    editor.value = initialText;
    render();
    countWords();
  }
})();
/* ── end boot block ─────────────────────────────────────────────────── */


/* ── Sidebar Drag & Drop Editor Insertion ───────────────────────────────── */
editor.addEventListener('drop', (e) => {
  const draggedMarkdown = e.dataTransfer.getData('text/plain');
  
  if (draggedMarkdown && draggedMarkdown.startsWith('![')) {
    e.preventDefault();
    
    const start = editor.selectionStart;
    const end   = editor.selectionEnd;

    // Use insertWithUndo so CodeMirror records this as a normal undoable edit,
    // preserving the full undo history. Also avoids the full-document replacement
    // that editor.value= causes.
    insertWithUndo(start, end, draggedMarkdown + '\n');

    // setSelectionRange is the correct CM-shim API; selectionStart has no setter.
    const newCursor = start + draggedMarkdown.length + 1;
    editor.setSelectionRange(newCursor, newCursor);
    
    render();
    countWords();
    
   // Trigger autosave (web mode only — see input listener note)
    if (!(window.NativeAPI && window.NativeAPI.isDesktop)) {
      try { localStorage.setItem('revery_md_autosave', editor.value); } catch(err) {}
    }
  }
});






editor.addEventListener('input', () => {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => { 
    // Skip render if on mobile and currently in editor view to save CPU/battery
    const isNarrow = window.innerWidth <= 820;
    const isMobileEditor = isNarrow && document.body.getAttribute('data-view') === 'editor';
    if (!isMobileEditor) {
      render(); 
    }
    countWords(); 
    if (!(window.NativeAPI && window.NativeAPI.isDesktop)) {
      
    try {
        localStorage.setItem(AUTOSAVE_KEY, editor.value);
        clearStatusWarning('storage-full'); // a later write succeeded — storage recovered
      } catch (e) {
        if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
          console.warn('Local storage quota exceeded. Auto-save failed.');
          showStatusWarning('storage-full',
            'Storage full! Please export your file to prevent data loss.',
            { priority: 100 }); // sticky until a write succeeds
        }
      }
      
    }
    /* Slow hardware mode floors the debounce at 400 ms so weak CPUs are
       never asked to re-render (markdown-it + KaTeX + hljs) per keystroke.
       The user's own renderDelay setting is respected when higher.       */
  }, window.slowHardwareMode ? Math.max(renderDelay, 400) : renderDelay);
});

render(); countWords();

/* ── Multi-tab autosave collision detection ── */
window.addEventListener('storage', (e) => {
  if (e.key === AUTOSAVE_KEY && e.newValue !== null && e.newValue !== editor.value) {
    showStatusWarning('tab-conflict',
      'Warning: another tab has overwritten the autosave. Export this tab now to avoid losing work.',
      { priority: 90 }); // sticky — previously erased by the very next keystroke
  }
});

/* ── Disaster Prevention (Accidental Close Warning) ── */
window.isQuitting = false;


window.addEventListener('beforeunload', (e) => {
  // Only trigger the warning if the editor actually has text in it and we aren't intentionally quitting
  if (!window.isQuitting && editor.value.trim().length > 0) {
    // This is the strict, standard way to trigger the browser's native safety prompt
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ── Active Outline Highlight ─────────────────────────────────────────────
   Tracks which heading is currently visible in the preview pane and
   highlights the corresponding item in the outline panel.               */
function updateActiveOutline(forcedRawLine = null) {
  const outlineNav = document.getElementById('outline-nav');
  if (!outlineNav) return;

  // Only run if the outline pane is actually visible
  const outlinePane = document.getElementById('outline-pane');
  const isMobileOpen = document.body.classList.contains('mobile-outline-open');
  if (!outlinePane || (!isMobileOpen && outlinePane.style.display === 'none')) return;

  let targetRawLine = forcedRawLine;

  /* Live preview: the preview pane is hidden and never scrolls, so the
     active section comes from the EDITOR viewport instead — the raw line
     near the top of the visible area (same 140px reading offset as the
     preview logic below). posAtCoords avoids any height-space math.    */
  if (targetRawLine === null
      && document.body.classList.contains('live-preview-active')
      && !document.body.classList.contains('reader-mode-active')
      && document.body.dataset.view !== 'preview'
      && window.cmView) {
    try {
      const view = window.cmView;
      const sd = view.scrollDOM;
      if (Math.abs((sd.scrollHeight - sd.scrollTop) - sd.clientHeight) <= 5) {
        /* Absolute bottom: the last heading may never cross the reading
           offset — force it active (same safeguard as the preview path). */
        targetRawLine = view.state.doc.lines - 1;
      } else {
        const rect = sd.getBoundingClientRect();
        const pos = view.posAtCoords({ x: rect.left + 10, y: rect.top + 140 }, false);
        targetRawLine = view.state.doc.lineAt(pos).number - 1; // buttons use 0-based lines
      }
    } catch (_) { /* fall through to the preview-based logic */ }
  }

    if (targetRawLine === null) {
    // Find all heading elements in the preview that have a mapped source line
    const headings = Array.from(preview.querySelectorAll('h1, h2, h3, h4, h5, h6'))
                          .filter(el => el.hasAttribute('data-sl'));
    if (headings.length === 0) return;

    const previewRect = preview.getBoundingClientRect();
    const offset = previewRect.top + 140; // Increased buffer to absorb sync inaccuracies

    let activeLine = null;

    // Find the last heading that has crossed above our offset threshold
    for (const h of headings) {
      const rect = h.getBoundingClientRect();
      if (rect.top <= offset) {
        activeLine = parseInt(h.getAttribute('data-sl'), 10);
      } else {
        break; 
      }
    }

    // SAFEGUARD: If we are at the absolute bottom of the preview, the last heading should be active.
    // This fixes short documents where the last heading cannot physically scroll up to the offset line.
    const isAtBottom = Math.abs((preview.scrollHeight - preview.scrollTop) - preview.clientHeight) <= 5;
    if (isAtBottom && headings.length > 0) {
      activeLine = parseInt(headings[headings.length - 1].getAttribute('data-sl'), 10);
    }

    // Fallback to the first heading if we are at the absolute top
    if (activeLine === null && headings.length > 0) {
      activeLine = parseInt(headings[0].getAttribute('data-sl'), 10);
    }



    if (activeLine !== null) {
      // Re-add the YAML frontmatter offset to match the raw editor lines
      let yamlOffset = 0;
      const yamlMatch = editor.value.match(/^---\r?\n[\s\S]*?\r?\n---/);
      if (yamlMatch) {
        yamlOffset = (yamlMatch[0].match(/\n/g) || []).length;
      }
      targetRawLine = activeLine + yamlOffset;
    }
  }

  if (targetRawLine !== null) {
    const buttons = Array.from(outlineNav.querySelectorAll('.outline-item'));

    // Reset styles
    buttons.forEach(btn => btn.classList.remove('active-outline'));

    // Find the nearest button that matches our current position
    let activeBtn = null;
    for (let i = buttons.length - 1; i >= 0; i--) {
      const btnLine = parseInt(buttons[i].dataset.line, 10);
      if (btnLine <= targetRawLine) {
        activeBtn = buttons[i];
        break;
      }
    }

    // Fallback to the first item
    if (!activeBtn && buttons.length > 0) activeBtn = buttons[0];

    if (activeBtn) {
      activeBtn.classList.add('active-outline');

      // Auto-scroll the outline panel itself to keep the highlighted item in view
      const navRect = outlineNav.getBoundingClientRect();
      const btnRect = activeBtn.getBoundingClientRect();
      if (btnRect.top < navRect.top || btnRect.bottom > navRect.bottom) {
         activeBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }
}

preview.addEventListener('scroll', () => {
  if (window.isNavigatingOutline) return; // Prevent natural scroll from immediately overriding your click
  clearTimeout(window.outlineScrollTimer);
  window.outlineScrollTimer = setTimeout(updateActiveOutline, 150);
});

/* Live preview: the outline highlight follows the EDITOR scroll (the
   preview pane is hidden there). Same debounce + navigation guard.   */
editor.addEventListener('scroll', () => {
  if (!document.body.classList.contains('live-preview-active')) return;
  if (window.isNavigatingOutline) return;
  clearTimeout(window.outlineScrollTimer);
  window.outlineScrollTimer = setTimeout(updateActiveOutline, 150);
});