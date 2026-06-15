import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  SAMPLE_INIT_ANSWER_INPUTS,
  SAMPLE_INIT_IMAGES,
  SAMPLE_INIT_TYPOGRAPHY,
} from './questionnaire-fixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INSTALLED_SKILL_SRC = path.join(ROOT, '.agents', 'skills', 'impeccable');
const INSTALLED_SKILL_DEST = path.join('.agents', 'skills', 'impeccable');

describe('installable .agents skill init flow', () => {
  it('runs $impeccable init through the packaged browser questionnaire and agent poll channel', async (t) => {
    const browser = await launchBrowserOrSkip(t);
    if (!browser) return;
    t.after(() => browser.close());

    assert.equal(fs.existsSync(path.join(INSTALLED_SKILL_SRC, 'SKILL.md')), true, 'installable .agents skill must exist');
    assert.equal(
      fs.existsSync(path.join(INSTALLED_SKILL_SRC, 'scripts', 'questionnaire', 'init-questionnaire.mjs')),
      true,
      'installable .agents skill must include init-questionnaire.mjs',
    );

    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-installed-init-'));
    const screenshotDir = path.join(
      ROOT,
      '.impeccable',
      'init',
      'screenshots',
      `installed-${Date.now().toString(36)}`,
    );
    let server = null;
    let context = null;

    try {
      fs.cpSync(INSTALLED_SKILL_SRC, path.join(workspace, INSTALLED_SKILL_DEST), { recursive: true });

      const initReference = fs.readFileSync(path.join(workspace, INSTALLED_SKILL_DEST, 'reference', 'init.md'), 'utf-8');
      assert.match(initReference, /Browser-first project setup/);
      assert.match(initReference, /init-questionnaire\.mjs/);
      assert.match(initReference, /init-poll\.mjs/);
      assert.doesNotMatch(initReference, /\.impeccable\/live\/config\.json/);

      const contextResult = await runNode(workspace, [
        path.join(INSTALLED_SKILL_DEST, 'scripts', 'context.mjs'),
      ]);
      assert.match(contextResult.stdout, /NO_PRODUCT_MD/);
      assert.match(contextResult.stdout, /reference\/init\.md/);

      server = spawn(process.execPath, [
        path.join(INSTALLED_SKILL_DEST, 'scripts', 'questionnaire', 'init-questionnaire.mjs'),
        '--prompt',
        'Set up Mira as a calm ceramic lamp site',
      ], {
        cwd: workspace,
        env: withoutImageKeys(process.env),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const startup = await readStartupJson(server);
      assert.equal(startup.ok, true);
      assert.match(startup.url, /^http:\/\/127\.0\.0\.1:/);
      assert.equal(startup.targetPaths.product, 'PRODUCT.md');
      assert.equal(startup.targetPaths.brand, 'BRAND.md');
      assert.equal(startup.targetPaths.design, 'DESIGN.md');

      context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'no-preference' });
      const page = await context.newPage();
      const alertMessages = [];
      page.on('dialog', async (dialog) => {
        alertMessages.push(dialog.message());
        await dialog.accept();
      });

      await page.goto(startup.url, { waitUntil: 'domcontentloaded' });
      await expectCurrentSlide(page, 'product-overview');
      await captureSlide(page, screenshotDir, '01-making');

      await answerTextSlideThroughPoll({
        workspace,
        page,
        sessionId: startup.sessionId,
        slideId: 'product-overview',
        value: SAMPLE_INIT_ANSWER_INPUTS['product-overview'].value,
        nextSlideId: 'assets',
        patch: {
          title: 'What does Mira already have?',
          prompt: 'Add product photos, process shots, testimonials, GIFs, or MP4s.',
          uploadNote: 'GIFs are best for quick review. MP4 works too.',
        },
      });
      await captureSlide(page, screenshotDir, '02-assets');

      const uploadFile = path.join(workspace, 'warm-lamp-product-photo.png');
      fs.writeFileSync(uploadFile, dataUrlToBuffer(SAMPLE_INIT_ANSWER_INPUTS.assets.assets[0].previewDataUrl));
      await page.locator('[data-current="true"] [data-upload-input]').setInputFiles(uploadFile);
      const uploadEvent = await pollUntil(workspace, startup.sessionId, (event) => event.type === 'upload', 'upload event');
      assert.equal(uploadEvent.uploadedAssets[0].role, 'product-photo');
      await captureSlide(page, screenshotDir, '02-assets-uploaded');

      await continueSlideThroughPoll({
        workspace,
        page,
        sessionId: startup.sessionId,
        slideId: 'assets',
        nextSlideId: 'differentiator',
        patch: {
          title: 'What makes Mira special?',
          prompt: 'Say what people cannot easily get somewhere else.',
          placeholder: 'Each piece is shaped by hand, fired in small batches, and made to stay quiet in the room.',
        },
      });
      await captureSlide(page, screenshotDir, '03-special');

      await answerTextSlideThroughPoll({
        workspace,
        page,
        sessionId: startup.sessionId,
        slideId: 'differentiator',
        value: SAMPLE_INIT_ANSWER_INPUTS.differentiator.value,
        nextSlideId: 'trust',
        patch: {
          title: 'What should Mira prove?',
          prompt: 'Choose the trust signal the site should make obvious.',
          options: [
            { label: 'Material honesty', value: SAMPLE_INIT_ANSWER_INPUTS.trust.value, hint: 'The object, process, and surface carry the promise.' },
            { label: 'Small-batch care', value: 'small-batch care', hint: 'The studio feels careful, limited, and human.' },
            { label: 'Quiet expertise', value: 'quiet expertise', hint: 'The brand feels confident without theatre.' },
          ],
        },
      });
      await captureSlide(page, screenshotDir, '04-trust');

      assert.equal(await page.locator('[data-current="true"] [data-delegate]').count(), 0);
      await page.waitForFunction((value) => {
        const selected = document.querySelector('[data-current="true"] [data-option][aria-pressed="true"]');
        return selected?.getAttribute('data-option') === value;
      }, SAMPLE_INIT_ANSWER_INPUTS.trust.value);

      await continueSlideThroughPoll({
        workspace,
        page,
        sessionId: startup.sessionId,
        slideId: 'trust',
        nextSlideId: 'audience-fit',
        patch: {
          title: 'Who should Mira feel made for?',
          prompt: 'Pick the person this should recognize immediately.',
          options: [
            { label: 'Quiet-object people', value: SAMPLE_INIT_ANSWER_INPUTS['audience-fit'].value },
            { label: 'Design collectors', value: 'collectors who want provenance and signed pieces' },
            { label: 'Warm minimalists', value: 'people who want softness without clutter' },
          ],
        },
      });
      await captureSlide(page, screenshotDir, '05-audience');

      await selectOptionThroughPoll({
        workspace,
        page,
        sessionId: startup.sessionId,
        slideId: 'audience-fit',
        value: SAMPLE_INIT_ANSWER_INPUTS['audience-fit'].value,
        nextSlideId: 'anti-audience',
        patch: {
          title: 'Who is Mira not for?',
          prompt: 'Choose the promise or taste the brand should refuse.',
          options: [
            { label: 'No glossy luxury drama', value: SAMPLE_INIT_ANSWER_INPUTS['anti-audience'].value },
            { label: 'No warehouse decor', value: 'not for mass-market decor or fast furniture cues' },
            { label: 'No loud maximalism', value: 'not for trend-led maximalism or visual noise' },
          ],
        },
      });
      await captureSlide(page, screenshotDir, '06-not-for');

      await page.locator(`[data-current="true"] [data-option="${cssEscape(SAMPLE_INIT_ANSWER_INPUTS['anti-audience'].value)}"]`).click();
      await clickContinue(page, 'anti-audience');
      const antiAnswer = await pollUntil(workspace, startup.sessionId, (event) => event.type === 'answer' && event.slideId === 'anti-audience', 'anti-audience answer');
      assert.equal(antiAnswer.nextSlideId, 'visual-cues');
      await reply(workspace, startup.sessionId, {
        action: 'update_slide',
        slideId: 'visual-cues',
        patch: {
          title: 'What should Mira carry visually?',
          prompt: 'Use the product photo, material honesty, and no-glossy-drama guardrail to choose 2-4 cue cards.',
          requestPlaceholder: 'More abstract and protective.',
        },
      });
      const cueRequest = await pollUntil(workspace, startup.sessionId, (event) => event.type === 'image_request' && event.slideId === 'visual-cues', 'visual cue request');
      assert.equal(cueRequest.imageProvider.provider, 'builtin-quadrant');
      assert.equal(cueRequest.promptContext.uploadedAssets[0].role, 'product-photo');
      await expectCurrentSlide(page, 'visual-cues');
      assert.ok(alertMessages.includes('No IMAGE_API_KEY in .impeccable/.env. Using built-in images; Flux is faster.'));
      await captureSlide(page, screenshotDir, '07-cues-loading');
      await reply(workspace, startup.sessionId, {
        action: 'image_batch',
        slideId: 'visual-cues',
        batchId: cueRequest.batchId,
        images: SAMPLE_INIT_IMAGES['visual-cues'],
      });
      await pollUntil(workspace, startup.sessionId, (event) => event.type === 'image_batch' && event.slideId === 'visual-cues', 'visual cue batch');
      await waitForImageCards(page, 'visual-cues');
      await captureSlide(page, screenshotDir, '07-cues');

      for (const id of SAMPLE_INIT_ANSWER_INPUTS['visual-cues'].value) {
        await chooseCard(page, `[data-current="true"] [data-image-card="${cssEscape(id)}"]`);
      }
      await clickContinue(page, 'visual-cues');
      const cueAnswer = await pollUntil(workspace, startup.sessionId, (event) => event.type === 'answer' && event.slideId === 'visual-cues', 'visual cue answer');
      assert.deepEqual(cueAnswer.answer.value, SAMPLE_INIT_ANSWER_INPUTS['visual-cues'].value);
      await reply(workspace, startup.sessionId, {
        action: 'update_slide',
        slideId: 'palette',
        patch: {
          title: 'Which colors fit Mira?',
          prompt: 'Build from the selected visual cues, material honesty, and quiet-object audience.',
          requestPlaceholder: 'Less beige, more mineral contrast.',
        },
      });
      const paletteRequest = await pollUntil(workspace, startup.sessionId, (event) => event.type === 'image_request' && event.slideId === 'palette', 'palette request');
      assert.deepEqual(paletteRequest.selectedImageIds, SAMPLE_INIT_ANSWER_INPUTS['visual-cues'].value);
      await reply(workspace, startup.sessionId, {
        action: 'image_batch',
        slideId: 'palette',
        batchId: paletteRequest.batchId,
        images: SAMPLE_INIT_IMAGES.palette,
      });
      await pollUntil(workspace, startup.sessionId, (event) => event.type === 'image_batch' && event.slideId === 'palette', 'palette batch');
      await waitForImageCards(page, 'palette');
      await captureSlide(page, screenshotDir, '08-palette');

      await chooseCard(page, `[data-current="true"] [data-image-card="${cssEscape(SAMPLE_INIT_ANSWER_INPUTS.palette.value[0])}"]`);
      await clickContinue(page, 'palette');
      const paletteAnswer = await pollUntil(workspace, startup.sessionId, (event) => event.type === 'answer' && event.slideId === 'palette', 'palette answer');
      assert.deepEqual(paletteAnswer.answer.value, SAMPLE_INIT_ANSWER_INPUTS.palette.value);
      await reply(workspace, startup.sessionId, {
        action: 'update_slide',
        slideId: 'typography',
        patch: {
          title: 'Which type fits Mira?',
          prompt: 'Pick a real font system for material honesty, quiet expertise, and the selected palette.',
          requestPlaceholder: 'More editorial, still readable.',
        },
      });
      const typographyRequest = await pollUntil(workspace, startup.sessionId, (event) => event.type === 'typography_request', 'typography request');
      assert.equal(typographyRequest.selectedCueImages.length, 3);
      await reply(workspace, startup.sessionId, {
        action: 'typography_batch',
        slideId: 'typography',
        batchId: typographyRequest.batchId,
        fontSets: SAMPLE_INIT_TYPOGRAPHY,
      });
      await pollUntil(workspace, startup.sessionId, (event) => event.type === 'typography_batch', 'typography batch');
      await waitForTypeCards(page);
      await captureSlide(page, screenshotDir, '09-typography');

      await chooseCard(page, `[data-current="true"] [data-type-card="${cssEscape(SAMPLE_INIT_ANSWER_INPUTS.typography.value[0])}"]`);
      await page.locator('[data-current="true"] [data-next]').click();
      await page.waitForFunction(() => document.querySelector('[data-current="true"] [data-status]')?.textContent?.includes('Wrote PRODUCT.md'));

      assert.equal(fs.existsSync(path.join(workspace, 'PRODUCT.md')), true);
      assert.equal(fs.existsSync(path.join(workspace, 'BRAND.md')), true);
      assert.equal(fs.existsSync(path.join(workspace, 'DESIGN.md')), true);
      assert.equal(fs.existsSync(path.join(workspace, 'IDENTITY.md')), false);
      assert.equal(fs.existsSync(path.join(workspace, '.impeccable', 'live', 'config.json')), false);
      assert.match(fs.readFileSync(path.join(workspace, 'BRAND.md'), 'utf-8'), /!\[Thrown clay\]\(.impeccable\/init\/generated/);
      assert.match(fs.readFileSync(path.join(workspace, 'DESIGN.md'), 'utf-8'), /Read `BRAND.md` before designing/);

      await assertNoTextOverflow(page);
    } finally {
      if (context) await context.close().catch(() => {});
      if (server) await stopProcess(server);
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});

async function launchBrowserOrSkip(t) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch (err) {
    t.skip(`Playwright is required for installed init flow tests (${err.message}).`);
    return null;
  }
  try {
    return await playwright.chromium.launch({ headless: true });
  } catch (err) {
    t.skip(`Chromium could not launch (${err.message}).`);
    return null;
  }
}

async function answerTextSlideThroughPoll({ workspace, page, sessionId, slideId, value, nextSlideId, patch }) {
  await page.locator(`[data-slide="${cssEscape(slideId)}"] [data-answer-text]`).fill(value);
  await continueSlideThroughPoll({ workspace, page, sessionId, slideId, nextSlideId, patch });
}

async function selectOptionThroughPoll({ workspace, page, sessionId, slideId, value, nextSlideId, patch }) {
  await page.locator(`[data-current="true"] [data-option="${cssEscape(value)}"]`).click();
  await continueSlideThroughPoll({ workspace, page, sessionId, slideId, nextSlideId, patch });
}

async function continueSlideThroughPoll({ workspace, page, sessionId, slideId, nextSlideId, patch }) {
  await clickContinue(page, slideId);
  const event = await pollUntil(workspace, sessionId, (item) => item.type === 'answer' && item.slideId === slideId, `${slideId} answer`);
  assert.equal(event.nextSlideId, nextSlideId);
  await reply(workspace, sessionId, {
    action: 'update_slide',
    slideId: nextSlideId,
    patch,
  });
  await expectCurrentSlide(page, nextSlideId);
}

async function clickContinue(page, slideId) {
  await page.waitForFunction(() => {
    const thinking = document.querySelector('[data-thinking]');
    return !thinking || thinking.hidden || !thinking.classList.contains('is-active');
  });
  const responsePromise = page.waitForResponse((response) => (
    response.url().includes('/api/answer')
      && response.request().method() === 'POST'
      && response.request().postDataJSON()?.slideId === slideId
  ), { timeout: 5000 });
  await page.locator(`[data-slide="${cssEscape(slideId)}"][data-current="true"] [data-next]`).click();
  const response = await responsePromise;
  const json = await response.json();
  assert.equal(json.ok, true, JSON.stringify(json));
}

async function expectCurrentSlide(page, expectedSlideId) {
  await page.waitForFunction((slideId) => {
    const thinking = document.querySelector('[data-thinking]');
    const ready = !thinking || thinking.hidden || !thinking.classList.contains('is-active');
    const current = document.querySelector('[data-current="true"]');
    return ready
      && current?.dataset.slide === slideId
      && Number(getComputedStyle(current).opacity) > 0.8;
  }, expectedSlideId, { timeout: 7000 });
}

async function waitForImageCards(page, slideId) {
  await page.waitForFunction((expectedSlideId) => {
    const current = document.querySelector('[data-current="true"]');
    return current?.dataset.slide === expectedSlideId
      && current.querySelectorAll('[data-image-card] img').length === 4
      && Array.from(current.querySelectorAll('[data-image-card] img')).every((img) => img.complete && img.naturalWidth > 0);
  }, slideId, { timeout: 7000 });
}

async function waitForTypeCards(page) {
  await page.waitForFunction(() => {
    const current = document.querySelector('[data-current="true"]');
    return current?.dataset.slide === 'typography'
      && current.querySelectorAll('[data-type-card]').length === 4;
  }, { timeout: 7000 });
}

async function chooseCard(page, selector) {
  await page.locator(selector).first().focus();
  await page.keyboard.press('Enter');
}

async function captureSlide(page, screenshotDir, label) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.waitForFunction(() => {
    const current = document.querySelector('[data-current="true"]');
    return current && Number(getComputedStyle(current).opacity) > 0.8;
  });
  const out = path.join(screenshotDir, `${label}.png`);
  const buffer = await page.locator('[data-current="true"]').screenshot({ path: out });
  assert.ok(buffer.byteLength > 6000, `${label} screenshot should contain visible pixels`);
}

async function pollUntil(workspace, sessionId, predicate, label) {
  for (let i = 0; i < 12; i += 1) {
    const event = await poll(workspace, sessionId, 2500);
    if (predicate(event)) return event;
    if (event.type !== 'timeout') {
      continue;
    }
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function poll(workspace, sessionId, timeoutMs = 2500) {
  const result = await runNode(workspace, [
    path.join(INSTALLED_SKILL_DEST, 'scripts', 'questionnaire', 'init-poll.mjs'),
    '--session-id',
    sessionId,
    '--timeout-ms',
    String(timeoutMs),
  ], { timeoutMs: timeoutMs + 3000 });
  return parseJson(result.stdout, 'poll output');
}

async function reply(workspace, sessionId, payload) {
  const replyPath = path.join(workspace, '.impeccable', `reply-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}.json`);
  fs.mkdirSync(path.dirname(replyPath), { recursive: true });
  fs.writeFileSync(replyPath, JSON.stringify(payload, null, 2));
  const result = await runNode(workspace, [
    path.join(INSTALLED_SKILL_DEST, 'scripts', 'questionnaire', 'init-poll.mjs'),
    '--session-id',
    sessionId,
    '--reply',
    replyPath,
  ]);
  return parseJson(result.stdout, 'reply output');
}

function runNode(cwd, args, { timeoutMs = 20_000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`node ${args.join(' ')} timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, timeoutMs);
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`node ${args.join(' ')} exited ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}

function readStartupJson(proc) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`init-questionnaire startup timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`)), 10_000);
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      try {
        const json = parseJson(stdout, 'startup output');
        clearTimeout(timer);
        resolve(json);
      } catch {
        // Wait for the rest of the JSON.
      }
    });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`init-questionnaire exited before startup JSON (${code})\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}

async function stopProcess(proc) {
  if (proc.exitCode !== null || proc.signalCode) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve();
    }, 3000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    proc.kill('SIGTERM');
  });
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse ${label}: ${error.message}\n${text}`);
  }
}

async function assertNoTextOverflow(page) {
  const offenders = await page.locator('h1, .prompt, button, textarea, .image-label, .type-label, .swatch-name').evaluateAll((nodes) => nodes
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        text: node.textContent?.trim() || node.getAttribute('placeholder') || '',
        overflows: node.scrollWidth > Math.ceil(rect.width) + 2,
      };
    })
    .filter((item) => item.overflows && item.text));
  assert.deepEqual(offenders, []);
}

function withoutImageKeys(env) {
  const next = { ...env };
  delete next.IMAGE_API_KEY;
  delete next.IMPECCABLE_IMAGE_API_KEY;
  delete next.BFL_API_KEY;
  delete next.FLUX_API_KEY;
  return next;
}

function dataUrlToBuffer(dataUrl) {
  return Buffer.from(String(dataUrl).split(',')[1] || '', 'base64');
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}
