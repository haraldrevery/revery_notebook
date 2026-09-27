/* Phone-layout driver (web mode, 390px wide — see phone_e2e.test.js).
   Walks the views a phone user switches between and reports what is on
   screen. A single expression, per web_e2e_main.js. */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  const vis = (el) => !!el && getComputedStyle(el).display !== 'none'
    && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
  const view = () => document.body.getAttribute('data-view');
  const toggle = $('btn-toggle-view');
  const label = () => toggle.textContent.trim();
  const out = { width: window.innerWidth };
  await sleep(600);

  /* The web version has no project sidebar, so no button for it. */
  out.noSidebarButton = !vis($('btn-sidebar-mobile')) && !vis($('btn-sidebar'));

  /* The view toggle names the view it switches TO. */
  const labels = [label()];
  toggle.click(); await sleep(250);
  const previewShown = view() === 'preview' && vis($('preview-pane')) && !vis($('editor-pane'));
  labels.push(label());
  toggle.click(); await sleep(250);
  labels.push(label());
  out.toggleLabels = labels.join('/');
  out.toggleSwitchesView = previewShown && view() === 'editor' && vis($('editor-pane'));

  /* The document title takes the rest of its row (it used to stop at 40vw). */
  out.titleFillsRow = $('doc-title').getBoundingClientRect().right >= window.innerWidth - 30;

  /* Reader mode entered from the editor view (e.g. a desktop window narrowed
     while reading): the preview shows — it used to be a blank screen — in one
     header row, with a way out. */
  toggleReaderMode(); await sleep(300);
  out.readerShowsPreview = view() === 'preview' && vis($('preview-pane')) && !vis($('editor-pane'))
    && !!document.querySelector('#preview .prose');
  out.readerHasExit = vis($('btn-exit-reader-mode'));
  out.readerOneRow = !vis($('topbar-left')) && $('topbar').getBoundingClientRect().height < 80;
  $('btn-exit-reader-mode').click(); await sleep(300);
  out.readerExits = !document.body.classList.contains('reader-mode-active')
    && view() === 'preview' && vis(toggle) && label() === 'Editor';
  toggle.click(); await sleep(250);

  /* Status warnings show in every phone view: the top bar's slot for
     them (#size-warning) is hidden in all of them. */
  showStatusWarning('e2e', 'E2E warning', { priority: 1 });
  await sleep(50);
  let warned = vis($('phone-status'));
  toggle.click(); await sleep(250);
  warned = warned && vis($('phone-status'));
  toggle.click(); await sleep(250);
  clearStatusWarning('e2e'); await sleep(50);
  out.warningsVisible = warned && !vis($('phone-status'));

  /* A tap opens a submenu. Its compatibility mouseenter used to open it
     and the click then shut it again. A tap's event order, synthesized. */
  $('btn-settings').click(); await sleep(100);
  const row = document.querySelector('#settings-dropdown > .has-submenu');
  const rowLabel = row.querySelector(':scope > span');
  rowLabel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
  rowLabel.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
  row.dispatchEvent(new MouseEvent('mouseenter'));
  rowLabel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.tapOpensSubmenu = row.querySelector('.submenu').style.display === 'flex';
  document.body.click(); await sleep(100);

  /* Export as .html carries the latest text, although the phone editor
     view does not render the preview while typing. */
  const blobs = [];
  const origCreateURL = URL.createObjectURL;
  const origAnchorClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = (b) => { blobs.push(b); return 'about:blank'; };
  HTMLAnchorElement.prototype.click = function () {};
  const cm = window.cmView;
  cm.dispatch({ changes: { from: cm.state.doc.length, insert: '\n\nE2E_FRESH_TEXT' } });
  await sleep(400);
  executeAction('file_export_html'); await sleep(300);
  out.htmlExportFresh = blobs.length > 0 && (await blobs[blobs.length - 1].text()).includes('E2E_FRESH_TEXT');
  URL.createObjectURL = origCreateURL;
  HTMLAnchorElement.prototype.click = origAnchorClick;

  /* About can always be left: Close on screen, Escape, a backdrop tap. */
  const about = $('about-modal');
  about.classList.add('show'); await sleep(100);
  const closeRect = $('about-btn-close').getBoundingClientRect();
  const closeOnScreen = closeRect.top >= 0 && closeRect.bottom <= window.innerHeight;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const escapeCloses = !about.classList.contains('show');
  about.classList.add('show');
  about.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  about.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.aboutClosable = closeOnScreen && escapeCloses && !about.classList.contains('show');
  about.classList.remove('show');

  /* Nothing is wider than the phone. */
  out.noHorizontalOverflow = document.documentElement.scrollWidth <= window.innerWidth;
  return out;
})()
