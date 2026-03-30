import { createTransformer } from './factory.js';
import { PROVIDERS } from './providers.js';

export const transformCursor = createTransformer(PROVIDERS.cursor);
export const transformClaudeCode = createTransformer(PROVIDERS['claude-code']);
export const transformGemini = createTransformer(PROVIDERS.gemini);
export const transformCodex = createTransformer(PROVIDERS.codex);
export const transformAgents = createTransformer(PROVIDERS.agents);
export const transformKiro = createTransformer(PROVIDERS.kiro);
export const transformOpenCode = createTransformer(PROVIDERS.opencode);
export const transformPi = createTransformer(PROVIDERS.pi);
export const transformRovoDev = createTransformer(PROVIDERS['rovo-dev']);

export { createTransformer, PROVIDERS };
