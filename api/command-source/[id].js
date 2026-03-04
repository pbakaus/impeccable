import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../..");

export default function handler(req, res) {
  try {
    const { id } = req.query;
    const commandPath = join(PROJECT_ROOT, "source", "skills", id, "SKILL.md");

    if (!existsSync(commandPath)) {
      return res.status(404).json({ error: "Command not found" });
    }

    const content = readFileSync(commandPath, "utf-8");
    res.status(200).json({ content });
  } catch (error) {
    console.error("Error in /api/command-source:", error);
    res.status(500).json({ error: error.message });
  }
}
