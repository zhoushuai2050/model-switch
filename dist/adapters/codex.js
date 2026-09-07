import { join } from 'node:path';
import { backupFiles, readText, writeJson, atomicWrite } from "../core/fsutil.js";
import { codexHome } from "../core/paths.js";
import { getTable, getTopLevel, removeTable, setTopLevel, upsertTable } from "../core/toml.js";
import { liveProviderKey, payloadModelIds } from "../core/types.js";
import { findBinary } from "./which.js";
function configPath() {
    return join(codexHome(), 'config.toml');
}
function catalogPath() {
    return join(codexHome(), 'msw-model-catalog.json');
}
const CATALOG_REL = 'msw-model-catalog.json';
function writeModelCatalog(models) {
    const entries = models.map((slug, index) => ({
        slug,
        display_name: slug,
        description: slug,
        base_instructions: 'You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user\'s goals.',
        default_reasoning_level: 'high',
        supported_reasoning_levels: [
            { effort: 'none', description: 'Disable Thinking' },
            { effort: 'high', description: 'Enabled Thinking' },
        ],
        shell_type: 'shell_command',
        visibility: 'list',
        supported_in_api: true,
        priority: 1000 + index,
        supports_reasoning_summaries: true,
        default_reasoning_summary: 'none',
        support_verbosity: false,
        truncation_policy: { mode: 'bytes', limit: 10000 },
        supports_parallel_tool_calls: false,
        supports_image_detail_original: false,
        context_window: 262144,
        max_context_window: 262144,
        effective_context_window_percent: 95,
        experimental_supported_tools: [],
        input_modalities: ['text', 'image'],
        supports_search_tool: false,
    }));
    writeJson(catalogPath(), { models: entries });
}
function providerTableId(provider) {
    return liveProviderKey(provider.id, 'codex');
}
function applyProviderTable(text, provider) {
    const proto = provider.protocols.openai;
    if (!proto)
        throw new Error(`Provider ${provider.id} has no OpenAI protocol for Codex`);
    const tableId = providerTableId(provider);
    const useEnv = proto.authMode === 'env_key' && Boolean(proto.envKey);
    const entries = {
        name: provider.name,
        base_url: proto.baseUrl,
        wire_api: 'responses',
        requires_openai_auth: false,
    };
    if (useEnv) {
        entries.env_key = proto.envKey;
    }
    else if (provider.apiKey) {
        // OpenCode keeps the key on the provider (`options.apiKey`). Codex's equivalent
        // is experimental_bearer_token; auth.json is only for official ChatGPT login.
        entries.experimental_bearer_token = provider.apiKey;
    }
    let next = upsertTable(text, `model_providers.${tableId}`, entries);
    const headerTable = `model_providers.${tableId}.http_headers`;
    if (!useEnv && provider.apiKey) {
        // OpenCode `options.headers` analog; also works if an older Codex ignores the token field.
        next = upsertTable(next, headerTable, {
            Authorization: `Bearer ${provider.apiKey}`,
        });
    }
    else {
        next = removeTable(next, headerTable);
    }
    return { text: sanitizeWireApi(next), tableId };
}
function sanitizeWireApi(text) {
    return text.replace(/^wire_api\s*=\s*"chat"\s*$/gm, 'wire_api = "responses"');
}
export const codexAdapter = {
    id: 'codex',
    displayName: 'Codex',
    protocol: 'openai',
    binaries: ['codex'],
    detect() {
        const bin = findBinary(this.binaries);
        return { installed: Boolean(bin), bin };
    },
    liveFiles() {
        return [configPath(), catalogPath()];
    },
    apply(payload) {
        backupFiles('codex', this.liveFiles());
        const models = payloadModelIds(payload);
        writeModelCatalog(models);
        let text = readText(configPath()) || '';
        const applied = applyProviderTable(text, payload.provider);
        text = setTopLevel(applied.text, 'model_provider', applied.tableId);
        text = setTopLevel(text, 'model', payload.model);
        text = setTopLevel(text, 'model_catalog_json', CATALOG_REL);
        atomicWrite(configPath(), text.endsWith('\n') ? text : `${text}\n`);
    },
    readStatus() {
        const text = readText(configPath());
        if (!text)
            return { configured: false };
        const model = getTopLevel(text, 'model');
        const providerId = getTopLevel(text, 'model_provider');
        const table = providerId ? getTable(text, `model_providers.${providerId}`) : undefined;
        return {
            configured: true,
            model,
            baseUrl: typeof table?.base_url === 'string' ? table.base_url : undefined,
            providerLabel: typeof table?.name === 'string' ? table.name : providerId,
            providerId,
        };
    },
    sessionLaunch(payload, extraArgs) {
        const bin = findBinary(this.binaries) || 'codex';
        const proto = payload.provider.protocols.openai;
        if (!proto)
            throw new Error(`Provider ${payload.provider.id} has no OpenAI protocol for Codex`);
        const tableId = providerTableId(payload.provider);
        const text = readText(configPath()) || '';
        const applied = applyProviderTable(text, payload.provider);
        if (applied.text !== text) {
            atomicWrite(configPath(), applied.text.endsWith('\n') ? applied.text : `${applied.text}\n`);
        }
        const args = [
            '-c',
            `model=${payload.model}`,
            '-c',
            `model_provider=${tableId}`,
            ...extraArgs,
        ];
        const env = {};
        if (payload.provider.apiKey)
            env.OPENAI_API_KEY = payload.provider.apiKey;
        return { command: bin, args, env };
    },
    syncMcp(servers) {
        let text = readText(configPath()) || '';
        for (const server of servers.filter((item) => item.agents.includes('codex'))) {
            if (server.transport === 'stdio') {
                text = upsertTable(text, `mcp_servers.${server.name}`, {
                    command: server.command || '',
                    args: server.args,
                });
            }
            else {
                text = upsertTable(text, `mcp_servers.${server.name}`, {
                    url: server.url || '',
                });
            }
        }
        atomicWrite(configPath(), text.endsWith('\n') ? text : `${text}\n`);
    },
};
