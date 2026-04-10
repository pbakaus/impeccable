/**
 * Impeccable DevTools Extension - Panel
 *
 * Displays findings, provides controls for scanning and overlay toggling,
 * and allows clicking findings to inspect elements.
 */

// Match the DevTools theme (light or dark)
if (chrome.devtools.panels.themeName === 'dark') {
  document.documentElement.classList.add('theme-dark');
}

const tabId = chrome.devtools.inspectedWindow.tabId;

// Auto-reconnecting port. Service workers in MV3 can be terminated after ~30s of
// inactivity (especially when the browser window is unfocused). When they restart,
// the existing port becomes invalid. We recreate it lazily on the next use.
let port = null;
function getPort() {
  if (port) return port;
  port = chrome.runtime.connect({ name: `impeccable-panel-${tabId}` });
  port.onMessage.addListener(handlePortMessage);
  port.onDisconnect.addListener(() => { port = null; });
  return port;
}
function postToPort(msg) {
  try {
    getPort().postMessage(msg);
  } catch {
    // Port died mid-call. Drop it and try once more with a fresh port.
    port = null;
    try { getPort().postMessage(msg); } catch { /* give up silently */ }
  }
}

const badge = document.getElementById('badge');
const container = document.getElementById('findings-container');
const emptyState = document.getElementById('empty-state');
const btnRescan = document.getElementById('btn-rescan');
const btnToggle = document.getElementById('btn-toggle');
const btnCopyAll = document.getElementById('btn-copy-all');
const settingsContainer = document.getElementById('settings-container');
const settingsList = document.getElementById('settings-list');
const btnSettings = document.getElementById('btn-settings');

let overlaysVisible = true;
let allAntipatterns = [];
let disabledRules = [];
let currentFindings = [];

// Load antipatterns list and disabled rules
async function initSettings() {
  try {
    const resp = await fetch(chrome.runtime.getURL('detector/antipatterns.json'));
    allAntipatterns = await resp.json();
  } catch { allAntipatterns = []; }

  const stored = await chrome.storage.sync.get({
    disabledRules: [],
    lineLengthMode: 'strict',
    spotlightBlur: true,
    autoScan: 'panel',
  });
  disabledRules = stored.disabledRules;
  renderSettings();
  initLineLengthControl(stored.lineLengthMode);
  initSpotlightBlurToggle(stored.spotlightBlur);
  initAutoScanControl(stored.autoScan);
}

function initAutoScanControl(currentMode) {
  const group = document.getElementById('auto-scan-mode');
  if (!group) return;
  for (const btn of group.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.value === currentMode);
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.value;
      for (const b of group.querySelectorAll('button')) {
        b.classList.toggle('active', b === btn);
      }
      await chrome.storage.sync.set({ autoScan: mode });
    });
  }
}

function initLineLengthControl(currentMode) {
  const group = document.getElementById('line-length-mode');
  if (!group) return;
  for (const btn of group.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.value === currentMode);
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.value;
      for (const b of group.querySelectorAll('button')) {
        b.classList.toggle('active', b === btn);
      }
      await chrome.storage.sync.set({ lineLengthMode: mode });
      chrome.runtime.sendMessage({ action: 'disabled-rules-changed' });
    });
  }
}

function initSpotlightBlurToggle(currentValue) {
  const cb = document.getElementById('spotlight-blur-toggle');
  if (!cb) return;
  cb.checked = currentValue;
  cb.addEventListener('change', async () => {
    await chrome.storage.sync.set({ spotlightBlur: cb.checked });
    chrome.runtime.sendMessage({ action: 'disabled-rules-changed' });
  });
}

function renderSettings() {
  settingsList.innerHTML = '';

  const categories = {
    slop: { label: 'AI tells', items: [] },
    quality: { label: 'Quality', items: [] },
  };
  for (const ap of allAntipatterns) {
    const cat = ap.category || 'quality';
    (categories[cat] || categories.quality).items.push(ap);
  }

  for (const [, group] of Object.entries(categories)) {
    if (!group.items.length) continue;

    const header = document.createElement('div');
    header.className = 'settings-header';
    header.textContent = group.label;
    settingsList.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'settings-grid';

    for (const ap of group.items) {
      const label = document.createElement('label');
      label.className = 'setting-rule';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !disabledRules.includes(ap.id);
      checkbox.addEventListener('change', () => toggleRule(ap.id, checkbox.checked));

      const text = document.createElement('span');
      text.textContent = ap.name;

      label.appendChild(checkbox);
      label.appendChild(text);
      grid.appendChild(label);
    }
    settingsList.appendChild(grid);
  }
}

async function toggleRule(ruleId, enabled) {
  if (enabled) {
    disabledRules = disabledRules.filter(id => id !== ruleId);
  } else {
    if (!disabledRules.includes(ruleId)) disabledRules.push(ruleId);
  }
  await chrome.storage.sync.set({ disabledRules });
  chrome.runtime.sendMessage({ action: 'disabled-rules-changed' });
}

// Listen for messages from the service worker (called by getPort() on each new connection)
function handlePortMessage(msg) {
  if (msg.action === 'page-pointer-active') {
    // Cursor is active on the page → user has left the panel
    setHoveredItem(null);
    return;
  }
  if (msg.action === 'findings' || msg.action === 'state') {
    renderFindings(msg.findings || []);
    if (msg.overlaysVisible !== undefined) {
      overlaysVisible = msg.overlaysVisible;
      updateToggleButton();
    }
  }
  if (msg.action === 'overlays-toggled') {
    overlaysVisible = msg.visible;
    updateToggleButton();
  }
  if (msg.action === 'navigated') {
    showScanning();
  }
}

// Initial connection
getPort();

// Heartbeat to keep the MV3 service worker alive while the panel is open.
// SWs can be terminated after ~30s of inactivity, especially when the browser is unfocused.
setInterval(() => postToPort({ action: 'ping' }), 20000);

// Controls
btnRescan.addEventListener('click', () => {
  showScanning();
  postToPort({ action: 'scan' });
});

btnToggle.addEventListener('click', () => {
  postToPort({ action: 'toggle-overlays' });
});

btnSettings.addEventListener('click', () => {
  const isVisible = settingsContainer.style.display !== 'none';
  settingsContainer.style.display = isVisible ? 'none' : '';
  btnSettings.classList.toggle('active', !isVisible);
});

function updateToggleButton() {
  btnToggle.title = overlaysVisible ? 'Hide overlays' : 'Show overlays';
  btnToggle.classList.toggle('inactive', !overlaysVisible);
}

function showScanning() {
  container.innerHTML = `
    <div class="scanning-indicator">
      <div class="scanning-dot"></div>
      Scanning page...
    </div>`;
}

// Maps each anti-pattern to the most relevant Impeccable skill(s) for fixing it.
// These are suggestions; the user decides whether and how to apply them.
const FIX_SKILLS = {
  // AI slop
  'side-tab':                'distill, polish',
  'border-accent-on-rounded':'distill, polish',
  'overused-font':           'typeset',
  'single-font':             'typeset',
  'flat-type-hierarchy':     'typeset',
  'gradient-text':           'typeset, distill',
  'ai-color-palette':        'colorize, distill',
  'nested-cards':            'distill, arrange',
  'monotonous-spacing':      'arrange',
  'everything-centered':     'arrange',
  'bounce-easing':           'animate',
  'dark-glow':               'quieter, distill',
  'icon-tile-stacked-above-heading': 'distill, arrange',
  // Quality
  'pure-black-white':        'colorize',
  'gray-on-color':           'colorize',
  'low-contrast':            'colorize, audit',
  'layout-transition':       'animate, optimize',
  'line-length':             'arrange, typeset',
  'cramped-padding':         'arrange, polish',
  'tight-leading':           'typeset',
  'skipped-heading':         'audit, harden',
  'justified-text':          'typeset',
  'tiny-text':               'typeset',
  'all-caps-body':           'typeset',
  'wide-tracking':           'typeset',
};

function fixSkillFor(type) {
  const skills = FIX_SKILLS[type] || 'polish';
  // Prefix each comma-separated skill with a slash for clarity
  return skills.split(',').map(s => '/' + s.trim()).join(', ');
}

// Returns a sorted array of unique skills referenced by the given findings,
// most-frequent first. Each entry already has the leading slash.
function uniqueSkillsForFindings(findings) {
  const counts = new Map();
  for (const item of findings) {
    for (const f of item.findings) {
      const list = (FIX_SKILLS[f.type] || 'polish').split(',').map(s => '/' + s.trim());
      for (const s of list) {
        counts.set(s, (counts.get(s) || 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

function getInspectedUrl() {
  return new Promise((resolve) => {
    // Strip the URL fragment — anchors are noise for "what page is this from"
    chrome.devtools.inspectedWindow.eval(
      '(function(){var u=new URL(location.href);u.hash="";return u.toString();})()',
      (result) => resolve(typeof result === 'string' ? result : '')
    );
  });
}

async function formatFindingsForCopy(findings) {
  if (!findings.length) return 'Impeccable found no anti-patterns on this page.';
  const url = await getInspectedUrl();
  const lines = ['# Impeccable findings'];
  if (url) lines.push(`URL: ${url}`);
  lines.push('');

  const groups = { slop: [], quality: [] };
  for (const item of findings) {
    for (const f of item.findings) {
      const cat = f.category || 'quality';
      groups[cat].push({ ...f, selector: item.selector, isPageLevel: item.isPageLevel });
    }
  }

  if (groups.slop.length) {
    lines.push(`## AI tells (${groups.slop.length})`);
    for (const f of groups.slop) {
      const where = f.isPageLevel ? '_(page-level)_' : `\`${f.selector}\``;
      lines.push(`- **${f.name}** at ${where}: ${f.detail}`);
    }
    lines.push('');
  }

  if (groups.quality.length) {
    lines.push(`## Quality issues (${groups.quality.length})`);
    for (const f of groups.quality) {
      const where = f.isPageLevel ? '_(page-level)_' : `\`${f.selector}\``;
      lines.push(`- **${f.name}** at ${where}: ${f.detail}`);
    }
    lines.push('');
  }

  // Roll up suggested skills across all findings (most-relevant first)
  const skills = uniqueSkillsForFindings(findings);
  if (skills.length) {
    lines.push(`Suggested Impeccable skills to fix: ${skills.join(', ')}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('Detected by [Impeccable](https://impeccable.style). Skills are suggestions, not required.');
  return lines.join('\n');
}

async function formatSingleFindingForCopy(item, finding) {
  const url = await getInspectedUrl();
  const where = item.isPageLevel ? '_(page-level)_' : `\`${item.selector}\``;
  const lines = [`# Impeccable: ${finding.name}`];
  if (url) lines.push(`URL: ${url}`);
  lines.push(`Element: ${where}`);
  lines.push(`Detail: ${finding.detail}`);
  lines.push('');
  lines.push(finding.description);
  lines.push('');
  lines.push(`Suggested Impeccable skill(s) to fix: ${fixSkillFor(finding.type)}`);
  return lines.join('\n');
}

async function copyToClipboard(text, btn) {
  if (text instanceof Promise) text = await text;
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const orig = btn.title;
      btn.title = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.title = orig;
        btn.classList.remove('copied');
      }, 1200);
    }
  } catch (err) {
    console.warn('Copy failed', err);
  }
}

btnCopyAll.addEventListener('click', () => {
  copyToClipboard(formatFindingsForCopy(currentFindings), btnCopyAll);
});

// Delegated hover tracking on the findings container.
// Reliably handles cursor moving between items, into children, or out of the panel.
let currentHoverSelector = null;
function setHoveredItem(selector) {
  if (selector === currentHoverSelector) return;
  currentHoverSelector = selector;
  if (selector) {
    postToPort({ action: 'highlight', selector });
  } else {
    postToPort({ action: 'unhighlight' });
  }
}

container.addEventListener('pointermove', (e) => {
  const item = e.target.closest('.finding-item');
  const selector = item && !item.classList.contains('is-hidden') ? item.dataset.selector || null : null;
  setHoveredItem(selector);
});

// Slow-cursor fallbacks (these fire reliably for slow movements)
container.addEventListener('pointerleave', () => setHoveredItem(null));
window.addEventListener('blur', () => setHoveredItem(null));


function renderFindings(findings) {
  currentFindings = findings;
  if (!findings.length) {
    container.innerHTML = '';
    container.appendChild(emptyState);
    emptyState.style.display = '';
    badge.classList.remove('visible');
    badge.textContent = '0';
    return;
  }

  emptyState.style.display = 'none';

  // Count total element-level findings
  const totalCount = findings.reduce((sum, f) => sum + f.findings.length, 0);
  badge.textContent = String(totalCount);
  badge.classList.add('visible');

  // Group findings by category, then by anti-pattern type
  const categories = { slop: new Map(), quality: new Map() };
  for (const item of findings) {
    for (const f of item.findings) {
      const cat = f.category || 'quality';
      const groups = categories[cat] || categories.quality;
      if (!groups.has(f.type)) {
        groups.set(f.type, { name: f.name, description: f.description, items: [] });
      }
      groups.get(f.type).items.push({
        selector: item.selector,
        tagName: item.tagName,
        isPageLevel: item.isPageLevel,
        isHidden: item.isHidden,
        detail: f.detail,
      });
    }
  }

  container.innerHTML = '';

  const CATEGORY_LABELS = { slop: 'AI tells', quality: 'Quality issues' };
  for (const [catKey, groups] of Object.entries(categories)) {
    if (groups.size === 0) continue;

    const catCount = [...groups.values()].reduce((sum, g) => sum + g.items.length, 0);
    const section = document.createElement('div');
    section.className = 'category-section category-' + catKey;

    const catHeader = document.createElement('div');
    catHeader.className = 'category-header';
    catHeader.innerHTML = `
      <span class="category-dot category-dot-${catKey}"></span>
      <span class="category-name">${CATEGORY_LABELS[catKey]}</span>
      <span class="category-count">${catCount}</span>`;
    section.appendChild(catHeader);

    for (const [type, group] of groups) {
    const groupEl = document.createElement('div');
    groupEl.className = 'finding-group';

    const header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML = `
      <span class="group-chevron">&#9660;</span>
      <span class="group-name">${escapeHtml(group.name)}</span>
      <span class="group-count">${group.items.length}</span>`;
    header.addEventListener('click', () => header.classList.toggle('collapsed'));
    groupEl.appendChild(header);

    const itemsEl = document.createElement('div');
    itemsEl.className = 'group-items';

    for (const item of group.items) {
      const itemEl = document.createElement('div');
      itemEl.className = 'finding-item' + (item.isHidden ? ' is-hidden' : '');
      const tag = item.isPageLevel
        ? '<span class="finding-tag tag-page">page</span>'
        : item.isHidden ? '<span class="finding-tag tag-hidden" title="Element is currently hidden on the page">hidden</span>' : '';
      itemEl.innerHTML = `
        ${tag}
        <div class="finding-row">
          <span class="finding-selector">${escapeHtml(item.selector)}</span>
          <button class="finding-copy" title="Copy this finding">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M11 1H3a2 2 0 0 0-2 2v10h2V3h8V1zm3 3H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 11H7V6h7v9z" fill="currentColor"/></svg>
          </button>
        </div>
        <span class="finding-detail">${escapeHtml(item.detail)}</span>
        <span class="finding-description">${escapeHtml(group.description)}</span>`;

      const copyBtn = itemEl.querySelector('.finding-copy');
      const finding = { type, name: group.name, description: group.description, detail: item.detail };
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(formatSingleFindingForCopy(item, finding), copyBtn);
      });

      if (!item.isPageLevel && !item.isHidden) {
        itemEl.dataset.selector = item.selector;
        itemEl.addEventListener('click', () => inspectElement(item.selector));
      }

      itemsEl.appendChild(itemEl);
    }

    groupEl.appendChild(itemsEl);
    section.appendChild(groupEl);
  }

    container.appendChild(section);
  }
}

function inspectElement(selector) {
  const json = JSON.stringify(selector);
  chrome.devtools.inspectedWindow.eval(
    `(function() {
      var el = document.querySelector(${json});
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); inspect(el); }
    })()`
  );
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

initSettings();
