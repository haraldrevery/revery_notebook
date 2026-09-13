/* In-page driver for the desktop media E2E. Evaluated by executeJavaScript
   from media_e2e_main.js inside the REAL Electron renderer (preload + IPC +
   sidebar bundle in desktop mode). Must be a single expression resolving
   to a JSON-serializable object. It reports FACTS; test/media_e2e.test.js
   holds the assertions.

   Every drop is a real DragEvent with a real DataTransfer, dispatched on
   CodeMirror's content DOM exactly where the browser would deliver it —
   so the capture/bubble ordering between the sidebar bundle's listener and
   CodeMirror's own drop handler is exercised, not simulated. */
(async () => {
  const PROJECT = __PROJECT__;
  const PNG_B64 = __PNG_B64__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { const v = fn(); if (v) return v; } catch (_) { /* not yet */ }
      await sleep(50);
    }
    return null;
  };
  const norm = (p) => String(p || '').replace(/\\/g, '/');
  const pngBytes = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));
  const listDir = async (dir) => (await window.NativeAPI.readDirectory(dir)).map((e) => e.name).sort();
  const count = (hay, needle) => hay.split(needle).length - 1;
  const activeFile = () => norm(window.sidebarGetActiveFilePath());
  const previewImgSrcs = () => Array.from(document.querySelectorAll('#preview img')).map((i) => i.getAttribute('src') || '');
  /* file:// sources, decoded to plain paths (encodeURI keeps parens raw,
     so compare decoded text, never a hand-written encoding). */
  const previewFilePaths = () => previewImgSrcs()
    .filter((s) => s.startsWith('file://'))
    .map((s) => { try { return decodeURIComponent(new URL(s).pathname); } catch (_) { return s; } });
  const contentPoint = () => {
    const r = window.cmView.contentDOM.getBoundingClientRect();
    return { x: r.left + 40, y: r.top + 20 };
  };
  const dropOnEditor = (dt) => {
    const { x, y } = contentPoint();
    window.cmView.contentDOM.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y,
    }));
  };
  const fileDt = (name, bytes, type) => {
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], name, { type }));
    return dt;
  };
  /* Every ![alt](dest) in the buffer, resolved against the active note's
     folder, must name a file that exists there (dests are bare names in
     these probes). This is the property users see as "the image renders". */
  const allLinksResolve = async () => {
    const dir = activeFile().split('/').slice(0, -1).join('/');
    if (!dir) return false;
    const names = await listDir(dir);
    const dests = Array.from(editor.value.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)).map((m) => decodeURIComponent(m[1]));
    return dests.length > 0 && dests.every((d) => !d.includes('/') && names.includes(d));
  };

  const out = {};

  /* 0. Boot restored the seeded project and note (desktop mode, real IPC). */
  out.booted = !!(await until(() => window.NativeAPI && window.NativeAPI.env === 'electron'
    && typeof window.sidebarGetActiveFilePath === 'function'
    && activeFile() === norm(PROJECT + '/note.md')
    && norm(window.sidebarGetRootPath()) === norm(PROJECT)));
  if (!out.booted) return out;
  await sleep(300);

  /* 1. OS image dropped on the editor while note.md (project root) is active:
        copied next to the note, ONE encoded link, preview resolves it. */
  {
    dropOnEditor(fileDt('shot from desk (1).png', pngBytes, 'image/png'));
    const link = '![shot from desk (1).png](shot%20from%20desk%20%281%29.png)';
    const inserted = !!(await until(() => editor.value.includes(link)));
    await sleep(400);
    const previewOk = !!(await until(() => previewFilePaths().some((p) => p.endsWith('/shot from desk (1).png')), 3000));
    out.osDrop = {
      linkInserted: inserted,
      linkCount: count(editor.value, link),
      fileCopied: (await listDir(PROJECT)).includes('shot from desk (1).png'),
      noStrayText: !/file:\/\//.test(editor.value) && !editor.value.includes('//?/'),
      previewResolved: previewOk,
    };
  }

  /* 2. A non-media OS file dropped on the editor must never be copied into
        the project (whatever the editor does with its text is CodeMirror's
        business). */
  {
    const before = editor.value;
    dropOnEditor(fileDt('notes.txt', new TextEncoder().encode('plain words'), 'text/plain'));
    await sleep(600);
    out.txtDrop = {
      notCopied: !(await listDir(PROJECT)).includes('notes.txt'),
      editorUnchanged: editor.value === before,
    };
  }

  /* 3. Sidebar payload drop — the DataTransfer a tree row's dragstart sets. */
  {
    const before = editor.value;
    const dt = new DataTransfer();
    dt.setData('text/plain', '![pic.png](sub/pic.png)');
    dt.setData('application/x-revery-path', PROJECT + '/sub/pic.png');
    dropOnEditor(dt);
    await sleep(400);
    out.sidebarDrop = {
      inserted: editor.value !== before,
      linkCount: count(editor.value, '![pic.png](sub/pic.png)'),
      selectionCollapsed: editor.selectionStart === editor.selectionEnd,
      noStrayText: !editor.value.includes('application/') && !/file:\/\//.test(editor.value),
    };
  }

  /* 3b. A multi-selection dragged from the REAL tree: two images picked
         with Ctrl+click travel as ONE drag, and dropping it on the editor
         inserts one link per image, each on its own line, in tree order. */
  {
    const subPath = PROJECT + '/sub';
    const fileRow = (p) => document.querySelector(`.sidebar-file[data-path="${CSS.escape(p)}"]`);
    const subRow = await until(() => document.querySelector(`.sidebar-dir[data-path="${CSS.escape(subPath)}"]`));
    if (subRow && !subRow.classList.contains('expanded')) subRow.click();
    const a = await until(() => fileRow(subPath + '/a-one.png'));
    const b = await until(() => fileRow(subPath + '/b-two.png'));
    out.multiDrag = { rowsFound: !!(a && b) };
    if (a && b) {
      const linkA = '![a-one.png](sub/a-one.png)';
      const linkB = '![b-two.png](sub/b-two.png)';
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      b.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      const dt = new DataTransfer();
      b.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      let payload = null;
      try {
        payload = JSON.parse(dt.getData('application/x-revery-path')).map((p) => norm(p).replace(norm(PROJECT), '<project>'));
      } catch (_) { /* reported as null */ }
      out.multiDrag.payload = payload;
      out.multiDrag.plainText = dt.getData('text/plain');
      dropOnEditor(dt);
      b.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
      await sleep(400);
      out.multiDrag.linkCounts = [count(editor.value, linkA), count(editor.value, linkB)];
      out.multiDrag.onConsecutiveLines = editor.value.includes(linkA + '\n' + linkB + '\n');
    }
  }

  /* 4. Click an image in a SUBFOLDER: the preview shows it (resolved
        against the folder the future note will live in), no file is
        created yet, and the editor holds a link relative to that folder. */
  {
    const subPath = PROJECT + '/sub';
    const subRow = await until(() => document.querySelector(`.sidebar-dir[data-path="${CSS.escape(subPath)}"]`));
    if (subRow && !subRow.classList.contains('expanded')) subRow.click();
    const picRow = await until(() => document.querySelector(`.sidebar-file[data-path="${CSS.escape(subPath + '/pic.png')}"]`));
    if (picRow) picRow.click();
    await sleep(500);
    const previewOk = !!(await until(() => previewFilePaths().some((p) => p.endsWith('/sub/pic.png')), 3000));
    out.mediaPreview = {
      rowFound: !!picRow,
      editorText: editor.value,
      activeIsNull: window.sidebarGetActiveFilePath() === null,
      previewResolvedToSubfolder: previewOk,
      noteNotCreatedYet: !(await listDir(subPath)).some((n) => n.endsWith('.md')),
      rowHighlighted: !!document.querySelector('.sidebar-item.sidebar-media-active'),
    };
  }

  /* 5. Drop a second image while previewing: the media must land NEXT TO
        the note that this very drop causes to be created, and every link
        in that note must resolve from the note's own folder. */
  {
    dropOnEditor(fileDt('second.png', pngBytes, 'image/png'));
    const created = await until(() => window.sidebarGetActiveFilePath() !== null, 8000);
    await sleep(600);
    const noteFile = activeFile();
    const noteDir = noteFile.split('/').slice(0, -1).join('/');
    let onDisk = null;
    try { onDisk = await window.NativeAPI.readFile(noteFile); } catch (_) { /* reported as null */ }
    out.coherence = {
      noteCreated: !!created,
      notePath: noteFile.replace(norm(PROJECT), '<project>'),
      mediaNextToNote: noteDir ? (await listDir(noteDir)).includes('second.png') : false,
      allLinksResolve: await allLinksResolve(),
      contentMatchesDisk: onDisk === editor.value,
      linkCount: count(editor.value, '![second.png](second.png)'),
    };
  }

  /* 6. Paste a screenshot: Pasted image <stamp>.png next to the active note. */
  {
    const dt = fileDt('image.png', pngBytes, 'image/png');
    window.cmView.contentDOM.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true, cancelable: true, clipboardData: dt,
    }));
    const ok = await until(() => /!\[Pasted image [^\]]+\]\(Pasted%20image%20[^)]+\.png\)/.test(editor.value));
    await sleep(400);
    const noteDir = activeFile().split('/').slice(0, -1).join('/');
    out.paste = {
      linkInserted: !!ok,
      fileCreated: (await listDir(noteDir)).some((n) => /^Pasted image .*\.png$/.test(n)),
      allLinksResolve: await allLinksResolve(),
    };
  }

  /* 7. Typing keeps flowing to disk through the ordinary autosave path. */
  {
    const len = editor.value.length;
    window.insertWithUndo(len, len, '\nafterwards\n');
    const file = activeFile();
    let matched = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && !matched) {
      await sleep(250);
      try { matched = (await window.NativeAPI.readFile(file)) === editor.value; } catch (_) { matched = false; }
    }
    out.autosave = { savedAfterTyping: matched, dirty: window.sidebarIsDirty ? window.sidebarIsDirty() : null };
  }

  /* 8. Link-path completion through the real desktop wiring (sidebar
        bundle feed + IPC readDirectory + CodeMirror source). Active note
        is sub/pic.md here, so `../su` must climb to the root and offer
        only `sub/`; rows carry the app's glyph; the menu wears the editor
        font; Tab accepts the first row; a folder accept re-opens the menu
        one level down; a file accept closes it. */
  {
    const typeText = async (s) => {
      for (const ch of s) {
        const at = window.cmView.state.selection.main.head;
        window.cmView.dispatch({ changes: { from: at, insert: ch }, selection: { anchor: at + 1 }, userEvent: 'input.type' });
        await sleep(30);
      }
    };
    const menu = () => document.querySelector('.cm-tooltip-autocomplete');
    const labels = () => Array.from(document.querySelectorAll('.cm-tooltip-autocomplete .cm-completionLabel')).map((e) => e.textContent);
    const tab = async () => {
      await sleep(400); // clear the engine's interactionDelay
      window.cmView.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      await sleep(400);
    };
    const len = editor.value.length;
    window.cmView.focus();
    window.cmView.dispatch({ changes: { from: len, insert: '\n' }, selection: { anchor: len + 1 } });
    await typeText('![](../su');
    const opened = !!(await until(() => menu() && labels().length, 4000));
    const firstLabels = labels();
    const glyph = !!document.querySelector('.cm-tooltip-autocomplete li .cm-completion-kind svg');
    const ul = document.querySelector('.cm-tooltip-autocomplete > ul');
    const fontMatches = !!ul && getComputedStyle(ul).fontFamily === getComputedStyle(window.cmView.contentDOM).fontFamily;
    await tab();
    const afterFolder = editor.value.slice(-'![](../sub/'.length);
    const reopened = !!(await until(() => menu() && labels().length, 4000));
    const secondLabels = labels();
    await typeText('pic.p');
    await until(() => labels().length === 1, 2000);
    await tab();
    const afterFile = editor.value.slice(-'![](../sub/pic.png'.length);
    const closed = !menu();
    out.linkComplete = { opened, firstLabels, glyph, fontMatches, afterFolder, reopened, secondLabels, afterFile, closed };
  }

  /* 9. Live preview: rendered blocks have no character geometry, so a
        sidebar image dropped on one goes in as its OWN paragraph after the
        source line under the pointer — never at a block edge, never glued
        onto text, never inside a code fence. */
  {
    window.setLivePreviewMode(true);
    const DOC = ['# Drop test', '', 'intro paragraph here', '',
      '- alpha item', '- beta item', '- gamma item', '',
      '```js', 'const code = 1;', 'more code', '```', '', 'tail text', ''].join('\n');
    const isLink = (l) => /^!\[pic\.png\]\([^)]*pic\.png\)$/.test(l);
    const wordPoint = (wrap, word) => {
      const tw = document.createTreeWalker(wrap, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = tw.nextNode())) {
        const i = n.nodeValue.indexOf(word);
        if (i < 0) continue;
        const rg = document.createRange();
        rg.setStart(n, i);
        rg.setEnd(n, i + word.length);
        const b = rg.getBoundingClientRect();
        if (b.width) return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }
      return null;
    };
    const dropOnWord = async (blockText, word) => {
      replaceEditorContent(DOC);
      window.cmView.dispatch({ selection: { anchor: DOC.indexOf('\n') + 1 } }); // blank line: every block renders
      await sleep(400);
      window.cmView.coordsAtPos(0); // run the pending measure, as the next frame would
      await sleep(100);
      const wrap = Array.from(document.querySelectorAll('#editor .cm-content .lp-render'))
        .find((el) => el.textContent.includes(blockText));
      const p = wrap && wordPoint(wrap, word);
      if (!p) return { found: false };
      const dt = new DataTransfer();
      dt.setData('text/plain', '![pic.png](sub/pic.png)');
      dt.setData('application/x-revery-path', PROJECT + '/sub/pic.png');
      (document.elementFromPoint(p.x, p.y) || window.cmView.contentDOM).dispatchEvent(new DragEvent('drop', {
        bubbles: true, cancelable: true, dataTransfer: dt, clientX: p.x, clientY: p.y,
      }));
      await sleep(300);
      const lines = editor.value.split('\n');
      const i = lines.findIndex(isLink);
      return {
        found: true,
        count: lines.filter(isLink).length,
        before: i < 0 ? null : lines.slice(Math.max(0, i - 2), i),
        after: i < 0 ? null : lines.slice(i + 1, i + 3),
      };
    };
    out.lpDrop = {
      listItem: await dropOnWord('beta item', 'beta'),
      codeLine: await dropOnWord('more code', 'more'),
      paragraph: await dropOnWord('intro paragraph', 'paragraph'),
    };
    window.setLivePreviewMode(false);
  }

  /* 10. Card view: the CARD owns the drag. A media card's thumbnail is an
         <img>, which browsers drag on their own — grabbing the picture
         started a native image drag instead of the card's. The <img> must
         be non-draggable so the card is the drag source wherever it is
         grabbed, and its dragstart carries the card's payload. (Which
         element the browser picks as drag source cannot be driven by a
         synthetic event — imgDraggable is the guard.) */
  {
    const viewBtn = document.getElementById('sidebar-view-btn');
    viewBtn.click();
    const img = await until(() => document.querySelector('.sidebar-card-media .sidebar-card-thumb img'), 5000);
    const card = img && img.closest('.sidebar-card');
    out.cardDrag = { found: !!card };
    if (card) {
      out.cardDrag.imgDraggable = img.draggable;
      out.cardDrag.cardDraggable = card.draggable;
      const dt = new DataTransfer();
      img.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      let payload = [];
      try { payload = JSON.parse(dt.getData('application/x-revery-path')); } catch (_) { /* not the card's */ }
      out.cardDrag.payloadIsCard = payload.length === 1 && payload[0] === card.dataset.path;
      card.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    }
    viewBtn.click(); // back to the tree view
    await until(() => !document.querySelector('.sidebar-card'), 5000);
  }

  return out;
})()
