import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { adapters, getAdapter } from "../adapters/index.js";
import * as db from "./db.js";
import { atomicWrite, backupFiles, readText } from "./fsutil.js";
import { getPreset, PRESETS } from "./presets.js";
import { withPathEnv } from "./paths.js";
import { buildChildEnv, classifyProbe, cleanupPingDirs, commandLine, createPingDirs, isProbeTestStep, PING_TIMEOUT_MS, randomPingPrompt, runCommand, } from "./probe.js";
import { collectAgentInstallInfo, installAgentSteps, } from "./agent-install.js";
import { AGENT_CHOICES, AGENT_IDS, isAgentId, now, liveProviderKey, slug, } from "./types.js";
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
                providerId: live.providerId,
                currentProviderId: matchLiveProvider(adapter.id, live)?.id,
            };
        });
    }
    listProviders() {
        return db.listProviders();
    }
    listProvidersForAgent(agent) {
        const id = agent && isAgentId(agent) ? agent : db.getState().currentAgent;
        if (!id)
            return this.listProviders();
        return this.listProviders().filter((item) => providerSupportsAgent(item, id));
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
    listPresets() {
        return PRESETS;
    }
    listMcp() {
        return db.listMcp();
    }
    listLogs(limit = 20) {
        return db.listLogs(limit);
    }
    addProvider(input) {
        const preset = input.preset ? getPreset(input.preset) : undefined;
        const baseName = input.name || preset?.name || input.preset || 'custom';
        // Provider IDs are storage identifiers. Keep the human-readable name for
        // CLI/UI lookup, but never derive the ID from it.
        const id = randomUUID();
        const agent = resolveProviderAgent(input.agent);
        const protocols = isolatedProtocols(input, preset);
        if (!Object.keys(protocols).length) {
            if (agent) {
                const need = protocolsForAgent(agent).map(protocolLabel).join('/');
                throw new EngineError(`当前 ${agent} 需要 ${need} 地址。请填写该 Agent 的地址，或换一个支持 ${agent} 的预设`);
            }
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
        replaceProviderModels(id, modelListForAdd(input.models, preset), input.defaultModel);
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
            if (models.length)
                replaceProviderModels(id, models, patch.defaultModel);
        }
        return next;
    }
    deleteProvider(id) {
        const exact = db.getProvider(id);
        const named = db.listProviders().filter((item) => item.name.toLowerCase() === id.toLowerCase());
        const provider = exact || named[0];
        if (!provider)
            throw new EngineError(`Unknown provider: ${id}`);
        if (!exact && named.length > 1) {
            const ids = named.map((item) => `  ${item.id}`).join('\n');
            throw new EngineError(`多个供应商名为 ${id}，请用 id 删除:\n${ids}`);
        }
        db.deleteProvider(provider.id);
        return provider;
    }
    addModel(providerQuery, modelId) {
        const provider = requireProvider(providerQuery);
        const id = modelId.trim();
        if (!id)
            throw new EngineError('模型名不能为空');
        const existing = db.modelsForProvider(provider.id);
        if (existing.some((item) => item.modelId === id)) {
            throw new EngineError(`供应商 ${provider.name} 已有模型 ${id}`);
        }
        const model = {
            id: modelRowId(provider.id, id),
            providerId: provider.id,
            modelId: id,
            alias: slug(id),
            agentHint: 'any',
            sortOrder: db.nextModelSortOrder(provider.id),
            selected: existing.length === 0,
        };
        db.upsertModel(model);
        if (model.selected)
            db.setSelectedModel(provider.id, model.id);
        return db.modelsForProvider(provider.id).find((item) => item.id === model.id) || model;
    }
    removeModel(providerQuery, modelQuery) {
        const provider = requireProvider(providerQuery);
        const models = db.modelsForProvider(provider.id);
        const found = findProviderModel(models, modelQuery);
        if (!found)
            throw new EngineError(`供应商 ${provider.name} 没有模型 ${modelQuery}`);
        if (models.length <= 1)
            throw new EngineError('至少保留一个模型');
        db.deleteModel(found.id);
        if (found.selected) {
            const rest = db.modelsForProvider(provider.id);
            if (rest[0])
                db.setSelectedModel(provider.id, rest[0].id);
        }
        return found;
    }
    selectModel(providerQuery, modelQuery, opts = {}) {
        const agent = opts.agent && isAgentId(opts.agent) ? opts.agent : db.getState().currentAgent;
        const provider = findProvider(providerQuery, agent) || findProvider(providerQuery);
        if (!provider)
            throw new EngineError(`Unknown provider: ${providerQuery}`);
        const found = findProviderModel(db.modelsForProvider(provider.id), modelQuery);
        if (!found)
            throw new EngineError(`供应商 ${provider.name} 没有模型 ${modelQuery}`);
        db.setSelectedModel(provider.id, found.id);
        const model = { ...found, selected: true };
        const live = agent ? isLiveProvider(provider, agent) : false;
        const shouldApply = opts.apply === true || (opts.apply !== false && live);
        if (shouldApply && agent) {
            return { provider, model, applied: applySpecific(provider, found.modelId, agent) };
        }
        return { provider, model };
    }
    getAgentConfig(agentId) {
        const agent = requireAgent(agentId);
        const adapter = getAdapter(agent);
        const path = adapter.liveFiles()[0];
        if (!path)
            throw new EngineError(`No configuration file declared for ${agent}`);
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
    saveAgentConfig(agentId, content) {
        if (typeof content !== 'string')
            throw new EngineError('Configuration content must be text');
        const current = this.getAgentConfig(agentId);
        if (current.fileName.endsWith('.json')) {
            try {
                JSON.parse(content);
            }
            catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                throw new EngineError(`Invalid JSON: ${detail}`);
            }
        }
        const backup = backupFiles(current.agentId, [current.path]);
        atomicWrite(current.path, content);
        return { ...this.getAgentConfig(current.agentId), backup };
    }
    agentInstallInfo(agentId) {
        return collectAgentInstallInfo(requireAgent(agentId));
    }
    async *installAgent(agentId) {
        yield* installAgentSteps(requireAgent(agentId));
    }
    use(target, opts = {}) {
        const fallback = opts.agent && isAgentId(opts.agent) ? opts.agent : db.getState().currentAgent;
        const parsed = parseTarget(target, fallback);
        if (parsed.agent)
            this.setAgent(parsed.agent);
        if (parsed.kind === 'provider') {
            return this.applyProvider(parsed.id, parsed.agent, opts.scope);
        }
        return this.applyModel(parsed.id, parsed.agent, opts.scope);
    }
    setAgent(agentId) {
        if (!isAgentId(agentId))
            throw new EngineError(`Unknown agent: ${agentId}. Use ${AGENT_CHOICES}`);
        db.setState({ currentAgent: agentId });
        return getAdapter(agentId);
    }
    setModel(model, opts = {}) {
        const agent = requireAgent(opts.agent || db.getState().currentAgent);
        return this.applyModel(model, agent);
    }
    applyProvider(providerId, agentId, scope = 'global') {
        const agent = requireAgent(agentId || db.getState().currentAgent);
        const provider = findProvider(providerId, agent);
        if (!provider)
            throw new EngineError(`Unknown provider: ${providerId}`);
        const model = defaultModelFor(provider.id, agent);
        return applySpecific(provider, model, agent, scope);
    }
    applyModel(modelQuery, agentId, scope = 'global') {
        const agent = requireAgent(agentId || db.getState().currentAgent);
        const found = findModel(modelQuery, agent);
        if (!found)
            throw new EngineError(`Unknown model: ${modelQuery}`);
        const provider = db.getProvider(found.providerId);
        if (!provider)
            throw new EngineError(`Model ${modelQuery} has no provider`);
        db.setSelectedModel(provider.id, found.id);
        return applySpecific(provider, found.modelId, agent, scope);
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
        const test = [...steps].reverse().find((item) => isProbeTestStep(item));
        return {
            ok: summary?.status === 'ok' || summary?.status === 'warn',
            url: test?.url || '',
            error: summary?.status === 'fail' ? summary.detail : undefined,
            steps,
        };
    }
    async *pingSteps(providerId, agentId) {
        const pingPrompt = randomPingPrompt();
        yield { id: 'load', title: '读取供应商配置', status: 'running' };
        const requestedAgent = agentId || db.getState().currentAgent;
        const provider = providerId
            ? findProvider(providerId, requestedAgent && isAgentId(requestedAgent) ? requestedAgent : undefined)
            : payloadForAgent(requireAgent(requestedAgent)).provider;
        if (!provider) {
            const detail = '找不到供应商';
            yield { id: 'load', title: '读取供应商配置', status: 'fail', detail };
            yield { id: 'summary', title: '测通失败', status: 'fail', detail };
            return;
        }
        const agent = resolvePingAgent(provider, requestedAgent);
        const modelRows = db.modelsForProvider(provider.id);
        const pingModel = selectedModelId(modelRows);
        const modelLabel = modelRows.length
            ? modelRows.map((item) => `${item.modelId}${item.selected || item.modelId === pingModel ? '（当前）' : ''}`).join(', ')
            : '无';
        yield {
            id: 'load',
            title: '读取供应商配置',
            status: 'ok',
            detail: `${provider.name} · ${provider.apiKey ? '已配置 Key' : '未配置 Key'} · 模型 ${modelLabel}`,
        };
        if (!agent) {
            const detail = `请先选择 Agent，或使用 --agent ${AGENT_CHOICES}`;
            yield { id: 'protocol', title: '检查协议', status: 'fail', detail };
            yield { id: 'summary', title: '测通失败', status: 'fail', detail };
            return;
        }
        const wanted = protocolsForAgent(agent);
        const protocols = wanted.filter((item) => provider.protocols[item]?.baseUrl);
        if (!protocols.length) {
            const need = wanted.map(labelOf).join(' / ');
            const detail = `当前 ${agent} 需要 ${need} 地址，该供应商未配置`;
            yield { id: 'protocol', title: '检查协议', status: 'fail', detail };
            yield { id: 'summary', title: '测通失败', status: 'fail', detail };
            return;
        }
        yield {
            id: 'protocol',
            title: `按 ${agent} 通过 ${getAdapter(agent).displayName} SDK 测试`,
            status: 'ok',
            detail: protocols.map((item) => `${labelOf(item)} ${provider.protocols[item]?.baseUrl}`).join(' · '),
        };
        if (!pingModel) {
            const detail = '没有可测的模型名';
            yield { id: `${agent}-sdk`, title: `通过 ${getAdapter(agent).displayName} SDK 发送测试消息`, status: 'skip', detail };
            yield { id: 'summary', title: '测通失败', status: 'fail', detail };
            return;
        }
        const adapter = getAdapter(agent);
        const detected = adapter.detect();
        if (!detected.installed) {
            const detail = `未安装 ${adapter.displayName}，无法通过 Agent SDK 测通`;
            yield { id: 'binary', title: `检查 ${adapter.displayName}`, status: 'fail', detail };
            yield { id: 'summary', title: '测通失败', status: 'fail', detail };
            return;
        }
        yield {
            id: 'binary',
            title: `检查 ${adapter.displayName}`,
            status: 'ok',
            detail: detected.bin || adapter.binaries[0],
        };
        const dirs = createPingDirs();
        const stepId = `${agent}-sdk`;
        const title = `通过 ${adapter.displayName} SDK 发送测试消息「${pingPrompt}」`;
        try {
            const payload = {
                provider,
                model: pingModel,
                extra: { models: modelIdsForPayload(provider.id, pingModel) },
            };
            const spec = adapter.probeSpec(payload, pingPrompt, dirs.root);
            const url = commandLine(spec.command, spec.args);
            yield { id: stepId, title, status: 'running', method: 'SDK', url };
            withPathEnv(spec.pathEnv, () => adapter.apply(payload));
            const run = await runCommand({ command: spec.command, args: spec.args, env: buildChildEnv(spec.pathEnv, spec.env), outputFile: spec.outputFile }, { cwd: dirs.work, timeoutMs: PING_TIMEOUT_MS });
            const parsed = adapter.parseProbe(run);
            const judged = classifyProbe(run, parsed);
            yield {
                id: stepId,
                title,
                status: judged.rank,
                method: 'SDK',
                url,
                ms: run.ms,
                detail: judged.detail,
            };
            yield {
                id: 'summary',
                title: judged.rank === 'ok' ? '测通成功' : judged.rank === 'warn' ? '服务可达' : '测通失败',
                status: judged.rank,
                detail: judged.rank === 'ok'
                    ? `已通过 ${adapter.displayName} SDK 发送测试消息「${pingPrompt}」并收到响应`
                    : judged.rank === 'warn'
                        ? `Agent 已启动，但测试消息「${pingPrompt}」未通过，请检查 API Key、协议或模型名`
                        : `通过 ${adapter.displayName} SDK 发送测试消息「${pingPrompt}」失败，请检查地址、API Key 和模型名`,
            };
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            yield { id: stepId, title, status: 'fail', method: 'SDK', detail };
            yield { id: 'summary', title: '测通失败', status: 'fail', detail };
        }
        finally {
            cleanupPingDirs(dirs.root);
        }
    }
    prompt() {
        const state = db.getState();
        const agent = state.currentAgent || 'none';
        const live = state.currentAgent ? getAdapter(state.currentAgent).readStatus() : undefined;
        const model = (state.currentAgent && state.currentModels[state.currentAgent]) || live?.model || '-';
        return `${agent}/${model}`;
    }
}
function protocolFor(provider, protocol) {
    if (provider.protocols[protocol])
        return provider.protocols[protocol];
    if (protocol === 'gemini')
        return provider.protocols.openai;
    return undefined;
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
    const models = modelIdsForPayload(payload.provider.id, payload.model);
    payload = {
        ...payload,
        extra: {
            ...(payload.extra || {}),
            models,
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
    if (opts.target) {
        const parsed = parseTarget(opts.target, agent);
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
    const live = getAdapter(agent).readStatus();
    const provider = matchLiveProvider(agent, live);
    if (provider) {
        return { provider, model: defaultModelFor(provider.id, agent) };
    }
    const modelId = db.getState().currentModels[agent];
    if (modelId) {
        const found = findModel(modelId, agent);
        const fromModel = found ? db.getProvider(found.providerId) : undefined;
        if (fromModel && found)
            return { provider: fromModel, model: found.modelId };
    }
    throw new EngineError(`No provider configured for ${agent}. Run msw use <provider>`);
}
function applySpecific(provider, model, agent, scope = 'global') {
    const result = emptyResult(scope);
    result.providerId = provider.id;
    result.model = model;
    result.agentId = agent;
    applyPayload(agent, { provider, model }, result);
    if (scope === 'global')
        db.setState({ currentModels: { [agent]: model } });
    db.logSwitch({ providerId: provider.id, agentId: agent, modelId: model, scope });
    return result;
}
function defaultModelFor(providerId, agent) {
    const models = db.modelsForProvider(providerId);
    const selected = selectedModelId(models);
    if (selected)
        return selected;
    const hinted = models.find((model) => model.agentHint === agent) || models.find((model) => model.agentHint === 'any');
    if (hinted)
        return hinted.modelId;
    if (models[0])
        return models[0].modelId;
    const live = getAdapter(agent).readStatus().model;
    return live || 'default';
}
function selectedModelId(models) {
    return models.find((item) => item.selected)?.modelId || models[0]?.modelId;
}
function modelIdsForPayload(providerId, current) {
    const models = db.modelsForProvider(providerId).map((row) => row.modelId);
    const ordered = current && models.includes(current)
        ? [current, ...models.filter((item) => item !== current)]
        : current
            ? [current, ...models]
            : models;
    return [...new Set(ordered.length ? ordered : current ? [current] : [])];
}
function modelListForAdd(models, preset) {
    if (models?.length) {
        return models.map((modelId) => ({ modelId, alias: slug(modelId), agentHint: 'any' }));
    }
    if (preset?.models?.length)
        return preset.models;
    return [{ modelId: 'default', alias: 'default', agentHint: 'any' }];
}
function replaceProviderModels(providerId, models, defaultModel) {
    const rows = models
        .map((item) => (typeof item === 'string' ? { modelId: item.trim() } : { ...item, modelId: item.modelId.trim() }))
        .filter((item) => item.modelId);
    if (!rows.length)
        return;
    const previous = db.modelsForProvider(providerId).find((item) => item.selected)?.modelId;
    const ids = rows.map((item) => item.modelId);
    const chosen = (defaultModel && ids.includes(defaultModel))
        ? defaultModel
        : (previous && ids.includes(previous) ? previous : ids[0]);
    db.deleteModelsForProvider(providerId);
    rows.forEach((model, index) => {
        db.upsertModel({
            id: modelRowId(providerId, model.modelId),
            providerId,
            modelId: model.modelId,
            alias: model.alias || slug(model.modelId),
            agentHint: model.agentHint || 'any',
            sortOrder: index,
            selected: model.modelId === chosen,
        });
    });
}
function modelRowId(providerId, modelId) {
    return `${providerId}-${slug(modelId)}`;
}
function findProviderModel(models, query) {
    const needle = query.toLowerCase();
    return (models.find((item) => item.id.toLowerCase() === needle) ||
        models.find((item) => item.modelId.toLowerCase() === needle) ||
        models.find((item) => item.alias?.toLowerCase() === needle));
}
function requireProvider(query) {
    const provider = findProvider(query, db.getState().currentAgent) || findProvider(query);
    if (!provider)
        throw new EngineError(`Unknown provider: ${query}`);
    return provider;
}
function isLiveProvider(provider, agent) {
    return matchLiveProvider(agent, getAdapter(agent).readStatus())?.id === provider.id;
}
function findProvider(query, agent) {
    const exact = db.getProvider(query);
    if (exact)
        return exact;
    const named = db.listProviders().filter((item) => item.name.toLowerCase() === query.toLowerCase());
    if (!named.length)
        return undefined;
    if (agent) {
        const matching = named.filter((item) => providerSupportsAgent(item, agent));
        if (matching.length)
            return matching[0];
    }
    return named[0];
}
function findModel(query, agent) {
    const needle = query.toLowerCase();
    const models = db.listModels();
    const compatible = models.filter((model) => {
        const provider = db.getProvider(model.providerId);
        return provider ? providerSupportsAgent(provider, agent) : false;
    });
    const search = (list) => list.find((model) => model.id.toLowerCase() === needle) ||
        list.find((model) => model.alias?.toLowerCase() === needle && (!model.agentHint || model.agentHint === 'any' || model.agentHint === agent)) ||
        list.find((model) => model.modelId.toLowerCase() === needle) ||
        list.find((model) => model.modelId.toLowerCase().includes(needle) || model.alias?.toLowerCase().includes(needle));
    return search(compatible) || search(models);
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
    if (query.startsWith('provider:'))
        return { kind: 'provider', id: query.slice(9), agent };
    if (query.startsWith('model:'))
        return { kind: 'model', id: query.slice(6), agent };
    const provider = findProvider(query, agent || fallbackAgent);
    if (provider)
        return { kind: 'provider', id: provider.id, agent: agent || fallbackAgent };
    return { kind: 'model', id: query, agent: agent || fallbackAgent };
}
function requireAgent(agentId) {
    if (!agentId)
        throw new EngineError(`No current agent. Run msw agent ${AGENT_CHOICES}`);
    if (!isAgentId(agentId))
        throw new EngineError(`Unknown agent: ${agentId}`);
    return agentId;
}
function emptyResult(scope) {
    return { scope, applied: [], skipped: [], backups: [] };
}
function resolvePingAgent(provider, requested) {
    if (requested && isAgentId(requested))
        return requested;
    const current = db.getState().currentAgent;
    if (current && isAgentId(current))
        return current;
    const supported = AGENT_IDS.filter((item) => providerSupportsAgent(provider, item));
    if (supported.length === 1)
        return supported[0];
    if (provider.protocols.anthropic?.baseUrl && !provider.protocols.openai?.baseUrl && !provider.protocols.gemini?.baseUrl) {
        return 'claude';
    }
    if (provider.protocols.gemini?.baseUrl && !provider.protocols.openai?.baseUrl && !provider.protocols.anthropic?.baseUrl) {
        return 'gemini';
    }
    if (provider.protocols.openai?.baseUrl)
        return 'codex';
    return supported[0];
}
export function protocolsForAgent(agent) {
    if (agent === 'claude')
        return ['anthropic'];
    if (agent === 'codex' || agent === 'opencode' || agent === 'grok-build')
        return ['openai'];
    if (agent === 'gemini')
        return ['gemini'];
    return ['openai', 'anthropic', 'gemini'];
}
function resolveProviderAgent(agent) {
    if (agent && isAgentId(agent))
        return agent;
    const current = db.getState().currentAgent;
    return current && isAgentId(current) ? current : undefined;
}
function protocolFromUrl(protocol, baseUrl, input, existing) {
    if (protocol === 'openai') {
        return {
            baseUrl,
            wireApi: input.wireApi || existing?.wireApi || 'responses',
            authMode: existing?.authMode || 'openai_auth',
        };
    }
    if (protocol === 'anthropic') {
        return {
            baseUrl,
            authMode: existing?.authMode || 'auth_token',
        };
    }
    return { baseUrl };
}
function isolatedProtocols(input, preset) {
    const agent = resolveProviderAgent(input.agent);
    const merged = preset ? { ...preset.protocols } : {};
    if (input.openaiUrl) {
        merged.openai = protocolFromUrl('openai', input.openaiUrl, input, merged.openai);
    }
    if (input.anthropicUrl) {
        merged.anthropic = protocolFromUrl('anthropic', input.anthropicUrl, input, merged.anthropic);
    }
    if (input.geminiUrl) {
        merged.gemini = protocolFromUrl('gemini', input.geminiUrl, input, merged.gemini);
    }
    const present = ['openai', 'anthropic', 'gemini'].filter((item) => merged[item]?.baseUrl);
    if (agent) {
        const wanted = protocolsForAgent(agent);
        const next = {};
        for (const protocol of wanted) {
            if (merged[protocol]?.baseUrl)
                next[protocol] = merged[protocol];
        }
        if (!Object.keys(next).length) {
            const fallback = input.anthropicUrl || input.openaiUrl || input.geminiUrl;
            if (fallback) {
                const protocol = wanted[0];
                next[protocol] = protocolFromUrl(protocol, fallback, input, merged[protocol]);
            }
        }
        return next;
    }
    if (present.length > 1) {
        throw new EngineError(`添加供应商请指定 --agent ${AGENT_CHOICES}，不再创建同时给多个 Agent 用的供应商`);
    }
    const next = {};
    for (const protocol of present)
        next[protocol] = merged[protocol];
    return next;
}
export function providerSupportsAgent(provider, agent) {
    return protocolsForAgent(agent).some((item) => Boolean(provider.protocols[item]?.baseUrl));
}
function matchLiveProvider(agentId, live) {
    const providers = db.listProviders();
    if (agentId === 'codex' && live.providerId) {
        const key = live.providerId;
        return providers.find((item) => liveProviderKey(item.id, 'codex') === key || item.id === key);
    }
    if (agentId === 'opencode' && live.providerId) {
        const key = live.providerId;
        return providers.find((item) => liveProviderKey(item.id, 'opencode') === key || item.id === key);
    }
    if (agentId === 'grok-build' && live.providerId) {
        return providers.find((item) => item.id === live.providerId);
    }
    const url = (live.baseUrl || '').replace(/\/$/, '');
    if (!url)
        return undefined;
    const hits = providers.filter((item) => Object.values(item.protocols).some((cfg) => (cfg?.baseUrl || '').replace(/\/$/, '') === url));
    if (hits.length === 1)
        return hits[0];
    if (live.providerLabel) {
        return hits.find((item) => item.name === live.providerLabel || item.id === live.providerLabel);
    }
    return undefined;
}
export function protocolLabel(protocol) {
    return labelOf(protocol);
}
function labelOf(protocol) {
    if (protocol === 'anthropic')
        return 'Anthropic';
    if (protocol === 'gemini')
        return 'Gemini';
    return 'OpenAI';
}
export const engine = new Engine();
