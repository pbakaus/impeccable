// Setup control output is local and independent of sign-in or service availability.
export default [
  { id: 'setup-status-default', verb: 'setup', env: { IMPECCABLE_HOME: '<WS>/.impeccable' } },
  { id: 'setup-unknown-verb', verb: 'setup', args: ['bogus'], env: { IMPECCABLE_HOME: '<WS>/.impeccable' } },
  // `start` sets everything up in one verb; only its offline paths are pinned here (tests/start.rs drives the rest).
  { id: 'start-help', verb: 'start', args: ['--help'], env: { IMPECCABLE_HOME: '<WS>/.impeccable' } },
  { id: 'start-unknown-arg', verb: 'start', args: ['--bogus'], env: { IMPECCABLE_HOME: '<WS>/.impeccable' } },
];
