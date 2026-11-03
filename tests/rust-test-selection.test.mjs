import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWN_READERS, searchTerms, selectCrates } from '../scripts/lib/rust-test-selection.mjs';

// A small workspace shaped like the real one: core at the bottom, html on
// core, cli on html, and a dev-dependency edge from tool to core.
const PACKAGES = [
  { name: 'core', dir: 'crates/core', deps: [] },
  { name: 'html', dir: 'crates/html', deps: ['core'] },
  { name: 'cli', dir: 'crates/cli', deps: ['html'] },
  { name: 'tool', dir: 'crates/tool', deps: ['core'] },
  { name: 'comp', dir: 'crates/comp', deps: [] },
];

// Crate sources keyed by path; searchCrates returns the files that contain a term.
function select(changed, sources = {}) {
  const searchCrates = (terms) =>
    Object.entries(sources).filter(([, text]) => terms.some((t) => text.includes(t))).map(([file]) => file);
  const { whole, selected } = selectCrates({ changed, packages: PACKAGES, searchCrates });
  return { whole, names: [...selected.keys()].sort() };
}

describe('rust-test-selection', () => {
  it('selects a touched crate and every crate that depends on it', () => {
    assert.deepEqual(select(['crates/html/src/lib.rs']).names, ['cli', 'html']);
    assert.deepEqual(select(['crates/core/src/lib.rs']).names, ['cli', 'core', 'html', 'tool']);
    assert.deepEqual(select(['crates/comp/tests/fixtures/café.png']).names, ['comp']);
  });

  it('selects nothing for files no crate reads', () => {
    assert.deepEqual(select(['README.md', 'docs/ENGINE.md'], { 'crates/core/src/lib.rs': '// see README.md' }), {
      whole: [],
      names: [],
    });
  });

  it('selects the whole workspace for Cargo and toolchain files', () => {
    for (const file of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', '.cargo/config.toml']) {
      assert.deepEqual(select([file, 'crates/comp/src/lib.rs']).whole, [file]);
    }
    assert.deepEqual(select(['crates/core/Cargo.toml']).whole, []);
  });

  it('selects crates that read an outside file or its directory', () => {
    const sources = {
      'crates/html/src/a.rs': 'include_str!("../../../skill/scripts/live-browser.js")',
      'crates/comp/tests/b.rs': 'env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/concept-catalog")',
      'crates/tool/src/c.rs': 'repo_root().join("tests/fixtures/antipatterns/x.html"); repo.join("tests/oracle/golden")',
      'crates/core/src/d.rs': 'include_str!(concat!("../../../browser-bundle/", $name))',
    };
    assert.deepEqual(select(['skill/scripts/live-browser.js'], sources).names, ['cli', 'html']);
    assert.deepEqual(select(['tests/fixtures/concept-catalog/cards/a.json'], sources).names, ['comp']);
    assert.deepEqual(select(['tests/fixtures/antipatterns/x.html'], sources).names, ['tool']);
    assert.deepEqual(select(['tests/fixtures/antipatterns/other.html'], sources).names, []);
    assert.deepEqual(select(['tests/oracle/golden/detect-a.json'], sources).names, ['tool']);
    assert.deepEqual(select(['browser-bundle/10-probe.js'], sources).names, ['cli', 'core', 'html', 'tool']);
  });

  it('does not select a crate for a file it only mentions or a sibling it includes', () => {
    const sources = {
      'crates/html/src/a.rs': 'include_str!("../../../scripts/bundle-signing-keys.json")',
      'crates/comp/src/b.rs': '// rebuilt by scripts/lib/build.js; reads the project\'s "package.json"',
      'crates/tool/src/c.rs': '//! fixtures live in `tests/fixtures/antipatterns/`',
      'crates/core/src/d.rs': 'let rel = "skill/scripts/impeccable is the launcher";',
    };
    assert.deepEqual(select(['scripts/test-rust-changed.mjs', 'scripts/lib/build.js', 'package.json'], sources).names, []);
    assert.deepEqual(select(['tests/fixtures/antipatterns/x.html', 'skill/scripts/live-browser.js'], sources).names, []);
    assert.deepEqual(select(['scripts/bundle-signing-keys.json'], sources).names, ['cli', 'html']);
  });

  it('selects the known readers of paths built with chained joins', () => {
    const packages = [
      { name: 'impeccable-core', dir: 'crates/core', deps: [] },
      { name: 'impeccable-html', dir: 'crates/html', deps: ['impeccable-core'] },
      { name: 'impeccable-comp', dir: 'crates/comp', deps: [] },
    ];
    const { selected } = selectCrates({
      changed: ['tests/oracle/vectors/calls/engines.static-html.css-cascade/cssPropToCamel.jsonl'],
      packages,
      searchCrates: () => [],
    });
    assert.deepEqual([...selected.keys()].sort(), ['impeccable-core', 'impeccable-html']);
    // Every row must name a workspace crate, or a rename silently drops it.
    const real = readdirSync('crates').flatMap((dir) => {
      try {
        return [/^name\s*=\s*"([^"]+)"/m.exec(readFileSync(join('crates', dir, 'Cargo.toml'), 'utf8'))[1]];
      } catch {
        return [];
      }
    });
    for (const row of KNOWN_READERS) for (const name of row.crates) assert.ok(real.includes(name), name);
  });

  it('builds terms for the file and its directories', () => {
    assert.deepEqual(searchTerms('package.json'), ['../package.json']);
    assert.deepEqual(searchTerms('a/b/c.txt'), ['../a/b/c.txt', '"a/b/c.txt', '../a/b"', '../a/b/"', '"a/b"', '"a/b/"', '../a"', '../a/"']);
  });
});
