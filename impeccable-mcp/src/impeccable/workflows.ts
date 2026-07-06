import type { ImpeccableSourceSnapshot } from './source.js';
import { sourcePath } from './source.js';

export type WorkflowInput = {
  command: string;
  surfaceType: 'product' | 'brand' | 'unknown';
  brief: string;
  currentState?: string;
};

export type ClientCapability = 'skills' | 'resources' | 'prompts' | 'tools' | 'local_files' | 'image_generation' | 'hooks';

export type EntryInput = {
  request: string;
  target?: string;
  surfaceType?: 'product' | 'brand' | 'unknown';
  clientCapabilities?: ClientCapability[];
};

type RegisterReference = 'reference:product' | 'reference:brand';

export type EntryPacket =
  | {
      status: 'ok';
      source: { commit: string; packageVersion: string };
      entrypoint: {
        skillPath: string;
        firstExecutableStep: string;
        localSkillEntry: string;
      };
      routing: {
        command: string;
        reason: string;
        referencePath: string;
        referenceId: string;
      };
      registerReference: RegisterReference;
      registerReferences: RegisterReference[];
      sequence: string[];
      limits: string[];
      nextTool: 'fetch' | 'impeccable_workflow';
    }
  | {
      status: 'needs_command';
      source: { commit: string; packageVersion: string };
      entrypoint: {
        skillPath: string;
        firstExecutableStep: string;
        localSkillEntry: string;
      };
      availableCommands: string[];
      sequence: string[];
      limits: string[];
      nextTool: 'impeccable_start';
    };

export type WorkflowPacket =
  | {
      status: 'ok';
      command: string;
      source: { commit: string; referencePath: string };
      summary: string;
      agentSequence: string[];
      guardrails: string[];
      askUserWhen: string[];
      nextCheckpoint: 'before_generation' | 'after_generation' | 'before_final';
    }
  | {
      status: 'unknown_command';
      command: string;
      availableCommands: string[];
    };

function firstParagraph(markdown: string): string {
  const paragraph = markdown
    .replace(/^#.*$/gm, '')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find(Boolean);
  return paragraph?.replace(/\s+/g, ' ').slice(0, 500) ?? 'Source-backed Impeccable workflow guidance.';
}

const commandHints: Record<string, string[]> = {
  adapt: ['responsive', 'mobile', 'tablet', 'breakpoint', 'viewport', 'screen size'],
  animate: ['animate', 'animation', 'motion', 'transition', 'micro-interaction', 'alive'],
  audit: ['audit', 'accessibility', 'a11y', 'performance', 'responsive check', 'quality check'],
  bolder: ['bolder', 'bold', 'bland', 'generic', 'safe', 'impact'],
  clarify: ['copy', 'microcopy', 'label', 'error message', 'confusing text', 'instructions'],
  colorize: ['color', 'colour', 'palette', 'flat', 'gray', 'grey', 'dull'],
  craft: ['build', 'create', 'implement', 'ship', 'feature', 'component'],
  critique: ['critique', 'review', 'evaluate', 'feedback', 'score'],
  delight: ['delight', 'personality', 'joy', 'memorable', 'fun'],
  distill: ['simplify', 'declutter', 'reduce', 'strip', 'cleaner'],
  document: ['document', 'design.md', 'design system', 'capture visual system'],
  extract: ['extract', 'tokens', 'component system', 'reusable'],
  harden: ['harden', 'production-ready', 'edge case', 'overflow', 'i18n', 'error state'],
  init: ['init', 'setup project', 'product.md', 'initialize'],
  layout: ['layout', 'spacing', 'rhythm', 'alignment', 'composition', 'visual hierarchy', 'crowded'],
  live: ['live', 'variant', 'browser iteration', 'hot-swap'],
  onboard: ['onboard', 'first-run', 'empty state', 'activation', 'getting started'],
  optimize: ['optimize', 'slow', 'laggy', 'janky', 'bundle', 'load time', 'faster'],
  overdrive: ['overdrive', 'wow', 'extraordinary', 'shader', 'physics', 'go all-out'],
  polish: ['polish', 'finish', 'finishing', 'looks off', 'pre-launch', 'improve', 'fix'],
  quieter: ['quieter', 'too loud', 'overwhelming', 'garish', 'aggressive', 'calmer'],
  shape: ['shape', 'design', 'plan', 'brief', 'ux before code'],
  typeset: ['typeset', 'typography', 'font', 'readability', 'hierarchy', 'type'],
};

function normalizedWords(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
}

function includesPhrase(haystack: string, phrase: string): boolean {
  return haystack.includes(` ${phrase.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `);
}

function availableCommands(snapshot: ImpeccableSourceSnapshot): string[] {
  return Object.keys(snapshot.commandMetadata)
    .filter((command) => Object.prototype.hasOwnProperty.call(snapshot.references, command))
    .sort();
}

function routeCommand(snapshot: ImpeccableSourceSnapshot, request: string): { command?: string; reason: string } {
  const normalized = normalizedWords(request);
  const commands = availableCommands(snapshot);
  for (const command of commands) {
    if (includesPhrase(normalized, command)) return { command, reason: `The request explicitly names the ${command} command.` };
  }

  const candidates = commands
    .map((command) => {
      const metadata = snapshot.commandMetadata[command];
      const description = normalizedWords(metadata?.description ?? '');
      const hints = commandHints[command] ?? [];
      const hintMatches = hints.filter((hint) => includesPhrase(normalized, hint)).length;
      const descriptionMatches = request
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 4 && description.includes(` ${word.replace(/[^a-z0-9]+/g, '')} `)).length;
      return { command, score: hintMatches * 4 + descriptionMatches, hintMatches, descriptionMatches };
    })
    .filter((candidate) => candidate.hintMatches > 0 || candidate.descriptionMatches >= 2)
    .sort((left, right) => right.score - left.score || right.hintMatches - left.hintMatches || left.command.localeCompare(right.command));

  if (candidates[0]) {
    return {
      command: candidates[0].command,
      reason: `The request matches ${candidates[0].hintMatches} routing hint(s) and ${candidates[0].descriptionMatches} source metadata term(s).`,
    };
  }

  if (/\b(build|create|implement|ship)\b/i.test(request) && commands.includes('craft')) {
    return { command: 'craft', reason: 'Build-oriented request fallback.' };
  }
  if (/\b(improve|fix|polish|finish)\b/i.test(request) && commands.includes('polish')) {
    return { command: 'polish', reason: 'Improvement-oriented request fallback.' };
  }
  if (/\b(design|plan|ux|ui)\b/i.test(request) && commands.includes('shape')) {
    return { command: 'shape', reason: 'Design-planning request fallback.' };
  }

  return { reason: 'No command could be inferred confidently from the request.' };
}

function firstExecutableStep(input: EntryInput): string {
  const base = 'node .agents/skills/impeccable/scripts/context.mjs';
  return input.target ? `${base} --target ${shellQuote(input.target)}` : base;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function registerReferences(surfaceType: EntryInput['surfaceType']): RegisterReference[] {
  if (surfaceType === 'product') return ['reference:product'];
  if (surfaceType === 'brand') return ['reference:brand'];
  return ['reference:product', 'reference:brand'];
}

function supportsCapability(input: EntryInput, capability: ClientCapability): boolean {
  return input.clientCapabilities === undefined || input.clientCapabilities.includes(capability);
}

function entrypoint(snapshot: ImpeccableSourceSnapshot, input: EntryInput) {
  return {
    skillPath: sourcePath(snapshot, 'skill/SKILL.src.md'),
    firstExecutableStep: firstExecutableStep(input),
    localSkillEntry: 'For native skill clients, install/read SKILL.md, run the context script once, then route through the command reference and product/brand register.',
  };
}

export function buildEntryPacket(snapshot: ImpeccableSourceSnapshot, input: EntryInput): EntryPacket {
  const route = routeCommand(snapshot, input.request);
  const source = { commit: snapshot.commit, packageVersion: snapshot.packageVersion };
  const canFetchSource = supportsCapability(input, 'tools');
  const limits = [
    'The MCP bridge does not install local skills into the client.',
    'The MCP bridge does not run provider-native edit hooks automatically.',
    'The MCP bridge does not edit client workspace files.',
    'Use checkpoints and detector tools as explicit bridge calls when native hooks are unavailable.',
  ];
  if (!route.command) {
    return {
      status: 'needs_command',
      source,
      entrypoint: entrypoint(snapshot, input),
      availableCommands: availableCommands(snapshot),
      sequence: [
        'Call impeccable_start again with a clearer UI request or explicit command.',
        supportsCapability(input, 'resources')
          ? 'If the client can read resources, read impeccable://source/skill and impeccable://source/commands.'
          : 'Use the availableCommands list to choose a real Impeccable command before generating UI.',
        'Choose the command that matches the user intent before generating UI.',
      ],
      limits,
      nextTool: 'impeccable_start',
    };
  }

  const registers = registerReferences(input.surfaceType ?? 'unknown');
  const fetchSteps = canFetchSource
    ? [
        `Fetch reference:${route.command} before generating or revising UI.`,
        ...registers.map((reference) => `Fetch ${reference} for register guidance.`),
      ]
    : [
        `Use source ids reference:${route.command} and ${registers.join(', ')} as the command/register context when source fetch is unavailable.`,
      ];

  return {
    status: 'ok',
    source,
    entrypoint: entrypoint(snapshot, input),
    routing: {
      command: route.command,
      reason: route.reason,
      referencePath: sourcePath(snapshot, `skill/reference/${route.command}.md`),
      referenceId: `reference:${route.command}`,
    },
    registerReference: registers[0],
    registerReferences: registers,
    sequence: [
      'Call impeccable_start first to route the request.',
      ...fetchSteps,
      `Call impeccable_workflow with command="${route.command}" and the user brief.`,
      'Generate or revise UI using the fetched Impeccable source guidance.',
      'Call impeccable_detect_markup when markup or style text is available.',
      'Call impeccable_checkpoint with phase="before_final" before declaring completion.',
    ],
    limits,
    nextTool: canFetchSource ? 'fetch' : 'impeccable_workflow',
  };
}

export function buildWorkflowPacket(snapshot: ImpeccableSourceSnapshot, input: WorkflowInput): WorkflowPacket {
  const command = input.command.trim().toLowerCase();
  const reference = snapshot.references[command];
  if (!reference || !availableCommands(snapshot).includes(command)) {
    return {
      status: 'unknown_command',
      command,
      availableCommands: availableCommands(snapshot),
    };
  }

  const metadata = snapshot.commandMetadata[command];
  const currentStateStep = input.currentState?.trim() ? `Current state: ${input.currentState.trim()}` : undefined;
  return {
    status: 'ok',
    command,
    source: {
      commit: snapshot.commit,
      referencePath: sourcePath(snapshot, `skill/reference/${command}.md`),
    },
    summary: metadata?.description ?? firstParagraph(reference),
    agentSequence: [
      `Use the ${command} workflow from skill/reference/${command}.md.`,
      currentStateStep,
      `Desired ${input.surfaceType} surface outcome: ${input.brief}`,
      'Call impeccable_checkpoint with phase before_generation before producing UI/code.',
      'After producing UI/code, call impeccable_detect_markup when markup or style text is available.',
      'Call impeccable_checkpoint with phase after_generation and revise important findings.',
      'Call impeccable_checkpoint with phase before_final before declaring completion.',
    ].filter((step): step is string => Boolean(step)),
    guardrails: [
      'Treat Impeccable source files as authoritative.',
      'Do not claim provider-native Impeccable hooks are installed; use explicit MCP checkpoints.',
      'Do not invent visual system facts that are absent from the brief or source context.',
    ],
    askUserWhen: [
      'The product/brand register is missing and the command requires strategic context.',
      'The brief conflicts with existing source-backed Impeccable guidance.',
      'A P0/P1 issue remains and cannot be fixed without changing product behavior.',
    ],
    nextCheckpoint: 'before_generation',
  };
}
