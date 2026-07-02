/* find_worker.js — regex execution sandbox for the find/replace bar.
 *
 * User-supplied regular expressions run here, off the main thread, so a
 * catastrophic pattern (ReDoS) can never freeze the editor. The main
 * thread enforces a hard time budget and terminates this worker outright
 * when it is exceeded — that is the actual safety mechanism; this file
 * just does the work.
 *
 * Protocol (one request in flight at a time, matched by id):
 *   → { id, op:'ping' }
 *   → { id, op:'find',       text, query, flags }
 *   → { id, op:'replaceAll', text, query, flags, replacement }
 *   ← { id, ok:true }                                   (ping)
 *   ← { id, ok:true, matches:[{index,length}] }         (find)
 *   ← { id, ok:true, text }                             (replaceAll)
 *   ← { id, ok:false, error:'syntax'|'exec' }
 */
'use strict';

/* Cap the match list so a match-everything query on a huge document can't
   balloon memory or drown the highlight layer. The find counter saturates
   long before this is reachable in practice. */
var MAX_MATCHES = 100000;

self.onmessage = function (e) {
  var data = e.data || {};
  var id = data.id;

  if (data.op === 'ping') {
    self.postMessage({ id: id, ok: true });
    return;
  }

  var re;
  try {
    re = new RegExp(data.query, data.flags);
  } catch (_) {
    self.postMessage({ id: id, ok: false, error: 'syntax' });
    return;
  }

  try {
    if (data.op === 'find') {
      var matches = [];
      var m;
      while ((m = re.exec(data.text)) !== null) {
        if (m[0].length > 0) {
          matches.push({ index: m.index, length: m[0].length });
          if (matches.length >= MAX_MATCHES) break;
        }
        /* Zero-length match (e.g. `a*` between characters): advance
           manually or exec() would loop forever on the same position. */
        if (re.lastIndex === m.index) re.lastIndex++;
      }
      self.postMessage({ id: id, ok: true, matches: matches });
    } else if (data.op === 'replaceAll') {
      self.postMessage({ id: id, ok: true, text: data.text.replace(re, data.replacement) });
    } else {
      self.postMessage({ id: id, ok: false, error: 'exec' });
    }
  } catch (_) {
    self.postMessage({ id: id, ok: false, error: 'exec' });
  }
};
