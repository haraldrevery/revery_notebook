/* In-page driver for the theme E2E check (evaluated by web_e2e_main.js,
   once per OS color scheme). Switches palettes through the same runtime
   setter the Theme menu uses and measures what the user actually sees:
   computed colors composited over the palette background, as WCAG
   contrast ratios. Everything light/dark-dependent must follow the APP
   palette (html.dark), never the OS setting — the old prose stylesheet
   followed the OS and painted white footnotes on light themes.
   Must be a single expression resolving to a serializable object. */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const view = window.cmView;
  const root = document.documentElement;

  /* Any CSS color (rgb, rgba, oklch …) → composited [r, g, b] over an
     opaque backdrop, via a 1×1 canvas (the browser does the parsing). */
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const over = (fg, backdrop) => {
    cx.globalCompositeOperation = 'source-over';
    cx.fillStyle = '#000'; cx.fillStyle = backdrop; cx.fillRect(0, 0, 1, 1);
    cx.fillStyle = '#000'; cx.fillStyle = fg;       cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const lum = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (a, b) => {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const round = (x) => Math.round(x * 100) / 100;
  const cssVar = (name) => getComputedStyle(root).getPropertyValue(name).trim();

  const DOC = [
    '# Heading', '',
    'Body text with a footnote[^1] and `inline code` here.', '',
    '```js', 'const x = "str"; // comment', 'function f(a) { return a + 1; }', '```', '',
    '[link](https://example.com)', '',
    '[^1]: The footnote text.', '',
  ].join('\n');
  replaceEditorContent(DOC);
  await sleep(700);

  /* Measure the palette currently applied. */
  const measure = async () => {
    await sleep(250);
    const bg = over(cssVar('--bg'), '#808080');
    const editorBg = over(cssVar('--editor-bg-start'), '#808080');
    const pv = document.getElementById('preview');
    const sup = pv.querySelector('sup a');
    const li = pv.querySelector('.footnotes li');
    const p = pv.querySelector('p');

    /* Selection band in the classic editor. */
    view.dispatch({ selection: { anchor: 12, head: 40 } });
    view.coordsAtPos(12); // run CM's measure cycle (hidden window)
    await sleep(120);
    const band = document.querySelector('#editor .cm-selectionBackground');
    const selColor = band ? getComputedStyle(band).backgroundColor : null;

    /* Lowest-contrast token inside the code fence of the classic editor. */
    const spans = Array.from(document.querySelectorAll('#editor .cm-line span'))
      .filter((s) => /const|str|comment|function|return|x|f|a|1/.test(s.textContent));
    const codeMin = spans.length
      ? Math.min(...spans.map((s) => contrast(over(getComputedStyle(s).color, cssVar('--editor-bg-start')), editorBg)))
      : null;

    /* The background-image overlay must be tinted with this palette's
       own --bg (the rgba literals used to be hand-copied per theme). */
    const overlay = getComputedStyle(pv).backgroundImage;
    const m = /rgba?\(([^)]*)\)/.exec(overlay);
    const overlayRgb = m ? m[1].split(',').slice(0, 3).map((n) => Math.round(parseFloat(n))) : null;

    /* Click flashes: the editor selection blink (#editor.highlight-flash)
       and the preview block flash, frozen at its peak (35% of 0.55 s). */
    const rgbOf = (c) => ((/rgba?\(([^)]*)\)/.exec(c || '') || [])[1] || '')
      .split(',').slice(0, 3).map((n) => Math.round(parseFloat(n))).join(',');
    view.dom.classList.add('highlight-flash');
    const flashBand = document.querySelector('#editor .cm-selectionBackground');
    const editorFlash = flashBand ? rgbOf(getComputedStyle(flashBand).backgroundColor) : null;
    view.dom.classList.remove('highlight-flash');
    p.style.animation = 'previewFlash 0.55s linear -0.1925s paused';
    const previewFlash = rgbOf(getComputedStyle(p).backgroundColor);
    p.style.animation = '';

    /* One text color: every text the prose stylesheet used to force to
       black/white follows --text (or --text-muted for list numbers). */
    const same = (c, v) => over(c, cssVar('--bg')).join(',') === over(cssVar(v), cssVar('--bg')).join(',');
    const code = pv.querySelector('p code');
    const oneTextColor = !!(sup && li && code)
      && same(getComputedStyle(sup).color, '--text')
      && same(getComputedStyle(li).color, '--text')
      && same(getComputedStyle(code).color, '--text')
      && same(getComputedStyle(li, '::marker').color, '--text-muted')
      && spans.every((sp) => same(getComputedStyle(sp).color, '--text'));

    return {
      dataTheme: root.getAttribute('data-theme'),
      darkClass: root.classList.contains('dark'),
      bgIsDark: lum(bg) < 0.2,
      body: round(contrast(over(getComputedStyle(p).color, cssVar('--bg')), bg)),
      footnoteRef: sup ? round(contrast(over(getComputedStyle(sup).color, cssVar('--bg')), bg)) : null,
      footnoteMarker: li ? round(contrast(over(getComputedStyle(li, '::marker').color, cssVar('--bg')), bg)) : null,
      footnoteText: li ? round(contrast(over(getComputedStyle(li).color, cssVar('--bg')), bg)) : null,
      selection: selColor ? round(contrast(over(selColor, cssVar('--editor-bg-start')), editorBg)) : null,
      editorCodeMin: codeMin == null ? null : round(codeMin),
      overlayMatchesBg: !!overlayRgb && overlayRgb.join(',') === bg.join(','),
      flashVar: cssVar('--flash-rgb').replace(/\s/g, ''),
      editorFlash,
      previewFlash,
      oneTextColor,
    };
  };

  const R = {
    osDark: matchMedia('(prefers-color-scheme: dark)').matches,
    builtIn: {},
  };
  for (const t of ['light', 'paper', 'dark', 'forest']) {
    window.setThemeMode(t);
    R.builtIn[t] = await measure();
  }

  /* Custom palettes: the defaults, all-gray, and the extremes of the
     sliders (full text and background saturation, same and opposite hues). */
  R.custom = {};
  const CUSTOMS = {
    'dark default': window.ReveryTheme.DEFAULT_CUSTOM,
    'dark vivid blue on full opposite tint': { base: 'dark', textHue: 265, textSat: 100, bgHue: 85, bgSat: 100 },
    'dark vivid red on same hue': { base: 'dark', textHue: 25, textSat: 100, bgHue: 25, bgSat: 100 },
    'light gray': { base: 'light', textHue: 0, textSat: 0, bgHue: 0, bgSat: 0 },
    'light vivid yellow on full tint': { base: 'light', textHue: 100, textSat: 100, bgHue: 100, bgSat: 100 },
    'light navy on warm': { base: 'light', textHue: 250, textSat: 60, bgHue: 100, bgSat: 40 },
  };
  for (const [name, params] of Object.entries(CUSTOMS)) {
    window.setThemeMode('custom', params);
    R.custom[name] = await measure();
  }

  /* In-app PDF print (Tauri / web) renders the export INSIDE the live page,
     where the app's theme rules could reach it: the lowest text contrast
     on white paper, per palette. */
  R.print = {};
  const realPrint = window.print;
  window.print = () => {};
  const printThemes = { light: ['light'], dark: ['dark'], forest: ['forest'],
    'custom dark': ['custom', CUSTOMS['dark vivid blue on full opposite tint']] };
  for (const [name, args] of Object.entries(printThemes)) {
    window.setThemeMode(...args);
    await sleep(80);
    window.exporterPrintInApp({ frontPage: false, toc: false, font: 'serif' });
    await sleep(120);
    const pr = document.getElementById('export-print-root');
    const texts = pr ? Array.from(pr.querySelectorAll('main p, main li, main h1, main sup a, main .footnotes, main blockquote')) : [];
    const markers = pr ? Array.from(pr.querySelectorAll('main li')).map((li) => getComputedStyle(li, '::marker').color) : [];
    const colors = texts.map((el) => getComputedStyle(el).color).concat(markers);
    R.print[name] = colors.length
      ? round(Math.min(...colors.map((c) => contrast(over(c, '#fff'), [255, 255, 255]))))
      : 'no print root';
    /* printInApp calls window.print() 200 ms after it starts; let the stub
       take that call before tearing down, or the REAL print dialog opens
       later and blocks the renderer. */
    await sleep(200);
    window.dispatchEvent(new Event('afterprint'));
    await sleep(60);
  }
  window.print = realPrint;

  /* ── The dialog, driven through the real menu and controls ── */
  const settings = () => JSON.parse(localStorage.getItem('revery_md_settings') || '{}');
  const modal = () => document.getElementById('custom-theme-modal');
  const inlineVars = () => window.ReveryTheme.CUSTOM_VARS.filter((v) => root.style.getPropertyValue(v) !== '').length;
  const menuItem = (label) => Array.from(document.querySelectorAll('#settings-dropdown button.menu-item'))
    .find((b) => b.textContent.replace(/^[■\u00a0 ]+/, '') === label);
  const openFromMenu = async () => { menuItem('Custom theme…').click(); await sleep(80); };
  /* The sliders in dialog order, keyed like the stored parameters. */
  const SLIDERS = ['textHue', 'textSat', 'bgHue', 'bgSat'];
  const range = (key) => modal().querySelectorAll('input.ct-range')[SLIDERS.indexOf(key)];
  const controls = () => Object.fromEntries(SLIDERS.map((k) => [k, Number(range(k).value)]));
  const slide = async (key, value) => {
    const input = range(key);
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(40);
  };
  const button = (label) => Array.from(modal().querySelectorAll('button')).find((b) => b.textContent.includes(label));
  const RT = window.ReveryTheme;
  const rgbCss = (c) => `rgb(${c.join(', ')})`; // how inline gradients serialize a color
  const D = {};

  /* Start from a saved built-in theme. */
  menuItem('Paper').click();
  await sleep(50);
  const before = settings();
  const paperText = cssVar('--text');

  await openFromMenu();
  D.opens = !!modal();
  D.startsOnScreenBase = root.getAttribute('data-theme') === 'light'; // Paper is light
  const bgBeforeText = cssVar('--bg');
  await slide('textHue', 120);
  await slide('textSat', 50);
  /* The applied --text is the generator's color for these two sliders,
     the Text saturation track ends in exactly that hue at full saturation,
     and the background did not move (each slider changes only what it
     names). Then the background sliders leave the text alone. */
  D.textSlidersApply = root.hasAttribute('data-custom-theme') && cssVar('--text') !== paperText
    && cssVar('--text') === RT.hex(RT.textColor('light', 'text', 120, 50))
    && range('textSat').style.background.includes(rgbCss(RT.textColor('light', 'text', 120, 100)))
    && cssVar('--bg') === bgBeforeText;
  const textBeforeBg = cssVar('--text');
  await slide('bgHue', 300);
  await slide('bgSat', 80);
  D.bgSlidersApply = cssVar('--text') === textBeforeBg && cssVar('--bg') !== bgBeforeText;

  /* Escape restores Paper and writes nothing. */
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(50);
  D.escapeRestores = !modal() && root.getAttribute('data-theme') === 'paper' && inlineVars() === 0
    && JSON.stringify(settings()) === JSON.stringify(before);

  /* A click outside the dialog is a Cancel too. */
  await openFromMenu();
  await slide('bgSat', 90);
  modal().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await sleep(50);
  D.outsideClickRestores = !modal() && root.getAttribute('data-theme') === 'paper' && inlineVars() === 0;

  /* Save: switch base to dark, set every control, keep. */
  await openFromMenu();
  button('Dark').click();
  await slide('textHue', 200);
  await slide('textSat', 70);
  await slide('bgHue', 110);
  await slide('bgSat', 70);
  const want = { base: 'dark', textHue: 200, textSat: 70, bgHue: 110, bgSat: 70 };
  button('Save').click();
  await sleep(50);
  const saved = settings();
  D.saves = !modal()
    && saved.customThemeActive === true
    && saved.themeMode === 'dark' // the base: older builds still open readable
    && JSON.stringify(saved.customTheme) === JSON.stringify(want)
    && root.getAttribute('data-theme') === 'dark' && root.classList.contains('dark')
    && inlineVars() === RT.CUSTOM_VARS.length
    && cssVar('--bg') === RT.buildCustomPalette(want).vars['--bg'];
  D.menuMarksCustom = menuItem('Custom theme…').textContent.startsWith('■');

  /* The Background opacity override is independent of the palette. */
  const bgBefore = cssVar('--bg');
  window.setBackgroundOpacity(0.3);
  const opSet = root.style.getPropertyValue('--bg_oacity') === '0.3';
  window.setBackgroundOpacity(null);
  D.opacityIndependent = opSet && root.style.getPropertyValue('--bg_oacity') === ''
    && cssVar('--bg') === bgBefore;

  /* Reopening starts from the saved values; Reset keeps the base. */
  await openFromMenu();
  D.reopensWithSaved = JSON.stringify({ base: 'dark', ...controls() }) === JSON.stringify(want);
  button('Reset').click();
  await sleep(50);
  const def = RT.DEFAULT_CUSTOM;
  D.resetKeepsBase = JSON.stringify(controls())
      === JSON.stringify({ textHue: def.textHue, textSat: def.textSat, bgHue: def.bgHue, bgSat: def.bgSat })
    && root.getAttribute('data-theme') === 'dark';
  button('Cancel').click();
  await sleep(50);
  D.cancelRestoresSavedCustom = !modal() && cssVar('--bg') === RT.buildCustomPalette(want).vars['--bg'];

  /* Leaving for a built-in theme clears the palette but keeps the saved
     custom values for next time. */
  menuItem('Light').click();
  await sleep(50);
  const after = settings();
  D.builtInClearsCustom = inlineVars() === 0 && !root.hasAttribute('data-custom-theme')
    && after.themeMode === 'light' && after.customThemeActive === false
    && JSON.stringify(after.customTheme) === JSON.stringify(want);

  R.dialog = D;
  return R;
})()
