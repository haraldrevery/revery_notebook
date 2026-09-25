/* In-page driver for the live-preview POINTER model E2E check (evaluated
   by web_e2e_main.js). Everything here goes through real DOM events on
   the real editor: mousedown on the deepest element under a screen point
   (exactly what the browser would target), mousemove/mouseup on the
   document (where CodeMirror's mouse selection listens).

   The properties under test are the ones users feel:
     - a click on rendered text puts the cursor on THAT word of the
       source, not at the start of a guessed line;
     - a drag that starts on a rendered block selects text;
     - a drag across rendered blocks is stable -- blocks the selection
       merely spans stay rendered (selected as units) instead of
       flipping to raw text under the pointer;
     - double-click, shift-click and right-click behave like they do on
       raw text.
   Must be a single expression resolving to a serializable object. */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const view = window.cmView;
  const R = {};

  /* A visible window paints a frame right after every update, running
     CodeMirror's measure cycle (where scroll pinning and the selected-unit
     marker write). The hidden harness window's requestAnimationFrame is
     unreliable, so force that cycle the way any layout read does. */
  const settle = async () => { view.coordsAtPos(view.state.selection.main.head); await sleep(60); };
  const setDoc = async (s, selAt) => {
    replaceEditorContent(s);
    const at = selAt == null ? s.length : selAt;
    editor.setSelectionRange(at, at);
    await sleep(400);
    await settle(); // apply the pending scroll-into-view, as the next real frame would
  };
  const widgets = () => Array.from(document.querySelectorAll('#editor .cm-content .lp-render, #editor .cm-content .lp-yaml'));
  const widgetWith = (text) => widgets().find((w) => w.textContent.includes(text)) || null;
  const cmText = () => document.querySelector('#editor .cm-content').textContent;
  const main = () => view.state.selection.main;
  const lineOf = (pos) => view.state.doc.lineAt(pos);

  /* Screen point at the middle of `word` inside a rendered widget. */
  const wordPoint = (wrap, word) => {
    if (!wrap) return null;
    const walker = document.createTreeWalker(wrap, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.nodeValue.indexOf(word);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + word.length);
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: r };
    }
    return null;
  };
  /* Screen point of a document offset (raw text). */
  const posPoint = (pos) => {
    const c = view.coordsAtPos(pos);
    return c ? { x: (c.left + c.right) / 2 + 1, y: (c.top + c.bottom) / 2 } : null;
  };
  /* Source span of `word` on the first doc line starting with `lineStart`. */
  const srcSpan = (lineStart, word) => {
    const doc = view.state.doc;
    for (let n = 1; n <= doc.lines; n++) {
      const l = doc.line(n);
      if (!l.text.startsWith(lineStart)) continue;
      const i = l.text.indexOf(word);
      if (i < 0) return null;
      return { from: l.from + i, to: l.from + i + word.length, line: l };
    }
    return null;
  };
  const within = (pos, span) => !!span && pos >= span.from && pos <= span.to;

  const mouse = (type, x, y, opts = {}) => {
    const init = {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      button: opts.button || 0,
      buttons: opts.buttons != null ? opts.buttons : (type === 'mouseup' ? 0 : 1),
      shiftKey: !!opts.shift,
    };
    const target = type === 'mousedown' ? (document.elementFromPoint(x, y) || document) : document;
    target.dispatchEvent(new MouseEvent(type, init));
    return target;
  };
  const press   = async (x, y, opts) => { mouse('mousedown', x, y, opts); await sleep(200); await settle(); };
  const moveTo  = async (x, y, opts) => { mouse('mousemove', x, y, opts); await sleep(120); };
  /* A click's block reveals on RELEASE (the layout is frozen while the
     button is down), so settle the measure cycle that applies it. */
  const release = async (x, y, opts) => { mouse('mouseup', x, y, Object.assign({}, opts, { buttons: 0 })); await sleep(120); await settle(); };
  /* Screen top of a document line (drawn raw lines; blank lines between
     blocks are raw in both states, so they measure a block's top edge). */
  const lineTop = (n) => { const c = view.coordsAtPos(view.state.doc.line(n).from); return c ? c.top : null; };
  const kept = (a, b) => a != null && b != null && Math.abs(a - b) <= 1;
  const selectedWidget = (text) => {
    const w = widgetWith(text);
    return !!w && w.classList.contains('lp-selected');
  };
  /* Text covered by the live preview's partial-selection highlight
     (CSS Custom Highlight API), '' when nothing is painted. */
  const hlText = () => {
    const h = window.CSS && CSS.highlights && CSS.highlights.get('revery-lp-selection');
    return h ? Array.from(h).map((r) => r.toString()).join('|') : '';
  };
  const bandCovers = (wrap) => {
    if (!wrap) return false;
    const r = wrap.getBoundingClientRect();
    return Array.from(document.querySelectorAll('#editor .cm-selectionBackground')).some((el) => {
      const b = el.getBoundingClientRect();
      return b.top <= r.top + 2 && b.bottom >= r.bottom - 2 && b.width > 0;
    });
  };

  const DOC = [
    '# Title Heading',
    '',
    'first paragraph with **bold words** inside it',
    '',
    'second paragraph here with more text',
    '',
    'third paragraph sits below the second one',
    '',
    'tail line at the end',
  ].join('\n');

  window.setLivePreviewMode(true);

  /* A. Click a rendered word: cursor lands on that word in the source,
        and the block's top edge stays where it was (line 2 is the blank
        line right above it). */
  await setDoc(DOC);
  {
    const p = wordPoint(widgetWith('bold words'), 'words');
    R.clickWord = { found: !!p };
    if (p) {
      const aboveTop = lineTop(2);
      await press(p.x, p.y);
      await release(p.x, p.y);
      const span = srcSpan('first paragraph', 'words');
      R.clickWord.revealed = !widgetWith('bold words') && cmText().includes('**bold words**');
      R.clickWord.onLine = lineOf(main().head).text.startsWith('first paragraph');
      R.clickWord.inWord = within(main().head, span);
      R.clickWord.collapsed = main().empty;
      R.clickWord.topKept = kept(aboveTop, lineTop(2));
    }
  }

  /* B. List item: the clicked ITEM's line, inside the clicked word. */
  await setDoc('intro line\n\n- alpha item\n- beta item\n- gamma item\n\nafter the list');
  {
    const p = wordPoint(widgetWith('gamma'), 'gamma');
    R.clickListItem = { found: !!p };
    if (p) {
      await press(p.x, p.y);
      R.clickListItem.onLine = lineOf(main().head).text === '- gamma item';
      R.clickListItem.inWord = within(main().head, srcSpan('- gamma', 'gamma'));
      await release(p.x, p.y);
    }
  }

  /* C. Fenced code: the clicked code LINE, inside the clicked token. */
  await setDoc('intro\n\n```javascript\nconst alpha = 1;\nlet beta = 2;\nreturn gamma;\n```\n\nafter');
  {
    const p = wordPoint(widgetWith('beta'), 'beta');
    R.clickCodeLine = { found: !!p };
    if (p) {
      await press(p.x, p.y);
      R.clickCodeLine.onLine = lineOf(main().head).text === 'let beta = 2;';
      R.clickCodeLine.inWord = within(main().head, srcSpan('let beta', 'beta'));
      await release(p.x, p.y);
    }
  }

  /* D. Table cell: the clicked ROW's line, inside the clicked cell text. */
  await setDoc('intro\n\n| Col A | Col B |\n|---|---|\n| **bold** | plain |\n| more | rows |\n\nafter');
  {
    const p = wordPoint(widgetWith('rows'), 'rows');
    R.clickTableCell = { found: !!p };
    if (p) {
      await press(p.x, p.y);
      R.clickTableCell.onLine = lineOf(main().head).text === '| more | rows |';
      R.clickTableCell.inWord = within(main().head, srcSpan('| more', 'rows'));
      await release(p.x, p.y);
    }
  }

  /* E. A wrapped paragraph (one doc line, several visual rows): a click
        on a word in a lower row lands on that word, and the paragraph's
        top edge stays put through the widget->raw swap. */
  {
    const words = [];
    for (let i = 0; i < 90; i++) words.push('w' + i);
    const longLine = 'wrapped paragraph ' + words.join(' ') + ' finish';
    await setDoc('lead line\n\n' + longLine + '\n\nafter');
    const w = widgetWith('w60');
    const p = wordPoint(w, 'w60 ');
    R.clickWrappedRow = { found: !!p };
    if (p) {
      const wrapRect = w.getBoundingClientRect();
      R.clickWrappedRow.lowerRow = p.y > wrapRect.top + 30;
      const aboveTop = lineTop(2);
      await press(p.x, p.y);
      await release(p.x, p.y);
      R.clickWrappedRow.inWord = within(main().head, srcSpan('wrapped paragraph', 'w60'));
      R.clickWrappedRow.topKept = kept(aboveTop, lineTop(2));
    }
  }

  /* E2. The layout never changes while the button is down: a click on a
         paragraph whose raw form reflows (a link's URL, ** marks) keeps it
         rendered until release, and a 2 px jitter meanwhile selects
         nothing. On release it reveals with the cursor in the word. */
  {
    const JIT = 'lead line\n\nstart words [linked text](https://example.com/a/long/path/that/reflows/the/raw/form) then **strong words** and the target word here to click\n\nafter';
    await setDoc(JIT);
    const w = widgetWith('target word');
    const p = w && wordPoint(w, 'target');
    R.clickJitter = { found: !!p };
    if (p) {
      mouse('mousedown', p.x, p.y);
      await sleep(120); await settle();
      R.clickJitter.renderedWhilePressed = !!widgetWith('target word');
      mouse('mousemove', p.x + 2, p.y + 1);
      await sleep(80); await settle();
      R.clickJitter.noSelection = main().empty;
      await release(p.x + 2, p.y + 1);
      R.clickJitter.revealedOnRelease = !widgetWith('target word') && cmText().includes('[linked text](');
      R.clickJitter.inWord = main().empty && within(main().head, srcSpan('start words', 'target'));
    }
  }

  /* F. A drag that STARTS on a rendered block selects text inside it. */
  await setDoc(DOC);
  {
    const p = wordPoint(widgetWith('bold words'), 'first');
    /* The target is measured on the RENDERED paragraph: the layout stays
       as it is while the button is down. */
    const q = wordPoint(widgetWith('bold words'), 'inside');
    R.dragFromWidget = { found: !!p };
    if (p) {
      await press(p.x, p.y);
      const target = srcSpan('first paragraph', 'inside');
      R.dragFromWidget.targetVisible = !!q;
      if (q) {
        await moveTo(q.x, q.y);
        await moveTo(q.x + 1, q.y);
        await release(q.x + 1, q.y);
        const m = main();
        R.dragFromWidget.nonEmpty = !m.empty;
        R.dragFromWidget.anchorInFirst = within(m.anchor, srcSpan('first paragraph', 'first'));
        R.dragFromWidget.headInInside = within(m.head, target);
        R.dragFromWidget.blockRaw = cmText().includes('**bold words**');
      }
    }
  }

  /* G. Drag from raw text ACROSS a rendered block: the spanned block stays
        rendered, is marked selected, the selection covers it, and the head
        does not oscillate while the pointer rests at one point. */
  await setDoc(DOC, DOC.indexOf('second'));
  {
    const start = srcSpan('second paragraph', 'second');
    const p0 = posPoint(start.from + 2);
    const w3 = widgetWith('third paragraph');
    R.dragAcross = { ready: !!p0 && !!w3 };
    if (p0 && w3) {
      await press(p0.x, p0.y);
      const r3 = w3.getBoundingClientRect();
      const x = p0.x, y = r3.bottom + 4; // the blank line right after the third paragraph
      await moveTo(x, r3.top + r3.height / 2);
      await settle();
      const midHead = main().head;
      const midRendered = !!widgetWith('third paragraph');
      const midHl = hlText();
      const midBand = bandCovers(widgetWith('third paragraph'));
      await moveTo(x, y);
      const heads = [main().head];
      for (let i = 0; i < 5; i++) {
        await moveTo(x, y + (i % 2));
        heads.push(main().head);
      }
      const third = srcSpan('third paragraph', 'third');
      const w3b = widgetWith('third paragraph');
      R.dragAcross.thirdStillRendered = !!w3b;
      R.dragAcross.thirdMarkedSelected = selectedWidget('third paragraph');
      R.dragAcross.bandCoversThird = bandCovers(w3b);
      R.dragAcross.coversThird = !!third && main().from <= third.line.from && main().to >= third.line.to;
      R.dragAcross.anchorKept = within(main().anchor, start);
      R.dragAcross.stableHead = heads.every((h) => h === heads[0]);
      R.dragAcross.overWidgetPartial = midRendered && !!third
        && midHead > third.line.from && midHead < third.line.to;
      R.dragAcross.midHighlightPrefix = midHl.length > 0
        && 'third paragraph sits below the second one'.startsWith(midHl);
      R.dragAcross.midBandStopsAtBlock = !midBand;
      R.dragAcross.endHighlightCleared = hlText() === '';
      R.dragAcross.secondStaysRaw = cmText().includes('second paragraph here');
      await release(x, y);
    }
  }

  /* H. Drag UPWARD over the first block (starts at offset 0): it stays
        rendered and the head rests at 0 without flip-flopping. */
  await setDoc(DOC, DOC.indexOf('first'));
  {
    const start = srcSpan('first paragraph', 'paragraph');
    const p0 = posPoint(start.from + 2);
    const wT = widgetWith('Title Heading');
    R.dragUpOverFirst = { ready: !!p0 && !!wT };
    if (p0 && wT) {
      await press(p0.x, p0.y);
      /* Into the heading's text: the tail from the pointer is painted. */
      const pw = wordPoint(wT, 'Heading');
      await moveTo(pw.x, pw.y);
      await moveTo(pw.x, pw.y + 1);
      await settle();
      const titleLine = view.state.doc.line(1);
      const tail = hlText().trim();
      R.dragUpOverFirst.headInHeadingWord = within(main().head, srcSpan('# Title', 'Heading'));
      R.dragUpOverFirst.titleTailPainted = tail.length > 0 && tail.length <= 'Heading'.length
        && 'Title Heading'.toLowerCase().endsWith(tail.toLowerCase());
      /* Then to the widget's top edge, repeatedly: the head parks at the
         block start (0), the heading stays rendered and is selected whole. */
      const rT = wT.getBoundingClientRect();
      const y = rT.top + 2;
      const heads = [];
      const rendered = [];
      for (let i = 0; i < 6; i++) {
        await moveTo(p0.x, y + (i % 2));
        heads.push(main().head);
        rendered.push(!!widgetWith('Title Heading'));
      }
      await settle();
      R.dragUpOverFirst.headInTitle = heads.every((h) => h >= 0 && h <= titleLine.to);
      R.dragUpOverFirst.stableHead = heads.every((h) => h === heads[0]);
      R.dragUpOverFirst.titleStaysRendered = rendered.every(Boolean);
      R.dragUpOverFirst.titleWholeAtEdge = heads[0] === 0 && selectedWidget('Title Heading');
      await release(p0.x, y);
    }
  }

  /* I. Double-click on a rendered word selects that word in the source. */
  await setDoc(DOC);
  {
    const p = wordPoint(widgetWith('second paragraph'), 'second');
    R.dblClickWord = { found: !!p };
    if (p) {
      mouse('mousedown', p.x, p.y);
      await sleep(60);
      mouse('mousedown', p.x, p.y);
      await sleep(250);
      const span = srcSpan('second paragraph', 'second');
      const m = main();
      R.dblClickWord.selectsWord = !!span && m.from === span.from && m.to === span.to;
      await release(p.x, p.y);
    }
  }

  /* J. Shift-click on a rendered block extends the existing selection. */
  await setDoc(DOC, DOC.indexOf('first'));
  {
    const p = wordPoint(widgetWith('third paragraph'), 'third');
    R.shiftClick = { found: !!p };
    if (p) {
      await press(p.x, p.y, { shift: true });
      const m = main();
      R.shiftClick.anchorKept = m.anchor === DOC.indexOf('first');
      R.shiftClick.headInThird = within(m.head, srcSpan('third paragraph', 'third'));
      await settle();
      R.shiftClick.thirdRendered = !!widgetWith('third paragraph');
      R.shiftClick.prefixPainted = hlText().length > 0 && 'third'.startsWith(hlText());
      R.shiftClick.firstRaw = cmText().includes('**bold words**');
      await release(p.x, p.y, { shift: true });
    }
  }

  /* J2. Drag from raw text to a WORD inside a rendered paragraph: the
         head lands on that word, the paragraph stays rendered and exactly
         the text up to the pointer is painted. */
  await setDoc(DOC, DOC.indexOf('second'));
  {
    const start = srcSpan('second paragraph', 'second');
    const p0 = posPoint(start.from + 2);
    const p = wordPoint(widgetWith('third paragraph'), 'below');
    R.dragIntoWord = { ready: !!p0 && !!p };
    if (p0 && p) {
      await press(p0.x, p0.y);
      await moveTo(p.x, p.y);
      await moveTo(p.x, p.y + 1);
      await settle();
      const below = srcSpan('third paragraph', 'below');
      const painted = hlText();
      R.dragIntoWord.headInWord = within(main().head, below);
      R.dragIntoWord.thirdRendered = !!widgetWith('third paragraph');
      R.dragIntoWord.paintedUpToPointer = painted.startsWith('third paragraph sits ')
        && painted.length >= 'third paragraph sits '.length
        && painted.length <= 'third paragraph sits below'.length;
      R.dragIntoWord.anchorKept = within(main().anchor, start);
      await release(p.x, p.y + 1);
    }
  }

  /* J3. Keyboard: Shift+ArrowDown from the blank line above a rendered
         paragraph enters it, Shift+ArrowRight walks into its text — the
         paragraph stays rendered with exactly those characters painted —
         and typing over the selection edits the SOURCE correctly. */
  await setDoc(DOC, DOC.indexOf('second'));
  {
    const blank = DOC.indexOf('\n\nthird') + 1;
    editor.setSelectionRange(blank, blank);
    await sleep(300);
    const key = async (k, shift) => {
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: !!shift, bubbles: true, cancelable: true }));
      await sleep(120);
    };
    await key('ArrowDown', true);
    for (let i = 0; i < 5; i++) await key('ArrowRight', true);
    await settle();
    const third = srcSpan('third paragraph', 'third');
    R.keyboardPartial = {
      headAfterFive: !!third && main().head === third.from + 5 && main().anchor === blank,
      thirdRendered: !!widgetWith('third paragraph'),
      painted: hlText() === 'third',
    };
    view.dispatch(Object.assign(view.state.replaceSelection('Z'), { userEvent: 'input.type' }));
    await sleep(300);
    R.keyboardPartial.typedOver = editor.value.includes('more text\nZ paragraph sits below')
      && cmText().includes('Z paragraph sits below');
  }

  /* K. Right-click on a rendered block places the cursor there (so the
        context menu acts on that block) and never drags a selection. */
  await setDoc(DOC);
  {
    const p = wordPoint(widgetWith('second paragraph'), 'more');
    R.rightClick = { found: !!p };
    if (p) {
      await press(p.x, p.y, { button: 2, buttons: 2 });
      const span = srcSpan('second paragraph', 'more');
      R.rightClick.placesCursor = within(main().head, span) && main().empty;
      await moveTo(p.x + 90, p.y, { buttons: 2 });
      R.rightClick.noDrag = main().empty && within(main().head, span);
      await release(p.x + 90, p.y, { button: 2 });
    }
  }

  /* L. Select-all keeps spanned blocks rendered (selected as units); the
        document text is untouched. */
  await setDoc(DOC, DOC.indexOf('second'));
  {
    view.dispatch({ selection: { anchor: 0, head: DOC.length } });
    await sleep(300);
    await settle();
    R.selectAll = {
      firstRendered: !!widgetWith('bold words') && selectedWidget('bold words'),
      thirdRendered: !!widgetWith('third paragraph') && selectedWidget('third paragraph'),
      textUnchanged: editor.value === DOC,
    };
  }

  /* M. Keyboard motion into a block still reveals it (regression guard). */
  await setDoc(DOC, DOC.indexOf('second'));
  {
    const blank = DOC.indexOf('\n\nthird') + 1; // the empty line above the third paragraph
    editor.setSelectionRange(blank, blank);
    await sleep(300);
    window.cmView.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await sleep(300);
    R.arrowReveals = lineOf(main().head).text.startsWith('third paragraph')
      && cmText().includes('third paragraph sits');
  }

  /* N. Interactive children keep their own behaviour: a mousedown on a
        task checkbox neither reveals the block nor edits the document. */
  await setDoc('- [ ] first task\n- [x] second task\n\nend');
  {
    const box = document.querySelector('#editor .lp-task-checkbox');
    R.checkboxNoReveal = { found: !!box };
    if (box) {
      const r = box.getBoundingClientRect();
      await press(r.left + r.width / 2, r.top + r.height / 2);
      R.checkboxNoReveal.stillRendered = !!document.querySelector('#editor .lp-task-checkbox');
      R.checkboxNoReveal.docUntouched = editor.value.startsWith('- [ ] first task');
      await release(r.left + r.width / 2, r.top + r.height / 2);
    }
  }

  /* O. Click on a rendered YAML row still opens editing on that line
        (pointer-selection contract with the frontmatter autocomplete). */
  await setDoc('---\ntags: [alpha, beta]\nstatus: done\n---\n\nbody text');
  {
    const pill = Array.from(document.querySelectorAll('#editor .lp-yaml .yaml-row'))
      .find((p) => p.textContent.startsWith('status'));
    R.yamlPill = { found: !!pill };
    if (pill) {
      const r = pill.getBoundingClientRect();
      await press(r.left + 8, r.top + r.height / 2);
      R.yamlPill.onStatusLine = lineOf(main().head).text.startsWith('status:');
      R.yamlPill.revealed = !document.querySelector('#editor .lp-yaml');
      if (CM.closeCompletion) CM.closeCompletion(view);
      await release(r.left + 8, r.top + r.height / 2);
    }
  }

  /* O2. The Properties sheet. Opening a note puts the cursor on the line
         after its frontmatter, so the sheet shows (at 0 the cursor sat
         inside the YAML and revealed it raw). The sheet reads the usual
         YAML shapes, folds to one header line through its toggle — a
         persisted, global, display-only choice that keeps the header in
         place and the height map exact — and a cursor inside the YAML
         still shows it raw while folded. */
  {
    const FM = '---\ntitle: "A: quoted title"\ntags:\n  - alpha\n  - beta\nauthor:\n  name: Harald\n  url: https://example.com\n'
      + 'summary: |\n  first line\n  second line\nlong: ' + 'word '.repeat(40).trim() + '\n---\n\nbody paragraph\n\n## Next heading\n';
    const fmEnd = FM.indexOf('\n---\n') + 4;
    const S = R.yamlSheet = {};
    replaceEditorContent(FM);           // the real file-open path: no cursor move
    await sleep(400);
    await settle();
    S.openCursorAfterYaml = main().head === fmEnd + 1 && main().empty;
    S.openShowsSheet = !!document.querySelector('#editor .lp-yaml .yaml-row');
    const rowOf = (key) => Array.from(document.querySelectorAll('#editor .lp-yaml .yaml-row'))
      .find((row) => row.querySelector('.yaml-key').textContent === key) || null;
    const tags = rowOf('tags'), author = rowOf('author'), summary = rowOf('summary'), title = rowOf('title'), long = rowOf('long');
    S.readsShapes = !!(tags && author && summary && title)
      && Array.from(tags.querySelectorAll('.yaml-chip'), (c) => c.textContent).join() === 'alpha,beta'
      && author.querySelectorAll('.yaml-sub').length === 2
      && summary.textContent.includes('second line')
      && title.querySelector('.yaml-value').textContent === 'A: quoted title';
    /* The key's TEXT stays on one line beside a long wrapping value (the
       grid cell itself stretches to the row, so measure the text). */
    S.keyNotSqueezed = !!long && (() => {
      const range = document.createRange();
      range.selectNodeContents(long.querySelector('.yaml-key'));
      const valueRows = long.querySelector('.yaml-value').getClientRects();
      return range.getClientRects().length === 1 && long.getBoundingClientRect().height > 40 && valueRows.length > 0;
    })();
    S.previewParity = document.querySelectorAll('#preview .yaml-row').length
        === document.querySelectorAll('#editor .lp-yaml .yaml-row').length
      && !document.querySelector('#preview .yaml-toggle');

    /* Fold through the header toggle: the mousedown is the toggle's own
       (CodeMirror places no cursor, nothing reveals), the click folds. */
    const toggle = document.querySelector('#editor .lp-yaml .yaml-toggle');
    const headTop = toggle ? toggle.getBoundingClientRect().top : null;
    const docBefore = editor.value, headBefore = main().head;
    if (toggle) {
      const r = toggle.getBoundingClientRect();
      await press(r.left + 20, r.top + r.height / 2);
      await release(r.left + 20, r.top + r.height / 2);
      toggle.click();
      await sleep(150);
      await settle();
    }
    const yamlBox = () => document.querySelector('#editor .lp-yaml');
    const drift = () => {
      const w = yamlBox();
      const b = view.lineBlockAt(0);
      return w ? Math.abs(b.top + view.documentTop - w.getBoundingClientRect().top)
        + Math.abs(b.height - w.getBoundingClientRect().height) : 99;
    };
    const settingNow = () => { try { return JSON.parse(localStorage.getItem('revery_md_settings')).yamlPropsCollapsed; } catch (_) { return null; } };
    S.folds = !!document.querySelector('#editor .lp-yaml .yaml-collapsed')
      && !document.querySelector('#editor .lp-yaml .yaml-row')
      && (document.querySelector('#editor .lp-yaml .yaml-count') || {}).textContent === '5';
    S.foldDisplayOnly = editor.value === docBefore && main().head === headBefore;
    S.foldKeepsHeader = kept(headTop, (document.querySelector('#editor .lp-yaml .yaml-toggle') || { getBoundingClientRect: () => ({}) }).getBoundingClientRect().top);
    S.foldHeightExact = drift() <= 1;
    S.foldPersisted = settingNow() === true;

    /* A click in the folded sheet's bottom margin lands below it. */
    {
      const w = yamlBox().getBoundingClientRect();
      await press(w.left + w.width / 2, w.bottom - 3);
      await release(w.left + w.width / 2, w.bottom - 3);
      S.foldedMarginClickOutside = main().head > fmEnd && !!document.querySelector('#editor .lp-yaml .yaml-collapsed');
    }

    /* The choice is global: another note opens folded too. */
    replaceEditorContent('---\nk: v\n---\n\nother note');
    await sleep(300);
    await settle();
    S.foldIsGlobal = !!document.querySelector('#editor .lp-yaml .yaml-collapsed');

    /* The cursor inside a folded frontmatter shows its raw lines. */
    editor.setSelectionRange(5, 5);
    await sleep(250);
    await settle();
    S.cursorInsideShowsRaw = !yamlBox() && !!document.querySelector('#editor .cm-line.lp-frontmatter');
    if (CM.closeCompletion) CM.closeCompletion(view);
    editor.setSelectionRange(editor.value.length, editor.value.length);
    await sleep(250);
    await settle();
    S.foldReturns = !!document.querySelector('#editor .lp-yaml .yaml-collapsed');

    /* Unfold again (and leave the setting as the rest of the run expects). */
    const t2 = document.querySelector('#editor .lp-yaml .yaml-toggle');
    if (t2) t2.click();
    await sleep(150);
    await settle();
    S.unfolds = !!document.querySelector('#editor .lp-yaml .yaml-row') && settingNow() === false && drift() <= 1;
  }

  /* O3. HTML export: list chips and nested values keep their separators
         in the metadata table (textContent alone ran them together). */
  {
    replaceEditorContent('---\ntags: [alpha, beta]\nauthor:\n  name: Harald\n  url: x\n---\n\nbody');
    await sleep(300);
    let blob = null;
    const origCreate = URL.createObjectURL, origClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (b) => { blob = b; return 'blob:about:blank'; };
    HTMLAnchorElement.prototype.click = function () {};
    try { await exportHtmlFile(); } finally {
      URL.createObjectURL = origCreate;
      HTMLAnchorElement.prototype.click = origClick;
    }
    const html = blob ? await blob.text() : '';
    R.yamlExport = {
      captured: !!blob,
      listJoined: html.includes('<th>tags</th><td>alpha, beta</td>'),
      mapJoined: html.includes('<th>author</th><td>name: Harald; url: x</td>'),
    };
  }

  /* O4. Body below a frontmatter the markdown parser misreads still
         renders: a `...` closer made the next line part of a paragraph
         starting inside the YAML, and a fence in a `|` value swallowed
         the whole body — both used to stay raw text forever. */
  {
    R.fmStraddle = {};
    /* The cursor on a blank line, so no probed block is being edited. */
    const dots = '---\ntitle: x\n...\nBody line right after\n\nPara two';
    await setDoc(dots, dots.indexOf('\n\nPara') + 1);
    R.fmStraddle.dotsCloser = !!document.querySelector('#editor .lp-yaml')
      && !!widgetWith('Body line right after') && !!widgetWith('Para two');
    const fence = '---\ndesc: |\n  ```\n---\n\n# Straddle Heading\n\nPara text';
    await setDoc(fence, fence.indexOf('\n\n#') + 1);
    R.fmStraddle.fenceInScalar = !!document.querySelector('#editor .lp-yaml')
      && !!Array.from(document.querySelectorAll('#editor .lp-render h1')).find((h) => h.textContent.includes('Straddle Heading'));
  }

  const settingNow = () => { try { return JSON.parse(localStorage.getItem('revery_md_settings')).yamlPropsCollapsed; } catch (_) { return null; } };
  const captureHtmlExport = async () => {
    let blob = null;
    const origCreate = URL.createObjectURL, origClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (b) => { blob = b; return 'blob:about:blank'; };
    HTMLAnchorElement.prototype.click = function () {};
    try { await exportHtmlFile(); } finally {
      URL.createObjectURL = origCreate;
      HTMLAnchorElement.prototype.click = origClick;
    }
    return blob ? blob.text() : '';
  };

  /* O5. Reader mode folds the sheet too — the SAME stored choice as live
         preview; its toggle only folds (no selection in the hidden
         editor); the HTML export still lists every property while the
         reader sheet is folded; the split-view preview never folds. */
  {
    const RF = R.readerFold = {};
    await setDoc('---\ntitle: Reader note\ntags: [a, b]\n---\n\nbody text');
    toggleReaderMode();
    await sleep(200);
    RF.toggleInReader = !!document.querySelector('#preview .yaml-toggle') && !!document.querySelector('#preview .yaml-row');
    const headBefore = main().head, docBefore = editor.value;
    const t = document.querySelector('#preview .yaml-toggle');
    if (t) t.click();
    await sleep(150);
    RF.folds = !!document.querySelector('#preview .yaml-collapsed') && !document.querySelector('#preview .yaml-row')
      && settingNow() === true;
    RF.noEditorSelection = main().head === headBefore && main().empty && editor.value === docBefore;
    RF.exportKeepsRows = (await captureHtmlExport()).includes('<th>title</th><td>Reader note</td>');
    toggleReaderMode();
    await sleep(200);
    await settle();
    RF.sharedWithLivePreview = !!document.querySelector('#editor .lp-yaml .yaml-collapsed');
    window.setLivePreviewMode(false);
    await sleep(250);
    RF.splitPaneNeverFolds = !document.querySelector('#preview .yaml-toggle') && !!document.querySelector('#preview .yaml-row');
    window.setLivePreviewMode(true);
    await sleep(250);
    await settle();
    const lt = document.querySelector('#editor .lp-yaml .yaml-toggle');
    if (lt) lt.click();
    await sleep(150);
    RF.unfoldShared = settingNow() === false && !!document.querySelector('#editor .lp-yaml .yaml-row');
  }

  /* O6. The sheet follows the PREVIEW text size (it used rem, the UI size). */
  {
    await setDoc('---\ntitle: Sized\n---\n\nA paragraph.');
    const sheetPx = () => parseFloat(getComputedStyle(document.querySelector('#editor .lp-yaml .yaml-render')).fontSize);
    const before = sheetPx();
    const orig = previewTextSize;
    window.setPreviewTextSize(stepTextSize(previewTextSize, 1));
    await sleep(200);
    await settle();
    const after = sheetPx();
    const expected = before * (previewTextSize / orig);
    window.setPreviewTextSize(orig);
    await sleep(150);
    R.sheetFollowsPreviewSize = after > before && Math.abs(after - expected) < 0.5;
  }

  /* O7. A mouse gesture still in progress when the document is swapped
         (a press with no release yet, e.g. during an external-change
         reload) must not corrupt the next edit. It used to: the gesture
         mapped the OLD document's positions through the new one's
         changes, threw inside the view update, and the screen stopped
         matching the saved text. */
  {
    const S = R.staleGesture = {};
    /* The old positions must lie beyond the new document's end, where
       mapping them throws: a longer note, then a much shorter one. */
    const before = '---\ntags: [alpha]\nstatus: done\n---\n\nbody paragraph with enough text in it';
    await setDoc(before, before.indexOf('\n---\n') + 5);
    const row = Array.from(document.querySelectorAll('#editor .lp-yaml .yaml-row'))
      .find((r) => r.textContent.startsWith('status'));
    const errs = [];
    const origErr = console.error;
    console.error = function (...a) { errs.push(String(a[0] && a[0].message || a[0])); return origErr.apply(this, a); };
    try {
      if (row) {
        const r = row.getBoundingClientRect();
        mouse('mousedown', r.left + 8, r.top + r.height / 2);   // pressed, never released
        await sleep(150);
      }
      S.pressed = !!(view.inputState && view.inputState.mouseSelection); // the gesture is live
      if (CM.closeCompletion) CM.closeCompletion(view);
      replaceEditorContent('short');
      await sleep(150);
      /* A paste, not typing: CodeMirror ends a gesture itself on typed
         input, but a paste, an undo, an autocomplete accept or a toolbar
         edit reached the stale gesture — the old report's trigger was a
         Tab-accepted suggestion. */
      try {
        view.dispatch({ changes: { from: view.state.doc.length, insert: ' more' }, userEvent: 'input.paste' });
        S.editOk = true;
      } catch (e) { S.editOk = false; errs.push(e.message); }
      window.setLivePreviewMode(false);
      await sleep(200);
      const screen = Array.from(document.querySelectorAll('#editor .cm-line'), (l) => l.textContent).join('\n');
      S.screenMatchesDoc = !!row && screen === editor.value && editor.value === 'short more';
      S.noErrors = errs.length === 0;
      window.setLivePreviewMode(true);
      await sleep(200);
    } finally {
      console.error = origErr;
      mouse('mouseup', 0, 0);
    }
  }

  /* O8. Frontmatter autocomplete: after a click opens the menu, what is
         typed filters it (Tab took the first row whatever was typed —
         "be" gave "alpha"); a value YAML cannot hold plain is inserted
         quoted; keys in any letters get suggestions. */
  {
    const AC = R.yamlAutocomplete = {};
    window.setLivePreviewMode(false);
    await sleep(150);
    const menuOpen = async () => {
      for (let w = 0; w < 30 && !document.querySelector('.cm-tooltip-autocomplete'); w++) await sleep(100);
      return !!document.querySelector('.cm-tooltip-autocomplete');
    };
    const labels = () => Array.from(document.querySelectorAll('.cm-tooltip-autocomplete .cm-completionLabel'), (e) => e.textContent);
    const typeText = (s) => { for (const ch of s) { const p = main().head; view.dispatch({ changes: { from: p, insert: ch }, selection: { anchor: p + 1 }, userEvent: 'input.type' }); } };
    const tab = () => view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    /* A click on the value of the key line `line` (its empty value). */
    const clickAt = async (doc, line) => {
      replaceEditorContent(doc);
      view.focus();
      view.dispatch({ selection: { anchor: doc.indexOf(line + '\n') + line.length }, userEvent: 'select.pointer' });
      const open = await menuOpen();
      await sleep(400); // the engine's interactionDelay
      return open;
    };
    const D1 = '---\ntags: [alpha, beta]\ntags: \n---\n\nbody';
    AC.opens = await clickAt(D1, 'tags: ');
    typeText('be');
    await sleep(300);
    AC.typedFilters = labels().length > 0 && !labels().includes('alpha');
    tab();
    await sleep(200);
    AC.tabTakesTyped = editor.value.split('\n')[2] === 'tags: beta';

    const D2 = '---\ntitle: "Note: part 2"\ntitle: \n---\n\nbody';
    await clickAt(D2, 'title: ');
    tab();
    await sleep(200);
    AC.quotesSpecial = editor.value.split('\n')[2] === 'title: "Note: part 2"';

    const D3 = '---\nförfattare: Harald\nförfattare: \n---\n\nbody';
    AC.unicodeKey = (await clickAt(D3, 'författare: ')) && labels().includes('Harald');
    if (CM.closeCompletion) CM.closeCompletion(view);
    window.setLivePreviewMode(true);
    await sleep(150);
  }

  /* O9. Templates never break the frontmatter: Insert YAML merges only
         the missing keys into an existing block (never a second block),
         Import Template goes below the frontmatter, and a YAML template
         without --- fences is refused. */
  {
    const T = R.yamlTemplates = {};
    replaceEditorContent('---\ntitle: Mine\ndraft: true\n---\n\nbody');
    insertTemplate('yaml', '---\ntitle: T\ndate: 2026-01-01\ntags: [a]\ndraft: false\n---\n\n');
    T.mergesMissing = editor.value === '---\ntitle: Mine\ndraft: true\ndate: 2026-01-01\ntags: [a]\n---\n\nbody';
    CM.undo(view);
    T.oneUndo = editor.value === '---\ntitle: Mine\ndraft: true\n---\n\nbody';
    insertTemplate('yaml', '---\ntitle: T\n---\n\n');
    T.nothingMissingNoop = editor.value === '---\ntitle: Mine\ndraft: true\n---\n\nbody';
    insertTemplate('md', '# Recipe Name\n\n## Ingredients\n\n');
    T.mdBelowFrontmatter = editor.value === '---\ntitle: Mine\ndraft: true\n---\n\n# Recipe Name\n\n## Ingredients\n\nbody';
    replaceEditorContent('plain note');
    insertTemplate('yaml', '---\ntitle: T\n---\n\n');
    T.yamlOnTopWithoutFm = editor.value === '---\ntitle: T\n---\n\nplain note';
    const bad = window.createCustomTemplate('yaml', 'No fences ' + Date.now(), 'title: x');
    T.fenceLessRefused = bad.ok === false && /---/.test(bad.error);
  }

  /* O10. Export metadata reads the same YAML the sheet shows: a folded
          title is its text (it exported as ">"), and an empty author
          stays empty (the next line, "date: …", became the author). */
  {
    replaceEditorContent('---\ntitle: >\n  A folded\n  title\nauthor:\ndate: 2026-09-25\n---\n\nbody');
    await sleep(150);
    const tex = window.exporterBuildLatex({ template: 'article', engine: 'pdflatex', titlePage: true, toc: false }).tex;
    R.exportMeta = {
      foldedTitle: tex.includes('\\title{A folded title}'),
      emptyAuthor: tex.includes('\\author{}') && !/\\author\{[^}]*date/.test(tex),
    };
  }

  /* ── Geometry: height map, edge and side clicks, layout-shift direction.
     A long document with lists, blockquotes, code and tables ABOVE the
     probed blocks: their nested margins used to collapse out of the
     widgets, so CodeMirror's height map drifted from the screen by their
     sum — edge clicks then revealed the neighbouring block and drops
     landed lines too low. (The documents above have no list or quote
     before a probed block, which is why none of them could see it.) */
  const SECTION = (n) => [
    `# Section ${n}`, '',
    `para${n} ` + 'filler words '.repeat(30).trim(), '',
    `- one ${n}`, `- two ${n}`, `- three ${n}`, '',
    `> quote ${n} a`, `> quote ${n} b`, '',
    '```js', `const v${n} = 1;`, '```', '',
    '| h | k |', '|---|---|', `| c${n} | d |`, '',
    `soft${n} line one`, `soft${n} line two`, `soft${n} line three`, '',
  ].join('\n');
  const LONG = [SECTION(1), SECTION(2), SECTION(3), 'end line'].join('\n');
  const BLANK2 = LONG.indexOf('\n') + 1; // line 2 is blank: a cursor there reveals nothing
  const scrollToText = async (text) => {
    view.dispatch({ effects: CM.EditorView.scrollIntoView(view.state.doc.toString().indexOf(text), { y: 'center' }) });
    await settle();
    await settle();
  };
  /* Line numbers of the blank lines right above and below a widget's block. */
  const blankAround = (w) => {
    const doc = view.state.doc;
    const first = doc.lineAt(view.posAtDOM(w)).number;
    let last = first;
    while (last < doc.lines && doc.line(last + 1).text !== '') last++;
    return { above: first - 1, below: last + 1 };
  };
  const rawLine = (text) => Array.from(document.querySelectorAll('#editor .cm-line')).some((l) => l.textContent === text);

  /* P. The height map agrees with the screen for every drawn widget. */
  await setDoc(LONG, BLANK2);
  await scrollToText('para2');
  {
    const drifts = widgets().map((w) =>
      Math.abs(view.documentTop + view.lineBlockAt(view.posAtDOM(w)).top - w.getBoundingClientRect().top));
    R.heightMap = { widgets: drifts.length, maxDrift: Math.round(Math.max(0, ...drifts)) };
  }

  /* Q. A click on the blank line just above / below a rendered block —
        the band where the selection outline is drawn — puts the cursor on
        that blank line: nothing reveals, nothing scrolls. */
  const edgeClick = async (fromBottom) => {
    await setDoc(LONG, BLANK2);
    await scrollToText('para2');
    const w = widgetWith('para2');
    if (!w) return { found: false };
    const r = w.getBoundingClientRect();
    const x = r.left + 40;
    const y = fromBottom ? r.bottom + 3 : r.top - 3;
    const s0 = view.scrollDOM.scrollTop;
    await press(x, y);
    await release(x, y);
    await settle();
    return {
      found: true,
      onBlankLine: lineOf(main().head).text === '',
      stillRendered: !!widgetWith('para2'),
      noScroll: Math.abs(view.scrollDOM.scrollTop - s0) <= 1,
    };
  };
  R.edgeAbove = await edgeClick(false);
  R.edgeBelow = await edgeClick(true);

  /* R. A click in the padding BESIDE a lower row of a wrapped paragraph
        lands on that row — not on the block's first or last line — and
        the paragraph's top edge stays put. */
  await setDoc(LONG, BLANK2);
  await scrollToText('para2');
  {
    const w = widgetWith('para2');
    R.sideClick = { found: !!w };
    if (w) {
      const r = w.getBoundingClientRect();
      const x = r.left - 20;
      const y = r.top + r.height * 0.75;
      const line = srcSpan('para2', 'para2').line;
      const aboveTop = lineTop(line.number - 1);
      R.sideClick.targetIsPadding = document.elementFromPoint(x, y) === view.contentDOM;
      await press(x, y);
      await release(x, y);
      const head = main().head;
      R.sideClick.onLine = lineOf(head).number === line.number;
      R.sideClick.lowerRow = head > line.from + 40 && head < line.to - 20;
      R.sideClick.topKept = kept(aboveTop, lineTop(line.number - 1));
    }
  }

  /* S. A reveal that changes a block's height moves the side with LESS
        visible text: the clicked block keeps its top edge when it sits low
        on the screen (the change goes below) and its bottom edge when it
        sits high (the change goes above). Soft-break lines are taller raw
        than rendered by nature (three lines vs one joined row); a table
        is shorter raw. */
  const shiftCase = async (text, word, place) => {
    await setDoc(LONG, BLANK2);
    await scrollToText(text);
    view.scrollDOM.scrollTop += place === 'low' ? -160 : 160;
    await settle(); await settle();
    const w = widgetWith(text);
    const p = w && wordPoint(w, word);
    if (!p) return { found: false };
    const { above, below } = blankAround(w);
    const aboveTop = lineTop(above);
    const belowTop = lineTop(below);
    await press(p.x, p.y);
    await release(p.x, p.y);
    await settle();
    return {
      found: true,
      revealed: !widgetWith(text),
      aboveKept: kept(aboveTop, lineTop(above)),
      belowKept: kept(belowTop, lineTop(below)),
    };
  };
  R.shiftSoftLow = await shiftCase('soft2 line one', 'two', 'low');
  R.shiftSoftHigh = await shiftCase('soft2 line one', 'two', 'high');
  R.shiftTableLow = await shiftCase('c2', 'c2', 'low');

  /* S2. A block taller than the screen (both edges off screen) keeps the
         clicked ROW under the pointer instead of an edge. */
  {
    const tallLines = Array.from({ length: 90 }, (_, i) => `tall row ${i} soft text`);
    const TALL = 'lead\n\n' + tallLines.join('\n') + '\n\nafter';
    await setDoc(TALL);
    await scrollToText('tall row 45');
    const w = widgetWith('tall row 45');
    if (w) { // centre the MIDDLE of the block, so both of its edges are off screen
      const r0 = w.getBoundingClientRect();
      const s0 = view.scrollDOM.getBoundingClientRect();
      view.scrollDOM.scrollTop += (r0.top + r0.height / 2) - (s0.top + s0.height / 2);
      await settle(); await settle();
    }
    const p = w && wordPoint(w, 'row 45 ');
    R.tallRowPin = { found: !!p };
    if (p) {
      const r = w.getBoundingClientRect();
      const sr = view.scrollDOM.getBoundingClientRect();
      R.tallRowPin.bothEdgesOff = r.top < sr.top && r.bottom > sr.bottom;
      await press(p.x, p.y);
      await release(p.x, p.y);
      await settle();
      const c = view.coordsAtPos(main().head);
      R.tallRowPin.onRow = lineOf(main().head).text.startsWith('tall row 45');
      R.tallRowPin.underPointer = !!c && Math.abs((c.top + c.bottom) / 2 - p.y) <= 3;
    }
  }

  /* S3. Typing a character the parser merges into the block above (lazy
         continuation) reveals that block without any click — the caret's
         line stays where it is. */
  {
    const at = LONG.indexOf('soft2 line three') + 'soft2 line three'.length + 1;
    await setDoc(LONG, at);
    await scrollToText('soft2 line one');
    const c0 = view.coordsAtPos(at);
    view.dispatch(Object.assign(view.state.replaceSelection('x'), { userEvent: 'input.type' }));
    await settle(); await settle();
    const c1 = view.coordsAtPos(main().head);
    R.typingMerge = { revealed: rawLine('soft2 line one'), caretKept: !!c0 && !!c1 && Math.abs(c1.top - c0.top) <= 1 };
  }

  /* S4. Arrow keys keep the caret's line in place when blocks switch:
         leaving the revealed soft lines (taller raw) downward, the blank
         line the caret lands on stays put while the lines re-render above
         it; ArrowUp from under a tall paragraph at the top of the screen
         lands on its last row without throwing the view up to its first
         row (it jumped by the paragraph's height). */
  const keyPress = async (k) => {
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    await sleep(120); await settle(); await settle();
  };
  {
    const inside = LONG.indexOf('soft2 line three') + 3;
    await setDoc(LONG, inside);
    await scrollToText('soft2 line one');
    const blankNo = lineOf(inside).number + 1;
    const y0 = lineTop(blankNo);
    await keyPress('ArrowDown');
    R.arrowLeave = {
      onBlank: lineOf(main().head).number === blankNo,
      rerendered: !!widgetWith('soft2 line one'),
      kept: kept(y0, lineTop(blankNo)),
    };
  }
  {
    const blank = LONG.indexOf('\n', LONG.indexOf('para2')) + 1;
    await setDoc(LONG, blank);
    view.dispatch({ effects: CM.EditorView.scrollIntoView(blank, { y: 'start', yMargin: 6 }) });
    await settle(); await settle();
    const st0 = view.scrollDOM.scrollTop;
    await keyPress('ArrowUp');
    const c = view.coordsAtPos(main().head);
    const sr = view.scrollDOM.getBoundingClientRect();
    const line = lineOf(main().head);
    R.arrowUpTall = {
      onPara: line.text.startsWith('para2'),
      lastRow: !!c && Math.abs(c.top - view.coordsAtPos(line.to, -1).top) <= 1, // the row the line ends on
      noJump: Math.abs(view.scrollDOM.scrollTop - st0) <= 2 * view.defaultLineHeight + 4,
      caretVisible: !!c && c.top >= sr.top - 1 && c.bottom <= sr.bottom + 1,
    };
  }

  /* X. Images and display math stay rendered UNDER their source while
        their block is edited, and a formula's preview follows typing. */
  {
    /* A real file beside index.html: markdown-it rejects data: URLs, and
       web mode resolves relative paths against the page. */
    const MEDIA = ['intro', '', '![pic](image_assets/bg_1_web.jpg)', '', '$$', 'x = \\frac{a}{b}', '$$', '', 'end'].join('\n');
    const loaded = async (sel) => {
      for (let i = 0; i < 60; i++) {
        const im = document.querySelector(sel);
        if (im && im.complete && im.naturalHeight) break;
        await sleep(50);
      }
      await settle(); await settle();
    };
    await setDoc(MEDIA);
    await loaded('#editor .lp-render img');
    const imgWidget = widgets().find((w) => w.querySelector('img') && !w.closest('.lp-below'));
    const imgH = imgWidget ? imgWidget.querySelector('img').getBoundingClientRect().height : 0;
    view.dispatch({ selection: { anchor: MEDIA.indexOf('![pic') + 2 } });
    await loaded('#editor .lp-below img');
    const below = document.querySelector('#editor .lp-below img');
    R.mediaImage = {
      rendered: imgH > 50,
      sourceShown: Array.from(document.querySelectorAll('#editor .cm-line')).some((l) => l.textContent.startsWith('![pic](')),
      previewBelow: !!below && Math.abs(below.getBoundingClientRect().height - imgH) <= 2,
    };
    view.dispatch({ selection: { anchor: MEDIA.indexOf('x = ') + 1 } });
    await settle(); await settle();
    const k1 = document.querySelector('#editor .lp-below .katex');
    const t1 = k1 ? k1.textContent : null;
    view.dispatch(Object.assign(view.state.replaceSelection('y'), { userEvent: 'input.type' }));
    await settle(); await settle();
    const k2 = document.querySelector('#editor .lp-below .katex');
    R.mediaMath = {
      previewBelow: !!k1,
      followsTyping: !!k2 && k2.textContent !== t1,
      imageBackToRendered: !!widgets().find((w) => w.querySelector('img') && !w.closest('.lp-below')),
    };
  }

  /* Y. Rendered blocks CodeMirror has not drawn keep the height they were
        measured at, instead of counting as one line each: reopening a long
        note at its end gives the same document height as scrolling
        through it. */
  {
    const LONG6 = [1, 2, 3, 4, 5, 6].map((n) => SECTION(n)).join('\n') + '\nend line';
    const scrollThrough = async () => {
      const sd = view.scrollDOM;
      for (let y = 0; y <= sd.scrollHeight; y += Math.round(sd.clientHeight * 0.7)) {
        sd.scrollTop = y;
        /* Hidden window: force the measure that draws the newly visible
           blocks, then the one that measures them. */
        view.requestMeasure();
        await sleep(30); await settle(); await settle();
      }
    };
    await setDoc(LONG6, BLANK2);
    await scrollThrough();
    replaceEditorContent(LONG6);
    view.dispatch({ selection: { anchor: LONG6.length }, effects: CM.EditorView.scrollIntoView(LONG6.length, { y: 'end' }) });
    await settle(); await settle();
    const h0 = view.contentHeight;
    await scrollThrough();
    R.heightEstimate = { drift: Math.round(Math.abs(view.contentHeight - h0)), total: Math.round(view.contentHeight) };
  }

  /* U. The block being edited keeps its rendered geometry: raw height ==
        rendered height (±2 px) for headings, a tight and a nested list, a
        one-line quote and a wrapped paragraph — at two text sizes. */
  const PARITY = [
    'intro line', '',
    '# One', '', '## Two', '', '### Three', '',
    '- tight alpha', '- tight beta', '- tight gamma', '',
    'a paragraph between the two lists', '',
    '- outer one', '  - inner one', '  - inner two', '- outer two', '',
    '> a one line quote', '',
    'wrapped parity ' + 'filler words '.repeat(40).trim(), '',
    'tail line',
  ].join('\n');
  const parityRun = async () => {
    const out = {};
    const blank = PARITY.indexOf('\n') + 1;
    await setDoc(PARITY, blank);
    for (const [key, text] of [['h1', '# One'], ['h2', '## Two'], ['h3', '### Three'], ['list', '- tight alpha'],
      ['nested', '- outer one'], ['quote', '> a one line quote'], ['para', 'wrapped parity']]) {
      const from = PARITY.indexOf(text);
      const d = view.state.doc;
      let n = d.lineAt(from).number;
      while (n < d.lines && d.line(n + 1).text !== '') n++;
      const to = d.line(n).to;
      view.dispatch({ selection: { anchor: blank }, effects: CM.EditorView.scrollIntoView(from, { y: 'center' }) });
      await settle(); await settle();
      const w = widgets().find((x) => { try { return view.posAtDOM(x) === from; } catch (_) { return false; } });
      const rendered = w ? w.getBoundingClientRect().height : NaN;
      view.dispatch({ selection: { anchor: from + 1 } });
      await settle(); await settle();
      const raw = view.lineBlockAt(to).bottom - view.lineBlockAt(from).top;
      out[key] = Math.round((raw - rendered) * 10) / 10;
    }
    return out;
  };
  R.rawParity = await parityRun();
  window.setPreviewTextSize(100);
  await sleep(200);
  R.rawParitySmall = await parityRun();
  window.setPreviewTextSize(140);
  await sleep(200);

  /* T. The block being edited re-renders when another block below it is
        clicked: the clicked block keeps its place although the content
        above it shrank — with the shrinking block on screen, and scrolled
        out of view above (where CodeMirror's own scroll anchoring also
        acts; the two must not add up). */
  const collapseCase = async (targetText, targetWord, scrollFirst) => {
    await setDoc(LONG, BLANK2);
    await scrollToText('soft1 line one');
    const s1 = widgetWith('soft1 line one');
    const p1 = s1 && wordPoint(s1, 'two');
    if (!p1) return { found: false };
    await press(p1.x, p1.y);
    await release(p1.x, p1.y);
    const firstRevealed = rawLine('soft1 line two');
    await sleep(450); // never a double-click
    if (scrollFirst) await scrollToText(targetText);
    const w = widgetWith(targetText);
    const p = w && wordPoint(w, targetWord);
    if (!p) return { found: false, firstRevealed };
    const { above } = blankAround(w);
    const aboveTop = lineTop(above);
    await press(p.x, p.y);
    await release(p.x, p.y);
    return {
      found: true,
      firstRevealed,
      firstRerendered: !rawLine('soft1 line two'),
      aboveKept: kept(aboveTop, lineTop(above)),
    };
  };
  R.collapseAbove = await collapseCase('Section 2', 'Section', false);
  R.collapseOffscreen = await collapseCase('para3', 'filler', true);

  window.setLivePreviewMode(false);
  await sleep(200);
  R.offClean = !document.querySelector('#editor .lp-render') && !document.querySelector('#editor .lp-yaml');
  return R;
})()
