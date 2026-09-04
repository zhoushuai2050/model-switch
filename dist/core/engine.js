import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { adapters, getAdapter } from "../adapters/index.js";
import * as db from "./db.js";
import { getPreset, PRESETS } from "./presets.js";
import { AGENT_IDS, isAgentId, now, slug, } from "./types.js";
export class EngineError extends Error {
    constructor(message) {
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
    listAgents() {
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
    listProviders() {
        return db.listProviders();
    }
    getProvider(id) {
        const provider = db.getProvider(id);
        if (!provider)
            throw new EngineError(`Unknown provider: ${id}`);
        return { provider, models: db.modelsForProvider(id) };
    }
    listModels() {
        return db.listModels();
    }
    listProfiles() {
        return db.listProfiles();
    }
    listPresets() {
        return PRESETS;
    }
    listMcp() {
        return db.listMcp();
    }
    listLogs(limit = 20) {
        return db.listLogs(limit);
    }
    init() {
        const imported = [];
        const skipped = [];
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
            const profile = existing || {
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
            if (first)
                db.setState({ currentAgent: first.id });
        }
        if (!current.currentProfile && imported[0]) {
            db.setState({ currentProfile: imported[0].providerId });
        }
        return { imported, skipped };
    }
    addProvider(input) {
        const preset = input.preset ? getPreset(input.preset) : undefined;
        const baseName = input.name || preset?.name || input.preset || 'custom';
        const id = uniqueId(input.id || (preset ? preset.id : slug(baseName)), (value) => Boolean(db.getProvider(value)));
        const protocols = preset ? { ...preset.protocols } : {};
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
        const provider = {
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
        const models = input.models?.map((modelId) => ({ modelId, alias: slug(modelId), agentHint: 'any' })) ||
            preset?.models ||
            [{ modelId: 'default', alias: 'default', agentHint: 'any' }];
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
    updateProvider(id, patch) {
        const provider = db.getProvider(id);
        if (!provider)
            throw new EngineError(`Unknown provider: ${id}`);
        const protocols = patch.protocols
            ? { ...provider.protocols, ...patch.protocols }
            : { ...provider.protocols };
        if (patch.openaiUrl) {
            protocols.openai = {
                ...protocols.openai,
                baseUrl: patch.openaiUrl,
                wireApi: patch.wireApi || protocols.openai?.wireApi || 'responses',
                authMode: protocols.openai?.authMode || 'openai_auth',
            };
        }
        else if (patch.wireApi && protocols.openai) {
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
        const next = {
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
    deleteProvider(id) {
        if (!db.getProvider(id))
            throw new EngineError(`Unknown provider: ${id}`);
        db.deleteProvider(id);
    }
    addProfile(input) {
        const id = uniqueId(input.id || slug(input.name), (value) => Boolean(db.getProfile(value)));
        const profile = {
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
    bind(profileId, agentId, providerId, modelId) {
        const profile = db.getProfile(profileId);
        if (!profile)
            throw new EngineError(`Unknown profile: ${profileId}`);
        if (!db.getProvider(providerId))
            throw new EngineError(`Unknown provider: ${providerId}`);
        const binding = {
            id: randomUUID(),
            profileId,
            agentId,
            providerId,
            modelId,
        };
        db.upsertBinding(binding);
        return binding;
    }
    use(target, opts = {}) {
        const fallback = opts.agent && isAgentId(opts.agent) ? opts.agent : db.getState().currentAgent;
        const parsed = parseTarget(target, fallback);
        if (parsed.agent)
            this.setAgent(parsed.agent);
        if (parsed.kind === 'profile') {
            return this.applyProfile(parsed.id, { agent: parsed.agent, scope: opts.scope });
        }
        if (parsed.kind === 'provider') {
            return this.applyProvider(parsed.id, parsed.agent, opts.scope);
        }
        return this.applyModel(parsed.id, parsed.agent, opts.scope);
    }
    setAgent(agentId) {
        if (!isAgentId(agentId))
            throw new EngineError(`Unknown agent: ${agentId}. Use claude|codex|gemini|opencode`);
        db.setState({ currentAgent: agentId });
        return getAdapter(agentId);
    }
    setModel(model, opts = {}) {
        const agent = requireAgent(opts.agent || db.getState().currentAgent);
        return this.applyModel(model, agent);
    }
    applyProfile(profileId, opts = {}) {
        const profile = db.getProfile(profileId) || db.listProfiles().find((item) => item.name.toLowerCase() === profileId.toLowerCase());
        if (!profile)
            throw new EngineError(`Unknown profile: ${profileId}`);
        const bindings = opts.agent ? profile.bindings.filter((b) => b.agentId === opts.agent) : profile.bindings;
        if (!bindings.length)
            throw new EngineError(`Profile ${profile.name} has no bindings`);
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
    applyProvider(providerId, agentId, scope = 'global') {
        const provider = db.getProvider(providerId) ||
            db.listProviders().find((item) => item.name.toLowerCase() === providerId.toLowerCase());
        if (!provider)
            throw new EngineError(`Unknown provider: ${providerId}`);
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
    applyModel(modelQuery, agentId, scope = 'global') {
        const agent = requireAgent(agentId || db.getState().currentAgent);
        const found = findModel(modelQuery, agent);
        if (!found)
            throw new EngineError(`Unknown model: ${modelQuery}`);
        const provider = db.getProvider(found.providerId);
        if (!provider)
            throw new EngineError(`Model ${modelQuery} has no provider`);
        const result = emptyResult(scope);
        result.providerId = provider.id;
        result.model = found.modelId;
        result.agentId = agent;
        applyPayload(agent, { provider, model: found.modelId }, result);
        if (scope === 'global')
            db.setState({ currentModels: { [agent]: found.modelId } });
        db.logSwitch({ providerId: provider.id, agentId: agent, modelId: found.modelId, scope });
        return result;
    }
    launch(opts = {}) {
        const agent = requireAgent(opts.agent || db.getState().currentAgent);
        const payload = resolveLaunchPayload(agent, opts);
        return getAdapter(agent).sessionLaunch(payload, opts.extraArgs || []);
    }
    spawn(spec) {
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
    addMcp(input) {
        const server = {
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
    syncMcp() {
        const servers = db.listMcp();
        const synced = [];
        for (const adapter of adapters) {
            if (!adapter.syncMcp)
                continue;
            adapter.syncMcp(servers);
            synced.push(adapter.id);
        }
        return synced;
    }
    async ping(providerId, agentId) {
        const steps = [];
        for await (const step of this.pingSteps(providerId, agentId))
            steps.push(step);
        const summary = [...steps].reverse().find((item) => item.id === 'summary');
        const http = [...steps].reverse().find((item) => item.httpStatus);
        return {
            ok: summary?.status === 'ok' || summary?.status === 'warn',
            status: http?.httpStatus,
            url: http?.url || '',
            error: summary?.status === 'fail' ? summary.detail : undefined,
            steps,
        };
    }
    async *pingSteps(providerId, agentId) {
        yield { id: 'load', title: '读取供应商配置', status: 'running' };
        const provider = providerId
            ? db.getProvider(providerId) || db.listProviders().find((item) => item.name.toLowerCase() === providerId.toLowerCase())
            : payloadForAgent(requireAgent(agentId || db.getState().currentAgent)).provider;
        if (!provider) {
            yield { id: 'load', title: '读取供应商配置', status: 'fail', detail: '找不到供应商' };
            return;
        }
        const models = db.modelsForProvider(provider.id).map((item) => item.modelId);
        yield {
            id: 'load',
            title: '读取供应商配置',
            status: 'ok',
            detail: `${provider.name} · ${provider.apiKey ? '已配置 Key' : '未配置 Key'} · 模型 ${models.join(', ') || '无'}`,
        };
        const agent = agentId && isAgentId(agentId) ? agentId : undefined;
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
        const ranks = [];
        for (const protocol of protocols) {
            const proto = provider.protocols[protocol];
            if (!proto)
                continue;
            const headers = authHeaders(protocol, provider.apiKey);
            const getUrl = modelsUrl(proto.baseUrl, protocol);
            yield { id: `${protocol}-models`, title: `${labelOf(protocol)} 拉取模型列表`, status: 'running', method: 'GET', url: getUrl };
            const listed = await probe(getUrl, { method: 'GET', headers });
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
            ranks.push(listed.rank);
            if (listed.rank === 'ok')
                continue;
            const posts = postProbes(protocol, proto.baseUrl, models[0], headers, proto.wireApi);
            if (!posts.length) {
                yield { id: `${protocol}-chat`, title: `${labelOf(protocol)} 发送测试请求`, status: 'skip', detail: '没有可测的模型名，且模型列表不可用' };
                continue;
            }
            for (const post of posts) {
                yield { id: post.id, title: post.title, status: 'running', method: 'POST', url: post.url };
                const replied = await probe(post.url, { method: 'POST', headers: post.headers, body: post.body });
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
                ranks.push(replied.rank);
                if (replied.rank === 'ok')
                    break;
            }
        }
        const best = ranks.includes('ok') ? 'ok' : ranks.includes('warn') ? 'warn' : 'fail';
        yield {
            id: 'summary',
            title: best === 'ok' ? '测通成功' : best === 'warn' ? '服务可达' : '测通失败',
            status: best,
            detail: best === 'ok'
                ? '接口可用'
                : best === 'warn'
                    ? '地址是通的，但鉴权或请求被拒绝，请检查 API Key / 模型名'
                    : '连不上该地址',
        };
    }
    prompt() {
        const state = db.getState();
        const agent = state.currentAgent || 'none';
        const live = state.currentAgent ? getAdapter(state.currentAgent).readStatus() : undefined;
        const model = (state.currentAgent && state.currentModels[state.currentAgent]) || live?.model || '-';
        return `${agent}/${model}`;
    }
    ensureProviderProfile(provider, model) {
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
            if (!protocolFor(provider, adapter.protocol))
                continue;
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
function agentPresent(agentId) {
    const adapter = getAdapter(agentId);
    const detected = adapter.detect();
    const live = adapter.readStatus();
    return detected.installed || live.configured;
}
function protocolFor(provider, protocol) {
    if (provider.protocols[protocol])
        return provider.protocols[protocol];
    if (protocol === 'gemini')
        return provider.protocols.openai;
    return undefined;
}
function applyBinding(binding, result) {
    const provider = db.getProvider(binding.providerId);
    if (!provider) {
        result.skipped.push({ agentId: binding.agentId, reason: 'missing provider' });
        return;
    }
    applyPayload(binding.agentId, { provider, model: binding.modelId, extra: binding.extra }, result);
}
function applyPayload(agentId, payload, result) {
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
        if (result.scope === 'global')
            adapter.apply(payload);
        result.applied.push(agentId);
        result.agentId = result.agentId || agentId;
        result.providerId = payload.provider.id;
        result.model = payload.model;
    }
    catch (error) {
        result.skipped.push({
            agentId,
            reason: error instanceof Error ? error.message : String(error),
        });
    }
}
function resolveLaunchPayload(agent, opts) {
    if (opts.profile) {
        const profile = db.getProfile(opts.profile) ||
            db.listProfiles().find((item) => item.name.toLowerCase() === opts.profile.toLowerCase());
        if (!profile)
            throw new EngineError(`Unknown profile: ${opts.profile}`);
        const binding = profile.bindings.find((item) => item.agentId === agent);
        if (!binding)
            throw new EngineError(`Profile ${profile.name} has no ${agent} binding`);
        const provider = db.getProvider(binding.providerId);
        if (!provider)
            throw new EngineError(`Missing provider ${binding.providerId}`);
        return { provider, model: binding.modelId };
    }
    if (opts.target) {
        const parsed = parseTarget(opts.target, agent);
        if (parsed.kind === 'profile') {
            return resolveLaunchPayload(parsed.agent || agent, { profile: parsed.id });
        }
        if (parsed.kind === 'provider') {
            const provider = db.getProvider(parsed.id) ||
                db.listProviders().find((item) => item.name.toLowerCase() === parsed.id.toLowerCase());
            if (!provider)
                throw new EngineError(`Unknown provider: ${parsed.id}`);
            return { provider, model: defaultModelFor(provider.id, agent) };
        }
        const found = findModel(parsed.id, agent);
        if (!found)
            throw new EngineError(`Unknown model: ${parsed.id}`);
        const provider = db.getProvider(found.providerId);
        if (!provider)
            throw new EngineError(`Model ${parsed.id} has no provider`);
        return { provider, model: found.modelId };
    }
    return payloadForAgent(agent);
}
function payloadForAgent(agent) {
    const state = db.getState();
    if (state.currentProfile) {
        const profile = db.getProfile(state.currentProfile);
        const binding = profile?.bindings.find((item) => item.agentId === agent);
        if (binding) {
            const provider = db.getProvider(binding.providerId);
            if (provider)
                return { provider, model: binding.modelId };
        }
    }
    const live = getAdapter(agent).importLive();
    if (live)
        return live;
    throw new EngineError(`No provider configured for ${agent}. Run msw init or msw provider add`);
}
function defaultModelFor(providerId, agent) {
    const models = db.modelsForProvider(providerId);
    const hinted = models.find((model) => model.agentHint === agent) || models.find((model) => model.agentHint === 'any');
    if (hinted)
        return hinted.modelId;
    if (models[0])
        return models[0].modelId;
    const live = getAdapter(agent).readStatus().model;
    return live || 'default';
}
function findModel(query, agent) {
    const needle = query.toLowerCase();
    const models = db.listModels();
    return (models.find((model) => model.id.toLowerCase() === needle) ||
        models.find((model) => model.alias?.toLowerCase() === needle && (!model.agentHint || model.agentHint === 'any' || model.agentHint === agent)) ||
        models.find((model) => model.modelId.toLowerCase() === needle) ||
        models.find((model) => model.modelId.toLowerCase().includes(needle) || model.alias?.toLowerCase().includes(needle)));
}
function parseTarget(target, fallbackAgent) {
    let agent;
    let query = target;
    const colon = target.indexOf(':');
    if (colon > 0) {
        const head = target.slice(0, colon);
        if (isAgentId(head)) {
            agent = head;
            query = target.slice(colon + 1);
        }
    }
    if (query.startsWith('profile:'))
        return { kind: 'profile', id: query.slice(8), agent };
    if (query.startsWith('provider:'))
        return { kind: 'provider', id: query.slice(9), agent };
    if (query.startsWith('model:'))
        return { kind: 'model', id: query.slice(6), agent };
    const profile = db.getProfile(query) || db.listProfiles().find((item) => item.name.toLowerCase() === query.toLowerCase());
    if (profile)
        return { kind: 'profile', id: profile.id, agent };
    const provider = db.getProvider(query) || db.listProviders().find((item) => item.name.toLowerCase() === query.toLowerCase());
    if (provider)
        return { kind: 'provider', id: provider.id, agent: agent || fallbackAgent };
    return { kind: 'model', id: query, agent: agent || fallbackAgent };
}
function requireAgent(agentId) {
    if (!agentId)
        throw new EngineError('No current agent. Run msw agent codex|claude|gemini|opencode');
    if (!isAgentId(agentId))
        throw new EngineError(`Unknown agent: ${agentId}`);
    return agentId;
}
function emptyResult(scope) {
    return { scope, applied: [], skipped: [], backups: [] };
}
function uniqueId(base, exists) {
    if (!exists(base))
        return base;
    let i = 2;
    while (exists(`${base}-${i}`))
        i += 1;
    return `${base}-${i}`;
}
function modelsUrl(baseUrl, protocol) {
    const trimmed = baseUrl.replace(/\/$/, '');
    if (protocol === 'anthropic')
        return `${trimmed}/v1/models`;
    if (trimmed.endsWith('/v1'))
        return `${trimmed}/models`;
    return `${trimmed}/v1/models`;
}
function protocolsForAgent(agent) {
    if (agent === 'claude')
        return ['anthropic'];
    if (agent === 'codex' || agent === 'opencode')
        return ['openai'];
    if (agent === 'gemini')
        return ['gemini', 'openai'];
    return ['openai', 'anthropic', 'gemini'];
}
function labelOf(protocol) {
    if (protocol === 'anthropic')
        return 'Anthropic';
    if (protocol === 'gemini')
        return 'Gemini';
    return 'OpenAI';
}
function authHeaders(protocol, apiKey) {
    if (protocol === 'anthropic') {
        return { 'x-api-key': apiKey.trim(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    }
    const headers = { 'content-type': 'application/json' };
    if (apiKey.trim())
        headers.Authorization = `Bearer ${apiKey.trim()}`;
    return headers;
}
function postProbes(protocol, baseUrl, model, headers, wireApi) {
    if (!model)
        return [];
    const trimmed = baseUrl.replace(/\/$/, '');
    if (protocol === 'anthropic') {
        return [{
                id: 'anthropic-messages',
                title: 'Anthropic 发送测试消息',
                url: `${trimmed}/v1/messages`,
                headers,
                body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] }),
            }];
    }
    if (protocol === 'gemini') {
        const root = trimmed.endsWith('/v1') || trimmed.endsWith('/v1beta') ? trimmed : `${trimmed}/v1beta`;
        return [{
                id: 'gemini-generate',
                title: 'Gemini 发送测试请求',
                url: `${root}/models/${encodeURIComponent(model)}:generateContent`,
                headers,
                body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }] }),
            }];
    }
    const openaiRoot = trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
    const chat = {
        id: 'openai-chat',
        title: 'OpenAI Chat Completions 测试',
        url: `${openaiRoot}/chat/completions`,
        headers,
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 16 }),
    };
    const responses = {
        id: 'openai-responses',
        title: 'OpenAI Responses 测试',
        url: `${openaiRoot}/responses`,
        headers,
        body: JSON.stringify({ model, input: 'ping', max_output_tokens: 16 }),
    };
    return wireApi === 'responses' ? [responses, chat] : [chat, responses];
}
function jsonMessage(text) {
    try {
        const json = JSON.parse(text);
        return json.error?.message || json.message;
    }
    catch {
        return undefined;
    }
}
function classify(status) {
    if (!status)
        return 'fail';
    if (status >= 200 && status < 300)
        return 'ok';
    if (status === 401 || status === 403 || status === 400)
        return 'warn';
    return 'fail';
}
async function probe(url, init) {
    const started = Date.now();
    try {
        const res = await fetch(url, {
            method: init.method,
            headers: init.headers,
            body: init.body,
            signal: AbortSignal.timeout(12000),
        });
        const text = (await res.text()).slice(0, 280).replace(/\s+/g, ' ').trim();
        const ms = Date.now() - started;
        const rank = classify(res.status);
        const message = jsonMessage(text);
        let detail = message || text || `HTTP ${res.status}`;
        if (rank === 'warn' && (res.status === 401 || res.status === 403)) {
            detail = `服务可达，鉴权失败：${message || 'API Key 无效'}`;
        }
        else if (rank === 'warn' && res.status === 400) {
            detail = `服务可达，请求被拒绝：${message || text || 'HTTP 400'}`;
        }
        else if (rank === 'ok') {
            detail = message || '接口可用';
        }
        return { ok: rank === 'ok', rank, status: res.status, ms, detail };
    }
    catch (error) {
        return {
            ok: false,
            rank: 'fail',
            ms: Date.now() - started,
            detail: error instanceof Error ? error.message : String(error),
        };
    }
}
export const engine = new Engine();
