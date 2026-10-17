import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { engineEnv, findEngineBinary, ENGINE_MISSING_MESSAGE } from './lib/engine-bin.mjs';

const engine = findEngineBinary();
let browser;
before(async () => {
  assert.ok(engine, ENGINE_MISSING_MESSAGE);
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

function run(cwd, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(engine, args, {
      cwd, env: engineEnv(engine, { IMPECCABLE_QUESTION_FORCE: '1' }), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(out) : reject(new Error(`${args[0]} exited ${code}: ${out} ${err}`)));
  });
}

async function screenshot(page, name) {
  const dir = process.env.IMPECCABLE_REVIEW_SCREENSHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true, animations: 'disabled' });
}

// Exclude rounded borders and overlaid chrome from the inspected image's pixels.
async function pixels(page, art, bottomInset = 52) {
  const box = await art.boundingBox();
  return page.screenshot({ clip: { x: box.x + 12, y: box.y + 12, width: box.width - 24, height: box.height - bottomInset }, animations: 'disabled' });
}

async function samePixels(page, before, after) {
  const equal = await page.evaluate(async ([a, b]) => {
    const decode = async value => {
      const img = new Image();
      img.src = `data:image/png;base64,${value}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return { width: img.width, height: img.height, pixels: ctx.getImageData(0, 0, img.width, img.height).data };
    };
    const [x, y] = await Promise.all([decode(a), decode(b)]);
    // Chromium can dither the same CSS gradient one sRGB level differently after recompositing.
    return x.width === y.width && x.height === y.height && x.pixels.every((v, i) => Math.abs(v - y.pixels[i]) <= 1);
  }, [before.toString('base64'), after.toString('base64')]);
  assert.ok(equal, 'artwork and its background must stay identical within one sRGB rounding level');
}

async function image(cwd) {
  const page = await browser.newPage();
  try {
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 400;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#b95437'; ctx.fillRect(80, 80, 180, 240);
      ctx.fillStyle = '#2c8176'; ctx.fillRect(300, 80, 260, 100);
      ctx.fillStyle = '#e4bc54'; ctx.fillRect(300, 220, 260, 100);
      return canvas.toDataURL().split(',')[1];
    });
    writeFileSync(path.join(cwd, 'sample.png'), Buffer.from(png, 'base64'));
  } finally { await page.close(); }
}

async function appearance(page, selector) {
  return page.locator(selector).evaluate(el => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, color: style.color, scheme: style.colorScheme };
  });
}

async function readableText(page, selector, backgroundSelector) {
  const ratio = await page.locator(selector).evaluate((el, bgSelector) => {
    const ctx = document.createElement('canvas').getContext('2d');
    const luminance = color => {
      ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const root = el.getRootNode();
    const fg = luminance(getComputedStyle(el).color);
    const bg = luminance(getComputedStyle(root.querySelector(bgSelector)).backgroundColor);
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  }, backgroundSelector);
  assert.ok(ratio >= 4.5, `${selector} contrast ${ratio.toFixed(2)} must reach 4.5:1`);
}

async function readablePressedButton(page, selector, name) {
  const button = page.locator(selector);
  const settle = () => button.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
  await settle();
  await readableText(page, selector, selector);
  await button.hover();
  await settle();
  await readableText(page, selector, selector);
  await page.mouse.down();
  try {
    assert.ok(await button.evaluate(el => el.matches(':active')), `${selector} is held down`);
    await settle();
    await screenshot(page, `${name}-pressed`);
    await readableText(page, selector, selector);
  } finally {
    // Release outside the button so inspecting its pressed state does not submit a decision.
    await page.mouse.move(0, 0);
    await page.mouse.up();
  }
}

// Switch the emulated scheme and wait for the colour transitions it starts:
// a control's text can flip at once while its fill is still fading, and a
// contrast read mid-fade measures neither scheme. Only transitions count:
// a pending placeholder's looping animation never finishes.
async function setScheme(page, colorScheme) {
  await page.emulateMedia({ colorScheme });
  await page.waitForFunction(() => document.getAnimations().every(a => !(a instanceof CSSTransition) || a.playState !== 'running'), null, { timeout: 5000 });
}

async function waitForExit(pid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await delay(20);
  }
  throw new Error(`Review server ${pid} did not stop`);
}

test('picker follows live OS changes while comp pixels and their background stay fixed', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'review-theme-picker-'));
  const key = 'theme';
  let serverPid;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' });
  try {
    await image(cwd);
    writeFileSync(path.join(cwd, 'question.json'), JSON.stringify({
      title: 'Choose a direction', question: 'Compare the artwork on its own background.',
      options: [
        { id: 'sample', kind: 'assigned', label: 'Review sample', hero: path.join(cwd, 'sample.png') },
        { id: 'sketch', kind: 'dealt', label: 'Transparent sketch', html: 'sketch.html' },
      ],
      steer: true, reroll: true, buildPath: { value: 'code', toggle: true },
    }));
    const started = await run(cwd, 'serve-question', '--start', '--payload', 'question.json', '--no-open', '--key', key);
    const url = started.match(/QUESTION URL: (\S+)/)?.[1];
    assert.ok(url, started);
    serverPid = JSON.parse(readFileSync(path.join(cwd, '.impeccable', 'questions', `${key}.state.json`))).pid;
    // Keep the sketch static: its own media queries also react to emulation on the original light-only picker.
    writeFileSync(path.join(cwd, 'sketch.html'), '<!doctype html><style>:root{color-scheme:light}body{margin:0}div{margin:120px;width:340px;height:220px;background:#2c8176}</style><div></div>');
    await page.goto(url);
    const art = page.locator('.media > img').first();
    await art.evaluate(img => img.decode());
    const sketch = page.locator('.media.html:not(.html-pending)');
    await sketch.waitFor();
    const light = await appearance(page, 'body');
    const lightArt = await pixels(page, art);
    const lightSketch = await pixels(page, sketch, 80);
    await screenshot(page, 'picker-light-desktop');
    await setScheme(page, 'dark');
    const dark = await appearance(page, 'body');
    await screenshot(page, 'picker-dark-desktop');
    assert.notEqual(dark.background, light.background);
    assert.equal(dark.scheme, 'dark');
    await readableText(page, '.question', 'body');
    await readableText(page, '.card[data-id="sample"] .face.front h2', '.card[data-id="sample"] .face.front');
    await readableText(page, '.card[data-id="sample"] button.choose', '.card[data-id="sample"] button.choose');
    // The primary action keeps its shape on the dark card, not one fill step off it.
    const fills = await page.locator('.card[data-id="sample"] .face.front').evaluate(face => {
      const ctx = document.createElement('canvas').getContext('2d');
      const lum = color => {
        ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
          .map(v => v / 255).map(s => s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4)
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      };
      const a = lum(getComputedStyle(face.querySelector('button.choose')).backgroundColor);
      const b = lum(getComputedStyle(face).backgroundColor);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    assert.ok(fills >= 3, `dark primary button fill contrast ${fills.toFixed(2)} against its card must reach 3:1`);
    await samePixels(page, lightArt, await pixels(page, art));
    await samePixels(page, lightSketch, await pixels(page, sketch, 80));
    await art.click();
    await page.locator('#lightbox.open').waitFor();
    const darkLightbox = await appearance(page, '#lightbox');
    const lightboxArt = await pixels(page, page.locator('#lightbox img'));
    await screenshot(page, 'picker-dark-lightbox');
    await setScheme(page, 'light');
    assert.notEqual((await appearance(page, '#lightbox')).background, darkLightbox.background);
    await samePixels(page, lightboxArt, await pixels(page, page.locator('#lightbox img')));
    await page.keyboard.press('Escape');
    await page.locator('#lightbox[hidden]').waitFor({ state: 'attached' });
    await setScheme(page, 'dark');
    await page.locator('.bp-opt[data-bp="comp"]').click();
    await page.getByRole('dialog').waitFor();
    assert.equal((await appearance(page, '.bp-confirm-panel')).scheme, 'dark');
    await screenshot(page, 'picker-dark-confirm');
    await page.keyboard.press('Escape');
    await page.locator('#steer').focus();
    assert.notEqual(await page.locator('#steer').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, null, { timeout: 5000 });
    await screenshot(page, 'picker-dark-mobile');
    await page.locator('.choose').first().click();
    await page.locator('.done').waitFor();
    assert.equal((await appearance(page, 'body')).scheme, 'dark');
  } finally {
    await page.close();
    await run(cwd, 'serve-question', '--stop', '--key', key);
    if (serverPid) await waitForExit(serverPid);
    rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

async function componentServer(cwd, manifest) {
  const store = path.join(cwd, 'store');
  const project = path.join(cwd, 'project');
  mkdirSync(project);
  await image(project);
  const spec = JSON.stringify({ comp: 'sample.png', compSize: { width: 640, height: 400 }, regions: manifest.components.map(c => ({ id: c.id, kind: c.kind, box: c.box, plate: 'sample.png', note: c.note })) });
  mkdirSync(path.join(project, '.impeccable', 'build'), { recursive: true });
  writeFileSync(path.join(project, '.impeccable', 'build', 'spec.json'), spec);
  if (manifest.schemaVersion === 3) manifest.specSha256 = createHash('sha256').update(spec).digest('hex');
  writeFileSync(path.join(project, 'preview.html'), '<!doctype html><style>:root{color-scheme:light}body{margin:0;background:#eee;color:#222}</style><p>Preview</p>');
  writeFileSync(path.join(project, 'review.json'), JSON.stringify(manifest));
  const prepared = JSON.parse(await run(project, 'component-review', 'prepare', '--manifest', 'review.json', '--store', store));
  const child = spawn(engine, ['component-review', 'serve', '--session', prepared.session, '--store', store, '--port', '0', '--idle-timeout', '60'], {
    cwd: project, env: engineEnv(engine, { IMPECCABLE_QUESTION_FORCE: '1' }), stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Review server did not start: ${output}`)); }, 15000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/COMPONENT REVIEW: (\{[^\n]+\})/);
      if (match) { clearTimeout(timer); resolve(JSON.parse(match[1]).url); }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Review server exited ${code}: ${output}`)); });
  });
  return { url, child };
}

for (const kind of ['component', 'plan', 'page']) {
  const plan = kind === 'plan';
  test(`${kind} review follows OS chrome and preserves preview pixels`, async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'review-theme-components-'));
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' });
    let child;
    try {
      const manifest = {
        schemaVersion: plan ? 3 : 1, id: 'theme-review', stage: kind === 'page' ? 'hero' : 'components', title: 'Theme review',
        comp: { path: 'sample.png', width: 640, height: 400, background: '#e8d8b8' },
        components: [{ id: 'art', name: 'Review sample', kind: 'image', role: 'asset', medium: 'Raster', note: 'Transparent sample',
          box: { x: 0, y: 0, w: 1, h: 1 }, preview: { kind: 'image', path: 'sample.png' }, dependencies: [],
          material: { format: 'png', width: 640, height: 400, alpha: 'transparent' } }],
      };
      if (kind === 'page') manifest.components[0].preview = { kind: 'page', path: 'preview.html' };
      if (plan) manifest.codeRegions = [];
      const server = await componentServer(cwd, manifest);
      child = server.child;
      await page.goto(server.url);
      const prefix = kind;
      if (plan) {
        for (const colorScheme of ['light', 'dark']) {
          await setScheme(page, colorScheme);
          await readablePressedButton(page, '#start', `plan-${colorScheme}-start`);
        }
        await setScheme(page, 'light');
        await page.getByRole('button', { name: /Start/ }).click();
      }
      const shell = plan ? '.rv' : '.review';
      const art = page.locator(plan ? '.frame > .pic.gen' : '.output.crop-stage');
      await art.waitFor();
      await page.evaluate(() => document.fonts.ready);
      const light = await appearance(page, shell);
      const lightArt = await pixels(page, art);
      const locator = plan ? page.locator('.locator-map') : null;
      const lightLocator = locator ? await pixels(page, locator) : null;
      await screenshot(page, `${prefix}-light-desktop`);
      await setScheme(page, 'dark');
      await screenshot(page, `${prefix}-dark-desktop`);
      assert.notEqual((await appearance(page, shell)).background, light.background);
      await readableText(page, plan ? '.bar-name' : kind === 'page' ? '.review h1' : '.material strong', shell);
      await samePixels(page, lightArt, await pixels(page, art));
      if (locator) await samePixels(page, lightLocator, await pixels(page, locator));
      const approval = plan ? '#decide-yes' : '#approve';
      for (const colorScheme of ['light', 'dark']) {
        await setScheme(page, colorScheme);
        await readablePressedButton(page, approval, `${prefix}-${colorScheme}-approval`);
      }
      if (plan) {
        await page.locator('#backdrop').click();
        const onLight = await pixels(page, art);
        await setScheme(page, 'light');
        await samePixels(page, onLight, await pixels(page, art));
        await setScheme(page, 'dark');
      } else {
        if (kind === 'component') {
          await page.getByRole('button', { name: 'Page color background' }).click();
          const onPage = await pixels(page, art);
          await setScheme(page, 'light');
          await samePixels(page, onPage, await pixels(page, art));
          await setScheme(page, 'dark');
        }
        await page.getByRole('button', { name: 'Enlarge comparison' }).click();
        await page.getByRole('dialog').waitFor();
        await screenshot(page, 'component-dark-expanded');
        await page.keyboard.press('Escape');
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, null, { timeout: 5000 });
      if (kind === 'component') await page.locator('#show-component').click();
      await readablePressedButton(page, approval, `${prefix}-dark-mobile-approval`);
      await screenshot(page, `${prefix}-dark-mobile`);
      await page.route('**/packet', route => route.fulfill({ status: 500, body: 'Unavailable' }));
      await page.reload();
      await page.getByRole('alert').waitFor();
      assert.equal((await appearance(page, 'body')).scheme, 'dark');
      assert.notEqual((await appearance(page, '[role="alert"] strong')).color, 'oklch(0.13 0 0)');
    } finally {
      await page.close();
      if (child && child.exitCode === null) {
        child.kill();
        await new Promise(resolve => child.once('exit', resolve));
      }
      rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
}

test('grouped previews keep their original mattes and approved dimming in either OS theme', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'review-theme-groups-'));
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' });
  let child;
  try {
    const server = await componentServer(cwd, {
      schemaVersion: 1, id: 'group-theme', stage: 'components', title: 'Grouped preview theme',
      comp: { path: 'sample.png', width: 640, height: 400, background: '#e8d8b8' },
      components: [0, 1].map(i => ({
        id: `control-${i}`, name: `Control ${i + 1}`, kind: 'control', medium: 'HTML / CSS', note: 'Repeated control',
        reviewGroup: 'controls', box: { x: i / 2, y: 0, w: 0.5, h: 1 },
        preview: { kind: 'page', path: 'preview.html' }, thumbnail: { kind: 'image', path: 'sample.png' }, dependencies: [],
      })),
    });
    child = server.child;
    await page.goto(server.url);
    await page.locator('.instance-produced img').first().evaluate(img => img.decode());
    let pendingPixels;
    for (const approved of [false, true]) {
      if (approved) {
        await page.locator('.instance-row').first().click();
        await page.getByRole('button', { name: 'Looks good', exact: true }).click();
        await page.locator('.instance-row.approved').waitFor();
        await page.locator('.instance-produced img').first().evaluate(img => img.decode());
      }
      for (const hovered of [false, true]) {
        const art = page.locator('.instance-produced').first();
        if (hovered) await art.hover();
        else await page.mouse.move(0, 0);
        await setScheme(page, 'light');
        const light = await pixels(page, art);
        const reference = page.locator('.instance-reference').first();
        const lightReference = await pixels(page, reference);
        if (!hovered) {
          if (approved) assert.notDeepEqual(light, pendingPixels, 'approved previews retain their original dimming');
          else pendingPixels = light;
        }
        await setScheme(page, 'dark');
        await samePixels(page, light, await pixels(page, art));
        await samePixels(page, lightReference, await pixels(page, reference));
        await screenshot(page, `group-${approved ? 'approved' : 'pending'}-${hovered ? 'hover' : 'normal'}-dark`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, null, { timeout: 5000 });
    await screenshot(page, 'group-dark-mobile');
  } finally {
    await page.close();
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
