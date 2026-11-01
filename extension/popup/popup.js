/**
 * Impeccable DevTools Extension - Popup
 *
 * Scan, copy the current page's findings, and toggle overlays.
 */

const countNumber = document.getElementById('count-number');
const countLabel = document.getElementById('count-label');
const btnScan = document.getElementById('btn-scan');
const btnToggle = document.getElementById('btn-toggle');
const btnCopyAll = document.getElementById('btn-copy-all');
const copyStatus = document.getElementById('copy-status');
const scanError = document.getElementById('scan-error');

let overlaysVisible = true;
let activeTabId = null;
let currentScan = null;
let revision = 0;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function showCopyStatus(message, error = false) {
  copyStatus.textContent = message;
  copyStatus.classList.toggle('is-error', error);
}

function updateFindings(findings) {
  const count = findings.reduce((sum, item) => sum + item.findings.length, 0);
  countNumber.textContent = String(count);
  countNumber.classList.toggle('has-findings', count > 0);
  countLabel.textContent = count === 1 ? 'anti-pattern' : 'anti-patterns';
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
  btnScan.textContent = state.scanning ? 'Restart scan' : 'Scan page';
  btnScan.disabled = false;
  scanError.textContent = state.scanError || '';
  scanError.hidden = !state.scanError;
  overlaysVisible = state.overlaysVisible !== false;
  btnToggle.textContent = overlaysVisible ? 'Hide overlays' : 'Show overlays';
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
    btnScan.textContent = msg.scanComplete ? 'Scan page' : 'Restart scan';
    btnScan.disabled = false;
    scanError.hidden = true;
  }
  if (msg.action === 'scan-started' || msg.action === 'navigated') {
    clearScan();
    scanError.hidden = true;
    btnScan.textContent = msg.action === 'scan-started' ? 'Restart scan' : 'Scan page';
    btnScan.disabled = false;
  }
  if (msg.action === 'scan-failed') {
    clearScan();
    btnScan.textContent = 'Scan page';
    btnScan.disabled = false;
    scanError.textContent = msg.message || 'Couldn\u2019t scan this page.';
    scanError.hidden = false;
  }
  if (msg.action === 'overlays-toggled-broadcast') {
    overlaysVisible = msg.visible;
    btnToggle.textContent = overlaysVisible ? 'Hide overlays' : 'Show overlays';
  }
});

// Clear at the start of navigation, including a reload with the same URL.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (tabId === activeTabId && (change.status === 'loading' || change.url)) {
    clearScan();
    scanError.hidden = true;
    btnScan.textContent = 'Scan page';
    btnScan.disabled = false;
  }
});

btnScan.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  activeTabId = tab.id;
  clearScan();
  scanError.hidden = true;
  btnScan.textContent = 'Restart scan';
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
    if (scan === currentScan) showCopyStatus('Copied findings. Paste them into your agent.');
  } catch {
    if (scan === currentScan) showCopyStatus('Couldn\u2019t copy findings. Try again.', true);
  } finally {
    if (scan === currentScan) btnCopyAll.disabled = false;
  }
});

btnToggle.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  chrome.runtime.sendMessage({ action: 'toggle-overlays', tabId: tab.id });
  overlaysVisible = !overlaysVisible;
  btnToggle.textContent = overlaysVisible ? 'Hide overlays' : 'Show overlays';
});

loadState();
