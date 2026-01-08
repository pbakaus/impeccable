import path from 'path';
import { cleanDir, ensureDir, writeFile, generateYamlFrontmatter, replacePlaceholders } from '../utils.js';

/**
 * Gemini Transformer (Full Featured - TOML Commands + Agent Skills)
 *
 * Commands: Converts to TOML format with {{args}} placeholders in .gemini/commands/
 * Skills: Uses Agent Skills standard with SKILL.md in .gemini/skills/{name}/
 * Reference files are copied to skill subdirectories
 *
 * Note: Gemini CLI skills require gemini-cli@preview and enabling via /settings
 *
 * @param {Object} options - Optional settings
 * @param {string} options.prefix - Prefix to add to command names (e.g., 'i-')
 * @param {string} options.outputSuffix - Suffix for output directory (e.g., '-prefixed')
 */
export function transformGemini(commands, skills, distDir, patterns = null, options = {}) {
  const { prefix = '', outputSuffix = '' } = options;
  const geminiDir = path.join(distDir, `gemini${outputSuffix}`);
  const commandsDir = path.join(geminiDir, '.gemini/commands');
  const skillsDir = path.join(geminiDir, '.gemini/skills');

  cleanDir(geminiDir);
  ensureDir(commandsDir);
  ensureDir(skillsDir);

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

  // Skills: Use Agent Skills standard with SKILL.md in subdirectories
  let refCount = 0;
  for (const skill of skills) {
    const skillDir = path.join(skillsDir, skill.name);

    const frontmatter = generateYamlFrontmatter({
      name: skill.name,
      description: skill.description,
    });

    const skillBody = replacePlaceholders(skill.body, 'gemini');
    const content = `${frontmatter}\n\n${skillBody}`;
    const outputPath = path.join(skillDir, 'SKILL.md');
    writeFile(outputPath, content);

    // Copy reference files if they exist
    if (skill.references && skill.references.length > 0) {
      const refDir = path.join(skillDir, 'reference');
      ensureDir(refDir);
      for (const ref of skill.references) {
        const refOutputPath = path.join(refDir, `${ref.name}.md`);
        const refContent = replacePlaceholders(ref.content, 'gemini');
        writeFile(refOutputPath, refContent);
        refCount++;
      }
    }
  }

  const refInfo = refCount > 0 ? ` (${refCount} reference files)` : '';
  const prefixInfo = prefix ? ` [${prefix}prefixed]` : '';
  console.log(`✓ Gemini${prefixInfo}: ${commands.length} commands (TOML), ${skills.length} skills${refInfo}`);
}

