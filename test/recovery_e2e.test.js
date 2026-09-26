'use strict';

/* Desktop E2E for crash recovery at startup (2026-09-27 audit). Each
   scenario boots the REAL Electron app with a crash backup waiting for the
   last opened note (helpers/recovery_e2e_main.js) and answers the recovery
   question one way. Pins:
     • Escape never deletes the backup: it saves it as a separate file
       beside the note (Escape used to mean "Discard");
     • Restore / an explicit Discard still do exactly that;
     • a backup older than the saved file recommends keeping both (Enter);
     • a last note that can no longer be opened no longer drops its backup
       silently: it is offered and saved as a new note, which opens.
   Skipped when no display server is available (same rule as data_safety). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');

const SAVED  = 'Saved chapter text.\n';
const BACKUP = 'Saved chapter text.\nAn unsaved paragraph typed before the crash.\n';
const OTHER  = 'another note\n';

function run(scenario) {
  const electronBin = require('electron');
  const mainScript  = path.join(__dirname, 'helpers', 'recovery_e2e_main.js');
  const env = { ...process.env, RECOVERY_SCENARIO: scenario };
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

const recoverDialogs = (r) => r.dialogs.filter((d) => d.title === 'Recover unsaved changes?');

test('crash recovery at startup in the real Electron app', { skip: !hasDisplay, timeout: 240000 }, async (t) => {
  await t.test('Escape saves the backup as a separate file (it used to delete it)', async () => {
    const r = await run('escape');
    const why = JSON.stringify(r, null, 2);
    assert.deepEqual(recoverDialogs(r).map((d) => [d.buttons, d.defaultId, d.cancelId]),
      [[['Restore', 'Save as a copy', 'Discard'], 0, 1]], why);
    assert.deepEqual(r.disk, { 'note.md': SAVED, 'note_recovered.md': BACKUP, 'other.md': OTHER }, why);
    assert.equal(r.backupLeft, null, 'the backup goes only once the copy is on disk\n' + why);
    assert.deepEqual([r.active, r.editor, r.dirty, r.lastOpened], ['note.md', SAVED, false, 'note.md'], why);
    assert.ok(r.status.includes('note_recovered.md'), 'the user is told where the text went\n' + why);
    assert.deepEqual(r.pageErrors, [], why);
  });

  await t.test('Restore puts the backup back and autosave writes it', async () => {
    const r = await run('restore');
    const why = JSON.stringify(r, null, 2);
    assert.deepEqual(r.disk, { 'note.md': BACKUP, 'other.md': OTHER }, why);
    assert.deepEqual([r.active, r.editor, r.dirty, r.backupLeft], ['note.md', BACKUP, false, null], why);
    assert.deepEqual(r.pageErrors, [], why);
  });

  await t.test('an explicit Discard deletes the backup and nothing else', async () => {
    const r = await run('discard');
    const why = JSON.stringify(r, null, 2);
    assert.deepEqual(r.disk, { 'note.md': SAVED, 'other.md': OTHER }, why);
    assert.deepEqual([r.active, r.editor, r.dirty, r.backupLeft], ['note.md', SAVED, false, null], why);
    assert.deepEqual(r.pageErrors, [], why);
  });

  await t.test('a backup older than the saved file: Enter keeps both', async () => {
    const r = await run('stale');
    const why = JSON.stringify(r, null, 2);
    assert.deepEqual(recoverDialogs(r).map((d) => [d.buttons, d.defaultId, d.cancelId]),
      [[['Restore older backup', 'Save backup as a copy', 'Discard backup'], 1, 1]], why);
    assert.deepEqual(r.disk, { 'note.md': SAVED, 'note_recovered.md': BACKUP, 'other.md': OTHER }, why);
    assert.deepEqual([r.active, r.editor, r.backupLeft], ['note.md', SAVED, null], why);
    assert.deepEqual(r.pageErrors, [], why);
  });

  await t.test('the last note is gone: its backup is offered, saved as a new note and opened', async () => {
    const r = await run('missing');
    const why = JSON.stringify(r, null, 2);
    assert.deepEqual(recoverDialogs(r).map((d) => [d.buttons, d.defaultId, d.cancelId]),
      [[['Save as a new file', 'Discard'], 0, 0]], why);
    assert.deepEqual(r.disk, { 'note_recovered.md': BACKUP, 'other.md': OTHER }, why);
    assert.deepEqual([r.active, r.editor, r.dirty, r.backupLeft, r.lastOpened],
      ['note_recovered.md', BACKUP, false, null, 'note_recovered.md'], why);
    assert.deepEqual(r.pageErrors, [], why);
  });

  await t.test('the last note is gone and the user discards: as before, a fresh start', async () => {
    const r = await run('missing-discard');
    const why = JSON.stringify(r, null, 2);
    assert.deepEqual(r.disk, { 'other.md': OTHER }, why);
    assert.deepEqual([r.active, r.backupLeft, r.lastOpened], [null, null, null], why);
    assert.ok(r.editor.startsWith('# Revery Notebook'), 'the welcome text is shown\n' + why);
    assert.deepEqual(r.pageErrors, [], why);
  });
});
