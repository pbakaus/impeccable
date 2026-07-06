import { describe, expect, it } from 'vitest';
import { readImpeccableSource } from '../src/impeccable/source.js';
import { buildEntryPacket, buildWorkflowPacket } from '../src/impeccable/workflows.js';

describe('workflow packets', () => {
  it('builds the real skill entry and routing packet', async () => {
    const snapshot = await readImpeccableSource();
    const packet = buildEntryPacket(snapshot, {
      request: 'Use impeccable to fix the spacing and layout on this dashboard',
      target: 'src/app/App.tsx',
      surfaceType: 'product',
      clientCapabilities: ['tools', 'resources'],
    });
    expect(packet.status).toBe('ok');
    if (packet.status !== 'ok') throw new Error('expected ok packet');
    expect(packet.entrypoint.skillPath).toContain('skill/SKILL.src.md');
    expect(packet.entrypoint.firstExecutableStep).toContain("context.mjs --target 'src/app/App.tsx'");
    expect(packet.routing.command).toBe('layout');
    expect(packet.routing.referenceId).toBe('reference:layout');
    expect(packet.registerReference).toBe('reference:product');
    expect(packet.registerReferences).toEqual(['reference:product']);
    expect(packet.sequence[0]).toContain('impeccable_start');
    expect(packet.limits).toContain('The MCP bridge does not install local skills into the client.');
  });

  it('does not route register references as commands', async () => {
    const packet = buildEntryPacket(await readImpeccableSource(), {
      request: 'Design a brand landing page',
      surfaceType: 'brand',
    });
    expect(packet.status).toBe('ok');
    if (packet.status !== 'ok') throw new Error('expected ok packet');
    expect(packet.routing.command).toBe('shape');
    expect(packet.routing.command).not.toBe('brand');
    expect(packet.registerReferences).toEqual(['reference:brand']);
  });

  it('returns separately fetchable register references for unknown surfaces', async () => {
    const packet = buildEntryPacket(await readImpeccableSource(), {
      request: 'Design a dashboard',
      surfaceType: 'unknown',
    });
    expect(packet.status).toBe('ok');
    if (packet.status !== 'ok') throw new Error('expected ok packet');
    expect(packet.registerReference).toBe('reference:product');
    expect(packet.registerReferences).toEqual(['reference:product', 'reference:brand']);
    expect(packet.sequence.join('\n')).not.toContain('reference:product/reference:brand');
    expect(packet.sequence).toContain('Fetch reference:product for register guidance.');
    expect(packet.sequence).toContain('Fetch reference:brand for register guidance.');
  });

  it('quotes target arguments in executable guidance', async () => {
    const packet = buildEntryPacket(await readImpeccableSource(), {
      request: 'Fix the layout',
      target: 'src/App.tsx; echo bad',
      surfaceType: 'product',
    });
    expect(packet.status).toBe('ok');
    if (packet.status !== 'ok') throw new Error('expected ok packet');
    expect(packet.entrypoint.firstExecutableStep).toContain("--target 'src/App.tsx; echo bad'");
  });

  it('does not tell limited clients to call fetch next', async () => {
    const packet = buildEntryPacket(await readImpeccableSource(), {
      request: 'Fix the layout',
      surfaceType: 'product',
      clientCapabilities: ['prompts'],
    });
    expect(packet.status).toBe('ok');
    if (packet.status !== 'ok') throw new Error('expected ok packet');
    expect(packet.nextTool).toBe('impeccable_workflow');
    expect(packet.sequence.join('\n')).not.toContain('Fetch reference:layout');
  });

  it('returns a source-backed route prompt when a command cannot be inferred', async () => {
    const packet = buildEntryPacket(await readImpeccableSource(), {
      request: 'Help with this surface',
      surfaceType: 'unknown',
    });
    expect(packet.status).toBe('needs_command');
    if (packet.status !== 'needs_command') throw new Error('expected needs_command packet');
    expect(packet.availableCommands).toContain('shape');
    expect(packet.availableCommands).not.toContain('brand');
    expect(packet.availableCommands).not.toContain('product');
    expect(packet.entrypoint.firstExecutableStep).toContain('context.mjs');
  });

  it.each(['shape', 'critique', 'audit', 'polish'])('builds source-backed packet for %s', async (command) => {
    const snapshot = await readImpeccableSource();
    const packet = buildWorkflowPacket(snapshot, {
      command,
      surfaceType: 'product',
      brief: 'Build a dashboard table',
      currentState: 'The current table is cramped and hard to scan.',
    });
    expect(packet.status).toBe('ok');
    if (packet.status !== 'ok') throw new Error('expected ok packet');
    expect(packet.source.commit).toBe(snapshot.commit);
    expect(packet.source.referencePath).toContain(`skill/reference/${command}.md`);
    expect(packet.agentSequence.join('\n')).toContain('Current state: The current table is cramped and hard to scan.');
    expect(packet.agentSequence.join('\n')).toContain('Desired product surface outcome: Build a dashboard table');
    expect(packet.agentSequence.length).toBeGreaterThan(2);
    expect(packet.nextCheckpoint).toBe('before_generation');
  });

  it('returns typed error for unknown command', async () => {
    const packet = buildWorkflowPacket(await readImpeccableSource(), {
      command: 'nope',
      surfaceType: 'unknown',
      brief: 'test',
    });
    expect(packet.status).toBe('unknown_command');
    if (packet.status !== 'unknown_command') throw new Error('expected unknown command');
    expect(packet.availableCommands).toContain('shape');
    expect(packet.availableCommands).not.toContain('brand');
  });
});
