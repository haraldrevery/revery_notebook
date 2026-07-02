/* helpers.js — pure-ish utility functions shared across modules. */
import { S } from './state.js';

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
     media   → images/video; click inserts markdown reference
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

  /* ── Relative-path helper ────────────────────────────────────────────
     Returns the POSIX-style relative path from fromDir to toFile.
     Used when inserting image markdown so paths stay portable.          */
  function makeRelativePath(fromDir, toFile) {
    fromDir = fromDir.replace(/\\/g, '/').replace(/\/$/, '');
    toFile  = toFile.replace(/\\/g, '/');
    const fParts = fromDir.split('/');
    const tParts = toFile.split('/');
    let common = 0;
    while (common < fParts.length && common < tParts.length
           && fParts[common] === tParts[common]) common++;
    const up   = fParts.length - common;
    const down = tParts.slice(common);
    return '../'.repeat(up) + down.join('/');
  }

  /**
   * Build the `![name](rel)` markdown for a media file.
   * @param {string} mediaPath  - absolute path to the media file
   * @param {string} [fromDir] - directory to resolve relative path from.
   *   Defaults to S.activeFilePath's directory, then S.rootPath.
   *   Pass the directory of the file that WILL contain this reference.
   */
  function mediaMarkdown(mediaPath, fromDir) {
    const name = mediaPath.replace(/\\/g, '/').split('/').pop();
    const baseDir = (fromDir || (
      S.activeFilePath
        ? S.activeFilePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
        : (S.rootPath || '').replace(/\\/g, '/')
    )).replace(/\\/g, '/');
    const rel = baseDir
      ? makeRelativePath(baseDir, mediaPath.replace(/\\/g, '/'))
      : name;
    return `![${name}](${rel})`;
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
      existingNames = new Set(entries.map(e => e.name));
    } catch {
      return `${targetDir}${sep}${name}`;
    }
    if (!existingNames.has(name)) return `${targetDir}${sep}${name}`;

    const lastDot = name.lastIndexOf('.');
    const hasExt  = (type === 'file') && (lastDot > 0);
    const base    = hasExt ? name.substring(0, lastDot) : name;
    const ext     = hasExt ? name.substring(lastDot)    : '';
    let counter   = 2;
    while (existingNames.has(`${base}_${counter}${ext}`)) counter++;
    return `${targetDir}${sep}${base}_${counter}${ext}`;
  }

  /**
   * Build an auto-incremented path like "untitled.md", "untitled_2.md", …
   * by peeking at the directory listing. Avoids overwriting existing files
   * without asking.
   */
  async function uniquePath(dir, baseName, ext) {
    const sep  = (dir.endsWith('/') || dir.endsWith('\\')) ? '' : '/';
    const base = baseName.replace(/_\d+$/, ''); // strip trailing _N before we start

    let names;
    try {
      const entries = await window.NativeAPI.readDirectory(dir);
      names = new Set(entries.map(e => e.name));
    } catch {
      /* Can't list the directory — return plain candidate and let
         createFile surface a useful OS error on collision. */
      return `${dir}${sep}${base}.${ext}`;
    }

    /* Try plain name first, then base_2, base_3, … */
    if (!names.has(`${base}.${ext}`)) return `${dir}${sep}${base}.${ext}`;
    let counter = 2;
    while (names.has(`${base}_${counter}.${ext}`)) counter++;
    return `${dir}${sep}${base}_${counter}.${ext}`;
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
      title:   'Recovery Backup Files Found',
      message: `${all.length} backup file(s) from a previous interrupted save were found.`,
      detail:
        `These were created during a cross-device save that did not complete. ` +
        `The matching original file may be corrupted.\n\n${display}${overflow}\n\n` +
        `To recover: open the file in Revery and verify it looks correct. ` +
        `If it is corrupted, locate the .revery_bak file in your file manager ` +
        `and rename it to replace the original (drop the ".<timestamp>.revery_bak" suffix).`,
      buttons: ['OK'],
    });
  }

export { stripMarkdownForPreview, getFileCategory, makeRelativePath,
         mediaMarkdown, uniqueDestPath, uniquePath, scanBakOrphansIn,
         reportBakOrphans };
