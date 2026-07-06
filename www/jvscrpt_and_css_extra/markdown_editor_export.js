/* markdown_editor_export.js — PDF + LaTeX-project export with options.
 *
 * Owns the "Export options" popup and the two heavyweight exporters, so
 * actions_cm.js keeps only thin dispatch (the file was getting bloated —
 * this module exists at Harald's request).
 *
 *   PDF   — print pipeline: a self-contained document built from the
 *           PREVIEW's rendered HTML (KaTeX → MathML, hljs colors kept),
 *           options applied as print CSS (@page size/margins, font size,
 *           optional front page + clickable TOC). Electron prints it to
 *           a real vector PDF (main-process printToPDF); Tauri and web
 *           print via a hidden same-origin iframe → the system dialog's
 *           "Save as PDF".
 *   LaTeX — the markdown→LaTeX converter (moved here from actions_cm.js)
 *           extended with engine/template/titlepage/TOC options; project
 *           images are collected, deduped and rewritten to images/<name>
 *           so the export becomes a ready-to-compile zip project
 *           (main.tex + images/). Web mode falls back to a single-.tex
 *           download.
 *
 * Option state persists in its own localStorage key (revery_export_
 * settings) — deliberately NOT part of menus.js's settings object.
 */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════
     OPTION STATE
  ══════════════════════════════════════════════════════════════════ */

  const SETTINGS_KEY = 'revery_export_settings';

  const DEFAULTS = {
    pdf: {
      frontPage: false,          // user-specified default: off
      frontTitle: '',            // '' → doc title at export time
      frontAuthor: '',           // '' → frontmatter author at export time
      frontImage: null,          // data URL, low opacity
      frontOpacity: 0.18,
      frontLayout: 'center',     // 'center' | 'corners'
      toc: false,                // user-specified default: off
      format: 'article',         // 'article' (symmetric) | 'book' (mirrored)
      marginPreset: 'normal',    // 'narrow' | 'normal' | 'wide'
      fontPt: 11,                // 9 | 10 | 11 | 12
      font: 'serif',             // serif|sans|mono|harald-text|harald-mono
      pageSize: 'A4',            // 'A4' | 'A5' | 'A6' | 'Letter'
      newPageH1: false,          // new page before every # / H1
      newPageH2: false,          // new page before every ## / H2
      pageNumbers: false,
      coverCounts: false,        // front page counted in the page numbers
    },
    latex: {
      engine: 'pdflatex',        // 'pdflatex' | 'xelatex'
      template: 'article',       // 'article' | 'report' | 'book'
      titlePage: true,
      toc: false,
    },
  };

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return {
        pdf: Object.assign({}, DEFAULTS.pdf, raw.pdf || {}),
        latex: Object.assign({}, DEFAULTS.latex, raw.latex || {}),
      };
    } catch (_) {
      return { pdf: Object.assign({}, DEFAULTS.pdf), latex: Object.assign({}, DEFAULTS.latex) };
    }
  }
  const exportSettings = loadSettings();

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(exportSettings)); } catch (_) {}
  }

  const T = (s) => (typeof window.t === 'function' ? window.t(s) : s);

  /* ── Shared metadata helpers ─────────────────────────────────────── */

  function readFrontmatterMeta() {
    const meta = { title: '', author: '', date: '' };
    const m = editor.value.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (m) {
      const get = (key) => {
        const mm = m[1].match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'm'));
        return mm ? mm[1] : '';
      };
      meta.title = get('title');
      meta.author = get('author');
      meta.date = get('date');
    }
    return meta;
  }

  function exportBaseName() {
    let baseName = (docTitle.value.trim() || 'untitled')
      .replace(/\s+/g, '-').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').toLowerCase();
    return baseName || 'untitled';
  }

  /* ══════════════════════════════════════════════════════════════════
     LATEX DOCUMENT BUILDER
     Moved from actions_cm.js (exportLatexFile) and extended with the
     options + project-image collection. Pure: returns strings/lists,
     never touches disk.
  ══════════════════════════════════════════════════════════════════ */

  function buildLatexDocument(opts) {
    opts = Object.assign({}, DEFAULTS.latex, opts || {});
    let raw = editor.value;

    /* ── 1. Extract YAML frontmatter metadata ── */
    let metaTitle  = docTitle.value.trim() || 'Untitled';
    let metaDate   = '\\today';
    let metaAuthor = '';

    const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (frontmatterMatch) {
      const yml = frontmatterMatch[1];
      const ymlGet = (key) => {
        const m = yml.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'm'));
        return m ? m[1] : '';
      };
      if (ymlGet('title'))  metaTitle  = ymlGet('title');
      if (ymlGet('date'))   metaDate   = ymlGet('date');
      if (ymlGet('author')) metaAuthor = ymlGet('author');
      raw = raw.slice(frontmatterMatch[0].length).replace(/^\r?\n/, '');
    }

    /* ── 2. Collect footnote definitions  [^id]: text ── */
    const footnoteMap = {};
    raw = raw.replace(/^\[\^([^\]]+)\]:\s*(.+)$/gm, (_, id, text) => {
      footnoteMap[id.trim()] = text.trim();
      return '';
    });

    /* ── 3. LaTeX special-char escape (prose only) ── */
    function latexEsc(str) {
      if (!str) return '';
      return str
        .replace(/\\/g, '\x00BKSL\x00')
        .replace(/&/g,  '\\&')
        .replace(/%/g,  '\\%')
        .replace(/\$/g, '\\$')
        .replace(/#/g,  '\\#')
        .replace(/_/g,  '\\_')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}')
        .replace(/~/g,  '\\textasciitilde{}')
        .replace(/\^/g, '\\textasciicircum{}')
        .replace(/\x00BKSL\x00/g, '\\textbackslash{}');
    }

    /* ── 4. Protected-block system ── */
    const protectedBlocks = [];
    let   pbIdx = 0;
    const protect = (latexStr) => {
      const ph = `\x02PH${pbIdx++}\x03`;
      protectedBlocks.push({ ph, content: latexStr });
      return ph;
    };
    const restoreProtected = (str) => {
      for (let i = protectedBlocks.length - 1; i >= 0; i--) {
        str = str.split(protectedBlocks[i].ph).join(protectedBlocks[i].content);
      }
      return str;
    };

    /* 4a. Fenced code blocks */
    raw = raw.replace(/```[^\n`]*\n([\s\S]*?)```/g, (_, code) =>
      protect(`\\begin{verbatim}\n${code.replace(/\n+$/, '')}\n\\end{verbatim}`)
    );

    /* 4b. Display math $$…$$ */
    let eqCounter = 0;
    raw = raw.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
      eqCounter++;
      const trimmedMath = math.trim();
      return protect(
        `\\begin{equation}\\label{equation_${eqCounter}}\n${trimmedMath}\n\\end{equation}`
      );
    });

    /* 4c. Inline math $…$ */
    raw = raw.replace(/(?<!\\)\$([^$]+?)\$/g, (_, math) =>
      protect(`$${math}$`)
    );

    /* 4d/e. Bracket math */
    raw = raw.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => protect(`\\[${math}\\]`));
    raw = raw.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => protect(`\\(${math}\\)`));

    /* ── 5. Markdown tables ── */
    let tableIdx = 0;
    raw = raw.replace(
      /^(\|[^\n]+\|[ \t]*\r?\n\|[-| :]+\|[ \t]*\r?\n(?:\|[^\n]+\|[ \t]*\r?\n?)*)/gm,
      (block) => {
        const tlines = block.trim().split(/\r?\n/).filter(l => l.trim().startsWith('|'));
        if (tlines.length < 2) return block;
        const parseRow = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const headers = parseRow(tlines[0]);
        const rows    = tlines.slice(2).map(parseRow);
        const cols    = headers.length;
        tableIdx++;
        let tex = `\\begin{table}[h]\n\\centering\n` +
                      `\\renewcommand{\\arraystretch}{1.8}\n` +
                      `\\begin{tabular}{| ${Array(cols).fill('l').join(' | ')} |}\n\\hline\n`;
        tex    += headers.map(c => `\\textbf{${processInline(c)}}`).join(' & ') + ' \\\\\n\\noalign{\\hrule height 1.2pt}\n';
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          const cells = Array.from({ length: cols }, (_, k) => processInline(row[k] || ''));
          tex += cells.join(' & ') + ' \\\\\n\\hline\n';
        }
        tex += `\\end{tabular}\n` +
               `\\caption{Table ${tableIdx}}\n\\label{table_${tableIdx}}\n\\end{table}`;
        return protect(tex);
      }
    );

    /* ── 6. Block images → figure, COLLECTED for the project zip ──────
       Project-relative sources resolve exactly like postProcessImages
       (active file dir → root containment); each becomes images/<name>
       in the archive (basenames deduped, LaTeX-hostile chars swapped).
       Remote/unresolvable sources keep the old path + advisory note.  */
    const collectedImages = [];
    const usedZipNames = new Set();

    function registerImage(src) {
      let decoded = src;
      try { decoded = decodeURIComponent(src); } catch (_) { /* keep raw */ }
      if (/^(https?:|data:|file:|asset:|tauri:)/i.test(decoded)) return null;
      if (typeof resolveRelPath !== 'function') return null;
      const activePath = (typeof window.sidebarGetActiveFilePath === 'function')
        ? window.sidebarGetActiveFilePath() : null;
      const rootPath = (typeof window.sidebarGetRootPath === 'function')
        ? window.sidebarGetRootPath() : null;
      if (!rootPath) return null;
      const baseDir = activePath
        ? activePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
        : rootPath.replace(/\\/g, '/');
      const abs = resolveRelPath(baseDir, decoded);
      const normRoot = rootPath.replace(/\\/g, '/').replace(/\/$/, '');
      const normAbs  = abs.replace(/\\/g, '/');
      if (!normAbs.startsWith(normRoot + '/') && normAbs !== normRoot) return null;

      /* LaTeX-safe archive name: swap specials/spaces, dedupe. */
      let name = decoded.split('/').pop().replace(/[{}%#&$~^\\\s]+/g, '_');
      if (usedZipNames.has(name)) {
        const dot = name.lastIndexOf('.');
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext  = dot > 0 ? name.slice(dot) : '';
        let n = 2;
        while (usedZipNames.has(`${stem}-${n}${ext}`)) n++;
        name = `${stem}-${n}${ext}`;
      }
      usedZipNames.add(name);
      collectedImages.push({ srcPath: abs, zipName: name });
      return name;
    }

    let imageIdx = 0;
    raw = raw.replace(/^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)\s*$/gm, (_, alt, src) => {
      imageIdx++;
      const zipName = registerImage(src);
      const texPath = zipName ? `images/${zipName}` : src;
      const note = zipName ? [] : [`% NOTE: external/unresolved image — adjust the path for compilation`];
      const tex = [
        `\\begin{figure}[h]`,
        `\\centering`,
        ...note,
        `\\includegraphics[width=0.8\\textwidth]{${texPath}}`,
        `\\caption{${latexEsc(alt || `Figure ${imageIdx}`)}}`,
        `\\label{image_${imageIdx}}`,
        `\\end{figure}`
      ].join('\n');
      return protect(tex);
    });

    /* ── 7. Inline Markdown → LaTeX ── */
    function processInlinePart(text) {
      if (!text) return '';
      const ip  = [];
      let   ii  = 0;
      const iSave = (s) => { const p = `\x04I${ii++}\x05`; ip.push({ p, s }); return p; };

      text = text.replace(/\*\*\*(.+?)\*\*\*/g, (_, t) => iSave(`\\textbf{\\textit{${latexEsc(t)}}}`));
      text = text.replace(/___(.+?)___/g,         (_, t) => iSave(`\\textbf{\\textit{${latexEsc(t)}}}`));
      text = text.replace(/\*\*(.+?)\*\*/g,  (_, t) => iSave(`\\textbf{${latexEsc(t)}}`));
      text = text.replace(/__(.+?)__/g,       (_, t) => iSave(`\\textbf{${latexEsc(t)}}`));
      text = text.replace(/\*([^*\n]+?)\*/g,  (_, t) => iSave(`\\textit{${latexEsc(t)}}`));
      text = text.replace(/(?<![\\a-zA-Z0-9])_([^_\n]+?)_(?![a-zA-Z0-9])/g,
                                              (_, t) => iSave(`\\textit{${latexEsc(t)}}`));
      text = text.replace(/~~(.+?)~~/g,       (_, t) => iSave(`\\sout{${latexEsc(t)}}`));
      text = text.replace(/`([^`\n]+)`/g,     (_, c) => iSave(`\\texttt{${latexEsc(c)}}`));
      text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
                          (_, a, s) => iSave(`\\textit{[Image: ${latexEsc(a || s)}]}`));
      text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
                          (_, t, u) => iSave(`\\href{${u}}{${latexEsc(t)}}`));
      text = text.replace(/\[\^([^\]]+)\]/g, (_, id) => {
        const def = footnoteMap[id.trim()];
        return iSave(`\\footnote{${latexEsc(def || id)}}`);
      });

      text = text.split(/(\x04I\d+\x05)/).map((part, idx) =>
        idx % 2 === 1 ? part : latexEsc(part)
      ).join('');

      for (const { p, s } of ip) text = text.split(p).join(s);
      return text;
    }

    function processInline(text) {
      return text.split(/(\x02PH\d+\x03)/).map((seg, idx) =>
        idx % 2 === 1 ? seg : processInlinePart(seg)
      ).join('');
    }

    /* Setext → ATX */
    raw = raw.replace(/^([^\n\r]+)\r?\n(=+|-+)\s*$/gm, (match, title, border) => {
      if (!title.trim() || title.trim().startsWith('\x02PH')) return match;
      const level = border[0] === '=' ? '#' : '##';
      return `${level} ${title.trim()}`;
    });

    /* ── 8. Block-level parsing ─────────────────────────────────────
       Heading map follows the template: report/book promote H1 to
       \chapter and shift the rest one level down.                   */
    const cmds = (opts.template === 'article')
      ? ['\\section', '\\subsection', '\\subsubsection',
         '\\paragraph', '\\subparagraph', '\\subparagraph']
      : ['\\chapter', '\\section', '\\subsection',
         '\\subsubsection', '\\paragraph', '\\subparagraph'];

    const lines  = raw.split('\n');
    const output = [];
    let i = 0;

    while (i < lines.length) {
      const line    = lines[i];
      const trimmed = line.trim();

      if (/^\x02PH\d+\x03$/.test(trimmed)) { output.push(trimmed); i++; continue; }

      const hm = trimmed.match(/^(#{1,6})(?:\s+(.*?)(?:\s+#+)?)?$/);
      if (hm) {
        const title = hm[2] || '';
        output.push(`${cmds[hm[1].length - 1]}{${processInline(title)}}`);
        i++; continue;
      }

      if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(trimmed)) {
        output.push('\n\\bigskip\\hrule\\bigskip\n');
        i++; continue;
      }

      if (/^>/.test(trimmed)) {
        const qLines = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          qLines.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        const parsedQLines = qLines.map(l => {
          const ht = l.trim().match(/^(#{1,6})(?:\s+(.*?)(?:\s+#+)?)?$/);
          if (ht) {
            const title = ht[2] || '';
            return `${cmds[ht[1].length - 1]}{${processInline(title)}}`;
          }
          return processInline(l);
        });
        output.push(`\\begin{quote}\n${parsedQLines.join('\n')}\n\\end{quote}`);
        continue;
      }

      if (/^\d+\.\s/.test(trimmed)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i++;
        }
        output.push(
          `\\begin{enumerate}\n` +
          items.map(t => `  \\item ${processInline(t)}`).join('\n') +
          `\n\\end{enumerate}`
        );
        continue;
      }

      if (/^[-*+]\s/.test(trimmed)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
          items.push(lines[i]);
          i++;
        }
        const itemLines = items.map(l => {
          const tm = l.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)/);
          if (tm) {
            const checked = tm[1].toLowerCase() === 'x';
            return `  \\item[${checked ? '$\\boxtimes$' : '$\\square$'}] ${processInline(tm[2])}`;
          }
          return `  \\item ${processInline(l.replace(/^\s*[-*+]\s+/, ''))}`;
        });
        output.push(`\\begin{itemize}\n${itemLines.join('\n')}\n\\end{itemize}`);
        continue;
      }

      if (/^\s*$/.test(line)) { output.push(''); i++; continue; }

      output.push(processInline(line));
      i++;
    }

    /* ── 9. Restore protected blocks ── */
    const body = restoreProtected(output.join('\n'));

    /* ── 10. Assemble the .tex document per options ── */
    const engineLines = (opts.engine === 'xelatex')
      ? [`% Compile with xelatex`, `\\usepackage{fontspec}`]
      : [`% Compile with pdflatex`, `\\usepackage[utf8]{inputenc}`, `\\usepackage[T1]{fontenc}`];

    const docParts = [
      `\\documentclass{${opts.template}}`,
      ...engineLines,
      `\\usepackage{amsmath}`,
      `\\usepackage{amssymb}`,
      `\\usepackage{graphicx}`,
      `\\usepackage{hyperref}`,
      `\\usepackage{longtable}`,
      `\\usepackage[normalem]{ulem}`,
      `\\usepackage[a4paper,top=2.5cm,bottom=2.5cm,left=2.5cm,right=2.5cm,marginparwidth=15mm,headheight=14pt]{geometry}`,
      `\\usepackage[font=small,labelfont=bf]{subcaption}`,
      `\\renewcommand\\thesubfigure{(\\alph{subfigure})}`,
      `\\usepackage{multirow}`,
      `\\usepackage{booktabs}`,
      `\\usepackage{xcolor}`,
      `\\usepackage[font=small,labelfont=bf,position=above]{caption}`,
      `\\setlength{\\parindent}{0pt}`,
      `\\setlength{\\parskip}{0.5em}`,
      ``,
      `\\usepackage{microtype}`,
      `\\usepackage{setspace}`,
      `\\setstretch{1.15}`,
      `\\hypersetup{`,
      `  colorlinks=true,`,
      `  linkcolor=blue!60!black,`,
      `  urlcolor=blue!60!black,`,
      `  citecolor=blue!60!black`,
      `}`,
      `\\title{${latexEsc(metaTitle)}}`,
      `\\author{${latexEsc(metaAuthor)}}`,
      `\\date{${metaDate}}`,
      ``,
      `\\begin{document}`,
      /* Title page, then the TOC on its own fresh page (clearpage before
         it when both are on, and after it so body content starts clean). */
      opts.titlePage ? `\\maketitle` : ``,
      (opts.titlePage && opts.toc) ? `\\clearpage` : ``,
      opts.toc ? `\\tableofcontents\n\\clearpage` : ``,
      body.trim(),
      ``,
      `\\end{document}`,
      ``
    ];
    const tex = docParts.join('\n').replace(/\n{3,}/g, '\n\n');

    return { tex, images: collectedImages, baseName: exportBaseName() };
  }

  /* ══════════════════════════════════════════════════════════════════
     PDF PRINT-DOCUMENT BUILDER
  ══════════════════════════════════════════════════════════════════ */

  const MARGIN_MM = { narrow: 12, normal: 20, wide: 30 };

  function cleanProseClone() {
    const proseEl = preview.querySelector('.prose');
    if (!proseEl) return null;
    const clone = proseEl.cloneNode(true);
    clone.querySelectorAll('.code-copy-btn').forEach(btn => btn.remove());
    clone.querySelectorAll('.inline-code-wrapper').forEach(wrapper => {
      const code = wrapper.querySelector('code');
      if (code) wrapper.replaceWith(code);
      else wrapper.replaceWith(...wrapper.childNodes);
    });
    clone.querySelectorAll('[data-sl]').forEach(el => {
      el.removeAttribute('data-sl');
      el.removeAttribute('data-sl-end');
    });
    clone.querySelectorAll('.preview-flash').forEach(el => el.classList.remove('preview-flash'));
    /* KaTeX → native MathML (self-contained: no katex.css needed;
       Chromium and WebKit both render MathML Core in print). */
    clone.querySelectorAll('.katex').forEach(katexEl => {
      const mathTag = katexEl.querySelector('math');
      if (mathTag) {
        Array.from(mathTag.childNodes).forEach(child => {
          if (child.nodeType === Node.TEXT_NODE) child.remove();
        });
        katexEl.replaceWith(mathTag);
      }
    });
    return clone;
  }

  const FONT_STACKS = {
    serif:         "Georgia, 'Times New Roman', serif",
    sans:          "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    mono:          "'HaraldMono', 'Courier New', monospace",
    'harald-text': "'HaraldText', Georgia, serif",
    'harald-mono': "'HaraldMono', 'Courier New', monospace",
  };
  /* A4/A5/A6 are CSS @page size keywords; Letter is 'letter'. */
  const PAGE_SIZE = { A4: 'A4', A5: 'A5', A6: 'A6', Letter: 'letter' };

  /* Build the shared parts (front page, TOC, body) — called once per
     export. Adds anchor ids for TOC links and returns the metadata the
     CSS builder needs. */
  function pdfParts(opts) {
    if (typeof render === 'function') render(); // preview reflects the latest text
    const clone = cleanProseClone();
    if (!clone) return null;

    const meta = readFrontmatterMeta();
    const title = (opts.frontTitle || '').trim() || meta.title || docTitle.value.trim() || 'Untitled';
    const author = (opts.frontAuthor || '').trim() || meta.author || '';

    const headings = [];
    let hid = 0;
    clone.querySelectorAll('h1, h2, h3').forEach((h) => {
      const id = `h-${++hid}`;
      h.id = id;
      headings.push({ id, level: parseInt(h.tagName[1], 10), text: h.textContent });
    });

    let tocHtml = '';
    if (opts.toc && headings.length) {
      const items = headings.map((h) =>
        `<li class="toc-l${h.level}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join('\n');
      tocHtml = `<nav class="toc"><h2>${escapeHtml(T('Contents'))}</h2><ol>\n${items}\n</ol></nav>`;
    }

    let frontHtml = '';
    if (opts.frontPage) {
      /* Full-bleed cover image: an absolutely-positioned layer covering
         the whole (zero-margin, named 'cover') page at the chosen
         opacity, with the title/author overlaid. */
      const img = opts.frontImage
        ? `<div class="fp-bg" style="background-image:url('${opts.frontImage}');opacity:${Number(opts.frontOpacity) || 0.18};"></div>`
        : '';
      frontHtml =
        `<section class="front-page fp-${opts.frontLayout === 'corners' ? 'corners' : 'center'}">` +
        img +
        `<div class="fp-title">${escapeHtml(title)}</div>` +
        (author ? `<div class="fp-author">${escapeHtml(author)}</div>` : '') +
        `</section>`;
    }

    return { title, author, frontHtml, tocHtml, bodyHtml: clone.innerHTML };
  }

  /* Print CSS from the options. `scoped` = true prefixes every content
     rule with #export-print-root (the in-app print path injects into the
     live document and must not leak styles into the app); `@page` rules
     stay global either way. `scoped` also SKIPS @font-face — the in-app
     path already has the brand fonts loaded (same origin), while the
     Electron self-contained document needs them (resolved via <base>). */
  function pdfCss(opts, scoped) {
    const B = scoped ? '#export-print-root' : 'body';       // body-level selector
    const P = scoped ? '#export-print-root ' : '';          // descendant prefix
    const mm = MARGIN_MM[opts.marginPreset] || 20;
    const size = PAGE_SIZE[opts.pageSize] || 'A4';
    const font = FONT_STACKS[opts.font] || FONT_STACKS.serif;

    /* Book format mirrors inner/outer margins on facing pages. */
    const bookMargins = (opts.format === 'book')
      ? `@page :right { margin: ${mm}mm ${Math.max(6, mm - 6)}mm ${mm}mm ${mm + 6}mm; }
@page :left  { margin: ${mm}mm ${mm + 6}mm ${mm}mm ${Math.max(6, mm - 6)}mm; }`
      : '';

    const fontFace = scoped ? '' : `
@font-face { font-family: 'HaraldText'; src: url('fonts/HaraldReveryTextFont.woff2') format('woff2'); font-display: swap; }
@font-face { font-family: 'HaraldMono'; src: url('fonts/HaraldReveryMonoFont.woff2') format('woff2'); font-display: swap; }`;

    /* New page before H1 / H2 (independent toggles). The first content
       block never forces a leading blank page. */
    const breaks =
      (opts.newPageH1 ? `${P}main h1 { break-before: page; }\n` : '') +
      (opts.newPageH2 ? `${P}main h2 { break-before: page; }\n` : '') +
      ((opts.newPageH1 || opts.newPageH2) ? `${P}main > *:first-child { break-before: avoid !important; }\n` : '');

    return `${fontFace}
@page { size: ${size}; margin: ${mm}mm; }
@page cover { margin: 0; }
${bookMargins}
${P}*, ${P}*::before, ${P}*::after { box-sizing: border-box; margin: 0; padding: 0; }
${B} {
  font-family: ${font};
  font-size: ${Number(opts.fontPt) || 11}pt; line-height: 1.6;
  color: #1a1a1a; background: #fff;
}
${P}h1, ${P}h2, ${P}h3, ${P}h4, ${P}h5, ${P}h6 {
  font-weight: 700; line-height: 1.25;
  margin-top: 1.6em; margin-bottom: 0.5em;
  break-after: avoid-page;
}
${P}h1 { font-size: 1.9em; } ${P}h2 { font-size: 1.45em; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
${P}h3 { font-size: 1.2em; } ${P}h4, ${P}h5, ${P}h6 { font-size: 1em; }
${breaks}${P}p { margin-bottom: 1.1em; }
${P}a { color: #1d4ed8; text-decoration: none; }
${P}ul, ${P}ol { margin: 0 0 1.1em 1.6em; }
${P}li { margin-bottom: 0.2em; }
${P}blockquote { border-left: 3px solid #999; margin: 1.3em 0; padding: 0.3em 1.1em; color: #555; font-style: italic; }
${P}code { font-family: 'HaraldMono', 'Courier New', monospace; font-size: 0.88em; background: #f3f4f6; padding: 0.1em 0.35em; border-radius: 3px; }
${P}pre { background: #0d1117; color: #c9d1d9; padding: 1em 1.2em; border-radius: 5px; margin: 1.3em 0; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; break-inside: avoid-page; }
${P}pre code { background: none; padding: 0; color: inherit; font-size: 0.85em; }
${P}table { width: 100%; border-collapse: collapse; margin: 1.3em 0; font-size: 0.92em; break-inside: avoid-page; }
${P}th, ${P}td { border: 1px solid #ccc; padding: 0.4em 0.6em; text-align: left; }
${P}th { background: #f3f4f6; }
${P}img { max-width: 100%; height: auto; display: block; margin: 1.3em auto; }
${P}hr { border: none; border-top: 1px solid #ccc; margin: 1.6em 0; }
${P}math { font-size: 1.05em; }
${P}.front-page { position: relative; height: 100vh; page: cover; page-break-after: always; break-after: page; overflow: hidden; }
${P}.fp-bg { position: absolute; inset: 0; background-position: center; background-size: cover; background-repeat: no-repeat; }
${P}.front-page .fp-title { font-size: 2.6em; font-weight: 700; letter-spacing: 0.02em; }
${P}.front-page .fp-author { font-size: 1.25em; color: #444; margin-top: 0.8em; }
${P}.fp-center { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
${P}.fp-corners .fp-title { position: absolute; top: 10%; left: 8%; max-width: 70%; z-index: 1; }
${P}.fp-corners .fp-author { position: absolute; bottom: 8%; right: 8%; text-align: right; z-index: 1; }
${P}.fp-center .fp-title, ${P}.fp-center .fp-author { position: relative; z-index: 1; }
${P}.toc { page-break-after: always; break-after: page; }
${P}.toc h2 { margin-top: 0.5em; }
${P}.toc ol { list-style: none; margin: 1em 0 0 0; }
${P}.toc li { margin-bottom: 0.35em; }
${P}.toc a { color: #1a1a1a; }
${P}.toc .toc-l2 { margin-left: 1.4em; }
${P}.toc .toc-l3 { margin-left: 2.8em; }
`;
  }

  /* The self-contained document for Electron's printToPDF. <base> points
     at the app's www/ so relative asset links (the hljs code-color theme
     and the brand fonts) resolve from the temp file's location. KaTeX is
     already converted to native MathML by cleanProseClone (no katex.css
     needed). */
  function buildPdfDocument(opts) {
    opts = Object.assign({}, DEFAULTS.pdf, opts || {});
    const parts = pdfParts(opts);
    if (!parts) return null;
    const baseHref = new URL('.', window.location.href).href;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<base href="${baseHref}">
<title>${escapeHtml(parts.title)}</title>
<link rel="stylesheet" href="jvscrpt_and_css_extra/github-dark.min.css">
<style>${pdfCss(opts, false)}</style>
</head>
<body>
${parts.frontHtml}
${parts.tocHtml}
<main>
${parts.bodyHtml}
</main>
</body>
</html>`;

    return { html, baseName: exportBaseName() };
  }

  /* ── In-app print (Tauri / web) ───────────────────────────────────
     WebKitGTK does not reliably print an off-screen iframe, so instead
     we render the export document INTO the live page (hidden on screen)
     and print the top window — the exact mechanism the app already uses
     for Ctrl+P (window.print() + @media print). The content is scoped
     under #export-print-root and the app is hidden via the
     body.exporting-pdf print rules (revery_notebook_style.css), so the
     OS print dialog's "Print to File / Save as PDF" outputs just the
     document. Everything is torn down on afterprint (+ a timeout
     fallback in case afterprint never fires).                         */
  /* Render the export document into the live page (scoped under
     #export-print-root, hidden on screen; shown only in the print view by
     body.exporting-pdf + @media print). Returns a cleanup() fn. Shared by
     the native-print path (Tauri) and the window.print() path (web).    */
  function injectPrintDom(opts) {
    const parts = pdfParts(opts);
    if (!parts) return null;

    const styleEl = document.createElement('style');
    styleEl.id = 'export-print-css';
    styleEl.textContent = pdfCss(opts, true);

    const rootEl = document.createElement('div');
    rootEl.id = 'export-print-root';
    rootEl.innerHTML = `${parts.frontHtml}${parts.tocHtml}<main>${parts.bodyHtml}</main>`;

    document.head.appendChild(styleEl);
    document.body.appendChild(rootEl);
    document.body.classList.add('exporting-pdf');

    let done = false;
    return () => {
      if (done) return;
      done = true;
      document.body.classList.remove('exporting-pdf');
      try { styleEl.remove(); } catch (_) {}
      try { rootEl.remove(); } catch (_) {}
    };
  }

  /* window.print() path (web, and Tauri fallback): inject, print, tear
     down on afterprint (+ a timeout fallback in case it never fires). */
  function printInApp(opts) {
    const cleanup = injectPrintDom(opts);
    if (!cleanup) return;
    const onAfter = () => { cleanup(); window.removeEventListener('afterprint', onAfter); };
    window.addEventListener('afterprint', onAfter);
    setTimeout(() => {
      try { window.print(); }
      catch (err) { console.error('[export] window.print failed:', err); }
      setTimeout(onAfter, 60000);
    }, 200);
  }

  /* ══════════════════════════════════════════════════════════════════
     RUNNERS
  ══════════════════════════════════════════════════════════════════ */

  async function runPdfExport() {
    const built = buildPdfDocument(exportSettings.pdf);
    if (!built) return;
    const canDirect = window.NativeAPI && typeof window.NativeAPI.exportPdf === 'function'
      && window.NativeAPI.exportPdf;
    if (canDirect) {
      try {
        const res = await window.NativeAPI.exportPdf(built.html, {
          baseName: built.baseName,
          pageNumbers: exportSettings.pdf.pageNumbers === true,
        });
        if (res && res.ok && typeof showSavedIndicator === 'function') showSavedIndicator();
      } catch (err) {
        console.error('[export] PDF failed:', err);
        if (window.NativeAPI.showMessageBox) {
          window.NativeAPI.showMessageBox({
            type: 'error', title: 'PDF Export',
            message: T('The PDF export failed.'),
            detail: String((err && err.message) || err),
          });
        }
      }
      return;
    }

    /* Tauri: native WebKitGTK print — dialog-free, we control paper +
       margins, no system headers (the "border" the GTK dialog adds). We
       render the document into the page, hand the webview to Rust to
       print, then tear the DOM down. If the native op errors, fall back
       to the window.print() dialog so the user still gets a PDF. */
    if (window.NativeAPI && typeof window.NativeAPI.exportPdfNative === 'function'
        && window.NativeAPI.exportPdfNative) {
      const cleanup = injectPrintDom(exportSettings.pdf);
      if (!cleanup) return;
      /* Wait a frame so layout/fonts settle before the webview prints. */
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      try {
        const res = await window.NativeAPI.exportPdfNative({
          pageSize: exportSettings.pdf.pageSize,
          baseName: built.baseName,
        });
        cleanup();
        if (res && res.ok && typeof showSavedIndicator === 'function') showSavedIndicator();
        else if (res && res.canceled) { /* user backed out — silent */ }
        else if (!res || !res.ok) throw new Error((res && res.error) || 'native print returned no result');
      } catch (err) {
        cleanup();
        console.warn('[export] native PDF failed — falling back to print dialog:', err);
        printInApp(exportSettings.pdf); // fallback, never leaves the user with nothing
      }
      return;
    }

    /* Web (browser): window.print() → the system "Save as PDF". */
    printInApp(exportSettings.pdf);
  }

  async function runLatexExport() {
    const built = buildLatexDocument(exportSettings.latex);
    const canZip = window.NativeAPI && typeof window.NativeAPI.exportLatexZip === 'function'
      && window.NativeAPI.exportLatexZip;
    if (canZip) {
      try {
        const res = await window.NativeAPI.exportLatexZip(built.tex, built.images, built.baseName);
        if (res && res.ok && typeof showSavedIndicator === 'function') showSavedIndicator();
      } catch (err) {
        console.error('[export] LaTeX zip failed:', err);
        if (window.NativeAPI.showMessageBox) {
          window.NativeAPI.showMessageBox({
            type: 'error', title: 'LaTeX Export',
            message: T('The LaTeX export failed.'),
            detail: String((err && err.message) || err),
          });
        }
      }
    } else {
      /* Web: single-.tex download (no zip machinery in the browser). */
      const filename = (typeof buildExportFilename === 'function')
        ? buildExportFilename(built.baseName, 'tex') : built.baseName + '.tex';
      const blob = new Blob([built.tex], { type: 'text/plain' });
      const blobUrl = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: blobUrl, download: filename });
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      if (typeof showSavedIndicator === 'function') setTimeout(showSavedIndicator, 500);
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     OPTIONS POPUP
     One modal, two modes ('pdf' | 'latex'), built lazily from the
     app's own modal + menu-item styling. Values persist on change.
  ══════════════════════════════════════════════════════════════════ */

  let modal = null;
  let currentMode = 'pdf';

  /* ── App-styled controls ────────────────────────────────────────────
     The popup uses the software's own dropdown-menu aesthetic instead of
     native <select>/checkbox: a trigger button that expands an inline
     `.menu-item`-styled list with the ■ (selected) / □ marker — the same
     language as the Settings submenus. Persist on every change. */

  const row = (labelText, control) => {
    const div = document.createElement('div');
    div.className = 'export-row';
    const label = document.createElement('label');
    label.textContent = T(labelText);
    div.appendChild(label);
    div.appendChild(control);
    return div;
  };

  /* Multi-choice dropdown: values = [[val, label], …]. `get`/`set` read
     and write the live setting so the ■ marker always reflects state. */
  const dropdown = (values, get, set) => {
    const wrap = document.createElement('div');
    wrap.className = 'export-dd';
    const btn = document.createElement('button');
    btn.className = 'export-dd-btn';
    const menu = document.createElement('div');
    menu.className = 'export-dd-menu';

    const labelFor = () => {
      const cur = values.find((v) => String(v[0]) === String(get()));
      return cur ? T(cur[1]) : String(get());
    };
    const items = values.map(([val, lab]) => {
      const item = document.createElement('button');
      item.className = 'export-dd-item';
      const paint = () => { item.textContent = (String(val) === String(get()) ? '■  ' : '□  ') + T(lab); };
      paint();
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        set(val); saveSettings();
        btn.textContent = labelFor() + '  ▾';
        items.forEach((it) => it.paint());
        menu.classList.remove('open');
      });
      item.paint = paint;
      menu.appendChild(item);
      return item;
    });
    btn.textContent = labelFor() + '  ▾';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = menu.classList.contains('open');
      closeExportMenus();
      if (!wasOpen) menu.classList.add('open');
    });
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  };

  /* Boolean setting rendered as a full-width ■/□ toggle row (matches the
     app's on/off menu items). Returns the row element directly. */
  const toggleRow = (labelText, get, set) => {
    const btn = document.createElement('button');
    btn.className = 'export-toggle';
    const paint = () => { btn.textContent = (get() ? '■  ' : '□  ') + T(labelText); };
    paint();
    btn.addEventListener('click', () => { set(!get()); saveSettings(); paint(); });
    return btn;
  };

  const textInput = (current, placeholderText, onChange) => {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'export-text';
    inp.value = current || '';
    inp.placeholder = T(placeholderText);
    inp.addEventListener('input', () => { onChange(inp.value); saveSettings(); });
    return inp;
  };

  /* Close any open inline dropdown (also wired to a document click). */
  function closeExportMenus() {
    document.querySelectorAll('.export-dd-menu.open').forEach((m) => m.classList.remove('open'));
  }

  function buildPdfSection() {
    const p = exportSettings.pdf;
    const wrap = document.createElement('div');

    wrap.appendChild(toggleRow('Front page', () => p.frontPage, (v) => { p.frontPage = v; }));
    wrap.appendChild(row('Front title', textInput(p.frontTitle, 'Document title', (v) => { p.frontTitle = v; })));
    wrap.appendChild(row('Author', textInput(p.frontAuthor, 'Author name', (v) => { p.frontAuthor = v; })));

    /* front image picker + clear */
    const imgControls = document.createElement('div');
    imgControls.className = 'export-inline';
    const pickBtn = document.createElement('button');
    pickBtn.className = 'modal-btn';
    pickBtn.textContent = T(p.frontImage ? 'Change image…' : 'Choose image…');
    pickBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const f = input.files && input.files[0];
        if (!f) return;
        const readerObj = new FileReader();
        readerObj.onload = () => {
          const img = new Image();
          img.onload = () => {
            const MAX = 1600;
            const scale = Math.min(1, MAX / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            p.frontImage = canvas.toDataURL('image/jpeg', 0.82);
            saveSettings();
            pickBtn.textContent = T('Change image…');
          };
          img.src = readerObj.result;
        };
        readerObj.readAsDataURL(f);
      };
      input.click();
    });
    const clearBtn = document.createElement('button');
    clearBtn.className = 'modal-btn';
    clearBtn.textContent = T('No image');
    clearBtn.addEventListener('click', () => {
      p.frontImage = null;
      saveSettings();
      pickBtn.textContent = T('Choose image…');
    });
    imgControls.appendChild(pickBtn);
    imgControls.appendChild(clearBtn);
    wrap.appendChild(row('Cover image (full page)', imgControls));

    const opacity = document.createElement('input');
    opacity.type = 'range';
    opacity.min = '0.05'; opacity.max = '1'; opacity.step = '0.05';
    opacity.value = String(p.frontOpacity);
    opacity.addEventListener('input', () => { p.frontOpacity = parseFloat(opacity.value); saveSettings(); });
    wrap.appendChild(row('Image opacity', opacity));

    wrap.appendChild(row('Front layout', dropdown(
      [['center', 'Centered'], ['corners', 'Opposite corners']],
      () => p.frontLayout, (v) => { p.frontLayout = v; })));

    wrap.appendChild(toggleRow('Table of contents', () => p.toc, (v) => { p.toc = v; }));
    wrap.appendChild(row('Format', dropdown(
      [['article', 'Article (symmetric)'], ['book', 'Book (mirrored margins)']],
      () => p.format, (v) => { p.format = v; })));
    wrap.appendChild(row('Margins', dropdown(
      [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']],
      () => p.marginPreset, (v) => { p.marginPreset = v; })));
    wrap.appendChild(row('Font', dropdown(
      [['serif', 'Serif'], ['sans', 'Sans-serif'], ['mono', 'Monospace'],
       ['harald-text', 'Harald Text'], ['harald-mono', 'Harald Mono']],
      () => p.font, (v) => { p.font = v; })));
    wrap.appendChild(row('Font size', dropdown(
      [[9, '9 pt'], [10, '10 pt'], [11, '11 pt'], [12, '12 pt']],
      () => p.fontPt, (v) => { p.fontPt = parseInt(v, 10); })));
    wrap.appendChild(row('Page size', dropdown(
      [['A4', 'A4'], ['A5', 'A5'], ['A6', 'A6'], ['Letter', 'Letter']],
      () => p.pageSize, (v) => { p.pageSize = v; })));
    wrap.appendChild(toggleRow('New page before each H1', () => p.newPageH1, (v) => { p.newPageH1 = v; }));
    wrap.appendChild(toggleRow('New page before each H2', () => p.newPageH2, (v) => { p.newPageH2 = v; }));
    wrap.appendChild(toggleRow('Page numbers', () => p.pageNumbers, (v) => { p.pageNumbers = v; }));

    const note = document.createElement('div');
    note.className = 'export-note';
    note.textContent = T('The front page is never numbered. Page numbers work in the desktop app; in the browser/Tauri they follow the system print dialog.');
    wrap.appendChild(note);
    return wrap;
  }

  function buildLatexSection() {
    const l = exportSettings.latex;
    const wrap = document.createElement('div');
    wrap.appendChild(row('Engine', dropdown(
      [['pdflatex', 'pdflatex'], ['xelatex', 'xelatex']],
      () => l.engine, (v) => { l.engine = v; })));
    wrap.appendChild(row('Template', dropdown(
      [['article', 'Article'], ['report', 'Report'], ['book', 'Book']],
      () => l.template, (v) => { l.template = v; })));
    wrap.appendChild(toggleRow('Title page', () => l.titlePage, (v) => { l.titlePage = v; }));
    wrap.appendChild(toggleRow('Table of contents', () => l.toc, (v) => { l.toc = v; }));

    const note = document.createElement('div');
    note.className = 'export-note';
    note.textContent = T('Exports a zip project: main.tex + images/ folder.');
    wrap.appendChild(note);
    return wrap;
  }

  function openExportModal(mode) {
    currentMode = mode === 'latex' ? 'latex' : 'pdf';
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'export-modal';
    modal.className = 'modal-overlay show';

    const content = document.createElement('div');
    content.className = 'modal-content export-modal-content';

    const heading = document.createElement('h3');
    heading.textContent = currentMode === 'pdf' ? T('PDF export') : T('LaTeX project export');
    content.appendChild(heading);

    content.appendChild(currentMode === 'pdf' ? buildPdfSection() : buildLatexSection());

    /* Clicking anywhere in the modal that isn't a dropdown closes any
       open dropdown (the triggers/items stopPropagation). */
    content.addEventListener('click', (e) => {
      if (!e.target.closest('.export-dd')) closeExportMenus();
    });

    const buttons = document.createElement('div');
    buttons.className = 'modal-buttons';
    const cancel = document.createElement('button');
    cancel.className = 'modal-btn';
    cancel.textContent = T('Cancel');
    cancel.addEventListener('click', closeExportModal);
    const go = document.createElement('button');
    go.className = 'modal-btn modal-btn-primary';
    go.textContent = T('Export');
    go.addEventListener('click', () => {
      closeExportModal();
      if (currentMode === 'pdf') runPdfExport();
      else runLatexExport();
    });
    buttons.appendChild(cancel);
    buttons.appendChild(go);
    content.appendChild(buttons);

    modal.appendChild(content);
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeExportModal(); });
    document.body.appendChild(modal);
  }

  function closeExportModal() {
    if (modal) { modal.remove(); modal = null; }
  }

  /* ── Public surface ─────────────────────────────────────────────── */
  window.exporterOpen = openExportModal;
  /* Test hooks: pure builders + the in-app print path (drives
     window.print, so tests stub it). No dialogs. */
  window.exporterBuildLatex = buildLatexDocument;
  window.exporterBuildPdfHtml = buildPdfDocument;
  window.exporterPrintInApp = printInApp;
  window.exporterRunPdf = runPdfExport;
})();
