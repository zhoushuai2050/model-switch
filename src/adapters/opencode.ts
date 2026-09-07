import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { backupFiles, readJson, writeJson } from '../core/fsutil.ts';
import { opencodeHome } from '../core/paths.ts';
import type { ApplyPayload, McpServer, Provider } from '../core/types.ts';
import { liveProviderKey } from '../core/types.ts';
import type { Adapter, LaunchSpec } from './types.ts';
import { findBinary } from './which.ts';

type OpenCodeConfig = {
  model?: string;
  provider?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
  [key: string]: unknown;
};

function configPath(): string {
  return join(opencodeHome(), 'opencode.json');
}

function providerKey(provider: Provider): string {
  return liveProviderKey(provider.id, 'opencode');
}

export const opencodeAdapter: Adapter = {
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
  apply(payload: ApplyPayload) {
    backupFiles('opencode', [configPath()]);
    const proto = payload.provider.protocols.openai;
    if (!proto) throw new Error(`Provider ${payload.provider.id} has no OpenAI protocol for OpenCode`);
    const config = readJson<OpenCodeConfig>(configPath()) || {};
    const key = providerKey(payload.provider);
    const providers = { ...(config.provider || {}) };
    const current = (providers[key] as Record<string, unknown>) || {};
    providers[key] = {
      ...current,
      npm: current.npm || '@ai-sdk/openai-compatible',
      name: payload.provider.name,
      options: {
        ...((current.options as Record<string, unknown>) || {}),
        baseURL: proto.baseUrl,
        apiKey: payload.provider.apiKey,
      },
      models: {
        ...((current.models as Record<string, unknown>) || {}),
        [payload.model]: { name: payload.model },
      },
    };
    config.provider = providers;
    config.model = `${key}/${payload.model}`;
    writeJson(configPath(), config);
  },
  readStatus() {
    const config = readJson<OpenCodeConfig>(configPath());
    if (!config) return { configured: existsSync(configPath()) };
    const model = String(config.model || '');
    const provId = model.split('/')[0];
    const entry = config.provider?.[provId] as { options?: { baseURL?: string }; name?: string } | undefined;
    return {
      configured: true,
      model: model.includes('/') ? model.slice(model.indexOf('/') + 1) : model,
      baseUrl: entry?.options?.baseURL,
      providerLabel: entry?.name || provId,
      providerId: provId || undefined,
    };
  },
  sessionLaunch(payload: ApplyPayload, extraArgs: string[]): LaunchSpec {
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
  syncMcp(servers: McpServer[]) {
    const config = readJson<OpenCodeConfig>(configPath()) || {};
    const mcp = { ...(config.mcp || {}) };
    for (const server of servers.filter((item) => item.agents.includes('opencode'))) {
      if (server.transport === 'stdio') {
        mcp[server.name] = { type: 'local', command: [server.command, ...server.args].filter(Boolean) };
      } else {
        mcp[server.name] = { type: 'remote', url: server.url };
      }
    }
    config.mcp = mcp;
    writeJson(configPath(), config);
  },
};
