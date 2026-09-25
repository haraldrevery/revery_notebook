'use strict';

/* Unit tests for the custom theme generator in markdown_editor_theme.js,
   loaded in a vm with a stub DOM (the file is a plain <head> script).

   The dialog's controls produce integers — base light/dark, text color
   (textHue 0–359) and text saturation (textSat 0–100), background color
   (bgHue 0–359) and background saturation (bgSat 0–100) — and stored
   values are normalized into those same ranges,
   so the contrast checks below cover EVERY palette a user can produce.
   The point: a borderless window with unreadable menus cannot be
   escaped, so no control position may break readability. */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WWW = path.join(__dirname, '..', 'www', 'jvscrpt_and_css_extra');
const SRC = fs.readFileSync(path.join(WWW, 'markdown_editor_theme.js'), 'utf8');
const CSS = fs.readFileSync(path.join(WWW, 'revery_notebook_style.css'), 'utf8');

/* Boot the script against a stub <html> and optional stored settings. */
function boot({ settings = null, osDark = false } = {}) {
  const props = new Map();
  const attrs = new Map();
  const classes = new Set();
  const el = {
    style: {
      setProperty: (k, v) => props.set(k, v),
      removeProperty: (k) => props.delete(k),
    },
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
  };
  const ctx = {
    document: { documentElement: el },
    localStorage: { getItem: (k) => (k === 'revery_md_settings' && settings ? JSON.stringify(settings) : null) },
    matchMedia: () => ({ matches: osDark, addEventListener() {} }),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return {
    api: ctx.ReveryTheme,
    setThemeMode: ctx.setThemeMode,
    dataTheme: () => attrs.get('data-theme'),
    isCustom: () => attrs.has('data-custom-theme'),
    dark: () => classes.has('dark'),
    colorScheme: () => el.style.colorScheme,
    prop: (k) => props.get(k),
    propCount: () => props.size,
  };
}

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (ya, yb) => (Math.max(ya, yb) + 0.05) / (Math.min(ya, yb) + 0.05);
const contrast = (a, b) => ratio(lum(a), lum(b));
const over = (fg, alpha, bg) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));
/* Objects made inside the vm have that realm's prototypes; compare copies. */
const plain = (x) => JSON.parse(JSON.stringify(x));
const hexRgb = (h) => {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

describe('custom theme generator', () => {
  const { api } = boot();

  test('generates exactly the variables every built-in palette defines (minus --bg_oacity)', () => {
    for (const name of ['dark', 'light', 'paper', 'forest']) {
      const m = new RegExp(`\\[data-theme="${name}"\\] \\{([^}]*)\\}`).exec(CSS);
      assert.ok(m, `palette block ${name} not found`);
      const defined = [...m[1].matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((x) => x[1])
        .filter((v) => v !== '--bg_oacity').sort();
      assert.deepEqual([...api.CUSTOM_VARS].sort(), defined,
        `${name}: the custom palette must set the same variables (a new palette token needs a generator entry)`);
    }
    const vars = api.buildCustomPalette(api.DEFAULT_CUSTOM).vars;
    assert.deepEqual(Object.keys(vars).sort(), [...api.CUSTOM_VARS].sort());
    assert.ok(!('--bg_oacity' in vars), 'must not override the Background opacity setting');
  });

  test('normalizes stored values into the control ranges and rejects garbage', () => {
    assert.deepEqual(plain(api.normalizeCustom({ base: 'dark', textHue: 400.4, textSat: 150, bgHue: -30, bgSat: -5 })),
      { base: 'dark', textHue: 40, textSat: 100, bgHue: 330, bgSat: 0 });
    assert.deepEqual(plain(api.normalizeCustom({ base: 'light', textHue: '12', textSat: '7.6', bgHue: 359.6, bgSat: 101 })),
      { base: 'light', textHue: 12, textSat: 8, bgHue: 0, bgSat: 100 });
    const ok = { base: 'dark', textHue: 1, textSat: 1, bgHue: 1, bgSat: 1 };
    for (const bad of [null, 'dark', {}, { ...ok, base: 'sepia' }, { ...ok, textHue: 'x' }, { ...ok, textSat: NaN },
      { ...ok, bgHue: Infinity }, { ...ok, bgSat: undefined },
      { base: 'dark', hue: 220, tint: 40, accent: 30 }]) { // the first dialog's format
      assert.equal(api.normalizeCustom(bad), null, JSON.stringify(bad));
      assert.equal(api.buildCustomPalette(bad), null);
    }
  });

  test('a theme saved with the earlier offset layout {hue, vivid, split, tint} keeps its colors', () => {
    assert.deepEqual(plain(api.normalizeCustom({ base: 'dark', hue: 75, vivid: 40, split: 180, tint: 35 })),
      { base: 'dark', textHue: 75, textSat: 40, bgHue: 255, bgSat: 35 });
    assert.deepEqual(plain(api.normalizeCustom({ base: 'light', hue: 30, vivid: 60, split: -90, tint: 50 })),
      { base: 'light', textHue: 30, textSat: 60, bgHue: 300, bgSat: 50 });
  });

  test('saturation 0 gives neutral gray, whatever the hues', () => {
    const neutral = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) <= 1;
    for (const base of ['light', 'dark']) {
      for (let textHue = 0; textHue < 360; textHue += 15) {
        for (const bgHue of [0, 90, 200, 300]) {
          const p = api.buildCustomPalette({ base, textHue, textSat: 0, bgHue, bgSat: 0 });
          for (const [name, c] of Object.entries(p.colors)) {
            assert.ok(neutral(c), `${base} text hue ${textHue} background hue ${bgHue}: ${name} is tinted`);
          }
        }
      }
    }
  });

  /* The dialog names four sliders by what they change; each must change
     only that. (An earlier "Text color" slider also turned the background.) */
  test('each slider changes only what it names', () => {
    const TEXT = ['--text', '--text-muted', '--text-dim', '--accent', '--border', '--border-md',
      '--scrollbar', '--selection', '--flash-rgb'];
    const BACKGROUND = ['--bg', '--bg-rgb', '--bg-panel-rgb', '--editor-bg-start', '--editor-bg-end', '--bg-panel',
      '--bg-hover', '--theme-divider', '--theme-divider-hover', '--menu-bg'];
    assert.deepEqual([...TEXT, ...BACKGROUND].sort(), [...api.CUSTOM_VARS].sort(), 'every variable is text or background');
    const start = { textHue: 75, textSat: 40, bgHue: 255, bgSat: 35 };
    const moves = { textHue: [0, 140, 300], textSat: [0, 90], bgHue: [0, 75, 180], bgSat: [0, 100] };
    for (const base of ['light', 'dark']) {
      const p0 = api.buildCustomPalette({ base, ...start }).vars;
      for (const [key, values] of Object.entries(moves)) {
        const own = key.startsWith('text') ? TEXT : BACKGROUND;
        const other = key.startsWith('text') ? BACKGROUND : TEXT;
        for (const v of values) {
          const p = api.buildCustomPalette({ base, ...start, [key]: v }).vars;
          for (const name of other) assert.equal(p[name], p0[name], `${base} ${key} → ${v} changed ${name}`);
          assert.ok(own.some((name) => p[name] !== p0[name]), `${base} ${key} → ${v} changed nothing it names`);
        }
      }
    }
  });

  /* Text colors come from (base, textHue, textSat) and surfaces from
     (base, bgHue, bgSat), independently, so ANY text color can meet ANY
     surface. So the worst pair is the most extreme text luminance against
     the most extreme surface luminance — both computed over every control
     position below, which makes this check exact for all combinations. */
  test('every control combination stays readable', () => {
    const failures = [];
    const need = (what, value, min) => { if (!(value >= min)) failures.push(`${what}: ${value.toFixed(2)} < ${min}`); };
    const SURFACES = ['bg', 'end', 'panel', 'menu', 'hover'];
    for (const base of ['light', 'dark']) {
      const dark = base === 'dark';
      /* Extreme luminance per text role over every text color + saturation. */
      const roleY = {};
      for (const role of ['text', 'muted', 'accent']) {
        let lo = Infinity, hi = -Infinity;
        for (let hue = 0; hue < 360; hue++) {
          for (let sat = 0; sat <= 100; sat++) {
            const y = lum(api.textColor(base, role, hue, sat));
            if (y < lo) lo = y;
            if (y > hi) hi = y;
          }
        }
        roleY[role] = { lo, hi };
      }
      /* Extreme luminance per surface over every background color and saturation,
         plus the checks that involve surfaces only. */
      const surfY = Object.fromEntries(SURFACES.map((n) => [n, { lo: Infinity, hi: -Infinity }]));
      for (let bgHue = 0; bgHue < 360; bgHue++) {
        for (let bgSat = 0; bgSat <= 100; bgSat++) {
          const p = api.buildCustomPalette({ base, textHue: 0, textSat: 0, bgHue, bgSat });
          const c = p.colors, where = `${base} background hue ${bgHue} saturation ${bgSat}`;
          assert.equal(p.dark, dark);
          assert.equal(lum(c.bg) < 0.2, dark, `${where}: html.dark must match the background lightness`);
          for (const n of SURFACES) {
            const y = lum(c[n]);
            if (y < surfY[n].lo) surfY[n].lo = y;
            if (y > surfY[n].hi) surfY[n].hi = y;
          }
          /* Editor gradient: darker toward the bottom, visible but gentle. */
          assert.ok(lum(c.end) < lum(c.bg), `${where}: gradient end must be darker than its start`);
          const g = contrast(c.bg, c.end);
          if (g < 1.03 || g > 1.35) failures.push(`${where}: gradient contrast ${g.toFixed(3)} outside 1.03–1.35`);
        }
      }
      /* Every text role sits on one side of every surface … */
      for (const role of Object.keys(roleY)) {
        for (const n of SURFACES) {
          if (dark) assert.ok(roleY[role].lo > surfY[n].hi, `${base}: some ${role} color is darker than some ${n}`);
          else assert.ok(roleY[role].hi < surfY[n].lo, `${base}: some ${role} color is lighter than some ${n}`);
        }
      }
      /* … so the worst contrast is between the two extremes. */
      const worst = (role, n) => (dark ? ratio(roleY[role].lo, surfY[n].hi) : ratio(roleY[role].hi, surfY[n].lo));
      for (const n of SURFACES) {
        const hover = n === 'hover';
        need(`${base} text on ${n}`, worst('text', n), 7);
        need(`${base} muted text on ${n}`, worst('muted', n), hover ? 4 : 4.5);
        need(`${base} highlight on ${n}`, worst('accent', n), hover ? 3 : 4.5);
      }
      /* Selection band (text color at a fixed alpha): must stay visible.
         Translucent, so checked on a dense grid rather than by bounds. */
      const a = api.buildCustomPalette({ base, textHue: 0, textSat: 0, bgHue: 0, bgSat: 0 }).alpha.selection;
      const grounds = [];
      for (let bgHue = 0; bgHue < 360; bgHue += 10) {
        for (let bgSat = 0; bgSat <= 100; bgSat += 10) {
          const c = api.buildCustomPalette({ base, textHue: 0, textSat: 0, bgHue, bgSat }).colors;
          grounds.push([c.bg, `${bgHue}/${bgSat}`], [c.end, `${bgHue}/${bgSat} gradient end`]);
        }
      }
      let selMin = Infinity, selWhere = '';
      for (let hue = 0; hue < 360; hue += 10) {
        for (let sat = 0; sat <= 100; sat += 10) {
          const t = api.textColor(base, 'text', hue, sat);
          for (const [s, name] of grounds) {
            const v = contrast(over(t, a, s), s);
            if (v < selMin) { selMin = v; selWhere = `text ${hue}/${sat} on ${name}`; }
          }
        }
      }
      need(`${base} selection visibility (${selWhere})`, selMin, 1.5);
    }
    assert.deepEqual(failures, []);
  });

  test('the dialog text tracks paint with the generator: the color shown is the color applied', () => {
    for (const base of ['light', 'dark']) {
      for (const [textHue, textSat] of [[0, 0], [75, 40], [250, 100], [359, 63]]) {
        const p = api.buildCustomPalette({ base, textHue, textSat, bgHue: 123, bgSat: 50 });
        assert.deepEqual(plain(p.colors.text), plain(api.textColor(base, 'text', textHue, textSat)));
        assert.equal(p.vars['--text'], api.hex(api.textColor(base, 'text', textHue, textSat)));
        assert.equal(p.vars['--flash-rgb'], p.colors.accent.join(', '), 'the click flash follows the highlight');
      }
    }
  });
});

describe('theme boot and live switching', () => {
  const custom = { base: 'light', textHue: 30, textSat: 60, bgHue: 180, bgSat: 60 };

  test('an active custom theme is applied before first paint, on its base palette', () => {
    const t = boot({ settings: { themeMode: 'light', customTheme: custom, customThemeActive: true }, osDark: true });
    assert.equal(t.dataTheme(), 'light', 'data-theme is the base so the base block supplies --bg_oacity');
    assert.equal(t.isCustom(), true);
    assert.equal(t.dark(), false);
    assert.equal(t.colorScheme(), 'light');
    assert.equal(t.propCount(), t.api.CUSTOM_VARS.length);
    assert.equal(t.prop('--bg'), t.api.buildCustomPalette(custom).vars['--bg']);
  });

  test('a saved but inactive custom theme is ignored', () => {
    const t = boot({ settings: { themeMode: 'forest', customTheme: custom, customThemeActive: false } });
    assert.equal(t.dataTheme(), 'forest');
    assert.equal(t.isCustom(), false);
    assert.equal(t.propCount(), 0);
    assert.equal(t.dark(), true);
  });

  test('corrupt or unknown stored values never produce an empty palette', () => {
    const cases = [
      [{ themeMode: 'dark', customTheme: { base: 'dark', textHue: 'x' }, customThemeActive: true }, 'dark'],
      [{ themeMode: 'custom' }, 'light'],   // 'custom' is never a stored mode; falls to System
      [{ themeMode: 'neon' }, 'light'],
      [{ themeMode: 42 }, 'light'],
    ];
    for (const [settings, expected] of cases) {
      const t = boot({ settings });
      assert.equal(t.dataTheme(), expected, JSON.stringify(settings));
      assert.equal(t.propCount(), 0, JSON.stringify(settings));
    }
  });

  test('switching custom → built-in removes every inline variable; invalid custom falls back to System', () => {
    const t = boot({ osDark: true });
    t.setThemeMode('custom', { base: 'dark', textHue: 100, textSat: 20, bgHue: 60, bgSat: 20 });
    assert.equal(t.dataTheme(), 'dark');
    assert.equal(t.dark(), true);
    assert.equal(t.propCount(), t.api.CUSTOM_VARS.length);

    t.setThemeMode('paper');
    assert.equal(t.dataTheme(), 'paper');
    assert.equal(t.propCount(), 0);
    assert.equal(t.isCustom(), false);
    assert.equal(t.dark(), false);

    /* Re-selecting custom without parameters reuses the last ones. */
    t.setThemeMode('custom');
    assert.equal(t.prop('--bg'), t.api.buildCustomPalette({ base: 'dark', textHue: 100, textSat: 20, bgHue: 60, bgSat: 20 }).vars['--bg']);

    const fresh = boot({ osDark: true });
    fresh.setThemeMode('custom', { base: 'nope' });
    assert.equal(fresh.dataTheme(), 'dark', 'System follows the OS (dark here)');
    assert.equal(fresh.propCount(), 0);

    fresh.setThemeMode('bogus');
    assert.equal(fresh.dataTheme(), 'dark');
  });
});
