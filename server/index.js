import { serve } from "bun";
import { readdir, stat } from "fs/promises";
import { join, basename } from "path";
import homepage from "../public/index.html";

const DIST_DIR = join(import.meta.dir, "..", "dist");
const SOURCE_DIR = join(import.meta.dir, "..", "source");

// Read all skills from source directory
async function getSkills() {
  const skillsDir = join(SOURCE_DIR, "skills");
  const files = await readdir(skillsDir);
  const skills = [];

  for (const file of files) {
    if (file.endsWith(".md")) {
      const content = await Bun.file(join(skillsDir, file)).text();
      const frontmatterMatch = content.match(/^---\n([\s\S]+?)\n---/);
      
      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const nameMatch = frontmatter.match(/name:\s*(.+)/);
        const descMatch = frontmatter.match(/description:\s*(.+)/);
        
        skills.push({
          id: file.replace(".md", ""),
          name: nameMatch?.[1]?.trim() || file.replace(".md", ""),
          description: descMatch?.[1]?.trim() || "No description available",
        });
      }
    }
  }

  return skills;
}

// Read all commands from source directory
async function getCommands() {
  const commandsDir = join(SOURCE_DIR, "commands");
  const files = await readdir(commandsDir);
  const commands = [];

  for (const file of files) {
    if (file.endsWith(".md")) {
      const content = await Bun.file(join(commandsDir, file)).text();
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

  return commands;
}

// Get the appropriate file path for a provider
function getFilePath(type, provider, id) {
  if (type === "skill") {
    if (provider === "cursor") {
      return join(DIST_DIR, "cursor", "rules", `${id}.md`);
    } else if (provider === "claude-code") {
      return join(DIST_DIR, "claude-code", "skills", id, "SKILL.md");
    } else if (provider === "gemini") {
      return join(DIST_DIR, "gemini", `GEMINI.${id}.md`);
    } else if (provider === "codex") {
      return join(DIST_DIR, "codex", `AGENTS.${id}.md`);
    }
  } else if (type === "command") {
    if (provider === "cursor") {
      return join(DIST_DIR, "cursor", "commands", `${id}.md`);
    } else if (provider === "claude-code") {
      return join(DIST_DIR, "claude-code", "commands", `${id}.md`);
    } else if (provider === "gemini") {
      return join(DIST_DIR, "gemini", "commands", `${id}.toml`);
    } else if (provider === "codex") {
      return join(DIST_DIR, "codex", "prompts", `${id}.md`);
    }
  }
  return null;
}

const server = serve({
  port: process.env.PORT || 3000,
  
  routes: {
    "/": homepage,
    
    // API: Get all skills
    "/api/skills": {
      async GET() {
        const skills = await getSkills();
        return Response.json(skills);
      },
    },
    
    // API: Get all commands
    "/api/commands": {
      async GET() {
        const commands = await getCommands();
        return Response.json(commands);
      },
    },
    
    // API: Download individual file
    "/api/download/:type/:provider/:id": async (req) => {
      const { type, provider, id } = req.params;
      
      if (type !== "skill" && type !== "command") {
        return new Response("Invalid type", { status: 400 });
      }
      
      const filePath = getFilePath(type, provider, id);
      
      if (!filePath) {
        return new Response("Invalid provider", { status: 400 });
      }
      
      try {
        const file = Bun.file(filePath);
        const exists = await file.exists();
        
        if (!exists) {
          return new Response("File not found", { status: 404 });
        }
        
        const fileName = basename(filePath);
        return new Response(file, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${fileName}"`,
          },
        });
      } catch (error) {
        console.error("Error downloading file:", error);
        return new Response("Error downloading file", { status: 500 });
      }
    },
    
    // API: Download provider bundle ZIP
    "/api/download/bundle/:provider": async (req) => {
      const { provider } = req.params;
      const zipPath = join(DIST_DIR, `${provider}.zip`);
      
      try {
        const file = Bun.file(zipPath);
        const exists = await file.exists();
        
        if (!exists) {
          return new Response("Bundle not found", { status: 404 });
        }
        
        return new Response(file, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="impeccable-style-${provider}.zip"`,
          },
        });
      } catch (error) {
        console.error("Error downloading bundle:", error);
        return new Response("Error downloading bundle", { status: 500 });
      }
    },
  },
  
  development: process.env.NODE_ENV !== "production",
});

console.log(`🎨 impeccable.style running at ${server.url}`);

