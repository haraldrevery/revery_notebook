'use strict';

/* Unit tests for the pure link rewriter (src/sidebar/link_rewrite.js) that
   keeps markdown links valid across rename/move operations. Pure string
   in/out — no filesystem, no DOM — so every nasty case is pinned here:
   encoding round-trips, unicode, folder prefixes, self-moves, code blocks.
   The integration (fileops.js) only orchestrates: scan → rewrite → confirm
   → write; correctness lives in this module. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const MOD_URL = pathToFileURL(path.join(__dirname, '..', 'src', 'sidebar', 'link_rewrite.js')).href;

async function mod() { return import(MOD_URL); }

/* Convenience: rewrite with a single-record mapping, file not moved. */
async function rw(text, oldPath, newPath, fileDir = '/p') {
  const { rewriteLinksInText, buildAbsMapper } = await mod();
  return rewriteLinksInText(text, {
    fileDirBefore: fileDir,
    fileDirAfter: fileDir,
    mapAbs: buildAbsMapper([{ oldPath, newPath }]),
  });
}

test('rename in same dir rewrites image and plain links', async () => {
  const r = await rw('![a](img.png) and [doc](img.png)', '/p/img.png', '/p/photo.png');
  assert.equal(r.text, '![a](photo.png) and [doc](photo.png)');
  assert.equal(r.changes, 2);
});

test('percent-encoded spaces round-trip; parens re-encoded', async () => {
  const r = await rw('![a](my%20pic.png)', '/p/my pic.png', '/p/img (2).png');
  assert.equal(r.text, '![a](img%20%282%29.png)');
  assert.equal(r.changes, 1);
});

test('literal % in filename survives the round-trip', async () => {
  const r = await rw('![a](50%25.png)', '/p/50%.png', '/p/half.png');
  assert.equal(r.text, '![a](half.png)');
});

test('unicode names (å→ö) kept raw, resolved correctly', async () => {
  const r = await rw('![å](bild-å.png)', '/p/bild-å.png', '/p/bild-ö.png');
  assert.equal(r.text, '![å](bild-ö.png)');
});

test('../ traversal from a subfolder resolves and rewrites', async () => {
  const r = await rw('![x](../img/x.png)', '/p/img/x.png', '/p/img/y.png', '/p/notes');
  assert.equal(r.text, '![x](../img/y.png)');
});

test('folder rename remaps every descendant (prefix mapping)', async () => {
  const r = await rw('![a](img/x.png) ![b](img/sub/y.png)', '/p/img', '/p/assets');
  assert.equal(r.text, '![a](assets/x.png) ![b](assets/sub/y.png)');
  assert.equal(r.changes, 2);
});

test('file moved to a subfolder re-bases its own relative links', async () => {
  const { rewriteLinksInText } = await mod();
  const r = rewriteLinksInText('![x](img.png) [w](https://x.se/a.png) ![abs](/p/abs.png)', {
    fileDirBefore: '/p',
    fileDirAfter: '/p/notes',
    mapAbs: () => null,
  });
  assert.equal(r.text, '![x](../img.png) [w](https://x.se/a.png) ![abs](/p/abs.png)');
  assert.equal(r.changes, 1); // URL and absolute path untouched
});

test('file and target moved together (folder move) → no byte changes', async () => {
  const { rewriteLinksInText, buildAbsMapper } = await mod();
  const src = '![i](i.png) ![s](sub/j.png)';
  const r = rewriteLinksInText(src, {
    fileDirBefore: '/p/A',
    fileDirAfter: '/p/B',
    mapAbs: buildAbsMapper([{ oldPath: '/p/A', newPath: '/p/B' }]),
  });
  assert.equal(r.text, src);
  assert.equal(r.changes, 0);
});

test('fenced code blocks are opaque', async () => {
  const src = 'before\n```\n![a](img.png)\n```\nafter ![a](img.png)';
  const r = await rw(src, '/p/img.png', '/p/new.png');
  assert.equal(r.text, 'before\n```\n![a](img.png)\n```\nafter ![a](new.png)');
  assert.equal(r.changes, 1);
});

test('inline code spans are opaque; digits outside links survive', async () => {
  const src = 'use `![a](img.png)` page 5 of 9 ![a](img.png)';
  const r = await rw(src, '/p/img.png', '/p/new.png');
  assert.equal(r.text, 'use `![a](img.png)` page 5 of 9 ![a](new.png)');
});

test('titles are preserved verbatim', async () => {
  const r = await rw('![a](img.png "The Caption") [b](img.png \'x\')', '/p/img.png', '/p/n.png');
  assert.equal(r.text, '![a](n.png "The Caption") [b](n.png \'x\')');
});

test('schemes, anchors and data URIs are never touched', async () => {
  const src = '![a](https://x/img.png) [b](#sec) [c](mailto:x@y.se) ![d](data:image/png;base64,AA==)';
  const r = await rw(src, '/p/img.png', '/p/new.png');
  assert.equal(r.text, src);
  assert.equal(r.changes, 0);
});

test('no match → byte-identical output', async () => {
  const src = '# T\n\n![a](other.png)\ntext';
  const r = await rw(src, '/p/img.png', '/p/new.png');
  assert.equal(r.text, src);
  assert.equal(r.changes, 0);
});

test('absolute destinations stay absolute when their target moves', async () => {
  const r = await rw('![a](/p/img.png)', '/p/img.png', '/p/new.png');
  assert.equal(r.text, '![a](/p/new.png)');
});

test('windows-style separators in dirs are normalized', async () => {
  const { rewriteLinksInText, buildAbsMapper } = await mod();
  const r = rewriteLinksInText('![a](img.png)', {
    fileDirBefore: 'C:\\p\\notes',
    fileDirAfter: 'C:\\p\\notes',
    mapAbs: buildAbsMapper([{ oldPath: 'C:\\p\\notes\\img.png', newPath: 'C:\\p\\notes\\new.png' }]),
  });
  assert.equal(r.text, '![a](new.png)');
});

test('buildAbsMapper: exact, prefix, and miss; invertRecords swaps', async () => {
  const { buildAbsMapper, invertRecords } = await mod();
  const map = buildAbsMapper([{ oldPath: '/p/a', newPath: '/p/b' }]);
  assert.equal(map('/p/a'), '/p/b');
  assert.equal(map('/p/a/x/y.png'), '/p/b/x/y.png');
  assert.equal(map('/p/ax'), null);
  const inv = invertRecords([{ oldPath: '/p/a', newPath: '/p/b' }]);
  assert.deepEqual(inv, [{ oldPath: '/p/b', newPath: '/p/a' }]);
});

test('reverse mapping restores the original links (undo path)', async () => {
  const { rewriteLinksInText, buildAbsMapper, invertRecords } = await mod();
  const records = [{ oldPath: '/p/img.png', newPath: '/p/moved/img.png' }];
  const src = '![a](img.png "t") mid ![b](../q/img2.png)';
  const fwd = rewriteLinksInText(src, {
    fileDirBefore: '/p', fileDirAfter: '/p', mapAbs: buildAbsMapper(records),
  });
  assert.equal(fwd.text, '![a](moved/img.png "t") mid ![b](../q/img2.png)');
  const back = rewriteLinksInText(fwd.text, {
    fileDirBefore: '/p', fileDirAfter: '/p', mapAbs: buildAbsMapper(invertRecords(records)),
  });
  assert.equal(back.text, src);
});
