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

/** Do two paths name the same location? Windows spellings compare
    case-insensitively (as that filesystem does), POSIX ones exactly.
    Every "is this the same file/folder?" question in the file operations
    goes through here or isInsideRoot — never through a raw `===`. */
export function samePath(a, b) {
  const x = pathKey(a);
  return !!x && x === pathKey(b);
}

/** A comparison key for a path: normalised, lower-cased for Windows
    spellings. Two paths are the same location iff their keys are equal. */
export function pathKey(p) {
  const n = normalizePath(p);
  return isWindowsPath(n) ? n.toLowerCase() : n;
}

/* ── Building paths in the listing's own spelling ─────────────────────
   Folder listings hand out native spellings (backslashes on Windows).
   A child path built with '/' ("C:\p\sub/x.md") names the same file but
   no longer equals the listing's string, and state compared with the
   tree by plain equality drifted apart. These keep the separator style
   of the path they start from. */
function sepOf(p) {
  const s = String(p);
  return (s.includes('\\') && !s.includes('/')) ? '\\' : '/';
}

/** `dir` + `name`, joined with dir's own separator (never doubled). */
export function joinPath(dir, name) {
  const d = String(dir);
  if (d.endsWith('/') || d.endsWith('\\')) return d + name;
  return d + sepOf(d) + name;
}

/** The parent folder of `p`, sliced from p's own spelling ('/' for a
    POSIX root child, "C:\" for a drive-root child). */
export function parentPathOf(p) {
  const s = String(p || '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  if (i < 0) return '';
  if (i === 0) return s[0];
  const head = s.slice(0, i);
  return /^[A-Za-z]:$/.test(head) ? head + s[i] : head;
}

/** Map `p` through a rename/move of `from` → `to`: `to` when p IS from,
    `to` + the rest when p lies inside `from`, otherwise null. The rest is
    re-spelled with to's separator. */
export function remapUnder(p, from, to) {
  if (!p || !from || !to) return null;
  if (samePath(p, from)) return to;
  if (!isInsideRoot(p, from)) return null;
  const rest = normalizePath(p).slice(normalizePath(from).length); // starts with '/'
  const sep = sepOf(to);
  return String(to).replace(/[/\\]$/, '') + (sep === '/' ? rest : rest.replace(/\//g, sep));
}

/* ── File kinds by extension ──────────────────────────────────────────
   text  → opens in the editor; media → images (preview, link insertion).
   Shared by helpers.getFileCategory and the rename rule below. */
export const TEXT_EXTS  = new Set(['.md', '.txt']);
export const MEDIA_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.bmp', '.ico', '.tiff', '.tif', '.avif',
]);

/** '.md' for "a.md", '' for "README" and for dot-names like ".md". */
export function extOf(name) {
  const n = String(name || '');
  const i = n.lastIndexOf('.');
  return i > 0 ? n.slice(i) : '';
}

function extGroup(ext) {
  const e = String(ext).toLowerCase();
  if (TEXT_EXTS.has(e))  return 'text';
  if (MEDIA_EXTS.has(e)) return 'media';
  return null;
}

/* ── Names the app will give a file or folder ─────────────────────────
   ONE rule for every name the user types (sidebar rename, multi-rename,
   title-bar rename, new folder, import). The backends enforce the same
   rule (fs_core.checkEntryName / main.rs check_entry_name), so a name the
   renderer lets through by mistake is still refused on disk.
   Refused, with the reason key returned:
     empty    — nothing left after trimming
     invalid  — '.', '..', path separators, control characters
     hidden   — a leading dot hides the item from the sidebar
     edge     — a trailing dot or space (Windows silently drops them, so
                the file on disk would not have the name we asked for)
     device   — a Windows device name (CON, NUL, COM1, …), with or
                without an extension: such a file cannot be opened or
                synced on Windows
     internal — the endings of Revery's own safety files (.revery_tmp,
                .revery_bak): the app would report them as leftovers
     long     — over 255 bytes, the common filesystem limit
   Characters Windows forbids (\ / ? % * : | " < >) are replaced with '_'
   by sanitizeEntryName before the check, as before. */
const NAME_FORBIDDEN_RE = /[/\\?%*:|"<>]/g;
const WIN_DEVICE_RE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;

export function sanitizeEntryName(raw) {
  return String(raw == null ? '' : raw).trim().replace(NAME_FORBIDDEN_RE, '_');
}

export function checkEntryName(name) {
  const n = String(name == null ? '' : name);
  if (!n.trim()) return 'empty';
  if (n === '.' || n === '..') return 'invalid';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f/\\]/.test(n)) return 'invalid';
  if (n.startsWith('.')) return 'hidden';
  if (/[. ]$/.test(n) || n.startsWith(' ')) return 'edge';
  if (WIN_DEVICE_RE.test(n)) return 'device';
  if (/\.revery_(tmp|bak)$/i.test(n)) return 'internal';
  if (new TextEncoder().encode(n).length > 255) return 'long';
  return null;
}

/** The name a FILE ends up with when the user types `typed` to rename
    `oldName`. The extension decides whether the app can open the file, so
    it is kept unless the user typed that same extension, or another one
    of the same kind (a note stays a note: .md ↔ .txt; an image stays an
    image). Everything else gets the old extension appended:
    "Meeting 26.09.2026" → "Meeting 26.09.2026.md". A file without an
    extension keeps exactly what was typed. */
export function renamedFileName(oldName, typed) {
  const oldExt = extOf(oldName);
  if (!oldExt) return typed;
  const newExt = extOf(typed);
  if (newExt) {
    if (newExt.toLowerCase() === oldExt.toLowerCase()) return typed;
    const g = extGroup(newExt);
    if (g && g === extGroup(oldExt)) return typed;
  }
  return typed + oldExt;
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
