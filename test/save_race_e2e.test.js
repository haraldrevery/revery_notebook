'use strict';

/* Desktop E2E for the save races found in the 2026-09-27 audit. Boots the
   REAL Electron main (preload, IPC, atomic writes, sidebar in desktop mode)
   on a temporary project and drives the renderer
   (helpers/save_race_e2e_driver.js). Pins:
     1. renaming the open note in the title field and clicking another note
        while the rename runs: the other note opens and receives the typing;
        the renamed note keeps ITS text (it used to be overwritten with the
        other note's text by the next autosave);
     2. another program's write landing just before an autosave (inside the
        watcher's debounce) is never overwritten unasked: the save stops,
        the external-change question comes, both versions survive;
     3. a note moved away by another program just before an autosave is not
        recreated by that background save; an explicit Ctrl+S still can;
     4. an explicit Ctrl+S right after another program's write asks first;
     5. closing right after another program's write stops at that question
        (the window stays open; no "discard and quit?" on top of it);
     6. only the expected native dialogs, no page error.
   Skipped when no display server is available (same rule as data_safety). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');

test('save races end-to-end in the real Electron app', { skip: !hasDisplay, timeout: 90000 }, async () => {
  const electronBin = require('electron');
  const mainScript  = path.join(__dirname, 'helpers', 'save_race_e2e_main.js');

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

  // 1. title rename + switching notes
  assert.deepEqual(r.renameRace, {
    active: 'x.md',
    title: 'x',
    editor: 'NOTE X: a shopping list\n',
    xDisk: 'NOTE X: a shopping list\ntyped after switching\n',
    renamedDisk: 'NOTE A: the thesis chapter\n',
    oldNameGone: true,
  }, 'the renamed note must keep its own text; the note that was opened gets the typing\n' + why);

  // 2. external write just before an autosave
  assert.deepEqual(r.externalBeforeAutosave, {
    opened: true, saved: false, held: true,
    diskKeptExternal: true, editorKeptLocal: true, savedByCtrlS: true,
  }, 'an autosave must never overwrite another program\'s fresh write unasked\n' + why);

  // 3. note moved away just before an autosave
  assert.deepEqual(r.missingBeforeAutosave, {
    opened: true, saved: false, recreated: false, told: true, editorKept: true, ctrlSRecreates: true,
  }, 'a background save must not recreate a note another program moved away\n' + why);

  // 4. explicit Ctrl+S right after an external write
  assert.deepEqual(r.ctrlSAfterExternal, {
    opened: true, held: true, diskKeptExternal: true, editorKeptLocal: true,
  }, 'Ctrl+S must ask before overwriting a change it has not shown\n' + why);

  // 5. closing right after an external write
  assert.deepEqual(r.closeAfterExternal, {
    opened: true, held: true, stillOpen: true, diskKeptExternal: true, editorKeptLocal: true,
  }, 'a close must stop at the external-change question, not discard or overwrite\n' + why);

  // 6. dialogs and errors
  assert.deepEqual(r.dialogs, ['File Changed Externally', 'File Changed Externally', 'File Changed Externally'],
    'one external-change question each for scenarios 2, 4 and 5 — no "Unsaved Changes" on close\n' + why);
  assert.deepEqual(r.pageErrors, [], 'no page errors\n' + why);
});
