import path from 'path';
import { cleanDir, ensureDir, writeFile } from '../utils.js';

/**
 * Gemini Transformer (Full Featured - TOML + Modular Skills)
 * 
 * Commands: Converts to TOML format with {{args}} placeholders
 * Skills: Creates modular files imported via @./GEMINI.{name}.md syntax
 */
export function transformGemini(commands, skills, distDir) {
  const geminiDir = path.join(distDir, 'gemini');
  const commandsDir = path.join(geminiDir, 'commands');
  
  cleanDir(geminiDir);
  ensureDir(commandsDir);
  
  // Commands: Transform to TOML
  for (const command of commands) {
    // Replace named placeholders with {{args}}
    let prompt = command.body.replace(/\{\{[^}]+\}\}/g, '{{args}}');
    
    const toml = [
      `description = "${command.description.replace(/"/g, '\\"')}"`,
      `prompt = """`,
      prompt,
      `"""`
    ].join('\n');
    
    const outputPath = path.join(commandsDir, `${command.name}.toml`);
    writeFile(outputPath, toml);
  }
  
  // Skills: Create modular files
  for (const skill of skills) {
    const outputPath = path.join(geminiDir, `GEMINI.${skill.name}.md`);
    writeFile(outputPath, skill.body);
  }
  
  // Create main GEMINI.md that imports skill files
  const geminiMd = [
    '# Gemini Context',
    '',
    'This repository contains specialized skills for different tasks. When you detect a user request in a particular domain, the corresponding skill file will be automatically loaded to provide detailed guidance.',
    '',
    '## Available Skills',
    '',
    'Each skill provides deep expertise in its domain. The skills below are automatically imported and will guide your responses:',
    '',
    ...skills.map(skill => 
      `### ${skill.name}\n\n**When to use**: ${skill.description}\n\n@./GEMINI.${skill.name}.md\n`
    ),
    '',
    '## How Skills Work',
    '',
    '1. Skills are automatically loaded via the import statements above',
    '2. When a user request matches a skill domain, apply that skill\'s guidance',
    '3. Multiple skills can be combined when the task requires expertise from different domains',
    '4. Follow the detailed instructions provided in each imported skill file'
  ].join('\n');
  
  writeFile(path.join(geminiDir, 'GEMINI.md'), geminiMd);
  
  console.log(`✓ Gemini: ${commands.length} commands (TOML), ${skills.length} skills (modular)`);
}

