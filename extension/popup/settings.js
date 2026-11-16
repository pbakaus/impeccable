/**
 * The extension's options page (right-click the toolbar icon, then Options): who is signed in, Sign in or Sign out,
 * and, in a build loaded unpacked, the server it signs in to. It lives under popup/ so the account worker answers it
 * as it answers the popup. Firefox leaves it out.
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
})();
