import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { backupFiles, readJson, writeJson } from '../core/fsutil.ts';
import { claudeHome, claudeJsonPath } from '../core/paths.ts';
import type { ApplyPayload, McpServer, Provider } from '../core/types.ts';
import type { Adapter, LaunchSpec } from './types.ts';
import { findBinary } from './which.ts';

type Settings = {
  env?: Record<string, string>;
  model?: string;
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
};

function settingsPath(): string {
  return join(claudeHome(), 'settings.json');
}

function envFromProvider(provider: Provider, model: string): Record<string, string> {
  const proto = provider.protocols.anthropic;
  if (!proto) throw new Error(`Provider ${provider.id} has no Anthropic protocol for Claude Code`);
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: proto.baseUrl.replace(/\/$/, ''),
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
  };
  if (proto.authMode === 'api_key') {
    env.ANTHROPIC_API_KEY = provider.apiKey;
    env.ANTHROPIC_AUTH_TOKEN = '';
  } else {
    env.ANTHROPIC_AUTH_TOKEN = provider.apiKey;
    env.ANTHROPIC_API_KEY = '';
  }
  return env;
}

export const claudeAdapter: Adapter = {
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
  apply(payload: ApplyPayload) {
    backupFiles('claude', this.liveFiles());
    const settings = readJson<Settings>(settingsPath()) || {};
    const nextEnv = { ...(settings.env || {}) };
    const incoming = envFromProvider(payload.provider, payload.model);
    for (const [key, value] of Object.entries(incoming)) {
      if (value) nextEnv[key] = value;
      else delete nextEnv[key];
    }
    settings.env = nextEnv;
    if (payload.model) settings.model = payload.model;
    writeJson(settingsPath(), settings);
  },
  readStatus() {
    const settings = readJson<Settings>(settingsPath());
    const env = settings?.env || {};
    return {
      configured: existsSync(settingsPath()),
      model: env.ANTHROPIC_MODEL || settings?.model,
      baseUrl: env.ANTHROPIC_BASE_URL,
      providerLabel: env.ANTHROPIC_BASE_URL,
    };
  },
  sessionLaunch(payload: ApplyPayload, extraArgs: string[]): LaunchSpec {
    const bin = findBinary(this.binaries) || 'claude';
    const env = envFromProvider(payload.provider, payload.model);
    const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value));
    return { command: bin, args: extraArgs, env: cleaned };
  },
  syncMcp(servers: McpServer[]) {
    const file = claudeJsonPath();
    const json = readJson<Record<string, unknown>>(file) || {};
    const mcp = (json.mcpServers as Record<string, unknown>) || {};
    for (const server of servers.filter((item) => item.agents.includes('claude'))) {
      if (server.transport === 'stdio') {
        mcp[server.name] = {
          command: server.command,
          args: server.args,
          env: server.env,
        };
      } else {
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
