/**
 * Impeccable DevTools Extension - Popup
 *
 * Quick controls: scan, toggle overlays, and see finding count.
 */

const countNumber = document.getElementById('count-number');
const countLabel = document.getElementById('count-label');
const btnScan = document.getElementById('btn-scan');
const btnToggle = document.getElementById('btn-toggle');
const scanError = document.getElementById('scan-error');

let overlaysVisible = true;

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function updateFromState(state) {
  if (!state) return;
  const count = state.findings?.reduce((sum, f) => sum + f.findings.length, 0) || 0;
  countNumber.textContent = String(count);
  countNumber.classList.toggle('has-findings', count > 0);
  countLabel.textContent = count === 1 ? 'anti-pattern' : 'anti-patterns';
  overlaysVisible = state.overlaysVisible !== false;
  btnToggle.textContent = overlaysVisible ? 'Hide overlays' : 'Show overlays';
}

async function loadState() {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  chrome.runtime.sendMessage({ action: 'get-state', tabId }, updateFromState);
}

// Listen for real-time updates from service worker
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'findings-updated') {
    const count = msg.findings?.reduce((sum, f) => sum + f.findings.length, 0) || 0;
    countNumber.textContent = String(count);
    countNumber.classList.toggle('has-findings', count > 0);
    countLabel.textContent = count === 1 ? 'anti-pattern' : 'anti-patterns';
    btnScan.textContent = 'Scan page';
    btnScan.disabled = false;
    scanError.hidden = true;
  }
  if (msg.action === 'scan-failed') {
    btnScan.textContent = 'Scan page';
    btnScan.disabled = false;
    scanError.textContent = msg.message || 'This page can\u2019t be scanned.';
    scanError.hidden = false;
  }
  if (msg.action === 'overlays-toggled-broadcast') {
    overlaysVisible = msg.visible;
    btnToggle.textContent = overlaysVisible ? 'Hide overlays' : 'Show overlays';
  }
});

btnScan.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  scanError.hidden = true;
  btnScan.textContent = 'Scanning...';
  btnScan.disabled = true;
  chrome.runtime.sendMessage({ action: 'scan', tabId });
});

btnToggle.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  chrome.runtime.sendMessage({ action: 'toggle-overlays', tabId });
  overlaysVisible = !overlaysVisible;
  btnToggle.textContent = overlaysVisible ? 'Hide overlays' : 'Show overlays';
});

loadState();
