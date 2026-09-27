/* In-page driver for the text typography E2E check (evaluated by
   web_e2e_main.js; see typography_e2e.test.js). Everything goes through
   the controls a user touches — Settings → Editor font… / Preview font…,
   the popup's lists, sliders and buttons, the pane −/+ buttons — and a
   click in the text is a real mousedown/mouseup on the element under the
   pointer, which is what CodeMirror's mouse handling maps. Runs the
   desktop checks above 820px and the phone-panel checks at or below.
   Must be a single expression resolving to a serializable object. */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const view = window.cmView;
  const out = { width: window.innerWidth, height: window.innerHeight };
  await sleep(600);

  /* Force CodeMirror's pending measure, as the next painted frame would.
     Used only to set a scene up, never between a change and the click
     under test (a user's click does not force a measure). */
  const settle = async () => {
    view.requestMeasure();
    view.coordsAtPos(view.state.selection.main.head);
    await sleep(60);
  };
  const saved = () => JSON.parse(localStorage.getItem('revery_md_settings') || '{}');
  const rootVar = (name) => document.documentElement.style.getPropertyValue(name);
  const popup = () => document.querySelector('.font-settings-content');
  const openVia = (rowText) => {
    const row = Array.from(document.querySelectorAll('#settings-dropdown > .menu-item'))
      .find((el) => el.textContent.includes(rowText));
    if (row) row.click();
    return popup();
  };
  const closeBtn = () => popup() && popup().querySelector('.modal-btn-primary');
  /* Pick `optionText` in the popup's list number `which` (0 font, 1 size). */
  const pickInList = (which, optionText) => {
    const list = popup() && popup().querySelectorAll('.fs-dd')[which];
    if (!list) return false;
    list.querySelector('.export-dd-btn').click();
    const opt = Array.from(list.querySelectorAll('.export-dd-item'))
      .find((b) => b.textContent.toLowerCase().includes(optionText.toLowerCase()));
    if (opt) opt.click();
    return !!opt;
  };
  const listLabel = (which) => popup().querySelectorAll('.fs-dd .export-dd-btn')[which].textContent.trim();
  /* Drag a slider to `value` (input events) and release it (change). */
  const slide = (which, value, release) => {
    const input = popup().querySelectorAll('.fs-slider input[type="range"]')[which];
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (release) input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  if (window.innerWidth <= 820) {
    /* ── Phone: a bottom panel that keeps the text in view and can always
          be closed. */
    replaceEditorContent('# Heading\n\nSome text to look at while changing it.');
    await sleep(300);
    const p = openVia('Preview font');
    const r = p ? p.getBoundingClientRect() : null;
    out.phonePanel = !!r && Math.abs(r.bottom - window.innerHeight) <= 1 && r.left <= 0.5
      && Math.abs(r.width - window.innerWidth) <= 1 && r.height <= window.innerHeight * 0.55 + 1;
    /* With the font list open the panel scrolls; Close stays reachable. */
    pickInList(0, '__no_such_font__'); // opens the list only
    await sleep(100);
    p.scrollTop = p.scrollHeight;
    await sleep(50);
    const cr = closeBtn().getBoundingClientRect();
    out.phoneCloseReachable = p.scrollHeight > p.clientHeight && cr.bottom <= window.innerHeight && cr.top >= r.top;
    /* An on-screen keyboard covering the bottom of the window lifts the
       panel above it (a stand-in visualViewport: no keyboard here). */
    escape(); await sleep(50); escape(); await sleep(50);
    const fakeVV = Object.assign(new EventTarget(), { height: window.innerHeight - 300, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { value: fakeVV, configurable: true });
    const pk = openVia('Preview font');
    fakeVV.dispatchEvent(new Event('resize'));
    await sleep(50);
    const lifted = pk.getBoundingClientRect();
    out.keyboardLifts = Math.abs(lifted.bottom - (window.innerHeight - 300)) <= 1 && lifted.top >= 0;
    fakeVV.height = window.innerHeight;
    fakeVV.dispatchEvent(new Event('resize'));
    await sleep(50);
    out.keyboardLifts = out.keyboardLifts && Math.abs(pk.getBoundingClientRect().bottom - window.innerHeight) <= 1;
    escape(); await sleep(50);
    delete window.visualViewport;
    openVia('Preview font');
    pickInList(0, '__no_such_font__');
    await sleep(100);
    /* The view toggle keeps it open (to look at the other pane). */
    const toggle = document.getElementById('btn-toggle-view');
    toggle.click(); await sleep(150);
    out.phoneToggleKeepsOpen = !!popup();
    toggle.click(); await sleep(150);
    /* Escape closes the open list first, then the panel. */
    escape(); await sleep(50);
    const listShut = !!popup() && !popup().querySelector('.export-dd-menu.open');
    escape(); await sleep(50);
    out.phoneEscapeCloses = listShut && !popup();
    out.noHorizontalOverflow = document.documentElement.scrollWidth <= window.innerWidth;
    return out;
  }

  if (window.innerHeight < 500) {
    /* ── A short desktop window (a landscape phone gets the desktop layout):
          the docked panel fits, and Close is reachable by scrolling it. */
    const p = openVia('Preview font');
    pickInList(0, '__no_such_font__'); // open the long list
    await sleep(100);
    const r = p.getBoundingClientRect();
    p.scrollTop = p.scrollHeight;
    await sleep(50);
    const cr = closeBtn().getBoundingClientRect();
    out.shortFits = r.top >= 0 && r.bottom <= window.innerHeight;
    out.shortCloseReachable = cr.bottom <= window.innerHeight && cr.top >= r.top;
    escape(); await sleep(50);
    const listShut = !!popup() && !popup().querySelector('.export-dd-menu.open');
    escape(); await sleep(50);
    out.shortEscapeCloses = listShut && !popup();
    return out;
  }

  /* ── 1. After a typography change the editor re-measures: the first
          click lands on the line under the pointer. CodeMirror re-measures
          by itself only when its scroller resizes, so its line map kept
          the old sizes and the click (and the caret, and the typing)
          landed lines away. Classic editor: three −/+ steps, then a font
          change through the popup. */
  const LONG = Array.from({ length: 220 }, (_, i) =>
    `para ${i} ` + 'words to wrap the line '.repeat(i % 3 ? 3 : 9)).join('\n\n') + '\n\ntail';
  const openLong = async (lp) => {
    window.setLivePreviewMode(lp);
    replaceEditorContent(LONG);
    editor.setSelectionRange(0, 0);
    await sleep(350);
    await settle();
    view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight * 0.5;
    await settle(); await settle();
  };
  /* The drawn paragraph (line or rendered widget) nearest the scroller's middle. */
  const middleBlock = () => {
    const sr = view.scrollDOM.getBoundingClientRect();
    const mid = (sr.top + sr.bottom) / 2;
    let best = null;
    for (const el of document.querySelectorAll('#editor .cm-content > *')) {
      const r = el.getBoundingClientRect();
      if (!el.textContent.startsWith('para') || r.bottom < sr.top || r.top > sr.bottom) continue;
      const d = Math.abs((r.top + r.bottom) / 2 - mid);
      if (!best || d < best.d) best = { el, r, d };
    }
    return best;
  };
  const mouse = (type, x, y) => {
    const target = type === 'mousedown' ? (document.elementFromPoint(x, y) || document) : document;
    target.dispatchEvent(new MouseEvent(type, {
      /* detail 1 = a single click: without it CodeMirror reads a triple
         click and selects the whole line (the caret lands on the next). */
      bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, detail: 1,
      buttons: type === 'mouseup' ? 0 : 1,
    }));
  };
  /* Click the middle of the block under the scroller's middle; report the
     document line clicked and the line the caret landed on. */
  const clickMiddle = async () => {
    const b = middleBlock();
    if (!b) return { clicked: null, landed: null };
    const clicked = view.state.doc.lineAt(view.posAtDOM(b.el)).number;
    const x = b.r.left + 30, y = (b.r.top + b.r.bottom) / 2;
    mouse('mousedown', x, y);
    await sleep(80);
    mouse('mouseup', x, y);
    await sleep(150);
    return { clicked, landed: view.state.doc.lineAt(view.state.selection.main.head).number };
  };
  /* Largest gap between where CodeMirror's height map puts a drawn block
     and where it really is on screen (px). */
  const mapDrift = () => {
    const sr = view.scrollDOM.getBoundingClientRect();
    let worst = 0;
    for (const el of document.querySelectorAll('#editor .cm-content > *')) {
      const r = el.getBoundingClientRect();
      if (r.bottom < sr.top || r.top > sr.bottom || r.height < 4) continue;
      let pos;
      try { pos = view.posAtDOM(el); } catch (_) { continue; }
      worst = Math.max(worst, Math.abs(view.lineBlockAt(pos).top + view.documentTop - r.top));
    }
    return Math.round(worst);
  };
  const press = (id, times) => { for (let i = 0; i < times; i++) document.getElementById(id).click(); };

  await openLong(false);
  press('editor-font-plus', 3);
  await sleep(100);
  out.classicClickAfterSize = await clickMiddle();
  window.setEditorTextSize(150);
  await openLong(false);
  const fontPicked = !!openVia('Editor font') && pickInList(0, 'monospace');
  if (closeBtn()) closeBtn().click();
  await sleep(100);
  out.classicClickAfterFont = fontPicked ? await clickMiddle() : { clicked: 'no popup font list', landed: null };
  setPaneTypography('editor', { font: 'harald' });

  /* Live preview: the editor −/+ drive the preview size there. Its clicks
     map through the rendered DOM, so the height map is checked directly. */
  await openLong(true);
  press('editor-font-plus', 3);
  await sleep(100);
  out.lpMapDriftAfterSize = mapDrift();
  out.lpClickAfterSize = await clickMiddle();
  window.setPreviewTextSize(140);
  window.setLivePreviewMode(false);
  replaceEditorContent('# Heading one\n\nA paragraph with several words.\n\n- list alpha\n- list beta\n\n> a quote');
  await sleep(300);

  /* ── 2. Settings: two rows open the popups; the four submenus are gone. */
  const rows = Array.from(document.querySelectorAll('#settings-dropdown > *')).map((el) => el.textContent);
  out.settingsRows = rows.some((t) => t.includes('Editor font…')) && rows.some((t) => t.includes('Preview font…'))
    && !rows.some((t) => /font type|text size/i.test(t));

  /* ── 3. The Editor popup: every control applies and saves at once. */
  const menuItem = document.querySelector('#settings-dropdown .menu-item');
  const probe = document.createElement('div'); // a page-level element, like the PDF print root
  probe.innerHTML = '<p>probe text</p>';
  document.body.appendChild(probe);
  const outside = () => {
    const a = getComputedStyle(menuItem), b = getComputedStyle(probe.firstChild);
    return [a.lineHeight, a.letterSpacing, b.lineHeight, b.letterSpacing].join('|');
  };
  const outsideBefore = outside();
  const p = openVia('Editor font');
  out.editorPopupOpens = !!p && p.dataset.pane === 'editor' && listLabel(0).includes('Harald') && listLabel(1) === '150%';
  pickInList(1, '170%');
  out.sizeFromList = editorTextSize === 170 && saved().editorTextSize === 170 && listLabel(1) === '170%';
  /* The −/+ buttons change the same setting: the popup shows it and stays open. */
  press('editor-font-plus', 1);
  await sleep(50);
  out.plusMinusUpdatesPopup = !!popup() && listLabel(1) === '180%' && saved().editorTextSize === 180;
  pickInList(0, 'monospace');
  out.fontFromList = editorFontType === 'mono' && saved().editorFontType === 'mono'
    && /monospace/.test(rootVar('--editor-font')) && listLabel(0) === 'System Monospace';
  slide(0, 1.5, false);
  const midDrag = editorLineScale === 1.5 && saved().editorLineScale === 1;
  slide(0, 1.5, true);
  const lh = parseFloat(getComputedStyle(document.querySelector('#editor .cm-content')).lineHeight);
  const fs = parseFloat(getComputedStyle(document.querySelector('#editor .cm-content')).fontSize);
  out.lineSlider = midDrag && saved().editorLineScale === 1.5 && Math.abs(lh - fs * 1.4 * 1.5) < 0.6;
  slide(1, 0.1, true);
  out.letterSlider = editorLetterEm === 0.1 && saved().editorLetterEm === 0.1 && rootVar('--editor-letter-offset') === '0.1em';
  out.valuesShown = popup().querySelector('.fs-slider .fs-value').value === '150%';
  out.noLeakOutsideText = outside() === outsideBefore;
  popup().querySelector('.modal-buttons .modal-btn:not(.modal-btn-primary)').click(); // Reset
  const d = Typography.DEFAULTS.editor;
  const s = saved();
  out.resetDefaults = editorTextSize === d.size && editorFontType === d.font && editorLineScale === 1 && editorLetterEm === 0
    && s.editorTextSize === d.size && s.editorFontType === d.font && s.editorLineScale === 1 && s.editorLetterEm === 0
    && rootVar('--editor-line-scale') === '' && rootVar('--editor-letter-offset') === '' && rootVar('--editor-font') === '';
  escape(); await sleep(50);
  out.escapeCloses = !popup();

  /* The Preview popup: spacing reaches the preview text, and nothing outside. */
  openVia('Preview font');
  slide(0, 1.5, true);
  slide(1, 0.1, true);
  const pp = getComputedStyle(document.querySelector('#preview .prose p'));
  out.previewSpacing = Math.abs(parseFloat(pp.lineHeight) - parseFloat(pp.fontSize) * 1.24 * 1.5) < 0.6
    && Math.abs(parseFloat(pp.letterSpacing) - parseFloat(pp.fontSize) * 0.11) < 0.05;
  out.previewNoLeak = outside() === outsideBefore;

  /* A double click on a slider puts it back to its default; on a touch
     screen two quick taps do (iOS fires no dblclick), a slow press or a
     drag never. */
  const lineInput = () => popup().querySelector('.fs-slider input[type="range"]');
  lineInput().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  out.dblclickResets = previewLineScale === 1 && saved().previewLineScale === 1
    && popup().querySelector('.fs-value').value === '100%';
  const touch = async (holdMs) => {
    const at = { bubbles: true, pointerType: 'touch', clientX: 50, clientY: 50 };
    lineInput().dispatchEvent(new PointerEvent('pointerdown', at));
    await sleep(holdMs);
    lineInput().dispatchEvent(new PointerEvent('pointerup', at));
  };
  slide(0, 1.5, true);
  await touch(300); await sleep(50); await touch(300); // two slow presses
  const slowKept = previewLineScale === 1.5;
  await sleep(400);
  await touch(20); await sleep(80); await touch(20);  // a double tap
  out.doubleTapResets = slowKept && previewLineScale === 1 && saved().previewLineScale === 1;

  /* The number is a text field: Enter applies a typed value (comma
     decimals, clamped to the range, onto the steps); junk changes
     nothing; Escape undoes the typing and leaves the popup open. */
  const field = (i) => popup().querySelectorAll('.fs-value')[i];
  const typeInto = (i, text, keyName) => {
    field(i).focus();
    field(i).value = text;
    field(i).dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true }));
  };
  typeInto(0, '130', 'Enter');
  const t130 = previewLineScale === 1.3 && saved().previewLineScale === 1.3 && field(0).value === '130%';
  typeInto(0, '1,5', 'Enter');
  const tFactor = previewLineScale === 1.5 && field(0).value === '150%';
  typeInto(0, 'abc', 'Enter');
  const tJunk = previewLineScale === 1.5 && field(0).value === '150%';
  typeInto(0, '500%', 'Enter');
  const tClamp = previewLineScale === 2 && field(0).value === '200%';
  typeInto(1, '−0,033 em', 'Enter');
  const tLetter = previewLetterEm === -0.03 && saved().previewLetterEm === -0.03 && field(1).value === '−0.03 em';
  typeInto(0, '95', 'Escape');
  const tEscape = previewLineScale === 2 && field(0).value === '200%' && !!popup()
    && document.activeElement !== field(0);
  out.typedValues = t130 && tFactor && tJunk && tClamp && tLetter && tEscape;
  if (!out.typedValues) out.typedValuesDetail = { t130, tFactor, tJunk, tClamp, tLetter, tEscape };
  popup().querySelector('.modal-buttons .modal-btn:not(.modal-btn-primary)').click(); // Reset
  probe.remove();
  /* A click elsewhere closes it; a click on the −/+ buttons does not. */
  press('preview-font-plus', 1);
  const keptOnPlus = !!popup();
  window.setPreviewTextSize(140);
  document.getElementById('preview').click();
  await sleep(50);
  out.outsideClickCloses = keptOnPlus && !popup();

  /* Custom fonts from inside the popup: "Custom font…" opens the importer
     on top (clicks in it leave the popup open); an added font shows up in
     the open list, and its ✕ removes it (the pane falls back to Harald). */
  openVia('Preview font');
  pickInList(0, 'custom font…');
  const importer = document.getElementById('font-importer-modal');
  if (importer) {
    importer.querySelector('input').click();
    importer.querySelector('input').value = 'E2E Popup Font';
    importer.querySelector('.modal-buttons .modal-btn:not(.modal-btn-primary)').click(); // Cancel
  }
  const survivedImporter = !!importer && !!popup() && !document.getElementById('font-importer-modal');
  const made = window.createCustomFont({ kind: 'system', label: 'E2E Popup Font', family: 'Georgia' });
  const fontList = () => popup().querySelectorAll('.fs-dd')[0];
  fontList().querySelector('.export-dd-btn').click();
  const rowOf = () => Array.from(fontList().querySelectorAll('.export-dd-item')).find((b) => b.textContent.includes('E2E Popup Font'));
  const listed = !!rowOf();
  rowOf().click();
  const chosen = previewFontType === 'custom:' + made.id && listLabel(0) === 'E2E Popup Font';
  const realConfirm = window.confirm;
  window.confirm = () => true;
  fontList().querySelector('.export-dd-btn').click();
  rowOf().querySelector('.tmpl-del').click();
  window.confirm = realConfirm;
  out.customFontsInPopup = survivedImporter && made.ok && listed && chosen && !rowOf()
    && previewFontType === 'harald' && listLabel(0).includes('Harald') && !!popup();
  escape(); await sleep(50);
  escape(); await sleep(50);

  /* ── 4. Live preview shows the Preview settings: its Editor row opens
          the Preview popup, which says so. */
  window.setLivePreviewMode(true);
  await sleep(200);
  const lp = openVia('Editor font');
  out.lpOpensPreview = !!lp && lp.dataset.pane === 'preview' && !!lp.querySelector('.fs-note');
  escape(); await sleep(50);
  window.setLivePreviewMode(false);

  /* ── 5. A damaged settings blob never reaches the CSS: each bad value
          keeps its default. */
  const good = localStorage.getItem('revery_md_settings');
  localStorage.setItem('revery_md_settings', JSON.stringify(Object.assign(JSON.parse(good), {
    editorTextSize: 'huge', previewTextSize: 9000, editorFontType: 'x"; }', previewFontType: 42,
    editorLineScale: -1, previewLineScale: 'tall', editorLetterEm: 5, previewLetterEm: null, outlineFontSize: 'big',
  })));
  loadEditorSettings();
  out.loadRejectsDamage = editorTextSize === 150 && previewTextSize === 140 && editorFontType === 'harald'
    && previewFontType === 'harald' && editorLineScale === 1 && previewLineScale === 1
    && editorLetterEm === 0 && previewLetterEm === 0 && typeof outlineFontSize === 'number';
  localStorage.setItem('revery_md_settings', JSON.stringify(Object.assign(JSON.parse(good), {
    previewLineScale: 1.2345, editorLetterEm: 0.123,
  })));
  loadEditorSettings();
  out.loadSnapsToGrid = previewLineScale === 1.25 && editorLetterEm === 0.12;
  localStorage.setItem('revery_md_settings', good);
  loadEditorSettings();
  applyTypography();

  await settle();
  return out;
})()
