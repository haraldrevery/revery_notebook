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

  /* Nothing is wider than the phone. */
  out.noHorizontalOverflow = document.documentElement.scrollWidth <= window.innerWidth;
  return out;
})()
