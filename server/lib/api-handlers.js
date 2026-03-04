import { readdir, readFile } from "fs/promises";
import { basename, join, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { readPatterns, parseFrontmatter } from "../../scripts/lib/utils.js";

// Get project root directory (works in both Node.js and Bun, including Vercel)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..", "..");

// Helper to read file content (works in both Node.js and Bun)
async function readFileContent(filePath) {
	return readFile(filePath, "utf-8");
}

// Read all skills from source/skills/ subdirectories
export async function getSkills() {
	const skillsDir = join(PROJECT_ROOT, "source", "skills");
	const entries = await readdir(skillsDir, { withFileTypes: true });
	const skills = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const skillMdPath = join(skillsDir, entry.name, "SKILL.md");
		if (!existsSync(skillMdPath)) continue;

		const content = await readFileContent(skillMdPath);
		const { frontmatter } = parseFrontmatter(content);

		skills.push({
			id: entry.name,
			name: frontmatter.name || entry.name,
			description: frontmatter.description || "No description available",
			userInvokable: frontmatter['user-invokable'] === true || frontmatter['user-invokable'] === 'true',
		});
	}

	return skills;
}

// Read commands (user-invokable skills)
export async function getCommands() {
	const allSkills = await getSkills();
	return allSkills.filter(s => s.userInvokable);
}

// Get command/skill source content
export async function getCommandSource(id) {
	const skillPath = join(PROJECT_ROOT, "source", "skills", id, "SKILL.md");

	try {
		if (!existsSync(skillPath)) {
			return null;
		}
		const content = await readFileContent(skillPath);
		return content;
	} catch (error) {
		console.error("Error reading skill source:", error);
		return null;
	}
}

// Get the appropriate file path for a provider
export function getFilePath(type, provider, id) {
	const distDir = join(PROJECT_ROOT, "dist");

	// Provider config directory mapping
	const providerPaths = {
		'cursor': '.cursor',
		'claude-code': '.claude',
		'gemini': '.gemini',
		'codex': '.codex',
		'agents': '.agents',
	};

	const configDir = providerPaths[provider];
	if (!configDir) return null;

	// Everything is a skill now
	if (type === "skill" || type === "command") {
		return join(distDir, provider, configDir, "skills", id, "SKILL.md");
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
