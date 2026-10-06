# Spell-check dictionaries (Electron build, Windows and Linux)

Chromium's spell checker — which the Electron build uses on Windows and
Linux (macOS uses the system spell checker) — needs Hunspell dictionaries
in Chromium's `.bdic` format. By default Electron downloads them from
Google's servers at start, which sends the user's IP address and language
to Google and contradicted the app's privacy statement ("No data is ever
transmitted to any server"). The app now ships these two and never
downloads any (`electron/main.js`, SPELL CHECK):

| File | Language |
|---|---|
| `en-US-10-1.bdic` | English (United States) |
| `sv-SE-3-0.bdic` | Swedish |

**Source:** `hunspell_dictionaries.zip` from the Electron v44.5.1 release
(`sha256 7a436577e7d7a27e466755b6b7da3a5ace86066468a836ee93163a89dd552449`,
matching that release's `SHASUMS256.txt`) — Chromium's
`hunspell_dictionaries`, converted to `.bdic`. The files are unchanged.

**Licences:** the licence texts published in that archive are included
unchanged (`LICENSE`, `COPYING`, `COPYING.*`). Which of them applies to
each dictionary is listed in Chromium's
`third_party/hunspell_dictionaries/README.chromium`.

**When upgrading Electron:** the version in each file name (`10-1`, `3-0`)
must be the one that Electron's Chromium expects. Copy both files (and the
licence texts) from the new release's `hunspell_dictionaries.zip`.
`test/spellcheck_offline_e2e.test.js` fails when a bundled dictionary is not
the one Chromium loads — it would otherwise stop spell checking silently,
since nothing is ever downloaded.
