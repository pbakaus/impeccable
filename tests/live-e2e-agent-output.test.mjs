import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { htmlToJsx, normalizeVariantOutput } from './live-e2e/agent.mjs';

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

    assert.equal(output.variants[0].innerHtml, '<h1 class="hero-title">Title</h1>');
    assert.equal(output.variants[1].innerHtml, '<h1 class="hero-title">Title</h1>');
    assert.match(output.scopedCss, /@scope \(\[data-impeccable-variant="1"\]\)/);
    assert.match(output.scopedCss, /color: red;/);
    assert.match(output.scopedCss, /font-weight: 700;/);
    assert.match(output.scopedCss, /content: "a;b";/);
    assert.match(output.scopedCss, /background-image: url\("foo;bar"\);/);
  });
});
