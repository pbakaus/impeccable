import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  compileCheckVariants,
  extractMatchingSourceCss,
  removeSelectorsFromSvelteSource,
  findSvelteComponentManifest,
  inlineSvelteComponentAccept,
  mergeCssIntoSvelteSource,
  reindentPreservingStructure,
  scaffoldSvelteComponentSession,
} from '../skill/scripts/live/svelte-component.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_NODE_MODULES = join(__dirname, '..', 'node_modules');
const ACCEPT = resolve(__dirname, '..', 'skill/scripts/live-accept.mjs');

const ROUTE_SOURCE = `<script>
  let stages = [
    { label: 'Review', detail: 'Bots comment', active: true },
    { label: 'Resolve', detail: 'Agent fixes', active: false },
  ];
  let footerNote = 'All quiet.';
</script>

<main>
  <ol class="pit-board">
    {#each stages as stage, i}
      <li class="stage">
        <span class="label">{stage.label}</span>
        <p class="detail">{stage.detail}</p>
      </li>
    {/each}
  </ol>
  <p class="footer">{footerNote}</p>
</main>

<style>
  .pit-board {
    border-top: 1px solid #333;
    display: flex;
  }
  .stage { padding: 8px; }
  .footer { color: gray; }
</style>
`;

function write(root, rel, content) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function runAccept(cwd, args) {
  const output = execFileSync(process.execPath, [ACCEPT, ...args], {
    cwd,
    encoding: 'utf-8',
  });
  return JSON.parse(output.trim());
}

describe('svelte component scaffold + accept pipeline', () => {
  let tmp;

  beforeEach(() => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-svelte-accept-')));
    // The scaffolder resolves the app's svelte compiler; link this repo's.
    mkdirSync(join(tmp, 'node_modules'), { recursive: true });
    try {
      symlinkSync(join(REPO_NODE_MODULES, 'svelte'), join(tmp, 'node_modules', 'svelte'), 'dir');
    } catch {
      cpSync(join(REPO_NODE_MODULES, 'svelte'), join(tmp, 'node_modules', 'svelte'), { recursive: true });
    }
    write(tmp, 'package.json', JSON.stringify({ name: 'app', dependencies: { svelte: '^5' } }));
    write(tmp, 'src/routes/+page.svelte', ROUTE_SOURCE);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function scaffold(id = 'testacc1') {
    // The picked element spans the <ol> block: lines 10-17 (1-indexed).
    const originalLines = ROUTE_SOURCE.split('\n').slice(9, 17);
    assert.match(originalLines[0], /<ol/);
    assert.match(originalLines[originalLines.length - 1], /<\/ol>/);
    return scaffoldSvelteComponentSession({
      id,
      count: 2,
      sourceFile: 'src/routes/+page.svelte',
      sourceStartLine: 10,
      sourceEndLine: 17,
      originalLines,
      cwd: tmp,
    });
  }

  it('scaffolds a v2 contract with the each collection as one structured prop', () => {
    const session = scaffold();
    assert.equal(session.fallback, undefined);
    assert.equal(session.manifest.contractVersion, 2);
    const collection = session.propContract.find((c) => c.kind === 'collection');
    assert.equal(collection.prop, 'stages');
    assert.equal(collection.item.rootTag, 'li');
    const v1 = readFileSync(join(tmp, session.componentDir, 'v1.svelte'), 'utf-8');
    assert.match(v1, /\{#each stages as stage, i\}/);
    assert.match(v1, /\{stage\.label\}/);
    assert.match(v1, /let \{ stages = \[\] \} = \$props\(\)/);
    // Stub CSS is seeded from the route's matching rules.
    assert.match(v1, /border-top: 1px solid #333/);
  });

  it('accepts a Svelte component session through the CLI', () => {
    const session = scaffold('cliacc1');
    write(tmp, join(session.componentDir, 'v1.svelte'), `<script>
  let { stages = [] } = $props();
</script>

<ol class="accepted-board">
  {#each stages as stage, i}
    <li class="stage">
      <span class="label">{stage.label}</span>
      <p class="detail">{stage.detail}</p>
    </li>
  {/each}
</ol>

<style>
  .accepted-board { display: grid; }
</style>
`);

    const result = runAccept(tmp, ['--id', 'cliacc1', '--variant', '1']);
    assert.equal(result.handled, true, result.error);
    assert.equal(result.file, 'src/routes/+page.svelte');
    assert.equal(result.previewMode, 'svelte-component');
    assert.equal(result.componentDir, session.componentDir);
    assert.match(readFileSync(join(tmp, result.file), 'utf-8'), /class="[^"]*\baccepted-board\b/);
    assert.equal(findSvelteComponentManifest('cliacc1', tmp), null);
  });

  it('discards a Svelte component session through the CLI', () => {
    const session = scaffold('clidisc1');

    const result = runAccept(tmp, ['--id', 'clidisc1', '--discard']);
    assert.deepEqual(result, {
      handled: true,
      file: 'src/routes/+page.svelte',
      carbonize: false,
      previewMode: 'svelte-component',
      componentDir: session.componentDir,
    });
    assert.equal(readFileSync(join(tmp, result.file), 'utf-8'), ROUTE_SOURCE);
    assert.equal(findSvelteComponentManifest('clidisc1', tmp), null);
  });

  it('falls back to source-preview for markup with component tags', () => {
    const res = scaffoldSvelteComponentSession({
      id: 'fallb1',
      count: 3,
      sourceFile: 'src/routes/+page.svelte',
      sourceStartLine: 1,
      sourceEndLine: 1,
      originalLines: ['<Card title={x} />'],
      cwd: tmp,
    });
    assert.equal(res.fallback, 'source-preview');
    assert.match(res.reason, /component tag/);
  });

  it('accept merges CSS instead of appending: superseded rules are replaced, dead branches pruned', () => {
    const session = scaffold('acc2');
    // Agent authors variant 1: arrows instead of divider borders, one param.
    write(tmp, join(session.componentDir, 'v1.svelte'), `<script>
  /** @type {{ stages?: Array<Record<string, unknown>> }} */
  let { stages = [] } = $props();
</script>

<ol class="pit-board">
  {#each stages as stage, i}
    <li class="stage">
      <span class="label">{stage.label}</span>
      <p class="detail">{stage.detail}</p>
    </li>
  {/each}
</ol>

<style>
  .pit-board {
    display: flex;
    clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%);
  }
  .stage { padding: calc(var(--p-depth, 6px) + 2px); }
  :global([data-p-density="airy"]) .stage { margin: 16px; }
  :global([data-p-density="snug"]) .stage { margin: 4px; }
</style>
`);
    write(tmp, join(session.componentDir, 'params.json'), JSON.stringify({
      1: [
        { id: 'depth', kind: 'range', min: 0, max: 20, step: 1, default: 6, label: 'Depth' },
        { id: 'density', kind: 'steps', default: 'airy', label: 'Density', options: [
          { value: 'airy', label: 'Airy' }, { value: 'snug', label: 'Snug' },
        ] },
      ],
    }));

    const manifest = findSvelteComponentManifest('acc2', tmp);
    const result = inlineSvelteComponentAccept(manifest, 1, { depth: 10, density: 'snug' }, tmp);
    assert.equal(result.handled, true, result.error);

    const out = readFileSync(join(tmp, 'src/routes/+page.svelte'), 'utf-8');
    // Loop restored with original expressions, one each block only.
    assert.equal(out.split('{#each stages as stage, i}').length - 1, 1);
    // Superseded divider border is GONE (replaced, not shadowed).
    assert.doesNotMatch(out, /border-top: 1px solid #333/);
    assert.match(out, /clip-path/);
    // Exactly one .pit-board rule.
    assert.equal(out.split('.pit-board {').length - 1, 1);
    // Range baked with paren-aware substitution.
    assert.match(out, /padding: calc\(10 \+ 2px\)/);
    // Steps: chosen branch folded into the .stage rule, other branch dropped,
    // no data-p attributes anywhere.
    assert.match(out, /margin: 4px/);
    assert.equal(out.split(/\.stage \{/).length - 1, 1);
    assert.doesNotMatch(out, /margin: 16px/);
    assert.doesNotMatch(out, /data-p-/);
    assert.doesNotMatch(out, /var\(--p-/);
    // The untouched .footer rule survives.
    assert.match(out, /\.footer \{ color: gray; \}/);
    // Self-check reports clean.
    assert.equal(result.verify.clean, true, JSON.stringify(result.verify.findings));
  });

  it('preserves the variant markup indentation structure', () => {
    const session = scaffold('acc3');
    write(tmp, join(session.componentDir, 'v1.svelte'), `<script>
  let { stages = [] } = $props();
</script>

<ol class="pit-board">
  {#each stages as stage, i}
    <li class="stage">
      <div class="deep">
        <span class="label">{stage.label}</span>
      </div>
    </li>
  {/each}
</ol>

<style>
  .deep { display: block; }
</style>
`);
    const manifest = findSvelteComponentManifest('acc3', tmp);
    const result = inlineSvelteComponentAccept(manifest, 1, null, tmp);
    assert.equal(result.handled, true, result.error);
    const out = readFileSync(join(tmp, 'src/routes/+page.svelte'), 'utf-8');
    const lines = out.split('\n');
    const deepIdx = lines.findIndex((l) => l.includes('<div class="deep">'));
    const labelIdx = lines.findIndex((l) => l.includes('span class="label"'));
    const deepIndent = lines[deepIdx].match(/^\s*/)[0].length;
    const labelIndent = lines[labelIdx].match(/^\s*/)[0].length;
    // Nested structure survives: label sits deeper than its parent div.
    assert.equal(labelIndent > deepIndent, true, `expected nesting, got ${deepIndent} vs ${labelIndent}`);
  });

  it('reindentPreservingStructure keeps relative depth', () => {
    const out = reindentPreservingStructure(['  <a>', '    <b>', '  </a>'], '      ');
    assert.deepEqual(out, ['      <a>', '        <b>', '      </a>']);
  });

  it('mergeCssIntoSvelteSource creates a style block when none exists', () => {
    const { text } = mergeCssIntoSvelteSource('<div class="x">hi</div>', '.x { color: red; }');
    assert.match(text, /<style>\n\s+\.x \{ color: red; \}\n<\/style>/);
  });

  it('extractMatchingSourceCss picks only rules that style the selection', () => {
    const { css } = extractMatchingSourceCss(ROUTE_SOURCE, '<ol class="pit-board"><li class="stage">x</li></ol>');
    assert.match(css, /\.pit-board/);
    assert.match(css, /\.stage/);
    assert.doesNotMatch(css, /\.footer/);
  });

  it('class matching is token-bounded, never substring', () => {
    // The field hazard: a falsely seeded selector becomes an accept-time
    // DELETION of a hand-written rule the pick never used.
    const route = `<style>
  .btn { color: red; }
  .btn-primary { color: blue; }
  .stage { padding: 4px; }
  .stages { display: grid; }
</style>`;
    const { css, supersedable } = extractMatchingSourceCss(route, '<button class="btn"><span class="stage">x</span></button>');
    assert.match(css, /\.btn \{/);
    assert.match(css, /\.stage \{/);
    assert.doesNotMatch(css, /btn-primary/, '.btn must not seed .btn-primary');
    assert.doesNotMatch(css, /\.stages/, '.stage must not seed .stages');
    assert.deepEqual([...supersedable].sort(), ['.btn', '.stage']);
  });

  it('tag rules seed the preview but are never supersedable', () => {
    const route = `<style>
  h1 { font-size: 3rem; }
  h1.hero { letter-spacing: -0.02em; }
  p { line-height: 1.6; }
  .sidebar { width: 20rem; }
</style>`;
    const { css, supersedable } = extractMatchingSourceCss(route, '<h1 class="hero">Title</h1>');
    assert.match(css, /h1 \{ font-size/, 'bare tag rules that style the pick are seeded');
    assert.match(css, /h1\.hero/, 'class rules still seed');
    assert.doesNotMatch(css, /^p \{/m, 'unrelated tags are not seeded');
    assert.doesNotMatch(css, /\.sidebar/);
    assert.deepEqual([...supersedable], ['h1.hero'], 'only class-matched selectors may be removed on accept');
  });
});

describe('review regressions: preview-truth supersession (the Pitch mangle)', () => {
  const PITCH_SOURCE = `<script>
  let verdicts = [
    { label: 'True positive', detail: 'Fix it' },
    { label: 'False positive', detail: 'Dismiss it' },
  ];
</script>

<section class="pitch">
  <div class="decisions">
    {#each verdicts as verdict}
      <div class="cell">
        <h3>{verdict.label}</h3>
        <p>{verdict.detail}</p>
      </div>
    {/each}
  </div>
</section>

<style>
  .pitch { padding: 40px; }
  .decisions {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .decisions > .cell { border: 1px solid #333; }
  @media (max-width: 700px) {
    .decisions { grid-template-columns: 1fr; }
    .pitch { padding: 16px; }
  }
</style>
`;

  it('removes seeded rules the variant did not re-declare and orders new base rules before media blocks', () => {
    const tmp2 = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-pitch-mangle-')));
    try {
      mkdirSync(join(tmp2, 'node_modules'), { recursive: true });
      try {
        symlinkSync(join(REPO_NODE_MODULES, 'svelte'), join(tmp2, 'node_modules', 'svelte'), 'dir');
      } catch {
        cpSync(join(REPO_NODE_MODULES, 'svelte'), join(tmp2, 'node_modules', 'svelte'), { recursive: true });
      }
      write(tmp2, 'package.json', JSON.stringify({ name: 'app' }));
      write(tmp2, 'src/lib/Pitch.svelte', PITCH_SOURCE);

      // Picked element: the .decisions block (lines 10-17, 1-indexed).
      const lines = PITCH_SOURCE.split('\n');
      const startLine = lines.findIndex((l) => l.includes('class="decisions"')) + 1;
      const endLine = lines.findIndex((l, i) => i >= startLine && l.trim() === '</div>' && lines[i + 1]?.includes('</section>')) + 1;
      const originalLines = lines.slice(startLine - 1, endLine);

      const session = scaffoldSvelteComponentSession({
        id: 'pitchm1',
        count: 1,
        sourceFile: 'src/lib/Pitch.svelte',
        sourceStartLine: startLine,
        sourceEndLine: endLine,
        originalLines,
        cwd: tmp2,
      });
      assert.equal(session.fallback, undefined, session.reason);
      // Seeded selectors recorded for accept-time supersession.
      assert.equal(session.manifest.seededSelectors.includes('.decisions'), true);

      // The agent's variant: a NEW class, no re-declaration of .decisions.
      write(tmp2, join(session.componentDir, 'v1.svelte'), `<script>
  let { verdicts = [] } = $props();
</script>

<div class="disposition-board">
  {#each verdicts as verdict}
    <div class="lane">
      <h3>{verdict.label}</h3>
      <p>{verdict.detail}</p>
    </div>
  {/each}
</div>

<style>
  .disposition-board { display: flex; flex-direction: column; gap: 8px; }
  .disposition-board .lane { border-left: 3px solid #7df; padding: 8px 12px; }
  @media (max-width: 700px) {
    .disposition-board .lane { padding: 6px 8px; }
  }
</style>
`);
      const manifest = findSvelteComponentManifest('pitchm1', tmp2);
      const result = inlineSvelteComponentAccept(manifest, 1, null, tmp2);
      assert.equal(result.handled, true, result.error);
      const out = readFileSync(join(tmp2, 'src/lib/Pitch.svelte'), 'utf-8');

      // The superseded grid rules are GONE: they never applied in the
      // preview the user approved, and the root keeps the old class.
      assert.doesNotMatch(out, /grid-template-columns: repeat\(3, 1fr\)/);
      assert.doesNotMatch(out, /\.decisions > \.cell/);
      assert.equal(result.css.superseded.includes('.decisions'), true);
      // The untouched sibling rule survives.
      assert.match(out, /\.pitch \{ padding: 40px; \}/);
      // Source media block survives for the surviving class...
      assert.match(out, /\.pitch \{ padding: 16px; \}/);
      // ...and no longer carries the superseded selector.
      assert.doesNotMatch(out, /\.decisions \{ grid-template-columns: 1fr; \}/);
      // New base rules sit BEFORE the source's @media block (cascade order).
      const baseIdx = out.indexOf('.disposition-board {');
      const mediaIdx = out.indexOf('@media (max-width: 700px)');
      assert.equal(baseIdx > -1 && mediaIdx > -1 && baseIdx < mediaIdx, true,
        `expected base rules before media, got base@${baseIdx} media@${mediaIdx}`);
      assert.equal(result.verify.clean, true, JSON.stringify(result.verify.findings));
    } finally {
      rmSync(tmp2, { recursive: true, force: true });
    }
  });

  it('keeps seeded rules the variant re-declares', () => {
    const { text, removed } = removeSelectorsFromSvelteSource('<div class="a">x</div>\n<style>\n  .a { color: red; }\n  .b { color: blue; }\n</style>', new Set(['.b']));
    assert.match(text, /\.a \{ color: red; \}/);
    assert.doesNotMatch(text, /color: blue/);
    assert.deepEqual(removed, ['.b']);
  });
});

describe('review regressions: publish-time compile gate', () => {
  it('flags a variant with a duplicate top-level style block, passes after the fix', () => {
    const tmp3 = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-compile-gate-')));
    try {
      mkdirSync(join(tmp3, 'node_modules'), { recursive: true });
      try {
        symlinkSync(join(REPO_NODE_MODULES, 'svelte'), join(tmp3, 'node_modules', 'svelte'), 'dir');
      } catch {
        cpSync(join(REPO_NODE_MODULES, 'svelte'), join(tmp3, 'node_modules', 'svelte'), { recursive: true });
      }
      write(tmp3, 'package.json', JSON.stringify({ name: 'app' }));
      write(tmp3, 'src/routes/+page.svelte', '<main>\n  <div class="pick">hi</div>\n</main>\n');

      const session = scaffoldSvelteComponentSession({
        id: 'gate0001',
        count: 1,
        sourceFile: 'src/routes/+page.svelte',
        sourceStartLine: 2,
        sourceEndLine: 2,
        originalLines: ['  <div class="pick">hi</div>'],
        cwd: tmp3,
      });
      assert.equal(session.fallback, undefined, session.reason);

      // The exact field failure: the agent kept the seeded block and
      // appended its own second top-level <style>.
      write(tmp3, join(session.componentDir, 'v1.svelte'), `<script>
  let {} = $props();
</script>

<div class="pick board">hi</div>

<style>
  .pick { color: red; }
</style>

<style>
  .board { margin-top: 86px; }
</style>
`);
      const broken = compileCheckVariants('gate0001', tmp3);
      assert.equal(broken.ok, false);
      assert.equal(broken.checked, 1);
      assert.match(broken.failures[0].message, /single top-level/);
      assert.match(broken.failures[0].file, /gate0001\/v1\.svelte/);
      assert.equal(typeof broken.failures[0].line, 'number');

      // Merged into one block: the gate opens.
      write(tmp3, join(session.componentDir, 'v1.svelte'), `<script>
  let {} = $props();
</script>

<div class="pick board">hi</div>

<style>
  .pick { color: red; }
  .board { margin-top: 86px; }
</style>
`);
      const fixed = compileCheckVariants('gate0001', tmp3);
      assert.equal(fixed.ok, true, JSON.stringify(fixed.failures));
    } finally {
      rmSync(tmp3, { recursive: true, force: true });
    }
  });
});

describe('review regressions: shared-class supersession guard', () => {
  const SHARED_SOURCE = `<script>
  let items = [{ name: 'a' }, { name: 'b' }];
</script>

<section class="page">
  <div class="card intro">Intro copy stays here.</div>
  <ul class="list">
    {#each items as item}
      <li class="card">{item.name}</li>
    {/each}
  </ul>
</section>

<style>
  .page { padding: 24px; }
  .card { border: 1px solid #999; border-radius: 8px; }
  .list { display: grid; gap: 8px; }
</style>
`;

  it('keeps a superseded selector whose class is still used outside the replaced region', () => {
    const tmp4 = realpathSync(mkdtempSync(join(tmpdir(), 'impeccable-shared-class-')));
    try {
      mkdirSync(join(tmp4, 'node_modules'), { recursive: true });
      try {
        symlinkSync(join(REPO_NODE_MODULES, 'svelte'), join(tmp4, 'node_modules', 'svelte'), 'dir');
      } catch {
        cpSync(join(REPO_NODE_MODULES, 'svelte'), join(tmp4, 'node_modules', 'svelte'), { recursive: true });
      }
      write(tmp4, 'package.json', JSON.stringify({ name: 'app' }));
      write(tmp4, 'src/lib/Shared.svelte', SHARED_SOURCE);

      // Pick the <ul class="list"> block. Its items use .card, and so does
      // the intro div OUTSIDE the pick.
      const lines = SHARED_SOURCE.split('\n');
      const startLine = lines.findIndex((l) => l.includes('class="list"')) + 1;
      const endLine = lines.findIndex((l) => l.trim() === '</ul>') + 1;
      const originalLines = lines.slice(startLine - 1, endLine);

      const session = scaffoldSvelteComponentSession({
        id: 'shared01',
        count: 1,
        sourceFile: 'src/lib/Shared.svelte',
        sourceStartLine: startLine,
        sourceEndLine: endLine,
        originalLines,
        cwd: tmp4,
      });
      assert.equal(session.fallback, undefined, session.reason);
      assert.equal(session.manifest.seededSelectors.includes('.card'), true, 'the pick uses .card, so it seeds');

      // The variant re-declares .list but NOT .card.
      write(tmp4, join(session.componentDir, 'v1.svelte'), `<script>
  let { items = [] } = $props();
</script>

<ul class="list">
  {#each items as item}
    <li class="card">{item.name}</li>
  {/each}
</ul>

<style>
  .list { display: flex; flex-direction: column; gap: 12px; }
</style>
`);
      const manifest = findSvelteComponentManifest('shared01', tmp4);
      const result = inlineSvelteComponentAccept(manifest, 1, null, tmp4);
      assert.equal(result.handled, true, result.error);
      const out = readFileSync(join(tmp4, 'src/lib/Shared.svelte'), 'utf-8');

      // .card is shared with the intro div outside the replaced region:
      // removing it would strip styling from markup this accept never
      // touched, so it must survive despite not being re-declared.
      assert.match(out, /\.card \{ border: 1px solid #999; border-radius: 8px; \}/);
      assert.equal(result.css.superseded.includes('.card'), false);
      // The re-declared .list took the variant's shape.
      assert.match(out, /\.list \{ display: flex/);
    } finally {
      rmSync(tmp4, { recursive: true, force: true });
    }
  });
});
