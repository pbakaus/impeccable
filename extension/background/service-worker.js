/**
 * Impeccable DevTools Extension - Service Worker
 *
 * Routes messages between popup, DevTools panel, and content scripts.
 * Maintains per-tab state and updates the badge.
 */

// Per-tab state: { tabId: { findings, overlaysVisible, injected } }
const tabState = new Map();

// Active DevTools panel connections: { tabId: Set<port> }
const panelPorts = new Map();

function getState(tabId) {
  if (!tabState.has(tabId)) {
    tabState.set(tabId, { findings: [], overlaysVisible: true, injected: false, csInjected: false });
  }
  return tabState.get(tabId);
}

function updateBadge(tabId) {
  const state = tabState.get(tabId);
  const count = state?.findings?.length || 0;
  const text = count > 0 ? String(count) : '';
  chrome.action.setBadgeText({ text, tabId }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#d6336c', tabId }).catch(() => {});
}

function notifyPanels(tabId, message) {
  const ports = panelPorts.get(tabId);
  if (ports) {
    for (const port of ports) {
      try { port.postMessage(message); } catch { /* port disconnected */ }
    }
  }
}

async function getSettings() {
  return chrome.storage.sync.get({
    disabledRules: [],
    lineLengthMode: 'strict', // 'strict' = 80, 'lax' = 120
    spotlightBlur: true,      // dim/blur the page on hover-highlight
    autoScan: 'panel',        // 'panel' = scan when Impeccable UI opens, 'devtools' = scan when DevTools opens
  });
}

async function buildScanConfig() {
  const { disabledRules, lineLengthMode, spotlightBlur } = await getSettings();
  const config = {};
  if (disabledRules.length) config.disabledRules = disabledRules;
  config.lineLengthMax = lineLengthMode === 'lax' ? 120 : 80;
  config.spotlightBlur = spotlightBlur;
  return config;
}

// Inject the content script on-demand. We removed the static content_scripts entry to
// minimize the always-on footprint; the script is only loaded when the user explicitly
// engages with the extension (DevTools panel/sidebar opened, popup scan, etc).
async function ensureContentScriptInjected(tabId) {
  const state = getState(tabId);
  if (state.csInjected) return true;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content-script.js'],
      injectImmediately: true,
    });
    state.csInjected = true;
    return true;
  } catch (err) {
    // Common cause: chrome:// pages, the web store, or other restricted URLs
    return false;
  }
}

async function sendScanToTab(tabId) {
  const ok = await ensureContentScriptInjected(tabId);
  if (!ok) return;
  const config = await buildScanConfig();
  chrome.tabs.sendMessage(tabId, { action: 'scan', config }).catch(() => {});
}

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = msg.tabId || sender.tab?.id;

  if (msg.action === 'findings' && tabId) {
    const state = getState(tabId);
    state.findings = msg.findings || [];
    state.injected = true;
    updateBadge(tabId);
    notifyPanels(tabId, { action: 'findings', findings: state.findings });
    // Broadcast for popup
    chrome.runtime.sendMessage({ action: 'findings-updated', tabId, findings: state.findings }).catch(() => {});
    sendResponse({ ok: true });
  }

  else if (msg.action === 'scan' && tabId) {
    sendScanToTab(tabId);
    sendResponse({ ok: true });
  }

  else if (msg.action === 'toggle-overlays' && tabId) {
    chrome.tabs.sendMessage(tabId, { action: 'toggle-overlays' }).catch(() => {});
    sendResponse({ ok: true });
  }

  else if (msg.action === 'page-pointer-active' && tabId) {
    notifyPanels(tabId, { action: 'page-pointer-active' });
    sendResponse({ ok: true });
  }

  else if (msg.action === 'overlays-toggled' && tabId) {
    const state = getState(tabId);
    state.overlaysVisible = msg.visible;
    notifyPanels(tabId, { action: 'overlays-toggled', visible: msg.visible });
    chrome.runtime.sendMessage({ action: 'overlays-toggled-broadcast', tabId, visible: msg.visible }).catch(() => {});
    sendResponse({ ok: true });
  }

  else if (msg.action === 'get-state' && tabId) {
    sendResponse(getState(tabId));
  }

  else if (msg.action === 'inject-fallback' && tabId) {
    // CSP fallback: inject detector via chrome.scripting (bypasses page CSP)
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: ['detector/detect.js'],
    }).then(() => {
      // Detector will post impeccable-ready, content script handles the rest
    }).catch((err) => {
      console.warn('[impeccable] Fallback injection failed:', err);
    });
    sendResponse({ ok: true });
  }

  else if (msg.action === 'disabled-rules-changed') {
    // Re-scan all tabs that have been injected
    for (const [tid, state] of tabState) {
      if (state.injected) sendScanToTab(tid);
    }
    sendResponse({ ok: true });
  }

  return true;
});

// Track which tabs have DevTools open (via the devtools.js lifecycle port)
const devtoolsTabs = new Set();

async function tearDownTab(tabId) {
  devtoolsTabs.delete(tabId);
  // Send the remove command and await it — this keeps the SW alive long enough
  // to actually deliver the message (setTimeout doesn't survive SW termination in MV3).
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'remove' });
  } catch { /* tab might be closed or content script gone */ }
  const state = tabState.get(tabId);
  if (state) {
    state.findings = [];
    state.injected = false;
    state.csInjected = false;
  }
  updateBadge(tabId);
  panelPorts.delete(tabId);
}

// Handle long-lived connections from DevTools pages and panels
chrome.runtime.onConnect.addListener((port) => {
  // Lifecycle port from devtools.js -- tracks DevTools open/close
  if (port.name.startsWith('impeccable-devtools-')) {
    const tabId = parseInt(port.name.replace('impeccable-devtools-', ''), 10);
    devtoolsTabs.add(tabId);

    port.onMessage.addListener((msg) => {
      if (msg.action === 'scan') sendScanToTab(tabId);
      // 'ping' is just a keepalive; no action needed
    });

    port.onDisconnect.addListener(() => {
      // Tear down immediately — defer with setTimeout doesn't work reliably in MV3
      // because the SW can be terminated before the timer fires.
      tearDownTab(tabId);
    });
  }

  // Panel port from panel.js -- for forwarding findings/state
  if (port.name.startsWith('impeccable-panel-')) {
    const tabId = parseInt(port.name.replace('impeccable-panel-', ''), 10);
    if (!panelPorts.has(tabId)) panelPorts.set(tabId, new Set());
    panelPorts.get(tabId).add(port);

    // Send current state to newly connected panel
    const state = getState(tabId);
    port.postMessage({ action: 'state', ...state });

    // If no findings yet, the auto-scan from devtools.js may have been lost -- trigger one
    if (!state.findings.length) {
      sendScanToTab(tabId);
    }

    port.onMessage.addListener((msg) => {
      if (msg.action === 'scan') {
        sendScanToTab(tabId);
      } else if (msg.action === 'toggle-overlays') {
        chrome.tabs.sendMessage(tabId, { action: 'toggle-overlays' }).catch(() => {});
      } else if (msg.action === 'highlight') {
        chrome.tabs.sendMessage(tabId, { action: 'highlight', selector: msg.selector }).catch(() => {});
      } else if (msg.action === 'unhighlight') {
        chrome.tabs.sendMessage(tabId, { action: 'unhighlight' }).catch(() => {});
      }
    });

    port.onDisconnect.addListener(() => {
      panelPorts.get(tabId)?.delete(port);
      if (panelPorts.get(tabId)?.size === 0) panelPorts.delete(tabId);
    });
  }

  // Sidebar pane port (Elements panel sidebar) -- receives findings updates.
  // Connecting the sidebar is a strong signal of "user engaged with Impeccable"
  // so we trigger a scan if no findings exist yet (matches the panel port behavior).
  if (port.name.startsWith('impeccable-sidebar-')) {
    const tabId = parseInt(port.name.replace('impeccable-sidebar-', ''), 10);
    if (!panelPorts.has(tabId)) panelPorts.set(tabId, new Set());
    panelPorts.get(tabId).add(port);

    const state = getState(tabId);
    port.postMessage({ action: 'state', ...state });
    if (!state.findings.length) sendScanToTab(tabId);

    port.onDisconnect.addListener(() => {
      panelPorts.get(tabId)?.delete(port);
      if (panelPorts.get(tabId)?.size === 0) panelPorts.delete(tabId);
    });
  }
});

// On navigation, reset content-script state for any tracked tab (page reload destroys
// the content script regardless of which UI surfaced it). Auto-rescan is gated separately
// on DevTools being open AND the user having previously engaged.
chrome.webNavigation?.onCompleted?.addListener((details) => {
  if (details.frameId !== 0) return;
  const state = tabState.get(details.tabId);
  if (!state) return;

  // Capture engagement state BEFORE clearing (used by the auto-rescan branch).
  const wasActive = state.injected || state.findings.length > 0;

  // Always clear: the content script is gone after reload, full stop. Skipping this when
  // DevTools wasn't open meant the popup-only flow saw a stale csInjected: true on the
  // second click and silently no-op'd against a tab that had no listener.
  state.findings = [];
  state.injected = false;
  state.csInjected = false;
  updateBadge(details.tabId);
  notifyPanels(details.tabId, { action: 'navigated' });

  // Auto-rescan only when DevTools is the driver — the popup is user-triggered and
  // shouldn't fire scans the user didn't ask for.
  if (devtoolsTabs.has(details.tabId) && wasActive) {
    setTimeout(() => sendScanToTab(details.tabId), 300);
  }
});

// Clean up state when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
  panelPorts.delete(tabId);
});
