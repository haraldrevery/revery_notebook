/* In-page driver (phase 2) for the user-operations E2E: runs in the page
   the Total Reset reloaded. Reports what the reset left behind. */
(async () => {
  const PROJECT = __PROJECT__;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { const v = await fn(); if (v) return v; } catch (_) { /* not yet */ }
      await sleep(50);
    }
    return null;
  };
  await until(() => window.NativeAPI && typeof window.sidebarGetActiveFilePath === 'function');
  await sleep(1500); // boot settles
  let resetDisk = null;
  try { resetDisk = await window.NativeAPI.readFile(PROJECT + '/reset.md'); } catch (_) { /* null */ }
  let markerLeft = 'unreadable';
  try { markerLeft = localStorage.getItem('revery_md_autosave'); } catch (_) { /* keep */ }
  return {
    resetDisk,
    active: window.sidebarGetActiveFilePath(),
    welcomeShown: editor.value.startsWith('# Revery Notebook'),
    markerLeft,
  };
})()
