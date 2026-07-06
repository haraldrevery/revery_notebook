'use strict';

/* Dedicated PDF print window (Tauri spike).
   The main window stages the full self-contained export document (the same
   string Electron feeds to printToPDF, from buildPdfDocument) into
   localStorage under one key, then opens this page in a SEPARATE
   WebviewWindow. Because both windows share the app origin, localStorage is
   shared and the document's relative asset links (hljs code theme, brand
   fonts) resolve natively here. We rewrite this document to BE the export
   document — so nothing of the live app (CodeMirror, #workspace, app CSS)
   is present to leak into the print — and call window.print(). That is the
   whole point of the approach: a clean page instead of the polluted live
   page the in-app path prints. */

(function () {
  var KEY = '__revery_pdf_payload__';

  var html = null;
  try { html = localStorage.getItem(KEY); } catch (e) { html = null; }
  try { localStorage.removeItem(KEY); } catch (e) {}

  if (!html) {
    document.body.textContent =
      'No document was staged for printing (localStorage did not carry the payload across windows).';
    return;
  }

  /* Replace the whole document with the export document. */
  document.open();
  document.write(html);
  document.close();

  var printed = false;
  function doPrint() {
    if (printed) return;
    printed = true;
    try { window.print(); }
    catch (err) { console.error('[pdf-print] window.print failed:', err); }
  }

  /* Print once fonts are ready so descenders/metrics are correct; hard
     fallback in case document.fonts.ready never settles in WebKitGTK. */
  var ready = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  ready.then(function () { setTimeout(doPrint, 200); });
  setTimeout(doPrint, 1500);

  /* Close this window after printing (or if the dialog is cancelled). */
  window.addEventListener('afterprint', function () {
    try {
      var T = window.__TAURI__;
      if (T && T.webviewWindow && T.webviewWindow.getCurrentWebviewWindow) {
        T.webviewWindow.getCurrentWebviewWindow().close();
        return;
      }
    } catch (e) { /* fall through */ }
    try { window.close(); } catch (e) {}
  });
})();
