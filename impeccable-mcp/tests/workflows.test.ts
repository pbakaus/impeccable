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
    expect(packet.entrypoint.firstExecutableStep).toContain('context.mjs --target src/app/App.tsx');
    expect(packet.routing.command).toBe('layout');
    expect(packet.routing.referenceId).toBe('reference:layout');
    expect(packet.registerReference).toBe('reference:product');
    expect(packet.sequence[0]).toContain('impeccable_start');
    expect(packet.limits).toContain('The MCP bridge does not install local skills into the client.');
  });

  it('returns a source-backed route prompt when a command cannot be inferred', async () => {
    const packet = buildEntryPacket(await readImpeccableSource(), {
      request: 'Help with this surface',
      surfaceType: 'unknown',
    });
    expect(packet.status).toBe('needs_command');
    if (packet.status !== 'needs_command') throw new Error('expected needs_command packet');
    expect(packet.availableCommands).toContain('shape');
    expect(packet.entrypoint.firstExecutableStep).toContain('context.mjs');
  });

  it.each(['shape', 'critique', 'audit', 'polish'])('builds source-backed packet for %s', async (command) => {
    const snapshot = await readImpeccableSource();
    const packet = buildWorkflowPacket(snapshot, {
      command,
      surfaceType: 'product',
      brief: 'Build a dashboard table',
    });
    expect(packet.status).toBe('ok');
    if (packet.status !== 'ok') throw new Error('expected ok packet');
    expect(packet.source.commit).toBe(snapshot.commit);
    expect(packet.source.referencePath).toContain(`skill/reference/${command}.md`);
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
  });
});
