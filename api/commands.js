import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

export default function handler(request) {
  try {
    const sourceDir = join(PROJECT_ROOT, "source");
    const commandsDir = join(sourceDir, "commands");

    console.log("PROJECT_ROOT:", PROJECT_ROOT);
    console.log("commandsDir:", commandsDir);

    const files = readdirSync(commandsDir);
    console.log("Files found:", files.length);

    const commands = [];

    for (const file of files) {
      if (file.endsWith(".md")) {
        const content = readFileSync(join(commandsDir, file), "utf-8");
        const frontmatterMatch = content.match(/^---\n([\s\S]+?)\n---/);

        if (frontmatterMatch) {
          const frontmatter = frontmatterMatch[1];
          const nameMatch = frontmatter.match(/name:\s*(.+)/);
          const descMatch = frontmatter.match(/description:\s*(.+)/);

          commands.push({
            id: file.replace(".md", ""),
            name: nameMatch?.[1]?.trim() || file.replace(".md", ""),
            description: descMatch?.[1]?.trim() || "No description available",
          });
        }
      }
    }

    return Response.json(commands);
  } catch (error) {
    console.error("Error in /api/commands:", error);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}

