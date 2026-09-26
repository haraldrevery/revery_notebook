'use strict';

/* The one rule for names the user types (src/sidebar/paths.js):
   checkEntryName / sanitizeEntryName / renamedFileName, and samePath —
   the path-identity check every file operation uses. The backends carry
   the same name rule (fs_core.checkEntryName, main.rs check_entry_name);
   test/fs_core.entry.test.js pins the Electron copy against this one. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/sidebar/paths.js');

test('ordinary names pass, including dots inside the name', async () => {
  const { checkEntryName } = await load();
  for (const n of ['notes.md', 'Meeting 26.09.2026.md', 'v1.2', 'README', 'a b c', 'Ärende – utkast.md', 'con-notes.md', 'nulla.md']) {
    assert.equal(checkEntryName(n), null, n);
  }
});

test('refused names and their reasons', async () => {
  const { checkEntryName } = await load();
  assert.equal(checkEntryName(''), 'empty');
  assert.equal(checkEntryName('   '), 'empty');
  assert.equal(checkEntryName('.'), 'invalid');
  assert.equal(checkEntryName('..'), 'invalid');
  assert.equal(checkEntryName('a/b'), 'invalid');
  assert.equal(checkEntryName('a\\b'), 'invalid');
  assert.equal(checkEntryName('a\u0000b'), 'invalid');
  assert.equal(checkEntryName('tab\there'), 'invalid');
  assert.equal(checkEntryName('.hidden'), 'hidden');
  assert.equal(checkEntryName('.md'), 'hidden');
  assert.equal(checkEntryName('notes.'), 'edge');
  assert.equal(checkEntryName('notes '), 'edge');
  assert.equal(checkEntryName(' notes'), 'edge');
  assert.equal(checkEntryName('x.revery_tmp'), 'internal');
  assert.equal(checkEntryName('x.md.123.revery_bak'), 'internal');
  assert.equal(checkEntryName('a'.repeat(256)), 'long');
  assert.equal(checkEntryName('å'.repeat(128)), 'long'); // 256 bytes in UTF-8
  assert.equal(checkEntryName('a'.repeat(255)), null);
});

test('Windows device names are refused with or without an extension, any case', async () => {
  const { checkEntryName } = await load();
  for (const n of ['CON', 'con', 'Nul', 'aux.md', 'PRN.txt', 'com1', 'COM9.md', 'lpt3', 'com\u00b9', 'conin$', 'CONOUT$', 'nul.tar.gz']) {
    assert.equal(checkEntryName(n), 'device', n);
  }
});

test('sanitizeEntryName trims and replaces the characters Windows forbids', async () => {
  const { sanitizeEntryName } = await load();
  assert.equal(sanitizeEntryName('  a:b*c?  '), 'a_b_c_');
  assert.equal(sanitizeEntryName('x/y\\z|"<>%'), 'x_y_z_____');
  assert.equal(sanitizeEntryName(null), '');
});

test('renamedFileName keeps the extension unless the same kind was typed', async () => {
  const { renamedFileName } = await load();
  // the reported bug: a dotted date used to replace ".md"
  assert.equal(renamedFileName('note.md', 'Meeting 26.09.2026'), 'Meeting 26.09.2026.md');
  assert.equal(renamedFileName('note.md', 'Meeting'), 'Meeting.md');
  assert.equal(renamedFileName('note.md', 'Meeting.md'), 'Meeting.md');
  assert.equal(renamedFileName('note.md', 'Meeting.MD'), 'Meeting.MD');
  assert.equal(renamedFileName('note.md', 'Meeting.txt'), 'Meeting.txt');   // note ↔ note
  assert.equal(renamedFileName('note.md', 'Meeting.png'), 'Meeting.png.md'); // never note → image
  assert.equal(renamedFileName('pic.png', 'photo.jpg'), 'photo.jpg');        // image ↔ image
  assert.equal(renamedFileName('pic.png', 'photo.md'), 'photo.md.png');      // never image → note
  assert.equal(renamedFileName('report.pdf', 'report.docx'), 'report.docx.pdf');
  assert.equal(renamedFileName('report.pdf', 'final'), 'final.pdf');
  // no extension: exactly what was typed (was "INFOREADME")
  assert.equal(renamedFileName('README', 'INFO'), 'INFO');
  assert.equal(renamedFileName('Makefile', 'Makefile.old'), 'Makefile.old');
});

test('samePath: separators, trailing slash, windows case-insensitive, posix exact', async () => {
  const { samePath } = await load();
  assert.equal(samePath('/p/a', '/p/a/'), true);
  assert.equal(samePath('C:\\Notes\\A', 'c:/notes/a'), true);
  assert.equal(samePath('/p/A', '/p/a'), false);
  assert.equal(samePath('/p/a', '/p/ab'), false);
  assert.equal(samePath('', ''), false);
  assert.equal(samePath(null, '/p'), false);
});

test('joinPath / parentPathOf keep the spelling a folder listing uses', async () => {
  const { joinPath, parentPathOf } = await load();
  assert.equal(joinPath('C:\\p\\sub', 'x.md'), 'C:\\p\\sub\\x.md');
  assert.equal(joinPath('/p/sub', 'x.md'), '/p/sub/x.md');
  assert.equal(joinPath('/p/sub/', 'x.md'), '/p/sub/x.md');
  assert.equal(joinPath('C:\\', 'x.md'), 'C:\\x.md');
  assert.equal(parentPathOf('C:\\p\\sub\\x.md'), 'C:\\p\\sub');
  assert.equal(parentPathOf('/p/sub/x.md'), '/p/sub');
  assert.equal(parentPathOf('C:\\x.md'), 'C:\\');
  assert.equal(parentPathOf('/x.md'), '/');
  assert.equal(parentPathOf('x.md'), '');
});

test('remapUnder follows a rename/move into descendants, in the new spelling', async () => {
  const { remapUnder } = await load();
  assert.equal(remapUnder('/p/a', '/p/a', '/p/b/a'), '/p/b/a');
  assert.equal(remapUnder('/p/a/deep/x.md', '/p/a', '/p/b/a'), '/p/b/a/deep/x.md');
  assert.equal(remapUnder('/p/ab/x.md', '/p/a', '/p/b/a'), null); // sibling prefix, not inside
  assert.equal(remapUnder('/p/other', '/p/a', '/p/b'), null);
  assert.equal(remapUnder('C:\\p\\A\\x.md', 'c:/p/a', 'C:\\p\\sub\\A'), 'C:\\p\\sub\\A\\x.md');
  assert.equal(remapUnder(null, '/p/a', '/p/b'), null);
});

test('pathKey: equal keys iff same location', async () => {
  const { pathKey } = await load();
  assert.equal(pathKey('C:\\Notes\\A\\'), pathKey('c:/notes/a'));
  assert.notEqual(pathKey('/n/A'), pathKey('/n/a'));
});
