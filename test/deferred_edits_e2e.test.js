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
        so that save could not happen).
   Skipped when no display server is available (same rule as data_safety). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.platform !== 'linux');
const LINK = /!\[Pasted image [^\]]+\]\([^)\s]+\)/;

test('deferred edits land in the right note in the real Electron app', { skip: !hasDisplay, timeout: 90000 }, async () => {
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
  assert.deepEqual(r.disk2, { 'other.md': 'In the second project\n' }, why);

  assert.deepEqual(r.dialogs, ['Open Failed'], 'no other dialog (e.g. "Save Failed")\n' + why);
  assert.deepEqual(r.pageErrors, [], why);
});
