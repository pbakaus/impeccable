// Runs on the Impeccable Pro welcome page (manifest.json `content_scripts`). It marks the page as having this
// extension, which the page reads, and makes the page's "open the side panel" button ask the worker to open it.
// It reads nothing of the page.
document.documentElement.dataset.impeccableExtension = 'ready';
document.addEventListener('click', (event) => {
  if (!event.target?.closest?.('[data-impeccable-open-panel]')) return;
  event.preventDefault();
  void chrome.runtime.sendMessage({ panel: 'open' }).catch(() => undefined);
}, true);
