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
 * Cursor Transformer (Agent Skills Standard)
 *
 * Commands: Body only in .cursor/commands/ (Cursor doesn't support command frontmatter)
 * Skills: Agent Skills standard with SKILL.md in .cursor/skills/{name}/
 * Reference files are copied to skill subdirectories
 *
 * Note: Agent Skills in Cursor require nightly channel and are agent-decided rules.
 */
export function transformCursor(commands, skills, distDir, patterns = null) {
  const cursorDir = path.join(distDir, 'cursor');
  const commandsDir = path.join(cursorDir, '.cursor/commands');
  const skillsDir = path.join(cursorDir, '.cursor/skills');

  cleanDir(cursorDir);
  ensureDir(commandsDir);
  ensureDir(skillsDir);

  // Commands: Body only (Cursor doesn't support command frontmatter/args)
  for (const command of commands) {
    const commandBody = replacePlaceholders(command.body, 'cursor');
    const outputPath = path.join(commandsDir, `${command.name}.md`);
    writeFile(outputPath, commandBody);
  }

  // Skills: Agent Skills standard with SKILL.md in subdirectories
  let refCount = 0;
  for (const skill of skills) {
    const skillDir = path.join(skillsDir, skill.name);

    const frontmatter = generateYamlFrontmatter({
      name: skill.name,
      description: skill.description,
      ...(skill.license && { license: skill.license })
    });

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

  const refInfo = refCount > 0 ? ` (${refCount} reference files)` : '';
  console.log(`✓ Cursor: ${commands.length} commands, ${skills.length} skills${refInfo}`);
}
