/* Theme engine — loaded first in <head> so the palette is on <html>
   before anything paints (no flash of the wrong theme).

   Built-in palettes are CSS blocks keyed on [data-theme] in
   revery_notebook_style.css. The custom theme is generated here from five
   small values and set as inline custom properties on <html>, on top of
   its light/dark base block (which still supplies --bg_oacity).

   Every light/dark-dependent rule in the stylesheets keys on html.dark,
   which applyTheme() sets for every dark palette — never on a theme name
   and never on the OS setting. */
(function () {
  var root = document.documentElement;
  var mq = window.matchMedia('(prefers-color-scheme: dark)');

  var MODES = ['system', 'light', 'dark', 'paper', 'forest', 'custom'];
  var DARK_PALETTES = { dark: true, forest: true };

  /* ── Custom palette generator ─────────────────────────────────────────
     Inputs are what the dialog's sliders produce, each changing only what
     it names: base 'light'|'dark'; textHue 0–359 and textSat 0–100 (the
     text color; 0 = gray); bgHue 0–359 and bgSat 0–100 (the backgrounds;
     0 = gray). Muted text, the highlight (--accent), the selection and the
     click flash derive from the text color, so it colors the whole UI.
     Lightness per role is FIXED per base — text roles on one side of every
     surface — so no combination can make text unreadable; only hue and
     chroma move. Colors are built in OKLCH (perceptually even lightness
     across hues) and chroma is reduced until the color fits sRGB.
     test/custom_theme.test.js checks the contrast of EVERY input
     combination, so change the numbers below only with that test green. */
  var DEFAULT_CUSTOM = { base: 'dark', textHue: 75, textSat: 40, bgHue: 255, bgSat: 35 };

  /* The custom properties a palette defines (all but --bg_oacity, which
     the base block keeps so the Background opacity override still works). */
  var CUSTOM_VARS = [
    '--bg', '--bg-rgb', '--bg-panel-rgb', '--editor-bg-start', '--editor-bg-end',
    '--bg-panel', '--bg-hover', '--border', '--border-md', '--theme-divider',
    '--theme-divider-hover', '--text', '--text-muted', '--text-dim', '--accent',
    '--scrollbar', '--menu-bg', '--selection', '--flash-rgb'
  ];

  function wrapHue(v) { return ((Math.round(v) % 360) + 360) % 360; }
  function clampInt(v, lo, hi) { return Math.min(hi, Math.max(lo, Math.round(v))); }

  /* Stored/hand-edited values → a valid parameter object, or null. Also
     reads the earlier {hue, vivid, split, tint} layout, whose background
     hue was stored as an offset from the text hue. */
  function normalizeCustom(x) {
    if (!x || typeof x !== 'object') return null;
    if (x.base !== 'light' && x.base !== 'dark') return null;
    var n = 'textHue' in x
      ? { textHue: Number(x.textHue), textSat: Number(x.textSat), bgHue: Number(x.bgHue), bgSat: Number(x.bgSat) }
      : { textHue: Number(x.hue), textSat: Number(x.vivid), bgHue: Number(x.hue) + Number(x.split), bgSat: Number(x.tint) };
    for (var k in n) if (!isFinite(n[k])) return null;
    return {
      base: x.base,
      textHue: wrapHue(n.textHue),
      textSat: clampInt(n.textSat, 0, 100),
      bgHue: wrapHue(n.bgHue),
      bgSat: clampInt(n.bgSat, 0, 100)
    };
  }
  function oklabToLinearRgb(L, C, h) {
    var hr = h * Math.PI / 180, a = C * Math.cos(hr), b = C * Math.sin(hr);
    var l = L + 0.3963377774 * a + 0.2158037573 * b;
    var m = L - 0.1055613458 * a - 0.0638541728 * b;
    var s = L - 0.0894841775 * a - 1.2914855480 * b;
    l = l * l * l; m = m * m * m; s = s * s * s;
    return [
       4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
  }
  function inGamut(c) {
    return c[0] >= -1e-5 && c[0] <= 1 + 1e-5 && c[1] >= -1e-5 && c[1] <= 1 + 1e-5
      && c[2] >= -1e-5 && c[2] <= 1 + 1e-5;
  }
  function encode(v) {
    v = Math.min(1, Math.max(0, v));
    v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(v * 255);
  }
  /* OKLCH → [r, g, b] 0–255, keeping L and h and shrinking C to fit sRGB. */
  function oklch(L, C, h) {
    L = Math.min(1, Math.max(0, L));
    var lin = oklabToLinearRgb(L, C, h);
    if (!inGamut(lin)) {
      var lo = 0, hi = C;
      for (var i = 0; i < 24; i++) {
        var mid = (lo + hi) / 2;
        if (inGamut(oklabToLinearRgb(L, mid, h))) lo = mid; else hi = mid;
      }
      lin = oklabToLinearRgb(L, lo, h);
    }
    return [encode(lin[0]), encode(lin[1]), encode(lin[2])];
  }

  function hex(c) {
    return '#' + c.map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ', ' + c[1] + ', ' + c[2] + ', ' + a + ')'; }

  /* Surfaces (bgHue): lightness L = l0 + l1·k and chroma C = c1·k,
     k = bgSat/100. The bgSat-0 ends match the built-in Light and Dark
     palettes. Text roles (textHue): fixed lightness, chroma =
     textSat/100 · C. */
  var SPEC = {
    light: {
      surface: {
        bg:    [0.975, -0.025, 0.040],
        end:   [0.915, -0.025, 0.055],  // editor gradient end
        panel: [0.990, -0.070, 0.030],
        menu:  [0.990, -0.070, 0.030],
        hover: [0.955, -0.110, 0.050],
        div:   [0.930, -0.090, 0.045],
        divH:  [0.867, -0.090, 0.055]
      },
      text:   { L: 0.330, C: 0.16 },
      muted:  { L: 0.450, C: 0.14 },
      accent: { L: 0.460, C: 0.19 },
      alpha:  { dim: 0.2, border: 0.08, borderMd: 0.15, scrollbar: 0.12, selection: 0.26 }
    },
    dark: {
      surface: {
        bg:    [0.145, 0.055, 0.030],
        end:   [0.085, 0.055, 0.040],   // editor gradient end
        panel: [0.235, 0.000, 0.025],
        menu:  [0.240, 0.025, 0.033],
        hover: [0.293, 0.000, 0.030],
        div:   [0.235, 0.025, 0.031],
        divH:  [0.285, 0.040, 0.042]
      },
      text:   { L: 0.880, C: 0.16 },
      muted:  { L: 0.700, C: 0.14 },
      accent: { L: 0.780, C: 0.19 },
      alpha:  { dim: 0.2, border: 0.09, borderMd: 0.15, scrollbar: 0.11, selection: 0.24 }
    }
  };

  /* One text-family color (role 'text' | 'muted' | 'accent'). The dialog's
     text slider tracks are painted with this too, so the color shown is
     the color applied. */
  function textColor(base, role, hue, sat) {
    var t = SPEC[base][role];
    return oklch(t.L, t.C * sat / 100, hue);
  }

  /* params → { dark, colors: {token: [r,g,b]}, alpha, vars: {--name: css} } */
  function buildCustomPalette(params) {
    var p = normalizeCustom(params);
    if (!p) return null;
    var spec = SPEC[p.base], k = p.bgSat / 100;
    var c = {};
    for (var name in spec.surface) {
      var t = spec.surface[name];
      c[name] = oklch(t[0] + t[1] * k, t[2] * k, p.bgHue);
    }
    c.text = textColor(p.base, 'text', p.textHue, p.textSat);
    c.muted = textColor(p.base, 'muted', p.textHue, p.textSat);
    c.accent = textColor(p.base, 'accent', p.textHue, p.textSat);
    var a = spec.alpha;
    return {
      dark: p.base === 'dark',
      colors: c,
      alpha: a,
      vars: {
        '--bg': hex(c.bg),
        '--bg-rgb': c.bg.join(', '),
        '--bg-panel-rgb': c.panel.join(', '),
        '--editor-bg-start': hex(c.bg),
        '--editor-bg-end': hex(c.end),
        '--bg-panel': hex(c.panel),
        '--bg-hover': hex(c.hover),
        '--border': rgba(c.text, a.border),
        '--border-md': rgba(c.text, a.borderMd),
        '--theme-divider': hex(c.div),
        '--theme-divider-hover': hex(c.divH),
        '--text': hex(c.text),
        '--text-muted': hex(c.muted),
        '--text-dim': rgba(c.text, a.dim),
        '--accent': hex(c.accent),
        '--scrollbar': rgba(c.text, a.scrollbar),
        '--menu-bg': hex(c.menu),
        '--selection': rgba(c.text, a.selection),
        '--flash-rgb': c.accent.join(', ')
      }
    };
  }

  /* ── Stored settings ─────────────────────────────────────────────────
     themeMode is saved as the custom theme's BASE ('light'/'dark') plus
     customThemeActive, so a build without custom themes still opens with
     a readable palette. An unknown mode must never reach data-theme: no
     palette block would match and every color variable would be empty. */
  var theme = 'system';
  var custom = null;
  try {
    var stored = localStorage.getItem('revery_md_settings');
    if (stored) {
      var s = JSON.parse(stored);
      if (MODES.indexOf(s.themeMode) !== -1 && s.themeMode !== 'custom') theme = s.themeMode;
      custom = normalizeCustom(s.customTheme);
      if (s.customThemeActive === true && custom) theme = 'custom';
    }
  } catch (e) {}

  function applyTheme() {
    var palette = theme === 'custom' ? buildCustomPalette(custom) : null;

    // 1. Determine the exact active palette block
    var activeTheme = palette ? custom.base
      : theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;

    // 2. data-theme drives the [data-theme="…"] palette blocks
    root.setAttribute('data-theme', activeTheme);

    // 3. The custom palette overrides the base block's variables inline
    for (var i = 0; i < CUSTOM_VARS.length; i++) {
      if (palette) root.style.setProperty(CUSTOM_VARS[i], palette.vars[CUSTOM_VARS[i]]);
      else root.style.removeProperty(CUSTOM_VARS[i]);
    }
    if (palette) root.setAttribute('data-custom-theme', '');
    else root.removeAttribute('data-custom-theme');

    // 4. One dark signal: html.dark + colorScheme (scrollbars, form controls)
    var isDarkTheme = palette ? palette.dark : !!DARK_PALETTES[activeTheme];
    root.style.colorScheme = isDarkTheme ? 'dark' : 'light';
    if (isDarkTheme) root.classList.add('dark');
    else root.classList.remove('dark');
  }

  applyTheme();

  mq.addEventListener('change', function () {
    if (theme === 'system') applyTheme();
  });

  /* Live setter for menus.js. 'custom' takes the parameters to show (the
     dialog calls this on every slider move); invalid input falls back to
     the System theme rather than leaving an empty palette. */
  window.setThemeMode = function (newTheme, customParams) {
    if (newTheme === 'custom') {
      var p = normalizeCustom(customParams || custom);
      if (p) { custom = p; theme = 'custom'; }
      else theme = 'system';
    } else {
      theme = MODES.indexOf(newTheme) !== -1 ? newTheme : 'system';
    }
    applyTheme();
  };

  window.ReveryTheme = {
    MODES: MODES.slice(),
    CUSTOM_VARS: CUSTOM_VARS.slice(),
    DEFAULT_CUSTOM: DEFAULT_CUSTOM,
    normalizeCustom: normalizeCustom,
    buildCustomPalette: buildCustomPalette,
    textColor: textColor,
    oklch: oklch,
    hex: hex,
    /* The palette in effect now — the dialog's starting point. */
    isDarkActive: function () { return root.classList.contains('dark'); }
  };
})();
