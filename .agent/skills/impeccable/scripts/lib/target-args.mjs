class TargetArgError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TargetArgError';
    this.code = code;
  }
}

export function parseTargetPath(args = [], { strict = false } = {}) {
  let targetPath = null;
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]);
    if (arg === '--target' || arg === '-t') {
      const next = args[i + 1];
      if (next && !String(next).startsWith('-')) {
        targetPath = String(next);
        i++;
        continue;
      }
      if (strict) {
        throw new TargetArgError('--target requires a path value.', 'TARGET_VALUE_MISSING');
      }
      continue;
    }
    if (arg.startsWith('--target=')) {
      const value = arg.slice('--target='.length);
      if (value) {
        targetPath = value;
        continue;
      }
      if (strict) {
        throw new TargetArgError('--target requires a path value.', 'TARGET_VALUE_MISSING');
      }
    }
  }
  return targetPath;
}

export function parseTargetOptions(args = [], options = {}) {
  const targetPath = parseTargetPath(args, options);
  return targetPath ? { targetPath } : {};
}
