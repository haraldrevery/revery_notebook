/* markdown_editor_livepreview.js — Obsidian-style live preview, v2.
 * Design: LIVE_PREVIEW_DESIGN.md.
 *
 * v2 architecture ("preview parity by construction"): every top-level
 * markdown block that is NOT being edited is replaced by a block widget
 * whose HTML comes from THE SAME renderer as the classic preview pane —
 * the global markdown-it instance (hljs highlight hook, footnote and
 * texmath/KaTeX plugins) followed by DOMPurify, wrapped in the preview's
 * own `.prose` container so the prose stylesheet and the dynamic
 * ui-scale compensation apply identically. Blocks intersecting the
 * selection stay raw editable text; blank lines between blocks stay raw
 * (natural cursor targets). Click a rendered block to edit it.
 *
 * The document text is never modified by rendering: saving, autosave,
 * crash backup, find/replace and undo all operate on the raw markdown
 * unchanged. Any build error degrades to "no decorations" (raw text),
 * never a broken editor.
 *
 * Block replace decorations are forbidden from view plugins, so the
 * whole engine is a single StateField. It rebuilds on doc changes and
 * on selection changes only when some block's active/rendered status
 * actually flips; widget `eq` on the block's source text means typing
 * in the active block never re-renders the others.
 *
 * This file only defines window.buildLivePreviewExtension(). Installation
 * is owned by menus.js (setLivePreviewMode) through the compartment hook
 * window.setLivePreviewExtension() in cm_setup.js.
 */

(function () {
  'use strict';
  if (typeof CM === 'undefined' || !CM.StateField || !CM.syntaxTree) {
    console.warn('[LivePreview] CM bundle lacks required exports — feature unavailable.');
    return;
  }
  const { Decoration, WidgetType, syntaxTree, StateField, EditorView, keymap, Prec } = CM;

  /* End offset of a YAML frontmatter block at the very start of the doc,
     or 0. CommonMark would otherwise misparse it: the fences become
     thematic breaks and 'key: value' + '---' becomes a Setext heading.
     Frontmatter stays a raw, dim-styled protected region.              */
  function frontmatterEnd(doc) {
    if (doc.lines < 2) return 0;
    if (doc.line(1).text.replace(/\r$/, '') !== '---') return 0;
    const maxScan = Math.min(doc.lines, 60);
    for (let n = 2; n <= maxScan; n++) {
      const text = doc.line(n).text.replace(/\r$/, '');
      if (text === '---' || text === '...') return doc.line(n).to;
    }
    return 0;
  }

  /* Top-level node types that markdown-it renders to empty/invisible
     HTML — replacing them with a widget would leave a zero-height hole.
     They stay raw instead. */
  const KEEP_RAW = new Set(['LinkReference']);

  /* ── Rendering: the classic preview's exact pipeline ─────────────────
     md (markdown-it + hljs + footnote + texmath) and DOMPurify are
     classic-script globals from markdown_editor_core_cm.js; they are
     checked at call time because widgets render lazily, after boot.   */
  function renderBlockHtml(src) {
    try {
      if (typeof md !== 'undefined') {
        let html = md.render(src);
        if (window.DOMPurify) {
          html = window.DOMPurify.sanitize(html, {
            ADD_ATTR: ['data-sl', 'data-sl-end', 'data-src'],
          });
        }
        return html;
      }
    } catch (err) {
      console.warn('[LivePreview] block render failed — showing raw text:', err);
    }
    return null; // caller falls back to raw text
  }

  /* Wire the task-list checkboxes the renderer leaves as literal "[ ]"
     text (the preview shows them as text too — live preview upgrades
     them to real checkboxes). Clicking toggles the marker in the
     DOCUMENT via a normal editor transaction: undoable, autosaved. The
     marker is re-read and validated at click time before any edit.    */
  const TASK_MARKER_RE = /^\s*(?:[-*+]|\d+[.)])\s+(\[[ xX]\])/gm;
  function upgradeTaskItems(wrap, blockSrc) {
    wrap.querySelectorAll('li').forEach((li) => {
      const first = li.firstChild;
      /* markdown-it may wrap loose list items in <p> */
      const textNode = (first && first.nodeType === 1 && first.tagName === 'P')
        ? first.firstChild : first;
      if (!textNode || textNode.nodeType !== 3) return;
      const m = /^\[([ xX])\]\s?/.exec(textNode.nodeValue);
      if (!m) return;
      const checked = m[1] !== ' ';
      textNode.nodeValue = textNode.nodeValue.slice(m[0].length);
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'lp-task-checkbox';
      box.checked = checked;
      li.classList.add('lp-task-item');
      if (checked) li.classList.add('lp-task-done');
      (textNode.parentNode || li).insertBefore(box, textNode);

      box.addEventListener('click', (e) => {
        e.preventDefault(); // the doc edit drives the visual state
        const view = window.cmView;
        if (!view) return;
        let anchor;
        try { anchor = view.posAtDOM(wrap); } catch (_) { return; }
        /* Locate this checkbox's marker: the Nth task marker in the
           block's source, N = this box's index among the block's boxes. */
        const boxes = Array.from(wrap.querySelectorAll('input.lp-task-checkbox'));
        const idx = boxes.indexOf(box);
        if (idx < 0) return;
        const slice = view.state.doc.sliceString(anchor, anchor + blockSrc.length);
        if (slice !== blockSrc) return; // stale widget — abort, never guess
        TASK_MARKER_RE.lastIndex = 0;
        let n = -1, at = -1, mm;
        while ((mm = TASK_MARKER_RE.exec(slice)) !== null) {
          n++;
          if (n === idx) { at = anchor + mm.index + mm[0].length - 3; break; }
        }
        if (at < 0) return;
        const marker = view.state.doc.sliceString(at, at + 3);
        if (!/^\[[ xX]\]$/.test(marker)) return;
        view.dispatch({ changes: { from: at, to: at + 3, insert: marker === '[ ]' ? '[x]' : '[ ]' } });
      });
    });
  }

  /* ── The block widget ────────────────────────────────────────────────
     DOM mirrors the preview pane's structure: a `.prose prose-lg
     max-w-none mx-auto` container (core_cm.js render()) inside an
     `.lp-render` scope element that the swept `#preview`-parity CSS
     rules also target. Post-processing reuses the preview's OWN
     functions (parameterized by root): image path resolution with the
     root-containment guard, and code copy buttons.                    */
  class BlockWidget extends WidgetType {
    constructor(src) { super(); this.src = src; }
    eq(other) { return other.src === this.src; }
    toDOM(view) {
      const wrap = document.createElement('div');
      wrap.className = 'lp-render';
      const prose = document.createElement('div');
      prose.className = 'prose prose-lg max-w-none mx-auto';
      wrap.appendChild(prose);
      const html = renderBlockHtml(this.src);
      if (html === null || !html.trim()) {
        /* Renderer unavailable or empty output — show the raw source. */
        prose.textContent = this.src;
        prose.classList.add('lp-render-fallback');
      } else {
        prose.innerHTML = html;
        try {
          if (typeof postProcessCodeBlocks === 'function') postProcessCodeBlocks(wrap);
          if (typeof postProcessImages === 'function') postProcessImages(wrap);
          upgradeTaskItems(wrap, this.src);
        } catch (err) {
          console.warn('[LivePreview] widget post-process failed:', err);
        }
        /* Images load async and change the block's height — tell
           CodeMirror to re-measure when they arrive. */
        wrap.querySelectorAll('img').forEach((img) => {
          img.addEventListener('load', () => view.requestMeasure());
          img.addEventListener('error', () => view.requestMeasure());
        });
      }
      /* Click-to-edit: place the cursor in the block, which reveals its
         raw markdown. Interactive children (copy button, checkboxes)
         keep their own behavior.                                       */
      attachClickToEdit(wrap, this.src);
      /* The app must never open links — same policy as everywhere else.
         The wrapper nav-guards are the backstop; this stops it locally. */
      wrap.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if (a) e.preventDefault();
      });
      return wrap;
    }
    /* true = CodeMirror never ALSO handles events on the widget. With
       false, CM's own pointer handling dispatched a competing cursor
       placement for every mousedown — which is why clicking the copy
       button (or a task checkbox) used to flip the block to raw. Our
       DOM listeners above fully own widget interaction.               */
    ignoreEvent() { return true; }
  }

  /* Shared click-to-edit wiring for rendered block widgets (markdown
     blocks AND the YAML pill box): map the click's vertical position to
     a source line, pin that line under the pointer through the reflow,
     and dispatch as a POINTER selection — semantically true, and it lets
     the YAML autocomplete's click-to-open listener react to it.
     `resolvePos(e, view)` (optional) lets a widget supply an exact doc
     position for a click target (the YAML pills do); returning null
     falls back to the vertical-fraction estimate.                     */
  function attachClickToEdit(wrap, src, resolvePos) {
    wrap.addEventListener('mousedown', (e) => {
      if (e.target.closest('.code-copy-btn') || e.target.closest('.lp-task-checkbox')) return;
      e.preventDefault();
      const view2 = window.cmView;
      if (!view2) return;
      let pos;
      try { pos = view2.posAtDOM(wrap); } catch (_) { return; }
      /* MARGINAL clicks — on the widget's own empty frame rather than any
         rendered content — route the cursor to the nearest position
         OUTSIDE the block instead of revealing it. This is the "clicked
         near the edge of the raw text but the neighbouring block got
         selected" fix: the neighbour's hit-box starts exactly where the
         raw text ends, so a near-miss must fall back to the raw side. */
      const marginal = e.target === wrap
        || (e.target.classList && e.target.classList.contains('prose'));
      if (marginal) {
        const blockFrom = pos;
        const blockTo = Math.min(view2.state.doc.length, blockFrom + src.length);
        const rect0 = wrap.getBoundingClientRect();
        const upper = rect0.height > 0 && e.clientY < rect0.top + rect0.height / 2;
        pos = upper ? Math.max(0, blockFrom - 1)
                    : Math.min(view2.state.doc.length, blockTo + 1);
      } else {
        let resolved = null;
        if (resolvePos) {
          try { resolved = resolvePos(e, view2); } catch (_) { resolved = null; }
        }
        if (resolved != null) {
          pos = Math.max(0, Math.min(resolved, view2.state.doc.length));
        } else {
          /* Refine to the clicked line: estimate from the click's vertical
             position within the rendered block. Falls back to the start. */
          try {
            const rect = wrap.getBoundingClientRect();
            if (rect.height > 0) {
              const frac = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
              const lines = src.split('\n');
              const lineIdx = Math.min(lines.length - 1, Math.floor(frac * lines.length));
              for (let i = 0; i < lineIdx; i++) pos += lines[i].length + 1;
            }
          } catch (_) { /* keep block start */ }
        }
      }
      /* Pin the clicked line under the pointer: the widget→raw swap
         (and the previous active block re-collapsing) changes content
         heights, so a plain scrollIntoView makes the view jump. The
         y:'start' + yMargin effect scrolls so the clicked source line
         sits exactly at the pointer's height after the reflow.       */
      let scrollEffect;
      try {
        const scrollRect = view2.scrollDOM.getBoundingClientRect();
        const lineH = view2.defaultLineHeight || 24;
        const yMargin = Math.max(0, Math.min(
          e.clientY - scrollRect.top,
          view2.scrollDOM.clientHeight - 3 * lineH));
        scrollEffect = EditorView.scrollIntoView(pos, { y: 'start', yMargin });
      } catch (_) { /* fall back to no scroll adjustment */ }
      view2.dispatch(scrollEffect
        ? { selection: { anchor: pos }, effects: scrollEffect, userEvent: 'select.pointer' }
        : { selection: { anchor: pos }, userEvent: 'select.pointer' });
      view2.focus();
    });
  }

  /* ── YAML frontmatter widget ─────────────────────────────────────────
     Renders the frontmatter as the SAME "Properties" pill box the
     classic preview/reader shows (shared buildYamlRenderHtml in
     markdown_editor_core_cm.js — escapeHtml'd there). Clicking a pill
     places the cursor on that source line, which reveals the raw YAML
     and pops the suggestions menu (the pointer-selection contract with
     yamlClickToComplete in cm_setup.js).                              */
  class YamlWidget extends WidgetType {
    constructor(src) { super(); this.src = src; }
    eq(other) { return other.src === this.src; }
    toDOM() {
      const wrap = document.createElement('div');
      wrap.className = 'lp-yaml';
      let html = '';
      try {
        const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*$/.exec(this.src);
        if (m && typeof buildYamlRenderHtml === 'function') {
          html = buildYamlRenderHtml(m[1], this.src.indexOf('\n') + 1);
        }
      } catch (_) { /* fall through to raw */ }
      if (html) {
        wrap.innerHTML = html; // every key/value escapeHtml'd by the builder
      } else {
        wrap.textContent = this.src;
        wrap.classList.add('lp-render-fallback');
      }
      /* Clicking a PILL lands the cursor at the start of that key's first
         value (pills carry data-start = doc offset of their source line),
         so the suggestions menu opens with the FULL value list for
         exactly that key. Elsewhere in the box: line-fraction fallback. */
      attachClickToEdit(wrap, this.src, (e, view) => {
        const pill = e.target.closest ? e.target.closest('.yaml-pill') : null;
        if (!pill || !pill.dataset || pill.dataset.start === undefined) return null;
        const ds = parseInt(pill.dataset.start, 10);
        if (!Number.isFinite(ds)) return null;
        const line = view.state.doc.lineAt(Math.max(0, Math.min(ds, view.state.doc.length)));
        const colon = line.text.indexOf(':');
        if (colon === -1) return line.from;
        let p = colon + 1;
        while (p < line.text.length && /[\s\[]/.test(line.text[p])) p++;
        return line.from + p;
      });
      return wrap;
    }
    /* CM must never ALSO handle events on the widget: its own pointer
       handling would dispatch a competing cursor placement at the widget
       boundary (which closed the menu before it could open).          */
    ignoreEvent() { return true; }
  }

  /* ── Block segmentation + decoration build ───────────────────────── */
  function buildBlocks(state) {
    const doc = state.doc;
    const ranges = [];
    const blockRanges = [];
    const fmEnd = frontmatterEnd(doc);
    const selRanges = state.selection.ranges;
    const intersects = (from, to) => selRanges.some((r) => r.from <= to && r.to >= from);

    const tree = syntaxTree(state);
    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
      if (node.from < fmEnd) continue;      // protected frontmatter region
      if (KEEP_RAW.has(node.name)) continue;
      const from = doc.lineAt(node.from).from;
      const to = doc.lineAt(Math.min(node.to, doc.length)).to;
      if (to <= from) continue;
      blockRanges.push({ from, to });
      if (intersects(from, to)) continue;   // being edited — stays raw
      ranges.push(Decoration.replace({
        widget: new BlockWidget(doc.sliceString(from, to)),
        block: true,
      }).range(from, to));
    }

    /* Frontmatter: rendered as the preview's "Properties" pill box when
       not being edited (parity with reader mode); dim raw lines while
       the cursor is inside it.                                        */
    if (fmEnd) {
      blockRanges.push({ from: 0, to: fmEnd });
      if (!intersects(0, fmEnd)) {
        ranges.push(Decoration.replace({
          widget: new YamlWidget(doc.sliceString(0, fmEnd)),
          block: true,
        }).range(0, fmEnd));
      } else {
        let pos = 0;
        for (;;) {
          const line = doc.lineAt(pos);
          if (line.from >= fmEnd) break;
          ranges.push(Decoration.line({ class: 'lp-frontmatter' }).range(line.from));
          if (line.to >= doc.length) break;
          pos = line.to + 1;
        }
      }
    }
    return { deco: Decoration.set(ranges, true), blockRanges };
  }

  let _warnedOnce = false;
  function safeBuildBlocks(state) {
    try {
      return buildBlocks(state);
    } catch (err) {
      if (!_warnedOnce) {
        _warnedOnce = true;
        console.warn('[LivePreview] block build failed — rendering raw markdown:', err);
      }
      return { deco: Decoration.none, blockRanges: [] };
    }
  }

  const blockField = StateField.define({
    create(state) { return safeBuildBlocks(state); },
    update(value, tr) {
      if (tr.docChanged) return safeBuildBlocks(tr.state);
      if (tr.selection) {
        /* Rebuild only when some block's rendered/raw status flips. */
        const hits = (sel, b) => sel.ranges.some((r) => r.from <= b.to && r.to >= b.from);
        const flipped = value.blockRanges.some((b) =>
          hits(tr.state.selection, b) !== hits(tr.startState.selection, b));
        if (flipped) return safeBuildBlocks(tr.state);
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });

  /* ── Line-by-line vertical cursor motion across rendered blocks ─────
     A multi-line rendered block is one replace widget: its raw lines have
     no drawn geometry, so the default (visual-line) ArrowUp/Down skips
     the whole block. Intercept ONLY when the default motion would land
     more than one document line away — or can't move at all (widget at
     the doc edge) — and step to the adjacent document line instead. The
     selection touching that line flips the block to raw text via the
     intersect rule in buildBlocks, in the same transaction. Motion inside
     raw text (incl. visual rows of soft-wrapped lines) stays default.
     Home/End/PageUp/PageDown are left alone on purpose: page keys as
     fast block-wise travel is desirable.                              */
  function moveByDocLine(view, forward, extend) {
    const state = view.state;
    const sel = state.selection.main;
    const doc = state.doc;
    const curLine = doc.lineAt(sel.head);
    const targetNo = curLine.number + (forward ? 1 : -1);
    if (targetNo < 1 || targetNo > doc.lines) return false;  // real doc edge

    const def = view.moveVertically(sel, forward);
    const defLine = doc.lineAt(def.head);
    /* Motion within the same doc line = stepping visual rows of a
       soft-wrapped line; the default is always right there, even when
       a rendered widget sits on the adjacent doc line. Must be checked
       before the widget-coverage trigger below.                      */
    if (def.head !== sel.head && defLine.number === curLine.number) return false;
    const skips = forward ? defLine.number > curLine.number + 1
                          : defLine.number < curLine.number - 1;
    const stuck = def.head === sel.head;
    const target = doc.line(targetNo);
    /* Deterministic trigger: moveVertically measures against the
       rendered-widget geometry that this very transaction is about to
       swap for raw text, so skips/stuck can flip between identical
       keypresses. If the adjacent doc line is covered by a replace
       widget, always take the override; the heuristic stays as a
       fallback for geometry cases the coverage test can't see.
       to > from excludes the zero-length lp-frontmatter line decos.  */
    let covered = false;
    const fv = state.field(blockField, false);
    if (fv) fv.deco.between(target.from, target.to, (from, to) => {
      if (to > from) { covered = true; return false; }
    });
    if (!covered && !skips && !stuck) return false;          // default handles it

    const head = target.from + Math.min(sel.head - curLine.from, target.length);
    /* Carry the goal column forward. moveVertically resolves it as
       sel.goalColumn ?? pixel-x of the head, so `def` already holds the
       column the user is aiming at; a plain {anchor, head} dispatch
       would erase it and make the column wander across presses that
       alternate between this override and the default motion. The
       bundle doesn't export EditorSelection — reach the class through
       the live selection instance instead. */
    const EditorSelection = state.selection.constructor;
    const goal = def.goalColumn !== undefined ? def.goalColumn : sel.goalColumn;
    /* The landing can sit exactly on a soft-wrap boundary (start of the
       entered row), where CM draws the caret with assoc||1 but measures
       the next vertical motion with assoc||-1 — one visual row apart, so
       the following press skips a row. Pin the caret to the row we
       deliberately landed on: bottom row entering from below, top row
       entering from above. Inert away from wrap points.               */
    const assoc = forward ? -1 : 1;
    if (goal !== undefined && typeof EditorSelection.cursor === 'function') {
      const range = extend
        ? EditorSelection.range(sel.anchor, head, goal)
        : EditorSelection.cursor(head, assoc, undefined, goal);
      view.dispatch({
        selection: EditorSelection.create([range]),
        scrollIntoView: true,
        userEvent: 'select',
      });
      /* The landing above is a char-offset guess — the target line was
         hidden inside the widget, so its pixels couldn't be measured
         pre-dispatch (from a blank line it parks at column 0, from a
         long one it clamps to the line end). Now that the dispatch has
         revealed the line, re-land at the goal: goalColumn is a pixel x
         relative to contentDOM's left edge, and posAtCoords flushes
         measurement synchronously. Both dispatches share one paint, so
         there is no visible double-move. The line guard means a stray
         measurement can never move the cursor off the intended line.
         The y must come from the DEPARTURE side of the target line, not
         from the guess: a wrapped paragraph is one doc line spanning
         several visual rows, and entering it from below must land on
         its BOTTOM row (the guess sits near column 0 = the top row). */
      const refPos = forward ? target.from : target.to;
      const lineCoords = view.coordsAtPos(refPos, forward ? 1 : -1);
      if (lineCoords) {
        const x = view.contentDOM.getBoundingClientRect().left + goal;
        const p = view.posAtCoords({ x, y: (lineCoords.top + lineCoords.bottom) / 2 });
        if (p != null && p !== head && doc.lineAt(p).number === targetNo) {
          const fixed = extend
            ? EditorSelection.range(sel.anchor, p, goal)
            : EditorSelection.cursor(p, assoc, undefined, goal);
          view.dispatch({
            selection: EditorSelection.create([fixed]),
            scrollIntoView: true,
            userEvent: 'select',
          });
        }
      }
    } else {
      view.dispatch({
        selection: extend ? { anchor: sel.anchor, head } : { anchor: head },
        scrollIntoView: true,
        userEvent: 'select',
      });
    }
    return true;
  }

  window.buildLivePreviewExtension = function () {
    if (!keymap || !Prec) return [blockField];
    return [
      blockField,
      Prec.high(keymap.of([
        { key: 'ArrowDown', run: (v) => moveByDocLine(v, true, false), shift: (v) => moveByDocLine(v, true, true) },
        { key: 'ArrowUp', run: (v) => moveByDocLine(v, false, false), shift: (v) => moveByDocLine(v, false, true) },
      ])),
    ];
  };
})();
