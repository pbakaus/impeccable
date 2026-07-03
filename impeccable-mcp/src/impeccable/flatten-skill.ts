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
  return `---\nname: impeccable-mcp\ndescription: Use Impeccable through a remote MCP connector for source-backed design workflow, checkpoints, and detector guidance.\n---\n\n# Impeccable MCP\n\nUse this skill guide when a client supports standalone Markdown skills or reusable agent instructions. It is generated from the real Impeccable source at commit \`${snapshot.commit}\` and must be used with the \`@Impeccable\` MCP connector.\n\n## Required Connector\n\n- Attach or invoke the \`@Impeccable\` remote MCP connector.\n- Call \`impeccable_manifest\` when you need to confirm source version or available commands.\n- Call \`impeccable_workflow\` before generating UI or design code.\n- Call \`impeccable_checkpoint\` after generating or revising UI.\n- Call \`impeccable_detect_markup\` when markup, JSX, CSS, HTML, Vue, or Svelte output is available.\n- Call \`impeccable_checkpoint\` with \`before_final\` before declaring work complete.\n\n## Compatibility Limits\n\nSome client skill-import surfaces accept only a single Markdown file and cannot include \`scripts/\`, \`reference/\`, \`assets/\`, subagents, or provider-native hooks. The MCP connector supplies those operational pieces from the real Impeccable source.\n\n## Checkpoint Sequence\n\n1. \`before_generation\`: choose the Impeccable command and confirm the brief/register.\n2. \`after_generation\`: scan available markup/code and request revisions for important findings.\n3. \`before_final\`: ensure P0/P1 issues are absent or explicitly acknowledged.\n\n## Command Catalog\n\n${summarizeCommands(snapshot)}\n\n## Source Skill Excerpt\n\n${extractCoreRules(snapshot.skillMarkdown)}\n`;
}
