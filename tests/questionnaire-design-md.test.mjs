import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildDesignMd,
  resolveDesignWriteTarget,
  STAGED_DESIGN_MD_PATH,
  writeDesignMd,
} from '../skill/scripts/questionnaire/design-md-builder.mjs';
import { normalizedSampleAnswers } from './questionnaire-fixtures.mjs';

let scratch;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-questionnaire-design-'));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('questionnaire DESIGN.md builder', () => {
  it('builds the existing six-section DESIGN.md structure in order', () => {
    const designMd = buildDesignMd({
      answers: normalizedSampleAnswers(),
      command: 'shape',
      prompt: 'Shape the billing workspace',
      generatedAt: '2026-06-14T00:00:00.000Z',
    });

    assert.deepEqual(
      [...designMd.matchAll(/^## \d\. .+$/gm)].map((match) => match[0]),
      [
        '## 1. Overview',
        '## 2. Colors',
        '## 3. Typography',
        '## 4. Elevation',
        '## 5. Components',
        "## 6. Do's and Don'ts",
      ],
    );
    assert.match(designMd, /^---\nname: "Orbit Ledger"/);
    assert.match(designMd, /letterSpacing: "0"/);
    assert.doesNotMatch(designMd, /undefined|null/);
  });

  it('writes DESIGN.md directly when the file is missing', () => {
    const designMd = buildDesignMd({ answers: normalizedSampleAnswers(), generatedAt: '2026-06-14T00:00:00.000Z' });
    assert.deepEqual(resolveDesignWriteTarget(scratch), {
      targetPath: 'DESIGN.md',
      absolutePath: path.join(scratch, 'DESIGN.md'),
      existingDesign: false,
      action: 'written',
    });

    const target = writeDesignMd({ cwd: scratch, designMd });
    assert.equal(target.action, 'written');
    assert.equal(target.targetPath, 'DESIGN.md');
    assert.equal(fs.readFileSync(path.join(scratch, 'DESIGN.md'), 'utf-8'), designMd);
  });

  it('stages DESIGN.next.md when DESIGN.md already exists', () => {
    fs.writeFileSync(path.join(scratch, 'DESIGN.md'), '# Existing design\n');
    const designMd = buildDesignMd({ answers: normalizedSampleAnswers(), generatedAt: '2026-06-14T00:00:00.000Z' });

    const target = writeDesignMd({ cwd: scratch, designMd });
    assert.equal(target.action, 'staged');
    assert.equal(target.targetPath, STAGED_DESIGN_MD_PATH);
    assert.equal(fs.readFileSync(path.join(scratch, 'DESIGN.md'), 'utf-8'), '# Existing design\n');
    assert.equal(fs.readFileSync(path.join(scratch, STAGED_DESIGN_MD_PATH), 'utf-8'), designMd);
  });
});
