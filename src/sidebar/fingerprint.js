/* fingerprint.js — a short, versioned fingerprint of a text. PURE (no DOM,
   no state): unit-tested in test/fingerprint.test.js.

   Used for crash backups: each backup records the fingerprint of the disk
   text its content was based on (save.js noteBackupBase), so the start-up
   recovery can tell whether the file still is that version (restoring
   then only puts the unsaved edits back) or was changed since by another
   program, a sync service or another device (restoring would replace that
   newer text — lifecycle.js then recommends keeping both). Timestamps
   could not tell: sync tools keep the other device's modification time.

   Not a security hash — it only has to tell two versions of one note
   apart. 64 bits from two independently mixed 32-bit lanes over the UTF-16
   code units, plus the length. Synchronous and allocation-free, so a
   20 MB note costs tens of milliseconds, and it is only ever computed
   once per saved version (save.js caches it). The "v1:" prefix names the
   algorithm: a backup carrying any other value is treated as having no
   fingerprint (the old timestamp check applies). */

export const FINGERPRINT_VERSION = 'v1';

export function textFingerprint(text) {
  const s = String(text);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1  = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2  = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (n) => (n >>> 0).toString(16).padStart(8, '0');
  return `${FINGERPRINT_VERSION}:${s.length}:${hex(h2)}${hex(h1)}`;
}

/** Is `value` a fingerprint this version of the app can compare? */
export function isTextFingerprint(value) {
  return typeof value === 'string' && /^v1:\d+:[0-9a-f]{16}$/.test(value);
}
