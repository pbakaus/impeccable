import { z } from 'zod';
import { runCheckpoint } from '../impeccable/checkpoint.js';
import { detectMarkup } from '../impeccable/detect.js';
import { buildAgentSkillMarkdown } from '../impeccable/flatten-skill.js';
import { readImpeccableSource, sourcePath } from '../impeccable/source.js';
import { buildWorkflowPacket } from '../impeccable/workflows.js';

export const toolNames = [
  'impeccable_manifest',
  'impeccable_skill_markdown',
  'impeccable_workflow',
  'impeccable_checkpoint',
  'impeccable_detect_markup',
  'search',
  'fetch',
] as const;

type ToolRegistrar = {
  registerTool: (
    name: string,
    config: Record<string, unknown>,
    handler: (args: Record<string, unknown>) => Promise<unknown> | unknown,
  ) => void;
};

function toolResponse(structuredContent: unknown, text?: string) {
  return {
    content: [{ type: 'text', text: text ?? JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

export async function manifest() {
  const snapshot = await readImpeccableSource();
  return {
    adapter: { name: '@impeccable/mcp', version: '0.1.0' },
    source: {
      repoRoot: snapshot.repoRoot,
      commit: snapshot.commit,
      packageName: snapshot.packageName,
      packageVersion: snapshot.packageVersion,
      files: [
        sourcePath(snapshot, 'skill/SKILL.src.md'),
        sourcePath(snapshot, 'skill/scripts/command-metadata.json'),
        sourcePath(snapshot, 'docs/HARNESSES.md'),
      ],
    },
    commands: Object.keys(snapshot.commandMetadata).sort(),
  };
}

export async function searchSource(query: string) {
  const snapshot = await readImpeccableSource();
  const needle = query.trim().toLowerCase();
  const docs = [
    { id: 'skill', title: 'SKILL.src.md', text: snapshot.skillMarkdown },
    { id: 'harnesses', title: 'docs/HARNESSES.md', text: snapshot.harnessesMarkdown },
    ...Object.entries(snapshot.references).map(([command, text]) => ({
      id: `reference:${command}`,
      title: `skill/reference/${command}.md`,
      text,
    })),
  ];
  return docs
    .filter((doc) => doc.title.toLowerCase().includes(needle) || doc.id.toLowerCase().includes(needle) || doc.text.toLowerCase().includes(needle))
    .sort((left, right) => {
      const leftExact = left.id.toLowerCase() === `reference:${needle}` || left.title.toLowerCase().includes(`/${needle}.md`);
      const rightExact = right.id.toLowerCase() === `reference:${needle}` || right.title.toLowerCase().includes(`/${needle}.md`);
      return Number(rightExact) - Number(leftExact);
    })
    .slice(0, 10)
    .map((doc) => ({
      id: doc.id,
      title: doc.title,
      excerpt: doc.text.replace(/\s+/g, ' ').slice(0, 500),
    }));
}

export async function fetchSource(id: string) {
  const snapshot = await readImpeccableSource();
  if (id === 'skill') return { id, text: snapshot.skillMarkdown };
  if (id === 'harnesses') return { id, text: snapshot.harnessesMarkdown };
  if (id === 'agent-skill') return { id, text: buildAgentSkillMarkdown(snapshot) };
  if (id.startsWith('reference:')) {
    const command = id.slice('reference:'.length);
    const text = snapshot.references[command];
    if (text) return { id, text };
  }
  throw new Error(`Unknown Impeccable source document id: ${id}`);
}

export function registerImpeccableTools(server: ToolRegistrar): void {
  server.registerTool(
    'impeccable_manifest',
    {
      title: 'Impeccable Manifest',
      description: 'Use this when you need the Impeccable source commit, package version, command inventory, and adapter version. This server is read-only and does not edit client workspace files.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => toolResponse(await manifest()),
  );

  server.registerTool(
    'impeccable_skill_markdown',
    {
      title: 'Impeccable Agent Skill Markdown',
      description: 'Use this when a client supports importing a standalone Markdown skill or guide for the Impeccable MCP workflow. This server is read-only and does not edit client workspace files.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const snapshot = await readImpeccableSource();
      const markdown = buildAgentSkillMarkdown(snapshot);
      return toolResponse({ markdown, source: { commit: snapshot.commit } }, markdown);
    },
  );

  server.registerTool(
    'impeccable_workflow',
    {
      title: 'Impeccable Workflow',
      description: 'Use this when you need source-backed Impeccable workflow guidance before generating or revising UI. This server is read-only and does not edit client workspace files.',
      inputSchema: z.object({
        command: z.string(),
        surfaceType: z.enum(['product', 'brand', 'unknown']).default('unknown'),
        brief: z.string(),
        currentState: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const snapshot = await readImpeccableSource();
      return toolResponse(buildWorkflowPacket(snapshot, args as never));
    },
  );

  server.registerTool(
    'impeccable_checkpoint',
    {
      title: 'Impeccable Checkpoint',
      description: 'Use this when you need explicit Impeccable hook/checkpoint behavior before generation, after generation, or before final response. This server is read-only and does not edit client workspace files.',
      inputSchema: z.object({
        phase: z.enum(['before_generation', 'after_generation', 'before_final']),
        command: z.string().optional(),
        brief: z.string().optional(),
        hasProductContext: z.boolean().optional(),
        detectorFindings: z.array(z.object({
          severity: z.string().optional(),
          ruleId: z.string().optional(),
          message: z.string().optional(),
        })).optional(),
        acknowledgedFindings: z.array(z.string()).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => toolResponse(runCheckpoint(args as never)),
  );

  server.registerTool(
    'impeccable_detect_markup',
    {
      title: 'Impeccable Markup Detector',
      description: 'Use this when generated markup, JSX, CSS, HTML, Vue, or Svelte text is available and you need real Impeccable detector findings. This server is read-only and does not edit client workspace files.',
      inputSchema: z.object({
        text: z.string(),
        language: z.string().optional(),
        filename: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const snapshot = await readImpeccableSource();
      return toolResponse(await detectMarkup(snapshot, args as never));
    },
  );

  server.registerTool(
    'search',
    {
      title: 'Search Impeccable Source',
      description: 'Use this when you need to search source-backed Impeccable skill, harness, and command reference docs. This server is read-only and does not edit client workspace files.',
      inputSchema: z.object({ query: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async (args) => toolResponse({ results: await searchSource(String(args.query ?? '')) }),
  );

  server.registerTool(
    'fetch',
    {
      title: 'Fetch Impeccable Source',
      description: 'Use this when you need to fetch a specific source-backed Impeccable document by id from search results. This server is read-only and does not edit client workspace files.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async (args) => toolResponse(await fetchSource(String(args.id ?? ''))),
  );
}
