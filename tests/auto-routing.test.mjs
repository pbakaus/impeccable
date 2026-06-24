import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('auto command routing', () => {
  it('publishes auto in the command metadata with plain-language routing intent', () => {
    const metadata = JSON.parse(read('skill/scripts/command-metadata.json'));

    assert.ok(metadata.auto, 'expected command-metadata.json to include auto');
    assert.match(metadata.auto.description, /plain[- ]English/i);
    assert.match(metadata.auto.description, /chooses? the right/i);
    assert.match(metadata.auto.argumentHint, /request/i);
  });

  it('ships an auto reference that defines a decision workflow and command bundle', () => {
    const ref = read('skill/reference/auto.md');

    assert.match(ref, /^# \/impeccable auto/m);
    assert.match(ref, /Decision workflow/);
    assert.match(ref, /primary command/i);
    assert.match(ref, /supporting commands/i);
    assert.match(ref, /Do not ask the user to choose a command/i);
  });

  it('makes auto a first-class command and default natural-language router in the skill', () => {
    const skill = read('skill/SKILL.src.md');

    assert.match(skill, /\| `auto \[request\]` \|[^|]*\|[^|]*plain-English/i);
    assert.match(skill, /First word is `auto`/);
    assert.match(skill, /load `reference\/auto\.md`/);
    assert.match(skill, /First word doesn't match a command, but the full argument is an actionable design\/build request.*load `reference\/auto\.md`/s);
  });

  it('keeps auto routing fallback rules mutually exclusive', () => {
    const skill = read('skill/SKILL.src.md');
    const autoRule = skill.indexOf('First word is `auto`');
    const teachRule = skill.indexOf('First word is `teach`');
    const actionableRule = skill.indexOf('actionable design/build request');
    const fallbackRule = skill.indexOf('No clear command match and no actionable design request');

    assert.ok(autoRule > -1, 'auto rule should exist');
    assert.ok(teachRule > -1, 'teach alias should be handled before generic unmatched routing');
    assert.ok(actionableRule > -1, 'generic unmatched routing should be limited to actionable requests');
    assert.ok(fallbackRule > -1, 'non-actionable fallback should exist');
    assert.ok(teachRule < actionableRule, 'teach alias should not be swallowed by auto fallback');
    assert.ok(actionableRule < fallbackRule, 'actionable auto route should be checked before non-actionable recommendation fallback');
  });

  it('keeps public command counts aligned after adding auto', () => {
    const metadata = JSON.parse(read('skill/scripts/command-metadata.json'));
    assert.equal(Object.keys(metadata).length, 24);

    for (const rel of [
      'README.md',
      'README.npm.md',
      'site/content/tutorials/getting-started.md',
      'site/public/llms.txt',
    ]) {
      assert.match(read(rel), /\b24 commands\b/, `${rel} should mention 24 commands`);
    }

    assert.match(read('CLAUDE.md'), /\b24 commands\b/);
  });

  it('keeps auto wired into command checklist companions', () => {
    const subPagesData = read('scripts/lib/sub-pages-data.js');
    assert.match(subPagesData, /auto:\s*'create'/);
    assert.match(subPagesData, /auto:\s*\{\s*leadsTo:\s*\['craft', 'critique', 'audit', 'polish', 'harden'\]/);

    const pinScript = read('skill/scripts/pin.mjs');
    assert.match(pinScript, /const VALID_COMMANDS = \[\s*'auto'/);
  });
});
