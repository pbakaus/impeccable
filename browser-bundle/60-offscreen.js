// --- browser-bundle/60-offscreen.js ---
// The extension's offscreen document: hosts the WASM core (its own CSP
// allows 'wasm-unsafe-eval'; a page's never has to) and runs the same scan
// the in-page bundle runs, over a page snapshot the content script captured
// (15-snapshot.js -> crates/core/src/browser/snapshot.rs). No rule logic
// here: marshalling, the session protocol, and the visual-contrast IO
// adapter whose every read is a question back to the content script.
//
// Protocol (content script <-> this document, chrome.runtime messages with
// `target: 'impeccable-offscreen'`; each request is answered exactly once):
//
//   { action: 'scan-start', session, snapshot, config }
//       -> { ask: { hitTests: [[x, y]] } }         answer: { hits: [...] }
//       -> { ask: { io: { kind: 'loadImage', src } } }
//                                                answer: { ref, w, h } | null
//       -> { ask: { io: { kind: 'readPixel', ref, plan, px, py } } }
//                                                answer: { data } | { error } | { noContext }
//       -> { stage: 'findings', groups, pageLevel, serialized }   answer: {}
//       -> { stage: 'visual', groups, serialized, lazy }           answer: {}
//       -> { done: true }
//       -> { error: message }
//       -> { superseded: true }   (a newer scan-start took the session over)
//   { action: 'scan-continue', session, answer }   (the answer to the last ask/stage)
//   { action: 'analyze-candidate', session, snapshot, candidate, groups }
//       -> asks as above, then { result, el, finding, serialized } (el 0 = no addition)
//   { action: 'antipatterns' }        -> the registry slice for the overlay labels
//   { action: 'ping' }                -> { ok: true, ready }
//
// `groups` are `[{ el, findings }]` with snapshot ids; the content script
// maps ids to Elements through the capture it made.

(function () {
  const TARGET = 'impeccable-offscreen';
  const sessions = new Map();

  let corePromise = null;
  function coreReady() {
    if (!corePromise) corePromise = __impeccableLoadCore();
    return corePromise;
  }

  // Coroutine over messages: `ask` answers the pending request with a
  // question and parks until the next 'scan-continue' brings the answer.
  function ask(session, payload) {
    return new Promise((resolve, reject) => {
      const respond = session.respond;
      session.respond = null;
      session.resume = { resolve, reject };
      if (!respond) {
        reject(new Error('session has no pending request'));
        return;
      }
      respond(payload);
    });
  }

  function finish(session, payload) {
    const respond = session.respond;
    session.respond = null;
    if (sessions.get(session.id) === session) sessions.delete(session.id);
    if (respond) respond(payload);
  }

  // The core holds one loaded snapshot at a time, so scans (which park at
  // asks) run one after another; a second tab's scan waits its turn.
  let chain = Promise.resolve();
  function serialized(fn) {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  }

  // The visual-contrast IO over the snapshot: the core over the loaded
  // snapshot (hit-test needs answered by the content script between calls),
  // node = snapshot id, images and pixels read by the content script.
  function createOffscreenVisualIO(wasm, session) {
    async function core(fn, ...args) {
      for (;;) {
        const out = wasm[fn](...args);
        if (!wasm.snapshot_has_needs()) return out;
        const needs = JSON.parse(wasm.snapshot_take_needs());
        const facts = await ask(session, { ask: { hitTests: needs.hitTests || [] } });
        wasm.snapshot_add_facts(JSON.stringify(facts || { hits: [] }));
      }
    }
    const media = (id) => JSON.parse(wasm.snapshot_media(id)) || {};
    return {
      core,
      coreSync() { throw new Error('the offscreen adapter is asynchronous'); },
      node: (handle) => handle,
      handle: (id) => id,
      parentOrBody: (id) => wasm.snapshot_parent_or_body(id),
      intrinsicImg(id) { const m = media(id); return [m.nw || m.vw || m.w || 0, m.nh || m.vh || m.h || 0]; },
      intrinsicRaster(id) { const m = media(id); return [m.w || m.vw || 0, m.h || m.vh || 0]; },
      imgSrc(id) { const m = media(id); return m.cur || m.src || ''; },
      loadImage: (src) => ask(session, { ask: { io: { kind: 'loadImage', src } } }),
      readPixel: (ref, plan, px, py) => ask(session, { ask: { io: { kind: 'readPixel', ref, plan, px, py } } }),
      // Scrolling the page from a snapshot is not meaningful; the extension
      // never sets scrollOffscreen, and the lazy pass re-captures instead.
      querySelector: () => null,
      scroll() { const v = JSON.parse(wasm.snapshot_viewport()) || {}; return { x: v.scrollX || 0, y: v.scrollY || 0 }; },
      scrollTo() {},
      scrollIntoView: () => false,
      waitForPaint: () => Promise.resolve(),
    };
  }

  function configJson(config) {
    config = config || {};
    return JSON.stringify({
      extensionMode: true,
      disabledRules: Array.isArray(config.disabledRules) ? config.disabledRules : [],
      disabledValues: Array.isArray(config.disabledValues) ? config.disabledValues : [],
      designSystem: config.designSystem == null ? null : config.designSystem,
      lineLengthMax: config.lineLengthMax == null ? null : config.lineLengthMax,
      skipScan: config.skipScan === true,
    });
  }

  function serialize(wasm, groups) {
    return JSON.parse(wasm.serialize_findings(JSON.stringify(groups)));
  }

  // addVisualContrastResult over id-keyed groups: the two decisions are the
  // core's; this only keeps the map.
  function addVisualContrastResult(wasm, groups, result) {
    const elId = wasm.visual_contrast_result_el(JSON.stringify(result));
    if (!elId) return 0;
    let group = groups.find(g => g.el === elId);
    const existing = group ? group.findings : [];
    const finding = JSON.parse(wasm.visual_contrast_result_finding(elId, JSON.stringify(existing), JSON.stringify(result)));
    if (!finding) return 0;
    if (group) group.findings.push(finding);
    else groups.push({ el: elId, findings: [finding] });
    return elId;
  }

  async function runScan(session, msg) {
    const wasm = await coreReady();
    const n = wasm.snapshot_load(msg.snapshot);
    if (n === 0xFFFFFFFF) throw new Error('snapshot did not parse');
    const config = msg.config || {};
    const IO = createOffscreenVisualIO(wasm, session);
    const vc = createVisualContrast(IO);
    const t0 = performance.now();
    const collected = JSON.parse(await IO.core('collect_browser_findings', configJson(config)));
    const groups = collected.groups;
    const stats = { elements: n, coreMs: performance.now() - t0, unknownStyleProps: JSON.parse(wasm.snapshot_unknown_style_props()) };
    await ask(session, {
      stage: 'findings',
      groups,
      pageLevel: collected.pageLevel,
      serialized: serialize(wasm, groups),
      stats,
    });
    const options = config;
    // An ignoreFiles-waived page (config.skipScan) answers every stage empty:
    // the core already emptied the collect pass, and the visual pass would
    // repopulate it, so it is skipped with everything else (mirrors
    // skipScanActive() in 50-scan.js; offscreen is always extension mode).
    if (config.skipScan !== true && __visualContrastMode(options, config) !== false) {
      const resolved = __visualContrastOptions(options, config);
      if (__visualContrastMode(options, config) === 'image-only') resolved.imageOnly = true;
      const analyses = await vc.analyzeVisualContrast(resolved);
      const added = [];
      for (const result of analyses) {
        const el = addVisualContrastResult(wasm, groups, result);
        if (el) added.push(el);
      }
      const lazy = (resolved.visualContrastLazy === false || resolved.scrollOffscreen !== false)
        ? []
        : __lazyVisualContrastCandidates(analyses);
      await ask(session, {
        stage: 'visual',
        groups,
        added,
        analyses,
        serialized: serialize(wasm, groups),
        lazy,
        stats: { visualMs: performance.now() - t0 - stats.coreMs },
      });
    }
    wasm.snapshot_clear();
    finish(session, { done: true });
  }

  async function runCandidate(session, msg) {
    const wasm = await coreReady();
    const n = wasm.snapshot_load(msg.snapshot);
    if (n === 0xFFFFFFFF) throw new Error('snapshot did not parse');
    const IO = createOffscreenVisualIO(wasm, session);
    const vc = createVisualContrast(IO);
    const groups = Array.isArray(msg.groups) ? msg.groups : [];
    const result = await vc.analyzeVisualContrastCandidate(msg.candidate);
    const el = addVisualContrastResult(wasm, groups, result);
    const out = { result, el, groups, serialized: el ? serialize(wasm, groups) : null };
    wasm.snapshot_clear();
    finish(session, out);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.target !== TARGET) return false;
    if (msg.action === 'ping') {
      coreReady().then(() => sendResponse({ ok: true, ready: true }), (err) => sendResponse({ ok: false, error: err?.message || String(err) }));
      return true;
    }
    if (msg.action === 'antipatterns') {
      coreReady().then((wasm) => sendResponse({ antipatterns: JSON.parse(wasm.antipatterns_json()) }), (err) => sendResponse({ error: err?.message || String(err) }));
      return true;
    }
    if (msg.action === 'scan-start' || msg.action === 'analyze-candidate') {
      const prior = sessions.get(msg.session);
      if (prior) {
        // A restarted session (the content script re-scanned): drop the old
        // coroutine so it never answers a stale request.
        prior.superseded = true;
        if (prior.resume) prior.resume.reject(new Error('superseded'));
        if (prior.respond) { try { prior.respond({ superseded: true }); } catch { /* channel gone */ } }
        prior.respond = null;
        sessions.delete(msg.session);
      }
      const session = { id: msg.session, respond: sendResponse, resume: null, superseded: false };
      sessions.set(msg.session, session);
      const run = msg.action === 'scan-start' ? runScan : runCandidate;
      serialized(() => {
        if (session.superseded) return;
        return run(session, msg);
      }).catch((err) => {
        if (err && err.message === 'superseded') return;
        finish(session, { error: err?.message || String(err) });
      });
      return true;
    }
    if (msg.action === 'scan-continue') {
      const session = sessions.get(msg.session);
      if (!session || !session.resume) {
        sendResponse({ error: 'no such session' });
        return false;
      }
      session.respond = sendResponse;
      const resume = session.resume;
      session.resume = null;
      resume.resolve(msg.answer);
      return true;
    }
    return false;
  });
})();
