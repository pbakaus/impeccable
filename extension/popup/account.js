/**
 * Impeccable extension popup: the account.
 *
 * Tabs along the top of the popup: Scan (the detector, popup.js, as it always was), Personas (only when signed in)
 * and Settings, the cog at the row's right end (who is signed in, Sign out, the walk helper). Signed out, one button
 * under every tab signs in. It asks the background worker (account/worker.js, onboarding/contact.js) and holds no
 * token itself. The tabs show when the account server takes extension sign-ins, and always in a build loaded
 * unpacked, so its screens can be seen before the server is there; Sign in then says it is not available yet.
 * Otherwise, or in a browser with no `chrome.identity` (Firefox shares this page), the popup is the detector alone,
 * as before. The store build does not load this script at all, so its popup asks no server anything. Its words are
 * in words.js.
 */
(() => {
  const WORDS = globalThis.IMPECCABLE_WORDS?.popup;
  const $ = (id) => document.getElementById(id);
  const tabs = $('account-tabs');
  if (!tabs || !WORDS || !globalThis.chrome?.identity) return;
  const TABS = ['scan', 'personas', 'settings'];
  const tab = (name) => $(`tab-${name}`);
  const panel = (name) => $(`panel-${name}`);

  const send = (message) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (answer) => resolve(chrome.runtime.lastError ? null : answer ?? null));
    } catch {
      resolve(null);
    }
  });
  const ask = (account, extra = {}) => send({ account, ...extra });

  let selected = 'scan';
  let status = null;
  let loadedPersonas = false;

  function select(name, { focus = false } = {}) {
    if (tab(name).hidden) name = 'scan';
    selected = name;
    for (const each of TABS) {
      const on = each === name;
      tab(each).setAttribute('aria-selected', String(on));
      tab(each).tabIndex = on ? 0 : -1;
      panel(each).hidden = !on;
    }
    if (focus) tab(name).focus();
    if (name === 'personas' && !loadedPersonas) void personas();
  }

  async function personas() {
    loadedPersonas = true;
    const answer = await ask('personas');
    const list = $('persona-list');
    const note = $('personas-note');
    const rows = answer?.ok ? answer.personas : null;
    list.replaceChildren(...(rows ?? []).map((persona) => {
      const item = document.createElement('li');
      item.className = 'persona';
      const name = document.createElement('span');
      name.className = 'persona-name';
      name.textContent = persona.name;
      item.append(name);
      if (persona.role) {
        const role = document.createElement('span');
        role.className = 'persona-role';
        role.textContent = persona.role;
        item.append(role);
      }
      return item;
    }));
    note.textContent = rows === null ? WORDS.personasFailed : rows.length === 0 ? WORDS.noPersonas : '';
    note.hidden = note.textContent === '';
  }

  function draw(next) {
    status = next;
    const available = next?.ok === true && next.available === true;
    const on = available || next?.unpacked === true;
    const signedIn = available && next.signedIn === true;
    tabs.hidden = !on;
    document.body.classList.toggle('has-tabs', on);
    document.body.dataset.account = !on ? 'off' : signedIn ? 'signed-in' : 'signed-out';
    $('sign-in').hidden = !on || signedIn;
    if (!on) { select('scan'); return; }
    tab('personas').hidden = !signedIn;
    $('account-label').textContent = signedIn ? WORDS.signedIn : WORDS.signedOut;
    $('account-email').textContent = next.email ?? '';
    $('account-email').hidden = !signedIn || !next.email;
    $('btn-sign-out').hidden = !signedIn;
    // Only a build loaded unpacked says which server it signs in to, and lets it be changed.
    $('account-server-row').hidden = typeof next.server !== 'string';
    if (typeof next.server === 'string') $('account-server').value = next.server;
    select(selected);
  }

  /** The walk helper's row in Settings: added, or a button to the onboarding that adds or updates it. */
  async function helper() {
    const answer = await send({ walks: 'helper' });
    if (!answer) return;
    const row = $('helper-row');
    row.dataset.state = answer.state;
    $('helper-state').textContent = { ready: WORDS.helperReady, old: WORDS.helperOld }[answer.state] ?? WORDS.helperMissing;
    $('btn-helper').textContent = answer.state === 'old' ? WORDS.helperUpdate : WORDS.helperAdd;
    $('btn-helper').hidden = answer.state === 'ready';
    row.hidden = false;
  }

  function note(text) {
    $('account-error').textContent = text;
    $('account-error').hidden = text === '';
  }

  for (const name of TABS) tab(name).addEventListener('click', () => select(name));
  tabs.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const shown = TABS.filter((name) => !tab(name).hidden);
    const at = shown.indexOf(selected);
    select(shown[(at + (event.key === 'ArrowRight' ? 1 : shown.length - 1)) % shown.length], { focus: true });
    event.preventDefault();
  });

  // The sign-in window takes the focus, which closes this popup; the worker finishes it, and the next popup shows it.
  $('btn-sign-in').addEventListener('click', async () => {
    if (status?.available !== true) { note(WORDS.signInUnavailable); return; }
    note('');
    const answer = await ask('sign-in');
    if (answer?.ok) draw(answer); else note(WORDS.failed);
  });
  $('btn-sign-out').addEventListener('click', async () => {
    note('');
    loadedPersonas = false;
    draw(await ask('sign-out'));
  });
  $('account-server').addEventListener('change', async (event) => {
    const answer = await ask('server', { server: event.target.value.trim().replace(/\/+$/, '') });
    if (answer?.ok) { loadedPersonas = false; draw(answer); }
  });

  // Closed only once the tab is asked for: a popup that closes first takes the request with it.
  $('btn-helper').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/onboarding.html') }).finally(() => window.close());
  });

  $('helper-label').textContent = WORDS.helper;
  $('btn-sign-in').textContent = WORDS.signIn;
  void ask('status').then(draw);
  void helper();
})();
