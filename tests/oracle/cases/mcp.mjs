/** `impeccable mcp` signed out, with no network: its usage, a start that opens no browser, and a call over SSH. */
const env = {
  IMPECCABLE_HOME: '<WS>/.oracle-home/.impeccable',
  IMPECCABLE_ACCOUNT_URL: 'http://127.0.0.1:1',
  IMPECCABLE_NO_STALENESS_CHECK: '1',
};
const line = (o) => JSON.stringify(o);

export default [
  { id: 'mcp-help', verb: 'mcp', args: ['--help'], env },
  {
    id: 'mcp-start-signed-out', verb: 'mcp', env,
    stdin: [
      line({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
      line({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      line({ jsonrpc: '2.0', id: 2, method: 'ping' }),
    ].join('\n'),
  },
  {
    id: 'mcp-call-over-ssh', verb: 'mcp', env: { ...env, SSH_TTY: '/dev/ttys001' },
    stdin: line({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'taste.get', arguments: {} } }),
  },
];
