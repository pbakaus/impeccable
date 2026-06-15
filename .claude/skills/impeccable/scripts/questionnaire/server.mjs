#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDesignMd,
  slideSummary,
  writeDesignMd,
} from './design-md-builder.mjs';
import {
  buildInitArtifacts,
  initSlideSummary,
  resolveInitWriteTargets,
  saveSelectedInitImages,
  writeInitArtifacts,
} from './init-md-builder.mjs';
import {
  cropBuiltInQuadrantSheet,
  decorateInitImageRequest,
  generateInitImageBatch,
  publicImageProviderConfig,
  resolveImageProviderConfig,
} from './init-image-provider.mjs';
import {
  getNextInitSlideId,
  INIT_QUESTIONNAIRE_VERSION,
  INIT_SLIDES,
  normalizeInitAnswer,
  normalizeInitImageBatch,
  normalizeInitSlidePatch,
  normalizeInitTypographyBatch,
  validateCompleteInitAnswers,
  validateInitCommand,
} from './init-schema.mjs';
import {
  getNextSlideId,
  normalizeAnswer,
  normalizeSlidePatch,
  QUESTIONNAIRE_SLIDES,
  QUESTIONNAIRE_VERSION,
  validateCommand,
  validateCompleteAnswers,
} from './schema.mjs';

const __filename = fileURLToPath(import.meta.url);
const isCli = path.resolve(process.argv[1] || '') === __filename;
const MAX_JSON_BYTES = 50 * 1024 * 1024;
const INIT_IMAGE_SLIDE_IDS = new Set(['visual-cues', 'palette']);
const INIT_TYPOGRAPHY_SLIDE_ID = 'typography';

export function getQuestionnaireDir(cwd = process.cwd()) {
  return path.join(cwd, '.impeccable', 'questionnaire');
}

export function getQuestionnaireSessionsDir(cwd = process.cwd()) {
  return path.join(getQuestionnaireDir(cwd), 'sessions');
}

export function getQuestionnaireServerPath(cwd = process.cwd()) {
  return path.join(getQuestionnaireDir(cwd), 'server.json');
}

export function resolveQuestionnaireRoot(cwd = process.cwd(), targetPath = null) {
  if (!targetPath) return cwd;
  const absTarget = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(cwd, targetPath);
  const rel = path.relative(cwd, absTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('targetPath must stay inside the current workspace.');
  }
  let current = fs.existsSync(absTarget) && fs.statSync(absTarget).isDirectory()
    ? absTarget
    : path.dirname(absTarget);
  while (current.startsWith(cwd)) {
    if (
      fs.existsSync(path.join(current, 'PRODUCT.md'))
      || fs.existsSync(path.join(current, 'BRAND.md'))
      || fs.existsSync(path.join(current, 'DESIGN.md'))
      || fs.existsSync(path.join(current, 'package.json'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current || path.resolve(current) === path.resolve(cwd)) break;
    current = parent;
  }
  return cwd;
}

export function createQuestionnaireRuntime({
  cwd = process.cwd(),
  token = randomToken(),
  baseUrl = null,
  env = process.env,
  imageGeneration = null,
  fetchImpl = fetch,
  autoGenerateImages = true,
} = {}) {
  const sessions = new Map();
  const waiters = new Map();
  const browserStreams = new Map();
  let runtimeBaseUrl = baseUrl;

  function sessionPath(sessionId, root = cwd) {
    return path.join(getQuestionnaireSessionsDir(root), `${sessionId}.json`);
  }

  function saveSession(session) {
    fs.mkdirSync(getQuestionnaireSessionsDir(session.projectRoot), { recursive: true });
    session.updatedAt = new Date().toISOString();
    fs.writeFileSync(sessionPath(session.id, session.projectRoot), JSON.stringify(session, null, 2));
    sessions.set(session.id, session);
    return session;
  }

  function loadSession(sessionId) {
    if (sessions.has(sessionId)) return sessions.get(sessionId);
    const candidates = [
      sessionPath(sessionId, cwd),
      ...findSessionFiles(cwd, sessionId),
    ];
    for (const candidate of candidates) {
      try {
        const session = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        sessions.set(session.id, session);
        return session;
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  }

  function createSession({ command = 'shape', prompt = '', targetPath = null, mode = null } = {}) {
    const sessionMode = resolveMode(command, mode);
    validateCommandForMode(sessionMode, command);
    const projectRoot = resolveQuestionnaireRoot(cwd, targetPath);
    const id = `q_${Date.now().toString(36)}_${randomToken(4)}`;
    const existingDesign = sessionMode === 'design' && fs.existsSync(path.join(projectRoot, 'DESIGN.md'));
    const initTargets = sessionMode === 'init' ? resolveInitWriteTargets(projectRoot) : null;
    const imageProvider = sessionMode === 'init'
      ? publicImageProviderConfig(resolveImageProviderConfig({ cwd: projectRoot, env }))
      : null;
    const session = {
      schemaVersion: sessionMode === 'init'
        ? INIT_QUESTIONNAIRE_VERSION
        : QUESTIONNAIRE_VERSION,
      id,
      mode: sessionMode,
      command,
      prompt: String(prompt || ''),
      targetPath: targetPath || null,
      projectRoot,
      existingDesign: sessionMode === 'init' ? initTargets.design.existing : existingDesign,
      existingProduct: sessionMode === 'init' ? initTargets.product.existing : fs.existsSync(path.join(projectRoot, 'PRODUCT.md')),
      existingBrand: sessionMode === 'init' ? initTargets.brand.existing : fs.existsSync(path.join(projectRoot, 'BRAND.md')),
      targetPaths: sessionMode === 'init' ? {
        product: initTargets.product.targetPath,
        brand: initTargets.brand.targetPath,
        design: initTargets.design.targetPath,
      } : null,
      status: 'active',
      answers: {},
      slidePatches: {},
      imageBatches: {},
      imageProvider,
      typographyBatches: {},
      uploadedAssets: [],
      events: [],
      deliveredEventCount: 0,
      browserSubscribers: 0,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveSession(session);
    return {
      sessionId: id,
      url: sessionUrl(id),
      token,
      existingDesign: session.existingDesign,
      existingProduct: session.existingProduct,
      existingBrand: session.existingBrand,
      targetPath: targetPathForSession(session),
      targetPaths: session.targetPaths,
      projectRoot,
    };
  }

  function sessionUrl(sessionId) {
    if (!runtimeBaseUrl) return null;
    return `${runtimeBaseUrl}/questionnaire/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token)}`;
  }

  function recordAnswer({ sessionId, slideId, answer }) {
    const session = requireSession(sessionId);
    if (session.status !== 'active') throw new Error('Questionnaire is no longer active.');
    const normalized = normalizeAnswerForSession(session, slideId, answer);
    session.answers[slideId] = normalized;
    if (sessionMode(session) === 'init' && slideId === 'assets' && Array.isArray(normalized.assets)) {
      session.uploadedAssets = normalized.assets;
    }
    const event = {
      type: 'answer',
      sessionId,
      slideId,
      answer: normalized,
      answers: session.answers,
      nextSlideId: getNextSlideIdForSession(session, slideId),
      slidePatches: session.slidePatches,
      createdAt: new Date().toISOString(),
    };
    pushEvent(session, event);
    maybeQueueInitRequest(session, slideId, normalized);
    return event;
  }

  function completeSession({ sessionId }) {
    const session = requireSession(sessionId);
    const mode = sessionMode(session);
    if (mode === 'init') {
      recoverInitAnswers(session);
      validateCompleteInitAnswers(session.answers, {
        images: allSessionImages(session),
        typography: allSessionTypography(session),
        uploadedAssets: session.uploadedAssets || [],
        slidePatches: session.slidePatches || {},
      });
    } else {
      validateCompleteAnswers(session.answers);
    }
    const generatedAt = new Date().toISOString();
    const selectedImagePaths = mode === 'init'
      ? saveSelectedInitImages({
        cwd: session.projectRoot,
        sessionId: session.id,
        answers: session.answers,
        imageBatches: session.imageBatches || {},
      })
      : {};
    const initArtifacts = mode === 'init'
      ? buildInitArtifacts({
        answers: session.answers,
        imageBatches: session.imageBatches || {},
        typographyBatches: session.typographyBatches || {},
        uploadedAssets: session.uploadedAssets || [],
        selectedImagePaths,
        command: session.command,
        prompt: session.prompt,
        generatedAt,
      })
      : null;
    const artifact = mode === 'init'
      ? initArtifacts.designMd
      : buildDesignMd({
        answers: session.answers,
        command: session.command,
        prompt: session.prompt,
        generatedAt,
      });
    const writeTarget = mode === 'init'
      ? writeInitArtifacts({ cwd: session.projectRoot, artifacts: initArtifacts })
      : writeDesignMd({ cwd: session.projectRoot, designMd: artifact });
    session.status = 'complete';
    if (mode === 'init') {
      session.productMd = initArtifacts.productMd;
      session.brandMd = initArtifacts.brandMd;
      session.designMd = initArtifacts.designMd;
      session.selectedImagePaths = selectedImagePaths;
      session.targetPaths = writeTarget.targetPaths;
      session.writeActions = writeTarget.writeActions;
    } else session.designMd = artifact;
    session.artifact = artifact;
    session.artifactTargetPath = mode === 'init' ? writeTarget.targetPaths.design : writeTarget.targetPath;
    if (mode === 'init') {
      session.productTargetPath = writeTarget.targetPaths.product;
      session.brandTargetPath = writeTarget.targetPaths.brand;
      session.designTargetPath = writeTarget.targetPaths.design;
    } else session.designTargetPath = writeTarget.targetPath;
    session.writeAction = mode === 'init' ? writeTarget.writeActions.design : writeTarget.action;
    session.summary = mode === 'init'
      ? initSlideSummary(session.answers)
      : slideSummary(session.answers);
    const event = {
      type: 'complete',
      sessionId,
      answers: session.answers,
      ...(mode === 'init'
        ? { productMd: initArtifacts.productMd, brandMd: initArtifacts.brandMd, designMd: initArtifacts.designMd }
        : { designMd: artifact }),
      targetPath: mode === 'init' ? writeTarget.targetPaths.design : writeTarget.targetPath,
      targetPaths: mode === 'init' ? writeTarget.targetPaths : undefined,
      writeAction: mode === 'init' ? writeTarget.writeActions.design : writeTarget.action,
      writeActions: mode === 'init' ? writeTarget.writeActions : undefined,
      existingDesign: mode === 'init' ? writeTarget.existing.design : writeTarget.existingDesign,
      existingProduct: mode === 'init' ? writeTarget.existing.product : false,
      existingBrand: mode === 'init' ? writeTarget.existing.brand : false,
      slidePatches: session.slidePatches,
      typographyBatches: session.typographyBatches || {},
      uploadedAssets: summarizeUploadedAssets(session.uploadedAssets || []),
      selectedImagePaths,
      createdAt: new Date().toISOString(),
    };
    pushEvent(session, event);
    return event;
  }

  function cancelSession({ sessionId }) {
    const session = requireSession(sessionId);
    session.status = 'cancelled';
    const event = {
      type: 'cancel',
      sessionId,
      answers: session.answers,
      createdAt: new Date().toISOString(),
    };
    pushEvent(session, event);
    return event;
  }

  function getSessionState(sessionId) {
    const session = requireSession(sessionId);
    return publicSession(session);
  }

  function sendMessage({ sessionId, kind = 'info', message = '' }) {
    const session = requireSession(sessionId);
    const item = {
      kind: ['info', 'warning', 'error', 'success'].includes(kind) ? kind : 'info',
      message: String(message || ''),
      createdAt: new Date().toISOString(),
    };
    session.messages.push(item);
    saveSession(session);
    broadcastState(session, 'message');
    return item;
  }

  function updateSlide({ sessionId, slideId, patch = {} }) {
    const session = requireSession(sessionId);
    if (session.status !== 'active') throw new Error('Questionnaire is no longer active.');
    const mode = sessionMode(session);
    const normalized = mode === 'init'
      ? normalizeInitSlidePatch(slideId, patch)
      : normalizeSlidePatch(slideId, patch);
    session.slidePatches ||= {};
    session.slidePatches[slideId] = {
      ...(session.slidePatches[slideId] || {}),
      ...normalized,
      updatedAt: new Date().toISOString(),
      source: 'agent',
    };
    saveSession(session);
    broadcastState(session, 'slide');
    return {
      slideId,
      patch: session.slidePatches[slideId],
      slidePatches: session.slidePatches,
    };
  }

  function sendImageBatch({ sessionId, slideId, batchId, images = [] }) {
    const session = requireSession(sessionId);
    if (session.status !== 'active') throw new Error('Questionnaire is no longer active.');
    const mode = sessionMode(session);
    if (mode !== 'init') throw new Error('Image batches are only supported for init questionnaires.');
    const previousBatch = Array.isArray(session.imageBatches?.[slideId])
      ? session.imageBatches[slideId][session.imageBatches[slideId].length - 1]
      : null;
    const normalizedImages = normalizeInitImageBatch({ slideId, batchId, images });
    const normalizedBatchId = normalizedImages[0].batchId;
    const requestEvent = findImageRequestEvent(session, { slideId, batchId: normalizedBatchId });
    const shouldReplaceSlideAnswer = requestEvent?.reason === 'user-requested-more'
      || !hasDownstreamInitProgress(session, slideId);
    if (
      previousBatch?.batchId
      && previousBatch.batchId !== normalizedBatchId
      && session.answers?.[slideId]
      && shouldReplaceSlideAnswer
    ) {
      delete session.answers[slideId];
    }
    const batch = {
      batchId: normalizedBatchId,
      slideId,
      kind: normalizedImages[0].kind,
      images: normalizedImages,
      createdAt: new Date().toISOString(),
    };
    session.imageBatches ||= {};
    session.imageBatches[slideId] ||= [];
    session.imageBatches[slideId].push(batch);
    session.imageBatches[slideId] = session.imageBatches[slideId].slice(-1);
    const event = {
      type: 'image_batch',
      sessionId,
      slideId,
      batchId: normalizedBatchId,
      kind: batch.kind,
      images: publicImageSummaries(normalizedImages),
      imageBatches: latestPublicImageBatches(session.imageBatches),
      createdAt: batch.createdAt,
    };
    pushEvent(session, event);
    return batch;
  }

  function sendTypographyBatch({ sessionId, slideId, batchId, fontSets = [] }) {
    const session = requireSession(sessionId);
    if (session.status !== 'active') throw new Error('Questionnaire is no longer active.');
    const mode = sessionMode(session);
    if (mode !== 'init') throw new Error('Typography batches are only supported for init questionnaires.');
    const normalizedFontSets = normalizeInitTypographyBatch({ slideId, batchId, fontSets });
    const normalizedBatchId = normalizedFontSets[0].batchId;
    const batch = {
      batchId: normalizedBatchId,
      slideId,
      kind: 'typography',
      fontSets: normalizedFontSets,
      createdAt: new Date().toISOString(),
    };
    session.typographyBatches ||= {};
    session.typographyBatches[slideId] ||= [];
    session.typographyBatches[slideId].push(batch);
    const event = {
      type: 'typography_batch',
      sessionId,
      slideId,
      batchId: normalizedBatchId,
      kind: batch.kind,
      fontSets: normalizedFontSets,
      typographyBatches: session.typographyBatches,
      createdAt: batch.createdAt,
    };
    pushEvent(session, event);
    return batch;
  }

  function requestImageBatch({ sessionId, slideId, freeform = '', selectedImageIds = null } = {}) {
    const session = requireSession(sessionId);
    if (session.status !== 'active') throw new Error('Questionnaire is no longer active.');
    const mode = sessionMode(session);
    if (mode !== 'init') throw new Error('Image requests are only supported for init questionnaires.');
    const fallbackSelectedImageIds = slideId === 'palette'
      ? (Array.isArray(session.answers?.['visual-cues']?.value) ? session.answers['visual-cues'].value : [])
      : (Array.isArray(session.answers?.[slideId]?.value) ? session.answers[slideId].value : []);
    const requestSelectedImageIds = Array.isArray(selectedImageIds)
      ? selectedImageIds.map((value) => String(value || '').trim()).filter(Boolean)
      : fallbackSelectedImageIds;
    const request = imageRequestEventForSession(session, slideId, {
      reason: 'user-requested-more',
      freeform,
      selectedImageIds: requestSelectedImageIds,
    });
    pushEvent(session, request);
    maybeStartInitImageGeneration(session, request);
    return request;
  }

  function requestTypographyBatch({ sessionId, slideId = INIT_TYPOGRAPHY_SLIDE_ID, freeform = '', selectedTypographyIds = null } = {}) {
    const session = requireSession(sessionId);
    if (session.status !== 'active') throw new Error('Questionnaire is no longer active.');
    const mode = sessionMode(session);
    if (mode !== 'init') throw new Error('Typography requests are only supported for init questionnaires.');
    const fallbackSelectedTypographyIds = Array.isArray(session.answers?.[slideId]?.value)
      ? session.answers[slideId].value
      : [];
    const request = typographyRequestEventForSession(session, slideId, {
      reason: 'user-requested-more',
      freeform,
      selectedTypographyIds: Array.isArray(selectedTypographyIds)
        ? selectedTypographyIds.map((value) => String(value || '').trim()).filter(Boolean)
        : fallbackSelectedTypographyIds,
    });
    pushEvent(session, request);
    return request;
  }

  function uploadAssets({ sessionId, files = [] }) {
    const session = requireSession(sessionId);
    if (session.status !== 'active') throw new Error('Questionnaire is no longer active.');
    if (sessionMode(session) !== 'init') throw new Error('Uploads are only supported for init questionnaires.');
    if (!Array.isArray(files)) throw new Error('files must be an array.');
    const dir = path.join(session.projectRoot, '.impeccable', 'init', 'uploads', session.id);
    fs.mkdirSync(dir, { recursive: true });
    const saved = files.map((file, index) => {
      const originalName = String(file?.name || `upload-${index + 1}`).trim();
      const type = String(file?.type || file?.mimeType || 'application/octet-stream').trim();
      const parsed = parseUploadDataUrl(file?.dataUrl || '');
      if (!parsed) throw new Error(`Upload ${originalName} must include a base64 dataUrl.`);
      const safeName = uniqueUploadName(dir, originalName || `upload-${index + 1}`, parsed.mimeType);
      const absolutePath = path.join(dir, safeName);
      fs.writeFileSync(absolutePath, parsed.bytes);
      const previewDataUrl = parsed.mimeType.startsWith('image/') && parsed.bytes.length <= 3 * 1024 * 1024
        ? String(file.dataUrl)
        : '';
      return {
        id: `asset_${Date.now().toString(36)}_${randomToken(3)}_${index + 1}`,
        name: originalName || safeName,
        type: type || parsed.mimeType,
        role: String(file?.role || inferUploadRole(type || parsed.mimeType, originalName || safeName)).trim(),
        path: path.relative(session.projectRoot, absolutePath).split(path.sep).join('/'),
        previewDataUrl,
        size: parsed.bytes.length,
        width: Number.isFinite(Number(file?.width)) ? Number(file.width) : undefined,
        height: Number.isFinite(Number(file?.height)) ? Number(file.height) : undefined,
        createdAt: new Date().toISOString(),
      };
    });
    session.uploadedAssets ||= [];
    session.uploadedAssets.push(...saved);
    session.answers.assets = normalizeInitAnswer('assets', { assets: session.uploadedAssets });
    const event = {
      type: 'upload',
      sessionId,
      slideId: 'assets',
      assets: saved,
      uploadedAssets: session.uploadedAssets,
      answers: session.answers,
      createdAt: new Date().toISOString(),
    };
    pushEvent(session, event);
    return { assets: saved, uploadedAssets: session.uploadedAssets };
  }

  function requestDelegateChoice({ sessionId, slideId, freeform = '' }) {
    const session = requireSession(sessionId);
    if (session.status !== 'active') throw new Error('Questionnaire is no longer active.');
    const slide = slidesForSession(session).find((item) => item.id === slideId);
    if (!slide) throw new Error(`Unknown slide: ${slideId}`);
    if (slide.delegable === false) throw new Error('This slide cannot be delegated.');
    const event = {
      type: 'delegate_request',
      sessionId,
      slideId,
      slide,
      freeform: String(freeform || '').trim(),
      answers: session.answers,
      slidePatches: session.slidePatches || {},
      uploadedAssets: session.uploadedAssets || [],
      imageBatches: session.imageBatches || {},
      typographyBatches: session.typographyBatches || {},
      createdAt: new Date().toISOString(),
    };
    pushEvent(session, event);
    return event;
  }

  function applyDelegateChoice({ sessionId, slideId, answer, rationale = '' }) {
    const session = requireSession(sessionId);
    if (session.status !== 'active') throw new Error('Questionnaire is no longer active.');
    const normalized = normalizeAnswerForSession(session, slideId, {
      ...(answer || {}),
      freeform: answer?.freeform || rationale || undefined,
    });
    session.answers[slideId] = normalized;
    const event = {
      type: 'delegate_answer',
      sessionId,
      slideId,
      answer: normalized,
      answers: session.answers,
      rationale: String(rationale || '').trim(),
      createdAt: new Date().toISOString(),
    };
    pushEvent(session, event);
    return event;
  }

  async function handleAgentReply(body = {}) {
    const action = String(body.action || body.type || '').trim();
    if (action === 'slide' || action === 'update_slide') {
      return updateSlide({ sessionId: body.sessionId, slideId: body.slideId, patch: body.patch || body });
    }
    if (action === 'message' || action === 'send_message') {
      return sendMessage({ sessionId: body.sessionId, kind: body.kind, message: body.message });
    }
    if (action === 'image_batch') {
      return sendImageBatch({ sessionId: body.sessionId, slideId: body.slideId, batchId: body.batchId, images: body.images });
    }
    if (action === 'image_sheet' || action === 'quadrant_sheet') {
      return sendImageSheet({
        sessionId: body.sessionId,
        slideId: body.slideId,
        batchId: body.batchId,
        sheetDataUrl: body.sheetDataUrl || body.dataUrl,
        sheetPath: body.sheetPath || body.path,
      });
    }
    if (action === 'typography_batch') {
      return sendTypographyBatch({ sessionId: body.sessionId, slideId: body.slideId, batchId: body.batchId, fontSets: body.fontSets });
    }
    if (action === 'delegate_answer') {
      return applyDelegateChoice({ sessionId: body.sessionId, slideId: body.slideId, answer: body.answer, rationale: body.rationale });
    }
    if (action === 'complete') {
      return completeSession({ sessionId: body.sessionId });
    }
    throw new Error('Unknown poll reply action.');
  }

  function maybeQueueInitRequest(session, answeredSlideId, answer) {
    if (sessionMode(session) !== 'init') return null;
    if (answeredSlideId === 'anti-audience') {
      const event = initImageRequestEvent(session, 'visual-cues', {
        reason: 'initial-visual-cues',
      });
      pushEvent(session, event);
      maybeStartInitImageGeneration(session, event);
      return event;
    }
    if (answeredSlideId === 'visual-cues') {
      const event = initImageRequestEvent(session, 'palette', {
        reason: 'initial-palette',
        selectedImageIds: answer.value || [],
      });
      pushEvent(session, event);
      maybeStartInitImageGeneration(session, event);
      return event;
    }
    if (answeredSlideId === 'palette') {
      const event = initTypographyRequestEvent(session, INIT_TYPOGRAPHY_SLIDE_ID, {
        reason: 'initial-typography',
      });
      pushEvent(session, event);
      return event;
    }
    return null;
  }

  function recoverInitAnswers(session) {
    if (sessionMode(session) !== 'init') return;
    session.answers ||= {};
    if (!hasEnoughInitSelection(session.answers['visual-cues'], 2)) {
      const paletteRequest = latestSessionEvent(session, (event) => (
        event?.type === 'image_request'
        && event.slideId === 'palette'
        && Array.isArray(event.selectedImageIds)
        && event.selectedImageIds.length >= 2
      ));
      if (paletteRequest) {
        session.answers['visual-cues'] = normalizeAnswerForSession(session, 'visual-cues', {
          value: paletteRequest.selectedImageIds,
          batchId: paletteRequest.selectedImages?.[0]?.batchId,
        });
      }
    }
    if (!hasEnoughInitSelection(session.answers.palette, 1)) {
      const typographyRequest = latestSessionEvent(session, (event) => (
        event?.type === 'typography_request'
        && event.selectedPaletteId
      ));
      if (typographyRequest) {
        session.answers.palette = normalizeAnswerForSession(session, 'palette', {
          value: [typographyRequest.selectedPaletteId],
          batchId: typographyRequest.selectedPalette?.batchId,
        });
      }
    }
    saveSession(session);
  }

  function hasEnoughInitSelection(answer, min) {
    return Array.isArray(answer?.value) && answer.value.length >= min;
  }

  function latestSessionEvent(session, predicate) {
    const events = Array.isArray(session.events) ? session.events : [];
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (predicate(events[i])) return events[i];
    }
    return null;
  }

  function hasDownstreamInitProgress(session, slideId) {
    if (sessionMode(session) !== 'init') return false;
    const events = Array.isArray(session.events) ? session.events : [];
    if (slideId === 'visual-cues') {
      return Boolean(session.answers?.palette || session.answers?.typography || events.some((event) => (
        event?.slideId === 'palette' || event?.slideId === 'typography'
      )));
    }
    if (slideId === 'palette') {
      return Boolean(session.answers?.typography || events.some((event) => event?.slideId === 'typography'));
    }
    return false;
  }

  function summarizeUploadedAssets(assets = []) {
    return assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      role: asset.role,
      path: asset.path,
      size: asset.size,
      width: asset.width,
      height: asset.height,
      createdAt: asset.createdAt,
    }));
  }

  async function sendImageSheet({ sessionId, slideId, batchId, sheetDataUrl = '', sheetPath = '' }) {
    const session = requireSession(sessionId);
    if (session.status !== 'active') throw new Error('Questionnaire is no longer active.');
    if (sessionMode(session) !== 'init') throw new Error('Image sheets are only supported for init questionnaires.');
    const request = findImageRequestEvent(session, { slideId, batchId })
      || initImageRequestEvent(session, slideId, { reason: 'image-sheet' });
    const result = await cropBuiltInQuadrantSheet({
      request: { ...request, batchId: batchId || request.batchId, slideId },
      sheetDataUrl,
      sheetPath,
      cwd: session.projectRoot,
    });
    return sendImageBatch({
      sessionId,
      slideId,
      batchId: result.batchId,
      images: result.images,
    });
  }

  function maybeStartInitImageGeneration(session, request) {
    if (!autoGenerateImages || sessionMode(session) !== 'init' || request?.type !== 'image_request') return;
    const providerConfig = resolveImageProviderConfig({ cwd: session.projectRoot, env });
    session.imageProvider = publicImageProviderConfig(providerConfig);
    saveSession(session);
    broadcastState(session, 'image_provider');
    if (providerConfig.provider !== 'flux') return;
    const generator = imageGeneration || ((event, options) => generateInitImageBatch(event, options));
    Promise.resolve()
      .then(() => generator(request, {
        cwd: session.projectRoot,
        env,
        providerConfig,
        fetchImpl,
      }))
      .then((result) => {
        sendImageBatch({
          sessionId: session.id,
          slideId: request.slideId,
          batchId: request.batchId,
          images: result.images,
        });
      })
      .catch((error) => {
        sendMessage({
          sessionId: session.id,
          kind: 'error',
          message: `Image generation failed: ${safeProviderError(error)}`,
        });
      });
  }

  function waitForEvent(sessionId, { timeoutMs = 600000 } = {}) {
    const session = requireSession(sessionId);
    const next = nextUndeliveredEvent(session);
    if (next) return Promise.resolve(next);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        removeWaiter(sessionId, waiter);
        resolve({ type: 'timeout', sessionId, createdAt: new Date().toISOString() });
      }, Math.max(0, Number(timeoutMs) || 0));
      const waiter = {
        resolve: (event) => {
          clearTimeout(timer);
          resolve(event);
        },
      };
      const list = waiters.get(sessionId) || [];
      list.push(waiter);
      waiters.set(sessionId, list);
    });
  }

  function removeWaiter(sessionId, waiter) {
    const pending = waiters.get(sessionId) || [];
    const next = pending.filter((item) => item !== waiter);
    if (next.length > 0) waiters.set(sessionId, next);
    else waiters.delete(sessionId);
  }

  function stopSession(sessionId) {
    const session = loadSession(sessionId);
    if (!session) return { ok: true, stopped: false };
    session.status = session.status === 'active' ? 'stopped' : session.status;
    saveSession(session);
    const pending = waiters.get(sessionId) || [];
    waiters.delete(sessionId);
    for (const waiter of pending) {
      waiter.resolve({ type: 'cancel', sessionId, createdAt: new Date().toISOString() });
    }
    return { ok: true, stopped: true };
  }

  function subscribeBrowser(sessionId, res) {
    const session = requireSession(sessionId);
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`event: state\ndata: ${JSON.stringify(publicSession(session))}\n\n`);
    const client = { res };
    const clients = browserStreams.get(sessionId) || new Set();
    clients.add(client);
    browserStreams.set(sessionId, clients);
    session.browserSubscribers = clients.size;
    saveSession(session);
    const heartbeat = setInterval(() => {
      try { res.write(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`); } catch {}
    }, 30000);
    res.on('close', () => {
      clearInterval(heartbeat);
      const next = browserStreams.get(sessionId);
      if (!next) return;
      next.delete(client);
      if (next.size === 0) browserStreams.delete(sessionId);
    });
  }

  function broadcastState(session, eventName = 'state') {
    const clients = browserStreams.get(session.id);
    if (!clients || clients.size === 0) return;
    const payload = JSON.stringify(publicSession(session));
    for (const client of clients) {
      try {
        client.res.write(`event: ${eventName}\ndata: ${payload}\n\n`);
      } catch {
        clients.delete(client);
      }
    }
    if (clients.size === 0) browserStreams.delete(session.id);
  }

  function pushEvent(session, event) {
    session.events.push(event);
    saveSession(session);
    broadcastState(session, event.type || 'state');
    const pending = waiters.get(session.id) || [];
    if (pending.length > 0) {
      const next = nextUndeliveredEvent(session);
      const waiter = pending.shift();
      if (pending.length > 0) waiters.set(session.id, pending);
      else waiters.delete(session.id);
      if (next) waiter.resolve(next);
    }
    return event;
  }

  function nextUndeliveredEvent(session) {
    if (session.deliveredEventCount >= session.events.length) return null;
    const event = session.events[session.deliveredEventCount];
    session.deliveredEventCount += 1;
    saveSession(session);
    return event;
  }

  function requireSession(sessionId) {
    const session = loadSession(sessionId);
    if (!session) throw new Error(`Unknown questionnaire session: ${sessionId}`);
    return session;
  }

  async function handleRequest(req, res) {
    const url = new URL(req.url, runtimeBaseUrl || 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, { ok: true, mode: 'questionnaire', token, baseUrl: runtimeBaseUrl });
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/questionnaire/')) {
        assertToken(url);
        const sessionId = decodeURIComponent(url.pathname.split('/').pop() || '');
        const session = requireSession(sessionId);
        html(res, renderQuestionnairePage({ session, token }));
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/assets/neo-kinpaku/')) {
        const served = serveDesignSystemAsset(url.pathname, res, cwd);
        if (served) return;
      }

      if (req.method === 'GET' && url.pathname === '/api/state') {
        assertToken(url);
        const sessionId = url.searchParams.get('sessionId');
        json(res, 200, getSessionState(sessionId));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/events') {
        assertToken(url);
        const sessionId = url.searchParams.get('sessionId');
        subscribeBrowser(sessionId, res);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/poll') {
        assertToken(url);
        const sessionId = url.searchParams.get('sessionId');
        const timeoutMs = Number(url.searchParams.get('timeoutMs') || url.searchParams.get('timeout') || 600000);
        json(res, 200, await waitForEvent(sessionId, { timeoutMs }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/poll') {
        const body = await readJson(req);
        assertBodyToken(body);
        json(res, 200, { ok: true, result: await handleAgentReply(body) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/session') {
        assertToken(url);
        json(res, 200, createSession(await readJson(req)));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/answer') {
        const body = await readJson(req);
        assertBodyToken(body);
        json(res, 200, { ok: true, event: recordAnswer(body) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/upload') {
        const body = await readJson(req);
        assertBodyToken(body);
        json(res, 200, { ok: true, upload: uploadAssets(body) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/delegate') {
        const body = await readJson(req);
        assertBodyToken(body);
        json(res, 200, { ok: true, event: requestDelegateChoice(body) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/complete') {
        const body = await readJson(req);
        assertBodyToken(body);
        json(res, 200, { ok: true, event: completeSession(body) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/cancel') {
        const body = await readJson(req);
        assertBodyToken(body);
        json(res, 200, { ok: true, event: cancelSession(body) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/message') {
        const body = await readJson(req);
        assertBodyToken(body);
        json(res, 200, { ok: true, message: sendMessage(body) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/slide') {
        const body = await readJson(req);
        assertBodyToken(body);
        json(res, 200, { ok: true, slide: updateSlide(body) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/image-batch') {
        const body = await readJson(req);
        assertBodyToken(body);
        json(res, 200, { ok: true, batch: sendImageBatch(body) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/image-request') {
        const body = await readJson(req);
        assertBodyToken(body);
        json(res, 200, { ok: true, event: requestImageBatch(body) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/typography-batch') {
        const body = await readJson(req);
        assertBodyToken(body);
        json(res, 200, { ok: true, batch: sendTypographyBatch(body) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/typography-request') {
        const body = await readJson(req);
        assertBodyToken(body);
        json(res, 200, { ok: true, event: requestTypographyBatch(body) });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/delegate-answer') {
        const body = await readJson(req);
        assertBodyToken(body);
        json(res, 200, { ok: true, event: applyDelegateChoice(body) });
        return;
      }

      json(res, 404, { ok: false, error: 'not_found' });
    } catch (err) {
      json(res, 400, { ok: false, error: err.message });
    }
  }

  function setBaseUrl(nextBaseUrl) {
    runtimeBaseUrl = nextBaseUrl;
  }

  function assertToken(url) {
    if (url.searchParams.get('token') !== token) throw new Error('Unauthorized.');
  }

  function assertBodyToken(body) {
    if (!body || body.token !== token) throw new Error('Unauthorized.');
  }

  return {
    get token() { return token; },
    get baseUrl() { return runtimeBaseUrl; },
    setBaseUrl,
    createSession,
    recordAnswer,
    completeSession,
    cancelSession,
    getSessionState,
    sendMessage,
    updateSlide,
    sendImageBatch,
    sendImageSheet,
    requestImageBatch,
    sendTypographyBatch,
    requestTypographyBatch,
    uploadAssets,
    requestDelegateChoice,
    applyDelegateChoice,
    waitForEvent,
    stopSession,
    handleRequest,
  };
}

export async function startQuestionnaireServer({
  cwd = process.cwd(),
  port = 0,
  token = randomToken(),
  env = process.env,
  imageGeneration = null,
  fetchImpl = fetch,
  autoGenerateImages = true,
} = {}) {
  const runtime = createQuestionnaireRuntime({ cwd, token, env, imageGeneration, fetchImpl, autoGenerateImages });
  const selectedPort = port || await findOpenPort(8600);
  const server = http.createServer(runtime.handleRequest);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(selectedPort, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const actualPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${actualPort}`;
  runtime.setBaseUrl(baseUrl);
  const info = {
    pid: process.pid,
    port: actualPort,
    token: runtime.token,
    baseUrl,
    cwd,
  };
  fs.mkdirSync(getQuestionnaireDir(cwd), { recursive: true });
  fs.writeFileSync(getQuestionnaireServerPath(cwd), JSON.stringify(info, null, 2));
  return {
    runtime,
    server,
    port: actualPort,
    token: runtime.token,
    baseUrl,
    stop: () => new Promise((resolve) => {
      try { fs.rmSync(getQuestionnaireServerPath(cwd), { force: true }); } catch {}
      server.close(() => resolve());
    }),
  };
}

function resolveMode(command = 'shape', mode = null) {
  if (mode === 'init' || mode === 'identity' || command === 'init' || command === 'identity') return 'init';
  return 'design';
}

function sessionMode(session) {
  if (session?.mode === 'init' || session?.mode === 'identity' || session?.command === 'init' || session?.command === 'identity') return 'init';
  return 'design';
}

function validateCommandForMode(mode, command) {
  if (mode === 'init') return validateInitCommand(command);
  return validateCommand(command);
}

function slidesForSession(session) {
  const mode = sessionMode(session);
  if (mode === 'init') return INIT_SLIDES;
  return QUESTIONNAIRE_SLIDES;
}

function getNextSlideIdForSession(session, slideId) {
  const mode = sessionMode(session);
  if (mode === 'init') return getNextInitSlideId(slideId);
  return getNextSlideId(slideId);
}

function normalizeAnswerForSession(session, slideId, answer) {
  const mode = sessionMode(session);
  if (mode === 'init') {
    return normalizeInitAnswer(slideId, answer, {
      images: allSessionImages(session),
      typography: allSessionTypography(session),
      batchId: latestSessionImageBatchId(session, slideId),
      uploadedAssets: session.uploadedAssets || [],
      slidePatches: session.slidePatches || {},
    });
  }
  return normalizeAnswer(slideId, answer);
}

function allSessionImages(session) {
  return Object.values(session.imageBatches || {})
    .flatMap((batches) => Array.isArray(batches) ? batches : [])
    .flatMap((batch) => Array.isArray(batch.images) ? batch.images : []);
}

function latestSessionImageBatchId(session, slideId) {
  const batches = Array.isArray(session.imageBatches?.[slideId]) ? session.imageBatches[slideId] : [];
  return batches[batches.length - 1]?.batchId || '';
}

function allSessionTypography(session) {
  return Object.values(session.typographyBatches || {})
    .flatMap((batches) => Array.isArray(batches) ? batches : [])
    .flatMap((batch) => Array.isArray(batch.fontSets) ? batch.fontSets : []);
}

function targetPathForSession(session) {
  if (sessionMode(session) === 'init') {
    return session.targetPaths?.design || (session.existingDesign ? path.join('.impeccable', 'init', 'DESIGN.next.md') : 'DESIGN.md');
  }
  return session.existingDesign ? path.join('.impeccable', 'questionnaire', 'DESIGN.next.md') : 'DESIGN.md';
}

function imageRequestEventForSession(session, slideId, options = {}) {
  if (sessionMode(session) !== 'init') throw new Error('Image requests are only supported for init questionnaires.');
  return initImageRequestEvent(session, slideId, options);
}

function typographyRequestEventForSession(session, slideId, options = {}) {
  if (sessionMode(session) !== 'init') throw new Error('Typography requests are only supported for init questionnaires.');
  return initTypographyRequestEvent(session, slideId, options);
}

function initImageRequestEvent(session, slideId, { reason = 'initial', freeform = '', selectedImageIds = [] } = {}) {
  if (!INIT_IMAGE_SLIDE_IDS.has(slideId)) {
    throw new Error(`Slide ${slideId} does not request init images.`);
  }
  const kind = slideId === 'palette' ? 'palette' : 'visual-cue';
  const prefix = kind === 'palette' ? 'palette_batch' : 'cue_batch';
  const batchId = `${prefix}_${Date.now().toString(36)}_${randomToken(3)}`;
  const selectedImages = selectedImageIds.length > 0
    ? selectedSessionImages(session, selectedImageIds)
    : [];
  const event = {
    type: 'image_request',
    sessionId: session.id,
    slideId,
    kind,
    batchId,
    reason,
    freeform: String(freeform || '').trim(),
    answers: session.answers,
    selectedImageIds,
    selectedImages,
    uploadedAssets: session.uploadedAssets || [],
    promptContext: initPromptContext(session, { freeform, selectedImages }),
    imagePromptGuidance: imagePromptGuidanceFor(kind, 'init'),
    imagePromptContract: imagePromptContractFor(kind, 'init'),
    createdAt: new Date().toISOString(),
  };
  return decorateInitImageRequest(event, {
    imageProvider: session.imageProvider || publicImageProviderConfig(resolveImageProviderConfig({ cwd: session.projectRoot })),
  });
}

function initTypographyRequestEvent(session, slideId, { reason = 'initial', freeform = '', selectedTypographyIds = [] } = {}) {
  if (slideId !== INIT_TYPOGRAPHY_SLIDE_ID) {
    throw new Error(`Slide ${slideId} does not request init typography.`);
  }
  const batchId = `type_batch_${Date.now().toString(36)}_${randomToken(3)}`;
  const selectedCueIds = Array.isArray(session.answers?.['visual-cues']?.value)
    ? session.answers['visual-cues'].value
    : [];
  const selectedPaletteIds = Array.isArray(session.answers?.palette?.value)
    ? session.answers.palette.value
    : [];
  const selectedCueImages = selectedSessionImages(session, selectedCueIds);
  const selectedPalette = selectedSessionImages(session, selectedPaletteIds)[0] || null;
  const selectedTypography = selectedSessionTypography(session, selectedTypographyIds);
  return {
    type: 'typography_request',
    sessionId: session.id,
    slideId,
    kind: 'typography',
    batchId,
    reason,
    freeform: String(freeform || '').trim(),
    answers: session.answers,
    selectedCueIds,
    selectedCueImages,
    selectedPaletteId: selectedPalette?.id || '',
    selectedPalette,
    selectedPaletteColors: selectedPalette?.colors || [],
    selectedTypographyIds,
    selectedTypography,
    uploadedAssets: session.uploadedAssets || [],
    promptContext: initTypographyPromptContext(session, {
      freeform,
      selectedCueImages,
      selectedPalette,
      selectedTypography,
    }),
    typographyGuidance: typographyGuidance('init'),
    typographyContract: typographyContract(),
    createdAt: new Date().toISOString(),
  };
}

function selectedSessionImages(session, selectedImageIds = []) {
  const latestById = new Map();
  for (const image of allSessionImages(session).reverse()) {
    if (!latestById.has(image.id)) latestById.set(image.id, image);
  }
  return selectedImageIds.map((id) => latestById.get(id)).filter(Boolean);
}

function selectedSessionTypography(session, selectedTypographyIds = []) {
  const latestById = new Map();
  for (const fontSet of allSessionTypography(session).reverse()) {
    if (!latestById.has(fontSet.id)) latestById.set(fontSet.id, fontSet);
  }
  return selectedTypographyIds.map((id) => latestById.get(id)).filter(Boolean);
}

function findImageRequestEvent(session, { slideId, batchId }) {
  const events = Array.isArray(session.events) ? session.events : [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.type === 'image_request'
      && event.slideId === slideId
      && (!batchId || event.batchId === batchId)
    ) {
      return event;
    }
  }
  return null;
}

function initPromptContext(session, { freeform = '', selectedImages = [] } = {}) {
  const answers = session.answers || {};
  const uploadedAssets = session.uploadedAssets || [];
  return {
    product: semanticInitAnswerText(answers['product-overview']),
    differentiator: semanticInitAnswerText(answers.differentiator),
    trust: semanticInitAnswerText(answers.trust),
    audienceFit: semanticInitAnswerText(answers['audience-fit']),
    antiAudience: semanticInitAnswerText(answers['anti-audience']),
    userDirection: String(freeform || '').trim(),
    uploadedAssetSummary: uploadedAssets.map((asset, index) => `Image ${index + 1}: ${asset.role || asset.type || 'reference'} (${asset.name || asset.id})`).join('; '),
    uploadedAssets: uploadedAssets.map((asset, index) => ({
      index: index + 1,
      id: asset.id,
      name: asset.name,
      type: asset.type,
      role: asset.role,
      path: asset.path,
      width: asset.width,
      height: asset.height,
    })),
    selectedCueImages: selectedImages.map((image) => ({
      id: image.id,
      label: image.label,
      routeFamily: image.routeFamily,
      prompt: truncateInitContextText(image.prompt),
    })),
  };
}

function initTypographyPromptContext(session, { freeform = '', selectedCueImages = [], selectedPalette = null, selectedTypography = [] } = {}) {
  const answers = session.answers || {};
  const uploadedAssets = session.uploadedAssets || [];
  return {
    product: semanticInitAnswerText(answers['product-overview']),
    differentiator: semanticInitAnswerText(answers.differentiator),
    trust: semanticInitAnswerText(answers.trust),
    audienceFit: semanticInitAnswerText(answers['audience-fit']),
    antiAudience: semanticInitAnswerText(answers['anti-audience']),
    userDirection: String(freeform || '').trim(),
    uploadedAssetSummary: uploadedAssets.map((asset, index) => `Image ${index + 1}: ${asset.role || asset.type || 'reference'} (${asset.name || asset.id})`).join('; '),
    uploadedAssets: uploadedAssets.map((asset, index) => ({
      index: index + 1,
      id: asset.id,
      name: asset.name,
      type: asset.type,
      role: asset.role,
      path: asset.path,
    })),
    selectedCueImages: selectedCueImages.map((image) => ({
      id: image.id,
      label: image.label,
      routeFamily: image.routeFamily,
      prompt: truncateInitContextText(image.prompt),
    })),
    selectedPalette: selectedPalette ? {
      id: selectedPalette.id,
      label: selectedPalette.label,
      prompt: truncateInitContextText(selectedPalette.prompt),
      colors: selectedPalette.colors || [],
      routeFamilies: selectedPalette.routeFamilies || [],
    } : null,
    selectedTypography: selectedTypography.map((fontSet) => ({
      id: fontSet.id,
      label: fontSet.label,
      heading: fontSet.heading,
      body: fontSet.body,
      rationale: fontSet.rationale,
    })),
  };
}

function semanticInitAnswerText(answer) {
  if (!answer || typeof answer !== 'object') return '';
  const candidates = [answer.freeform, answer.value, answer.label];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) continue;
    const text = String(candidate || '').trim();
    if (!text) continue;
    if (/^(recommended|route\s+\d+|option\s+\d+)$/i.test(text)) continue;
    return text;
  }
  return '';
}

function truncateInitContextText(value, max = 1200) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function typographyGuidance(mode = 'init') {
  return [
    'Use the Impeccable typeset skill guidance: choose fonts for personality, hierarchy, readability, performance, and accessible contrast.',
    mode === 'init'
      ? 'Act like a senior brand designer showing type directions after seeing the product, brand stance, selected cue route families, selected palette, and uploaded assets.'
      : 'Act like a senior brand designer showing first-round type directions after seeing the selected visual cues and palette.',
    'Suggest exactly four distinct heading/body systems; each should be a strategic route, not a random pair.',
    'Use actual web fonts that can be loaded in the browser. Provide a Google Fonts CSS URL for each set.',
    'Pair on a meaningful contrast axis: serif plus sans, display plus humanist body, editorial plus utilitarian, or one family only when its range is the concept.',
    'Avoid generic defaults such as Inter, Roboto, Open Sans, Arial, and system UI unless the brand context makes a strong case.',
    'Do not use decorative, fragile, or low-readability faces for body copy.',
    'Load only the weights the option needs. Prefer 400 and 600/700 over excessive weight ranges.',
    'Make every label and rationale specific to the brand, selected cues, and selected palette.',
  ];
}

function typographyContract() {
  return {
    output: 'Four typography cards, each with real loadable heading and body fonts plus designer rationale.',
    requiredCount: 4,
    payloadRules: [
      'Each font set must include id, label, cssUrl, heading.family, body.family, sampleHeading, sampleBody, rationale, usage, and optional avoid.',
      'cssUrl must be a Google Fonts CSS URL, using https://fonts.googleapis.com/css..., that loads both heading and body families with the listed weights.',
      'heading.weights and body.weights should list only the numeric weights needed for the preview and eventual implementation.',
      'sampleHeading and sampleBody should be brand-contextual text, not lorem ipsum.',
      'Do not include image payloads for typography cards.',
    ],
    suggestedRoutes: [
      'Expressive heading with highly readable product body.',
      'Soft editorial heading with calm utility body.',
      'Precise label-like heading with ingredient-friendly body.',
      'Distinctive but accessible display with mobile-commerce body.',
    ],
  };
}

function imagePromptGuidanceFor(kind, mode = 'init') {
  const base = [
    'Default to Flux Pro parallel when IMAGE_API_KEY is configured; otherwise use the built-in 2x2 quadrant fallback described on the image_request payload.',
    'Write each image prompt as a senior brand designer/art director would brief a first-round identity exploration.',
    'Follow current OpenAI and BFL prompting guidance: put the most important visual intent early, use a consistent labeled structure, state intended use, and specify medium, composition, framing, lighting, mood, texture, and constraints.',
    'Use positive visual direction first; keep the final negative constraint line short and specific.',
    'When uploaded product assets are present, reference them explicitly by index and role (for example: Image 1 product photo, Image 2 texture reference) and say how each should influence the result.',
    'Use concrete visible language. Avoid vague adjectives such as premium, modern, elegant, luxury, clean, and minimal unless they are translated into visual choices.',
    'Create four distinct strategic routes per batch, not near-duplicates; vary motif, material logic, composition, light temperature, and emotional register.',
    'Flux path: generate four independent 1:1 images in parallel/fan-out, never a contact sheet, collage, sprite sheet, montage, or combined image.',
    'Built-in fallback path: generate one strict 2x2 sheet only when requested, then crop locally and send the browser four normal cards.',
    'No text, no logos, no lettering, no numerals, no watermark, no UI mockup, no website screen, no fake packaging label.',
    'Transparent PNG/WebP outputs are useful for cutouts, but avoid them in this flow so cue and palette cards render consistently on the lacquer browser surface.',
  ];
  if (kind === 'palette') {
    return [
      ...base,
      'Use the selected cue images as primary visual references; palette routes must visibly inherit their materials, temperature, edge quality, and atmosphere.',
      'Generate palette direction imagery only: an abstract color-material board with four clear color relationships, browser UI renders labels and swatches separately.',
      'Each palette must be a color strategy with roles, contrast logic, and brand rationale, not a decorative gradient.',
      mode === 'init'
        ? 'Inherit selected cue route families instead of flattening everything back into physical fragments.'
        : 'Preserve the selected cue image atmosphere.',
      'Return exactly four named OKLCH colors with each palette payload; names should describe brand roles, not generic hues.',
    ];
  }
  if (mode === 'init') {
    return [
      ...base,
      'Explore visual cues across distinct art-direction route families: material-object, graphic-shape, gesture-motion, atmosphere-light, playful-character, pattern-ornament, surreal-metaphor, and editorial-cultural.',
      'Every visual cue image payload must include routeFamily. Each batch of four must include at least three different routeFamily values.',
      'Do not default every card to a realistic material still life. A cue may be physical, graphic, symbolic, playful, atmospheric, patterned, surreal, or culturally art-directed.',
      'Each cue must still translate into design behavior: spacing, surface, edge, image, icon, motion, or interaction language.',
      'A batch should feel like four different art-direction doors, not four variations of the same object.',
    ];
  }
  return [
    ...base,
    'Explore elemental or material carry cues that can become spacing, surface, edge, image, icon, and motion language.',
    'Prefer abstract-but-specific physical cues: folded paper tension, ceramic glaze pooling, petal geometry, woven fiber rhythm, cast shadow veil, mineral dust, shell edge, vapor layer, protective film.',
    'Each cue card needs one clear visual thesis and a browser-rendered label that names the motif in two or three words.',
    'Avoid literal website sections, app screens, typography specimens, collage moodboards, stock photos, people, and decorative clip art.',
  ];
}

function imagePromptContractFor(kind, mode = 'init') {
  if (kind === 'palette') {
    return {
      model: 'flux-2-pro-preview-or-built-in-quadrant',
      quality: 'high',
      size: '1024x1024',
      output: 'Four independent palette cards, each with a no-text image plus exactly four named OKLCH colors in the payload.',
      promptTemplate: [
        'Create a 1:1 square brand identity palette study for [brand].',
        'Intent: translate the selected visual cue images into one coherent color strategy for a real site identity.',
        'Brand context: [site overview], for [primary audience].',
        'Reference cues: selected visual cue images, [selected cue labels and what their images show].',
        'Palette route: [distinct strategic direction, e.g. quiet mineral warmth / luminous care / editorial contrast / deep atmospheric trust].',
        mode === 'init'
          ? 'Image content: a no-text color-world artifact with four deliberate color relationships; it may use material fragments, graphic fields, light studies, pattern fragments, or surreal/editorial set pieces based on selected cue route families.'
          : 'Image content: an abstract material color board with four deliberate color relationships; use physical fragments, surfaces, shadows, and negative space, not flat UI swatches.',
        'Composition: square editorial art-board, controlled spacing, clear hierarchy, no busy collage.',
        'Lighting and finish: studio-grade, tactile, color-accurate, believable shadows, refined material contrast.',
        'Constraints: no text, no lettering, no numerals, no logos, no watermark, no UI, no labels inside the image, opaque background.',
      ],
      colorPayloadRules: [
        'Return exactly four colors.',
        'Each color needs a role-aware name and valid OKLCH string.',
        'Make one color suitable for ground/background, one for primary accent/action, one for support/surface, and one for contrast or depth unless the brand context demands another role split.',
      ],
    };
  }
  if (mode === 'init') {
    return {
      model: 'flux-2-pro-preview-or-built-in-quadrant',
      quality: 'high',
      size: '1024x1024',
      output: 'Four independent visual cue cards, each with one no-text image, concise motif label, and routeFamily.',
      routeFamilies: [
        'material-object',
        'graphic-shape',
        'gesture-motion',
        'atmosphere-light',
        'playful-character',
        'pattern-ornament',
        'surreal-metaphor',
        'editorial-cultural',
      ],
      promptTemplate: [
        'Create a 1:1 square brand identity cue for [brand/product].',
        'Intent: first-round brand identity cue, not decoration.',
        'Brand context: [product overview], [differentiator], [trust], [audience fit], [anti-audience].',
        'Product references: when uploaded assets exist, reference them by index and role, e.g. Image 1 product photo, Image 2 process texture, and explain what to borrow.',
        'Route family: [one of material-object / graphic-shape / gesture-motion / atmosphere-light / playful-character / pattern-ornament / surreal-metaphor / editorial-cultural].',
        'Concept route: [specific motif and strategic reason].',
        'Visual language: [medium, form, shape, texture, composition, framing, light, mood, color temperature].',
        'Design translation: how this becomes spacing, surface, edge, image, icon, motion, or interaction behavior.',
        'Constraints: no text, no lettering, no numerals, no logos, no watermark, no UI mockup, no website, no fake packaging label, opaque background.',
      ],
      routeRules: [
        'Every card must include routeFamily in the payload.',
        'At least three routeFamily values must be represented in each batch of four.',
        'Do not generate four realistic material still lifes by default.',
        'Do not produce four versions of the same flower, ceramic fragment, blob, pattern, mascot, or light study.',
        'Do not produce a 2x2 contact sheet or one image that must be cropped into cards.',
        'Use user freeform direction for iterative follow-ups instead of overloading the first prompt.',
      ],
    };
  }
  return {
      model: 'flux-2-pro-preview-or-built-in-quadrant',
      quality: 'high',
      size: '1024x1024',
      output: 'Four independent visual cue cards, each with one no-text image and a concise motif label.',
    promptTemplate: [
      'Create a 1:1 square abstract brand identity material study for [brand].',
      'Intent: first-round art direction cue for a professional brand identity system, not an illustration for decoration.',
      'Brand context: [site overview], for [primary audience].',
      'Concept route: [specific motif and strategic reason].',
      'Subject/material: [one clear physical cue such as folded paper, ceramic glaze, woven fiber, shell edge, soft vapor, botanical geometry, protective film].',
      'Composition: editorial still-life or sculptural material study with generous negative space, one dominant subject, restrained supporting texture, no clutter.',
      'Lighting and finish: controlled studio lighting, believable contact shadows, tactile surfaces, refined color temperature, no cinematic overprocessing.',
      'Design translation: the image should imply future spacing, surface, curve, texture, layer, edge, icon, or motion behavior.',
      'Constraints: no text, no lettering, no numerals, no logos, no watermark, no UI, no website, no fake packaging label, no people, opaque background.',
    ],
    routeRules: [
      'Make all four cards strategically different.',
      'Do not produce four versions of the same flower, same ceramic, or same abstract blob.',
      'Do not produce a 2x2 contact sheet or one image that must be cropped into cards.',
      'Use the user’s freeform direction to pivot the next batch, while preserving the strongest facts from the first three answers.',
    ],
  };
}

function renderQuestionnairePage({ session, token }) {
  const slidesJson = escapeScriptJson(slidesForSession(session));
  const sessionJson = escapeScriptJson(publicSession(session));
  const tokenJson = JSON.stringify(token);
  const artifactNameJson = JSON.stringify(sessionMode(session) === 'init'
    ? 'PRODUCT.md, BRAND.md, and DESIGN.md'
    : 'DESIGN.md');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Impeccable ${sessionMode(session) === 'init' ? 'init' : 'design'} questionnaire</title>
  <style>
    @import url("https://fonts.googleapis.com/css2?family=Albert+Sans:wght@300;400;500;600;700;800&family=Alumni+Sans+Pinstripe&family=Alumni+Sans:wght@300;400;500;600;700&display=swap");

    :root {
      color-scheme: dark;
      --ks-font-display: "Alumni Sans Pinstripe", "Albert Sans", Arial, sans-serif;
      --ks-font-wordmark: "Alumni Sans", "Alumni Sans Pinstripe", "Albert Sans", Arial, sans-serif;
      --ks-font: "Albert Sans", "Avenir Next", "Helvetica Neue", Arial, system-ui, sans-serif;
      --ks-mono: "SFMono-Regular", "Roboto Mono", "JetBrains Mono", Consolas, monospace;
      --ks-type-display-size: clamp(3.4rem, 6.5vw, 5.6rem);
      --ks-type-display-weight: 300;
      --ks-type-display-line: 1.02;
      --ks-type-display-track: -0.01em;
      --ks-type-body-size: 1.02rem;
      --ks-type-body-line: 1.8;
      --ks-type-mono-size: 0.72rem;
      --ks-type-mono-track: 0.22em;
      --lacquer: oklch(7% 0.006 95);
      --lacquer-deep: oklch(4% 0.004 95);
      --lacquer-raised: oklch(12% 0.006 95);
      --surface: oklch(11% 0.006 95);
      --graphite: oklch(18% 0.008 95);
      --text: oklch(89% 0 0);
      --muted: oklch(70% 0 0);
      --faint: oklch(55% 0 0);
      --gold: oklch(84% 0.19 80.46);
      --gold-pale: oklch(89% 0.17 86);
      --gold-rich: oklch(72% 0.16 78);
      --gold-deep: oklch(61% 0.085 78);
      --patina: oklch(70% 0.12 188);
      --patina-deep: oklch(45% 0.08 188);
      --rule: oklch(78% 0 0 / 0.18);
      --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    * { box-sizing: border-box; }
    html, body {
      width: 100%;
      min-height: 100%;
    }
    body {
      margin: 0;
      overflow: hidden;
      color: var(--text);
      background:
        radial-gradient(circle at 50% 50%, oklch(69% 0.105 190 / 0.1), transparent 18rem),
        linear-gradient(180deg, oklch(8% 0.006 95), oklch(5% 0.004 95));
      font-family: var(--ks-font);
      font-size: 16px;
      line-height: var(--ks-type-body-line);
      font-weight: 300;
    }

    button, textarea, input { font: inherit; }

    .app {
      position: relative;
      z-index: 1;
      min-height: 100svh;
      isolation: isolate;
    }

    .topbar {
      position: fixed;
      z-index: 20;
      top: 0;
      left: 0;
      right: 0;
      display: grid;
      grid-template-columns: auto;
      align-items: center;
      padding: 22px clamp(18px, 4vw, 56px);
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
      color: var(--gold);
      font-family: var(--ks-font-wordmark);
      font-size: 1.3rem;
      font-weight: 400;
      letter-spacing: 0.15em;
      line-height: 1;
      text-transform: uppercase;
      -webkit-font-smoothing: auto;
    }

    .mark {
      width: 38px;
      height: 38px;
      display: inline-grid;
      place-items: center;
      flex: none;
    }

    .mark svg {
      width: 32px;
      height: 32px;
    }

    .stage {
      position: relative;
      height: 100svh;
      overflow: hidden;
    }

    .slide {
      position: absolute;
      inset: 0;
      display: grid;
      align-items: start;
      padding: 108px clamp(20px, 7vw, 120px) 96px;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      transform: translateY(100%);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition:
        transform 520ms var(--ease),
        opacity 260ms var(--ease),
        visibility 0ms linear 520ms;
    }

    .slide.is-active,
    .slide[data-current="true"] {
      transform: translateY(0);
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transition:
        transform 520ms var(--ease),
        opacity 320ms var(--ease);
    }

    .slide:not([data-current="true"]) {
      pointer-events: none !important;
    }

    .slide.is-before { transform: translateY(-100%); }
    .slide[data-current="true"] { transform: translateY(0); }
    .slide-inner {
      width: min(920px, 100%);
      align-self: center;
      display: grid;
      gap: clamp(20px, 3vw, 34px);
    }

    .slide--image {
      padding-right: clamp(20px, 3.5vw, 56px);
      padding-left: clamp(20px, 3.5vw, 56px);
    }

    .slide--image .slide-inner {
      width: min(1480px, 100%);
    }

    .slide-kicker {
      color: var(--patina);
      font-family: var(--ks-mono);
      font-size: var(--ks-type-mono-size);
      font-weight: 400;
      letter-spacing: var(--ks-type-mono-track);
      line-height: 1;
      text-transform: uppercase;
    }

    .section-progress {
      display: grid;
      gap: 10px;
      width: min(360px, 100%);
    }

    .progress-rail {
      position: relative;
      height: 2px;
      overflow: hidden;
      background: oklch(78% 0 0 / 0.14);
    }

    .progress-rail span {
      position: absolute;
      inset: 0 auto 0 0;
      width: var(--progress);
      background: linear-gradient(90deg, var(--gold-deep), var(--gold), var(--gold-pale));
      transition: width 420ms var(--ease);
    }

    h1 {
      max-width: 100%;
      margin: 0;
      color: var(--text);
      font-family: var(--ks-font-display);
      font-size: clamp(3rem, 5.2vw, 5.7rem);
      font-weight: var(--ks-type-display-weight);
      line-height: var(--ks-type-display-line);
      letter-spacing: var(--ks-type-display-track);
      white-space: nowrap;
      overflow-wrap: normal;
    }

    .prompt {
      max-width: 65ch;
      margin: 0;
      color: var(--muted);
      font-size: var(--ks-type-body-size);
      line-height: var(--ks-type-body-line);
      font-weight: 300;
      overflow-wrap: anywhere;
    }

    .answer {
      width: min(760px, 100%);
    }

    .answer--image {
      width: min(1480px, 100%);
    }

    .suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin: 0 0 14px;
    }

    .suggestion-chip {
      min-height: 34px;
      border: 1px solid oklch(78% 0 0 / 0.14);
      border-radius: 2px;
      padding: 0 13px;
      color: oklch(78% 0 0);
      background: oklch(9% 0.006 95 / 0.2);
      cursor: pointer;
      font-family: var(--ks-font);
      font-size: 0.86rem;
      font-weight: 400;
      line-height: 1;
      text-align: center;
      white-space: nowrap;
      transition: border-color 180ms var(--ease), color 180ms var(--ease), background 180ms var(--ease);
    }

    .suggestion-chip:hover,
    .suggestion-chip[aria-pressed="true"] {
      border-color: var(--patina);
      color: var(--text);
      background: oklch(70% 0.12 188 / 0.12);
    }

    .suggestion-chip:focus-visible {
      outline: 2px solid var(--patina);
      outline-offset: 3px;
    }

    textarea,
    .answer-input {
      width: 100%;
      border: 1px solid var(--rule);
      border-radius: 2px;
      color: var(--text);
      background: oklch(12% 0.006 95 / 0.46);
      outline: none;
      font-size: var(--ks-type-body-size);
      line-height: var(--ks-type-body-line);
      font-weight: 300;
      transition: border-color 180ms var(--ease), background-color 180ms var(--ease);
    }

    textarea {
      min-height: 146px;
      resize: vertical;
      padding: 18px 20px;
    }

    .answer-input {
      min-height: 58px;
      padding: 0 18px;
    }

    textarea::placeholder,
    .answer-input::placeholder {
      color: oklch(72% 0 0);
      opacity: 1;
    }

    textarea:focus-visible,
    .answer-input:focus-visible {
      border-color: var(--patina);
      background: oklch(13.5% 0.008 95 / 0.58);
      box-shadow: none;
    }

    .freeform-choice {
      margin-top: 14px;
      background: oklch(8% 0.006 95 / 0.34);
    }

    .options {
      display: grid;
      gap: 10px;
      width: min(720px, 100%);
    }

    .option {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
      width: 100%;
      min-height: 56px;
      padding: 14px 16px;
      border: 1px solid var(--rule);
      border-radius: 8px;
      color: var(--text);
      background: oklch(11% 0.006 95 / 0.86);
      text-align: left;
      cursor: pointer;
      transition:
        border-color 180ms var(--ease),
        background 180ms var(--ease),
        transform 180ms var(--ease);
    }

    .option-number {
      width: 24px;
      height: 24px;
      display: inline-grid;
      place-items: center;
      border: 1px solid oklch(78% 0 0 / 0.18);
      border-radius: 999px;
      color: var(--gold);
      font-family: var(--ks-mono);
      font-size: 0.68rem;
      line-height: 1;
    }

    .option-copy {
      min-width: 0;
      display: grid;
      gap: 3px;
    }

    .recommended-badge {
      align-self: start;
      border: 1px solid oklch(84% 0.19 80.46 / 0.46);
      border-radius: 999px;
      padding: 3px 8px;
      color: var(--gold);
      font-family: var(--ks-mono);
      font-size: 0.58rem;
      letter-spacing: 0.08em;
      line-height: 1;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .option small {
      color: var(--muted);
      font-size: 0.86rem;
      line-height: 1.45;
    }

    .option:hover {
      border-color: oklch(84% 0.19 80.46 / 0.7);
    }

    .option[aria-pressed="true"] {
      border-color: var(--patina);
      background: linear-gradient(90deg, oklch(70% 0.12 188 / 0.16), oklch(11% 0.006 95 / 0.94));
    }

    .suggestion-options {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .suggestion-options .suggestion-chip {
      min-height: 54px;
      white-space: normal;
      text-align: left;
      line-height: 1.35;
      padding: 12px 14px;
    }

    .upload-zone {
      position: relative;
      display: grid;
      gap: 10px;
      width: min(720px, 100%);
      min-height: 168px;
      border: 1px dashed oklch(84% 0.19 80.46 / 0.48);
      border-radius: 4px;
      place-items: center;
      padding: 26px;
      background: oklch(8% 0.006 95 / 0.42);
    }

    .upload-zone input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }

    .upload-copy {
      display: grid;
      gap: 6px;
      text-align: center;
      pointer-events: none;
    }

    .upload-copy strong {
      color: var(--gold);
      font-size: 1.05rem;
      font-weight: 600;
    }

    .upload-copy span {
      color: var(--muted);
      font-size: 0.94rem;
    }

    .asset-empty {
      margin-top: 12px;
      color: var(--muted);
    }

    .asset-list {
      display: grid;
      gap: 10px;
      margin-top: 14px;
      width: min(720px, 100%);
    }

    .asset-item {
      display: grid;
      grid-template-columns: 54px 1fr;
      gap: 12px;
      align-items: center;
      min-width: 0;
      border: 1px solid var(--rule);
      border-radius: 4px;
      padding: 8px;
      background: oklch(10% 0.006 95 / 0.6);
    }

    .asset-item img,
    .asset-file {
      width: 54px;
      height: 54px;
      border-radius: 2px;
      object-fit: cover;
      background: linear-gradient(135deg, oklch(84% 0.19 80.46 / 0.26), oklch(70% 0.12 188 / 0.18));
    }

    .asset-item strong,
    .asset-item small {
      display: block;
      overflow-wrap: anywhere;
    }

    .asset-item strong {
      color: var(--text);
      font-weight: 500;
      line-height: 1.35;
    }

    .asset-item small {
      color: var(--muted);
      font-size: 0.82rem;
    }

    .image-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 16px;
      width: 100%;
    }

    .type-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 16px;
      width: 100%;
    }

    .image-card,
    .type-card {
      position: relative;
      display: grid;
      gap: 10px;
      min-width: 0;
      border: 1px solid var(--rule);
      border-radius: 4px;
      padding: 10px;
      color: var(--text);
      background: oklch(8% 0.006 95 / 0.74);
      text-align: left;
      cursor: pointer;
      user-select: none;
      transition: border-color 180ms var(--ease), transform 180ms var(--ease), background 180ms var(--ease);
    }

    .image-card-index,
    .type-card-index {
      position: absolute;
      top: 18px;
      left: 18px;
      z-index: 2;
      width: 28px;
      height: 28px;
      display: grid;
      place-items: center;
      border: 1px solid oklch(91% 0 0 / 0.2);
      border-radius: 999px;
      color: var(--gold);
      background: oklch(4% 0.004 95 / 0.72);
      font-family: var(--ks-mono);
      font-size: 0.72rem;
      line-height: 1;
    }

    .image-card-check,
    .type-card-check {
      position: absolute;
      right: 16px;
      bottom: 16px;
      z-index: 2;
      width: 28px;
      height: 28px;
      display: grid;
      place-items: center;
      border: 1px solid oklch(91% 0 0 / 0.2);
      border-radius: 999px;
      color: transparent;
      background: oklch(4% 0.004 95 / 0.72);
      transition: color 160ms var(--ease), background-color 160ms var(--ease), border-color 160ms var(--ease);
    }

    .image-card-check::before,
    .type-card-check::before {
      content: "";
      width: 12px;
      height: 7px;
      border-left: 2px solid currentColor;
      border-bottom: 2px solid currentColor;
      transform: translateY(-1px) rotate(-45deg);
    }

    .image-card:hover,
    .type-card:hover {
      border-color: oklch(84% 0.19 80.46 / 0.62);
    }

    .image-card[aria-pressed="true"],
    .type-card[aria-pressed="true"] {
      border-color: var(--gold);
      background: linear-gradient(180deg, oklch(84% 0.19 80.46 / 0.13), oklch(8% 0.006 95 / 0.88));
    }

    .image-card[aria-pressed="true"] .image-card-check,
    .type-card[aria-pressed="true"] .type-card-check {
      border-color: var(--gold);
      color: var(--lacquer-deep);
      background: var(--gold);
    }

    .image-card:focus-visible,
    .type-card:focus-visible {
      outline: 2px solid var(--patina);
      outline-offset: 4px;
    }

    .image-expand,
    .type-expand {
      position: absolute;
      top: 18px;
      right: 18px;
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      border: 1px solid oklch(91% 0 0 / 0.22);
      border-radius: 2px;
      color: var(--text);
      background: oklch(4% 0.004 95 / 0.78);
      cursor: pointer;
      opacity: 0.82;
      z-index: 2;
      transition: opacity 160ms var(--ease), border-color 160ms var(--ease), color 160ms var(--ease);
    }

    .image-card:hover .image-expand,
    .image-card:focus-within .image-expand,
    .image-expand:focus-visible,
    .type-card:hover .type-expand,
    .type-card:focus-within .type-expand,
    .type-expand:focus-visible {
      opacity: 1;
    }

    .image-expand:hover,
    .image-expand:focus-visible,
    .type-expand:hover,
    .type-expand:focus-visible {
      border-color: var(--gold);
      color: var(--gold);
      outline: none;
    }

    .image-expand::before,
    .image-expand::after,
    .type-expand::before,
    .type-expand::after {
      content: "";
      position: absolute;
      width: 14px;
      height: 14px;
      border-color: currentColor;
      border-style: solid;
      pointer-events: none;
    }

    .image-expand::before,
    .type-expand::before {
      top: 8px;
      right: 8px;
      border-width: 1px 1px 0 0;
    }

    .image-expand::after,
    .type-expand::after {
      bottom: 8px;
      left: 8px;
      border-width: 0 0 1px 1px;
    }

    .image-card img,
    .image-placeholder {
      width: 100%;
      aspect-ratio: 1;
      display: block;
      border: 1px solid oklch(78% 0 0 / 0.12);
      border-radius: 2px;
      object-fit: cover;
      background:
        radial-gradient(circle at 50% 44%, oklch(70% 0.12 188 / 0.16), transparent 44%),
        linear-gradient(135deg, oklch(14% 0.008 95), oklch(6% 0.004 95));
    }

    .image-placeholder {
      position: relative;
      overflow: hidden;
    }

    .image-placeholder::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent, oklch(84% 0.19 80.46 / 0.18), transparent);
      animation: thinking-line 1.25s var(--ease) infinite;
    }

    .image-label {
      display: block;
      min-height: 24px;
      color: var(--text);
      font-size: 0.95rem;
      line-height: 1.35;
      font-weight: 400;
      overflow-wrap: anywhere;
    }

    .image-route {
      display: block;
      width: fit-content;
      max-width: 100%;
      border: 1px solid oklch(70% 0.12 188 / 0.34);
      border-radius: 999px;
      padding: 2px 7px;
      color: var(--patina);
      font-family: var(--ks-mono);
      font-size: 0.62rem;
      letter-spacing: 0.08em;
      line-height: 1.3;
      text-transform: uppercase;
      overflow-wrap: anywhere;
    }

    .type-specimen {
      min-height: 246px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 18px;
      border: 1px solid oklch(78% 0 0 / 0.12);
      border-radius: 2px;
      padding: 18px;
      background:
        radial-gradient(circle at 80% 12%, oklch(84% 0.19 80.46 / 0.1), transparent 34%),
        linear-gradient(135deg, oklch(11% 0.006 95 / 0.92), oklch(5% 0.004 95 / 0.96));
      overflow: hidden;
    }

    .type-kicker {
      color: var(--gold);
      font-family: var(--ks-mono);
      font-size: 0.58rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }

    .type-heading-sample {
      margin: 0;
      color: var(--text);
      font-family: var(--heading-font);
      font-size: clamp(1.85rem, 2.25vw, 2.55rem);
      font-weight: 650;
      line-height: 0.98;
      letter-spacing: 0;
      text-wrap: balance;
    }

    .type-body-sample {
      margin: 0;
      color: var(--muted);
      font-family: var(--body-font);
      font-size: 0.9rem;
      font-weight: 400;
      line-height: 1.52;
      text-wrap: pretty;
    }

    .type-label {
      display: block;
      color: var(--text);
      font-size: 0.95rem;
      line-height: 1.25;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .type-pair {
      display: grid;
      grid-template-columns: 1fr;
      gap: 4px;
      color: var(--muted);
      font-size: 0.72rem;
      line-height: 1.32;
    }

    .type-pair strong {
      color: oklch(82% 0 0);
      font-weight: 500;
    }

    .swatches {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 10px;
    }

    .swatch {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr);
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .swatch-color {
      height: 22px;
      border: 1px solid oklch(78% 0 0 / 0.16);
      border-radius: 2px;
      background: var(--swatch);
    }

    .swatch-name {
      color: var(--muted);
      font-size: 0.62rem;
      line-height: 1.15;
      overflow-wrap: normal;
      word-break: normal;
      hyphens: none;
      white-space: nowrap;
    }

    .image-modal,
    .type-modal {
      position: fixed;
      inset: 0;
      z-index: 80;
      display: grid;
      place-items: center;
      padding: 28px;
      background: oklch(0% 0 0 / 0.74);
      backdrop-filter: blur(10px);
    }

    .image-modal[hidden],
    .type-modal[hidden] {
      display: none;
    }

    .image-modal-card,
    .type-modal-card {
      position: relative;
      width: min(960px, 100%);
      max-height: calc(100vh - 56px);
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(220px, 300px);
      gap: 18px;
      border: 1px solid oklch(84% 0.19 80.46 / 0.42);
      border-radius: 4px;
      padding: 16px;
      color: var(--text);
      background: oklch(5% 0.004 95 / 0.98);
      box-shadow: 0 28px 80px oklch(0% 0 0 / 0.5);
    }

    .image-modal-card img {
      width: 100%;
      max-height: calc(100vh - 92px);
      aspect-ratio: 1;
      object-fit: contain;
      border: 1px solid oklch(78% 0 0 / 0.14);
      border-radius: 2px;
      background: oklch(3% 0.004 95);
    }

    .image-modal-meta {
      align-self: stretch;
      display: flex;
      flex-direction: column;
      gap: 14px;
      justify-content: center;
      min-width: 0;
    }

    .image-modal-title {
      margin: 0;
      color: var(--text);
      font-family: var(--ks-font-display);
      font-size: clamp(2rem, 3vw, 3.2rem);
      font-weight: 600;
      line-height: 1;
    }

    .image-modal .swatches {
      grid-template-columns: 1fr;
      gap: 10px;
    }

    .image-modal .swatch {
      grid-template-columns: 44px 1fr;
      align-items: center;
    }

    .image-modal .swatch-color {
      height: 34px;
    }

    .image-modal .swatch-name {
      font-size: 0.9rem;
      white-space: normal;
    }

    .image-modal-close {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      border: 1px solid oklch(91% 0 0 / 0.18);
      border-radius: 2px;
      color: var(--text);
      background: oklch(8% 0.006 95 / 0.92);
      cursor: pointer;
    }

    .image-modal-close:hover,
    .image-modal-close:focus-visible {
      border-color: var(--gold);
      color: var(--gold);
      outline: none;
    }

    .image-modal-close::before,
    .image-modal-close::after {
      content: "";
      position: absolute;
      width: 16px;
      height: 1px;
      background: currentColor;
    }

    .image-modal-close::before { transform: rotate(45deg); }
    .image-modal-close::after { transform: rotate(-45deg); }

    .type-modal-card {
      width: min(1080px, 100%);
      grid-template-columns: minmax(0, 1fr) minmax(260px, 340px);
      padding: 22px;
    }

    .type-modal-preview {
      min-height: min(620px, calc(100vh - 110px));
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 28px;
      border: 1px solid oklch(78% 0 0 / 0.14);
      border-radius: 2px;
      padding: clamp(24px, 4vw, 56px);
      background:
        radial-gradient(circle at 82% 16%, oklch(84% 0.19 80.46 / 0.12), transparent 32%),
        linear-gradient(135deg, oklch(12% 0.006 95), oklch(5% 0.004 95));
    }

    .type-modal-preview .type-heading-sample {
      max-width: 10ch;
      font-size: clamp(4.6rem, 8vw, 7.8rem);
      line-height: 0.92;
    }

    .type-modal-preview .type-body-sample {
      max-width: 58ch;
      font-size: clamp(1.05rem, 1.35vw, 1.25rem);
      line-height: 1.68;
    }

    .type-modal-meta {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 18px;
      min-width: 0;
    }

    .type-modal-title {
      margin: 0;
      color: var(--text);
      font-family: var(--ks-font-display);
      font-size: clamp(2rem, 3vw, 3.2rem);
      font-weight: 600;
      line-height: 1;
    }

    .type-modal-copy {
      margin: 0;
      color: var(--muted);
      font-size: 0.95rem;
      line-height: 1.58;
    }

    .image-request,
    .type-request {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      width: min(760px, 100%);
      margin-top: 16px;
    }

    .image-request input,
    .type-request input {
      min-height: 44px;
      border: 1px solid var(--rule);
      border-radius: 2px;
      color: var(--text);
      background: oklch(12% 0.006 95 / 0.46);
      padding: 0 14px;
      outline: none;
      font: inherit;
      font-size: 0.95rem;
      font-weight: 300;
    }

    .image-request input::placeholder { color: oklch(72% 0 0); opacity: 1; }
    .image-request input:focus-visible {
      border-color: var(--patina);
    }

    .image-request button,
    .type-request button {
      min-height: 44px;
      border: 1px solid var(--gold);
      border-radius: 2px;
      padding: 0 16px;
      color: var(--gold);
      background: transparent;
      cursor: pointer;
      font-size: 0.88rem;
      font-weight: 500;
    }

    .empty-images {
      display: grid;
      gap: 10px;
      width: min(760px, 100%);
      color: var(--muted);
    }

    .option:focus-visible,
    .nav-button:focus-visible,
    .image-request button:focus-visible,
    .type-request button:focus-visible {
      outline: 2px solid var(--patina);
      outline-offset: 4px;
    }

    .nav {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 18px;
    }

    .nav-button {
      position: relative;
      min-height: 52px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      border: 1px solid var(--gold);
      border-radius: 2px;
      padding: 0 28px;
      color: var(--lacquer-deep);
      background: var(--gold);
      cursor: pointer;
      font-size: 0.96rem;
      font-weight: 500;
      line-height: 1;
      letter-spacing: 0;
      transition: transform 180ms var(--ease), background-color 180ms var(--ease), border-color 180ms var(--ease), color 180ms var(--ease);
    }

    .nav-button::after {
      content: "";
      width: 16px;
      height: 8px;
      flex: none;
      background: currentColor;
      clip-path: polygon(0 42%, 72% 42%, 72% 0, 100% 50%, 72% 100%, 72% 58%, 0 58%);
    }

    .nav-button:hover {
      background: var(--gold-pale);
      border-color: var(--gold-pale);
      transform: translateY(-1px);
    }

    .nav-button:active {
      background: var(--gold-rich);
      border-color: var(--gold-rich);
      transform: translateY(0);
    }

    .nav-button.secondary {
      color: var(--gold);
      background: transparent;
      border-color: var(--gold);
    }

    .nav-button.secondary::after { display: none; }

    .nav-button.secondary:hover {
      background: oklch(84% 0.19 80.46 / 0.08);
      color: var(--gold);
    }

    .status {
      min-height: 22px;
      color: var(--patina);
      font-family: var(--ks-mono);
      font-size: var(--ks-type-mono-size);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .status[data-kind="error"] { color: oklch(68% 0.16 35); }
    .status[data-kind="success"] { color: var(--patina); }

    .shortcut-hint {
      position: fixed;
      right: clamp(18px, 3vw, 42px);
      bottom: clamp(16px, 3vw, 34px);
      z-index: 45;
      padding: 7px 9px;
      border: 1px solid oklch(78% 0 0 / 0.12);
      border-radius: 999px;
      color: oklch(76% 0 0 / 0.84);
      background: oklch(5% 0.004 95 / 0.72);
      font-family: var(--ks-mono);
      font-size: 0.62rem;
      letter-spacing: 0.08em;
      line-height: 1;
      text-transform: uppercase;
      pointer-events: none;
    }

    .thinking {
      position: fixed;
      inset: 0;
      z-index: 16;
      display: grid;
      place-items: center;
      padding: 24px;
      background:
        radial-gradient(circle at 50% 50%, oklch(69% 0.105 190 / 0.12), transparent 17rem),
        oklch(5% 0.004 95 / 0.9);
      opacity: 0;
      pointer-events: none;
      transition: opacity 220ms var(--ease);
    }

    .thinking.is-active {
      opacity: 1;
      pointer-events: auto;
    }

    .thinking[hidden] { display: none; }

    .thinking-inner {
      width: min(340px, 80vw);
      display: grid;
      gap: 14px;
      color: var(--gold);
      font-family: var(--ks-mono);
      font-size: var(--ks-type-mono-size);
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .thinking-line {
      position: relative;
      height: 2px;
      overflow: hidden;
      background: oklch(78% 0 0 / 0.14);
    }

    .thinking-line::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 42%;
      background: linear-gradient(90deg, transparent, var(--gold), var(--patina), transparent);
      animation: thinking-line 1s var(--ease) infinite;
    }

    @keyframes thinking-line {
      from { transform: translateX(-110%); }
      to { transform: translateX(260%); }
    }

    @media (max-width: 640px) {
      body { overflow: auto; }
      .stage {
        min-height: auto;
        height: auto;
        overflow: visible;
      }
      .topbar {
        grid-template-columns: 1fr;
        gap: 12px;
        padding: 18px 18px 0;
      }
      .slide {
        position: relative;
        inset: auto;
        display: none;
        min-height: 100svh;
        align-items: start;
        padding: 118px 18px 170px;
        transform: none;
      }
      .slide-inner {
        align-self: start;
      }
      .nav {
        position: fixed;
        left: 18px;
        right: 18px;
        bottom: 0;
        z-index: 40;
        padding: 14px 0 18px;
        background:
          linear-gradient(180deg, transparent, oklch(5% 0.004 95 / 0.94) 28%, oklch(5% 0.004 95) 100%);
      }
      .slide.is-active,
      .slide[data-current="true"] {
        display: grid;
        transform: none;
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }
      .slide.is-before {
        display: none;
        transform: none;
      }
      .slide[data-current="true"] {
        display: grid;
        transform: none;
      }
      h1 {
        max-width: 100%;
        font-size: clamp(2.6rem, 12vw, 4.2rem);
        white-space: normal;
        text-wrap: balance;
      }
      .image-grid {
        grid-template-columns: 1fr;
        width: min(100%, 420px);
      }
      .type-grid {
        grid-template-columns: 1fr;
        width: min(100%, 420px);
      }
      .image-modal-card {
        grid-template-columns: 1fr;
        overflow: auto;
      }
      .type-modal-card {
        grid-template-columns: 1fr;
        overflow: auto;
      }
      .image-modal-card img {
        max-height: 58vh;
      }
      .type-modal-preview {
        min-height: auto;
      }
      .type-modal-preview .type-heading-sample {
        font-size: clamp(3rem, 16vw, 4.8rem);
      }
      .image-request,
      .type-request {
        grid-template-columns: 1fr;
      }
      .shortcut-hint {
        right: 18px;
        bottom: 86px;
        max-width: calc(100vw - 36px);
        white-space: nowrap;
      }
    }

    @media (min-width: 641px) and (max-width: 1120px) {
      .image-grid {
        grid-template-columns: repeat(2, minmax(250px, 1fr));
        width: min(760px, 100%);
      }
      .type-grid {
        grid-template-columns: repeat(2, minmax(250px, 1fr));
        width: min(760px, 100%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        scroll-behavior: auto !important;
        transition-duration: 1ms !important;
        animation-duration: 1ms !important;
        animation-iteration-count: 1 !important;
      }
      .slide,
      .slide.is-before,
      .slide.is-active {
        transform: none;
      }
      .slide:not([data-current="true"]) {
        opacity: 0;
        pointer-events: none;
      }
      .thinking-line::before {
        animation: none;
        transform: none;
      }
    }
  </style>
</head>
<body>
  <main class="app" aria-live="polite">
    <header class="topbar">
      <div class="brand">
        <span class="mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M5 2.5 L13.5 2.5 L5.5 21.5 L5 21.5 Q2.5 21.5 2.5 19 L2.5 5 Q2.5 2.5 5 2.5 Z"></path>
            <path d="M16.5 2.5 L19 2.5 Q21.5 2.5 21.5 5 L21.5 19 Q21.5 21.5 19 21.5 L8.5 21.5 Z"></path>
          </svg>
        </span>
        <span>IMPECCABLE</span>
      </div>
    </header>
    <section class="stage" data-stage></section>
    <div class="thinking" data-thinking hidden aria-live="polite" aria-busy="true">
      <div class="thinking-inner">
        <span data-thinking-message>Shaping next question</span>
        <span class="thinking-line" aria-hidden="true"></span>
      </div>
    </div>
    <div class="image-modal" data-image-modal hidden role="dialog" aria-modal="true" aria-labelledby="image-modal-title">
      <div class="image-modal-card" data-image-modal-card>
        <button class="image-modal-close" type="button" data-image-modal-close aria-label="Close expanded image"></button>
        <img data-image-modal-img alt="">
        <div class="image-modal-meta">
          <h2 class="image-modal-title" id="image-modal-title" data-image-modal-title></h2>
          <div data-image-modal-swatches></div>
        </div>
      </div>
    </div>
    <div class="type-modal" data-type-modal hidden role="dialog" aria-modal="true" aria-labelledby="type-modal-title">
      <div class="type-modal-card" data-type-modal-card>
        <button class="image-modal-close" type="button" data-type-modal-close aria-label="Close expanded typography"></button>
        <div class="type-modal-preview" data-type-modal-preview></div>
        <div class="type-modal-meta">
          <h2 class="type-modal-title" id="type-modal-title" data-type-modal-title></h2>
          <p class="type-modal-copy" data-type-modal-pair></p>
          <p class="type-modal-copy" data-type-modal-rationale></p>
          <p class="type-modal-copy" data-type-modal-usage></p>
        </div>
      </div>
    </div>
    <div class="shortcut-hint" data-shortcut-hint aria-hidden="true">↑ Back · ↓ Next · 1-4 Select · Enter Continue</div>
  </main>
  <script>
    const BASE_SLIDES = ${slidesJson};
    const SESSION = ${sessionJson};
    const TOKEN = ${tokenJson};
    const ARTIFACT_NAME = ${artifactNameJson};
    const stage = document.querySelector('[data-stage]');
    const thinking = document.querySelector('[data-thinking]');
    const thinkingMessage = document.querySelector('[data-thinking-message]');
    const imageModal = document.querySelector('[data-image-modal]');
    const imageModalImg = document.querySelector('[data-image-modal-img]');
    const imageModalTitle = document.querySelector('[data-image-modal-title]');
    const imageModalSwatches = document.querySelector('[data-image-modal-swatches]');
    const imageModalClose = document.querySelector('[data-image-modal-close]');
    const typeModal = document.querySelector('[data-type-modal]');
    const typeModalPreview = document.querySelector('[data-type-modal-preview]');
    const typeModalTitle = document.querySelector('[data-type-modal-title]');
    const typeModalPair = document.querySelector('[data-type-modal-pair]');
    const typeModalRationale = document.querySelector('[data-type-modal-rationale]');
    const typeModalUsage = document.querySelector('[data-type-modal-usage]');
    const typeModalClose = document.querySelector('[data-type-modal-close]');
    let slidePatches = { ...(SESSION.slidePatches || {}) };
    let imageBatches = { ...(SESSION.imageBatches || {}) };
    let imageProvider = SESSION.imageProvider || null;
    let imageProviderNotice = SESSION.imageProviderNotice || null;
    let typographyBatches = { ...(SESSION.typographyBatches || {}) };
    let uploadedAssets = [ ...(SESSION.uploadedAssets || []) ];
    let SLIDES = applySlidePatches(BASE_SLIDES, slidePatches);
    let index = 0;
    let answers = { ...(SESSION.answers || {}) };
    let lastMessageAt = null;
    let isBusy = false;
    let pendingAdvance = null;
    let lastModalFocus = null;
    const pendingImageSlideIds = new Set();
    const loadedTypographyFontUrls = new Set();
    let imageProviderAlertShown = sessionStorage.getItem('impeccable-image-provider-alert-' + SESSION.id) === '1';

    function setSlideIndex(nextIndex) {
      index = Math.max(0, Math.min(SLIDES.length - 1, nextIndex));
    }

    function render() {
      stage.innerHTML = SLIDES.map((slide, i) => {
        const answer = answers[slide.id];
        const imageSlide = slide.kind === 'visual-cue-grid' || slide.kind === 'palette-grid' || slide.kind === 'typography-grid';
        return '<article class="slide' + (imageSlide ? ' slide--image' : '') + '" data-slide="' + slide.id + '" aria-labelledby="title-' + slide.id + '">' +
          '<div class="slide-inner">' +
            '<div class="section-progress">' +
              '<span class="slide-kicker">' + escapeHtml(slide.section || 'Question') + '</span>' +
              '<span class="progress-rail" aria-hidden="true"><span style="--progress: ' + sectionProgress(slide) + '%"></span></span>' +
            '</div>' +
            '<h1 id="title-' + slide.id + '">' + escapeHtml(slide.title) + '</h1>' +
            '<p class="prompt">' + escapeHtml(slide.prompt || '') + '</p>' +
            '<div class="answer' + (imageSlide ? ' answer--image' : '') + '">' + renderAnswer(slide, answer) + '</div>' +
            '<div class="nav">' +
              '<button class="nav-button" type="button" data-next>' + (i === SLIDES.length - 1 ? 'Write ' + ARTIFACT_NAME : 'Continue') + '</button>' +
              (i > 0 ? '<button class="nav-button secondary" type="button" data-prev>Back</button>' : '') +
              '<span class="status" data-status></span>' +
            '</div>' +
          '</div>' +
        '</article>';
      }).join('');

      stage.addEventListener('click', onStageClick);
      stage.addEventListener('input', onStageInput);
      stage.addEventListener('change', onStageChange);
      stage.addEventListener('blur', onStageBlur, true);
      document.addEventListener('keydown', onKeydown);
      imageModal?.addEventListener('click', onImageModalClick);
      typeModal?.addEventListener('click', onTypeModalClick);
      ensureTypographyFonts();
      refresh();
      connectEventStream();
      pollMessages();
      setInterval(pollMessages, 2200);
    }

    function renderAnswer(slide, answer) {
      if (slide.kind === 'text') {
        const suggestions = Array.isArray(slide.suggestions)
          ? slide.suggestions.map(normalizeSuggestionItem).filter((item) => item.label && item.value)
          : Array.isArray(slide.options)
            ? slide.options.map(normalizeSuggestionItem).filter((item) => item.label && item.value)
            : [];
        const currentValue = String(answer?.value || '');
        if (SESSION.mode !== 'init') {
          const chips = suggestions.length > 0
            ? '<div class="suggestions suggestion-options" aria-label="Suggested answers">' + suggestions.map((item) => {
                const pressed = item.value === currentValue ? 'true' : 'false';
                return '<button class="suggestion-chip" type="button" aria-pressed="' + pressed + '" data-suggestion="' + escapeHtml(item.value) + '">' + escapeHtml(item.label) + '</button>';
              }).join('') + '</div>'
            : '';
          return chips + '<textarea data-answer-text placeholder="' + escapeHtml(slide.placeholder || '') + '">' + escapeHtml(currentValue) + '</textarea>';
        }
        const selectedSuggestion = currentValue || (SESSION.mode === 'init' && suggestions.length > 0 ? suggestions[0].value : '');
        const chips = suggestions.length > 0
          ? '<div class="options suggestion-options" aria-label="Suggested answers">' + suggestions.map((item, suggestionIndex) => {
              const pressed = item.value === selectedSuggestion ? 'true' : 'false';
              return renderOptionButton({
                kind: 'suggestion',
                value: item.value,
                label: item.label,
                hint: item.hint,
                index: suggestionIndex,
                pressed,
                recommended: SESSION.mode === 'init' && suggestionIndex === 0
              });
            }).join('') + '</div>'
          : '';
        const inputValue = suggestions.length > 0 && suggestions.some((item) => item.value === currentValue) ? '' : currentValue;
        if (slide.id === 'product-overview') {
          return chips + '<textarea data-answer-text placeholder="' + escapeHtml(slide.placeholder || '') + '">' + escapeHtml(inputValue) + '</textarea>';
        }
        return chips + '<input class="answer-input" data-answer-text type="text" placeholder="' + escapeHtml(slide.placeholder || '') + '" value="' + escapeHtml(inputValue) + '">';
      }
      if (slide.kind === 'visual-cue-grid' || slide.kind === 'palette-grid') {
        return renderImageSlide(slide, answer);
      }
      if (slide.kind === 'typography-grid') {
        return renderTypographySlide(slide, answer);
      }
      if (slide.kind === 'upload') {
        return renderUploadSlide(slide, answer);
      }
      const values = defaultSelectedValues(slide, answer);
      const optionValues = new Set((slide.options || []).map((option) => option.value));
      const inputValue = answer?.freeform || (answer?.value && !optionValues.has(answer.value) ? answer.value : '');
      const input = SESSION.mode === 'init'
        ? '<input class="answer-input freeform-choice" data-answer-text type="text" placeholder="' + escapeHtml(slide.placeholder || 'Or write your own answer.') + '" value="' + escapeHtml(inputValue) + '">'
        : '<textarea class="freeform-choice" data-answer-text placeholder="' + escapeHtml(slide.placeholder || 'Or write your own answer.') + '">' + escapeHtml(inputValue) + '</textarea>';
      return '<div class="options">' + (slide.options || []).map((option) => {
        const pressed = values.has(option.value) ? 'true' : 'false';
        return renderOptionButton({
          kind: 'option',
          value: option.value,
          label: option.label,
          hint: option.hint,
          index: (slide.options || []).indexOf(option),
          pressed,
          recommended: SESSION.mode === 'init' && (slide.options || []).indexOf(option) === 0
        });
      }).join('') + '</div>' + input;
    }

    function renderOptionButton({ kind, value, label, hint, index, pressed, recommended }) {
      const attr = kind === 'suggestion' ? 'data-suggestion' : 'data-option';
      return '<button class="option" type="button" aria-pressed="' + pressed + '" ' + attr + '="' + escapeHtml(value) + '">' +
        '<span class="option-number">' + String(index + 1) + '</span>' +
        '<span class="option-copy">' +
          '<span>' + escapeHtml(label) + '</span>' +
          (hint ? '<small>' + escapeHtml(hint) + '</small>' : '') +
        '</span>' +
        (recommended ? '<span class="recommended-badge">Recommended</span>' : '') +
      '</button>';
    }

    function defaultSelectedValues(slide, answer) {
      const raw = Array.isArray(answer?.value) ? answer.value : [answer?.value].filter(Boolean);
      if (raw.length > 0) return new Set(raw);
      if (SESSION.mode !== 'init') return new Set();
      const firstOption = Array.isArray(slide.options) ? slide.options[0] : null;
      return firstOption?.value ? new Set([firstOption.value]) : new Set();
    }

    function sectionProgress(slide) {
      const sectionSlides = SLIDES.filter((item) => item.section === slide.section);
      const sectionIndex = sectionSlides.findIndex((item) => item.id === slide.id);
      if (sectionIndex < 0 || sectionSlides.length <= 1) return 100;
      return Math.round(((sectionIndex + 1) / sectionSlides.length) * 100);
    }

    function renderImageSlide(slide, answer) {
      const images = pendingImageSlideIds.has(slide.id) ? [] : latestImagesForSlide(slide.id);
      const activeBatchId = latestImageBatchId(slide.id);
      const selected = answer?.batchId && answer.batchId !== activeBatchId
        ? new Set()
        : new Set(Array.isArray(answer?.value) ? answer.value : []);
      const cards = images.length > 0
        ? '<div class="image-grid" role="listbox" aria-label="' + escapeHtml(slide.title) + '" aria-multiselectable="' + (slide.kind === 'visual-cue-grid' ? 'true' : 'false') + '">' + images.map((image, imageIndex) => renderImageCard(slide, image, selected.has(image.id), imageIndex)).join('') + '</div>'
        : '<div class="empty-images"><div class="image-grid">' + [1, 2, 3, 4].map(() => '<div class="image-placeholder" aria-hidden="true"></div>').join('') + '</div><span>' + escapeHtml(slide.emptyMessage || 'Waiting for image cards.') + '</span></div>';
      const request = '<div class="image-request">' +
        '<input data-image-request-input placeholder="' + escapeHtml(slide.requestPlaceholder || 'Describe another direction.') + '" aria-label="' + escapeHtml(slide.requestLabel || 'Request another direction') + '">' +
        '<button type="button" data-image-request>' + escapeHtml(slide.kind === 'palette-grid' ? 'More palettes' : 'More cues') + '</button>' +
      '</div>';
      return cards + request;
    }

    function renderUploadSlide(slide, answer) {
      const assets = Array.isArray(answer?.assets) ? answer.assets : (SESSION.uploadedAssets || []);
      const list = assets.length > 0
        ? '<div class="asset-list">' + assets.map((asset) => (
            '<div class="asset-item">' +
              (asset.previewDataUrl ? '<img src="' + escapeHtml(asset.previewDataUrl) + '" alt="">' : '<span class="asset-file" aria-hidden="true"></span>') +
              '<span><strong>' + escapeHtml(asset.name) + '</strong><small>' + escapeHtml(asset.role || asset.type || 'asset') + '</small></span>' +
            '</div>'
          )).join('') + '</div>'
        : '<div class="asset-empty">No files added yet.</div>';
      return '<div class="upload-zone">' +
        '<input data-upload-input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,text/plain,application/pdf">' +
        '<div class="upload-copy"><strong>Add product material</strong><span>' + escapeHtml(slide.uploadNote || 'GIFs are best for quick review. MP4 works too.') + '</span></div>' +
      '</div>' + list;
    }

    function renderImageCard(slide, image, selected, imageIndex) {
      const swatches = slide.kind === 'palette-grid' && Array.isArray(image.colors)
        ? '<div class="swatches">' + image.colors.map((color) => (
            '<span class="swatch">' +
              '<span class="swatch-color" style="--swatch: ' + escapeHtml(color.oklch) + '"></span>' +
              '<span class="swatch-name">' + escapeHtml(color.name) + '</span>' +
            '</span>'
          )).join('') + '</div>'
        : '';
      const route = image.routeFamily
        ? '<span class="image-route">' + escapeHtml(image.routeFamilyLabel || image.routeFamily) + '</span>'
        : '';
      return '<div class="image-card" role="option" tabindex="0" aria-pressed="' + (selected ? 'true' : 'false') + '" aria-selected="' + (selected ? 'true' : 'false') + '" data-image-card="' + escapeHtml(image.id) + '" data-image-batch="' + escapeHtml(image.batchId || '') + '">' +
        '<span class="image-card-index" aria-hidden="true">' + String(imageIndex + 1) + '</span>' +
        '<button class="image-expand" type="button" aria-label="Expand ' + escapeHtml(image.label) + '" data-image-expand="' + escapeHtml(image.id) + '"></button>' +
        '<img src="' + escapeHtml(image.dataUrl) + '" alt="' + escapeHtml(image.label) + '">' +
        '<span class="image-label">' + escapeHtml(image.label) + '</span>' +
        route +
        swatches +
        '<span class="image-card-check" aria-hidden="true"></span>' +
      '</div>';
    }

    function renderTypographySlide(slide, answer) {
      const fontSets = latestTypographyForSlide(slide.id);
      const selected = new Set(Array.isArray(answer?.value) ? answer.value : []);
      const cards = fontSets.length > 0
        ? '<div class="type-grid" role="listbox" aria-label="' + escapeHtml(slide.title) + '">' + fontSets.map((fontSet, typeIndex) => renderTypographyCard(fontSet, selected.has(fontSet.id), typeIndex)).join('') + '</div>'
        : '<div class="empty-images"><div class="type-grid">' + [1, 2, 3, 4].map(() => '<div class="image-placeholder" aria-hidden="true"></div>').join('') + '</div><span>' + escapeHtml(slide.emptyMessage || 'Waiting for typography cards.') + '</span></div>';
      const request = '<div class="type-request">' +
        '<input data-type-request-input placeholder="' + escapeHtml(slide.requestPlaceholder || 'Describe another type direction.') + '" aria-label="' + escapeHtml(slide.requestLabel || 'Request another type direction') + '">' +
        '<button type="button" data-type-request>More type</button>' +
      '</div>';
      return cards + request;
    }

    function renderTypographyCard(fontSet, selected, typeIndex) {
      const style = '--heading-font: ' + fontStack(fontSet.heading) + '; --body-font: ' + fontStack(fontSet.body) + ';';
      return '<div class="type-card" role="option" tabindex="0" aria-pressed="' + (selected ? 'true' : 'false') + '" aria-selected="' + (selected ? 'true' : 'false') + '" data-type-card="' + escapeHtml(fontSet.id) + '" style="' + escapeHtml(style) + '">' +
        '<span class="type-card-index" aria-hidden="true">' + String(typeIndex + 1) + '</span>' +
        '<button class="type-expand" type="button" aria-label="Expand ' + escapeHtml(fontSet.label) + '" data-type-expand="' + escapeHtml(fontSet.id) + '"></button>' +
        renderTypeSpecimen(fontSet, false) +
        '<span class="type-label">' + escapeHtml(fontSet.label) + '</span>' +
        '<span class="type-pair">' +
          '<span><strong>Heading</strong> ' + escapeHtml(fontSet.heading?.family || '') + '</span>' +
          '<span><strong>Body</strong> ' + escapeHtml(fontSet.body?.family || '') + '</span>' +
        '</span>' +
        '<span class="type-card-check" aria-hidden="true"></span>' +
      '</div>';
    }

    function renderTypeSpecimen(fontSet, large) {
      const content =
        '<span class="type-kicker">' + escapeHtml((fontSet.heading?.family || 'Heading') + ' / ' + (fontSet.body?.family || 'Body')) + '</span>' +
        '<h3 class="type-heading-sample">' + escapeHtml(fontSet.sampleHeading || 'A softer daily ritual, made precise.') + '</h3>' +
        '<p class="type-body-sample">' + escapeHtml(fontSet.sampleBody || 'Use this pairing for product proof, ingredient detail, buying decisions, and calm reassurance across the site.') + '</p>';
      if (large) return content;
      return '<div class="type-specimen">' + content + '</div>';
    }

    function latestImagesForSlide(slideId) {
      const batches = Array.isArray(imageBatches?.[slideId]) ? imageBatches[slideId] : [];
      const latest = batches[batches.length - 1];
      return Array.isArray(latest?.images) ? latest.images : [];
    }

    function latestTypographyForSlide(slideId) {
      const batches = Array.isArray(typographyBatches?.[slideId]) ? typographyBatches[slideId] : [];
      const latest = batches[batches.length - 1];
      return Array.isArray(latest?.fontSets) ? latest.fontSets : [];
    }

    function allTypographySets() {
      return Object.values(typographyBatches || {})
        .flatMap((batches) => Array.isArray(batches) ? batches : [])
        .flatMap((batch) => Array.isArray(batch.fontSets) ? batch.fontSets : []);
    }

    function ensureTypographyFonts() {
      ensureTypographyPreconnects();
      for (const fontSet of allTypographySets()) {
        const cssUrl = String(fontSet.cssUrl || '').trim();
        if (!cssUrl || loadedTypographyFontUrls.has(cssUrl)) continue;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssUrl;
        link.dataset.typographyFont = cssUrl;
        document.head.appendChild(link);
        loadedTypographyFontUrls.add(cssUrl);
      }
    }

    function ensureTypographyPreconnects() {
      for (const href of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) {
        if (document.querySelector('link[data-typography-preconnect="' + href + '"]')) continue;
        const link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = href;
        if (href.includes('gstatic')) link.crossOrigin = 'anonymous';
        link.dataset.typographyPreconnect = href;
        document.head.appendChild(link);
      }
    }

    function fontStack(role = {}) {
      const family = String(role.family || '').replace(/["\\\\]/g, '\\\\$&') || 'serif';
      const fallback = String(role.fallback || 'serif').replace(/[^a-zA-Z0-9\\s,-]/g, '').trim() || 'serif';
      return '"' + family + '", ' + fallback;
    }

    function normalizeSuggestionItem(item) {
      if (item && typeof item === 'object') {
        return {
          label: String(item.label || item.value || ''),
          value: String(item.value || item.answer || item.label || ''),
        };
      }
      return {
        label: String(item || ''),
        value: String(item || ''),
      };
    }

    function currentSlide() {
      return SLIDES[index];
    }

    function currentSlideEl() {
      return stage.querySelector('[data-slide="' + currentSlide().id + '"]');
    }

    function refresh() {
      syncSlideVisibility();
      maybeShowImageProviderAlert(currentSlide());
    }

    function maybeShowImageProviderAlert(slide) {
      if (imageProviderAlertShown || !imageProviderNotice?.message) return;
      if (!slide || (slide.kind !== 'visual-cue-grid' && slide.kind !== 'palette-grid')) return;
      imageProviderAlertShown = true;
      sessionStorage.setItem('impeccable-image-provider-alert-' + SESSION.id, '1');
      window.alert(imageProviderNotice.message);
    }

    function syncSlideVisibility() {
      stage.dataset.currentSlide = currentSlide()?.id || '';
      for (const [i, el] of Array.from(stage.querySelectorAll('.slide')).entries()) {
        el.classList.toggle('is-active', i === index);
        el.classList.toggle('is-before', i < index);
        el.setAttribute('aria-hidden', i === index ? 'false' : 'true');
        el.dataset.current = i === index ? 'true' : 'false';
      }
    }

    function onStageClick(event) {
      if (isBusy) return;
      const slide = currentSlide();
      const expand = event.target.closest('[data-image-expand]');
      if (expand && expand.closest('.slide') === currentSlideEl()) {
        event.preventDefault();
        event.stopPropagation();
        openImageModal(slide, expand.dataset.imageExpand);
        return;
      }
      const typeExpand = event.target.closest('[data-type-expand]');
      if (typeExpand && typeExpand.closest('.slide') === currentSlideEl()) {
        event.preventDefault();
        event.stopPropagation();
        openTypeModal(slide, typeExpand.dataset.typeExpand);
        return;
      }
      const suggestion = event.target.closest('[data-suggestion]');
      if (suggestion && suggestion.closest('.slide') === currentSlideEl()) {
        const value = suggestion.dataset.suggestion || '';
        const input = currentSlideEl().querySelector('[data-answer-text]');
        if (input) input.value = '';
        setAnswer(slide, { value }, false);
        updateSuggestionState(slide);
        return;
      }
      const option = event.target.closest('[data-option]');
      if (option && option.closest('.slide') === currentSlideEl()) {
        const answer = answerFromOption(slide, option.dataset.option);
        setAnswer(slide, answer, false);
        updateOptionState(slide);
        const input = currentSlideEl().querySelector('[data-answer-text]');
        if (input && slide.kind === 'choice') input.value = '';
        return;
      }
      const imageCard = event.target.closest('[data-image-card]');
      if (imageCard && imageCard.closest('.slide') === currentSlideEl()) {
        if (event.target.closest('[data-image-expand]')) return;
        const answer = answerFromImageCard(slide, imageCard.dataset.imageCard);
        setAnswer(slide, answer, false);
        updateImageCardState(slide);
        return;
      }
      const typeCard = event.target.closest('[data-type-card]');
      if (typeCard && typeCard.closest('.slide') === currentSlideEl()) {
        if (event.target.closest('[data-type-expand]')) return;
        const answer = answerFromTypographyCard(slide, typeCard.dataset.typeCard);
        setAnswer(slide, answer, false);
        updateTypographyCardState(slide);
        return;
      }
      if (event.target.closest('[data-image-request]')) {
        requestMoreImages(slide);
        return;
      }
      if (event.target.closest('[data-type-request]')) {
        requestMoreTypography(slide);
        return;
      }
      if (event.target.closest('[data-next]')) {
        go(1);
        return;
      }
      if (event.target.closest('[data-prev]')) {
        go(-1);
      }
    }

    function onStageInput(event) {
      if (!event.target.matches('[data-answer-text]')) return;
      const slide = currentSlide();
      if (slide.kind === 'choice' || slide.kind === 'text') {
        delete answers[slide.id];
        updateOptionState(slide);
        updateSuggestionState(slide);
      }
    }

    function onStageChange(event) {
      if (!event.target.matches('[data-upload-input]')) return;
      uploadFiles(event.target.files);
      event.target.value = '';
    }

    function onStageBlur() {}

    function onKeydown(event) {
      if (isAnyModalOpen()) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeActiveModal();
        }
        if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === 'ArrowUp' || event.key === 'PageUp') {
          event.preventDefault();
        }
        return;
      }
      if (isBusy) {
        event.preventDefault();
        return;
      }
      const typing = isEditableTarget(event.target);
      if (typing) {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          commitCurrentDraft();
          go(1);
        }
        return;
      }
      const focusedExpand = event.target.closest?.('[data-image-expand]');
      if ((event.key === 'Enter' || event.key === ' ') && focusedExpand && focusedExpand.closest('.slide') === currentSlideEl()) {
        event.preventDefault();
        openImageModal(currentSlide(), focusedExpand.dataset.imageExpand);
        return;
      }
      const focusedTypeExpand = event.target.closest?.('[data-type-expand]');
      if ((event.key === 'Enter' || event.key === ' ') && focusedTypeExpand && focusedTypeExpand.closest('.slide') === currentSlideEl()) {
        event.preventDefault();
        openTypeModal(currentSlide(), focusedTypeExpand.dataset.typeExpand);
        return;
      }
      const focusedImageCard = event.target.closest?.('[data-image-card]');
      if ((event.key === 'Enter' || event.key === ' ') && focusedImageCard && focusedImageCard.closest('.slide') === currentSlideEl()) {
        event.preventDefault();
        const slide = currentSlide();
        const answer = answerFromImageCard(slide, focusedImageCard.dataset.imageCard);
        setAnswer(slide, answer, false);
        updateImageCardState(slide);
        return;
      }
      const focusedTypeCard = event.target.closest?.('[data-type-card]');
      if ((event.key === 'Enter' || event.key === ' ') && focusedTypeCard && focusedTypeCard.closest('.slide') === currentSlideEl()) {
        event.preventDefault();
        const slide = currentSlide();
        const answer = answerFromTypographyCard(slide, focusedTypeCard.dataset.typeCard);
        setAnswer(slide, answer, false);
        updateTypographyCardState(slide);
        return;
      }
      if (event.key === 'Escape') {
        if (confirm('Cancel this questionnaire?')) cancelSession();
        return;
      }
      if (/^[1-9]$/.test(event.key)) {
        const handled = selectByIndex(Number(event.key) - 1);
        if (handled) {
          event.preventDefault();
          return;
        }
      }
      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        go(1);
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        go(-1);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        go(1);
      }
    }

    function isEditableTarget(target) {
      const element = target?.closest?.('input, textarea, [contenteditable="true"]');
      if (!element) return false;
      return element.closest('.slide') === currentSlideEl();
    }

    function selectByIndex(itemIndex) {
      const slide = currentSlide();
      const active = currentSlideEl();
      if (!slide || !active || itemIndex < 0) return false;
      const option = active.querySelectorAll('[data-option], [data-suggestion]')[itemIndex];
      if (option) {
        option.click();
        option.focus?.({ preventScroll: true });
        return true;
      }
      const imageCard = active.querySelectorAll('[data-image-card]')[itemIndex];
      if (imageCard) {
        const answer = answerFromImageCard(slide, imageCard.dataset.imageCard);
        setAnswer(slide, answer, false);
        updateImageCardState(slide);
        imageCard.focus?.({ preventScroll: true });
        return true;
      }
      const typeCard = active.querySelectorAll('[data-type-card]')[itemIndex];
      if (typeCard) {
        const answer = answerFromTypographyCard(slide, typeCard.dataset.typeCard);
        setAnswer(slide, answer, false);
        updateTypographyCardState(slide);
        typeCard.focus?.({ preventScroll: true });
        return true;
      }
      return false;
    }

    function answerFromOption(slide, value) {
      if (slide.kind === 'multi') {
        const existing = new Set(Array.isArray(answers[slide.id]?.value) ? answers[slide.id].value : []);
        if (existing.has(value)) existing.delete(value);
        else existing.add(value);
        return { value: Array.from(existing) };
      }
      return { value };
    }

    function answerFromOptionValue(slide, value) {
      if (slide.kind === 'multi') return { value: [value].filter(Boolean) };
      return { value };
    }

    function answerFromImageCard(slide, value) {
      const activeBatchId = latestImageBatchId(slide.id);
      const currentAnswer = answers[slide.id];
      const existing = currentAnswer?.batchId && currentAnswer.batchId !== activeBatchId
        ? new Set()
        : new Set(Array.isArray(currentAnswer?.value) ? currentAnswer.value : []);
      if (slide.kind === 'palette-grid') {
        return { value: [value], batchId: activeBatchId, freeform: imageRequestValue() };
      }
      if (existing.has(value)) existing.delete(value);
      else existing.add(value);
      return { value: Array.from(existing), batchId: activeBatchId, freeform: imageRequestValue() };
    }

    function answerFromTypographyCard(slide, value) {
      return { value: [value], freeform: typographyRequestValue() };
    }

    function setAnswer(slide, answer, postNow) {
      const normalized = normalizeLocalAnswer(slide, answer);
      answers[slide.id] = normalized;
      setStatus('', 'info');
      if (postNow) postAnswer(slide.id);
    }

    function normalizeLocalAnswer(slide, answer) {
      if (slide.kind === 'choice') {
        const option = (slide.options || []).find((item) => item.value === answer.value);
        return { value: answer.value, label: option?.label || answer.value, freeform: answer.freeform || undefined };
      }
      if (slide.kind === 'upload') {
        return {
          value: uploadedAssets.map((asset) => asset.id),
          label: uploadedAssets.length > 0 ? uploadedAssets.map((asset) => asset.name).join(', ') : 'No assets yet',
          assets: uploadedAssets,
        };
      }
      if (slide.kind === 'visual-cue-grid' || slide.kind === 'palette-grid') {
        const values = Array.isArray(answer.value) ? answer.value : [answer.value].filter(Boolean);
        const byId = new Map(latestImagesForSlide(slide.id).map((image) => [image.id, image]));
        const labels = values.map((value) => byId.get(value)?.label || value);
        return {
          value: values,
          label: labels.join(', '),
          freeform: answer.freeform || undefined,
          batchId: answer.batchId || latestImageBatchId(slide.id),
          images: values.map((value) => summarizeImageAnswer(byId.get(value))).filter(Boolean),
        };
      }
      if (slide.kind === 'typography-grid') {
        const values = Array.isArray(answer.value) ? answer.value : [answer.value].filter(Boolean);
        const byId = new Map(latestTypographyForSlide(slide.id).map((fontSet) => [fontSet.id, fontSet]));
        const labels = values.map((value) => byId.get(value)?.label || value);
        return {
          value: values,
          label: labels.join(', '),
          freeform: answer.freeform || undefined,
          typography: values.map((value) => summarizeTypographyAnswer(byId.get(value))).filter(Boolean),
        };
      }
      if (slide.kind === 'multi') {
        const values = Array.isArray(answer.value) ? answer.value : [];
        const labels = values.map((value) => (slide.options || []).find((item) => item.value === value)?.label || value);
        return { value: values, label: labels.join(', ') };
      }
      return { value: answer.value || '', label: answer.value || '' };
    }

    function updateOptionState(slide) {
      const input = currentSlideEl().querySelector('[data-answer-text]');
      const hasDraft = Boolean(String(input?.value || '').trim());
      const selected = hasDraft ? new Set() : defaultSelectedValues(slide, answers[slide.id]);
      currentSlideEl().querySelectorAll('[data-option]').forEach((button) => {
        button.setAttribute('aria-pressed', selected.has(button.dataset.option) ? 'true' : 'false');
      });
    }

    function updateImageCardState(slide) {
      const answer = answers[slide.id];
      const activeBatchId = latestImageBatchId(slide.id);
      const selected = answer?.batchId && answer.batchId !== activeBatchId
        ? new Set()
        : new Set(Array.isArray(answer?.value) ? answer.value : []);
      currentSlideEl().querySelectorAll('[data-image-card]').forEach((button) => {
        button.setAttribute('aria-pressed', selected.has(button.dataset.imageCard) ? 'true' : 'false');
        button.setAttribute('aria-selected', selected.has(button.dataset.imageCard) ? 'true' : 'false');
      });
    }

    function updateTypographyCardState(slide) {
      const selected = new Set(Array.isArray(answers[slide.id]?.value) ? answers[slide.id].value : []);
      currentSlideEl().querySelectorAll('[data-type-card]').forEach((button) => {
        button.setAttribute('aria-pressed', selected.has(button.dataset.typeCard) ? 'true' : 'false');
        button.setAttribute('aria-selected', selected.has(button.dataset.typeCard) ? 'true' : 'false');
      });
    }

    function openImageModal(slide, imageId) {
      const image = latestImagesForSlide(slide.id).find((item) => item.id === imageId);
      if (!image || !imageModal || !imageModalImg || !imageModalTitle || !imageModalSwatches) return;
      lastModalFocus = document.activeElement;
      imageModalImg.src = image.dataUrl;
      imageModalImg.alt = image.label || '';
      imageModalTitle.textContent = image.label || '';
      imageModalSwatches.innerHTML = renderModalSwatches(image);
      imageModal.hidden = false;
      imageModal.setAttribute('aria-hidden', 'false');
      imageModalClose?.focus?.({ preventScroll: true });
    }

    function closeImageModal() {
      if (!imageModal) return;
      imageModal.hidden = true;
      imageModal.setAttribute('aria-hidden', 'true');
      if (imageModalImg) imageModalImg.removeAttribute('src');
      const focusTarget = lastModalFocus;
      lastModalFocus = null;
      focusTarget?.focus?.({ preventScroll: true });
    }

    function openTypeModal(slide, fontSetId) {
      const fontSet = latestTypographyForSlide(slide.id).find((item) => item.id === fontSetId);
      if (!fontSet || !typeModal || !typeModalPreview || !typeModalTitle || !typeModalPair || !typeModalRationale || !typeModalUsage) return;
      ensureTypographyFonts();
      lastModalFocus = document.activeElement;
      const style = '--heading-font: ' + fontStack(fontSet.heading) + '; --body-font: ' + fontStack(fontSet.body) + ';';
      typeModalPreview.setAttribute('style', style);
      typeModalPreview.innerHTML = renderTypeSpecimen(fontSet, true);
      typeModalTitle.textContent = fontSet.label || '';
      typeModalPair.textContent = 'Heading: ' + (fontSet.heading?.family || '') + ' / Body: ' + (fontSet.body?.family || '');
      typeModalRationale.textContent = fontSet.rationale || '';
      typeModalUsage.textContent = fontSet.usage || '';
      typeModal.hidden = false;
      typeModal.setAttribute('aria-hidden', 'false');
      typeModalClose?.focus?.({ preventScroll: true });
    }

    function closeTypeModal() {
      if (!typeModal) return;
      typeModal.hidden = true;
      typeModal.setAttribute('aria-hidden', 'true');
      if (typeModalPreview) {
        typeModalPreview.innerHTML = '';
        typeModalPreview.removeAttribute('style');
      }
      const focusTarget = lastModalFocus;
      lastModalFocus = null;
      focusTarget?.focus?.({ preventScroll: true });
    }

    function isImageModalOpen() {
      return Boolean(imageModal && !imageModal.hidden);
    }

    function isTypeModalOpen() {
      return Boolean(typeModal && !typeModal.hidden);
    }

    function isAnyModalOpen() {
      return isImageModalOpen() || isTypeModalOpen();
    }

    function closeActiveModal() {
      if (isImageModalOpen()) closeImageModal();
      if (isTypeModalOpen()) closeTypeModal();
    }

    function onImageModalClick(event) {
      if (event.target === imageModal || event.target.closest('[data-image-modal-close]')) {
        closeImageModal();
      }
    }

    function onTypeModalClick(event) {
      if (event.target === typeModal || event.target.closest('[data-type-modal-close]')) {
        closeTypeModal();
      }
    }

    function renderModalSwatches(image) {
      if (!Array.isArray(image.colors) || image.colors.length === 0) return '';
      return '<div class="swatches">' + image.colors.map((color) => (
        '<span class="swatch">' +
          '<span class="swatch-color" style="--swatch: ' + escapeHtml(color.oklch) + '"></span>' +
          '<span class="swatch-name">' + escapeHtml(color.name) + '</span>' +
        '</span>'
      )).join('') + '</div>';
    }

    function updateSuggestionState(slide) {
      const input = currentSlideEl().querySelector('[data-answer-text]');
      const hasDraft = Boolean(String(input?.value || '').trim());
      const suggestionButtons = Array.from(currentSlideEl().querySelectorAll('[data-suggestion]'));
      const value = hasDraft
        ? ''
        : String(answers[slide.id]?.value || (SESSION.mode === 'init' ? (suggestionButtons[0]?.dataset.suggestion || '') : ''));
      currentSlideEl().querySelectorAll('[data-suggestion]').forEach((button) => {
        button.setAttribute('aria-pressed', button.dataset.suggestion === value ? 'true' : 'false');
      });
    }

    function summarizeImageAnswer(image) {
      if (!image) return null;
      return {
        id: image.id,
        batchId: image.batchId,
        slideId: image.slideId,
        kind: image.kind,
        label: image.label,
        prompt: truncateClientPrompt(image.prompt),
        routeFamily: image.routeFamily,
        colors: image.colors,
      };
    }

    function summarizeTypographyAnswer(fontSet) {
      if (!fontSet) return null;
      return {
        id: fontSet.id,
        batchId: fontSet.batchId,
        slideId: fontSet.slideId,
        kind: fontSet.kind,
        label: fontSet.label,
        cssUrl: fontSet.cssUrl,
        heading: fontSet.heading,
        body: fontSet.body,
        rationale: fontSet.rationale,
        usage: fontSet.usage,
      };
    }

    function truncateClientPrompt(value) {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      return text.length > 1200 ? text.slice(0, 1199).trim() + '…' : text;
    }

    async function postAnswer(slideId) {
      const slide = SLIDES.find((item) => item.id === slideId);
      let answer = answers[slideId];
      if ((!answer || !hasValue(answer)) && slide?.kind === 'upload') {
        answer = normalizeLocalAnswer(slide, { assets: uploadedAssets });
        answers[slideId] = answer;
      }
      if (!answer || !hasValue(answer)) {
        if (slide.required) return null;
        answer = { value: '', label: 'No manual answer', freeform: 'Use the current context.' };
        answers[slideId] = answer;
      }
      try {
        const res = await fetch('/api/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: TOKEN, sessionId: SESSION.id, slideId, answer }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Answer was not accepted.');
        answers = { ...answers, ...(json.event.answers || {}) };
        applyStateUpdates(json.event, { allowActiveUpdate: false, autoAdvance: false });
        return json.event;
      } catch (error) {
        setStatus(error.message, 'error');
        return null;
      }
    }

    async function requestMoreImages(slide) {
      const input = currentSlideEl().querySelector('[data-image-request-input]');
      const freeform = String(input?.value || '').trim();
      if (!freeform) {
        setStatus('Describe the direction you want first.', 'error');
        input?.focus?.({ preventScroll: true });
        return;
      }
      try {
        setStatus('Asking Codex for another batch.', 'info');
        const res = await fetch('/api/image-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: TOKEN,
            sessionId: SESSION.id,
            slideId: slide.id,
            freeform,
            selectedImageIds: slide.kind === 'palette-grid'
              ? (Array.isArray(answers['visual-cues']?.value) ? answers['visual-cues'].value : [])
              : (Array.isArray(answers[slide.id]?.value) ? answers[slide.id].value : []),
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Could not request more images.');
        markImageSlidePending(slide.id);
        input.value = '';
        setThinking(true, slide.kind === 'palette-grid' ? 'Generating palettes' : 'Generating cues');
      } catch (error) {
        setStatus(error.message, 'error');
      }
    }

    async function requestMoreTypography(slide) {
      const input = currentSlideEl().querySelector('[data-type-request-input]');
      const freeform = String(input?.value || '').trim();
      if (!freeform) {
        setStatus('Describe the type direction you want first.', 'error');
        input?.focus?.({ preventScroll: true });
        return;
      }
      try {
        setStatus('Asking Codex for another type batch.', 'info');
        const res = await fetch('/api/typography-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: TOKEN,
            sessionId: SESSION.id,
            slideId: slide.id,
            freeform,
            selectedTypographyIds: Array.isArray(answers[slide.id]?.value) ? answers[slide.id].value : [],
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Could not request more type directions.');
        input.value = '';
        setThinking(true, 'Generating type systems');
      } catch (error) {
        setStatus(error.message, 'error');
      }
    }

    async function chooseForMe(slide) {
      try {
        const freeform = String(currentSlideEl()?.querySelector('[data-answer-text], [data-image-request-input], [data-type-request-input]')?.value || '').trim();
        setThinking(true, 'Choosing a direction');
        const res = await fetch('/api/delegate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: TOKEN,
            sessionId: SESSION.id,
            slideId: slide.id,
            freeform,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Could not ask Codex to choose.');
        const ready = await waitForDelegatedAnswer(slide.id);
        if (!ready) {
          setThinking(false);
          setStatus('Waiting for Codex to choose.', 'info');
        }
      } catch (error) {
        setThinking(false);
        setStatus(error.message, 'error');
      }
    }

    async function waitForDelegatedAnswer(slideId) {
      const started = Date.now();
      while (Date.now() - started < 120000) {
        try {
          const state = await fetchState();
          applyStateUpdates(state, { allowActiveUpdate: true, autoAdvance: false });
          if (state.answers?.[slideId] && hasValue(state.answers[slideId])) {
            answers = { ...answers, ...(state.answers || {}) };
            updateSlideDom({ allowActiveUpdate: true });
            setThinking(false);
            setStatus('Chosen. You can continue.', 'success');
            return true;
          }
          if (Date.now() - started > 2200) setThinking(true, 'Waiting for Codex');
        } catch {
          if (Date.now() - started > 1200) setThinking(true, 'Waiting for Codex');
        }
        await delay(260);
      }
      return false;
    }

    async function uploadFiles(fileList) {
      const files = Array.from(fileList || []);
      if (files.length === 0) return;
      try {
        setThinking(true, 'Adding local files');
        const payloadFiles = await Promise.all(files.map(async (file) => ({
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl: await readFileAsDataUrl(file),
        })));
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: TOKEN,
            sessionId: SESSION.id,
            files: payloadFiles,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Could not add files.');
        uploadedAssets = json.upload.uploadedAssets || [];
        answers.assets = {
          value: uploadedAssets.map((asset) => asset.id),
          label: uploadedAssets.map((asset) => asset.name).join(', '),
          assets: uploadedAssets,
        };
        updateSlideDom({ allowActiveUpdate: true });
        setThinking(false);
        setStatus('Added ' + payloadFiles.length + ' file' + (payloadFiles.length === 1 ? '' : 's') + '.', 'success');
      } catch (error) {
        setThinking(false);
        setStatus(error.message, 'error');
      }
    }

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
        reader.readAsDataURL(file);
      });
    }

    function imageRequestValue() {
      return String(currentSlideEl()?.querySelector('[data-image-request-input]')?.value || '').trim() || undefined;
    }

    function typographyRequestValue() {
      return String(currentSlideEl()?.querySelector('[data-type-request-input]')?.value || '').trim() || undefined;
    }

    function commitCurrentDraft() {
      const slide = currentSlide();
      const active = currentSlideEl();
      if (!slide || !active) return;
      const input = active.querySelector('[data-answer-text]');
      if (input) {
        const typed = String(input.value || '').trim();
        if (typed) {
          setAnswer(slide, { value: typed, freeform: typed }, false);
          return;
        }
      }
      if (slide.kind === 'choice') {
        const selected = active.querySelector('[data-option][aria-pressed="true"]') || active.querySelector('[data-option]');
        if (selected?.dataset.option) {
          setAnswer(slide, answerFromOptionValue(slide, selected.dataset.option), false);
        }
        return;
      }
      if (slide.kind === 'text') {
        const selected = active.querySelector('[data-suggestion][aria-pressed="true"]') || active.querySelector('[data-suggestion]');
        if (selected?.dataset.suggestion) {
          setAnswer(slide, { value: selected.dataset.suggestion }, false);
        }
      }
    }

    async function go(delta) {
      if (isBusy) return;
      if (delta < 0) {
        commitCurrentDraft();
        setSlideIndex(index - 1);
        updateSlideDom({ allowActiveUpdate: true });
        refresh();
        return;
      }
      const slide = currentSlide();
      commitCurrentDraft();
      if (slide.required && !hasValue(answers[slide.id])) {
        setStatus('Answer this slide before continuing.', 'error');
        return;
      }
      const selectionError = validateSelection(slide, answers[slide.id]);
      if (selectionError) {
        setStatus(selectionError, 'error');
        return;
      }
      const nextSlide = SLIDES[index + 1];
      const nextSlideId = nextSlide?.id;
      const previousPatchToken = nextSlideId ? patchToken(nextSlideId) : '';
      pendingAdvance = nextSlideId ? { slideId: nextSlideId, previousPatchToken } : null;
      setThinking(true, index === SLIDES.length - 1 ? 'Writing design direction' : 'Shaping next question');
      const posted = await postAnswer(slide.id);
      if (!posted) {
        pendingAdvance = null;
        setThinking(false);
        return;
      }
      if (index === SLIDES.length - 1) {
        await completeSession();
        setThinking(false);
        return;
      }
      if (nextSlideId && shouldWaitForSlidePatch(nextSlide)) {
        const ready = await waitForNextSlideReady(nextSlideId, previousPatchToken);
        if (!ready) {
          setThinking(false);
          setStatus('Waiting for Codex to shape the next question.', 'info');
          return;
        }
      }
      const targetIndex = nextSlideId ? SLIDES.findIndex((item) => item.id === nextSlideId) : -1;
      if (targetIndex >= 0 && index >= targetIndex) {
        pendingAdvance = null;
        setThinking(false);
        return;
      }
      pendingAdvance = null;
      setSlideIndex(targetIndex >= 0 ? targetIndex : index + 1);
      updateSlideDom({ allowActiveUpdate: true });
      refresh();
      setThinking(false);
    }

    async function completeSession() {
      try {
        setStatus('Writing ' + ARTIFACT_NAME + '...', 'info');
        const res = await fetch('/api/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: TOKEN, sessionId: SESSION.id }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Could not complete questionnaire.');
        applyStateUpdates(json.event, { allowActiveUpdate: false, autoAdvance: false });
        setStatus(json.event.writeAction === 'staged' ? 'Staged next ' + ARTIFACT_NAME + '.' : 'Wrote ' + ARTIFACT_NAME + '.', 'success');
      } catch (error) {
        setStatus(error.message, 'error');
      }
    }

    async function cancelSession() {
      await fetch('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: TOKEN, sessionId: SESSION.id }),
      }).catch(() => {});
      setStatus('Questionnaire cancelled.', 'error');
    }

    async function pollMessages() {
      try {
        const res = await fetch('/api/state?token=' + encodeURIComponent(TOKEN) + '&sessionId=' + encodeURIComponent(SESSION.id));
        const state = await res.json();
        applyStateUpdates(state, { allowActiveUpdate: false, autoAdvance: true });
        const last = state.messages?.[state.messages.length - 1];
        if (last && last.createdAt !== lastMessageAt) {
          lastMessageAt = last.createdAt;
          setStatus(last.message, last.kind || 'info');
          if (last.kind === 'error') {
            pendingImageSlideIds.clear();
            setThinking(false);
            updateSlideDom({ allowActiveUpdate: true });
          }
        }
      } catch {
        // Status messages are non-critical.
      }
    }

    function connectEventStream() {
      if (!window.EventSource) return;
      try {
        const stream = new EventSource('/events?token=' + encodeURIComponent(TOKEN) + '&sessionId=' + encodeURIComponent(SESSION.id));
        const onState = (event) => {
          try {
            const state = JSON.parse(event.data || '{}');
            applyStateUpdates(state, { allowActiveUpdate: false, autoAdvance: true });
            const last = state.messages?.[state.messages.length - 1];
            if (last && last.createdAt !== lastMessageAt) {
              lastMessageAt = last.createdAt;
              setStatus(last.message, last.kind || 'info');
              if (last.kind === 'error') {
                pendingImageSlideIds.clear();
                setThinking(false);
                updateSlideDom({ allowActiveUpdate: true });
              }
            }
          } catch {}
        };
        stream.addEventListener('state', onState);
        stream.addEventListener('slide', onState);
        stream.addEventListener('answer', onState);
        stream.addEventListener('delegate_answer', onState);
        stream.addEventListener('image_provider', onState);
        stream.addEventListener('image_batch', onState);
        stream.addEventListener('typography_batch', onState);
        stream.addEventListener('upload', onState);
        stream.addEventListener('message', onState);
        stream.addEventListener('complete', onState);
      } catch {
        // Polling remains the fallback.
      }
    }

    async function fetchState() {
      const res = await fetch('/api/state?token=' + encodeURIComponent(TOKEN) + '&sessionId=' + encodeURIComponent(SESSION.id));
      if (!res.ok) throw new Error('Could not read questionnaire state.');
      return res.json();
    }

    async function waitForNextSlideReady(slideId, previousPatchToken) {
      const started = Date.now();
      await delay(520);
      while (Date.now() - started < 120000) {
        try {
          const state = await fetchState();
          const patch = state.slidePatches?.[slideId];
          applyStateUpdates(state, { allowActiveUpdate: false, autoAdvance: false });
          const token = patchTokenFrom(patch);
          if (patch?.source === 'agent' && token && token !== previousPatchToken) return true;
          if (Date.now() - started > 2200) setThinking(true, 'Waiting for Codex');
        } catch {
          if (Date.now() - started > 1200) setThinking(true, 'Waiting for Codex');
        }
        await delay(260);
      }
      return false;
    }

    function shouldWaitForSlidePatch(slide) {
      if (!slide) return false;
      if (SESSION.mode === 'init') return true;
      return slide.kind !== 'visual-cue-grid' && slide.kind !== 'palette-grid' && slide.kind !== 'typography-grid';
    }

    function applyStateUpdates(state, options = {}) {
      if (!state) return;
      const hasPatches = Object.prototype.hasOwnProperty.call(state, 'slidePatches');
      const hasImages = Object.prototype.hasOwnProperty.call(state, 'imageBatches');
      const hasImageProvider = Object.prototype.hasOwnProperty.call(state, 'imageProvider');
      const hasImageProviderNotice = Object.prototype.hasOwnProperty.call(state, 'imageProviderNotice');
      const hasTypography = Object.prototype.hasOwnProperty.call(state, 'typographyBatches');
      const hasUploads = Object.prototype.hasOwnProperty.call(state, 'uploadedAssets');
      const hasAnswers = Object.prototype.hasOwnProperty.call(state, 'answers');
      const nextPatches = JSON.stringify(hasPatches ? (state.slidePatches || {}) : (slidePatches || {}));
      const nextImages = JSON.stringify(hasImages ? (state.imageBatches || {}) : (imageBatches || {}));
      const nextImageProvider = JSON.stringify(hasImageProvider ? (state.imageProvider || null) : (imageProvider || null));
      const nextImageProviderNotice = JSON.stringify(hasImageProviderNotice ? (state.imageProviderNotice || null) : (imageProviderNotice || null));
      const nextTypography = JSON.stringify(hasTypography ? (state.typographyBatches || {}) : (typographyBatches || {}));
      const nextUploads = JSON.stringify(hasUploads ? (state.uploadedAssets || []) : (uploadedAssets || []));
      const nextAnswers = JSON.stringify(hasAnswers ? (state.answers || {}) : (answers || {}));
      const patchesChanged = nextPatches !== JSON.stringify(slidePatches || {});
      const imagesChanged = nextImages !== JSON.stringify(imageBatches || {});
      const imageProviderChanged = nextImageProvider !== JSON.stringify(imageProvider || null);
      const imageProviderNoticeChanged = nextImageProviderNotice !== JSON.stringify(imageProviderNotice || null);
      const typographyChanged = nextTypography !== JSON.stringify(typographyBatches || {});
      const uploadsChanged = nextUploads !== JSON.stringify(uploadedAssets || []);
      const answersChanged = nextAnswers !== JSON.stringify(answers || {});
      if (!patchesChanged && !imagesChanged && !imageProviderChanged && !imageProviderNoticeChanged && !typographyChanged && !uploadsChanged && !answersChanged) return;
      const previousImageBatchIds = latestImageBatchIds(imageBatches || {});
      const previousTypographyBatchIds = latestImageBatchIds(typographyBatches || {});
      let imageBatchArrivedForCurrent = false;
      let typographyBatchArrivedForCurrent = false;
      if (answersChanged && hasAnswers) {
        const activeSlideId = currentSlide()?.id;
        const activeDraft = activeSlideId ? answers[activeSlideId] : null;
        answers = { ...answers, ...(state.answers || {}) };
        if (activeSlideId && activeDraft && hasValue(activeDraft) && !state.answers?.[activeSlideId]) {
          answers[activeSlideId] = activeDraft;
        }
      }
      if (patchesChanged && hasPatches) {
        slidePatches = { ...(state.slidePatches || {}) };
        SLIDES = applySlidePatches(BASE_SLIDES, slidePatches);
      }
      if (imagesChanged && hasImages) {
        const activeSlideId = currentSlide()?.id;
        imageBatches = { ...(state.imageBatches || {}) };
        for (const slideId of Object.keys(state.imageBatches || {})) pendingImageSlideIds.delete(slideId);
        const nextImageBatchIds = latestImageBatchIds(imageBatches || {});
        imageBatchArrivedForCurrent = Boolean(activeSlideId && nextImageBatchIds[activeSlideId] && nextImageBatchIds[activeSlideId] !== previousImageBatchIds[activeSlideId]);
        pruneHiddenImageSelections(previousImageBatchIds);
      }
      if (imageProviderChanged && hasImageProvider) {
        imageProvider = state.imageProvider || null;
      }
      if (imageProviderNoticeChanged && hasImageProviderNotice) {
        imageProviderNotice = state.imageProviderNotice || null;
      }
      if (typographyChanged && hasTypography) {
        const activeSlideId = currentSlide()?.id;
        typographyBatches = { ...(state.typographyBatches || {}) };
        const nextTypographyBatchIds = latestImageBatchIds(typographyBatches || {});
        typographyBatchArrivedForCurrent = Boolean(activeSlideId && nextTypographyBatchIds[activeSlideId] && nextTypographyBatchIds[activeSlideId] !== previousTypographyBatchIds[activeSlideId]);
        ensureTypographyFonts();
      }
      if (uploadsChanged && hasUploads) {
        uploadedAssets = [ ...(state.uploadedAssets || []) ];
      }
      const activeInputIsFocused = hasFocusedAnswerInput();
      updateSlideDom({
        ...options,
        allowActiveUpdate: Boolean((options.allowActiveUpdate || imagesChanged || typographyChanged || uploadsChanged || answersChanged) && !activeInputIsFocused),
      });
      syncSlideVisibility();
      if (imagesChanged || typographyChanged) setThinking(false);
      if (imageBatchArrivedForCurrent || typographyBatchArrivedForCurrent) setStatus('', 'info');
      if (options.autoAdvance !== false) maybeAdvancePending();
      maybeShowImageProviderAlert(currentSlide());
    }

    function markImageSlidePending(slideId) {
      pendingImageSlideIds.add(slideId);
      if (currentSlide()?.id === slideId) updateSlideDom({ allowActiveUpdate: true });
    }

    function applySlidePatches(slides, patches) {
      return slides.map((slide) => ({
        ...slide,
        ...(patches?.[slide.id] || {}),
      }));
    }

    function updateSlideDom({ allowActiveUpdate = false } = {}) {
      for (const slide of SLIDES) {
        const el = stage.querySelector('[data-slide="' + slide.id + '"]');
        if (!el) continue;
        if (!allowActiveUpdate && el.classList.contains('is-active')) continue;
        if (el.classList.contains('is-active') && hasFocusedAnswerInput()) continue;
        const title = el.querySelector('h1');
        const prompt = el.querySelector('.prompt');
        if (title) title.textContent = slide.title;
        if (prompt) prompt.textContent = slide.prompt || '';
        if (slide.kind === 'text' || slide.kind === 'choice' || slide.kind === 'upload' || slide.kind === 'visual-cue-grid' || slide.kind === 'palette-grid' || slide.kind === 'typography-grid') {
          const answer = answers[slide.id];
          const answerEl = el.querySelector('.answer');
          if (answerEl) answerEl.innerHTML = renderAnswer(slide, answer);
        }
      }
    }

    function pruneHiddenImageSelections(previousBatchIds = {}) {
      for (const slide of SLIDES) {
        if (slide.kind !== 'visual-cue-grid' && slide.kind !== 'palette-grid') continue;
        const answer = answers[slide.id];
        const values = Array.isArray(answer?.value) ? answer.value : [];
        const latestBatchId = latestImageBatchId(slide.id);
        if (
          latestBatchId
          && (
            (previousBatchIds[slide.id] && latestBatchId !== previousBatchIds[slide.id])
            || (answer?.batchId && answer.batchId !== latestBatchId)
          )
        ) {
          delete answers[slide.id];
          continue;
        }
        if (values.length === 0) continue;
        if (slide.id === currentSlide()?.id && hasValue(answer) && !isBusy) continue;
        const visibleIds = new Set(latestImagesForSlide(slide.id).map((image) => image.id));
        const kept = values.filter((value) => visibleIds.has(value));
        if (kept.length === values.length) continue;
        if (kept.length === 0) {
          delete answers[slide.id];
        } else {
          answers[slide.id] = normalizeLocalAnswer(slide, {
            ...answer,
            value: kept,
          });
        }
      }
    }

    function latestImageBatchIds(batchesBySlide = {}) {
      return Object.fromEntries(Object.entries(batchesBySlide).map(([slideId, batches]) => {
        const list = Array.isArray(batches) ? batches : [];
        return [slideId, list[list.length - 1]?.batchId || ''];
      }));
    }

    function latestImageBatchId(slideId) {
      const batches = Array.isArray(imageBatches?.[slideId]) ? imageBatches[slideId] : [];
      return batches[batches.length - 1]?.batchId || '';
    }

    function hasFocusedAnswerInput() {
      const active = document.activeElement;
      return Boolean(
        active?.matches?.('[data-answer-text], [data-image-request-input], [data-type-request-input]')
        && active.closest('.slide') === currentSlideEl()
      );
    }

    function setThinking(active, message) {
      isBusy = active;
      if (!thinking) return;
      if (message && thinkingMessage) thinkingMessage.textContent = message;
      if (active) {
        thinking.hidden = false;
        requestAnimationFrame(() => thinking.classList.add('is-active'));
        return;
      }
      thinking.classList.remove('is-active');
      setTimeout(() => {
        if (!isBusy) thinking.hidden = true;
      }, 230);
    }

    function maybeAdvancePending() {
      if (!pendingAdvance) return;
      const patch = slidePatches?.[pendingAdvance.slideId];
      const token = patchTokenFrom(patch);
      if (patch?.source !== 'agent' || !token || token === pendingAdvance.previousPatchToken) return;
      const targetIndex = SLIDES.findIndex((slide) => slide.id === pendingAdvance.slideId);
      if (targetIndex <= index) return;
      pendingAdvance = null;
      setSlideIndex(targetIndex);
      updateSlideDom({ allowActiveUpdate: true });
      refresh();
      setThinking(false);
    }

    function delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function patchToken(slideId) {
      return patchTokenFrom(slidePatches?.[slideId]);
    }

    function patchTokenFrom(patch) {
      if (!patch) return '';
      return patch.updatedAt || JSON.stringify(patch);
    }

    function setStatus(message, kind) {
      const status = currentSlideEl()?.querySelector('[data-status]');
      if (!status) return;
      status.textContent = message || '';
      status.dataset.kind = kind || 'info';
    }

    function hasValue(answer) {
      if (Array.isArray(answer?.value)) return answer.value.length > 0;
      return String(answer?.value || '').trim().length > 0;
    }

    function validateSelection(slide, answer) {
      if (slide.kind !== 'visual-cue-grid' && slide.kind !== 'palette-grid' && slide.kind !== 'typography-grid') return '';
      const count = Array.isArray(answer?.value) ? answer.value.length : 0;
      const min = slide.minSelections || 1;
      const max = slide.maxSelections || min;
      if (count < min) return min === 1 ? 'Choose one card before continuing.' : 'Choose at least ' + min + ' cards before continuing.';
      if (count > max) return max === 1 ? 'Choose one card.' : 'Choose no more than ' + max + ' cards.';
      return '';
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]);
    }

    render();
  </script>
</body>
</html>`;
}

function publicSession(session) {
  const mode = sessionMode(session);
  const targetDesignPath = session.designTargetPath
    || (mode === 'init'
      ? (session.targetPaths?.design || (session.existingDesign ? path.join('.impeccable', 'init', 'DESIGN.next.md') : 'DESIGN.md'))
      : (session.existingDesign ? path.join('.impeccable', 'questionnaire', 'DESIGN.next.md') : 'DESIGN.md'));
  return {
    id: session.id,
    mode,
    command: session.command,
    prompt: session.prompt,
    targetPath: session.targetPath,
    targetPaths: session.targetPaths || null,
    projectRoot: session.projectRoot,
    existingDesign: session.existingDesign,
    existingProduct: session.existingProduct || false,
    existingBrand: session.existingBrand || false,
    status: session.status,
    answers: session.answers,
    slidePatches: session.slidePatches || {},
    imageBatches: latestPublicImageBatches(session.imageBatches || {}),
    imageProvider: session.imageProvider || null,
    imageProviderNotice: session.imageProvider?.provider === 'builtin-quadrant'
      ? {
        kind: 'missing-image-api-key',
        message: session.imageProvider.alertMessage || 'No IMAGE_API_KEY in .impeccable/.env. Using built-in images; Flux is faster.',
      }
      : null,
    typographyBatches: session.typographyBatches || {},
    uploadedAssets: session.uploadedAssets || [],
    events: publicEventSummaries(session.events || []),
    messages: session.messages,
    targetDesignPath,
    targetProductPath: session.productTargetPath || session.targetPaths?.product || (session.existingProduct ? path.join('.impeccable', 'init', 'PRODUCT.next.md') : 'PRODUCT.md'),
    targetBrandPath: session.brandTargetPath || session.targetPaths?.brand || (session.existingBrand ? path.join('.impeccable', 'init', 'BRAND.next.md') : 'BRAND.md'),
    artifactTargetPath: session.artifactTargetPath || targetDesignPath,
    writeAction: session.writeAction || null,
    writeActions: session.writeActions || null,
  };
}

function latestPublicImageBatches(imageBatches = {}) {
  return Object.fromEntries(Object.entries(imageBatches).map(([slideId, batches]) => {
    const list = Array.isArray(batches) ? batches : [];
    const latest = list[list.length - 1];
    return [slideId, latest ? [latest] : []];
  }));
}

function publicImageSummaries(images = []) {
  return images.map((image) => ({
    id: image.id,
    batchId: image.batchId,
    slideId: image.slideId,
    kind: image.kind,
    label: image.label,
    routeFamily: image.routeFamily,
    routeFamilyLabel: image.routeFamilyLabel,
    colors: image.colors,
    createdAt: image.createdAt,
  }));
}

function publicEventSummaries(events = []) {
  return events.map((event) => {
    if (!event || typeof event !== 'object') return event;
    if (event.type === 'image_batch') {
      return {
        ...event,
        images: Array.isArray(event.images) ? publicImageSummaries(event.images) : [],
        imageBatches: latestPublicImageBatches(event.imageBatches || {}),
      };
    }
    if (event.type === 'image_request') {
      return {
        ...event,
        selectedImages: Array.isArray(event.selectedImages)
          ? event.selectedImages.map((image) => ({
            id: image.id,
            label: image.label,
            routeFamily: image.routeFamily,
            routeFamilyLabel: image.routeFamilyLabel,
          }))
          : [],
      };
    }
    return event;
  });
}

function safeProviderError(error) {
  return String(error?.message || error || 'unknown error')
    .replace(/bfl_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .slice(0, 220);
}

function findSessionFiles(cwd, sessionId) {
  const out = [];
  walkWorkspace(cwd, 0);
  return out;

  function walkWorkspace(dir, depth) {
    if (depth > 5) return;
    const candidate = path.join(getQuestionnaireSessionsDir(dir), `${sessionId}.json`);
    if (fs.existsSync(candidate)) out.push(candidate);

    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipSessionSearchDir(entry.name)) continue;
      walkWorkspace(path.join(dir, entry.name), depth + 1);
    }
  }
}

function shouldSkipSessionSearchDir(name) {
  return new Set([
    '.astro',
    '.git',
    '.hg',
    '.next',
    '.nuxt',
    '.svelte-kit',
    '.svn',
    'build',
    'coverage',
    'dist',
    'node_modules',
    'tmp',
  ]).has(name);
}

function parseUploadDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase(),
    bytes: Buffer.from(match[2], 'base64'),
  };
}

function uniqueUploadName(dir, originalName, mimeType) {
  const ext = path.extname(originalName) || extensionForMime(mimeType);
  const stem = sanitizeFilePart(path.basename(originalName, path.extname(originalName)) || 'upload');
  let candidate = `${stem}${ext}`;
  let index = 2;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${stem}-${index}${ext}`;
    index += 1;
  }
  return candidate;
}

function extensionForMime(mimeType) {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg';
  if (mimeType.includes('png')) return '.png';
  if (mimeType.includes('webp')) return '.webp';
  if (mimeType.includes('gif')) return '.gif';
  if (mimeType.includes('mp4')) return '.mp4';
  if (mimeType.includes('plain')) return '.txt';
  return '.bin';
}

function inferUploadRole(type, name) {
  const lower = `${type} ${name}`.toLowerCase();
  if (lower.includes('gif') || lower.includes('video') || lower.includes('mp4')) return 'motion';
  if (lower.includes('testimonial') || lower.includes('review') || lower.includes('text/plain')) return 'proof';
  if (lower.includes('process')) return 'process';
  if (lower.includes('image') || lower.match(/\.(png|jpe?g|webp)$/)) return 'product-photo';
  return 'asset';
}

function sanitizeFilePart(value) {
  return String(value || 'file')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'file';
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new Error('Payload too large.');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function html(res, body) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function serveDesignSystemAsset(pathname, res, cwd) {
  const allowed = new Set(['kinpaku-gold-leaf.png', 'verdigris-patina.png']);
  const filename = path.basename(pathname);
  if (!allowed.has(filename)) return false;
  const assetPath = path.join(cwd, 'site', 'public', 'assets', 'neo-kinpaku', filename);
  if (!fs.existsSync(assetPath)) return false;
  res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
  fs.createReadStream(assetPath).pipe(res);
  return true;
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
}

function randomToken(bytes = 16) {
  return randomBytes(bytes).toString('hex');
}

async function findOpenPort(start = 8600) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(start, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(findOpenPort(start + 1)));
  });
}

if (isCli) {
  const args = process.argv.slice(2);
  const portArg = args.find((arg) => arg.startsWith('--port='));
  const port = portArg ? Number(portArg.slice('--port='.length)) : 0;
  const server = await startQuestionnaireServer({ cwd: process.cwd(), port });
  console.log(`Impeccable questionnaire server running on ${server.baseUrl}`);
}
