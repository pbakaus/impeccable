import path from 'path';
import { cleanDir, ensureDir, writeFile } from '../utils.js';

/**
 * Codex Transformer (Full Featured - Custom Prompts + Modular Skills)
 * 
 * Commands: Uses argument-hint format with $VARIABLE placeholders
 * Skills: Creates modular files with guiding AGENTS.md
 */
export function transformCodex(commands, skills, distDir) {
  const codexDir = path.join(distDir, 'codex');
  const promptsDir = path.join(codexDir, 'prompts');
  
  cleanDir(codexDir);
  ensureDir(promptsDir);
  
  // Commands: Transform to Codex prompt format
  for (const command of commands) {
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
    
    // Transform {{argname}} to $ARGNAME for Codex
    let body = command.body;
    body = body.replace(/\{\{([^}]+)\}\}/g, (match, argName) => {
      return `$${argName.toUpperCase()}`;
    });
    
    const content = `${yamlLines.join('\n')}\n\n${body}`;
    const outputPath = path.join(promptsDir, `${command.name}.md`);
    writeFile(outputPath, content);
  }
  
  // Skills: Create modular files (body only)
  const skillEntries = [];
  for (const skill of skills) {
    const outputPath = path.join(codexDir, `AGENTS.${skill.name}.md`);
    writeFile(outputPath, skill.body);
    skillEntries.push({
      name: skill.name,
      description: skill.description,
      file: `AGENTS.${skill.name}.md`
    });
  }
  
  // Create main AGENTS.md that guides Codex to the right skill files
  const agentsMd = [
    '# Codex Agent Instructions',
    '',
    'This repository contains specialized skills for different tasks. When the user requests work in a particular domain, read the corresponding skill file for detailed guidance.',
    '',
    '## Available Skills',
    '',
    'Each skill provides deep expertise in its domain. Use the descriptions below to decide which skill file to read:',
    '',
    ...skillEntries.map(skill => 
      `### ${skill.name}\n\n**When to use**: ${skill.description}\n\n**Read**: \`${skill.file}\` for complete instructions.\n`
    ),
    '',
    '## How to Use Skills',
    '',
    '1. Identify the user\'s request domain',
    '2. Match it to a skill description above',
    '3. Read the corresponding skill file',
    '4. Follow the guidance in that file',
    '',
    'Multiple skills can be combined when the task requires expertise from different domains.'
  ].join('\n');
  
  writeFile(path.join(codexDir, 'AGENTS.md'), agentsMd);
  
  console.log(`✓ Codex: ${commands.length} prompts, ${skills.length} skills (modular)`);
}

