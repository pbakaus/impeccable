// Theme switcher — three-way: auto / light / dark with localStorage persistence.
// "auto" (the default) inherits from the OS via prefers-color-scheme and is only
// overridden once the user clicks the toggle. Clicking cycles auto → light → dark → auto.

const STORAGE_KEY = 'impeccable-theme';

export function getStoredPref() {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' ? v : 'auto';
}

export function setStoredPref(pref) {
  if (pref === 'auto') localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, pref);
}

function systemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function resolveTheme(pref) {
  return pref === 'auto' ? systemTheme() : pref;
}

const LABELS = {
  auto: 'Theme: auto, matching your system. Click to switch to light mode.',
  light: 'Theme: light. Click to switch to dark mode.',
  dark: 'Theme: dark. Click to switch back to auto.',
};

const TITLES = {
  auto: 'Theme: auto (matches system)',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

export function applyTheme(pref) {
  const html = document.documentElement;
  const resolved = resolveTheme(pref);

  html.classList.remove('light', 'dark');
  html.classList.add(resolved);
  html.setAttribute('data-theme-pref', pref);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', resolved === 'light' ? '#f7f4ef' : '#010101');
  }

  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.setAttribute('aria-label', LABELS[pref]);
    btn.setAttribute('title', TITLES[pref]);
  });
}

function nextPref(pref) {
  return pref === 'auto' ? 'light' : pref === 'light' ? 'dark' : 'auto';
}

export function initThemeToggle() {
  applyTheme(getStoredPref());

  // While in auto, follow the OS as it flips.
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      if (getStoredPref() === 'auto') applyTheme('auto');
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = nextPref(getStoredPref());
      setStoredPref(next);
      applyTheme(next);
    });
  });
}
