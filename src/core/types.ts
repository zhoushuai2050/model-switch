export const AGENT_IDS = ['claude', 'codex', 'grok-build', 'gemini', 'opencode'] as const;
export const AGENT_CHOICES = AGENT_IDS.join('|');
export type AgentId = (typeof AGENT_IDS)[number];

export const PROTOCOLS = ['openai', 'anthropic', 'gemini'] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export type WireApi = 'chat' | 'responses';
export type AuthMode = 'api_key' | 'auth_token' | 'openai_auth' | 'env_key';

export interface ProtocolConfig {
  baseUrl: string;
  wireApi?: WireApi;
  authMode?: AuthMode;
  envKey?: string;
}

export interface Provider {
  id: string;
  name: string;
  apiKey: string;
  websiteUrl?: string;
  notes?: string;
  agent?: AgentId;
  protocols: Partial<Record<Protocol, ProtocolConfig>>;
  createdAt: number;
  updatedAt: number;
}

export interface ModelRow {
  id: string;
  providerId: string;
  modelId: string;
  alias?: string;
  agentHint?: AgentId | 'any';
  sortOrder?: number;
  selected?: boolean;
}

export interface McpServer {
  id: string;
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args: string[];
  url?: string;
  env: Record<string, string>;
  agents: AgentId[];
}

export interface ApplyPayload {
  provider: Provider;
  model: string;
  extra?: Record<string, unknown>;
}

export interface AgentLiveStatus {
  id: AgentId;
  name: string;
  installed: boolean;
  bin?: string;
  configured: boolean;
  model?: string;
  baseUrl?: string;
  providerLabel?: string;
  providerId?: string;
  currentProviderId?: string;
}

export interface SwitchResult {
  scope: 'global' | 'session';
  agentId?: AgentId;
  providerId?: string;
  model?: string;
  applied: AgentId[];
  skipped: Array<{ agentId: AgentId; reason: string }>;
  backups: string[];
}

export interface AppState {
  currentAgent?: AgentId;
  currentModels: Partial<Record<AgentId, string>>;
}


export function protocolsForAgent(agent?: AgentId): Protocol[] {
  if (agent === 'claude') return ['anthropic'];
  if (agent === 'codex' || agent === 'opencode' || agent === 'grok-build') return ['openai'];
  if (agent === 'gemini') return ['gemini'];
  return ['openai', 'anthropic', 'gemini'];
}

export function protocolCompatibleAgents(protocols: Provider['protocols']): AgentId[] {
  return AGENT_IDS.filter((agent) =>
    protocolsForAgent(agent).some((protocol) => Boolean(protocols[protocol]?.baseUrl)),
  );
}

export function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}

export function now(): number {
  return Date.now();
}

export function slug(value: string): string {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'item';
}

export function liveProviderKey(providerId: string, agent: 'codex' | 'opencode'): string {
  const base = slug(providerId);
  if (agent === 'codex') return base.replace(/-/g, '_') || 'custom';
  return base.replace(/-/g, '') || 'custom';
}

export function payloadModelIds(payload: ApplyPayload): string[] {
  const extra = payload.extra?.models;
  const listed = Array.isArray(extra)
    ? extra.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const models = listed.length ? [...listed] : payload.model ? [payload.model] : [];
  if (payload.model && !models.includes(payload.model)) models.unshift(payload.model);
  return [...new Set(models)];
}

export type PingStatus = 'running' | 'ok' | 'warn' | 'fail' | 'skip';

export interface PingStep {
  id: string;
  title: string;
  status: PingStatus;
  method?: string;
  url?: string;
  httpStatus?: number;
  ms?: number;
  detail?: string;
}

export interface PingResult {
  ok: boolean;
  status?: number;
  url: string;
  error?: string;
  steps: PingStep[];
}
