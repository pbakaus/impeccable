import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  assembleLiveBrowserScript,
  assertLiveBrowserScriptParts,
  readLiveBrowserScriptParts,
  resolveLiveBrowserScriptParts,
} from '../skill/scripts/live/browser-script-parts.mjs';

describe('live browser script parts', () => {
  it('resolves the canonical browser script order', () => {
    const parts = resolveLiveBrowserScriptParts('/repo/skill/scripts');

    assert.deepEqual(parts.map((part) => part.name), ['session-state', 'dom-helpers', 'browser-ui']);
    assert.equal(parts[0].file, 'live-browser-session.js');
    assert.equal(parts[1].file, 'live-browser-dom.js');
    assert.equal(parts[2].file, 'live-browser.js');
    assert.equal(parts[0].path, path.join('/repo/skill/scripts', 'live-browser-session.js'));
    assert.equal(parts[1].path, path.join('/repo/skill/scripts', 'live-browser-dom.js'));
    assert.equal(parts[2].path, path.join('/repo/skill/scripts', 'live-browser.js'));
  });

  it('asserts missing script parts by name', () => {
    const parts = resolveLiveBrowserScriptParts('/repo/skill/scripts');

    assert.throws(
      () => assertLiveBrowserScriptParts(parts, (filePath) => !filePath.endsWith('live-browser.js')),
      /Live browser script part missing: browser-ui/,
    );
  });

  it('reads each part with an injected reader', () => {
    const parts = resolveLiveBrowserScriptParts('/repo/skill/scripts');
    const loaded = readLiveBrowserScriptParts(parts, (filePath) => `source:${path.basename(filePath)}`);

    assert.deepEqual(loaded.map((part) => part.source), [
      'source:live-browser-session.js',
      'source:live-browser-dom.js',
      'source:live-browser.js',
    ]);
  });

  it('assembles prelude, session helper, and browser UI in order', () => {
    const script = assembleLiveBrowserScript({
      token: 'token-a',
      port: 8421,
      vocabulary: [{ value: 'shape', label: 'Shape' }],
      commandPrefix: '$',
      parts: [
        { name: 'session-state', file: 'live-browser-session.js', source: 'window.__SESSION_PART__ = true;' },
        { name: 'dom-helpers', file: 'live-browser-dom.js', source: 'window.__DOM_PART__ = true;' },
        { name: 'browser-ui', file: 'live-browser.js', source: 'window.__BROWSER_PART__ = true;' },
      ],
    });

    const tokenIndex = script.indexOf('window.__IMPECCABLE_TOKEN__');
    const portIndex = script.indexOf('window.__IMPECCABLE_PORT__');
    const commandPrefixIndex = script.indexOf('window.__IMPECCABLE_COMMAND_PREFIX__');
    const vocabIndex = script.indexOf('window.__IMPECCABLE_VOCAB__');
    const sessionIndex = script.indexOf('window.__SESSION_PART__');
    const domIndex = script.indexOf('window.__DOM_PART__');
    const browserIndex = script.indexOf('window.__BROWSER_PART__');

    assert.ok(tokenIndex !== -1);
    assert.ok(tokenIndex < portIndex);
    assert.ok(portIndex < commandPrefixIndex);
    assert.ok(commandPrefixIndex < vocabIndex);
    assert.match(script, /window\.__IMPECCABLE_COMMAND_PREFIX__ = "\$"/);
    assert.ok(vocabIndex < sessionIndex);
    assert.ok(sessionIndex < domIndex);
    assert.ok(domIndex < browserIndex);
    assert.match(script, /impeccable live script part: session-state \(live-browser-session\.js\)/);
    assert.match(script, /impeccable live script part: dom-helpers \(live-browser-dom\.js\)/);
    assert.match(script, /impeccable live script part: browser-ui \(live-browser\.js\)/);
  });
});
