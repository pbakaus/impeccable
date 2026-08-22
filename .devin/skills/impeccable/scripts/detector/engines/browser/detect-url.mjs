import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { finding } from '../../findings.mjs';
import { profileFindingsAsync, profileStep, profileStepAsync } from '../../profile/profiler.mjs';
import { captureVisualContrastCandidate } from '../visual/screenshot-contrast.mjs';
import { checkContentHiddenAtRest } from '../../rules/checks.mjs';

// On Windows, puppeteer's bundled Chrome lives in a user-writable cache
// directory. Its GPU process can be denied (STATUS_ACCESS_DENIED) by security
// software or the GPU sandbox because it launches from an untrusted path.
// Chrome then crash-loops the GPU process, and each relaunch briefly flashes a
// compositor surface, the black window users report during `detect <url>`
// (issue #372). The system-installed Chrome runs from a trusted location with a
// healthy GPU, so channel:'chrome' avoids the crash entirely; both use hardware
// GPU, so contrast measurement is unaffected. Scope this to Windows only: other
// platforms do not have the bug, so they keep the pinned bundled build for
// consistent measurement across machines. Fall back to bundled when the switch
// fails (Chrome not installed, or channel resolution fails). If the bundled
// launch then also fails, surface the original system-Chrome error as the
// cause so the real failure is not lost.
async function launchBrowser(puppeteer, { headless = true, args = [] } = {}) {
  let channelError;
  if (process.platform === 'win32') {
    try {
      return await puppeteer.default.launch({ channel: 'chrome', headless, args });
    } catch (err) {
      // System Chrome unavailable or unlaunchable; fall through to the bundled
      // browser, but keep the error in case the fallback fails too.
      channelError = err;
    }
  }
  try {
    return await puppeteer.default.launch({ headless, args });
  } catch (err) {
    if (channelError && err && err.cause === undefined) err.cause = channelError;
    throw err;
  }
}

// Reveal sweep + invisible-text measurement for the content-hidden-at-rest
// rule. Scrolls through the document with instant jumps (bypasses CSS
// scroll-behavior: smooth) so IntersectionObserver / scroll reveal handlers
// get every chance to fire, returns to the top, lets transitions settle,
// then measures how much text still renders invisible. A healthy
// reveal-on-scroll page drops to ~0 after the sweep; a page whose reveal
// script died keeps most of its text at opacity 0.
async function measureContentHiddenAfterReveal(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.7));
    const max = Math.max(
      document.documentElement.scrollHeight || 0,
      document.body?.scrollHeight || 0,
    );
    for (let y = 0; y <= max; y += step) {
      window.scrollTo({ top: y, left: 0, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 40)));
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await new Promise(resolve => setTimeout(resolve, 700));
  });
  return page.evaluate(() => {
    if (typeof window.impeccableMeasureHiddenText !== 'function') return null;
    return window.impeccableMeasureHiddenText();
  });
}

function serializeDesignSystemForBrowser(designSystem) {
  if (!designSystem?.present) return null;
  return {
    present: true,
    hasFonts: designSystem.hasFonts === true,
    allowedFonts: Array.from(designSystem.allowedFonts || []),
    hasColors: designSystem.hasColors === true,
    allowedColors: Array.from(designSystem.allowedColorKeys?.values?.() || [])
      .map(entry => entry?.color)
      .filter(color => color && Number.isFinite(color.r) && Number.isFinite(color.g) && Number.isFinite(color.b))
      .map(color => ({ r: color.r, g: color.g, b: color.b })),
    hasRadii: designSystem.hasRadii === true,
    allowedRadii: (designSystem.allowedRadii || [])
      .map(entry => Number(entry?.px))
      .filter(px => Number.isFinite(px)),
    hasPillRadius: designSystem.hasPillRadius === true,
  };
}

async function runVisualContrastFallback(page, serializedGroups, options, profile, target) {
  if (options?.visualContrast === false) return [];
  const maxCandidates = Number.isFinite(options?.visualContrastMaxCandidates)
    ? options.visualContrastMaxCandidates
    : 12;
  const scrollOffscreen = options?.visualContrastScrollOffscreen !== false;
  const existingLowContrastSelectors = new Set(
    serializedGroups
      .filter(group => group.findings?.some(f => f.type === 'low-contrast'))
      .map(group => group.selector)
      .filter(Boolean)
  );

  let browserAnalyses = [];
  const findings = [];
  if (options?.visualContrastBrowser !== false) {
    const browserFindings = await profileFindingsAsync(profile, {
      engine: 'browser',
      phase: 'visual-contrast',
      ruleId: 'browser-fallback',
      target,
    }, async () => {
      browserAnalyses = await page.evaluate(async ({ maxCandidates, scrollOffscreen }) => {
        if (typeof window.impeccableAnalyzeVisualContrast !== 'function') return [];
        return window.impeccableAnalyzeVisualContrast({ maxCandidates, scrollOffscreen });
      }, { maxCandidates, scrollOffscreen });
      return browserAnalyses
        .filter(result => result.finding && !existingLowContrastSelectors.has(result.selector))
        .map(result => result.finding);
    });
    findings.push(...browserFindings);
  }

  let candidates = browserAnalyses.length > 0 ? browserAnalyses : [];
  if (candidates.length === 0) {
    candidates = await profileStepAsync(profile, {
      engine: 'browser',
      phase: 'visual-contrast',
      ruleId: 'collect-candidates',
      target,
    }, () => page.evaluate(({ maxCandidates }) => {
      if (typeof window.impeccableCollectVisualContrastCandidates !== 'function') return [];
      return window.impeccableCollectVisualContrastCandidates({ maxCandidates });
    }, { maxCandidates }));
  }

  const viewport = options?.viewport || { width: 1280, height: 800 };
  const browserResolvedSelectors = new Set(
    browserAnalyses
      .filter(result => result.status === 'fail' || result.status === 'pass')
      .map(result => result.selector)
      .filter(Boolean)
  );
  const filtered = candidates.filter(candidate =>
    !existingLowContrastSelectors.has(candidate.selector) &&
    !browserResolvedSelectors.has(candidate.selector)
  );
  if (options?.visualContrastPixel === false) return findings;
  for (const candidate of filtered) {
    const result = await profileFindingsAsync(profile, {
      engine: 'browser',
      phase: 'visual-contrast',
      ruleId: 'pixel-diff',
      target,
    }, async () => {
      const finding = await captureVisualContrastCandidate(page, candidate, viewport);
      return finding ? [finding] : [];
    });
    findings.push(...result);
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Puppeteer detection (for URLs)
// ---------------------------------------------------------------------------

async function detectUrl(url, options = {}) {
  const profile = options?.profile;
  const waitUntil = options?.waitUntil || 'networkidle0';
  const settleMs = Number.isFinite(options?.settleMs) ? options.settleMs : 0;
  const viewport = options?.viewport || { width: 1280, height: 800 };
  const externalBrowser = options?.browser || null;
  let puppeteer;
  if (!externalBrowser) {
    try {
      puppeteer = await profileStepAsync(profile, {
        engine: 'browser',
        phase: 'setup',
        ruleId: 'import-puppeteer',
        target: url,
      }, () => import('puppeteer'));
    } catch {
      throw new Error('puppeteer is required for URL scanning. Install: npm install puppeteer');
    }
  }

  // Read the browser detection script — reuse it instead of reimplementing
  const browserScriptPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'detect-antipatterns-browser.js'
  );
  let browserScript;
  try {
    browserScript = profileStep(profile, {
      engine: 'browser',
      phase: 'setup',
      ruleId: 'read-browser-script',
      target: url,
    }, () => fs.readFileSync(browserScriptPath, 'utf-8'));
  } catch {
    throw new Error(`Browser script not found at ${browserScriptPath}`);
  }

  // CI runners (GitHub Actions Ubuntu) block unprivileged user namespaces, so
  // Chrome can't initialize its sandbox there. Disable the sandbox only when
  // running in CI; local users keep the default hardened launch.
  const launchArgs = process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
  const browser = externalBrowser || await profileStepAsync(profile, {
    engine: 'browser',
    phase: 'load',
    ruleId: 'launch-browser',
    target: url,
  }, () => launchBrowser(puppeteer, { headless: options?.headless ?? true, args: launchArgs }));
  const page = await profileStepAsync(profile, {
    engine: 'browser',
    phase: 'load',
    ruleId: 'new-page',
    target: url,
  }, () => browser.newPage());

  // Uncaught exceptions and parse errors surface as pageerror events. The
  // listener must attach before goto: a syntax error fires during the
  // initial parse, long before the load event. Dedupe by message; a single
  // broken loop can otherwise throw hundreds of identical errors.
  const pageErrors = [];
  if (options?.scriptErrors !== false) {
    page.on('pageerror', (err) => {
      const message = String(err?.message || err).split('\n')[0].trim().slice(0, 160);
      if (message && !pageErrors.includes(message)) pageErrors.push(message);
    });
  }

  let results = [];
  try {
    await profileStepAsync(profile, {
      engine: 'browser',
      phase: 'load',
      ruleId: 'set-viewport',
      target: url,
    }, () => page.setViewport(viewport));
    await profileStepAsync(profile, {
      engine: 'browser',
      phase: 'load',
      ruleId: `goto:${waitUntil}`,
      target: url,
    }, () => page.goto(url, { waitUntil, timeout: 30000 }));
    if (settleMs > 0) {
      await profileStepAsync(profile, {
        engine: 'browser',
        phase: 'load',
        ruleId: 'settle',
        target: url,
      }, () => new Promise(resolve => setTimeout(resolve, settleMs)));
    }

    // Inject the browser detection script and collect results
    const browserDesignSystem = serializeDesignSystemForBrowser(options?.designSystem);
    await profileStepAsync(profile, {
      engine: 'browser',
      phase: 'scan',
      ruleId: 'configure-pure-detect',
      target: url,
    }, () => page.evaluate((designSystem) => {
      window.__IMPECCABLE_CONFIG__ = {
        ...(window.__IMPECCABLE_CONFIG__ || {}),
        autoScan: false,
        ...(designSystem ? { designSystem } : {}),
      };
    }, browserDesignSystem));
    await profileStepAsync(profile, {
      engine: 'browser',
      phase: 'scan',
      ruleId: 'inject-browser-script',
      target: url,
    }, () => page.evaluate(browserScript));
    let serializedGroups = [];
    results = await profileFindingsAsync(profile, {
      engine: 'browser',
      phase: 'scan',
      ruleId: 'browser-scan',
      target: url,
    }, async () => {
      serializedGroups = await page.evaluate(() => {
        if (!window.impeccableDetect) return [];
        return window.impeccableDetect({ decorate: false, serialize: true });
      });
      return serializedGroups.flatMap(({ findings }) =>
        findings.map(f => ({ id: f.type, snippet: f.detail, ignoreValue: f.ignoreValue || '', severity: f.severity || '' }))
      );
    });
    // Content invisible at rest: reveal sweep, then re-measure. Runs after
    // the main scan (which must see the true at-rest state) and before the
    // visual contrast fallback (the sweep restores scroll to the top).
    if (options?.contentHidden !== false) {
      const hiddenFindings = await profileFindingsAsync(profile, {
        engine: 'browser',
        phase: 'scan',
        ruleId: 'content-hidden-at-rest',
        target: url,
      }, async () => {
        const measured = await measureContentHiddenAfterReveal(page);
        return measured ? checkContentHiddenAtRest(measured) : [];
      });
      results.push(...hiddenFindings);
    }

    for (const message of pageErrors.slice(0, 3)) {
      results.push({ id: 'script-error', snippet: message });
    }

    const visualFindings = await runVisualContrastFallback(page, serializedGroups, options, profile, url);
    results.push(...visualFindings);
  } finally {
    await profileStepAsync(profile, {
      engine: 'browser',
      phase: 'load',
      ruleId: 'close-page',
      target: url,
    }, () => page.close().catch(() => {}));
    if (!externalBrowser) {
      await profileStepAsync(profile, {
        engine: 'browser',
        phase: 'load',
        ruleId: 'close-browser',
        target: url,
      }, () => browser.close());
    }
  }
  return results.map(f => {
    const item = finding(f.id, url, f.snippet);
    if (f.ignoreValue) item.ignoreValue = f.ignoreValue;
    // Per-finding severity promotion (e.g. hero-region pulsing dot)
    // overrides the registry default carried by finding().
    if (f.severity && f.severity !== item.severity) item.severity = f.severity;
    return item;
  });
}

async function createBrowserDetector(options = {}) {
  let puppeteer;
  try {
    puppeteer = await import('puppeteer');
  } catch {
    throw new Error('puppeteer is required for URL scanning. Install: npm install puppeteer');
  }
  const launchArgs = options.launchArgs || (process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : []);
  const browser = options.browser || await launchBrowser(puppeteer, {
    headless: options.headless ?? true,
    args: launchArgs,
  });
  const ownsBrowser = !options.browser;
  const defaults = {
    waitUntil: options.waitUntil || 'load',
    settleMs: Number.isFinite(options.settleMs) ? options.settleMs : 100,
    viewport: options.viewport || { width: 1280, height: 800 },
  };
  return {
    browser,
    async detectUrl(url, scanOptions = {}) {
      return detectUrl(url, {
        ...defaults,
        ...scanOptions,
        browser,
      });
    },
    async close() {
      if (ownsBrowser) await browser.close().catch(() => {});
    },
  };
}

export { runVisualContrastFallback, detectUrl, createBrowserDetector, launchBrowser };
