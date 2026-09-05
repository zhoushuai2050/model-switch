import { randomInt, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import type { EnvHttpProxyAgent } from 'undici';
import { adapters, getAdapter } from '../adapters/index.ts';
import type { LaunchSpec } from '../adapters/types.ts';
import * as db from './db.ts';
import { atomicWrite, backupFiles, readText } from './fsutil.ts';
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
  type PingResult,
  type PingStatus,
  type PingStep,
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

  getProvider(id: string): { provider: Provider; models: ModelRow[] } {
    const provider = db.getProvider(id);
    if (!provider) throw new EngineError(`Unknown provider: ${id}`);
    return { provider, models: db.modelsForProvider(id) };
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
    // Provider IDs are storage identifiers. Keep the human-readable name for
    // CLI/UI lookup, but never derive the ID from it.
    const id = randomUUID();
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
    this.ensureProviderProfile(provider, models[0]?.modelId || 'default', input.preset);
    return provider;
  }

  updateProvider(id: string, patch: {
    name?: string;
    apiKey?: string;
    notes?: string;
    websiteUrl?: string;
    openaiUrl?: string;
    anthropicUrl?: string;
    geminiUrl?: string;
    wireApi?: 'chat' | 'responses';
    models?: string[];
    protocols?: Provider['protocols'];
  }): Provider {
    const provider = db.getProvider(id);
    if (!provider) throw new EngineError(`Unknown provider: ${id}`);
    const protocols: Provider['protocols'] = patch.protocols
      ? { ...provider.protocols, ...patch.protocols }
      : { ...provider.protocols };
    if (patch.openaiUrl) {
      protocols.openai = {
        ...protocols.openai,
        baseUrl: patch.openaiUrl,
        wireApi: patch.wireApi || protocols.openai?.wireApi || 'responses',
        authMode: protocols.openai?.authMode || 'openai_auth',
      };
    } else if (patch.wireApi && protocols.openai) {
      protocols.openai = { ...protocols.openai, wireApi: patch.wireApi };
    }
    if (patch.anthropicUrl) {
      protocols.anthropic = {
        ...protocols.anthropic,
        baseUrl: patch.anthropicUrl,
        authMode: protocols.anthropic?.authMode || 'auth_token',
      };
    }
    if (patch.geminiUrl) {
      protocols.gemini = { ...protocols.gemini, baseUrl: patch.geminiUrl };
    }
    const next: Provider = {
      ...provider,
      name: patch.name?.trim() || provider.name,
      apiKey: patch.apiKey && patch.apiKey.trim() ? patch.apiKey.trim() : provider.apiKey,
      notes: patch.notes ?? provider.notes,
      websiteUrl: patch.websiteUrl ?? provider.websiteUrl,
      protocols,
      updatedAt: now(),
    };
    db.upsertProvider(next);
    if (patch.models) {
      const models = patch.models.map((item) => item.trim()).filter(Boolean);
      if (models.length) {
        db.deleteModelsForProvider(id);
        for (const modelId of models) {
          db.upsertModel({
            id: `${id}-${slug(modelId)}`,
            providerId: id,
            modelId,
            alias: slug(modelId),
            agentHint: 'any',
          });
        }
        this.ensureProviderProfile(next, models[0]);
      }
    }
    return next;
  }

  deleteProvider(id: string): void {
    const provider = findProvider(id);
    if (!provider) throw new EngineError(`Unknown provider: ${id}`);
    db.deleteProvider(provider.id);
  }

  getAgentConfig(agentId: string): {
    agentId: AgentId;
    agentName: string;
    fileName: string;
    path: string;
    exists: boolean;
    content: string;
  } {
    const agent = requireAgent(agentId);
    const adapter = getAdapter(agent);
    const path = adapter.liveFiles()[0];
    if (!path) throw new EngineError(`No configuration file declared for ${agent}`);
    const content = readText(path);
    return {
      agentId: agent,
      agentName: adapter.displayName,
      fileName: basename(path),
      path,
      exists: content !== null,
      content: content ?? '',
    };
  }

  saveAgentConfig(agentId: string, content: string): {
    agentId: AgentId;
    agentName: string;
    fileName: string;
    path: string;
    exists: boolean;
    content: string;
    backup: string;
  } {
    if (typeof content !== 'string') throw new EngineError('Configuration content must be text');
    const current = this.getAgentConfig(agentId);
    if (current.fileName.endsWith('.json')) {
      try {
        JSON.parse(content);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new EngineError(`Invalid JSON: ${detail}`);
      }
    }
    const backup = backupFiles(current.agentId, [current.path]);
    atomicWrite(current.path, content);
    return { ...this.getAgentConfig(current.agentId), backup };
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
    const provider = findProvider(providerId);
    if (!provider) throw new EngineError(`Unknown provider: ${providerId}`);
    const binding: ProfileBinding = {
      id: randomUUID(),
      profileId,
      agentId,
      providerId: provider.id,
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

  async ping(providerId?: string, agentId?: AgentId): Promise<PingResult> {
    const steps: PingStep[] = [];
    for await (const step of this.pingSteps(providerId, agentId)) steps.push(step);
    const summary = [...steps].reverse().find((item) => item.id === 'summary');
    const test = [...steps].reverse().find((item) => isTestStep(item) && item.httpStatus);
    const http = [...steps].reverse().find((item) => item.httpStatus);
    return {
      ok: summary?.status === 'ok' || summary?.status === 'warn',
      status: test?.httpStatus ?? http?.httpStatus,
      url: test?.url || http?.url || '',
      error: summary?.status === 'fail' ? summary.detail : undefined,
      steps,
    };
  }

  async *pingSteps(providerId?: string, agentId?: AgentId): AsyncGenerator<PingStep> {
    const pingPrompt = randomPingPrompt();
    yield { id: 'load', title: '读取供应商配置', status: 'running' };
    const requestedAgent = agentId || db.getState().currentAgent;
    const agent = requestedAgent && isAgentId(requestedAgent) ? requestedAgent : undefined;
    const provider = providerId
      ? db.getProvider(providerId) || db.listProviders().find((item) => item.name.toLowerCase() === providerId.toLowerCase())
      : payloadForAgent(requireAgent(requestedAgent)).provider;
    if (!provider) {
      const detail = '找不到供应商';
      yield { id: 'load', title: '读取供应商配置', status: 'fail', detail };
      yield { id: 'summary', title: '测通失败', status: 'fail', detail };
      return;
    }
    const models = db.modelsForProvider(provider.id).map((item) => item.modelId);
    yield {
      id: 'load',
      title: '读取供应商配置',
      status: 'ok',
      detail: `${provider.name} · ${provider.apiKey ? '已配置 Key' : '未配置 Key'} · 模型 ${models.join(', ') || '无'}`,
    };

    const wanted = protocolsForAgent(agent);
    const protocols = wanted.filter((item) => provider.protocols[item]?.baseUrl);
    if (!protocols.length) {
      const need = wanted.map(labelOf).join(' / ');
      const detail = agent ? `当前 ${agent} 需要 ${need} 地址，该供应商未配置` : '没有可用的协议地址';
      yield { id: 'protocol', title: '检查协议', status: 'fail', detail };
      yield { id: 'summary', title: '测通失败', status: 'fail', detail };
      return;
    }
    yield {
      id: 'protocol',
      title: agent ? `按 ${agent} 测试 ${protocols.map(labelOf).join(' / ')}` : '检查协议',
      status: 'ok',
      detail: protocols.map((item) => `${labelOf(item)} ${provider.protocols[item]?.baseUrl}`).join(' · '),
    };

    const ranks: PingStatus[] = [];
    for (const protocol of protocols) {
      const proto = provider.protocols[protocol];
      if (!proto) continue;
      const headers = authHeaders(protocol, provider.apiKey);
      const posts = postProbes(protocol, proto.baseUrl, models[0], headers, proto.wireApi, pingPrompt);
      let requestRank: PingStatus | undefined;

      if (!posts.length) {
        yield {
          id: `${protocol}-chat`,
          title: `${labelOf(protocol)} 发送测试消息「${pingPrompt}」`,
          status: 'skip',
          detail: '没有可测的模型名',
        };
      } else {
        for (const post of posts) {
          yield { id: post.id, title: post.title, status: 'running', method: 'POST', url: post.url };
          const replied = await probe(post.url, {
            method: 'POST',
            headers: post.headers,
            body: post.body,
            showResponse: true,
          });
          yield {
            id: post.id,
            title: post.title,
            status: replied.rank,
            method: 'POST',
            url: post.url,
            httpStatus: replied.status,
            ms: replied.ms,
            detail: replied.detail,
          };
          requestRank = requestRank ? betterRank(requestRank, replied.rank) : replied.rank;
          if (replied.rank === 'ok') break;
        }
      }

      // Only use GET /models as a fallback diagnostic. A successful real
      // message is the authoritative result, and many relays do not implement
      // GET /models at all.
      let listed: Awaited<ReturnType<typeof probe>> | undefined;
      if (requestRank !== 'ok') {
        const getUrl = modelsUrl(proto.baseUrl, protocol);
        yield { id: `${protocol}-models`, title: `${labelOf(protocol)} 拉取模型列表`, status: 'running', method: 'GET', url: getUrl };
        listed = await probe(getUrl, { method: 'GET', headers });
        yield {
          id: `${protocol}-models`,
          title: `${labelOf(protocol)} 拉取模型列表`,
          status: listed.rank,
          method: 'GET',
          url: getUrl,
          httpStatus: listed.status,
          ms: listed.ms,
          detail: listed.detail,
        };
      }

      if (requestRank === 'ok') {
        ranks.push('ok');
      } else if (requestRank === 'warn') {
        ranks.push('warn');
      } else if (listed?.rank === 'ok') {
        // The service is reachable, but the actual test message did not pass.
        ranks.push('warn');
      } else {
        ranks.push(requestRank || listed?.rank || 'fail');
      }
    }
    const best = ranks.includes('ok') ? 'ok' : ranks.includes('warn') ? 'warn' : 'fail';
    yield {
      id: 'summary',
      title: best === 'ok' ? '测通成功' : best === 'warn' ? '服务可达' : '测通失败',
      status: best,
      detail:
        best === 'ok'
          ? `已发送测试消息「${pingPrompt}」并收到响应`
          : best === 'warn'
            ? `地址可达，但测试消息「${pingPrompt}」未通过，请检查 API Key、协议或模型名`
            : `发送测试消息「${pingPrompt}」失败，请检查地址、API Key 和模型名`,
    };
  }

  prompt(): string {
    const state = db.getState();
    const agent = state.currentAgent || 'none';
    const live = state.currentAgent ? getAdapter(state.currentAgent).readStatus() : undefined;
    const model = (state.currentAgent && state.currentModels[state.currentAgent]) || live?.model || '-';
    return `${agent}/${model}`;
  }

  private ensureProviderProfile(provider: Provider, model: string, preferredId?: string): void {
    const existing = db.listProfiles().find((item) => item.bindings.some((binding) => binding.providerId === provider.id));
    const profileBaseId = preferredId || provider.name;
    const profileId = existing?.id || uniqueId(slug(profileBaseId), (value) => Boolean(db.getProfile(value)));
    if (!existing) {
      db.upsertProfile({
        id: profileId,
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
        profileId,
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
  throw new EngineError(`No provider configured for ${agent}. Run msw provider add`);
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

function findProvider(query: string): Provider | undefined {
  return db.getProvider(query) || db.listProviders().find((item) => item.name.toLowerCase() === query.toLowerCase());
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

const PING_PROMPTS = [
  '你好，请用一句话介绍你自己。',
  '请用中文回答：1+1 等于多少？',
  '请用不超过 20 个字解释什么是 API。',
  '请给我一个简短的学习建议。',
  '请用一句话描述春天。',
  '请返回一个简短的 JSON：{"ok":true}',
] as const;

function randomPingPrompt(): string {
  return PING_PROMPTS[randomInt(PING_PROMPTS.length)];
}

function modelsUrl(baseUrl: string, protocol: Protocol): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (protocol === 'anthropic') return `${apiV1Root(trimmed)}/models`;
  if (trimmed.endsWith('/v1')) return `${trimmed}/models`;
  return `${trimmed}/v1/models`;
}

function protocolsForAgent(agent?: AgentId): Protocol[] {
  if (agent === 'claude') return ['anthropic'];
  if (agent === 'codex' || agent === 'opencode') return ['openai'];
  if (agent === 'gemini') return ['gemini'];
  return ['openai', 'anthropic', 'gemini'];
}

function labelOf(protocol: Protocol): string {
  if (protocol === 'anthropic') return 'Anthropic';
  if (protocol === 'gemini') return 'Gemini';
  return 'OpenAI';
}

function authHeaders(protocol: Protocol, apiKey: string): Record<string, string> {
  const key = apiKey.trim();
  if (protocol === 'anthropic') {
    return { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  }
  if (protocol === 'gemini') {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (key) headers['x-goog-api-key'] = key;
    return headers;
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function apiV1Root(baseUrl: string): string {
  return baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`;
}

function postProbes(
  protocol: Protocol,
  baseUrl: string,
  model: string | undefined,
  headers: Record<string, string>,
  wireApi: string | undefined,
  pingPrompt: string,
) {
  if (!model) return [];
  const trimmed = baseUrl.replace(/\/$/, '');
  if (protocol === 'anthropic') {
    return [{
      id: 'anthropic-messages',
      title: `Anthropic 发送测试消息「${pingPrompt}」`,
      url: `${apiV1Root(trimmed)}/messages`,
      headers,
      body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: pingPrompt }] }),
    }];
  }
  if (protocol === 'gemini') {
    const root = trimmed.endsWith('/v1') || trimmed.endsWith('/v1beta') ? trimmed : `${trimmed}/v1beta`;
    return [{
      id: 'gemini-generate',
      title: `Gemini 发送测试消息「${pingPrompt}」`,
      url: `${root}/models/${encodeURIComponent(model)}:generateContent`,
      headers,
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: pingPrompt }] }] }),
    }];
  }
  const openaiRoot = apiV1Root(trimmed);
  const streamHeaders = { ...headers, accept: 'text/event-stream' };
  const chat = {
    id: 'openai-chat',
    title: `OpenAI Chat Completions 测试消息「${pingPrompt}」`,
    url: `${openaiRoot}/chat/completions`,
    headers: streamHeaders,
    body: JSON.stringify({ model, messages: [{ role: 'user', content: pingPrompt }], max_tokens: 16, stream: true }),
  };
  const responses = {
    id: 'openai-responses',
    title: `OpenAI Responses 测试消息「${pingPrompt}」`,
    url: `${openaiRoot}/responses`,
    headers: streamHeaders,
    // Use the same message-array shape and streaming mode as Codex. Some
    // OpenAI-compatible relays only implement this wire format reliably.
    body: JSON.stringify({
      model,
      input: [{ role: 'user', content: [{ type: 'input_text', text: pingPrompt }] }],
      max_output_tokens: 16,
      store: false,
      stream: true,
    }),
  };
  if (wireApi === 'responses') return [responses];
  if (wireApi === 'chat') return [chat];
  return [responses, chat];
}

function jsonValue(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function jsonMessage(text: string): string | undefined {
  const json = jsonValue(text);
  const root = asRecord(json);
  const error = asRecord(root?.error);
  return asString(error?.message) || asString(root?.message);
}

function responseText(text: string): string | undefined {
  const root = asRecord(jsonValue(text));
  if (!root) return undefined;
  const direct = asString(root.output_text);
  if (direct) return direct;

  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choice = asRecord(choices[0]);
  const message = asRecord(choice?.message);
  const choiceText = textContent(message?.content) || textContent(choice?.text);
  if (choiceText) return choiceText;

  const content = textContent(root.content);
  if (content) return content;

  const output = Array.isArray(root.output) ? root.output : [];
  for (const item of output) {
    const itemRecord = asRecord(item);
    const outputText = textContent(itemRecord?.content) || asString(itemRecord?.text);
    if (outputText) return outputText;
  }

  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  const candidate = asRecord(candidates[0]);
  const candidateContent = asRecord(candidate?.content);
  return textContent(candidateContent?.parts);
}

function textContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const text = value.map((item) => textContent(item)).filter(Boolean).join(' ');
    return text || undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  return asString(record.text) || textContent(record.content) || textContent(record.parts);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function clip(text: string, length = 180): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function betterRank(current: PingStatus, next: PingStatus): PingStatus {
  if (current === 'ok' || next === 'ok') return 'ok';
  if (current === 'warn' || next === 'warn') return 'warn';
  if (current === 'running' || next === 'running') return 'running';
  if (current === 'skip' || next === 'skip') return 'skip';
  return 'fail';
}

function isTestStep(step: PingStep): boolean {
  return step.id === 'anthropic-messages' || step.id === 'gemini-generate' || step.id === 'openai-chat' || step.id === 'openai-responses';
}

function classify(status?: number): PingStatus {
  if (!status) return 'fail';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403 || status === 400) return 'warn';
  return 'fail';
}

type UndiciModule = typeof import('undici');

let proxyAgent: EnvHttpProxyAgent | undefined;
let proxyEnvSignature = '';
let undiciModule: UndiciModule | undefined;
let undiciLoad: Promise<UndiciModule | undefined> | undefined;

const PROXY_ENV_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];

function proxyEnvironmentSignature(): string {
  return PROXY_ENV_KEYS.map((key) => `${key}=${process.env[key] || ''}`).join('\n');
}

function hasProxyEnvironment(): boolean {
  return ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']
    .some((key) => Boolean(process.env[key]?.trim()));
}

function httpProxyAgent(EnvHttpProxyAgent: typeof import('undici').EnvHttpProxyAgent): EnvHttpProxyAgent {
  const signature = proxyEnvironmentSignature();
  if (!proxyAgent || signature !== proxyEnvSignature) {
    proxyAgent = new EnvHttpProxyAgent();
    proxyEnvSignature = signature;
  }
  return proxyAgent;
}

async function loadUndici(): Promise<UndiciModule | undefined> {
  if (undiciModule) return undiciModule;
  if (!undiciLoad) {
    undiciLoad = import('undici')
      .then((module) => {
        undiciModule = module;
        return module;
      })
      .catch(() => undefined);
  }
  return undiciLoad;
}

const CONNECT_TIMEOUT_MS = 12_000;
const MESSAGE_TIMEOUT_MS = 45_000;

type RequestInit = { method: string; headers: Record<string, string>; body?: string; timeoutMs: number };

type ProbeBody = {
  text: string;
  streamText?: string;
  streamError?: string;
};

type ProbeReader = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(reason?: unknown): Promise<void>;
  releaseLock(): void;
};

type ProbeResponse = {
  headers: { get(name: string): string | null };
  body: { getReader(): ProbeReader } | null;
  text(): Promise<string>;
  status: number;
};

async function request(url: string, init: RequestInit): Promise<ProbeResponse> {
  const fetchInit = {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs),
  };
  if (!hasProxyEnvironment()) return globalThis.fetch(url, fetchInit);

  const undici = await loadUndici();
  if (!undici) {
    throw new EngineError(
      '检测到 HTTP(S)_PROXY 环境变量，但当前安装缺少 undici。请在项目目录执行 npm install --omit=dev 后重试。',
    );
  }
  return undici.fetch(url, {
    ...fetchInit,
    dispatcher: httpProxyAgent(undici.EnvHttpProxyAgent),
  });
}

async function readProbeBody(res: ProbeResponse): Promise<ProbeBody> {
  const contentType = res.headers.get('content-type')?.toLowerCase() || '';
  if (!res.body || !contentType.includes('text/event-stream')) {
    return { text: await res.text() };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let raw = '';
  let streamText = '';
  let streamError: string | undefined;
  let completed = false;
  try {
    while (!completed) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const part = decoder.decode(chunk.value, { stream: true });
      raw += part;
      buffer += part;
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      for (const event of events) {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (!data) continue;
        if (data === '[DONE]') {
          completed = true;
          break;
        }
        const parsed = jsonValue(data);
        const root = asRecord(parsed);
        if (!root) continue;
        const type = asString(root.type) || '';
        if (type === 'response.output_text.delta') {
          streamText += asString(root.delta) || '';
        } else if (type === 'response.output_text.done') {
          streamText = asString(root.text) || streamText;
        } else if (type === 'response.completed' || type === 'response.incomplete') {
          completed = true;
        } else if (type === 'response.failed' || type === 'error') {
          streamError = jsonMessage(data) || asString(root.message) || '流式请求失败';
          completed = true;
        }

        const choices = Array.isArray(root.choices) ? root.choices : [];
        const choice = asRecord(choices[0]);
        const delta = asRecord(choice?.delta);
        streamText += textContent(delta?.content) || '';
        if (choice?.finish_reason) completed = true;

        if (!streamText) {
          streamText = responseText(data) || '';
        }
      }
    }
  } finally {
    // Stop reading as soon as the provider signals completion. Some relays keep
    // the SSE connection open for a short time after the final event.
    await reader.cancel().catch(() => undefined);
  }
  return { text: raw, streamText: streamText || undefined, streamError };
}

async function probe(url: string, init: { method: string; headers: Record<string, string>; body?: string; showResponse?: boolean }) {
  const started = Date.now();
  try {
    const res = await request(url, {
      ...init,
      timeoutMs: init.method === 'POST' ? MESSAGE_TIMEOUT_MS : CONNECT_TIMEOUT_MS,
    });
    const body = await readProbeBody(res);
    const text = body.text.slice(0, 280).replace(/\s+/g, ' ').trim();
    const ms = Date.now() - started;
    const rank = classify(res.status);
    const message = body.streamError || jsonMessage(text);
    const parsed = jsonValue(text);
    const reply = init.showResponse
      ? clip(body.streamText || responseText(text) || (parsed === undefined ? text : ''))
      : undefined;
    let detail = message || text || `HTTP ${res.status}`;
    if (rank === 'warn' && (res.status === 401 || res.status === 403)) {
      detail = `服务可达，鉴权失败：${message || 'API Key 无效'}`;
    } else if (rank === 'warn' && res.status === 400) {
      detail = `服务可达，请求被拒绝：${message || text || 'HTTP 400'}`;
    } else if (rank === 'ok') {
      detail = init.showResponse ? `收到回复：${reply || '接口可用'}` : '接口可用';
    }
    return { ok: rank === 'ok', rank, status: res.status, ms, detail };
  } catch (error) {
    return {
      ok: false,
      rank: 'fail' as const,
      ms: Date.now() - started,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export const engine = new Engine();
