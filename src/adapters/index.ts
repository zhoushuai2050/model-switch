import type { AgentId } from '../core/types.ts';
import { claudeAdapter } from './claude.ts';
import { codexAdapter } from './codex.ts';
import { geminiAdapter } from './gemini.ts';
import { opencodeAdapter } from './opencode.ts';
import type { Adapter } from './types.ts';

export const adapters: Adapter[] = [claudeAdapter, codexAdapter, geminiAdapter, opencodeAdapter];

export const adapterMap: Record<AgentId, Adapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
  opencode: opencodeAdapter,
};

export function getAdapter(id: AgentId): Adapter {
  return adapterMap[id];
}

export type { Adapter, LaunchSpec } from './types.ts';
