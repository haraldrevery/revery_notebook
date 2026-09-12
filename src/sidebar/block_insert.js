/* block_insert.js — pure: the text that places a block of markdown (e.g.
   one or more media link lines) on its OWN paragraph at an insertion
   point, adding only the blank lines that are missing on either side.
   No DOM, no editor — unit-tested in test/block_insert.test.js.

   Used by live-preview drops (media_ingest.js): the point is a line end
   chosen by markdown_editor_livepreview.js, and the block must neither
   glue onto the text before it nor swallow the text after it. */

/**
 * @param {string} before  document text before the point (only its last two characters matter)
 * @param {string} after   document text from the point on (only its first two characters matter)
 * @param {string} block   the markdown to insert, without surrounding newlines
 * @returns {{ insert: string, cursor: number }} the text to insert at the point, and the
 *   cursor offset (relative to the point) at the start of the line after the block —
 *   a blank line by construction, so a live-preview cursor there reveals nothing.
 */
export function paragraphInsertion(before, after, block) {
  const lead = (before === '' || before.endsWith('\n\n')) ? ''
    : before.endsWith('\n') ? '\n'
    : '\n\n';
  const trail = after.startsWith('\n\n') ? ''
    : (after === '' || after.startsWith('\n')) ? '\n'
    : '\n\n';
  return { insert: lead + block + trail, cursor: lead.length + block.length + 1 };
}
