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
 * Claude Code Transformer (Full Featured)
 *
 * Keeps full YAML frontmatter with args support.
 * Skills stored in subdirectories with SKILL.md filename.
 * Supports reference files in skill subdirectories.
 */
export function transformClaudeCode(commands, skills, distDir, patterns = null) {
  const claudeDir = path.join(distDir, 'claude-code');
  const commandsDir = path.join(claudeDir, '.claude/commands');
  const skillsDir = path.join(claudeDir, '.claude/skills');

  cleanDir(claudeDir);
  ensureDir(commandsDir);
  ensureDir(skillsDir);

  // Commands: Keep frontmatter + body
  for (const command of commands) {
    const frontmatter = generateYamlFrontmatter({
      name: command.name,
      description: command.description,
      ...(command.context && { context: command.context }),
      ...(command.args.length > 0 && { args: command.args })
    });

    const commandBody = replacePlaceholders(command.body, 'claude-code');
    const content = `${frontmatter}\n\n${commandBody}`;
    const outputPath = path.join(commandsDir, `${command.name}.md`);
    writeFile(outputPath, content);
  }

  // Skills: Keep frontmatter + body in subdirectories
  let refCount = 0;
  for (const skill of skills) {
    const skillDir = path.join(skillsDir, skill.name);

    const frontmatterObj = {
      name: skill.name,
      description: skill.description,
    };

    // Add optional fields if present
    if (skill.license) frontmatterObj.license = skill.license;
    if (skill.compatibility) frontmatterObj.compatibility = skill.compatibility;
    if (skill.metadata) frontmatterObj.metadata = skill.metadata;
    if (skill.allowedTools) frontmatterObj['allowed-tools'] = skill.allowedTools;

    const frontmatter = generateYamlFrontmatter(frontmatterObj);

    const skillBody = replacePlaceholders(skill.body, 'claude-code');
    const content = `${frontmatter}\n\n${skillBody}`;
    const outputPath = path.join(skillDir, 'SKILL.md');
    writeFile(outputPath, content);

    // Copy reference files if they exist
    if (skill.references && skill.references.length > 0) {
      const refDir = path.join(skillDir, 'reference');
      ensureDir(refDir);
      for (const ref of skill.references) {
        const refOutputPath = path.join(refDir, `${ref.name}.md`);
        const refContent = replacePlaceholders(ref.content, 'claude-code');
        writeFile(refOutputPath, refContent);
        refCount++;
      }
    }
  }

  const refInfo = refCount > 0 ? ` (${refCount} reference files)` : '';
  console.log(`✓ Claude Code: ${commands.length} commands, ${skills.length} skills${refInfo}`);
}

