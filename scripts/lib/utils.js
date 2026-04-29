import fs from 'fs';
import path from 'path';

// Per-project artifacts live inside `scripts/` of an installed skill but
// belong to the consuming project, not the distributable skill. The build
// excludes them from dist, and the harness-sync step preserves them across
// the rm+recopy so local state isn't destroyed on every rebuild.
// - config.json: live-mode inject target list for the current project.
//   Written by the agent at first /impeccable live; tied to the project's
//   filesystem layout. Losing it resets the user's glob + exclusions.
export const PER_PROJECT_SCRIPT_ARTIFACTS = new Set(['config.json']);

// Walk the harness-dir skill tree and return any per-project script
// artifacts found, ready for restoration after a full sync rm+recopy.
// Returns [{ relPath, content: Buffer }], where relPath is relative to
// the passed-in rootDir (typically `<configDir>/skills`).
export function stashPerProjectArtifacts(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      // Only preserve files inside a skill's scripts/ directory.
      if (path.basename(path.dirname(p)) !== 'scripts') continue;
      if (PER_PROJECT_SCRIPT_ARTIFACTS.has(entry.name)) {
        out.push({ relPath: path.relative(rootDir, p), content: fs.readFileSync(p) });
      }
    }
  };
  walk(rootDir);
  return out;
}

export function restorePerProjectArtifacts(rootDir, stashed) {
  for (const { relPath, content } of stashed) {
    const target = path.join(rootDir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

/**
 * Parse frontmatter from markdown content
 * Returns { frontmatter: object, body: string }
 */
export function parseFrontmatter(content) {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const [, frontmatterText, body] = match;
  const frontmatter = {};

  // Simple YAML parser (handles basic key-value and arrays)
  const lines = frontmatterText.split(/\r?\n/);
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
        } else {
          // Simple string item in array
          currentArray.push(trimmed.slice(2));
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
        const isQuoted = /^(".*"|'.*')$/.test(value);
        const unquotedValue = isQuoted ? value.slice(1, -1) : value;
        const shouldCoerceBoolean =
          key === 'user-invocable' || key === 'user-invokable' || !isQuoted;

        if (value) {
          frontmatter[key] = shouldCoerceBoolean
            ? unquotedValue === 'true'
              ? true
              : unquotedValue === 'false'
                ? false
                : unquotedValue
            : unquotedValue;
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

          // Read script files if they exist. PER_PROJECT_SCRIPT_ARTIFACTS
          // (defined at module top) are excluded from the distributable skill
          // so the build never bundles one project's state into another's.
          const scripts = [];
          const scriptsDir = path.join(entryPath, 'scripts');
          if (fs.existsSync(scriptsDir)) {
            const scriptFiles = fs.readdirSync(scriptsDir).filter(f => {
              if (PER_PROJECT_SCRIPT_ARTIFACTS.has(f)) return false;
              return fs.statSync(path.join(scriptsDir, f)).isFile();
            });
            for (const scriptFile of scriptFiles) {
              const scriptPath = path.join(scriptsDir, scriptFile);
              const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
              scripts.push({
                name: scriptFile,
                content: scriptContent,
                filePath: scriptPath
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
            references,
            scripts
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
 * Extract DO/DON'T patterns from a skill markdown file, grouped by section
 * (h3 `### ` headings). Recognizes both formats:
 *   - Markdown bullet form:  `**DO**: …`  /  `**DON'T**: …`
 *   - Prose form:            `DO …`       /  `DO NOT …`
 *
 * Defaults to the main impeccable SKILL.md but accepts any relative path so
 * rules in `src/detect-antipatterns.mjs` can anchor to register-specific
 * reference files (e.g. `reference/editorial.md`) via an optional `skillFile`
 * field. Callers that don't pass `relativePath` get the legacy behavior.
 *
 * Returns { patterns: [...], antipatterns: [...] }
 */
// Curated short-list for the homepage Antidote section. Intentionally
// hand-written (not auto-extracted) so the copy stays tight and
// editorial. The long-form catalog lives on /slop — this is the teaser.
const CURATED_CATEGORIES = [
  {
    name: 'Typography',
    do: [
      'Pair a distinctive display face with a restrained body face; vary across projects.',
      'Use a ≥1.25 scale ratio between hierarchy steps. Flat scales read as bland.',
      'Cap body line length at 65–75ch. Wider is fatiguing.',
    ],
    dont: [
      'Inter, Roboto, Plex, Fraunces, or any other reflex default. Look further.',
      'Monospace as lazy shorthand for "technical."',
      'Long passages in uppercase. Reserve all-caps for short labels.',
    ],
  },
  {
    name: 'Color & Contrast',
    do: [
      'Use OKLCH. Reduce chroma near lightness extremes.',
      'Tint neutrals toward the brand hue. Chroma 0.005–0.01 is enough.',
      'Pick a color strategy before picking colors (Restrained, Committed, Full, Drenched).',
    ],
    dont: [
      'Pure #000 or #fff. Always tint.',
      'Dark mode + purple-to-cyan gradients. The AI tell.',
      'Gradient text via background-clip. Use weight or size for emphasis.',
    ],
  },
  {
    name: 'Layout & Space',
    do: [
      'Vary spacing for rhythm. Tight groupings, generous separations.',
      'Use the simplest tool: Flexbox for 1D, Grid for 2D, plain flow often enough.',
      'Let whitespace carry hierarchy before reaching for color or scale.',
    ],
    dont: [
      'Wrap everything in cards. Nested cards are always wrong.',
      'Identical card grids of icon + heading + text, repeated endlessly.',
      'The hero-metric template: big number, small label, supporting stats, gradient accent.',
    ],
  },
  {
    name: 'Visual Details',
    do: [
      'Commit to an aesthetic direction and execute it with precision.',
      'Use ornament only where it earns its place.',
    ],
    dont: [
      'Side-stripe borders (border-left/-right > 1px). The dashboard tell.',
      'Glassmorphism everywhere. Rare and purposeful or nothing.',
      'Rounded rectangles with generic drop shadows. "Could be any AI output."',
    ],
  },
  {
    name: 'Motion',
    do: [
      'Use transform and opacity. Animate the composited properties only.',
      'Ease out with exponential curves (quart / quint / expo).',
      'Respect prefers-reduced-motion on every transition.',
    ],
    dont: [
      'Animate layout (width, height, padding, margin).',
      'Bounce or elastic easing. Feels dated and tacky.',
      'Decorative motion for its own sake. Motion should signal state.',
    ],
  },
  {
    name: 'Interaction',
    do: [
      'Use optimistic UI: update immediately, sync later.',
      'Design empty states that teach the interface, not just say "nothing here."',
      'Progressive disclosure: start simple, reveal sophistication on demand.',
    ],
    dont: [
      'Make every button primary. Hierarchy matters.',
      'Default to a modal. Exhaust inline alternatives first.',
      'Repeat information the user can already see.',
    ],
  },
];

export function readPatterns(_rootDir, _relativePath) {
  // Hand-curated list — see CURATED_CATEGORIES above. The homepage
  // Antidote teaser uses this; the full catalog lives on /slop.
  return {
    patterns: CURATED_CATEGORIES.map((c) => ({ name: c.name, items: c.do })),
    antipatterns: CURATED_CATEGORIES.map((c) => ({ name: c.name, items: c.dont })),
  };
}

// Previous SKILL.md parser retained below but disabled; kept as a
// reference for how prefix-style extraction used to work.
function _legacyReadPatterns(rootDir, relativePath = 'source/skills/impeccable/SKILL.md') {
  const skillPath = path.join(rootDir, relativePath);

  if (!fs.existsSync(skillPath)) {
    return { patterns: [], antipatterns: [] };
  }

  const content = fs.readFileSync(skillPath, 'utf-8');
  const lines = content.split('\n');

  const patternsMap = {};  // category -> items[]
  const antipatternsMap = {};  // category -> items[]
  let currentSection = null;

  const pushPattern = (item) => {
    if (!currentSection) return;
    if (!patternsMap[currentSection]) patternsMap[currentSection] = [];
    patternsMap[currentSection].push(item);
  };
  const pushAntipattern = (item) => {
    if (!currentSection) return;
    if (!antipatternsMap[currentSection]) antipatternsMap[currentSection] = [];
    antipatternsMap[currentSection].push(item);
  };

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

    // Markdown bullet form (legacy): **DO**: ... and **DON'T**: ...
    if (trimmed.startsWith('**DO**:')) {
      pushPattern(trimmed.slice(7).trim());
      continue;
    }
    if (trimmed.startsWith("**DON'T**:")) {
      pushAntipattern(trimmed.slice(10).trim());
      continue;
    }

    // XML-block prose form (current). Both space and colon variants:
    //   "DO NOT use ..."  /  "DO NOT: Use ..."
    //   "DO use ..."      /  "DO: Use ..."
    // IMPORTANT: check `DO NOT` BEFORE `DO` so the prefix doesn't get
    // gobbled by the wrong matcher.
    if (trimmed.startsWith('DO NOT: ')) {
      pushAntipattern(trimmed.slice('DO NOT: '.length).trim());
      continue;
    }
    if (trimmed.startsWith('DO NOT ')) {
      pushAntipattern(trimmed.slice('DO NOT '.length).trim());
      continue;
    }
    if (trimmed.startsWith('DO: ')) {
      pushPattern(trimmed.slice('DO: '.length).trim());
      continue;
    }
    if (trimmed.startsWith('DO ')) {
      pushPattern(trimmed.slice('DO '.length).trim());
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
    ask_instruction: "STOP and use Codex's structured user-input/question tool when available; if unavailable, ask directly in chat to clarify what you cannot infer.",
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
  'qoder': {
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
  },
  'rovo-dev': {
    model: 'Rovo Dev',
    config_file: 'AGENTS.md',
    ask_instruction: 'ask the user directly to clarify what you cannot infer.',
    command_prefix: '/'
  }
};

/**
 * Replace all {{placeholder}} tokens with provider-specific values
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const EXCLUDED_FROM_SUGGESTIONS = new Set([
  'impeccable',               // foundational skill, not a steering command
  'teach-impeccable',         // deprecated shim
  'frontend-design',          // deprecated shim
]);

// Sub-commands of /impeccable that should appear in {{available_commands}}.
// These are the commands that audit/critique/etc. reference when suggesting next steps.
const IMPECCABLE_SUB_COMMANDS = [
  'adapt', 'animate', 'audit', 'bolder', 'clarify', 'colorize',
  'critique', 'delight', 'distill', 'document', 'harden', 'layout',
  'onboard', 'optimize', 'overdrive', 'polish', 'quieter', 'shape', 'typeset',
];

export function replacePlaceholders(content, provider, commandNames = [], allSkillNames = []) {
  const placeholders = PROVIDER_PLACEHOLDERS[provider] || PROVIDER_PLACEHOLDERS['cursor'];
  const cmdPrefix = placeholders.command_prefix || '/';

  // Build the available_commands list.
  // After the v3.0 consolidation, commands are sub-commands of /impeccable.
  // If there's only one user-invocable skill (impeccable), generate sub-command references.
  // Otherwise fall back to listing skill names (backwards compat for forks).
  const nonExcluded = commandNames.filter(n => !EXCLUDED_FROM_SUGGESTIONS.has(n));
  let commandList;
  if (nonExcluded.length === 0) {
    // Single-skill architecture: list sub-commands as /impeccable <sub>
    commandList = IMPECCABLE_SUB_COMMANDS
      .map(n => `${cmdPrefix}impeccable ${n}`)
      .join(', ');
  } else {
    // Multi-skill architecture (backwards compat)
    commandList = nonExcluded.map(n => `${cmdPrefix}${n}`).join(', ');
  }

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
 * Decide whether a YAML scalar string value must be quoted to survive parsing.
 *
 * Plain (unquoted) YAML scalars cannot contain `: ` or ` #`, cannot start with
 * a YAML indicator character, cannot look like a boolean/null/number, and
 * cannot carry leading/trailing whitespace. parseFrontmatter strips surrounding
 * quotes on input, so we must re-detect the need to quote on output — otherwise
 * descriptions like "Handles: critique/review..." round-trip into invalid YAML.
 */
function yamlNeedsQuoting(value) {
  if (typeof value !== 'string') return false;
  if (value === '') return true;
  // Leading or trailing whitespace
  if (/^\s|\s$/.test(value)) return true;
  // Starts with a YAML flow/indicator character
  if (/^[\[\]{},&*!|>'"%@`#]/.test(value)) return true;
  // Starts with `?`, `:`, or `-` followed by space or end of string
  if (/^[?:-](\s|$)/.test(value)) return true;
  // Contains `: ` (ends plain scalar) or ` #` (starts comment), or ends with `:`
  if (/: |\s#|:$/.test(value)) return true;
  // Reserved keywords that YAML 1.1 parsers coerce to boolean/null
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) return true;
  // Looks like a number
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) return true;
  return false;
}

function formatYamlScalar(value) {
  if (typeof value !== 'string') return String(value);
  if (yamlNeedsQuoting(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

function appendYamlObject(lines, data, indent = 0) {
  const space = ' '.repeat(indent);

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${space}${key}:`);
      for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          lines.push(`${space}  -`);
          appendYamlObject(lines, item, indent + 4);
        } else {
          lines.push(`${space}  - ${formatYamlScalar(item)}`);
        }
      }
    } else if (value && typeof value === 'object') {
      lines.push(`${space}${key}:`);
      appendYamlObject(lines, value, indent + 2);
    } else if (typeof value === 'boolean') {
      lines.push(`${space}${key}: ${value}`);
    } else {
      lines.push(`${space}${key}: ${formatYamlScalar(value)}`);
    }
  }
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
          lines.push(`  - name: ${formatYamlScalar(item.name)}`);
          if (item.description) lines.push(`    description: ${formatYamlScalar(item.description)}`);
          if (item.required !== undefined) lines.push(`    required: ${item.required}`);
        } else {
          lines.push(`  - ${formatYamlScalar(item)}`);
        }
      }
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${formatYamlScalar(value)}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * Generate a plain YAML document string.
 */
export function generateYamlDocument(data) {
  const lines = [];
  appendYamlObject(lines, data);
  return lines.join('\n');
}
