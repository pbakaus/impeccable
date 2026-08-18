#!/usr/bin/env node
/**
 * Record goldens.
 *   node tests/oracle/record.mjs --bin [prefix]     # from the engine binary ($IMPECCABLE_BIN,
 *                                                   # or --bin=/path/to/impeccable)
 *   node tests/oracle/record.mjs [prefix]           # from the JS scripts (historical; the
 *                                                   # scripts left the tree with the launcher swap)
 * A prefix limits recording to ids starting with it (e.g. detect-).
 *
 * The committed goldens are frozen JS behavior plus the reviewed deltas in
 * DELTAS.md. Re-recording from the binary overwrites that history for the
 * cases it touches, so record only the cases you added or whose delta a
 * review accepted, and say so in the commit.
 */
import { allCases, runCase, writeGolden } from './lib.mjs';

const argv = process.argv.slice(2);
const binFlag = argv.find(a => a === '--bin' || a.startsWith('--bin='));
const impl = binFlag ? 'bin' : 'js';
const bin = binFlag?.includes('=') ? binFlag.split('=').slice(1).join('=') : process.env.IMPECCABLE_BIN;
if (impl === 'bin' && !bin) {
  process.stderr.write('record.mjs --bin needs IMPECCABLE_BIN or --bin=/path/to/impeccable\n');
  process.exit(2);
}
if (impl === 'bin') process.env.IMPECCABLE_BIN = bin;
const prefix = argv.find(a => !a.startsWith('--')) || '';
const cases = (await allCases()).filter(c => c.id.startsWith(prefix));
let n = 0;
for (const c of cases) {
  const res = runCase(c, { impl, bin });
  writeGolden(c.id, res);
  n++;
  const head = res.steps ? `${res.steps.length} steps, exits ${res.steps.map(s => s.exit).join('/')}` : `exit ${res.exit}, ${res.stdout.length}b out`;
  process.stdout.write(`recorded ${c.id} (${head}, ${Object.keys(res.files).length} files)\n`);
}
process.stdout.write(`\n${n} goldens written (${impl})\n`);
