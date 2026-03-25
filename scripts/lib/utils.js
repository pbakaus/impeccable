import fs from 'fs';
import path from 'path';

/**
 * Parse frontmatter from markdown content
 * Returns { frontmatter: object, body: string }
 */
export function parseFrontmatter(content) {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const [, frontmatterText, body] = match;
  const frontmatter = {};

  // Simple YAML parser (handles basic key-value and arrays)
  const lines = frontmatterText.split('\n');
  let currentKey = null;
  let currentArray = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    // Calculate indent level
    const leadingSpaces = line.length - line.trimStart().length;
    const trimmed = line.trim();

    // Array item at level 2 (nested under a key)
    if (trimmed.startsWith('- ') && leadingSpaces >= 2) {
      if (currentArray) {
        if (trimmed.startsWith('- name:')) {
          // New object in array
          const obj = {};
          obj.name = trimmed.slice(7).trim();
          currentArray.push(obj);
        }
      }
      continue;
    }

    // Property of array object (indented further)
    if (leadingSpaces >= 4 && currentArray && currentArray.length > 0) {
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const key = trimmed.slice(0, colonIndex).trim();
        const value = trimmed.slice(colonIndex + 1).trim();
        const lastObj = currentArray[currentArray.length - 1];
        lastObj[key] = value === 'true' ? true : value === 'false' ? false : value;
      }
      continue;
    }

    // Top-level key-value pair
    if (leadingSpaces === 0) {
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const key = trimmed.slice(0, colonIndex).trim();
        const value = trimmed.slice(colonIndex + 1).trim();

        if (value) {
          // Strip YAML quotes
          const unquoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
            ? value.slice(1, -1)
            : value;
          frontmatter[key] = unquoted === 'true' ? true : unquoted === 'false' ? false : unquoted;
          currentKey = key;
          currentArray = null;
        } else {
          // Start of array
          currentKey = key;
          currentArray = [];
          frontmatter[key] = currentArray;
        }
      }
    }
  }

  return { frontmatter, body: body.trim() };
}

/**
 * Recursively read all .md files from a directory
 */
export function readFilesRecursive(dir, fileList = []) {
  if (!fs.existsSync(dir)) {
    return fileList;
  }

  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      readFilesRecursive(filePath, fileList);
    } else if (file.endsWith('.md')) {
      fileList.push(filePath);
    }
  }

  return fileList;
}

/**
 * Read and parse all source files (unified skills architecture)
 * All source lives in source/skills/{name}/SKILL.md
 * Returns { skills } where each skill has userInvocable flag
 */
export function readSourceFiles(rootDir) {
  const skillsDir = path.join(rootDir, 'source/skills');

  const skills = [];

  if (fs.existsSync(skillsDir)) {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(skillsDir, entry.name);

      if (entry.isDirectory()) {
        // Directory-based skill with potential references
        const skillMdPath = path.join(entryPath, 'SKILL.md');
        if (fs.existsSync(skillMdPath)) {
          const content = fs.readFileSync(skillMdPath, 'utf-8');
          const { frontmatter, body } = parseFrontmatter(content);

          // Read reference files if they exist
          const references = [];
          const referenceDir = path.join(entryPath, 'reference');
          if (fs.existsSync(referenceDir)) {
            const refFiles = fs.readdirSync(referenceDir).filter(f => f.endsWith('.md'));
            for (const refFile of refFiles) {
              const refPath = path.join(referenceDir, refFile);
              const refContent = fs.readFileSync(refPath, 'utf-8');
              references.push({
                name: path.basename(refFile, '.md'),
                content: refContent,
                filePath: refPath
              });
            }
          }

          skills.push({
            name: frontmatter.name || entry.name,
            description: frontmatter.description || '',
            license: frontmatter.license || '',
            compatibility: frontmatter.compatibility || '',
            metadata: frontmatter.metadata || null,
            allowedTools: frontmatter['allowed-tools'] || '',
            userInvocable: frontmatter['user-invocable'] === true || frontmatter['user-invocable'] === 'true',
            argumentHint: frontmatter['argument-hint'] || '',
            context: frontmatter.context || null,
            body,
            filePath: skillMdPath,
            references
          });
        }
      }
    }
  }

  return { skills };
}

/**
 * Ensure directory exists, create if needed
 */
export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Clean directory (remove all contents)
 */
export function cleanDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Write file with automatic directory creation
 */
export function writeFile(filePath, content) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Extract patterns from frontend-design SKILL.md
 * Parses **DO**: and **DON'T**: lines, grouped by section headings
 * Returns { patterns: [...], antipatterns: [...] }
 */
export function readPatterns(rootDir) {
  const skillPath = path.join(rootDir, 'source/skills/frontend-design/SKILL.md');

  if (!fs.existsSync(skillPath)) {
    return { patterns: [], antipatterns: [] };
  }

  const content = fs.readFileSync(skillPath, 'utf-8');
  const lines = content.split('\n');

  const patternsMap = {};  // category -> items[]
  const antipatternsMap = {};  // category -> items[]
  let currentSection = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track section headings (### Typography, ### Color & Theme, etc.)
    if (trimmed.startsWith('### ')) {
      currentSection = trimmed.slice(4).trim();
      // Normalize "Color & Theme" to "Color & Contrast" for consistency
      if (currentSection === 'Color & Theme') {
        currentSection = 'Color & Contrast';
      }
      continue;
    }

    // Parse **DO**: lines
    if (trimmed.startsWith('**DO**:') && currentSection) {
      const item = trimmed.slice(7).trim();
      if (!patternsMap[currentSection]) {
        patternsMap[currentSection] = [];
      }
      patternsMap[currentSection].push(item);
      continue;
    }

    // Parse **DON'T**: lines
    if (trimmed.startsWith("**DON'T**:") && currentSection) {
      const item = trimmed.slice(10).trim();
      if (!antipatternsMap[currentSection]) {
        antipatternsMap[currentSection] = [];
      }
      antipatternsMap[currentSection].push(item);
      continue;
    }
  }

  // Convert maps to arrays in consistent order
  const sectionOrder = ['Typography', 'Color & Contrast', 'Layout & Space', 'Visual Details', 'Motion', 'Interaction', 'Responsive', 'UX Writing'];

  const patterns = [];
  const antipatterns = [];

  for (const section of sectionOrder) {
    if (patternsMap[section] && patternsMap[section].length > 0) {
      patterns.push({ name: section, items: patternsMap[section] });
    }
    if (antipatternsMap[section] && antipatternsMap[section].length > 0) {
      antipatterns.push({ name: section, items: antipatternsMap[section] });
    }
  }

  return { patterns, antipatterns };
}

/**
 * Provider-specific placeholders
 */
export const PROVIDER_PLACEHOLDERS = {
  'claude-code': {
    model: 'Claude',
    config_file: 'CLAUDE.md',
    ask_instruction: 'STOP and call the AskUserQuestion tool to clarify.',
    command_prefix: '/'
  },
  'cursor': {
    model: 'the model',
    config_file: '.cursorrules',
    ask_instruction: 'ask the user directly to clarify what you cannot infer.',
    command_prefix: '/'
  },
  'gemini': {
    model: 'Gemini',
    config_file: 'GEMINI.md',
    ask_instruction: 'ask the user directly to clarify what you cannot infer.',
    command_prefix: '/'
  },
  'codex': {
    model: 'GPT',
    config_file: 'AGENTS.md',
    ask_instruction: 'ask the user directly to clarify what you cannot infer.',
    command_prefix: '$'
  },
  'agents': {
    model: 'the model',
    config_file: '.github/copilot-instructions.md',
    ask_instruction: 'ask the user directly to clarify what you cannot infer.',
    command_prefix: '/'
  },
  'kiro': {
    model: 'Claude',
    config_file: '.kiro/settings.json',
    ask_instruction: 'ask the user directly to clarify what you cannot infer.',
    command_prefix: '/'
  },
  opencode: {
    model: 'Claude',
    config_file: 'AGENTS.md',
    ask_instruction: 'STOP and call the `question` tool to clarify.',
    command_prefix: '/'
  },
  'pi': {
    model: 'the model',
    config_file: 'AGENTS.md',
    ask_instruction: 'ask the user directly to clarify what you cannot infer.',
    command_prefix: '/'
  },
  'trae': {
    model: 'the model',
    config_file: 'RULES.md',
    ask_instruction: 'ask the user directly to clarify what you cannot infer.',
    command_prefix: '/'
  }
};

/**
 * Replace all {{placeholder}} tokens with provider-specific values
 */
/**
 * Prefix skill cross-references in body text.
 * Replaces patterns like `/skillname` and `the skillname skill` with prefixed versions.
 *
 * @param {string} content - The skill body text
 * @param {string} prefix - The prefix to add (e.g., 'i-')
 * @param {string[]} skillNames - Array of all skill names
 * @param {string} commandPrefix - The command invocation prefix (e.g., '/' or '$')
 */
export function prefixSkillReferences(content, prefix, skillNames, commandPrefix = '/') {
  if (!prefix || !skillNames || skillNames.length === 0) return content;

  let result = content;
  // Sort by length descending to avoid partial matches (e.g. 'teach-impeccable' before 'teach')
  const sorted = [...skillNames].sort((a, b) => b.length - a.length);

  for (const name of sorted) {
    const prefixed = `${prefix}${name}`;

    // Replace command invocations (e.g., `/skillname` or `$skillname`) with prefixed versions
    const escapedPrefix = escapeRegex(commandPrefix);
    result = result.replace(
      new RegExp(`${escapedPrefix}(?=${escapeRegex(name)}(?:[^a-zA-Z0-9_-]|$))`, 'g'),
      `${commandPrefix}${prefix}`
    );

    // Replace `the skillname skill` references
    result = result.replace(
      new RegExp(`(the) ${escapeRegex(name)} skill`, 'gi'),
      (_, article) => `${article} ${prefixed} skill`
    );
  }

  return result;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const EXCLUDED_FROM_SUGGESTIONS = new Set(['teach-impeccable', 'i-teach-impeccable']);

export function replacePlaceholders(content, provider, commandNames = [], allSkillNames = []) {
  const placeholders = PROVIDER_PLACEHOLDERS[provider] || PROVIDER_PLACEHOLDERS['cursor'];
  const cmdPrefix = placeholders.command_prefix || '/';
  const commandList = commandNames
    .filter(n => !EXCLUDED_FROM_SUGGESTIONS.has(n))
    .map(n => `${cmdPrefix}${n}`)
    .join(', ');

  let result = content
    .replace(/\{\{model\}\}/g, placeholders.model)
    .replace(/\{\{config_file\}\}/g, placeholders.config_file)
    .replace(/\{\{ask_instruction\}\}/g, placeholders.ask_instruction)
    .replace(/\{\{command_prefix\}\}/g, cmdPrefix)
    .replace(/\{\{available_commands\}\}/g, commandList);

  // Replace `/skillname` invocations with the correct command prefix for this provider
  // (e.g., `/normalize` → `$normalize` for Codex)
  if (cmdPrefix !== '/' && allSkillNames.length > 0) {
    const sorted = [...allSkillNames].sort((a, b) => b.length - a.length);
    for (const name of sorted) {
      result = result.replace(
        new RegExp(`\\/(?=${escapeRegex(name)}(?:[^a-zA-Z0-9_-]|$))`, 'g'),
        cmdPrefix
      );
    }
  }

  return result;
}

/**
 * Generate YAML frontmatter string
 */
export function generateYamlFrontmatter(data) {
  const lines = ['---'];

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        if (typeof item === 'object') {
          lines.push(`  - name: ${item.name}`);
          if (item.description) lines.push(`    description: ${item.description}`);
          if (item.required !== undefined) lines.push(`    required: ${item.required}`);
        } else {
          lines.push(`  - ${item}`);
        }
      }
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else {
      const needsQuoting = typeof value === 'string' && /^[\[{]/.test(value);
      lines.push(`${key}: ${needsQuoting ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}
