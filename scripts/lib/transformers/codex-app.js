import path from 'path';
import {
  cleanDir,
  ensureDir,
  writeFile,
  generateYamlFrontmatter,
  replacePlaceholders,
  prefixSkillReferences
} from '../utils.js';

/**
 * Codex App Transformer
 *
 * Codex app discovers skills from .agents/skills/{name}/SKILL.md within the
 * current project tree, so this output is project-local rather than global.
 * Frontmatter mirrors the shared Agent Skills shape used by other .agents
 * consumers, but uses Codex-specific placeholder text in the body.
 *
 * @param {Array} skills - All skills (including user-invokable ones)
 * @param {string} distDir - Distribution output directory
 * @param {Object} patterns - Design patterns data (unused)
 * @param {Object} options - Optional settings
 * @param {string} options.prefix - Prefix to add to user-invokable skill names (e.g., 'i-')
 * @param {string} options.outputSuffix - Suffix for output directory (e.g., '-prefixed')
 */
export function transformCodexApp(skills, distDir, patterns = null, options = {}) {
  const { prefix = '', outputSuffix = '' } = options;
  const codexAppDir = path.join(distDir, `codex-app${outputSuffix}`);
  const skillsDir = path.join(codexAppDir, '.agents/skills');

  cleanDir(codexAppDir);
  ensureDir(skillsDir);

  const allSkillNames = skills.map(s => s.name);
  const commandNames = skills.filter(s => s.userInvokable).map(s => `${prefix}${s.name}`);
  let refCount = 0;

  for (const skill of skills) {
    const skillName = `${prefix}${skill.name}`;
    const skillDir = path.join(skillsDir, skillName);

    const frontmatterObj = {
      name: skillName,
      description: skill.description,
    };

    if (skill.userInvokable) frontmatterObj['user-invokable'] = true;

    if (skill.userInvokable && skill.args && skill.args.length > 0) {
      const hints = skill.args.map(arg => {
        return arg.required ? `<${arg.name}>` : `[${arg.name.toUpperCase()}=<value>]`;
      });
      frontmatterObj['argument-hint'] = hints.join(' ');
    }

    const frontmatter = generateYamlFrontmatter(frontmatterObj);
    let skillBody = replacePlaceholders(skill.body, 'codex-app', commandNames);
    if (prefix) skillBody = prefixSkillReferences(skillBody, prefix, allSkillNames);
    const content = `${frontmatter}\n\n${skillBody}`;
    const outputPath = path.join(skillDir, 'SKILL.md');
    writeFile(outputPath, content);

    if (skill.references && skill.references.length > 0) {
      const refDir = path.join(skillDir, 'reference');
      ensureDir(refDir);
      for (const ref of skill.references) {
        const refOutputPath = path.join(refDir, `${ref.name}.md`);
        const refContent = replacePlaceholders(ref.content, 'codex-app');
        writeFile(refOutputPath, refContent);
        refCount++;
      }
    }
  }

  const userInvokableCount = skills.filter(s => s.userInvokable).length;
  const refInfo = refCount > 0 ? ` (${refCount} reference files)` : '';
  const prefixInfo = prefix ? ` [${prefix}prefixed]` : '';
  console.log(`✓ Codex app${prefixInfo}: ${skills.length} skills (${userInvokableCount} user-invokable)${refInfo}`);
}
