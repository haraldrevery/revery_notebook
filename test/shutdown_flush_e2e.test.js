'use strict';

/* Desktop E2E (helpers/restart_e2e_main.js + restart_e2e_driver.js): the
   last moments of typing survive the computer being shut down or the user
   logging out. Autosave runs 1.5 s after the last keystroke and the crash
   backup 2 s after it; an OS that ends the app in between used to lose
   that text. Pins (save.js FLUSH, main.js 'session-end', lifecycle.js):
     • the window loses focus (Start menu, logout dialog, another app):
       the pending autosave runs at once;
     • Windows ends the session ('query-session-end'): the same;
     • a held file ("Keep my version") is still never written by it — only
       its crash backup is;
     • closing (as at logout) right after another program changed the file:
       the close cannot save and asks — nobody answers, the app is gone —
       the typing was backed up before the question, and the next start
       keeps it as a copy beside the newer file.
   Linux/macOS logout sends SIGTERM, which Electron turns into the normal
   close (and the Tauri build now too: main.rs close_on_quit_signals).
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

const TYPED = 'typed just before the computer went down\n';

function clean(r, why) {
  assert.deepEqual(r.problems, [], why);
  r.sessions.forEach((s, i) => {
    assert.equal(s.driverError, undefined, `session ${i}\n` + why);
    assert.deepEqual(s.pageErrors, [], `session ${i}\n` + why);
  });
}

test('typing survives shutdown and logout in the real Electron app', { skip: !hasDisplay, timeout: 600000 }, async (t) => {
  for (const [scenario, what] of [['flush-blur', 'the window loses focus'],
                                  ['flush-session-end', 'Windows ends the session']]) {
    await t.test(`${what}: the pending autosave runs at once`, async () => {
      const r = await run(scenario);
      const why = JSON.stringify(r, null, 2);
      const { V1, OTHER } = r.TEXT;
      clean(r, why);
      const s0 = r.sessions[0];
      assert.equal(s0.diskBefore, V1, 'not saved yet when it happened\n' + why);
      assert.ok(typeof s0.onDiskAfterMs === 'number' && s0.onDiskAfterMs < 1000,
        'on disk well before the autosave delay would have run\n' + why);
      assert.equal(s0.dirtyAfter, false, why);
      assert.deepEqual(r.disk, { 'note.md': V1 + TYPED, 'other.md': OTHER }, why);
      assert.deepEqual(r.dialogs, [], why);
    });
  }

  await t.test('a held file ("Keep my version") is not written by it — its crash backup is', async () => {
    const r = await run('flush-hold');
    const why = JSON.stringify(r, null, 2);
    const { V1, V2 } = r.TEXT;
    clean(r, why);
    const s0 = r.sessions[0];
    assert.equal(s0.held, true, why);
    assert.equal(s0.backupAfterBlur, V1 + TYPED, 'the typing is backed up at once\n' + why);
    assert.equal(s0.diskAfterBlur, V2, 'the other program\'s version stays on disk\n' + why);
  });

  await t.test('closed right after another program changed the file, nobody answers: the typing is kept as a copy', async () => {
    const r = await run('close-external-change');
    const why = JSON.stringify(r, null, 2);
    const { V1, V2, OTHER } = r.TEXT;
    clean(r, why);
    const s0 = r.sessions[0];
    assert.equal(s0.backupBeforeCrash, V1 + TYPED, 'backed up before any question\n' + why);
    assert.equal(s0.diskBeforeCrash, V2, why);
    const recovery = r.dialogs.filter((d) => d.title === 'Recover unsaved changes?');
    assert.deepEqual(recovery.map((d) => [d.session, d.buttons, d.defaultId]),
      [[1, ['Restore backup', 'Save backup as a copy', 'Discard backup'], 1]],
      'the next start offers it — as a copy by default, never over the newer file\n' + why);
    assert.deepEqual(r.disk, { 'note.md': V2, 'note_recovered.md': V1 + TYPED, 'other.md': OTHER }, why);
    assert.deepEqual(r.backups, [], why);
  });
});
