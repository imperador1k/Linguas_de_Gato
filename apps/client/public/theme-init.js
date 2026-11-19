// Applies the stored theme before first paint to avoid a light/dark flash.
// Keep in sync with src/lib/theme.ts (storage key and values).
(function () {
  var preference = 'system';
  try {
    var stored = window.localStorage.getItem('ldg:theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') preference = stored;
  } catch (_) {
    // Storage can be unavailable (private mode, blocked site data).
  }
  var dark =
    preference === 'dark' ||
    (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
