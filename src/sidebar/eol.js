/* eol.js — line-ending rules for the active file. PURE (no DOM, no state),
   unit-tested in test/eol.test.js.

   The editor always holds '\n' (CodeMirror normalises every line break on
   load). A file keeps CRLF on save only when it was PURELY CRLF; mixed or
   LF files are written with '\n' — the previous behaviour for everything. */

/** '\r\n' for text whose every line break is CRLF (at least one), else '\n'. */
export function detectEol(raw) {
  if (typeof raw !== 'string' || raw.indexOf('\r\n') < 0) return '\n';
  // Pure CRLF: no '\n' without a '\r' before it, and no lone '\r'.
  return (/(^|[^\r])\n/.test(raw) || /\r(?!\n)/.test(raw)) ? '\n' : '\r\n';
}

/** Disk text → the form the editor holds (every line break '\n'). */
export function normalizeEol(raw) {
  return typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n') : raw;
}

/** Editor text → the text to write for a file whose style is `eol`. */
export function toDiskText(editorText, eol) {
  return eol === '\r\n' ? editorText.replace(/\n/g, '\r\n') : editorText;
}
