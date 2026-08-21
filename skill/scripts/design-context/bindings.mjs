/** What the design context document lets a person edit, and where it lands.
 *
 * Every editable field has an id the browser sends and this file resolves into
 * a file and a path inside it. That is what makes applying a change a
 * deterministic write rather than a search: the document names the field, not
 * the text it happens to hold.
 *
 * `file` is the store file the value lives in. For `context`, the path is
 * relative to the top-level `context` object, so `product.purpose` addresses
 * `context.product.purpose` inside context.json.
 *
 * `downstream` names the document the agent reconciles afterwards. The value
 * itself is already applied by the time the agent hears about it; what needs a
 * reader is the prose around it.
 */

export const BINDINGS = {
  'palette.primary': { file: 'answers', path: 'palette-primary', kind: 'color', downstream: 'design-md' },
  'palette.secondary': { file: 'answers', path: 'palette-secondary', kind: 'color', downstream: 'design-md' },
  'palette.tertiary': { file: 'answers', path: 'palette-tertiary', kind: 'color', downstream: 'design-md' },
  'palette.neutral': { file: 'answers', path: 'palette-neutral', kind: 'color', downstream: 'design-md' },

  'product.purpose': { file: 'context', path: 'product.purpose', kind: 'text', maxLen: 600, downstream: 'product-md' },
  'product.positioning.not': { file: 'context', path: 'product.positioning.not', kind: 'text', maxLen: 300, downstream: 'product-md' },
  'product.positioning.this': { file: 'context', path: 'product.positioning.this', kind: 'text', maxLen: 300, downstream: 'product-md' },

  'audience.primary': { file: 'context', path: 'audience.primary', kind: 'text', maxLen: 300, downstream: 'product-md' },
  'audience.secondary': { file: 'context', path: 'audience.secondary', kind: 'text', maxLen: 300, downstream: 'product-md' },
  'audience.emotion': { file: 'context', path: 'audience.emotion', kind: 'text', maxLen: 300, downstream: 'product-md' },
  'audience.leaving': { file: 'context', path: 'audience.leaving', kind: 'text', maxLen: 300, downstream: 'product-md' },

  'brand.personality': { file: 'context', path: 'brand.personality', kind: 'text', maxLen: 600, downstream: 'product-md' },
};

const DEFAULT_MAX_LEN = 2000;
const HEX = /^#[0-9a-fA-F]{6}$/;

export const bindingFor = (id) => (Object.hasOwn(BINDINGS, id) ? BINDINGS[id] : null);

/**
 * Turn what a contenteditable produced into something safe to write.
 *
 * Everything arriving here was typed into a browser, so it is treated as text
 * and nothing else: control characters go, newlines collapse (every bound field
 * is a single line in the document), and the length is capped where the field
 * says so. A value that survives is a string; a value that cannot be one throws.
 */
export function sanitizeValue(binding, raw) {
  if (binding.kind === 'color') {
    const value = String(raw ?? '').trim().toUpperCase();
    if (!HEX.test(value)) throw new Error('Expected a #rrggbb color');
    return value;
  }

  const text = String(raw ?? '')
    /* Newlines first, because they are the one control character with a
       meaning here: a pasted paragraph becomes one line rather than nothing. */
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!text) throw new Error('Expected some text');
  return text.slice(0, binding.maxLen || DEFAULT_MAX_LEN);
}

/** Read a dotted path out of a plain object, without creating anything. */
export function readPath(root, dotted) {
  return dotted.split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), root);
}

/** Write a dotted path into a plain object, creating the objects on the way. */
export function writePath(root, dotted, value) {
  const keys = dotted.split('.');
  const last = keys.pop();
  let node = root;
  for (const key of keys) {
    if (!node[key] || typeof node[key] !== 'object' || Array.isArray(node[key])) node[key] = {};
    node = node[key];
  }
  node[last] = value;
  return root;
}
