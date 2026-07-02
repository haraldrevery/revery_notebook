// editor-sync.js

/* NEW GUARD: Catch middle-clicks (which often bypass standard click listeners) */
preview.addEventListener('auxclick', function (e) {
  const linkEl = e.target.closest('a');
  if (linkEl) {
    e.preventDefault();
    e.stopPropagation();
  }
});

/* ── Updated: Preview → Editor : click to highlight source block ───────────────────── */
preview.addEventListener('click', function (e) {

  // NEW GUARD: Intercept and disable all link navigation to prevent app from acting like a browser
  const linkEl = e.target.closest('a');
  if (linkEl) {
    e.preventDefault();  // Stops the webview from navigating to the URL
    e.stopPropagation(); // Stops your editor from jumping around
    
    // Optional UX: Flash a safe, existing UI warning so the user isn't confused why the link is dead
    if (typeof window.showStatusWarning === 'function') {
      window.showStatusWarning('link-blocked',
        'External links are disabled.',
        { priority: 10, ttl: 3000 });
    }
    return; // Exit early, do nothing else
  }

  // Prevent crashes if the user clicks a broken image or a raw media file wrapper
  if (e.target.tagName === 'IMG' || window._showingUnsupportedFile) {
    return;
  }

  const raw = editor.value;
/* NEW: Check if an individual YAML pill was clicked */
  const pillEl = e.target.closest('.yaml-pill');
  if (pillEl) {
    e.stopPropagation(); // Prevent the outer YAML block click from firing
    
    const charStart = parseInt(pillEl.getAttribute('data-start'), 10);
    const charEnd = parseInt(pillEl.getAttribute('data-end'), 10);

    /* Scroll to top and select specific line */
    editor.scrollTop = 0;
    editor.focus();
    editor.setSelectionRange(charStart, charEnd);

    /* Visual feedback — flash the pill */
    pillEl.classList.remove('preview-flash');
    void pillEl.offsetWidth; 
    pillEl.classList.add('preview-flash');
    pillEl.addEventListener('animationend', () => pillEl.classList.remove('preview-flash'), { once: true });

    /* Flash text highlighter */
    editor.classList.remove('highlight-flash');
    void editor.offsetWidth; 
    editor.classList.add('highlight-flash');
    setTimeout(() => editor.classList.remove('highlight-flash'), 150);
    setTimeout(() => editor.classList.add('highlight-flash'), 300);
    setTimeout(() => editor.classList.remove('highlight-flash'), 450);
    
    if (typeof updateActiveOutline === 'function') updateActiveOutline(0);
    return;
  }
  /* 1. Check if the YAML frontmatter block was clicked */
  const yamlEl = e.target.closest('.yaml-render');
  if (yamlEl) {
    const yamlMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---/);

    if (yamlMatch) {
      const charStart = 0;
      const charEnd = yamlMatch[0].length; // The end of the YAML block

      /* Scroll to top and select */
      editor.scrollTop = 0;
      editor.focus();
      editor.setSelectionRange(charStart, charEnd);

      /* Visual feedback — flash the clicked preview element */
      yamlEl.classList.remove('preview-flash');
      void yamlEl.offsetWidth; 
      yamlEl.classList.add('preview-flash');
      yamlEl.addEventListener('animationend', () => yamlEl.classList.remove('preview-flash'), { once: true });

      /* Make the text selection highlighter blink */
      editor.classList.remove('highlight-flash');
      void editor.offsetWidth; 
      editor.classList.add('highlight-flash');
      setTimeout(() => editor.classList.remove('highlight-flash'), 150);
      setTimeout(() => editor.classList.add('highlight-flash'), 300);
      setTimeout(() => editor.classList.remove('highlight-flash'), 450);
      
      if (typeof updateActiveOutline === 'function') updateActiveOutline(0);
    }
    return; // Exit early so it doesn't try to process normal markdown blocks
  }

  /* 2. Check if a standard Markdown block was clicked */
  const el = e.target.closest('[data-sl]');
  if (!el) return;

const mdLine    = parseInt(el.getAttribute('data-sl'),     10);
const mdLineEnd = parseInt(el.getAttribute('data-sl-end'), 10);

// Guard: if data-sl is missing or corrupt there is nothing to map to.
if (isNaN(mdLine)) return;

/* Count lines consumed by YAML frontmatter (stripped before md.render) */
let yamlOffset = 0;
const yamlMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---/);
if (yamlMatch) {
  yamlOffset = (yamlMatch[0].match(/\n/g) || []).length;
}

const editorStartLine = mdLine + yamlOffset;

// data-sl-end is absent (NaN) or equal to data-sl for many block types
// (headings, single-line paragraphs, tight list items).  In those cases the
// loop below never runs and the selection silently collapses to a cursor.
// Always guarantee at least one full source line is selected.
const safeEndLine   = (!isNaN(mdLineEnd) && mdLineEnd > mdLine) ? mdLineEnd : mdLine + 1;
const editorEndLine = safeEndLine + yamlOffset;

/* Convert line indices → character offsets */
const lines = raw.split('\n');
let charStart = 0;
for (let i = 0; i < editorStartLine && i < lines.length; i++) {
  charStart += lines[i].length + 1; /* +1 for the \n */
}
let charEnd = charStart;
for (let i = editorStartLine; i < editorEndLine && i < lines.length; i++) {
  charEnd += lines[i].length + 1;
}
/* Trim trailing newline so the selection ends at the last real char */
charEnd = Math.max(charStart, charEnd - 1);


  
  /* Scroll the editor proportionally to the block's position */
  const totalLines  = lines.length || 1;
  const scrollRatio = editorStartLine / totalLines;
  editor.scrollTop  = Math.max(
    0,
    editor.scrollHeight * scrollRatio - editor.clientHeight * 0.3
  );

  /* Select the block and pull focus so the selection is visible */
  editor.focus();
  editor.setSelectionRange(charStart, charEnd);

  /* Visual feedback — flash the clicked preview element */
  el.classList.remove('preview-flash');
  void el.offsetWidth; 
  el.classList.add('preview-flash');
  el.addEventListener('animationend', () => el.classList.remove('preview-flash'), { once: true });

  /* Make the text selection highlighter blink */
  editor.classList.remove('highlight-flash');
  void editor.offsetWidth; 
  editor.classList.add('highlight-flash');
  setTimeout(() => editor.classList.remove('highlight-flash'), 150);
  setTimeout(() => editor.classList.add('highlight-flash'), 300);
  setTimeout(() => editor.classList.remove('highlight-flash'), 450);

  /* Force outline navigation to jump to clicked section */
  if (typeof updateActiveOutline === 'function') {
    updateActiveOutline(editorStartLine);
  }
});


/* ── Forced Preview Sync Algorithm (Debounced) ────────────────────────── */
let forcedSyncTimer = null;

window.triggerForcedSync = function() {
  if (!window.forcedSyncEnabled) return;
  clearTimeout(forcedSyncTimer);
  // Use the same user‑adjustable delay as the main render debounce.
  // Fallback to 1000ms if renderDelay is undefined (should never happen).
  // Slow hardware mode applies the same 400 ms floor as the main render.
  let delay = (typeof renderDelay !== 'undefined') ? renderDelay : 1000;
  if (window.slowHardwareMode) delay = Math.max(delay, 400);
  forcedSyncTimer = setTimeout(() => {
    window.forceSyncToCursor();
  }, delay);
};

window.forceSyncToCursor = function() {
  if (!window.forcedSyncEnabled) return;
  
  const rawText = editor.value;
  const cursorPos = editor.selectionStart;
  const mdCursorLineRaw = (rawText.substring(0, cursorPos).match(/\n/g) || []).length;
  
  /* Adjust for YAML frontmatter */
  const yamlMatch = rawText.match(/^---\r?\n[\s\S]*?\r?\n---/);
  const yamlLines = yamlMatch ? (yamlMatch[0].match(/\n/g) || []).length : 0;
  const mdCursorLine = Math.max(0, mdCursorLineRaw - yamlLines);
  
  const blocks = Array.from(preview.querySelectorAll('[data-sl]'));
  if (!blocks.length) return;
  
  let targetBlock = null;
  for (const block of blocks) {
    const sl = parseInt(block.getAttribute('data-sl') ?? '-1', 10);
    if (isNaN(sl)) continue;
    if (sl <= mdCursorLine) targetBlock = block;
    else break;
  }
  
  if (targetBlock) {
    const previewRect = preview.getBoundingClientRect();
    const blockTop = targetBlock.getBoundingClientRect().top - previewRect.top + preview.scrollTop;
    
    /* Smooth scroll to push the block near the top (with a 20px buffer) */
    preview.scrollTo({
      top: Math.max(0, blockTop - 20),
      behavior: 'smooth'
    });
  }
};

/* Attach trigger to editor interactions */
editor.addEventListener('keyup', window.triggerForcedSync);
editor.addEventListener('click', window.triggerForcedSync);
editor.addEventListener('input', window.triggerForcedSync);


/* ── Line-mapped scroll sync ──────────────────────────────────────────── */
// Cache variables to prevent heavy O(N) operations on every scroll frame
let cachedTextLength = -1;
let cachedLineCount = 1;
let cachedYamlLines = 0;
let cachedBlocks = [];

function syncPreviewScroll() {
  if (window.forcedSyncEnabled) return; // Mute standard sync if forced sync is active
  
  const editorMax = editor.scrollHeight - editor.clientHeight;
  if (editorMax <= 0) return;
  
  /* ── Fix 1: Force scroll to absolute bottom if editor is at the bottom ── */
  // Increased threshold to 16px to prevent fast-typing layout lag from breaking the bottom-lock
  if (editor.scrollTop >= editorMax - 16) {
    preview.scrollTop = preview.scrollHeight - preview.clientHeight;
    return;
  }

  // 1. Check if we need to recalculate heavy variables (only if text changed)
  const rawText = editor.value;
  if (rawText.length !== cachedTextLength) {
    cachedLineCount = (rawText.match(/\n/g) || []).length + 1;
    const yamlMatch = rawText.match(/^---\r?\n[\s\S]*?\r?\n---/);
    cachedYamlLines = yamlMatch ? (yamlMatch[0].match(/\n/g) || []).length : 0;
    cachedBlocks = Array.from(preview.querySelectorAll('[data-sl]'));
    cachedTextLength = rawText.length;
  }

  // 2. Estimate the editor line at the top of the visible area.
  const lineH   = editor.scrollHeight / cachedLineCount;
  const topLine = editor.scrollTop / lineH;
  const mdLine  = Math.max(0, topLine - cachedYamlLines);

  // 3. Use the cached source-mapped blocks.
  if (!cachedBlocks.length) {
    // Fallback to percentage ratio
    preview.scrollTop = (editor.scrollTop / editorMax) * (preview.scrollHeight - preview.clientHeight);
    return;
  }

  // 4. Helper: get an element's scroll offset relative to #preview.
  const getScrollOffset = (el) => {
    const elRect      = el.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    return elRect.top - previewRect.top + preview.scrollTop;
  };

  // 5. Find the two surrounding blocks (prev ≤ mdLine < next).
  let prevBlock = null, nextBlock = null;

  for (const block of cachedBlocks) {
    const sl = parseInt(block.getAttribute('data-sl') ?? '-1', 10);
    if (isNaN(sl)) continue; // ← skip unmapped blocks instead of treating them as line 0
    if (sl <= mdLine) prevBlock = block;
    else              { nextBlock = block; break; }
  }
  
  if (!prevBlock) {
    preview.scrollTop = 0;
    return;
  }

  if (!nextBlock) {
    /* ── Fix 2: Smooth interpolation for the last block ── */
    const prevLine = parseInt(prevBlock.getAttribute('data-sl'), 10);
    const prevTop  = getScrollOffset(prevBlock);
    
    const remainingLines = cachedLineCount - prevLine;
    const currentProgress = mdLine - prevLine;
    const ratio = remainingLines > 0 ? currentProgress / remainingLines : 0;
    
    const remainingScroll = (preview.scrollHeight - preview.clientHeight) - prevTop;
    
    preview.scrollTop = prevTop + (Math.max(0, ratio) * Math.max(0, remainingScroll));
    return;
  }

  // 6. Linearly interpolate between the two surrounding blocks.
  const prevLine = parseInt(prevBlock.getAttribute('data-sl'), 10);
  const nextLine = parseInt(nextBlock.getAttribute('data-sl'), 10);
  const prevTop  = getScrollOffset(prevBlock);
  const nextTop  = getScrollOffset(nextBlock);
  const t        = (nextLine > prevLine) ? (mdLine - prevLine) / (nextLine - prevLine) : 0;

  preview.scrollTop = prevTop + t * (nextTop - prevTop);
}

// ── FIX: Throttle the scroll event using requestAnimationFrame ──
// This ensures the browser only processes one scroll calculation per visual frame, 
// protecting the main thread from locking up.
let scrollTicking = false;

editor.addEventListener('scroll', () => {
  if (!scrollTicking) {
    window.requestAnimationFrame(() => {
      syncPreviewScroll();
      scrollTicking = false;
    });
    scrollTicking = true;
  }
});


// Below is supposed to give a better preview synch. To be honest, if it gets too bad the "forced prev. sync." is more reliable.

/* ── Fix 3: Observe DOM mutations to sync scroll automatically while typing ── */
let previewSyncTimer = null;
const previewObserver = new MutationObserver(() => {
  // Clear any pending sync
  clearTimeout(previewSyncTimer);
  // Debounce: sync only after 100ms of no DOM changes
  previewSyncTimer = setTimeout(() => {
    requestAnimationFrame(() => {
      if (window.forcedSyncEnabled) {
        window.triggerForcedSync(); // Delegate to forced sync if active
        return;
      }

      
      const rawText   = editor.value;
      const lineCount = (rawText.match(/\n/g) || []).length + 1;
      const lineH     = editor.scrollHeight / lineCount;
      const cursorPos = editor.selectionStart;
      const mdCursorLineRaw = (rawText.substring(0, cursorPos).match(/\n/g) || []).length;
      const yamlMatch = rawText.match(/^---\r?\n[\s\S]*?\r?\n---/);
      const yamlLines = yamlMatch ? (yamlMatch[0].match(/\n/g) || []).length : 0;
      const mdCursorLine = Math.max(0, mdCursorLineRaw - yamlLines);
      const blocks = Array.from(preview.querySelectorAll('[data-sl]'));
      if (!blocks.length) { syncPreviewScroll(); return; }
      const getScrollOffset = (el) => {
        const elRect = el.getBoundingClientRect();
        const previewRect = preview.getBoundingClientRect();
        return elRect.top - previewRect.top + preview.scrollTop;
      };
      let prevBlock = null, nextBlock = null;
      for (const block of blocks) {
        const sl = parseInt(block.getAttribute('data-sl') ?? '-1', 10);
        if (isNaN(sl)) continue;
        if (sl <= mdCursorLine) prevBlock = block;
        else { nextBlock = block; break; }
      }
      if (!prevBlock) { preview.scrollTop = 0; return; }
      const previewMax = preview.scrollHeight - preview.clientHeight;
      let targetTop;
      if (!nextBlock) {
        const prevLine = parseInt(prevBlock.getAttribute('data-sl'), 10);
        const prevTop  = getScrollOffset(prevBlock);
        const remaining = lineCount - prevLine;
        const progress = mdCursorLine - prevLine;
        const ratio = remaining > 0 ? progress / remaining : 1;
        const remainingScroll = Math.max(0, previewMax - prevTop);
        targetTop = prevTop + Math.max(0, ratio) * remainingScroll;
      } else {
        const prevLine = parseInt(prevBlock.getAttribute('data-sl'), 10);
        const nextLine = parseInt(nextBlock.getAttribute('data-sl'), 10);
        const prevTop  = getScrollOffset(prevBlock);
        const nextTop  = getScrollOffset(nextBlock);
        const t = (nextLine > prevLine) ? (mdCursorLine - prevLine) / (nextLine - prevLine) : 0;
        targetTop = prevTop + t * (nextTop - prevTop);
      }
      const cursorPixel = mdCursorLineRaw * lineH;
      const cursorFrac = editor.clientHeight > 0 ? (cursorPixel - editor.scrollTop) / editor.clientHeight : 1;
      const viewportFrac = Math.max(0, Math.min(1, cursorFrac));
      const bottomBuffer = preview.clientHeight * 0.09;
      preview.scrollTop = Math.max(0, Math.min(previewMax,
        (targetTop - viewportFrac * preview.clientHeight) + bottomBuffer
      ));
    });
  }, 100);
}); 
previewObserver.observe(preview, { childList: true, subtree: true, characterData: true });