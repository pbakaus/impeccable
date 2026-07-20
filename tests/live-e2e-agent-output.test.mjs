import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  htmlToJsx,
  isExpectedGenerationCancellation,
  normalizeVariantOutput,
} from './live-e2e/agent.mjs';

describe('live-e2e agent output translation', () => {
  it('treats a fenced late generation as expected cancellation only', () => {
    assert.equal(isExpectedGenerationCancellation(new Error('Source publication prepare failed: stale_generation_epoch')), true);
    assert.equal(isExpectedGenerationCancellation(new Error('Source publication failed: stale_source_revision')), false);
    assert.equal(isExpectedGenerationCancellation(new Error('provider unavailable')), false);
  });

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

  it('returns the original output untouched when no inline styles are present', () => {
    const original = {
      scopedCss: '@scope ([data-impeccable-variant="1"]) { :scope > h1 { color: blue; } }',
      variants: [{ innerHtml: '<h1 class="hero-title">Title</h1>' }],
    };
    const result = normalizeVariantOutput(original, { styleMode: 'scoped' });
    assert.equal(result, original);
  });
});
