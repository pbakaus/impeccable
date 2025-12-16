import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

export default function handler(request) {
  try {
    const sourceDir = join(PROJECT_ROOT, "source");
    const filePath = join(sourceDir, "patterns.md");

    console.log("Reading patterns from:", filePath);

    const content = readFileSync(filePath, "utf-8");
    console.log("File read, length:", content.length);
    const frontmatterMatch = content.match(/^---\n([\s\S]+?)\n---/);

    if (!frontmatterMatch) {
      return Response.json({ patterns: [], antipatterns: [] });
    }

    const frontmatterText = frontmatterMatch[1];
    const patterns = [];
    const antipatterns = [];
    const lines = frontmatterText.split('\n');
    let currentSection = null;
    let currentCategory = null;
    let inItems = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const indent = line.length - line.trimStart().length;

      if (indent === 0 && trimmed === 'patterns:') {
        currentSection = 'patterns';
        currentCategory = null;
        inItems = false;
        continue;
      }
      if (indent === 0 && trimmed === 'antipatterns:') {
        currentSection = 'antipatterns';
        currentCategory = null;
        inItems = false;
        continue;
      }

      if (trimmed.startsWith('- name:') && currentSection) {
        currentCategory = { name: trimmed.slice(7).trim(), items: [] };
        if (currentSection === 'patterns') {
          patterns.push(currentCategory);
        } else {
          antipatterns.push(currentCategory);
        }
        inItems = false;
        continue;
      }

      if (trimmed === 'items:' && currentCategory) {
        inItems = true;
        continue;
      }

      if (trimmed.startsWith('- ') && inItems && currentCategory && indent >= 6) {
        currentCategory.items.push(trimmed.slice(2).trim());
      }
    }

    return Response.json({ patterns, antipatterns });
  } catch (error) {
    console.error("Error in /api/patterns:", error);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}
