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
  const { Decoration, WidgetType, ViewPlugin, syntaxTree, StateField, StateEffect, EditorView, keymap, Prec } = CM;

  /* End offset of a YAML frontmatter block at the very start of the doc,
     or 0. The markdown parser knows no frontmatter (its fences parse as
     thematic breaks, 'key: value' + '---' as a Setext heading), so this
     scan decides: the region renders as the Properties sheet (YamlWidget)
     and shows its raw, dim lines while being edited.                   */
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

  /* ── Height estimates ────────────────────────────────────────────────
     CodeMirror sizes a widget it has not drawn by its `estimatedHeight`,
     and WidgetType's default (-1) means ONE LINE. Every rendered block
     outside the drawn viewport therefore counted as a single row: the
     scrollbar was ~36% short on a long note and grew while scrolling,
     and whenever CodeMirror rebuilds its height map (its text-metrics
     oracle refreshes) every off-screen block above the viewport fell
     back to one row at once. The measure pass (see the selection
     painter) records each drawn widget's real height by kind + source
     text; a block never drawn gets a rough estimate from its source
     instead. Drawn widgets are always measured by CodeMirror itself —
     estimates only stand in for undrawn ones.                         */
  const HEIGHT_CACHE_MAX = 5000;
  const heightCache = new Map();   // key → px; Map order = age, oldest evicted first
  const metrics = { lineHeight: 34, charsPerRow: 40, width: 340 }; // refreshed by the measure pass
  const HEADING_ROWS = [0, 2.1, 2.15, 1.8, 1.5, 1.3, 1.15];       // rendered h1…h6 height in raw rows
  function rememberHeight(key, h) {
    heightCache.delete(key);
    heightCache.set(key, h);
    if (heightCache.size > HEIGHT_CACHE_MAX) heightCache.delete(heightCache.keys().next().value);
  }
  function recordHeights(view) {
    for (const dom of view.contentDOM.querySelectorAll('.lp-render, .lp-yaml, .lp-below')) {
      if (!dom.lpHeightKey) continue; // the rendered frame inside .lp-below
      const h = dom.getBoundingClientRect().height;
      if (h > 0) rememberHeight(dom.lpHeightKey, h);
    }
  }
  function estimateHeight(key, src) {
    const known = heightCache.get(key);
    if (known !== undefined) return known;
    const { lineHeight, charsPerRow, width } = metrics;
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(src.trim())) return Math.round(width * 0.6); // an image on its own
    let rows = 0;
    for (const line of src.split('\n')) rows += Math.max(1, Math.ceil(line.length / charsPerRow));
    const heading = /^(#{1,6})\s/.exec(src);
    return Math.round(rows * lineHeight * (heading ? HEADING_ROWS[heading[1].length] : 1));
  }
  function updateMetrics(view) {
    if (view.defaultLineHeight > 0) metrics.lineHeight = view.defaultLineHeight;
    const line = view.contentDOM.querySelector('.cm-line');
    if (line && line.clientWidth > 0) metrics.width = line.clientWidth;
    if (view.defaultCharacterWidth > 0) {
      metrics.charsPerRow = Math.max(10, Math.floor(metrics.width / view.defaultCharacterWidth));
    }
  }

  /* ── Rendered widgets ────────────────────────────────────────────────
     Shared by the block widget, the YAML box and the media preview below
     an edited block: identity by kind + source (typing in one block never
     re-renders the others), the height estimate above, and the pointer
     contract — CodeMirror handles a mousedown (lpMouseSelection maps it
     to a source position) unless it targets an interactive child, which
     keeps its own behaviour. Every other event stays the widget's own:
     CM's handlers (drag, copy, …) must never treat rendered DOM as
     editable content.                                                  */
  class RenderedWidget extends WidgetType {
    constructor(src) { super(); this.src = src; }
    eq(other) { return other.src === this.src; }
    get estimatedHeight() { return estimateHeight(this.kind + this.src, this.src); }
    /* Tags the widget's DOM for the measure pass (recordHeights). */
    trackHeight(dom) { dom.lpHeightKey = this.kind + this.src; }
    ignoreEvent(event) {
      if (event.type !== 'mousedown') return true;
      return isInteractive(event.target);
    }
  }

  /* The classic preview's DOM for `src`, inside `wrap`: a `.prose prose-lg
     max-w-none mx-auto` container (core_cm.js render()) — `.lp-render` is
     the scope the swept `#preview`-parity CSS rules also target — with
     the preview's OWN post-processing (parameterized by root): image path
     resolution with the root-containment guard, and code copy buttons. */
  function fillRendered(view, wrap, src) {
    const prose = document.createElement('div');
    prose.className = 'prose prose-lg max-w-none mx-auto';
    wrap.appendChild(prose);
    const html = renderBlockHtml(src);
    if (html === null || !html.trim()) {
      /* Renderer unavailable or empty output — show the raw source. */
      prose.textContent = src;
      prose.classList.add('lp-render-fallback');
      return;
    }
    prose.innerHTML = html;
    try {
      if (typeof postProcessCodeBlocks === 'function') postProcessCodeBlocks(wrap);
      if (typeof postProcessImages === 'function') postProcessImages(wrap);
      upgradeTaskItems(wrap, src);
    } catch (err) {
      console.warn('[LivePreview] widget post-process failed:', err);
    }
    /* Images load async and change the block's height — tell CodeMirror
       to re-measure when they arrive. */
    wrap.querySelectorAll('img').forEach((img) => {
      img.addEventListener('load', () => view.requestMeasure());
      img.addEventListener('error', () => view.requestMeasure());
    });
  }

  /* ── The block widget: one top-level markdown block, rendered ──────── */
  class BlockWidget extends RenderedWidget {
    get kind() { return 'b'; }
    toDOM(view) {
      const wrap = document.createElement('div');
      wrap.className = 'lp-render';
      fillRendered(view, wrap, this.src);
      wireWidgetDom(wrap);
      this.trackHeight(wrap);
      return wrap;
    }
  }

  /* ── Media preview below the block being edited ──────────────────────
     Images and display math stay visible UNDER their source while their
     block is raw (Obsidian-style): a formula updates live while typed,
     and revealing an image adds its source row instead of removing the
     whole picture. `src` holds just those constructs (mediaSource). The
     `.lp-below` frame marks it as not a block of its own: pointer mapping
     skips it, so a click there lands at the end of the edited block,
     which stays raw.                                                    */
  class MediaWidget extends RenderedWidget {
    get kind() { return 'm'; }
    toDOM(view) {
      const outer = document.createElement('div');
      outer.className = 'lp-below';
      const wrap = document.createElement('div');
      wrap.className = 'lp-render';
      outer.appendChild(wrap);
      fillRendered(view, wrap, this.src);
      wireWidgetDom(outer);
      this.trackHeight(outer);
      return outer;
    }
  }

  /* ── YAML frontmatter widget ─────────────────────────────────────────
     Renders the frontmatter as the SAME "Properties" sheet the classic
     preview/reader shows (window.ReveryYaml.buildSheetHtml in
     markdown_editor_yaml.js — escaped there). Clicking a row
     places the cursor on that source line (posInYamlWidget), which
     reveals the raw YAML and pops the suggestions menu (the pointer-
     selection contract with yamlClickToComplete in cm_setup.js).
     The header is a toggle that folds the sheet to one line — the one
     global, persisted choice reader mode shares (setYamlPropsCollapsed,
     menus.js), carried here by the field (yamlCollapseEffect). Folding is
     display only: a cursor inside the frontmatter always shows its raw
     lines, folded or not.                                              */
  class YamlWidget extends RenderedWidget {
    constructor(src, collapsed) { super(src); this.collapsed = collapsed; }
    get kind() { return this.collapsed ? 'yc' : 'y'; }
    eq(other) { return other.src === this.src && other.collapsed === this.collapsed; }
    toDOM(view) {
      const wrap = document.createElement('div');
      wrap.className = 'lp-yaml';
      let html = '';
      try {
        const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*$/.exec(this.src);
        if (m && window.ReveryYaml) {
          html = window.ReveryYaml.buildSheetHtml(m[1], this.src.indexOf('\n') + 1,
            { collapsible: true, collapsed: this.collapsed });
        }
      } catch (_) { /* fall through to raw */ }
      if (html) {
        wrap.innerHTML = html; // every key/value escapeHtml'd by the builder
        const toggle = wrap.querySelector('.yaml-toggle');
        if (toggle) toggle.addEventListener('click', (e) => { e.preventDefault(); toggleYamlCollapsed(view); });
      } else {
        wrap.textContent = this.src;
        wrap.classList.add('lp-render-fallback');
      }
      wireWidgetDom(wrap);
      this.trackHeight(wrap);
      return wrap;
    }
  }

  /* The sheet's header toggle: store the choice (menus.js redraws every
     sheet through syncYamlCollapsed below), keeping this header where it
     was — the text below moves instead. */
  function toggleYamlCollapsed(view) {
    const fv = view.state.field(blockField, false);
    if (!fv) return;
    const next = !fv.yamlCollapsed;
    const anchor = { pos: 0, side: 'top', y: screenEdge(view, 0, 'top') };
    if (typeof window.setYamlPropsCollapsed === 'function') window.setYamlPropsCollapsed(next);
    else window.livePreviewSyncYamlCollapsed(next);
    keepInPlace(view, anchor);
  }

  /* Redraws the live preview's sheet folded / unfolded when the choice
     changes anywhere (menus.js setYamlPropsCollapsed — this toggle, or
     reader mode's). A no-op when live preview is off or already agrees. */
  window.livePreviewSyncYamlCollapsed = function (collapsed) {
    window.yamlPropsCollapsed = !!collapsed;
    const view = window.cmView;
    const fv = view && view.state.field(blockField, false);
    if (fv && fv.yamlCollapsed !== !!collapsed) view.dispatch({ effects: yamlCollapseEffect.of(!!collapsed) });
  };

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
     the lp-selected outline). So nothing a drag does changes the layout,
     and the click that started it takes effect only on release (the
     field freezes the reveal set while a button is down — freezeEffect):
     the whole gesture maps against the layout the user sees. That is
     what keeps clicks and drags stable. Select-all likewise keeps everything
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

  /* ── Raw geometry of the block being edited ──────────────────────────
     The revealed block's lines get classes (revery_notebook_style.css,
     "The block being edited keeps its rendered geometry") that give them
     the rendered block's box, so a reveal barely moves anything: heading
     size, quote bar and margins, list spacing with hung markers,
     paragraph justification. Images and display math also stay rendered
     under the source (MediaWidget). All of it is display-only.        */
  const HEADING_NODE = /^(?:ATX|Setext)Heading([1-6])$/;
  const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'CommentBlock']);
  const DISPLAY_MATH = /\$\$[\s\S]+?\$\$/g;
  const hangMark = Decoration.mark({ class: 'lp-raw-hang' });
  const lineClass = (cls, style) =>
    Decoration.line(style ? { class: cls, attributes: { style } } : { class: cls });

  function eachLine(doc, from, to, fn) {
    for (let n = doc.lineAt(from).number, last = doc.lineAt(to).number; n <= last; n++) fn(doc.line(n), n, last);
  }

  /* Quote: bar + indent on every line, the paragraph margins as padding on
     the first/last line, the first `>` of each line hung in the indent. */
  function decorateQuote(doc, from, to, out) {
    eachLine(doc, from, to, (line, n, last) => {
      let cls = 'lp-raw-quote';
      if (line.from === doc.lineAt(from).from) cls += ' lp-raw-quote-first';
      if (n === last) cls += ' lp-raw-quote-last';
      out.push(lineClass(cls).range(line.from));
      const m = /^ {0,3}> ?/.exec(line.text);
      if (m) out.push(hangMark.range(line.from, line.from + m[0].length));
    });
  }

  /* List: every line indented to its item's rendered text x (prose-lg:
     1.5556em of the prose base for the outer list + 0.4444em item padding,
     2em more per nesting level), the marker (with any indentation before
     it) hung in that indent. Tight lists also get the item margins as
     padding: 0.15em between items, 0.8889em around a nested list, and at
     the list's end. Loose lists keep their blank lines as the gaps.    */
  function decorateList(doc, list, out) {
    const lines = new Map(); // line number → { depth, start, gap, markFrom, markTo }
    const loose = /\n[ \t]*\n/.test(doc.sliceString(list.from, list.to).replace(/\s+$/, ''));
    const walk = (listNode, depth) => {
      let first = true, prevNested = false;
      for (let item = listNode.firstChild; item; item = item.nextSibling) {
        if (item.name !== 'ListItem') continue;
        const s = doc.lineAt(item.from).number;
        const e = doc.lineAt(Math.min(item.to, doc.length)).number;
        for (let n = s; n <= e; n++) lines.set(n, Object.assign(lines.get(n) || {}, { depth }));
        const info = lines.get(s);
        info.start = true;
        info.gap = (depth > 1 && first) || prevNested ? 'nest' : 'item';
        const mark = item.firstChild && item.firstChild.name === 'ListMark' ? item.firstChild : null;
        if (mark) {
          const line = doc.line(s);
          info.markFrom = line.from;
          info.markTo = Math.min(line.to, mark.to + (doc.sliceString(mark.to, mark.to + 1) === ' ' ? 1 : 0));
        }
        let nested = false;
        for (let c = item.firstChild; c; c = c.nextSibling) {
          if (c.name === 'BulletList' || c.name === 'OrderedList') { nested = true; walk(c, depth + 1); }
        }
        first = false;
        prevNested = nested;
      }
    };
    walk(list, 1);
    const lastNo = doc.lineAt(Math.min(list.to, doc.length)).number;
    for (const [n, info] of lines) {
      const hang = `calc(var(--prose-base-size, 1.125rem) * 1.5555556 + ${(0.4444444 + 2 * (info.depth - 1)).toFixed(7)}em)`;
      let cls = 'lp-raw-li';
      if (!loose && info.start) cls += info.gap === 'nest' ? ' lp-raw-li-gap-nest' : ' lp-raw-li-gap';
      if (!loose && n === lastNo) cls += info.depth > 1 ? ' lp-raw-li-end-nest' : ' lp-raw-li-end';
      const line = doc.line(n);
      out.push(lineClass(cls, '--lp-hang: ' + hang).range(line.from));
      if (info.markTo > info.markFrom) out.push(hangMark.range(info.markFrom, info.markTo));
    }
  }

  /* An inline image the renderer will actually draw. A reference image has
     no definition in the snippet, and markdown-it refuses some URLs
     (data:, javascript: — validateLink in core_cm.js), leaving the source
     as text that a preview would only repeat. */
  function renderableImage(text) {
    const m = /\]\(\s*<?([^\s)>]*)/.exec(text);
    if (!m) return false;
    try { return typeof md === 'undefined' || !md.validateLink || md.validateLink(m[1]); } catch (_) { return false; }
  }

  /* The images and display math of a block, as markdown source for the
     MediaWidget ('' when there are none). Code never contributes. */
  function mediaSource(state, node) {
    if (CODE_NODES.has(node.name)) return '';
    const doc = state.doc;
    const parts = [];
    syntaxTree(state).iterate({
      from: node.from, to: node.to,
      enter: (n) => {
        if (n.from < node.from || n.to > node.to) return undefined;
        if (CODE_NODES.has(n.name)) return false;
        if (n.name === 'Image') {
          const text = doc.sliceString(n.from, n.to);
          if (renderableImage(text)) parts.push(text);
          return false;
        }
        return undefined;
      },
    });
    if (node.name === 'Paragraph') {
      for (const m of doc.sliceString(node.from, node.to).matchAll(DISPLAY_MATH)) parts.push(m[0]);
    }
    return parts.join('\n\n');
  }

  function decorateRaw(state, node, from, to, out) {
    const doc = state.doc;
    const h = HEADING_NODE.exec(node.name);
    if (h) out.push(lineClass('lp-raw-h' + h[1]).range(from)); // setext: its text line; the underline stays plain
    else if (node.name === 'Paragraph') eachLine(doc, from, to, (line) => out.push(lineClass('lp-raw-p').range(line.from)));
    else if (node.name === 'Blockquote') decorateQuote(doc, from, to, out);
    else if (node.name === 'BulletList' || node.name === 'OrderedList') decorateList(doc, node, out);
    const media = mediaSource(state, node);
    if (media) out.push(Decoration.widget({ widget: new MediaWidget(media), block: true, side: 1 }).range(to));
  }

  /* ── Block segmentation + decoration build ───────────────────────── */
  /* The part of a top-level node below the frontmatter, as a block of its
     own, or null. The parser knows no frontmatter, so a node can start
     inside it and run past its end: a `...` closer lets the next line
     join a paragraph, and an HTML line or a code fence in a `|` value
     swallows the body below. That body still renders — as ONE block, the
     rest of the node, since the tree has nothing finer there. */
  function belowFrontmatter(doc, node, fmEnd) {
    const end = Math.min(node.to, doc.length);
    if (end <= fmEnd || fmEnd >= doc.length) return null;
    let line = doc.lineAt(fmEnd + 1);
    while (!line.text.trim() && line.to < end) line = doc.line(line.number + 1);
    if (line.from >= end || !line.text.trim()) return null;
    return { name: 'BelowFrontmatter', from: line.from, to: end };
  }

  /* `frozen` (the reveal set while a mouse button is down, see the field)
     overrides the reveal rule: exactly those blocks are raw.
     `yamlCollapsed`: the frontmatter sheet is folded (YamlWidget). */
  function buildBlocks(state, frozen, yamlCollapsed) {
    const doc = state.doc;
    const ranges = [];
    const blockRanges = [];
    const revealed = [];   // blocks shown raw, for the layout anchor's flip test
    const fmEnd = frontmatterEnd(doc);
    const sel = state.selection;
    const shown = (from, to, linear) => (frozen
      ? frozen.some((r) => r.from === from && r.to === to)
      : isRevealed(sel, from, to, linear));

    const tree = syntaxTree(state);
    for (let top = tree.topNode.firstChild; top; top = top.nextSibling) {
      const node = top.from < fmEnd ? belowFrontmatter(doc, top, fmEnd) : top;
      if (!node) continue;                  // inside the frontmatter (rendered below)
      if (KEEP_RAW.has(node.name)) continue;
      const from = doc.lineAt(node.from).from;
      const to = doc.lineAt(Math.min(node.to, doc.length)).to;
      if (to <= from) continue;
      blockRanges.push({ from, to, linear: true });
      if (shown(from, to, true)) {           // being edited — raw, in its rendered geometry
        revealed.push({ from, to });
        decorateRaw(state, node, from, to, ranges);
        continue;
      }
      ranges.push(Decoration.replace({
        widget: new BlockWidget(doc.sliceString(from, to)),
        block: true,
      }).range(from, to));
    }

    /* Frontmatter: rendered as the preview's "Properties" sheet when
       not being edited (parity with reader mode); dim raw lines while
       the cursor is inside it.                                        */
    if (fmEnd) {
      blockRanges.push({ from: 0, to: fmEnd, linear: false });
      const fmShown = shown(0, fmEnd, false);
      if (fmShown) revealed.push({ from: 0, to: fmEnd });
      if (!fmShown) {
        ranges.push(Decoration.replace({
          widget: new YamlWidget(doc.sliceString(0, fmEnd), yamlCollapsed),
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
    return { deco: Decoration.set(ranges, true), blockRanges, revealed };
  }

  let _warnedOnce = false;
  function safeBuildBlocks(state, frozen, yamlCollapsed) {
    let value;
    try {
      value = buildBlocks(state, frozen, yamlCollapsed);
    } catch (err) {
      if (!_warnedOnce) {
        _warnedOnce = true;
        console.warn('[LivePreview] block build failed — rendering raw markdown:', err);
      }
      value = { deco: Decoration.none, blockRanges: [], revealed: [] };
    }
    value.frozen = frozen || null;
    value.yamlCollapsed = yamlCollapsed;
    return value;
  }

  /* While a mouse button is down the reveal set is FROZEN: the layout
     never changes under a pressed pointer, and the click that reveals a
     block (and re-renders the one that was being edited) takes effect on
     release. CodeMirror maps every pointer move of a gesture against the
     layout on screen at that moment and has no drag threshold for a plain
     click, so a reveal at mousedown turned 1–2 px of involuntary jitter
     into a selection of whatever raw text had moved under the pointer —
     often reaching backwards, above the click (measured: 87 of 131
     clicks). Set and thawed by lpMouseSelection; any edit also thaws. */
  const freezeEffect = StateEffect.define();
  /* Folds (true) / unfolds the frontmatter sheet — toggleYamlCollapsed. */
  const yamlCollapseEffect = StateEffect.define();

  const blockField = StateField.define({
    create(state) { return safeBuildBlocks(state, null, !!window.yamlPropsCollapsed); },
    update(value, tr) {
      let frozen = value.frozen;
      let collapsed = value.yamlCollapsed;
      for (const e of tr.effects) {
        if (e.is(freezeEffect)) frozen = e.value ? (value.frozen || value.revealed) : null;
        else if (e.is(yamlCollapseEffect)) collapsed = !!e.value;
      }
      if (tr.docChanged) frozen = null; // an edit is never hidden inside a rendered block
      if (tr.docChanged || frozen !== value.frozen || collapsed !== value.yamlCollapsed) {
        return safeBuildBlocks(tr.state, frozen, collapsed);
      }
      /* The parser finishes large documents in idle time, AFTER the
         transaction that changed the text: a new tree means blocks the
         previous build could not see yet.                             */
      if (syntaxTree(tr.state) !== syntaxTree(tr.startState)) return safeBuildBlocks(tr.state, frozen, collapsed);
      if (tr.selection && !frozen) {
        /* Rebuild only when some block's rendered/raw status flips. */
        const flipped = value.blockRanges.some((b) =>
          isRevealed(tr.state.selection, b.from, b.to, b.linear)
            !== isRevealed(tr.startState.selection, b.from, b.to, b.linear));
        if (flipped) return safeBuildBlocks(tr.state, null, collapsed);
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

  /* The DOM of every block widget — never the media preview under an
     edited block, which is not a block of its own. */
  const BLOCK_WRAPS = '.lp-render:not(.lp-below > .lp-render), .lp-yaml';

  /* One of our block widgets containing `target`, if it is in this view. */
  function wrapOf(view, target) {
    const wrap = (target && target.closest) ? target.closest('.lp-render, .lp-yaml') : null;
    return (wrap && !wrap.closest('.lp-below') && view.contentDOM.contains(wrap)) ? wrap : null;
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

  /* Click inside the YAML Properties sheet → source position. A row
     carries data-start = doc offset of its key's line; the cursor lands
     at the start of that key's first value so the suggestions menu opens
     with the full value list for exactly that key. Beside or between
     rows the nearest row counts; below the last row (the sheet's bottom
     margin) or anywhere on a folded sheet the click lands outside the
     frontmatter, like a click on any block's own frame. Only the raw-text
     fallback (no entries) maps by vertical position.                  */
  function posInYamlWidget(view, block, wrap, target, x, y) {
    const doc = view.state.doc;
    let row = target.closest ? target.closest('.yaml-row') : null;
    const rows = wrap.querySelectorAll('.yaml-row');
    if (!row && rows.length && y <= rows[rows.length - 1].getBoundingClientRect().bottom) {
      let best = Infinity;
      for (const r of rows) {
        const rr = r.getBoundingClientRect();
        const d = y < rr.top ? rr.top - y : y > rr.bottom ? y - rr.bottom : 0;
        if (d < best) { best = d; row = r; }
      }
    }
    if (row && row.dataset && row.dataset.start !== undefined) {
      const ds = parseInt(row.dataset.start, 10);
      if (Number.isFinite(ds)) {
        const line = doc.lineAt(Math.max(0, Math.min(ds, doc.length)));
        const colon = line.text.indexOf(':');
        if (colon === -1) return line.from;
        let p = colon + 1;
        while (p < line.text.length && /[\s\[]/.test(line.text[p])) p++;
        return line.from + p;
      }
    }
    if (wrap.querySelector('.yaml-render')) return outsidePos(view, block, wrap.getBoundingClientRect(), y);
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
    for (const wrap of view.contentDOM.querySelectorAll(BLOCK_WRAPS)) {
      const r = wrap.getBoundingClientRect();
      if (y >= r.top && y < r.bottom) return wrap;
    }
    return null;
  }

  /* A pointer at (x, y) over DOM `target` → {pos, bias, anchor, to} when
     it lies on or beside one of our widgets, else null (raw text: the
     caller uses posAtCoords). `anchor`..`to` is the block's range — the
     box whose edge a click keeps in place through the reflow
     (pointerAnchor).
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
    return {
      pos: Math.max(0, Math.min(view.state.doc.length, pos)), bias: 1,
      anchor: block.from, to: block.to, linear: block.linear,
    };
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

  /* Screen y of the top or bottom edge of the line block holding `pos` —
     a rendered block's widget, or a raw line with any media preview
     under it. From CodeMirror's height map, which matches the screen
     because widgets contain their margins (.lp-render CSS); the same
     measure is taken before and after a flip.                         */
  function screenEdge(view, pos, side) {
    const b = view.lineBlockAt(Math.max(0, Math.min(pos, view.state.doc.length)));
    return view.documentTop + (side === 'bottom' ? b.bottom : b.top);
  }

  /* What a click keeps in place through the reflow (keepInPlace),
     measured BEFORE its transaction changes the layout:
       • on raw text: the clicked line's top. Nothing of it changes; the
         block that was being edited re-renders on its own side of it.
       • on a rendered block: its edge on the side with MORE visible text,
         so its change in height moves the side with less — a block low on
         the screen grows or shrinks downward, a block high on the screen
         upward. (With nothing above to scroll, at the start of a note,
         keepInPlace's clamp leaves the top in place instead.)
       • on a block taller than the screen (both edges off screen): the
         clicked row stays under the pointer.                          */
  function pointerAnchor(view, hit, pos, pointerY) {
    if (!hit) {
      const from = view.state.doc.lineAt(pos).from;
      return { pos: from, side: 'top', y: screenEdge(view, from, 'top') };
    }
    const top = screenEdge(view, hit.anchor, 'top');
    const bottom = screenEdge(view, hit.anchor, 'bottom');
    const sr = view.scrollDOM.getBoundingClientRect();
    const above = top - sr.top, below = sr.bottom - bottom;
    if (above < 0 && below < 0) return { pos, side: 'row', y: pointerY };
    if (below <= above) return { pos: hit.anchor, side: 'top', y: top };
    return { pos: hit.to, side: 'bottom', y: bottom };
  }

  /* After a flip the layout reflows: the block entering edit mode swaps
     its rendering for raw lines, the block leaving it re-renders.
     Something on screen moves by the difference; `anchor` says what must
     not: { pos, side: 'top' | 'bottom', y } keeps that edge of pos's line
     block at screen y, { pos, side: 'row', y } keeps pos's row centred on
     y. Scrolls by exactly the remaining displacement, then — never at the
     cost of the caret — by whatever keeps the caret's row visible. Void if
     the document changed in between (file switch).
     WHEN: after CodeMirror's whole measure cycle, not inside it. For a
     height change ABOVE the viewport, CodeMirror's own scroll anchoring
     compensates too — and it runs after every measure request has
     drained, so a correction made in a request doubled it (measured: the
     clicked block jumped by the full collapse of an off-screen block).
     A microtask queued from the cycle's write phase runs once the cycle
     (anchoring included) is complete and still before the browser
     paints: it sees the final layout and corrects only what is left.  */
  function keepInPlace(view, anchor) {
    const doc = view.state.doc;
    view.requestMeasure({
      key: keepInPlace,
      read() { return null; },
      write(_, v) {
        queueMicrotask(() => {
          if (v.state.doc !== doc) return;
          /* The caret first: coordsAtPos flushes any measure still pending
             (a later dispatch's scroll target), so all reads below see the
             final layout. */
          const caret = v.coordsAtPos(v.state.selection.main.head);
          let delta = 0;
          if (anchor.side === 'row') {
            const c = v.coordsAtPos(Math.min(anchor.pos, doc.length), 1);
            if (c) delta = (c.top + c.bottom) / 2 - anchor.y;
          } else {
            delta = screenEdge(v, anchor.pos, anchor.side) - anchor.y;
          }
          const sd = v.scrollDOM;
          const sr = sd.getBoundingClientRect();
          if (caret) {
            const top = caret.top - delta, bottom = caret.bottom - delta;
            if (top < sr.top) delta -= sr.top - top;
            else if (bottom > sr.bottom) delta += bottom - sr.bottom;
          }
          if (Math.abs(delta) < 1) return;
          const max = Math.max(0, sd.scrollHeight - sd.clientHeight);
          sd.scrollTop = Math.max(0, Math.min(max, sd.scrollTop + delta));
        });
      },
    });
  }

  /* ── Layout anchor for every other flip ──────────────────────────────
     Arrow keys, typing, find, undo … flip blocks too: typing on the blank
     line under a paragraph merges it into that paragraph (lazy
     continuation) and reveals it without any click. For all of these the
     caret's line never moves: the block or line the caret is now in
     keeps the edge it was entered from — its top when the caret came from
     above or stayed inside it, its bottom when it came from below — and
     whatever changed height elsewhere moves away from it. The "before"
     geometry comes from a snapshot of the drawn line blocks taken in each
     measure (in update() the height map is already the new one; the
     screen has not scrolled yet, so documentTop still holds). Left alone:
     pointer selections (pointerAnchor handles them), transactions that
     scroll on purpose (a scrollIntoView effect: outline, find, …), and
     reconfigurations (the mode toggle).                               */
  const SCROLL_EFFECT = EditorView.scrollIntoView(0).type;
  function revealChanged(before, after, changes) {
    if (before.revealed.length !== after.revealed.length) return true;
    return before.revealed.some((b, i) =>
      changes.mapPos(b.from, -1) !== after.revealed[i].from || changes.mapPos(b.to, 1) !== after.revealed[i].to);
  }
  const layoutAnchor = ViewPlugin ? ViewPlugin.fromClass(class {
    constructor(view) { this.blocks = null; this.snapshot(view); }
    snapshot(view) {
      view.requestMeasure({ key: this, read: (v) => { this.blocks = v.viewportLineBlocks; } });
    }
    update(u) {
      if ((u.docChanged || u.selectionSet) && this.blocks) this.anchorFlip(u);
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.geometryChanged) this.snapshot(u.view);
    }
    anchorFlip(u) {
      const before = u.startState.field(blockField, false);
      const after = u.state.field(blockField, false);
      if (!before || !after || before === after || !revealChanged(before, after, u.changes)) return;
      if (u.transactions.some((tr) => tr.reconfigured || tr.isUserEvent('select.pointer')
        || tr.effects.some((e) => e.is(SCROLL_EFFECT)))) return;
      const head = u.state.selection.main.head;
      let entry = null;
      for (const b of this.blocks) {
        const from = u.changes.mapPos(b.from, -1), to = u.changes.mapPos(b.to, 1);
        if (head >= from && head <= to) { entry = { b, from, to }; break; }
      }
      if (!entry) return; // the caret left the drawn area: CodeMirror scrolls to it
      const docTop = u.view.documentTop;
      const fromBelow = u.changes.mapPos(u.startState.selection.main.head) > entry.to;
      keepInPlace(u.view, fromBelow
        ? { pos: entry.to, side: 'bottom', y: docTop + entry.b.bottom }
        : { pos: entry.b.widget ? entry.from : head, side: 'top', y: docTop + entry.b.top });
    }
  }) : null;

  /* ── Mouse selection style ───────────────────────────────────────────
     Installed through EditorView.mouseSelectionStyle, so CodeMirror's
     own MouseSelection machinery (document-level move/up listeners,
     autoscroll at the viewport edges, shift-extend, click-inside-
     selection drag detection, focus) drives every gesture; this style
     only decides WHERE a pointer event points:
       • mousedown on (or beside) a rendered widget → the mapped source
         position (click-to-edit; the block reveals through the reveal
         rule) — the side with less visible text takes the reflow
         (pointerAnchor, keepInPlace);
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

  /* Pointer moves closer than this to the press point are jitter, not a
     drag (the usual OS drag threshold). CodeMirror applies none to a
     plain click, so without it a hand's tremor selects a character. */
  const DRAG_SLOP = 4;
  /* Every way a press can end: a release (also outside the window —
     the next move then has no buttons), a lost focus, a native drag. */
  const RELEASE_EVENTS = ['mouseup', 'mousemove', 'blur', 'dragend'];

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
    /* The layout stays frozen until the button is released (freezeEffect),
       so everything the gesture maps — the click, a drag, jitter — maps
       against the layout the user is looking at. Not on the YAML box: the
       frontmatter reveals at once, because its suggestions menu opens on
       the click (yamlClickToComplete). What the click keeps in place
       (pointerAnchor) is measured and applied when the layout actually
       changes — on release, or right away for the YAML box. */
    const freeze = !(widgetHit && widgetHit.linear === false);
    const pin = freeze ? null : pointerAnchor(view, widgetHit, start.pos, event.clientY);
    if (freeze) {
      view.dispatch({ effects: freezeEffect.of(true) });
      const win = view.win || window;
      let lastY = event.clientY;
      const release = (e) => {
        if (e.type === 'mousemove') {
          lastY = e.clientY;
          if (e.buttons !== 0) return;  // still pressed
        }
        for (const t of RELEASE_EVENTS) win.removeEventListener(t, release);
        if (e.type === 'mouseup') lastY = e.clientY;
        const fv = view.state.field(blockField, false);
        if (!fv || !fv.frozen) return;   // an edit thawed it already
        const anchor = pointerAnchor(view, widgetHit, view.state.selection.main.head, lastY);
        view.dispatch({ effects: freezeEffect.of(false), userEvent: 'select.pointer' });
        keepInPlace(view, anchor);
      };
      /* Bubble phase on the window: after CodeMirror's own mouseup
         handling on the document. */
      for (const t of RELEASE_EVENTS) win.addEventListener(t, release);
    }
    let startSel = view.state.selection;
    let pinPending = !freeze;
    let dragging = false;
    /* The document this gesture's positions belong to. A document swap
       (setState) never arrives here as an update, so an update that does
       not start from it means the gesture outlived its document: its
       positions mean nothing any more, and mapping them through the new
       document's changes throws inside the view update. The gesture goes
       inert instead (replaceEditorContent also ends it outright). */
    let gestureDoc = view.state.doc;
    return {
      update(update) {
        if (update.startState.doc !== gestureDoc) { gestureDoc = null; return; }
        gestureDoc = update.state.doc;
        if (update.docChanged) {
          start.pos = update.changes.mapPos(start.pos);
          if (pin) pin.pos = update.changes.mapPos(pin.pos);
          startSel = startSel.map(update.changes);
        }
        if (pinPending && update.selectionSet) {
          pinPending = false;
          keepInPlace(update.view, pin);
        }
      },
      get(curEvent, extend) {
        if (gestureDoc !== view.state.doc) return view.state.selection;
        if (!dragging && !stationary && curEvent !== event
          && Math.hypot(curEvent.clientX - event.clientX, curEvent.clientY - event.clientY) >= DRAG_SLOP) {
          dragging = true;
        }
        const cur = dragging ? queryMove(view, curEvent, start.pos) : start;
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
    view.contentDOM.querySelectorAll(BLOCK_WRAPS).forEach((wrap) => {
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

  /* Also the MEASURE PASS for height estimates: its read phase records
     every drawn widget's height (recordHeights) and the text metrics
     estimateHeight works from. */
  const selectionPainter = ViewPlugin ? ViewPlugin.fromClass(class {
    constructor(view) { this.schedule(view); }
    update(update) {
      if (update.selectionSet || update.docChanged || update.viewportChanged || update.geometryChanged) {
        this.schedule(update.view);
      }
    }
    schedule(view) {
      /* Keyed: repeated scheduling within one measure cycle collapses to one run. */
      view.requestMeasure({
        key: paintSelection,
        read(v) { recordHeights(v); updateMetrics(v); return null; },
        write(_, v) { paintSelection(v); },
      });
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
  /* Whether [from, to] lies under a widget that REPLACES text — a
     rendered block. Line decorations, the hung-marker marks of the block
     being edited and the media preview (a point widget) do not count. */
  function coveredByWidget(state, from, to) {
    const fv = state.field(blockField, false);
    let covered = false;
    if (fv) fv.deco.between(from, to, (a, b, deco) => {
      if (b > a && deco.spec.block) { covered = true; return false; }
    });
    return covered;
  }

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
       fallback for geometry cases the coverage test can't see.     */
    const covered = coveredByWidget(state, target.from, target.to);
    if (!covered && !skips && !stuck) return false;          // default handles it

    /* The landing guess sits on the row the caret enters from: the top
       row going down (column carried over), the BOTTOM row going up (the
       line's end). The re-land below then moves it to the goal column on
       that row. */
    const head = forward ? target.from + Math.min(sel.head - curLine.from, target.length) : target.to;
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
      /* The scroll goes on this guess: it sits on the row the caret enters
         from, so the scroll that the coordsAtPos below flushes is the
         natural one-row step at the viewport edge, and it puts that row
         on screen, where posAtCoords is exact. (The guess used to be the
         TOP row in both directions: entering a wrapped paragraph from
         below scrolled the view to its first row — measured −370 px.) */
      view.dispatch({
        selection: EditorSelection.create([range]),
        scrollIntoView: true,
        userEvent: 'select',
      });
      /* The landing above is a char-offset guess — the target line was
         hidden inside the widget, so its pixels couldn't be measured
         pre-dispatch (going down it carries the column over, going up it
         parks at the line's end). Now that the dispatch has revealed the
         line, re-land at the goal: goalColumn is a pixel x relative to
         contentDOM's left edge, and posAtCoords flushes measurement
         synchronously. Both dispatches share one paint, so there is no
         visible double-move. The line guard means a stray measurement
         can never move the cursor off the intended line.
         The y comes from the DEPARTURE side of the target line: a wrapped
         paragraph is one doc line spanning several visual rows, and
         entering it from below must land on its BOTTOM row. */
      /* Only when the landing REVEALED the line: extending a selection
         into a block leaves it rendered (head never reveals), and over a
         block widget posAtCoords answers with the widget's start or end
         by vertical half — it would fling the head to the block end. */
      const stillCovered = coveredByWidget(view.state, target.from, target.to);
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
    if (layoutAnchor) ext.push(layoutAnchor);
    if (keymap && Prec) {
      ext.push(Prec.high(keymap.of([
        { key: 'ArrowDown', run: (v) => moveByDocLine(v, true, false), shift: (v) => moveByDocLine(v, true, true) },
        { key: 'ArrowUp', run: (v) => moveByDocLine(v, false, false), shift: (v) => moveByDocLine(v, false, true) },
      ])));
    }
    return ext;
  };
})();
