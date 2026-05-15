#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createBrowserDetector,
  createDetectorProfile,
  detectHtml,
  detectText,
  detectUrl,
  summarizeDetectorProfile,
  walkDir,
} from '../cli/engine/detect-antipatterns.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'antipatterns');
const BROWSER_FIXTURES = [
  'cramped-padding.html',
  'quality.html',
  'body-text-viewport-edge.html',
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function parseArgs(argv) {
  const args = {
    browser: false,
    json: false,
    out: null,
    quick: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--browser') args.browser = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--quick') args.quick = true;
    else if (arg === '--out') args.out = argv[++i] || null;
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length);
    else if (arg === '--help') {
      printUsage();
      process.exit(0);
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/benchmark-detector.mjs [options]

Options:
  --quick     Run a small smoke benchmark subset
  --browser   Include browser-backed URL benchmarks
  --json      Print the benchmark report as JSON
  --out FILE  Write the benchmark report JSON to FILE
  --help      Show this help message`);
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now();
}

function roundMs(value) {
  return Number(value.toFixed(3));
}

function isHtml(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.html' || ext === '.htm';
}

function rel(filePath) {
  return path.relative(ROOT, filePath);
}

function addEvent(profile, event) {
  profile.events.push({
    engine: event.engine || 'unknown',
    phase: event.phase || 'unknown',
    ruleId: event.ruleId || 'unknown',
    target: event.target || '',
    ms: Number.isFinite(event.ms) ? event.ms : 0,
    findings: Number.isFinite(event.findings) ? event.findings : 0,
  });
}

async function measureCase({ name, engine, mode, target, run }) {
  const profile = createDetectorProfile();
  const started = nowMs();
  try {
    const result = await run(profile);
    const findings = Array.isArray(result)
      ? result.length
      : (Number.isFinite(result?.findings) ? result.findings : 0);
    return {
      name,
      engine,
      mode,
      target,
      status: 'ok',
      totalMs: roundMs(nowMs() - started),
      findings,
      profile: summarizeDetectorProfile(profile),
      events: profile.events,
    };
  } catch (err) {
    return {
      name,
      engine,
      mode,
      target,
      status: 'failed',
      totalMs: roundMs(nowMs() - started),
      findings: 0,
      error: err?.message || String(err),
      profile: summarizeDetectorProfile(profile),
      events: profile.events,
    };
  }
}

function skippedCase({ name, engine, mode, target, reason }) {
  return {
    name,
    engine,
    mode,
    target,
    status: 'skipped',
    totalMs: 0,
    findings: 0,
    skipReason: reason,
    profile: [],
    events: [],
  };
}

async function scanDirectory(files, fastMode, profile) {
  const findings = [];
  for (const file of files) {
    if (!fastMode && isHtml(file)) {
      findings.push(...await detectHtml(file, { profile }));
    } else {
      const content = fs.readFileSync(file, 'utf-8');
      findings.push(...detectText(content, file, { profile }));
    }
  }
  return findings;
}

function selectQuickFiles(files, predicate, preferredNames) {
  const preferred = preferredNames
    .map(name => files.find(file => path.basename(file) === name))
    .filter(Boolean);
  const fallback = files.filter(predicate).slice(0, preferredNames.length || 2);
  return preferred.length ? preferred : fallback;
}

async function runFileBenchmarks(args) {
  const files = walkDir(FIXTURES).sort();
  const htmlFiles = files.filter(isHtml);
  const textFiles = files.filter(file => !isHtml(file));
  const selectedText = args.quick
    ? textFiles.slice(0, 2)
    : textFiles;
  const selectedHtml = args.quick
    ? selectQuickFiles(htmlFiles, isHtml, ['color.html', 'quality.html'])
    : htmlFiles;
  const directoryFiles = args.quick
    ? [...selectedHtml, ...selectedText].sort()
    : files;

  const cases = [];
  for (const file of selectedText) {
    cases.push(await measureCase({
      name: `detectText:${rel(file)}`,
      engine: 'regex',
      mode: 'file',
      target: rel(file),
      run: (profile) => detectText(fs.readFileSync(file, 'utf-8'), file, { profile }),
    }));
  }

  for (const file of selectedHtml) {
    cases.push(await measureCase({
      name: `detectHtml:${rel(file)}`,
      engine: 'static-html',
      mode: 'file',
      target: rel(file),
      run: (profile) => detectHtml(file, { profile }),
    }));
  }

  cases.push(await measureCase({
    name: args.quick ? 'directory-default:quick-fixtures' : 'directory-default:all-fixtures',
    engine: 'mixed',
    mode: 'directory-default',
    target: rel(FIXTURES),
    run: (profile) => scanDirectory(directoryFiles, false, profile),
  }));

  cases.push(await measureCase({
    name: args.quick ? 'directory-fast:quick-fixtures' : 'directory-fast:all-fixtures',
    engine: 'regex',
    mode: 'directory-fast',
    target: rel(FIXTURES),
    run: (profile) => scanDirectory(directoryFiles, true, profile),
  }));

  return cases;
}

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    let filePath;
    const urlPath = req.url?.split('?')[0] || '/';
    if (urlPath.startsWith('/fixtures/')) {
      filePath = path.join(ROOT, 'tests', urlPath);
    } else if (urlPath === '/js/detect-antipatterns-browser.js') {
      filePath = path.join(ROOT, 'cli', 'engine', 'detect-antipatterns-browser.js');
    } else {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

async function closeServer(server) {
  await new Promise(resolve => server.close(resolve));
}

async function runBrowserBenchmarks(args) {
  let serverInfo;
  try {
    serverInfo = await startFixtureServer();
  } catch (err) {
    return [
      skippedCase({
        name: 'browser:fixtures',
        engine: 'browser',
        mode: 'browser',
        target: 'localhost',
        reason: `localhost fixture server unavailable: ${err?.message || err}`,
      }),
    ];
  }

  const cases = [];
  const browserFiles = args.quick ? ['quality.html'] : BROWSER_FIXTURES;

  try {
    for (const fileName of browserFiles) {
      const url = `${serverInfo.baseUrl}/fixtures/antipatterns/${fileName}`;
      const fresh = await measureCase({
        name: `detectUrl:fresh-load:${fileName}`,
        engine: 'browser',
        mode: 'fresh-load',
        target: url,
        run: (profile) => detectUrl(url, { profile, waitUntil: 'load', settleMs: 100 }),
      });
      if (fresh.status === 'failed' && /Could not find Chrome|Failed to launch|executable|spawn|puppeteer/i.test(fresh.error || '')) {
        cases.push(skippedCase({
          name: `detectUrl:fresh-load:${fileName}`,
          engine: 'browser',
          mode: 'fresh-load',
          target: url,
          reason: `Chromium unavailable: ${fresh.error}`,
        }));
      } else {
        cases.push(fresh);
      }
    }

    const visualContrastUrl = `${serverInfo.baseUrl}/fixtures/antipatterns/visual-contrast.html`;
    cases.push(await measureCase({
      name: 'detectUrl:visual-contrast',
      engine: 'browser',
      mode: 'visual-contrast',
      target: visualContrastUrl,
      run: (profile) => detectUrl(visualContrastUrl, {
        profile,
        waitUntil: 'load',
        settleMs: 0,
        visualContrast: true,
      }),
    }));

    cases.push(await measureCase({
      name: 'detectUrl:warm-load',
      engine: 'browser',
      mode: 'warm-load',
      target: serverInfo.baseUrl,
      run: async (profile) => {
        const detector = await createBrowserDetector({ waitUntil: 'load', settleMs: 100 });
        const findings = [];
        try {
          for (const fileName of browserFiles) {
            const url = `${serverInfo.baseUrl}/fixtures/antipatterns/${fileName}`;
            findings.push(...await detector.detectUrl(url, { profile }));
          }
        } finally {
          await detector.close();
        }
        return findings;
      },
    }));

    cases.push(await measureCase({
      name: 'detectUrl:warm-networkidle0',
      engine: 'browser',
      mode: 'warm-networkidle0',
      target: serverInfo.baseUrl,
      run: async (profile) => {
        const detector = await createBrowserDetector({ waitUntil: 'load', settleMs: 100 });
        const findings = [];
        try {
          for (const fileName of browserFiles) {
            const url = `${serverInfo.baseUrl}/fixtures/antipatterns/${fileName}`;
            findings.push(...await detector.detectUrl(url, {
              profile,
              waitUntil: 'networkidle0',
              settleMs: 0,
            }));
          }
        } finally {
          await detector.close();
        }
        return findings;
      },
    }));

    let puppeteer;
    try {
      puppeteer = await import('puppeteer');
    } catch (err) {
      cases.push(skippedCase({
        name: 'browser:pure-vs-overlay',
        engine: 'browser',
        mode: 'pure-vs-overlay',
        target: serverInfo.baseUrl,
        reason: `puppeteer unavailable: ${err?.message || err}`,
      }));
      return cases;
    }

    cases.push(await measureCase({
      name: 'browser:pure-vs-overlay',
      engine: 'browser',
      mode: 'pure-vs-overlay',
      target: serverInfo.baseUrl,
      run: async (profile) => {
        let browser;
        const launchStarted = nowMs();
        try {
          browser = await puppeteer.default.launch({
            headless: true,
            args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
          });
          addEvent(profile, {
            engine: 'browser',
            phase: 'load',
            ruleId: 'launch-browser-overlay-bench',
            target: serverInfo.baseUrl,
            ms: nowMs() - launchStarted,
          });
        } catch (err) {
          throw new Error(`Chromium unavailable: ${err?.message || err}`);
        }

        let findings = [];
        try {
          const page = await browser.newPage();
          const url = `${serverInfo.baseUrl}/fixtures/antipatterns/${browserFiles[0]}`;
          const browserScript = fs.readFileSync(path.join(ROOT, 'cli', 'engine', 'detect-antipatterns-browser.js'), 'utf-8');
          await page.setViewport({ width: 1280, height: 800 });
          await page.goto(url, { waitUntil: 'load', timeout: 30000 });
          await new Promise(resolve => setTimeout(resolve, 100));
          await page.evaluate(() => { window.__IMPECCABLE_CONFIG__ = { autoScan: false }; });
          await page.evaluate(browserScript);
          const pureStarted = nowMs();
          findings = await page.evaluate(() => {
            const serialized = window.impeccableDetect({ decorate: false, serialize: true });
            return serialized.flatMap(({ findings }) => findings.map(f => ({ id: f.type, snippet: f.detail })));
          });
          addEvent(profile, {
            engine: 'browser',
            phase: 'scan',
            ruleId: 'pure-detect',
            target: url,
            ms: nowMs() - pureStarted,
            findings: findings.length,
          });
          const overlayStarted = nowMs();
          const overlayGroupCount = await page.evaluate(() => window.impeccableScan().length);
          addEvent(profile, {
            engine: 'browser',
            phase: 'scan',
            ruleId: 'overlay-scan',
            target: url,
            ms: nowMs() - overlayStarted,
            findings: overlayGroupCount,
          });
          await page.close().catch(() => {});
        } finally {
          const closeStarted = nowMs();
          await browser.close().catch(() => {});
          addEvent(profile, {
            engine: 'browser',
            phase: 'load',
            ruleId: 'close-browser-overlay-bench',
            target: serverInfo.baseUrl,
            ms: nowMs() - closeStarted,
          });
        }
        return findings;
      },
    }));
  } finally {
    await closeServer(serverInfo.server);
  }

  return cases.map(testCase => {
    if (testCase.engine === 'browser' && testCase.status === 'failed' && /Chromium unavailable|Failed to launch|Could not find Chrome|executable|spawn|puppeteer/i.test(testCase.error || '')) {
      return skippedCase({
        name: testCase.name,
        engine: testCase.engine,
        mode: testCase.mode,
        target: testCase.target,
        reason: testCase.error,
      });
    }
    return testCase;
  });
}

function aggregateEvents(cases) {
  const profile = createDetectorProfile();
  for (const testCase of cases) {
    if (Array.isArray(testCase.events)) profile.events.push(...testCase.events);
  }
  return summarizeDetectorProfile(profile);
}

function makeReport(args, cases) {
  const summary = aggregateEvents(cases);
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    cwd: ROOT,
    quick: args.quick,
    browser: args.browser,
    cases: cases.map(({ events, ...testCase }) => testCase),
    summary,
  };
}

function pad(value, width) {
  const str = String(value);
  if (str.length >= width) return str.slice(0, width);
  return str + ' '.repeat(width - str.length);
}

function printRows(rows, columns) {
  const header = columns.map(col => pad(col.label, col.width)).join('  ');
  console.log(header);
  console.log(columns.map(col => '-'.repeat(col.width)).join('  '));
  for (const row of rows) {
    console.log(columns.map(col => pad(row[col.key] ?? '', col.width)).join('  '));
  }
}

function printConsoleReport(report) {
  console.log(`Detector benchmark ${report.quick ? '(quick)' : '(full)'}`);
  console.log(`Cases: ${report.cases.length}`);
  const caseRows = report.cases.map(testCase => ({
    status: testCase.status,
    engine: testCase.engine,
    mode: testCase.mode,
    totalMs: testCase.totalMs,
    findings: testCase.findings,
    target: testCase.target,
  }));
  printRows(caseRows, [
    { key: 'status', label: 'Status', width: 8 },
    { key: 'engine', label: 'Engine', width: 12 },
    { key: 'mode', label: 'Mode', width: 20 },
    { key: 'totalMs', label: 'Total ms', width: 10 },
    { key: 'findings', label: 'Findings', width: 8 },
    { key: 'target', label: 'Target', width: 60 },
  ]);

  const skipped = report.cases.filter(testCase => testCase.status === 'skipped');
  for (const testCase of skipped) {
    console.log(`Skipped ${testCase.name}: ${testCase.skipReason}`);
  }

  console.log('\nSlowest profile groups');
  const slowRows = report.summary.slice(0, 20).map(item => ({
    engine: item.engine,
    phase: item.phase,
    ruleId: item.ruleId,
    calls: item.calls,
    totalMs: item.totalMs,
    avgMs: item.avgMs,
    p95: item.p95,
    findings: item.findings,
    target: item.target,
  }));
  printRows(slowRows, [
    { key: 'engine', label: 'Engine', width: 12 },
    { key: 'phase', label: 'Phase', width: 14 },
    { key: 'ruleId', label: 'Rule', width: 28 },
    { key: 'calls', label: 'Calls', width: 8 },
    { key: 'totalMs', label: 'Total ms', width: 10 },
    { key: 'avgMs', label: 'Avg ms', width: 8 },
    { key: 'p95', label: 'P95', width: 8 },
    { key: 'findings', label: 'Finds', width: 7 },
    { key: 'target', label: 'Target', width: 45 },
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cases = [
    ...await runFileBenchmarks(args),
  ];
  if (args.browser) {
    cases.push(...await runBrowserBenchmarks(args));
  }

  const report = makeReport(args, cases);
  const json = JSON.stringify(report, null, 2);
  if (args.out) {
    fs.writeFileSync(path.resolve(args.out), json + '\n');
  }
  if (args.json) {
    process.stdout.write(json + '\n');
  } else {
    printConsoleReport(report);
    if (args.out) console.log(`\nWrote JSON report to ${path.resolve(args.out)}`);
  }

  if (report.cases.some(testCase => testCase.status === 'failed')) {
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
