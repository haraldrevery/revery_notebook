/* markdown_editor_livepreview.js — Obsidian-style live preview, phase 1.
 * Design: LIVE_PREVIEW_DESIGN.md.
 *
 * Formatting renders inside the editor via CodeMirror DECORATIONS ONLY:
 * the document text is never modified, so saving, autosave, crash backup,
 * find/replace and undo all operate on the raw markdown unchanged. The
 * failure mode of anything in this file is visual, never data loss — and
 * buildDecorations is wrapped so an unexpected error degrades to "no
 * decorations" rather than a broken editor.
 *
 * Reveal rule: syntax marks stay VISIBLE on any line that intersects a
 * selection range (the line being edited), and are hidden elsewhere. When
 * in doubt, show the marks.
 *
 * This file only defines window.buildLivePreviewExtension(). Installation
 * is owned by menus.js (setLivePreviewMode) through the compartment hook
 * window.setLivePreviewExtension() in cm_setup.js.
 */

(function () {
  'use strict';
  if (typeof CM === 'undefined' || !CM.ViewPlugin || !CM.syntaxTree) {
    console.warn('[LivePreview] CM bundle lacks required exports — feature unavailable.');
    return;
  }
  const { Decoration, ViewPlugin, WidgetType, syntaxTree } = CM;

  /* Node-type tables (names from the lezer markdown grammar). */
  const HEADING_LINE = {
    ATXHeading1: 'lp-h1', ATXHeading2: 'lp-h2', ATXHeading3: 'lp-h3',
    ATXHeading4: 'lp-h4', ATXHeading5: 'lp-h5', ATXHeading6: 'lp-h6',
    SetextHeading1: 'lp-h1', SetextHeading2: 'lp-h2',
  };
  const INLINE_STYLE = {
    Emphasis: 'lp-em', StrongEmphasis: 'lp-strong', Strikethrough: 'lp-strike',
    InlineCode: 'lp-code', Link: 'lp-link', Image: 'lp-link',
  };
  /* Syntax marks hidden outside the selection's lines. URL is listed but
     additionally guarded below: only inside Link/Image (an Autolink's URL
     IS its visible content and must never be hidden). */
  const HIDE = new Set([
    'HeaderMark', 'EmphasisMark', 'CodeMark', 'StrikethroughMark',
    'LinkMark', 'URL', 'QuoteMark',
  ]);

  const lineDecoCache = {};
  function lineDeco(cls) {
    return lineDecoCache[cls] || (lineDecoCache[cls] = Decoration.line({ class: cls }));
  }
  const markDecoCache = {};
  function markDeco(cls) {
    return markDecoCache[cls] || (markDecoCache[cls] = Decoration.mark({ class: cls }));
  }
  const hideDeco = Decoration.replace({});

  /* ── Phase-2 widgets ──────────────────────────────────────────────────
     Inline widgets only: CodeMirror forbids BLOCK decorations from view
     plugins, so the image renders as an inline element that grows its
     line — visually equivalent for the common image-on-its-own-line case. */
  class HrWidget extends WidgetType {
    toDOM() {
      const el = document.createElement('span');
      el.className = 'lp-hr';
      return el;
    }
    eq() { return true; }
  }
  const hrDeco = Decoration.replace({ widget: new HrWidget() });

  class BulletWidget extends WidgetType {
    toDOM() {
      const el = document.createElement('span');
      el.className = 'lp-bullet';
      el.textContent = '•';
      return el;
    }
    eq() { return true; }
  }
  const bulletDeco = Decoration.replace({ widget: new BulletWidget() });

  class ImageWidget extends WidgetType {
    constructor(src, alt) { super(); this.src = src; this.alt = alt; }
    eq(other) { return other.src === this.src && other.alt === this.alt; }
    toDOM() {
      const wrap = document.createElement('span');
      wrap.className = 'lp-image-widget';
      const img = document.createElement('img');
      img.alt = this.alt;
      img.onerror = () => {
        const fb = document.createElement('span');
        fb.className = 'lp-image-fallback';
        fb.textContent = '[image: ' + (this.alt || this.src) + ']';
        wrap.replaceChildren(fb);
      };
      img.src = this.src;
      wrap.appendChild(img);
      return wrap;
    }
    ignoreEvent() { return true; }
  }

  /* Copy button for fenced code blocks — parity with the classic
     preview's postProcessCodeBlocks button. Reuses the same
     .code-copy-btn class, ::after label variables and .is-copied
     feedback, and the same clipboard strategy (navigator.clipboard
     with an execCommand fallback). ignoreEvent() keeps CodeMirror's
     own mouse handling away from the button.                          */
  class CopyWidget extends WidgetType {
    constructor(text) { super(); this.text = text; }
    eq(other) { return other.text === this.text; }
    toDOM() {
      const btn = document.createElement('button');
      btn.className = 'code-copy-btn';
      btn.title = 'Copy code to clipboard';
      const text = this.text;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const fallbackCopy = (str) => {
          const ta = document.createElement('textarea');
          ta.value = str;
          ta.style.top = '0'; ta.style.left = '0'; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus(); ta.select();
          let ok = false;
          try { ok = document.execCommand('copy'); } catch (_) {}
          document.body.removeChild(ta);
          return ok;
        };
        const handleFeedback = (ok) => {
          if (ok) {
            btn.classList.add('is-copied');
            setTimeout(() => btn.classList.remove('is-copied'), 1600);
          } else {
            console.warn('Copy failed.');
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
      return btn;
    }
    ignoreEvent() { return true; }
  }

  /* Task-list checkbox. Clicking toggles [ ] <-> [x] in the DOCUMENT via
     a normal editor transaction — a user-initiated edit like any
     keystroke: it flows through undo, dirty-tracking and autosave. The
     marker text is re-read at click time (via posAtDOM) and validated,
     so a stale widget can never corrupt anything.                     */
  class TaskWidget extends WidgetType {
    constructor(checked) { super(); this.checked = checked; }
    eq(other) { return other.checked === this.checked; }
    toDOM() {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'lp-task-checkbox';
      box.checked = this.checked;
      box.addEventListener('click', (e) => {
        e.preventDefault(); // the doc edit drives the visual state
        const view = window.cmView;
        if (!view) return;
        let pos;
        try { pos = view.posAtDOM(box); } catch (_) { return; }
        const marker = view.state.doc.sliceString(pos, pos + 3);
        if (!/^\[[ xX]\]$/.test(marker)) return; // not where we thought — abort
        const next = marker === '[ ]' ? '[x]' : '[ ]';
        view.dispatch({ changes: { from: pos, to: pos + 3, insert: next } });
      });
      return box;
    }
    ignoreEvent() { return false; } // let the click reach the checkbox
  }
  /* The checkbox rides ON the replace decoration (like the hr widget) —
     a separate point widget at the edge of a replaced range would be
     swallowed by it. */
  const taskDoneDeco = Decoration.replace({ widget: new TaskWidget(true) });
  const taskTodoDeco = Decoration.replace({ widget: new TaskWidget(false) });
  const taskLineDone = Decoration.line({ class: 'lp-task-done' });

  /* Resolve an image reference exactly like the classic preview does
     (postProcessImages in markdown_editor_core_cm.js): absolute schemes
     pass through; in desktop mode relative paths resolve against the
     active file's directory (else the project root) and MUST stay inside
     the project root — Electron serves unrestricted file:// URLs, so the
     containment guard is a security property, not a nicety. Web mode
     leaves relative paths for the browser, same as the preview.        */
  function resolveImageSrc(raw) {
    if (!raw) return null;
    if (/^(https?:|data:|file:|asset:|tauri:)/i.test(raw)) return raw;
    if (!(window.NativeAPI && window.NativeAPI.isDesktop)) return raw;
    if (typeof resolveRelPath !== 'function') return null;
    const activePath = (typeof window.sidebarGetActiveFilePath === 'function')
      ? window.sidebarGetActiveFilePath() : null;
    const rootPath = (typeof window.sidebarGetRootPath === 'function')
      ? window.sidebarGetRootPath() : null;
    const baseDir = activePath
      ? activePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
      : (rootPath || '').replace(/\\/g, '/');
    if (!baseDir || !rootPath) return null;
    const abs = resolveRelPath(baseDir, raw);
    const normRoot = rootPath.replace(/\\/g, '/').replace(/\/$/, '');
    const normAbs  = abs.replace(/\\/g, '/');
    if (!normAbs.startsWith(normRoot + '/') && normAbs !== normRoot) return null;
    return window.NativeAPI.toMediaUrl(abs);
  }

  /* ── KaTeX math ───────────────────────────────────────────────────────
     The lezer markdown parser has no math syntax, so $…$ / $$…$$ are
     found by a conservative scanner over the visible text (excluding
     code contexts and the YAML frontmatter) and rendered through the
     globally loaded KaTeX — the same engine the classic preview uses.
     Stability rules: throwOnError:false, every render wrapped, and any
     failure falls back to the raw text. Multi-line $$ blocks stay raw
     (replace decorations may not cross lines from a view plugin); the
     classic preview remains the full renderer for those.              */
  class MathWidget extends WidgetType {
    constructor(tex, display) { super(); this.tex = tex; this.display = display; }
    eq(other) { return other.tex === this.tex && other.display === this.display; }
    toDOM() {
      const el = document.createElement('span');
      el.className = this.display ? 'lp-math lp-math-block' : 'lp-math';
      try {
        el.innerHTML = katex.renderToString(this.tex, {
          throwOnError: false,
          displayMode: this.display,
        });
      } catch (_) {
        el.textContent = this.display ? '$$' + this.tex + '$$' : '$' + this.tex + '$';
      }
      return el;
    }
    ignoreEvent() { return true; }
  }

  const MATH_RE = /\$\$([^$\n]+?)\$\$|\$([^$\n]+?)\$/g;

  /* End offset of a YAML frontmatter block at the very start of the doc,
     or 0. CommonMark would otherwise misparse it: the fences become
     thematic breaks and 'key: value' + '---' becomes a Setext heading. */
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

  /** Line numbers touched by any selection range — marks stay visible there. */
  function selectionLines(state) {
    const lines = new Set();
    for (const r of state.selection.ranges) {
      const a = state.doc.lineAt(r.from).number;
      const b = state.doc.lineAt(r.to).number;
      for (let n = a; n <= b; n++) lines.add(n);
    }
    return lines;
  }

  function buildDecorations(view) {
    const state    = view.state;
    const doc      = state.doc;
    const revealed = selectionLines(state);
    const ranges   = [];
    const seenLineDeco = new Set(); // `${lineNumber}:${cls}` — one line deco per class
    const fmEnd      = frontmatterEnd(doc);
    const codeRanges = []; // math must never render inside code contexts

    const addLineClass = (lineFrom, cls) => {
      const line = doc.lineAt(lineFrom);
      const key = line.number + ':' + cls;
      if (seenLineDeco.has(key)) return;
      seenLineDeco.add(key);
      ranges.push(lineDeco(cls).range(line.from));
    };

    /* Apply a line class to every line a block node covers (clamped to the
       visible range so huge code blocks stay cheap). */
    const addBlockLines = (node, vr, cls) => {
      let pos = Math.max(node.from, vr.from);
      const end = Math.min(node.to, vr.to);
      for (;;) {
        const line = doc.lineAt(pos);
        addLineClass(line.from, cls);
        if (line.to >= end || line.to >= doc.length) break;
        pos = line.to + 1;
      }
    };

    for (const vr of view.visibleRanges) {
      syntaxTree(state).iterate({
        from: vr.from,
        to: vr.to,
        enter: (node) => {
          const name = node.name;

          /* YAML frontmatter is a protected region: no decorations at
             all (prevents the hr / Setext-heading misparse); its lines
             get a dim mono style below instead.                       */
          if (fmEnd && node.from < fmEnd) return;

          if (name === 'FencedCode' || name === 'InlineCode') {
            codeRanges.push([node.from, node.to]);
          }

          const headingCls = HEADING_LINE[name];
          if (headingCls) addLineClass(node.from, headingCls);
          else if (name === 'Blockquote')  addBlockLines(node, vr, 'lp-quote');
          else if (name === 'FencedCode') {
            addBlockLines(node, vr, 'lp-codeblock');
            /* Copy button on the opening fence line (one per block even
               when the block spans multiple visible ranges). Copied text
               is the block content without the fence lines.            */
            const firstLine = doc.lineAt(node.from);
            const lastLine  = doc.lineAt(Math.min(node.to, doc.length));
            const copyKey   = firstLine.from + ':copy';
            if (lastLine.number > firstLine.number && !seenLineDeco.has(copyKey)) {
              seenLineDeco.add(copyKey);
              const innerFrom = Math.min(firstLine.to + 1, node.to);
              const innerTo   = Math.max(lastLine.from - 1, innerFrom);
              ranges.push(Decoration.widget({
                widget: new CopyWidget(doc.sliceString(innerFrom, innerTo)),
                side: 1,
              }).range(firstLine.to));
            }
          }

          const styleCls = INLINE_STYLE[name];
          if (styleCls && node.to > node.from) {
            ranges.push(markDeco(styleCls).range(node.from, node.to));
          }

          if (name === 'HorizontalRule') {
            if (!revealed.has(doc.lineAt(node.from).number) && node.to > node.from) {
              ranges.push(hrDeco.range(node.from, node.to));
            }
            return;
          }

          if (name === 'ListMark') {
            const text = doc.sliceString(node.from, node.to);
            if (/^[-*+]$/.test(text) && !revealed.has(doc.lineAt(node.from).number)) {
              /* '- [ ] task': the checkbox replaces the whole marker pair —
                 hide the list dash (and its space) instead of a bullet.  */
              if (/^ \[[ xX]\]/.test(doc.sliceString(node.to, node.to + 4))) {
                ranges.push(hideDeco.range(node.from, node.to + 1));
              } else {
                ranges.push(bulletDeco.range(node.from, node.to));
              }
            }
            return;
          }

          if (name === 'TaskMarker') {
            const line = doc.lineAt(node.from);
            if (revealed.has(line.number)) return; // raw '[ ]' while editing
            const marker = doc.sliceString(node.from, node.to);
            const done = /x/i.test(marker);
            /* Replace '[ ]' (and one following space) with the checkbox. */
            let to = node.to;
            if (to < line.to && doc.sliceString(to, to + 1) === ' ') to++;
            ranges.push((done ? taskDoneDeco : taskTodoDeco).range(node.from, to));
            if (done) ranges.push(taskLineDone.range(line.from));
            return;
          }

          if (name === 'Image') {
            /* Render the actual image after the syntax (which the phase-1
               mark hiding collapses to the alt text off-line). The widget
               stays even while the line is selected — Obsidian behavior. */
            const m = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?/.exec(doc.sliceString(node.from, node.to));
            if (m) {
              const src = resolveImageSrc(m[2]);
              if (src) {
                ranges.push(Decoration.widget({
                  widget: new ImageWidget(src, m[1] || ''),
                  side: 1,
                }).range(node.to));
              }
            }
            /* fall through: Image is also in INLINE_STYLE (handled above) */
          }

          if (!HIDE.has(name)) return;

          /* Never hide a fence line's backticks — the code block keeps its
             raw delimiters (phase-1 honesty; see design §3). */
          const parent = node.node.parent;
          if (name === 'CodeMark' && parent && parent.name === 'FencedCode') return;
          /* An Autolink's URL is its visible text. Only hide URLs that are
             the target part of a [text](url) link or image. */
          if (name === 'URL' && !(parent && (parent.name === 'Link' || parent.name === 'Image'))) return;

          const line = doc.lineAt(node.from);
          if (revealed.has(line.number)) return; // editing here — marks visible

          let to = node.to;
          /* Swallow the single space after "#"/">" so headings and quotes
             don't sit one phantom column to the right. */
          if ((name === 'HeaderMark' || name === 'QuoteMark')
              && to < line.to && doc.sliceString(to, to + 1) === ' ') {
            to++;
          }
          if (to > node.from) ranges.push(hideDeco.range(node.from, to));
        },
      });
    }

    /* Frontmatter lines: dim mono, applied to whichever of them are visible. */
    if (fmEnd) {
      const vFrom = view.visibleRanges.length ? view.visibleRanges[0].from : 0;
      let pos = Math.min(vFrom, fmEnd);
      for (;;) {
        const line = doc.lineAt(pos);
        if (line.from >= fmEnd) break;
        addLineClass(line.from, 'lp-frontmatter');
        if (line.to >= doc.length) break;
        pos = line.to + 1;
      }
    }

    /* Math scan over the visible text, outside code and frontmatter. */
    for (const vr of view.visibleRanges) {
      const text = doc.sliceString(vr.from, vr.to);
      MATH_RE.lastIndex = 0;
      let m;
      while ((m = MATH_RE.exec(text)) !== null) {
        const from = vr.from + m.index;
        const to   = from + m[0].length;
        const tex  = m[1] !== undefined ? m[1] : m[2];
        const display = m[1] !== undefined;
        if (from < fmEnd) continue;
        if (from > 0 && doc.sliceString(from - 1, from) === '\\') continue; // escaped \$
        /* texmath-style validity for single-$: content must not start or
           end with whitespace (keeps '5$ and 10$' as plain currency). */
        if (!display && (/^\s/.test(tex) || /\s$/.test(tex))) continue;
        if (codeRanges.some(([a, b]) => from < b && to > a)) continue;
        if (revealed.has(doc.lineAt(from).number)) continue;
        ranges.push(Decoration.replace({ widget: new MathWidget(tex, display) }).range(from, to));
      }
    }

    /* sort:true — mixed line/mark/replace ranges arrive out of order. */
    return Decoration.set(ranges, true);
  }

  let _warnedOnce = false;
  function safeBuild(view) {
    try {
      return buildDecorations(view);
    } catch (err) {
      if (!_warnedOnce) {
        _warnedOnce = true;
        console.warn('[LivePreview] decoration build failed — rendering raw markdown:', err);
      }
      return Decoration.none;
    }
  }

  const livePreviewPlugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.decorations = safeBuild(view);
    }
    update(update) {
      if (update.view.composing) {
        /* IME composition in progress: never rebuild under the composer,
           but keep positions valid by mapping through the changes. */
        this.decorations = this.decorations.map(update.changes);
        return;
      }
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = safeBuild(update.view);
      }
    }
  }, {
    decorations: (v) => v.decorations,
  });

  window.buildLivePreviewExtension = function () {
    return [livePreviewPlugin];
  };
})();
