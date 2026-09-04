import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { backupFiles, readJson, writeJson } from "../core/fsutil.js";
import { claudeHome, claudeJsonPath } from "../core/paths.js";
import { now } from "../core/types.js";
import { findBinary } from "./which.js";
function settingsPath() {
    return join(claudeHome(), 'settings.json');
}
function envFromProvider(provider, model) {
    const proto = provider.protocols.anthropic;
    if (!proto)
        throw new Error(`Provider ${provider.id} has no Anthropic protocol for Claude Code`);
    const env = {
        ANTHROPIC_BASE_URL: proto.baseUrl.replace(/\/$/, ''),
        ANTHROPIC_MODEL: model,
        ANTHROPIC_DEFAULT_OPUS_MODEL: model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    };
    if (proto.authMode === 'api_key') {
        env.ANTHROPIC_API_KEY = provider.apiKey;
        env.ANTHROPIC_AUTH_TOKEN = '';
    }
    else {
        env.ANTHROPIC_AUTH_TOKEN = provider.apiKey;
        env.ANTHROPIC_API_KEY = '';
    }
    return env;
}
export const claudeAdapter = {
    id: 'claude',
    displayName: 'Claude Code',
    protocol: 'anthropic',
    binaries: ['claude'],
    detect() {
        const bin = findBinary(this.binaries);
        return { installed: Boolean(bin), bin };
    },
    liveFiles() {
        return [settingsPath(), claudeJsonPath()];
    },
    importLive() {
        const settings = readJson(settingsPath()) || {};
        const env = settings.env || {};
        const baseUrl = env.ANTHROPIC_BASE_URL || '';
        const apiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '';
        const model = env.ANTHROPIC_MODEL || settings.model || '';
        if (!baseUrl && !apiKey && !model)
            return null;
        const authMode = env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN ? 'api_key' : 'auth_token';
        const provider = {
            id: 'imported-claude',
            name: 'Imported Claude',
            apiKey,
            protocols: {
                anthropic: {
                    baseUrl: baseUrl || 'https://api.anthropic.com',
                    authMode,
                },
            },
            createdAt: now(),
            updatedAt: now(),
        };
        return { provider, model: model || 'claude-sonnet-4-6' };
    },
    apply(payload) {
        backupFiles('claude', this.liveFiles());
        const settings = readJson(settingsPath()) || {};
        const nextEnv = { ...(settings.env || {}) };
        const incoming = envFromProvider(payload.provider, payload.model);
        for (const [key, value] of Object.entries(incoming)) {
            if (value)
                nextEnv[key] = value;
            else
                delete nextEnv[key];
        }
        settings.env = nextEnv;
        if (payload.model)
            settings.model = payload.model;
        writeJson(settingsPath(), settings);
    },
    readStatus() {
        const settings = readJson(settingsPath());
        const env = settings?.env || {};
        return {
            configured: existsSync(settingsPath()),
            model: env.ANTHROPIC_MODEL || settings?.model,
            baseUrl: env.ANTHROPIC_BASE_URL,
            providerLabel: env.ANTHROPIC_BASE_URL,
        };
    },
    sessionLaunch(payload, extraArgs) {
        const bin = findBinary(this.binaries) || 'claude';
        const env = envFromProvider(payload.provider, payload.model);
        const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value));
        return { command: bin, args: extraArgs, env: cleaned };
    },
    syncMcp(servers) {
        const file = claudeJsonPath();
        const json = readJson(file) || {};
        const mcp = json.mcpServers || {};
        for (const server of servers.filter((item) => item.agents.includes('claude'))) {
            if (server.transport === 'stdio') {
                mcp[server.name] = {
                    command: server.command,
                    args: server.args,
                    env: server.env,
                };
            }
            else {
                mcp[server.name] = {
                    type: server.transport,
                    url: server.url,
                };
            }
        }
        json.mcpServers = mcp;
        writeJson(file, json);
    },
};
