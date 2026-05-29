// Theme toggle — light / dark with localStorage persistence.

const STORAGE_KEY = 'impeccable-theme';

export function getStoredTheme() {
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredTheme(theme) {
  localStorage.setItem(STORAGE_KEY, theme);
}

export function applyTheme(theme) {
  const html = document.documentElement;
  const resolved = theme === 'light' ? 'light' : 'dark';

  html.classList.remove('light', 'dark');
  html.classList.add(resolved);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', resolved === 'light' ? '#f7f4ef' : '#010101');
  }

  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    const next = resolved === 'light' ? 'dark' : 'light';
    btn.setAttribute('aria-label', resolved === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    btn.setAttribute('title', resolved === 'light' ? 'Dark mode' : 'Light mode');
    btn.dataset.nextTheme = next;
  });
}

export function initThemeToggle() {
  const stored = getStoredTheme();
  applyTheme(stored === 'light' ? 'light' : 'dark');

  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.nextTheme || (document.documentElement.classList.contains('light') ? 'dark' : 'light');
      setStoredTheme(next);
      applyTheme(next);
    });
  });
}
