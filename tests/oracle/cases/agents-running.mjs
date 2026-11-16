// agents running: the agent sessions running now (REN-2124). The list itself reads this machine's processes and is
// covered in crates/mcp (presence.rs and tests/presence.rs); the oracle pins the route and its usage.
export default [
  { id: 'agents-running-usage', verb: 'agents', args: ['running', '--nope'] },
];
