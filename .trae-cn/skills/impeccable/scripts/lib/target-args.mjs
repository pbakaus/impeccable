export function parseTargetPath(args = []) {
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]);
    if (arg === '--target' || arg === '-t') {
      const next = args[i + 1];
      return next && !String(next).startsWith('-') ? String(next) : null;
    }
    if (arg.startsWith('--target=')) {
      const value = arg.slice('--target='.length);
      return value ? value : null;
    }
  }
  return null;
}

export function parseTargetOptions(args = []) {
  const targetPath = parseTargetPath(args);
  return targetPath ? { targetPath } : {};
}

export function stripTargetArgs(args = []) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]);
    if (arg === '--target' || arg === '-t') {
      if (args[i + 1] && !String(args[i + 1]).startsWith('-')) i++;
      continue;
    }
    if (arg.startsWith('--target=')) continue;
    out.push(args[i]);
  }
  return out;
}
