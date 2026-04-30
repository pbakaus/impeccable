// Theme toggle - supports light, dark, and system preference

const STORAGE_KEY = 'impeccable-theme';

function getStoredTheme() {
  return localStorage.getItem(STORAGE_KEY);
}

function setStoredTheme(theme) {
  localStorage.setItem(STORAGE_KEY, theme);
}

function applyTheme(theme) {
  const html = document.documentElement;

  // Remove both classes first
  html.classList.remove('light', 'dark');

  if (theme === 'light') {
    html.classList.add('light');
  } else if (theme === 'dark') {
    html.classList.add('dark');
  }
  // 'system' = no class, falls back to media query

  // Update active state on buttons
  document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

export function initThemeToggle() {
  const toggle = document.querySelector('.theme-toggle');
  if (!toggle) return;

  // Get stored theme or default to system
  const storedTheme = getStoredTheme() || 'system';
  applyTheme(storedTheme);

  // Handle button clicks
  toggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-toggle-btn');
    if (!btn) return;

    const theme = btn.dataset.theme;
    setStoredTheme(theme);
    applyTheme(theme);
  });

  // Listen for system preference changes (only matters when in 'system' mode)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStoredTheme() === 'system' || !getStoredTheme()) {
      applyTheme('system');
    }
  });
}
