import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { backupFiles, readJson, writeJson } from "../core/fsutil.js";
import { claudeHome, claudeJsonPath } from "../core/paths.js";
import { findBinary } from "./which.js";
const CLAUDE_ALIASES = ['opus', 'sonnet', 'haiku'];
function settingsPath() {
    return join(claudeHome(), 'settings.json');
}
function anthropicBaseUrl(url) {
    return url.replace(/\/+$/, '').replace(/\/v1$/i, '');
}
function claudeAlias(model) {
    const lower = model.toLowerCase();
    if (lower.includes('opus'))
        return 'opus';
    if (lower.includes('haiku'))
        return 'haiku';
    return 'sonnet';
}
function envFromProvider(provider, model) {
    const proto = provider.protocols.anthropic;
    if (!proto)
        throw new Error(`Provider ${provider.id} has no Anthropic protocol for Claude Code`);
    // Claude Code's /model picker only accepts official aliases. Map the upstream
    // id through ANTHROPIC_DEFAULT_*_MODEL and never set ANTHROPIC_MODEL.
    const env = {
        ANTHROPIC_BASE_URL: anthropicBaseUrl(proto.baseUrl),
        ANTHROPIC_MODEL: '',
        ANTHROPIC_DEFAULT_MODEL: '',
        ANTHROPIC_DEFAULT_OPUS_MODEL: model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
        ANTHROPIC_SMALL_FAST_MODEL: model,
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
function applyEnvTemplate(current, incoming) {
    const next = { ...current };
    for (const [key, value] of Object.entries(incoming)) {
        if (value)
            next[key] = value;
        else
            delete next[key];
    }
    return next;
}
function mappedModel(settings) {
    if (!settings)
        return undefined;
    const env = settings.env || {};
    const alias = settings.model;
    const fromAlias = alias === 'opus'
        ? env.ANTHROPIC_DEFAULT_OPUS_MODEL
        : alias === 'haiku'
            ? env.ANTHROPIC_DEFAULT_HAIKU_MODEL
            : env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    return env.ANTHROPIC_MODEL || fromAlias || settings.model;
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
    apply(payload) {
        backupFiles('claude', this.liveFiles());
        const settings = readJson(settingsPath()) || {};
        settings.env = applyEnvTemplate(settings.env || {}, envFromProvider(payload.provider, payload.model));
        if (payload.model)
            settings.model = claudeAlias(payload.model);
        writeJson(settingsPath(), settings);
    },
    readStatus() {
        const settings = readJson(settingsPath());
        const env = settings?.env || {};
        return {
            configured: existsSync(settingsPath()),
            model: mappedModel(settings),
            baseUrl: env.ANTHROPIC_BASE_URL,
            providerLabel: env.ANTHROPIC_BASE_URL,
        };
    },
    sessionLaunch(payload, extraArgs) {
        const bin = findBinary(this.binaries) || 'claude';
        const env = envFromProvider(payload.provider, payload.model);
        const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value));
        const alias = claudeAlias(payload.model);
        const args = extraArgs.some((item) => item === '--model' || item === '-m' || item.startsWith('--model='))
            ? extraArgs
            : ['--model', alias, ...extraArgs];
        return { command: bin, args, env: cleaned };
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
