// first-viewport: the pre-review measure of a built page. The measures need a
// browser and live in crates/cli/tests/first_viewport.rs; the oracle pins the
// contract that holds without one: both selectors are required.
export default [
  { id: 'first-viewport-usage', verb: 'first-viewport', args: [] },
  { id: 'first-viewport-no-action', verb: 'first-viewport', args: ['index.html', '--thesis', '.plates'] },
  { id: 'first-viewport-empty-thesis', verb: 'first-viewport', args: ['index.html', '--thesis', '', '--action', '.buy'] },
];
