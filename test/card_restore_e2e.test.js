'use strict';

/* Desktop E2E across app sessions (helpers/restart_e2e_main.js): the card
   view opens where it was. It used to open at the project root at every
   start (and every project switch) while the editor reopened the last
   note — and New File then went into the last note's folder, out of
   sight. Pins:
     • a restart reopens the card view in the folder it showed, and New
       File creates the note there;
     • a remembered folder that was removed meanwhile falls back to the
       nearest folder above it that still exists (and New File follows);
     • nothing remembered: the last note's folder, not the root;
     • each project keeps its own folder across project switches.
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

function clean(r, why) {
  assert.deepEqual(r.problems, [], why);
  assert.deepEqual(r.dialogs, [], 'no dialog at all\n' + why);
  r.sessions.forEach((s, i) => {
    assert.equal(s.driverError, undefined, `session ${i}\n` + why);
    assert.deepEqual(s.pageErrors, [], `session ${i}\n` + why);
  });
}

test('card view folder across app sessions in the real Electron app', { skip: !hasDisplay, timeout: 600000 }, async (t) => {
  await t.test('a restart reopens the folder the card view showed; New File goes there', async () => {
    const r = await run('card-restore');
    const why = JSON.stringify(r, null, 2);
    clean(r, why);
    const [s0, s1] = r.sessions;
    assert.deepEqual([s0.cardAtStart, s0.crumbBeforeRestart], ['a', 'b'], why);
    assert.deepEqual([s1.crumb, s1.cards, s1.newFileIn, s1.active], ['b', ['deep.md'], 'a/b', 'a/b/untitled.md'], why);
    assert.equal(r.disk['a/n.md'], 'note in a\n', 'the last note was reopened untouched\n' + why);
  });

  await t.test('the remembered folder was removed meanwhile: the nearest folder above it', async () => {
    const r = await run('card-gone');
    const why = JSON.stringify(r, null, 2);
    clean(r, why);
    const [s0, s1] = r.sessions;
    assert.deepEqual([s0.crumbBeforeRestart, s0.folderGone], ['b', true], why);
    assert.deepEqual([s1.crumb, s1.cards, s1.newFileIn], ['a', ['n.md'], 'a'],
      'never an empty panel, and New File never targets the vanished folder\n' + why);
  });

  await t.test('nothing remembered: the last note\'s folder, not the project root', async () => {
    const r = await run('card-default');
    const why = JSON.stringify(r, null, 2);
    clean(r, why);
    assert.deepEqual([r.sessions[0].cardAtStart, r.sessions[1].crumb], ['a', 'a'], why);
  });

  await t.test('each project keeps its own folder across project switches', async () => {
    const r = await run('card-switch');
    const why = JSON.stringify(r, null, 2);
    clean(r, why);
    const s0 = r.sessions[0];
    assert.deepEqual([s0.inC, s0.inSub2, s0.backInP1], ['c', 'sub2', 'c'], why);
  });
});
