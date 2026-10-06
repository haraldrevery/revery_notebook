'use strict';
/* spellcheck.js — the Electron build's spell checker, without the network.

   Chromium's spell checker (Electron on Windows and Linux; macOS uses the
   system spell checker) needs Hunspell dictionaries and downloads them from
   Google's servers by default: the user's IP address and language went to
   Google at every start, while the app promises that no data is ever
   transmitted. The app now ships English and Swedish
   (electron/dictionaries/README.md). They are copied into the profile's
   Dictionaries folder — where Chromium looks before it downloads — and the
   download address points at a local folder that does not exist, so a
   dictionary the app does not ship is never fetched from anywhere.

   Spell checking is on for the bundled languages the system prefers, and
   off when it prefers none of them: checking another language against an
   English or Swedish dictionary would mark nearly every word as wrong.

   The pure parts (language choice, dictionary install) are unit-tested in
   test/spellcheck.test.js; the whole is pinned end-to-end in
   test/spellcheck_offline_e2e.test.js (no network request at all). */
const fs   = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { atomicWriteFile } = require('./fs_core');

/* File names carry the dictionary version Chromium expects (see the
   README before upgrading Electron). */
const BUNDLED_DICTIONARIES = Object.freeze([
  Object.freeze({ lang: 'en-US', base: 'en', file: 'en-US-10-1.bdic' }),
  Object.freeze({ lang: 'sv-SE', base: 'sv', file: 'sv-SE-3-0.bdic' }),
]);

const SOURCE_DIR = path.join(__dirname, 'dictionaries');

/** The system's preferred languages ("sv-SE", "en_GB", "en") → the bundled
    spell-check languages to use, in the system's order, without repeats. */
function spellCheckLanguages(preferred) {
  const out = [];
  for (const p of Array.isArray(preferred) ? preferred : []) {
    const base = String(p).toLowerCase().split(/[-_.@]/)[0];
    const hit = BUNDLED_DICTIONARIES.find((d) => d.base === base);
    if (hit && !out.includes(hit.lang)) out.push(hit.lang);
  }
  return out;
}

/** Copy the bundled dictionaries into `destDir` (the profile's Dictionaries
    folder) unless an identical copy is there. Atomic, so a crash never
    leaves a truncated dictionary that Chromium would fail to load. Never
    throws: → the names that are in place. */
function installBundledDictionaries(destDir, srcDir = SOURCE_DIR) {
  const ready = [];
  try { fs.mkdirSync(destDir, { recursive: true }); } catch (_) { /* reported per file below */ }
  for (const d of BUNDLED_DICTIONARIES) {
    const dest = path.join(destDir, d.file);
    try {
      const data = fs.readFileSync(path.join(srcDir, d.file));
      let same = false;
      try { same = fs.readFileSync(dest).equals(data); } catch (_) { /* not there yet */ }
      if (!same) atomicWriteFile(dest, data);
      ready.push(d.file);
    } catch (err) {
      console.warn('[revery] spell-check dictionary not installed:', d.file, err.message);
    }
  }
  return ready;
}

/** Set up spell checking. Call once the app is ready and BEFORE anything
    touches a session (`session.defaultSession`, the first window): Chromium
    looks for its dictionaries — and starts downloading a missing one — the
    moment a session is created. So the bundled dictionaries go in place
    first, and every session gets the no-download address from the very
    event that announces it (in time: the lookup runs after it). Only then
    is the default session created, to choose the languages. `app` and
    `getDefaultSession` are Electron's (the latter: () => session.defaultSession). */
function setUpSpellChecker(app, getDefaultSession) {
  if (process.platform === 'darwin') return; // the system spell checker: no dictionaries, no downloads
  const userData = app.getPath('userData');
  const noDownloads = pathToFileURL(path.join(userData, 'no-dictionary-downloads')).href + '/';
  const installed = installBundledDictionaries(path.join(userData, 'Dictionaries'));
  app.on('session-created', (s) => {
    try {
      s.setSpellCheckerDictionaryDownloadURL(noDownloads);
    } catch (err) {
      console.warn('[revery] spell check turned off (download address not set):', err.message);
      s.setSpellCheckerEnabled(false);
    }
  });

  const ses = getDefaultSession();
  const langs = spellCheckLanguages(app.getPreferredSystemLanguages())
    .filter((lang) => installed.includes(BUNDLED_DICTIONARIES.find((d) => d.lang === lang).file));
  if (!langs.length) {
    ses.setSpellCheckerEnabled(false);
    return;
  }
  try {
    ses.setSpellCheckerLanguages(langs);
  } catch (err) {
    console.warn('[revery] spell check turned off:', err.message);
    ses.setSpellCheckerEnabled(false);
  }
}

module.exports = { BUNDLED_DICTIONARIES, spellCheckLanguages, installBundledDictionaries, setUpSpellChecker };
