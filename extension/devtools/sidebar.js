/**
 * Impeccable DevTools Extension - Elements Sidebar Pane
 *
 * Shows Impeccable findings for the currently selected element ($0) in the Elements panel.
 */

if (chrome.devtools.panels.themeName === 'dark') {
  document.documentElement.classList.add('theme-dark');
}

const tabId = chrome.devtools.inspectedWindow.tabId;
const content = document.getElementById('sidebar-content');
let currentFindings = [];

// Auto-reconnecting port (service worker may restart in MV3)
let port = null;
function getPort() {
  if (port) return port;
  port = chrome.runtime.connect({ name: `impeccable-sidebar-${tabId}` });
  port.onMessage.addListener((msg) => {
    if (msg.action === 'findings' || msg.action === 'state') {
      currentFindings = msg.findings || [];
      refreshForCurrentSelection();
    }
  });
  port.onDisconnect.addListener(() => { port = null; });
  return port;
}
getPort();

chrome.devtools.panels.elements.onSelectionChanged.addListener(refreshForCurrentSelection);

function refreshForCurrentSelection() {
  if (!currentFindings.length) {
    renderEmpty('No findings on this page yet.');
    return;
  }

  // Collect non-page-level selectors and ask the inspected window which one matches $0
  const selectors = [];
  for (const item of currentFindings) {
    if (item.isPageLevel || item.isHidden) continue;
    selectors.push(item.selector);
  }
  if (!selectors.length) {
    renderEmpty('No element-level findings on this page.');
    return;
  }

  const code = `(function() {
    var sels = ${JSON.stringify(selectors)};
    var matched = [];
    for (var i = 0; i < sels.length; i++) {
      try { if (document.querySelector(sels[i]) === $0) matched.push(sels[i]); } catch (e) {}
    }
    return matched;
  })()`;

  chrome.devtools.inspectedWindow.eval(code, (matched) => {
    if (!matched || !matched.length) {
      renderNoFindings();
      return;
    }
    const items = currentFindings.filter(item => matched.includes(item.selector));
    render(items);
  });
}

function renderEmpty(text) {
  content.innerHTML = `<div class="state">${escapeHtml(text)}</div>`;
}

function renderNoFindings() {
  content.innerHTML = `<div class="state"><strong>Clean.</strong> No anti-patterns on this element.</div>`;
}

function render(items) {
  const html = [];
  for (const item of items) {
    for (const f of item.findings) {
      const isSlop = f.category === 'slop';
      const marker = isSlop ? '<span class="marker">\u2726</span>' : '';
      const kind = isSlop ? 'AI tell' : 'Quality';
      html.push(`
        <div class="finding">
          <div class="finding-header">
            <span class="finding-name">${marker}${escapeHtml(f.name)}</span>
            <span class="finding-kind ${isSlop ? 'is-slop' : 'is-quality'}">${kind}</span>
          </div>
          <div class="finding-detail">${escapeHtml(f.detail)}</div>
          <div class="finding-description">${escapeHtml(f.description)}</div>
        </div>
      `);
    }
  }
  content.innerHTML = html.join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
