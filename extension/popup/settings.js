/**
 * The extension's options page (right-click the toolbar icon, then Options): who is signed in, Sign in or Sign out,
 * and, in a build loaded unpacked, the server it signs in to. It lives under popup/ so the account worker answers it
 * as it answers the popup. The store build and Firefox leave it out.
 */
(() => {
  const WORDS = globalThis.IMPECCABLE_WORDS.popup;
  const $ = (id) => document.getElementById(id);
  const ask = (account, extra = {}) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ account, ...extra }, (answer) => resolve(chrome.runtime.lastError ? null : answer ?? null));
  });

  let status = null;
  function draw(next) {
    status = next;
    const signedIn = next?.signedIn === true;
    document.body.dataset.account = signedIn ? 'signed-in' : 'signed-out';
    $('account-label').textContent = signedIn ? WORDS.signedIn : WORDS.signedOut;
    $('account-email').textContent = next?.email ?? '';
    $('account-email').hidden = !signedIn || !next?.email;
    $('btn-account').textContent = signedIn ? WORDS.signOut : WORDS.signIn;
    $('btn-account').hidden = !next?.ok;
    $('account-server-row').hidden = typeof next?.server !== 'string';
    if (typeof next?.server === 'string') $('account-server').value = next.server;
  }
  const say = (text) => { $('account-error').textContent = text; };

  $('btn-account').addEventListener('click', async () => {
    say('');
    if (status?.signedIn === true) { draw(await ask('sign-out')); return; }
    if (status?.available !== true) { say(WORDS.signInUnavailable); return; }
    const answer = await ask('sign-in');
    if (answer?.ok) draw(answer); else say(WORDS.failed);
  });
  $('account-server').addEventListener('change', async (event) => {
    const answer = await ask('server', { server: event.target.value.trim().replace(/\/+$/, '') });
    if (answer?.ok) draw(answer);
  });
  void ask('status').then(draw);

  // The sites the person always lets their own agent use (walks/agent.js), each with Remove.
  const SITES = 'agentSites';
  async function drawSites() {
    const sites = (await chrome.storage.local.get(SITES))[SITES] ?? [];
    $('agent-sites').hidden = sites.length === 0;
    $('agent-sites-label').textContent = WORDS.agentSites;
    $('agent-sites-list').replaceChildren(...sites.map((origin) => {
      const row = document.createElement('li');
      const host = document.createElement('span');
      host.textContent = new URL(origin).host;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = WORDS.remove;
      remove.setAttribute('aria-label', `${WORDS.remove} ${host.textContent}`);
      remove.addEventListener('click', async () => {
        const now = (await chrome.storage.local.get(SITES))[SITES] ?? [];
        await chrome.storage.local.set({ [SITES]: now.filter((kept) => kept !== origin) });
      });
      row.append(host, remove);
      return row;
    }));
  }
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[SITES]) void drawSites(); });
  void drawSites();
})();
