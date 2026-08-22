/**
 * Shared event validation for the live helper server.
 * Extracted for unit testing (insert mode rules).
 */

import { canCreateInsert } from './insert-ui.mjs';

// The accepted protocol values come from the canonical vocabulary so the
// validator, the store, the server, and the picker UI never drift. Imported
// (not just re-exported) so they are also in scope for the validators below.
import { AGENT_PHASES, CLIENT_EVENT_TYPES, VISUAL_ACTIONS } from './vocabulary.mjs';
export { AGENT_PHASES, CLIENT_EVENT_TYPES, VISUAL_ACTIONS };

const AGENT_PHASE_SET = new Set(AGENT_PHASES);

const ID_PATTERN = /^[0-9a-f]{8}$/;
const VARIANT_ID_PATTERN = /^[0-9]{1,3}$/;
const INSERT_POSITIONS = new Set(['before', 'after']);
const FORBIDDEN_MANUAL_EDIT_TEXT_CHARS = ['<', '{', '}', '`'];

// Mount acknowledgements carry a module URL and a raw exception message from
// the page. Both are attacker-adjacent (any script on the page can POST them
// with the token it can already read), so they are length-capped before they
// reach the journal.
export const MOUNT_URL_MAX_LENGTH = 2000;
export const MOUNT_ERROR_MAX_LENGTH = 1000;

function isValidId(v) { return typeof v === 'string' && ID_PATTERN.test(v); }
function isValidVariantId(v) { return typeof v === 'string' && VARIANT_ID_PATTERN.test(v); }

function validateManualEditText(newText) {
  if (typeof newText !== 'string') return null;
  const hits = FORBIDDEN_MANUAL_EDIT_TEXT_CHARS.filter((char) => newText.includes(char));
  return hits.length > 0 ? hits : null;
}

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

function validateManualEditEvent(msg, label) {
  if (!isValidId(msg.id)) return label + ': missing or malformed id';
  if (!msg.pageUrl || typeof msg.pageUrl !== 'string') return label + ': missing pageUrl';
  if (!msg.element || typeof msg.element !== 'object') return label + ': missing element';
  if (!Array.isArray(msg.ops) || msg.ops.length === 0) return label + ': ops must be non-empty array';
  if (msg.ops.length > 100) return label + ': too many ops (max 100)';
  for (const op of msg.ops) {
    if (typeof op.ref !== 'string') return label + ': op.ref required';
    if (typeof op.tag !== 'string') return label + ': op.tag required';
    if (typeof op.originalText !== 'string') return label + ': op.originalText required';
    if (op.deleted !== true && typeof op.newText !== 'string') {
      return label + ': text op requires newText';
    }
    if (typeof op.newText === 'string') {
      if (op.deleted !== true && op.newText.trim().length === 0) {
        return label + ': newText cannot be empty';
      }
      const forbidden = validateManualEditText(op.newText);
      if (forbidden) {
        return label + ': newText cannot contain ' + forbidden.join(' ') + ' (plain text only; ask the AI to insert markup)';
      }
    }
  }
  return null;
}

function isValidMountVariant(value) {
  return Number.isInteger(value) && value >= 1 && value <= 999;
}

/**
 * Mount acknowledgements are the browser's answer to "did the thing you
 * published actually render". They are validated strictly because the render
 * truth in the session snapshot is built from them: a malformed ack that slid
 * through would report a variant as mounted that never was.
 */
function validateMountAck(msg) {
  if (!isValidId(msg.id)) return 'variant_mounted: missing or malformed id';
  if (!isValidMountVariant(msg.variant)) return 'variant_mounted: variant must be an integer 1-999';
  if (msg.url !== undefined) {
    if (typeof msg.url !== 'string') return 'variant_mounted: url must be string';
    if (msg.url.length > MOUNT_URL_MAX_LENGTH) return 'variant_mounted: url too long';
  }
  return null;
}

function validateMountFailure(msg) {
  if (!isValidId(msg.id)) return 'variant_mount_failed: missing or malformed id';
  if (!isValidMountVariant(msg.variant)) return 'variant_mount_failed: variant must be an integer 1-999';
  if (typeof msg.url !== 'string' || !msg.url.trim()) return 'variant_mount_failed: url required';
  if (msg.url.length > MOUNT_URL_MAX_LENGTH) return 'variant_mount_failed: url too long';
  if (typeof msg.error !== 'string' || !msg.error.trim()) return 'variant_mount_failed: error required';
  if (msg.error.length > MOUNT_ERROR_MAX_LENGTH) return 'variant_mount_failed: error too long';
  return null;
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
    case 'agent_phase':
      if (!isValidId(msg.id)) return 'agent_phase: missing or malformed id';
      if (typeof msg.phase !== 'string' || !msg.phase) return 'agent_phase: missing phase';
      // The enum, not a shape pattern. A phase the browser cannot rank is a
      // phase the progress bar cannot show, so accepting an arbitrary
      // lowercase word only defers the failure to the UI.
      if (!AGENT_PHASE_SET.has(msg.phase)) {
        return 'agent_phase: unknown phase ' + msg.phase + ' (expected one of ' + AGENT_PHASES.join(', ') + ')';
      }
      if (msg.durationMs !== undefined && (!Number.isFinite(msg.durationMs) || msg.durationMs < 0)) {
        return 'agent_phase: durationMs must be a non-negative number';
      }
      return null;
    case 'variant_mounted':
      return validateMountAck(msg);
    case 'variant_mount_failed':
      return validateMountFailure(msg);
    case 'exit':
      return null;
    case 'prefetch':
      if (!msg.pageUrl || typeof msg.pageUrl !== 'string') return 'prefetch: missing pageUrl';
      return null;
    case 'manual_edits':
      return validateManualEditEvent(msg, 'manual_edits');
    case 'steer':
      if (!isValidId(msg.id)) return 'steer: missing or malformed id';
      if (typeof msg.message !== 'string' || !msg.message.trim()) return 'steer: message required';
      if (msg.message.length > 4000) return 'steer: message too long';
      if (msg.pageUrl !== undefined && typeof msg.pageUrl !== 'string') return 'steer: pageUrl must be string';
      return null;
    case 'carbonize_cleanup':
      if (!isValidId(msg.id)) return 'carbonize_cleanup: missing or malformed id';
      if (!isValidId(msg.sessionId)) return 'carbonize_cleanup: missing or malformed sessionId';
      if (!msg.file || typeof msg.file !== 'string') return 'carbonize_cleanup: missing file';
      if (!isValidVariantId(String(msg.variantId))) return 'carbonize_cleanup: missing or malformed variantId';
      return null;
    default:
      return 'Unknown event type: ' + msg.type;
  }
}
