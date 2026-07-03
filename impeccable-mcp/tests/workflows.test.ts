import { describe, expect, it } from 'vitest';
import { readImpeccableSource } from '../src/impeccable/source.js';
import { buildWorkflowPacket } from '../src/impeccable/workflows.js';

describe('workflow packets', () => {
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
