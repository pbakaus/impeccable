import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { SAMPLE_INIT_TYPOGRAPHY } from './questionnaire-fixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INSTALLED_SKILL_DEST = path.join('.agents', 'skills', 'impeccable');
const INIT_OWNED_FILES = [
  'PRODUCT.md',
  'DESIGN.md',
  path.join('.impeccable', 'live', 'config.json'),
];
const VIDEO_SIZE = { width: 1280, height: 860 };

const DATASETS = [
  {
    slug: 'yana-hand-cream',
    brand: 'Yana',
    scenario: 'Hand cream brand for repaired hands without a medical-looking routine.',
    uploads: [
      testPng('yana-cream-jar.png', 'product-photo', 'Yana cream jar', 'f6eee5', '273a34'),
      testPng('yana-skin-texture.png', 'process-shot', 'skin texture', 'ead8c8', '4b3a30'),
      testPng('yana-review-card.png', 'testimonial', 'review card', 'fff8ec', '3b4a42'),
    ],
    initialIdea: 'Yana is a hand cream site for people whose hands feel dry from work, washing, and weather.',
    editedIdea: 'Yana is a hand cream brand for people who want repaired hands without a medical-looking routine.',
    differentiator: 'It absorbs quickly, protects the skin barrier, and feels calm enough to use all day.',
    differentiatorEdit: 'Yana absorbs quickly, protects the skin barrier, and feels calm enough to use after every wash.',
    trust: 'Skin barrier repair that still feels beautiful.',
    audience: 'Nurses, makers, parents, and anyone washing their hands constantly.',
    notFor: 'Not for glossy beauty drama, sticky luxury cream, or loud fragrance.',
    moreCues: 'More abstract and protective. Less spa. Add a soft barrier, skin rhythm, and one playful care cue.',
    paletteShift: 'Less beige, more fresh clinical green and soft human warmth.',
  },
  {
    slug: 'puppy-wear',
    brand: 'Puppy Wear',
    scenario: 'Soft protective puppy shoes for tiny paws in city conditions.',
    uploads: [
      testPng('puppy-walking.png', 'product-context', 'puppy walk', 'ecf7ff', '25394a'),
      testPng('tiny-shoe-detail.png', 'material-reference', 'tiny shoe', 'f5e7d4', '3e352c'),
      testPng('puppy-parent-review.png', 'review', 'owner review', 'fff6d8', '443a1c'),
    ],
    initialIdea: 'Puppy Wear is a puppy shoe brand for small dogs learning city walks.',
    editedIdea: 'Puppy Wear makes soft protective puppy shoes for tiny paws on hot pavement, rain, and apartment floors.',
    differentiator: 'The shoes are light, flexible, washable, and shaped for nervous first walks.',
    differentiatorEdit: 'The shoes stay light, flexible, and washable while helping nervous puppies accept their first walks.',
    trust: 'Gentle paw protection that does not make the puppy fight the shoe.',
    audience: 'New puppy owners who are anxious about comfort, fit, and pavement safety.',
    notFor: 'Not for costume fashion, stiff boots, or treating dogs like accessories.',
    moreCues: 'More playful but still premium. Add bounce, tiny paw geometry, soft rubber, and one charming character-like cue.',
    paletteShift: 'More joyful and clean. Keep trust, but avoid baby-blue pet-store clichés.',
  },
  {
    slug: 'supa-fresh',
    brand: 'Supa Fresh',
    scenario: 'Men’s deodorant for active daily routines and clean confidence.',
    uploads: [
      testPng('supa-deodorant-stick.png', 'product-photo', 'deo stick', 'e7f2ef', '102d2a'),
      testPng('supa-gym-context.png', 'product-context', 'gym context', 'dce8f2', '172433'),
      testPng('supa-review-card.png', 'review', 'clean review', 'f4f7ea', '2f3a2c'),
    ],
    initialIdea: 'Supa Fresh is a men’s deodorant site for guys who want to smell clean without overthinking it.',
    editedIdea: 'Supa Fresh is a men’s deodorant brand for active daily routines, built around clean confidence and no sticky residue.',
    differentiator: 'It gives all-day odor control with a dry feel, sharp scent, and no loud locker-room branding.',
    differentiatorEdit: 'Supa Fresh gives all-day odor control with a dry feel, sharp scent, and no performative locker-room energy.',
    trust: 'Reliable odor control that feels dry, clean, and not performative.',
    audience: 'Men who train, commute, date, work, and want one deodorant that just works.',
    notFor: 'Not for aggressive masculinity, axe-body-spray energy, or wellness-soft vagueness.',
    moreCues: 'More graphic and energetic. Add cold air, motion streaks, mineral dry texture, and one bold symbol route.',
    paletteShift: 'Sharper contrast, fresher greens or icy blues, but not generic gym-tech neon.',
  },
  {
    slug: 'insta-messaging',
    brand: 'Insta Messaging',
    scenario: 'Lightweight messaging app for close groups and private coordination.',
    uploads: [
      testPng('insta-phone-context.png', 'product-context', 'phone chat', 'eef3ff', '1f2a42'),
      testPng('insta-app-screenshot-reference.png', 'interface-reference', 'app screen', 'f4f1ff', '2b2448'),
      testPng('insta-user-review.png', 'testimonial', 'user review', 'eefaf8', '1d3d3a'),
    ],
    initialIdea: 'Insta Messaging is a messaging app for people who want quick conversations without feed noise.',
    editedIdea: 'Insta Messaging is a lightweight messaging app for close groups, fast replies, and private everyday coordination.',
    differentiator: 'It removes social feed pressure and keeps chats focused, searchable, and calm.',
    differentiatorEdit: 'It removes social feed pressure while keeping close-group chats fast, searchable, private, and calm.',
    trust: 'Privacy, speed, and clarity without turning messaging into social performance.',
    audience: 'Friends, families, and small teams who coordinate constantly but hate feed noise.',
    notFor: 'Not for public posting, vanity metrics, algorithmic feeds, or noisy creator tools.',
    moreCues: 'More abstract and digital. Add signal flow, message bubbles without UI mockups, private rooms, and motion trails.',
    paletteShift: 'More alive and social, but avoid Instagram gradients, purple-blue SaaS, and dark terminal vibes.',
  },
  {
    slug: 'keio-flower-shop',
    brand: 'Keio Flower Shop',
    scenario: 'Local florist site for seasonal arrangements and same-day pickup.',
    uploads: [
      testPng('keio-bouquet.png', 'product-photo', 'bouquet', 'f8e8ec', '3f2b35'),
      testPng('keio-shop-window.png', 'product-context', 'shop window', 'eef4e9', '263828'),
      testPng('keio-delivery-note.png', 'testimonial', 'delivery note', 'fff7e0', '4a3c20'),
    ],
    initialIdea: 'Keio Flower Shop is a neighborhood flower shop site for seasonal bouquets and same-day gifts.',
    editedIdea: 'Keio Flower Shop is a local florist site for seasonal arrangements, quiet gifts, and easy same-day pickup.',
    differentiator: 'Every bouquet is seasonal, balanced by hand, and made to feel specific to the recipient.',
    differentiatorEdit: 'Every bouquet is seasonal, hand-balanced, and adjusted so the gift feels specific to the recipient.',
    trust: 'Fresh flowers, honest substitutions, and arrangements that look hand-composed.',
    audience: 'People buying flowers for birthdays, apologies, home tables, and small rituals.',
    notFor: 'Not for plastic-looking arrangements, wedding-luxury excess, or cheap delivery sameness.',
    moreCues: 'More poetic but not vintage. Add petal rhythm, paper wrap, morning shop light, and one graphic floral cue.',
    paletteShift: 'More seasonal and memorable. Avoid beige florist minimalism and overly pink romance.',
  },
];

describe('recorded live Flux $impeccable init journeys', () => {
  it('records five full user-like journeys with live Flux and per-run artifacts', async (t) => {
    if (process.env.IMPECCABLE_INIT_RECORDING_LIVE !== '1') {
      t.skip('Set IMPECCABLE_INIT_RECORDING_LIVE=1 to run the expensive live Flux recording suite.');
      return;
    }

    const imageProviderMode = recordingImageProviderMode();
    const imageApiKey = imageProviderMode === 'flux' ? resolveImageApiKey() : '';
    const builtInSheets = imageProviderMode === 'builtin' ? resolveBuiltInSheets() : null;
    if (imageProviderMode === 'flux' && !imageApiKey) {
      t.skip('IMAGE_API_KEY is required for the live Flux recording suite.');
      return;
    }

    const browser = await launchBrowserOrSkip(t);
    if (!browser) return;
    t.after(() => browser.close());

    const ffmpeg = findBinary('ffmpeg');
    const ffprobe = findBinary('ffprobe');
    if (!ffmpeg || !ffprobe) {
      t.skip('ffmpeg and ffprobe are required to convert and validate Playwright WebM video as MP4.');
      return;
    }

    const selectedDatasets = selectedRecordingDatasets();
    const produced = [];
    for (const dataset of selectedDatasets) {
      produced.push(await runDatasetJourney({ browser, ffmpeg, ffprobe, dataset, imageApiKey, imageProviderMode, builtInSheets }));
    }

    assert.equal(produced.length, selectedDatasets.length);
    for (const artifactDir of produced) {
      for (const required of [
        'journey.mp4',
        'manifest.json',
        'test-data.md',
        'test-data.json',
        'asset-manifest.json',
        'PRODUCT.md',
        'DESIGN.md',
        'init-config.json',
        'session-state.json',
      ]) {
        assert.equal(fs.existsSync(path.join(artifactDir, required)), true, `${required} should exist in ${artifactDir}`);
      }
      const brandExists = fs.existsSync(path.join(artifactDir, 'BRAND.md'))
        || fs.existsSync(path.join(artifactDir, 'BRAND.next.md'));
      assert.equal(brandExists, true, `BRAND.md or BRAND.next.md should exist in ${artifactDir}`);
      const promptPrefix = imageProviderMode === 'builtin' ? 'builtin-prompts' : 'flux-prompts';
      for (const required of [
        `${promptPrefix}-visual-cues.md`,
        `${promptPrefix}-visual-cues.json`,
        `${promptPrefix}-palettes.md`,
        `${promptPrefix}-palettes.json`,
      ]) {
        assert.equal(fs.existsSync(path.join(artifactDir, required)), true, `${required} should exist in ${artifactDir}`);
      }
    }
  });
});

async function runDatasetJourney({ browser, ffmpeg, ffprobe, dataset, imageApiKey, imageProviderMode, builtInSheets }) {
  const runId = `${dataset.slug}-${Date.now().toString(36)}`;
  const artifactPrefix = imageProviderMode === 'builtin' ? 'live-builtin' : 'live-flux';
  const artifactDir = path.join(ROOT, '.impeccable', 'init', 'recordings', `${artifactPrefix}-${runId}`);
  const screenshotsDir = path.join(artifactDir, 'screenshots');
  const uploadArtifactDir = path.join(artifactDir, 'uploads');
  const rawVideoDir = path.join(artifactDir, 'raw-video');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `impeccable-init-live-${dataset.slug}-`));
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(uploadArtifactDir, { recursive: true });
  fs.mkdirSync(rawVideoDir, { recursive: true });

  let server = null;
  let context = null;

  try {
    copyReplicaRepo(ROOT, workspace);
    seedInitOwnedFilesFromHead(workspace);
    deleteInitOwnedFiles(workspace);
    fs.mkdirSync(path.join(workspace, '.impeccable'), { recursive: true });
    if (imageProviderMode === 'flux') {
      fs.writeFileSync(path.join(workspace, '.impeccable', '.env'), `IMAGE_API_KEY=${imageApiKey}\n`);
    }

    const assetManifest = await downloadUploadAssets(dataset, uploadArtifactDir);
    writeFixtureDocs({ dataset, artifactDir, assetManifest, imageProviderMode, builtInSheets });
    const agent = createRecordingAgent({ dataset, artifactDir, assetManifest, imageProviderMode, builtInSheets });

    server = spawn(process.execPath, [
      path.join(INSTALLED_SKILL_DEST, 'scripts', 'questionnaire', 'init-questionnaire.mjs'),
      '--prompt',
      `$impeccable init ${dataset.brand}`,
    ], {
      cwd: workspace,
      env: {
        ...process.env,
        IMAGE_API_KEY: imageProviderMode === 'flux' ? imageApiKey : '',
        IMPECCABLE_IMAGE_API_KEY: imageProviderMode === 'flux' ? (process.env.IMPECCABLE_IMAGE_API_KEY || '') : '',
        BFL_API_KEY: imageProviderMode === 'flux' ? (process.env.BFL_API_KEY || '') : '',
        FLUX_API_KEY: imageProviderMode === 'flux' ? (process.env.FLUX_API_KEY || '') : '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const startup = await readStartupJson(server);

    context = await browser.newContext({
      viewport: VIDEO_SIZE,
      reducedMotion: 'no-preference',
      recordVideo: {
        dir: rawVideoDir,
        size: VIDEO_SIZE,
      },
    });
    const page = await context.newPage();
    if (imageProviderMode === 'builtin') {
      page.on('dialog', async (dialog) => {
        agent.log.push({
          kind: 'browser-dialog',
          message: dialog.message(),
          capturedAt: new Date().toISOString(),
        });
        await dialog.accept();
      });
    }
    await page.goto(startup.url, { waitUntil: 'domcontentloaded' });
    await installVisibleCursor(page);
    await page.mouse.move(VIDEO_SIZE.width / 2, VIDEO_SIZE.height / 2);
    await expectCurrentSlide(page, 'product-overview');
    await assertNoLiveConfig(workspace);
    await recordCurrentSlideContent(page, agent, 'static-first-slide');

    await capturePage(page, path.join(screenshotsDir, '01-first-slide.png'));
    await humanType(page, '[data-current="true"] [data-answer-text]', dataset.initialIdea);
    await capturePage(page, path.join(screenshotsDir, '02-first-slide-typed.png'));
    await clickContinueAndPatch({ page, workspace, sessionId: startup.sessionId, slideId: 'product-overview', nextSlideId: 'assets', agent });
    await recordCurrentSlideContent(page, agent, 'assets-from-initial-idea');
    await capturePage(page, path.join(screenshotsDir, '03-assets-empty.png'));

    await humanClick(page, '[data-current="true"] [data-prev]');
    await expectCurrentSlide(page, 'product-overview');
    await page.waitForTimeout(1400);
    await replaceText(page, '[data-current="true"] [data-answer-text]', dataset.editedIdea);
    await clickContinueAndPatch({ page, workspace, sessionId: startup.sessionId, slideId: 'product-overview', nextSlideId: 'assets', agent });
    await recordCurrentSlideContent(page, agent, 'assets-after-edited-idea');

    await uploadFilesHuman(page, assetManifest.map((asset) => asset.localPath));
    await page.waitForTimeout(2600);
    await capturePage(page, path.join(screenshotsDir, '04-assets-uploaded.png'));
    await clickContinueAndPatch({ page, workspace, sessionId: startup.sessionId, slideId: 'assets', nextSlideId: 'differentiator', agent });
    await recordCurrentSlideContent(page, agent, 'differentiator-after-uploads');
    await capturePage(page, path.join(screenshotsDir, '05-differentiator.png'));

    await humanType(page, '[data-current="true"] [data-answer-text]', dataset.differentiator);
    await clickContinueAndPatch({ page, workspace, sessionId: startup.sessionId, slideId: 'differentiator', nextSlideId: 'trust', agent });
    await recordCurrentSlideContent(page, agent, 'trust-from-first-differentiator');
    await pauseThenBack(page, 'differentiator');
    await replaceText(page, '[data-current="true"] [data-answer-text]', dataset.differentiatorEdit);
    await clickContinueAndPatch({ page, workspace, sessionId: startup.sessionId, slideId: 'differentiator', nextSlideId: 'trust', agent });
    await recordCurrentSlideContent(page, agent, 'trust-after-edited-differentiator');
    await capturePage(page, path.join(screenshotsDir, '06-trust.png'));

    await exerciseChoiceSlide({ page, workspace, sessionId: startup.sessionId, dataset, slideId: 'trust', nextSlideId: 'audience-fit', customValue: dataset.trust, agent, screenshotsDir });
    await exerciseChoiceSlide({ page, workspace, sessionId: startup.sessionId, dataset, slideId: 'audience-fit', nextSlideId: 'anti-audience', customValue: dataset.audience, agent, screenshotsDir });

    await assertShortcutHint(page);
    await exerciseAntiAudienceToVisualCues({ page, workspace, sessionId: startup.sessionId, dataset, agent, screenshotsDir });
    await exerciseVisualCues({ page, workspace, sessionId: startup.sessionId, dataset, screenshotsDir, agent });
    await exercisePalette({ page, workspace, sessionId: startup.sessionId, dataset, screenshotsDir, agent });
    await exerciseTypographyAndFinish({ page, workspace, sessionId: startup.sessionId, dataset, screenshotsDir, agent });

    await context.close();
    context = null;
    const webmPath = await page.video().path();
    const mp4Path = path.join(artifactDir, 'journey.mp4');
    convertWebmToMp4({ ffmpeg, webmPath, mp4Path });
    validateMp4({ ffprobe, mp4Path });

    writeSlideContentLog(agent);
    copyOutputs({ workspace, artifactDir, sessionId: startup.sessionId, startup, assetManifest });
    assert.equal(fs.existsSync(path.join(workspace, '.impeccable', 'live', 'config.json')), false, 'init must not recreate .impeccable/live/config.json');
    return artifactDir;
  } finally {
    if (context) await context.close().catch(() => {});
    if (server) await stopProcess(server);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

async function exerciseChoiceSlide({ page, workspace, sessionId, dataset, slideId, nextSlideId, customValue, agent, screenshotsDir }) {
  await expectCurrentSlide(page, slideId);
  await assertRecommendedSelected(page);
  await page.keyboard.press('2');
  await page.waitForTimeout(500);
  await clickContinueAndPatch({ page, workspace, sessionId, slideId, nextSlideId, agent });
  await recordCurrentSlideContent(page, agent, `${nextSlideId}-from-number-key`);
  await pauseThenBack(page, slideId);
  await humanType(page, '[data-current="true"] [data-answer-text]', customValue);
  await page.keyboard.press('Enter');
  await pollAndReplySlide({ workspace, sessionId, expectedSlideId: slideId, nextSlideId, agent });
  await expectCurrentSlide(page, nextSlideId);
  await recordCurrentSlideContent(page, agent, `${nextSlideId}-from-custom-input`);
  await capturePage(page, path.join(screenshotsDir, `${screenshotOrder(agent)}-${nextSlideId}.png`));
}

async function exerciseAntiAudienceToVisualCues({ page, workspace, sessionId, dataset, agent, screenshotsDir }) {
  await expectCurrentSlide(page, 'anti-audience');
  await assertRecommendedSelected(page);
  await page.keyboard.press('2');
  await clickContinueAndPatch({ page, workspace, sessionId, slideId: 'anti-audience', nextSlideId: 'visual-cues', agent });
  await recordCurrentSlideContent(page, agent, 'visual-cues-from-number-key');
  await pauseThenBack(page, 'anti-audience');
  await humanType(page, '[data-current="true"] [data-answer-text]', dataset.notFor);
  await page.keyboard.press('Enter');
  await pollAndReplySlide({ workspace, sessionId, expectedSlideId: 'anti-audience', nextSlideId: 'visual-cues', agent });
  await expectCurrentSlide(page, 'visual-cues');
  await recordCurrentSlideContent(page, agent, 'visual-cues-from-custom-anti-goal');
  await capturePage(page, path.join(screenshotsDir, `${screenshotOrder(agent)}-visual-cues-loading.png`));
}

async function exerciseVisualCues({ page, workspace, sessionId, dataset, screenshotsDir, agent }) {
  await waitForLiveImageCards(page, workspace, sessionId, 'visual-cues', 'initial cue batch');
  await capturePage(page, path.join(screenshotsDir, `${screenshotOrder(agent)}-visual-cues-live.png`));
  await selectCardByIndex(page, '[data-image-card]', 0);
  await capturePage(page, path.join(screenshotsDir, `${screenshotOrder(agent)}-visual-cue-one-selected.png`));
  await humanClick(page, '[data-current="true"] [data-next]');
  await page.waitForFunction(() => /at least 2/i.test(document.querySelector('[data-current="true"] [data-status]')?.textContent || ''));
  await expandAndClose(page, '[data-image-expand]', '[data-image-modal]', '[data-image-modal-close]', path.join(screenshotsDir, `${screenshotOrder(agent)}-visual-cue-modal.png`));
  await selectCardByIndex(page, '[data-image-card]', 1);
  await ensureSelectedCards(page, '[data-image-card]', [0, 1], 2);
  await continueImageSlideWithAgent({ page, workspace, sessionId, agent, slideId: 'visual-cues', nextSlideId: 'palette' });
  await recordCurrentSlideContent(page, agent, 'palette-from-first-cue-pair');
  await waitForLiveImageCards(page, workspace, sessionId, 'palette', 'first palette batch');

  await pauseThenBack(page, 'visual-cues');
  await selectCardByIndex(page, '[data-image-card]', 0);
  await selectCardByIndex(page, '[data-image-card]', 2);
  await ensureSelectedCards(page, '[data-image-card]', [0, 2], 2);
  await continueImageSlideWithAgent({ page, workspace, sessionId, agent, slideId: 'visual-cues', nextSlideId: 'palette' });
  await recordCurrentSlideContent(page, agent, 'palette-from-changed-cue-pair');
  await waitForLiveImageCards(page, workspace, sessionId, 'palette', 'second palette batch');

  await pauseThenBack(page, 'visual-cues');
  const oldCueIds = await currentImageCardIds(page);
  const moreCueRequest = await requestMoreImagesAndWait({
    page,
    workspace,
    sessionId,
    slideId: 'visual-cues',
    text: dataset.moreCues,
    label: 'more visual cue request',
    loadingScreenshotPath: path.join(screenshotsDir, `${screenshotOrder(agent)}-visual-cues-regenerating.png`),
  });
  await waitForLiveImageCards(page, workspace, sessionId, 'visual-cues', 'more cue batch', { previousIds: oldCueIds, batchId: moreCueRequest.batchId });
  await capturePage(page, path.join(screenshotsDir, `${screenshotOrder(agent)}-visual-cues-more.png`));
  await selectCardByIndex(page, '[data-image-card]', 0);
  await humanClick(page, '[data-current="true"] [data-next]');
  await page.waitForFunction(() => /at least 2/i.test(document.querySelector('[data-current="true"] [data-status]')?.textContent || ''));
  await selectCardByIndex(page, '[data-image-card]', 1);
  await ensureSelectedCards(page, '[data-image-card]', [0, 1], 2);
  await continueImageSlideWithAgent({ page, workspace, sessionId, agent, slideId: 'visual-cues', nextSlideId: 'palette' });
  await recordCurrentSlideContent(page, agent, 'palette-from-regenerated-cues');
}

async function exercisePalette({ page, workspace, sessionId, dataset, screenshotsDir, agent }) {
  await waitForLiveImageCards(page, workspace, sessionId, 'palette', 'palette batch after cue changes');
  await capturePage(page, path.join(screenshotsDir, `${screenshotOrder(agent)}-palette-live.png`));
  await selectCardByIndex(page, '[data-image-card]', 0);
  await expandAndClose(page, '[data-image-expand]', '[data-image-modal]', '[data-image-modal-close]', path.join(screenshotsDir, `${screenshotOrder(agent)}-palette-modal.png`));
  const oldPaletteIds = await currentImageCardIds(page);
  const paletteShiftRequest = await requestMoreImagesAndWait({
    page,
    workspace,
    sessionId,
    slideId: 'palette',
    text: dataset.paletteShift,
    label: 'palette shift request',
    loadingScreenshotPath: path.join(screenshotsDir, `${screenshotOrder(agent)}-palette-regenerating.png`),
  });
  await waitForLiveImageCards(page, workspace, sessionId, 'palette', 'shifted palette batch', { previousIds: oldPaletteIds, batchId: paletteShiftRequest.batchId });
  await capturePage(page, path.join(screenshotsDir, `${screenshotOrder(agent)}-palette-shifted.png`));
  await selectCardByIndex(page, '[data-image-card]', 1);
  await page.waitForFunction((batchId) => {
    const selected = Array.from(document.querySelectorAll('[data-current="true"] [data-image-card][aria-selected="true"]'));
    return selected.length === 1 && selected[0].getAttribute('data-image-batch') === batchId;
  }, paletteShiftRequest.batchId, { timeout: 30000 });
  await continueImageSlideWithAgent({ page, workspace, sessionId, agent, slideId: 'palette', nextSlideId: 'typography' });
  await recordCurrentSlideContent(page, agent, 'typography-from-shifted-palette');
  const typographyRequest = await pollUntil(workspace, sessionId, (event) => event.type === 'typography_request', 'typography request');
  await reply(workspace, {
    action: 'typography_batch',
    sessionId,
    slideId: 'typography',
    batchId: typographyRequest.batchId,
    fontSets: SAMPLE_INIT_TYPOGRAPHY.map((fontSet) => ({
      ...fontSet,
      label: `${dataset.brand} ${fontSet.label}`,
      sampleHeading: `${dataset.brand} feels considered.`,
    })),
  });
  await expectCurrentSlide(page, 'typography');
  await capturePage(page, path.join(screenshotsDir, `${screenshotOrder(agent)}-typography-live.png`));
}

async function exerciseTypographyAndFinish({ page, workspace, sessionId, screenshotsDir, agent }) {
  await page.waitForFunction(() => document.querySelectorAll('[data-current="true"] [data-type-card]').length === 4);
  await selectCardByIndex(page, '[data-type-card]', 0);
  await expandAndClose(page, '[data-type-expand]', '[data-type-modal]', '[data-type-modal-close]', path.join(screenshotsDir, `${screenshotOrder(agent)}-typography-modal.png`));
  await clickContinueOnly(page, 'typography');
  await page.waitForFunction(() => /Wrote PRODUCT\.md|Staged/.test(document.querySelector('[data-current="true"] [data-status]')?.textContent || ''), { timeout: 30000 });
  await capturePage(page, path.join(screenshotsDir, `${screenshotOrder(agent)}-finished.png`));
  await pollUntil(workspace, sessionId, (event) => event.type === 'complete', 'complete event');
}

function selectedRecordingDatasets() {
  const filter = String(process.env.IMPECCABLE_INIT_RECORDING_DATASET || '').trim();
  if (!filter) return DATASETS;
  const wanted = new Set(filter.split(',').map((item) => item.trim()).filter(Boolean));
  const selected = DATASETS.filter((dataset) => wanted.has(dataset.slug) || wanted.has(dataset.brand));
  assert.ok(selected.length > 0, `No recording dataset matched IMPECCABLE_INIT_RECORDING_DATASET=${filter}`);
  return selected;
}

function recordingImageProviderMode() {
  const value = String(process.env.IMPECCABLE_INIT_RECORDING_PROVIDER || 'flux').trim().toLowerCase();
  if (['builtin', 'built-in', 'codex', 'codex-built-in', 'builtin-quadrant'].includes(value)) return 'builtin';
  if (value === 'flux' || value === '') return 'flux';
  throw new Error(`Unsupported IMPECCABLE_INIT_RECORDING_PROVIDER=${value}`);
}

function resolveBuiltInSheets() {
  const visualCues = path.resolve(process.env.IMPECCABLE_INIT_BUILTIN_CUE_SHEET || '');
  const palette = path.resolve(process.env.IMPECCABLE_INIT_BUILTIN_PALETTE_SHEET || '');
  assert.ok(process.env.IMPECCABLE_INIT_BUILTIN_CUE_SHEET, 'IMPECCABLE_INIT_BUILTIN_CUE_SHEET is required for built-in recording mode.');
  assert.ok(process.env.IMPECCABLE_INIT_BUILTIN_PALETTE_SHEET, 'IMPECCABLE_INIT_BUILTIN_PALETTE_SHEET is required for built-in recording mode.');
  assert.equal(fs.existsSync(visualCues), true, `Built-in cue sheet is missing: ${visualCues}`);
  assert.equal(fs.existsSync(palette), true, `Built-in palette sheet is missing: ${palette}`);
  return { visualCues, palette };
}

function createRecordingAgent({ dataset, artifactDir, assetManifest, imageProviderMode = 'flux', builtInSheets = null }) {
  return {
    dataset,
    artifactDir,
    assetManifest,
    imageProviderMode,
    builtInSheets,
    log: [],
    slidePatch(slideId, event) {
      const patch = slidePatch(dataset, slideId, event?.answers || {}, assetManifest);
      assertDynamicSlidePatch({ dataset, slideId, patch, event });
      this.log.push({
        kind: 'agent-payload',
        slideId,
        triggeredBy: event?.slideId || null,
        answerValue: event?.answer?.value || null,
        title: patch.title || '',
        prompt: patch.prompt || '',
        placeholder: patch.placeholder || patch.requestPlaceholder || patch.uploadNote || '',
        options: (patch.options || []).map((option) => ({
          label: option.label,
          value: option.value,
          hint: option.hint || '',
        })),
        createdAt: new Date().toISOString(),
      });
      writeSlideContentLog(this);
      return patch;
    },
  };
}

function slidePatch(dataset, slideId, answers = {}, assetManifest = []) {
  const ctx = initContextFromAnswers(dataset, answers, assetManifest);
  const commonOptions = (recommendedValue, alternatives) => [
    { label: shortOptionLabel(recommendedValue), value: recommendedValue, hint: recommendedHintFor(slideId, ctx) },
    ...alternatives.map((item) => ({
      label: shortOptionLabel(item.value || item),
      value: item.value || item,
      hint: item.hint || '',
    })),
  ];
  const patches = {
    assets: {
      title: `What proof does ${dataset.brand} have?`,
      prompt: `Add photos, fit details, reviews, process shots, GIFs, or MP4s that help explain: ${ctx.product}.`,
      uploadNote: 'Local files stay on this machine; GIFs are best for quick review.',
    },
    differentiator: {
      title: `What makes ${dataset.brand} work?`,
      prompt: `After the ${ctx.assetRoles || 'uploaded material'}, what should feel meaningfully different?`,
      placeholder: dataset.differentiator,
    },
    trust: {
      title: `What should ${ctx.trustAudience} trust first?`,
      prompt: `Use the differentiator: ${ctx.differentiator}. Choose the proof ${dataset.brand} should make obvious.`,
      placeholder: `Or write the trust signal ${dataset.brand} needs.`,
      options: commonOptions(dataset.trust, [
        { value: `${dataset.brand} shows comfort and movement honestly.`, hint: 'Good when fit anxiety is the purchase blocker.' },
        { value: `${dataset.brand} makes care feel practical, not precious.`, hint: 'Good when daily use matters more than novelty.' },
        { value: `${dataset.brand} proves the product with real owner evidence.`, hint: 'Good when reviews and demos should lead.' },
      ]),
    },
    'audience-fit': {
      title: `Who needs ${dataset.brand} most?`,
      prompt: `Think about who hears "${ctx.trust}" and immediately feels less worried.`,
      placeholder: `Or write the audience in your own words.`,
      options: commonOptions(dataset.audience, [
        { value: `People who need reassurance before choosing ${dataset.brand}.`, hint: 'They need proof before style.' },
        { value: `People comparing comfort, fit, and daily care quickly.`, hint: 'They scan for practical signals.' },
        { value: `People who want usefulness without making the product feel ugly.`, hint: 'They care about both taste and proof.' },
      ]),
    },
    'anti-audience': {
      title: `What should ${dataset.brand} refuse?`,
      prompt: `${ctx.audience} should not mistake this for the wrong kind of brand. Choose the line to avoid.`,
      placeholder: `Or write the anti-goals yourself.`,
      options: commonOptions(dataset.notFor, [
        { value: `${dataset.brand} should avoid generic category clichés.`, hint: 'Do not look copied from the category.' },
        { value: `${dataset.brand} should not overpromise or fake authority.`, hint: 'Confidence should come from evidence.' },
        { value: `${dataset.brand} should avoid visual drama that breaks trust.`, hint: 'Keep the design expressive but credible.' },
      ]),
    },
    'visual-cues': {
      title: `What should ${dataset.brand} carry visually?`,
      prompt: `Use ${ctx.trust}, ${ctx.audience}, ${ctx.antiAudience}, and ${ctx.assetRoles || 'the uploaded material'} to choose 2-4 cue cards.`,
      requestPlaceholder: dataset.moreCues,
    },
    palette: {
      title: `Which colors fit ${dataset.brand}?`,
      prompt: `Build from the selected cue cards, ${ctx.trust}, and the line to avoid: ${ctx.antiAudience}. Choose one palette.`,
      requestPlaceholder: dataset.paletteShift,
    },
    typography: {
      title: `Which type fits ${dataset.brand}?`,
      prompt: `Pick the type voice that can carry ${ctx.trust} for ${ctx.audience} without drifting into ${ctx.antiAudience}.`,
      requestPlaceholder: 'More distinctive, still readable. Show another designer-quality type route.',
    },
  };
  return patches[slideId] || {};
}

function initContextFromAnswers(dataset, answers = {}, assetManifest = []) {
  const product = answerValue(answers['product-overview']) || dataset.editedIdea || dataset.initialIdea;
  const differentiator = answerValue(answers.differentiator) || dataset.differentiatorEdit || dataset.differentiator;
  const trust = answerValue(answers.trust) || dataset.trust;
  const audience = answerValue(answers['audience-fit']) || dataset.audience;
  const antiAudience = answerValue(answers['anti-audience']) || dataset.notFor;
  const assetRoles = assetManifest.map((asset) => `${asset.role} ${asset.name}`).join(', ');
  return {
    product,
    differentiator,
    trust,
    audience,
    antiAudience,
    assetRoles,
    trustAudience: audience
      .replace(/^new\s+/i, '')
      .replace(/\s+who\b.*$/i, '')
      .replace(/,.*/, '')
      .trim() || `${dataset.brand} buyers`,
  };
}

function answerValue(answer) {
  if (!answer || typeof answer !== 'object') return '';
  for (const candidate of [answer.freeform, answer.value, answer.label]) {
    if (Array.isArray(candidate)) continue;
    const text = String(candidate || '').trim();
    if (!text) continue;
    if (/^(recommended|route\s+\d+|option\s+\d+)$/i.test(text)) continue;
    return text;
  }
  return '';
}

function shortOptionLabel(value) {
  const text = String(value || '').replace(/^Not for\s+/i, 'No ').trim();
  const words = text.split(/\s+/).slice(0, 5).join(' ');
  return words.replace(/[.,;:]$/, '') || 'Recommended route';
}

function recommendedHintFor(slideId, ctx) {
  if (slideId === 'trust') return `Directly follows: ${truncate(ctx.differentiator, 80)}`;
  if (slideId === 'audience-fit') return `Most likely to care about: ${truncate(ctx.trust, 80)}`;
  if (slideId === 'anti-audience') return `Protects the brand from the wrong read.`;
  return '';
}

function assertDynamicSlidePatch({ dataset, slideId, patch, event }) {
  assert.ok(patch.title, `${slideId} needs an agent title`);
  const combined = `${patch.title} ${patch.prompt || ''} ${patch.placeholder || ''} ${patch.requestPlaceholder || ''} ${(patch.options || []).map((option) => `${option.label} ${option.value} ${option.hint || ''}`).join(' ')}`;
  assert.doesNotMatch(patch.title, /^(What do we already have|What makes it special|What should people trust|Who should feel seen|Who is this not for|What should it carry visually|Which colors feel true|Which type feels right)\??$/i);
  if (slideId !== 'assets') {
    assert.match(combined, new RegExp(dataset.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `${slideId} should mention the brand`);
  }
  const contextNeedles = [dataset.brand, 'puppy', 'paw', 'comfort', 'fit', 'walk', 'protection', 'trust'];
  if (dataset.slug === 'puppy-wear') {
    assert.ok(contextNeedles.some((needle) => combined.toLowerCase().includes(needle)), `${slideId} should carry Puppy context: ${combined}`);
  }
  if (event?.answers && slideId === 'visual-cues') {
    assert.match(combined, /costume|stiff|accessories|paw|comfort|fit/i);
  }
  if (event?.answers && slideId === 'palette') {
    assert.match(combined, /cue|trust|avoid|costume|stiff|accessories/i);
  }
}

function truncate(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function screenshotOrder(agent) {
  agent.screenshotIndex = (agent.screenshotIndex || 6) + 1;
  return String(agent.screenshotIndex).padStart(2, '0');
}

async function recordCurrentSlideContent(page, agent, note) {
  const snapshot = await page.evaluate(() => {
    const active = document.querySelector('[data-current="true"]');
    return {
      slideId: active?.dataset.slide || '',
      title: active?.querySelector('h1')?.textContent?.trim() || '',
      prompt: active?.querySelector('.prompt')?.textContent?.trim() || '',
      placeholder: active?.querySelector('[data-answer-text], [data-image-request-input], [data-type-request-input]')?.getAttribute('placeholder') || '',
      options: Array.from(active?.querySelectorAll('[data-option], [data-suggestion]') || []).map((option) => ({
        label: option.textContent.replace(/\s+/g, ' ').trim(),
        value: option.getAttribute('data-option') || option.getAttribute('data-suggestion') || '',
        selected: option.getAttribute('aria-pressed') === 'true',
      })),
      cards: Array.from(active?.querySelectorAll('[data-image-card], [data-type-card]') || []).map((card) => ({
        label: card.querySelector('.image-label, .type-label')?.textContent?.trim() || '',
        selected: card.getAttribute('aria-selected') === 'true',
        batchId: card.getAttribute('data-image-batch') || '',
      })),
    };
  });
  agent.log.push({
    kind: 'browser-slide',
    note,
    ...snapshot,
    capturedAt: new Date().toISOString(),
  });
  writeSlideContentLog(agent);
}

function writeSlideContentLog(agent) {
  fs.mkdirSync(agent.artifactDir, { recursive: true });
  fs.writeFileSync(path.join(agent.artifactDir, 'slide-content-log.json'), `${JSON.stringify(agent.log, null, 2)}\n`);
  fs.writeFileSync(path.join(agent.artifactDir, 'slide-content-log.md'), [
    `# ${agent.dataset.brand} Slide Content Log`,
    '',
    `Scenario: ${agent.dataset.scenario}`,
    '',
    ...agent.log.map((entry, index) => {
      if (entry.kind === 'agent-payload') {
        return [
          `## ${index + 1}. Agent payload: ${entry.slideId}`,
          '',
          `- Triggered by: ${entry.triggeredBy || 'n/a'}`,
          `- Answer: ${formatLogValue(entry.answerValue)}`,
          `- Title: ${entry.title}`,
          `- Prompt: ${entry.prompt}`,
          entry.placeholder ? `- Placeholder/request: ${entry.placeholder}` : '',
          ...(entry.options || []).map((option, optionIndex) => `- Option ${optionIndex + 1}: ${option.label} — ${option.value}${option.hint ? ` (${option.hint})` : ''}`),
        ].filter(Boolean).join('\n');
      }
      return [
        `## ${index + 1}. Browser slide: ${entry.slideId}`,
        '',
        `- Note: ${entry.note}`,
        `- Title: ${entry.title}`,
        `- Prompt: ${entry.prompt}`,
        entry.placeholder ? `- Placeholder/request: ${entry.placeholder}` : '',
        ...(entry.options || []).map((option, optionIndex) => `- Option ${optionIndex + 1}: ${option.label} — ${option.value}${option.selected ? ' [selected]' : ''}`),
        ...(entry.cards || []).map((card, cardIndex) => `- Card ${cardIndex + 1}: ${card.label}${card.selected ? ' [selected]' : ''}`),
      ].filter(Boolean).join('\n');
    }),
    '',
  ].join('\n\n'));
}

function formatLogValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value || 'n/a');
}

async function clickContinueAndPatch({ page, workspace, sessionId, slideId, nextSlideId, agent, patch }) {
  await clickContinueOnly(page, slideId);
  if (patch !== null) await pollAndReplySlide({ workspace, sessionId, expectedSlideId: slideId, nextSlideId, agent, patch });
  await expectCurrentSlide(page, nextSlideId);
}

async function pollAndReplySlide({ workspace, sessionId, expectedSlideId, nextSlideId, agent, patch }) {
  const event = await pollUntil(workspace, sessionId, (item) => item.type === 'answer' && item.slideId === expectedSlideId, `${expectedSlideId} answer`);
  assert.equal(event.nextSlideId, nextSlideId);
  const resolvedPatch = patch || agent.slidePatch(nextSlideId, event);
  await reply(workspace, {
    action: 'update_slide',
    sessionId,
    slideId: nextSlideId,
    patch: resolvedPatch,
  });
}

async function continueImageSlideWithAgent({ page, workspace, sessionId, agent, slideId, nextSlideId }) {
  await clickContinueOnly(page, slideId);
  await pollAndReplySlide({ workspace, sessionId, expectedSlideId: slideId, nextSlideId, agent });
  await expectCurrentSlide(page, nextSlideId);
}

async function clickContinueOnly(page, expectedSlideId) {
  const responsePromise = page.waitForResponse((response) => (
    response.url().includes('/api/answer')
      && response.request().method() === 'POST'
      && response.request().postDataJSON()?.slideId === expectedSlideId
  ), { timeout: 120000 });
  await humanClick(page, `[data-slide="${cssEscape(expectedSlideId)}"][data-current="true"] [data-next]`);
  const response = await responsePromise;
  const json = await response.json();
  if (!json.ok) {
    const diagnostics = await page.evaluate(() => {
      const active = document.querySelector('[data-current="true"]');
      return {
        slideId: active?.getAttribute('data-slide') || '',
        status: active?.querySelector('[data-status]')?.textContent || '',
        selectedCards: Array.from(active?.querySelectorAll('[aria-selected="true"]') || []).map((card) => ({
          image: card.getAttribute('data-image-card'),
          type: card.getAttribute('data-type-card'),
          batch: card.getAttribute('data-image-batch'),
          pressed: card.getAttribute('aria-pressed'),
        })),
      };
    }).catch((error) => ({ error: error?.message || String(error) }));
    throw new Error(`Expected ${expectedSlideId} answer to be accepted; response=${JSON.stringify(json)} diagnostics=${JSON.stringify(diagnostics)}`);
  }
}

async function waitForLiveImageCards(page, workspace, sessionId, slideId, label, { previousIds = [], batchId = '' } = {}) {
  await expectActiveSlide(page, slideId, 120000);
  if (recordingImageProviderMode() === 'builtin' && !batchId) {
    const request = await pollUntil(workspace, sessionId, (item) => (
      item.type === 'image_request'
        && item.slideId === slideId
    ), `${label} image_request`);
    await replyBuiltInImageSheet({ workspace, sessionId, request });
    batchId = request.batchId;
  }
  const event = await pollUntil(workspace, sessionId, (item) => (
    item.type === 'image_batch'
      && item.slideId === slideId
      && (!batchId || item.batchId === batchId)
  ), `${label} image_batch`);
  assert.equal(event.images.length, 4);
  await page.waitForFunction(({ expectedSlideId, oldIds }) => {
    const active = document.querySelector('[data-current="true"]');
    const cards = Array.from(document.querySelectorAll('[data-current="true"] [data-image-card]'));
    const ids = cards.map((card) => `${card.getAttribute('data-image-card') || ''}:${card.getAttribute('data-image-batch') || ''}`);
    const changed = oldIds.length === 0 || ids.join('|') !== oldIds.join('|');
    return active?.dataset.slide === expectedSlideId
      && cards.length === 4
      && changed
      && cards.every((card) => {
        const img = card.querySelector('img');
        return img?.complete && img.naturalWidth > 0;
      });
  }, { expectedSlideId: slideId, oldIds: previousIds }, { timeout: 120000 });
}

async function requestMoreImagesAndWait({ page, workspace, sessionId, slideId, text, label, loadingScreenshotPath = '' }) {
  await typeAndVerify(page, '[data-current="true"] [data-image-request-input]', text);
  const responsePromise = page.waitForResponse((response) => (
    response.url().includes('/api/image-request')
      && response.request().method() === 'POST'
      && response.request().postDataJSON()?.slideId === slideId
  ), { timeout: 60000 });
  await humanClick(page, '[data-current="true"] [data-image-request]');
  const response = await responsePromise;
  assert.equal((await response.json()).ok, true);
  await assertImageLoadingPlaceholders(page, slideId);
  if (loadingScreenshotPath) await capturePage(page, loadingScreenshotPath);
  const request = await pollUntil(workspace, sessionId, (event) => (
    event.type === 'image_request'
      && event.slideId === slideId
      && String(event.freeform || '').includes(text)
  ), label, { maxAttempts: 24, timeoutMs: 5000 });
  await replyBuiltInImageSheet({ workspace, sessionId, request });
  return request;
}

async function typeAndVerify(page, selector, text) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await replaceText(page, selector, text);
    const value = await page.locator(selector).first().inputValue({ timeout: 10000 }).catch(() => '');
    if (value === text) return;
    await page.waitForTimeout(300);
  }
  const value = await page.locator(selector).first().inputValue({ timeout: 10000 }).catch(() => '');
  assert.equal(value, text, `expected ${selector} to contain typed text`);
}

async function currentImageCardIds(page) {
  return page.locator('[data-current="true"] [data-image-card]').evaluateAll((cards) => (
    cards.map((card) => `${card.getAttribute('data-image-card') || ''}:${card.getAttribute('data-image-batch') || ''}`)
  ));
}

async function assertImageLoadingPlaceholders(page, slideId) {
  await page.waitForFunction((expectedSlideId) => {
    const active = document.querySelector('[data-current="true"]');
    return active?.dataset.slide === expectedSlideId
      && active.querySelectorAll('.image-placeholder').length === 4;
  }, slideId, { timeout: 10000 });
}

async function pauseThenBack(page, expectedSlideId) {
  await page.waitForTimeout(2600);
  await humanClick(page, '[data-current="true"] [data-prev]');
  if (expectedSlideId) await expectCurrentSlide(page, expectedSlideId);
  await page.waitForTimeout(1400);
}

async function installVisibleCursor(page) {
  await page.addStyleTag({
    content: `
      #impeccable-test-cursor {
        position: fixed;
        z-index: 999999;
        left: 0;
        top: 0;
        width: 30px;
        height: 30px;
        border: 3px solid #ffc83d;
        border-radius: 999px;
        background: rgba(255, 200, 61, .18);
        box-shadow: 0 0 0 4px rgba(0,0,0,.78), 0 0 28px rgba(255, 190, 46, .9);
        pointer-events: none;
        transform: translate(-50%, -50%);
        transition: width 120ms ease, height 120ms ease, background-color 120ms ease;
      }
      #impeccable-test-cursor::after {
        content: "";
        position: absolute;
        left: 19px;
        top: 21px;
        width: 18px;
        height: 3px;
        border-radius: 999px;
        background: #ffc83d;
        transform: rotate(42deg);
        box-shadow: 0 0 0 2px rgba(0,0,0,.78);
      }
      #impeccable-test-cursor.is-down {
        width: 22px;
        height: 22px;
        background: rgba(255, 200, 61, .42);
      }
    `,
  });
  await page.evaluate(() => {
    const cursor = document.createElement('div');
    cursor.id = 'impeccable-test-cursor';
    cursor.style.left = `${window.innerWidth / 2}px`;
    cursor.style.top = `${window.innerHeight / 2}px`;
    document.body.appendChild(cursor);
    window.addEventListener('mousemove', (event) => {
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
    }, { passive: true });
    window.addEventListener('mousedown', () => cursor.classList.add('is-down'), true);
    window.addEventListener('mouseup', () => cursor.classList.remove('is-down'), true);
  });
}

async function humanClick(page, selector) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 120000 });
  await locator.hover({ timeout: 120000 });
  await page.waitForTimeout(220);
  await locator.click({ timeout: 120000 });
}

async function humanType(page, selector, text) {
  await humanClick(page, selector);
  await page.keyboard.type(text, { delay: 18 });
}

async function replaceText(page, selector, text) {
  await humanClick(page, selector);
  const isMac = process.platform === 'darwin';
  await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(text, { delay: 18 });
}

async function uploadFilesHuman(page, files) {
  const input = page.locator('[data-current="true"] [data-upload-input]');
  await input.hover({ timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(260);
  await input.setInputFiles(files);
  await page.waitForFunction((count) => document.querySelectorAll('[data-current="true"] .asset-item').length === count, files.length, { timeout: 30000 });
}

async function selectCardByIndex(page, cardSelector, index) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const card = page.locator(`[data-current="true"] ${cardSelector}`).nth(index);
      await card.waitFor({ state: 'visible', timeout: 120000 });
      await card.scrollIntoViewIfNeeded({ timeout: 120000 });
      const box = await waitForStableBox(card);
      assert.ok(box, `missing card bounds for ${cardSelector} ${index}`);
      const point = { x: Math.min(48, box.width / 4), y: Math.min(96, box.height / 3) };
      await card.hover({ position: point, timeout: 120000 });
      await page.waitForTimeout(240);
      await card.click({ position: point, timeout: 120000 });
      await page.waitForTimeout(420);
      const selected = await card.getAttribute('aria-selected').catch(() => null);
      const pressed = await card.getAttribute('aria-pressed').catch(() => null);
      if (selected === 'true' || pressed === 'true') return;
    } catch (error) {
      if (!/not attached|detached|closed/i.test(String(error?.message || error))) throw error;
    }
    await page.waitForTimeout(260);
  }
  assert.fail(`card ${index} did not become selected for ${cardSelector}`);
}

async function ensureSelectedCards(page, cardSelector, preferredIndexes, minSelected) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const selectedCount = await page.locator(`[data-current="true"] ${cardSelector}[aria-selected="true"]`).count();
    if (selectedCount >= minSelected) return;
    const index = preferredIndexes[attempt % preferredIndexes.length];
    await selectCardByIndex(page, cardSelector, index);
  }
  const selectedCount = await page.locator(`[data-current="true"] ${cardSelector}[aria-selected="true"]`).count();
  assert.ok(selectedCount >= minSelected, `expected at least ${minSelected} selected cards, found ${selectedCount}`);
}

async function waitForStableBox(locator, timeout = 120000) {
  const started = Date.now();
  let previous = null;
  while (Date.now() - started < timeout) {
    const box = await locator.boundingBox().catch(() => null);
    if (box && box.width > 1 && box.height > 1) {
      const signature = `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.width)}:${Math.round(box.height)}`;
      if (signature === previous) return box;
      previous = signature;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return null;
}

async function expandAndClose(page, expandSelector, modalSelector, closeSelector, screenshotPath = '') {
  await humanClick(page, `[data-current="true"] ${expandSelector}`);
  await page.waitForFunction((selector) => {
    const modal = document.querySelector(selector);
    return modal && !modal.hidden;
  }, modalSelector, { timeout: 10000 });
  await page.waitForTimeout(1400);
  if (screenshotPath) await capturePage(page, screenshotPath);
  await humanClick(page, closeSelector);
  await page.waitForFunction((selector) => document.querySelector(selector)?.hidden === true, modalSelector, { timeout: 10000 });
}

async function assertRecommendedSelected(page) {
  await page.waitForFunction(() => {
    const selected = document.querySelector('[data-current="true"] [data-option][aria-pressed="true"]');
    return selected && selected.querySelector('.recommended-badge');
  });
}

async function assertShortcutHint(page) {
  await page.waitForFunction(() => /1-4 Select/.test(document.querySelector('[data-shortcut-hint]')?.textContent || ''));
}

async function expectCurrentSlide(page, expectedSlideId, timeout = 30000) {
  await page.waitForFunction((slideId) => {
    const thinking = document.querySelector('[data-thinking]');
    const ready = !thinking || thinking.hidden || !thinking.classList.contains('is-active');
    const current = document.querySelector('[data-current="true"]');
    return ready
      && current?.dataset.slide === slideId
      && Number(getComputedStyle(current).opacity) > 0.8;
  }, expectedSlideId, { timeout });
}

async function expectActiveSlide(page, expectedSlideId, timeout = 30000) {
  await page.waitForFunction((slideId) => {
    const current = document.querySelector('[data-current="true"]');
    return current?.dataset.slide === slideId;
  }, expectedSlideId, { timeout });
}

async function capturePage(page, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const buffer = await page.screenshot({ path: outPath, fullPage: true });
  assert.ok(buffer.byteLength > 10_000, `${outPath} should contain visible pixels`);
}

async function downloadUploadAssets(dataset, uploadArtifactDir) {
  const manifest = [];
  for (let index = 0; index < dataset.uploads.length; index += 1) {
    const asset = dataset.uploads[index];
    const res = await fetch(asset.url);
    if (!res.ok) throw new Error(`Could not download ${asset.url}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const localPath = path.join(uploadArtifactDir, asset.name);
    fs.writeFileSync(localPath, bytes);
    manifest.push({
      order: index + 1,
      name: asset.name,
      role: asset.role,
      sourcePage: asset.sourcePage,
      sourceFileUrl: asset.url,
      license: asset.license,
      attribution: asset.attribution,
      localPath,
    });
  }
  fs.writeFileSync(path.join(path.dirname(uploadArtifactDir), 'asset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function writeFixtureDocs({ dataset, artifactDir, assetManifest, imageProviderMode = 'flux', builtInSheets = null }) {
  const data = {
    brand: dataset.brand,
    slug: dataset.slug,
    scenario: dataset.scenario,
    imageProviderMode,
    builtInSheets: builtInSheets ? {
      visualCues: builtInSheets.visualCues,
      palette: builtInSheets.palette,
    } : null,
    typedValues: {
      initialIdea: dataset.initialIdea,
      editedIdea: dataset.editedIdea,
      differentiator: dataset.differentiator,
      differentiatorEdit: dataset.differentiatorEdit,
      trust: dataset.trust,
      audience: dataset.audience,
      notFor: dataset.notFor,
      moreCues: dataset.moreCues,
      paletteShift: dataset.paletteShift,
    },
    shortcutsUsed: ['Arrow/back button navigation', 'number key selection', 'Enter to continue from input'],
    uploadRoles: assetManifest.map((asset) => ({ name: asset.name, role: asset.role, order: asset.order })),
    expectedOutputs: [
      'PRODUCT.md',
      'BRAND.md or BRAND.next.md',
      'DESIGN.md',
      'init-config.json',
      'slide-content-log.md',
      'slide-content-log.json',
      imageProviderMode === 'builtin' ? 'builtin-prompts-visual-cues.md/json' : 'flux-prompts-visual-cues.md/json',
      imageProviderMode === 'builtin' ? 'builtin-prompts-palettes.md/json' : 'flux-prompts-palettes.md/json',
    ],
  };
  fs.writeFileSync(path.join(artifactDir, 'test-data.json'), `${JSON.stringify(data, null, 2)}\n`);
  fs.writeFileSync(path.join(artifactDir, 'test-data.md'), [
    `# ${dataset.brand} Init Recording Fixture`,
    '',
    `Scenario: ${dataset.scenario}`,
    '',
    '## Typed Values',
    '',
    ...Object.entries(data.typedValues).map(([key, value]) => `- **${key}**: ${value}`),
    '',
    '## Uploads',
    '',
    ...assetManifest.map((asset) => `- ${asset.order}. ${asset.name} — ${asset.role} — ${asset.sourceFileUrl}`),
    '',
    '## Interactions',
    '',
    '- Cursor hover, click, and slow typing are used for all visible fields.',
    '- Number keys select option cards.',
    '- Back/edit loops are used before continuing.',
    '- Cue and palette cards are expanded in modals before continuing.',
    '- Slide content is logged from both agent payloads and browser-rendered copy.',
    `- Image provider mode: ${imageProviderMode}.`,
    ...(builtInSheets ? [
      `- Built-in visual cue sheet: ${builtInSheets.visualCues}`,
      `- Built-in palette sheet: ${builtInSheets.palette}`,
    ] : []),
    '',
  ].join('\n'));
}

function copyOutputs({ workspace, artifactDir, sessionId, startup, assetManifest }) {
  for (const file of ['PRODUCT.md', 'DESIGN.md']) {
    fs.copyFileSync(path.join(workspace, file), path.join(artifactDir, file));
  }
  const brandSource = fs.existsSync(path.join(workspace, 'BRAND.md'))
    ? path.join(workspace, 'BRAND.md')
    : path.join(workspace, '.impeccable', 'init', 'BRAND.next.md');
  fs.copyFileSync(brandSource, path.join(artifactDir, path.basename(brandSource)));

  const sessionStatePath = path.join(workspace, '.impeccable', 'questionnaire', 'sessions', `${sessionId}.json`);
  const rawState = JSON.parse(fs.readFileSync(sessionStatePath, 'utf-8'));
  writeImagePromptLogs({ state: rawState, artifactDir });
  const state = redactSecretsDeep(rawState);
  fs.writeFileSync(path.join(artifactDir, 'session-state.json'), `${JSON.stringify(state, null, 2)}\n`);
  fs.writeFileSync(path.join(artifactDir, 'init-config.json'), `${JSON.stringify(redactSecretsDeep({
    sessionId,
    targetPaths: startup.targetPaths,
    artifactDir,
    assetCount: assetManifest.length,
    imageProvider: rawState.imageProvider?.provider || null,
    liveConfigRecreated: fs.existsSync(path.join(workspace, '.impeccable', 'live', 'config.json')),
  }), null, 2)}\n`);
  fs.writeFileSync(path.join(artifactDir, 'manifest.json'), `${JSON.stringify(redactSecretsDeep({
    runId: path.basename(artifactDir),
    video: path.join(artifactDir, 'journey.mp4'),
    screenshotsDir: path.join(artifactDir, 'screenshots'),
    uploadsDir: path.join(artifactDir, 'uploads'),
    promptLogs: promptLogManifest(rawState.imageProvider?.provider || 'flux', artifactDir),
    targetPaths: startup.targetPaths,
  }), null, 2)}\n`);
}

async function replyBuiltInImageSheet({ workspace, sessionId, request }) {
  if (recordingImageProviderMode() !== 'builtin') return null;
  assert.equal(request.imageProvider?.provider, 'builtin-quadrant');
  assert.equal(Boolean(request.builtInQuadrant?.prompt), true, `${request.slideId} built-in request should include quadrant prompt`);
  const sheets = resolveBuiltInSheets();
  const sheetPath = request.slideId === 'palette' ? sheets.palette : sheets.visualCues;
  assert.equal(fs.existsSync(sheetPath), true, `Built-in sheet should exist: ${sheetPath}`);
  await replyRaw(workspace, {
    action: 'image_sheet',
    sessionId,
    slideId: request.slideId,
    batchId: request.batchId,
    sheetPath,
  }, { timeoutMs: 120000 });
  return null;
}

function writeImagePromptLogs({ state, artifactDir }) {
  const provider = state.imageProvider?.provider || 'flux';
  if (provider === 'builtin-quadrant') return writeBuiltInPromptLogs({ state, artifactDir });
  return writeFluxPromptLogs({ state, artifactDir });
}

function writeFluxPromptLogs({ state, artifactDir }) {
  const events = Array.isArray(state.events) ? state.events : [];
  const requests = events.filter((event) => (
    event?.type === 'image_request'
      && event?.imageProvider?.provider === 'flux'
      && Array.isArray(event?.flux?.prompts)
  ));
  const groups = {
    'visual-cues': requests.filter((event) => event.slideId === 'visual-cues'),
    palette: requests.filter((event) => event.slideId === 'palette'),
  };

  writeFluxPromptLogFile({
    artifactDir,
    filenameStem: 'flux-prompts-visual-cues',
    title: 'Visual Cue Flux Prompt Log',
    requests: groups['visual-cues'],
  });
  writeFluxPromptLogFile({
    artifactDir,
    filenameStem: 'flux-prompts-palettes',
    title: 'Palette Flux Prompt Log',
    requests: groups.palette,
  });

  assert.ok(groups['visual-cues'].length > 0, 'visual cue Flux prompt log should include at least one request');
  assert.ok(groups.palette.length > 0, 'palette Flux prompt log should include at least one request');
}

function writeBuiltInPromptLogs({ state, artifactDir }) {
  const events = Array.isArray(state.events) ? state.events : [];
  const requests = events.filter((event) => (
    event?.type === 'image_request'
      && event?.imageProvider?.provider === 'builtin-quadrant'
      && event?.builtInQuadrant?.prompt
  ));
  const groups = {
    'visual-cues': requests.filter((event) => event.slideId === 'visual-cues'),
    palette: requests.filter((event) => event.slideId === 'palette'),
  };
  writeBuiltInPromptLogFile({
    artifactDir,
    filenameStem: 'builtin-prompts-visual-cues',
    title: 'Built-In Visual Cue Sheet Prompt Log',
    requests: groups['visual-cues'],
  });
  writeBuiltInPromptLogFile({
    artifactDir,
    filenameStem: 'builtin-prompts-palettes',
    title: 'Built-In Palette Sheet Prompt Log',
    requests: groups.palette,
  });
  assert.ok(groups['visual-cues'].length > 0, 'visual cue built-in prompt log should include at least one request');
  assert.ok(groups.palette.length > 0, 'palette built-in prompt log should include at least one request');
}

function writeBuiltInPromptLogFile({ artifactDir, filenameStem, title, requests }) {
  const entries = requests.map((event) => ({
    slideId: event.slideId,
    batchId: event.batchId,
    reason: event.reason,
    freeform: event.freeform || '',
    provider: event.imageProvider?.provider || '',
    model: event.builtInQuadrant?.model || '',
    prompt: event.builtInQuadrant?.prompt || '',
    routes: event.builtInQuadrant?.routes || [],
    promptLength: String(event.builtInQuadrant?.prompt || '').length,
    contextChecklist: promptContextChecklist(event.builtInQuadrant?.prompt, event.promptContext),
  }));
  fs.writeFileSync(path.join(artifactDir, `${filenameStem}.json`), `${JSON.stringify(entries, null, 2)}\n`);
  fs.writeFileSync(path.join(artifactDir, `${filenameStem}.md`), [
    `# ${title}`,
    '',
    ...entries.map((entry, index) => [
      `## ${index + 1}. ${entry.slideId} (${entry.batchId})`,
      '',
      `- Reason: ${entry.reason}`,
      `- Provider/model: ${entry.provider} / ${entry.model}`,
      `- Freeform: ${entry.freeform || 'n/a'}`,
      `- Prompt length: ${entry.promptLength}`,
      `- Routes: ${entry.routes.map((route) => `${route.label} (${route.routeFamily})`).join(', ')}`,
      `- Context checklist: ${Object.entries(entry.contextChecklist).map(([key, value]) => `${key}=${value ? 'yes' : 'no'}`).join(', ')}`,
      '',
      '```text',
      entry.prompt,
      '```',
    ].join('\n')),
    '',
  ].join('\n\n'));
}

function promptLogManifest(provider, artifactDir) {
  const prefix = provider === 'builtin-quadrant' ? 'builtin-prompts' : 'flux-prompts';
  return {
    visualCues: path.join(artifactDir, `${prefix}-visual-cues.md`),
    palettes: path.join(artifactDir, `${prefix}-palettes.md`),
  };
}

function writeFluxPromptLogFile({ artifactDir, filenameStem, title, requests }) {
  const entries = requests.flatMap((event) => event.flux.prompts.map((item) => ({
    slideId: event.slideId,
    batchId: event.batchId,
    reason: event.reason,
    freeform: event.freeform || '',
    provider: event.imageProvider?.provider || '',
    model: event.flux?.model || '',
    id: item.id,
    label: item.label,
    routeFamily: item.routeFamily,
    prompt: item.prompt,
    promptLength: String(item.prompt || '').length,
    contextChecklist: promptContextChecklist(item.prompt, event.promptContext),
  })));
  fs.writeFileSync(path.join(artifactDir, `${filenameStem}.json`), `${JSON.stringify(entries, null, 2)}\n`);
  fs.writeFileSync(path.join(artifactDir, `${filenameStem}.md`), [
    `# ${title}`,
    '',
    ...entries.map((entry, index) => [
      `## ${index + 1}. ${entry.label} (${entry.routeFamily})`,
      '',
      `- Slide: ${entry.slideId}`,
      `- Batch: ${entry.batchId}`,
      `- Reason: ${entry.reason}`,
      `- Provider/model: ${entry.provider} / ${entry.model}`,
      `- Freeform: ${entry.freeform || 'n/a'}`,
      `- Prompt length: ${entry.promptLength}`,
      `- Context checklist: ${Object.entries(entry.contextChecklist).map(([key, value]) => `${key}=${value ? 'yes' : 'no'}`).join(', ')}`,
      '',
      '```text',
      entry.prompt,
      '```',
    ].join('\n')),
    '',
  ].join('\n\n'));
}

function promptContextChecklist(prompt = '', promptContext = {}) {
  const text = String(prompt || '');
  return {
    product: Boolean(promptContext?.product && text.includes(promptContext.product)),
    differentiator: Boolean(promptContext?.differentiator && text.includes(promptContext.differentiator)),
    trust: Boolean(promptContext?.trust && text.includes(promptContext.trust)),
    audience: Boolean((promptContext?.audienceFit || promptContext?.audience) && text.includes(promptContext.audienceFit || promptContext.audience)),
    antiAudience: Boolean(promptContext?.antiAudience && text.includes(promptContext.antiAudience)),
    uploads: Array.isArray(promptContext?.uploadedAssets)
      && promptContext.uploadedAssets.length > 0
      && promptContext.uploadedAssets.every((asset) => text.includes(asset.name || asset.id)),
    selectedCues: Array.isArray(promptContext?.selectedCueImages)
      && promptContext.selectedCueImages.length > 0
      ? promptContext.selectedCueImages.every((image) => text.includes(image.label || image.id))
      : true,
    baselineRules: /independent 1:1 square card|1:1 full-bleed/.test(text) && /no contact sheet/i.test(text),
  };
}

async function pollUntil(workspace, sessionId, predicate, label, { maxAttempts = 180, timeoutMs = 15000 } = {}) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const event = await poll(workspace, sessionId, timeoutMs);
    if (predicate(event)) return event;
    if (event.type === 'message' && event.kind === 'error') {
      throw new Error(`${label} failed: ${event.message}`);
    }
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function poll(workspace, sessionId, timeoutMs = 4000) {
  const result = await runNode(workspace, [
    path.join(INSTALLED_SKILL_DEST, 'scripts', 'questionnaire', 'init-poll.mjs'),
    '--session-id',
    sessionId,
    '--timeout-ms',
    String(timeoutMs),
    '--redact-images',
    '--summary',
  ], { timeoutMs: timeoutMs + 15000 });
  return parseJson(result.stdout, 'poll output');
}

async function reply(workspace, payload) {
  const result = await replyRaw(workspace, payload);
  return parseJson(result.stdout, 'reply output');
}

async function replyRaw(workspace, payload, { timeoutMs = 30000 } = {}) {
  const replyPath = path.join(workspace, `.impeccable/init-reply-${Date.now().toString(36)}.json`);
  fs.mkdirSync(path.dirname(replyPath), { recursive: true });
  fs.writeFileSync(replyPath, JSON.stringify(payload));
  return runNode(workspace, [
    path.join(INSTALLED_SKILL_DEST, 'scripts', 'questionnaire', 'init-poll.mjs'),
    '--session-id',
    payload.sessionId,
    '--reply',
    replyPath,
  ], { timeoutMs });
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
    const timer = setTimeout(() => reject(new Error(`init-questionnaire startup timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`)), 10000);
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      try {
        const json = parseJson(stdout, 'startup output');
        clearTimeout(timer);
        resolve(json);
      } catch {
        // Wait for full JSON.
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

async function launchBrowserOrSkip(t) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch (err) {
    t.skip(`Playwright is required for recorded init tests (${err.message}).`);
    return null;
  }
  try {
    return await playwright.chromium.launch({ headless: true });
  } catch (err) {
    t.skip(`Chromium could not launch (${err.message}).`);
    return null;
  }
}

function copyReplicaRepo(sourceRoot, destRoot) {
  fs.cpSync(sourceRoot, destRoot, {
    recursive: true,
    filter(source) {
      const rel = path.relative(sourceRoot, source);
      if (!rel) return true;
      const parts = rel.split(path.sep);
      if (parts.includes('.git') || parts.includes('node_modules') || parts.includes('dist') || parts.includes('build')) return false;
      if (parts[0] === '.impeccable') {
        const ignored = [
          ['.impeccable', '.env'],
          ['.impeccable', 'env'],
          ['.impeccable', 'init'],
          ['.impeccable', 'questionnaire'],
          ['.impeccable', 'history'],
          ['.impeccable', 'live'],
        ];
        if (ignored.some((prefix) => prefix.every((part, index) => parts[index] === part))) return false;
      }
      return true;
    },
  });
}

function seedInitOwnedFilesFromHead(workspace) {
  for (const relPath of INIT_OWNED_FILES) {
    const outPath = path.join(workspace, relPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    try {
      const content = execFileSync('git', ['show', `HEAD:${relPath.split(path.sep).join('/')}`], {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      fs.writeFileSync(outPath, content);
    } catch {
      fs.writeFileSync(outPath, `# Seeded ${relPath}\n`);
    }
  }
}

function deleteInitOwnedFiles(workspace) {
  for (const relPath of INIT_OWNED_FILES) fs.rmSync(path.join(workspace, relPath), { force: true });
}

function assertNoLiveConfig(workspace) {
  assert.equal(fs.existsSync(path.join(workspace, '.impeccable', 'live', 'config.json')), false);
}

function convertWebmToMp4({ ffmpeg, webmPath, mp4Path }) {
  execFileSync(ffmpeg, [
    '-y',
    '-i',
    webmPath,
    '-movflags',
    '+faststart',
    '-pix_fmt',
    'yuv420p',
    mp4Path,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function validateMp4({ ffprobe, mp4Path }) {
  const metadata = JSON.parse(execFileSync(ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size',
    '-show_entries',
    'stream=width,height,codec_name',
    '-of',
    'json',
    mp4Path,
  ], { encoding: 'utf-8' }));
  assert.equal(metadata.streams[0]?.codec_name, 'h264');
  assert.equal(metadata.streams[0]?.width, VIDEO_SIZE.width);
  assert.equal(metadata.streams[0]?.height, VIDEO_SIZE.height);
  assert.ok(Number(metadata.format?.duration) > 20, 'recorded journey should include real interaction time');
  assert.ok(Number(metadata.format?.size) > 100000, 'recorded MP4 should be nonempty');
  return metadata;
}

function findBinary(name) {
  for (const candidate of [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Could not parse ${label}: ${error.message}\n${text}`);
  }
}

function resolveImageApiKey() {
  for (const key of ['IMAGE_API_KEY', 'IMPECCABLE_IMAGE_API_KEY', 'BFL_API_KEY', 'FLUX_API_KEY']) {
    if (process.env[key]) return process.env[key];
  }
  for (const rel of [path.join('.impeccable', '.env'), path.join('.impeccable', 'env')]) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf-8');
    for (const key of ['IMAGE_API_KEY', 'IMPECCABLE_IMAGE_API_KEY', 'BFL_API_KEY', 'FLUX_API_KEY']) {
      const match = content.match(new RegExp(`^${key}=["']?([^"'\\n]+)["']?`, 'm'));
      if (match) return match[1].trim();
    }
  }
  return '';
}

function redactSecretsDeep(value) {
  if (Array.isArray(value)) return value.map(redactSecretsDeep);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|apiKey|api_key|IMAGE_API_KEY|BFL|FLUX/i.test(key)) {
      out[key] = '[redacted]';
    } else if (key === 'dataUrl' && typeof item === 'string' && item.startsWith('data:image/')) {
      out[key] = `[redacted:${Math.round(item.length / 1024)}kb-image-data-url]`;
    } else if (typeof item === 'string' && /bfl_[A-Za-z0-9]+/.test(item)) {
      out[key] = item.replace(/bfl_[A-Za-z0-9]+/g, '[redacted]');
    } else {
      out[key] = redactSecretsDeep(item);
    }
  }
  return out;
}

function testPng(name, role, text, bg, fg) {
  const encoded = encodeURIComponent(text);
  return {
    name,
    role,
    url: `https://dummyimage.com/640x640/${bg}/${fg}.png&text=${encoded}`,
    sourcePage: 'https://dummyimage.com/',
    license: 'Synthetic test image generated from an internet placeholder service; used only in ignored local test artifacts.',
    attribution: 'dummyimage.com',
  };
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}
