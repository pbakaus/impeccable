import { readImpeccableSource } from './impeccable/source.js';

export async function healthPayload() {
  const snapshot = await readImpeccableSource();
  return {
    ok: true,
    name: '@impeccable/mcp',
    source: {
      packageName: snapshot.packageName,
      packageVersion: snapshot.packageVersion,
      commit: snapshot.commit,
    },
  };
}
