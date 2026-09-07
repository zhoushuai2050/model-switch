export const AGENT_IDS = ['claude', 'codex', 'gemini', 'opencode'] as const;
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
}

export interface ProfileBinding {
  id: string;
  profileId: string;
  agentId: AgentId;
  providerId: string;
  modelId: string;
  extra?: Record<string, unknown>;
}

export interface Profile {
  id: string;
  name: string;
  description?: string;
  defaultAgent?: AgentId;
  sortIndex: number;
  bindings: ProfileBinding[];
  createdAt: number;
  updatedAt: number;
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
  profileId?: string;
  agentId?: AgentId;
  providerId?: string;
  model?: string;
  applied: AgentId[];
  skipped: Array<{ agentId: AgentId; reason: string }>;
  backups: string[];
}

export interface AppState {
  currentAgent?: AgentId;
  currentProfile?: string;
  currentModels: Partial<Record<AgentId, string>>;
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
