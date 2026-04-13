/**
 * Impeccable Live Variant Mode — Browser Script
 *
 * Injected into the user's page via <script src="http://localhost:PORT/live.js">.
 * The server prepends window.__IMPECCABLE_TOKEN__ and window.__IMPECCABLE_PORT__
 * before this code.
 *
 * UI: a single floating bar that morphs between three states —
 * configure (pick action + go), generating (progressive dots), and cycling
 * (prev/next + accept/discard). Feels like Spotlight, not a modal.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  // Guard against double-init. Bun's HTML loader may process the <script> tag
  // and create a bundled copy alongside the external load, or HMR may re-execute.
  // Check BEFORE reading token/port to catch all cases.
  if (window.__IMPECCABLE_LIVE_INIT__) return;
  window.__IMPECCABLE_LIVE_INIT__ = true;

  const TOKEN = window.__IMPECCABLE_TOKEN__;
  const PORT = window.__IMPECCABLE_PORT__;
  if (!TOKEN || !PORT) {
    window.__IMPECCABLE_LIVE_INIT__ = false; // reset so the real load can init
    return;
  }

  // ---------------------------------------------------------------------------
  // Design tokens
  // ---------------------------------------------------------------------------

  const C = {
    brand:     'oklch(55% 0.25 350)',
    brandHov:  'oklch(48% 0.25 350)',
    brandSoft: 'oklch(55% 0.25 350 / 0.12)',
    ink:       'oklch(15% 0.01 350)',
    ash:       'oklch(55% 0 0)',
    paper:     'oklch(98% 0.005 350 / 0.92)',
    paperSolid:'oklch(98% 0.005 350)',
    mist:      'oklch(90% 0.01 350 / 0.6)',
    white:     'oklch(99% 0 0)',
  };
  const FONT = 'system-ui, -apple-system, sans-serif';
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
  const Z = { highlight: 99990, bar: 99995, picker: 99997, toast: 99999 };
  const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'; // ease-out-quint
  const PREFIX = 'impeccable-live';

  const SKIP_TAGS = new Set([
    'html', 'head', 'body', 'script', 'style', 'link', 'meta', 'noscript', 'br', 'wbr',
  ]);

  const ACTIONS = [
    { value: 'impeccable', label: 'Freeform' },
    { value: 'bolder',     label: 'Bolder' },
    { value: 'quieter',    label: 'Quieter' },
    { value: 'distill',    label: 'Distill' },
    { value: 'polish',     label: 'Polish' },
    { value: 'typeset',    label: 'Typeset' },
    { value: 'colorize',   label: 'Colorize' },
    { value: 'layout',     label: 'Layout' },
    { value: 'adapt',      label: 'Adapt' },
    { value: 'animate',    label: 'Animate' },
    { value: 'delight',    label: 'Delight' },
    { value: 'overdrive',  label: 'Overdrive' },
  ];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let state = 'IDLE';
  let ws = null;
  let hoveredElement = null;
  let selectedElement = null;
  let currentSessionId = null;
  let expectedVariants = 0;
  let arrivedVariants = 0;
  let visibleVariant = 0;
  let variantObserver = null;
  let hasProjectContext = false;
  let selectedAction = 'impeccable';
  let selectedCount = 3;

  // UI refs
  let highlightEl = null;
  let tooltipEl = null;
  let barEl = null;
  let pickerEl = null;
  let toastEl = null;
  let scrollRaf = null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function own(el) {
    return el && (el.id?.startsWith(PREFIX) || el.closest?.('[id^="' + PREFIX + '"]'));
  }

  function pickable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAGS.has(el.tagName.toLowerCase())) return false;
    if (own(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 20 && r.height >= 20;
  }

  function desc(el) {
    if (!el) return '';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.classList.length) s += '.' + [...el.classList].slice(0, 2).join('.');
    return s;
  }

  function id8() { return crypto.randomUUID().replace(/-/g, '').slice(0, 8); }

  // ---------------------------------------------------------------------------
  // Highlight overlay
  // ---------------------------------------------------------------------------

  function initHighlight() {
    highlightEl = document.createElement('div');
    highlightEl.id = PREFIX + '-highlight';
    Object.assign(highlightEl.style, {
      position: 'fixed', top: '0', left: '0', width: '0', height: '0',
      border: '2px solid ' + C.brand, borderRadius: '3px',
      pointerEvents: 'none', zIndex: Z.highlight, boxSizing: 'border-box',
      transition: 'top 0.08s ease, left 0.08s ease, width 0.08s ease, height 0.08s ease, opacity 0.15s ease',
      display: 'none', opacity: '0',
    });
    document.body.appendChild(highlightEl);

    tooltipEl = document.createElement('div');
    tooltipEl.id = PREFIX + '-tooltip';
    Object.assign(tooltipEl.style, {
      position: 'fixed',
      background: C.ink, color: C.white,
      fontFamily: MONO, fontSize: '10px', fontWeight: '500',
      padding: '2px 6px', borderRadius: '3px',
      zIndex: Z.highlight + 1, pointerEvents: 'none',
      whiteSpace: 'nowrap', display: 'none',
      letterSpacing: '0.02em',
    });
    document.body.appendChild(tooltipEl);
  }

  function showHighlight(el) {
    if (!el || !highlightEl) return;
    const r = el.getBoundingClientRect();
    Object.assign(highlightEl.style, {
      top: (r.top - 2) + 'px', left: (r.left - 2) + 'px',
      width: (r.width + 4) + 'px', height: (r.height + 4) + 'px',
      display: 'block', opacity: '1',
    });
    tooltipEl.textContent = desc(el);
    const tipTop = r.top - 20;
    Object.assign(tooltipEl.style, {
      top: (tipTop < 4 ? r.bottom + 4 : tipTop) + 'px',
      left: Math.max(4, r.left) + 'px', display: 'block',
    });
  }

  function hideHighlight() {
    if (highlightEl) { highlightEl.style.opacity = '0'; highlightEl.style.display = 'none'; }
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // Element context extraction
  // ---------------------------------------------------------------------------

  function extractContext(el) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const props = {};
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.style) for (let i = 0; i < rule.style.length; i++) {
            const p = rule.style[i];
            if (p.startsWith('--') && !props[p]) {
              const v = cs.getPropertyValue(p).trim();
              if (v) props[p] = v;
            }
          }
        }
      } catch { /* cross-origin */ }
    }
    return {
      tagName: el.tagName.toLowerCase(), id: el.id || null,
      classes: [...el.classList],
      textContent: (el.textContent || '').slice(0, 500),
      outerHTML: el.outerHTML.slice(0, 10000),
      computedStyles: {
        'font-family': cs.fontFamily, 'font-size': cs.fontSize,
        'font-weight': cs.fontWeight, 'line-height': cs.lineHeight,
        'color': cs.color, 'background': cs.background,
        'background-color': cs.backgroundColor,
        'padding': cs.padding, 'margin': cs.margin,
        'display': cs.display, 'position': cs.position,
        'gap': cs.gap, 'border-radius': cs.borderRadius,
        'box-shadow': cs.boxShadow,
      },
      cssCustomProperties: props,
      parentContext: el.parentElement
        ? '<' + el.parentElement.tagName.toLowerCase()
          + (el.parentElement.id ? ' id="' + el.parentElement.id + '"' : '')
          + (el.parentElement.className ? ' class="' + el.parentElement.className + '"' : '')
          + '>'
        : null,
      boundingRect: { width: Math.round(r.width), height: Math.round(r.height) },
    };
  }

  // ---------------------------------------------------------------------------
  // The Bar — one floating element, three modes
  // ---------------------------------------------------------------------------

  function initBar() {
    barEl = document.createElement('div');
    barEl.id = PREFIX + '-bar';
    Object.assign(barEl.style, {
      position: 'fixed', zIndex: Z.bar,
      display: 'none', opacity: '0',
      transform: 'translateY(6px)',
      transition: 'opacity 0.25s ' + EASE + ', transform 0.3s ' + EASE,
      // Visual
      background: C.paper,
      backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid ' + C.mist,
      borderRadius: '10px',
      boxShadow: '0 4px 20px oklch(0% 0 0 / 0.08), 0 1px 3px oklch(0% 0 0 / 0.06)',
      fontFamily: FONT, fontSize: '13px', color: C.ink,
      padding: '6px',
      maxWidth: '460px', minWidth: '320px',
    });
    document.body.appendChild(barEl);
  }

  function positionBar() {
    if (!barEl || !selectedElement) return;
    const r = selectedElement.getBoundingClientRect();
    const barH = barEl.offsetHeight || 44;
    const barW = barEl.offsetWidth || 380;
    let top = r.bottom + 8;
    let left = r.left + (r.width - barW) / 2;
    // Keep in viewport
    if (top + barH + 8 > window.innerHeight) top = r.top - barH - 8;
    if (top < 8) top = 8;
    if (left < 8) left = 8;
    if (left + barW > window.innerWidth - 8) left = window.innerWidth - barW - 8;
    Object.assign(barEl.style, { top: top + 'px', left: left + 'px' });
  }

  function showBar(mode) {
    barEl.innerHTML = '';
    if (mode === 'configure') barEl.appendChild(buildConfigureRow());
    else if (mode === 'generating') barEl.appendChild(buildGeneratingRow());
    else if (mode === 'cycling') barEl.appendChild(buildCyclingRow());
    barEl.style.display = 'block';
    positionBar();
    requestAnimationFrame(() => {
      barEl.style.opacity = '1';
      barEl.style.transform = 'translateY(0)';
    });
  }

  function hideBar() {
    if (!barEl) return;
    barEl.style.opacity = '0';
    barEl.style.transform = 'translateY(6px)';
    setTimeout(() => { if (barEl) barEl.style.display = 'none'; }, 250);
    hideActionPicker();
  }

  function updateBarContent(mode) {
    if (!barEl || barEl.style.display === 'none') return;
    barEl.innerHTML = '';
    if (mode === 'configure') barEl.appendChild(buildConfigureRow());
    else if (mode === 'generating') barEl.appendChild(buildGeneratingRow());
    else if (mode === 'cycling') barEl.appendChild(buildCyclingRow());
  }

  // --- Configure row ---

  function buildConfigureRow() {
    const row = el('div', {
      display: 'flex', alignItems: 'center', gap: '4px',
    });

    // Action pill
    const pill = el('button', {
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '5px 10px', borderRadius: '6px',
      background: C.ink, color: C.white,
      fontFamily: FONT, fontSize: '12px', fontWeight: '500',
      border: 'none', cursor: 'pointer',
      transition: 'background 0.12s ease, transform 0.1s ease',
      whiteSpace: 'nowrap', flexShrink: '0',
    });
    pill.textContent = actionLabel() + ' \u25BE';
    pill.addEventListener('mouseenter', () => pill.style.background = C.brandHov);
    pill.addEventListener('mouseleave', () => pill.style.background = C.ink);
    pill.addEventListener('mousedown', () => pill.style.transform = 'scale(0.97)');
    pill.addEventListener('mouseup', () => pill.style.transform = 'scale(1)');
    pill.addEventListener('click', (e) => { e.stopPropagation(); toggleActionPicker(); });
    row.appendChild(pill);

    // Freeform input
    const input = document.createElement('input');
    input.id = PREFIX + '-input';
    input.type = 'text';
    input.placeholder = selectedAction === 'impeccable' ? 'describe what you want...' : 'refine further (optional)...';
    Object.assign(input.style, {
      flex: '1', minWidth: '0',
      padding: '5px 8px', borderRadius: '6px',
      border: '1px solid transparent', background: 'transparent',
      fontFamily: FONT, fontSize: '12px', color: C.ink,
      outline: 'none',
      transition: 'border-color 0.15s ease, background 0.15s ease',
    });
    input.addEventListener('focus', () => {
      input.style.borderColor = C.mist;
      input.style.background = C.white;
    });
    input.addEventListener('blur', () => {
      input.style.borderColor = 'transparent';
      input.style.background = 'transparent';
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // Don't trigger element picker keyboard nav
      if (e.key === 'Enter') { e.preventDefault(); handleGo(); }
      if (e.key === 'Escape') { e.preventDefault(); input.blur(); hideBar(); state = 'PICKING'; }
    });
    row.appendChild(input);

    // Variant count toggle
    const count = el('button', {
      padding: '4px 6px', borderRadius: '5px',
      border: '1px solid ' + C.mist, background: 'transparent',
      fontFamily: MONO, fontSize: '11px', fontWeight: '600',
      color: C.ash, cursor: 'pointer',
      transition: 'color 0.12s ease, border-color 0.12s ease',
      flexShrink: '0', whiteSpace: 'nowrap',
    });
    count.textContent = '\u00D7' + selectedCount;
    count.title = 'Variants: click to change';
    count.addEventListener('mouseenter', () => { count.style.color = C.ink; count.style.borderColor = C.ink; });
    count.addEventListener('mouseleave', () => { count.style.color = C.ash; count.style.borderColor = C.mist; });
    count.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedCount = selectedCount >= 4 ? 2 : selectedCount + 1;
      count.textContent = '\u00D7' + selectedCount;
    });
    row.appendChild(count);

    // Go button
    const go = el('button', {
      padding: '5px 12px', borderRadius: '6px',
      border: 'none', background: C.brand, color: C.white,
      fontFamily: FONT, fontSize: '12px', fontWeight: '600',
      cursor: 'pointer',
      transition: 'background 0.12s ease, transform 0.1s ease',
      flexShrink: '0', whiteSpace: 'nowrap',
    });
    go.textContent = 'Go \u2192';
    go.addEventListener('mouseenter', () => go.style.background = C.brandHov);
    go.addEventListener('mouseleave', () => go.style.background = C.brand);
    go.addEventListener('mousedown', () => go.style.transform = 'scale(0.97)');
    go.addEventListener('mouseup', () => go.style.transform = 'scale(1)');
    go.addEventListener('click', (e) => { e.stopPropagation(); handleGo(); });
    row.appendChild(go);

    // Auto-focus input after a beat
    setTimeout(() => input.focus(), 60);
    return row;
  }

  // --- Generating row ---

  function buildGeneratingRow() {
    const row = el('div', {
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '2px 4px',
    });

    // Action label
    const label = el('span', {
      fontWeight: '600', fontSize: '12px', color: C.ink,
      flexShrink: '0', whiteSpace: 'nowrap',
    });
    label.textContent = actionLabel();
    row.appendChild(label);

    // Dots
    row.appendChild(buildDots(false));

    // Status
    const status = el('span', {
      fontSize: '11px', color: C.ash, whiteSpace: 'nowrap',
      marginLeft: 'auto',
    });
    status.textContent = arrivedVariants < expectedVariants
      ? 'Generating ' + (arrivedVariants + 1) + ' of ' + expectedVariants + '...'
      : 'Done';
    row.appendChild(status);

    return row;
  }

  // --- Cycling row ---

  function buildCyclingRow() {
    const row = el('div', {
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '1px 2px',
    });

    // Prev
    const prev = navBtn('\u2190');
    prev.addEventListener('click', (e) => { e.stopPropagation(); cycleVariant(-1); });
    if (visibleVariant <= 1) prev.style.opacity = '0.3';
    row.appendChild(prev);

    // Dots (clickable)
    row.appendChild(buildDots(true));

    // Counter
    const counter = el('span', {
      fontFamily: MONO, fontSize: '11px', fontWeight: '500',
      color: C.ash, minWidth: '24px', textAlign: 'center',
    });
    counter.textContent = visibleVariant + '/' + arrivedVariants;
    row.appendChild(counter);

    // Next
    const next = navBtn('\u2192');
    next.addEventListener('click', (e) => { e.stopPropagation(); cycleVariant(1); });
    if (visibleVariant >= arrivedVariants) next.style.opacity = '0.3';
    row.appendChild(next);

    // Spacer
    row.appendChild(el('div', { flex: '1' }));

    // Accept
    const accept = el('button', {
      padding: '4px 10px', borderRadius: '5px',
      border: 'none', background: C.ink, color: C.white,
      fontFamily: FONT, fontSize: '11px', fontWeight: '600',
      cursor: 'pointer', transition: 'background 0.12s ease',
      whiteSpace: 'nowrap',
    });
    accept.textContent = '\u2713 Accept';
    accept.addEventListener('mouseenter', () => accept.style.background = C.brand);
    accept.addEventListener('mouseleave', () => accept.style.background = C.ink);
    accept.addEventListener('click', (e) => { e.stopPropagation(); handleAccept(); });
    if (arrivedVariants === 0) { accept.style.opacity = '0.3'; accept.style.pointerEvents = 'none'; }
    row.appendChild(accept);

    // Discard
    const discard = el('button', {
      padding: '4px 6px', borderRadius: '5px',
      border: '1px solid ' + C.mist, background: 'transparent',
      fontFamily: FONT, fontSize: '11px', color: C.ash,
      cursor: 'pointer', transition: 'color 0.12s ease, border-color 0.12s ease',
    });
    discard.textContent = '\u2715';
    discard.title = 'Discard all variants';
    discard.addEventListener('mouseenter', () => { discard.style.color = C.ink; discard.style.borderColor = C.ink; });
    discard.addEventListener('mouseleave', () => { discard.style.color = C.ash; discard.style.borderColor = C.mist; });
    discard.addEventListener('click', (e) => { e.stopPropagation(); handleDiscard(); });
    row.appendChild(discard);

    return row;
  }

  // --- Shared UI builders ---

  function buildDots(clickable) {
    const container = el('div', {
      display: 'flex', alignItems: 'center', gap: '4px',
    });
    for (let i = 1; i <= expectedVariants; i++) {
      const arrived = i <= arrivedVariants;
      const active = i === visibleVariant;
      const dot = el('div', {
        width: '7px', height: '7px', borderRadius: '50%',
        background: active ? C.brand : (arrived ? C.ash : 'transparent'),
        border: '1.5px solid ' + (arrived ? C.brand : C.mist),
        transition: 'all 0.2s ' + EASE,
        cursor: (clickable && arrived) ? 'pointer' : 'default',
        transform: arrived ? 'scale(1)' : 'scale(0.6)',
        opacity: arrived ? '1' : '0.4',
      });
      if (clickable && arrived) {
        const idx = i;
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          visibleVariant = idx;
          showVariantInDOM(currentSessionId, idx);
          updateSelectedElement();
          updateBarContent('cycling');
        });
      }
      container.appendChild(dot);
    }
    return container;
  }

  function navBtn(text) {
    const b = el('button', {
      width: '26px', height: '26px', borderRadius: '5px',
      border: '1px solid ' + C.mist, background: 'transparent',
      color: C.ink, fontFamily: FONT, fontSize: '13px',
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'border-color 0.12s ease, background 0.12s ease',
      padding: '0', lineHeight: '1',
    });
    b.textContent = text;
    b.addEventListener('mouseenter', () => { b.style.borderColor = C.ink; });
    b.addEventListener('mouseleave', () => { b.style.borderColor = C.mist; });
    return b;
  }

  function actionLabel() {
    const a = ACTIONS.find(a => a.value === selectedAction);
    return a ? a.label : 'Freeform';
  }

  function el(tag, styles) {
    const e = document.createElement(tag);
    if (styles) Object.assign(e.style, styles);
    return e;
  }

  // ---------------------------------------------------------------------------
  // Action picker popover
  // ---------------------------------------------------------------------------

  function initActionPicker() {
    pickerEl = document.createElement('div');
    pickerEl.id = PREFIX + '-picker';
    Object.assign(pickerEl.style, {
      position: 'fixed', zIndex: Z.picker,
      display: 'none', opacity: '0',
      transform: 'scale(0.96) translateY(4px)',
      transformOrigin: 'bottom left',
      transition: 'opacity 0.18s ' + EASE + ', transform 0.2s ' + EASE,
      background: C.paperSolid,
      border: '1px solid ' + C.mist,
      borderRadius: '10px',
      boxShadow: '0 8px 30px oklch(0% 0 0 / 0.10), 0 2px 6px oklch(0% 0 0 / 0.06)',
      padding: '6px',
      fontFamily: FONT,
    });

    // Build the chip grid
    const grid = el('div', {
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3px',
    });

    ACTIONS.forEach(action => {
      const chip = el('button', {
        padding: '6px 8px', borderRadius: '6px',
        border: 'none',
        background: action.value === selectedAction ? C.brandSoft : 'transparent',
        color: action.value === selectedAction ? C.brand : C.ink,
        fontFamily: FONT, fontSize: '11px', fontWeight: '500',
        cursor: 'pointer',
        transition: 'background 0.1s ease, color 0.1s ease',
        textAlign: 'center', whiteSpace: 'nowrap',
      });
      chip.textContent = action.label;
      chip.dataset.action = action.value;
      chip.addEventListener('mouseenter', () => {
        if (action.value !== selectedAction) chip.style.background = C.brandSoft;
      });
      chip.addEventListener('mouseleave', () => {
        chip.style.background = action.value === selectedAction ? C.brandSoft : 'transparent';
      });
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedAction = action.value;
        hideActionPicker();
        updateBarContent('configure');
      });
      grid.appendChild(chip);
    });

    pickerEl.appendChild(grid);
    document.body.appendChild(pickerEl);
  }

  function toggleActionPicker() {
    if (pickerEl.style.display !== 'none') { hideActionPicker(); return; }
    // Rebuild chips to reflect current selection
    pickerEl.querySelectorAll('button').forEach(chip => {
      const isActive = chip.dataset.action === selectedAction;
      chip.style.background = isActive ? C.brandSoft : 'transparent';
      chip.style.color = isActive ? C.brand : C.ink;
    });
    // Position above the bar
    const barRect = barEl.getBoundingClientRect();
    const pickerH = 90; // approximate
    let top = barRect.top - pickerH - 6;
    if (top < 8) top = barRect.bottom + 6;
    Object.assign(pickerEl.style, {
      top: top + 'px', left: barRect.left + 'px',
      display: 'block',
    });
    requestAnimationFrame(() => {
      pickerEl.style.opacity = '1';
      pickerEl.style.transform = 'scale(1) translateY(0)';
    });
  }

  function hideActionPicker() {
    if (!pickerEl) return;
    pickerEl.style.opacity = '0';
    pickerEl.style.transform = 'scale(0.96) translateY(4px)';
    setTimeout(() => { if (pickerEl) pickerEl.style.display = 'none'; }, 180);
  }

  // ---------------------------------------------------------------------------
  // Variant cycling in DOM
  // ---------------------------------------------------------------------------

  function showVariantInDOM(sessionId, num) {
    const wrapper = document.querySelector('[data-impeccable-variants="' + sessionId + '"]');
    if (!wrapper) return;
    for (const child of wrapper.children) {
      const v = child.dataset ? child.dataset.impeccableVariant : null;
      if (!v) continue;
      child.style.display = (v === String(num)) ? '' : 'none';
    }
  }

  function cycleVariant(dir) {
    const next = visibleVariant + dir;
    if (next < 1 || next > arrivedVariants) return;
    visibleVariant = next;
    showVariantInDOM(currentSessionId, next);
    // Update selectedElement to the newly visible variant's content
    updateSelectedElement();
    updateBarContent('cycling');
  }

  function updateSelectedElement() {
    if (!currentSessionId) return;
    const wrapper = document.querySelector('[data-impeccable-variants="' + currentSessionId + '"]');
    if (!wrapper) return;
    const visEl = wrapper.querySelector('[data-impeccable-variant="' + visibleVariant + '"] > :first-child');
    if (visEl) selectedElement = visEl;
  }

  // ---------------------------------------------------------------------------
  // MutationObserver for progressive variant reveal
  // ---------------------------------------------------------------------------

  function startVariantObserver(sessionId) {
    let updating = false; // re-entrancy guard

    const obs = new MutationObserver((mutations) => {
      if (updating) return;

      // Only react to mutations that add nodes with data-impeccable-variant,
      // or mutations inside the variant wrapper. Ignore our own bar/UI changes.
      let dominated = false;
      for (const m of mutations) {
        if (m.target.closest?.('[data-impeccable-variants]')) { dominated = true; break; }
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && (n.dataset?.impeccableVariants || n.dataset?.impeccableVariant)) {
            dominated = true; break;
          }
        }
        if (dominated) break;
      }
      if (!dominated) return;

      const wrapper = document.querySelector('[data-impeccable-variants="' + sessionId + '"]');
      if (!wrapper) return;

      const variants = wrapper.querySelectorAll('[data-impeccable-variant]:not([data-impeccable-variant="original"])');
      const count = variants.length;

      // Nothing new
      if (count <= arrivedVariants) return;

      updating = true;
      arrivedVariants = count;
      if (visibleVariant === 0 && arrivedVariants > 0) {
        visibleVariant = 1;
        showVariantInDOM(sessionId, 1);
      }

      const expected = parseInt(wrapper.dataset.impeccableVariantCount || '0');
      if (expected > 0) expectedVariants = expected;

      if (arrivedVariants >= expectedVariants && expectedVariants > 0) {
        state = 'CYCLING';
        updateBarContent('cycling');
      } else if (state === 'GENERATING') {
        updateBarContent('generating');
      }
      updating = false;
    });

    obs.observe(document.body, { childList: true, subtree: true });
    return obs;
  }

  // ---------------------------------------------------------------------------
  // Bar scroll tracking
  // ---------------------------------------------------------------------------

  function startScrollTracking() {
    function tick() {
      if (state === 'CONFIGURING' || state === 'GENERATING' || state === 'CYCLING') {
        positionBar();
        showHighlight(selectedElement);
      }
      scrollRaf = requestAnimationFrame(tick);
    }
    scrollRaf = requestAnimationFrame(tick);
  }

  function stopScrollTracking() {
    if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = null; }
  }

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------

  function connectWS() {
    ws = new WebSocket('ws://localhost:' + PORT + '/ws');
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
    ws.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.type) {
        case 'auth_ok':
          hasProjectContext = !!msg.hasProjectContext;
          if (!hasProjectContext) showToast('No .impeccable.md found. Variants will be brand-agnostic.', 6000);
          console.log('[impeccable] Live mode connected.');
          // Only go to PICKING if we're not already in a resumed session
          if (state === 'IDLE') state = 'PICKING';
          break;
        case 'auth_fail':
          console.error('[impeccable] Auth failed:', msg.reason);
          break;
        case 'done':
          state = 'CYCLING';
          updateBarContent('cycling');
          break;
        case 'error':
          console.error('[impeccable] Error:', msg.message);
          showToast('Error: ' + msg.message, 5000);
          hideBar();
          state = 'PICKING';
          break;
      }
    };
    ws.onclose = () => { setTimeout(connectWS, 3000); };
    ws.onerror = () => {};
  }

  function sendWS(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  function handleMouseMove(e) {
    if (state !== 'PICKING') return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || !pickable(target) || target === hoveredElement) return;
    hoveredElement = target;
    showHighlight(target);
  }

  function handleClick(e) {
    // Close action picker on any outside click
    if (pickerEl?.style.display !== 'none' && !own(e.target)) {
      hideActionPicker();
    }
    if (state !== 'PICKING') return;
    if (own(e.target)) return;
    if (!hoveredElement || !pickable(hoveredElement)) return;
    e.preventDefault();
    e.stopPropagation();
    selectedElement = hoveredElement;
    state = 'CONFIGURING';
    showHighlight(selectedElement);
    showBar('configure');
    startScrollTracking();
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (pickerEl?.style.display !== 'none') { hideActionPicker(); return; }
      if (state === 'CONFIGURING') { hideBar(); stopScrollTracking(); state = 'PICKING'; return; }
      if (state === 'CYCLING') { handleDiscard(); return; }
      if (state === 'PICKING') { hideHighlight(); state = 'IDLE'; return; }
    }

    if (state === 'PICKING' && hoveredElement) {
      let next = null;
      if (e.key === 'ArrowDown' && !e.shiftKey) {
        next = hoveredElement.nextElementSibling;
        while (next && !pickable(next)) next = next.nextElementSibling;
      } else if (e.key === 'ArrowUp' && !e.shiftKey) {
        next = hoveredElement.previousElementSibling;
        while (next && !pickable(next)) next = next.previousElementSibling;
      } else if (e.key === 'ArrowUp' && e.shiftKey) {
        next = hoveredElement.parentElement;
        if (next && !pickable(next)) next = null;
      } else if (e.key === 'ArrowDown' && e.shiftKey) {
        next = hoveredElement.firstElementChild;
        while (next && !pickable(next)) next = next.nextElementSibling;
      } else if (e.key === 'Enter') {
        e.preventDefault();
        selectedElement = hoveredElement;
        state = 'CONFIGURING';
        showHighlight(selectedElement);
        showBar('configure');
        startScrollTracking();
        return;
      }
      if (next) {
        e.preventDefault();
        hoveredElement = next;
        showHighlight(next);
        next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      return;
    }

    if (state === 'CYCLING') {
      if (e.key === 'ArrowLeft') { e.preventDefault(); cycleVariant(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); cycleVariant(1); }
      if (e.key === 'Enter') { e.preventDefault(); handleAccept(); }
    }
  }

  function handleGo() {
    if (!selectedElement || state !== 'CONFIGURING') return;
    const input = document.getElementById(PREFIX + '-input');
    const prompt = input ? input.value.trim() : '';

    currentSessionId = id8();
    expectedVariants = selectedCount;
    arrivedVariants = 0;
    visibleVariant = 0;

    sendWS({
      type: 'generate', id: currentSessionId,
      action: selectedAction,
      freeformPrompt: prompt || undefined,
      count: selectedCount,
      element: extractContext(selectedElement),
    });

    state = 'GENERATING';
    showBar('generating');
    if (variantObserver) variantObserver.disconnect();
    variantObserver = startVariantObserver(currentSessionId);
  }

  function handleAccept() {
    if (!currentSessionId || arrivedVariants === 0) return;
    sendWS({ type: 'accept', id: currentSessionId, variantId: String(visibleVariant) });
    cleanup();
  }

  function handleDiscard() {
    if (!currentSessionId) return;
    sendWS({ type: 'discard', id: currentSessionId });
    cleanup();
  }

  function cleanup() {
    hideBar();
    hideHighlight();
    stopScrollTracking();
    if (variantObserver) { variantObserver.disconnect(); variantObserver = null; }
    selectedElement = null;
    currentSessionId = null;
    selectedAction = 'impeccable';
    state = 'PICKING';
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  function showToast(message, duration) {
    if (toastEl) toastEl.remove();
    toastEl = el('div', {
      position: 'fixed', bottom: '16px', left: '50%',
      transform: 'translateX(-50%) translateY(8px)',
      background: C.ink, color: C.white,
      fontFamily: FONT, fontSize: '12px',
      padding: '8px 16px', borderRadius: '8px',
      zIndex: Z.toast, opacity: '0',
      transition: 'opacity 0.25s ' + EASE + ', transform 0.25s ' + EASE,
      pointerEvents: 'none', maxWidth: '420px', textAlign: 'center',
    });
    toastEl.id = PREFIX + '-toast';
    toastEl.textContent = message;
    document.body.appendChild(toastEl);
    requestAnimationFrame(() => {
      toastEl.style.opacity = '1';
      toastEl.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
      if (toastEl) {
        toastEl.style.opacity = '0';
        toastEl.style.transform = 'translateX(-50%) translateY(8px)';
        setTimeout(() => { if (toastEl) { toastEl.remove(); toastEl = null; } }, 250);
      }
    }, duration);
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  // Resume an active variant session after HMR/page reload.
  // If a [data-impeccable-variants] wrapper exists in the DOM, the agent wrote
  // variants before HMR fired. Pick up where we left off.
  function resumeSession() {
    const wrapper = document.querySelector('[data-impeccable-variants]');
    if (!wrapper) return false;

    currentSessionId = wrapper.dataset.impeccableVariants;
    expectedVariants = parseInt(wrapper.dataset.impeccableVariantCount || '0');
    const variants = wrapper.querySelectorAll('[data-impeccable-variant]:not([data-impeccable-variant="original"])');
    arrivedVariants = variants.length;
    visibleVariant = arrivedVariants > 0 ? 1 : 0;

    // Find the visible variant's content element for highlight positioning.
    // The wrapper has display:contents (no box), so we target the actual
    // content element inside the currently visible variant.
    const visEl = wrapper.querySelector('[data-impeccable-variant]:not([style*="display: none"]):not([data-impeccable-variant="original"])');
    selectedElement = (visEl && visEl.firstElementChild) || visEl || wrapper.parentElement;

    // Set display state BEFORE starting observer (avoid triggering it)
    if (arrivedVariants > 0) showVariantInDOM(currentSessionId, 1);

    state = arrivedVariants >= expectedVariants ? 'CYCLING' : 'GENERATING';
    showBar(state === 'CYCLING' ? 'cycling' : 'generating');
    startScrollTracking();

    // Start observing for more variants AFTER initial setup
    if (variantObserver) variantObserver.disconnect();
    variantObserver = startVariantObserver(currentSessionId);
    return true;
  }

  function init() {
    initHighlight();
    initBar();
    initActionPicker();
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
    connectWS();

    // Check for an active session to resume (variant wrapper already in DOM after HMR)
    if (!resumeSession()) {
      console.log('[impeccable] Live variant mode ready. Hover over elements to pick one.');
    } else {
      console.log('[impeccable] Resumed active variant session ' + currentSessionId + ' (' + arrivedVariants + '/' + expectedVariants + ' variants).');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
