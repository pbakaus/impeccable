import path from 'path';
import { cleanDir, ensureDir, writeFile, generateYamlFrontmatter, replacePlaceholders } from '../utils.js';

/**
 * Cursor Transformer (Skills Only)
 *
 * All skills output to .cursor/skills/{name}/SKILL.md
 * Frontmatter: name, description, license
 *
 * @param {Array} skills - All skills (including user-invokable ones)
 * @param {string} distDir - Distribution output directory
 * @param {Object} patterns - Design patterns data (unused)
 * @param {Object} options - Optional settings
 * @param {string} options.prefix - Prefix to add to user-invokable skill names (e.g., 'i-')
 * @param {string} options.outputSuffix - Suffix for output directory (e.g., '-prefixed')
 */
export function transformCursor(skills, distDir, patterns = null, options = {}) {
  const { prefix = '', outputSuffix = '' } = options;
  const cursorDir = path.join(distDir, `cursor${outputSuffix}`);
  const skillsDir = path.join(cursorDir, '.cursor/skills');

  cleanDir(cursorDir);
  ensureDir(skillsDir);

  let refCount = 0;
  for (const skill of skills) {
    const skillName = skill.userInvokable ? `${prefix}${skill.name}` : skill.name;
    const skillDir = path.join(skillsDir, skillName);

    const frontmatterObj = {
      name: skillName,
      description: skill.description,
    };
    if (skill.license) frontmatterObj.license = skill.license;

    const frontmatter = generateYamlFrontmatter(frontmatterObj);
    const skillBody = replacePlaceholders(skill.body, 'cursor');
    const content = `${frontmatter}\n\n${skillBody}`;
    const outputPath = path.join(skillDir, 'SKILL.md');
    writeFile(outputPath, content);

    // Copy reference files if they exist
    if (skill.references && skill.references.length > 0) {
      const refDir = path.join(skillDir, 'reference');
      ensureDir(refDir);
      for (const ref of skill.references) {
        const refOutputPath = path.join(refDir, `${ref.name}.md`);
        const refContent = replacePlaceholders(ref.content, 'cursor');
        writeFile(refOutputPath, refContent);
        refCount++;
      }
    }
  }

  const userInvokableCount = skills.filter(s => s.userInvokable).length;
  const refInfo = refCount > 0 ? ` (${refCount} reference files)` : '';
  const prefixInfo = prefix ? ` [${prefix}prefixed]` : '';
  console.log(`✓ Cursor${prefixInfo}: ${skills.length} skills (${userInvokableCount} user-invokable)${refInfo}`);
}
