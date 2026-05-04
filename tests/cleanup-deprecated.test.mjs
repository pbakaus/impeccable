import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  findProjectRoot,
  isImpeccableSkill,
  buildTargetNames,
  findSkillsDirs,
  removeDeprecatedSkills,
  cleanSkillsLock,
  cleanup,
  loadLock,
} from '../skill/scripts/cleanup-deprecated.mjs';

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'impeccable-cleanup-test-'));
}

function writeSkill(root, harness, name, content) {
  const dir = join(root, harness, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8');
  return dir;
}

describe('cleanup-deprecated', () => {
  let tmp;

  beforeEach(() => {
    tmp = makeTmpDir();
    // Mark as project root
    writeFileSync(join(tmp, 'package.json'), '{}', 'utf-8');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('findProjectRoot', () => {
    it('finds directory with package.json', () => {
      const sub = join(tmp, 'a', 'b', 'c');
      mkdirSync(sub, { recursive: true });
      assert.equal(findProjectRoot(sub), tmp);
    });

    it('finds directory with skills-lock.json', () => {
      const root2 = makeTmpDir();
      writeFileSync(join(root2, 'skills-lock.json'), '{}', 'utf-8');
      assert.equal(findProjectRoot(root2), root2);
      rmSync(root2, { recursive: true, force: true });
    });
  });

  describe('isImpeccableSkill', () => {
    it('returns true when SKILL.md mentions impeccable', () => {
      const dir = writeSkill(tmp, '.claude', 'arrange', 'Invoke /impeccable first.');
      assert.equal(isImpeccableSkill(dir), true);
    });

    it('returns false when SKILL.md does not mention impeccable', () => {
      const dir = writeSkill(tmp, '.claude', 'arrange', 'This is my custom arrange skill.');
      assert.equal(isImpeccableSkill(dir), false);
    });

    it('returns false for non-existent directory', () => {
      assert.equal(isImpeccableSkill(join(tmp, 'nope')), false);
    });

    it('returns true when lock source says pbakaus/impeccable, even if SKILL.md never mentions it', () => {
      const dir = writeSkill(tmp, '.claude', 'harden', 'A custom skill with no pack mention.');
      const lock = {
        skills: { harden: { source: 'pbakaus/impeccable' } },
      };
      assert.equal(isImpeccableSkill(dir, { skillName: 'harden', lock }), true);
    });

    it('returns false when lock source is a different pack', () => {
      const dir = writeSkill(tmp, '.claude', 'harden', 'A custom skill with no pack mention.');
      const lock = {
        skills: { harden: { source: 'someone-else/pack' } },
      };
      assert.equal(isImpeccableSkill(dir, { skillName: 'harden', lock }), false);
    });

    it('falls back to SKILL.md content when no lock entry exists', () => {
      const dir = writeSkill(tmp, '.claude', 'harden', 'Invoke /impeccable to harden.');
      const lock = { skills: {} };
      assert.equal(isImpeccableSkill(dir, { skillName: 'harden', lock }), true);
    });
  });

  describe('loadLock', () => {
    it('returns null when skills-lock.json is missing', () => {
      assert.equal(loadLock(tmp), null);
    });

    it('parses skills-lock.json when present', () => {
      const lock = { version: 1, skills: { arrange: { source: 'pbakaus/impeccable' } } };
      writeFileSync(join(tmp, 'skills-lock.json'), JSON.stringify(lock), 'utf-8');
      assert.deepEqual(loadLock(tmp), lock);
    });

    it('returns null on malformed JSON', () => {
      writeFileSync(join(tmp, 'skills-lock.json'), '{not json', 'utf-8');
      assert.equal(loadLock(tmp), null);
    });
  });

  describe('buildTargetNames', () => {
    it('includes both unprefixed and i-prefixed names', () => {
      const names = buildTargetNames();
      assert.ok(names.includes('arrange'));
      assert.ok(names.includes('i-arrange'));
      assert.ok(names.includes('frontend-design'));
      assert.ok(names.includes('i-frontend-design'));
      assert.equal(names.length, 46); // 23 deprecated * 2
    });
  });

  describe('findSkillsDirs', () => {
    it('finds existing harness skill directories', () => {
      mkdirSync(join(tmp, '.claude', 'skills'), { recursive: true });
      mkdirSync(join(tmp, '.agents', 'skills'), { recursive: true });
      const dirs = findSkillsDirs(tmp);
      assert.equal(dirs.length, 2);
    });

    it('ignores non-existent harness directories', () => {
      const dirs = findSkillsDirs(tmp);
      assert.equal(dirs.length, 0);
    });
  });

  describe('removeDeprecatedSkills', () => {
    it('deletes impeccable-owned deprecated skill directories', () => {
      writeSkill(tmp, '.claude', 'arrange', 'Invoke /impeccable first.');
      writeSkill(tmp, '.claude', 'normalize', 'Run impeccable teach.');
      const deleted = removeDeprecatedSkills(tmp);
      assert.equal(deleted.length, 2);
      assert.equal(existsSync(join(tmp, '.claude', 'skills', 'arrange')), false);
      assert.equal(existsSync(join(tmp, '.claude', 'skills', 'normalize')), false);
    });

    it('does NOT delete skills that do not mention impeccable', () => {
      writeSkill(tmp, '.claude', 'arrange', 'My custom layout organizer.');
      const deleted = removeDeprecatedSkills(tmp);
      assert.equal(deleted.length, 0);
      assert.equal(existsSync(join(tmp, '.claude', 'skills', 'arrange')), true);
    });

    it('deletes i-prefixed variants', () => {
      writeSkill(tmp, '.cursor', 'i-normalize', 'Invoke /impeccable first.');
      const deleted = removeDeprecatedSkills(tmp);
      assert.equal(deleted.length, 1);
      assert.equal(existsSync(join(tmp, '.cursor', 'skills', 'i-normalize')), false);
    });

    it('cleans across multiple harness directories', () => {
      writeSkill(tmp, '.claude', 'onboard', 'Run impeccable teach first.');
      writeSkill(tmp, '.agents', 'onboard', 'Run impeccable teach first.');
      writeSkill(tmp, '.cursor', 'onboard', 'Run impeccable teach first.');
      const deleted = removeDeprecatedSkills(tmp);
      assert.equal(deleted.length, 3);
    });

    it('leaves non-deprecated skills alone', () => {
      writeSkill(tmp, '.claude', 'my-custom-skill', 'Invoke /impeccable first.');
      writeSkill(tmp, '.claude', 'arrange', 'Invoke /impeccable first.');
      const deleted = removeDeprecatedSkills(tmp);
      assert.equal(deleted.length, 1); // only arrange
      assert.equal(existsSync(join(tmp, '.claude', 'skills', 'my-custom-skill')), true);
    });

    it('deletes a stock v2.x harden skill with no lock file via the fingerprint fallback', () => {
      // Reproduces the no-lock-file install path: user installed via
      // submodule or manual copy, so skills-lock.json never existed. The
      // v2.x harden SKILL.md never contained the word "impeccable", but
      // does contain the distinctive description fingerprint.
      const body = [
        '---',
        'name: harden',
        'description: "Make interfaces production-ready: error handling, empty states, onboarding flows, i18n, text overflow, and edge case management."',
        '---',
        '',
        'Strengthen interfaces against edge cases.',
      ].join('\n');
      writeSkill(tmp, '.claude', 'harden', body);
      const deleted = removeDeprecatedSkills(tmp);
      assert.equal(deleted.length, 1);
      assert.equal(existsSync(join(tmp, '.claude', 'skills', 'harden')), false);
    });

    it('deletes a stock v2.x optimize skill with no lock file via the fingerprint fallback', () => {
      const body = [
        '---',
        'name: optimize',
        'description: "Diagnoses and fixes UI performance across loading speed, rendering, animations, images, and bundle size."',
        '---',
        '',
        'Identify and fix performance issues.',
      ].join('\n');
      writeSkill(tmp, '.claude', 'optimize', body);
      const deleted = removeDeprecatedSkills(tmp);
      assert.equal(deleted.length, 1);
    });

    it('does NOT delete a user-written harden skill that lacks both the pack word and the fingerprint', () => {
      writeSkill(tmp, '.claude', 'harden', 'My custom skill for hardening cookies against CSRF.');
      const deleted = removeDeprecatedSkills(tmp);
      assert.equal(deleted.length, 0);
      assert.equal(existsSync(join(tmp, '.claude', 'skills', 'harden')), true);
    });

    it('deletes skills whose SKILL.md never mentions impeccable when the lock claims them', () => {
      // Reproduces the "orphan dir" bug: the old SKILL.md bodies described
      // each skill on its own merits and never said the word "impeccable",
      // so the content heuristic returned false. The lock source is the
      // authoritative signal.
      writeSkill(tmp, '.claude', 'harden', '# Harden\n\nA custom skill with zero pack-name mentions.');
      const lock = {
        version: 1,
        skills: { harden: { source: 'pbakaus/impeccable', sourceType: 'github', computedHash: 'x' } },
      };
      writeFileSync(join(tmp, 'skills-lock.json'), JSON.stringify(lock), 'utf-8');
      const deleted = removeDeprecatedSkills(tmp);
      assert.equal(deleted.length, 1);
      assert.equal(existsSync(join(tmp, '.claude', 'skills', 'harden')), false);
    });

    it('does NOT delete a same-named skill owned by a different pack', () => {
      writeSkill(tmp, '.claude', 'extract', 'Some user-written extract skill.');
      const lock = {
        version: 1,
        skills: { extract: { source: 'someone-else/pack' } },
      };
      writeFileSync(join(tmp, 'skills-lock.json'), JSON.stringify(lock), 'utf-8');
      const deleted = removeDeprecatedSkills(tmp);
      assert.equal(deleted.length, 0);
      assert.equal(existsSync(join(tmp, '.claude', 'skills', 'extract')), true);
    });

    it('handles symlinks to deprecated skills', () => {
      // Create the canonical skill in .agents
      const canonical = writeSkill(tmp, '.agents', 'extract', 'Use impeccable extract.');
      // Create a symlink in .claude
      mkdirSync(join(tmp, '.claude', 'skills'), { recursive: true });
      symlinkSync(canonical, join(tmp, '.claude', 'skills', 'extract'));
      const deleted = removeDeprecatedSkills(tmp);
      assert.equal(deleted.length, 2); // both canonical and symlink
    });
  });

  describe('cleanSkillsLock', () => {
    it('removes impeccable-owned deprecated entries', () => {
      const lock = {
        version: 1,
        skills: {
          arrange: { source: 'pbakaus/impeccable', sourceType: 'github', computedHash: 'abc' },
          impeccable: { source: 'pbakaus/impeccable', sourceType: 'github', computedHash: 'def' },
          'resolve-reviews': { source: 'pbakaus/agent-reviews', sourceType: 'github', computedHash: 'ghi' },
        },
      };
      writeFileSync(join(tmp, 'skills-lock.json'), JSON.stringify(lock), 'utf-8');
      const removed = cleanSkillsLock(tmp);
      assert.deepEqual(removed, ['arrange']);
      const updated = JSON.parse(readFileSync(join(tmp, 'skills-lock.json'), 'utf-8'));
      assert.equal(updated.skills.arrange, undefined);
      assert.ok(updated.skills.impeccable); // not deprecated
      assert.ok(updated.skills['resolve-reviews']); // different source
    });

    it('does NOT remove entries from other sources', () => {
      const lock = {
        version: 1,
        skills: {
          extract: { source: 'some-other/package', sourceType: 'github', computedHash: 'xyz' },
        },
      };
      writeFileSync(join(tmp, 'skills-lock.json'), JSON.stringify(lock), 'utf-8');
      const removed = cleanSkillsLock(tmp);
      assert.equal(removed.length, 0);
    });

    it('handles missing skills-lock.json gracefully', () => {
      const removed = cleanSkillsLock(tmp);
      assert.equal(removed.length, 0);
    });

    it('removes i-prefixed entries', () => {
      const lock = {
        version: 1,
        skills: {
          'i-arrange': { source: 'pbakaus/impeccable', sourceType: 'github', computedHash: 'abc' },
          'i-normalize': { source: 'pbakaus/impeccable', sourceType: 'github', computedHash: 'def' },
        },
      };
      writeFileSync(join(tmp, 'skills-lock.json'), JSON.stringify(lock), 'utf-8');
      const removed = cleanSkillsLock(tmp);
      assert.equal(removed.length, 2);
    });
  });

  describe('cleanup (integration)', () => {
    it('cleans both files and lock entries in one pass', () => {
      // Set up deprecated skills in two harness dirs
      writeSkill(tmp, '.claude', 'arrange', 'Invoke /impeccable.');
      writeSkill(tmp, '.agents', 'arrange', 'Invoke /impeccable.');
      writeSkill(tmp, '.claude', 'extract', 'Run impeccable extract.');

      // Set up lock file
      const lock = {
        version: 1,
        skills: {
          arrange: { source: 'pbakaus/impeccable', sourceType: 'github', computedHash: 'a' },
          extract: { source: 'pbakaus/impeccable', sourceType: 'github', computedHash: 'b' },
          impeccable: { source: 'pbakaus/impeccable', sourceType: 'github', computedHash: 'c' },
        },
      };
      writeFileSync(join(tmp, 'skills-lock.json'), JSON.stringify(lock), 'utf-8');

      const result = cleanup(tmp);
      assert.equal(result.deletedPaths.length, 3);
      assert.equal(result.removedLockEntries.length, 2); // arrange + extract
      assert.equal(existsSync(join(tmp, '.claude', 'skills', 'arrange')), false);
      assert.equal(existsSync(join(tmp, '.agents', 'skills', 'arrange')), false);

      const updated = JSON.parse(readFileSync(join(tmp, 'skills-lock.json'), 'utf-8'));
      assert.ok(updated.skills.impeccable); // not deprecated
      assert.equal(updated.skills.arrange, undefined);
      assert.equal(updated.skills.extract, undefined);
    });

    it('is a no-op when nothing needs cleaning', () => {
      writeSkill(tmp, '.claude', 'my-custom-skill', 'Invoke /impeccable.');
      const result = cleanup(tmp);
      assert.equal(result.deletedPaths.length, 0);
      assert.equal(result.removedLockEntries.length, 0);
    });
  });
});
