// markdown_editor_cm_setup.js
// ─────────────────────────────────────────────────────────────────────────────
// Replaces markdown_editor_undo.js and the plain <textarea id="editor">.
//
// Creates:
//   • window.cmView          – the live CodeMirror EditorView
//   • window.editor          – a shim that mirrors textarea's API surface so
//                              ALL existing scripts (core, actions, sync, find,
//                              menus) keep working with zero or minimal changes
//   • window.insertWithUndo  – CM-native transaction (replaces execCommand-based impl)
//   • window.performTextChange – replaces entire doc (used by new-file / import)
//   • window.undoManager     – stub; CM history() handles undo natively
//   • window.setFindHighlights / clearFindHighlights – used by find.js
//   • window.updateEditorPlaceholder – lets menus.js update placeholder text
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── Guard: ensure the bundle loaded ──────────────────────────────────────
  if (!window.CM || !CM.EditorView) {
    console.error('[cm_setup] CodeMirror bundle not found – aborting CM init.');
    return;
  }

const {
    EditorView, keymap, Decoration, drawSelection, placeholder,
    EditorState, StateField, StateEffect, Compartment, RangeSetBuilder, Prec,
    history, historyKeymap, defaultKeymap,
    markdown, Strikethrough, syntaxHighlighting, defaultHighlightStyle,
    lineNumbers
  } = CM;  // Note: language-data pack omitted (see codemirror-bundle.js)

const lineNumbersCompartment = new Compartment();
  let _currentLineNumbersVisible = false; // Track state for file-switching

  window.setLineNumbersVisible = function (visible) {
    _currentLineNumbersVisible = visible;
    if (window.cmView) {
      window.cmView.dispatch({
        effects: lineNumbersCompartment.reconfigure(visible ? lineNumbers() : [])
      });
    }
  };

  /* ── Live preview slot ────────────────────────────────────────────────
     The live-preview extension (markdown_editor_livepreview.js) installs
     itself through this compartment. Same file-switch rule as the line
     numbers above: replaceEditorContent() builds a FRESH state from
     _editorExtensions, which snapshots the compartment's initial (empty)
     value — the tracked current value MUST be re-applied after every
     setState or live preview silently dies on file switch.             */
  const livePreviewCompartment = new Compartment();
  let _currentLivePreviewExt = []; // Track state for file-switching

  window.setLivePreviewExtension = function (ext) {
    _currentLivePreviewExt = ext || [];
    if (window.cmView) {
      window.cmView.dispatch({
        effects: livePreviewCompartment.reconfigure(_currentLivePreviewExt)
      });
    }
  };
  // ═════════════════════════════════════════════════════════════════════════
  // 1.  FIND HIGHLIGHT DECORATIONS
  //     Replacing the old textarea-backdrop approach with CM native marks.
  // ═════════════════════════════════════════════════════════════════════════

  const findHighlightEffect = StateEffect.define();

  const findHighlightField = StateField.define({
    create() { return Decoration.none; },
    update(deco, tr) {
      for (const eff of tr.effects) {
        if (eff.is(findHighlightEffect)) return eff.value;
      }
      // When the document changes, stale highlights map to new positions automatically.
      return deco.map(tr.changes);
    },
    provide: f => EditorView.decorations.from(f),
  });

  /** Called by find.js – paints all match positions, highlighting the current one. */
  window.setFindHighlights = function (matches, currentIdx) {
    if (!window.cmView) return;
    if (!matches || matches.length === 0) {
      window.cmView.dispatch({ effects: findHighlightEffect.of(Decoration.none) });
      return;
    }
    // Decorations must be added in document order.
    const sorted = [...matches].sort((a, b) => a.index - b.index);
    const builder = new RangeSetBuilder();
    sorted.forEach((m, i) => {
      const cls = i === currentIdx ? 'cm-find-highlight-current' : 'cm-find-highlight';
      builder.add(m.index, m.index + m.length, Decoration.mark({ class: cls }));
    });
    window.cmView.dispatch({ effects: findHighlightEffect.of(builder.finish()) });
  };

  window.clearFindHighlights = function () {
    if (window.cmView) {
      window.cmView.dispatch({ effects: findHighlightEffect.of(Decoration.none) });
    }
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 2.  PLACEHOLDER COMPARTMENT (so menus.js can update the placeholder text)
  // ═════════════════════════════════════════════════════════════════════════

  const placeholderCompartment = new Compartment();

  window.updateEditorPlaceholder = function (text) {
    if (window.cmView) {
      window.cmView.dispatch({
        effects: placeholderCompartment.reconfigure(placeholder(text)),
      });
    }
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 3.  EVENT LISTENER REGISTRIES  (shim bridges browser-style addEventListener)
  // ═════════════════════════════════════════════════════════════════════════

  const _inputListeners  = [];
  const _scrollListeners = [];

  // ═════════════════════════════════════════════════════════════════════════
  // 4.  VISUAL THEME  (mirrors the existing #editor CSS rules)
  // ═════════════════════════════════════════════════════════════════════════

  const notebookTheme = EditorView.theme({
    // Outer wrapper
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
      fontFamily: 'var(--editor-font, var(--font-brand, inherit))',
      color: 'var(--text)',
    },
// Scrollable container
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'inherit',
      // Thin scrollbar to match existing theme
      scrollbarWidth: 'thin',
      scrollbarColor: 'var(--scrollbar) transparent',
    },
    // Editable content
    '.cm-content': {
      padding: 'var(--editor-padding, 24px 28px)',
      lineHeight: '1.7',
      letterSpacing: '0.01em',
      caretColor: 'var(--text)',
      minHeight: '100%',
      fontFamily: 'inherit',
      tabSize: '2',
    },
    // Cursor
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--text)',
    },

// Selection (drawSelection uses this class)
    '.cm-selectionBackground': {
      backgroundColor: 'rgba(255,255,255,0.22)',
    },
    '[data-theme="light"] & .cm-selectionBackground': {
      backgroundColor: 'rgba(0,0,0,0.22)',
    },
    // Highlight-flash: navigation flash changes selection colour (matching old #editor.highlight-flash::selection)
    '&.highlight-flash .cm-selectionBackground': {
      backgroundColor: 'rgba(255,200,60,0.6) !important',
    },
    // Fix unreadable syntax highlighting colors in dark mode.
    '[data-theme="dark"] & .cm-content span:not(.cm-placeholder)': {
      color: 'var(--text) !important',
    },
    // Strip bold, font-size changes, and underlines that defaultHighlightStyle applies
    // to heading, strong, link, and url tokens — the editor renders as plain text.
    '.cm-content span:not(.cm-placeholder)': {
      fontWeight: 'normal !important',
      textDecoration: 'none !important',
      fontSize: 'inherit !important',
    },
    // Find mark: all matches
    '.cm-find-highlight': {
      backgroundColor: 'rgba(255,200,60,0.35)',
      borderRadius: '2px',
    },

    // Find mark: current/active match
    '.cm-find-highlight-current': {
      backgroundColor: 'rgba(255,140,0,0.55)',
      outline: '1px solid rgba(255,140,0,0.85)',
      borderRadius: '2px',
    },
    // Placeholder
    '.cm-placeholder': {
      color: 'var(--text-muted, rgba(0,0,0,0.4))',
      fontStyle: 'normal',
      pointerEvents: 'none',
    },
    // No focus outline on the outer wrapper (we handle focus state ourselves)
    '&.cm-focused': {
      outline: 'none',
    },
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5.  KEYBOARD EXTENSIONS
  //     These replace the editor.addEventListener('keydown', ...) block
  //     in markdown_editor_actions.js.
  // ═════════════════════════════════════════════════════════════════════════

  // ── 5a. Tab → insert 4 spaces ──────────────────────────────────────────
  const tabKeymap = [{
    key: 'Tab',
    run: (view) => {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: '    ' },
        selection: { anchor: from + 4 },
        userEvent: 'input.type',
      });
      return true;
    },
  }];

  // ── 5b. Auto-wrap selected text with syntax pairs ──────────────────────
  //    Mirrors the autoWrapPairs object from markdown_editor_actions.js.
  const WRAP_PAIRS = {
    '"': '"', "'": "'", '(': ')', '[': ']', '{': '}',
    '*': '*', '_': '_', '`': '`', '~': '~',
  };
  const autoWrapKeymap = Object.entries(WRAP_PAIRS).map(([open, close]) => ({
    key: open,
    run: (view) => {
      const { from, to } = view.state.selection.main;
      if (from === to) return false; // no selection → type normally
      const selected = view.state.doc.sliceString(from, to);
      view.dispatch({
        changes: { from, to, insert: open + selected + close },
        selection: { anchor: from + 1, head: to + 1 },
        userEvent: 'input.type',
      });
      return true;
    },
  }));

  // ── 5c. Escape → close find bar if open ───────────────────────────────
  const escapeKeymap = [{
    key: 'Escape',
    run: () => {
      const fb = document.getElementById('find-bar');
      if (fb && fb.style.display !== 'none') {
        if (typeof closeFindBar === 'function') { closeFindBar(); return true; }
      }
      return false;
    },
  }];

  // ═════════════════════════════════════════════════════════════════════════
  // 6.  BUILD INITIAL EDITOR STATE
  // ═════════════════════════════════════════════════════════════════════════

  // _editorExtensions is stored so replaceEditorContent() can create a fresh
  // EditorState with clean history whenever a new file is opened, preventing
  // undo from leaking content across file switches.
  const _editorExtensions = [
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      syntaxHighlighting(defaultHighlightStyle),
      /* CommonMark + GFM strikethrough. Without the extension the parser
         never produces Strikethrough nodes, so ~~text~~ neither rendered
         in live preview nor struck through in the classic editor (bold
         and italic always did — this brings ~~ to parity).             */
      markdown({ extensions: [Strikethrough] }),
      EditorView.contentAttributes.of({ spellcheck: 'true' }),
      placeholderCompartment.of(placeholder('Start writing\u2026')),
      lineNumbersCompartment.of([]), // Initialize empty, Settings will toggle this
      livePreviewCompartment.of([]), // Initialize empty, Settings will toggle this
      Prec.highest(keymap.of(tabKeymap)),
      Prec.high(keymap.of([...escapeKeymap, ...autoWrapKeymap])),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      notebookTheme,
      findHighlightField,
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          const evt = new Event('input', { bubbles: true });
          _inputListeners.forEach(fn => fn(evt));
        }
      }),
    ];

  const state = EditorState.create({
    doc: '',
    extensions: _editorExtensions,
  });

// ═════════════════════════════════════════════════════════════════════════
  // 7.  MOUNT THE VIEW
  //     The HTML must have <div id="cm-editor-host"></div> where the
  //     <textarea id="editor"> used to be.
  // ═════════════════════════════════════════════════════════════════════════

  const host = document.getElementById('cm-editor-host');
  if (!host) {
    console.error('[cm_setup] #cm-editor-host element not found in HTML.');
    return;
  }

  // FIX: Force the host container to fill its parent pane and constrain its height.
  // This ensures CodeMirror's internal virtualized scrolling (.cm-scroller) activates,
  // preventing the editor from growing infinitely and breaking the scrollbar.
  host.style.flex = '1';
  host.style.display = 'flex';
  host.style.flexDirection = 'column';
  host.style.minHeight = '0';
  host.style.overflow = 'hidden';

  window.cmView = new EditorView({ state, parent: host });
  // Give the CM wrapper div id='editor' so document.getElementById('editor')
  // works in menus.js (applyTextSize, applyDOMTranslations) without changes.
  window.cmView.dom.id = 'editor';
  
  // FIX: Override legacy #editor CSS properties (from the old textarea) that could hijack scrolling
  window.cmView.dom.style.overflow = 'hidden';
  window.cmView.dom.style.padding = '0';
  window.cmView.dom.style.border = 'none';

  // Forward CM scroll events to the registered scroll listeners
  window.cmView.scrollDOM.addEventListener('scroll', (e) => {
    _scrollListeners.forEach(handler => handler(e));
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 8.  THE `editor` SHIM
  //     Exposes the same property surface the existing scripts depend on
  //     so core.js, actions.js, sync.js, menus.js, find.js work as-is.
  // ═════════════════════════════════════════════════════════════════════════

  // Dynamic font-size override tag (used by applyTextSize() in menus.js)
  let _fontSizeStyle = '';

  window.editor = {

    // ── Content ────────────────────────────────────────────────────────────
    get value() {
      return window.cmView.state.doc.toString();
    },
    set value(v) {
      const len = window.cmView.state.doc.length;
      window.cmView.dispatch({ changes: { from: 0, to: len, insert: v } });
    },

    // ── Selection ──────────────────────────────────────────────────────────
    get selectionStart() { return window.cmView.state.selection.main.from; },
    get selectionEnd()   { return window.cmView.state.selection.main.to;   },

    setSelectionRange(from, to) {
      const len = window.cmView.state.doc.length;
      from = Math.max(0, Math.min(from, len));
      to   = Math.max(from, Math.min(to, len));
      window.cmView.dispatch({
        selection:    { anchor: from, head: to },
        scrollIntoView: true,
      });
    },

    // ── Focus ──────────────────────────────────────────────────────────────
    focus() { window.cmView.focus(); },

    // ── Scroll (maps to CM's scrollDOM) ────────────────────────────────────
    get scrollTop()    { return window.cmView.scrollDOM.scrollTop; },
    set scrollTop(v)   { window.cmView.scrollDOM.scrollTop = v; },
    get scrollHeight() { return window.cmView.scrollDOM.scrollHeight; },
    get clientHeight() { return window.cmView.scrollDOM.clientHeight; },

    // ── Geometry (used by sync.js and find.js) ─────────────────────────────
    get offsetTop()    { return window.cmView.dom.offsetTop; },
    get offsetLeft()   { return window.cmView.dom.offsetLeft; },
    get offsetWidth()  { return window.cmView.dom.offsetWidth; },
    get offsetHeight() { return window.cmView.dom.offsetHeight; },
    getBoundingClientRect() { return window.cmView.dom.getBoundingClientRect(); },

    // ── Style proxy (used by applyTextSize() in menus.js) ─────────────────
    style: {
      get fontSize() { return _fontSizeStyle; },
      set fontSize(v) {
        _fontSizeStyle = v;
        // Set on the CM wrapper (#editor). .cm-content inherits via CSS.
        window.cmView.dom.style.fontSize = v;
      },
      get outline() { return window.cmView.dom.style.outline; },
      set outline(v) { window.cmView.dom.style.outline = v; },
    },

    // ── Parent (used by the old find backdrop — now unused but safe) ────────
    get parentNode() { return window.cmView.dom.parentNode; },

    // ── ClassList proxy (sync.js uses .highlight-flash) ────────────────────
    classList: {
      add(cls)      { window.cmView.dom.classList.add(cls); },
      remove(cls)   { window.cmView.dom.classList.remove(cls); },
      contains(cls) { return window.cmView.dom.classList.contains(cls); },
    },

    // ── Placeholder (menus.js sets editor.placeholder via translation) ──────
    get placeholder() { return ''; },
    set placeholder(v) { window.updateEditorPlaceholder(v); },

    // ── Event listener bridge ──────────────────────────────────────────────
    addEventListener(type, handler, opts) {
      switch (type) {
        case 'input':
          // Collected and fired by the CM updateListener above
          _inputListeners.push(handler);
          break;
        case 'scroll':
          // Collected and fired by the scrollDOM scroll listener above
          _scrollListeners.push(handler);
          break;
        case 'keydown':
        case 'keyup':
          // Keyboard events bubble from cm-content → cm-scroller → cm-editor
          window.cmView.dom.addEventListener(type, handler, opts);
          break;
        case 'contextmenu':
          // Context menu fires on the editable content div
          window.cmView.contentDOM.addEventListener(type, handler, opts);
          break;
        default:
          window.cmView.dom.addEventListener(type, handler, opts);
      }
    },
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 9.  insertWithUndo  (replaces the execCommand-based implementation)
  // ═════════════════════════════════════════════════════════════════════════

  window.insertWithUndo = function (start, end, text) {
    const doc  = window.cmView.state.doc;
    const from = Math.max(0, Math.min(start, doc.length));
    const to   = Math.max(from, Math.min(end, doc.length));
    window.cmView.dispatch({
      changes: { from, to, insert: text },
      // Place cursor after inserted text
      selection: { anchor: from + text.length },
      userEvent: 'input',
    });
  };

  // Convenience alias used in a few places (e.g. buildMenu template inserts)
  // Signature: insertWithUndo(0, 0, content) prepends at position 0
  // That already works correctly with the above.

  // ═════════════════════════════════════════════════════════════════════════
  // 10. performTextChange  (replaces entire document — used by new-file/import)
  // ═════════════════════════════════════════════════════════════════════════

  window.performTextChange = function (text, selStart, selEnd) {
    const len       = window.cmView.state.doc.length;
    const safeStart = Math.max(0, Math.min(selStart || 0, text.length));
    const safeEnd   = Math.max(safeStart, Math.min(selEnd || 0, text.length));
    window.cmView.dispatch({
      changes:   { from: 0, to: len, insert: text },
      selection: { anchor: safeStart, head: safeEnd },
    });
    if (typeof render === 'function')     render();
    if (typeof countWords === 'function') countWords();
    if (!(window.NativeAPI && window.NativeAPI.isDesktop)) {
      try { localStorage.setItem('revery_md_autosave', text); } catch (_) {}
    }
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 11. undoManager stub  (CM history handles undo natively)
  // ═════════════════════════════════════════════════════════════════════════

  window.undoManager = {
    capture()      { return null; },
    recordChange() {},
    ignoreNext:    false,
  };

  // ═════════════════════════════════════════════════════════════════════════
  // 12. replaceEditorContent  (file-switch: fresh state = fresh history)
  //
  //     Uses cmView.setState() rather than dispatch() so that CodeMirror
  //     creates a completely new history stack for every file.  This means:
  //       • Ctrl+Z in file B can never undo back to file A's content.
  //       • Undoing past the start of edits never empties the file.
  //       • The sidebar's navigation undo (move/rename) stays separate.
  //
  //     IMPORTANT: setState does NOT fire updateListener, so _inputListeners
  //     are NOT called — the sidebar's auto-save/dirty-track handler is
  //     intentionally skipped, which is correct for programmatic file loads.
  // ═════════════════════════════════════════════════════════════════════════

window.replaceEditorContent = function (text) {
    const freshState = EditorState.create({
      doc: text,
      extensions: _editorExtensions,
    });
    window.cmView.setState(freshState);
    
    // Re-apply the line numbers visibility state to the fresh editor
    window.setLineNumbersVisible(_currentLineNumbersVisible);
    // Re-apply live preview — the fresh state snapshotted an empty slot
    window.setLivePreviewExtension(_currentLivePreviewExt);

    if (typeof render === 'function')     render();
    if (typeof countWords === 'function') countWords();
    if (!(window.NativeAPI && window.NativeAPI.isDesktop)) {
      try { localStorage.setItem('revery_md_autosave', text); } catch (_) {}
    }
  };
})();
