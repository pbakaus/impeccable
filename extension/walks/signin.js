// When a walk pauses itself for a sign-in. Fixed code, checked in the extension before any picture is taken: nothing a
// page shows the persona, and nothing the server asks, changes it. A page can fake a sign-in, but that only pauses
// the walk, which is the safe way to be wrong.
//
// The signs, each enough on its own:
//   - the top-level document is going to, or is on, one of SIGN_IN_PAGES;
//   - a password field (or one for a password or a one-time code by its `autocomplete`) is visible in the top
//     document, a frame on its origin, or an open shadow root in either (a closed one is not seen), unless its form
//     only changes a password (`lookInPage`); and not on a page the person already pressed Continue on at a sign-in
//     (driver.js `signInShows`);
//   - any such field, shown or hidden, holds a value or Chrome's autofill: always, Continue or not; a password field
//     a "show password" button made text still counts, by the mark `lookInPage` gave it when it saw it;
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
  // A password field, one marked as one when seen, one that says it takes a password or a one-time code whatever
  // its type, or a text field whose name, id, placeholder and label read as a password and not as an email (a reset
  // field): a "show password" toggle turns it to text, so each password field is marked at every look, before the
  // person can show it (the cover keeps it covered by the same mark); a code step is a text field.
  const MARK = 'data-secret-field';
  for (const root of roots) for (const field of root.querySelectorAll(`input[type="password" i]:not([${MARK}])`)) field.setAttribute(MARK, '');
  const NAMED = ['name', 'id', 'placeholder', 'aria-label'];
  const words = (input) => NAMED.map((name) => input.getAttribute?.(name) ?? '').join(' ');
  const named = (input) => String(input.type).toLowerCase() === 'text' && /passw|pwd/i.test(words(input)) && !/mail/i.test(words(input));
  const SECRET = ['current-password', 'new-password', 'one-time-code'];
  const secret = (input) => String(input.type).toLowerCase() === 'password' || input.getAttribute?.(MARK) != null || String(input.getAttribute?.('autocomplete') ?? '').toLowerCase().split(/\s+/).some((token) => SECRET.includes(token)) || named(input);
  // A "show password" button that swaps in a new text field instead puts it where the password field was: the element
  // round each password field (and the one above, when that element is the field's own wrapper) keeps how many children
  // it has and which of them hold a password field (counted as the cover counts them), and whether each held one. At
  // the next look, with as many children, a text field in such a place (or alone in it) that names no account is marked
  // if it holds something, so the walk stays paused on this page; one still empty and named for nothing, where the
  // password field was empty too, waits to be typed into. Anything else ends it: a field that was beside the password,
  // or a next step drawn where it was, is plain.
  const SPOT = 'data-secret-spot';
  const passwordField = (f) => String(f.type).toLowerCase() === 'password' || f.getAttribute(MARK) !== null || /current-password|new-password/i.test(f.getAttribute('autocomplete') ?? '') || named(f);
  const account = (f) => {
    const said = `${words(f)} ${f.getAttribute('autocomplete') ?? ''}`;
    return ['email', 'tel'].includes(String(f.type).toLowerCase()) || (/user|mail|login|phone|account/i.test(said) && !/pass|pwd/i.test(said));
  };
  for (const root of roots) {
    for (const f of root.querySelectorAll('input')) if (f.getAttribute(MARK) === null && passwordField(f)) f.setAttribute(MARK, '');
    for (const box of root.querySelectorAll(`[${SPOT}]`)) {
      const [count, ...at] = (box.getAttribute(SPOT) ?? '').split(' ');
      const waits = Number(count) !== box.children.length ? [] : at.filter((i) => {
        const el = box.children[parseInt(i, 10)];
        const f = el?.tagName === 'INPUT' ? el : el?.querySelectorAll('input').length === 1 ? el.querySelectorAll('input')[0] : undefined;
        if (!f || String(f.type).toLowerCase() !== 'text' || passwordField(f) || account(f)) return false;
        if (f.value) f.setAttribute(MARK, '');
        return !f.value && !i.endsWith('f') && !words(f).trim();
      });
      if (waits.length) box.setAttribute(SPOT, `${count} ${waits.join(' ')}`);
      else box.removeAttribute(SPOT);
    }
    // Its parent, and the one above when the parent is the field's own wrapper (a swap may replace the wrapper).
    for (const field of root.querySelectorAll('input')) {
      if (!passwordField(field)) continue;
      for (let el = field, box = field.parentElement, up = 0; box && up < 2; el = box, box = box.parentElement, up++) {
        const i = [...box.children].indexOf(el);
        const [, ...at] = (box.getAttribute(SPOT) ?? '').split(' ').filter((t, n) => n === 0 || parseInt(t, 10) !== i);
        box.setAttribute(SPOT, [box.children.length, ...at, `${i}${field.value ? 'f' : ''}`].join(' '));
        if (box.querySelectorAll('input').length > 1) break;
      }
    }
  }
  const changing = (field, root) => {
    const inputs = [...(field.form ?? root).querySelectorAll('input')].filter(visible);
    return inputs.filter(secret).length >= 2 && !inputs.some((input) => !secret(input) && ['text', 'email', 'tel'].includes(String(input.type).toLowerCase()));
  };
  // Chrome keeps an autofilled value from scripts (`value` is empty) until the person acts: the filled look counts too.
  const autofilled = (field) => ['autofill', '-webkit-autofill'].some((state) => { try { return field.matches(`:${state}`); } catch { return false; } });
  const fields = roots.flatMap((root) => [...root.querySelectorAll('input')].filter(secret).map((field) => ({ field, root })));
  // A password in a field, typed or filled, shown or hidden, always pauses the walk: nothing it runs may read it.
  // A disabled or read-only field holds no password the person typed or had filled (a "••••••" placeholder).
  const filled = fields.some(({ field }) => !field.disabled && !field.readOnly && (Boolean(field.value) || autofilled(field)));
  const password = filled || fields.some(({ field, root }) => visible(field) && !field.disabled && !changing(field, root));

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
    if (el.tagName === 'INPUT' && (String(el.type).toLowerCase() === 'password' || el.getAttribute?.(MARK) != null || tokens.some((token) => token === 'current-password' || token === 'new-password') || named(el))) focus = 'password';
    else if (tokens.some((token) => token.startsWith('cc-'))) focus = 'card';
    else if (tokens.includes('one-time-code')) focus = 'code';
  }
  const status = performance.getEntriesByType('navigation')[0]?.responseStatus ?? 0;
  return { password, filled, status, focus };
}

/** Whether what {@link lookInPage} saw is a sign-in. */
export const signingIn = (seen) => seen?.password === true || seen?.status === 401;
