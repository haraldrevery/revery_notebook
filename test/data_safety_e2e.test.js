'use strict';

/* Desktop E2E for the data-safety fixes. Boots the REAL Electron main
   (preload, IPC, atomic writes, sidebar in desktop mode) on a temporary
   project and drives the renderer (helpers/data_safety_e2e_driver.js).
   Pins:
     1. Find → Replace after an edit before the match replaces the match on
        screen (stored offsets used to overwrite unrelated text);
     2. an edit inside the match makes Replace refuse and refresh;
     3. regex Replace sees the full-text context (lookbehind, $n);
     4. after a file switch with the bar open, Replace never touches the
        newly opened file;
     5. typing in the image preview and opening another file before the new
        note exists: the typed text lands in the note, the opened file stays
        active and unchanged;
     6. sidebar Ctrl+Z undoes a tree move (it used to throw);
     7. renaming the open note during a "Keep my version" hold keeps the
        edits unsaved and backed up under the new name (never "saved");
     8. links in the OPEN note follow a rename, as a small edit;
     9. a CRLF file keeps CRLF; an identical external rewrite is ignored;
    10. an external write right after an autosave is detected (no blind
        spot) and "Keep my version" pauses autosave even on a clean buffer;
    11. a note moved away by another program is not recreated by autosave;
    12. only the expected native dialogs and no page error along the way.
   Skipped when no display server is available (same rule as media_e2e). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');

test('data-safety end-to-end in the real Electron app', { skip: !hasDisplay, timeout: 110000 }, async () => {
  const electronBin = require('electron');
  const mainScript  = path.join(__dirname, 'helpers', 'data_safety_e2e_main.js');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const output = await new Promise((resolve, reject) => {
    const child = spawn(electronBin, [mainScript], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`electron exited ${code}\n${out}`));
    });
  });

  const line = output.split('\n').find((l) => l.startsWith('E2E-RESULT: '));
  assert.ok(line, `no E2E-RESULT in output:\n${output}`);
  const r = JSON.parse(line.slice('E2E-RESULT: '.length));
  const why = JSON.stringify(r, null, 2);

  assert.equal(r.booted, true, 'boot must restore the seeded project and note\n' + why);

  // 1–2. Replace uses the positions on screen and verifies the match
  assert.deepEqual(r.replaceAfterEdit, { found: 2, text: 'XY OMEGA beta alpha\n' },
    'Replace after an edit before the match must replace that match, nothing else\n' + why);
  assert.deepEqual(r.replaceStale, { text: 'XY OMEGA beZta alpha\n', matchesAfter: 0, warned: true },
    'an edited match is no longer a match: nothing replaced, results refreshed, user told\n' + why);

  // 3. full-text regex context
  assert.deepEqual(r.regexContext, {
    opened: true,
    afterLookbehind: 'fooBAZ and foo bar\n',
    afterGroups: 'BAZ-foo and foo bar\n',
  }, 'regex Replace must honour lookbehinds and $n in the real context\n' + why);

  // 4. file switch
  assert.deepEqual(r.replaceAfterSwitch, {
    opened: true, editor: 'nothing to see here\n', disk: 'nothing to see here\n',
  }, 'Replace after a file switch must never modify the newly opened file\n' + why);

  // 5. scratchpad race
  assert.deepEqual(r.scratchRace, {
    typed: '![pic.png](pic.png) typed',
    active: '<project>/other.md',
    editor: 'nothing to see here\n',
    otherDisk: 'nothing to see here\n',
    noteDisk: '![pic.png](pic.png) typed',
    subFiles: ['pic.md', 'pic.png'],
    told: true,
  }, 'text typed before the note existed must land in that note; the file opened meanwhile stays active and untouched\n' + why);

  // 6. sidebar undo
  assert.deepEqual(r.undoMove, { moved: true, restored: true, errors: [] },
    'sidebar Ctrl+Z must undo a tree move without errors\n' + why);

  // 7. rename during a "Keep my version" hold
  assert.deepEqual(r.renameDuringHold, {
    held: true, started: true, renamed: true,
    dirty: true,
    diskStillExternal: true,
    oldNameGone: true,
    backupUnderNewName: true,
    editorKeptLocal: true,
    savedByCtrlS: true,
    cleanAfterSave: true,
  }, 'renaming the open note must never mark unsaved edits as saved; the hold and the backup follow the file\n' + why);

  // 8. the open note's links follow a rename
  assert.deepEqual(r.linkUpdateOpenNote, {
    started: true,
    confirmShown: true,
    editor: 'See [target](target2.md) here.\nSecond line.\n',
    disk: 'See [target](target2.md) here.\nSecond line.\n',
    cursorAtEnd: true,
  }, 'links in the OPEN note must follow a rename, as a small edit\n' + why);

  // 9. CRLF files stay CRLF; an identical rewrite is not a change
  assert.deepEqual(r.crlf, { opened: true, saved: true, editorLF: true, stillClean: true, noHold: true },
    'a CRLF file must keep CRLF on save, and an identical external rewrite must be ignored\n' + why);

  // 10. no blind spot after our own save; Keep pauses autosave even when clean
  assert.deepEqual(r.blindSpot, {
    asked: true, diskKeptExternal: true, editorKeptLocal: true, savedAfterCtrlS: true, holdCleared: true,
  }, 'an external write right after an autosave must be detected and never silently overwritten\n' + why);

  // 11. a note moved away by another program is not recreated
  assert.deepEqual(r.movedAway, { told: true, notRecreated: true, movedCopyIntact: true, editorKept: true },
    'autosave must not recreate a file another program moved away\n' + why);

  // 12. nothing unexpected: exactly the two external-change questions
  assert.deepEqual(r.dialogs, ['File Changed Externally', 'File Changed Externally'],
    'only the expected native dialogs\n' + why);
  assert.deepEqual(r.pageErrors, [], 'no page error may occur\n' + why);
});
