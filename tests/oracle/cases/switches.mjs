// switches: the Impeccable block's catalog, which the repo settings page mirrors, and the
// verb's usage. The per-file listing reads the machine's home and is covered in
// crates/cli/tests/account.rs.
export default [
  { id: 'switches-catalog', verb: 'switches', args: ['--catalog'] },
  { id: 'switches-usage', verb: 'switches', args: ['--nope'] },
];
