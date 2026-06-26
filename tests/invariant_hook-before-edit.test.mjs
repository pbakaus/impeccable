const { proposedFilePath, proposedContent } = require('./plugin/skills/impeccable/scripts/hook-before-edit.mjs');
const path = require('path');

describe("User-supplied strings in HTTP responses are HTML-escaped", () => {
  const payloads = [
    { input: '<script>alert(1)</script>', description: 'script tag payload' },
    { input: '<img onerror=alert(1) src=x>', description: 'img onerror payload' },
    { input: '"><svg onload=alert(1)>', description: 'attribute break payload' },
    { input: 'normal_file.txt', description: 'valid input' },
    { input: '', description: 'empty string boundary' }
  ];

  test.each(payloads)("sanitizes adversarial input: $description", ({ input }) => {
    const mockEvent = { tool_input: { file_path: input } };
    const cwd = '/test';
    
    const result = proposedFilePath(mockEvent, cwd);
    
    // Check that raw unescaped payload doesn't appear in output
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('onerror=');
    expect(result).not.toContain('onload=');
    expect(result).not.toContain('alert(1)');
    
    // For valid input, ensure it's handled correctly
    if (input === 'normal_file.txt') {
      expect(result).toBe(path.resolve(cwd, input));
    }
    
    // For empty input, ensure empty string is returned
    if (input === '') {
      expect(result).toBe('');
    }
  });
});