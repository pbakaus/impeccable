import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SUITES,
  OPT_IN_SUITES,
  SUITES,
  expandSuites,
  findTestFiles,
  matchesSuiteTriggers,
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

  it('selects every suite when one of its own test files changes', () => {
    // Change-based CI (ci-test-plan.mjs) picks suites via matchesSuiteTriggers.
    // A test file whose edits select no suite, or only a suite that does not
    // run it, is a silent CI gap; the generated own-file triggers close it.
    for (const [name, suite] of Object.entries(SUITES)) {
      for (const file of suiteFiles([name])) {
        assert.equal(
          matchesSuiteTriggers(name, [file]),
          true,
          `editing ${file} must select suite "${name}"`,
        );
      }
    }
  });

  it('never lets a test file trigger only suites that do not run it', () => {
    const allSuiteNames = Object.keys(SUITES);
    for (const file of findTestFiles()) {
      const triggered = allSuiteNames.filter((name) => matchesSuiteTriggers(name, [file]));
      const runsIn = allSuiteNames.filter((name) => suiteFiles([name]).includes(file));
      const useful = triggered.filter((name) => runsIn.includes(name));
      assert.ok(
        useful.length > 0,
        `${file} triggers [${triggered.join(', ')}] but runs in [${runsIn.join(', ')}]; ` +
        'at least one triggered suite must actually run it',
      );
    }
  });
});
