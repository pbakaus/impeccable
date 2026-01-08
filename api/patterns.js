import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readPatterns } from "../scripts/lib/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..");

export default function handler(req, res) {
  try {
    // Extract patterns from SKILL.md using the shared utility
    const { patterns, antipatterns } = readPatterns(PROJECT_ROOT);
    res.status(200).json({ patterns, antipatterns });
  } catch (error) {
    console.error("Error in /api/patterns:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
}
