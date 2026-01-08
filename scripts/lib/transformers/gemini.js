import path from 'path';
import { cleanDir, ensureDir, writeFile, replacePlaceholders } from '../utils.js';

/**
 * Gemini Transformer (Full Featured - TOML + Modular Skills)
 *
 * Commands: Converts to TOML format with {{args}} placeholders
 * Skills: Creates modular files imported via @./GEMINI.{name}.md syntax
 * Reference files are inlined into the main skill file for Gemini
 *
 * @param {Object} options - Optional settings
 * @param {string} options.prefix - Prefix to add to command names (e.g., 'i-')
 * @param {string} options.outputSuffix - Suffix for output directory (e.g., '-prefixed')
 */
export function transformGemini(commands, skills, distDir, patterns = null, options = {}) {
  const { prefix = '', outputSuffix = '' } = options;
  const geminiDir = path.join(distDir, `gemini${outputSuffix}`);
  const commandsDir = path.join(geminiDir, '.gemini/commands');

  cleanDir(geminiDir);
  ensureDir(commandsDir);

  // Commands: Transform to TOML
  for (const command of commands) {
    const commandName = `${prefix}${command.name}`;
    // First replace our placeholders, then replace remaining {{arg}} with {{args}}
    let prompt = replacePlaceholders(command.body, 'gemini');
    prompt = prompt.replace(/\{\{[^}]+\}\}/g, '{{args}}');

    const toml = [
      `description = "${command.description.replace(/"/g, '\\"')}"`,
      `prompt = """`,
      prompt,
      `"""`
    ].join('\n');

    const outputPath = path.join(commandsDir, `${commandName}.toml`);
    writeFile(outputPath, toml);
  }

  // Skills: Create modular files (with references inlined)
  let refCount = 0;
  for (const skill of skills) {
    let content = skill.body;

    // Merge patterns body into frontend-design skill (before Domain Reference Files section)
    if (skill.name === 'frontend-design' && patterns && patterns.body) {
      const insertPoint = content.indexOf('---\n\n## Domain Reference Files');
      if (insertPoint > -1) {
        content = content.slice(0, insertPoint) + '\n\n' + patterns.body + '\n\n' + content.slice(insertPoint);
      } else {
        content += '\n\n' + patterns.body;
      }
    }

    // Inline reference files if they exist
    if (skill.references && skill.references.length > 0) {
      const refSections = skill.references.map(ref => {
        refCount++;
        const refContent = replacePlaceholders(ref.content, 'gemini');
        return `\n\n---\n\n## Reference: ${ref.name}\n\n${refContent}`;
      });
      content += refSections.join('');
    }

    // Replace all placeholders
    content = replacePlaceholders(content, 'gemini');

    const outputPath = path.join(geminiDir, `GEMINI.${skill.name}.md`);
    writeFile(outputPath, content);
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

  const refInfo = refCount > 0 ? ` (${refCount} refs inlined)` : '';
  const prefixInfo = prefix ? ` [${prefix}prefixed]` : '';
  console.log(`✓ Gemini${prefixInfo}: ${commands.length} commands (TOML), ${skills.length} skills (modular)${refInfo}`);
}

