/** Signed-out critique preferences: isolated account state, no network calls. */
const env = {
  IMPECCABLE_HOME: '<WS>/.oracle-home/.impeccable',
  IMPECCABLE_ACCOUNT_URL: 'http://127.0.0.1:1',
  IMPECCABLE_NO_STALENESS_CHECK: '1',
};

export default [
  { id: 'critiques-no-argument', verb: 'critiques', env },
  { id: 'critiques-bad-argument', verb: 'critiques', args: ['bogus'], env },
  { id: 'critiques-status', verb: 'critiques', args: ['status'], env },
  {
    id: 'critiques-on-signed-out', verb: 'critiques', env,
    steps: [{ args: ['on'] }, { args: ['status'] }],
    files: ['.oracle-home/.impeccable/critiques.json'],
  },
  {
    id: 'critiques-off-signed-out', verb: 'critiques', env,
    steps: [{ args: ['on'] }, { args: ['off'] }, { args: ['status'] }],
    files: ['.oracle-home/.impeccable/critiques.json'],
  },
];
