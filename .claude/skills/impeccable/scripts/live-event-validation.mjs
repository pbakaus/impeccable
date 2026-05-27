/**
 * Shared event validation for the live helper server.
 * Extracted for unit testing (insert mode rules).
 */

import { canCreateInsert } from './live-insert-ui.mjs';

export const VISUAL_ACTIONS = [
  'impeccable', 'bolder', 'quieter', 'distill', 'polish', 'typeset',
  'colorize', 'layout', 'adapt', 'animate', 'delight', 'overdrive',
];

const ID_PATTERN = /^[0-9a-f]{8}$/;
const VARIANT_ID_PATTERN = /^[0-9]{1,3}$/;
const INSERT_POSITIONS = new Set(['before', 'after']);

function isValidId(v) { return typeof v === 'string' && ID_PATTERN.test(v); }
function isValidVariantId(v) { return typeof v === 'string' && VARIANT_ID_PATTERN.test(v); }

function validateAnnotationFields(msg) {
  if (msg.screenshotPath !== undefined && typeof msg.screenshotPath !== 'string') {
    return 'generate: screenshotPath must be string';
  }
  if (msg.comments !== undefined && !Array.isArray(msg.comments)) {
    return 'generate: comments must be array';
  }
  if (msg.strokes !== undefined && !Array.isArray(msg.strokes)) {
    return 'generate: strokes must be array';
  }
  return null;
}

function validateInsertGenerate(msg) {
  if (!msg.insert || typeof msg.insert !== 'object') return 'generate: insert mode requires insert object';
  if (!INSERT_POSITIONS.has(msg.insert.position)) return 'generate: insert.position must be before or after';
  const anchor = msg.insert.anchor;
  if (!anchor || typeof anchor !== 'object') return 'generate: insert.anchor required';
  if (!anchor.tagName && !anchor.outerHTML && !(Array.isArray(anchor.classes) && anchor.classes.length)) {
    return 'generate: insert.anchor needs tagName, classes, or outerHTML';
  }
  if (!msg.placeholder || typeof msg.placeholder !== 'object') return 'generate: insert mode requires placeholder dimensions';
  if (!Number.isFinite(msg.placeholder.width) || !Number.isFinite(msg.placeholder.height)) {
    return 'generate: placeholder width and height must be numbers';
  }
  if (!canCreateInsert({
    prompt: msg.freeformPrompt,
    comments: msg.comments,
    strokes: msg.strokes,
  })) {
    return 'generate: insert requires freeformPrompt or annotations';
  }
  return validateAnnotationFields(msg);
}

function validateReplaceGenerate(msg) {
  if (!msg.action || !VISUAL_ACTIONS.includes(msg.action)) return 'generate: invalid action';
  if (!msg.element || !msg.element.outerHTML) return 'generate: missing element context';
  return validateAnnotationFields(msg);
}

export function validateEvent(msg) {
  if (!msg || typeof msg !== 'object' || !msg.type) return 'Missing or invalid message';
  switch (msg.type) {
    case 'generate':
      if (!isValidId(msg.id)) return 'generate: missing or malformed id';
      if (!Number.isInteger(msg.count) || msg.count < 1 || msg.count > 8) return 'generate: count must be 1-8';
      if (msg.mode === 'insert') return validateInsertGenerate(msg);
      return validateReplaceGenerate(msg);
    case 'accept':
      if (!isValidId(msg.id)) return 'accept: missing or malformed id';
      if (!isValidVariantId(msg.variantId)) return 'accept: missing or malformed variantId';
      if (msg.paramValues !== undefined) {
        if (typeof msg.paramValues !== 'object' || msg.paramValues === null || Array.isArray(msg.paramValues)) {
          return 'accept: paramValues must be an object';
        }
      }
      return null;
    case 'discard':
      return isValidId(msg.id) ? null : 'discard: missing or malformed id';
    case 'checkpoint':
      if (!isValidId(msg.id)) return 'checkpoint: missing or malformed id';
      if (!Number.isInteger(msg.revision) || msg.revision < 0) return 'checkpoint: revision must be a non-negative integer';
      if (msg.paramValues !== undefined && (typeof msg.paramValues !== 'object' || msg.paramValues === null || Array.isArray(msg.paramValues))) {
        return 'checkpoint: paramValues must be an object';
      }
      return null;
    case 'exit':
      return null;
    case 'prefetch':
      if (!msg.pageUrl || typeof msg.pageUrl !== 'string') return 'prefetch: missing pageUrl';
      return null;
    case 'steer':
      if (!isValidId(msg.id)) return 'steer: missing or malformed id';
      if (typeof msg.message !== 'string' || !msg.message.trim()) return 'steer: message required';
      if (msg.message.length > 4000) return 'steer: message too long';
      if (msg.pageUrl !== undefined && typeof msg.pageUrl !== 'string') return 'steer: pageUrl must be string';
      return null;
    default:
      return 'Unknown event type: ' + msg.type;
  }
}
