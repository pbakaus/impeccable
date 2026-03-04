import path from 'path';
import { cleanDir, ensureDir, writeFile, generateYamlFrontmatter, replacePlaceholders } from '../utils.js';

/**
 * Codex Transformer (Skills Only)
 *
 * All skills output to .codex/skills/{name}/SKILL.md
 * Frontmatter: name, description, argument-hint (from args for user-invokable)
 * For user-invokable skills: {{argname}} becomes $ARGNAME in body
 *
 * @param {Array} skills - All skills (including user-invokable ones)
 * @param {string} distDir - Distribution output directory
 * @param {Object} patterns - Design patterns data (unused)
 * @param {Object} options - Optional settings
 * @param {string} options.prefix - Prefix to add to user-invokable skill names (e.g., 'i-')
 * @param {string} options.outputSuffix - Suffix for output directory (e.g., '-prefixed')
 */
export function transformCodex(skills, distDir, patterns = null, options = {}) {
  const { prefix = '', outputSuffix = '' } = options;
  const codexDir = path.join(distDir, `codex${outputSuffix}`);
  const skillsDir = path.join(codexDir, '.codex/skills');

  cleanDir(codexDir);
  ensureDir(skillsDir);

  let refCount = 0;
  for (const skill of skills) {
    const skillName = skill.userInvokable ? `${prefix}${skill.name}` : skill.name;
    const skillDir = path.join(skillsDir, skillName);

    const frontmatterObj = {
      name: skillName,
      description: skill.description,
    };

    // Build argument-hint from args array for user-invokable skills
    if (skill.userInvokable && skill.args && skill.args.length > 0) {
      const hints = skill.args.map(arg => {
        return arg.required ? `<${arg.name}>` : `[${arg.name.toUpperCase()}=<value>]`;
      });
      frontmatterObj['argument-hint'] = hints.join(' ');
    }
    if (skill.license) frontmatterObj.license = skill.license;

    const frontmatter = generateYamlFrontmatter(frontmatterObj);

    let skillBody = replacePlaceholders(skill.body, 'codex');
    // For user-invokable skills, transform remaining {{argname}} to $ARGNAME
    if (skill.userInvokable) {
      skillBody = skillBody.replace(/\{\{([^}]+)\}\}/g, (match, argName) => {
        return `$${argName.toUpperCase()}`;
      });
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
        const refContent = replacePlaceholders(ref.content, 'codex');
        writeFile(refOutputPath, refContent);
        refCount++;
      }
    }
  }

  const userInvokableCount = skills.filter(s => s.userInvokable).length;
  const refInfo = refCount > 0 ? ` (${refCount} reference files)` : '';
  const prefixInfo = prefix ? ` [${prefix}prefixed]` : '';
  console.log(`✓ Codex${prefixInfo}: ${skills.length} skills (${userInvokableCount} user-invokable)${refInfo}`);
}
