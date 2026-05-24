import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { applyManualEditBatchToSource, htmlToJsx, normalizeVariantOutput } from './live-e2e/agent.mjs';

describe('live-e2e agent output translation', () => {
  it('converts HTML class and inline style attributes to JSX syntax', () => {
    const jsx = htmlToJsx(
      '<h1 class="hero-title" style="--p-scale:1; font-size:2.25rem; font-weight:700">Title</h1>',
    );

    assert.equal(
      jsx,
      '<h1 className="hero-title" style={{ "--p-scale": "1", fontSize: "2.25rem", fontWeight: "700" }}>Title</h1>',
    );
  });

  it('camel-cases vendor-prefixed style properties', () => {
    const jsx = htmlToJsx(
      '<h1 class="hero-title" style="-webkit-background-clip:text; background-clip:text; color:transparent">Title</h1>',
    );

    assert.equal(
      jsx,
      '<h1 className="hero-title" style={{ WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Title</h1>',
    );
  });

  it('keeps semicolons inside quoted and parenthesized style values', () => {
    const jsx = htmlToJsx(
      `<h1 class="hero-title" style='content:"a;b"; background-image:url("foo;bar"); font-size:1rem'>Title</h1>`,
    );

    assert.equal(
      jsx,
      `<h1 className="hero-title" style={{ content: "\\"a;b\\"", backgroundImage: "url(\\"foo;bar\\")", fontSize: "1rem" }}>Title</h1>`,
    );
  });

  it('does not rewrite class inside data-class attributes', () => {
    const jsx = htmlToJsx('<h1 data-class="hero" class="hero-title">Title</h1>');

    assert.equal(jsx, '<h1 data-class="hero" className="hero-title">Title</h1>');
  });

  it('self-closes HTML void elements for JSX output', () => {
    const jsx = htmlToJsx('<h1 class="hero-title">React<br>Manual<img src="/hero.png" alt="a > b"></h1>');

    assert.equal(
      jsx,
      '<h1 className="hero-title">React<br />Manual<img src="/hero.png" alt="a > b" /></h1>',
    );
  });

  it('hoists model inline styles into variant-scoped CSS', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: '',
        variants: [
          {
            innerHtml: '<h1 class="hero-title" style="color:red; font-weight:700">Title</h1>',
          },
          {
            innerHtml: `<h1 class="hero-title" style='content:"a;b"; background-image:url("foo;bar")'>Title</h1>`,
          },
        ],
      },
      { styleMode: 'scoped' },
    );

    assert.equal(
      output.variants[0].innerHtml,
      '<h1 data-impeccable-hoist-id="1" class="hero-title">Title</h1>',
    );
    assert.equal(
      output.variants[1].innerHtml,
      '<h1 data-impeccable-hoist-id="1" class="hero-title">Title</h1>',
    );
    assert.match(output.scopedCss, /@scope \(\[data-impeccable-variant="1"\]\)/);
    assert.match(output.scopedCss, /:scope \[data-impeccable-hoist-id="1"\]\s*\{/);
    assert.match(output.scopedCss, /color: red;/);
    assert.match(output.scopedCss, /font-weight: 700;/);
    assert.match(output.scopedCss, /content: "a;b";/);
    assert.match(output.scopedCss, /background-image: url\("foo;bar"\);/);
  });

  it('hoists styles split across multiple lines', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: '',
        variants: [
          {
            innerHtml: '<h1 class="hero-title" style="\n  color: red;\n  font-size: 2rem;\n">Title</h1>',
          },
        ],
      },
      { styleMode: 'scoped' },
    );

    assert.equal(
      output.variants[0].innerHtml,
      '<h1 data-impeccable-hoist-id="1" class="hero-title">Title</h1>',
    );
    assert.match(output.scopedCss, /color: red;/);
    assert.match(output.scopedCss, /font-size: 2rem;/);
  });

  it('binds hoisted rules to the element the style was on, not the variant root', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: '',
        variants: [
          {
            innerHtml: '<h1 class="hero-title"><span style="color:red; transform:scale(1.1)">Title</span></h1>',
          },
        ],
      },
      { styleMode: 'scoped' },
    );

    assert.equal(
      output.variants[0].innerHtml,
      '<h1 class="hero-title"><span data-impeccable-hoist-id="1">Title</span></h1>',
    );
    assert.match(output.scopedCss, /:scope \[data-impeccable-hoist-id="1"\]\s*\{/);
    assert.match(output.scopedCss, /color: red;/);
    assert.match(output.scopedCss, /transform: scale\(1\.1\);/);
  });

  it('emits a separate rule per styled element inside one variant', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: '',
        variants: [
          {
            innerHtml: '<h1 style="color:red"><span style="font-weight:700">Title</span></h1>',
          },
        ],
      },
      { styleMode: 'scoped' },
    );

    assert.match(output.scopedCss, /:scope \[data-impeccable-hoist-id="1"\]\s*\{[^}]*color: red;/);
    assert.match(output.scopedCss, /:scope \[data-impeccable-hoist-id="2"\]\s*\{[^}]*font-weight: 700;/);
  });

  it('targets only the styled element when same-tag siblings are present', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: '',
        variants: [
          {
            innerHtml: '<div><span>plain</span><span style="color:red">styled</span></div>',
          },
        ],
      },
      { styleMode: 'scoped' },
    );

    const hoistMatches = output.variants[0].innerHtml.match(/data-impeccable-hoist-id=/g) || [];
    assert.equal(hoistMatches.length, 1, 'only the styled span should carry the hoist attribute');
    assert.match(
      output.variants[0].innerHtml,
      /<span data-impeccable-hoist-id="1">styled<\/span>/,
    );
    assert.match(output.variants[0].innerHtml, /<span>plain<\/span>/);
    assert.match(output.scopedCss, /:scope \[data-impeccable-hoist-id="1"\]\s*\{[^}]*color: red;/);
  });

  it('handles > inside a quoted attribute value without losing the style', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: '',
        variants: [
          {
            innerHtml: '<h1 aria-label="x > y" style="color:red">Title</h1>',
          },
        ],
      },
      { styleMode: 'scoped' },
    );

    assert.match(output.variants[0].innerHtml, /aria-label="x > y"/);
    assert.match(output.variants[0].innerHtml, /data-impeccable-hoist-id="1"/);
    assert.doesNotMatch(output.variants[0].innerHtml, /style=/);
    assert.match(output.scopedCss, /color: red;/);
  });

  it('emits the astro-global-prefixed selector shape when styleMode requests it', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: '',
        variants: [
          { innerHtml: '<h1 style="color:red">Title</h1>' },
        ],
      },
      { styleMode: 'astro-global-prefixed' },
    );

    assert.match(
      output.scopedCss,
      /\[data-impeccable-variant="1"\] \[data-impeccable-hoist-id="1"\] \{/,
    );
    assert.doesNotMatch(output.scopedCss, /@scope/);
  });

  it('fills missing base variant rules when a model emits only param-conditioned CSS', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: [
          '@scope ([data-impeccable-variant="1"]) { :scope > h1 { color: blue; } }',
          '@scope ([data-impeccable-variant="2"][data-p-uppercase]) { :scope > h1 { text-transform: uppercase; } }',
        ].join('\n'),
        variants: [
          { innerHtml: '<h1 class="hero-title">One</h1>' },
          { innerHtml: '<h1 class="hero-title">Two</h1>' },
        ],
      },
      { styleMode: 'scoped' },
    );

    assert.match(output.scopedCss, /@scope \(\[data-impeccable-variant="2"\]\)/);
    assert.match(output.scopedCss, /--impeccable-variant-ready: 1;/);
    assert.match(output.scopedCss, /@scope \(\[data-impeccable-variant="2"\]\[data-p-uppercase\]\)/);
  });

  it('normalizes model-emitted variant selector quotes to the live.md shape', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: [
          "@scope ([data-impeccable-variant='1']) { :scope > h1 { color: blue; } }",
          "[data-impeccable-variant='2'] > h1 { color: red; }",
        ].join('\n'),
        variants: [
          { innerHtml: '<h1 class="hero-title">One</h1>' },
          { innerHtml: '<h1 class="hero-title">Two</h1>' },
        ],
      },
      { styleMode: 'scoped' },
    );

    assert.match(output.scopedCss, /@scope \(\[data-impeccable-variant="1"\]\)/);
    assert.match(output.scopedCss, /\[data-impeccable-variant="2"\] > h1/);
    assert.doesNotMatch(output.scopedCss, /data-impeccable-variant='/);
  });

  it('returns the original output untouched when no inline styles are present', () => {
    const original = {
      scopedCss: '@scope ([data-impeccable-variant="1"]) { :scope > h1 { color: blue; } }',
      variants: [{ innerHtml: '<h1 class="hero-title">Title</h1>' }],
    };
    const result = normalizeVariantOutput(original, { styleMode: 'scoped' });
    assert.equal(result, original);
  });

});

describe('live-e2e fake manual edit apply', () => {
  it('applies a sourceHint-backed staged edit to source', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-apply-source-hint-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'src/App.jsx'), '<h1>Old title</h1>\n');

      const result = await applyManualEditBatchToSource({
        entries: [
          {
            id: 'cafebabe',
            ops: [
              {
                ref: 'body>h1',
                originalText: 'Old title',
                newText: 'New title',
                sourceHint: { file: 'src/App.jsx', line: 1 },
              },
            ],
          },
        ],
        candidates: [],
      }, { tmp });

      assert.equal(result.status, 'done');
      assert.deepEqual(result.appliedEntryIds, ['cafebabe']);
      assert.deepEqual(result.files, ['src/App.jsx']);
      assert.match(fs.readFileSync(path.join(tmp, 'src/App.jsx'), 'utf-8'), /New title/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('prefers the exact sourceHint line when duplicate text appears nearby', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-apply-source-hint-duplicate-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, 'src/page.astro'),
        [
          '<Layout title="Old title">',
          '  <main>',
          '    <h1>Old title</h1>',
          '  </main>',
          '</Layout>',
          '',
        ].join('\n'),
      );

      const result = await applyManualEditBatchToSource({
        entries: [
          {
            id: 'duplicate',
            ops: [
              {
                ref: 'body>main>h1',
                originalText: 'Old title',
                newText: 'New heading',
                sourceHint: { file: 'src/page.astro', line: 3 },
              },
            ],
          },
        ],
        candidates: [],
      }, { tmp });

      const body = fs.readFileSync(path.join(tmp, 'src/page.astro'), 'utf-8');
      assert.equal(result.status, 'done');
      assert.match(body, /<Layout title="Old title">/);
      assert.match(body, /<h1>New heading<\/h1>/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('uses candidate text matches when no sourceHint is present', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-apply-candidate-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'src/App.jsx'), "const title = 'Beta card';\n");

      const result = await applyManualEditBatchToSource({
        entries: [
          {
            id: 'feedface',
            ops: [
              {
                ref: 'body>article:nth-of-type(2)>h1',
                originalText: 'Beta card',
                newText: 'Beta card edited',
              },
            ],
          },
        ],
        candidates: [
          {
            entryId: 'feedface',
            ref: 'body>article:nth-of-type(2)>h1',
            textMatches: [{ file: 'src/App.jsx', line: 1, kind: 'text_match' }],
          },
        ],
      }, { tmp });

      assert.equal(result.status, 'done');
      assert.match(fs.readFileSync(path.join(tmp, 'src/App.jsx'), 'utf-8'), /Beta card edited/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('expands integer-backed display copy without coercing the numeric model', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-apply-typed-display-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, 'src/App.jsx'),
        [
          'const workshopStats = { seats: 7 };',
          '',
          'export default function App() {',
          '  return <span className="capacity-count">{String(workshopStats.seats)}</span>;',
          '}',
          '',
        ].join('\n'),
      );

      const result = await applyManualEditBatchToSource({
        entries: [
          {
            id: 'typed-display',
            ops: [
              {
                ref: 'body>main>span.capacity-count',
                tag: 'span',
                classes: ['capacity-count'],
                originalText: '7',
                newText: '7 seats',
                sourceHint: { file: 'src/App.jsx', line: 4 },
              },
            ],
          },
        ],
        candidates: [],
      }, { tmp });

      const body = fs.readFileSync(path.join(tmp, 'src/App.jsx'), 'utf-8');
      assert.equal(result.status, 'done');
      assert.match(body, /seats: 7/);
      assert.match(body, /\{"7 seats"\}/);
      assert.doesNotMatch(body, /seats:\s*['"`]7 seats/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
