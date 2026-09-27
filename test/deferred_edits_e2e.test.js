'use strict';

/* Desktop E2E for edits that are aimed at the open note but land after an
   await (2026-09-27 audit). Boots the REAL Electron app on temporary
   projects (helpers/deferred_edits_e2e_main.js). Pins:
     1. an image dropped on a note, then another note opened before the
        copy finished: the link does not go into the other note, and the
        user is told the image was added without a link;
     2. an image pasted over a selection, then typing elsewhere: exactly
        the selection is replaced (it used to replace whatever text had
        moved under the old offsets);
     3. the same, typing over the selection: the typed text is kept and the
        link inserted beside it;
     4. an edit landing while the next note is read is saved into the note
        it was made in before the switch (it used to be dropped);
     5. a note that cannot be read leaves the open note in place;
     6. an edit arriving while the folder picker is open is saved into the
        OLD project (the picker used to switch the backend's root first,
        so that save could not happen);
     7. text typed with no note open whose note cannot be created is not
        replaced by opening another note (it used to be, its only copy a
        temp-dir backup): it stays, the user is told, a reboot-safe backup
        is written; once possible, the switch creates the note first;
     8. text typed into the emptied editor during a project switch gets its
        note in the project being opened, and saves there (it was created
        in the project being left, where every save then failed);
     9. a recent project whose folder is gone: the user is told, the current
        project and the open note stay (the failure used to reach only the
        console, with the editor left empty);
    10. New File while the open note cannot be saved creates nothing (it
        left an empty "untitled" behind).
   Skipped when no display server is available (same rule as data_safety). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');
const LINK = /!\[Pasted image [^\]]+\]\([^)\s]+\)/;

test('deferred edits land in the right note in the real Electron app', { skip: !hasDisplay, timeout: 120000 }, async () => {
  const electronBin = require('electron');
  const mainScript  = path.join(__dirname, 'helpers', 'deferred_edits_e2e_main.js');
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

  const line = output.split(/\r?\n/).find((l) => l.startsWith('E2E-RESULT: '));
  assert.ok(line, `no E2E-RESULT in output:\n${output}`);
  const r = JSON.parse(line.slice('E2E-RESULT: '.length));
  const why = JSON.stringify(r, null, 2);

  assert.equal(r.booted, true, 'boot must restore the seeded note\n' + why);

  // 1. drop, then open another note before the copy finished
  const d = r.dropThenSwitch;
  assert.deepEqual([d.switched, d.copied, d.active, d.editorHasLink], [true, true, 'b.md', false], why);
  assert.equal(d.b, 'Note B\n', 'the link must never go into the note opened meanwhile\n' + why);
  assert.equal(d.a, 'Note A\n', why);
  assert.match(d.status, /dropped\.png.*no link was inserted/, 'the user is told\n' + why);
  assert.equal(r.disk['dropped.png'], '<65536 bytes>', 'the image itself is in the project\n' + why);

  // 2. paste over a selection, type elsewhere
  const p = r.pasteThenTypeElsewhere;
  assert.equal(p.typedFirst, true, 'the typing must happen before the link lands\n' + why);
  assert.match(p.editor, new RegExp('^NEW-INTRO KEEP-THIS-SENTENCE\\. ' + LINK.source + '\\n\\n$'), why);
  assert.equal(p.disk, p.editor, why);

  // 3. paste over a selection, type over it
  const o = r.pasteThenTypeOver;
  assert.equal(o.typedFirst, true, why);
  assert.match(o.editor, new RegExp('^KEEP-THIS-SENTENCE\\. ' + LINK.source + '\\nTYPED\\n$'), why);
  assert.equal(o.disk, o.editor, why);

  // 4. an edit lands while the next note is read
  assert.deepEqual(r.editDuringSwitch, {
    hooked: true, switched: true, active: 'c.md', editor: 'Note C\n', dirty: false,
    b: 'Note B edited\nLATE-EDIT\n', c: 'Note C\n',
  }, 'the late edit is saved into the note it was made in\n' + why);

  // 5. a note that cannot be read
  assert.deepEqual(r.openFailure, { active: 'c.md', editor: 'Note C\n' }, why);
  assert.ok(r.dialogs.includes('Open Failed'), why);

  // 6. an edit arrives while the folder picker is open
  assert.deepEqual(r.projectSwitch, { switched: true, activeFile: null, editor: '', dirty: false }, why);
  assert.equal(r.disk['c.md'], 'Note C before switch\nDURING-PICKER\n',
    'the edit is saved into the old project before the switch\n' + why);
  assert.equal(r.disk['bad.md'], 'Caf�\n', 'never written (read back lossily by the harness)\n' + why);
  assert.equal(r.disk2['other.md'], 'In the second project\n', why);

  // 7. text whose note cannot be created, then another note opened
  const u = r.scratchUncreatable;
  assert.deepEqual(u.blocked, { active: null, editor: 'UNSAVED-SCRATCH\n' },
    'the switch is refused while the note cannot be created: the text stays\n' + why);
  assert.deepEqual([u.switched, u.active, u.note, u.scratchBackups], [true, 'other.md', 'UNSAVED-SCRATCH\n', 0],
    'once it can be, the note is created first, then the switch happens\n' + why);
  assert.ok(r.durableWrites.some((w) => w.key.startsWith('__revery_scratchpad__/') && w.content === 'UNSAVED-SCRATCH\n'),
    'the text got a reboot-safe backup while its note was missing\n' + why);
  assert.deepEqual(r.durableLeft.filter((k) => k.startsWith('__revery_scratchpad__/')), [],
    'that backup is gone once the note exists\n' + why);
  assert.equal(r.disk2['untitled.md'], 'UNSAVED-SCRATCH\n', why);

  // 8. typing while a project switch runs
  assert.deepEqual(r.typedDuringSwitch, {
    hooked: true, switched: true, inNewProject: true, dirty: false,
    note: 'TYPED-IN-GAP\nMORE-AFTER-SWITCH\n',
  }, 'the note is created in the project being opened and saves there\n' + why);
  assert.equal(Object.keys(r.disk2).length, 2, 'nothing from the gap lands in the project left\n' + why);

  // 9. a recent project whose folder is gone
  assert.deepEqual(r.missingProject, { found: true, sameRoot: true, active: 'untitled.md', sameEditor: true },
    'the current project and the open note stay\n' + why);

  // 10. New File while the open note cannot be saved
  assert.deepEqual(r.newFileSaveFails, { nothingCreated: true, active: 'untitled.md', kept: true, savedLater: true }, why);
  assert.equal(r.disk['untitled.md'], 'TYPED-IN-GAP\nMORE-AFTER-SWITCH\nWILL-NOT-SAVE\n', why);

  assert.deepEqual(r.dialogs, [
    'Open Failed',           // 5
    'Could Not Create File', // 7: the create that failed while typing
    'Could Not Create File', // 7: the switch that was refused
    'Could Not Open Folder', // 9
    'Save Failed',           // 10
  ], 'no other dialog\n' + why);
  assert.deepEqual(r.pageErrors, [], why);
});
