// Setup control output is local and independent of sign-in or service availability.
export default [
  { id: 'setup-status-default', verb: 'setup', env: { IMPECCABLE_HOME: '<WS>/.impeccable' } },
  { id: 'setup-unknown-verb', verb: 'setup', args: ['bogus'], env: { IMPECCABLE_HOME: '<WS>/.impeccable' } },
];
