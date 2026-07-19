#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const DEFAULT_BASE_URL = 'http://127.0.0.1:4321';
const DEFAULT_SEEDS = [
  '/',
  '/designing/',
  '/docs/',
  '/slop/',
  '/live-mode/',
  '/detector/',
  '/tutorials/',
  '/design-system/',
  '/design-system/explorations/',
  '/faq/',
  '/changelog/',
  '/privacy/',
  '/cases/neo-mirai/',
  '/shader-lab/',
];
const DEFAULT_VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  mobile: { width: 390, height: 844 },
};
const SKIP_PATH_PREFIXES = [
  '/_astro/',
  '/api/',
  '/antipattern-examples/',
  '/assets/',
  '/detector/fixtures/',
  '/neo-mirai/',
];

const options = parseArgs(process.argv.slice(2));
const browser = await chromium.launch({ headless: true });

try {
  const routes = options.routes.length > 0
    ? options.routes.map(normalizePath)
    : await discoverRoutes(browser, options.baseUrl, options.maxPages);
  const results = [];

  for (const viewportName of options.viewports) {
    for (const theme of options.themes) {
      const context = await browser.newContext({
        colorScheme: theme,
        reducedMotion: 'reduce',
        viewport: DEFAULT_VIEWPORTS[viewportName],
      });
      await context.addInitScript((forcedTheme) => {
        localStorage.setItem('impeccable-theme', forcedTheme);
      }, theme);

      for (const route of routes) {
        const page = await context.newPage();
        const url = new URL(route, options.baseUrl).href;
        let response;

        try {
          response = await page.goto(url, { waitUntil: 'domcontentloaded' });
          await page.evaluate(() => document.fonts?.ready);
          const pageResult = await page.evaluate(scanRenderedText);
          results.push({
            route,
            theme,
            viewport: viewportName,
            status: response?.status() || null,
            title: await page.title(),
            ...pageResult,
          });
        } catch (error) {
          results.push({
            route,
            theme,
            viewport: viewportName,
            status: response?.status() || null,
            error: error.message,
            findings: [],
            scannedTextElements: 0,
          });
        } finally {
          await page.close();
        }
      }

      await context.close();
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    routes,
    themes: options.themes,
    viewports: options.viewports,
    results,
  };

  const renderedOutput = options.format === 'json'
    ? `${JSON.stringify(report, null, 2)}\n`
    : printMarkdown(report, options);
  printOutput(renderedOutput, options.output);

  if (options.failOnAa && results.some((result) =>
    result.findings.some((finding) => !finding.complexBackground && !finding.passAa))) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}

function parseArgs(args) {
  const parsed = {
    baseUrl: DEFAULT_BASE_URL,
    failOnAa: false,
    format: 'markdown',
    includeComplex: false,
    maxPages: 100,
    output: null,
    routes: [],
    standard: 'aa',
    themes: ['light', 'dark'],
    viewports: ['desktop', 'mobile'],
  };

  for (const arg of args) {
    if (arg === '--fail-on-aa') parsed.failOnAa = true;
    else if (arg === '--include-complex') parsed.includeComplex = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith('--base-url=')) {
      parsed.baseUrl = arg.slice('--base-url='.length).replace(/\/$/, '');
    } else if (arg.startsWith('--format=')) {
      parsed.format = arg.slice('--format='.length);
    } else if (arg.startsWith('--max-pages=')) {
      parsed.maxPages = Number.parseInt(arg.slice('--max-pages='.length), 10);
    } else if (arg.startsWith('--output=')) {
      parsed.output = arg.slice('--output='.length);
    } else if (arg.startsWith('--routes=')) {
      parsed.routes = splitList(arg.slice('--routes='.length));
    } else if (arg.startsWith('--standard=')) {
      parsed.standard = arg.slice('--standard='.length).toLowerCase();
    } else if (arg.startsWith('--themes=')) {
      parsed.themes = expandChoice(arg.slice('--themes='.length), ['light', 'dark']);
    } else if (arg.startsWith('--viewports=')) {
      parsed.viewports = expandChoice(arg.slice('--viewports='.length), ['desktop', 'mobile']);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!['json', 'markdown'].includes(parsed.format)) {
    throw new Error('--format must be json or markdown');
  }
  if (!['aa', 'aaa', '9'].includes(parsed.standard)) {
    throw new Error('--standard must be aa, aaa, or 9');
  }
  return parsed;
}

function splitList(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function expandChoice(value, choices) {
  if (value === 'all' || value === 'both') return choices;
  const selected = splitList(value);
  for (const item of selected) {
    if (!choices.includes(item)) {
      throw new Error(`Expected one of ${choices.join(', ')}, received ${item}`);
    }
  }
  return selected;
}

function normalizePath(value) {
  const url = new URL(value, 'https://audit.invalid');
  let pathname = url.pathname;
  if (!pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(pathname)) pathname += '/';
  return pathname;
}

async function discoverRoutes(browserInstance, baseUrl, maxPages) {
  const context = await browserInstance.newContext({
    colorScheme: 'light',
    reducedMotion: 'reduce',
    viewport: DEFAULT_VIEWPORTS.desktop,
  });
  await context.addInitScript(() => {
    localStorage.setItem('impeccable-theme', 'light');
  });
  const page = await context.newPage();
  const origin = new URL(baseUrl).origin;
  const queue = [...DEFAULT_SEEDS];
  const visited = new Set();

  while (queue.length > 0 && visited.size < maxPages) {
    const route = normalizePath(queue.shift());
    if (visited.has(route) || shouldSkipPath(route)) continue;
    visited.add(route);

    try {
      const response = await page.goto(new URL(route, baseUrl).href, {
        waitUntil: 'domcontentloaded',
      });
      const contentType = response?.headers()['content-type'] || '';
      if (!response?.ok() || !contentType.includes('text/html')) continue;

      const hrefs = await page.locator('a[href]').evaluateAll((anchors) =>
        anchors.map((anchor) => anchor.href));
      for (const href of hrefs) {
        const url = new URL(href);
        if (url.origin !== origin || shouldSkipPath(url.pathname)) continue;
        const discovered = normalizePath(url.pathname);
        if (!visited.has(discovered) && !queue.includes(discovered)) queue.push(discovered);
      }
    } catch {
      // Keep discovery resilient; the audit phase records route errors.
    }
  }

  await context.close();
  return [...visited].sort((a, b) => a.localeCompare(b));
}

function shouldSkipPath(pathname) {
  if (SKIP_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  return /\.(?:avif|css|gif|ico|jpe?g|js|json|map|md|pdf|png|svg|txt|webp|xml|zip)$/i.test(pathname);
}

function scanRenderedText() {
  const findings = [];
  let scannedTextElements = 0;

  for (const element of document.querySelectorAll('body *')) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) continue;
    if (element.checkVisibility && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    if (rect.width === 0 || rect.height === 0 || rect.bottom <= 0 || rect.right <= 0) continue;
    if (element.closest('[hidden], [inert], [aria-hidden="true"], [disabled], [aria-disabled="true"]')) continue;

    const text = ownVisibleText(element);
    if (!text) continue;
    scannedTextElements += 1;

    const foreground = parseColor(style.color);
    const background = effectiveBackground(element);
    if (!foreground || !background.color || background.color.a < 0.999) continue;

    const paintedForeground = composite(foreground, background.color);
    const ratio = contrastRatio(paintedForeground, background.color);
    const fontSize = Number.parseFloat(style.fontSize) || 16;
    const fontWeight = numericFontWeight(style.fontWeight);
    const largeText = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    const aaThreshold = largeText ? 3 : 4.5;
    const aaaThreshold = largeText ? 4.5 : 7;
    const passAa = ratio + 0.005 >= aaThreshold;
    const passAaa = ratio + 0.005 >= aaaThreshold;
    const passStrictNine = ratio + 0.005 >= 9;

    if (passAa && passAaa && passStrictNine) continue;

    findings.push({
      aaThreshold,
      aaaThreshold,
      background: formatColor(background.color),
      backgroundImages: background.images,
      complexBackground: background.images.length > 0,
      fontSize: round(fontSize, 2),
      fontWeight,
      foreground: formatColor(foreground),
      largeText,
      passAa,
      passAaa,
      passStrictNine,
      ratio: round(ratio, 2),
      selector: cssPath(element),
      tag: element.tagName.toLowerCase(),
      text: text.replace(/\s+/g, ' ').slice(0, 140),
    });
  }

  const grouped = new Map();
  for (const finding of findings) {
    const key = [
      finding.selector,
      finding.foreground,
      finding.background,
      finding.ratio,
      finding.fontSize,
      finding.fontWeight,
      finding.complexBackground,
    ].join('|');
    const existing = grouped.get(key);
    if (existing) {
      existing.occurrences += 1;
      if (!existing.textExamples.includes(finding.text) && existing.textExamples.length < 4) {
        existing.textExamples.push(finding.text);
      }
    } else {
      grouped.set(key, {
        ...finding,
        occurrences: 1,
        textExamples: [finding.text],
      });
    }
  }

  const groupedFindings = [...grouped.values()]
    .sort((a, b) => a.ratio - b.ratio || a.selector.localeCompare(b.selector));
  return { findings: groupedFindings, scannedTextElements };

  function ownVisibleText(element) {
    const direct = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent.trim())
      .filter(Boolean)
      .join(' ');
    if (direct) return direct;
    if (element instanceof HTMLInputElement) {
      const textTypes = new Set(['email', 'number', 'password', 'search', 'tel', 'text', 'url']);
      if (!textTypes.has(element.type)) return '';
      return element.value || element.placeholder || '';
    }
    if (element instanceof HTMLTextAreaElement) return element.value || element.placeholder || '';
    if (element instanceof HTMLSelectElement) {
      return element.selectedOptions[0]?.textContent?.trim() || '';
    }
    if (element.tagName === 'SVG') return element.getAttribute('aria-label') || '';
    return '';
  }

  function effectiveBackground(element) {
    let current = { r: 0, g: 0, b: 0, a: 0 };
    const images = [];

    for (let node = element; node instanceof Element; node = node.parentElement) {
      const nodeStyle = getComputedStyle(node);
      if (nodeStyle.backgroundImage !== 'none') {
        images.push(`${cssPath(node)}: ${nodeStyle.backgroundImage.slice(0, 120)}`);
      }
      const layer = parseColor(nodeStyle.backgroundColor);
      if (layer && layer.a > 0) current = composite(current, layer);
      if (current.a >= 0.999) break;
    }

    if (current.a < 0.999) current = composite(current, { r: 255, g: 255, b: 255, a: 1 });
    return { color: current, images };
  }

  function parseColor(value) {
    if (!value || value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

    const rgb = value.match(/^rgba?\((.+)\)$/i);
    if (rgb) {
      const [channels, alpha = '1'] = rgb[1].split('/').map((part) => part.trim());
      const parts = channels.includes(',')
        ? channels.split(',').map((part) => part.trim())
        : channels.split(/\s+/);
      const trailingAlpha = parts.length === 4 ? parts.pop() : alpha;
      const [r, g, b] = parts.map(channelToByte);
      return { r, g, b, a: alphaToNumber(trailingAlpha) };
    }

    const oklch = value.match(/^oklch\((.+)\)$/i);
    if (oklch) {
      const [channels, alpha = '1'] = oklch[1].split('/').map((part) => part.trim());
      const [lightness, chroma, hue = '0'] = channels.split(/\s+/);
      const L = lightness.endsWith('%') ? Number.parseFloat(lightness) / 100 : Number.parseFloat(lightness);
      const C = Number.parseFloat(chroma);
      const h = Number.parseFloat(hue) * Math.PI / 180;
      const a = C * Math.cos(h);
      const b = C * Math.sin(h);
      const lPrime = L + 0.3963377774 * a + 0.2158037573 * b;
      const mPrime = L - 0.1055613458 * a - 0.0638541728 * b;
      const sPrime = L - 0.0894841775 * a - 1.291485548 * b;
      const l = lPrime ** 3;
      const m = mPrime ** 3;
      const s = sPrime ** 3;
      return {
        r: linearToByte(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        g: linearToByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        b: linearToByte(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
        a: alphaToNumber(alpha),
      };
    }

    const srgb = value.match(/^color\(srgb\s+(.+)\)$/i);
    if (srgb) {
      const [channels, alpha = '1'] = srgb[1].split('/').map((part) => part.trim());
      const [r, g, b] = channels.split(/\s+/).map((part) => Number.parseFloat(part) * 255);
      return { r, g, b, a: alphaToNumber(alpha) };
    }

    return null;
  }

  function channelToByte(value) {
    return value.endsWith('%') ? Number.parseFloat(value) * 2.55 : Number.parseFloat(value);
  }

  function alphaToNumber(value) {
    return value.endsWith('%') ? Number.parseFloat(value) / 100 : Number.parseFloat(value);
  }

  function linearToByte(value) {
    const clamped = Math.max(0, Math.min(1, value));
    const encoded = clamped <= 0.0031308
      ? 12.92 * clamped
      : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return encoded * 255;
  }

  function composite(top, bottom) {
    const alpha = top.a + bottom.a * (1 - top.a);
    if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
      g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
      b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
      a: alpha,
    };
  }

  function contrastRatio(first, second) {
    const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
    const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
    return (lighter + 0.05) / (darker + 0.05);
  }

  function relativeLuminance(color) {
    const [r, g, b] = [color.r, color.g, color.b].map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function numericFontWeight(value) {
    if (value === 'normal') return 400;
    if (value === 'bold') return 700;
    return Number.parseInt(value, 10) || 400;
  }

  function formatColor(color) {
    return `rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)} / ${round(color.a, 3)})`;
  }

  function cssPath(element) {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const parts = [];
    for (let node = element; node instanceof Element && parts.length < 5; node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      const stableClasses = [...node.classList]
        .filter((name) => !name.startsWith('astro-') && !/^is-(?:active|visible)$/.test(name))
        .slice(0, 3);
      if (stableClasses.length > 0) part += `.${stableClasses.map((name) => CSS.escape(name)).join('.')}`;
      parts.unshift(part);
      if (node.matches('main, header, footer, nav')) break;
    }
    return parts.join(' > ');
  }

  function round(value, places) {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  }
}

function printMarkdown(report, parsedOptions) {
  const lines = [];
  const print = (line = '') => lines.push(line);
  const flat = report.results.flatMap((result) => result.findings.map((finding) => ({
    route: result.route,
    theme: result.theme,
    viewport: result.viewport,
    ...finding,
  })));
  const aaFailures = flat.filter((finding) => !finding.complexBackground && !finding.passAa);
  const aaaFailures = flat.filter((finding) => !finding.complexBackground && !finding.passAaa);
  const strictNineMisses = flat.filter((finding) => !finding.complexBackground && !finding.passStrictNine);
  const complex = flat.filter((finding) => finding.complexBackground);
  const errors = report.results.filter((result) => result.error || (result.status && result.status >= 400));

  print('# Rendered contrast audit');
  print();
  print(`- Base URL: ${report.baseUrl}`);
  print(`- Routes: ${report.routes.length}`);
  print(`- Themes: ${report.themes.join(', ')}`);
  print(`- Viewports: ${report.viewports.join(', ')}`);
  print(`- WCAG AA failure patterns on solid backgrounds: ${aaFailures.length}`);
  print(`- WCAG AA failing text occurrences: ${sumOccurrences(aaFailures)}`);
  print(`- WCAG AAA failure patterns on solid backgrounds: ${aaaFailures.length}`);
  print(`- Strict 9:1 miss patterns on solid backgrounds: ${strictNineMisses.length}`);
  print(`- Text patterns on image/gradient backgrounds requiring manual verification: ${complex.length}`);
  print(`- Route/render errors: ${errors.length}`);
  print();
  print('WCAG thresholds are 4.5:1 for normal text and 3:1 for large text at AA;');
  print('7:1 and 4.5:1 respectively at AAA. The 9:1 column is a custom project target.');
  print();
  print('| Standard | Route | Theme | Viewport | Ratio | Required | Count | Foreground | Background | Selector | Examples |');
  print('|---|---|---|---|---:|---:|---:|---|---|---|---|');

  const rows = flat
    .filter((finding) => !finding.complexBackground && failsSelectedStandard(finding, parsedOptions.standard))
    .sort((a, b) => a.ratio - b.ratio || a.route.localeCompare(b.route));
  for (const finding of rows) {
    const standard = parsedOptions.standard === '9' ? '9:1' : parsedOptions.standard.toUpperCase();
    const required = parsedOptions.standard === 'aa'
      ? finding.aaThreshold
      : parsedOptions.standard === 'aaa' ? finding.aaaThreshold : 9;
    print(`| ${standard} | ${escapeCell(finding.route)} | ${finding.theme} | ${finding.viewport} | ${finding.ratio}:1 | ${required}:1 | ${finding.occurrences} | ${finding.foreground} | ${finding.background} | \`${escapeCell(finding.selector)}\` | ${escapeCell(finding.textExamples.join(' · '))} |`);
  }

  if (parsedOptions.includeComplex && complex.length > 0) {
    print();
    print('## Manual verification queue');
    print();
    print('These samples intersect image or gradient backgrounds. The solid fallback ratio is not conclusive.');
    print();
    for (const finding of complex) {
      print(`- ${finding.route} · ${finding.theme} · ${finding.viewport} · \`${finding.selector}\` · ${finding.textExamples.join(' · ')}`);
    }
  }

  if (errors.length > 0) {
    print();
    print('## Route/render errors');
    print();
    for (const error of errors) {
      print(`- ${error.route} · ${error.theme} · ${error.viewport}: ${error.error || `HTTP ${error.status}`}`);
    }
  }

  if (parsedOptions.failOnAa) {
    print();
    print(`Exit policy: ${aaFailures.length > 0 ? 'failed' : 'passed'} (--fail-on-aa).`);
  }
  return `${lines.join('\n')}\n`;
}

function sumOccurrences(findings) {
  return findings.reduce((total, finding) => total + finding.occurrences, 0);
}

function failsSelectedStandard(finding, standard) {
  if (standard === 'aa') return !finding.passAa;
  if (standard === 'aaa') return !finding.passAaa;
  return !finding.passStrictNine;
}

function printOutput(value, outputPath) {
  if (outputPath) {
    writeFileSync(outputPath, value);
    console.log(`Wrote ${outputPath}`);
    return;
  }
  process.stdout.write(value);
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function printHelp() {
  console.log(`Usage: node scripts/audit-site-contrast.mjs [options]

Options:
  --base-url=<url>           Site to audit (default: ${DEFAULT_BASE_URL})
  --routes=/,/docs/          Skip crawling and audit only these routes
  --themes=light,dark|all    Themes to force before first paint (default: all)
  --viewports=desktop,mobile Viewports to test (default: all)
  --max-pages=<number>       Maximum same-origin pages discovered (default: 100)
  --format=markdown|json     Output format (default: markdown)
  --output=<path>            Write the report to a file instead of stdout
  --standard=aa|aaa|9        Findings listed in Markdown (default: aa)
  --include-complex          Include the image/gradient manual-review queue
  --fail-on-aa               Exit non-zero for verified solid-background AA failures
  --help                     Show this help

The scanner reports WCAG AA, WCAG AAA, and a separate custom 9:1 target.
Image and gradient backgrounds are queued for manual verification instead of
being treated as conclusive failures.`);
}
