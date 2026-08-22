import fs from 'node:fs';
import path from 'node:path';

import { GENERIC_FONTS, OVERUSED_FONTS } from '../../shared/constants.mjs';
import {
  checkSourceDesignSystem,
  collectStaticDesignSystemFindings,
  mergeDesignSystemFindings,
} from '../../design-system.mjs';
import { isFullPage } from '../../shared/page.mjs';
import { applyInlineIgnores } from '../../shared/inline-ignores.mjs';
import { finding } from '../../findings.mjs';
import { profileFindings, profileStep, profileStepAsync } from '../../profile/profiler.mjs';
import {
  checkElementBorders,
  checkElementClippedOverflow,
  checkElementColors,
  checkElementGlow,
  checkElementGptBorderShadow,
  checkElementHeroEyebrow,
  checkElementHoverContrast,
  checkElementIconTile,
  checkElementItalicSerif,
  checkElementMotion,
  checkElementOversizedH1,
  checkElementQuality,
  checkElementRadialSpotlight,
  checkCreamPalette,
  checkHtmlPatterns,
  checkKickerAboveHeadingFromDoc,
  scopedIgnoreActive,
  checkNumberedSectionLabelsFromDoc,
  checkPageLayout,
  checkPageQualityFromDoc,
  checkRepeatedContainerTextFromDoc,
  resolveBackground,
  resolveBorderRadiusPx,
} from '../../rules/checks.mjs';
import { detectText, runTextContentAnalyzers } from '../regex/detect-text.mjs';
import {
  StaticDocument,
  buildStaticStyleMap,
  buildStaticWindow,
  collectStaticCssText,
} from './css-cascade.mjs';

function checkStaticPageTypography(document, window) {
  const findings = [];
  const fonts = new Set();
  const overusedFound = new Set();
  for (const el of document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, dd, blockquote, figcaption, a, button, label, span, div')) {
    const hasText = el.childNodes.some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!hasText) continue;
    const ff = window.getComputedStyle(el).fontFamily || '';
    const stack = ff.split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
    const primary = stack.find(f => f && !GENERIC_FONTS.has(f));
    if (!primary) continue;
    fonts.add(primary);
    if (OVERUSED_FONTS.has(primary)) overusedFound.add(primary);
  }
  for (const font of overusedFound) {
    findings.push({ id: 'overused-font', snippet: `Primary font: ${font}` });
  }
  const sizes = new Set();
  for (const el of document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, a, li, td, th, label, button, div')) {
    const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
    if (fontSize >= 8 && fontSize < 200) sizes.add(Math.round(fontSize * 10) / 10);
  }
  if (sizes.size >= 3) {
    const sorted = [...sizes].sort((a, b) => a - b);
    const ratio = sorted[sorted.length - 1] / sorted[0];
    if (ratio < 2.0) {
      findings.push({ id: 'flat-type-hierarchy', snippet: `Sizes: ${sorted.map(s => s + 'px').join(', ')} (ratio ${ratio.toFixed(1)}:1)` });
    }
  }
  return findings;
}

function checkElementBrokenImage(el) {
  const src = (el.getAttribute && el.getAttribute('src')) ?? el.attribs?.src;
  // Missing src attribute entirely
  if (src === undefined || src === null) {
    return [{ id: 'broken-image', snippet: '<img> with no src attribute' }];
  }
  const trimmed = String(src).trim();
  // Empty or placeholder-only src values
  if (trimmed === '' || trimmed === '#') {
    return [{ id: 'broken-image', snippet: `<img src="${src}">` }];
  }
  return [];
}

const STATIC_ELEMENT_RULES = [
  { id: 'border-rules', selector: '*', run: (el, tag, style, window, customPropMap) => checkElementBorders(tag, style, null, resolveBorderRadiusPx(el, style, parseFloat(style.width) || 0, window), el) },
  { id: 'color-rules', selector: '*', run: (el, tag, style, window, customPropMap) => checkElementColors(el, style, tag, window, customPropMap, false) },
  { id: 'hover-color-rules', selector: '*', run: (el, tag, style, window) => checkElementHoverContrast(el, style, tag, window) },
  { id: 'dark-glow', selector: '*', run: (el, tag, style, window, customPropMap) => checkElementGlow(tag, style, resolveBackground(el.parentElement || el, window, customPropMap)) },
  { id: 'motion-rules', selector: '*', run: (el, tag, style) => checkElementMotion(tag, style) },
  { id: 'icon-tile-stack', selector: 'h1,h2,h3,h4,h5,h6', run: (el, tag, _style, window) => checkElementIconTile(el, tag, window) },
  { id: 'italic-serif-display', selector: 'h1,h2', run: (el, tag, style) => checkElementItalicSerif(el, style, tag) },
  { id: 'hero-eyebrow-chip', selector: 'h1', run: (el, tag, style, window, customPropMap) => checkElementHeroEyebrow(el, style, tag, window, customPropMap) },
  { id: 'broken-image', selector: 'img', run: (el) => checkElementBrokenImage(el) },
  { id: 'quality-rules', selector: '*', run: (el, tag, style, window) => checkElementQuality(el, style, tag, window) },
  { id: 'oversized-h1', selector: 'h1', run: (el, tag, style, window) => checkElementOversizedH1(el, style, tag, window) },
  { id: 'clipped-overflow-container', selector: '*', run: (el, tag, style, window) => checkElementClippedOverflow(el, style, tag, window) },
  { id: 'gpt-thin-border-wide-shadow', selector: '*', run: (el, tag, style) => checkElementGptBorderShadow(el, style) },
  { id: 'radial-spotlight-glow', selector: '*', run: (el, tag, style, window) => checkElementRadialSpotlight(el, style, tag, window) },
];

async function detectHtml(filePath, options = {}) {
  const profile = options?.profile;
  const html = profileStep(profile, {
    engine: 'static-html',
    phase: 'setup',
    ruleId: 'read-html',
    target: filePath,
  }, () => fs.readFileSync(filePath, 'utf-8'));

  let modules;
  try {
    modules = await profileStepAsync(profile, {
      engine: 'static-html',
      phase: 'setup',
      ruleId: 'import-static-parser',
      target: filePath,
    }, async () => {
      const [htmlparser2, cssSelect, csstree, domutils] = await Promise.all([
        import('htmlparser2'),
        import('css-select'),
        import('css-tree'),
        import('domutils'),
      ]);
      return {
        parseDocument: htmlparser2.parseDocument,
        selectAll: cssSelect.selectAll,
        selectOne: cssSelect.selectOne,
        compile: cssSelect.compile,
        csstree,
        domutils,
      };
    });
  } catch (err) {
  if (!globalThis.__impeccableStaticHtmlWarned) {
    globalThis.__impeccableStaticHtmlWarned = true;

    process.stderr.write(
  'impeccable detect: DEGRADED - HTML parser modules unavailable ' +
  '(htmlparser2, css-select, css-tree, domutils).\n' +
  'Falling back to regex matching. Custom properties, selector matching and computed ' +
  'contrast are NOT evaluated; findings are an undercount, not a clean bill of health.\n'
);
  }

  return detectText(html, filePath, options);
}

  const resolvedPath = path.resolve(filePath);
  const fileDir = path.dirname(resolvedPath);
  const root = profileStep(profile, {
    engine: 'static-html',
    phase: 'parse-html',
    ruleId: 'parse-document',
    target: filePath,
  }, () => modules.parseDocument(html, { lowerCaseAttributeNames: false, lowerCaseTags: true }));

  const cssText = collectStaticCssText(root, fileDir, profile, filePath, modules);
  const document = new StaticDocument(root, modules);
  buildStaticStyleMap(root, document, cssText, modules, profile, filePath);
  const window = buildStaticWindow(document);

  const customPropMap = null;

  const findings = [];
  const runElementCheck = (ruleId, callback) => profile
    ? profileFindings(profile, { engine: 'static-html', phase: 'element', ruleId, target: filePath }, callback)
    : callback();

  const visitedByRule = new Map();
  for (const rule of STATIC_ELEMENT_RULES) {
    const elements = document.querySelectorAll(rule.selector);
    visitedByRule.set(rule.id, elements.length);
    for (const el of elements) {
      const tag = el.tagName.toLowerCase();
      const style = window.getComputedStyle(el);
      for (const f of runElementCheck(rule.id, () => rule.run(el, tag, style, window, customPropMap))) {
        // Element-scoped waivers: a data-impeccable-ignore ancestor suppresses
        // matching findings for its subtree, same as the browser walk.
        if (scopedIgnoreActive(el, f.id)) continue;
        findings.push(finding(f.id, filePath, f.snippet));
      }
    }
  }

  if (options?.designSystem) {
    const sourceDesignFindings = profileFindings(profile, {
      engine: 'static-html',
      phase: 'source',
      ruleId: 'design-system',
      target: filePath,
    }, () => checkSourceDesignSystem(html, filePath, { designSystem: options.designSystem }));
    const staticDesignFindings = profileFindings(profile, {
      engine: 'static-html',
      phase: 'page',
      ruleId: 'design-system',
      target: filePath,
    }, () => collectStaticDesignSystemFindings(document, window, filePath, options.designSystem));
    findings.push(...mergeDesignSystemFindings(staticDesignFindings, sourceDesignFindings));
  }

  if (isFullPage(html)) {
    const runPageCheck = (ruleId, callback) => profile
      ? profileFindings(profile, { engine: 'static-html', phase: 'page', ruleId, target: filePath }, callback)
      : callback();
    for (const f of runPageCheck('typography-rules', () => checkStaticPageTypography(document, window))) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of runPageCheck('kicker-above-heading', () => checkKickerAboveHeadingFromDoc(document, window))) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of runPageCheck('numbered-section-labels', () => checkNumberedSectionLabelsFromDoc(document, window))) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of runPageCheck('repeated-container-text', () => checkRepeatedContainerTextFromDoc(document, window))) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of runPageCheck('layout-rules', () => checkPageLayout(document, window))) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of runPageCheck('cream-palette', () => checkCreamPalette(document, window))) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    for (const f of runPageCheck('skipped-heading', () => checkPageQualityFromDoc(document))) {
      findings.push(finding(f.id, filePath, f.snippet));
    }
    // Scoped corpora for the pattern checks (see buildHtmlPatternCorpora in
    // rules/checks.mjs): CSS-property regexes must not fire on prose ABOUT
    // css — `<code>background-clip: text</code>` in a changelog is
    // documentation, not styling. cssText already carries the <style>
    // blocks and any linked local stylesheets; style/class attributes come
    // from the parsed document, so escaped code samples never contribute.
    const styleAttrParts = [];
    const classAttrParts = [];
    for (const el of document.querySelectorAll('*')) {
      const styleAttr = el.getAttribute('style');
      if (styleAttr) styleAttrParts.push(`style="${styleAttr}"`);
      const classAttr = el.getAttribute('class');
      if (classAttr) classAttrParts.push(classAttr);
    }
    const patternCorpora = {
      styleText: [cssText, ...styleAttrParts].join('\n'),
      classText: classAttrParts.join('\n'),
    };
    for (const f of runPageCheck('html-patterns', () => checkHtmlPatterns(html, patternCorpora).filter(item =>
      item.id !== 'bounce-easing' && item.id !== 'layout-transition'
    ))) {
      // Selector-backed page findings honor scoped waivers here too, matching
      // the browser pass: resolve the selector and drop the finding when an
      // ignoring ancestor covers a match. Unlike the browser, an unmatched
      // selector keeps the finding — static scans see partial documents.
      if (f.selector) {
        let matches = null;
        try {
          matches = document.querySelectorAll(String(f.selector).replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '').trim());
        } catch { matches = null; }
        if (matches && matches.length > 0 && [...matches].every(el => scopedIgnoreActive(el, f.id))) continue;
      }
      const item = finding(f.id, filePath, f.snippet);
      // Position-aware severity promotion: checks may attach a per-finding
      // severity (e.g. a pulsing dot inside a header/nav landmark) that
      // overrides the registry default.
      if (f.severity) item.severity = f.severity;
      findings.push(item);
    }
    // Text-content analyzers (em-dash overuse, marketing buzzwords,
    // numbered section markers, aphoristic cadence) live in the regex
    // engine. Call them from here so .html files get the same coverage
    // as .css/.tsx files. These are scoped to text content only and
    // don't overlap with static-html's element/page rules.
    for (const f of runPageCheck('text-content', () => runTextContentAnalyzers(html, filePath, options))) {
      findings.push(finding(f.antipattern, filePath, f.snippet));
    }
  }

  // Static-HTML findings carry no line number, so only whole-file
  // `impeccable-disable` directives apply here — exactly the standalone-document
  // waiver this primitive targets. Bypassed by `--no-config` / `--no-inline-ignores`.
  return options?.inlineIgnores === false ? findings : applyInlineIgnores(findings, html);
}

export { checkStaticPageTypography, STATIC_ELEMENT_RULES, detectHtml };
