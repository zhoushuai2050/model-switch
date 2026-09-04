import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { adapters, getAdapter } from '../adapters/index.ts';
import type { LaunchSpec } from '../adapters/types.ts';
import * as db from './db.ts';
import { getPreset, PRESETS, type Preset } from './presets.ts';
import {
  AGENT_IDS,
  isAgentId,
  now,
  slug,
  type AgentId,
  type AgentLiveStatus,
  type ApplyPayload,
  type McpServer,
  type ModelRow,
  type Profile,
  type ProfileBinding,
  type Protocol,
  type ProtocolConfig,
  type Provider,
  type SwitchResult,
} from './types.ts';

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

export class Engine {
  status() {
    const state = db.getState();
    const agents = this.listAgents();
    return {
      home: process.env.MSW_HOME || process.env.MODEL_SWITCH_HOME || '~/.model-switch',
      state,
      agents,
      current: agents.find((agent) => agent.id === state.currentAgent) || agents.find((a) => a.installed),
      profile: state.currentProfile ? db.getProfile(state.currentProfile) : undefined,
    };
  }

  listAgents(): AgentLiveStatus[] {
    return adapters.map((adapter) => {
      const detected = adapter.detect();
      const live = adapter.readStatus();
      return {
        id: adapter.id,
        name: adapter.displayName,
        installed: detected.installed,
        bin: detected.bin,
        configured: live.configured,
        model: live.model,
        baseUrl: live.baseUrl,
        providerLabel: live.providerLabel,
      };
    });
  }

  listProviders(): Provider[] {
    return db.listProviders();
  }

  listModels(): ModelRow[] {
    return db.listModels();
  }

  listProfiles(): Profile[] {
    return db.listProfiles();
  }

  listPresets(): Preset[] {
    return PRESETS;
  }

  listMcp(): McpServer[] {
    return db.listMcp();
  }

  listLogs(limit = 20) {
    return db.listLogs(limit);
  }

  init() {
    const imported: Array<{ agentId: AgentId; providerId: string; model: string }> = [];
    const skipped: Array<{ agentId: AgentId; reason: string }> = [];
    for (const adapter of adapters) {
      const live = adapter.importLive();
      if (!live) {
        skipped.push({ agentId: adapter.id, reason: 'no live config' });
        continue;
      }
      if (db.getProvider(live.provider.id)) {
        skipped.push({ agentId: adapter.id, reason: 'already imported' });
        continue;
      }
      live.provider.updatedAt = now();
      db.upsertProvider(live.provider);
      db.upsertModel({
        id: `${live.provider.id}-${slug(live.model)}`,
        providerId: live.provider.id,
        modelId: live.model,
        alias: live.model,
        agentHint: adapter.id,
      });
      const profileId = live.provider.id;
      const existing = db.getProfile(profileId);
      const profile: Profile = existing || {
        id: profileId,
        name: live.provider.name,
        description: `Imported from ${adapter.displayName}`,
        defaultAgent: adapter.id,
        sortIndex: 0,
        bindings: [],
        createdAt: now(),
        updatedAt: now(),
      };
      db.upsertProfile(profile);
      db.upsertBinding({
        id: randomUUID(),
        profileId,
        agentId: adapter.id,
        providerId: live.provider.id,
        modelId: live.model,
      });
      imported.push({ agentId: adapter.id, providerId: live.provider.id, model: live.model });
    }
    const agents = this.listAgents();
    const current = db.getState();
    if (!current.currentAgent) {
      const first = agents.find((agent) => agent.installed) || agents.find((agent) => agent.configured);
      if (first) db.setState({ currentAgent: first.id });
    }
    if (!current.currentProfile && imported[0]) {
      db.setState({ currentProfile: imported[0].providerId });
    }
    return { imported, skipped };
  }

  addProvider(input: {
    id?: string;
    name?: string;
    preset?: string;
    apiKey?: string;
    websiteUrl?: string;
    notes?: string;
    openaiUrl?: string;
    anthropicUrl?: string;
    geminiUrl?: string;
    wireApi?: 'chat' | 'responses';
    models?: string[];
  }): Provider {
    const preset = input.preset ? getPreset(input.preset) : undefined;
    const baseName = input.name || preset?.name || input.preset || 'custom';
    const id = uniqueId(input.id || (preset ? preset.id : slug(baseName)), (value) => Boolean(db.getProvider(value)));
    const protocols: Provider['protocols'] = preset ? { ...preset.protocols } : {};
    if (input.openaiUrl) {
      protocols.openai = {
        baseUrl: input.openaiUrl,
        wireApi: input.wireApi || protocols.openai?.wireApi || 'responses',
        authMode: protocols.openai?.authMode || 'openai_auth',
      };
    }
    if (input.anthropicUrl) {
      protocols.anthropic = {
        baseUrl: input.anthropicUrl,
        authMode: protocols.anthropic?.authMode || 'auth_token',
      };
    }
    if (input.geminiUrl) {
      protocols.gemini = { baseUrl: input.geminiUrl };
    }
    if (!Object.keys(protocols).length) {
      throw new EngineError('Provider needs at least one protocol URL or a preset');
    }
    const provider: Provider = {
      id,
      name: baseName,
      apiKey: input.apiKey || '',
      websiteUrl: input.websiteUrl || preset?.websiteUrl,
      notes: input.notes,
      protocols,
      createdAt: now(),
      updatedAt: now(),
    };
    db.upsertProvider(provider);
    const models =
      input.models?.map((modelId) => ({ modelId, alias: slug(modelId), agentHint: 'any' as const })) ||
      preset?.models ||
      [{ modelId: 'default', alias: 'default', agentHint: 'any' as const }];
    for (const model of models) {
      db.upsertModel({
        id: `${id}-${slug(model.modelId)}`,
        providerId: id,
        modelId: model.modelId,
        alias: model.alias || slug(model.modelId),
        agentHint: model.agentHint || 'any',
      });
    }
    this.ensureProviderProfile(provider, models[0]?.modelId || 'default');
    return provider;
  }

  updateProvider(id: string, patch: Partial<Pick<Provider, 'name' | 'apiKey' | 'notes' | 'websiteUrl' | 'protocols'>>): Provider {
    const provider = db.getProvider(id);
    if (!provider) throw new EngineError(`Unknown provider: ${id}`);
    const next: Provider = {
      ...provider,
      ...patch,
      protocols: patch.protocols ? { ...provider.protocols, ...patch.protocols } : provider.protocols,
      updatedAt: now(),
    };
    db.upsertProvider(next);
    return next;
  }

  deleteProvider(id: string): void {
    if (!db.getProvider(id)) throw new EngineError(`Unknown provider: ${id}`);
    db.deleteProvider(id);
  }

  addProfile(input: { id?: string; name: string; description?: string; defaultAgent?: AgentId }): Profile {
    const id = uniqueId(input.id || slug(input.name), (value) => Boolean(db.getProfile(value)));
    const profile: Profile = {
      id,
      name: input.name,
      description: input.description,
      defaultAgent: input.defaultAgent,
      sortIndex: db.listProfiles().length,
      bindings: [],
      createdAt: now(),
      updatedAt: now(),
    };
    db.upsertProfile(profile);
    return profile;
  }

  bind(profileId: string, agentId: AgentId, providerId: string, modelId: string): ProfileBinding {
    const profile = db.getProfile(profileId);
    if (!profile) throw new EngineError(`Unknown profile: ${profileId}`);
    if (!db.getProvider(providerId)) throw new EngineError(`Unknown provider: ${providerId}`);
    const binding: ProfileBinding = {
      id: randomUUID(),
      profileId,
      agentId,
      providerId,
      modelId,
    };
    db.upsertBinding(binding);
    return binding;
  }

  use(target: string, opts: { agent?: string; scope?: 'global' | 'session' } = {}): SwitchResult {
    const fallback = opts.agent && isAgentId(opts.agent) ? opts.agent : db.getState().currentAgent;
    const parsed = parseTarget(target, fallback);
    if (parsed.agent) this.setAgent(parsed.agent);
    if (parsed.kind === 'profile') {
      return this.applyProfile(parsed.id, { agent: parsed.agent, scope: opts.scope });
    }
    if (parsed.kind === 'provider') {
      return this.applyProvider(parsed.id, parsed.agent, opts.scope);
    }
    return this.applyModel(parsed.id, parsed.agent, opts.scope);
  }

  setAgent(agentId: string) {
    if (!isAgentId(agentId)) throw new EngineError(`Unknown agent: ${agentId}. Use claude|codex|gemini|opencode`);
    db.setState({ currentAgent: agentId });
    return getAdapter(agentId);
  }

  setModel(model: string, opts: { agent?: string } = {}): SwitchResult {
    const agent = requireAgent(opts.agent || db.getState().currentAgent);
    return this.applyModel(model, agent);
  }

  applyProfile(
    profileId: string,
    opts: { agent?: AgentId; scope?: 'global' | 'session' } = {},
  ): SwitchResult {
    const profile = db.getProfile(profileId) || db.listProfiles().find((item) => item.name.toLowerCase() === profileId.toLowerCase());
    if (!profile) throw new EngineError(`Unknown profile: ${profileId}`);
    const bindings = opts.agent ? profile.bindings.filter((b) => b.agentId === opts.agent) : profile.bindings;
    if (!bindings.length) throw new EngineError(`Profile ${profile.name} has no bindings`);
    const result = emptyResult(opts.scope || 'global');
    result.profileId = profile.id;
    for (const binding of bindings) {
      if (!opts.agent && !agentPresent(binding.agentId)) {
        result.skipped.push({ agentId: binding.agentId, reason: 'not installed or configured' });
        continue;
      }
      applyBinding(binding, result);
    }
    if (result.scope === 'global') {
      db.setState({
        currentProfile: profile.id,
        currentModels: Object.fromEntries(bindings.map((b) => [b.agentId, b.modelId])),
      });
    }
    db.logSwitch({
      profileId: profile.id,
      agentId: opts.agent,
      scope: result.scope,
      note: `profile ${profile.name}`,
    });
    return result;
  }

  applyProvider(providerId: string, agentId?: AgentId, scope: 'global' | 'session' = 'global'): SwitchResult {
    const provider =
      db.getProvider(providerId) ||
      db.listProviders().find((item) => item.name.toLowerCase() === providerId.toLowerCase());
    if (!provider) throw new EngineError(`Unknown provider: ${providerId}`);
    const agent = requireAgent(agentId || db.getState().currentAgent);
    const model = defaultModelFor(provider.id, agent);
    const result = emptyResult(scope);
    result.providerId = provider.id;
    result.model = model;
    result.agentId = agent;
    applyPayload(agent, { provider, model }, result);
    if (scope === 'global') {
      db.setState({ currentModels: { [agent]: model } });
    }
    db.logSwitch({ providerId: provider.id, agentId: agent, modelId: model, scope });
    return result;
  }

  applyModel(modelQuery: string, agentId?: AgentId, scope: 'global' | 'session' = 'global'): SwitchResult {
    const agent = requireAgent(agentId || db.getState().currentAgent);
    const found = findModel(modelQuery, agent);
    if (!found) throw new EngineError(`Unknown model: ${modelQuery}`);
    const provider = db.getProvider(found.providerId);
    if (!provider) throw new EngineError(`Model ${modelQuery} has no provider`);
    const result = emptyResult(scope);
    result.providerId = provider.id;
    result.model = found.modelId;
    result.agentId = agent;
    applyPayload(agent, { provider, model: found.modelId }, result);
    if (scope === 'global') db.setState({ currentModels: { [agent]: found.modelId } });
    db.logSwitch({ providerId: provider.id, agentId: agent, modelId: found.modelId, scope });
    return result;
  }

  launch(opts: { agent?: string; profile?: string; target?: string; extraArgs?: string[] } = {}): LaunchSpec {
    const agent = requireAgent(opts.agent || db.getState().currentAgent);
    const payload = resolveLaunchPayload(agent, opts);
    return getAdapter(agent).sessionLaunch(payload, opts.extraArgs || []);
  }

  spawn(spec: LaunchSpec): void {
    const child = spawn(spec.command, spec.args, {
      stdio: 'inherit',
      env: { ...process.env, ...spec.env },
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    child.on('error', (error) => {
      console.error(`Failed to launch ${spec.command}: ${error.message}`);
      process.exit(1);
    });
  }

  addMcp(input: {
    name: string;
    transport?: McpServer['transport'];
    command?: string;
    args?: string[];
    url?: string;
    agents?: AgentId[];
  }): McpServer {
    const server: McpServer = {
      id: slug(input.name),
      name: input.name,
      transport: input.transport || (input.url ? 'http' : 'stdio'),
      command: input.command,
      args: input.args || [],
      url: input.url,
      env: {},
      agents: input.agents?.length ? input.agents : [...AGENT_IDS],
    };
    db.upsertMcp(server);
    return server;
  }

  syncMcp(): AgentId[] {
    const servers = db.listMcp();
    const synced: AgentId[] = [];
    for (const adapter of adapters) {
      if (!adapter.syncMcp) continue;
      adapter.syncMcp(servers);
      synced.push(adapter.id);
    }
    return synced;
  }

  async ping(providerId?: string, agentId?: AgentId): Promise<{ ok: boolean; status?: number; url: string; error?: string }> {
    const provider = providerId
      ? db.getProvider(providerId) || db.listProviders().find((item) => item.name.toLowerCase() === providerId.toLowerCase())
      : payloadForAgent(requireAgent(agentId || db.getState().currentAgent)).provider;
    if (!provider) throw new EngineError('No provider to ping');
    const agent = agentId && isAgentId(agentId) ? agentId : db.getState().currentAgent;
    const protocol: Protocol =
      (agent && getAdapter(agent).protocol) ||
      (provider.protocols.openai && 'openai') ||
      (provider.protocols.anthropic && 'anthropic') ||
      'gemini';
    const proto = provider.protocols[protocol] || provider.protocols.openai || provider.protocols.anthropic || provider.protocols.gemini;
    if (!proto) throw new EngineError('Provider has no protocol URL');
    const url = modelsUrl(proto.baseUrl, protocol);
    try {
      const headers: Record<string, string> = {};
      if (protocol === 'anthropic') {
        headers['x-api-key'] = provider.apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else if (provider.apiKey) {
        headers.Authorization = `Bearer ${provider.apiKey}`;
      }
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      return { ok: res.ok, status: res.status, url };
    } catch (error) {
      return { ok: false, url, error: error instanceof Error ? error.message : String(error) };
    }
  }

  prompt(): string {
    const state = db.getState();
    const agent = state.currentAgent || 'none';
    const live = state.currentAgent ? getAdapter(state.currentAgent).readStatus() : undefined;
    const model = (state.currentAgent && state.currentModels[state.currentAgent]) || live?.model || '-';
    return `${agent}/${model}`;
  }

  private ensureProviderProfile(provider: Provider, model: string): void {
    if (!db.getProfile(provider.id)) {
      db.upsertProfile({
        id: provider.id,
        name: provider.name,
        description: `Auto profile for ${provider.name}`,
        sortIndex: db.listProfiles().length,
        bindings: [],
        createdAt: now(),
        updatedAt: now(),
      });
    }
    for (const adapter of adapters) {
      if (!protocolFor(provider, adapter.protocol)) continue;
      db.upsertBinding({
        id: randomUUID(),
        profileId: provider.id,
        agentId: adapter.id,
        providerId: provider.id,
        modelId: model,
      });
    }
  }
}

function agentPresent(agentId: AgentId): boolean {
  const adapter = getAdapter(agentId);
  const detected = adapter.detect();
  const live = adapter.readStatus();
  return detected.installed || live.configured;
}

function protocolFor(provider: Provider, protocol: Protocol): ProtocolConfig | undefined {
  if (provider.protocols[protocol]) return provider.protocols[protocol];
  if (protocol === 'gemini') return provider.protocols.openai;
  return undefined;
}

function applyBinding(binding: ProfileBinding, result: SwitchResult): void {
  const provider = db.getProvider(binding.providerId);
  if (!provider) {
    result.skipped.push({ agentId: binding.agentId, reason: 'missing provider' });
    return;
  }
  applyPayload(binding.agentId, { provider, model: binding.modelId, extra: binding.extra }, result);
}

function applyPayload(agentId: AgentId, payload: ApplyPayload, result: SwitchResult): void {
  const adapter = getAdapter(agentId);
  if (!protocolFor(payload.provider, adapter.protocol)) {
    result.skipped.push({
      agentId,
      reason: `provider ${payload.provider.id} has no ${adapter.protocol} protocol`,
    });
    return;
  }
  const models = db.modelsForProvider(payload.provider.id).map((row) => row.modelId);
  payload = {
    ...payload,
    extra: {
      ...(payload.extra || {}),
      models: models.length ? models : [payload.model],
    },
  };
  try {
    if (result.scope === 'global') adapter.apply(payload);
    result.applied.push(agentId);
    result.agentId = result.agentId || agentId;
    result.providerId = payload.provider.id;
    result.model = payload.model;
  } catch (error) {
    result.skipped.push({
      agentId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}


function resolveLaunchPayload(
  agent: AgentId,
  opts: { profile?: string; target?: string },
): ApplyPayload {
  if (opts.profile) {
    const profile =
      db.getProfile(opts.profile) ||
      db.listProfiles().find((item) => item.name.toLowerCase() === opts.profile!.toLowerCase());
    if (!profile) throw new EngineError(`Unknown profile: ${opts.profile}`);
    const binding = profile.bindings.find((item) => item.agentId === agent);
    if (!binding) throw new EngineError(`Profile ${profile.name} has no ${agent} binding`);
    const provider = db.getProvider(binding.providerId);
    if (!provider) throw new EngineError(`Missing provider ${binding.providerId}`);
    return { provider, model: binding.modelId };
  }
  if (opts.target) {
    const parsed = parseTarget(opts.target, agent);
    if (parsed.kind === 'profile') {
      return resolveLaunchPayload(parsed.agent || agent, { profile: parsed.id });
    }
    if (parsed.kind === 'provider') {
      const provider =
        db.getProvider(parsed.id) ||
        db.listProviders().find((item) => item.name.toLowerCase() === parsed.id.toLowerCase());
      if (!provider) throw new EngineError(`Unknown provider: ${parsed.id}`);
      return { provider, model: defaultModelFor(provider.id, agent) };
    }
    const found = findModel(parsed.id, agent);
    if (!found) throw new EngineError(`Unknown model: ${parsed.id}`);
    const provider = db.getProvider(found.providerId);
    if (!provider) throw new EngineError(`Model ${parsed.id} has no provider`);
    return { provider, model: found.modelId };
  }
  return payloadForAgent(agent);
}

function payloadForAgent(agent: AgentId): ApplyPayload {
  const state = db.getState();
  if (state.currentProfile) {
    const profile = db.getProfile(state.currentProfile);
    const binding = profile?.bindings.find((item) => item.agentId === agent);
    if (binding) {
      const provider = db.getProvider(binding.providerId);
      if (provider) return { provider, model: binding.modelId };
    }
  }
  const live = getAdapter(agent).importLive();
  if (live) return live;
  throw new EngineError(`No provider configured for ${agent}. Run msw init or msw provider add`);
}

function defaultModelFor(providerId: string, agent: AgentId): string {
  const models = db.modelsForProvider(providerId);
  const hinted = models.find((model) => model.agentHint === agent) || models.find((model) => model.agentHint === 'any');
  if (hinted) return hinted.modelId;
  if (models[0]) return models[0].modelId;
  const live = getAdapter(agent).readStatus().model;
  return live || 'default';
}

function findModel(query: string, agent: AgentId): ModelRow | undefined {
  const needle = query.toLowerCase();
  const models = db.listModels();
  return (
    models.find((model) => model.id.toLowerCase() === needle) ||
    models.find((model) => model.alias?.toLowerCase() === needle && (!model.agentHint || model.agentHint === 'any' || model.agentHint === agent)) ||
    models.find((model) => model.modelId.toLowerCase() === needle) ||
    models.find((model) => model.modelId.toLowerCase().includes(needle) || model.alias?.toLowerCase().includes(needle))
  );
}

function parseTarget(target: string, fallbackAgent?: AgentId): { kind: 'profile' | 'provider' | 'model'; id: string; agent?: AgentId } {
  let agent: AgentId | undefined;
  let query = target;
  const colon = target.indexOf(':');
  if (colon > 0) {
    const head = target.slice(0, colon);
    if (isAgentId(head)) {
      agent = head;
      query = target.slice(colon + 1);
    }
  }
  if (query.startsWith('profile:')) return { kind: 'profile', id: query.slice(8), agent };
  if (query.startsWith('provider:')) return { kind: 'provider', id: query.slice(9), agent };
  if (query.startsWith('model:')) return { kind: 'model', id: query.slice(6), agent };
  const profile =
    db.getProfile(query) || db.listProfiles().find((item) => item.name.toLowerCase() === query.toLowerCase());
  if (profile) return { kind: 'profile', id: profile.id, agent };
  const provider =
    db.getProvider(query) || db.listProviders().find((item) => item.name.toLowerCase() === query.toLowerCase());
  if (provider) return { kind: 'provider', id: provider.id, agent: agent || fallbackAgent };
  return { kind: 'model', id: query, agent: agent || fallbackAgent };
}

function requireAgent(agentId?: string): AgentId {
  if (!agentId) throw new EngineError('No current agent. Run msw agent codex|claude|gemini|opencode');
  if (!isAgentId(agentId)) throw new EngineError(`Unknown agent: ${agentId}`);
  return agentId;
}

function emptyResult(scope: 'global' | 'session'): SwitchResult {
  return { scope, applied: [], skipped: [], backups: [] };
}

function uniqueId(base: string, exists: (id: string) => boolean): string {
  if (!exists(base)) return base;
  let i = 2;
  while (exists(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

function modelsUrl(baseUrl: string, protocol: Protocol): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (protocol === 'anthropic') return `${trimmed}/v1/models`;
  if (trimmed.endsWith('/v1')) return `${trimmed}/models`;
  return `${trimmed}/v1/models`;
}

export const engine = new Engine();
