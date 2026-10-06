'use strict';

/* The Electron build's spell checker never touches the network
   (electron/spellcheck.js): it used to download its dictionaries from
   Google's servers at every start — the user's IP address and language
   went to Google, while the app promises that no data is ever transmitted.
   Boots the REAL app (helpers/spellcheck_e2e_main.js) while the OS reports
   a chosen language, and pins, from Chromium's own network log:
     • English or Swedish system: the bundled dictionary is the one Chromium
       loads (not a download), and a misspelled word typed into the editor
       is flagged;
     • a language the app has no dictionary for: spell check is off rather
       than marking every word as wrong — and nothing is downloaded;
     • not a single http(s) request in any run.
   After an Electron upgrade this fails if the bundled dictionaries are not
   the version Chromium expects (electron/dictionaries/README.md).
   Linux only: there the OS language comes from LANGUAGE/LANG, which the
   test can set; Windows takes it from the user's settings. macOS uses the
   system spell checker. Skipped without a display (same rule as the other
   E2Es). */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
const runsHere = process.platform === 'linux' && hasDisplay;

function run(language) {
  const electronBin = require('electron');
  const mainScript  = path.join(__dirname, 'helpers', 'spellcheck_e2e_main.js');
  const env = { ...process.env, LANGUAGE: language, LANG: language.split(':')[0] + '.UTF-8', LC_ALL: '' };
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

const BUNDLED = ['en-US-10-1.bdic', 'sv-SE-3-0.bdic'];

test('spell check works offline and never downloads', { skip: !runsHere, timeout: 180000 }, async (t) => {
  await t.test('English system: the bundled dictionary is loaded, a typo is flagged, no network', async () => {
    const r = await run('en_US');
    const why = JSON.stringify(r, null, 2);
    assert.equal(r.netLogRead, true, 'the network log was read\n' + why);
    assert.deepEqual(r.httpRequests, [], 'not a single http(s) request\n' + why);
    assert.deepEqual([r.enabled, r.languages], [true, ['en-US']], why);
    assert.ok(r.events.includes('initialized en-US'), 'Chromium loaded the bundled dictionary\n' + why);
    assert.ok(!r.events.some((e) => e.startsWith('download')), 'nothing was downloaded\n' + why);
    assert.equal(r.flagged, 'Thiss', 'a misspelled word is flagged\n' + why);
    assert.deepEqual(r.dictionaries, BUNDLED, why);
  });

  await t.test('Swedish system (English as well): both bundled dictionaries, no network', async () => {
    const r = await run('sv_SE:en_US');
    const why = JSON.stringify(r, null, 2);
    assert.deepEqual(r.httpRequests, [], why);
    // Chromium reports Swedish as "sv"
    assert.deepEqual([r.enabled, r.languages], [true, ['sv', 'en-US']], why);
    assert.ok(r.events.includes('initialized sv'), why);
    assert.ok(r.events.includes('initialized en-US'), why);
    assert.ok(!r.events.some((e) => e.startsWith('download')), why);
    assert.equal(r.flagged, 'Thiss', why);
  });

  await t.test('a language without a bundled dictionary: spell check is off, nothing is downloaded', async () => {
    const r = await run('de_DE');
    const why = JSON.stringify(r, null, 2);
    assert.deepEqual(r.httpRequests, [], 'not a single http(s) request\n' + why);
    assert.equal(r.enabled, false, why);
    /* Chromium looks for the system language's dictionary when the session
       is created; the attempt goes to the local no-download address and
       fails — it never reaches the network, and nothing is loaded. */
    assert.ok(!r.events.some((e) => e.startsWith('initialized') || e.startsWith('download-success')), why);
    assert.notEqual(r.flagged, 'Thiss', 'nothing is marked as misspelled\n' + why);
  });
});
