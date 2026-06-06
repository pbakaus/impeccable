import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SUITES,
  OPT_IN_SUITES,
  SUITES,
  expandSuites,
  findTestFiles,
  suiteFiles,
} from '../scripts/test-suites.mjs';

describe('test suite registry', () => {
  it('assigns every test file to a default or opt-in suite', () => {
    const allDiscovered = findTestFiles();
    const allRegistered = new Set(suiteFiles([...DEFAULT_SUITES, ...OPT_IN_SUITES]));
    const missing = allDiscovered.filter((file) => !allRegistered.has(file));

    assert.deepEqual(
      missing,
      [],
      'new test files must be added to scripts/test-suites.mjs, either in a default suite or an opt-in suite',
    );
  });

  it('keeps default local suites free of duplicate test files', () => {
    const files = suiteFiles(DEFAULT_SUITES);
    const duplicates = files.filter((file, index) => files.indexOf(file) !== index);

    assert.deepEqual(duplicates, []);
  });

  it('keeps opt-in suites out of the default alias', () => {
    const expanded = expandSuites(['default']);
    for (const suite of expanded) {
      assert.equal(SUITES[suite].optIn, undefined, `${suite} should not be opt-in`);
    }
  });
});
