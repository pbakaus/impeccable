import { readdir, readFile } from "fs/promises";
import { basename, join, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { readPatterns } from "../../scripts/lib/utils.js";

// Get project root directory (works in both Node.js and Bun, including Vercel)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..", "..");

// Helper to read file content (works in both Node.js and Bun)
async function readFileContent(filePath) {
	return readFile(filePath, "utf-8");
}

// Read all skills from source directory
export async function getSkills() {
	const sourceDir = join(PROJECT_ROOT, "source");
	const skillsDir = join(sourceDir, "skills");
	const files = await readdir(skillsDir);
	const skills = [];

	for (const file of files) {
		if (file.endsWith(".md")) {
			const content = await readFileContent(join(skillsDir, file));
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
export async function getCommands() {
	const sourceDir = join(PROJECT_ROOT, "source");
	const commandsDir = join(sourceDir, "commands");
	const files = await readdir(commandsDir);
	const commands = [];

	for (const file of files) {
		if (file.endsWith(".md")) {
			const content = await readFileContent(join(commandsDir, file));
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
export function getFilePath(type, provider, id) {
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

// Handle individual file download
export async function handleFileDownload(type, provider, id) {
	if (type !== "skill" && type !== "command") {
		return new Response("Invalid type", { status: 400 });
	}

	const filePath = getFilePath(type, provider, id);

	if (!filePath) {
		return new Response("Invalid provider", { status: 400 });
	}

	try {
		if (!existsSync(filePath)) {
			return new Response("File not found", { status: 404 });
		}

		const content = await readFile(filePath);
		const fileName = basename(filePath);
		return new Response(content, {
			headers: {
				"Content-Type": "application/octet-stream",
				"Content-Disposition": `attachment; filename="${fileName}"`,
			},
		});
	} catch (error) {
		console.error("Error downloading file:", error);
		return new Response("Error downloading file", { status: 500 });
	}
}

// Extract patterns from SKILL.md using the shared utility
export async function getPatterns() {
	try {
		return readPatterns(PROJECT_ROOT);
	} catch (error) {
		console.error("Error reading patterns:", error);
		return { patterns: [], antipatterns: [] };
	}
}

// Handle bundle download
export async function handleBundleDownload(provider) {
	const distDir = join(PROJECT_ROOT, "dist");
	const zipPath = join(distDir, `${provider}.zip`);

	try {
		if (!existsSync(zipPath)) {
			return new Response("Bundle not found", { status: 404 });
		}

		const content = await readFile(zipPath);
		return new Response(content, {
			headers: {
				"Content-Type": "application/zip",
				"Content-Disposition": `attachment; filename="impeccable-style-${provider}.zip"`,
			},
		});
	} catch (error) {
		console.error("Error downloading bundle:", error);
		return new Response("Error downloading bundle", { status: 500 });
	}
}
