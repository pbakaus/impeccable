#!/usr/bin/env node
/**
 * Record goldens from the JS implementation.
 *   node tests/oracle/record.mjs            # all cases
 *   node tests/oracle/record.mjs detect-    # only ids starting with a prefix
 */
import { allCases, runCase, writeGolden } from './lib.mjs';

const prefix = process.argv[2] || '';
const cases = (await allCases()).filter(c => c.id.startsWith(prefix));
let n = 0;
for (const c of cases) {
  const res = runCase(c, { impl: 'js' });
  writeGolden(c.id, res);
  n++;
  process.stdout.write(`recorded ${c.id} (exit ${res.exit}, ${res.stdout.length}b out, ${Object.keys(res.files).length} files)\n`);
}
process.stdout.write(`\n${n} goldens written\n`);
