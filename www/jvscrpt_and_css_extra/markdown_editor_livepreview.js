/* markdown_editor_livepreview.js — Obsidian-style live preview, v2.
 * Design: LIVE_PREVIEW_DESIGN.md.
 *
 * v2 architecture ("preview parity by construction"): every top-level
 * markdown block that is NOT being edited is replaced by a block widget
 * whose HTML comes from THE SAME renderer as the classic preview pane —
 * the global markdown-it instance (hljs highlight hook, footnote and
 * texmath/KaTeX plugins) followed by DOMPurify, wrapped in the preview's
 * own `.prose` container so the prose stylesheet and the dynamic
 * ui-scale compensation apply identically. Blocks the user is editing
 * stay raw editable text (see the reveal rule); blank lines between
 * blocks stay raw (natural cursor targets). Click a rendered block to
 * edit it.
 *
 * The document text is never modified by rendering: saving, autosave,
 * crash backup, find/replace and undo all operate on the raw markdown
 * unchanged. Any build error degrades to "no decorations" (raw text),
 * never a broken editor.
 *
 * Block replace decorations are forbidden from view plugins, so the
 * whole engine is a single StateField. It rebuilds on doc changes, when
 * the parser delivers a new tree, and on selection changes only when
 * some block's revealed/rendered status actually flips; widget `eq` on
 * the block's source text means typing in the active block never
 * re-renders the others.
 *
 * POINTER MODEL (the second half of this file): CodeMirror owns every
 * mouse gesture through EditorView.mouseSelectionStyle; this file only
 * decides what document position a pointer event means — a click on
 * rendered text maps to THAT text in the source (renderer source-line
 * stamps + text alignment), a drag extends character by character into
 * rendered blocks (which stay rendered, the covered part painted in
 * place), everything on raw text is the default posAtCoords.
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
  const { Decoration, WidgetType, ViewPlugin, syntaxTree, StateField, EditorView, keymap, Prec } = CM;

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

  /* Children of a rendered block that keep their own pointer behaviour
     (copy buttons, task checkboxes): CodeMirror never treats a mousedown
     on them as a selection, and they never steal the editor's focus.   */
  const INTERACTIVE = '.code-copy-btn, .lp-task-checkbox, input, button';
  const isInteractive = (target) => !!(target && target.closest && target.closest(INTERACTIVE));

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

  /* Shared widget-DOM wiring for both widget kinds:
       • interactive children keep their behaviour but must not take the
         editor's focus on mousedown (a <button>/<input> focuses itself by
         default — typing right after copying a snippet used to go nowhere);
       • the app must never open links — same policy as everywhere else;
         the wrapper nav-guards are the backstop, this stops it locally;
       • rendered images/links are not draggable: a browser drag of an
         <img> carries the file itself, and dropping it back on the
         editor would import a duplicate copy into the project.       */
  function wireWidgetDom(wrap) {
    wrap.addEventListener('mousedown', (e) => {
      if (isInteractive(e.target)) e.preventDefault();
    });
    wrap.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a) e.preventDefault();
    });
    wrap.querySelectorAll('img, a').forEach((el) => { el.draggable = false; });
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
      wireWidgetDom(wrap);
      return wrap;
    }
    /* CodeMirror handles a mousedown on the widget (lpMouseSelection
       below maps it to a source position) unless it targets an
       interactive child, which keeps its own behaviour. Every other
       event stays the widget's own: CM's handlers (drag, copy, …) must
       never treat rendered DOM as editable content.                   */
    ignoreEvent(event) {
      if (event.type !== 'mousedown') return true;
      return isInteractive(event.target);
    }
  }

  /* ── YAML frontmatter widget ─────────────────────────────────────────
     Renders the frontmatter as the SAME "Properties" pill box the
     classic preview/reader shows (shared buildYamlRenderHtml in
     markdown_editor_core_cm.js — escapeHtml'd there). Clicking a pill
     places the cursor on that source line (posInYamlWidget), which
     reveals the raw YAML and pops the suggestions menu (the pointer-
     selection contract with yamlClickToComplete in cm_setup.js).     */
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
      wireWidgetDom(wrap);
      return wrap;
    }
    ignoreEvent(event) {
      if (event.type !== 'mousedown') return true;
      return isInteractive(event.target);
    }
  }

  /* ── Reveal rule ─────────────────────────────────────────────────────
     A block shows its raw markdown while the user is EDITING it:
       • the cursor (empty selection) sits anywhere in it, edges included;
       • a selection range STARTS in it — the anchor is where the user
         began (the click that revealed the block), edges included, so a
         block never collapses under a drag that started inside it.
     The HEAD of a range never reveals a markdown block: a selection that
     reaches into a rendered block leaves it rendered and the covered part
     is painted inside the rendered text (paintSelection), exactly like
     selecting across formatted text in a WYSIWYG editor; a block the
     range spans entirely is selected as a unit (drawSelection's band +
     the lp-selected outline). So nothing changes layout while a pointer
     drags — the only reveal is the click that started it — which is
     what keeps drags stable. Select-all likewise keeps everything
     rendered except the block the anchor sits in.
     The YAML pill box is not linear text, so a head inside it reveals
     the raw frontmatter as before.                                    */
  function revealedBy(from, to, r, linear) {
    if (r.empty) return r.head >= from && r.head <= to;
    if (r.anchor >= from && r.anchor <= to) return true;
    return !linear && r.head > from && r.head < to;
  }
  const isRevealed = (selection, from, to, linear = true) =>
    selection.ranges.some((r) => revealedBy(from, to, r, linear));

  /* ── Block segmentation + decoration build ───────────────────────── */
  function buildBlocks(state) {
    const doc = state.doc;
    const ranges = [];
    const blockRanges = [];
    const fmEnd = frontmatterEnd(doc);
    const sel = state.selection;

    const tree = syntaxTree(state);
    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
      if (node.from < fmEnd) continue;      // protected frontmatter region
      if (KEEP_RAW.has(node.name)) continue;
      const from = doc.lineAt(node.from).from;
      const to = doc.lineAt(Math.min(node.to, doc.length)).to;
      if (to <= from) continue;
      blockRanges.push({ from, to, linear: true });
      if (isRevealed(sel, from, to)) continue;   // being edited — stays raw
      ranges.push(Decoration.replace({
        widget: new BlockWidget(doc.sliceString(from, to)),
        block: true,
      }).range(from, to));
    }

    /* Frontmatter: rendered as the preview's "Properties" pill box when
       not being edited (parity with reader mode); dim raw lines while
       the cursor is inside it.                                        */
    if (fmEnd) {
      blockRanges.push({ from: 0, to: fmEnd, linear: false });
      if (!isRevealed(sel, 0, fmEnd, false)) {
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
      /* The parser finishes large documents in idle time, AFTER the
         transaction that changed the text: a new tree means blocks the
         previous build could not see yet.                             */
      if (syntaxTree(tr.state) !== syntaxTree(tr.startState)) return safeBuildBlocks(tr.state);
      if (tr.selection) {
        /* Rebuild only when some block's rendered/raw status flips. */
        const flipped = value.blockRanges.some((b) =>
          isRevealed(tr.state.selection, b.from, b.to, b.linear)
            !== isRevealed(tr.startState.selection, b.from, b.to, b.linear));
        if (flipped) return safeBuildBlocks(tr.state);
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });

  /* ═══════════════════════════════════════════════════════════════════
     POINTER MODEL
     ═══════════════════════════════════════════════════════════════════ */

  /* The bundle doesn't export EditorSelection — reach the class through
     the live selection instance (static cursor/range/create). */
  const SelectionOf = (view) => view.state.selection.constructor;
  const isWs = (c) => /\s/.test(c);
  const childIndex = (node) => Array.prototype.indexOf.call(node.parentNode.childNodes, node);

  /* Block range record for a widget's DOM (from the field, by position). */
  function blockForWrap(view, wrap) {
    let from;
    try { from = view.posAtDOM(wrap); } catch (_) { return null; }
    const fv = view.state.field(blockField, false);
    if (!fv) return null;
    return fv.blockRanges.find((b) => b.from === from) || null;
  }

  /* One of our widget wrappers containing `target`, if it is in this view. */
  function wrapOf(view, target) {
    const wrap = (target && target.closest) ? target.closest('.lp-render, .lp-yaml') : null;
    return (wrap && view.contentDOM.contains(wrap)) ? wrap : null;
  }

  /* Rendered block under a screen y, from CodeMirror's OWN block geometry
     (no DOM hit-testing): the BlockInfo whose widget is one of ours, or
     null when a raw line is there. Heights above/below the document clamp
     to the first/last block, exactly like posAtCoords' 0 / doc.length. */
  function renderedBlockAtY(view, y) {
    let block;
    try { block = view.elementAtHeight(y - view.documentTop); } catch (_) { return null; }
    if (!block) return null;
    const w = block.widget;
    return (w instanceof BlockWidget || w instanceof YamlWidget) ? block : null;
  }

  function caretAt(x, y) {
    try {
      if (document.caretPositionFromPoint) {
        const p = document.caretPositionFromPoint(x, y);
        return p ? { node: p.offsetNode, offset: p.offset } : null;
      }
      if (document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(x, y);
        return r ? { node: r.startContainer, offset: r.startOffset } : null;
      }
    } catch (_) { /* no caret API — line-level mapping only */ }
    return null;
  }

  /* ── Rendered text ⇄ source alignment ────────────────────────────────
     markdown-it's source_map rule (core_cm.js) stamps every top-level
     token with data-sl / data-sl-end: line numbers within the text it
     rendered — here the block's own source. Within such a segment the
     rendered text is aligned to the source character by character:
     a character is found at its next occurrence (whatever lies between
     is markup — `**`, `[`, `> `, bullets, fences), whitespace is ignored
     on both sides (the DOM collapses it, markdown reflows it), a
     rendered character absent from the rest of the segment (typographer
     output like “ or …) consumes one source character, and constructs
     whose DOM text is NOT their source (images, KaTeX, footnote refs,
     the `](url)` tail of a link) enter as opaque tokens that jump over
     their markdown. The same aligner runs in both directions — click →
     source offset, and source offset → rendered point for painting a
     partial selection — so what is painted is what is selected.
     Heuristic by nature: a miss lands on the right line at a nearby
     column, never in another block.                                   */

  /* Source range [start, end) of the stamped element `slEl` within `blockSrc`. */
  function segmentOf(blockSrc, slEl) {
    const lines = blockSrc.split('\n');
    const sl = Math.max(0, Math.min(lines.length - 1, parseInt(slEl.getAttribute('data-sl'), 10) || 0));
    let slEnd = parseInt(slEl.getAttribute('data-sl-end'), 10);
    if (!Number.isFinite(slEnd) || slEnd <= sl) slEnd = lines.length;
    slEnd = Math.min(lines.length, slEnd);
    let start = 0;
    for (let i = 0; i < sl; i++) start += lines[i].length + 1;
    let end = start;
    for (let i = sl; i < slEnd; i++) end += lines[i].length + (i < slEnd - 1 ? 1 : 0);
    return { start, end };
  }
  function stampedAncestor(wrap, el) {
    const slEl = (el && el.closest) ? el.closest('[data-sl]') : null;
    return (slEl && wrap.contains(slEl)) ? slEl : null;
  }

  const OPAQUE = 'img, .katex, .footnote-ref, .code-copy-btn';
  function opaqueToken(el) {
    if (el.tagName === 'IMG') return { kind: 'img' };
    if (el.classList.contains('katex')) return { kind: 'math' };
    if (el.classList.contains('footnote-ref')) return { kind: 'fnref' };
    return { kind: 'skip' };
  }

  /* Index just past the ')' matching the '(' at `open`, or -1. */
  function closeParenAfter(src, open) {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) return i + 1; }
    }
    return -1;
  }

  /* Incremental aligner over one source segment. `si` is the source
     offset just past everything consumed so far. */
  function makeAligner(src) {
    const n = src.length;
    const a = { si: 0, trailing: false };
    /* Source index a rendered character maps to (its next occurrence,
       else the next non-space character as a substitution). */
    a.peekChar = (c) => {
      const j = src.indexOf(c, a.si);
      if (j >= 0) return j;
      let k = a.si;
      while (k < n && isWs(src[k])) k++;
      return k;
    };
    /* Source range [start, end) an opaque token jumps over, or null. */
    a.peekToken = (tok) => {
      const si = a.si;
      if (tok.kind === 'img') {
        const open = src.indexOf('![', si);
        if (open < 0) return null;
        const paren = src.indexOf('](', open);
        const close = paren < 0 ? -1 : closeParenAfter(src, paren + 1);
        return [open, close < 0 ? open + 2 : close];
      }
      if (tok.kind === 'math') {
        const open = src.indexOf('$', si);
        if (open < 0) return null;
        const delim = src[open + 1] === '$' ? '$$' : '$';
        const close = src.indexOf(delim, open + delim.length);
        return [open, close < 0 ? open + delim.length : close + delim.length];
      }
      if (tok.kind === 'fnref') {
        const open = src.indexOf('[^', si);
        if (open < 0) return null;
        const close = src.indexOf(']', open);
        return [open, close < 0 ? open + 2 : close + 1];
      }
      if (tok.kind === 'linkclose') {
        const m = /^\s*\]\(/.exec(src.slice(si));
        if (!m) return null;
        const close = closeParenAfter(src, si + m[0].length - 1);
        return [si, close > 0 ? close : si + m[0].length];
      }
      return null;
    };
    a.feed = (item) => {
      if (typeof item === 'string') {
        if (!item) return;
        if (isWs(item)) { a.trailing = true; return; }
        a.trailing = false;
        if (a.si >= n) return;
        a.si = Math.min(n, a.peekChar(item) + 1);
        return;
      }
      a.trailing = false;
      const r = a.peekToken(item);
      if (r) a.si = Math.min(n, r[1]);
    };
    /* The caret sat after a space: step past the source spaces too (never
       across a line or into markup), so the cursor lands where clicked. */
    a.finish = () => {
      if (a.trailing) while (a.si < n && src[a.si] === ' ') a.si++;
      return a.si;
    };
    return a;
  }

  /* Depth-first walk of the rendered text under `node`, in order. The
     visitor gets (item, node, index): a character with its text node and
     offset, '' at the END of every text node, an opaque token with its
     element, or a 'linkclose' token after an <a>'s children. Opaque
     subtrees are never entered. Returns true when the visitor stopped. */
  function walkRendered(node, visit) {
    if (node.nodeType === 3) {
      const text = node.nodeValue;
      for (let i = 0; i < text.length; i++) if (visit(text[i], node, i)) return true;
      return visit('', node, text.length);
    }
    if (node.nodeType !== 1) return false;
    if (node.matches(OPAQUE)) return visit(opaqueToken(node), node, 0);
    for (let i = 0; i < node.childNodes.length; i++) {
      if (walkRendered(node.childNodes[i], visit)) return true;
    }
    if (node.tagName === 'A') return visit({ kind: 'linkclose' }, node, node.childNodes.length);
    return false;
  }
  /* The DOM point a visited item sits at (before it). */
  function itemPoint(item, node, i) {
    if (typeof item === 'string') return [node, i];
    if (item.kind === 'linkclose') return [node, node.childNodes.length];
    return [node.parentNode, childIndex(node)];
  }

  /* Rendered caret inside the stamped element `segEl` → offset within its
     source segment `segSrc`. */
  function offsetAtCaret(segEl, segSrc, caret) {
    const al = makeAligner(segSrc);
    const point = document.createRange();
    try { point.setStart(caret.node, caret.offset); point.collapse(true); } catch (_) { return al.finish(); }
    walkRendered(segEl, (item, node, i) => {
      if (typeof item !== 'string' && item.kind !== 'linkclose' && node.contains(caret.node)) return true;
      const [pn, po] = itemPoint(item, node, i);
      let cmp;
      try { cmp = point.comparePoint(pn, po); } catch (_) { cmp = -1; }
      if (cmp !== -1) return true;       // reached (or passed) the caret
      al.feed(item);
      return false;
    });
    return al.finish();
  }

  /* Source offset (absolute) → rendered DOM point inside the widget, the
     inverse of offsetAtCaret. Offsets between segments (blank lines inside
     a block) resolve to the end of the preceding stamped element. */
  function renderedPointAt(wrap, blockFrom, blockSrc, absOffset) {
    const rel = absOffset - blockFrom;
    let hit = null, before = null;
    for (const el of wrap.querySelectorAll('[data-sl]')) {
      const seg = segmentOf(blockSrc, el);
      if (rel >= seg.start && rel <= seg.end) { hit = { el, seg }; break; }
      if (rel > seg.end && (!before || seg.end > before.seg.end)) before = { el, seg };
    }
    if (!hit) {
      if (before) return { node: before.el.parentNode, offset: childIndex(before.el) + 1 };
      return rel <= 0 ? { node: wrap, offset: 0 } : { node: wrap, offset: wrap.childNodes.length };
    }
    const al = makeAligner(blockSrc.slice(hit.seg.start, hit.seg.end));
    const target = rel - hit.seg.start;
    let found = null;
    walkRendered(hit.el, (item, node, i) => {
      if (typeof item === 'string') {
        if (!item) return false;
        if (isWs(item)) {
          if (al.si >= target) { found = itemPoint(item, node, i); return true; }
          al.feed(item);
          return false;
        }
        if (al.peekChar(item) >= target) { found = itemPoint(item, node, i); return true; }
        al.feed(item);
        return false;
      }
      const r = al.peekToken(item);
      if (r && r[0] >= target) { found = itemPoint(item, node, i); return true; }
      /* The offset falls INSIDE the construct's markdown: the construct is
         only painted once the range covers all of it. */
      if (r && r[1] > target) { found = itemPoint(item, node, i); return true; }
      al.feed(item);
      return false;
    });
    if (found) return { node: found[0], offset: found[1] };
    return { node: hit.el, offset: hit.el.childNodes.length };
  }

  /* ── Pointer → document position ─────────────────────────────────── */

  /* Nearest position OUTSIDE a block — for clicks on a widget's own frame
     rather than any rendered content (e.g. beside a narrower table). A
     near-miss on the neighbouring raw text must fall back to the raw
     side instead of revealing the block whose hit-box begins there. */
  function outsidePos(view, block, wrapRect, y) {
    const doc = view.state.doc;
    const upper = wrapRect.height > 0 && y < wrapRect.top + wrapRect.height / 2;
    return upper ? Math.max(0, block.from - 1) : Math.min(doc.length, block.to + 1);
  }

  /* The far side of a block relative to where a drag started: selects the
     block as a unit without ever putting the head inside it. */
  function unitSide(view, block, anchorPos) {
    const doc = view.state.doc;
    return anchorPos <= block.from ? Math.min(doc.length, block.to + 1) : Math.max(0, block.from - 1);
  }

  /* A caret inside a rendered markdown block → absolute source position. */
  function posAtCaretInBlock(view, block, wrap, caret) {
    const src = view.state.doc.sliceString(block.from, block.to);
    const el = caret.node.nodeType === 1 ? caret.node : caret.node.parentNode;
    let slEl = stampedAncestor(wrap, el);
    if (!slEl && caret.node.nodeType === 1) {
      /* Caret between block children (the prose container): the start of
         the next stamped element, else the end of the block. */
      const next = caret.node.childNodes[caret.offset];
      const stamped = next && next.nodeType === 1
        ? (next.matches('[data-sl]') ? next : next.querySelector('[data-sl]')) : null;
      if (!stamped) return block.to;
      return Math.min(block.to, block.from + segmentOf(src, stamped).start);
    }
    if (!slEl) return block.from;
    const seg = segmentOf(src, slEl);
    const col = offsetAtCaret(slEl, src.slice(seg.start, seg.end), caret);
    return Math.max(block.from, Math.min(block.to, block.from + seg.start + col));
  }

  /* Click inside a rendered markdown block → source position. */
  function posInBlockWidget(view, block, wrap, target, x, y) {
    const marginal = target === wrap || (target.classList && target.classList.contains('prose'));
    if (marginal) return outsidePos(view, block, wrap.getBoundingClientRect(), y);
    const caret = caretAt(x, y);
    if (caret && caret.node && wrap.contains(caret.node)) return posAtCaretInBlock(view, block, wrap, caret);
    /* No caret under the point (synthetic events, exotic engines): the
       clicked element's first source line. */
    const slEl = stampedAncestor(wrap, target);
    if (!slEl) return block.from;
    return block.from + segmentOf(view.state.doc.sliceString(block.from, block.to), slEl).start;
  }

  /* Click inside the YAML pill box → source position. A pill carries
     data-start = doc offset of its source line; the cursor lands at the
     start of that key's first value so the suggestions menu opens with
     the full value list for exactly that key. Elsewhere in the box the
     click's vertical position picks the frontmatter line.            */
  function posInYamlWidget(view, block, wrap, target, x, y) {
    const doc = view.state.doc;
    const pill = target.closest ? target.closest('.yaml-pill') : null;
    if (pill && pill.dataset && pill.dataset.start !== undefined) {
      const ds = parseInt(pill.dataset.start, 10);
      if (Number.isFinite(ds)) {
        const line = doc.lineAt(Math.max(0, Math.min(ds, doc.length)));
        const colon = line.text.indexOf(':');
        if (colon === -1) return line.from;
        let p = colon + 1;
        while (p < line.text.length && /[\s\[]/.test(line.text[p])) p++;
        return line.from + p;
      }
    }
    const rect = wrap.getBoundingClientRect();
    const lines = doc.sliceString(block.from, block.to).split('\n');
    let pos = block.from;
    if (rect.height > 0) {
      const frac = Math.min(1, Math.max(0, (y - rect.top) / rect.height));
      const lineIdx = Math.min(lines.length - 1, Math.floor(frac * lines.length));
      for (let i = 0; i < lineIdx; i++) pos += lines[i].length + 1;
    }
    return pos;
  }

  /* The rendered block beside screen height y, by DOM geometry — for a
     pointer in the content padding left/right of a block, where the
     event target is .cm-content itself. */
  function wrapAtY(view, y) {
    for (const wrap of view.contentDOM.querySelectorAll('.lp-render, .lp-yaml')) {
      const r = wrap.getBoundingClientRect();
      if (y >= r.top && y < r.bottom) return wrap;
    }
    return null;
  }

  /* A pointer at (x, y) over DOM `target` → {pos, bias, anchor} when it
     lies on or beside one of our widgets, else null (raw text: the caller
     uses posAtCoords). `anchor` is the block's start — what a click keeps
     in place through the reflow (keepInPlace).
     Beside a block (the padding left/right of the content column) the
     pointer reads the row at that height, as if it were just inside the
     block's element there. CodeMirror's own answer for that spot is the
     block's first or last line, whichever half is nearer — a click beside
     the middle of a list revealed it with the cursor rows away. */
  function resolveWidgetPoint(view, target, x, y) {
    let wrap = wrapOf(view, target);
    if (!wrap && target === view.contentDOM) {
      wrap = wrapAtY(view, y);
      if (!wrap) return null;
      const r = wrap.getBoundingClientRect();
      const inner = document.elementFromPoint(r.left + r.width / 2, y);
      if (!inner || !wrap.contains(inner)) return null;
      const ir = inner.getBoundingClientRect();
      target = inner;
      x = Math.min(Math.max(x, ir.left + 1), ir.right - 1);
    }
    if (!wrap) return null;
    const block = blockForWrap(view, wrap);
    if (!block) return null;
    let pos;
    try {
      pos = wrap.classList.contains('lp-yaml')
        ? posInYamlWidget(view, block, wrap, target, x, y)
        : posInBlockWidget(view, block, wrap, target, x, y);
    } catch (err) {
      console.warn('[LivePreview] click mapping failed — using the block start:', err);
      pos = block.from;
    }
    return { pos: Math.max(0, Math.min(view.state.doc.length, pos)), bias: 1, anchor: block.from };
  }

  /* Which side of `pos` the pointer is on (cursor assoc at wrap points):
     before if the point lies in the row that ENDS at pos, else after. */
  function positionSide(view, pos, y) {
    const line = view.state.doc.lineAt(pos);
    if (pos === line.from) return 1;
    if (pos === line.to) return -1;
    const before = view.coordsAtPos(pos, -1);
    return (before && y >= before.top && y <= before.bottom) ? -1 : 1;
  }

  function queryRaw(view, event) {
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
    return { pos, bias: positionSide(view, pos, event.clientY) };
  }

  /* A pointer MOVING over a rendered markdown block maps to the exact
     character under it — the block stays rendered (the head never
     reveals; see the reveal rule) and the covered part is painted by
     paintSelection — so a selection extends across rendered blocks
     character by character, like across formatted text in any WYSIWYG
     editor. The YAML pill box is not linear text: it is selected as a
     unit, as is any block the pointer is beside rather than over.     */
  function queryMove(view, event, anchorPos) {
    const x = event.clientX, y = event.clientY;
    const wrap = wrapOf(view, document.elementFromPoint(x, y));
    if (wrap) {
      const block = blockForWrap(view, wrap);
      if (block) {
        if (!wrap.classList.contains('lp-yaml')) {
          const caret = caretAt(x, y);
          if (caret && caret.node && wrap.contains(caret.node)) {
            try { return { pos: posAtCaretInBlock(view, block, wrap, caret), bias: 1 }; } catch (_) { /* unit */ }
          }
        }
        return { pos: unitSide(view, block, anchorPos), bias: anchorPos <= block.from ? -1 : 1 };
      }
    }
    const block = renderedBlockAtY(view, y);
    if (block) return { pos: unitSide(view, block, anchorPos), bias: anchorPos <= block.from ? -1 : 1 };
    return queryRaw(view, event);
  }

  /* Double-click → the run of same-category characters (a word, a
     punctuation run, a whitespace run) around pos, like CM's own. */
  function groupAt(view, pos, bias) {
    const state = view.state;
    const Sel = SelectionOf(view);
    const line = state.doc.lineAt(pos);
    if (line.length === 0) return Sel.cursor(pos);
    const text = line.text;
    let at = pos - line.from;
    if (at === 0) bias = 1;
    else if (at === text.length) bias = -1;
    const categorize = state.charCategorizer(pos);
    let from = at, to = at;
    if (bias < 0) from = at - 1; else to = at + 1;
    const cat = categorize(text.slice(from, to));
    while (from > 0 && categorize(text[from - 1]) === cat) from--;
    while (to < text.length && categorize(text[to]) === cat) to++;
    return Sel.range(line.from + from, line.from + to);
  }

  function rangeForClick(view, pos, bias, type) {
    const Sel = SelectionOf(view);
    if (type === 1) return Sel.cursor(pos, bias);
    if (type === 2) return groupAt(view, pos, bias);
    const line = view.state.doc.lineAt(pos);
    const to = line.to < view.state.doc.length ? line.to + 1 : line.to;
    return Sel.range(line.from, to);
  }

  /* Screen y of the top edge of the block holding `pos` — a rendered
     block's widget, or a raw line. From CodeMirror's height map, which
     matches the screen because widgets contain their margins (.lp-render
     CSS); the same measure is taken before and after a click.         */
  function screenTop(view, pos) {
    return view.documentTop + view.lineBlockAt(pos).top;
  }

  /* After a click the layout reflows: the clicked block swaps to raw text
     (its own height changes) and the block that was being edited
     re-renders. Keep the TOP EDGE of what was clicked where it was on
     screen, so the clicked block grows or shrinks downward and nothing
     above it moves — the text no longer jumps both ways around the
     click. Scrolls by exactly the remaining displacement: zero unless
     something above the clicked block changed height. When the raw text
     is taller than its rendering (soft line breaks) the caret can land a
     row below the pointer — the accepted cost of a page that stays put.
     Void if the document changed in between (file switch).
     WHEN: after CodeMirror's whole measure cycle, not inside it. For a
     height change ABOVE the viewport, CodeMirror's own scroll anchoring
     compensates too — and it runs after every measure request has
     drained, so a correction made in a request doubled it (measured: the
     clicked block jumped by the full collapse of an off-screen block).
     A microtask queued from the cycle's write phase runs once the cycle
     (anchoring included) is complete and still before the browser
     paints: it sees the final layout and corrects only what is left.  */
  function keepInPlace(view, anchor, topBefore) {
    const doc = view.state.doc;
    view.requestMeasure({
      key: keepInPlace,
      read() { return null; },
      write(_, v) {
        queueMicrotask(() => {
          if (v.state.doc !== doc) return;
          const delta = screenTop(v, Math.min(anchor, doc.length)) - topBefore;
          if (Math.abs(delta) < 1) return;
          const sd = v.scrollDOM;
          const max = Math.max(0, sd.scrollHeight - sd.clientHeight);
          sd.scrollTop = Math.max(0, Math.min(max, sd.scrollTop + delta));
        });
      },
    });
  }

  /* ── Mouse selection style ───────────────────────────────────────────
     Installed through EditorView.mouseSelectionStyle, so CodeMirror's
     own MouseSelection machinery (document-level move/up listeners,
     autoscroll at the viewport edges, shift-extend, click-inside-
     selection drag detection, focus) drives every gesture; this style
     only decides WHERE a pointer event points:
       • mousedown on (or beside) a rendered widget → the mapped source
         position (click-to-edit; the block reveals through the reveal
         rule) — the clicked block's top edge stays put (keepInPlace);
       • mousemove → queryMove (character-precise inside rendered
         blocks, unit for the YAML box);
       • anything on raw text → posAtCoords, exactly like the default.
     Click counting (double = word, triple = line) lives here because
     the default's counter never sees widget clicks; a repeat click
     reuses the first click's mapped position, so a double-click on a
     rendered word selects THAT word even though the raw text has
     shifted under the pointer since the first click.                 */
  const lastClick = { time: 0, x: 0, y: 0, count: 0, pos: null };
  function clickCount(event) {
    const now = Date.now();
    const repeat = now - lastClick.time < 400
      && Math.abs(event.clientX - lastClick.x) < 2
      && Math.abs(event.clientY - lastClick.y) < 2;
    lastClick.count = repeat ? (lastClick.count % 3) + 1 : 1;
    lastClick.time = now;
    lastClick.x = event.clientX;
    lastClick.y = event.clientY;
    return lastClick.count;
  }

  function lpMouseSelection(view, event) {
    if (event.button !== 0 && event.button !== 2) return null;
    const widgetHit = resolveWidgetPoint(view, event.target, event.clientX, event.clientY);
    /* Right button: on a rendered block place the cursor there (so the
       context menu acts on that block) and never drag; on raw text the
       browser's own caret placement applies, as in the classic editor. */
    if (event.button === 2 && !widgetHit) return null;
    const type = clickCount(event);
    let start = widgetHit;
    if (type > 1 && lastClick.pos != null) {
      start = { pos: Math.min(lastClick.pos, view.state.doc.length), bias: 1 };
    }
    if (!start) start = queryRaw(view, event);
    lastClick.pos = start.pos;

    const Sel = SelectionOf(view);
    const stationary = event.button === 2;
    /* What this click keeps in place through the reflow: the rendered
       block under the pointer, else the raw line clicked. Measured now,
       before the click's own transaction changes the layout. */
    let anchor = widgetHit ? widgetHit.anchor : view.state.doc.lineAt(start.pos).from;
    const anchorTop = screenTop(view, anchor);
    let startSel = view.state.selection;
    let pinPending = true;
    return {
      update(update) {
        if (update.docChanged) {
          start.pos = update.changes.mapPos(start.pos);
          anchor = update.changes.mapPos(anchor);
          startSel = startSel.map(update.changes);
        }
        if (pinPending && update.selectionSet) {
          pinPending = false;
          keepInPlace(update.view, anchor, anchorTop);
        }
      },
      get(curEvent, extend) {
        const cur = (curEvent === event || stationary) ? start : queryMove(view, curEvent, start.pos);
        let range = rangeForClick(view, cur.pos, cur.bias, type);
        if (cur.pos !== start.pos && !extend) {
          const startRange = rangeForClick(view, start.pos, start.bias, type);
          const from = Math.min(startRange.from, range.from);
          const to = Math.max(startRange.to, range.to);
          range = from < range.from ? Sel.range(from, to) : Sel.range(to, from);
        }
        if (extend) return startSel.replaceRange(startSel.main.extend(range.from, range.to));
        return Sel.create([range]);
      },
    };
  }

  /* ── Selection painter ───────────────────────────────────────────────
     drawSelection knows nothing about the text inside a widget: its band
     covers raw lines and stops at a widget's edge (and paints BEHIND
     widgets, where code blocks and images hide it). So for rendered
     blocks the selection is painted here, in the measure phase's write
     step (never inside an update):
       • a block the range SPANS gets `lp-selected` (CSS outline) — the
         band already tints its transparent parts;
       • a block the range reaches INTO gets the covered part of its
         rendered text highlighted through the CSS Custom Highlight API
         (::highlight(revery-lp-selection)), mapping the source offsets
         back to rendered DOM points with the same aligner clicks use.
         Without the API (older WebKitGTK) such a block falls back to the
         outline, as does the YAML box.
     Class toggles on widget DOM are legal (widgets own their DOM; CM
     ignores mutations inside them).                                   */
  const HIGHLIGHT_NAME = 'revery-lp-selection';
  const hasHighlightApi = typeof Highlight === 'function' && typeof CSS !== 'undefined' && !!CSS.highlights;

  function partialRange(view, wrap, b, r) {
    const src = view.state.doc.sliceString(b.from, b.to);
    const start = r.from <= b.from ? { node: wrap, offset: 0 } : renderedPointAt(wrap, b.from, src, r.from);
    const end = r.to >= b.to ? { node: wrap, offset: wrap.childNodes.length } : renderedPointAt(wrap, b.from, src, r.to);
    try {
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return range.collapsed ? null : range;
    } catch (_) { return null; }
  }

  function paintSelection(view) {
    const ranges = view.state.selection.ranges.filter((r) => !r.empty);
    const fv = view.state.field(blockField, false);
    const partials = [];
    view.contentDOM.querySelectorAll('.lp-render, .lp-yaml').forEach((wrap) => {
      let spanned = false;
      const b = (ranges.length && fv) ? blockForWrap(view, wrap) : null;
      if (b) {
        const paintable = hasHighlightApi && !wrap.classList.contains('lp-yaml');
        for (const r of ranges) {
          if (r.from <= b.from && r.to >= b.to) { spanned = true; break; }
          if (r.from < b.to && r.to > b.from) {        // reaches into the block
            const range = paintable ? partialRange(view, wrap, b, r) : null;
            if (range) partials.push(range);
            else if (!paintable) spanned = true;         // fallback: the unit outline
          }
        }
      }
      wrap.classList.toggle('lp-selected', spanned);
    });
    if (hasHighlightApi) {
      if (partials.length) CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...partials));
      else CSS.highlights.delete(HIGHLIGHT_NAME);
    }
  }

  const selectionPainter = ViewPlugin ? ViewPlugin.fromClass(class {
    constructor(view) { this.schedule(view); }
    update(update) {
      if (update.selectionSet || update.docChanged || update.viewportChanged) this.schedule(update.view);
    }
    schedule(view) {
      /* Keyed: repeated scheduling within one measure cycle collapses to one run. */
      view.requestMeasure({ key: paintSelection, read() { return null; }, write(_, v) { paintSelection(v); } });
    }
    destroy() {
      if (hasHighlightApi) CSS.highlights.delete(HIGHLIGHT_NAME);
    }
  }) : null;

  /* ── Line-by-line vertical cursor motion across rendered blocks ─────
     A multi-line rendered block is one replace widget: its raw lines have
     no drawn geometry, so the default (visual-line) ArrowUp/Down skips
     the whole block. Intercept ONLY when the default motion would land
     more than one document line away — or can't move at all (widget at
     the doc edge) — and step to the adjacent document line instead. The
     selection touching that line flips the block to raw text via the
     reveal rule in buildBlocks, in the same transaction. Motion inside
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
      /* Only when the landing REVEALED the line: extending a selection
         into a block leaves it rendered (head never reveals), and over a
         block widget posAtCoords answers with the widget's start or end
         by vertical half — it would fling the head to the block end. */
      let stillCovered = false;
      const fv2 = view.state.field(blockField, false);
      if (fv2) fv2.deco.between(target.from, target.to, (from, to) => {
        if (to > from) { stillCovered = true; return false; }
      });
      const refPos = forward ? target.from : target.to;
      const lineCoords = stillCovered ? null : view.coordsAtPos(refPos, forward ? 1 : -1);
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

  /* ── Drops ───────────────────────────────────────────────────────────
     A rendered block has no character geometry for a drop to aim at, so
     media dropped on the live preview goes in as its OWN paragraph after
     the source line under the pointer (media_ingest.js inserts it through
     block_insert.js). The line comes from the same mapping as a click.
     Where splitting at that line would corrupt a construct or swallow the
     link, the paragraph goes after the whole construct instead: code
     (fenced or indented), tables, HTML blocks, setext headings,
     blockquotes, paragraphs holding $$ math, the YAML frontmatter — and
     in lists the list ITEM holding the line (an unindented paragraph
     between an item and its continuation lines would detach them).    */
  const KEEP_WHOLE = new Set([
    'FencedCode', 'CodeBlock', 'Table', 'HTMLBlock', 'CommentBlock',
    'ProcessingInstructionBlock', 'SetextHeading1', 'SetextHeading2', 'Blockquote',
  ]);
  function dropLineEnd(state, pos) {
    const doc = state.doc;
    const fmEnd = frontmatterEnd(doc);
    if (fmEnd && pos <= fmEnd) return fmEnd;
    const line = doc.lineAt(pos);
    const endOf = (node) => doc.lineAt(Math.min(node.to, doc.length)).to;
    let end = line.to;
    let inItem = false;
    for (let n = syntaxTree(state).resolveInner(line.to, -1); n; n = n.parent) {
      if (KEEP_WHOLE.has(n.name)) end = Math.max(end, endOf(n));
      else if (n.name === 'ListItem' && !inItem) { inItem = true; end = Math.max(end, endOf(n)); }
      else if (n.name === 'Paragraph' && doc.sliceString(n.from, n.to).includes('$$')) end = Math.max(end, endOf(n));
    }
    return end;
  }

  /* Insertion offset (a line end) for media dropped at client point
     (x, y), or null when live preview is off — the caller then inserts
     at the character under the pointer, as in the classic editor. */
  window.livePreviewDropPos = function (x, y) {
    const view = window.cmView;
    if (!view || !view.state.field(blockField, false)) return null;
    try {
      const hit = resolveWidgetPoint(view, document.elementFromPoint(x, y), x, y);
      const pos = hit ? hit.pos : view.posAtCoords({ x, y }, false);
      return dropLineEnd(view.state, pos);
    } catch (err) {
      console.warn('[LivePreview] drop mapping failed — inserting at the pointer:', err);
      return null;
    }
  };

  window.buildLivePreviewExtension = function () {
    const ext = [blockField, EditorView.mouseSelectionStyle.of(lpMouseSelection)];
    if (selectionPainter) ext.push(selectionPainter);
    if (keymap && Prec) {
      ext.push(Prec.high(keymap.of([
        { key: 'ArrowDown', run: (v) => moveByDocLine(v, true, false), shift: (v) => moveByDocLine(v, true, true) },
        { key: 'ArrowUp', run: (v) => moveByDocLine(v, false, false), shift: (v) => moveByDocLine(v, false, true) },
      ])));
    }
    return ext;
  };
})();
