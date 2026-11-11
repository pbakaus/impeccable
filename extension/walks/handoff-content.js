// Runs only on our own app's page for an outing (manifest.json `content_scripts`). It reads the page's hand-off
// block and passes its text to the worker, which checks where it came from and every field of it (handoff.js). It
// listens to nothing the page's script can send: no window messages, no custom events.
(() => {
  const ID = 'impeccable-outing';
  let passed = null;

  const read = () => {
    const block = document.getElementById(ID);
    if (!(block instanceof HTMLScriptElement) || block.type !== 'application/json') return;
    const text = block.textContent ?? '';
    if (text === '' || text === passed) return;
    passed = text;
    // The page learns whether the walk was taken (`taken`) or why not, on the block itself.
    chrome.runtime.sendMessage({ handoff: text }).then((answer) => {
      block.dataset.impeccable = answer?.ok ? 'taken' : `refused:${answer?.why ?? 'unknown'}`;
      if (answer?.ok) watch();
    }, () => undefined);
  };

  // Chrome may end the extension's worker while a walk waits for its tab, and nothing of the worker's own starts it
  // again. Once a walk is taken, this port is held open to the worker: it drops when the worker is ended, and opening
  // another starts the worker, which decides what the walk needs (link.js, the rule for connecting again). Once the
  // worker says no walk is waiting, it is left to rest.
  let watching = false;
  const watch = () => {
    if (watching) return;
    let port;
    let again = true;
    try { port = chrome.runtime.connect({ name: 'outing-page' }); } catch { return; }
    watching = true;
    port.onMessage.addListener((message) => { if (message?.rest) again = false; });
    port.onDisconnect.addListener(() => { watching = false; if (again) setTimeout(watch, 500); });
  };

  read();
  // The app draws the page after it loads, and may put another outing's block in its place.
  new MutationObserver(read).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // Chrome opens a side panel only on a click: one on anything the page marks `data-impeccable-panel` opens ours.
  document.addEventListener('click', (event) => {
    if (event.isTrusted && event.target instanceof Element && event.target.closest('[data-impeccable-panel]')) void chrome.runtime.sendMessage({ panel: 'open' }).catch(() => undefined);
  }, true);
})();
