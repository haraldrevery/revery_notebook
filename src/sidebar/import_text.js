/* import_text.js — how an imported file's bytes become text. PURE (no DOM,
   no state): unit-tested in test/import_text.test.js.

   The app only ever reads UTF-8, and refuses anything else rather than
   decode it lossily (fs_core.readUtf8TextStrict / read_text_strict). The
   import used FileReader.readAsText, which DID decode lossily: every byte
   of a Windows-1252 file that is not valid UTF-8 silently became U+FFFD in
   the imported copy. Now:
     • UTF-8 is decoded strictly; a leading BOM is kept, as the backends
       keep it;
     • UTF-16 with a byte-order mark is unambiguous, so it is converted
       (strictly — an unpaired surrogate refuses the file); the BOM is not
       carried into the UTF-8 copy;
     • everything else is refused: decodeImportedText throws, and the caller
       tells the user instead of importing a damaged copy. A UTF-32 BOM
       (whose first two bytes look like UTF-16LE's) is refused too. */

export function decodeImportedText(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 4 && b[0] === 0xFF && b[1] === 0xFE && b[2] === 0x00 && b[3] === 0x00) {
    throw new Error('UTF-32 text is not supported.');
  }
  if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) {
    return new TextDecoder('utf-16le', { fatal: true }).decode(b);
  }
  if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) {
    return new TextDecoder('utf-16be', { fatal: true }).decode(b);
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b);
}
