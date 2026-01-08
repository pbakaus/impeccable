import path from 'path';
import { cleanDir, ensureDir, writeFile, generateYamlFrontmatter, replacePlaceholders } from '../utils.js';

/**
 * Generate markdown from structured patterns/antipatterns data
 */
function generatePatternsMarkdown(patterns) {
  if (!patterns || (!patterns.patterns?.length && !patterns.antipatterns?.length)) {
    return '';
  }

  let md = `## Design Patterns Reference

This reference defines what TO do and what NOT to do when creating frontend interfaces. These patterns fight against model bias—the tendency of LLMs to converge on the same predictable choices.

### What TO Do (Patterns)

Focus on intentional, distinctive design choices:
`;

  for (const category of patterns.patterns || []) {
    md += `\n**${category.name}**:\n`;
    for (const item of category.items || []) {
      md += `- ${item}\n`;
    }
  }

  md += `
### What NOT to Do (Anti-Patterns)

These patterns create generic "AI slop" aesthetics:
`;

  for (const category of patterns.antipatterns || []) {
    md += `\n**${category.name}**:\n`;
    for (const item of category.items || []) {
      md += `- ${item}\n`;
    }
  }

  md += `
These anti-patterns are baked into training data from countless generic templates. Without explicit guidance, AI reproduces them. This skill ensures your AI knows both what to do AND what to avoid.
`;

  return md;
}

/**
 * Codex Transformer (Full Featured - Agent Skills Standard)
 *
 * Commands: Uses argument-hint format with $VARIABLE placeholders in .codex/prompts/
 * Skills: Uses Agent Skills standard with SKILL.md in .codex/skills/{name}/
 * Reference files are copied to skill subdirectories
 *
 * @param {Object} options - Optional settings
 * @param {string} options.prefix - Prefix to add to command names (e.g., 'i-')
 * @param {string} options.outputSuffix - Suffix for output directory (e.g., '-prefixed')
 */
export function transformCodex(commands, skills, distDir, patterns = null, options = {}) {
  const { prefix = '', outputSuffix = '' } = options;
  const codexDir = path.join(distDir, `codex${outputSuffix}`);
  const promptsDir = path.join(codexDir, '.codex/prompts');
  const skillsDir = path.join(codexDir, '.codex/skills');

  cleanDir(codexDir);
  ensureDir(promptsDir);
  ensureDir(skillsDir);

  // Commands: Transform to Codex prompt format
  for (const command of commands) {
    const commandName = `${prefix}${command.name}`;
    const yamlLines = ['---'];
    yamlLines.push(`description: ${command.description}`);

    // Build argument-hint from args array
    if (command.args && command.args.length > 0) {
      const hints = command.args.map(arg => {
        const hint = arg.required ? `<${arg.name}>` : `[${arg.name.toUpperCase()}=<value>]`;
        return hint;
      });
      yamlLines.push(`argument-hint: ${hints.join(' ')}`);
    }

    yamlLines.push('---');

    // First replace our placeholders, then transform remaining {{argname}} to $ARGNAME
    let body = replacePlaceholders(command.body, 'codex');
    body = body.replace(/\{\{([^}]+)\}\}/g, (match, argName) => {
      return `$${argName.toUpperCase()}`;
    });

    const content = `${yamlLines.join('\n')}\n\n${body}`;
    const outputPath = path.join(promptsDir, `${commandName}.md`);
    writeFile(outputPath, content);
  }

  // Skills: Use Agent Skills standard with SKILL.md in subdirectories
  let refCount = 0;
  for (const skill of skills) {
    const skillDir = path.join(skillsDir, skill.name);

    const frontmatter = generateYamlFrontmatter({
      name: skill.name,
      description: skill.description,
      ...(skill.license && { license: skill.license })
    });

    const skillBody = replacePlaceholders(skill.body, 'codex');
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

  const refInfo = refCount > 0 ? ` (${refCount} reference files)` : '';
  const prefixInfo = prefix ? ` [${prefix}prefixed]` : '';
  console.log(`✓ Codex${prefixInfo}: ${commands.length} prompts, ${skills.length} skills${refInfo}`);
}
