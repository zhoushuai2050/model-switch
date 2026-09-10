import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite, backupFiles, readJson, readText, writeJson } from "../core/fsutil.js";
import { parseEnv, stringifyEnv } from "../core/envfile.js";
import { geminiHome } from "../core/paths.js";
import { asRecord, asString, extractJson } from "../core/probe.js";
import { findBinary } from "./which.js";
function envPath() {
    return join(geminiHome(), '.env');
}
function settingsPath() {
    return join(geminiHome(), 'settings.json');
}
function envFromProvider(provider, model) {
    const proto = provider.protocols.gemini || provider.protocols.openai;
    if (!proto)
        throw new Error(`Provider ${provider.id} has no Gemini/OpenAI protocol`);
    return {
        GEMINI_API_KEY: provider.apiKey,
        GOOGLE_GEMINI_BASE_URL: proto.baseUrl,
        GEMINI_MODEL: model,
    };
}
export const geminiAdapter = {
    id: 'gemini',
    displayName: 'Gemini CLI',
    protocol: 'gemini',
    binaries: ['gemini'],
    detect() {
        const bin = findBinary(this.binaries);
        return { installed: Boolean(bin), bin };
    },
    liveFiles() {
        return [envPath(), settingsPath()];
    },
    apply(payload) {
        backupFiles('gemini', this.liveFiles());
        const original = readText(envPath()) || '';
        const next = stringifyEnv(envFromProvider(payload.provider, payload.model), original);
        atomicWrite(envPath(), next);
        const settings = readJson(settingsPath()) || {};
        settings.model = payload.model;
        writeJson(settingsPath(), settings);
    },
    readStatus() {
        const env = parseEnv(readText(envPath()) || '');
        const settings = readJson(settingsPath());
        return {
            configured: existsSync(envPath()) || existsSync(settingsPath()),
            model: env.GEMINI_MODEL || settings?.model,
            baseUrl: env.GOOGLE_GEMINI_BASE_URL,
            providerLabel: env.GOOGLE_GEMINI_BASE_URL,
        };
    },
    sessionLaunch(payload, extraArgs) {
        const bin = findBinary(this.binaries) || 'gemini';
        return {
            command: bin,
            args: extraArgs,
            env: envFromProvider(payload.provider, payload.model),
        };
    },
    probeSpec(payload, prompt, isolatedHome) {
        const bin = findBinary(this.binaries) || 'gemini';
        return {
            command: bin,
            args: [
                '-p', prompt,
                '--output-format', 'json',
                '-m', payload.model,
            ],
            env: envFromProvider(payload.provider, payload.model),
            pathEnv: { GEMINI_CONFIG_DIR: isolatedHome },
        };
    },
    parseProbe(input) {
        const json = extractJson(input.stdout) ?? extractJson(input.stderr);
        const root = asRecord(json);
        if (root) {
            const error = asRecord(root.error);
            if (error)
                return { error: asString(error.message) || asString(root.error) || 'Gemini CLI 报错' };
            const response = asString(root.response) || asString(root.result) || asString(root.text);
            if (response)
                return { reply: response };
        }
        if (input.code === 0 && input.stdout.trim())
            return { reply: input.stdout.trim() };
        return { error: input.stderr.trim() || input.stdout.trim() || input.spawnError };
    },
    syncMcp(servers) {
        const settings = readJson(settingsPath()) || {};
        const mcp = settings.mcpServers || {};
        for (const server of servers.filter((item) => item.agents.includes('gemini'))) {
            if (server.transport === 'stdio') {
                mcp[server.name] = { command: server.command, args: server.args, env: server.env };
            }
            else {
                mcp[server.name] = { httpUrl: server.url };
            }
        }
        settings.mcpServers = mcp;
        writeJson(settingsPath(), settings);
    },
};
