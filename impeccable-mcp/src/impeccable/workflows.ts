import type { ImpeccableSourceSnapshot } from './source.js';
import { sourcePath } from './source.js';

export type WorkflowInput = {
  command: string;
  surfaceType: 'product' | 'brand' | 'unknown';
  brief: string;
  currentState?: string;
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

export function buildWorkflowPacket(snapshot: ImpeccableSourceSnapshot, input: WorkflowInput): WorkflowPacket {
  const command = input.command.trim().toLowerCase();
  const reference = snapshot.references[command];
  if (!reference) {
    return {
      status: 'unknown_command',
      command,
      availableCommands: Object.keys(snapshot.references).sort(),
    };
  }

  const metadata = snapshot.commandMetadata[command];
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
      `Apply the workflow to this ${input.surfaceType} surface: ${input.brief}`,
      'Call impeccable_checkpoint with phase before_generation before producing UI/code.',
      'After producing UI/code, call impeccable_detect_markup when markup or style text is available.',
      'Call impeccable_checkpoint with phase after_generation and revise important findings.',
      'Call impeccable_checkpoint with phase before_final before declaring completion.',
    ],
    guardrails: [
      'Treat Impeccable source files as authoritative.',
      'Do not claim native client hooks; use explicit MCP checkpoints.',
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
