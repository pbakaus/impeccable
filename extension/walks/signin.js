// When a walk pauses itself for a sign-in. Fixed code, checked in the extension before any picture is taken: nothing a
// page shows the persona, and nothing the server asks, changes it. A page can fake a sign-in, but that only pauses
// the walk, which is the safe way to be wrong.
//
// The signs, each enough on its own:
//   - the top-level document is going to, or is on, one of SIGN_IN_PAGES;
//   - a password field (or one for a password or a one-time code by its `autocomplete`, or a text field named for a
//     password) is visible in the top document, a frame on its origin, or an open shadow root in either (a closed one
//     is not seen), unless its form
//     only changes a password (`lookInPage`); and not on a page the person already pressed Continue on at a sign-in
//     (driver.js `signInShows`);
//   - a password field (not one only named for a password), shown or hidden, holds a value or Chrome's autofill:
//     always, Continue or not; one a "show password" button made text still counts, by the mark `lookInPage` gave it
//     when it saw it; on a walk whose server names no helpers and sends its own code, any filled field that may hold
//     a password too (`maybe`: one named for a password, or one a "show password" swap put in), until Continue;
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
  // Two rules, as the picture cover keeps them: a password field (`type=password`, one marked as one when seen,
  // or one whose `autocomplete` takes a password or a one-time code) is never typed into and, filled, holds the walk
  // paused past Continue; a text field named for one (by name, id, placeholder or label) pauses the walk too, which
  // Continue lets go. A "show password" toggle turns a password field to text, so each is marked at every look, before
  // the person can show it. The marks stay once the walk lets go of the tab: a later walk there still knows a password
  // shown since, which it could not tell from text.
  const MARK = 'data-impeccable-secret-field';
  const NAMED = ['name', 'id', 'placeholder', 'aria-label'];
  const kind = (f) => String(f.type).toLowerCase();
  // Plain text by the browser's own type (an empty, unknown or padded one is text): an email, number or search field
  // named for a password is no sign-in.
  const named = (input) => kind(input) === 'text' && NAMED.some((name) => /passw|pwd/i.test(input.getAttribute?.(name) ?? ''));
  const SECRET = ['current-password', 'new-password', 'one-time-code'];
  const secret = (input) => kind(input) === 'password' || input.getAttribute?.(MARK) != null || String(input.getAttribute?.('autocomplete') ?? '').toLowerCase().split(/\s+/).some((token) => SECRET.includes(token));
  // A "show password" button that swaps in a new text field instead, as the cover marks it: the boxes round each
  // password field, marked or named for one (its form, or the elements round it up to the first that
  // holds an account field, two when none does, never `<html>`, and `<body>` only round a field right in it) keep how
  // many they held and showed, and whether one held an account field. While a box holds fewer and a marked account
  // field is still in it, or it never held one, each filled, shown text field in it that names no account is marked as
  // one that may hold a secret (while it only shows fewer, each beside a hidden one or holding what it holds: a clone
  // shown): covered and never read, and a pause Continue lets go only when the server sends its own code (`maybe`).
  // That mark is no password field, so a box keeps watching for the password typed after a filled name took it. A false
  // mark costs a black box, a miss a password, so every such box marks. A search box in a page's header stays plain
  // once a sign-in below it went (unless an element round both holds the account field), and so does a checkout whose
  // account section was only hidden.
  const MAYBE = 'data-impeccable-secret-maybe';
  const HELD = 'data-impeccable-secret-form';
  const inputs = (box) => [...box.querySelectorAll('input')];
  const shown = (f) => { const size = f.getBoundingClientRect(); return size.width > 0 && size.height > 0; };
  const counts = (f) => f.getAttribute(MARK) !== null || named(f);
  const passwords = (box, all) => inputs(box).filter((f) => counts(f) && (all || shown(f))).length;
  const account = (f) => {
    const said = [...NAMED, 'autocomplete'].map((name) => f.getAttribute(name) ?? '').join(' ');
    return ['email', 'tel'].includes(kind(f)) || (/user|mail|login|phone|account/i.test(said) && !/pass|pwd/i.test(said));
  };
  for (const root of roots) {
    for (const f of inputs(root)) if (f.getAttribute(MARK) === null && (kind(f) === 'password' || /current-password|new-password/i.test(f.getAttribute('autocomplete') ?? ''))) f.setAttribute(MARK, '');
    for (const box of root.querySelectorAll(`[${HELD}]`)) {
      const [most, mostShown, had] = (box.getAttribute(HELD) ?? '').split(' ');
      const gone = passwords(box, true) < Number(most);
      const all = inputs(box);
      if ((!gone && passwords(box, false) >= Number(mostShown)) || (had && !all.some((f) => f.getAttribute(`${HELD}-name`) !== null))) continue;
      // One gone: any filled field may be the one swapped in. One only hidden: a shown clone, beside it or holding what it holds.
      const hidden = all.filter((f) => counts(f) && !shown(f));
      const clone = (f) => hidden.some((h) => h.parentElement === f.parentElement || (Boolean(h.value) && h.value === f.value));
      for (const f of all) if (kind(f) === 'text' && f.value && shown(f) && !account(f) && f.getAttribute(MARK) === null && (gone || clone(f))) f.setAttribute(MAYBE, '');
    }
    for (const field of inputs(root)) {
      if (!counts(field)) continue;
      const round = [];
      for (let box = field.form ? null : field.parentElement; box && box.tagName !== 'HTML' && (box.tagName !== 'BODY' || box === field.parentElement); box = box.parentElement) round.push(box);
      const upTo = round.findIndex((box) => inputs(box).some(account));
      for (const box of field.form ? [field.form] : round.slice(0, upTo < 0 ? 2 : upTo + 1)) {
        const accounts = inputs(box).filter(account);
        for (const f of accounts) f.setAttribute(`${HELD}-name`, '');
        const [most, mostShown, had] = (box.getAttribute(HELD) ?? '').split(' ');
        box.setAttribute(HELD, `${Math.max(Number(most) || 0, passwords(box, true))} ${Math.max(Number(mostShown) || 0, passwords(box, false))}${had || accounts.length ? ' named' : ''}`);
      }
    }
  }
  const pw = (input) => secret(input) || named(input);
  const changing = (field, root) => {
    const inputs = [...(field.form ?? root).querySelectorAll('input')].filter(visible);
    return inputs.filter(pw).length >= 2 && !inputs.some((input) => !pw(input) && ['text', 'email', 'tel'].includes(String(input.type).toLowerCase()));
  };
  // Chrome keeps an autofilled value from scripts (`value` is empty) until the person acts: the filled look counts too.
  const autofilled = (field) => ['autofill', '-webkit-autofill'].some((state) => { try { return field.matches(`:${state}`); } catch { return false; } });
  const fields = roots.flatMap((root) => [...root.querySelectorAll('input')].filter(pw).map((field) => ({ field, root })));
  // A password in a password field, typed or filled, shown or hidden, always pauses the walk: nothing it runs may read it.
  // A disabled or read-only field holds no password the person typed or had filled (a "••••••" placeholder).
  const holds = (field) => !field.disabled && !field.readOnly && (Boolean(field.value) || autofilled(field));
  const filled = fields.some(({ field }) => secret(field) && holds(field));
  // Any filled field that may hold one: a password field, one named for a password, or one marked as maybe. Code the
  // server sends (an older one, which names no helpers) could read it, so that walk pauses there too, until Continue.
  const maybe = filled || roots.some((root) => inputs(root).some((f) => (named(f) || f.getAttribute(MAYBE) !== null) && holds(f)));
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
    if (el.tagName === 'INPUT' && (String(el.type).toLowerCase() === 'password' || el.getAttribute?.(MARK) != null || tokens.some((token) => token === 'current-password' || token === 'new-password'))) focus = 'password';
    else if (tokens.some((token) => token.startsWith('cc-'))) focus = 'card';
    else if (tokens.includes('one-time-code')) focus = 'code';
  }
  const status = performance.getEntriesByType('navigation')[0]?.responseStatus ?? 0;
  return { password, filled, maybe, status, focus };
}

/** Whether what {@link lookInPage} saw is a sign-in. */
export const signingIn = (seen) => seen?.password === true || seen?.status === 401;
