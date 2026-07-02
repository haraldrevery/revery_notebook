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
  const { Decoration, ViewPlugin, syntaxTree } = CM;

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

          const headingCls = HEADING_LINE[name];
          if (headingCls) addLineClass(node.from, headingCls);
          else if (name === 'Blockquote')  addBlockLines(node, vr, 'lp-quote');
          else if (name === 'FencedCode')  addBlockLines(node, vr, 'lp-codeblock');

          const styleCls = INLINE_STYLE[name];
          if (styleCls && node.to > node.from) {
            ranges.push(markDeco(styleCls).range(node.from, node.to));
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
