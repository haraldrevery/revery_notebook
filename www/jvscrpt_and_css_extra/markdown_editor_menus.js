// editor-menus.js
// ── Settings dropdown ──────────────────────────────────────────────────────
const btnFile         = document.getElementById('btn-file');
const fileDropdown    = document.getElementById('file-dropdown');
const btnSettings     = document.getElementById('btn-settings');
const settingsDropdown= document.getElementById('settings-dropdown');
const btnLogo         = document.getElementById('btn-logo');
const logoDropdown    = document.getElementById('logo-dropdown');

window.forcedSyncEnabled = false; // New Forced Sync state
let rightClickDisabled = true; // New right click setting state
let lineNumbersVisible = false; // Line number visibility state
let previewVisible = true;
let wordCountVisible = false; // Word count visibility state
window.centerHeaders = true; // Center align headings in preview
let mobileView = false;
let readerMode = false;
let outlineVisible = false; // Outline navigation panel (toggled via Settings)
let themeMode = 'system'; // 'system', 'light', 'dark', 'paper', 'forest'

let uiSize  = 140; // UI menu font scale in %, applied to <html> (90–200 in 10% steps)
let editorTextSize = 150; // Editor textarea font scale in %
let previewTextSize = 140; // Preview prose font scale in %
let outlineFontSize = 140; // Outline panel font scale in %, independent of editor/preview text

let readerPadding = window.innerWidth <= 820 ? 'default' : '40'; // Reader mode content width: 'default' | '80' | '60' | '50'
let editorPadding = 'default'; // Editor padding: 'default' | '5%' | '10%' | '15%' | '20%' | '25%' | '30%'
let editorFontType = 'harald'; // Editor font style ('harald' is default)

let previewFontType = 'harald'; // Preview font style ('harald' is default)
let uiLanguage = window.uiLanguage; // UI Language setting (synced from lang.js)
let selectedBackground = 'bg_6'; // Active background image key
let slowHardwareMode = false;    // One switch for older machines — see setSlowHardwareMode
let backgroundOpacity = null;    // null = per-theme CSS default; number 0.01–1 overrides
let livePreviewMode = false;     // Obsidian-style in-editor rendering — see setLivePreviewMode
const CUSTOM_BG_KEY = 'revery_custom_bg'; // data: URL of an imported background (outside the settings JSON)
window.slowHardwareMode = false; // Mirror read by core/sync/native_api/sidebar at call time
let editorBgGradient = false;     // true = gradient fade, false = solid colour

/* ── Background image options ─────────────────────────────────────────────
   To add a new background: append a new entry to this array.
   { label: 'Display Name', val: 'unique-key', url: '/path/to/image.jpg' }  */
const BACKGROUND_OPTIONS = [
  { label: 'None',        val: 'none',   url: null },
  { label: 'Galdhøpiggen', val: 'bg_1',   url: '../image_assets/bg_1_max.jpg' },
  { label: 'Rocks',     val: 'bg_2',   url: '../image_assets/bg_2_max.jpg'  },
  { label: 'Matterhorn',  val: 'bg_3',   url: '../image_assets/bg_3_max.jpg'  },
  { label: 'Alpern',      val: 'bg_4',   url: '../image_assets/bg_4_max.jpg'  },
  { label: 'Grass',       val: 'bg_5',   url: '../image_assets/bg_5_max.jpg'  },
  { label: 'Tree',        val: 'bg_6',   url: '../image_assets/bg_6_max.jpg'  },
  { label: 'Tjurpannan',        val: 'bg_7',   url: '../image_assets/bg_7_max.jpg'  }
];

/* ── Settings Persistence ─────────────────────────────────────────────── */
window.saveEditorSettings = function() {
  const settings = {
    lineNumbersVisible,
    forcedSyncEnabled: window.forcedSyncEnabled, rightClickDisabled, previewVisible, wordCountVisible, mobileView, readerMode, outlineVisible,
    uiSize, editorTextSize, previewTextSize, outlineFontSize, readerPadding, editorPadding, editorFontType, previewFontType, uiLanguage,
    currentDateFormat: window.currentDateFormat,

    
    filenameFormat: window.filenameFormat,
    renderDelay: typeof renderDelay !== 'undefined' ? renderDelay : 50,
    savedEditorWidth: window.savedEditorWidth || '',
    savedSidebarWidth: window.savedSidebarWidth || '',
    centerHeaders: window.centerHeaders,
    selectedBackground,
    themeMode,
    editorBgGradient,
    slowHardwareMode,
    backgroundOpacity,
    livePreviewMode
  };

  try {
    localStorage.setItem('revery_md_settings', JSON.stringify(settings));
  } catch (e) {
    if ((e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')
        && typeof window.showStatusWarning === 'function') {
      window.showStatusWarning('storage-full',
        'Storage full! Settings could not be saved. Export your file to free up space.',
        { priority: 100 });
    }
  }
};


function loadEditorSettings() {
  try {
    const stored = localStorage.getItem('revery_md_settings');
    if (stored) {
      const s = JSON.parse(stored);
      if (s.lineNumbersVisible !== undefined) {
        lineNumbersVisible = s.lineNumbersVisible;
        if (typeof window.setLineNumbersVisible === 'function') {
          window.setLineNumbersVisible(lineNumbersVisible);
        }
      }
      if (s.forcedSyncEnabled !== undefined) window.forcedSyncEnabled = s.forcedSyncEnabled;
      if (s.rightClickDisabled !== undefined) rightClickDisabled = s.rightClickDisabled;
      if (s.previewVisible !== undefined) previewVisible = s.previewVisible;
      if (s.wordCountVisible !== undefined) wordCountVisible = s.wordCountVisible;
      if (s.mobileView !== undefined) mobileView = s.mobileView;

      
      if (s.readerMode !== undefined) readerMode = s.readerMode;
      if (s.outlineVisible !== undefined) outlineVisible = s.outlineVisible; // Added
    
      if (s.uiSize !== undefined) uiSize = s.uiSize; // Added    
      if (s.editorTextSize !== undefined) editorTextSize = s.editorTextSize;
      if (s.previewTextSize !== undefined) previewTextSize = s.previewTextSize;

      if (s.outlineFontSize !== undefined) outlineFontSize = s.outlineFontSize;
      
      if (s.readerPadding !== undefined) readerPadding = s.readerPadding;
      if (s.editorPadding !== undefined) editorPadding = s.editorPadding;
      if (s.editorFontType !== undefined) editorFontType = s.editorFontType;
      if (s.previewFontType !== undefined) previewFontType = s.previewFontType;
      if (s.uiLanguage !== undefined) {
                uiLanguage = s.uiLanguage;
                window.uiLanguage = s.uiLanguage; // Keep global translation engine in sync!
              }
      if (s.currentDateFormat !== undefined) window.currentDateFormat = s.currentDateFormat;

      if (s.filenameFormat !== undefined) window.filenameFormat = s.filenameFormat;      
      if (s.renderDelay !== undefined && typeof renderDelay !== 'undefined') renderDelay = s.renderDelay;
      if (s.savedEditorWidth !== undefined) {
        const w = String(s.savedEditorWidth);
        // Only accept pixel or percentage values; discard anything else
        if (/^\d+(\.\d+)?(px|%)$/.test(w)) window.savedEditorWidth = w;
      }
      if (s.savedSidebarWidth !== undefined) {
        const sw = String(s.savedSidebarWidth);
        if (/^\d+(\.\d+)?px$/.test(sw)) window.savedSidebarWidth = sw;
      }
    if (s.centerHeaders !== undefined) window.centerHeaders = s.centerHeaders;
    if (s.selectedBackground !== undefined) selectedBackground = s.selectedBackground;
    if (s.slowHardwareMode !== undefined) { slowHardwareMode = !!s.slowHardwareMode; window.slowHardwareMode = slowHardwareMode; }
    if (typeof s.backgroundOpacity === 'number' && s.backgroundOpacity > 0 && s.backgroundOpacity <= 1) {
      backgroundOpacity = s.backgroundOpacity;
    }
    if (s.livePreviewMode !== undefined) livePreviewMode = !!s.livePreviewMode;
    if (s.themeMode !== undefined) themeMode = s.themeMode;
    if (s.editorBgGradient !== undefined) editorBgGradient = s.editorBgGradient;
    }
  } catch (e) {}
}
loadEditorSettings();



// Update static HTML elements
window.applyDOMTranslations = function() {
  const updateTxt = (selector, enText) => {
    const el = document.querySelector(selector);
    if (el) el.textContent = window.t(enText);
  };
  
  const updateTitle = (selector, enText) => {
    const el = document.querySelector(selector);
    if (el) el.title = window.t(enText);
  };

  // Topbar & Panes
  updateTxt('#btn-file .btn-label-desktop', 'File ▾');
  updateTxt('#btn-file .btn-label-mobile', 'File');
  updateTxt('#btn-settings .btn-label-desktop', 'Settings ▾');
  updateTxt('#btn-settings .btn-label-mobile', 'Set.');
  updateTxt('#btn-toolbar .btn-label-desktop', 'Toolbar ▾');
  updateTxt('#btn-toolbar .btn-label-mobile', 'Tool.');
  updateTxt('#btn-reader-mode .btn-label-desktop', 'Reader Mode');
  updateTxt('#btn-exit-reader-mode', 'Exit Reader Mode');
  updateTxt('#btn-reader-outline', 'Outline');
  updateTxt('#btn-export .btn-label-desktop', 'Export .md');
  updateTxt('#btn-export .btn-label-mobile', 'Export');
  updateTxt('#editor-pane .pane-label', 'Markdown');
  updateTxt('#preview-pane .pane-label', 'Preview');
  // Target the title span only — the pane label also hosts the +/- font buttons.
  updateTxt('#outline-pane-title', 'Outline');
  updateTxt('#preview-empty span', 'Nothing here yet');
  
  updateTitle('#btn-logo', 'Harald Revery — Menu');

  // Placeholders
  const docTitle = document.getElementById('doc-title');
  if (docTitle) docTitle.placeholder = window.t('Untitled');
    const editor = document.getElementById('editor');
  if (editor) editor.placeholder = window.t('Start writing…');

  // --- Find bar placeholders and buttons ---------------------------------
  const findInput = document.getElementById('find-input');
  if (findInput) findInput.placeholder = window.t('Find…');
  const replaceInput = document.getElementById('replace-input');
  if (replaceInput) replaceInput.placeholder = window.t('Replace…');
  const replaceOneBtn = document.getElementById('find-replace-one');
  if (replaceOneBtn) replaceOneBtn.textContent = window.t('Replace');
  const replaceAllBtn = document.getElementById('find-replace-all');
  if (replaceAllBtn) replaceAllBtn.textContent = window.t('All');

  updateTitle('#find-case-btn', 'Match Case');
  updateTitle('#find-regex-btn', 'Regular Expression');
  updateTitle('#find-prev', 'Previous match (Shift+Enter)');
  updateTitle('#find-next', 'Next match (Enter)');
  updateTitle('#find-close', 'Close (Escape)');
  updateTitle('#find-replace-one', 'Replace current match (Enter)');
  updateTitle('#find-replace-all', 'Replace all matches');

// --- Toggle view button (initial label) --------------------------------
  const toggleViewBtn = document.getElementById('btn-toggle-view');
  if (toggleViewBtn) {
    const isEditor = document.body.getAttribute('data-view') === 'editor';
    toggleViewBtn.textContent = isEditor ? window.t('Preview') : window.t('Editor');
  }

  // --- Inject translations for CSS pseudo-elements (Code block copy buttons) ---
  document.documentElement.style.setProperty('--str-copy', `"${window.t('Copy')}"`);
  document.documentElement.style.setProperty('--str-copied', `"${window.t('Copied!')}"`);

  // --- Save As modal ------------------------------------------------------
  updateTxt('#save-as-modal .modal-content h3', 'Save As');
  const saveAsMsg = document.querySelector('#save-as-modal p');
  if (saveAsMsg) saveAsMsg.textContent = window.t('Enter filename (will be saved as .md):');
  const saveAsConfirm = document.getElementById('save-as-btn-confirm');
  if (saveAsConfirm) saveAsConfirm.textContent = window.t('Save');
  const saveAsCancel = document.getElementById('save-as-btn-cancel');
  if (saveAsCancel) saveAsCancel.textContent = window.t('Cancel');

  // --- Table modal --------------------------------------------------------
  const tableModalTitle = document.querySelector('#table-modal h3');
  if (tableModalTitle) tableModalTitle.textContent = window.t('Insert Table');
  const colsLabel = document.querySelector('#table-modal .table-modal-inputs label:first-child');
  if (colsLabel) colsLabel.childNodes[0].textContent = window.t('Columns');
  const rowsLabel = document.querySelector('#table-modal .table-modal-inputs label:last-child');
  if (rowsLabel) rowsLabel.childNodes[0].textContent = window.t('Rows');
  const insertBtn = document.getElementById('table-btn-insert');
  if (insertBtn) insertBtn.textContent = window.t('Insert');
  const cancelTableBtn = document.getElementById('table-btn-cancel');
  if (cancelTableBtn) cancelTableBtn.textContent = window.t('Cancel');

// New File modal
  updateTxt('#new-file-modal .modal-content h3', 'Unsaved Changes');
  updateTxt('#modal-btn-export', 'Export .md');
  updateTxt('#modal-btn-clear', 'Clear Editor');
  updateTxt('#modal-btn-cancel', 'Cancel');
  const modalMsg = document.getElementById('modal-msg');



  if (modalMsg) {
    if (typeof pendingFileAction !== 'undefined' && pendingFileAction === 'import') {
      modalMsg.textContent = window.t("Export your work using the \"Export .md\" button. Once the file is safely on your hard drive, click \"Clear Editor\" to proceed with the import.");
    } else {
      modalMsg.textContent = window.t("Export your work using the \"Export .md\" button. Once the file is safely on your hard drive, click \"Clear Editor\".");
    }
  }
 // Date picker modal
  updateTxt('#cal-btn-cancel', 'Cancel');

  updateTxt('#date-picker-modal .modal-content h3', 'Select Date');

  // Quit modal
  updateTxt('#quit-btn-save', 'Export & Continue');
  updateTxt('#quit-btn-nosave', 'Don\'t Export');
  updateTxt('#quit-btn-cancel', 'Cancel');
  updateTxt('#quit-btn-total-reset', 'Total Reset');
  updateTxt('#quit-btn-restart', 'Restart');
  updateTxt('#quit-btn-leave', 'Leave');
  const quitMsg = document.getElementById('quit-modal-msg');
  if (quitMsg) {
    if (window.isQuitting) {
      quitMsg.textContent = window.t("The editor engine has been safely shut down. What would you like to do next?");
    } else {
      quitMsg.textContent = window.t("Do you want to export your current work before quitting? Unsaved text will be lost.");
    }
  }

// About & User Guide modal close buttons
  updateTxt('#about-btn-close', 'Close');
  updateTxt('#legal-btn-close', 'Close');
  updateTxt('#user-guide-btn-close', 'Close');



  
// --- Legal modal (full HTML replacement) --------------------------------
const legalModalContent = document.querySelector('#legal-modal .modal-content > div');
if (legalModalContent) {
  const lang = window.uiLanguage || 'English';
  legalModalContent.innerHTML = window.uiTemplates.legal[lang] || window.uiTemplates.legal['English'];
}
const legalTitle = document.querySelector('#legal-modal .modal-content h3');
if (legalTitle) legalTitle.textContent = window.t('Legal');



  
// --- About modal (full HTML replacement) --------------------------------
const aboutModalContent = document.querySelector('#about-modal .modal-content > div');
if (aboutModalContent) {
  const lang = window.uiLanguage || 'English';
  // Use the pre‑defined template from uiTemplates.about
  aboutModalContent.innerHTML = window.uiTemplates.about[lang] || window.uiTemplates.about['English'];
}
// Translate the About modal title (keep brand name untranslated)
const aboutTitle = document.querySelector('#about-modal .modal-content h3');
if (aboutTitle) aboutTitle.textContent = 'Revery Notebook';

// --- User Guide modal (full HTML replacement) --------------------------
const guideModalContent = document.querySelector('#user-guide-modal .modal-content > div');
if (guideModalContent) {
  const lang = window.uiLanguage || 'English';
  // Use the pre‑defined template from uiTemplates.userGuide
  guideModalContent.innerHTML = window.uiTemplates.userGuide[lang] || window.uiTemplates.userGuide['English'];
}
// Translate the User Guide modal title
const guideTitle = document.querySelector('#user-guide-modal .modal-content h3');
if (guideTitle) guideTitle.textContent = window.t('User Guide');
// Refresh word counter to apply the new language


  updateTxt('#sidebar-folder-name', 'No folder open');
  const sidebarButtons = [
    { id: 'sidebar-projects-btn',   titleKey: 'Switch project…' },
    { id: 'sidebar-open-folder',    titleKey: 'Open folder…' },
    { id: 'sidebar-new-file',       titleKey: 'New .md file in root folder' },
    { id: 'sidebar-new-folder',     titleKey: 'New folder in root folder' },
    { id: 'sidebar-sort-btn',       titleKey: 'Sort files…' },
    { id: 'sidebar-card-smaller',   titleKey: 'Smaller cards' },
    { id: 'sidebar-card-larger',    titleKey: 'Larger cards' }
  ];
  sidebarButtons.forEach(({ id, titleKey }) => {
    const el = document.getElementById(id);
    if (el) el.title = window.t(titleKey);
  });


countWords();
};







/* Apply text size: scales the editor textarea and preview prose without
   touching any chrome/menu elements. The baseline values (1.22 / 1.07 /
   0.96 rem) match the defaults set in the :root <style> block.          */
function applyTextSize() {
  const editorScale = editorTextSize / 100;
  const previewScale = previewTextSize / 100;
  const uiScale = uiSize / 100;
  // Scale the CSS custom properties consumed by the prose renderer
  // (Divided by uiScale to counteract the root font-size change)
  document.documentElement.style.setProperty('--text-body',        ((1.22 * previewScale) / uiScale).toFixed(3) + 'rem');
  document.documentElement.style.setProperty('--text-body-mobile', ((1.07 * previewScale) / uiScale).toFixed(3) + 'rem');
  // Scale the editor textarea font directly (hardcoded 0.96rem baseline)
  document.getElementById('editor').style.fontSize = ((0.96 * editorScale) / uiScale).toFixed(3) + 'rem';
  // Keep headings and code-block sizes in sync with the new text scale.
  // These use hardcoded rem values in prose.css so they need the same
  // combined UI-compensation + text-scale treatment applied here.
  applyUiSizeProseCompensation();
}






/* Apply outline font size: scales only the outline panel items.
   Baseline is 0.76rem (set in --outline-font-size in the :root block).  */
function applyOutlineFontSize() {
  const scale = outlineFontSize / 100;
  const uiScale = uiSize / 100;
  document.documentElement.style.setProperty('--outline-font-size', ((0.76 * scale) / uiScale).toFixed(3) + 'rem');
}

/* Canonical setter — shared by the Settings submenu and the +/- buttons
   on the outline panel. Clamps to the submenu's own range, persists,
   and keeps the Settings checkmark in sync. Touches ONLY the outline
   font variable, nothing else in the UI. */
window.setOutlineFontSize = function (pct) {
  outlineFontSize = Math.max(70, Math.min(240, Math.round(pct / 10) * 10));
  applyOutlineFontSize();
  if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
  if (typeof buildSettingsMenu === 'function') buildSettingsMenu();
};
window.getOutlineFontSize = function () { return outlineFontSize; };

/* The +/- buttons on the outline panel header. */
(function initOutlineSizeButtons() {
  const plus  = document.getElementById('outline-font-plus');
  const minus = document.getElementById('outline-font-minus');
  if (plus)  plus.addEventListener('click',  (e) => { e.stopPropagation(); window.setOutlineFontSize(outlineFontSize + 10); });
  if (minus) minus.addEventListener('click', (e) => { e.stopPropagation(); window.setOutlineFontSize(outlineFontSize - 10); });
})();

/* Apply UI size: injects a <style> override that counteracts the root
   font-size change for prose headings, which use hardcoded rem values in
   prose.css (h1=3rem, h2=1.875rem) and the prose-lg base (1.125rem) that
   drives h3/h4 via em. Without this, UI menu size bleeds into the preview.
   The outline items are already covered by --outline-font-size above, and
   prose p/li are already covered by --text-body/--text-body-mobile.
   textSize is also factored in here because these elements use hardcoded
   rem values that bypass --text-body, so this is the single place where
   both the UI-bleed compensation and the text scale are applied together. */
function applyUiSizeProseCompensation() {
  let styleEl = document.getElementById('ui-scale-prose-fix');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'ui-scale-prose-fix';
    document.head.appendChild(styleEl);
  }
  const inv    = (1 / (uiSize / 100)).toFixed(4);
  const tScale = (previewTextSize / 100).toFixed(4);
  /* .lp-render is the live preview's rendered-block scope: it must get
     the exact same compensation or its headings drift from the preview. */
  styleEl.textContent = [
    `:is(#preview, .lp-render) .prose h1       { font-size: calc(3rem      * ${inv} * ${tScale}); }`,
    `:is(#preview, .lp-render) .prose h2       { font-size: calc(1.875rem  * ${inv} * ${tScale}); }`,
    `:is(#preview, .lp-render) .prose.prose-lg { font-size: calc(1.125rem  * ${inv} * ${tScale}); }`
  ].join('\n');
}

/* Apply reader mode padding: constrains the prose content width so text
   doesn't stretch edge-to-edge on large monitors in reader mode.
   Uses a CSS custom property (--reader-max-width) defined in :root.     */
function applyReaderPadding() {
  const map = {
    'default': 'none',
    '90': '90vw',
    '80': '80vw',
    '70': '70vw',
    '60': '60vw',
    '50': '50vw',
    '40': '40vw',
    '30': '30vw',
    '25': '25vw',
    '20': '20vw',
    '15': '15vw',
    '10': '10vw'
  };
  
  const val = map[readerPadding] || 'none';
  document.documentElement.style.setProperty('--reader-max-width', val);
}
applyReaderPadding(); // Apply the 50% default on load


function applyEditorPadding() {
  const map = {
    'default': '24px 28px',
    '95%': '24px 2.5%',
    '90%': '24px 5%',
    '85%': '24px 7.5%',
    '80%': '24px 10%',
    '75%': '24px 12.5%',
    '70%': '24px 15%',
    '60%': '24px 20%',
    '50%': '24px 25%',
    '40%': '24px 30%',
    '30%': '24px 35%',
    '25%': '24px 40%',
    '20%': '24px 42%',
    '15%': '24px 45%'
  };
  const mapMobile = {
    'default': '24px 20px 40vh',
    '95%': '24px 2.5% 40vh',
    '90%': '24px 5% 40vh',
    '85%': '24px 7.5% 40vh',
    '80%': '24px 10% 40vh',
    '75%': '24px 12.5% 40vh',
    '70%': '24px 15% 40vh',
    '60%': '24px 20% 40vh',
    '50%': '24px 25% 40vh',
    '40%': '24px 30% 40vh',
    '30%': '24px 35% 40vh',
    '25%': '24px 25% 40vh',
    '20%': '24px 20% 40vh',
    '15%': '24px 15% 40vh'
  };
  const val = map[editorPadding] || '24px 28px';
  const valMobile = mapMobile[editorPadding] || '24px 20px 40vh';
  document.documentElement.style.setProperty('--editor-padding', val);
  document.documentElement.style.setProperty('--editor-padding-mobile', valMobile);
}
applyEditorPadding();



/* Apply background image to the preview area via CSS variable.
   Slow hardware mode suppresses the image (large JPEG decode + composite)
   without touching the user's selectedBackground choice — turning the mode
   off restores their background.                                          */
function applyBackground() {
  if (slowHardwareMode) {
    document.documentElement.style.removeProperty('--preview-bg-image');
    return;
  }
  if (selectedBackground === 'custom') {
    let dataUrl = null;
    try { dataUrl = localStorage.getItem(CUSTOM_BG_KEY); } catch (_) {}
    if (dataUrl) {
      document.documentElement.style.setProperty('--preview-bg-image', `url("${dataUrl}")`);
    } else {
      /* The stored image is gone (storage cleared) — fall back to none. */
      document.documentElement.style.removeProperty('--preview-bg-image');
    }
    return;
  }
  const opt = BACKGROUND_OPTIONS.find(o => o.val === selectedBackground);
  if (!opt || opt.val === 'none') {
    document.documentElement.style.removeProperty('--preview-bg-image');
  } else {
    document.documentElement.style.setProperty('--preview-bg-image', `url('${opt.url}')`);
  }
}

/* ── Background opacity ────────────────────────────────────────────────
   The stylesheet simulates image opacity per theme with an overlay
   gradient driven by --bg_oacity (the historical variable name is
   missing its 'p' — kept for compatibility with all existing CSS).
   Only override when the user picked a value; otherwise each theme's
   own subtle default applies, so existing setups look unchanged.      */
window.setBackgroundOpacity = function (v) {
  backgroundOpacity = (typeof v === 'number' && v > 0 && v <= 1) ? v : null;
  if (backgroundOpacity !== null) {
    document.documentElement.style.setProperty('--bg_oacity', String(backgroundOpacity));
  } else {
    document.documentElement.style.removeProperty('--bg_oacity');
  }
  if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
};

/* ── Custom background import ──────────────────────────────────────────
   The imported image is stored as a data: URL in localStorage — never
   the filesystem — so it behaves identically in web, Electron and Tauri
   and cannot interact with any file-safety code path. The picker
   downscales through a canvas so the stored string stays small.       */
window.applyCustomBackgroundImage = function (dataUrl) {
  try {
    localStorage.setItem(CUSTOM_BG_KEY, dataUrl);
  } catch (e) {
    if (typeof window.showStatusWarning === 'function') {
      window.showStatusWarning('storage-full',
        'Storage full! The image is too large to keep as a background.',
        { priority: 100, ttl: 5000 });
    }
    return false;
  }
  selectedBackground = 'custom';
  applyBackground();
  if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
  return true;
};

window.removeCustomBackgroundImage = function () {
  try { localStorage.removeItem(CUSTOM_BG_KEY); } catch (_) {}
  if (selectedBackground === 'custom') selectedBackground = 'bg_6';
  applyBackground();
  if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
};

function importCustomBackgroundFile(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) return;
  /* Read via FileReader into a data: URL — NOT URL.createObjectURL. The
     img-src CSP (both wrappers and the web deploy) allows data: but not
     blob:, so a blob-URL image silently fails to decode. That was the
     bug in the first version of this feature.                          */
  const reader = new FileReader();
  reader.onerror = () => console.warn('[Background] Could not read the chosen file.');
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const MAX_DIM = 2560; // plenty for a behind-text background
      const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const w = Math.max(1, Math.round((img.naturalWidth  || 1) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      let dataUrl;
      try {
        dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      } catch (e) {
        console.warn('[Background] Could not re-encode the image:', e);
        return;
      }
      if (window.applyCustomBackgroundImage(dataUrl)) {
        /* The per-theme default overlay leaves the image at ~3%
           visibility — right for the built-in textures, invisible for a
           photo the user just imported. Give a clearly visible starting
           point; the Background opacity submenu tunes it from there.  */
        if (backgroundOpacity === null) window.setBackgroundOpacity(0.35);
        buildSettingsMenu();
      }
    };
    img.onerror = () => console.warn('[Background] Could not decode the chosen image.');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* ── Slow hardware mode ────────────────────────────────────────────────
   One switch for older machines (slow HDD, low RAM, weak CPU/GPU). It
   only reduces work FREQUENCY and visual load — every disk write keeps
   the exact same atomic-write + fsync durability guarantees. Effects:
     • sidebar auto-save debounce 1.5s→4s, forced save 10s→20s
     • crash-backup debounce 2s→5s, forced backup 15s→30s (native_api)
       (worst case lost typing on a hard crash grows from ~2s to ~5s)
     • preview render delay floored at 400 ms (user setting untouched)
     • background image disabled (solid color)
     • file-card text previews and image thumbnails skipped
     • tree renders in smaller chunks so slow CPUs stay responsive
   Everything reads window.slowHardwareMode at call time, so toggling
   takes effect immediately — no restart needed.                        */
window.setSlowHardwareMode = function (on) {
  slowHardwareMode = !!on;
  window.slowHardwareMode = slowHardwareMode;
  document.body.classList.toggle('slow-hw-active', slowHardwareMode);
  applyBackground();
  if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
};

/* ── Live Preview (experimental) ───────────────────────────────────────
   Obsidian-style: formatting renders inside the editor and the side
   preview pane hides (CSS body class — the user's own previewVisible
   choice is untouched underneath and returns on toggle-off). The editor
   extension is installed through the cm_setup compartment; decorations
   are display-only, so the document text, saving and undo are never
   affected. See LIVE_PREVIEW_DESIGN.md.                                */
window.setLivePreviewMode = function (on) {
  livePreviewMode = !!on;
  window.livePreviewMode = livePreviewMode;
  document.body.classList.toggle('live-preview-active', livePreviewMode);
  if (typeof window.setLivePreviewExtension === 'function') {
    window.setLivePreviewExtension(
      (livePreviewMode && typeof window.buildLivePreviewExtension === 'function')
        ? window.buildLivePreviewExtension()
        : []
    );
  }
  if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
};

/* Apply Custom Font Types via CSS Variables */

/* Apply Custom Font Types via CSS Variables */
function applyFontTypes() {
  const fontMap = {
    'harald': '', // Handled by CSS variable fallback
    'sans': 'ui-sans-serif, system-ui, sans-serif',
    'serif': 'ui-serif, Georgia, serif',
    'mono': 'ui-monospace, "Courier New", monospace',
    'arial': 'Arial, Helvetica, sans-serif',
    'times': '"Times New Roman", Times, serif',
    'courier': '"Courier New", Courier, monospace'
  };

  if (editorFontType !== 'harald' && fontMap[editorFontType]) {
    document.documentElement.style.setProperty('--editor-font', fontMap[editorFontType]);
  } else {
    document.documentElement.style.removeProperty('--editor-font');
  }

  if (previewFontType !== 'harald' && fontMap[previewFontType]) {
    document.documentElement.style.setProperty('--preview-font', fontMap[previewFontType]);
    document.documentElement.style.setProperty('--preview-letter-spacing', 'normal');
    document.documentElement.style.setProperty('--katex-font-size', '1em');
  } else {
    document.documentElement.style.removeProperty('--preview-font');
    document.documentElement.style.removeProperty('--preview-letter-spacing');
    document.documentElement.style.setProperty('--katex-font-size', '0.7em');
  }

  const outlineFontFamily = (previewFontType !== 'harald' && fontMap[previewFontType]) 
    ? fontMap[previewFontType] 
    : '';
  
  if (outlineFontFamily) {
    document.documentElement.style.setProperty('--outline-font', outlineFontFamily);
  } else {
    document.documentElement.style.removeProperty('--outline-font');
  }
}

/* Apply editor background: gradient (default) or solid (uses --editor-bg-start) */
function applyEditorBgStyle() {
  if (editorBgGradient) {
    document.documentElement.classList.remove('editor-bg-solid');
  } else {
    document.documentElement.classList.add('editor-bg-solid');
  }
}

/* Apply heading centering via class toggle */
function applyCenterHeaders() {
  if (window.centerHeaders) {
    document.body.classList.add('center-headers-active');
  } else {
    document.body.classList.remove('center-headers-active');
  }
}


/* ── Apply initial loaded styling and visual states ── */
document.documentElement.style.fontSize = uiSize + '%';
applyTextSize();
applyOutlineFontSize();
applyUiSizeProseCompensation();
applyFontTypes(); // Execute font assignment on boot
applyCenterHeaders(); // <-- ADD THIS LINE to apply the saved setting on page load
applyBackground();
applyEditorBgStyle();
if (backgroundOpacity !== null) {
  document.documentElement.style.setProperty('--bg_oacity', String(backgroundOpacity));
}
window.setSlowHardwareMode(slowHardwareMode); // sync body class + bg suppression on boot
window.setLivePreviewMode(livePreviewMode);   // install editor extension + hide pane if saved on

function applyLoadedStates() {
  // Apply visibility to preview and editor panes based on saved state
  prPane.style.display = previewVisible ? '' : 'none';
  divider.style.display = (previewVisible && !readerMode) ? '' : 'none';
  
  if (!readerMode) {
    if (previewVisible) {
      edPane.style.width = window.savedEditorWidth || '33.33%';
      edPane.style.flex = 'none';
    } else {
      edPane.style.width = '100%';
      edPane.style.flex = '1';
    }
  }

  // Restore mobile view frame
  prPane.classList.toggle('mobile-preview', mobileView);

  // Restore reader mode
  document.body.classList.toggle('reader-mode-active', readerMode);
  if (readerMode) {
    edPane.style.display = 'none';
    divider.style.display = 'none';
    prPane.style.display = '';
  }

// Restore outline visibility
  const outlinePane = document.getElementById('outline-pane');
  const outlineDivider = document.getElementById('outline-divider');
  if (outlinePane) outlinePane.style.display = outlineVisible ? '' : 'none';
  if (outlineDivider) outlineDivider.style.display = outlineVisible ? '' : 'none';
  if (outlineVisible && typeof renderOutline === 'function') {
    renderOutline();
  }
  
  applyWordCountVisibility();
  
  window.applyDOMTranslations(); // Apply saved language to DOM on boot
}

/* Apply Word Counter visibility */
function applyWordCountVisibility() {
  const wc = document.getElementById('wordcount');
  if (wc) wc.style.display = wordCountVisible ? 'inline-block' : 'none';
}

applyLoadedStates();


/* ── smartPositionDropdown ────────────────────────────────────────────────
   Called each time a top-level dropdown is opened. Checks whether the menu
   overflows the bottom of the viewport and corrects it in two steps:
     1. Shift the menu upward (adjusting its `top` relative to its offset
        parent) until it fits — this preserves submenu flyout behaviour.
     2. If there still isn't enough room (the menu is taller than the usable
        viewport height), cap the height and enable scrolling as a fallback.
   All overrides are cleared at the start of each call so repeated opens
   always start from a clean slate.                                       */
function smartPositionDropdown(el) {
  if (!el.classList.contains('show')) return;

  // ── Skip repositioning for the logo dropdown ──
  if (el.id === 'logo-dropdown') return;

  // Clear any previously applied dynamic overrides
  el.style.removeProperty('top');
  el.style.removeProperty('max-height');
  el.style.removeProperty('overflow-y');
  el.style.removeProperty('left');   // Clean up horizontal overrides
  el.style.removeProperty('right');  // Clean up horizontal overrides
  el.style.removeProperty('width');  // Clean up horizontal overrides

  // ── Mobile branch: force scrollable menu with max-height ──
  if (window.innerWidth <= 820) {
    // Grab full bounding rect to get the parent's X position
    const parentRect = el.offsetParent ? el.offsetParent.getBoundingClientRect() : { top: 0, left: 0 };
    const TOPBAR = 94;
    const MARGIN = 62;
    const availH = window.innerHeight - TOPBAR - MARGIN;
    
    el.style.maxHeight = Math.max(availH, 120) + 'px';
    el.style.overflowY = 'auto';
    
    // Vertically shift the dropdown below the topbar
    el.style.top = (TOPBAR - parentRect.top) + 'px';

    // --- Fix horizontal squishing ---
    // Offset negatively to reach the screen's left edge, then add the 16px margin
    el.style.left = (MARGIN - parentRect.left) + 'px';
    
    // Force explicit width to span viewport minus margins (32px total)
    el.style.width = (window.innerWidth - (MARGIN * 2)) + 'px';
    el.style.right = 'auto';

    return;
  }


  const rect   = el.getBoundingClientRect();
  const vpH    = window.innerHeight;
  const MARGIN = 8;
  const TOPBAR = 44;

  if (rect.bottom <= vpH - MARGIN) return;

  const naturalH    = el.scrollHeight;
  const parentTop   = el.offsetParent ? el.offsetParent.getBoundingClientRect().top : 0;
  const currentTopLocal = parseFloat(el.style.top) || 38;
  const idealTopInVP    = vpH - naturalH - MARGIN;
  const idealTopLocal   = idealTopInVP - parentTop;
  const clampedTopLocal = Math.max(TOPBAR - parentTop, idealTopLocal);

  if (idealTopInVP >= TOPBAR) {
    el.style.top = clampedTopLocal + 'px';
    return;
  }

  el.style.top = (TOPBAR - parentTop) + 'px';
  const availH = vpH - TOPBAR - MARGIN;
  el.style.maxHeight = Math.max(availH, 120) + 'px';
  el.style.overflowY = 'auto';
}




/* ── positionSubmenuVertically ───────────────────────────────────────────
   Called right after a submenu becomes visible. Shifts it upward if its
   bottom edge would fall below the viewport. Falls back to a capped +
   scrollable height when the submenu is taller than the available space.  */
function positionSubmenuVertically(sub, initialTop) {
  // Reset previously applied dynamic overrides
  sub.style.removeProperty('max-height');
  sub.style.removeProperty('overflow-y');

  // Set the initial vertical position using fixed coordinates
  sub.style.top = initialTop + 'px';

  const subRect = sub.getBoundingClientRect();
  const vpH     = window.innerHeight;
  const MARGIN  = 8;
  const TOPBAR  = 44;

  if (subRect.bottom <= vpH - MARGIN) return; // fits — nothing to do

  // How much to shift upward (in px)
  const overflow   = subRect.bottom - (vpH - MARGIN);
  const newTop     = initialTop - overflow;
  sub.style.top    = newTop + 'px';

  // Check whether shifting caused the top to go above the topbar
  const shiftedRect = sub.getBoundingClientRect();
  if (shiftedRect.top < TOPBAR + MARGIN) {
    // Still doesn't fit — clamp and enable scrolling
    sub.style.top    = (TOPBAR + MARGIN) + 'px';
    sub.style.maxHeight  = (vpH - TOPBAR - 2 * MARGIN) + 'px';
    sub.style.overflowY  = 'auto';
  }
}

/* ── attachSubmenuHandlers ────────────────────────────────────────────────
   Attaches open/close logic to a submenu wrapper for both desktop (hover)
   and mobile/touch (tap).  Extracted from the repeated inline blocks so
   every submenu gets identical, correct behaviour everywhere.

   On touch: prevents ghost mouse events, collapses any other open submenu,
   and repositions the submenu to stay within the viewport edge.          */
function attachSubmenuHandlers(wrapper, sub) {
  let hideTimer;

  /* Shared helper: show the submenu and fix both horizontal and vertical
     overflow in one place, used by both mouseenter and click handlers.   */
  function showSubAndFix() {
    sub.style.display = 'flex';
    sub.style.flexDirection = 'column';

    // ── Mobile layout bailout ──
    // On narrow screens, CSS handles submenus as relative accordions.
    if (window.innerWidth <= 820) {
      sub.style.removeProperty('position');
      sub.style.removeProperty('left');
      sub.style.removeProperty('right');
      sub.style.removeProperty('top');
      return;
    }

    // ── Desktop: Break out of scrolling parent ──
    sub.style.position = 'fixed';

    // ── Horizontal overflow ──
    const wrapRect = wrapper.getBoundingClientRect();
    const subWidth = sub.offsetWidth || 160;
    
    if (wrapRect.right + subWidth > window.innerWidth) {
      sub.style.left = 'auto';
      sub.style.right = (window.innerWidth - wrapRect.left) + 'px';
    } else {
      sub.style.left = wrapRect.right + 'px';
      sub.style.right = 'auto';
    }

    // ── Vertical overflow ──
    // Pass the ideal top position (aligned with the wrapper)
    positionSubmenuVertically(sub, wrapRect.top - 1);
  }

  /* Shared helper: hide and reset all dynamic positioning so the next open
     starts from a clean slate.                                           */
  function hideSub() {
    sub.style.display = 'none';
    sub.style.removeProperty('top');
    sub.style.removeProperty('left');
    sub.style.removeProperty('right');
    sub.style.removeProperty('position');
    sub.style.removeProperty('max-height');
    sub.style.removeProperty('overflow-y');
  }

  // ── Desktop: hover to reveal ──
  wrapper.addEventListener('mouseenter', () => {
    clearTimeout(hideTimer);
    showSubAndFix();
  });
  wrapper.addEventListener('mouseleave', () => {
    hideTimer = setTimeout(hideSub, 80);
  });
  sub.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  sub.addEventListener('mouseleave', () => {
    hideTimer = setTimeout(hideSub, 80);
  });

  // ── Mobile/touch: tap to toggle ──
  wrapper.addEventListener('click', (e) => {
    // Allow clicks inside the submenu to register and fire their actions
    if (e.target.closest('.submenu')) return;

    e.stopPropagation(); // Prevent the document click listener from immediately closing the main menu
    const isOpen = sub.style.display === 'flex';
    // Collapse any other open submenus first so only one is visible at a time
    document.querySelectorAll('.submenu').forEach(s => {
      if (s !== sub) {
        s.style.display = 'none';
        s.style.removeProperty('top');
        s.style.removeProperty('left');
        s.style.removeProperty('right');
        s.style.removeProperty('position');
        s.style.removeProperty('max-height');
        s.style.removeProperty('overflow-y');
      }
    });
    if (isOpen) {
      hideSub();
    } else {
      showSubAndFix();
    }
  });
}




// ── File Menu Definition ───────────────────────────────────────────────────
const fileActions = [
  { label: 'New File', action: 'file_new' },
  { label: 'Import File', action: 'file_import' },
  { type: 'submenu', label: 'Import Template ▸', items: typeof mdTemplates !== 'undefined' ? mdTemplates : [] },
  { type: 'divider' },
  { label: 'Save as...', action: 'file_save_as' },
  { label: 'Export as .md', action: 'file_export_md' },
  { label: 'Export as .txt', action: 'file_export_txt' },
  { label: 'Export as .html', action: 'file_export_html' },
  { label: 'Export as .pdf', action: 'file_export_pdf' },
  { label: 'LaTeX project (.zip)', action: 'file_export_tex' },
  { type: 'divider', desktopOnly: true },
  /* Whole-project zip export — desktop only (web mode has no project). */
  { label: 'Zip Project Export', action: 'file_zip_export', desktopOnly: true }
];
/* Populate Menus — supports submenus */
function buildMenu(container, actions) {
  actions.forEach(item => {
    /* Entries that need a native backend are omitted in web mode
       (native_api.js loads in <head>, so isDesktop is settled here). */
    if (item.desktopOnly && !(window.NativeAPI && window.NativeAPI.isDesktop)) return;
    if (item.type === 'divider') {
      const div = document.createElement('div');
      div.className = 'menu-divider';
      container.appendChild(div);
    } else if (item.type === 'submenu') {
      const wrapper = document.createElement('div');
      wrapper.className = 'menu-item has-submenu';

      const labelSpan = document.createElement('span');
      labelSpan.textContent = window.t(item.label);
      wrapper.appendChild(labelSpan);

      const sub = document.createElement('div');
      sub.className = 'submenu';
      sub.style.display = 'none';

      item.items.forEach(subItem => {
        const subBtn = document.createElement('button');
        subBtn.className = 'menu-item';
        subBtn.textContent = window.t(subItem.label);
        subBtn.onclick = (e) => {
          e.stopPropagation();
          insertWithUndo(0, 0, subItem.content);
          render();
          container.classList.remove('show');
        };
        sub.appendChild(subBtn);
      });

      wrapper.appendChild(sub);
      attachSubmenuHandlers(wrapper, sub);
      container.appendChild(wrapper);
    } else {
      const btn = document.createElement('button');
      btn.className = 'menu-item';
      btn.textContent = window.t(item.label);
      btn.onclick = (e) => { e.stopPropagation(); executeAction(item.action); container.classList.remove('show'); };
      container.appendChild(btn);
    }
  });
}

buildMenu(fileDropdown, fileActions);
buildMenu(toolbarDropdown, menuActions);
buildMenu(contextMenu, [...menuActions, ...contextMenuExtra]);




function buildSettingsMenu() {
  settingsDropdown.innerHTML = '';

// ── Toggle Preview item
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'menu-item';
  const check = document.createElement('span');
  check.className = 'menu-item-check';
  check.textContent = previewVisible ? '■' : '□';
  toggleBtn.appendChild(check);
  toggleBtn.appendChild(document.createTextNode(window.t('Show Preview')));
  toggleBtn.onclick = (e) => {
    e.stopPropagation();
    togglePreview();
    settingsDropdown.classList.remove('show');
  };
  settingsDropdown.appendChild(toggleBtn);

// ── Toggle Word Counter item
  const wcBtn = document.createElement('button');
  wcBtn.className = 'menu-item';
  const wcCheck = document.createElement('span');
  wcCheck.className = 'menu-item-check';
  wcCheck.textContent = wordCountVisible ? '■' : '□';
  wcBtn.appendChild(wcCheck);
  wcBtn.appendChild(document.createTextNode(window.t('Show Word Counter')));
  wcBtn.onclick = (e) => {
    e.stopPropagation();
    wordCountVisible = !wordCountVisible;
    settingsDropdown.classList.remove('show');
    buildSettingsMenu();
    applyWordCountVisibility();
    if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
  };
  settingsDropdown.appendChild(wcBtn);


// ── Toggle Line Numbers item
  const lnBtn = document.createElement('button');
  lnBtn.className = 'menu-item';
  const lnCheck = document.createElement('span');
  lnCheck.className = 'menu-item-check';
  lnCheck.textContent = lineNumbersVisible ? '■' : '□';
  lnBtn.appendChild(lnCheck);
  lnBtn.appendChild(document.createTextNode(window.t('Show Line Numbers')));
  lnBtn.onclick = (e) => {
    e.stopPropagation();
    lineNumbersVisible = !lineNumbersVisible;
    if (typeof window.setLineNumbersVisible === 'function') {
      window.setLineNumbersVisible(lineNumbersVisible);
    }
    settingsDropdown.classList.remove('show');
    buildSettingsMenu();
    if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
  };
  settingsDropdown.appendChild(lnBtn);


// ── Desktop-only toggles (hidden on real mobile screens)
  if (window.innerWidth > 820) {
    // ── Outline Navigation toggle
    const outlineBtn = document.createElement('button');
    outlineBtn.className = 'menu-item';
    const outlineCheck = document.createElement('span');
    outlineCheck.className = 'menu-item-check';
    outlineCheck.textContent = outlineVisible ? '■' : '□';
    outlineBtn.appendChild(outlineCheck);
    outlineBtn.appendChild(document.createTextNode(window.t('Show Outline')));
    outlineBtn.onclick = (e) => {
      e.stopPropagation();
      toggleOutline();
      settingsDropdown.classList.remove('show');
    };
    settingsDropdown.appendChild(outlineBtn);

    // ── Mobile View toggle
    const mobileBtn = document.createElement('button');
    mobileBtn.className = 'menu-item';
    const mobileCheck = document.createElement('span');
    mobileCheck.className = 'menu-item-check';
    mobileCheck.textContent = mobileView ? '■' : '□';
    mobileBtn.appendChild(mobileCheck);
    mobileBtn.appendChild(document.createTextNode(window.t('Mobile View')));
    mobileBtn.onclick = (e) => {
      e.stopPropagation();
      toggleMobileView();
      settingsDropdown.classList.remove('show');
    };
    settingsDropdown.appendChild(mobileBtn);
  }

// ── Reader Padding submenu (controls prose max-width in reader / preview mode)
const readerPaddingOptions = [
  { label: '100%',     val: 'default' },
  { label: '90%',      val: '90' },
  { label: '80%',      val: '80' },
  { label: '70%',      val: '70' },
  { label: '60%',      val: '60' },
  { label: '50%',      val: '50' },
  { label: '40%',      val: '40' },
  { label: '30%',      val: '30' },
  { label: '25%',      val: '25' },
  { label: '20%',      val: '20' },
  { label: '15%',      val: '15' },
  { label: '10%',      val: '10' }
];
  const readerPadWrapper = document.createElement('div');
  readerPadWrapper.className = 'menu-item has-submenu';

  const readerPadLabel = document.createElement('span');
  readerPadLabel.textContent = window.t('Reader padding ▸');
  readerPadWrapper.appendChild(readerPadLabel);

  const readerPadSub = document.createElement('div');
  readerPadSub.className = 'submenu';
  readerPadSub.style.display = 'none';

  readerPaddingOptions.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = (readerPadding === opt.val ? '■ ' : '\u00a0\u00a0') + opt.label;
    btn.onclick = (e) => {
      e.stopPropagation();
      readerPadding = opt.val;
      applyReaderPadding();
      settingsDropdown.classList.remove('show');
      buildSettingsMenu();
    };
    readerPadSub.appendChild(btn);
  });

  readerPadWrapper.appendChild(readerPadSub);
  attachSubmenuHandlers(readerPadWrapper, readerPadSub);
  settingsDropdown.appendChild(readerPadWrapper);

// ── Editor Padding submenu
const editorPaddingOptions = [
  { label: '100%',  val: 'default' },
  { label: '95%',      val: '95%' },
  { label: '90%',      val: '90%' },
  { label: '85%',      val: '85%' },
  { label: '80%',      val: '80%' },
  { label: '75%',      val: '75%' },
  { label: '70%',      val: '70%' },
  { label: '60%',      val: '60%' },
  { label: '50%',      val: '50%' },
  { label: '40%',      val: '40%' },
  { label: '30%',      val: '30%' },
  { label: '25%',      val: '25%' },
  { label: '20%',      val: '20%' },
  { label: '15%',      val: '15%' }
];




  const editorPadWrapper = document.createElement('div');
  editorPadWrapper.className = 'menu-item has-submenu';

  const editorPadLabel = document.createElement('span');
  editorPadLabel.textContent = window.t('Editor padding ▸');
  editorPadWrapper.appendChild(editorPadLabel);

  const editorPadSub = document.createElement('div');
  editorPadSub.className = 'submenu';
  editorPadSub.style.display = 'none';

  editorPaddingOptions.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = (editorPadding === opt.val ? '■ ' : '\u00a0\u00a0') + window.t(opt.label);
    btn.onclick = (e) => {
      e.stopPropagation();
      editorPadding = opt.val;
      applyEditorPadding();
      settingsDropdown.classList.remove('show');
      buildSettingsMenu();
      if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
    };
    editorPadSub.appendChild(btn);
  });

  editorPadWrapper.appendChild(editorPadSub);
  attachSubmenuHandlers(editorPadWrapper, editorPadSub);
  settingsDropdown.appendChild(editorPadWrapper);

  // ── Calendar Format Submenu
  const formatOptions = [
    { label: 'YYYY-MM-DD', val: 'YYYY-MM-DD' },
    { label: 'DD/MM/YYYY', val: 'DD/MM/YYYY' },
    { label: 'MM/DD/YYYY', val: 'MM/DD/YYYY' },
    { label: 'Long Date',  val: 'Long Date' }
  ];
  
  const formatWrapper = document.createElement('div');
  formatWrapper.className = 'menu-item has-submenu';

  const formatLabel = document.createElement('span');
  formatLabel.textContent = window.t('Calendar format ▸');
  formatWrapper.appendChild(formatLabel);

  const formatSub = document.createElement('div');
  formatSub.className = 'submenu';
  formatSub.style.display = 'none';

  formatOptions.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = (window.currentDateFormat === opt.val ? '■ ' : '\u00a0\u00a0') + window.t(opt.label);
    btn.onclick = (e) => {
      e.stopPropagation();
      window.currentDateFormat = opt.val;
      settingsDropdown.classList.remove('show');
      buildSettingsMenu();
    };
    formatSub.appendChild(btn);
  });

  formatWrapper.appendChild(formatSub);
  attachSubmenuHandlers(formatWrapper, formatSub);
  settingsDropdown.appendChild(formatWrapper);

  // ── Filename Format Submenu
  const filenameFormatOptions = [
    { label: 'None  —  Title.md',                         val: 'none'           },
    { label: 'Date suffix  —  Title_YYYY-MM-DD',          val: 'suffix_date'    },
    { label: 'Datetime suffix  —  Title_YYYY-MM-DD_HH-MM-SS', val: 'suffix_datetime' },
    { label: 'Time suffix  —  Title_HH-MM-SS',            val: 'suffix_time'    },
    { label: 'Date prefix  —  YYYY-MM-DD_Title',          val: 'prefix_date'    },
    { label: 'Compact prefix  —  YYYYMMDD_Title',         val: 'prefix_compact' }
  ];

  const fnFmtWrapper = document.createElement('div');
  fnFmtWrapper.className = 'menu-item has-submenu';

  const fnFmtLabel = document.createElement('span');
  fnFmtLabel.textContent = window.t('Filename format ▸');
  fnFmtWrapper.appendChild(fnFmtLabel);

  const fnFmtSub = document.createElement('div');
  fnFmtSub.className = 'submenu';
  fnFmtSub.style.display = 'none';

  filenameFormatOptions.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = (window.filenameFormat === opt.val ? '■ ' : '\u00a0\u00a0') + window.t(opt.label);
    btn.onclick = (e) => {
      e.stopPropagation();
      window.filenameFormat = opt.val;
      settingsDropdown.classList.remove('show');
      buildSettingsMenu();
    };
    fnFmtSub.appendChild(btn);
  });

  fnFmtWrapper.appendChild(fnFmtSub);
  attachSubmenuHandlers(fnFmtWrapper, fnFmtSub);
  settingsDropdown.appendChild(fnFmtWrapper);

  // ── Text Size submenu
  const sizeOptions = [70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 290];

  // ── Editor Text Size submenu
  const editorSizeWrapper = document.createElement('div');
  editorSizeWrapper.className = 'menu-item has-submenu';

  const editorSizeLabel = document.createElement('span');
  editorSizeLabel.textContent = window.t('Editor text size ▸');
  editorSizeWrapper.appendChild(editorSizeLabel);

  const editorSizeSub = document.createElement('div');
  editorSizeSub.className = 'submenu';
  editorSizeSub.style.display = 'none';

  sizeOptions.forEach(pct => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = (editorTextSize === pct ? '■ ' : '\u00a0\u00a0') + pct + '%';
    btn.onclick = (e) => {
      e.stopPropagation();
      editorTextSize = pct;
      applyTextSize();
      settingsDropdown.classList.remove('show');
      buildSettingsMenu();
    };
    editorSizeSub.appendChild(btn);
  });

  editorSizeWrapper.appendChild(editorSizeSub);
  attachSubmenuHandlers(editorSizeWrapper, editorSizeSub);
  settingsDropdown.appendChild(editorSizeWrapper);

  // ── Editor Font Type Submenu
  const fontTypeOptions = [
    { label: 'Harald Revery Font', val: 'harald' }, 
    { label: 'System Sans-Serif',  val: 'sans' },
    { label: 'System Serif',       val: 'serif' },
    { label: 'System Monospace',   val: 'mono' },
    { label: 'Arial',              val: 'arial' },
    { label: 'Times New Roman',    val: 'times' },
    { label: 'Courier New',        val: 'courier' }
  ];

  const editorFontWrapper = document.createElement('div');
  editorFontWrapper.className = 'menu-item has-submenu';
  
  const editorFontLabel = document.createElement('span');
  editorFontLabel.textContent = window.t('Editor font type ▸');
  editorFontWrapper.appendChild(editorFontLabel);

  const editorFontSub = document.createElement('div');
  editorFontSub.className = 'submenu';
  editorFontSub.style.display = 'none';

 fontTypeOptions.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = (editorFontType === opt.val ? '■ ' : '\u00a0\u00a0') + window.t(opt.label);
    btn.onclick = (e) => {
      e.stopPropagation();
      editorFontType = opt.val;
      applyFontTypes(); 
      settingsDropdown.classList.remove('show');
      buildSettingsMenu();
    };
    editorFontSub.appendChild(btn);
  });

  editorFontWrapper.appendChild(editorFontSub);
  attachSubmenuHandlers(editorFontWrapper, editorFontSub);
  settingsDropdown.appendChild(editorFontWrapper);

  // ── Preview Text Size submenu
  const previewSizeWrapper = document.createElement('div');
  previewSizeWrapper.className = 'menu-item has-submenu';

  const previewSizeLabel = document.createElement('span');
  previewSizeLabel.textContent = window.t('Preview text size ▸');
  previewSizeWrapper.appendChild(previewSizeLabel);

  const previewSizeSub = document.createElement('div');
  previewSizeSub.className = 'submenu';
  previewSizeSub.style.display = 'none';

  sizeOptions.forEach(pct => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = (previewTextSize === pct ? '■ ' : '\u00a0\u00a0') + pct + '%';
    btn.onclick = (e) => {
      e.stopPropagation();
      previewTextSize = pct;
      applyTextSize();
      settingsDropdown.classList.remove('show');
      buildSettingsMenu();
    };
    previewSizeSub.appendChild(btn);
  });

  previewSizeWrapper.appendChild(previewSizeSub);
  attachSubmenuHandlers(previewSizeWrapper, previewSizeSub);
  settingsDropdown.appendChild(previewSizeWrapper);

  // ── Preview Font Type Submenu
  const previewFontWrapper = document.createElement('div');
  previewFontWrapper.className = 'menu-item has-submenu';
  
  const previewFontLabel = document.createElement('span');
  previewFontLabel.textContent = window.t('Preview font type ▸');
  previewFontWrapper.appendChild(previewFontLabel);

  const previewFontSub = document.createElement('div');
  previewFontSub.className = 'submenu';
  previewFontSub.style.display = 'none';

  fontTypeOptions.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = (previewFontType === opt.val ? '■ ' : '\u00a0\u00a0') + window.t(opt.label);
    btn.onclick = (e) => {
      e.stopPropagation();
      previewFontType = opt.val;
      applyFontTypes();
      settingsDropdown.classList.remove('show');
      buildSettingsMenu();
    };
    previewFontSub.appendChild(btn);
  });

  previewFontWrapper.appendChild(previewFontSub);
  attachSubmenuHandlers(previewFontWrapper, previewFontSub);
  settingsDropdown.appendChild(previewFontWrapper);

  // ── Outline Font Size submenu
  const outlineSizeOptions = [70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240];

  const outlineSizeWrapper = document.createElement('div');
  outlineSizeWrapper.className = 'menu-item has-submenu';

  const outlineSizeLabel = document.createElement('span');
  outlineSizeLabel.textContent = window.t('Outline font size ▸');
  outlineSizeWrapper.appendChild(outlineSizeLabel);

  const outlineSizeSub = document.createElement('div');
  outlineSizeSub.className = 'submenu';
  outlineSizeSub.style.display = 'none';

  outlineSizeOptions.forEach(pct => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = (outlineFontSize === pct ? '■ ' : '\u00a0\u00a0') + pct + '%';
    btn.onclick = (e) => {
      e.stopPropagation();
      window.setOutlineFontSize(pct); // canonical: applies + persists + resyncs
      settingsDropdown.classList.remove('show');
    };
    outlineSizeSub.appendChild(btn);
  });

outlineSizeWrapper.appendChild(outlineSizeSub);
  attachSubmenuHandlers(outlineSizeWrapper, outlineSizeSub);
  settingsDropdown.appendChild(outlineSizeWrapper);

  // ── Theme Mode submenu
const themeOptions = [
  { label: 'System', val: 'system' },
  { label: 'Light',  val: 'light'  },
  { label: 'Dark',   val: 'dark'   },
  { label: 'Paper',  val: 'paper'  },
  { label: 'Forest', val: 'forest' }
];

  const themeWrapper = document.createElement('div');
  themeWrapper.className = 'menu-item has-submenu';

  const themeLabel = document.createElement('span');
  themeLabel.textContent = window.t('Theme ▸');
  themeWrapper.appendChild(themeLabel);

  const themeSub = document.createElement('div');
  themeSub.className = 'submenu';
  themeSub.style.display = 'none';

  themeOptions.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = (themeMode === opt.val ? '■ ' : '\u00a0\u00a0') + window.t(opt.label);
    btn.onclick = (e) => {
      e.stopPropagation();
      themeMode = opt.val;
      if (window.setThemeMode) window.setThemeMode(themeMode);
      settingsDropdown.classList.remove('show');
      buildSettingsMenu();
      if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
    };
    themeSub.appendChild(btn);
  });

// ── Gradient / Solid toggle (appended at the bottom of the Theme submenu)
  const bgStyleDivider = document.createElement('div');
  bgStyleDivider.className = 'menu-divider';
  themeSub.appendChild(bgStyleDivider);

  const bgStyleBtn = document.createElement('button');
  bgStyleBtn.className = 'menu-item';
  const bgStyleCheck = document.createElement('span');
  bgStyleCheck.className = 'menu-item-check';
  bgStyleCheck.textContent = editorBgGradient ? '■' : '□';
  bgStyleBtn.appendChild(bgStyleCheck);
  bgStyleBtn.appendChild(document.createTextNode(window.t('Editor gradient bg')));
  bgStyleBtn.onclick = (e) => {
    e.stopPropagation();
    editorBgGradient = !editorBgGradient;
    applyEditorBgStyle();
    buildSettingsMenu();
    if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
  };
  themeSub.appendChild(bgStyleBtn);

  themeWrapper.appendChild(themeSub);
  attachSubmenuHandlers(themeWrapper, themeSub);
  settingsDropdown.appendChild(themeWrapper);

  // ── Background Image submenu

  // ── Background Image submenu
  const bgWrapper = document.createElement('div');
  bgWrapper.className = 'menu-item has-submenu';

  const bgLabel = document.createElement('span');
  bgLabel.textContent = window.t('Background ▸');
  bgWrapper.appendChild(bgLabel);

  const bgSub = document.createElement('div');
  bgSub.className = 'submenu';
  bgSub.style.display = 'none';

  BACKGROUND_OPTIONS.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = (selectedBackground === opt.val ? '■ ' : '\u00a0\u00a0') + window.t(opt.label);
    btn.onclick = (e) => {
      e.stopPropagation();
      selectedBackground = opt.val;
      applyBackground();
      settingsDropdown.classList.remove('show');
      buildSettingsMenu();
      if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
    };
    bgSub.appendChild(btn);
  });

  // No background (solid theme color)
  const bgNoneBtn = document.createElement('button');
  bgNoneBtn.className = 'menu-item';
  bgNoneBtn.textContent = (selectedBackground === 'none' ? '■ ' : '\u00a0\u00a0') + window.t('No background');
  bgNoneBtn.onclick = (e) => {
    e.stopPropagation();
    selectedBackground = 'none';
    applyBackground();
    settingsDropdown.classList.remove('show');
    buildSettingsMenu();
    if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
  };
  bgSub.appendChild(bgNoneBtn);

  // Import a custom image (stored locally as a downscaled data: URL)
  const bgCustomBtn = document.createElement('button');
  bgCustomBtn.className = 'menu-item';
  bgCustomBtn.textContent = (selectedBackground === 'custom' ? '■ ' : '\u00a0\u00a0') + window.t('Custom image…');
  bgCustomBtn.onclick = (e) => {
    e.stopPropagation();
    settingsDropdown.classList.remove('show');
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.onchange = () => {
      if (picker.files && picker.files[0]) importCustomBackgroundFile(picker.files[0]);
    };
    picker.click();
  };
  bgSub.appendChild(bgCustomBtn);

  let hasCustomBg = false;
  try { hasCustomBg = !!localStorage.getItem(CUSTOM_BG_KEY); } catch (_) {}
  if (hasCustomBg) {
    const bgRemoveBtn = document.createElement('button');
    bgRemoveBtn.className = 'menu-item';
    bgRemoveBtn.textContent = '\u00a0\u00a0' + window.t('Remove custom image');
    bgRemoveBtn.onclick = (e) => {
      e.stopPropagation();
      window.removeCustomBackgroundImage();
      settingsDropdown.classList.remove('show');
      buildSettingsMenu();
    };
    bgSub.appendChild(bgRemoveBtn);
  }

  bgWrapper.appendChild(bgSub);
  attachSubmenuHandlers(bgWrapper, bgSub);
  settingsDropdown.appendChild(bgWrapper);

  // ── Background opacity submenu (null = each theme's subtle default)
  const bgOpacityOptions = [
    { label: window.t('Theme default'), val: null },
    { label: '3%',  val: 0.03 }, { label: '5%',  val: 0.05 },
    { label: '8%',  val: 0.08 }, { label: '12%', val: 0.12 },
    { label: '20%', val: 0.20 }, { label: '30%', val: 0.30 },
    { label: '50%', val: 0.50 }, { label: '75%', val: 0.75 },
    { label: '100%', val: 1 },
  ];
  const bgOpWrapper = document.createElement('div');
  bgOpWrapper.className = 'menu-item has-submenu';
  const bgOpLabel = document.createElement('span');
  bgOpLabel.textContent = window.t('Background opacity ▸');
  bgOpWrapper.appendChild(bgOpLabel);
  const bgOpSub = document.createElement('div');
  bgOpSub.className = 'submenu';
  bgOpSub.style.display = 'none';
  bgOpacityOptions.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = (backgroundOpacity === opt.val ? '■ ' : '\u00a0\u00a0') + opt.label;
    btn.onclick = (e) => {
      e.stopPropagation();
      window.setBackgroundOpacity(opt.val);
      settingsDropdown.classList.remove('show');
      buildSettingsMenu();
    };
    bgOpSub.appendChild(btn);
  });
  bgOpWrapper.appendChild(bgOpSub);
  attachSubmenuHandlers(bgOpWrapper, bgOpSub);
  settingsDropdown.appendChild(bgOpWrapper);

  // ── UI Menu Size submenu
  const uiSizeOptions = [90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270];
  const uiSizeWrapper = document.createElement('div');
  uiSizeWrapper.className = 'menu-item has-submenu';

  const uiSizeLabel = document.createElement('span');
  uiSizeLabel.textContent = window.t('UI menu size ▸');
  uiSizeWrapper.appendChild(uiSizeLabel);

  const uiSizeSub = document.createElement('div');
  uiSizeSub.className = 'submenu';
  uiSizeSub.style.display = 'none';

  uiSizeOptions.forEach(pct => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = (uiSize === pct ? '■ ' : '\u00a0\u00a0') + pct + '%';
    btn.onclick = (e) => {
      e.stopPropagation();
      uiSize = pct;
      document.documentElement.style.fontSize = pct + '%';
      applyTextSize();
      applyOutlineFontSize();
      applyUiSizeProseCompensation();
      settingsDropdown.classList.remove('show');
      buildSettingsMenu();
    };
    uiSizeSub.appendChild(btn);
  });

  uiSizeWrapper.appendChild(uiSizeSub);
  attachSubmenuHandlers(uiSizeWrapper, uiSizeSub);
  settingsDropdown.appendChild(uiSizeWrapper);

  // ── Language submenu
  const languageOptions = [
    { label: 'English', val: 'English' },
    { label: 'Swedish', val: 'Swedish' }
  ];

  const langWrapper = document.createElement('div');
  langWrapper.className = 'menu-item has-submenu';

  const langLabel = document.createElement('span');
  langLabel.textContent = window.t('Language ▸');
  langWrapper.appendChild(langLabel);

  const langSub = document.createElement('div');
  langSub.className = 'submenu';
  langSub.style.display = 'none';

  languageOptions.forEach(opt => {
  const btn = document.createElement('button');
  btn.className = 'menu-item';
  btn.textContent = (uiLanguage === opt.val ? '■ ' : '\u00a0\u00a0') + window.t(opt.label);
    btn.onclick = (e) => {
      e.stopPropagation();
      uiLanguage = opt.val;
      window.uiLanguage = opt.val;
      
      window.applyDOMTranslations();
      rebuildAllMenus();   // rebuild all dynamic menus
      
      settingsDropdown.classList.remove('show');
      if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
    };
    langSub.appendChild(btn);
  });

  langWrapper.appendChild(langSub);
  attachSubmenuHandlers(langWrapper, langSub);
  settingsDropdown.appendChild(langWrapper);

  const delayOptions = [50, 100, 150, 200, 250, 300, 350, 400, 500, 600, 700, 800, 900, 1000, 1200, 1500, 2000, 2500, 4000];
  const delayWrapper = document.createElement('div');
  delayWrapper.className = 'menu-item has-submenu';
  
  const delayLabel = document.createElement('span');
  delayLabel.textContent = window.t('CPU performance delay ▸');
  delayWrapper.appendChild(delayLabel);

  const delaySub = document.createElement('div');
  delaySub.className = 'submenu';
  delaySub.style.display = 'none';

  delayOptions.forEach(ms => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = (renderDelay === ms ? '■ ' : '\u00a0\u00a0') + ms + ' ms';
    btn.onclick = (e) => {
      e.stopPropagation();
      renderDelay = ms;
      settingsDropdown.classList.remove('show');
      buildSettingsMenu();
    };
    delaySub.appendChild(btn);
  });

  delayWrapper.appendChild(delaySub);
  attachSubmenuHandlers(delayWrapper, delaySub);
  settingsDropdown.appendChild(delayWrapper);

  // ── Slow Hardware Mode Toggle (groups with the CPU delay above)
  const shBtn = document.createElement('button');
  shBtn.className = 'menu-item';
  const shCheck = document.createElement('span');
  shCheck.className = 'menu-item-check';
  shCheck.textContent = slowHardwareMode ? '■' : '□';
  shBtn.appendChild(shCheck);
  shBtn.appendChild(document.createTextNode(window.t('Slow Hardware Mode')));
  shBtn.title = window.t('For older machines: fewer disk writes, calmer rendering, no background image. Saves keep full crash-safety.');
  shBtn.onclick = (e) => {
    e.stopPropagation();
    window.setSlowHardwareMode(!slowHardwareMode);
    settingsDropdown.classList.remove('show');
    buildSettingsMenu();
  };
  settingsDropdown.appendChild(shBtn);

  // ── Live Preview Toggle (experimental)
  const lpBtn = document.createElement('button');
  lpBtn.className = 'menu-item';
  const lpCheck = document.createElement('span');
  lpCheck.className = 'menu-item-check';
  lpCheck.textContent = livePreviewMode ? '■' : '□';
  lpBtn.appendChild(lpCheck);
  lpBtn.appendChild(document.createTextNode(window.t('Live Preview (experimental)')));
  lpBtn.title = window.t('Render formatting inside the editor; markdown symbols show on the line you are editing. Hides the side preview while active.');
  lpBtn.onclick = (e) => {
    e.stopPropagation();
    window.setLivePreviewMode(!livePreviewMode);
    settingsDropdown.classList.remove('show');
    buildSettingsMenu();
  };
  settingsDropdown.appendChild(lpBtn);

  const rcDivider = document.createElement('div');
  rcDivider.className = 'menu-divider';
  settingsDropdown.appendChild(rcDivider);

  // ── Forced Preview Sync Toggle
  const fsBtn = document.createElement('button');
  fsBtn.className = 'menu-item';
  const fsCheck = document.createElement('span');
  fsCheck.className = 'menu-item-check';
  fsCheck.textContent = window.forcedSyncEnabled ? '■' : '□';
  fsBtn.appendChild(fsCheck);
  fsBtn.appendChild(document.createTextNode(window.t('Forced Prev. Synch')));
  fsBtn.onclick = (e) => {
    e.stopPropagation();
    window.forcedSyncEnabled = !window.forcedSyncEnabled;
    settingsDropdown.classList.remove('show');
    buildSettingsMenu();
    if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
    if (window.forcedSyncEnabled && typeof window.forceSyncToCursor === 'function') window.forceSyncToCursor();
  };
  settingsDropdown.appendChild(fsBtn);

  // ── Deactivate Right Click Toggle
  const rcBtn = document.createElement('button');
  rcBtn.className = 'menu-item';
  const rcCheck = document.createElement('span');
  rcCheck.className = 'menu-item-check';
  rcCheck.textContent = rightClickDisabled ? '■' : '□';
  rcBtn.appendChild(rcCheck);
  rcBtn.appendChild(document.createTextNode(window.t('Deactivate Right Click')));
  rcBtn.onclick = (e) => {
    e.stopPropagation();
    rightClickDisabled = !rightClickDisabled;
    settingsDropdown.classList.remove('show');
    buildSettingsMenu();
  };
  settingsDropdown.appendChild(rcBtn);

  // ── Center Headers Toggle
  const centerHeadersBtn = document.createElement('button');
  centerHeadersBtn.className = 'menu-item';
  const centerHeadersCheck = document.createElement('span');
  centerHeadersCheck.className = 'menu-item-check';
  centerHeadersCheck.textContent = window.centerHeaders ? '■' : '□';
  centerHeadersBtn.appendChild(centerHeadersCheck);
  centerHeadersBtn.appendChild(document.createTextNode(window.t('Center Headers')));
  centerHeadersBtn.onclick = (e) => {
    e.stopPropagation();
    window.centerHeaders = !window.centerHeaders;
    settingsDropdown.classList.remove('show');
    buildSettingsMenu();
    applyCenterHeaders();
    if (typeof window.saveEditorSettings === 'function') window.saveEditorSettings();
  };
  settingsDropdown.appendChild(centerHeadersBtn);
  
  if (typeof window.saveEditorSettings === 'function') {
    window.saveEditorSettings();
  }
}



function togglePreview() {
  previewVisible = !previewVisible;
  
  if (readerMode && !previewVisible) {
    readerMode = false;
    edPane.style.display = '';
  }

  prPane.style.display      = previewVisible ? '' : 'none';
  divider.style.display     = (previewVisible && !readerMode) ? '' : 'none';
  
  if (!readerMode) {
    if (previewVisible) {
      // Restore split layout — use the user's last dragged width if available
      edPane.style.width = window.savedEditorWidth || '33.33%';
      edPane.style.flex  = 'none';
    } else {
      // Editor fills the workspace
      edPane.style.width = '100%';
      edPane.style.flex  = '1';
    }
  }
  buildSettingsMenu(); // refresh checkmark
}

function toggleReaderMode() {
  readerMode = !readerMode;
  document.body.classList.toggle('reader-mode-active', readerMode);
  if (readerMode) {
    edPane.style.display = 'none';
    divider.style.display = 'none';
    prPane.style.display = '';
  } else {
    edPane.style.display = '';
    divider.style.display = previewVisible ? '' : 'none';
    prPane.style.display = previewVisible ? '' : 'none';
    
    if (previewVisible) {
      // Restore split layout — use the user's last dragged width if available
      edPane.style.width = window.savedEditorWidth || '33.33%';
      edPane.style.flex  = 'none';
    } else {
      edPane.style.width = '100%';
      edPane.style.flex  = '1';
    }
  }
  buildSettingsMenu(); // refresh checkmarks
}

function toggleMobileView() {
  mobileView = !mobileView;
  prPane.classList.toggle('mobile-preview', mobileView);
  buildSettingsMenu(); // refresh checkmark
}

/* ── Outline Navigation Toggle ────────────────────────────────────────────
   Shows/hides the outline pane on the right side of the preview.
   When shown, renderOutline() is called immediately so the panel
   is populated with the current document's headings.                     */
function toggleOutline() {
  /* ── Mobile: show as dropdown anchored to the Outline button ───────── */
  if (window.innerWidth <= 820) {
    const isOpening = !document.body.classList.contains('mobile-outline-open');
    document.body.classList.toggle('mobile-outline-open');

    if (isOpening) {
      // Render outline content first
      if (typeof renderOutline === 'function') renderOutline();

      // Position the outline pane directly under the Outline button
              const outlinePane = document.getElementById('outline-pane');
              const outlineBtn = document.getElementById('btn-reader-outline');
              if (outlinePane && outlineBtn) {
                const btnRect = outlineBtn.getBoundingClientRect();
                
                // Place it just below the button, ensuring it stays within horizontal screen bounds
                const paneWidth = outlinePane.offsetWidth || 280;
                let rightPos = window.innerWidth - btnRect.right;
                rightPos = Math.max(10, Math.min(rightPos, window.innerWidth - paneWidth - 10));

                outlinePane.style.position = 'absolute';
                outlinePane.style.top = (btnRect.bottom + 5) + 'px';
                outlinePane.style.right = rightPos + 'px';
                outlinePane.style.left = 'auto';
                outlinePane.style.bottom = 'auto';
              }
    } else {
      // When closing, remove any inline positioning so it resets for next open
      const outlinePane = document.getElementById('outline-pane');
      if (outlinePane) {
        outlinePane.style.position = '';
        outlinePane.style.top = '';
        outlinePane.style.right = '';
        outlinePane.style.left = '';
        outlinePane.style.bottom = '';
      }
    }
    return; // Skip desktop inline-style logic
  }


  /* ── Desktop: toggle the side pane with inline styles (unchanged) ─── */
  outlineVisible = !outlineVisible;
  const outlinePane    = document.getElementById('outline-pane');
  const outlineDivider = document.getElementById('outline-divider');
  if (!outlinePane) return;

  outlinePane.style.display    = outlineVisible ? '' : 'none';
  /* Show the resize divider alongside the outline pane */
  if (outlineDivider) {
    outlineDivider.style.display = outlineVisible ? '' : 'none';
  }

  /* Populate the outline right away so the user sees content immediately */
  if (outlineVisible && typeof renderOutline === 'function') {
    renderOutline();
  }
  buildSettingsMenu(); // refresh checkmark
}


// Reposition the mobile outline when the window is resized (only if it's open)
window.addEventListener('resize', function() {
  if (window.innerWidth <= 820 && document.body.classList.contains('mobile-outline-open')) {
    const outlinePane = document.getElementById('outline-pane');
    const outlineBtn = document.getElementById('btn-reader-outline');
    if (outlinePane && outlineBtn) {
      const btnRect = outlineBtn.getBoundingClientRect();
      
      const paneWidth = outlinePane.offsetWidth || 280;
      let rightPos = window.innerWidth - btnRect.right;
      rightPos = Math.max(10, Math.min(rightPos, window.innerWidth - paneWidth - 10));

      outlinePane.style.top = (btnRect.bottom + 5) + 'px';
      outlinePane.style.right = rightPos + 'px';
    }
  }
});



buildSettingsMenu();

/* ── Build the Logo Dropdown Menu ── */

function buildLogoMenu() {
  if (!logoDropdown) return;
  logoDropdown.innerHTML = '';

  const aboutBtn = document.createElement('button');
  aboutBtn.className = 'menu-item';
  aboutBtn.textContent = window.t('About');
  aboutBtn.onclick = (e) => {
    e.stopPropagation();
    logoDropdown.classList.remove('show');
    document.getElementById('about-modal').classList.add('show');
  };
  logoDropdown.appendChild(aboutBtn);

  const legalBtn = document.createElement('button');
  legalBtn.className = 'menu-item';
  legalBtn.textContent = window.t('Legal');
  legalBtn.onclick = (e) => {
    e.stopPropagation();
    logoDropdown.classList.remove('show');
    document.getElementById('legal-modal').classList.add('show');
  };
  logoDropdown.appendChild(legalBtn);

  const guideBtn = document.createElement('button');
  guideBtn.className = 'menu-item';
  guideBtn.textContent = window.t('User Guide');
  guideBtn.onclick = (e) => {
    e.stopPropagation();
    logoDropdown.classList.remove('show');
    document.getElementById('user-guide-modal').classList.add('show');
  };
  logoDropdown.appendChild(guideBtn);

  const div = document.createElement('div');
  div.className = 'menu-divider';
  logoDropdown.appendChild(div);

  const quitBtn = document.createElement('button');
  quitBtn.className = 'menu-item';
  quitBtn.style.color = '#ff5555';
  quitBtn.textContent = window.t('Quit / Exit');
  quitBtn.onclick = (e) => {
    e.stopPropagation();
    logoDropdown.classList.remove('show');
    if (typeof openQuitModal === 'function') openQuitModal();
  };
  logoDropdown.appendChild(quitBtn);
}




function rebuildAllMenus() {
  // Clear and rebuild file dropdown
  fileDropdown.innerHTML = '';
  buildMenu(fileDropdown, fileActions);
  
  // Clear and rebuild toolbar dropdown
  toolbarDropdown.innerHTML = '';
  buildMenu(toolbarDropdown, menuActions);
  
  // Clear and rebuild context menu
  contextMenu.innerHTML = '';
  buildMenu(contextMenu, [...menuActions, ...contextMenuExtra]);
  
  // Rebuild logo dropdown
  logoDropdown.innerHTML = '';
  buildLogoMenu();
  
  // Rebuild settings dropdown (already uses translated strings)
  buildSettingsMenu();
}




buildLogoMenu();

btnSettings.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsDropdown.classList.toggle('show');
  toolbarDropdown.classList.remove('show');
  fileDropdown.classList.remove('show');
  if (logoDropdown) logoDropdown.classList.remove('show');
  contextMenu.classList.remove('show');
  smartPositionDropdown(settingsDropdown);
});

/* Toggle Toolbar Dropdown */
btnToolbar.addEventListener('click', (e) => {
  e.stopPropagation();
  toolbarDropdown.classList.toggle('show');
  settingsDropdown.classList.remove('show');
  fileDropdown.classList.remove('show');
  if (logoDropdown) logoDropdown.classList.remove('show');
  contextMenu.classList.remove('show');
  smartPositionDropdown(toolbarDropdown);
});

/* Toggle File Dropdown */
btnFile.addEventListener('click', (e) => {
  e.stopPropagation();
  fileDropdown.classList.toggle('show');
  toolbarDropdown.classList.remove('show');
  settingsDropdown.classList.remove('show');
  if (logoDropdown) logoDropdown.classList.remove('show');
  contextMenu.classList.remove('show');
  smartPositionDropdown(fileDropdown);
});

/* Toggle Logo Dropdown */
if (btnLogo) {
  btnLogo.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    logoDropdown.classList.toggle('show');
    fileDropdown.classList.remove('show');
    toolbarDropdown.classList.remove('show');
    settingsDropdown.classList.remove('show');
    contextMenu.classList.remove('show');
    smartPositionDropdown(logoDropdown);
  });
}
/* Context Menu Logic with Smart Positioning */
editor.addEventListener('contextmenu', (e) => {
  if (rightClickDisabled) {
    return;
  }

  e.preventDefault();
  toolbarDropdown.classList.remove('show');
  settingsDropdown.classList.remove('show');
  fileDropdown.classList.remove('show');
  if (logoDropdown) logoDropdown.classList.remove('show');

  // --- FIX: Rebuild the context menu to ensure it contains the correct editor actions
  contextMenu.innerHTML = '';
  buildMenu(contextMenu, [...menuActions, ...contextMenuExtra]);

// Clear any previous scrolling constraints
          contextMenu.style.removeProperty('max-height');
          contextMenu.style.removeProperty('overflow-y');

          // 1. Show the menu hidden first to measure its size
          contextMenu.style.display = ''; 
          contextMenu.style.visibility = 'hidden';
          contextMenu.classList.add('show');

          const menuWidth = contextMenu.offsetWidth;
          const menuHeight = contextMenu.offsetHeight;



          
          // 2. Calculate coordinates
          let posX = e.pageX;
          let posY = e.pageY;

          // 3. Flip/Shift if it would go off-screen
          // Horizontal check
          if (posX + menuWidth > window.innerWidth) {
            posX = window.innerWidth - menuWidth - 10;
          }
          // Vertical check
          if (posY + menuHeight > window.innerHeight) {
            posY = window.innerHeight - menuHeight - 10;
            // If shifting it up pushes it off the top of the screen, cap the height and enable scrolling
            if (posY < 10) {
              posY = 10;
              contextMenu.style.maxHeight = (window.innerHeight - 20) + 'px';
              contextMenu.style.overflowY = 'auto';
            }
          }
        // Add this block to signal the CSS to flip the submenu left
          if (posX + menuWidth + 160 > window.innerWidth) {
    contextMenu.classList.add('align-right');
  } else {
    contextMenu.classList.remove('align-right');
  }


  // 4. Apply position and make visible
  contextMenu.style.left = posX + 'px';
  contextMenu.style.top = posY + 'px';
  contextMenu.style.visibility = 'visible';
});

/* Close menus on outside click */
document.addEventListener('click', () => {
  toolbarDropdown.classList.remove('show');
  settingsDropdown.classList.remove('show');
  fileDropdown.classList.remove('show');
  if (logoDropdown) logoDropdown.classList.remove('show');
  contextMenu.classList.remove('show');
});

/* Attach event listener for About close button */
const btnAboutClose = document.getElementById('about-btn-close');
if (btnAboutClose) {
  btnAboutClose.addEventListener('click', () => {
    document.getElementById('about-modal').classList.remove('show');
  });
}

/* Attach event listener for User Guide close button */
const btnUserGuideClose = document.getElementById('user-guide-btn-close');
if (btnUserGuideClose) {
  btnUserGuideClose.addEventListener('click', () => {
    document.getElementById('user-guide-modal').classList.remove('show');
  });
}

/* Attach event listener for Legal close button */
const btnLegalClose = document.getElementById('legal-btn-close');
if (btnLegalClose) {
  btnLegalClose.addEventListener('click', () => {
    document.getElementById('legal-modal').classList.remove('show');
  });
}

/* Attach event listeners for Reader Mode buttons */
const btnReaderMode = document.getElementById('btn-reader-mode');
const btnExitReaderMode = document.getElementById('btn-exit-reader-mode');
const btnReaderOutline = document.getElementById('btn-reader-outline');

if (btnReaderMode) btnReaderMode.addEventListener('click', toggleReaderMode);
if (btnExitReaderMode) btnExitReaderMode.addEventListener('click', toggleReaderMode);
if (btnReaderOutline) btnReaderOutline.addEventListener('click', toggleOutline);
