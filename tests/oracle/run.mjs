#!/usr/bin/env node
/**
 * Replay the corpus against an implementation and diff against goldens.
 *   IMPECCABLE_BIN=/path/to/impeccable node tests/oracle/run.mjs [prefix]
 *   node tests/oracle/run.mjs --js [prefix]     # self-check: JS vs its own goldens
 * Exit 1 on any difference. Cases whose id appears in DELTAS.md as accepted
 * are reported but not counted as failures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { allCases, runCase, readGolden, diffResults, caseRunsHere, ORACLE_DIR } from './lib.mjs';

const argv = process.argv.slice(2);
const impl = argv.includes('--js') ? 'js' : 'bin';
const prefix = argv.find(a => !a.startsWith('--')) || '';
const accepted = loadAcceptedDeltas();

const cases = (await allCases()).filter(c => c.id.startsWith(prefix));
let pass = 0, fail = 0, acceptedCount = 0, missing = 0, skipped = 0;
for (const c of cases) {
  if (!caseRunsHere(c)) { skipped++; process.stdout.write(`-- ${c.id}: skipped (platforms: ${c.platforms.join(', ')})\n`); continue; }
  const golden = readGolden(c.id);
  if (!golden) { missing++; process.stdout.write(`?? ${c.id}: no golden (run record.mjs)\n`); continue; }
  const actual = runCase(c, { impl });
  const diffs = diffResults(golden, actual);
  if (!diffs.length) { pass++; continue; }
  if (accepted.has(c.id)) { acceptedCount++; process.stdout.write(`~~ ${c.id}: differs (accepted delta)\n`); continue; }
  fail++;
  process.stdout.write(`XX ${c.id}\n${diffs.map(d => '   ' + d.replace(/\n/g, '\n   ')).join('\n')}\n`);
}
process.stdout.write(`\n${pass} pass, ${fail} fail, ${acceptedCount} accepted deltas, ${missing} missing goldens${skipped ? `, ${skipped} skipped on ${process.platform}` : ''} (${impl})\n`);
process.exit(fail || missing ? 1 : 0);

function loadAcceptedDeltas() {
  const p = path.join(ORACLE_DIR, 'DELTAS.md');
  if (!fs.existsSync(p)) return new Set();
  const ids = new Set();
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^- `([^`]+)`/.exec(line);
    if (m) ids.add(m[1]);
  }
  return ids;
}
