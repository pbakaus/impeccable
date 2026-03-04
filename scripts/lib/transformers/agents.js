import path from 'path';
import { cleanDir, ensureDir, writeFile, generateYamlFrontmatter, replacePlaceholders } from '../utils.js';

/**
 * Agents Transformer (VS Code Copilot + Antigravity)
 *
 * All skills output to .agents/skills/{name}/SKILL.md
 * Frontmatter: name, description, user-invokable (if true), argument-hint (from args)
 *
 * @param {Array} skills - All skills (including user-invokable ones)
 * @param {string} distDir - Distribution output directory
 * @param {Object} patterns - Design patterns data (unused)
 * @param {Object} options - Optional settings
 */
export function transformAgents(skills, distDir, patterns = null, options = {}) {
  const agentsDir = path.join(distDir, 'agents');
  const skillsDir = path.join(agentsDir, '.agents/skills');

  cleanDir(agentsDir);
  ensureDir(skillsDir);

  let refCount = 0;
  for (const skill of skills) {
    const skillName = skill.name;
    const skillDir = path.join(skillsDir, skillName);

    const frontmatterObj = {
      name: skillName,
      description: skill.description,
    };

    if (skill.userInvokable) frontmatterObj['user-invokable'] = true;

    // Build argument-hint from args array for user-invokable skills
    if (skill.userInvokable && skill.args && skill.args.length > 0) {
      const hints = skill.args.map(arg => {
        return arg.required ? `<${arg.name}>` : `[${arg.name.toUpperCase()}=<value>]`;
      });
      frontmatterObj['argument-hint'] = hints.join(' ');
    }

    const frontmatter = generateYamlFrontmatter(frontmatterObj);
    const skillBody = replacePlaceholders(skill.body, 'agents');
    const content = `${frontmatter}\n\n${skillBody}`;
    const outputPath = path.join(skillDir, 'SKILL.md');
    writeFile(outputPath, content);

    // Copy reference files if they exist
    if (skill.references && skill.references.length > 0) {
      const refDir = path.join(skillDir, 'reference');
      ensureDir(refDir);
      for (const ref of skill.references) {
        const refOutputPath = path.join(refDir, `${ref.name}.md`);
        const refContent = replacePlaceholders(ref.content, 'agents');
        writeFile(refOutputPath, refContent);
        refCount++;
      }
    }
  }

  const userInvokableCount = skills.filter(s => s.userInvokable).length;
  const refInfo = refCount > 0 ? ` (${refCount} reference files)` : '';
  console.log(`✓ Agents: ${skills.length} skills (${userInvokableCount} user-invokable)${refInfo}`);
}
