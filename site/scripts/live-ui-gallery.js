/*
 * Dev-only Impeccable Live state gallery.
 *
 * This is a static state harness, not a second implementation of Live. It
 * mirrors the exact chrome vocabulary and state wording from:
 *   skill/scripts/live-browser.js
 *   skill/scripts/live/ui-core.mjs
 * Command labels/icons are injected by LiveUiGallery.astro from the canonical
 * skill/scripts/live/vocabulary.mjs export.
 */

const ICONS = Object.freeze({
  pick: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>',
  insert: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  detect: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  chat: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  voice: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
  submit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
  tune: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="8" x2="20" y2="8"/><circle cx="14" cy="8" r="2.4" fill="currentColor" stroke="none"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="10" cy="16" r="2.4" fill="currentColor" stroke="none"/></svg>',
  edit: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
  trash: '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h8"/><path d="M5 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1"/><path d="M4 4l.5 7a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1L10 4"/></svg>',
  exit: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><line x1="3" y1="3" x2="11" y2="11"/><line x1="11" y1="3" x2="3" y2="11"/></svg>',
});

function parseJson(root, selector, fallback = []) {
  try {
    return JSON.parse(root.querySelector(selector)?.textContent || '[]');
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function brandMark() {
  return '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 2.5 L13.5 2.5 L5.5 21.5 L5 21.5 Q2.5 21.5 2.5 19 L2.5 5 Q2.5 2.5 5 2.5 Z"/><path d="M16.5 2.5 L19 2.5 Q21.5 2.5 21.5 5 L21.5 19 Q21.5 21.5 19 21.5 L8.5 21.5 Z"/></svg>';
}

function designMark() {
  return '<span class="lvg-design-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
}

function hostPage({ edited = false, insert = false } = {}) {
  return `
    <div class="lvg-host-page${insert ? ' has-insert' : ''}">
      <p class="lvg-host-kicker">Northstar field journal · Edition 08</p>
      <article class="lvg-host-target"${edited ? ' data-edited="true"' : ''}>
        <h4>${edited ? 'Useful observations, refined.' : 'Useful observations from the long way around.'}</h4>
        <p>Four routes, annotated maps, and practical details for unhurried weekends.</p>
      </article>
    </div>`;
}

function selectionOutline() {
  return '<div class="lvg-selection-outline" aria-hidden="true"></div>';
}

function dots({ arrived = 0, visible = 0, expected = 3, clickable = false } = {}) {
  let html = '<span class="lvg-dots" aria-label="Variant progress">';
  for (let index = 1; index <= expected; index += 1) {
    const active = index === visible;
    const pending = index > arrived;
    const className = `lvg-dot${active ? ' is-active' : ''}${pending ? ' is-pending' : ''}`;
    if (clickable && !pending) {
      const target = index === 1 ? 'cycling-progressive' : 'cycling-second';
      html += `<button type="button" class="${className}" data-gallery-go="${target}" aria-label="Show variant ${index}"${active ? ' aria-current="true"' : ''}></button>`;
    } else {
      html += `<i class="${className}" aria-hidden="true"></i>`;
    }
  }
  return html + '</span>';
}

function configureBar({ actionLabel, count, listening = false, locked = false, insert = false, picker = '' } = {}) {
  const inputValue = insert
    ? 'Add a compact proof strip'
    : listening
      ? 'Tighten the hierarchy'
      : locked
        ? ''
        : 'Make this feel more confident';
  const actionControl = insert ? '' : `
    <button type="button" class="lvg-configure-modifier" data-gallery-go="action-picker" aria-haspopup="listbox" aria-expanded="${picker ? 'true' : 'false'}">
      ${escapeHtml(actionLabel)} <span aria-hidden="true">▾</span>
    </button>`;
  return `
    <div class="lvg-live-context is-configure${picker ? ' has-picker' : ''}"${locked ? ' data-locked="true"' : ''}>
      <div class="lvg-configure-row">
        <div class="lvg-configure-input-shell">
          <button type="button" class="lvg-selection-pill" data-gallery-go="global-ready" aria-label="Clear selection">${insert ? 'slot' : 'article'}</button>
          <input class="lvg-configure-input" aria-label="${insert ? 'Describe the new element' : 'Describe the change'}" value="${escapeHtml(inputValue)}"${locked ? ' placeholder="apply is running..." disabled' : ''} />
        </div>
        <div class="lvg-configure-trailing">
          <div class="lvg-configure-modifiers">
            ${actionControl}
            <button type="button" class="lvg-configure-modifier is-count" data-gallery-count aria-label="Change variant count">×${count}</button>
          </div>
          <button type="button" class="lvg-configure-voice" data-gallery-go="${listening ? 'configure-replace' : 'configure-listening'}" aria-label="${listening ? 'Stop voice input' : 'Voice input'}" aria-pressed="${listening}">${ICONS.voice}</button>
          <button type="button" class="lvg-configure-submit" data-gallery-go="generating" aria-label="${insert ? 'Create variants' : 'Generate variants'}">${ICONS.submit}</button>
        </div>
      </div>
      ${picker}
    </div>`;
}

function actionPicker(commands, selectedAction) {
  return `
    <div class="lvg-action-picker" role="listbox" aria-label="Design action">
      <div class="lvg-action-grid">
        ${commands.map((command) => `
          <button type="button" class="lvg-action-chip" role="option" data-gallery-action="${escapeHtml(command.value)}" aria-pressed="${command.value === selectedAction}">
            <span>${command.icon}</span><span>${escapeHtml(command.label)}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

function generatingBar(recovery = false, actionLabel = 'Freeform') {
  return `
    <div class="lvg-live-context">
      <div class="lvg-generation-row">
        <span class="lvg-generation-label">${escapeHtml(actionLabel)}</span>
        ${dots({ expected: 3 })}
        <span class="lvg-generation-status">${recovery ? 'Variants ready. Reveal the selected element to resume.' : 'Source ready. Generating...'}</span>
      </div>
    </div>`;
}

function tuneButton(open) {
  return `
    <button type="button" class="lvg-tune-button" data-gallery-go="${open ? 'cycling-second' : 'tune-open'}" aria-expanded="${open}">
      ${ICONS.tune}<span>Tune</span><span class="lvg-tune-badge">3</span>
    </button>`;
}

function cyclingBar({ arrived = 1, visible = 1, tune = false } = {}) {
  const remaining = 3 - arrived;
  return `
    <div class="lvg-live-context${tune ? ' has-tune' : ''}">
      <div class="lvg-cycling-row">
        <button type="button" class="lvg-nav-button" data-gallery-go="cycling-progressive" aria-label="Previous variant"${visible <= 1 ? ' disabled' : ''}>←</button>
        ${dots({ arrived, visible, expected: 3, clickable: true })}
        <span class="lvg-variant-counter">${visible}/3</span>
        <button type="button" class="lvg-nav-button" data-gallery-go="cycling-second" aria-label="Next variant"${visible >= arrived ? ' disabled' : ''}>→</button>
        ${tuneButton(tune)}
        <span class="lvg-cycling-spacer"></span>
        ${remaining > 0 ? `<span class="lvg-arrival-progress">${remaining} more arriving...</span>` : ''}
        <button type="button" class="lvg-accept" data-gallery-go="applying">✓ Accept</button>
        <button type="button" class="lvg-discard" data-gallery-go="global-ready" aria-label="Discard all variants" title="Discard all variants">✕</button>
      </div>
      ${tune ? tunePanel() : ''}
    </div>`;
}

function tunePanel() {
  return `
    <div class="lvg-tune-panel">
      <div class="lvg-tune-grid">
        <div class="lvg-param">
          <div class="lvg-param-header"><strong>Color amount</strong><output data-gallery-range-output>0.60</output></div>
          <input type="range" min="0" max="1" step="0.05" value="0.6" data-gallery-range aria-label="Color amount" />
        </div>
        <div class="lvg-param">
          <div class="lvg-param-header"><strong>Density</strong><output data-gallery-density-output>Snug</output></div>
          <div class="lvg-param-steps" role="group" aria-label="Density">
            <button type="button" data-gallery-density="Airy" aria-pressed="false">Airy</button>
            <button type="button" data-gallery-density="Snug" aria-pressed="true">Snug</button>
            <button type="button" data-gallery-density="Packed" aria-pressed="false">Packed</button>
          </div>
        </div>
        <div class="lvg-param">
          <div class="lvg-param-header"><strong>Motion</strong><output data-gallery-toggle-output>Off</output></div>
          <button type="button" class="lvg-param-toggle" data-gallery-param-toggle aria-label="Motion" aria-pressed="false"></button>
        </div>
      </div>
    </div>`;
}

function statusBar(kind) {
  if (kind === 'confirmed') {
    return '<div class="lvg-live-context is-confirmed"><div class="lvg-status-row"><span aria-hidden="true">✓</span><span>Variant applied</span></div></div>';
  }
  return '<div class="lvg-live-context"><div class="lvg-status-row"><i class="lvg-spinner" aria-hidden="true"></i><span>Applying variant...</span></div></div>';
}

function editBadge(editing = false) {
  if (!editing) {
    return `<div class="lvg-edit-badge"><button type="button" class="is-icon" data-gallery-go="edit-copy" aria-label="Edit copy" title="Edit copy">${ICONS.edit}</button></div>`;
  }
  return '<div class="lvg-edit-badge"><button type="button" data-gallery-go="configure-replace">Cancel</button><button type="button" class="is-primary" data-gallery-go="copy-pending">Save</button></div>';
}

function annotationLayer() {
  return `
    <div class="lvg-annotation-layer">
      <svg viewBox="0 0 404 150" aria-hidden="true"><path d="M44 106 C82 74, 136 83, 175 105 S267 135, 322 90"/></svg>
      <button type="button" class="lvg-annotation-clear" data-gallery-go="configure-replace">Clear</button>
      <div class="lvg-annotation-pin"><span>Keep this line on one row</span></div>
    </div>`;
}

function pendingDock(kind) {
  if (kind === 'attention') {
    return `
      <div class="lvg-pending-dock">
        <button type="button" class="lvg-pending-pill" disabled>Apply needs attention</button>
        <button type="button" class="lvg-pending-decision is-primary" data-gallery-go="copy-applying">Keep fixing</button>
        <button type="button" class="lvg-pending-decision" data-gallery-go="copy-pending">Rollback</button>
      </div>`;
  }
  const applying = kind === 'applying';
  return `
    <div class="lvg-pending-dock">
      <button type="button" class="lvg-pending-pill" data-gallery-go="${applying ? 'copy-attention' : 'copy-applying'}" aria-busy="${applying}"${applying ? ' disabled' : ''}>
        ${applying ? '<i class="lvg-pending-spinner" aria-hidden="true"></i><span>Applying 3 copy edits</span>' : '<span>Apply copy edits</span><span class="lvg-pending-count">3</span>'}
      </button>
      <button type="button" class="lvg-pending-trash" data-gallery-go="global-ready" aria-label="Discard copy edits on this page">${ICONS.trash}</button>
    </div>`;
}

function designPanel(tab = 'visual') {
  const raw = tab === 'raw';
  return `
    <aside class="lvg-design-panel" aria-label="DESIGN.md panel">
      <header class="lvg-design-header">
        <span class="lvg-design-title">DESIGN.md</span>
        <div class="lvg-design-tabs" role="tablist" aria-label="Design system view">
          <button type="button" role="tab" data-gallery-design-tab="visual" aria-selected="${!raw}">Visual</button>
          <button type="button" role="tab" data-gallery-design-tab="raw" aria-selected="${raw}">Raw</button>
        </div>
        <button type="button" class="lvg-design-close" data-gallery-go="global-tools" aria-label="Close panel">✕</button>
      </header>
      <div class="lvg-design-body">
        ${raw ? `
          <div class="lvg-design-tile">
            <div class="lvg-design-meta"><strong>Neo Kinpaku</strong><span>Raw</span></div>
            <p class="lvg-design-copy"># Design System: Impeccable<br><br>Dark lacquer, kinpaku gold, and precise technical geometry.</p>
          </div>` : `
          <div class="lvg-design-tile">
            <div class="lvg-design-meta"><strong>Kinpaku Gold</strong><span>Primary</span></div>
            <div class="lvg-design-swatch"></div>
            <p class="lvg-design-copy">Primary accent for commitment, active controls, and the Impeccable mark.</p>
          </div>
          <div class="lvg-design-tile">
            <div class="lvg-design-meta"><strong>Display</strong><span>Typography</span></div>
            <p class="lvg-design-type">Useful observations</p>
            <p class="lvg-design-copy">Alumni Sans · precise, light, and deliberately geometric.</p>
          </div>`}
      </div>
    </aside>`;
}

function globalBar({ connected = true, active = 'pick', steer = 'collapsed', detectCount = 0, designActive = false } = {}) {
  const modeButton = (key, icon, label, target, extra = '') => {
    const isActive = active === key || (key === 'design' && designActive);
    return `<button type="button" class="lvg-global-mode" data-active="${isActive}" data-gallery-go="${target}" aria-label="${escapeHtml(label)}">${icon}${isActive ? `<span>${escapeHtml(label)}</span>` : ''}${extra}</button>`;
  };
  const steerHtml = steer === 'processing'
    ? `<div class="lvg-steer" data-expanded="true" data-processing="true" aria-busy="true" aria-label="Processing steer request"><span class="lvg-steer-icon">${ICONS.chat}</span><span class="lvg-steer-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>`
    : steer === 'expanded'
      ? `<div class="lvg-steer" data-expanded="true"><span class="lvg-steer-icon">${ICONS.chat}</span><input type="text" value="Make the page hierarchy more decisive" data-gallery-steer-input aria-label="Steer the page"/><button type="button" class="lvg-steer-voice" aria-label="Voice input">${ICONS.voice}</button></div>`
      : `<button type="button" class="lvg-steer" data-gallery-go="steer-expanded" aria-label="Steer the page"><span class="lvg-steer-icon">${ICONS.chat}</span><span class="lvg-steer-hint">Steer</span><span class="lvg-steer-voice">${ICONS.voice}</span></button>`;

  return `
    <div class="lvg-live-global">
      <span class="lvg-live-brand" data-connected="${connected}" role="img" aria-label="Impeccable live mode${connected ? '' : ' - agent not polling'}">
        ${brandMark()}${connected ? '' : '<i class="lvg-agent-dot" aria-hidden="true"></i>'}
      </span>
      <div class="lvg-global-inner">
        ${modeButton('pick', ICONS.pick, 'Pick', 'configure-replace')}
        ${modeButton('insert', ICONS.insert, 'Insert', 'insert-placeholder')}
        ${modeButton('detect', ICONS.detect, 'Detect', 'global-tools', detectCount ? `<span class="lvg-detect-badge">${detectCount}</span>` : '')}
        ${modeButton('design', designMark(), 'DESIGN.md', 'design-panel')}
        ${steerHtml}
        <span class="lvg-global-divider" aria-hidden="true"></span>
        <button type="button" class="lvg-global-exit" data-gallery-go="global-ready" aria-label="Exit live mode" title="Exit live mode">${ICONS.exit}</button>
      </div>
    </div>`;
}

function sceneFor(state, context) {
  const actionLabel = context.commands.find((command) => command.value === context.selectedAction)?.label || 'Freeform';
  const commonGlobal = (opts = {}) => globalBar({ active: 'pick', ...opts });
  switch (state) {
    case 'global-disconnected':
      return hostPage() + '<div class="lvg-agent-tooltip" role="tooltip">Agent disconnected - run live-poll.mjs to connect</div>' + commonGlobal({ connected: false });
    case 'global-tools':
      return hostPage() + commonGlobal({ active: 'detect', detectCount: 7, designActive: true });
    case 'steer-expanded':
      return hostPage() + commonGlobal({ steer: 'expanded' });
    case 'steer-processing':
      return hostPage() + commonGlobal({ steer: 'processing' });
    case 'configure-replace':
      return hostPage() + selectionOutline() + editBadge(false) + configureBar({ actionLabel, count: context.count }) + commonGlobal();
    case 'action-picker':
      return hostPage() + selectionOutline() + editBadge(false) + configureBar({ actionLabel, count: context.count, picker: actionPicker(context.commands, context.selectedAction) }) + commonGlobal();
    case 'configure-listening':
      return hostPage() + selectionOutline() + editBadge(false) + configureBar({ actionLabel, count: context.count, listening: true }) + commonGlobal();
    case 'configure-locked':
      return hostPage({ edited: true }) + selectionOutline() + editBadge(false) + configureBar({ actionLabel, count: context.count, locked: true }) + pendingDock('applying') + commonGlobal();
    case 'annotation':
      return hostPage() + selectionOutline() + annotationLayer() + configureBar({ actionLabel, count: context.count }) + commonGlobal();
    case 'insert-placeholder':
      return hostPage({ insert: true }) + '<div class="lvg-insert-placeholder" aria-label="Insert placeholder"></div>' + configureBar({ count: context.count, insert: true }) + globalBar({ active: 'insert' });
    case 'generating':
      return hostPage() + selectionOutline() + generatingBar(false, actionLabel) + commonGlobal();
    case 'generation-recovery':
      return hostPage() + generatingBar(true, actionLabel) + commonGlobal();
    case 'cycling-progressive':
      return hostPage() + selectionOutline() + cyclingBar({ arrived: 1, visible: 1 }) + commonGlobal();
    case 'cycling-second':
      return hostPage() + selectionOutline() + cyclingBar({ arrived: 2, visible: 2 }) + commonGlobal();
    case 'tune-open':
      return hostPage() + selectionOutline() + cyclingBar({ arrived: 3, visible: 2, tune: true }) + commonGlobal();
    case 'applying':
      return hostPage() + selectionOutline() + statusBar('applying') + commonGlobal();
    case 'confirmed':
      return hostPage({ edited: true }) + statusBar('confirmed') + commonGlobal();
    case 'edit-copy':
      return hostPage({ edited: true }) + selectionOutline() + editBadge(true) + configureBar({ actionLabel, count: context.count }) + commonGlobal();
    case 'copy-pending':
      return hostPage({ edited: true }) + pendingDock('pending') + commonGlobal();
    case 'copy-applying':
      return hostPage({ edited: true }) + pendingDock('applying') + commonGlobal();
    case 'copy-attention':
      return hostPage({ edited: true }) + pendingDock('attention') + commonGlobal();
    case 'design-panel':
      return hostPage() + designPanel(context.designTab) + globalBar({ active: 'design', designActive: true });
    case 'toast-error':
      return hostPage() + '<div class="lvg-live-toast" role="alert">No variants were mounted. Please try again.</div>' + commonGlobal();
    case 'global-ready':
    default:
      return hostPage() + commonGlobal();
  }
}

function initLiveUiGallery(root) {
  if (!root || root.dataset.galleryReady === 'true') return;
  root.dataset.galleryReady = 'true';

  const states = parseJson(root, '[data-live-gallery-states]');
  const commands = parseJson(root, '[data-live-gallery-vocabulary]');
  if (states.length === 0 || commands.length === 0) return;

  const select = root.querySelector('[data-gallery-state]');
  const groupReadout = root.querySelector('[data-gallery-state-group]');
  const labelReadout = root.querySelector('[data-gallery-state-label]');
  const quickNav = root.querySelector('.live-ui-gallery__quick-nav');
  const previews = [...root.querySelectorAll('[data-live-gallery-preview]')];
  let selectedAction = 'impeccable';
  let count = 3;
  let designTab = 'visual';

  const stateIndex = (key) => Math.max(0, states.findIndex((state) => state.key === key));
  const currentState = () => select?.value || states[0].key;

  function render(nextState = currentState(), { focusSelect = false } = {}) {
    const state = states[stateIndex(nextState)] || states[0];
    if (select) select.value = state.key;
    if (groupReadout) groupReadout.textContent = state.group;
    if (labelReadout) labelReadout.textContent = state.label;

    let activeStateButton = null;
    root.querySelectorAll('[data-gallery-state-button]').forEach((button) => {
      const active = button.dataset.galleryStateButton === state.key;
      button.setAttribute('aria-current', active ? 'true' : 'false');
      if (active) activeStateButton = button;
    });

    for (const preview of previews) {
      preview.dataset.galleryState = state.key;
      preview.setAttribute('aria-label', `${preview.dataset.liveGalleryPreview} host — ${state.label}`);
      preview.innerHTML = sceneFor(state.key, { commands, selectedAction, count, designTab });
    }

    if (quickNav && activeStateButton) {
      requestAnimationFrame(() => {
        const navRect = quickNav.getBoundingClientRect();
        const buttonRect = activeStateButton.getBoundingClientRect();
        if (buttonRect.left < navRect.left) quickNav.scrollLeft -= navRect.left - buttonRect.left + 8;
        if (buttonRect.right > navRect.right) quickNav.scrollLeft += buttonRect.right - navRect.right + 8;
      });
    }
    if (focusSelect) select?.focus();
  }

  function step(delta) {
    const next = (stateIndex(currentState()) + delta + states.length) % states.length;
    render(states[next].key, { focusSelect: true });
  }

  select?.addEventListener('change', () => render(select.value));

  root.addEventListener('click', (event) => {
    const stepButton = event.target.closest('[data-gallery-step]');
    if (stepButton) {
      step(Number(stepButton.dataset.galleryStep) || 1);
      return;
    }

    const stateButton = event.target.closest('[data-gallery-state-button]');
    if (stateButton) {
      render(stateButton.dataset.galleryStateButton);
      return;
    }

    const actionButton = event.target.closest('[data-gallery-action]');
    if (actionButton) {
      selectedAction = actionButton.dataset.galleryAction || 'impeccable';
      render('configure-replace');
      return;
    }

    const countButton = event.target.closest('[data-gallery-count]');
    if (countButton) {
      count = count >= 4 ? 1 : count + 1;
      render(currentState());
      return;
    }

    const densityButton = event.target.closest('[data-gallery-density]');
    if (densityButton) {
      const value = densityButton.dataset.galleryDensity;
      root.querySelectorAll('[data-gallery-density]').forEach((button) => {
        button.setAttribute('aria-pressed', button.dataset.galleryDensity === value ? 'true' : 'false');
      });
      root.querySelectorAll('[data-gallery-density-output]').forEach((output) => { output.textContent = value; });
      return;
    }

    const toggleButton = event.target.closest('[data-gallery-param-toggle]');
    if (toggleButton) {
      const next = toggleButton.getAttribute('aria-pressed') !== 'true';
      root.querySelectorAll('[data-gallery-param-toggle]').forEach((button) => button.setAttribute('aria-pressed', String(next)));
      root.querySelectorAll('[data-gallery-toggle-output]').forEach((output) => { output.textContent = next ? 'On' : 'Off'; });
      return;
    }

    const designTabButton = event.target.closest('[data-gallery-design-tab]');
    if (designTabButton) {
      designTab = designTabButton.dataset.galleryDesignTab === 'raw' ? 'raw' : 'visual';
      render('design-panel');
      return;
    }

    const trigger = event.target.closest('[data-gallery-go]');
    if (trigger && !trigger.disabled) render(trigger.dataset.galleryGo);
  });

  root.addEventListener('input', (event) => {
    const range = event.target.closest('[data-gallery-range]');
    if (!range) return;
    const value = Number(range.value).toFixed(2);
    root.querySelectorAll('[data-gallery-range]').forEach((input) => { if (input !== range) input.value = range.value; });
    root.querySelectorAll('[data-gallery-range-output]').forEach((output) => { output.textContent = value; });
  });

  root.addEventListener('keydown', (event) => {
    if (event.target.matches('[data-gallery-steer-input]') && event.key === 'Enter') {
      event.preventDefault();
      render('steer-processing');
      return;
    }

    const stateButton = event.target.closest('[data-gallery-state-button]');
    if (stateButton && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const current = stateIndex(stateButton.dataset.galleryStateButton);
      const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? states.length - 1
          : (current + (event.key === 'ArrowLeft' ? -1 : 1) + states.length) % states.length;
      render(states[next].key);
      root.querySelector(`[data-gallery-state-button="${states[next].key}"]`)?.focus();
      return;
    }

    const panel = event.target.closest('.live-ui-gallery__control-panel');
    if (!panel || event.target.matches('input')) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      render(states[0].key, { focusSelect: true });
    } else if (event.key === 'End') {
      event.preventDefault();
      render(states[states.length - 1].key, { focusSelect: true });
    }
  });

  render(states[0].key);
}

function initLiveUiGalleries() {
  document.querySelectorAll('[data-live-ui-gallery]').forEach(initLiveUiGallery);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLiveUiGalleries, { once: true });
} else {
  initLiveUiGalleries();
}

document.addEventListener('astro:page-load', initLiveUiGalleries);
