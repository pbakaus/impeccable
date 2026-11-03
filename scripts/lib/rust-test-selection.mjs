// Which workspace crates a change reaches, for scripts/test-rust-changed.mjs.
// Pure: the caller supplies the changed paths, the workspace packages and a
// search over crate sources, so tests/rust-test-selection.test.mjs can pin
// the selection without git or cargo.

export const WORKSPACE_FILES = [/^Cargo\.(toml|lock)$/, /^rust-toolchain(\.toml)?$/, /^\.cargo\//];

// Readers the source search cannot see. crates/core/tests/vectors.rs and
// crates/html/tests/vectors.rs build the vectors path with chained calls,
// `repo.join("tests").join("oracle").join("vectors")`, so no single string
// in them names the directory. Add a row here for any other path a crate
// assembles piece by piece.
export const KNOWN_READERS = [
  { prefix: 'tests/oracle/vectors/', crates: ['impeccable-core', 'impeccable-html'] },
];

// Crates name what they read either relative to their manifest
// (`include_str!("../../../skill/scripts/live-browser.js")`,
// `CARGO_MANIFEST_DIR/../../tests/fixtures/concept-catalog`) or from the repo
// root (`repo_root().join("tests/fixtures/antipatterns/x.html")`). The terms
// are the file itself and each directory above it as a whole path in either
// spelling: `../<file>`, `../<dir>"`, `../<dir>/"` (a `concat!` completes it),
// and the same after an opening `"` for paths of two segments or more. A
// crate that includes one file of scripts/, mentions a path in a comment, or
// reads a user project's `package.json` is not selected by every edit there.
export function searchTerms(file) {
  const parts = file.split('/');
  const terms = new Set([`../${file}`]);
  if (parts.length >= 2) terms.add(`"${file}`);
  for (let i = parts.length - 1; i >= 1; i--) {
    const dir = parts.slice(0, i).join('/');
    terms.add(`../${dir}"`);
    terms.add(`../${dir}/"`);
    if (i >= 2) {
      terms.add(`"${dir}"`);
      terms.add(`"${dir}/"`);
    }
  }
  return [...terms];
}

// changed: repo-relative paths. packages: [{ name, dir, deps }] with `dir`
// repo-relative (`crates/live`) and `deps` the workspace path dependencies,
// dev-dependencies included. searchCrates(terms): repo-relative paths of the
// files under crates/ that contain any of the terms.
// Returns { whole, selected: Map<name, reason> }; `whole` lists the changed
// files that select the whole workspace.
export function selectCrates({ changed, packages, searchCrates }) {
  const byDir = new Map(packages.map((p) => [p.dir, p.name]));
  const whole = changed.filter((f) => WORKSPACE_FILES.some((re) => re.test(f)));
  const selected = new Map();
  const pick = (name, why) => {
    if (!selected.has(name)) selected.set(name, why);
  };
  const crateOf = (file) => byDir.get(file.split('/').slice(0, 2).join('/'));

  for (const file of changed) {
    if (whole.includes(file)) continue;
    if (file.startsWith('crates/')) {
      const name = crateOf(file);
      if (name) pick(name, file);
      continue;
    }
    for (const { prefix, crates } of KNOWN_READERS) {
      if (file.startsWith(prefix)) for (const name of crates) pick(name, file);
    }
    for (const hit of searchCrates(searchTerms(file))) {
      const name = crateOf(hit);
      if (name) pick(name, file);
    }
  }

  // Reverse dependencies: anything in the workspace that depends on a
  // selected crate is selected too.
  for (let grew = true; grew;) {
    grew = false;
    for (const p of packages) {
      if (selected.has(p.name)) continue;
      const dep = p.deps.find((d) => selected.has(d));
      if (dep) {
        pick(p.name, `depends on ${dep}`);
        grew = true;
      }
    }
  }
  return { whole, selected };
}
