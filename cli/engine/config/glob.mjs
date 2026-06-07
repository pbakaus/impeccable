// Minimal glob matcher (no dependencies). Supports **, *, ? against
// POSIX-style relative paths. ** matches across separators; * and ? do not.

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // ** optionally followed by / matches any number of path segments
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function matchesAnyGlob(relPath, patterns) {
  if (!patterns || patterns.length === 0) return false;
  const p = toPosix(relPath);
  return patterns.some(g => globToRegExp(toPosix(g)).test(p));
}

export { globToRegExp, matchesAnyGlob, toPosix };
