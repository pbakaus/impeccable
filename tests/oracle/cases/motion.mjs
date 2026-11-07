// Browser-free contract for the skill-internal motion evidence verb.
// Real frame pixels and findings are covered by crates/cli/tests/motion.rs.
export default [
  { id: 'motion-capture-help', verb: 'motion-capture', workspace: 'comp-basic', args: ['--help'] },
  { id: 'motion-capture-usage', verb: 'motion-capture', workspace: 'comp-basic', args: [] },
  { id: 'motion-capture-url-scheme', verb: 'motion-capture', workspace: 'comp-basic', args: ['javascript:alert(1)', '--click', '#toggle', '--out-dir', 'motion'] },
];
