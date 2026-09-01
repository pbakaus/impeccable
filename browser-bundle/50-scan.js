// --- browser-bundle/50-scan.js ---
// The in-page scan/detect API, the WASM core bridge (group-map
// marshalling), and the extension-mode message loop of the standalone
// bundle. Ported from cli/engine/browser/injected/index.mjs Section 7; every
// rule decision is a call into the WASM core (`__impeccable.*`), the DOM
// reads it needs go through the probe, the overlay UI is 40-overlay.js and
// the visual-contrast sampling 35-visual.js.

const IS_BROWSER = typeof window !== 'undefined';

// ─── Section 7: Browser UI (IS_BROWSER only) ────────────────────────────────

if (IS_BROWSER && !__impeccable) {
  // The core could not start (in practice: a Content-Security-Policy whose
  // script-src lacks 'wasm-unsafe-eval'). Keep the API surface so callers get
  // one clear error instead of "impeccableDetect is not a function".
  const reason = __impeccableInitError && __impeccableInitError.message
    ? __impeccableInitError.message
    : String(__impeccableInitError);
  const message = `[impeccable] detector core unavailable: ${reason} (a Content-Security-Policy without 'wasm-unsafe-eval' blocks WebAssembly)`;
  const fail = () => { throw new Error(message); };
  const _myScript = document.currentScript;
  const EXTENSION_MODE = (_myScript && _myScript.dataset.impeccableExtension === 'true')
    || document.documentElement.dataset.impeccableExtension === 'true';
  console.warn(message);
  window.impeccableDetect = fail;
  window.impeccableDetectAsync = async () => fail();
  window.impeccableScan = fail;
  window.impeccableScanAsync = async () => fail();
  window.impeccableMeasureHiddenText = fail;
  window.impeccableCollectVisualContrastCandidates = fail;
  window.impeccableAnalyzeVisualContrast = async () => fail();
  window.impeccableGetLastVisualContrastAnalyses = () => [];
  window.__impeccableCoreError = message;
  if (EXTENSION_MODE) {
    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data || e.data.source !== 'impeccable-command') return;
      if (e.data.action === 'scan') window.postMessage({ source: 'impeccable-error', message }, '*');
    });
    window.postMessage({ source: 'impeccable-ready' }, '*');
  }
} else if (IS_BROWSER) {
  // Detect extension mode via the script tag's data attribute or the document element fallback.
  // currentScript is reliable for synchronously-executing scripts (which our IIFE is).
  const _myScript = document.currentScript;
  const EXTENSION_MODE = (_myScript && _myScript.dataset.impeccableExtension === 'true')
    || document.documentElement.dataset.impeccableExtension === 'true';

  const ui = createImpeccableOverlay({
    extensionMode: EXTENSION_MODE,
    antipatterns: JSON.parse(__impeccable.antipatterns_json()),
  });
  const {
    collectVisualContrastCandidates,
    analyzeVisualContrastCandidate,
    analyzeVisualContrast,
    waitForVisualPaint,
  } = createVisualContrast(createInPageVisualIO(__impeccable));

  // ── WASM core bridge ──────────────────────────────────────────────────────
  // The rule core runs collectBrowserFindings in WASM and hands back element
  // handles; this side keeps a Map<Element, findings[]> so later additions
  // (visual contrast) can join the same groups, and serializes through the
  // core so selectors/labels/severities come from one place.

  function collectConfigJson() {
    const config = window.__IMPECCABLE_CONFIG__ || {};
    return JSON.stringify({
      extensionMode: EXTENSION_MODE,
      disabledRules: Array.isArray(config.disabledRules) ? config.disabledRules : [],
      designSystem: config.designSystem == null ? null : config.designSystem,
      lineLengthMax: config.lineLengthMax == null ? null : config.lineLengthMax,
      skipScan: config.skipScan === true,
    });
  }

  // A page matched by detector.ignoreFiles is waived wholesale: every scan
  // stage answers empty so the badge and toast read zero. Mirrors
  // shouldIgnoreDetectionFile in cli/lib/impeccable-config.mjs; the live
  // overlay resolves the globs per page (live-browser-ignores.js) and
  // forwards the verdict as config.skipScan. The core repeats this guard on
  // the parsed config so the snapshot route answers empty too.
  function skipScanActive() {
    return EXTENSION_MODE && window.__IMPECCABLE_CONFIG__?.skipScan === true;
  }

  function serializeFindings(allFindings) {
    const groups = allFindings.map(({ el, findings }) => ({ el: __intern(el), findings }));
    return JSON.parse(__impeccable.serialize_findings(JSON.stringify(groups)));
  }

  const printSummary = function(allFindings) {
    if (allFindings.length === 0) {
      console.log('%c[impeccable] No anti-patterns found.', 'color: #22c55e; font-weight: bold');
      return;
    }
    console.group(
      `%c[impeccable] ${allFindings.length} anti-pattern${allFindings.length === 1 ? '' : 's'} found`,
      'color: oklch(84% 0.19 80.46); font-weight: bold'
    );
    for (const { el, findings } of allFindings) {
      for (const f of findings) {
        console.log(`%c${f.type || f.id}%c ${f.detail || f.snippet}`,
          'color: oklch(84% 0.19 80.46); font-weight: bold', 'color: inherit', el);
      }
    }
    console.groupEnd();
  };

  function browserFindingsFromMap(groupMap) {
    return [...groupMap.entries()].map(([el, findings]) => ({ el, findings }));
  }

  function collectBrowserFindings() {
    if (skipScanActive()) {
      return { groupMap: new Map(), allFindings: [], pageLevelFindings: [] };
    }
    __resetRegistry();
    const collected = JSON.parse(__impeccable.collect_browser_findings(collectConfigJson()));
    const groupMap = new Map();
    for (const g of collected.groups) {
      // Handle 0 is the JS `document.body` null key (a bare document).
      groupMap.set(__el(g.el), g.findings);
    }
    return {
      groupMap,
      allFindings: browserFindingsFromMap(groupMap),
      pageLevelFindings: collected.pageLevel,
    };
  }

  // Config plumbing shared with the extension's offscreen document lives in
  // 30-scan-common.js; here the config is the page's __IMPECCABLE_CONFIG__.
  const pageConfig = () => window.__IMPECCABLE_CONFIG__ || {};
  const visualContrastMode = (options = {}) => __visualContrastMode(options, pageConfig());
  const shouldRunVisualContrast = (options = {}) => visualContrastMode(options) !== false;
  const visualContrastOptions = (options = {}) => __visualContrastOptions(options, pageConfig());
  const scanResultMeta = __scanResultMeta;

  let lastVisualContrastAnalyses = [];
  let lazyVisualContrastObserver = null;
  let lazyVisualContrastPending = new WeakMap();
  const lazyVisualContrastResolving = new WeakSet();
  let scanGeneration = 0;

  function rememberVisualContrastAnalysis(result) {
    if (!result?.selector) {
      lastVisualContrastAnalyses.push(result);
      return;
    }
    const idx = lastVisualContrastAnalyses.findIndex(item => item.selector === result.selector);
    if (idx >= 0) lastVisualContrastAnalyses[idx] = result;
    else lastVisualContrastAnalyses.push(result);
  }

  function disconnectLazyVisualContrastObserver() {
    if (lazyVisualContrastObserver) {
      lazyVisualContrastObserver.disconnect();
      lazyVisualContrastObserver = null;
    }
    lazyVisualContrastPending = new WeakMap();
  }

  function addVisualContrastResult(groupMap, result, options = {}) {
    const elId = __impeccable.visual_contrast_result_el(JSON.stringify(result));
    const el = __el(elId);
    if (!el) return false;
    const existing = groupMap.get(el) || [];
    const finding = JSON.parse(__impeccable.visual_contrast_result_finding(elId, JSON.stringify(existing), JSON.stringify(result)));
    if (!finding) return false;
    if (groupMap.has(el)) groupMap.get(el).push(finding);
    else groupMap.set(el, [finding]);
    if (options.decorate && el !== document.body && el !== document.documentElement) {
      ui.highlight(el, groupMap.get(el) || []);
    }
    return true;
  }


  function postSerializedFindings(groupMap, options = {}) {
    if (!EXTENSION_MODE) return;
    const allFindings = browserFindingsFromMap(groupMap);
    window.postMessage({
      source: 'impeccable-results',
      findings: serializeFindings(allFindings),
      count: allFindings.length,
      ...scanResultMeta(options),
    }, '*');
  }

  function postExtensionError(err) {
    if (!EXTENSION_MODE) return;
    window.postMessage({
      source: 'impeccable-error',
      message: err?.message || String(err),
    }, '*');
  }

  function reportVisualContrastError(err, detail = {}) {
    window.dispatchEvent(new CustomEvent('impeccable-visual-contrast-error', {
      detail: {
        ...detail,
        message: err?.message || String(err),
      },
    }));
    if (EXTENSION_MODE) {
      postExtensionError(err);
    } else {
      console.warn('[impeccable] visual contrast scan failed', err);
    }
  }

  function scheduleLazyVisualContrast(groupMap, analyses, options = {}, runtime = {}) {
    disconnectLazyVisualContrastObserver();
    if (options.visualContrastLazy === false || options.scrollOffscreen !== false) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const unresolved = __lazyVisualContrastCandidates(analyses);
    if (unresolved.length === 0) return;
    const generation = runtime.generation || scanGeneration;

    lazyVisualContrastObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        const candidate = lazyVisualContrastPending.get(el);
        if (!candidate || lazyVisualContrastResolving.has(el)) continue;
        lazyVisualContrastObserver?.unobserve(el);
        lazyVisualContrastPending.delete(el);
        lazyVisualContrastResolving.add(el);
        waitForVisualPaint()
          .then(() => analyzeVisualContrastCandidate(candidate))
          .then(result => {
            if (generation !== scanGeneration) return;
            rememberVisualContrastAnalysis(result);
            const added = addVisualContrastResult(groupMap, result, { decorate: true });
            if (added) {
              postSerializedFindings(groupMap, options);
              window.dispatchEvent(new CustomEvent('impeccable-visual-contrast-resolved', {
                detail: {
                  selector: result.selector,
                  status: result.status,
                  finding: result.finding || null,
                },
              }));
            }
          })
          .catch(err => {
            reportVisualContrastError(err, { selector: candidate.selector });
          })
          .finally(() => {
            lazyVisualContrastResolving.delete(el);
          });
      }
    }, { threshold: 0.5 });

    for (const candidate of unresolved) {
      let el = null;
      try {
        el = document.querySelector(candidate.selector);
      } catch {
        el = null;
      }
      if (!el) continue;
      lazyVisualContrastPending.set(el, candidate);
      lazyVisualContrastObserver.observe(el);
    }
  }

  async function addVisualContrastFindings(groupMap, options = {}, runtime = {}) {
    if (!shouldRunVisualContrast(options)) {
      lastVisualContrastAnalyses = [];
      disconnectLazyVisualContrastObserver();
      return [];
    }
    const resolvedOptions = visualContrastOptions(options);
    if (visualContrastMode(options) === 'image-only') resolvedOptions.imageOnly = true;
    const analyses = await analyzeVisualContrast(resolvedOptions);
    if (runtime.generation && runtime.generation !== scanGeneration) return analyses;
    lastVisualContrastAnalyses = analyses;
    for (const result of analyses) {
      addVisualContrastResult(groupMap, result, { decorate: runtime.decorate });
    }
    if (runtime.decorate || runtime.scheduleLazy) scheduleLazyVisualContrast(groupMap, analyses, resolvedOptions, runtime);
    return analyses;
  }

  async function collectBrowserFindingsAsync(options = {}, runtime = {}) {
    const collected = collectBrowserFindings();
    // The visual pass walks the DOM on its own; on a skipScan page it would
    // repopulate the emptied scan, so it is skipped with everything else.
    if (skipScanActive()) {
      lastVisualContrastAnalyses = [];
      return { ...collected, allFindings: [], visualContrastAnalyses: [] };
    }
    await addVisualContrastFindings(collected.groupMap, options, runtime);
    return {
      ...collected,
      allFindings: browserFindingsFromMap(collected.groupMap),
      visualContrastAnalyses: lastVisualContrastAnalyses,
    };
  }

  function clearOverlays() {
    scanGeneration += 1;
    disconnectLazyVisualContrastObserver();
    ui.clearOverlays();
  }

  function renderBrowserFindings(collected, options = {}) {
    const { allFindings, pageLevelFindings } = collected;

    for (const { el, findings } of allFindings) {
      if (el === document.body || el === document.documentElement) continue;
      ui.highlight(el, findings);
    }

    if (pageLevelFindings.length > 0) {
      ui.showPageBanner(pageLevelFindings);
    }

    if (!EXTENSION_MODE) printSummary(allFindings);

    // In extension mode, post serialized results for the DevTools panel
    if (EXTENSION_MODE) {
      window.postMessage({
        source: 'impeccable-results',
        findings: serializeFindings(allFindings),
        count: allFindings.length,
        ...scanResultMeta(options),
      }, '*');
    }

    // After this scan completes, all subsequent reveals are instant (no stagger, no animation)
    setTimeout(() => { ui.setFirstScanDone(); }, 1000);

    return allFindings;
  }

  const scan = function(options = {}) {
    clearOverlays();
    const generation = scanGeneration;
    const collected = collectBrowserFindings();
    const allFindings = renderBrowserFindings(collected, options);
    if (!skipScanActive() && shouldRunVisualContrast(options)) {
      addVisualContrastFindings(collected.groupMap, options, { decorate: true, generation })
        .then(() => {
          if (generation === scanGeneration) postSerializedFindings(collected.groupMap, options);
        })
        .catch(err => {
          reportVisualContrastError(err);
        });
    }
    return allFindings;
  };

  const scanAsync = async function(options = {}) {
    clearOverlays();
    const generation = scanGeneration;
    if (shouldRunVisualContrast(options)) {
      const collected = await collectBrowserFindingsAsync(options, { generation, scheduleLazy: true });
      if (generation !== scanGeneration) return [];
      return renderBrowserFindings(collected, options);
    }
    lastVisualContrastAnalyses = [];
    return renderBrowserFindings(collectBrowserFindings(), options);
  };

  const detect = function(options = {}) {
    lastVisualContrastAnalyses = [];
    const { allFindings } = collectBrowserFindings();
    return options.serialize === false ? allFindings : serializeFindings(allFindings);
  };

  const detectAsync = async function(options = {}) {
    if (shouldRunVisualContrast(options)) {
      const { allFindings } = await collectBrowserFindingsAsync(options);
      return options.serialize === false ? allFindings : serializeFindings(allFindings);
    }
    lastVisualContrastAnalyses = [];
    const { allFindings } = collectBrowserFindings();
    return options.serialize === false ? allFindings : serializeFindings(allFindings);
  };

  if (EXTENSION_MODE) {
    // Extension mode: listen for commands, don't auto-scan
    window.addEventListener('message', (e) => {
      if (e.source !== window || !e.data || e.data.source !== 'impeccable-command') return;
      if (e.data.action === 'scan') {
        if (e.data.config) window.__IMPECCABLE_CONFIG__ = e.data.config;
        try {
          scan(e.data.config || {});
        } catch (err) {
          postExtensionError(err);
        }
      }
      if (e.data.action === 'toggle-overlays') {
        const visible = ui.toggleOverlays();
        window.postMessage({ source: 'impeccable-overlays-toggled', visible }, '*');
      }
      if (e.data.action === 'remove') {
        clearOverlays();
        ui.remove();
      }
      if (e.data.action === 'highlight') {
        ui.highlightSelector(e.data.selector);
      }
      if (e.data.action === 'unhighlight') {
        ui.unspotlight();
      }
    });
    window.postMessage({ source: 'impeccable-ready' }, '*');
  } else {
    if (window.__IMPECCABLE_CONFIG__?.autoScan !== false) {
      const runAutoScan = () => {
        try {
          scan();
        } catch (err) {
          console.warn('[impeccable] scan failed', err);
        }
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(runAutoScan, 100));
      } else {
        setTimeout(runAutoScan, 100);
      }
    }
  }

  window.impeccableDetect = detect;
  window.impeccableDetectAsync = detectAsync;
  window.impeccableScan = scan;
  window.impeccableScanAsync = scanAsync;
  // Raw measurement for the URL engine's content-hidden-at-rest pass: it
  // drives a reveal sweep from Node and thresholds the result itself.
  window.impeccableMeasureHiddenText = () => JSON.parse(__impeccable.measure_hidden_text());
  window.impeccableCollectVisualContrastCandidates = collectVisualContrastCandidates;
  window.impeccableAnalyzeVisualContrast = analyzeVisualContrast;
  window.impeccableGetLastVisualContrastAnalyses = () => lastVisualContrastAnalyses.slice();

  // The snapshot route (what the extension runs when the page's CSP keeps
  // WebAssembly out of every world it can reach), exposed here so the two
  // routes can be A/B'd on the same page: capture, run the same core over
  // the snapshot (answering its hit-test needs from the live page), and
  // serialize through it. Deterministic findings only; the visual-contrast
  // pass over a snapshot is the extension's (see 60-offscreen.js).
  window.impeccableSnapshotCapture = (options) => __impeccableSnapshot.capture(options);
  window.impeccableDetectFromSnapshot = function (options = {}) {
    const t0 = performance.now();
    const cap = __impeccableSnapshot.capture(options);
    if (cap.error) throw new Error(cap.error);
    const t1 = performance.now();
    let out = JSON.parse(__impeccable.collect_findings_from_snapshot(cap.json, collectConfigJson()));
    let rounds = 1;
    while (out.needs) {
      __impeccable.snapshot_add_facts(JSON.stringify(__impeccableSnapshot.answer(out.needs, cap)));
      out = JSON.parse(__impeccable.collect_browser_findings(collectConfigJson()));
      if (__impeccable.snapshot_has_needs()) out = { needs: JSON.parse(__impeccable.snapshot_take_needs()) };
      rounds++;
    }
    const serialized = JSON.parse(__impeccable.serialize_findings(JSON.stringify(out.groups)));
    const unknownStyleProps = JSON.parse(__impeccable.snapshot_unknown_style_props());
    __impeccable.snapshot_clear();
    return {
      findings: serialized,
      pageLevel: out.pageLevel,
      stats: { ...cap.stats, rounds, unknownStyleProps, captureMs: t1 - t0, coreMs: performance.now() - t1 },
    };
  };
}
