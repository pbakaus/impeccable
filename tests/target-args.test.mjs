import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseTargetPath } from '../skill/scripts/lib/target-args.mjs';

describe('target argument helpers', () => {
  it('uses the last target value when duplicate target flags are present', () => {
    assert.equal(
      parseTargetPath(['--target', 'apps/marketing/src/App.jsx', '--target=apps/dashboard/src/App.jsx']),
      'apps/dashboard/src/App.jsx',
    );
  });

  it('throws a small target-arg error for missing target values in strict mode', () => {
    assert.throws(
      () => parseTargetPath(['--target', '--help'], { strict: true }),
      (err) => err.code === 'TARGET_VALUE_MISSING' && /--target requires a path value/.test(err.message),
    );
  });
});
