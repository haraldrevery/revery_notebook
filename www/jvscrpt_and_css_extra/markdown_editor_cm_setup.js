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
    markdown, Strikethrough, TaskList, Table, codeLanguages, syntaxHighlighting, defaultHighlightStyle,
    lineNumbers,
    autocompletion, startCompletion, completionStatus
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
    // Fix unreadable syntax highlighting colors in dark mode. Live-preview
    // widget content (.lp-render/.lp-yaml) is EXCLUDED: it carries its own
    // colors — hljs token classes in code fences, KaTeX, YAML pill tints —
    // which this blanket !important used to silently flatten to --text.
    '[data-theme="dark"] & .cm-content span:not(.cm-placeholder):not(.lp-render *):not(.lp-yaml *)': {
      color: 'var(--text) !important',
    },
    // Strip bold, font-size changes, and underlines that defaultHighlightStyle applies
    // to heading, strong, link, and url tokens — the editor renders as plain text.
    // Same widget exclusion: prose/hljs spans keep their own weight and size.
    '.cm-content span:not(.cm-placeholder):not(.lp-render *):not(.lp-yaml *)': {
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

  // ── 5d. YAML frontmatter autocomplete ──────────────────────────────────
  // CLAUDE.md feature: suggest the project's existing frontmatter keys and
  // values (tags etc.) while editing YAML, so standard metadata never has
  // to be retyped. Built on the first-party @codemirror/autocomplete
  // engine — no custom popup fighting the editor. The source gates itself
  // to the frontmatter region, so nothing changes anywhere else in the
  // document. Data comes from window.sidebarYamlIndex (project-wide scan,
  // mtime-cached, provided by the sidebar bundle; in web mode it indexes
  // the current document only). Always on — it can only ever appear
  // inside frontmatter.

  /* Start offset of the CLOSING '---'/'...' line of a leading YAML block,
     or 0 when the document has no frontmatter. Same rules as the live
     preview's protected region (markdown_editor_livepreview.js). */
  function _fmCloseLineStart(state) {
    const doc = state.doc;
    if (doc.lines < 2 || doc.line(1).text.replace(/\r$/, '') !== '---') return 0;
    const maxScan = Math.min(doc.lines, 60);
    for (let n = 2; n <= maxScan; n++) {
      const t = doc.line(n).text.replace(/\r$/, '');
      if (t === '---' || t === '...') return doc.line(n).from;
    }
    return 0;
  }

  async function yamlCompletionSource(context) {
    const state = context.state;
    const pos = context.pos;
    const closeAt = _fmCloseLineStart(state);
    if (!closeAt) return null;
    const line = state.doc.lineAt(pos);
    if (line.number === 1 || line.from >= closeAt) return null; // outside the block

    /* TOKEN-AWARE replacement: from..to always spans the WHOLE current
       token (key, value segment, or list item), never just the text
       before the cursor. Accepting a suggestion with the cursor in the
       middle of "alpha" must produce "gamma", never "gammapha". CM
       filters options by the from..cursor slice, so clicking at the
       start of a token shows the full list.                           */
    const lineText = line.text;
    const col = pos - line.from;
    let mode = null, key = null, from = pos, to = pos;
    let m;

    const kvLine = /^([A-Za-z0-9_][\w-]*)(\s*):(.*)$/.exec(lineText);
    if (kvLine && col <= kvLine[1].length) {
      /* Cursor inside the KEY of an existing "key: value" line —
         replace the key only, keep the colon and value. */
      mode = 'key-replace';
      from = line.from;
      to = line.from + kvLine[1].length;
    } else if (kvLine && col > lineText.indexOf(':')) {
      /* In the VALUE area — replace the whole segment between the
         nearest , or [ before the cursor and the next , or ] after. */
      mode = 'value';
      key = kvLine[1];
      const valStart = lineText.indexOf(':') + 1;
      const val = lineText.slice(valStart);
      const rel = col - valStart;
      const segStart = Math.max(val.lastIndexOf(',', rel - 1), val.lastIndexOf('[', rel - 1)) + 1;
      let segEnd = val.length;
      for (const stop of [',', ']']) {
        const i = val.indexOf(stop, rel);
        if (i !== -1 && i < segEnd) segEnd = i;
      }
      const lead = /^\s*/.exec(val.slice(segStart))[0].length;
      from = line.from + valStart + segStart + lead;
      to = line.from + valStart + segEnd;
      while (to > from && /\s/.test(lineText[(to - line.from) - 1])) to--;
      if (from > pos) from = pos;
      if (to < pos) to = pos;
    } else if ((m = /^(\s*-\s+)(.*)$/.exec(lineText)) && col >= m[1].length) {
      /* "- item" under a block-list key: replace the whole item text. */
      mode = 'value';
      from = line.from + m[1].length;
      to = line.from + (m[1] + m[2].replace(/\s+$/, '')).length;
      if (to < pos) to = pos;
      for (let n = line.number - 1; n >= 2; n--) {
        const t = state.doc.line(n).text;
        const kv = /^([A-Za-z0-9_][\w-]*)\s*:/.exec(t);
        if (kv) { key = kv[1]; break; }
        if (!/^\s*-\s/.test(t)) break;
      }
      if (!key) return null;
    } else if (!lineText.includes(':') && (m = /^([A-Za-z0-9_-]*)\s*$/.exec(lineText))) {
      /* Bare (partial) key on its own line. */
      mode = 'key';
      from = line.from;
      to = line.from + m[1].length;
      if (to < pos) to = pos;
    } else {
      return null;
    }

    /* Only the frontmatter slice is passed for current-doc merging —
       never the whole document (docs can be large; frontmatter is tiny). */
    let index = null;
    try {
      if (typeof window.sidebarYamlIndex === 'function') {
        const fmSlice = state.doc.sliceString(0, Math.min(closeAt + 4, state.doc.length));
        index = await window.sidebarYamlIndex(fmSlice);
      }
    } catch (_) { /* index unavailable — no completions, never an error */ }
    if (!index) return null;

    const currentToken = state.doc.sliceString(from, to);

    let options;
    if (mode === 'key' || mode === 'key-replace') {
      options = (index.keys || []).map((k) => ({
        label: k.label,
        /* On a bare line the colon is added; inside an existing
           "key: value" line the colon is already there. */
        apply: mode === 'key' ? k.label + ': ' : k.label,
        boost: Math.min(k.count || 1, 99) / 100,
      }));
    } else {
      const vals = (index.values && index.values[key]) || [];
      /* Every value option replaces the WHOLE clicked segment via a
         function apply (from..to spans the value). This decouples what
         is SHOWN from what is REPLACED: on an explicit open the menu can
         list all values with an empty filter while still cleanly
         swapping the value the user landed on. */
      const applyValue = (view, completion) => {
        view.dispatch({
          changes: { from, to, insert: completion.label },
          selection: { anchor: from + completion.label.length },
          userEvent: 'input.complete',
        });
      };
      options = vals.map((v) => ({
        label: v.label,
        apply: applyValue,
        boost: Math.min(v.count || 1, 99) / 100,
      }));
    }
    if (!options.length) return null;

    /* Explicit open (pill click / Ctrl+Space) vs. implicit (typing):
       - EXPLICIT: show ALL options with an empty filter (from = the
         cursor, so CM has no existing text to match against), the
         current value DEMOTED to the bottom. Function applies still
         replace the full from..to segment. This is what makes clicking a
         "tags: [alpha, beta]" pill list both alpha and beta.
       - IMPLICIT: filter by the typed prefix (from..to spans it) and
         demote the exact current token so a half-typed value that leaked
         into the current-doc index can't shadow the real suggestion.   */
    options = options.map((o) =>
      o.label === currentToken ? Object.assign({}, o, { boost: -99 }) : o);

    /* The empty-filter reveal only applies to VALUES (whose function
       apply replaces the whole segment). Keys keep span-replace so an
       explicit key completion still overwrites the key text. */
    if (context.explicit && mode === 'value') {
      return { from: pos, options };
    }
    return {
      from,
      to,
      options,
      validFor: (mode === 'key' || mode === 'key-replace') ? /^[\w-]*$/ : /^[^,\[\]\n]*$/,
    };
  }

  /* Clicking into the frontmatter opens the menu (the CLAUDE.md UX:
     "when clicking on the rendered YAML part, a drop menu is shown").
     Pointer selections only — arrow-key travel through the block should
     not pop UI. With selectOnOpen:false below, Enter still inserts a
     newline until the user actually arrows onto a suggestion.          */
  const yamlClickToComplete = EditorView.updateListener.of((update) => {
    if (!update.selectionSet) return;
    if (!update.transactions.some((tr) => tr.isUserEvent('select.pointer'))) return;
    const st = update.state;
    const closeAt = _fmCloseLineStart(st);
    if (!closeAt) return;
    const head = st.selection.main.head;
    const ln = st.doc.lineAt(head);
    if (ln.number === 1 || ln.from >= closeAt) return;
    if (completionStatus(st) !== null) return; // already open or pending
    setTimeout(() => { try { startCompletion(update.view); } catch (_) {} }, 0);
  });

  // ── 5e. Link-path autocomplete ─────────────────────────────────────────
  // VS-Code-style path IntelliSense inside markdown link destinations:
  // typing in `![...](here)` / `[...](here)` suggests the folders, media
  // files and notes reachable from the active file's directory; accepting
  // a folder inserts "folder/" and immediately re-opens the menu for the
  // next level. Listing/filtering/containment lives in the sidebar bundle
  // (window.sidebarListLinkCompletions — resolves with the renderer's own
  // path semantics, read-only, null in web mode so this source is inert).

  /* Minimal CommonMark-safe encoding — same set mediaMarkdown uses, so
     accepted paths render everywhere (% first!). */
  function _encodeLinkSeg(s) {
    return s.replace(/%/g, '%25').replace(/ /g, '%20')
            .replace(/\(/g, '%28').replace(/\)/g, '%29');
  }

  async function linkPathCompletionSource(context) {
    if (typeof window.sidebarListLinkCompletions !== 'function') return null;
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    /* Cursor inside a link destination: `![alt](partial` or `[txt](partial`
       with no closing paren / whitespace between the '(' and the cursor. */
    const m = before.match(/!?\[[^\]]*\]\(([^()\s]*)$/);
    if (!m) return null;

    let res = null;
    try { res = await window.sidebarListLinkCompletions(m[1]); } catch (_) { return null; }
    if (!res || !res.entries.length) return null;

    const from = context.pos - res.rawSegLength;
    const options = res.entries.map((e) => ({
      label: e.name + (e.isDir ? '/' : ''),
      type: e.isDir ? 'folder' : 'file',
      apply: (view, _completion, applyFrom, applyTo) => {
        const insert = _encodeLinkSeg(e.name) + (e.isDir ? '/' : '');
        view.dispatch({
          changes: { from: applyFrom, to: applyTo, insert },
          selection: { anchor: applyFrom + insert.length },
          userEvent: 'input.complete',
        });
        /* Folder accepted → descend: reopen the menu for the next level. */
        if (e.isDir) setTimeout(() => { try { startCompletion(view); } catch (_) {} }, 0);
      },
    }));
    return {
      from,
      options,
      /* Keep filtering while the user types within the current segment;
         a '/' ends the segment and re-queries the source (descends). */
      validFor: /^[^()\s/]*$/,
    };
  }

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
      /* GFM extensions + curated fence languages: nested language parses
         inside \`\`\`fences are colored by syntaxHighlighting in BOTH the
         classic editor and live preview (same precedent as strikethrough:
         a consistent improvement to the classic editor too).           */
      markdown({ extensions: [Strikethrough, TaskList, Table], codeLanguages }),
      EditorView.contentAttributes.of({ spellcheck: 'true' }),
      placeholderCompartment.of(placeholder('Start writing\u2026')),
      lineNumbersCompartment.of([]), // Initialize empty, Settings will toggle this
      livePreviewCompartment.of([]), // Initialize empty, Settings will toggle this
      /* Completion sources (5d YAML frontmatter + 5e link paths). Each
         source gates itself to its own region (frontmatter / inside link
         parens) and returns null everywhere else, so they can never
         conflict and the engine stays inert outside both. selectOnOpen:
         false keeps Enter inserting newlines until the user arrows onto
         an option (menus auto-open on click/typing — never steal Enter).
         icons:false matches the app's clean menu aesthetic.           */
      autocompletion({ override: [yamlCompletionSource, linkPathCompletionSource], selectOnOpen: false, icons: false }),
      yamlClickToComplete,
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
