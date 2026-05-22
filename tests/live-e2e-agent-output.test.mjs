import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { htmlToJsx } from './live-e2e/agent.mjs';

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
});
