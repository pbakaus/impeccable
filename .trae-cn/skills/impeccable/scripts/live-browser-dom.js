/**
 * Browser-side DOM helpers for Impeccable live mode.
 *
 * Kept separate from live-browser.js so future browser script parts can share
 * chrome mounting, lookup, focus, and picker helpers without depending on the
 * full overlay UI bundle.
 */
(function (root) {
  'use strict';
  if (!root) return;

  function createLiveBrowserDomHelpers({
    prefix,
    skipTags,
    document: doc = root.document,
    css = root.CSS,
    crypto = root.crypto,
  } = {}) {
    if (!prefix) throw new Error('prefix required');
    if (!doc) throw new Error('document required');
    const tagsToSkip = skipTags || new Set();

    function own(el) {
      return el && (el.id?.startsWith(prefix) || el.closest?.('[id^="' + prefix + '"]'));
    }

    function pickable(el) {
      if (!el || el.nodeType !== 1) return false;
      if (tagsToSkip.has(String(el.tagName || '').toLowerCase())) return false;
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

    function rectIsUsableAnchor(rect) {
      return !!rect && rect.width > 0.5 && rect.height > 0.5;
    }

    function makeFrozenAnchor(el) {
      if (!el || !el.getBoundingClientRect) return null;
      const r = el.getBoundingClientRect();
      if (!rectIsUsableAnchor(r)) return null;
      const rect = {
        x: r.x, y: r.y,
        top: r.top, left: r.left,
        right: r.right, bottom: r.bottom,
        width: r.width, height: r.height,
      };
      return {
        __impeccableFrozenAnchor: true,
        tagName: el.tagName || 'DIV',
        id: el.id || '',
        classList: el.classList ? [...el.classList] : [],
        hasAttribute: () => false,
        getBoundingClientRect: () => rect,
      };
    }

    function id8() {
      if (crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
      return (Math.random().toString(16).slice(2) + Date.now().toString(16)).slice(0, 8);
    }

    function cssId(id) {
      if (css?.escape) return css.escape(id);
      return String(id).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
    }

    function liveUiRoot() {
      const uiRoot = root.__IMPECCABLE_LIVE_UI_ROOT__;
      if (uiRoot && typeof uiRoot.appendChild === 'function') return uiRoot;
      return doc.body;
    }

    function uiAppend(el) {
      liveUiRoot().appendChild(el);
      return el;
    }

    function uiAppendStyle(styleEl) {
      const uiRoot = liveUiRoot();
      if (uiRoot && uiRoot !== doc.body) uiRoot.appendChild(styleEl);
      else doc.head.appendChild(styleEl);
      return styleEl;
    }

    function uiGetById(id) {
      const uiRoot = liveUiRoot();
      if (uiRoot?.getElementById) {
        const found = uiRoot.getElementById(id);
        if (found) return found;
      }
      if (uiRoot?.querySelector) {
        const found = uiRoot.querySelector('#' + cssId(id));
        if (found) return found;
      }
      return doc.getElementById(id);
    }

    function activeElementDeep() {
      let active = doc.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      return active;
    }

    function defangOutsideHandlers(rootEl, { setPointerEvents = true } = {}) {
      if (!rootEl) return;
      if (setPointerEvents) {
        rootEl.style.setProperty('pointer-events', 'auto', 'important');
      }
      const stop = (e) => e.stopPropagation();
      rootEl.addEventListener('pointerdown', stop);
      rootEl.addEventListener('mousedown', stop);
      rootEl.addEventListener('focusin', stop);
    }

    return {
      own,
      pickable,
      desc,
      rectIsUsableAnchor,
      makeFrozenAnchor,
      id8,
      cssId,
      liveUiRoot,
      uiAppend,
      uiAppendStyle,
      uiGetById,
      activeElementDeep,
      defangOutsideHandlers,
    };
  }

  root.__IMPECCABLE_LIVE_DOM__ = {
    version: 1,
    createLiveBrowserDomHelpers,
  };
})(typeof window !== 'undefined' ? window : globalThis);
