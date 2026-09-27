'use strict';

/* File history (undo/redo) and start-without-project, end-to-end: boots the
   REAL Electron app on a temporary project — helpers/file_history_e2e_main.js
   — and drives it through helpers/file_history_e2e_driver.js with real
   context menus, drags, dialogs and key presses. The system trash is never
   used and the user's data is never touched.

   history mode:
     A. the user DECLINED the link update of a move: Ctrl+Z and Ctrl+Y move
        the note without touching its links (undo used to rewrite its
        correct relative links into broken ones, silently);
     B. the user ACCEPTED it: undo restores the links and Ctrl+Y re-applies
        them, without asking again;
     C. Ctrl+Y / Ctrl+Shift+Z in the title or the editor never redo a file
        move; in the file panel they do;
     D. a new operation ends the redo chain;
     E. a delete ends the file history;
     F. autosave never renames the note to a title still being typed (it
        renamed to the half-typed name); leaving the field does;
     G. "File Changed Externally" with unsaved edits defaults to "Save my
        version & reload" (it defaulted to "Reload from disk", which
        discards them); without unsaved edits a reload loses nothing.
   noproject mode (the last project folder is missing at start):
     the user is told; typed text gets a crash backup (it had none); New
     File and Import leave it alone (Import replaced it); Open Folder keeps
     it and gives it a note in that folder (it emptied the editor). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');

function runApp(mode) {
  const electronBin = require('electron');
  const mainScript  = path.join(__dirname, 'helpers', 'file_history_e2e_main.js');
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

const N_TEXT = 'See [other](../other.md) and ![img](../img.png)\n';

test('file history: undo/redo, links, title autosave, external-change default', { skip: !hasDisplay, timeout: 150000 }, async () => {
  const r = await runApp('history');
  const why = JSON.stringify(r, null, 2);
  assert.equal(r.booted, true, 'boot must open the seeded temp project\n' + why);
  assert.equal(r.error || null, null, 'driver error\n' + why);
  assert.deepEqual(r.pageErrors, [], 'no page errors\n' + why);

  // A. declined links are never touched by undo/redo
  assert.equal(r.A_moveUpOffered, true, why);
  assert.equal(r.A_prompted, true, 'the move asks about links\n' + why);
  assert.equal(r.A_afterMove, N_TEXT, why);
  assert.equal(r.A_afterUndo, N_TEXT, 'undo must not rewrite links the user kept\n' + why);
  assert.equal(r.A_promptOnUndo, false, why);
  assert.match(r.A_undoStatus, /Undone: move of 1 item/, why);
  assert.equal(r.A_afterRedo, N_TEXT, 'redo must not rewrite links the user kept\n' + why);
  assert.equal(r.A_promptOnRedo, false, why);
  assert.match(r.A_redoStatus, /Redone: move of 1 item/, why);

  // B. accepted links follow undo and redo, unasked
  assert.equal(r.B_prompted, true, why);
  assert.equal(r.B_linksAfterMove, 'See [mv](sub/mv.md).\n', why);
  assert.equal(r.B_linksAfterUndo, 'See [mv](mv.md).\n', why);
  assert.equal(r.B_promptOnUndo, false, why);
  assert.match(r.B_undoStatus, /Undone: move of 1 item/, why);
  assert.equal(r.B_linksAfterRedo, 'See [mv](sub/mv.md).\n', why);
  assert.equal(r.B_promptOnRedo, false, why);
  assert.match(r.B_redoStatus, /Redone: move of 1 item/, why);

  // C. redo keys only from the file panel
  assert.ok(r.C_afterKeysInTitle_root.includes('mv.md'), 'Ctrl+Y / Ctrl+Shift+Z in the title must not move files\n' + why);
  assert.ok(r.C_afterCtrlYInEditor_root.includes('mv.md'), 'Ctrl+Y in the editor must not move files\n' + why);
  assert.ok(r.C_afterPanelCtrlShiftZ_sub.includes('mv.md'), 'Ctrl+Shift+Z in the panel redoes\n' + why);

  // D. a new operation ends the redo chain
  assert.ok(r.D_afterCtrlY_root.includes('mv.md') && r.D_afterCtrlY_root.includes('b.md'), why);
  assert.ok(!r.D_afterCtrlY_sub.includes('mv.md'), 'no redo after a new operation\n' + why);

  // E. a delete ends the file history
  assert.ok(r.E_afterCtrlZ_root.includes('b.md') && !r.E_afterCtrlZ_root.includes('a.md'),
    'no undo across a delete\n' + why);
  assert.equal(r.disk['b.md'], 'a\n', why);

  // F. title autosave
  assert.equal(r.F_active, 'note.md', why);
  assert.ok(r.F_whileTyping_root.includes('note.md') && !r.F_whileTyping_root.includes('note-final.md'),
    'autosave must not rename while the title is being typed\n' + why);
  assert.equal(r.F_contentSavedWhileTyping, 'note\ntyped ', 'the text itself is still autosaved\n' + why);
  assert.equal(r.F_titleWhileTyping, 'note-final', 'the field is left as typed\n' + why);
  assert.ok(r.F_afterCommit_root.includes('note-final.md') && !r.F_afterCommit_root.includes('note.md'), why);

  // G. external-change default
  assert.ok(r.G_dirtyBox, why);
  assert.equal(r.G_dirtyBox.buttons[r.G_dirtyBox.defaultId], 'Save my version & reload',
    'with unsaved edits the default keeps both versions\n' + why);
  assert.equal(r.G_dirtyBox.buttons[r.G_dirtyBox.cancelId], 'Keep my version', why);
  assert.ok(r.G_cleanBox, why);
  assert.equal(r.G_cleanBox.buttons[r.G_cleanBox.defaultId], 'Reload from disk',
    'without unsaved edits a reload loses nothing\n' + why);
  const nativeTitles = r.dialogs.map((d) => d.title);
  assert.equal(nativeTitles.filter((t) => t === 'File Changed Externally').length, 2, why);
});

test('no project at start: told, typed text backed up and kept', { skip: !hasDisplay, timeout: 150000 }, async () => {
  const r = await runApp('noproject');
  const why = JSON.stringify(r, null, 2);
  assert.equal(r.booted, true, 'boot must end with no project open\n' + why);
  assert.equal(r.error || null, null, 'driver error\n' + why);
  assert.deepEqual(r.pageErrors, [], 'no page errors\n' + why);

  const titles = r.dialogs.map((d) => d.title);
  assert.equal(titles[0], 'Could Not Open Project', 'the missing folder is reported at start\n' + why);
  assert.match(r.dialogs[0].message, /"Stick" could not be opened/, why);

  assert.ok(r.backupCount >= 1 && r.backupHasText, 'text typed with no project has a crash backup\n' + why);
  assert.equal(r.importKeptText, true, 'Import must not replace the text\n' + why);
  assert.equal(r.newFileKeptText, true, why);
  assert.equal(titles.filter((t) => t === 'No Folder Open').length, 2, why);

  assert.equal(r.openedOther, true, why);
  assert.equal(r.noteCreated, true, 'Open Folder gives the text a note there\n' + why);
  assert.equal(r.editorKeptText, true, 'Open Folder must not empty the editor\n' + why);
  assert.match(r.noteOnDisk, /MY THESIS NOTES/, why);
  assert.equal(r.otherDisk[r.activeAfterOpen.replace(/^\//, '')], r.noteOnDisk, why);
  assert.equal(r.backupsAfter, 0, 'the backup goes once the note exists\n' + why);
});
