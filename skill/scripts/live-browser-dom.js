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

    function hasFrameworkHmrOwnership(el) {
      for (let node = el; node; node = node.parentElement) {
        let keys = [];
        try { keys = Object.getOwnPropertyNames(node); } catch {}
        if (keys.some((key) => (
          key.startsWith('__reactFiber$')
          || key.startsWith('__reactProps$')
          || key.startsWith('__reactContainer$')
          || key === '_reactRootContainer'
          || key === '__vueParentComponent'
          || key === '__vue_app__'
          || key === '__vnode'
          || key === '__svelte_meta'
        ))) {
          return true;
        }
      }
      return false;
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

    // A modal <dialog> (showModal) paints in the top layer and makes every
    // node outside its subtree inert, so chrome on <body> can be neither seen
    // nor clicked while one is open, and no z-index reaches it (issue #879).
    // While a modal is open the chrome parks inside the topmost one, in one
    // popover: inside the dialog it is not inert, and a popover shown after
    // the dialog paints above it. One popover for all of it, because
    // top-layer entries stack by show order, which would drop the z-index
    // order between the roots. The detect overlay (browser-bundle/
    // 40-overlay.js) mounts its outlines here too: it finds the host by this
    // id and places its outlines again on the event of the same name, fired
    // on every move.
    const topLayerHost = doc.createElement('div');
    topLayerHost.id = prefix + '-top-layer';
    // Same box as the SvelteKit shadow host: 0x0, fixed, chrome overflows it.
    // `all: initial` also clears the popover UA box.
    for (const [name, value] of Object.entries({
      all: 'initial', position: 'fixed', top: '0', left: '0', width: '0', height: '0', overflow: 'visible',
    })) topLayerHost.style.setProperty(name, value, 'important');
    const pageRoots = new WeakSet(); // chrome nodes mounted on the page itself
    const openModals = [];           // in the order they opened; last is topmost

    // Modals that were open before watching began have no readable top-layer
    // order, but the topmost one's backdrop covers the viewport, so a hit
    // test lands in it. Raise that one to the top of the stack.
    function raiseHitModal() {
      const i = openModals.indexOf(doc.elementFromPoint(0, 0)?.closest('dialog:modal'));
      if (i !== -1) openModals.push(...openModals.splice(i, 1));
    }

    function syncTopLayerHost(records = []) {
      for (const { type, target, oldValue } of records) {
        if (type !== 'attributes' || oldValue !== null || !target.matches('dialog:modal')) continue;
        // Opened, or closed and reopened in one task (the observer sees only
        // the end state): either way it is back on top of the top layer, so
        // a host shown inside it earlier has to be shown again. A write to an
        // `open` that was already set (oldValue not null) moved nothing.
        const i = openModals.indexOf(target);
        if (i !== -1) openModals.splice(i, 1);
        openModals.push(target);
        if (topLayerHost.parentNode === target) topLayerHost.remove();
      }
      // A closed dialog, or one removed from the document while open, stops
      // matching :modal. Whichever is now on top may predate the watch.
      const before = openModals.length;
      for (let i = openModals.length - 1; i >= 0; i--) {
        if (!openModals[i].matches('dialog:modal')) openModals.splice(i, 1);
      }
      if (openModals.length < before && openModals.length > 1) raiseHitModal();
      const modal = openModals[openModals.length - 1] || null;
      if (topLayerHost.parentNode === modal) return;
      if (modal) {
        modal.appendChild(topLayerHost);
        for (const el of [...doc.body.children]) if (pageRoots.has(el)) topLayerHost.appendChild(el);
        topLayerHost.showPopover();
      } else {
        doc.body.append(...topLayerHost.childNodes);
        topLayerHost.remove();
      }
      doc.dispatchEvent(new Event(topLayerHost.id));
    }

    // Returns the function that stops watching and puts the chrome back.
    function watchModalDialogs() {
      if (typeof topLayerHost.showPopover !== 'function') return () => {};
      topLayerHost.popover = 'manual';
      // Parked in the page's dialog, chrome clicks would bubble into its own
      // handlers, such as a click-outside-the-box close. Live listens in capture.
      topLayerHost.addEventListener('click', (e) => e.stopPropagation());
      openModals.push(...doc.querySelectorAll('dialog:modal'));
      raiseHitModal();
      const observer = new MutationObserver(syncTopLayerHost);
      observer.observe(doc, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['open'] });
      syncTopLayerHost();
      return () => {
        observer.disconnect();
        openModals.length = 0;
        syncTopLayerHost();
      };
    }

    // A copy of a page element without the chrome parked inside it, which a
    // picked modal dialog contains.
    function cloneWithoutChrome(el) {
      const clone = el.cloneNode(true);
      if (el.contains(topLayerHost)) clone.querySelector('#' + cssId(topLayerHost.id)).remove();
      return clone;
    }

    // Mount a chrome node on the page itself: <body>, or the top-layer host
    // while the chrome is parked in a modal.
    function uiAppendToPage(el) {
      pageRoots.add(el);
      (topLayerHost.parentNode ? topLayerHost : doc.body).appendChild(el);
      return el;
    }

    function uiAppend(el) {
      const uiRoot = liveUiRoot();
      if (uiRoot === doc.body) return uiAppendToPage(el);
      // An adapter shadow root: its host is the node that sits on the page.
      if (uiRoot.host) pageRoots.add(uiRoot.host);
      uiRoot.appendChild(el);
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
      hasFrameworkHmrOwnership,
      id8,
      cssId,
      liveUiRoot,
      uiAppend,
      uiAppendToPage,
      topLayerHost,
      watchModalDialogs,
      cloneWithoutChrome,
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
