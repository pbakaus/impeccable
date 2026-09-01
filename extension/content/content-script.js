/**
 * Impeccable DevTools Extension - Content Script
 *
 * Runs in the tab's isolated world with two generated companions injected
 * before it (detector/snapshot.js, detector/overlay.js). A scan is:
 *
 *   1. capture a snapshot of the page (measurement only, snapshot.js);
 *   2. hand it to the offscreen document, where the WebAssembly rule core
 *      runs the same rules the in-page bundle runs (detector/core.js); the
 *      core asks back for what a snapshot cannot hold — hit tests, image
 *      pixels — and this script answers from the live page;
 *   3. draw the findings it returns (overlay.js) and report them to the
 *      service worker exactly as before (`findings`, `overlays-toggled`).
 *
 * No rule logic lives in this world, so the page's Content-Security-Policy
 * (which gates WebAssembly in every world an extension can reach) does not
 * matter: github.com scans like any other page.
 *
 * Wrapped in an IIFE with an idempotency flag so re-injection (via
 * chrome.scripting.executeScript) is a no-op and doesn't cause:
 *   - SyntaxError: Identifier 'foo' has already been declared
 *   - Duplicate event listeners accumulating over time
 */
(function () {
  if (window.__IMPECCABLE_CS_LOADED__) return;
  window.__IMPECCABLE_CS_LOADED__ = true;

  const OFFSCREEN = 'impeccable-offscreen';
  const snapshot = window.__impeccableSnapshot;
  const createOverlay = window.__impeccableCreateOverlay;
  // One session id per content-script instance: a re-scan supersedes the
  // previous run of the same tab in the offscreen document.
  const sessionId = `tab-${Math.random().toString(36).slice(2)}`;
  const candidateSessionId = `${sessionId}-lazy`;

  let injected = false;      // a scan has produced findings on this page
  let scanConfig = null;
  let ui = null;
  let uiPromise = null;
  let scanGeneration = 0;
  let capture = null;        // the last capture (elements by snapshot id)
  let visualIO = null;
  const groupMap = new Map(); // Element -> findings[]
  let lazyObserver = null;
  const lazyPending = new WeakMap();
  const lazyResolving = new WeakSet();
  // Measurements of the last scan (snapshot size, core time, ask rounds),
  // reported alongside the findings for diagnostics.
  let lastStats = null;

  const send = (msg) => chrome.runtime.sendMessage({ target: OFFSCREEN, ...msg });

  function reportError(err) {
    chrome.runtime.sendMessage({
      action: 'detector-error',
      message: err?.message || String(err),
    }).catch(() => {});
  }

  async function ensureUI() {
    if (ui) return ui;
    if (!uiPromise) {
      uiPromise = send({ action: 'antipatterns' }).then((r) => {
        if (!r || r.error) throw new Error(r?.error || 'rule registry unavailable');
        ui = createOverlay({ extensionMode: true, antipatterns: r.antipatterns });
        return ui;
      });
      uiPromise.catch(() => { uiPromise = null; });
    }
    return uiPromise;
  }

  // Answer one of the core's questions from the live page.
  async function answer(askMsg) {
    if (askMsg.hitTests) return snapshot.answer(askMsg, capture);
    const io = askMsg.io;
    if (io && io.kind === 'loadImage') return visualIO.loadImage(io.src);
    if (io && io.kind === 'readPixel') return visualIO.readPixel(io.ref, io.plan, io.px, io.py);
    return null;
  }

  function elementOf(id) {
    return capture ? capture.elements[id] || null : null;
  }

  function setGroups(groups) {
    groupMap.clear();
    for (const g of groups) {
      const el = elementOf(g.el);
      if (el) groupMap.set(el, g.findings);
    }
  }

  function groupsForCapture(cap) {
    const out = [];
    for (const [el, findings] of groupMap) {
      const id = snapshot.idOf(el, cap);
      if (id) out.push({ el: id, findings });
    }
    return out;
  }

  function postFindings(serialized) {
    chrome.runtime.sendMessage({
      action: 'findings',
      findings: serialized,
      count: serialized.length,
      stats: lastStats,
    }).catch(() => {});
  }

  function drawGroups(groups, onlyIds) {
    for (const g of groups) {
      if (onlyIds && !onlyIds.includes(g.el)) continue;
      const el = elementOf(g.el);
      if (!el || el === document.body || el === document.documentElement) continue;
      ui.highlight(el, g.findings);
    }
  }

  function disconnectLazy() {
    if (lazyObserver) {
      lazyObserver.disconnect();
      lazyObserver = null;
    }
  }

  // Elements whose visual contrast stayed unresolved only because they were
  // outside the viewport: re-analyze each when it scrolls into view.
  function scheduleLazy(candidates, generation) {
    disconnectLazy();
    if (!candidates.length || typeof IntersectionObserver === 'undefined') return;
    lazyObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        const candidate = lazyPending.get(el);
        if (!candidate || lazyResolving.has(el)) continue;
        lazyObserver?.unobserve(el);
        lazyPending.delete(el);
        lazyResolving.add(el);
        waitForPaint()
          .then(() => analyzeCandidate(candidate, generation))
          .catch(reportError)
          .finally(() => lazyResolving.delete(el));
      }
    }, { threshold: 0.5 });
    for (const candidate of candidates) {
      let el = null;
      try { el = document.querySelector(candidate.selector); } catch { el = null; }
      if (!el) continue;
      lazyPending.set(el, candidate);
      lazyObserver.observe(el);
    }
  }

  function waitForPaint() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  // Drive one offscreen session to completion, answering its asks.
  async function drive(startMsg, sid, onStage) {
    let r = await send({ ...startMsg, session: sid });
    for (;;) {
      if (!r) throw new Error('the rule core did not answer');
      if (r.error) throw new Error(r.error);
      if (r.superseded) return null;
      if (r.ask) {
        if (lastStats) {
          if (r.ask.hitTests) { lastStats.rounds += 1; lastStats.hitTests += r.ask.hitTests.length; }
          else if (r.ask.io) lastStats.ioAsks += 1;
        }
        const a = await answer(r.ask);
        r = await send({ action: 'scan-continue', session: sid, answer: a });
        continue;
      }
      if (r.stage) {
        await onStage(r);
        r = await send({ action: 'scan-continue', session: sid, answer: {} });
        continue;
      }
      return r;
    }
  }

  async function runScan(config) {
    const generation = ++scanGeneration;
    scanConfig = config || null;
    window.__IMPECCABLE_CONFIG__ = config || {};
    await ensureUI();
    if (generation !== scanGeneration) return;
    disconnectLazy();
    ui.clearOverlays();
    const cap = snapshot.capture();
    if (cap.error) throw new Error(cap.error);
    capture = cap;
    visualIO = snapshot.visualIO(cap);
    lastStats = { elements: cap.stats.elements, bytes: cap.stats.bytes, captureMs: cap.stats.ms, coreMs: null, visualMs: null, rounds: 1, hitTests: 0, ioAsks: 0, unknownStyleProps: [], startedAt: performance.now(), findingsAtMs: null, visualAtMs: null };
    await drive({ action: 'scan-start', snapshot: cap.json, config: config || {} }, sessionId, async (r) => {
      if (generation !== scanGeneration) return;
      if (r.stats) {
        if (r.stats.coreMs !== undefined) lastStats.coreMs = r.stats.coreMs;
        if (r.stats.visualMs !== undefined) lastStats.visualMs = r.stats.visualMs;
        if (r.stats.unknownStyleProps) lastStats.unknownStyleProps = r.stats.unknownStyleProps;
      }
      if (r.stage === 'findings') {
        lastStats.findingsAtMs = performance.now() - lastStats.startedAt;
        setGroups(r.groups);
        drawGroups(r.groups);
        if (r.pageLevel && r.pageLevel.length) ui.showPageBanner(r.pageLevel);
        injected = true;
        postFindings(r.serialized);
        setTimeout(() => ui.setFirstScanDone(), 1000);
      } else if (r.stage === 'visual') {
        lastStats.visualAtMs = performance.now() - lastStats.startedAt;
        setGroups(r.groups);
        drawGroups(r.groups, r.added);
        postFindings(r.serialized);
        scheduleLazy(r.lazy || [], generation);
      }
    });
  }

  async function analyzeCandidate(candidate, generation) {
    if (generation !== scanGeneration) return;
    const cap = snapshot.capture();
    if (cap.error) throw new Error(cap.error);
    const priorCapture = capture;
    const priorIO = visualIO;
    capture = cap;
    visualIO = snapshot.visualIO(cap);
    try {
      const out = await drive({
        action: 'analyze-candidate',
        snapshot: cap.json,
        candidate,
        groups: groupsForCapture(cap),
      }, candidateSessionId, async () => {});
      if (!out || generation !== scanGeneration) return;
      if (out.el) {
        const el = elementOf(out.el);
        const group = out.groups.find(g => g.el === out.el);
        if (el && group) {
          groupMap.set(el, group.findings);
          if (el !== document.body && el !== document.documentElement) ui.highlight(el, group.findings);
          if (out.serialized) postFindings(out.serialized);
        }
      }
    } finally {
      // Later hit-test/pixel asks for the main session (none pending by now)
      // would need the main capture; restore it.
      capture = priorCapture || capture;
      visualIO = priorIO || visualIO;
    }
  }

  // Listen for commands from the service worker
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'scan') {
      runScan(msg.config || null).catch((err) => {
        if (err && err.message === 'superseded') return;
        reportError(err);
      });
      sendResponse({ ok: true });
    } else if (msg.action === 'toggle-overlays') {
      if (ui) {
        const visible = ui.toggleOverlays();
        chrome.runtime.sendMessage({ action: 'overlays-toggled', visible }).catch(() => {});
      }
      sendResponse({ ok: true });
    } else if (msg.action === 'remove') {
      scanGeneration += 1;
      disconnectLazy();
      if (ui) ui.remove();
      groupMap.clear();
      injected = false;
      sendResponse({ ok: true });
    } else if (msg.action === 'highlight') {
      if (ui) ui.highlightSelector(msg.selector);
      sendResponse({ ok: true });
    } else if (msg.action === 'unhighlight') {
      if (ui) ui.unspotlight();
      sendResponse({ ok: true });
    }
    return true;
  });

  // Forward "page is active" signal to the extension when the cursor moves over the page.
  // This is the reliable way to know the user has left the DevTools panel — the panel's
  // own pointerleave/mouseleave events are unreliable on fast cursor movement.
  let lastPageActive = 0;
  document.addEventListener('pointermove', () => {
    const now = Date.now();
    if (now - lastPageActive < 150) return; // throttle
    lastPageActive = now;
    chrome.runtime.sendMessage({ action: 'page-pointer-active' }).catch(() => {});
  }, { passive: true, capture: true });

  // SPA navigation detection (pushState/replaceState don't fire events, but
  // popstate and hashchange cover back/forward and hash navigation)
  let lastUrl = location.href;
  function onPossibleNavigation() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    if (injected) {
      // Re-scan after the DOM settles
      setTimeout(() => runScan(scanConfig).catch(reportError), 500);
    }
  }
  window.addEventListener('popstate', onPossibleNavigation);
  window.addEventListener('hashchange', onPossibleNavigation);
})();
