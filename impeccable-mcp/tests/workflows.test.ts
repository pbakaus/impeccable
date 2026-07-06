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
      clientCapabilities: ['tools', 'resources'],
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
      clientCapabilities: ['tools', 'resources'],
    });
    expect(packet.status).toBe('ok');
    if (packet.status !== 'ok') throw new Error('expected ok packet');
    expect(packet.registerReference).toBe('reference:product');
    expect(packet.registerReferences).toEqual(['reference:product', 'reference:brand']);
    expect(packet.sequence.join('\n')).not.toContain('reference:product/reference:brand');
    expect(packet.sequence).toContain('Fetch reference:product for register guidance.');
    expect(packet.sequence).toContain('Fetch reference:brand for register guidance.');
  });

  it('routes remote visual variant requests away from live when local runtime capabilities are absent', async () => {
    const packet = buildEntryPacket(await readImpeccableSource(), {
      request: 'Create a third visual variant with a two-panel rail/detail split for this purchases table',
      surfaceType: 'product',
      clientCapabilities: ['tools', 'resources'],
    });
    expect(packet.status).toBe('ok');
    if (packet.status !== 'ok') throw new Error('expected ok packet');
    expect(packet.routing.command).toBe('layout');
    expect(packet.routing.command).not.toBe('live');
    expect(packet.sequence.join('\n')).not.toContain('live.mjs');
  });

  it('allows live routing only for clients with local runtime support', async () => {
    const packet = buildEntryPacket(await readImpeccableSource(), {
      request: 'Use live variant mode to hot-swap browser alternatives',
      surfaceType: 'product',
      clientCapabilities: ['tools', 'resources', 'local_files', 'browser'],
    });
    expect(packet.status).toBe('ok');
    if (packet.status !== 'ok') throw new Error('expected ok packet');
    expect(packet.routing.command).toBe('live');
  });

  it('quotes target arguments in executable guidance', async () => {
    const packet = buildEntryPacket(await readImpeccableSource(), {
      request: 'Fix the layout',
      target: 'src/App.tsx; echo bad',
      surfaceType: 'product',
      clientCapabilities: ['tools'],
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

  it('does not assume omitted capabilities can fetch source or read resources', async () => {
    const packet = buildEntryPacket(await readImpeccableSource(), {
      request: 'Fix the layout',
      surfaceType: 'product',
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
    expect(packet.sequence.join('\n')).not.toContain('impeccable://source/skill');
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

  it('rejects direct live workflow calls without local runtime support', async () => {
    const packet = buildWorkflowPacket(await readImpeccableSource(), {
      command: 'live',
      surfaceType: 'product',
      brief: 'Generate a third rail/detail split variant',
      currentState: 'Remote agent platform without browser HMR control.',
      clientCapabilities: ['tools', 'resources'],
    });
    expect(packet.status).toBe('unsupported_command');
    if (packet.status !== 'unsupported_command') throw new Error('expected unsupported command');
    expect(packet.reason).toContain('live requires local files and browser control');
    expect(packet.availableCommands).toContain('layout');
    expect(packet.availableCommands).not.toContain('live');
  });

  it('allows direct live workflow calls when local runtime support is advertised', async () => {
    const packet = buildWorkflowPacket(await readImpeccableSource(), {
      command: 'live',
      surfaceType: 'product',
      brief: 'Use live mode against a dev server',
      clientCapabilities: ['tools', 'resources', 'local_files', 'browser'],
    });
    expect(packet.status).toBe('ok');
    if (packet.status !== 'ok') throw new Error('expected ok packet');
    expect(packet.command).toBe('live');
  });
});
