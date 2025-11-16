import path from 'path';
import { cleanDir, ensureDir, writeFile } from '../utils.js';

/**
 * Cursor Transformer (Downgraded - No Frontmatter/Args)
 * 
 * Strips all frontmatter and metadata, outputs body only.
 * Cursor doesn't support arguments or frontmatter.
 */
export function transformCursor(commands, skills, distDir) {
  const commandsDir = path.join(distDir, 'cursor/commands');
  const rulesDir = path.join(distDir, 'cursor/rules');
  
  cleanDir(path.join(distDir, 'cursor'));
  ensureDir(commandsDir);
  ensureDir(rulesDir);
  
  // Commands: Body only (no frontmatter)
  for (const command of commands) {
    const outputPath = path.join(commandsDir, `${command.name}.md`);
    writeFile(outputPath, command.body);
  }
  
  // Skills: Body only (no frontmatter)
  for (const skill of skills) {
    const outputPath = path.join(rulesDir, `${skill.name}.md`);
    writeFile(outputPath, skill.body);
  }
  
  console.log(`✓ Cursor: ${commands.length} commands, ${skills.length} skills (downgraded)`);
}

