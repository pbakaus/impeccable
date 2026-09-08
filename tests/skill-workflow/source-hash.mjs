import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Include local styles/scripts/assets too: an unchanged HTML file is not
// evidence of a current capture when an external stylesheet changed.
export function sourceHash(root) {
  const hash = crypto.createHash('sha256');
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const relative = `${prefix}${entry.name}`;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file, `${relative}/`);
      else if (entry.isFile() && /\.(html?|css|m?js|svg|png|jpe?g|webp|woff2?)$/i.test(entry.name)) {
        hash.update(relative).update('\0').update(fs.readFileSync(file)).update('\0');
      }
    }
  }
  visit(root);
  return hash.digest('hex');
}
