import { z } from 'zod';

type PromptRegistrar = {
  registerPrompt?: (
    name: string,
    config: Record<string, unknown>,
    handler: (args: Record<string, unknown>) => unknown,
  ) => void;
};

export const promptNames = ['use-impeccable'] as const;

export function registerImpeccablePrompts(server: PromptRegistrar): void {
  if (typeof server.registerPrompt !== 'function') return;

  server.registerPrompt(
    'use-impeccable',
    {
      title: 'Use Impeccable',
      description: 'Start an Impeccable-backed UI workflow through the MCP bridge.',
      argsSchema: z.object({
        request: z.string().describe('The UI/design request to route through Impeccable.'),
        target: z.string().optional().describe('Optional file, route, component, or surface target.'),
      }),
    },
    (args) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'Use the Impeccable MCP bridge for this UI/design request.',
              '',
              `Request: ${String(args.request ?? '')}`,
              args.target ? `Target: ${String(args.target)}` : undefined,
              '',
              'Call `impeccable_start` first. Then fetch the returned command/register references, call `impeccable_workflow`, and only use checkpoints/detector calls as explicit bridge support when native Impeccable hooks are unavailable.',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        },
      ],
    }),
  );
}
