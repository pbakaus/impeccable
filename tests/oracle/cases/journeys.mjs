/** journeys: a malformed run is refused as one JSON object before any sign-in or network call. */
const env = {
  IMPECCABLE_HOME: '<WS>/.oracle-home/.impeccable',
  IMPECCABLE_ACCOUNT_URL: 'http://127.0.0.1:1',
  IMPECCABLE_NO_STALENESS_CHECK: '1',
};

export default [
  { id: 'journeys-bad-usage-json', verb: 'journeys', args: ['add a todo', '--json'], env },
];
