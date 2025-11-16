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
  generateYamlFrontmatter
} from '../../scripts/lib/utils.js';

// Temporary test directory
const TEST_DIR = path.join(process.cwd(), 'test-tmp');

describe('parseFrontmatter', () => {
  test('should parse basic frontmatter with simple key-value pairs', () => {
    const content = `---
name: test-command
description: A test command
---

This is the body content.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe('test-command');
    expect(result.frontmatter.description).toBe('A test command');
    expect(result.body).toBe('This is the body content.');
  });

  test('should parse frontmatter with args array', () => {
    const content = `---
name: test-command
description: A test command
args:
  - name: target
    description: The target to normalize
    required: false
  - name: output
    description: Output format
    required: true
---

Body here.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.name).toBe('test-command');
    expect(result.frontmatter.args).toBeArray();
    expect(result.frontmatter.args).toHaveLength(2);
    expect(result.frontmatter.args[0].name).toBe('target');
    expect(result.frontmatter.args[0].description).toBe('The target to normalize');
    expect(result.frontmatter.args[0].required).toBe(false);
    expect(result.frontmatter.args[1].required).toBe(true);
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
});

describe('generateYamlFrontmatter', () => {
  test('should generate basic frontmatter', () => {
    const data = {
      name: 'test-command',
      description: 'A test'
    };

    const result = generateYamlFrontmatter(data);
    expect(result).toContain('---');
    expect(result).toContain('name: test-command');
    expect(result).toContain('description: A test');
  });

  test('should generate frontmatter with args array', () => {
    const data = {
      name: 'test',
      description: 'Test command',
      args: [
        { name: 'target', description: 'The target', required: false },
        { name: 'output', description: 'Output format', required: true }
      ]
    };

    const result = generateYamlFrontmatter(data);
    expect(result).toContain('args:');
    expect(result).toContain('- name: target');
    expect(result).toContain('description: The target');
    expect(result).toContain('required: false');
    expect(result).toContain('required: true');
  });

  test('should roundtrip: generate and parse back', () => {
    const original = {
      name: 'roundtrip-test',
      description: 'Testing roundtrip',
      args: [
        { name: 'arg1', description: 'First arg', required: true }
      ]
    };

    const yaml = generateYamlFrontmatter(original);
    const content = `${yaml}\n\nBody content`;
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter.name).toBe(original.name);
    expect(parsed.frontmatter.description).toBe(original.description);
    expect(parsed.frontmatter.args).toBeArray();
    expect(parsed.frontmatter.args[0].name).toBe('arg1');
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

  test('should read and parse command files', () => {
    const commandContent = `---
name: test-command
description: A test command
args:
  - name: target
    description: Target arg
    required: false
---

Command body content.`;

    writeFile(path.join(testRootDir, 'source/commands/test-command.md'), commandContent);
    
    const { commands, skills } = readSourceFiles(testRootDir);
    
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe('test-command');
    expect(commands[0].description).toBe('A test command');
    expect(commands[0].args).toHaveLength(1);
    expect(commands[0].body).toBe('Command body content.');
  });

  test('should read and parse skill files', () => {
    const skillContent = `---
name: test-skill
description: A test skill
license: MIT
---

Skill instructions here.`;

    writeFile(path.join(testRootDir, 'source/skills/test-skill.md'), skillContent);
    
    const { commands, skills } = readSourceFiles(testRootDir);
    
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('test-skill');
    expect(skills[0].description).toBe('A test skill');
    expect(skills[0].license).toBe('MIT');
    expect(skills[0].body).toBe('Skill instructions here.');
  });

  test('should use filename as name if not in frontmatter', () => {
    writeFile(path.join(testRootDir, 'source/commands/my-command.md'), 'Just body, no frontmatter.');
    
    const { commands } = readSourceFiles(testRootDir);
    
    expect(commands[0].name).toBe('my-command');
  });

  test('should handle empty source directories', () => {
    ensureDir(path.join(testRootDir, 'source/commands'));
    ensureDir(path.join(testRootDir, 'source/skills'));
    
    const { commands, skills } = readSourceFiles(testRootDir);
    
    expect(commands).toEqual([]);
    expect(skills).toEqual([]);
  });

  test('should read multiple commands and skills', () => {
    writeFile(path.join(testRootDir, 'source/commands/cmd1.md'), '---\nname: cmd1\n---\nBody1');
    writeFile(path.join(testRootDir, 'source/commands/cmd2.md'), '---\nname: cmd2\n---\nBody2');
    writeFile(path.join(testRootDir, 'source/skills/skill1.md'), '---\nname: skill1\n---\nSkill1');
    writeFile(path.join(testRootDir, 'source/skills/skill2.md'), '---\nname: skill2\n---\nSkill2');
    
    const { commands, skills } = readSourceFiles(testRootDir);
    
    expect(commands).toHaveLength(2);
    expect(skills).toHaveLength(2);
  });
});

