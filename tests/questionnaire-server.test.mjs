import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createQuestionnaireRuntime,
  getQuestionnaireSessionsDir,
  startQuestionnaireServer,
} from '../skill/scripts/questionnaire/server.mjs';
import {
  SAMPLE_ANSWER_INPUTS,
  SAMPLE_INIT_ANSWER_INPUTS,
  SAMPLE_INIT_IMAGES,
  SAMPLE_INIT_TYPOGRAPHY,
  postJson,
} from './questionnaire-fixtures.mjs';

let scratch;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-questionnaire-server-'));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('questionnaire server', () => {
  it('still serves the legacy design questionnaire and writes DESIGN.md', async () => {
    fs.writeFileSync(path.join(scratch, 'PRODUCT.md'), '# Product\n');
    const handle = await startQuestionnaireServer({ cwd: scratch, env: {} });
    try {
      const session = handle.runtime.createSession({ command: 'shape', prompt: 'Shape billing workspace' });
      assert.equal(session.existingDesign, false);
      assert.equal(session.targetPath, 'DESIGN.md');

      for (const [slideId, answer] of Object.entries(SAMPLE_ANSWER_INPUTS)) {
        handle.runtime.recordAnswer({ sessionId: session.sessionId, slideId, answer });
      }

      const complete = handle.runtime.completeSession({ sessionId: session.sessionId });
      assert.equal(complete.type, 'complete');
      assert.equal(complete.targetPath, 'DESIGN.md');
      assert.match(fs.readFileSync(path.join(scratch, 'DESIGN.md'), 'utf-8'), /Design System:/);
    } finally {
      await handle.stop();
    }
  });

  it('runs init through uploads, poll events, generated batches, completion, and recovery', async () => {
    const handle = await startQuestionnaireServer({ cwd: scratch, env: {} });
    try {
      const sessionRes = await postJson(`${handle.baseUrl}/api/session?token=${handle.token}`, {
        command: 'init',
        prompt: 'Set up Mira',
      });
      assert.equal(sessionRes.res.status, 200, sessionRes.text);
      const session = sessionRes.json;
      assert.equal(session.targetPaths.product, 'PRODUCT.md');
      assert.equal(session.targetPaths.brand, 'BRAND.md');
      assert.equal(session.targetPaths.design, 'DESIGN.md');

      const pageRes = await fetch(session.url);
      const html = await pageRes.text();
      assert.equal(pageRes.status, 200);
      assert.match(html, /What are we making\?/);
      assert.doesNotMatch(html, /Choose for me/);
      assert.match(html, /1-4 Select/);
      assert.match(html, /EventSource/);
      assert.match(html, /prefers-reduced-motion: reduce/);
      assert.doesNotMatch(html, /shape questionnaire/);

      const uploadWait = handle.runtime.waitForEvent(session.sessionId, { timeoutMs: 1000 });
      const uploadRes = await postJson(`${handle.baseUrl}/api/upload`, {
        token: handle.token,
        sessionId: session.sessionId,
        files: [
          {
            name: 'warm-lamp-product-photo.png',
            type: 'image/png',
            dataUrl: SAMPLE_INIT_ANSWER_INPUTS.assets.assets[0].previewDataUrl,
            width: 32,
            height: 32,
          },
        ],
      });
      assert.equal(uploadRes.res.status, 200, uploadRes.text);
      assert.equal(uploadRes.json.upload.uploadedAssets[0].role, 'product-photo');
      assert.equal((await uploadWait).type, 'upload');
      assert.equal(fs.existsSync(path.join(scratch, uploadRes.json.upload.uploadedAssets[0].path)), true);

      await postJson(`${handle.baseUrl}/api/answer`, {
        token: handle.token,
        sessionId: session.sessionId,
        slideId: 'product-overview',
        answer: SAMPLE_INIT_ANSWER_INPUTS['product-overview'],
      });

      const pollUrl = new URL('/poll', handle.baseUrl);
      pollUrl.searchParams.set('token', handle.token);
      pollUrl.searchParams.set('sessionId', session.sessionId);
      pollUrl.searchParams.set('timeoutMs', '1000');
      const pollEvent = await (await fetch(pollUrl)).json();
      assert.equal(pollEvent.type, 'answer');
      assert.equal(pollEvent.nextSlideId, 'assets');

      const slideReply = await postJson(`${handle.baseUrl}/poll`, {
        token: handle.token,
        sessionId: session.sessionId,
        action: 'update_slide',
        slideId: 'assets',
        patch: {
          title: 'What material does Mira already have?',
          prompt: 'Add product photos, process shots, proof, GIFs, or MP4s.',
        },
      });
      assert.equal(slideReply.res.status, 200, slideReply.text);
      assert.equal(slideReply.json.result.patch.title, 'What material does Mira already have?');

      const delegateWait = handle.runtime.waitForEvent(session.sessionId, { timeoutMs: 1000 });
      const delegateRes = await postJson(`${handle.baseUrl}/api/delegate`, {
        token: handle.token,
        sessionId: session.sessionId,
        slideId: 'trust',
        freeform: 'Choose the proof route.',
      });
      assert.equal(delegateRes.res.status, 200, delegateRes.text);
      const delegate = await delegateWait;
      assert.equal(delegate.type, 'delegate_request');
      assert.equal(delegate.slideId, 'trust');

      const delegateAnswer = await postJson(`${handle.baseUrl}/poll`, {
        token: handle.token,
        sessionId: session.sessionId,
        action: 'delegate_answer',
        slideId: 'trust',
        answer: SAMPLE_INIT_ANSWER_INPUTS.trust,
        rationale: 'Material honesty is the clearest fit.',
      });
      assert.equal(delegateAnswer.json.result.type, 'delegate_answer');

      for (const slideId of ['assets', 'differentiator', 'trust', 'audience-fit', 'anti-audience']) {
        handle.runtime.recordAnswer({
          sessionId: session.sessionId,
          slideId,
          answer: SAMPLE_INIT_ANSWER_INPUTS[slideId],
        });
      }

      let cueRequest;
      for (let i = 0; i < 8; i += 1) {
        const event = await handle.runtime.waitForEvent(session.sessionId, { timeoutMs: 1000 });
        if (event.type === 'image_request' && event.slideId === 'visual-cues') {
          cueRequest = event;
          break;
        }
      }
      assert.equal(cueRequest.kind, 'visual-cue');
      assert.equal(cueRequest.imageProvider.provider, 'builtin-quadrant');
      assert.equal(cueRequest.imageProvider.hasKey, false);
      assert.match(cueRequest.builtInQuadrant.prompt, /Create ONE square 2x2 quadrant sheet/);
      assert.equal(cueRequest.imagePromptContract.model, 'flux-2-pro-preview-or-built-in-quadrant');
      assert.equal(cueRequest.imagePromptContract.size, '1024x1024');
      assert.match(cueRequest.imagePromptGuidance.join('\n'), /OpenAI and BFL prompting guidance/);
      assert.match(cueRequest.imagePromptContract.routeRules.join('\n'), /at least three routeFamily/i);
      assert.equal(cueRequest.promptContext.uploadedAssets[0].role, 'product-photo');

      const cueBatch = handle.runtime.sendImageBatch({
        sessionId: session.sessionId,
        slideId: 'visual-cues',
        batchId: cueRequest.batchId,
        images: SAMPLE_INIT_IMAGES['visual-cues'],
      });
      assert.equal(cueBatch.images.length, 4);
      assert.ok(new Set(cueBatch.images.map((image) => image.routeFamily)).size >= 3);

      handle.runtime.recordAnswer({
        sessionId: session.sessionId,
        slideId: 'visual-cues',
        answer: SAMPLE_INIT_ANSWER_INPUTS['visual-cues'],
      });

      let paletteRequest;
      for (let i = 0; i < 8; i += 1) {
        const event = await handle.runtime.waitForEvent(session.sessionId, { timeoutMs: 1000 });
        if (event.type === 'image_request' && event.slideId === 'palette') {
          paletteRequest = event;
          break;
        }
      }
      assert.equal(paletteRequest.kind, 'palette');
      assert.deepEqual(paletteRequest.selectedImageIds, SAMPLE_INIT_ANSWER_INPUTS['visual-cues'].value);
      assert.match(paletteRequest.imagePromptGuidance.join('\n'), /selected cue route families/);

      handle.runtime.sendImageBatch({
        sessionId: session.sessionId,
        slideId: 'palette',
        batchId: paletteRequest.batchId,
        images: SAMPLE_INIT_IMAGES.palette,
      });
      handle.runtime.recordAnswer({
        sessionId: session.sessionId,
        slideId: 'palette',
        answer: SAMPLE_INIT_ANSWER_INPUTS.palette,
      });

      let typographyRequest;
      for (let i = 0; i < 8; i += 1) {
        const event = await handle.runtime.waitForEvent(session.sessionId, { timeoutMs: 1000 });
        if (event.type === 'typography_request') {
          typographyRequest = event;
          break;
        }
      }
      assert.equal(typographyRequest.slideId, 'typography');
      assert.equal(typographyRequest.selectedCueImages.length, 3);
      assert.match(typographyRequest.typographyGuidance.join('\n'), /selected cue route families/);

      handle.runtime.sendTypographyBatch({
        sessionId: session.sessionId,
        slideId: 'typography',
        batchId: typographyRequest.batchId,
        fontSets: SAMPLE_INIT_TYPOGRAPHY,
      });
      handle.runtime.recordAnswer({
        sessionId: session.sessionId,
        slideId: 'typography',
        answer: SAMPLE_INIT_ANSWER_INPUTS.typography,
      });

      const complete = handle.runtime.completeSession({ sessionId: session.sessionId });
      assert.equal(complete.type, 'complete');
      assert.deepEqual(complete.targetPaths, {
        product: 'PRODUCT.md',
        brand: 'BRAND.md',
        design: 'DESIGN.md',
      });
      assert.match(fs.readFileSync(path.join(scratch, 'PRODUCT.md'), 'utf-8'), /Mira is a ceramic lamp studio/);
      assert.match(fs.readFileSync(path.join(scratch, 'BRAND.md'), 'utf-8'), /!\[Thrown clay\]\(.impeccable\/init\/generated/);
      assert.match(fs.readFileSync(path.join(scratch, 'DESIGN.md'), 'utf-8'), /Read `BRAND.md` before designing/);

      const sessionFile = path.join(getQuestionnaireSessionsDir(scratch), `${session.sessionId}.json`);
      assert.equal(fs.existsSync(sessionFile), true);
      const recovered = createQuestionnaireRuntime({ cwd: scratch, env: {} }).getSessionState(session.sessionId);
      assert.equal(recovered.status, 'complete');
      assert.equal(recovered.targetBrandPath, 'BRAND.md');
      assert.equal(recovered.uploadedAssets[0].role, 'product-photo');
    } finally {
      await handle.stop();
    }
  });

  it('stages init artifacts independently when files already exist', () => {
    fs.writeFileSync(path.join(scratch, 'PRODUCT.md'), '# Existing product\n');
    fs.writeFileSync(path.join(scratch, 'BRAND.md'), '# Existing brand\n');
    const runtime = createQuestionnaireRuntime({ cwd: scratch, baseUrl: 'http://127.0.0.1:8600', env: {} });
    const session = runtime.createSession({ command: 'identity', prompt: 'Alias identity to init' });
    assert.equal(session.targetPaths.product, path.join('.impeccable', 'init', 'PRODUCT.next.md'));
    assert.equal(session.targetPaths.brand, path.join('.impeccable', 'init', 'BRAND.next.md'));
    assert.equal(session.targetPaths.design, 'DESIGN.md');
  });

  it('auto-generates init cue and palette batches with a mocked Flux provider without exposing the key', async () => {
    const calls = [];
    const handle = await startQuestionnaireServer({
      cwd: scratch,
      env: { IMAGE_API_KEY: 'bfl_test_secret' },
      imageGeneration: async (request, options) => {
        calls.push({
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
    try {
      const session = handle.runtime.createSession({ command: 'init', prompt: 'Set up Mira' });
      for (const slideId of ['product-overview', 'assets', 'differentiator', 'trust', 'audience-fit', 'anti-audience']) {
        handle.runtime.recordAnswer({
          sessionId: session.sessionId,
          slideId,
          answer: SAMPLE_INIT_ANSWER_INPUTS[slideId],
        });
      }

      const cueRequest = await waitForEventMatching(handle, session.sessionId, (event) => event.type === 'image_request' && event.slideId === 'visual-cues');
      assert.equal(cueRequest.imageProvider.provider, 'flux');
      assert.equal(cueRequest.imageProvider.hasKey, true);
      assert.equal(cueRequest.imageProvider.apiKey, undefined);
      assert.equal(cueRequest.flux.prompts.length, 4);

      const cueBatch = await waitForEventMatching(handle, session.sessionId, (event) => event.type === 'image_batch' && event.slideId === 'visual-cues');
      assert.equal(cueBatch.images.length, 4);
      assert.equal(calls[0].provider, 'flux');
      assert.equal(calls[0].apiKey, 'bfl_test_secret');

      handle.runtime.recordAnswer({
        sessionId: session.sessionId,
        slideId: 'visual-cues',
        answer: SAMPLE_INIT_ANSWER_INPUTS['visual-cues'],
      });
      const paletteBatch = await waitForEventMatching(handle, session.sessionId, (event) => event.type === 'image_batch' && event.slideId === 'palette');
      assert.equal(paletteBatch.images.length, 4);
      assert.equal(paletteBatch.images[0].colors.length, 4);

      const state = handle.runtime.getSessionState(session.sessionId);
      assert.equal(state.imageProvider.provider, 'flux');
      assert.doesNotMatch(JSON.stringify(state), /bfl_test_secret/);
      assert.equal(calls.map((call) => call.slideId).join(','), 'visual-cues,palette');
    } finally {
      await handle.stop();
    }
  });
});

async function waitForEventMatching(handle, sessionId, predicate) {
  for (let i = 0; i < 12; i += 1) {
    const event = await handle.runtime.waitForEvent(sessionId, { timeoutMs: 1000 });
    if (predicate(event)) return event;
  }
  throw new Error('Expected event was not received.');
}
