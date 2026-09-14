/* paths.js — the ONE place that knows how the renderer spells paths.
   Pure functions, no DOM, no imports: unit-tested in test/paths.test.js.
   Shared by the sidebar bundle (link building, link rewriting on rename,
   link-path autocomplete, media ingest) and — through window.ReveryPaths,
   exposed by index.js — by the editor scripts (preview image resolution,
   LaTeX export image collection). These rules used to live in five files
   and had already drifted.

   Conventions
   • Paths are compared and joined with '/'; every input is normalised
     first (backslashes → '/'). Directories carry no trailing slash except
     a bare "/" root.
   • Windows spellings (drive letter, UNC) compare case-insensitively, as
     that filesystem does; POSIX spellings compare exactly.
   • Link destinations are minimally percent-encoded (CommonMark rejects
     raw spaces and parens); decoding tolerates malformed sequences. */

const DRIVE_RE = /^[a-zA-Z]:(\/|$)/;
const UNC_RE   = /^\/\/[^/]/;
/* A URL scheme has at least two characters: a single letter and a colon
   is a Windows drive, not a scheme. */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

export function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/(.)\/$/, '$1');
}

export function isWindowsPath(p) {
  const n = normalizePath(p);
  return DRIVE_RE.test(n) || UNC_RE.test(n);
}

export function isAbsolutePath(p) {
  const n = normalizePath(p);
  return n.startsWith('/') || DRIVE_RE.test(n);
}

export function hasUrlScheme(s) {
  return SCHEME_RE.test(String(s || ''));
}

/** Parent folder of a path ('' for a bare name, '/' for a root child). */
export function dirOf(p) {
  const n = normalizePath(p);
  const i = n.lastIndexOf('/');
  if (i < 0) return '';
  return i === 0 ? '/' : n.slice(0, i);
}

export function baseNameOf(p) {
  const n = normalizePath(p);
  return n.slice(n.lastIndexOf('/') + 1);
}

function segments(dir) {
  const n = normalizePath(dir);
  return n === '/' ? [''] : n.split('/');
}

function sameSegment(a, b, caseInsensitive) {
  return caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Resolve a link destination against the folder of the document that
    contains it. URLs and absolute destinations come back unchanged
    (normalised); '.' and empty segments are skipped, '..' climbs. */
export function resolvePath(baseDir, rel) {
  const r = normalizePath(rel);
  if (hasUrlScheme(r) || isAbsolutePath(r) || !baseDir) return r;
  const parts = segments(baseDir);
  for (const seg of r.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

/** Relative path from fromDir to toFile (both absolute), climbing with
    '../' where needed. */
export function relativePath(fromDir, toFile) {
  const f = segments(fromDir);
  const t = normalizePath(toFile).split('/');
  const ci = isWindowsPath(fromDir) || isWindowsPath(toFile);
  let common = 0;
  while (common < f.length && common < t.length && sameSegment(f[common], t[common], ci)) common++;
  return '../'.repeat(f.length - common) + t.slice(common).join('/');
}

/** Minimal CommonMark-safe encoding of a link destination (% first!). */
export function encodeLinkDest(p) {
  return String(p)
    .replace(/%/g, '%25')
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

/** Inverse of encodeLinkDest; undecodable sequences stay raw. */
export function decodeLinkDest(s) {
  try { return decodeURIComponent(String(s)); } catch (_) { return String(s); }
}

/** Does absPath lie inside rootPath (or equal it)? Windows spellings
    compare case-insensitively. A root "/" contains every POSIX path. */
export function isInsideRoot(absPath, rootPath) {
  const r = normalizePath(rootPath);
  if (!r) return false;
  const a  = normalizePath(absPath);
  const ci = isWindowsPath(r);
  const A  = ci ? a.toLowerCase() : a;
  const R  = ci ? r.toLowerCase() : r;
  if (A === R) return true;
  return A.startsWith(R === '/' ? '/' : R + '/');
}

/** A file or folder name not yet taken in a folder listing: `stem+suffix`,
    else `stem_2+suffix`, `stem_3+suffix`, … Comparison IGNORES CASE: on
    Windows and macOS "Notes.md" and "notes.md" are one file, so a
    case-sensitive check handed out names that could never be created (the
    new-note flow then failed on every keystroke). On a case-sensitive
    filesystem this only ever picks a more distinct name, never a colliding
    one. `ignoreName` (exact spelling) does not count as taken — the file
    being renamed must not block its own new spelling. `stem` is used
    exactly as given (a trailing "_2024" is part of the name). */
export function uniqueName(existingNames, stem, suffix = '', ignoreName = null) {
  const taken = new Set();
  for (const n of existingNames || []) {
    if (typeof n === 'string' && n !== ignoreName) taken.add(n.toLowerCase());
  }
  let candidate = stem + suffix;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) {
    candidate = `${stem}_${i}${suffix}`;
  }
  return candidate;
}

/** The `![name](relative)` markdown for a media file as seen from baseDir
    (the folder of the note that will contain the link). */
export function mediaLinkMarkdown(mediaPath, baseDir) {
  const name = baseNameOf(mediaPath);
  const rel  = baseDir ? relativePath(baseDir, mediaPath) : name;
  return `![${name}](${encodeLinkDest(rel)})`;
}
