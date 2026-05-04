import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import {
  parseFrontmatter,
  readFilesRecursive,
  readSourceFiles,
  ensureDir,
  cleanDir,
  writeFile,
  generateYamlFrontmatter,
  readPatterns,
  replacePlaceholders
} from '../../scripts/lib/utils.js';

// Temporary test directory
const TEST_DIR = path.join(process.cwd(), 'test-tmp');

describe('parseFrontmatter', () => {
  test('should parse basic frontmatter with simple key-value pairs', () => {
    const content = `---
name: test-skill
description: A test skill
---

This is the body content.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe('test-skill');
    expect(result.frontmatter.description).toBe('A test skill');
    expect(result.body).toBe('This is the body content.');
  });

  test('should parse frontmatter with argument-hint', () => {
    const content = `---
name: test-skill
description: A test skill
argument-hint: <output> [TARGET=<value>]
---

Body here.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe('test-skill');
    expect(result.frontmatter['argument-hint']).toBe('<output> [TARGET=<value>]');
  });

  test('should return empty frontmatter when no frontmatter present', () => {
    const content = 'Just some content without frontmatter.';
    const result = parseFrontmatter(content);

    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(content);
  });

  test('should handle empty body', () => {
    const content = `---
name: test
---
`;
    const result = parseFrontmatter(content);

    expect(result.frontmatter.name).toBe('test');
    expect(result.body).toBe('');
  });

  test('should handle frontmatter with license field', () => {
    const content = `---
name: skill-name
description: A skill
license: MIT
---

Skill body.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.license).toBe('MIT');
  });

  test('should parse user-invocable boolean', () => {
    const content = `---
name: test-skill
user-invocable: true
---

Body.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter['user-invocable']).toBe(true);
  });

  test('should parse quoted user-invocable boolean as true', () => {
    const content = `---
name: test-skill
user-invocable: 'true'
---

Body.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter['user-invocable']).toBe(true);
  });

  test('should keep quoted non-user-invocable booleans as plain strings', () => {
    const content = `---
name: test-skill
description: 'true'
---

Body.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.description).toBe('true');
  });

  test('should parse allowed-tools field', () => {
    const content = `---
name: test-skill
allowed-tools: Bash
---

Body.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter['allowed-tools']).toBe('Bash');
  });
});

describe('generateYamlFrontmatter', () => {
  test('should generate basic frontmatter', () => {
    const data = {
      name: 'test-skill',
      description: 'A test'
    };

    const result = generateYamlFrontmatter(data);
    expect(result).toContain('---');
    expect(result).toContain('name: test-skill');
    expect(result).toContain('description: A test');
  });

  test('should generate frontmatter with argument-hint', () => {
    const data = {
      name: 'test',
      description: 'Test skill',
      'argument-hint': '<output> [TARGET=<value>]'
    };

    const result = generateYamlFrontmatter(data);
    expect(result).toContain('argument-hint: <output> [TARGET=<value>]');
  });

  test('should generate frontmatter with boolean', () => {
    const data = {
      name: 'test',
      description: 'Test',
      'user-invocable': true
    };

    const result = generateYamlFrontmatter(data);
    expect(result).toContain('user-invocable: true');
  });

  test('should roundtrip: generate and parse back', () => {
    const original = {
      name: 'roundtrip-test',
      description: 'Testing roundtrip',
      'argument-hint': '<arg1>'
    };

    const yaml = generateYamlFrontmatter(original);
    const content = `${yaml}\n\nBody content`;
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter.name).toBe(original.name);
    expect(parsed.frontmatter.description).toBe(original.description);
    expect(parsed.frontmatter['argument-hint']).toBe('<arg1>');
  });

  test('should quote strings containing colon-space (breaks plain scalars)', () => {
    const data = {
      name: 'impeccable',
      description: 'Design fluency. Also handles: critique, audit. Commands: craft, polish.'
    };

    const result = generateYamlFrontmatter(data);
    // Must be wrapped in quotes so YAML parsers don't mis-read the inner `: ` as a mapping
    expect(result).toContain('description: "Design fluency. Also handles: critique, audit. Commands: craft, polish."');

    // Roundtrip through our parser should recover the original string intact
    const parsed = parseFrontmatter(`${result}\n\nbody`);
    expect(parsed.frontmatter.description).toBe(data.description);
  });

  test('should quote strings starting with YAML flow indicators', () => {
    const data = {
      name: 'test',
      'argument-hint': '[command] [target]'
    };

    const result = generateYamlFrontmatter(data);
    expect(result).toContain('argument-hint: "[command] [target]"');
  });

  test('should not quote plain strings without special chars', () => {
    const data = {
      name: 'simple',
      description: 'A plain description with no colons or hashes'
    };

    const result = generateYamlFrontmatter(data);
    expect(result).toContain('description: A plain description with no colons or hashes');
    expect(result).not.toContain('"A plain');
  });
});

describe('ensureDir', () => {
  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test('should create directory if it does not exist', () => {
    const testPath = path.join(TEST_DIR, 'new-dir');
    ensureDir(testPath);

    expect(fs.existsSync(testPath)).toBe(true);
    expect(fs.statSync(testPath).isDirectory()).toBe(true);
  });

  test('should create nested directories', () => {
    const testPath = path.join(TEST_DIR, 'level1', 'level2', 'level3');
    ensureDir(testPath);

    expect(fs.existsSync(testPath)).toBe(true);
  });

  test('should not throw if directory already exists', () => {
    const testPath = path.join(TEST_DIR, 'existing');
    fs.mkdirSync(testPath, { recursive: true });

    expect(() => ensureDir(testPath)).not.toThrow();
  });
});

describe('cleanDir', () => {
  beforeEach(() => {
    ensureDir(TEST_DIR);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test('should remove directory and all contents', () => {
    const filePath = path.join(TEST_DIR, 'test.txt');
    fs.writeFileSync(filePath, 'content');

    expect(fs.existsSync(filePath)).toBe(true);

    cleanDir(TEST_DIR);
    expect(fs.existsSync(TEST_DIR)).toBe(false);
  });

  test('should not throw if directory does not exist', () => {
    const nonExistent = path.join(TEST_DIR, 'does-not-exist');
    expect(() => cleanDir(nonExistent)).not.toThrow();
  });

  test('should remove nested directories', () => {
    const nestedPath = path.join(TEST_DIR, 'level1', 'level2');
    ensureDir(nestedPath);
    fs.writeFileSync(path.join(nestedPath, 'file.txt'), 'content');

    cleanDir(TEST_DIR);
    expect(fs.existsSync(TEST_DIR)).toBe(false);
  });
});

describe('writeFile', () => {
  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test('should write file with content', () => {
    const filePath = path.join(TEST_DIR, 'test.txt');
    const content = 'Hello, world!';

    writeFile(filePath, content);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(content);
  });

  test('should create parent directories automatically', () => {
    const filePath = path.join(TEST_DIR, 'nested', 'deep', 'file.txt');
    writeFile(filePath, 'content');

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('content');
  });

  test('should overwrite existing file', () => {
    const filePath = path.join(TEST_DIR, 'file.txt');
    writeFile(filePath, 'first');
    writeFile(filePath, 'second');

    expect(fs.readFileSync(filePath, 'utf-8')).toBe('second');
  });
});

describe('readFilesRecursive', () => {
  beforeEach(() => {
    ensureDir(TEST_DIR);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test('should find all markdown files in directory', () => {
    writeFile(path.join(TEST_DIR, 'file1.md'), 'content1');
    writeFile(path.join(TEST_DIR, 'file2.md'), 'content2');
    writeFile(path.join(TEST_DIR, 'file3.txt'), 'not markdown');

    const files = readFilesRecursive(TEST_DIR);
    expect(files).toHaveLength(2);
    expect(files.some(f => f.endsWith('file1.md'))).toBe(true);
    expect(files.some(f => f.endsWith('file2.md'))).toBe(true);
  });

  test('should find markdown files in nested directories', () => {
    writeFile(path.join(TEST_DIR, 'root.md'), 'root');
    writeFile(path.join(TEST_DIR, 'sub', 'nested.md'), 'nested');
    writeFile(path.join(TEST_DIR, 'sub', 'deep', 'deeper.md'), 'deeper');

    const files = readFilesRecursive(TEST_DIR);
    expect(files).toHaveLength(3);
    expect(files.some(f => f.endsWith('root.md'))).toBe(true);
    expect(files.some(f => f.endsWith('nested.md'))).toBe(true);
    expect(files.some(f => f.endsWith('deeper.md'))).toBe(true);
  });

  test('should return empty array for non-existent directory', () => {
    const files = readFilesRecursive(path.join(TEST_DIR, 'does-not-exist'));
    expect(files).toEqual([]);
  });

  test('should return empty array for directory with no markdown files', () => {
    writeFile(path.join(TEST_DIR, 'file.txt'), 'text');
    writeFile(path.join(TEST_DIR, 'file.js'), 'code');

    const files = readFilesRecursive(TEST_DIR);
    expect(files).toEqual([]);
  });
});

describe('readSourceFiles', () => {
  const testRootDir = TEST_DIR;

  beforeEach(() => {
    ensureDir(testRootDir);
  });

  afterEach(() => {
    if (fs.existsSync(testRootDir)) {
      fs.rmSync(testRootDir, { recursive: true, force: true });
    }
  });

  test('should read and parse SKILL.md from skill/', () => {
    const skillContent = `---
name: test-skill
description: A test skill
license: MIT
---

Skill instructions here.`;

    const skillDir = path.join(testRootDir, 'skill');
    ensureDir(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

    const { skills } = readSourceFiles(testRootDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('test-skill');
    expect(skills[0].description).toBe('A test skill');
    expect(skills[0].license).toBe('MIT');
    expect(skills[0].body).toBe('Skill instructions here.');
  });

  test('should read skill with user-invocable flag', () => {
    const skillContent = `---
name: audit
description: Run technical quality checks
user-invocable: true
---

Audit the code.`;

    const skillDir = path.join(testRootDir, 'skill');
    ensureDir(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

    const { skills } = readSourceFiles(testRootDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].userInvocable).toBe(true);
  });

  test('should read skill with quoted user-invocable flag', () => {
    const skillContent = `---
name: audit
description: Run technical quality checks
user-invocable: 'true'
---

Audit the code.`;

    const skillDir = path.join(testRootDir, 'skill');
    ensureDir(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

    const { skills } = readSourceFiles(testRootDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].userInvocable).toBe(true);
  });

  test('should read skill with reference files', () => {
    const skillContent = `---
name: impeccable
description: Impeccable design skill
---

Impeccable design instructions.`;

    const skillDir = path.join(testRootDir, 'skill');
    ensureDir(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

    const refDir = path.join(skillDir, 'reference');
    ensureDir(refDir);
    fs.writeFileSync(path.join(refDir, 'typography.md'), 'Typography reference content.');
    fs.writeFileSync(path.join(refDir, 'color.md'), 'Color reference content.');

    const { skills } = readSourceFiles(testRootDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].references).toHaveLength(2);
    // References may not be in a specific order due to fs.readdirSync
    const refNames = skills[0].references.map(r => r.name).sort();
    expect(refNames).toEqual(['color', 'typography']);
  });

  test('should fall back to "impeccable" when frontmatter has no name', () => {
    const skillDir = path.join(testRootDir, 'skill');
    ensureDir(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'Just body, no frontmatter.');

    const { skills } = readSourceFiles(testRootDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('impeccable');
  });

  test('should ignore non-md files in skill/reference', () => {
    const skillDir = path.join(testRootDir, 'skill');
    ensureDir(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: test-skill\n---\nBody');

    const refDir = path.join(skillDir, 'reference');
    ensureDir(refDir);
    fs.writeFileSync(path.join(refDir, 'readme.txt'), 'Not a markdown file');
    fs.writeFileSync(path.join(refDir, 'typography.md'), 'Valid reference');

    const { skills } = readSourceFiles(testRootDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].references).toHaveLength(1);
    expect(skills[0].references[0].name).toBe('typography');
  });

  test('should handle missing skill directory', () => {
    const { skills } = readSourceFiles(testRootDir);
    expect(skills).toEqual([]);
  });

  test('should parse all frontmatter fields correctly', () => {
    const skillContent = `---
name: test-skill
description: A comprehensive test skill
license: Apache-2.0
compatibility: claude-code
user-invocable: true
allowed-tools: Bash,Edit
---

Body content.`;

    const skillDir = path.join(testRootDir, 'skill');
    ensureDir(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

    const { skills } = readSourceFiles(testRootDir);

    expect(skills[0].name).toBe('test-skill');
    expect(skills[0].description).toBe('A comprehensive test skill');
    expect(skills[0].license).toBe('Apache-2.0');
    expect(skills[0].compatibility).toBe('claude-code');
    expect(skills[0].userInvocable).toBe(true);
    expect(skills[0].allowedTools).toBe('Bash,Edit');
  });
});

describe('readPatterns', () => {
  const testRootDir = TEST_DIR;

  beforeEach(() => {
    ensureDir(testRootDir);
  });

  afterEach(() => {
    if (fs.existsSync(testRootDir)) {
      fs.rmSync(testRootDir, { recursive: true, force: true });
    }
  });

  test('should extract DO and DON\'T patterns from SKILL.md', () => {
    const skillContent = `---
name: impeccable
---

### Typography
**DO**: Use variable fonts for flexibility.
**DON'T**: Use system fonts like Arial.

### Color & Contrast
**DO**: Ensure WCAG AA compliance.
**DON'T**: Use gray text on colored backgrounds.

### Layout & Space
**DO**: Use consistent spacing scale.
**DON'T**: Nest cards inside cards.`;

    const skillDir = path.join(testRootDir, 'skill');
    ensureDir(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

    const { patterns, antipatterns } = readPatterns(testRootDir);

    expect(patterns).toHaveLength(3);
    expect(antipatterns).toHaveLength(3);

    expect(patterns[0].name).toBe('Typography');
    expect(patterns[0].items).toContain('Use variable fonts for flexibility.');
    expect(antipatterns[0].items).toContain('Use system fonts like Arial.');
  });

  test('should normalize "Color & Theme" to "Color & Contrast"', () => {
    const skillContent = `---
name: impeccable
---

### Color & Theme
**DO**: Use OKLCH color space.
**DON'T**: Use pure black.`;

    const skillDir = path.join(testRootDir, 'skill');
    ensureDir(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

    const { patterns, antipatterns } = readPatterns(testRootDir);

    expect(patterns[0].name).toBe('Color & Contrast');
  });

  test('should handle missing SKILL.md file', () => {
    ensureDir(path.join(testRootDir, 'skill'));

    const { patterns, antipatterns } = readPatterns(testRootDir);

    expect(patterns).toEqual([]);
    expect(antipatterns).toEqual([]);
  });

  test('should return patterns in consistent section order', () => {
    const skillContent = `---
name: impeccable
---

### Motion
**DO**: Use ease-out for natural movement.

### Typography
**DO**: Use modular scale.

### Color & Contrast
**DO**: Use tinted neutrals.`;

    const skillDir = path.join(testRootDir, 'skill');
    ensureDir(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

    const { patterns } = readPatterns(testRootDir);

    // Patterns are returned in predefined section order, not source order
    // Only sections with content are included
    expect(patterns[0].name).toBe('Typography');
    expect(patterns[1].name).toBe('Color & Contrast');
    expect(patterns[2].name).toBe('Motion');
    expect(patterns.length).toBe(3);
  });
});

describe('replacePlaceholders', () => {
  test('should replace {{model}} with provider-specific value', () => {
    expect(replacePlaceholders('Ask {{model}} for help.', 'claude-code')).toBe('Ask Claude for help.');
    expect(replacePlaceholders('Ask {{model}} for help.', 'gemini')).toBe('Ask Gemini for help.');
    expect(replacePlaceholders('Ask {{model}} for help.', 'codex')).toBe('Ask GPT for help.');
    expect(replacePlaceholders('Ask {{model}} for help.', 'cursor')).toBe('Ask the model for help.');
    expect(replacePlaceholders('Ask {{model}} for help.', 'agents')).toBe('Ask the model for help.');
    expect(replacePlaceholders('Ask {{model}} for help.', 'kiro')).toBe('Ask Claude for help.');
  });

  test('should replace {{config_file}} with provider-specific value', () => {
    expect(replacePlaceholders('See {{config_file}}.', 'claude-code')).toBe('See CLAUDE.md.');
    expect(replacePlaceholders('See {{config_file}}.', 'cursor')).toBe('See .cursorrules.');
    expect(replacePlaceholders('See {{config_file}}.', 'gemini')).toBe('See GEMINI.md.');
    expect(replacePlaceholders('See {{config_file}}.', 'codex')).toBe('See AGENTS.md.');
    expect(replacePlaceholders('See {{config_file}}.', 'agents')).toBe('See .github/copilot-instructions.md.');
    expect(replacePlaceholders('See {{config_file}}.', 'kiro')).toBe('See .kiro/settings.json.');
  });

  test('should replace {{ask_instruction}} with provider-specific value', () => {
    const result = replacePlaceholders('{{ask_instruction}}', 'claude-code');
    expect(result).toBe('STOP and call the AskUserQuestion tool to clarify.');

    const cursorResult = replacePlaceholders('{{ask_instruction}}', 'cursor');
    expect(cursorResult).toBe('ask the user directly to clarify what you cannot infer.');
  });

  test('should replace {{available_commands}} with command list', () => {
    const result = replacePlaceholders('Commands: {{available_commands}}', 'claude-code', ['audit', 'polish', 'optimize']);
    expect(result).toBe('Commands: /audit, /polish, /optimize');
  });

  test('should exclude impeccable from {{available_commands}}', () => {
    const result = replacePlaceholders('Commands: {{available_commands}}', 'claude-code', ['audit', 'impeccable', 'polish']);
    expect(result).toBe('Commands: /audit, /polish');
  });

  test('should exclude i-impeccable from {{available_commands}}', () => {
    const result = replacePlaceholders('Commands: {{available_commands}}', 'claude-code', ['i-audit', 'i-impeccable', 'i-polish']);
    expect(result).toBe('Commands: /i-audit, /i-polish');
  });

  test('should exclude legacy teach-impeccable from {{available_commands}}', () => {
    const result = replacePlaceholders('Commands: {{available_commands}}', 'claude-code', ['audit', 'teach-impeccable', 'polish']);
    expect(result).toBe('Commands: /audit, /polish');
  });

  test('should exclude legacy i-teach-impeccable from {{available_commands}}', () => {
    const result = replacePlaceholders('Commands: {{available_commands}}', 'claude-code', ['i-audit', 'i-teach-impeccable', 'i-polish']);
    expect(result).toBe('Commands: /i-audit, /i-polish');
  });

  test('should produce empty string for {{available_commands}} with no commands', () => {
    const result = replacePlaceholders('Commands: {{available_commands}}.', 'claude-code', []);
    expect(result).toBe('Commands: .');
  });

  test('should replace multiple placeholders in the same string', () => {
    const result = replacePlaceholders('{{model}} uses {{config_file}} and {{ask_instruction}}', 'claude-code');
    expect(result).toBe('Claude uses CLAUDE.md and STOP and call the AskUserQuestion tool to clarify.');
  });

  test('should replace multiple occurrences of the same placeholder', () => {
    const result = replacePlaceholders('{{model}} and {{model}} again.', 'gemini');
    expect(result).toBe('Gemini and Gemini again.');
  });

  test('should fall back to cursor placeholders for unknown provider', () => {
    const result = replacePlaceholders('{{model}} {{config_file}}', 'unknown-provider');
    expect(result).toBe('the model .cursorrules');
  });
});

