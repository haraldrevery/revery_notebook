/* helpers.js — pure-ish utility functions shared across modules.
   Path spelling (resolve / relative / encode / containment) lives in
   paths.js; this file adds the pieces that need sidebar state or the
   filesystem. */
import { pendingNoteDir } from './state.js';
import { mediaLinkMarkdown, baseNameOf, uniqueName } from './paths.js';
import { SIDEBAR_ITEM_MIME, encodeSidebarPayload } from './drop_transport.js';

  /* File bytes → base64 in 32 KB chunks (fromCharCode arg-count limits).
     Used by the media ingest for DOM File sources. */
  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  /**
   * Strip the most distracting markdown syntax so card previews look
   * like readable prose rather than raw markup.  Light-touch only —
   * no full parser needed here.
   */
  function stripMarkdownForPreview(raw) {
    return raw
      .replace(/^---[\s\S]*?---\n?/m, '')      // strip YAML frontmatter
      .replace(/^#{1,6}\s+/gm, '')             // strip ATX heading markers
      .replace(/!\[.*?\]\(.*?\)/g, '')         // strip images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → link text
      .replace(/`{1,3}[^`]*`{1,3}/g, '')       // inline code
      .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1') // bold/italic
      .replace(/^\s*[-*+]\s+/gm, '')           // list bullets
      .replace(/^\s*\d+\.\s+/gm, '')           // numbered lists
      .replace(/\n{2,}/g, ' ')                 // collapse blank lines
      .replace(/\s+/g, ' ')                    // collapse whitespace
      .trim();
  }

  /* ── File category classification ───────────────────────────────────
     text    → editable in the editor (.md, .txt)
     media   → images; click previews, drop/drag inserts a markdown link
     other   → all remaining types; shown in orange, cannot be opened   */
  const SUPPORTED_TEXT  = new Set(['.md', '.txt']);
  const SUPPORTED_MEDIA = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
    '.bmp', '.ico', '.tiff', '.tif', '.avif',
  ]);

  function getFileCategory(name) {
    const dot = name.lastIndexOf('.');
    if (dot < 0) return 'other';
    const ext = name.substring(dot).toLowerCase();
    if (SUPPORTED_TEXT.has(ext))  return 'text';
    if (SUPPORTED_MEDIA.has(ext)) return 'media';
    return 'other';
  }

  /**
   * Build the `![name](rel)` markdown for a media file.
   * @param {string} mediaPath  - absolute path to the media file
   * @param {string} [fromDir]  - folder of the note that WILL contain the
   *   link. Defaults to pendingNoteDir(): the active note's folder, else
   *   where the next keystroke creates the note — so a link built while no
   *   note is open stays correct once it exists.
   */
  function mediaMarkdown(mediaPath, fromDir) {
    return mediaLinkMarkdown(mediaPath, fromDir || pendingNoteDir());
  }

  /**
   * The payloads of a sidebar drag (tree rows and cards alike), for every
   * dragged item — the whole multi-selection, in tree order:
   *   • SIDEBAR_ITEM_MIME — the dragged files' absolute paths. The editor's
   *     drop handler (media_ingest.js) recognises our own drags by it and
   *     inserts one link per media file itself, relative to the note at
   *     DROP time, so CodeMirror's default text insertion never runs.
   *   • text/plain — the media links, one per line, so dragging into
   *     another application still yields them.
   * effectAllowed: 'copyMove' when media is dragged (moved in the tree OR
   * linked into the editor — without 'copy' the browser cancels that drop),
   * else 'move'.
   * @param {DataTransfer} dataTransfer
   * @param {{path: string, type: string}[]} items
   */
  function setSidebarDragData(dataTransfer, items) {
    const files = items.filter((it) => it.type === 'file').map((it) => it.path);
    const media = files.filter((p) => getFileCategory(baseNameOf(p)) === 'media');
    dataTransfer.effectAllowed = media.length ? 'copyMove' : 'move';
    dataTransfer.setData(SIDEBAR_ITEM_MIME, encodeSidebarPayload(files));
    dataTransfer.setData('text/plain', media.map((p) => mediaMarkdown(p)).join('\n'));
  }

  /**
   * Like uniquePath but works for both files (with ext) and directories.
   * Appends _2, _3, … to the base name until no collision is found.
   */
  async function uniqueDestPath(targetDir, name, type) {
    const sep = (targetDir.endsWith('/') || targetDir.endsWith('\\')) ? '' : '/';
    let existingNames;
    try {
      const entries = await window.NativeAPI.readDirectory(targetDir);
      existingNames = entries.map(e => e.name);
    } catch {
      return `${targetDir}${sep}${name}`;
    }

    const lastDot = name.lastIndexOf('.');
    const hasExt  = (type === 'file') && (lastDot > 0);
    const base    = hasExt ? name.substring(0, lastDot) : name;
    const ext     = hasExt ? name.substring(lastDot)    : '';
    return `${targetDir}${sep}${uniqueName(existingNames, base, ext)}`;
  }

  /**
   * Build an auto-incremented path like "untitled.md", "untitled_2.md", …
   * by peeking at the directory listing (collisions ignore case — see
   * paths.uniqueName). `ignoreName`: the file being renamed, which does not
   * count as taken (so a case-only rename keeps its requested spelling).
   * The requested name is used exactly as given: it used to have a
   * trailing "_<number>" stripped, which renamed a note titled
   * "meeting_2024" to "meeting.md" and imported "notes_2023.md" as
   * "notes.md".
   */
  async function uniquePath(dir, baseName, ext, ignoreName = null) {
    const sep = (dir.endsWith('/') || dir.endsWith('\\')) ? '' : '/';

    let names;
    try {
      const entries = await window.NativeAPI.readDirectory(dir);
      names = entries.map(e => e.name);
    } catch {
      /* Can't list the directory — return plain candidate and let
         createFile surface a useful OS error on collision. */
      return `${dir}${sep}${baseName}.${ext}`;
    }
    return `${dir}${sep}${uniqueName(names, baseName, '.' + ext, ignoreName)}`;
  }



  /* Does `p` exist as a file? Answered from its parent directory listing,
     NOT by reading the file: a read also fails for reasons that say
     nothing about existence (not UTF-8, over the size cap, locked).
     Returns true / false, or null when unknown (the listing failed, e.g.
     the folder is outside the project root) — null must mean "do not act". */
  async function fileExistsViaListing(p) {
    if (typeof p !== 'string') return null;
    const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    if (i <= 0) return null;
    const dir  = p.slice(0, i);
    const name = p.slice(i + 1);
    try {
      const entries = await window.NativeAPI.readDirectory(dir);
      return (entries || []).some((e) => e && e.name === name && e.type === 'file');
    } catch (_) {
      return null;
    }
  }

  async function scanBakOrphansIn(dir) {
    if (!dir) return [];
    try {
      const entries = await window.NativeAPI.readDirectory(dir);
      return entries
        .filter(e => e.type === 'file' && /\.revery_bak$/.test(e.name))
        .map(e => e.path);
    } catch (e) {
      console.warn('[Sidebar] Bak orphan scan failed for', dir, e);
      return [];
    }
  }

  async function reportBakOrphans(rootDir, lastFile) {
    /* Scan the project root and (if different) the directory of the
       last-opened file. Both are non-recursive — a project-wide walk
       at startup would block UI for too long on large folders. */
    const dirs = new Set();
    if (rootDir) dirs.add(rootDir);
    if (lastFile) {
      const lastDir = lastFile.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
      if (lastDir) dirs.add(lastDir);
    }

    const all = [];
    for (const d of dirs) {
      const found = await scanBakOrphansIn(d);
      for (const p of found) if (!all.includes(p)) all.push(p);
    }
    if (all.length === 0) return;

    /* De-duplicate and trim file display to keep the dialog readable. */
    const display = all
      .slice(0, 5)
      .map(p => '• ' + p.replace(/\\/g, '/').split('/').pop())
      .join('\n');
    const overflow = all.length > 5 ? `\n• …and ${all.length - 5} more` : '';

    await window.NativeAPI.showMessageBox({
      type:    'warning',
      title:   window.t('Recovery Backup Files Found'),
      message: window.t('{n} backup file(s) from a previous interrupted save were found.').replace('{n}', all.length),
      detail:
        `These were created during a cross-device save that did not complete. ` +
        `The matching original file may be corrupted.\n\n${display}${overflow}\n\n` +
        `To recover: open the file in Revery and verify it looks correct. ` +
        `If it is corrupted, locate the .revery_bak file in your file manager ` +
        `and rename it to replace the original (drop the ".<timestamp>.revery_bak" suffix).`,
      buttons: [window.t('OK')],
    });
  }

export { stripMarkdownForPreview, getFileCategory, mediaMarkdown, setSidebarDragData, uniqueDestPath,
         uniquePath, scanBakOrphansIn, reportBakOrphans, arrayBufferToBase64,
         fileExistsViaListing };
