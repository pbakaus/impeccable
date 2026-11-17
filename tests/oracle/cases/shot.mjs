// shot: a look at a page at the sizes it ships at. The capture needs a browser
// and lives in crates/cli/tests/shot.rs; the oracle pins the contract that
// holds without one: a page is required.
export default [
  { id: 'shot-usage', verb: 'shot', args: [] },
  { id: 'shot-missing-page', verb: 'shot', args: ['missing.html'] },
  { id: 'shot-bad-viewport', verb: 'shot', args: ['index.html', '--viewport', 'wide'] },
];
