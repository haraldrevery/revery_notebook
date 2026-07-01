(function () {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var theme = 'system';
    try {
      var stored = localStorage.getItem('revery_md_settings');
      if (stored) {
        var s = JSON.parse(stored);
        if (s.themeMode) theme = s.themeMode;
      }
    } catch(e) {}

function applyTheme() {
  // 1. Determine the exact active theme state
  var activeTheme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;

  // 2. Apply Custom CSS data-theme attribute (drives all [data-theme="…"] palette blocks)
  document.documentElement.setAttribute('data-theme', activeTheme);

  // 3. Map custom theme names to the two values the browser understands for
  //    colorScheme (scrollbar tint, form controls, etc.).
  //    'paper' is a warm light theme; 'forest' is a dark theme.
  var isDarkTheme = (activeTheme === 'dark' || activeTheme === 'forest');
  document.documentElement.style.colorScheme = isDarkTheme ? 'dark' : 'light';

  // 4. Keep Tailwind (or other framework) strictly synced by managing the .dark class
  if (isDarkTheme) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

    applyTheme();

    mq.addEventListener('change', function (e) {
      if (theme === 'system') applyTheme();
    });

    // Expose the setter so menus.js can update it live without a refresh
    window.setThemeMode = function(newTheme) {
      theme = newTheme;
      applyTheme();
    };
  })();