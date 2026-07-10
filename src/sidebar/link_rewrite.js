/* link_rewrite.js — pure markdown link rewriting for rename/move operations.
   NO imports, NO DOM: everything takes strings in and returns strings out,
   so the whole module is unit-tested in plain node (test/link_rewrite.test.js)
   without a filesystem.

   The algorithm mirrors the RENDERER's own semantics (resolveRelPath /
   mediaMarkdown in the app) instead of doing text matching: each link
   destination is decoded, resolved against the containing file's directory,
   and only rewritten when it resolves to a moved path (or when the file
   itself moved and its relative links need re-basing). The invariant this
   buys: any link that rendered correctly before a rename/move renders
   correctly after it — and links that never resolved are never touched.

   Deliberate limits (documented, not bugs):
   - Only markdown syntax `![alt](dest)` / `[text](dest)` (optional "title"),
     the only link forms the app itself produces. Raw HTML <img> and
     angle-bracket destinations `(<a b.png>)` are left untouched.
   - Fenced code blocks and inline code spans are never rewritten.
   - Any destination with a URL scheme (http:, data:, …) or an anchor (#…)
     is never touched. */

/** Normalize separators; strip one trailing slash (keeps root "/"). */
function norm(p) {
  return String(p || '').replace(/\\/g, '/').replace(/(.)\/$/, '$1');
}

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const ABS_WIN_RE = /^[a-zA-Z]:\//;

function isAbsoluteDest(p) {
  return p.startsWith('/') || ABS_WIN_RE.test(p);
}

/** Mirror of the renderer's resolveRelPath: resolve rel against baseDir. */
function resolveRel(baseDir, rel) {
  baseDir = norm(baseDir);
  rel = norm(rel);
  if (isAbsoluteDest(rel)) return rel;
  const parts = baseDir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

/** Mirror of the sidebar's makeRelativePath. */
function makeRelative(fromDir, toFile) {
  fromDir = norm(fromDir);
  toFile = norm(toFile);
  const fParts = fromDir.split('/');
  const tParts = toFile.split('/');
  let common = 0;
  while (common < fParts.length && common < tParts.length
         && fParts[common] === tParts[common]) common++;
  const up = fParts.length - common;
  return '../'.repeat(up) + tParts.slice(common).join('/');
}

/** Mirror of mediaMarkdown's minimal CommonMark-safe encoding (% first!). */
function encodeDest(p) {
  return p
    .replace(/%/g, '%25')
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function decodeSafe(s) {
  try { return decodeURIComponent(s); } catch (_) { return s; }
}

/** Build abs→abs mapper from rename records [{oldPath,newPath}] (prefix-aware
    so folder moves remap every descendant). Returns null for unmoved paths. */
export function buildAbsMapper(records) {
  const pairs = records.map((r) => [norm(r.oldPath), norm(r.newPath)]);
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
  const dirBefore = norm(opts.fileDirBefore);
  const dirAfter = norm(opts.fileDirAfter);
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
      if (SCHEME_RE.test(dest) || dest.startsWith('#')) return full;

      const decoded = decodeSafe(dest);
      if (SCHEME_RE.test(decoded) || decoded.startsWith('#')) return full;

      const wasAbsolute = isAbsoluteDest(norm(decoded));
      const absOld = resolveRel(dirBefore, decoded);
      const mapped = mapAbs(absOld);

      /* Rewrite when the target moved, or when this file itself moved and
         the destination is relative (its base directory changed). */
      if (mapped === null && !(selfMoved && !wasAbsolute)) return full;

      const absNew = mapped === null ? absOld : mapped;
      /* Preserve the author's style: absolute stays absolute. */
      const newDest = encodeDest(wasAbsolute ? absNew : makeRelative(dirAfter, absNew));
      if (newDest === dest) return full;

      changes++;
      return `${bang}[${label}](${newDest}${title || ''})`;
    });

    return rewritten.replace(/\u0000(\d+)\u0000/g, (_, i) => spans[+i]);
  });

  return { text: out.join('\n'), changes };
}
