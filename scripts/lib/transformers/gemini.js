import path from 'path';
import { cleanDir, ensureDir, writeFile, generateYamlFrontmatter, replacePlaceholders } from '../utils.js';

/**
 * Gemini Transformer (Skills Only)
 *
 * All skills output to .gemini/skills/{name}/SKILL.md
 * Frontmatter: name, description
 * For user-invokable skills: {{arg}} placeholders become {{args}} in body
 *
 * @param {Array} skills - All skills (including user-invokable ones)
 * @param {string} distDir - Distribution output directory
 * @param {Object} patterns - Design patterns data (unused)
 * @param {Object} options - Optional settings
 * @param {string} options.prefix - Prefix to add to user-invokable skill names (e.g., 'i-')
 * @param {string} options.outputSuffix - Suffix for output directory (e.g., '-prefixed')
 */
export function transformGemini(skills, distDir, patterns = null, options = {}) {
  const { prefix = '', outputSuffix = '' } = options;
  const geminiDir = path.join(distDir, `gemini${outputSuffix}`);
  const skillsDir = path.join(geminiDir, '.gemini/skills');

  cleanDir(geminiDir);
  ensureDir(skillsDir);

  let refCount = 0;
  for (const skill of skills) {
    const skillName = skill.userInvokable ? `${prefix}${skill.name}` : skill.name;
    const skillDir = path.join(skillsDir, skillName);

    const frontmatter = generateYamlFrontmatter({
      name: skillName,
      description: skill.description,
    });

    let skillBody = replacePlaceholders(skill.body, 'gemini');
    // For user-invokable skills, replace remaining {{arg}} placeholders with {{args}}
    if (skill.userInvokable) {
      skillBody = skillBody.replace(/\{\{[^}]+\}\}/g, '{{args}}');
    }

    const content = `${frontmatter}\n\n${skillBody}`;
    const outputPath = path.join(skillDir, 'SKILL.md');
    writeFile(outputPath, content);

    // Copy reference files if they exist
    if (skill.references && skill.references.length > 0) {
      const refDir = path.join(skillDir, 'reference');
      ensureDir(refDir);
      for (const ref of skill.references) {
        const refOutputPath = path.join(refDir, `${ref.name}.md`);
        const refContent = replacePlaceholders(ref.content, 'gemini');
        writeFile(refOutputPath, refContent);
        refCount++;
      }
    }
  }

  const userInvokableCount = skills.filter(s => s.userInvokable).length;
  const refInfo = refCount > 0 ? ` (${refCount} reference files)` : '';
  const prefixInfo = prefix ? ` [${prefix}prefixed]` : '';
  console.log(`✓ Gemini${prefixInfo}: ${skills.length} skills (${userInvokableCount} user-invokable)${refInfo}`);
}
