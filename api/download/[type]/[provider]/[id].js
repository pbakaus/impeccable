import { readFileSync, existsSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "../../../..");

function getFilePath(type, provider, id) {
  const distDir = join(PROJECT_ROOT, "dist");

  if (type === "skill") {
    if (provider === "cursor") {
      return join(distDir, "cursor", ".cursor", "skills", id, "SKILL.md");
    } else if (provider === "claude-code") {
      return join(distDir, "claude-code", ".claude", "skills", id, "SKILL.md");
    } else if (provider === "gemini") {
      return join(distDir, "gemini", `GEMINI.${id}.md`);
    } else if (provider === "codex") {
      return join(distDir, "codex", ".codex", "skills", id, "SKILL.md");
    }
  } else if (type === "command") {
    if (provider === "cursor") {
      return join(distDir, "cursor", ".cursor", "commands", `${id}.md`);
    } else if (provider === "claude-code") {
      return join(distDir, "claude-code", ".claude", "commands", `${id}.md`);
    } else if (provider === "gemini") {
      return join(distDir, "gemini", ".gemini", "commands", `${id}.toml`);
    } else if (provider === "codex") {
      return join(distDir, "codex", ".codex", "prompts", `${id}.md`);
    }
  }
  return null;
}

export default function handler(req, res) {
  try {
    const { type, provider, id } = req.query;

    if (type !== "skill" && type !== "command") {
      return res.status(400).json({ error: "Invalid type" });
    }

    const filePath = getFilePath(type, provider, id);

    if (!filePath) {
      return res.status(400).json({ error: "Invalid provider" });
    }

    if (!existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    const content = readFileSync(filePath);
    const fileName = basename(filePath);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(content);
  } catch (error) {
    console.error("Error downloading file:", error);
    res.status(500).json({ error: error.message });
  }
}
