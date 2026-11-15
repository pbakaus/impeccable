// When a walk pauses itself for a sign-in. Fixed code, checked in the extension before any picture is taken: nothing a
// page shows the persona, and nothing the server asks, changes it. A page can fake a sign-in, but that only pauses
// the walk, which is the safe way to be wrong.
//
// The signs, each enough on its own:
//   - the top-level document is going to, or is on, one of SIGN_IN_PAGES;
//   - a password field is visible in the top document, a frame on its origin, or an open shadow root in either (a
//     closed one is not seen), unless its form only changes a password (`lookInPage`); and not on a page the person
//     already pressed Continue on at a sign-in (driver.js `signInShows`);
//   - the top document answered 401 and asked for a password (`WWW-Authenticate`), or is that 401's page.
// A passkey prompt is not one of them: Chrome tells an extension nothing of a real one. The debugger's WebAuthn domain
// would swap the person's own authenticators for virtual ones, and wrapping `navigator.credentials` means running in
// the page's own world, which a walk never does.

/** Where people sign in to other services: a host, every host under a domain (`.okta.com`), or a host's sign-in paths. */
export const SIGN_IN_PAGES = [
  { host: 'accounts.google.com' },
  { host: 'login.microsoftonline.com' },
  { host: 'login.live.com' },
  { host: 'appleid.apple.com' },
  { host: 'idmsa.apple.com' },
  { host: 'github.com', paths: ['/login', '/session', '/sessions/'] },
  { domain: 'okta.com' },
  { domain: 'auth0.com' },
];

/** Whether an address is one of SIGN_IN_PAGES. */
export function isSignInPage(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  return SIGN_IN_PAGES.some((page) => {
    if (page.domain) return host.endsWith(`.${page.domain}`);
    if (host !== page.host) return false;
    return !page.paths || page.paths.some((path) => parsed.pathname === path.replace(/\/$/, '') || parsed.pathname.startsWith(path));
  });
}

/** Whether a document's response asks for a password: a 401 with a challenge. */
export function asksForPassword(response) {
  if (response?.status !== 401) return false;
  return Object.keys(response.headers ?? {}).some((name) => name.toLowerCase() === 'www-authenticate');
}

/**
 * Runs in the walked tab, in a world of the walk's own (never the page's), and reads the page for the signs above and
 * for where typing would land. Self-contained: it is sent as text. Answers `{ password, filled, status, focus }`: whether a
 * password field is visible, whether one holds a password, the top document's HTTP status, and what has focus when typing must not reach it
 * (`password`, `card`, `code`, or `frame` for a frame on another origin), else null.
 */
export function lookInPage() {
  // The documents and open shadow roots to read, found in one pass over each.
  const roots = [document];
  for (let at = 0; at < roots.length; at++) {
    for (const el of roots[at].querySelectorAll('*')) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        try { if (el.contentDocument) roots.push(el.contentDocument); } catch { /* another origin's */ }
      }
    }
  }
  const visible = (field) => {
    const box = field.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && (field.checkVisibility ? field.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true);
  };
  // A form of two or more password fields and nothing to name an account by (no text, email or phone field) changes
  // a password on a page already signed in to (a settings page): not a sign-in. A lone one (asked again), or one beside
  // a name or an email (signing in, signing up), is.
  const changing = (field, root) => {
    const types = [...(field.form ?? root).querySelectorAll('input')].filter(visible).map((input) => String(input.type).toLowerCase());
    return types.filter((type) => type === 'password').length >= 2 && !types.some((type) => type === 'text' || type === 'email' || type === 'tel');
  };
  // A password in a field (typed or filled) always pauses the walk: nothing it runs may read it.
  const fields = roots.flatMap((root) => [...root.querySelectorAll('input[type="password" i]')].filter(visible).map((field) => ({ field, root })));
  const filled = fields.some(({ field }) => Boolean(field.value));
  const password = fields.some(({ field, root }) => Boolean(field.value) || !changing(field, root));

  let focus = null;
  let el = document.activeElement;
  for (;;) {
    if (el?.shadowRoot?.activeElement) { el = el.shadowRoot.activeElement; continue; }
    if (el && (el.tagName === 'IFRAME' || el.tagName === 'FRAME')) {
      let inner = null;
      try { inner = el.contentDocument; } catch { /* another origin's */ }
      if (!inner) { focus = 'frame'; break; }
      el = inner.activeElement;
      continue;
    }
    break;
  }
  if (!focus && el) {
    const tokens = String(el.getAttribute?.('autocomplete') ?? '').toLowerCase().split(/\s+/);
    if (el.tagName === 'INPUT' && String(el.type).toLowerCase() === 'password') focus = 'password';
    else if (tokens.some((token) => token.startsWith('cc-'))) focus = 'card';
    else if (tokens.includes('one-time-code')) focus = 'code';
  }
  const status = performance.getEntriesByType('navigation')[0]?.responseStatus ?? 0;
  return { password, filled, status, focus };
}

/** Whether what {@link lookInPage} saw is a sign-in. */
export const signingIn = (seen) => seen?.password === true || seen?.status === 401;
