// Opt-in integration check. Requires the bundled detector, Puppeteer Chrome, and Firefox.
import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'));
await fs.mkdir('build/929', {recursive:true});
const html = await fs.readFile('tests/fixtures/antipatterns/hard-offset-shadow.html', 'utf8');
const bundle = await fs.readFile('dist/detect-antipatterns-browser.js');
const assets = new Map([
  ['/', ['text/html', html]],
  ['/detector.js', ['text/javascript', bundle]],
]);
for (const file of ['devtools/panel.html', 'devtools/panel.js', 'devtools/panel.css', 'shared/kinpaku.css', 'detector/antipatterns.json']) {
  const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/html';
  assets.set('/' + file, [type, await fs.readFile('extension/' + file)]);
}
const server = http.createServer((req,res) => {
  const asset = assets.get(req.url);
  if (!asset) { res.writeHead(404); res.end(); return; }
  res.setHeader('content-type', asset[0]);
  res.end(asset[1]);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
server.unref();
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];
for (const browserName of ['chrome', 'firefox']) {
  const browser = await puppeteer.launch({browser: browserName, headless: true, timeout: 60000,
    ...(browserName === 'firefox' ? {executablePath: process.env.FIREFOX_PATH || '/Applications/Firefox.app/Contents/MacOS/firefox'} : {})});
  try {
    const page = await browser.newPage();
    page.on("pageerror", e => console.log("PAGE ERROR", browserName, e.message));
    page.on("console", m => {if(m.type()==="error") console.log("CONSOLE", m.text());});
    await page.setViewport({width: 1280, height: 1800});
    await page.goto(base);
    await page.evaluate(() => {document.documentElement.dataset.impeccableExtension = 'true';});
    await page.addScriptTag({url:base+'/detector.js'});
    await page.waitForFunction(() => typeof window.impeccableDetect === 'function');
    const rows = await page.evaluate(() => window.impeccableDetect());
    const hits = rows.flatMap(g => g.findings || []).filter(f => (f.type || f.id) === 'hard-offset-shadow');
    if (hits.length !== 4) console.log(JSON.stringify(rows));
    assert.equal(hits.length, 4);
    assert.ok(hits.every(f => f.severity === 'advisory' && f.advisory === true));
    const repeat = await page.evaluate(() => window.impeccableDetect());
    assert.equal(repeat.flatMap(g => g.findings || []).filter(f => f.type === 'hard-offset-shadow').length, 4);
    await page.evaluate(() => {window.__IMPECCABLE_CONFIG__ = {disabledRules: ['hard-offset-shadow']};});
    const muted = await page.evaluate(() => window.impeccableDetect());
    assert.equal(muted.flatMap(g => g.findings || []).filter(f => (f.type || f.id) === 'hard-offset-shadow').length, 0);
    await page.evaluate(() => {window.__IMPECCABLE_CONFIG__ = {};});
    const restored = await page.evaluate(() => window.impeccableDetect());
    assert.equal(restored.flatMap(g => g.findings || []).filter(f => f.type === 'hard-offset-shadow').length, 4);
    await page.screenshot({path:`build/929/${browserName}-fixture.png`, fullPage:true});
    // Render the shipped DevTools page with real WASM findings. The Chrome
    // extension APIs are stubbed here, so this complements packaged E2E checks.
    const panel = await browser.newPage();
    await panel.evaluateOnNewDocument(() => {
      window.chrome = {
        devtools: {
          panels: { themeName: 'light' },
          inspectedWindow: { tabId: 1, eval: (_code, callback) => callback('https://example.test/') },
        },
        runtime: {
          getURL: path => '/' + path,
          connect: () => ({
            onMessage: { addListener(callback) { window.deliverFindings = callback; } },
            onDisconnect: { addListener() {} }, postMessage() {},
          }),
          sendMessage() {},
        },
        storage: { sync: { get: async defaults => defaults, set: async () => {} } },
      };
      Object.defineProperty(navigator, 'clipboard', { value: {
        writeText: async text => { window.copiedReport = text; },
      }});
    });
    await panel.setViewport({ width: 650, height: 900 });
    await panel.goto(base + '/devtools/panel.html');
    await panel.waitForSelector('.setting-rule');
    const shadowRows = rows.map(row => ({ ...row, findings: row.findings.filter(f => f.type === 'hard-offset-shadow') })).filter(row => row.findings.length);
    await panel.evaluate(findings => window.deliverFindings({ action: 'findings', findings }), shadowRows);
    assert.deepEqual(await panel.$$eval('.category-name', els => els.map(el => el.textContent)), ['Advisories']);
    assert.equal(await panel.$eval('#badge', el => el.textContent), '4');
    assert.equal(await panel.$$eval('.category-advisory .finding-item', els => els.length), 4);
    await panel.click('#btn-copy-all');
    await panel.waitForFunction(() => window.copiedReport);
    const report = await panel.evaluate(() => window.copiedReport);
    assert.match(report, /## Advisories \(4\)/);
    assert.doesNotMatch(report, /AI tells|Suggested Impeccable skills to fix|\/polish/);
    await panel.evaluate(() => { window.copiedReport = ''; });
    await panel.hover('.finding-item');
    await panel.click('.finding-copy');
    await panel.waitForFunction(() => window.copiedReport);
    assert.doesNotMatch(await panel.evaluate(() => window.copiedReport), /Suggested Impeccable skill|\/polish/);
    await panel.screenshot({ path: `build/929/${browserName}-advisory-panel.png` });
    await panel.click('#btn-settings');
    const advisoryRules = await panel.evaluate(() => {
      const header = [...document.querySelectorAll('.settings-header')].find(el => el.textContent === 'Advisories');
      return header ? header.nextElementSibling.textContent : '';
    });
    assert.match(advisoryRules, /Hard offset shadow/i);
    results.push({browser: await browser.version(), hardOffsetFindings:hits.length, disabledFindings:0, devtoolsGroup: 'Advisories', report, hits});
  } finally {await browser.close();}
}
await fs.writeFile('build/929/browser-results.json', JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
