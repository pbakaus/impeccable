// --- browser-bundle/30-scan-common.js ---
// Scan-config plumbing shared by the in-page bundle (50-scan.js) and the
// extension's offscreen document (60-offscreen.js): which visual-contrast
// mode a scan runs in, the options it resolves to, which analyses the lazy
// (scroll-into-view) pass re-tries, and the scanId echo. `config` is the
// page's `window.__IMPECCABLE_CONFIG__` in the page and the extension's scan
// config offscreen.

// Visual contrast has three modes. Explicit true runs the full sampled
// pass; explicit false disables it entirely (the deterministic-only mode
// the test suites use). Unset — the default overlay run — samples ONLY
// image-backed text: the one class the analytic walk deliberately skips,
// because a url() layer's pixels are unknowable without looking. In-page
// sampling draws the source image alone to a canvas (glyph ink never
// pollutes it), and a cross-origin image without CORS reports unresolved
// instead of guessing.
function __visualContrastMode(options = {}, config = {}) {
  const explicit = typeof options.visualContrast === 'boolean'
    ? options.visualContrast
    : typeof config?.visualContrast === 'boolean'
      ? config.visualContrast
      : null;
  if (explicit === true) return 'full';
  if (explicit === false) return false;
  return 'image-only';
}

function __visualContrastOptions(options = {}, config = {}) {
  config = config || {};
  const scrollOffscreen = typeof options.scrollOffscreen === 'boolean'
    ? options.scrollOffscreen
    : typeof options.visualContrastScrollOffscreen === 'boolean'
      ? options.visualContrastScrollOffscreen
      : typeof config.visualContrastScrollOffscreen === 'boolean'
        ? config.visualContrastScrollOffscreen
        : false;
  return {
    ...options,
    maxCandidates: Number.isFinite(options.visualContrastMaxCandidates)
      ? options.visualContrastMaxCandidates
      : Number.isFinite(options.maxCandidates)
        ? options.maxCandidates
        : Number.isFinite(config.visualContrastMaxCandidates)
          ? config.visualContrastMaxCandidates
          : undefined,
    scrollOffscreen,
  };
}

// The analyses the lazy pass watches: unresolved only because the text was
// outside the viewport, and addressable.
function __lazyVisualContrastCandidates(analyses) {
  return (analyses || []).filter(result =>
    result?.status === 'unresolved' &&
    result.reason === 'text outside viewport' &&
    result.selector
  );
}

function __scanResultMeta(options = {}) {
  const scanId = options.scanId;
  if (typeof scanId !== 'string' && typeof scanId !== 'number') return {};
  return { scanId: String(scanId) };
}
