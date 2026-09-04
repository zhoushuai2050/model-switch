import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite, backupFiles, readJson, readText, writeJson } from '../core/fsutil.ts';
import { parseEnv, stringifyEnv } from '../core/envfile.ts';
import { geminiHome } from '../core/paths.ts';
import type { ApplyPayload, McpServer, Provider } from '../core/types.ts';
import { now } from '../core/types.ts';
import type { Adapter, LaunchSpec } from './types.ts';
import { findBinary } from './which.ts';

function envPath(): string {
  return join(geminiHome(), '.env');
}

function settingsPath(): string {
  return join(geminiHome(), 'settings.json');
}

function envFromProvider(provider: Provider, model: string): Record<string, string> {
  const proto = provider.protocols.gemini || provider.protocols.openai;
  if (!proto) throw new Error(`Provider ${provider.id} has no Gemini/OpenAI protocol`);
  return {
    GEMINI_API_KEY: provider.apiKey,
    GOOGLE_GEMINI_BASE_URL: proto.baseUrl,
    GEMINI_MODEL: model,
  };
}

export const geminiAdapter: Adapter = {
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
  importLive() {
    const text = readText(envPath()) || '';
    const env = parseEnv(text);
    const settings = readJson<{ model?: string }>(settingsPath()) || {};
    const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '';
    const baseUrl = env.GOOGLE_GEMINI_BASE_URL || '';
    const model = env.GEMINI_MODEL || settings.model || '';
    if (!apiKey && !baseUrl && !model) return null;
    const provider: Provider = {
      id: 'imported-gemini',
      name: 'Imported Gemini',
      apiKey,
      protocols: {
        gemini: { baseUrl: baseUrl || 'https://generativelanguage.googleapis.com' },
        openai: baseUrl ? { baseUrl, wireApi: 'chat' } : undefined,
      },
      createdAt: now(),
      updatedAt: now(),
    };
    return { provider, model: model || 'gemini-2.5-pro' };
  },
  apply(payload: ApplyPayload) {
    backupFiles('gemini', this.liveFiles());
    const original = readText(envPath()) || '';
    const next = stringifyEnv(envFromProvider(payload.provider, payload.model), original);
    atomicWrite(envPath(), next);
    const settings = readJson<Record<string, unknown>>(settingsPath()) || {};
    settings.model = payload.model;
    writeJson(settingsPath(), settings);
  },
  readStatus() {
    const env = parseEnv(readText(envPath()) || '');
    const settings = readJson<{ model?: string }>(settingsPath());
    return {
      configured: existsSync(envPath()) || existsSync(settingsPath()),
      model: env.GEMINI_MODEL || settings?.model,
      baseUrl: env.GOOGLE_GEMINI_BASE_URL,
      providerLabel: env.GOOGLE_GEMINI_BASE_URL,
    };
  },
  sessionLaunch(payload: ApplyPayload, extraArgs: string[]): LaunchSpec {
    const bin = findBinary(this.binaries) || 'gemini';
    return {
      command: bin,
      args: extraArgs,
      env: envFromProvider(payload.provider, payload.model),
    };
  },
  syncMcp(servers: McpServer[]) {
    const settings = readJson<Record<string, unknown>>(settingsPath()) || {};
    const mcp = (settings.mcpServers as Record<string, unknown>) || {};
    for (const server of servers.filter((item) => item.agents.includes('gemini'))) {
      if (server.transport === 'stdio') {
        mcp[server.name] = { command: server.command, args: server.args, env: server.env };
      } else {
        mcp[server.name] = { httpUrl: server.url };
      }
    }
    settings.mcpServers = mcp;
    writeJson(settingsPath(), settings);
  },
};
