import path from 'path';
import { cleanDir, ensureDir, writeFile, generateYamlFrontmatter } from '../utils.js';

/**
 * Claude Code Transformer (Full Featured)
 * 
 * Keeps full YAML frontmatter with args support.
 * Skills stored in subdirectories with SKILL.md filename.
 */
export function transformClaudeCode(commands, skills, distDir) {
  const commandsDir = path.join(distDir, 'claude-code/commands');
  const skillsDir = path.join(distDir, 'claude-code/skills');
  
  cleanDir(path.join(distDir, 'claude-code'));
  ensureDir(commandsDir);
  ensureDir(skillsDir);
  
  // Commands: Keep frontmatter + body
  for (const command of commands) {
    const frontmatter = generateYamlFrontmatter({
      name: command.name,
      description: command.description,
      ...(command.args.length > 0 && { args: command.args })
    });
    
    const content = `${frontmatter}\n\n${command.body}`;
    const outputPath = path.join(commandsDir, `${command.name}.md`);
    writeFile(outputPath, content);
  }
  
  // Skills: Keep frontmatter + body in subdirectories
  for (const skill of skills) {
    const skillDir = path.join(skillsDir, skill.name);
    
    const frontmatter = generateYamlFrontmatter({
      name: skill.name,
      description: skill.description,
      ...(skill.license && { license: skill.license })
    });
    
    const content = `${frontmatter}\n\n${skill.body}`;
    const outputPath = path.join(skillDir, 'SKILL.md');
    writeFile(outputPath, content);
  }
  
  console.log(`✓ Claude Code: ${commands.length} commands, ${skills.length} skills`);
}

