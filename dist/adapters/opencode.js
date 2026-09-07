import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { backupFiles, readJson, writeJson } from "../core/fsutil.js";
import { opencodeHome } from "../core/paths.js";
import { liveProviderKey } from "../core/types.js";
import { findBinary } from "./which.js";
function configPath() {
    return join(opencodeHome(), 'opencode.json');
}
function providerKey(provider) {
    return liveProviderKey(provider.id, 'opencode');
}
export const opencodeAdapter = {
    id: 'opencode',
    displayName: 'OpenCode',
    protocol: 'openai',
    binaries: ['opencode'],
    detect() {
        const bin = findBinary(this.binaries);
        return { installed: Boolean(bin), bin };
    },
    liveFiles() {
        return [configPath(), join(opencodeHome(), 'AGENTS.md')];
    },
    apply(payload) {
        backupFiles('opencode', [configPath()]);
        const proto = payload.provider.protocols.openai;
        if (!proto)
            throw new Error(`Provider ${payload.provider.id} has no OpenAI protocol for OpenCode`);
        const config = readJson(configPath()) || {};
        const key = providerKey(payload.provider);
        const providers = { ...(config.provider || {}) };
        const current = providers[key] || {};
        providers[key] = {
            ...current,
            npm: current.npm || '@ai-sdk/openai-compatible',
            name: payload.provider.name,
            options: {
                ...(current.options || {}),
                baseURL: proto.baseUrl,
                apiKey: payload.provider.apiKey,
            },
            models: {
                ...(current.models || {}),
                [payload.model]: { name: payload.model },
            },
        };
        config.provider = providers;
        config.model = `${key}/${payload.model}`;
        writeJson(configPath(), config);
    },
    readStatus() {
        const config = readJson(configPath());
        if (!config)
            return { configured: existsSync(configPath()) };
        const model = String(config.model || '');
        const provId = model.split('/')[0];
        const entry = config.provider?.[provId];
        return {
            configured: true,
            model: model.includes('/') ? model.slice(model.indexOf('/') + 1) : model,
            baseUrl: entry?.options?.baseURL,
            providerLabel: entry?.name || provId,
            providerId: provId || undefined,
        };
    },
    sessionLaunch(payload, extraArgs) {
        const bin = findBinary(this.binaries) || 'opencode';
        const key = providerKey(payload.provider);
        return {
            command: bin,
            args: extraArgs,
            env: {
                OPENCODE_MODEL: `${key}/${payload.model}`,
            },
        };
    },
    syncMcp(servers) {
        const config = readJson(configPath()) || {};
        const mcp = { ...(config.mcp || {}) };
        for (const server of servers.filter((item) => item.agents.includes('opencode'))) {
            if (server.transport === 'stdio') {
                mcp[server.name] = { type: 'local', command: [server.command, ...server.args].filter(Boolean) };
            }
            else {
                mcp[server.name] = { type: 'remote', url: server.url };
            }
        }
        config.mcp = mcp;
        writeJson(configPath(), config);
    },
};
