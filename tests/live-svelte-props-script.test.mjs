/**
 * The variant components live mode scaffolds must survive the app's own Svelte
 * compiler AND parse as JavaScript afterwards. Run with:
 *   node --test tests/live-svelte-props-script.test.mjs
 *
 * `compileCheckVariants` already compiles each variant with `generate: false`,
 * which proves the .svelte source parses. It cannot prove the emitted module
 * parses, and that is the gap this suite covers. In issue #580, esrap 2.3.3
 * (Svelte's JS printer, pulled in by `esrap: ^2.2.12`) printed a
 * `/** @type {...} *\/` written directly before a destructuring declaration as
 * JSDoc cast syntax on the template's own declaration,
 *
 *   var /** @type {{ title: string; }} *\/ (h1) = root();
 *
 * which compiles without complaint and then dies in the browser's dynamic
 * import with "Unexpected token '('". Nothing rendered, and the failure
 * surfaced two layers away from the comment that caused it.
 *
 * Two things follow, and both shape this file:
 *
 * 1. The assertion is on the emitted JavaScript, never on the comment style. A
 *    future printer that mangles some other construct fails here too, which a
 *    test pinned to `@typedef` would not.
 * 2. The compiler is imported as ESM, because that is what the dev server
 *    resolves. Svelte's export map sends `require` to a prebuilt CJS compiler
 *    and `import` to `src/compiler`, and only the latter goes through the
 *    installed esrap. Reaching for `createRequire` here (as `loadSvelteCompiler`
 *    does) compiles with a different printer than the browser ever sees, and
 *    the guard passes while the product is broken. That is not hypothetical:
 *    the first draft of this suite did exactly that and reported green.
 */

import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { buildPropsScriptV2 } from '../skill/scripts/live/svelte-ast.mjs';
import { scaffoldSvelteComponentSession } from '../skill/scripts/live/svelte-component.mjs';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let compile;
let acornParse;
let svelteVersion;
let printerVersion;

before(async () => {
  // ESM import, not createRequire: see note 2 in the header. This is the build
  // a Vite dev server loads, and the only one that uses the installed esrap.
  const compiler = await import('svelte/compiler');
  compile = compiler.compile;
  svelteVersion = compiler.VERSION;
  acornParse = require('acorn').parse;
  try {
    printerVersion = require('esrap/package.json').version;
  } catch {
    printerVersion = 'unknown';
  }
});

function assertEmittedJsParses(svelteSource, label) {
  const { js } = compile(svelteSource, {
    generate: 'client',
    // dev:true is what a dev server uses, and it is the mode that carries the
    // defect: the extra location metadata is where the stray annotation lands.
    dev: true,
    filename: 'v1.svelte',
  });
  try {
    acornParse(js.code, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (err) {
    const line = js.code.split('\n')[(err.loc?.line ?? 1) - 1] || '';
    assert.fail(
      `${label}: svelte ${svelteVersion} (printer esrap ${printerVersion}) emitted JavaScript that does not parse.\n`
      + `  ${err.message}\n`
      + `  offending line: ${line.trim()}\n`
      + `  The browser reports this as a mount failure, not as a compile error, `
      + `because the .svelte source is valid and only the emitted module is not.\n`
      + `  source:\n${svelteSource}`,
    );
  }
}

describe('scaffolded props scripts emit parseable JavaScript', () => {
  // The empty contract is the shape the CI fixture hit: a picked element with
  // no dynamic values at all.
  const CONTRACTS = {
    'no props': [],
    'one text prop': [{ prop: 'title', expr: 'title', kind: 'text' }],
    'every prop kind': [
      { prop: 'title', expr: 'title', kind: 'text' },
      { prop: 'body', expr: 'post.body', kind: 'raw' },
      { prop: 'isOpen', expr: 'open', kind: 'condition' },
      { prop: 'items', expr: 'stages', kind: 'collection' },
      { prop: 'onSelect', expr: 'select', kind: 'handler' },
    ],
  };

  for (const [label, contract] of Object.entries(CONTRACTS)) {
    it(`buildPropsScriptV2: ${label}`, () => {
      const source = `${buildPropsScriptV2(contract)}\n<h1 class="hero-title">Fixture</h1>\n`;
      assertEmittedJsParses(source, `buildPropsScriptV2 (${label})`);
    });
  }

  // Deliberately NOT asserted here: that the old `@type` shape still breaks.
  // Whether it breaks depends on the installed printer (esrap 2.3.3 yes, 2.3.2
  // no), and this repo's lockfile carries a good one while a fresh fixture
  // install pulls the bad one. An assertion that upstream is still broken would
  // fail in this repo and pass in CI, which is the wrong way round for a guard.
  // The live-e2e suite installs fresh and is where the real printer gets
  // exercised; these cases pin what we emit, on whatever printer is present.
});

describe('the real scaffolder writes variants that parse', () => {
  let scratch;

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-svelte-scaffold-'));
    fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ name: 'app', type: 'module' }));
    // Only `svelte` is linked, into a node_modules this workspace owns.
    // Symlinking the whole directory pointed `node_modules/.impeccable-live` at
    // the REPO's node_modules, so the scaffolder wrote its variants there:
    // afterEach cleaned the temp dir and left them behind, the next case reused
    // the session id, and a stale variant could be parsed against a fresh
    // manifest. Svelte's own dependencies still resolve, because node follows
    // the link to its real path before looking for them.
    fs.mkdirSync(path.join(scratch, 'node_modules'), { recursive: true });
    fs.symlinkSync(
      path.join(REPO_ROOT, 'node_modules', 'svelte'),
      path.join(scratch, 'node_modules', 'svelte'),
      'dir',
    );
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  const CASES = {
    'static markup (the #580 shape)': ['<h1 class="hero-title">Vite 8 + SvelteKit Fixture</h1>'],
    'markup with a free expression': ['<h1 class="hero-title">{headline}</h1>'],
  };

  let caseIndex = 0;
  for (const [label, originalLines] of Object.entries(CASES)) {
    it(label, () => {
      // Distinct per case as well: an id shared across cases is only safe while
      // the output directory is genuinely per-case, and that coupling is the
      // kind that quietly breaks again.
      const sessionId = `testsession${caseIndex++}`;
      const result = scaffoldSvelteComponentSession({
        id: sessionId,
        count: 3,
        sourceFile: 'src/routes/+page.svelte',
        sourceStartLine: 1,
        sourceEndLine: originalLines.length,
        originalLines,
        cwd: scratch,
      });
      assert.equal(result.fallback, undefined, `scaffold fell back: ${result.reason}`);

      const dir = path.join(scratch, 'node_modules', '.impeccable-live', sessionId);
      const variants = fs.readdirSync(dir).filter((name) => /^v\d+\.svelte$/.test(name));
      assert.ok(variants.length > 0, 'scaffolder wrote no variant files');

      for (const name of variants) {
        assertEmittedJsParses(fs.readFileSync(path.join(dir, name), 'utf-8'), `${label} / ${name}`);
      }
    });
  }
});
