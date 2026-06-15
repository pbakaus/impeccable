import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startQuestionnaireServer } from '../skill/scripts/questionnaire/server.mjs';
import { MISSING_IMAGE_API_KEY_ALERT } from '../skill/scripts/questionnaire/init-image-provider.mjs';
import {
  SAMPLE_INIT_ANSWER_INPUTS,
  SAMPLE_INIT_IMAGES,
  SAMPLE_INIT_TYPOGRAPHY,
} from './questionnaire-fixtures.mjs';

describe('init questionnaire browser UI', () => {
  it('runs the init browser flow with visual screenshots, committed answers, generated cards, and completion', async (t) => {
    const browser = await launchBrowserOrSkip(t);
    if (!browser) return;
    t.after(() => browser.close());
    const screenshotDir = path.join(
      process.cwd(),
      '.impeccable',
      'init',
      'screenshots',
      `browser-${Date.now().toString(36)}`,
    );

    for (const viewport of [
      { name: 'desktop', width: 1280, height: 860 },
      { name: 'mobile', width: 390, height: 760 },
    ]) {
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `impeccable-init-browser-${viewport.name}-`));
      const handle = await startQuestionnaireServer({ cwd: scratch, env: {} });
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: viewport.name === 'mobile' ? 'reduce' : 'no-preference',
      });
      try {
        const session = handle.runtime.createSession({ command: 'init', prompt: 'Set up Mira' });
        const page = await context.newPage();
        await page.goto(session.url, { waitUntil: 'domcontentloaded' });
        await expectNonBlank(page);
        await assertNoFirstSlideBack(page);
        await assertNoChooseForMe(page);
        await assertShortcutHint(page);
        await assertNoTextOverflow(page, viewport.name);
        await captureActiveSlideScreenshot(page, screenshotDir, `${viewport.name}-01-making`);

        await answerCurrentTextAndPatchNext({
          page,
          handle,
          sessionId: session.sessionId,
          slideId: 'product-overview',
          value: SAMPLE_INIT_ANSWER_INPUTS['product-overview'].value,
          nextSlideId: 'assets',
          patch: {
            title: 'What does Mira have?',
            prompt: 'Add product photos, process shots, testimonials, GIFs, or MP4s.',
            uploadNote: 'GIFs are best for quick review. MP4 works too.',
          },
        });
        await captureActiveSlideScreenshot(page, screenshotDir, `${viewport.name}-02-assets-empty`);

        const uploadFile = path.join(scratch, 'warm-lamp-product-photo.png');
        fs.writeFileSync(uploadFile, dataUrlToBuffer(SAMPLE_INIT_ANSWER_INPUTS.assets.assets[0].previewDataUrl));
        await page.locator('[data-current="true"] [data-upload-input]').setInputFiles(uploadFile);
        await page.waitForFunction(() => document.querySelectorAll('[data-current="true"] .asset-item').length === 1);
        const uploadEvent = await waitForRuntimeEvent(handle, session.sessionId, (event) => event.type === 'upload');
        assert.equal(uploadEvent.uploadedAssets[0].role, 'product-photo');
        await captureActiveSlideScreenshot(page, screenshotDir, `${viewport.name}-02-assets-uploaded`);

        await continueAndPatchNext({
          page,
          handle,
          sessionId: session.sessionId,
          expectedSlideId: 'assets',
          nextSlideId: 'differentiator',
          patch: {
            title: 'What makes Mira special?',
            prompt: 'Tell me what people can’t easily get somewhere else.',
            placeholder: 'Each lamp is hand-thrown, fired in small batches, and calm even when switched off.',
          },
        });
        await captureActiveSlideScreenshot(page, screenshotDir, `${viewport.name}-03-special`);

        await answerCurrentTextAndPatchNext({
          page,
          handle,
          sessionId: session.sessionId,
          slideId: 'differentiator',
          value: SAMPLE_INIT_ANSWER_INPUTS.differentiator.value,
          nextSlideId: 'trust',
          patch: {
            title: 'What should Mira prove?',
            prompt: 'Choose the trust signal that should shape the site.',
            placeholder: 'Or write the trust signal yourself.',
            options: [
              { label: 'Material honesty', value: 'material honesty', hint: 'The product proves itself through process and surface.' },
              { label: 'Quiet expertise', value: 'quiet expertise', hint: 'The studio feels confident without shouting.' },
              { label: 'Small-batch care', value: 'small-batch care', hint: 'The making process carries the promise.' },
            ],
          },
        });
        await assertOptionCards(page, 3);
        await assertRecommendedDefault(page, 'Material honesty');
        await assertNumberKeySelects(page, 2);
        await captureActiveSlideScreenshot(page, screenshotDir, `${viewport.name}-04-trust`);

        await selectOptionAndPatchNext({
          page,
          handle,
          sessionId: session.sessionId,
          value: SAMPLE_INIT_ANSWER_INPUTS.trust.value,
          expectedSlideId: 'trust',
          nextSlideId: 'audience-fit',
          patch: {
            title: 'Who is Mira for?',
            prompt: 'Pick the person Mira should immediately reassure.',
            options: [
              { label: 'Quiet-object people', value: 'people who want quiet objects with presence, not visual noise' },
              { label: 'Design collectors', value: 'collectors who want signed pieces and provenance' },
              { label: 'Warm minimalists', value: 'people who want softness without clutter' },
            ],
          },
        });
        await assertBrandSpecificTitle(page, 'Mira');
        await captureActiveSlideScreenshot(page, screenshotDir, `${viewport.name}-05-audience`);

        await selectOptionAndPatchNext({
          page,
          handle,
          sessionId: session.sessionId,
          value: SAMPLE_INIT_ANSWER_INPUTS['audience-fit'].value,
          expectedSlideId: 'audience-fit',
          nextSlideId: 'anti-audience',
          patch: {
            title: 'Who is Mira not for?',
            prompt: 'Name the tastes, clichés, or promises to avoid.',
            options: [
              { label: 'No glossy luxury drama', value: 'not for glossy luxury drama, bargain decor, or trend-led maximalism' },
              { label: 'No warehouse decor', value: 'not for mass-market decor or fast furniture cues' },
              { label: 'No loud maximalism', value: 'not for trend-led maximalism or visual noise' },
            ],
          },
        });
        await captureActiveSlideScreenshot(page, screenshotDir, `${viewport.name}-06-not-for`);

        await page.locator(`[data-current="true"] [data-option="${cssEscape(SAMPLE_INIT_ANSWER_INPUTS['anti-audience'].value)}"]`).click();
        const fallbackAlert = expectNextDialog(page, MISSING_IMAGE_API_KEY_ALERT);
        const antiAnswer = await clickContinueAndReadAnswer(page, 'anti-audience');
        assert.equal(antiAnswer.slideId, 'anti-audience');
        assert.ok(antiAnswer.answers.assets, 'answer event carries uploaded asset answer');
        handle.runtime.updateSlide({
          sessionId: session.sessionId,
          slideId: 'visual-cues',
          patch: {
            title: 'What should Mira carry visually?',
            prompt: 'Use the lamp material, product photo, quiet expertise, and anti-luxury guardrails to choose 2-4 cue cards.',
            requestPlaceholder: 'More abstract and protective, with a clearer graphic route.',
          },
        });
        const cueRequest = await waitForRuntimeEvent(handle, session.sessionId, (event) => event.type === 'image_request' && event.slideId === 'visual-cues');
        assert.equal(cueRequest.promptContext.uploadedAssets[0].role, 'product-photo');
        assert.match(cueRequest.imagePromptContract.routeRules.join('\n'), /At least three routeFamily/);
        await waitForCurrentSlide(page, 'visual-cues');
        await fallbackAlert;
        await captureActiveSlideScreenshot(page, screenshotDir, `${viewport.name}-07-cues-loading`);

        handle.runtime.sendImageBatch({
          sessionId: session.sessionId,
          slideId: 'visual-cues',
          batchId: cueRequest.batchId,
          images: SAMPLE_INIT_IMAGES['visual-cues'],
        });
        assert.equal((await waitForRuntimeEvent(handle, session.sessionId, (event) => event.type === 'image_batch' && event.slideId === 'visual-cues')).type, 'image_batch');
        await waitForActiveImageCards(page, 'visual-cues');
        await assertImagesVisuallyRendered(page, 'visual cue cards');
        await assertRouteFamiliesVisible(page);
        await captureActiveSlideScreenshot(page, screenshotDir, `${viewport.name}-07-cues`);
        await waitForActiveImageCards(page, 'visual-cues');

        await assertImageCardClickSelectsWithoutModal(page, SAMPLE_INIT_ANSWER_INPUTS['visual-cues'].value[0]);
        await page.locator('[data-current="true"] [data-next]').click();
        await page.waitForFunction(() => /at least 2/i.test(document.querySelector('[data-current="true"] [data-status]')?.textContent || ''));
        for (const id of SAMPLE_INIT_ANSWER_INPUTS['visual-cues'].value.slice(1)) await chooseImageCard(page, id);
        await page.waitForFunction((count) => (
          document.querySelectorAll('[data-current="true"] [data-image-card][aria-pressed="true"]').length === count
        ), SAMPLE_INIT_ANSWER_INPUTS['visual-cues'].value.length);
        await assertSelectedCheckmarkVisible(page);
        await assertImageCardExpands(page, screenshotDir, `${viewport.name}-07-cue-modal`);
        const cueAnswer = await clickContinueAndReadAnswer(page, 'visual-cues');
        assert.equal(cueAnswer.nextSlideId, 'palette');
        handle.runtime.updateSlide({
          sessionId: session.sessionId,
          slideId: 'palette',
          patch: {
            title: 'Which colors fit Mira?',
            prompt: 'Build from the selected cue cards, material honesty, and the quiet-object positioning. Choose one palette.',
            requestPlaceholder: 'Less beige, more mineral contrast.',
          },
        });
        await waitForCurrentSlide(page, 'palette');
        const paletteRequest = await waitForRuntimeEvent(handle, session.sessionId, (event) => event.type === 'image_request' && event.slideId === 'palette');
        assert.deepEqual(paletteRequest.selectedImageIds, SAMPLE_INIT_ANSWER_INPUTS['visual-cues'].value);
        handle.runtime.sendImageBatch({
          sessionId: session.sessionId,
          slideId: 'palette',
          batchId: paletteRequest.batchId,
          images: SAMPLE_INIT_IMAGES.palette,
        });
        assert.equal((await waitForRuntimeEvent(handle, session.sessionId, (event) => event.type === 'image_batch' && event.slideId === 'palette')).type, 'image_batch');
        await waitForActiveImageCards(page, 'palette');

        await page.locator('[data-current="true"] [data-prev]').click();
        await waitForCurrentSlide(page, 'visual-cues');
        await page.locator('[data-current="true"] [data-image-request-input]').fill('More abstract and protective, with a clearer graphic route.');
        const moreCueResponsePromise = page.waitForResponse((response) => (
          response.url().includes('/api/image-request')
            && response.request().method() === 'POST'
            && response.request().postDataJSON()?.slideId === 'visual-cues'
        ));
        await page.locator('[data-current="true"] [data-image-request]').click();
        const moreCueJson = await (await moreCueResponsePromise).json();
        assert.equal(moreCueJson.ok, true);
        assert.equal(moreCueJson.event.reason, 'user-requested-more');
        const refreshedCueBatch = SAMPLE_INIT_IMAGES['visual-cues'].map((image) => ({
          ...image,
          label: `${image.label} refreshed`,
        }));
        handle.runtime.sendImageBatch({
          sessionId: session.sessionId,
          slideId: 'visual-cues',
          batchId: moreCueJson.event.batchId,
          images: refreshedCueBatch,
        });
        await waitForRuntimeEvent(handle, session.sessionId, (event) => (
          event.type === 'image_batch'
            && event.slideId === 'visual-cues'
            && event.batchId === moreCueJson.event.batchId
        ));
        await waitForActiveImageCards(page, 'visual-cues');
        await page.waitForFunction((batchId) => {
          const active = document.querySelector('[data-current="true"]');
          const cards = Array.from(active?.querySelectorAll('[data-image-card]') || []);
          return cards.length === 4
            && cards.every((card) => card.getAttribute('data-image-batch') === batchId)
            && cards.every((card) => card.getAttribute('aria-pressed') === 'false');
        }, moreCueJson.event.batchId);
        await chooseImageCard(page, SAMPLE_INIT_ANSWER_INPUTS['visual-cues'].value[0]);
        await page.locator('[data-current="true"] [data-next]').click();
        await page.waitForFunction(() => /at least 2/i.test(document.querySelector('[data-current="true"] [data-status]')?.textContent || ''));
        await chooseImageCard(page, SAMPLE_INIT_ANSWER_INPUTS['visual-cues'].value[1]);
        const refreshedCueAnswer = await clickContinueAndReadAnswer(page, 'visual-cues');
        assert.equal(refreshedCueAnswer.answer.batchId, moreCueJson.event.batchId);
        handle.runtime.updateSlide({
          sessionId: session.sessionId,
          slideId: 'palette',
          patch: {
            title: 'Which colors fit the refreshed Mira cues?',
            prompt: 'Use the refreshed cue batch, product photo, and quiet expertise to choose one palette.',
            requestPlaceholder: 'More mineral, still warm enough for home.',
          },
        });
        await waitForCurrentSlide(page, 'palette');
        const refreshedPaletteRequest = await waitForRuntimeEvent(handle, session.sessionId, (event) => (
          event.type === 'image_request'
            && event.slideId === 'palette'
            && event.batchId !== paletteRequest.batchId
        ));
        handle.runtime.sendImageBatch({
          sessionId: session.sessionId,
          slideId: 'palette',
          batchId: refreshedPaletteRequest.batchId,
          images: SAMPLE_INIT_IMAGES.palette,
        });
        await waitForRuntimeEvent(handle, session.sessionId, (event) => (
          event.type === 'image_batch'
            && event.slideId === 'palette'
            && event.batchId === refreshedPaletteRequest.batchId
        ));
        await waitForActiveImageCards(page, 'palette');
        await assertPaletteLabelsFit(page, viewport.name);
        await captureActiveSlideScreenshot(page, screenshotDir, `${viewport.name}-08-palette`);
        await waitForActiveImageCards(page, 'palette');

        await chooseImageCard(page, SAMPLE_INIT_ANSWER_INPUTS.palette.value[0]);
        await page.waitForFunction(() => document.querySelectorAll('[data-current="true"] [data-image-card][aria-pressed="true"]').length === 1);
        await assertImageCardExpands(page, screenshotDir, `${viewport.name}-08-palette-modal`);
        const paletteAnswer = await clickContinueAndReadAnswer(page, 'palette');
        assert.equal(paletteAnswer.nextSlideId, 'typography');
        handle.runtime.updateSlide({
          sessionId: session.sessionId,
          slideId: 'typography',
          patch: {
            title: 'Which type fits Mira?',
            prompt: 'Pick the heading and body voice that can carry material honesty and quiet expertise.',
            requestPlaceholder: 'More editorial, still readable.',
          },
        });
        await waitForCurrentSlide(page, 'typography');
        const typographyRequest = await waitForRuntimeEvent(handle, session.sessionId, (event) => event.type === 'typography_request');
        assert.equal(typographyRequest.selectedCueImages.length, 2);
        handle.runtime.sendTypographyBatch({
          sessionId: session.sessionId,
          slideId: 'typography',
          batchId: typographyRequest.batchId,
          fontSets: SAMPLE_INIT_TYPOGRAPHY,
        });
        assert.equal((await waitForRuntimeEvent(handle, session.sessionId, (event) => event.type === 'typography_batch' && event.slideId === 'typography')).type, 'typography_batch');
        await waitForActiveTypeCards(page);
        await captureActiveSlideScreenshot(page, screenshotDir, `${viewport.name}-09-typography`);
        await waitForActiveTypeCards(page);

        await chooseTypeCard(page, SAMPLE_INIT_ANSWER_INPUTS.typography.value[0]);
        await page.waitForFunction(() => document.querySelectorAll('[data-current="true"] [data-type-card][aria-pressed="true"]').length === 1);
        await assertTypeCardExpands(page, screenshotDir, `${viewport.name}-09-type-modal`);
        await page.locator('[data-current="true"] [data-next]').click();
        await page.waitForFunction(() => document.querySelector('[data-current="true"] [data-status]')?.textContent?.includes('Wrote PRODUCT.md'));
        assert.equal(fs.existsSync(path.join(scratch, 'PRODUCT.md')), true);
        assert.equal(fs.existsSync(path.join(scratch, 'BRAND.md')), true);
        assert.equal(fs.existsSync(path.join(scratch, 'DESIGN.md')), true);
        assertNoGeneratedIdentityFile(scratch);
        await assertNoTextOverflow(page, viewport.name);
      } finally {
        await context.close();
        await handle.stop();
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    }
  });

  it('renders mocked Flux image batches without showing the fallback alert or leaking the key', async (t) => {
    const browser = await launchBrowserOrSkip(t);
    if (!browser) return;
    t.after(() => browser.close());

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-init-browser-flux-'));
    const screenshotDir = path.join(
      process.cwd(),
      '.impeccable',
      'init',
      'screenshots',
      `browser-flux-${Date.now().toString(36)}`,
    );
    const generationCalls = [];
    const handle = await startQuestionnaireServer({
      cwd: scratch,
      env: { IMAGE_API_KEY: 'bfl_browser_secret' },
      imageGeneration: async (request, options) => {
        generationCalls.push({
          slideId: request.slideId,
          provider: options.providerConfig.provider,
          apiKey: options.providerConfig.apiKey,
        });
        const fixture = request.slideId === 'palette'
          ? SAMPLE_INIT_IMAGES.palette
          : SAMPLE_INIT_IMAGES['visual-cues'];
        return {
          images: fixture.map((image) => ({
            ...image,
            batchId: request.batchId,
            slideId: request.slideId,
            kind: request.kind,
          })),
        };
      },
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 860 },
      reducedMotion: 'no-preference',
    });
    try {
      const session = handle.runtime.createSession({ command: 'init', prompt: 'Set up Mira' });
      const page = await context.newPage();
      let dialogMessage = '';
      page.on('dialog', async (dialog) => {
        dialogMessage = dialog.message();
        await dialog.dismiss();
      });

      await page.goto(session.url, { waitUntil: 'domcontentloaded' });
      await expectNonBlank(page);
      await captureActiveSlideScreenshot(page, screenshotDir, 'flux-01-making');

      await answerCurrentTextAndPatchNext({
        page,
        handle,
        sessionId: session.sessionId,
        slideId: 'product-overview',
        value: SAMPLE_INIT_ANSWER_INPUTS['product-overview'].value,
        nextSlideId: 'assets',
        patch: {
          title: 'What does Mira have?',
          prompt: 'Add product photos, process shots, proof, GIFs, or MP4s.',
        },
      });
      await captureActiveSlideScreenshot(page, screenshotDir, 'flux-02-assets');

      await continueAndPatchNext({
        page,
        handle,
        sessionId: session.sessionId,
        expectedSlideId: 'assets',
        nextSlideId: 'differentiator',
        patch: {
          title: 'What makes Mira special?',
          prompt: 'Say what people cannot easily get somewhere else.',
          placeholder: SAMPLE_INIT_ANSWER_INPUTS.differentiator.value,
        },
      });
      await captureActiveSlideScreenshot(page, screenshotDir, 'flux-03-special');

      await answerCurrentTextAndPatchNext({
        page,
        handle,
        sessionId: session.sessionId,
        slideId: 'differentiator',
        value: SAMPLE_INIT_ANSWER_INPUTS.differentiator.value,
        nextSlideId: 'trust',
        patch: {
          title: 'What should Mira prove?',
          prompt: 'Choose the trust signal that should shape the site.',
          options: [
            { label: 'Material honesty', value: SAMPLE_INIT_ANSWER_INPUTS.trust.value },
            { label: 'Small-batch care', value: 'small-batch care' },
            { label: 'Quiet expertise', value: 'quiet expertise' },
          ],
        },
      });
      await captureActiveSlideScreenshot(page, screenshotDir, 'flux-04-trust');

      await selectOptionAndPatchNext({
        page,
        handle,
        sessionId: session.sessionId,
        value: SAMPLE_INIT_ANSWER_INPUTS.trust.value,
        expectedSlideId: 'trust',
        nextSlideId: 'audience-fit',
        patch: {
          title: 'Who is Mira for?',
          prompt: 'Pick the person Mira should recognize immediately.',
          options: [
            { label: 'Quiet-object people', value: SAMPLE_INIT_ANSWER_INPUTS['audience-fit'].value },
            { label: 'Design collectors', value: 'collectors who want provenance' },
            { label: 'Warm minimalists', value: 'people who want softness without clutter' },
          ],
        },
      });
      await captureActiveSlideScreenshot(page, screenshotDir, 'flux-05-audience');

      await selectOptionAndPatchNext({
        page,
        handle,
        sessionId: session.sessionId,
        value: SAMPLE_INIT_ANSWER_INPUTS['audience-fit'].value,
        expectedSlideId: 'audience-fit',
        nextSlideId: 'anti-audience',
        patch: {
          title: 'Who is Mira not for?',
          prompt: 'Choose the promise or taste the brand should refuse.',
          options: [
            { label: 'No glossy luxury drama', value: SAMPLE_INIT_ANSWER_INPUTS['anti-audience'].value },
            { label: 'No bargain decor', value: 'not for bargain decor or fast furniture cues' },
            { label: 'No loud maximalism', value: 'not for trend-led maximalism or visual noise' },
          ],
        },
      });
      await captureActiveSlideScreenshot(page, screenshotDir, 'flux-06-not-for');

      await page.locator(`[data-current="true"] [data-option="${cssEscape(SAMPLE_INIT_ANSWER_INPUTS['anti-audience'].value)}"]`).click();
      const antiAnswer = await clickContinueAndReadAnswer(page, 'anti-audience');
      assert.equal(antiAnswer.nextSlideId, 'visual-cues');
      handle.runtime.updateSlide({
        sessionId: session.sessionId,
        slideId: 'visual-cues',
        patch: {
          title: 'What should Mira carry visually?',
          prompt: 'Use material honesty, the uploaded product reference, and the no-glossy-drama guardrail to choose 2-4 cue cards.',
          requestPlaceholder: 'More abstract and protective.',
        },
      });
      await waitForCurrentSlide(page, 'visual-cues');
      await waitForActiveImageCards(page, 'visual-cues');
      await assertImagesVisuallyRendered(page, 'mocked Flux cue cards');
      await assertRouteFamiliesVisible(page);
      await captureActiveSlideScreenshot(page, screenshotDir, 'flux-07-cues');
      await assertImageCardExpands(page, screenshotDir, 'flux-07-cue-modal');

      for (const id of SAMPLE_INIT_ANSWER_INPUTS['visual-cues'].value) {
        await chooseImageCard(page, id);
      }
      await clickContinueAndReadAnswer(page, 'visual-cues');
      handle.runtime.updateSlide({
        sessionId: session.sessionId,
        slideId: 'palette',
        patch: {
          title: 'Which colors fit Mira?',
          prompt: 'Build from the selected cue cards and material honesty without drifting into glossy luxury drama.',
          requestPlaceholder: 'Less beige, more mineral contrast.',
        },
      });
      await waitForCurrentSlide(page, 'palette');
      await waitForActiveImageCards(page, 'palette');
      await assertPaletteLabelsFit(page, 'flux');
      await captureActiveSlideScreenshot(page, screenshotDir, 'flux-08-palette');
      await assertImageCardExpands(page, screenshotDir, 'flux-08-palette-modal');

      assert.equal(dialogMessage, '');
      assert.equal(generationCalls.map((call) => call.slideId).join(','), 'visual-cues,palette');
      assert.equal(generationCalls.every((call) => call.provider === 'flux'), true);
      assert.equal(generationCalls.every((call) => call.apiKey === 'bfl_browser_secret'), true);
      assert.doesNotMatch(await page.content(), /bfl_browser_secret/);
      assert.doesNotMatch(JSON.stringify(handle.runtime.getSessionState(session.sessionId)), /bfl_browser_secret/);
      await assertNoTextOverflow(page, 'flux');
    } finally {
      await context.close();
      await handle.stop();
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('keeps focused draft text stable while remote slide updates arrive', async (t) => {
    const browser = await launchBrowserOrSkip(t);
    if (!browser) return;
    t.after(() => browser.close());

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-init-browser-focus-'));
    const handle = await startQuestionnaireServer({ cwd: scratch, env: {} });
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    try {
      const session = handle.runtime.createSession({ command: 'init', prompt: 'Set up Mira' });
      const page = await context.newPage();
      await page.goto(session.url, { waitUntil: 'domcontentloaded' });
      await answerCurrentTextAndPatchNext({
        page,
        handle,
        sessionId: session.sessionId,
        slideId: 'product-overview',
        value: SAMPLE_INIT_ANSWER_INPUTS['product-overview'].value,
        nextSlideId: 'assets',
        patch: {
          title: 'What does Mira have?',
          prompt: 'Add product photos, process shots, testimonials, GIFs, or MP4s.',
        },
      });
      await continueAndPatchNext({
        page,
        handle,
        sessionId: session.sessionId,
        expectedSlideId: 'assets',
        nextSlideId: 'differentiator',
        patch: {
          title: 'What makes Mira special?',
          prompt: 'Tell me what people can’t easily get somewhere else.',
          placeholder: 'Each lamp is hand-thrown and calm even when switched off.',
        },
      });
      const input = page.locator('[data-current="true"] [data-answer-text]');
      await input.click();
      await input.fill('Draft while the agent updates');
      handle.runtime.updateSlide({
        sessionId: session.sessionId,
        slideId: 'differentiator',
        patch: {
          title: 'What makes Mira special?',
          prompt: 'Updated remotely while the user keeps typing.',
          placeholder: 'This must not replace the focused draft.',
        },
      });
      await page.waitForTimeout(450);
      assert.equal(await input.inputValue(), 'Draft while the agent updates');
      assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-answer-text]')), true);
    } finally {
      await context.close();
      await handle.stop();
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

async function launchBrowserOrSkip(t) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch (err) {
    t.skip(`Playwright is required for questionnaire browser tests (${err.message}).`);
    return null;
  }
  try {
    return await playwright.chromium.launch({ headless: true });
  } catch (err) {
    t.skip(`Chromium could not launch (${err.message}).`);
    return null;
  }
}

async function answerCurrentTextAndPatchNext({ page, handle, sessionId, slideId, value, nextSlideId, patch }) {
  await page.locator(`[data-slide="${slideId}"] [data-answer-text]`).fill(value);
  await continueAndPatchNext({ page, handle, sessionId, expectedSlideId: slideId, nextSlideId, patch });
}

async function selectOptionAndPatchNext({ page, handle, sessionId, value, expectedSlideId, nextSlideId, patch }) {
  await page.locator(`[data-current="true"] [data-option="${cssEscape(value)}"]`).click();
  await continueAndPatchNext({ page, handle, sessionId, expectedSlideId, nextSlideId, patch });
}

async function continueAndPatchNext({ page, handle, sessionId, expectedSlideId, nextSlideId, patch }) {
  const event = await clickContinueAndReadAnswer(page, expectedSlideId);
  assert.equal(event.slideId, expectedSlideId);
  assert.equal(event.nextSlideId, nextSlideId);
  handle.runtime.updateSlide({ sessionId, slideId: nextSlideId, patch });
  await waitForCurrentSlide(page, nextSlideId);
}

async function clickContinueAndReadAnswer(page, expectedSlideId) {
  await waitForPageReady(page);
  const responsePromise = page.waitForResponse((response) => (
    response.url().includes('/api/answer')
      && response.request().method() === 'POST'
      && response.request().postDataJSON()?.slideId === expectedSlideId
  ), { timeout: 3000 }).catch((error) => error);
  await page.locator(`[data-slide="${cssEscape(expectedSlideId)}"][data-current="true"] [data-next]`).click();
  const response = await responsePromise;
  if (response instanceof Error) {
    const activeSlide = await page.locator('[data-current="true"]').getAttribute('data-slide').catch(() => '');
    const status = await page.locator('[data-current="true"] [data-status]').innerText().catch(() => '');
    const selected = await page.locator('[data-current="true"] [aria-pressed="true"]').count().catch(() => 0);
    throw new Error(`Expected /api/answer for ${expectedSlideId}; active=${activeSlide}; selected=${selected}; status=${status || 'none'}`);
  }
  const json = await response.json();
  assert.equal(json.ok, true, JSON.stringify(json));
  assert.equal(json.event.slideId, expectedSlideId);
  return json.event;
}

async function waitForPageReady(page) {
  await page.waitForFunction(() => {
    const thinking = document.querySelector('[data-thinking]');
    return !thinking || thinking.hidden || !thinking.classList.contains('is-active');
  });
}

async function waitForCurrentSlide(page, expectedSlideId, timeout = 5000) {
  const result = await page.waitForFunction((slideId) => (
    (() => {
      const thinking = document.querySelector('[data-thinking]');
      const ready = !thinking || thinking.hidden || !thinking.classList.contains('is-active');
      const current = document.querySelector('[data-current="true"]');
      return ready
        && document.querySelectorAll('[data-current="true"]').length === 1
        && current?.dataset.slide === slideId
        && getComputedStyle(current).visibility === 'visible'
        && Number(getComputedStyle(current).opacity) > 0.8;
    })()
  ), expectedSlideId, { timeout }).then(() => null).catch((error) => error);
  if (!result) return;
  const diagnostics = await page.evaluate(() => {
    const current = document.querySelector('[data-current="true"]');
    const thinking = document.querySelector('[data-thinking]');
    return {
      current: current?.dataset.slide || '',
      currentClass: current?.className || '',
      status: current?.querySelector('[data-status]')?.textContent || '',
      thinkingHidden: thinking?.hidden ?? null,
      thinkingClass: thinking?.className || '',
      thinkingText: thinking?.textContent?.trim() || '',
      debug: window.__impeccableQuestionnaireDebug?.() || null,
      slides: Array.from(document.querySelectorAll('.slide')).map((slide) => ({
        id: slide.dataset.slide,
        current: slide.dataset.current,
        className: slide.className,
        visible: getComputedStyle(slide).visibility,
        display: getComputedStyle(slide).display,
        opacity: getComputedStyle(slide).opacity,
      })),
    };
  });
  throw new Error(`Expected current slide ${expectedSlideId}; ${JSON.stringify(diagnostics)}`);
}

async function waitForActiveImageCards(page, slideId) {
  const result = await page.waitForFunction((expectedSlideId) => {
    const thinking = document.querySelector('[data-thinking]');
    const ready = !thinking || thinking.hidden || !thinking.classList.contains('is-active');
    const currentSlides = document.querySelectorAll('[data-current="true"]');
    const active = document.querySelector('[data-current="true"]');
    return ready
      && currentSlides.length === 1
      && active?.dataset.slide === expectedSlideId
      && active.querySelectorAll('[data-image-card]').length === 4;
  }, slideId, { timeout: 5000 }).then(() => null).catch((error) => error);
  if (!result) return;
  const activeSlide = await page.locator('[data-current="true"]').getAttribute('data-slide').catch(() => '');
  const status = await page.locator('[data-current="true"] [data-status]').innerText().catch(() => '');
  const cards = await page.locator('[data-current="true"] [data-image-card]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-image-card'))).catch(() => []);
  const slides = await page.locator('.slide').evaluateAll((nodes) => nodes.map((node) => ({
    id: node.getAttribute('data-slide'),
    current: node.getAttribute('data-current'),
    className: node.className,
    visible: getComputedStyle(node).visibility,
    display: getComputedStyle(node).display,
    opacity: getComputedStyle(node).opacity,
  }))).catch(() => []);
  const debug = await page.evaluate(() => window.__impeccableQuestionnaireDebug?.() || null).catch(() => null);
  throw new Error(`Expected ${slideId} with four image cards; active=${activeSlide}; cards=${cards.join(', ') || 'none'}; status=${status || 'none'}; debug=${JSON.stringify(debug)}; slides=${JSON.stringify(slides)}; last=${result.message}`);
}

async function waitForActiveTypeCards(page) {
  await page.waitForFunction(() => {
    const active = document.querySelector('[data-current="true"]');
    return active?.dataset.slide === 'typography'
      && active.querySelectorAll('[data-type-card]').length === 4;
  });
}

async function chooseImageCard(page, id) {
  await chooseCardByKeyboard(page, `[data-current="true"] [data-image-card="${cssEscape(id)}"]`);
}

async function chooseTypeCard(page, id) {
  await chooseCardByKeyboard(page, `[data-current="true"] [data-type-card="${cssEscape(id)}"]`);
}

async function chooseCardByKeyboard(page, selector) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await page.waitForFunction((targetSelector) => Boolean(document.querySelector(targetSelector)), selector, { timeout: 1200 });
      const card = page.locator(selector).first();
      await card.focus({ timeout: 1200 });
      await page.keyboard.press('Enter');
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(120);
    }
  }
  const activeSlide = await page.locator('[data-current="true"]').getAttribute('data-slide').catch(() => '');
  const cards = await page.locator('[data-current="true"] [data-image-card], [data-current="true"] [data-type-card]').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-image-card') || node.getAttribute('data-type-card'))
  )).catch(() => []);
  throw new Error(`Could not select card ${selector}; active=${activeSlide}; cards=${cards.join(', ') || 'none'}; last=${lastError?.message || 'unknown'}`);
}

async function waitForRuntimeEvent(handle, sessionId, predicate) {
  for (let i = 0; i < 12; i += 1) {
    const event = await handle.runtime.waitForEvent(sessionId, { timeoutMs: 2000 });
    if (predicate(event)) return event;
  }
  throw new Error('Expected runtime event was not received.');
}

async function expectNonBlank(page) {
  const text = await page.locator('body').innerText();
  assert.match(text, /What are we making\?/);
  const box = await page.locator('[data-current="true"]').boundingBox();
  assert.ok(box && box.width > 100 && box.height > 100, 'active slide should have visible bounds');
}

async function assertNoFirstSlideBack(page) {
  assert.equal(await page.locator('[data-current="true"] [data-prev]').count(), 0, 'first slide must not show Back');
}

async function assertNoChooseForMe(page) {
  assert.equal(await page.locator('[data-delegate]').count(), 0, 'Choose for me/delegate control should not render');
  assert.doesNotMatch(await page.locator('body').innerText(), /choose for me/i);
}

async function assertShortcutHint(page) {
  const hint = page.locator('[data-shortcut-hint]');
  await hint.waitFor({ state: 'visible' });
  const text = await hint.innerText();
  assert.match(text, /↑ BACK · ↓ NEXT · 1-4 SELECT · ENTER CONTINUE/i);
}

async function assertRecommendedDefault(page, expectedLabel) {
  const selected = page.locator('[data-current="true"] [data-option][aria-pressed="true"]').first();
  await selected.waitFor({ state: 'visible' });
  assert.match(await selected.innerText(), new RegExp(expectedLabel));
  assert.equal(await selected.locator('.recommended-badge').count(), 1, 'first selected option should show Recommended');
}

async function assertBrandSpecificTitle(page, brandName) {
  const title = await page.locator('[data-current="true"] h1').innerText();
  assert.match(title, new RegExp(brandName, 'i'), 'post-first-slide title should be brand-specific');
  assert.doesNotMatch(title, /^Who should feel seen\??$/i);
  assert.doesNotMatch(title, /^What should people trust\??$/i);
}

async function assertNumberKeySelects(page, number) {
  await page.keyboard.press(String(number));
  const selectedText = await page.locator('[data-current="true"] [data-option][aria-pressed="true"]').innerText();
  assert.match(selectedText, new RegExp(String(number) === '2' ? 'Quiet expertise|Small-batch care' : '.+'));
}

async function expectNextDialog(page, expectedMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Expected native alert: ${expectedMessage}`)), 5000);
    page.once('dialog', async (dialog) => {
      clearTimeout(timer);
      try {
        assert.equal(dialog.message(), expectedMessage);
        await dialog.accept();
        resolve(dialog.message());
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function captureActiveSlideScreenshot(page, screenshotDir, label) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-current="true"]');
    return el && Number(getComputedStyle(el).opacity) > 0.8;
  });
  const out = path.join(screenshotDir, `${label}.png`);
  const buffer = await page.locator('[data-current="true"]').screenshot({ path: out });
  assert.ok(buffer.byteLength > 6000, `${label} screenshot should contain visible pixels`);
  return out;
}

async function assertImageCardExpands(page, screenshotDir, label) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const activeSlideId = await page.locator('[data-current="true"]').getAttribute('data-slide');
  await page.locator('[data-current="true"] [data-image-expand]').first().click();
  await page.waitForFunction(() => {
    const modal = document.querySelector('[data-image-modal]');
    const img = document.querySelector('[data-image-modal-img]');
    return modal && !modal.hidden && img && img.complete && img.naturalWidth > 0;
  });
  await page.locator('[data-image-modal]').screenshot({ path: path.join(screenshotDir, `${label}.png`) });
  await page.locator('[data-image-modal-close]').click();
  await page.waitForFunction(() => document.querySelector('[data-image-modal]')?.hidden === true);
  await assertActiveSlide(page, activeSlideId);
}

async function assertImageCardClickSelectsWithoutModal(page, id) {
  const card = page.locator(`[data-current="true"] [data-image-card="${cssEscape(id)}"]`).first();
  await card.click({ position: { x: 18, y: 72 } });
  await page.waitForFunction((cardId) => {
    const cardNode = document.querySelector(`[data-current="true"] [data-image-card="${CSS.escape(cardId)}"]`);
    const modal = document.querySelector('[data-image-modal]');
    return cardNode?.getAttribute('aria-pressed') === 'true' && modal?.hidden === true;
  }, id);
}

async function assertSelectedCheckmarkVisible(page) {
  const check = page.locator('[data-current="true"] [data-image-card][aria-pressed="true"] .image-card-check').first();
  const box = await check.boundingBox();
  assert.ok(box && box.width >= 20 && box.height >= 20, 'selected image card should show a visible checked indicator');
}

async function assertTypeCardExpands(page, screenshotDir, label) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const activeSlideId = await page.locator('[data-current="true"]').getAttribute('data-slide');
  await page.locator('[data-current="true"] [data-type-expand]').first().click();
  await page.waitForFunction(() => {
    const modal = document.querySelector('[data-type-modal]');
    return modal && !modal.hidden && modal.querySelector('.type-heading-sample')?.textContent?.trim();
  });
  await page.locator('[data-type-modal]').screenshot({ path: path.join(screenshotDir, `${label}.png`) });
  await page.locator('[data-type-modal-close]').click();
  await page.waitForFunction(() => document.querySelector('[data-type-modal]')?.hidden === true);
  await assertActiveSlide(page, activeSlideId);
}

async function assertActiveSlide(page, expectedSlideId) {
  const result = await page.waitForFunction((slideId) => document.querySelector('[data-current="true"]')?.dataset.slide === slideId, expectedSlideId, { timeout: 2500 })
    .then(() => null)
    .catch((error) => error);
  if (!result) return;
  const activeSlides = await page.locator('[data-current="true"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-slide'))).catch(() => []);
  throw new Error(`Expected active slide ${expectedSlideId}; active=${activeSlides.join(', ') || 'none'}; last=${result.message}`);
}

async function assertImagesVisuallyRendered(page, label) {
  const result = await page.locator('[data-current="true"] [data-image-card] img').evaluateAll((imgs) => imgs.map((img) => ({
    width: img.naturalWidth,
    height: img.naturalHeight,
    complete: img.complete,
  })));
  assert.equal(result.length, 4, `${label} should render four images`);
  for (const image of result) {
    assert.ok(image.complete && image.width > 0 && image.height > 0, `${label} image should be loaded`);
  }
}

async function assertRouteFamiliesVisible(page) {
  const routeFamilies = await page.locator('[data-current="true"] .image-route').evaluateAll((items) => items.map((item) => item.textContent.trim()));
  assert.ok(routeFamilies.length >= 4);
  assert.ok(new Set(routeFamilies).size >= 3);
}

async function assertOptionCards(page, min) {
  await page.waitForFunction((minimum) => document.querySelectorAll('[data-current="true"] [data-option]').length >= minimum, min);
  assert.ok(await page.locator('[data-current="true"] [data-option]').count() >= min);
}

async function assertPaletteLabelsFit(page, viewportName) {
  const offenders = await page.locator('[data-current="true"] .swatch-name').evaluateAll((nodes) => nodes
    .map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        text: node.textContent,
        overflows: node.scrollWidth > Math.ceil(rect.width) + 1,
        wordBreak: getComputedStyle(node).wordBreak,
      };
    })
    .filter((item) => item.overflows || item.wordBreak === 'break-all'));
  assert.deepEqual(offenders, [], `${viewportName} palette labels should fit`);
}

async function assertNoTextOverflow(page, label) {
  const offenders = await page.locator('h1, .prompt, button, textarea, input, .image-label, .type-label, .swatch-name, [data-shortcut-hint]').evaluateAll((nodes) => nodes
    .map((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || rect.width <= 0 || rect.height <= 0) return null;
      return {
        text: node.textContent?.trim() || node.getAttribute('placeholder') || '',
        tag: node.tagName,
        overflows: node.scrollWidth > Math.ceil(rect.width) + 2,
      };
    })
    .filter(Boolean)
    .filter((item) => item.overflows && item.text));
  assert.deepEqual(offenders, [], `${label} should not have text overflow`);
}

function assertNoGeneratedIdentityFile(root) {
  assert.equal(fs.existsSync(path.join(root, 'IDENTITY.md')), false);
}

function dataUrlToBuffer(dataUrl) {
  return Buffer.from(String(dataUrl).split(',')[1] || '', 'base64');
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}
