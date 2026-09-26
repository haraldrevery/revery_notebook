'use strict';

/* File operations end-to-end: boots the REAL Electron app (main.js,
   preload, IPC, entry validation, rename/trash handlers, sidebar) on a
   temporary project — helpers/file_ops_e2e_main.js — and drives it through
   helpers/file_ops_e2e_driver.js with real DragEvents, context menus,
   dialogs and key presses. The system trash is never used (a recorder
   stands in for shell.trashItem) and the user's data is never touched.

   Plain mode (project opened by its real path):
     1. card view: a path bar; dropping a card on the root segment moves
        it up;
     2. in a narrow panel the bar falls back to "← Back", which is a drop
        target for the parent folder; no Back and no segment at the root;
     3. "Move to…" picker: never the moved folder or below it, the current
        folder marked; the link update still runs;
     4. Ctrl+Z typed in the title does NOT undo a file move; after working
        in the file panel it does, with a status message;
     5. "Move up one level" (offered only below the root);
     6. links: an absolute link moves as a link (target untouched); a
        relative link is not moved to another folder; deleting a link
        trashes the link, never its target;
     7. rename rules: "Meeting 26.09.2026" keeps ".md", "README" → "INFO"
        stays extensionless, a leading dot and Windows device names are
        refused; an existing folder name is reported;
     8. the open note's folder moves while a save is queued: the save lands
        first, later typing is saved at the new place, the old folder is
        never recreated;
     9. the open note is deleted while a save is in flight: the save lands
        first (the trashed copy has it) and the note is never resurrected;
    10. multi-delete says "Move … to Trash" (it used to say "Permanently").
   Symlink mode (project opened through a symlink):
     the renderer adopts the canonical root and note spelling; a file
     dropped on its own folder is not renamed to name_2; the card view
     never offers a way above the root. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');
const canSymlink = process.platform !== 'win32';

function runApp(mode) {
  const electronBin = require('electron');
  const mainScript  = path.join(__dirname, 'helpers', 'file_ops_e2e_main.js');
  const env = { ...process.env, REVERY_E2E_MODE: mode };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(electronBin, [mainScript], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`electron exited ${code}\n${out}`));
      const line = out.split('\n').find((l) => l.startsWith('E2E-RESULT: '));
      if (!line) return reject(new Error(`no E2E-RESULT in output:\n${out}`));
      resolve(JSON.parse(line.slice('E2E-RESULT: '.length)));
    });
  });
}

test('file operations end-to-end (plain project)', { skip: !hasDisplay || !canSymlink, timeout: 150000 }, async () => {
  const r = await runApp('plain');
  const why = JSON.stringify(r, null, 2);
  assert.equal(r.booted, true, 'boot must open the seeded temp project\n' + why);
  assert.equal(r.error || null, null, 'driver error\n' + why);
  assert.deepEqual(r.pageErrors, [], 'no page errors\n' + why);
  assert.equal(r.rootIsCanonical, true, why);
  assert.equal(r.activeIsCanonical, true, why);

  // 1. path bar + drop on the root segment
  assert.deepEqual(r.pathBarSegs, ['Notes'], why);
  assert.equal(r.pathBarCrumb, 'sub', why);
  assert.equal(r.rootSegLit, true, 'the root segment lights up as a drop target\n' + why);
  assert.ok(r.afterSegDrop_root.includes('inner.md') && !r.afterSegDrop_sub.includes('inner.md'), why);
  assert.equal(r.cardViewStillSub, true, why);

  // 2. compact bar: Back is a drop target for the parent; nothing above the root
  assert.equal(r.compactBack, true, why);
  assert.equal(r.compactNoPathBar, true, why);
  assert.ok(r.compactBackTarget.endsWith('/Notes/sub'), why);
  assert.equal(r.backLit, true, why);
  assert.ok(r.afterBackDrop_sub.includes('x.md') && !r.afterBackDrop_deep.includes('x.md'), why);
  assert.equal(r.atRootBack, false, why);
  assert.equal(r.atRootSegs, 0, why);

  // 3. Move to…
  assert.ok(r.fileMenuLabels.includes('Move to…'), why);
  assert.ok(!r.fileMenuLabels.includes('Move up one level'), 'nothing above the root\n' + why);
  assert.deepEqual(r.pickerRowsForFile[0], { text: 'Notes (current folder)', disabled: true }, why);
  assert.ok(r.pickerRowsForFile.some((x) => x.text === 'deep' && !x.disabled), why);
  assert.ok(!r.pickerRowsForFile.some((x) => /link/.test(x.text)), 'links are never offered as folders\n' + why);
  assert.ok(r.afterMoveTo_sub.includes('mv.md'), why);
  assert.equal(r.linksAfterMoveTo, 'See [mv](sub/mv.md).\n', 'the link update still runs\n' + why);
  assert.ok(!r.pickerRowsForFolder.some((x) => x.text === 'sub' || x.text === 'deep'),
    'a folder is never offered itself or below it\n' + why);

  // 4. Ctrl+Z scope
  assert.ok(r.afterCtrlZInTitle_sub.includes('mv.md'), 'Ctrl+Z in the title must not move files\n' + why);
  assert.ok(r.afterPanelCtrlZ_root.includes('mv.md'), 'Ctrl+Z after working in the panel undoes the move\n' + why);
  assert.match(r.undoStatus, /Undone: move of 1 item/, why);
  assert.equal(r.disk['links.md'], 'See [mv](mv.md).\n', 'undo restores the link\n' + why);

  // 5. Move up one level
  assert.equal(r.moveUpOffered, true, why);
  assert.ok(r.afterMoveUp_sub.includes('y.md'), why);
  assert.ok(!r.rootItemMenuLabels.includes('Move up one level'), why);

  // 6. links
  assert.ok(r.afterAbsLinkMove_box.includes('abslink'), why);
  assert.equal(r.disk['realfolder/inside.md'], 'inside\n', 'a link target is never moved or trashed\n' + why);
  assert.equal(r.relLinkDialogs.length, 1, why);
  assert.match(r.relLinkDialogs[0].detail, /relative link/, why);
  assert.ok(r.afterRelLinkMove_root.includes('rellink'), why);
  assert.equal(r.linkRowMarked, true, why);
  assert.ok(!r.linkMenuLabels.includes('Open'), why);
  assert.equal(r.linkDeleteDialogs[0].title, 'Delete Link', why);
  assert.deepEqual(r.trashCalls[0], 'Notes/rellink', 'the trash receives the link itself\n' + why);
  assert.equal(r.trash['1-rellink'], '-> realfolder', why);

  // 7. names
  assert.ok(r.afterDottedRename.includes('Meeting 26.09.2026.md'), why);
  assert.equal(r.activeAfterDottedRename, 'Meeting 26.09.2026.md', why);
  assert.ok(r.afterExtensionlessRename.includes('INFO'), why);
  assert.equal(r.hiddenRenameDialogs[0].title, 'Invalid Name', why);
  assert.equal(r.deviceRenameDialogs[0].title, 'Invalid Name', why);
  assert.ok(r.afterRefusedRenames.includes('a.md'), why);
  assert.ok(!r.afterRefusedRenames.some((n) => n.startsWith('.') || /^con/i.test(n)), why);
  assert.equal(r.existingFolderDialogs[0].title, 'Name Already Used', why);

  // 8. folder of the open note moved while a save was queued
  assert.equal(r.activeAfterFolderMove, '/sub/box/active.md', why);
  assert.equal(r.movedNote, 'SECOND FIRST active\n', why);
  assert.equal(r.oldBoxRecreated, false, 'the old folder must never be recreated\n' + why);

  // 9. open note deleted with a save in flight
  assert.equal(r.deletedNoteResurrected, false, why);
  assert.equal(r.activeAfterDelete, null, why);
  assert.equal(r.trash['2-del.md'], 'EDIT delete me\n', 'the in-flight save lands before the delete\n' + why);

  // 10. multi-delete wording
  assert.equal(r.multiDeleteDialogs[0].message, 'Move 2 item(s) to Trash?', why);
  assert.ok(r.trashCalls.includes('Notes/one.md') && r.trashCalls.includes('Notes/two.md'), why);
});

test('file operations end-to-end (project opened through a symlink)', { skip: !hasDisplay || !canSymlink, timeout: 150000 }, async () => {
  const r = await runApp('symlink');
  const why = JSON.stringify(r, null, 2);
  assert.equal(r.booted, true, why);
  assert.equal(r.error || null, null, why);
  assert.deepEqual(r.pageErrors, [], why);
  assert.equal(r.rootIsCanonical, true, 'the renderer adopts the canonical root\n' + why);
  assert.equal(r.activeIsCanonical, true, 'the restored note takes the canonical spelling\n' + why);
  assert.ok(r.symRootAfterOwnFolderDrop.includes('a.md') && !r.symRootAfterOwnFolderDrop.includes('a_2.md'),
    'a file dropped on its own folder must not be renamed\n' + why);
  assert.equal(r.symBackAtRoot, false, why);
  assert.equal(r.symSegAtRoot, 0, why);
  assert.equal(r.symRootSegPath, r.root, why);
  assert.deepEqual(r.dialogs, [], why);
});
