/* link_rewrite.js — pure markdown link rewriting for rename/move operations.
   NO DOM: everything takes strings in and returns strings out, so the whole
   module is unit-tested in plain node (test/link_rewrite.test.js) without a
   filesystem. Path spelling comes from paths.js — the same functions the
   renderer uses — so the invariant holds by construction: any link that
   rendered correctly before a rename/move renders correctly after it, and
   links that never resolved are never touched.

   Deliberate limits (documented, not bugs):
   - Only markdown syntax `![alt](dest)` / `[text](dest)` (optional "title"),
     the only link forms the app itself produces. Raw HTML <img> and
     angle-bracket destinations `(<a b.png>)` are left untouched.
   - Fenced code blocks and inline code spans are never rewritten.
   - Any destination with a URL scheme (http:, data:, …) or an anchor (#…)
     is never touched. */

import { normalizePath, isAbsolutePath, hasUrlScheme, resolvePath,
         relativePath, encodeLinkDest, decodeLinkDest } from './paths.js';

/** Build abs→abs mapper from rename records [{oldPath,newPath}] (prefix-aware
    so folder moves remap every descendant). Returns null for unmoved paths. */
export function buildAbsMapper(records) {
  const pairs = records.map((r) => [normalizePath(r.oldPath), normalizePath(r.newPath)]);
  return (abs) => {
    for (const [o, n] of pairs) {
      if (abs === o) return n;
      if (abs.startsWith(o + '/')) return n + abs.slice(o.length);
    }
    return null;
  };
}

/** Inverted records (new→old), for undo and for mapping post-paths back. */
export function invertRecords(records) {
  return records.map((r) => ({ oldPath: r.newPath, newPath: r.oldPath }));
}

/* ![alt](dest) or [text](dest), optional "title"/'title'. Destination is a
   run without whitespace/parens — exactly what the app emits (it encodes
   spaces and parens), and the same shape the LaTeX exporter already parses. */
const LINK_RE = /(!?)\[([^\]]*)\]\(\s*([^()\s]+)(\s+"[^"]*"|\s+'[^']*')?\s*\)/g;

/**
 * Rewrite the links of one document.
 * @param {string} text            document content
 * @param {object} opts
 *   fileDirBefore {string}  directory of this file BEFORE the operation
 *   fileDirAfter  {string}  directory AFTER (differs only if the file moved)
 *   mapAbs        {fn}      abs path → new abs path, or null if not moved
 * @returns {{text: string, changes: number}}
 */
export function rewriteLinksInText(text, opts) {
  const dirBefore = normalizePath(opts.fileDirBefore);
  const dirAfter = normalizePath(opts.fileDirAfter);
  const mapAbs = opts.mapAbs || (() => null);
  const selfMoved = dirBefore !== dirAfter;
  let changes = 0;

  let inFence = false;
  let fenceChar = '';
  const out = text.split('\n').map((line) => {
    /* Fenced code blocks are opaque. */
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const ch = fence[1][0];
      if (!inFence) { inFence = true; fenceChar = ch; }
      else if (ch === fenceChar) { inFence = false; }
      return line;
    }
    if (inFence) return line;

    /* Mask inline code spans so links inside backticks stay untouched. */
    const spans = [];
    const masked = line.replace(/`[^`]*`/g, (m) => {
      spans.push(m);
      return '\u0000' + (spans.length - 1) + '\u0000';
    });

    const rewritten = masked.replace(LINK_RE, (full, bang, label, dest, title) => {
      if (hasUrlScheme(dest) || dest.startsWith('#')) return full;

      const decoded = decodeLinkDest(dest);
      if (hasUrlScheme(decoded) || decoded.startsWith('#')) return full;

      const wasAbsolute = isAbsolutePath(decoded);
      const absOld = resolvePath(dirBefore, decoded);
      const mapped = mapAbs(absOld);

      /* Rewrite when the target moved, or when this file itself moved and
         the destination is relative (its base directory changed). */
      if (mapped === null && !(selfMoved && !wasAbsolute)) return full;

      const absNew = mapped === null ? absOld : mapped;
      /* Preserve the author's style: absolute stays absolute. */
      const newDest = encodeLinkDest(wasAbsolute ? absNew : relativePath(dirAfter, absNew));
      if (newDest === dest) return full;

      changes++;
      return `${bang}[${label}](${newDest}${title || ''})`;
    });

    return rewritten.replace(/\u0000(\d+)\u0000/g, (_, i) => spans[+i]);
  });

  return { text: out.join('\n'), changes };
}
