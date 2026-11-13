/**
 * Impeccable extension popup: the Impeccable Pro button at its foot.
 *
 * Signed out, it signs in through the background worker (account/worker.js), which holds every token; once signed in,
 * the worker points the toolbar icon at the side panel instead of this popup (walks/toolbar.js). The button is in
 * popup.html from the start and the worker's answer changes only what a click does, so the popup never grows after
 * it opens. Who is signed in, Sign out and the server live on the extension's options page (settings.html). Firefox
 * loads neither this script nor the button. Its words are in words.js.
 */
(() => {
  const WORDS = globalThis.IMPECCABLE_WORDS?.popup;
  const button = document.getElementById('btn-pro');
  const line = document.getElementById('scan-error');
  if (!button || !WORDS || !globalThis.chrome?.identity) return;

  const ask = (account) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ account }, (answer) => resolve(chrome.runtime.lastError ? null : answer ?? null));
    } catch {
      resolve(null);
    }
  });
  const say = (text) => { line.textContent = text; line.dataset.from = text ? 'account' : ''; };

  let status = null;
  const known = ask('status').then((answer) => { status = answer; return answer; });

  // The sign-in window takes the focus, which closes this popup; the worker finishes it and switches the icon.
  button.addEventListener('click', async () => {
    if (status?.signedIn === true && status.pro === false) { say(WORDS.notPro); return; }
    if (status?.signedIn === true) {
      const tab = (await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []))[0];
      if (tab) await chrome.sidePanel?.open({ tabId: tab.id }).catch(() => undefined);
      window.close();
      return;
    }
    const now = status ?? await known;
    if (now?.available !== true) { say(WORDS.signInUnavailable); return; }
    say('');
    const answer = await ask('sign-in');
    if (!answer?.ok) say(WORDS.failed);
  });
})();
