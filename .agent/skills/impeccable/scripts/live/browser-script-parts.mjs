import fs from 'node:fs';
import path from 'node:path';

import { LIVE_CHROME_MOUNT_CONTRACT, LIVE_UI_SURFACES } from './ui-surfaces.mjs';

export const LIVE_BROWSER_SCRIPT_PARTS = Object.freeze([
  Object.freeze({ name: 'session-state', file: 'live-browser-session.js' }),
  Object.freeze({ name: 'dom-helpers', file: 'live-browser-dom.js' }),
  Object.freeze({ name: 'browser-ui', file: 'live-browser.js' }),
]);

export function resolveLiveBrowserScriptParts(scriptsDir, parts = LIVE_BROWSER_SCRIPT_PARTS) {
  if (!scriptsDir) throw new Error('scriptsDir is required');
  return parts.map((part, index) => ({
    ...part,
    index,
    path: path.join(scriptsDir, part.file),
  }));
}

export function assertLiveBrowserScriptParts(parts, exists = fs.existsSync) {
  for (const part of parts) {
    if (!exists(part.path)) {
      throw new Error(`Live browser script part missing: ${part.name} (${part.path})`);
    }
  }
  return parts;
}

export function readLiveBrowserScriptParts(parts, readFile = (filePath) => fs.readFileSync(filePath, 'utf-8')) {
  return parts.map((part) => ({
    ...part,
    source: readFile(part.path),
  }));
}

export function assembleLiveBrowserScript({
  token,
  port,
  vocabulary,
  commandPrefix = '/',
  appRoot = null,
  parts,
  // Defaulted rather than threaded through live-server.mjs: the browser bundle
  // must always carry the canonical inventory, and a default makes that true by
  // construction instead of by every caller remembering to pass it. Overridable
  // so tests can assemble with a stand-in.
  uiSurfaces = LIVE_UI_SURFACES,
  mountContract = LIVE_CHROME_MOUNT_CONTRACT,
}) {
  const prelude =
    `window.__IMPECCABLE_TOKEN__ = '${token}';\n` +
    `window.__IMPECCABLE_PORT__ = ${port};\n` +
    // Project identity for browser-side session storage. localStorage is
    // keyed by ORIGIN, and two projects routinely share a localhost port
    // across time; saved sessions carry this value so a resume can tell a
    // foreign project's leftovers from its own.
    `window.__IMPECCABLE_APP_ROOT__ = ${JSON.stringify(appRoot)};\n` +
    `window.__IMPECCABLE_COMMAND_PREFIX__ = ${JSON.stringify(commandPrefix)};\n` +
    // Canonical command vocabulary (values + labels + icons). live-browser.js
    // builds its action picker from this instead of an inline copy.
    `window.__IMPECCABLE_VOCAB__ = ${JSON.stringify(vocabulary)};\n` +
    // Canonical Live chrome inventory from live/ui-surfaces.mjs. live-browser.js
    // is a classic script and cannot import an ES module at runtime, so the list
    // is serialized here and read off the global there. Node consumers (this
    // repo's tests, the impeccable-site Live UI lab) import the module directly,
    // which is what keeps the two from drifting.
    `window.__IMPECCABLE_LIVE_UI_SURFACES__ = ${JSON.stringify(uiSurfaces)};\n` +
    `window.__IMPECCABLE_LIVE_MOUNT_CONTRACT__ = ${JSON.stringify(mountContract)};\n`;

  const body = parts.map((part) => {
    const file = part.file || path.basename(part.path || '');
    return `// --- impeccable live script part: ${part.name} (${file}) ---\n${part.source}`;
  }).join('\n');

  return prelude + body;
}
