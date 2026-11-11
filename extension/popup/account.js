/**
 * Impeccable extension popup: the account.
 *
 * Three tabs over the popup: Scan (the detector, popup.js, as it always was), Personas (only when signed in) and
 * Settings (who is signed in, Sign in, Sign out). It asks the background worker (account/worker.js) and holds no
 * token itself. The tabs show only when the account server takes extension sign-ins: when it answers 404, or this
 * browser has no `chrome.identity` (Firefox shares this page), the popup is the detector alone, as before.
 */
(() => {
  const WORDS = {
    signedIn: 'Signed in as',
    signedOut: 'Not signed in.',
    failed: 'Couldn’t sign in. Try again.',
    noPersonas: 'No personas yet.',
    personasFailed: 'Couldn’t load your personas.',
  };

  const $ = (id) => document.getElementById(id);
  const tabs = $('account-tabs');
  if (!tabs || !globalThis.chrome?.identity) return;

  const TABS = ['scan', 'personas', 'settings'];
  const tab = (name) => $(`tab-${name}`);
  const panel = (name) => $(`panel-${name}`);

  const ask = (account, extra = {}) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ account, ...extra }, (answer) => resolve(chrome.runtime.lastError ? null : answer ?? null));
    } catch {
      resolve(null);
    }
  });

  let selected = 'scan';
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

  function draw(status) {
    const on = status?.ok === true && status.available === true;
    tabs.hidden = !on;
    document.body.classList.toggle('has-tabs', on);
    document.body.dataset.account = !on ? 'off' : status.signedIn ? 'signed-in' : 'signed-out';
    if (!on) { select('scan'); return; }
    tab('personas').hidden = !status.signedIn;
    $('account-label').textContent = status.signedIn ? WORDS.signedIn : WORDS.signedOut;
    $('account-email').textContent = status.email ?? '';
    $('account-email').hidden = !status.signedIn || !status.email;
    $('btn-sign-in').hidden = status.signedIn === true;
    $('btn-sign-out').hidden = status.signedIn !== true;
    // Only a build loaded unpacked says which server it signs in to, and lets it be changed.
    $('account-server-row').hidden = typeof status.server !== 'string';
    if (typeof status.server === 'string') $('account-server').value = status.server;
    select(selected);
  }

  function failed(show) {
    $('account-error').textContent = show ? WORDS.failed : '';
    $('account-error').hidden = !show;
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
    failed(false);
    const answer = await ask('sign-in');
    if (answer?.ok) draw(answer); else failed(true);
  });
  $('btn-sign-out').addEventListener('click', async () => {
    failed(false);
    loadedPersonas = false;
    draw(await ask('sign-out'));
  });
  $('account-server').addEventListener('change', async (event) => {
    const answer = await ask('server', { server: event.target.value.trim().replace(/\/+$/, '') });
    if (answer?.ok) { loadedPersonas = false; draw(answer); }
  });

  void ask('status').then(draw);
})();
