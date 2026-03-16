import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { parseFrontmatter } from '../scripts/lib/utils.js';
import { commandCategories, commandProcessSteps } from '../public/js/data.js';

function getUserInvokableCommandIds() {
  const skillsDir = path.join(process.cwd(), 'source', 'skills');
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) return null;

      const content = fs.readFileSync(skillPath, 'utf-8');
      const { frontmatter } = parseFrontmatter(content);
      const isUserInvokable = frontmatter['user-invokable'] === true || frontmatter['user-invokable'] === 'true';

      return isUserInvokable ? (frontmatter.name || entry.name) : null;
    })
    .filter(Boolean)
    .sort();
}

describe('public command metadata', () => {
  test('covers every user-invokable skill in public/js/data.js', () => {
    const commandIds = getUserInvokableCommandIds();

    for (const id of commandIds) {
      expect(commandProcessSteps).toHaveProperty(id);
      expect(commandCategories).toHaveProperty(id);
    }
  });

  test('covers every user-invokable skill in the cheatsheet category map', () => {
    const commandIds = getUserInvokableCommandIds();
    const cheatsheet = fs.readFileSync(path.join(process.cwd(), 'public', 'cheatsheet.html'), 'utf-8');
    const categoryBlockMatch = cheatsheet.match(/const commandCategories = \{([\s\S]*?)\n    \};/);

    expect(categoryBlockMatch).not.toBeNull();

    const categoryBlock = categoryBlockMatch[1];
    for (const id of commandIds) {
      expect(categoryBlock).toContain(`'${id}':`);
    }
  });

  test('keeps the cheatsheet command count in sync', () => {
    const commandIds = getUserInvokableCommandIds();
    const cheatsheet = fs.readFileSync(path.join(process.cwd(), 'public', 'cheatsheet.html'), 'utf-8');

    expect(cheatsheet).toContain(`Quick reference for all ${commandIds.length} Impeccable commands.`);
    expect(cheatsheet).toContain(`Quick reference for all ${commandIds.length} design commands`);
  });
});
