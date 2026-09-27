'use strict';

/* Desktop E2E for user operations that used to drop or damage text
   (2026-09-27 audit, batch 1). Boots the REAL Electron app on a temporary
   project (helpers/user_ops_e2e_main.js; the system Trash is replaced by a
   private folder, the save dialog answers "cancel"). Pins:
     1. deleting the open note with unsaved edits saves it first: the Trash
        copy holds them;
     2. deleting a note while auto-save is paused for it deletes nothing
        (and does not ask first);
     3. Total Reset in that state is stopped (no reload, text kept);
     4. import refuses a Windows-1252 file (it used to import it with U+FFFD),
        converts UTF-16 with a BOM, and reports a failed write;
     5. "Export & Continue" with the dialog cancelled stays on step one;
     6. Total Reset with unsaved edits saves them before it reloads;
     7. only the expected native dialogs, no page error.
   Skipped when no display server is available (same rule as data_safety). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');

test('user operations keep text in the real Electron app', { skip: !hasDisplay, timeout: 110000 }, async () => {
  const electronBin = require('electron');
  const mainScript  = path.join(__dirname, 'helpers', 'user_ops_e2e_main.js');
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

  assert.equal(r.booted, true, 'boot must restore the seeded note\n' + why);

  // 1. delete the open note with unsaved edits
  assert.deepEqual(r.deleteDirty, { started: true, gone: true, active: null, editor: '' }, why);
  assert.deepEqual(r.trash, { '1-del.md': 'del: saved\nedit before delete\n' },
    'the Trash copy must hold the edits autosave had not written yet\n' + why);

  // 2. delete while auto-save is paused
  assert.deepEqual(r.deleteHeld, {
    opened: true, held: true, started: true, told: true, stillOnDisk: true, editorKept: true,
  }, 'nothing may be deleted while the version on screen is not on disk\n' + why);

  // 3. Total Reset while paused
  assert.deepEqual(r.resetHeld, {
    told: true, modalClosed: true, quitting: false, editorKept: true, savedByCtrlS: true,
  }, 'Total Reset must stop while auto-save is paused for the open note\n' + why);

  // 4. import
  assert.deepEqual(r.imports, {
    legacyCreated: false,
    wideOpened: true,
    wideDisk: 'Café 📝 wide\n',
    roFiles: r.readOnlyTestable ? [] : null,
  }, 'import: refuse lossy decoding, convert UTF-16, leave nothing behind on failure\n' + why);

  // 5. Export & Continue, dialog cancelled
  assert.deepEqual(r.exportCancelled, { stillStep1: true, quitting: false }, why);

  // 6. Total Reset with unsaved edits
  assert.equal(r.resetOpened, true, why);
  assert.equal(r.resetDirty, true, why);
  assert.deepEqual(r.afterReset, {
    resetDisk: 'reset: saved\ntyped right before the reset\n',
    active: null,
    welcomeShown: true,
    markerLeft: null,
  }, 'the edits must be on disk after the reset, and the reset itself still happens\n' + why);
  assert.equal(r.lastOpenedAfterReset, null, 'the reset still forgets the last-opened note\n' + why);

  // final disk state: nothing half-imported, nothing deleted by mistake
  assert.deepEqual(r.disk, {
    'held.md': 'held: saved\nmy edit\n',
    'reset.md': 'reset: saved\ntyped right before the reset\n',
    'ro': {},
    'wide.md': 'Café 📝 wide\n',
  }, why);

  // 7. dialogs and errors
  // (no second 'Delete File': a paused note is refused before the question)
  assert.deepEqual(r.dialogs, ['Delete File', 'File Changed Externally', 'Import',
    ...(r.readOnlyTestable ? ['Import Failed'] : [])], why);
  assert.deepEqual(r.pageErrors, [], why);
});
