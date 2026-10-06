'use strict';

/* Desktop E2E across app sessions (helpers/restart_e2e_main.js): what one
   session leaves on disk and in the crash-backup folders is what the next
   start finds. Pins the 2026-10 crash-backup fixes:
     • a backup made BEFORE another program (a sync service) changed the
       file is never restored over it by default — the start-up recovery
       compares the backup's recorded base with the file, which a sync tool
       keeping an old modification time cannot fool; Enter keeps both;
     • "Keep my version" with no unsaved edits: the version kept in the
       editor survives closing (offered as a copy), switching notes (saved
       as "<name>_local" first, unless the file holds it again) and a
       rename (its backup follows the new name);
     • "Reload from disk" deletes the backup of the edits it discarded —
       they used to come back at the next start, Restore by default;
     • typing during a save, then a crash: the backup names the version
       that save wrote, so the next start sees plain unsaved edits
       (Restore), not a false "file changed" warning;
     • "Save my version & reload" (now on the shared copy writer).
   Skipped when no display server is available (same rule as data_safety). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');

function run(scenario) {
  const electronBin = require('electron');
  const mainScript  = path.join(__dirname, 'helpers', 'restart_e2e_main.js');
  const env = { ...process.env, RESTART_SCENARIO: scenario };
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

const recoveryDialogs = (r) => r.dialogs.filter((d) => d.title === 'Recover unsaved changes?')
  .map((d) => [d.session, d.buttons, d.defaultId, d.cancelId]);
const CHANGED_SINCE = ['Restore backup', 'Save backup as a copy', 'Discard backup'];

function clean(r, why) {
  assert.deepEqual(r.problems, [], why);
  r.sessions.forEach((s, i) => {
    assert.equal(s.driverError, undefined, `session ${i}\n` + why);
    assert.deepEqual(s.pageErrors, [], `session ${i}\n` + why);
  });
}

test('crash backups across app sessions in the real Electron app', { skip: !hasDisplay, timeout: 900000 }, async (t) => {
  await t.test('Keep my version (no edits), close, restart: Enter keeps BOTH versions', async () => {
    const r = await run('keep-clean-close');
    const why = JSON.stringify(r, null, 2);
    const { V1, V2, OTHER } = r.TEXT;
    clean(r, why);
    const [s0, s1] = r.sessions;
    assert.deepEqual([s0.held, s0.closed, s0.diskAtClose], [true, true, V2], why);
    assert.deepEqual(s0.snapshot, { content: V1, hasBase: true }, 'the kept version is backed up, with its base\n' + why);
    assert.deepEqual(recoveryDialogs(r), [[1, CHANGED_SINCE, 1, 1]],
      'the start says the file changed since, and recommends the copy — never Restore by default\n' + why);
    assert.deepEqual(r.disk, { 'note.md': V2, 'note_recovered.md': V1, 'other.md': OTHER }, why);
    assert.deepEqual(r.backups, [], 'the backup goes once the copy is on disk\n' + why);
    assert.deepEqual([s1.active, s1.editor, s1.dirty], ['note.md', V2, false], why);
  });

  await t.test('Keep my version WITH unsaved edits, crash: Enter keeps both', async () => {
    const r = await run('keep-dirty-crash');
    const why = JSON.stringify(r, null, 2);
    const { V1, V2, OTHER } = r.TEXT;
    const mine = V1 + 'A paragraph I typed and kept.\n';
    clean(r, why);
    assert.deepEqual(r.sessions[0].snapshot, { content: mine, hasBase: true }, why);
    assert.equal(r.sessions[0].diskBeforeCrash, V2, 'nothing was written over the other version\n' + why);
    assert.deepEqual(recoveryDialogs(r), [[1, CHANGED_SINCE, 1, 1]], why);
    assert.deepEqual(r.disk, { 'note.md': V2, 'note_recovered.md': mine, 'other.md': OTHER }, why);
    assert.deepEqual(r.backups, [], why);
    assert.equal(r.sessions[1].editor, V2, why);
  });

  await t.test('Reload from disk discards the edits AND their backup: nothing comes back after a crash', async () => {
    const r = await run('reload-discard');
    const why = JSON.stringify(r, null, 2);
    const { V2, OTHER } = r.TEXT;
    clean(r, why);
    assert.deepEqual([r.sessions[0].reloaded, r.sessions[0].backupAfterReload], [true, null], why);
    assert.deepEqual(recoveryDialogs(r), [], 'the discarded edits are not offered again\n' + why);
    assert.deepEqual(r.disk, { 'note.md': V2, 'other.md': OTHER }, why);
    assert.deepEqual(r.backups, [], why);
    assert.deepEqual([r.sessions[1].active, r.sessions[1].editor], ['note.md', V2], why);
  });

  await t.test('typing during a slow save, then a crash: plain unsaved edits, restored by Enter', async () => {
    const r = await run('slow-save-crash');
    const why = JSON.stringify(r, null, 2);
    const { V1, OTHER } = r.TEXT;
    clean(r, why);
    const s0 = r.sessions[0];
    assert.deepEqual([s0.saved, s0.diskBeforeCrash, s0.backup],
      [true, V1 + ' first', V1 + ' first during save'], why);
    assert.deepEqual(recoveryDialogs(r), [[1, ['Restore', 'Save as a copy', 'Discard'], 0, 1]],
      'no false "changed since" warning for the app\'s own save\n' + why);
    assert.equal(r.sessions[1].restoredAndSaved, true, why);
    assert.deepEqual(r.disk, { 'note.md': V1 + ' first during save', 'other.md': OTHER }, why);
    assert.deepEqual(r.backups, [], why);
  });

  await t.test('Keep my version (no edits), then another note is opened: the kept version is saved as a copy', async () => {
    const r = await run('keep-clean-switch');
    const why = JSON.stringify(r, null, 2);
    const { V1, V2, OTHER } = r.TEXT;
    clean(r, why);
    const s0 = r.sessions[0];
    assert.deepEqual([s0.held, s0.switched, s0.copied, s0.backupAfterSwitch], [true, true, true, null], why);
    assert.ok(s0.statusAfterSwitch.includes('note_local.md'), 'the user is told where it went\n' + why);
    assert.deepEqual(r.disk, { 'note.md': V2, 'note_local.md': V1, 'other.md': OTHER }, why);
    assert.deepEqual(recoveryDialogs(r), [], why);
    assert.deepEqual(r.backups, [], why);
  });

  await t.test('… unless the file holds the kept version again: no copy', async () => {
    const r = await run('keep-clean-reverted');
    const why = JSON.stringify(r, null, 2);
    const { V1, OTHER } = r.TEXT;
    clean(r, why);
    assert.deepEqual([r.sessions[0].reverted, r.sessions[0].switched, r.sessions[0].copyMade], [true, true, false], why);
    assert.deepEqual(r.disk, { 'note.md': V1, 'other.md': OTHER }, why);
    assert.deepEqual(recoveryDialogs(r), [], why);
    assert.deepEqual(r.backups, [], why);
  });

  await t.test('Keep my version (no edits), rename in the file panel, close: the kept version follows the name', async () => {
    const r = await run('rename-kept');
    const why = JSON.stringify(r, null, 2);
    const { V1, V2, OTHER } = r.TEXT;
    clean(r, why);
    const s0 = r.sessions[0];
    assert.deepEqual([s0.renameStarted, s0.renamed, s0.snapshotUnderNewName, s0.snapshotUnderOldName, s0.closed],
      [true, true, V1, false, true], why);
    assert.deepEqual(recoveryDialogs(r), [[1, CHANGED_SINCE, 1, 1]], why);
    assert.deepEqual(r.disk, { 'other.md': OTHER, 'renamed.md': V2, 'renamed_recovered.md': V1 }, why);
    assert.deepEqual(r.backups, [], why);
  });

  await t.test('Save my version & reload: the copy is written, the backup goes, nothing is offered later', async () => {
    const r = await run('save-mine-reload');
    const why = JSON.stringify(r, null, 2);
    const { V1, V2, OTHER } = r.TEXT;
    clean(r, why);
    assert.deepEqual([r.sessions[0].reloaded, r.sessions[0].copied, r.sessions[0].backupAfter], [true, true, null], why);
    assert.ok(r.dialogs.some((d) => d.session === 0 && d.title === 'Saved as Copy'), why);
    assert.deepEqual(r.disk, { 'note.md': V2, 'note_local.md': V1 + 'My own paragraph.\n', 'other.md': OTHER }, why);
    assert.deepEqual(recoveryDialogs(r), [], why);
    assert.deepEqual(r.backups, [], why);
  });
});
