import path from 'path';
import { cleanDir, ensureDir, writeFile, generateYamlFrontmatter, replacePlaceholders, prefixSkillReferences } from '../utils.js';

/**
 * Trae Transformer (Skills Only)
 *
 * Outputs skills for both Trae China and Trae International versions:
 * - .trae-cn/builtin_skills/{name}/SKILL.md (China version)
 * - .trae/builtin_skills/{name}/SKILL.md (International version)
 *
 * Trae uses a similar format to Claude Code with full metadata support.
 *
 * @param {Array} skills - All skills (including user-invokable ones)
 * @param {string} distDir - Distribution output directory
 * @param {Object} patterns - Design patterns data (unused, kept for interface consistency)
 * @param {Object} options - Optional settings
 * @param {string} options.prefix - Prefix to add to user-invokable skill names (e.g., 'i-')
 * @param {string} options.outputSuffix - Suffix for output directory (e.g., '-prefixed')
 */
export function transformTrae(skills, distDir, patterns = null, options = {}) {
  const { prefix = '', outputSuffix = '' } = options;
  const traeDir = path.join(distDir, `trae${outputSuffix}`);

  cleanDir(traeDir);

  const allSkillNames = skills.map(s => s.name);
  const commandNames = skills.filter(s => s.userInvokable).map(s => `${prefix}${s.name}`);

  const variants = [
    { name: 'China', configDir: '.trae-cn/builtin_skills' },
    { name: 'International', configDir: '.trae/builtin_skills' }
  ];

  let totalRefCount = 0;

  for (const variant of variants) {
    const skillsDir = path.join(traeDir, variant.configDir);
    ensureDir(skillsDir);

    let refCount = 0;
    for (const skill of skills) {
      const skillName = `${prefix}${skill.name}`;
      const skillDir = path.join(skillsDir, skillName);

      const frontmatterObj = {
        name: skillName,
        description: skill.description,
      };

      if (skill.userInvokable) frontmatterObj['user-invokable'] = true;
      if (skill.args && skill.args.length > 0) frontmatterObj.args = skill.args;
      if (skill.license) frontmatterObj.license = skill.license;
      if (skill.compatibility) frontmatterObj.compatibility = skill.compatibility;
      if (skill.metadata) frontmatterObj.metadata = skill.metadata;
      if (skill.allowedTools) frontmatterObj['allowed-tools'] = skill.allowedTools;

      const frontmatter = generateYamlFrontmatter(frontmatterObj);
      let skillBody = replacePlaceholders(skill.body, 'trae', commandNames);
      if (prefix) skillBody = prefixSkillReferences(skillBody, prefix, allSkillNames);
      const content = `${frontmatter}\n\n${skillBody}`;
      const outputPath = path.join(skillDir, 'SKILL.md');
      writeFile(outputPath, content);

      if (skill.references && skill.references.length > 0) {
        const refDir = path.join(skillDir, 'reference');
        ensureDir(refDir);
        for (const ref of skill.references) {
          const refOutputPath = path.join(refDir, `${ref.name}.md`);
          const refContent = replacePlaceholders(ref.content, 'trae');
          writeFile(refOutputPath, refContent);
          refCount++;
        }
      }
    }
    totalRefCount += refCount;
  }

  const userInvokableCount = skills.filter(s => s.userInvokable).length;
  const refInfo = totalRefCount > 0 ? ` (${totalRefCount / 2} reference files per variant)` : '';
  const prefixInfo = prefix ? ` [${prefix}prefixed]` : '';
  console.log(`✓ Trae${prefixInfo}: ${skills.length} skills (${userInvokableCount} user-invokable) for 2 variants${refInfo}`);
}
