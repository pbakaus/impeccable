
/* Plan 6 capture script. Boots the real picker for the hanazono-atelier
   project, walks the questionnaire, and writes ground truth for the previews
   gallery: per-screen section HTML, verbatim stylesheets with every url()
   resource inlined as a data URI, measured stage boxes, and one reference
   screenshot per cell. It writes ONLY capture.json and refs/*.png inside
   tmp/questionaire/. It never submits the picker form and it kills only the
   server it spawned. */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { CELL_LIST, SECTIONS, VIEWPORT, refName } from './gallery-cells.mjs';

const SERVER = '/Users/abdulwahab/impeccable/skill/scripts/picker-server.mjs';
const PROJECT = '/Users/abdulwahab/hanazono-atelier';
const OUT_DIR = '/Users/abdulwahab/impeccable/tmp/questionaire';
const REFS_DIR = OUT_DIR + '/refs';

function startServer() {
  const child = spawn('node', [SERVER], { cwd: PROJECT, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('picker-server did not print PICKER_URL within 30s')), 30000);
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      const match = buffer.match(/PICKER_URL\s+(\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.on('exit', (code) => reject(new Error('picker-server exited early (code ' + code + ')')));
  });
  return { child, url };
}

async function fetchDataUri(absoluteUrl) {
  const res = await fetch(absoluteUrl);
  if (!res.ok) throw new Error('resource fetch failed: ' + absoluteUrl + ' (' + res.status + ')');
  const mime = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  return 'data:' + mime + ';base64,' + buf.toString('base64');
}

/* Rewrite every url(...) in a stylesheet to a data URI so the gallery makes
   zero network requests. data: and fragment references are left alone. */
async function inlineUrls(cssText, baseUrl) {
  const refs = [...new Set(
    [...cssText.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)].map((m) => m[2]),
  )].filter((u) => !u.startsWith('data:') && !u.startsWith('#'));
  let out = cssText;
  for (const ref of refs) {
    const dataUri = await fetchDataUri(new URL(ref, baseUrl).href);
    for (const quoted of ['url(' + ref + ')', "url('" + ref + "')", 'url("' + ref + '")']) {
      out = out.split(quoted).join('url(' + dataUri + ')');
    }
  }
  return out;
}

async function main() {
  await mkdir(REFS_DIR, { recursive: true });
  const { child, url: urlPromise } = startServer();
  process.on('exit', () => { try { child.kill(); } catch {} });
  const pickerUrl = await urlPromise;
  console.log('picker at', pickerUrl);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  const capture = { viewport: VIEWPORT, pickerUrl, capturedAt: new Date().toISOString(), sections: {} };

  try {
    await page.goto(pickerUrl);
    await page.waitForSelector('.picker-screen[data-screen="01"][data-active]');

    const gotoScreen = async (id) => {
      await page.evaluate((screen) => {
        document.dispatchEvent(new CustomEvent('picker:goto', { detail: { screen } }));
      }, id);
      await page.waitForSelector('.picker-screen[data-screen="' + id + '"][data-active]');
      await page.waitForTimeout(400);
    };
    const sectionHtml = (id) => page.evaluate(
      (screen) => document.querySelector('.picker-screen[data-screen="' + screen + '"]').outerHTML, id);
    const dimsOf = (selector) => page.evaluate((q) => {
      const el = document.querySelector(q);
      if (!el) throw new Error('missing stage: ' + q);
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    }, selector);
    const setSurfaces = (values) => page.evaluate((wanted) => {
      for (const input of document.querySelectorAll('input[name="surface-modes"]')) {
        if (input.checked !== wanted.includes(input.value)) input.click();
      }
    }, values);
    const clickRadio = (group, value) => page.evaluate(([g, v]) => {
      const input = document.querySelector('input[name="' + g + '"][value="' + v + '"]');
      if (!input) throw new Error('missing radio ' + g + '=' + v);
      input.click();
    }, [group, value]);
    const clickTab = (screen, surface) => page.evaluate(([s, mode]) => {
      const tab = document.querySelector('.picker-screen[data-screen="' + s + '"] [data-surface-tab="' + mode + '"]');
      if (!tab) throw new Error('missing surface tab ' + mode + ' on screen ' + s);
      tab.click();
    }, [screen, surface]);
    const applyFormState = (formState) => page.evaluate((state) => {
      for (const [group, value] of Object.entries(state)) {
        const input = document.querySelector('input[name="' + group + '"][value="' + value + '"]');
        if (input && !input.checked) input.click();
      }
    }, formState);
    const neutralizeLiveImages = () => page.evaluate(() => {
      const blank = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
      for (const img of document.querySelectorAll('img')) img.src = blank;
    });
    const shoot = async (screen, stageSelector, file) => {
      await neutralizeLiveImages();
      const selector = '.picker-screen[data-screen="' + screen + '"] ' + stageSelector;
      await page.locator(selector).first().screenshot({ path: REFS_DIR + '/' + file });
    };
    const bySection = (id) => SECTIONS.find((s) => s.id === id);
    const cellsOf = (id) => CELL_LIST.filter((c) => c.section === id);

    /* ---- Screen 01b: all four surfaces on, capture section + tile refs. */
    await gotoScreen('01b');
    await setSurfaces(['persuade', 'operate', 'read', 'experience']);
    await page.waitForTimeout(300);
    capture.sections.surfaces = {
      screen: '01b',
      stageSelector: bySection('surfaces').stageSelector,
      dims: await dimsOf('.picker-screen[data-screen="01b"] .picker-modes-grid .picker-mode-tile'),
      sectionHtml: await sectionHtml('01b'),
    };
    for (const cell of cellsOf('surfaces')) {
      await shoot('01b', '.picker-modes-grid .picker-mode-tile:nth-of-type(' + cell.tileIndex + ')', refName(cell));
    }
    console.log('captured surfaces');

    /* ---- Screen 02: one visit per surface so the panel preview is that
       surface's drawing. The deck rests on the first cue card (zinc-dawn). */
    capture.sections.palette = {
      screen: '02',
      stageSelector: bySection('palette').stageSelector,
      dims: null,
      variants: {},
    };
    for (const cell of cellsOf('palette')) {
      await gotoScreen('01b');
      await setSurfaces([cell.surface]);
      await page.waitForTimeout(300);
      await gotoScreen('02');
      await page.waitForSelector('.picker-card-layer .picker-card');
      await page.waitForSelector('[data-select-palette]:not([disabled])');
      await page.waitForTimeout(400);
      capture.sections.palette.variants[cell.surface] = await sectionHtml('02');
      if (!capture.sections.palette.dims) {
        capture.sections.palette.dims = await dimsOf('.picker-screen[data-screen="02"] .picker-palette-panel .picker-preview');
      }
      await shoot('02', '.picker-palette-panel .picker-preview', refName(cell));
    }
    console.log('captured palette');

    /* ---- Restore all four surfaces, then commit the palette. Clicking the
       select button advances to screen 03; it does not submit the form. */
    await gotoScreen('01b');
    await setSurfaces(['persuade', 'operate', 'read', 'experience']);
    await page.waitForTimeout(300);
    await gotoScreen('02');
    await page.waitForSelector('[data-select-palette]:not([disabled])');
    await page.click('[data-select-palette]');
    await page.waitForSelector('.picker-screen[data-screen="03"][data-active]');
    await page.waitForSelector('.picker-strategy-stage > .picker-preview[data-surface="persuade"]');
    await page.waitForTimeout(500);

    /* ---- Stylesheets, verbatim and in document order, captured once. */
    const rawCss = await page.evaluate(async () => {
      const out = [];
      for (const sheet of document.styleSheets) {
        if (sheet.href) {
          const text = await fetch(sheet.href).then((r) => {
            if (!r.ok) throw new Error('css fetch failed: ' + sheet.href);
            return r.text();
          });
          out.push({ from: sheet.href, text });
        } else if (sheet.ownerNode && sheet.ownerNode.textContent) {
          out.push({ from: 'inline', text: sheet.ownerNode.textContent });
        }
      }
      return out;
    });
    capture.cssSources = [];
    for (const source of rawCss) {
      const base = source.from === 'inline' ? pickerUrl : source.from;
      capture.cssSources.push({ from: source.from, text: await inlineUrls(source.text, base) });
    }
    capture.foilDataUri = await fetchDataUri(new URL('/assets/kinpaku-gold-leaf.jpg', pickerUrl).href);
    console.log('captured ' + capture.cssSources.length + ' stylesheets');

    /* ---- The tab strips stay visible: dims and reference screenshots are
       taken on each section's preview element (previewSelector), which sits in
       the stage row below the strip and never contains it. Hiding the strip
       before measuring is what plan 6 got wrong: on screens 03 and 04 the
       collapsed tab row hands its height to the preview, which then measures
       taller than anything a visitor ever sees. */
    await page.evaluate(() => {
      const blank = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
      for (const img of document.querySelectorAll('img')) img.src = blank;
    });

    /* ---- Screens 03 through 10: capture the section once on arrival, then
       per cell open the surface tab, click the option, settle, screenshot. */
    for (const sectionId of ['strategy', 'font-pair', 'motion', 'layout', 'boundaries', 'corners', 'depth']) {
      const section = bySection(sectionId);
      await gotoScreen(section.screen);
      if (sectionId === 'font-pair') {
        await page.waitForSelector('input[name="font-pair"]');
        await page.evaluate(() => document.fonts.ready);
      }
      await page.waitForTimeout(600);
      const measureSelector = section.previewSelector || section.stageSelector;
      capture.sections[sectionId] = {
        screen: section.screen,
        stageSelector: section.stageSelector,
        dims: await dimsOf('.picker-screen[data-screen="' + section.screen + '"] ' + measureSelector),
        sectionHtml: await sectionHtml(section.screen),
      };
      for (const cell of cellsOf(sectionId)) {
        await clickTab(section.screen, cell.surface);
        await applyFormState(cell.formState);
        await page.waitForTimeout(sectionId === 'motion' ? 700 : 350);
        await shoot(section.screen, measureSelector, refName(cell));
      }
      console.log('captured ' + sectionId);
    }

    /* Screen 11 (iconography) left the gallery when its section left
       gallery-cells.mjs; capturing it here read a section that no longer
       exists and crashed the walk before capture.json was written. */
    await writeFile(OUT_DIR + '/capture.json', JSON.stringify(capture));
    console.log('wrote capture.json; sections: ' + Object.keys(capture.sections).join(', '));
    console.log('refs written: ' + CELL_LIST.length);
  } finally {
    await browser.close();
    child.kill();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });