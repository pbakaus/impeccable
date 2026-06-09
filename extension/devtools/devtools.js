/**
 * Impeccable DevTools Extension - DevTools Page
 *
 * Creates the Impeccable panel and triggers an auto-scan when DevTools opens.
 * This page lives for the entire DevTools session -- its port disconnect
 * is the canonical signal that DevTools has closed.
 */

chrome.devtools.panels.create(
  'Impeccable',
  '/icons/icon-32.png',
  '/devtools/panel.html'
);

// Sidebar pane in the Elements panel: shows findings for the currently selected element
chrome.devtools.panels.elements.createSidebarPane('Impeccable', (sidebar) => {
  sidebar.setPage('/devtools/sidebar.html');
  sidebar.setHeight('200px');
});

// Lifecycle port to the service worker. Auto-reconnects if the SW gets terminated
// (which can happen in MV3 after ~30s of inactivity, especially when the browser is unfocused).
const portName = `impeccable-devtools-${chrome.devtools.inspectedWindow.tabId}`;
let lifecyclePort = null;
let firstConnect = true;
function connectLifecycle() {
  lifecyclePort = chrome.runtime.connect({ name: portName });
  // On the very first connection, decide whether to auto-scan based on the user's setting.
  // Default ('panel'): wait until the user opens the Impeccable panel or sidebar.
  // Opt-in ('devtools'): scan immediately when DevTools opens.
  if (firstConnect) {
    firstConnect = false;
    chrome.storage.sync.get({ autoScan: 'panel' }, (settings) => {
      if (settings.autoScan === 'devtools') {
        try { lifecyclePort?.postMessage({ action: 'scan' }); } catch {}
      }
    });
  }
  lifecyclePort.onDisconnect.addListener(() => {
    lifecyclePort = null;
    // Reconnect on the next tick so the SW sees a fresh connection
    setTimeout(connectLifecycle, 100);
  });
}
connectLifecycle();

// Heartbeat to keep the SW alive
setInterval(() => {
  try { lifecyclePort?.postMessage({ action: 'ping' }); } catch {}
}, 20000);
