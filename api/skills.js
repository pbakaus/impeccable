import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

export default function handler(req, res) {
  try {
    const skillsDir = join(PROJECT_ROOT, "source", "skills");

    const entries = readdirSync(skillsDir);
    const skills = [];

    for (const entry of entries) {
      const entryPath = join(skillsDir, entry);
      if (!statSync(entryPath).isDirectory()) continue;

      const skillMd = join(entryPath, "SKILL.md");
      if (!existsSync(skillMd)) continue;

      const content = readFileSync(skillMd, "utf-8");
      const frontmatterMatch = content.match(/^---\n([\s\S]+?)\n---/);

      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const nameMatch = frontmatter.match(/name:\s*(.+)/);
        const descMatch = frontmatter.match(/description:\s*(.+)/);

        skills.push({
          id: entry,
          name: nameMatch?.[1]?.trim() || entry,
          description: descMatch?.[1]?.trim() || "No description available",
        });
      }
    }

    res.status(200).json(skills);
  } catch (error) {
    console.error("Error in /api/skills:", error);
    res.status(500).json({ error: error.message });
  }
}
