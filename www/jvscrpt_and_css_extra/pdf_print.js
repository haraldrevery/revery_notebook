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

  /* Replace this page's content with the export document via plain DOM.
     NOT document.open()/write(): this script runs synchronously while the
     page is still parsing, and per spec document.open() is a NO-OP from a
     parser-inserted script — write() then APPENDS at the parser's insertion
     point instead of replacing, which left the "Preparing document…"
     placeholder as the first element of the printed PDF. Grafting the parsed
     payload's head/body wholesale removes the placeholder (and this script
     element) deterministically, with no parser re-entrancy quirks. The
     payload's <base> precedes its <link>/<style>, so relative assets (code
     theme, brand fonts) still resolve. */
  try {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc || !doc.body || !doc.body.childNodes.length) {
      throw new Error('parsed document is empty');
    }
    var adoptAll = function (el) {
      /* Snapshot first: childNodes is LIVE and adoptNode removes each node
         from it — iterating it directly would skip every other node. */
      return Array.prototype.slice.call(el.childNodes)
        .map(function (n) { return document.adoptNode(n); });
    };
    document.head.replaceChildren.apply(document.head, adoptAll(doc.head));
    document.body.replaceChildren.apply(document.body, adoptAll(doc.body));
  } catch (err) {
    /* A visible message beats a blank window (and beats printing the
       placeholder — the bug class this file's approach exists to prevent). */
    document.body.textContent = 'Could not prepare the document for printing: '
      + ((err && err.message) || err);
    return;
  }

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
