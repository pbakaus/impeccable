import type { ImpeccableSourceSnapshot } from './source.js';

const placeholderPattern = /\{\{(?:scripts_path|command_prefix)\}\}/g;

function summarizeCommands(snapshot: ImpeccableSourceSnapshot): string {
  return Object.entries(snapshot.commandMetadata)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([command, metadata]) => `- \`${command}\`: ${metadata.description}`)
    .join('\n');
}

function extractCoreRules(markdown: string): string {
  const cleaned = markdown
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(placeholderPattern, '@Impeccable')
    .replace(/\]\(reference\/([^)]+)\)/g, ']($1)')
    .trim();
  return cleaned.slice(0, 6000);
}

export function buildAgentSkillMarkdown(snapshot: ImpeccableSourceSnapshot): string {
  return `---\nname: impeccable-mcp\ndescription: Use Impeccable through a remote MCP connector for source-backed design workflow, checkpoints, and detector guidance.\n---\n\n# Impeccable MCP\n\nUse this skill guide when a client supports standalone Markdown skills or reusable agent instructions. It is generated from the real Impeccable source at commit \`${snapshot.commit}\` and must be used with the \`@Impeccable\` MCP connector.\n\nThe MCP connector is a bridge to the real Impeccable skill entrypoint. It does not install local skills, run provider-native hooks automatically, or edit client workspace files.\n\n## Required Connector\n\n- Attach or invoke the \`@Impeccable\` remote MCP connector.\n- Call \`impeccable_start\` first. This routes the request to the real skill entrypoint, command reference, register reference, and next MCP bridge calls.\n- Call \`impeccable_manifest\` when you need to confirm source version or available commands.\n- Fetch the returned command and register references when the client supports MCP resources/tools.\n- Call \`impeccable_workflow\` before generating UI or design code.\n- Call \`impeccable_detect_markup\` when markup, JSX, CSS, HTML, Vue, or Svelte output is available.\n- Call \`impeccable_checkpoint\` with \`before_final\` before declaring work complete when native Impeccable hooks are unavailable.\n\n## Compatibility Limits\n\nSome client skill-import surfaces accept only a single Markdown file and cannot include \`scripts/\`, \`reference/\`, \`assets/\`, subagents, or provider-native hooks. The MCP connector exposes those source-backed pieces from the real Impeccable source so the agent can follow them explicitly.\n\n## Checkpoint Sequence\n\n1. \`impeccable_start\`: choose the Impeccable command and source references.\n2. \`impeccable_workflow\`: load the command-specific workflow guidance.\n3. \`impeccable_detect_markup\`: scan available markup/code and request revisions for important findings.\n4. \`impeccable_checkpoint before_final\`: ensure P0/P1 issues are absent or explicitly acknowledged.\n\n## Command Catalog\n\n${summarizeCommands(snapshot)}\n\n## Source Skill Excerpt\n\n${extractCoreRules(snapshot.skillMarkdown)}\n`;
}
