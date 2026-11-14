/**
 * Impeccable DevTools Extension - Popup
 *
 * Scan, copy the current page's findings, and toggle the outlines.
 */

const countDisplay = document.getElementById('count-display');
const countNumber = document.getElementById('count-number');
const countLabel = document.getElementById('count-label');
const btnScan = document.getElementById('btn-scan');
const btnToggle = document.getElementById('btn-toggle');
const btnCopyAll = document.getElementById('btn-copy-all');
const copyLabel = document.getElementById('copy-label');
const toggleLabel = document.getElementById('toggle-label');
// The one line under Scan page: an error, or nothing. Its space is always kept, so nothing moves.
const scanError = document.getElementById('scan-error');

let overlaysVisible = true;
let activeTabId = null;
let currentScan = null;
let revision = 0;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

let copiedTimer = null;
/** `copied`: the button says so for a moment; `message`: what went wrong, on the line. */
function showCopyStatus(message, copied = false) {
  clearTimeout(copiedTimer);
  copyLabel.textContent = copied ? 'Copied' : 'Copy all';
  if (copied) copiedTimer = setTimeout(() => { copyLabel.textContent = 'Copy all'; }, 1500);
  if (message || scanError.dataset.from === 'copy') showLine(message, 'copy');
}

function showLine(message, from = 'scan') {
  scanError.textContent = message || '';
  scanError.dataset.from = message ? from : '';
}

function showOverlays(visible) {
  overlaysVisible = visible;
  toggleLabel.textContent = overlaysVisible ? 'Hide outlines' : 'Show outlines';
}

function updateFindings(findings) {
  const count = findings.reduce((sum, item) => sum + item.findings.length, 0);
  countNumber.textContent = String(count);
  countDisplay.classList.toggle('has-findings', count > 0);
  countLabel.textContent = count === 1 ? 'anti-pattern' : 'anti-patterns';
  btnToggle.disabled = count === 0;
}

function clearScan() {
  revision++;
  currentScan = null;
  btnCopyAll.disabled = true;
  showCopyStatus('');
  updateFindings([]);
}

function updateFromState(state) {
  if (!state) return;
  revision++;
  currentScan = state.scanComplete && state.url
    ? { findings: state.findings || [], url: state.url, tabId: activeTabId }
    : null;
  btnCopyAll.disabled = !currentScan;
  showCopyStatus('');
  updateFindings(state.findings || []);
  btnScan.disabled = false;
  showLine(state.scanError);
  showOverlays(state.overlaysVisible !== false);
}

async function loadState() {
  const tab = await getActiveTab();
  if (!tab) return;
  activeTabId = tab.id;
  const requestedAt = revision;
  chrome.runtime.sendMessage({ action: 'get-state', tabId: tab.id }, state => {
    // A scan or navigation broadcast may arrive before this callback.
    if (requestedAt !== revision) return;
    // Overlay visibility belongs to the tab, independent of scan validity.
    const validScan = tab.status !== 'loading' && state?.url === tab.url;
    updateFromState({ ...state, ...(!validScan && { findings: [], scanComplete: false }) });
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  // Unscoped messages and background tabs cannot supply this popup's report.
  if (activeTabId == null || msg.tabId !== activeTabId) return;
  if (msg.action === 'findings-updated') {
    updateFromState({ ...msg, overlaysVisible });
    btnScan.disabled = false;
    showLine('');
  }
  if (msg.action === 'scan-started' || msg.action === 'navigated') {
    clearScan();
    showLine('');
    btnScan.disabled = false;
  }
  if (msg.action === 'scan-failed') {
    clearScan();
    btnScan.disabled = false;
    showLine(msg.message || 'Couldn\u2019t scan this page.');
  }
  if (msg.action === 'overlays-toggled-broadcast') {
    showOverlays(msg.visible);
  }
});

// Clear at the start of navigation, including a reload with the same URL.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (tabId === activeTabId && (change.status === 'loading' || change.url)) {
    clearScan();
    showLine('');
    btnScan.disabled = false;
  }
});

btnScan.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  activeTabId = tab.id;
  clearScan();
  showLine('');
  btnScan.disabled = false;
  chrome.runtime.sendMessage({ action: 'scan', tabId: tab.id });
});

btnCopyAll.addEventListener('click', async () => {
  const scan = currentScan;
  if (!scan || btnCopyAll.disabled) return;
  btnCopyAll.disabled = true;
  showCopyStatus('');
  try {
    const tab = await getActiveTab();
    if (scan !== currentScan) return;
    if (!tab || tab.id !== scan.tabId || tab.url !== scan.url || tab.status === 'loading') {
      clearScan();
      showCopyStatus('Page changed. Scan this page before copying.');
      return;
    }
    await navigator.clipboard.writeText(ImpeccableReport.formatFindingsForCopy(scan.findings, scan.url));
    if (scan === currentScan) showCopyStatus('', true);
  } catch {
    if (scan === currentScan) showCopyStatus('Couldn\u2019t copy findings. Try again.');
  } finally {
    if (scan === currentScan) btnCopyAll.disabled = false;
  }
});

btnToggle.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  chrome.runtime.sendMessage({ action: 'toggle-overlays', tabId: tab.id });
  showOverlays(!overlaysVisible);
});

loadState();
