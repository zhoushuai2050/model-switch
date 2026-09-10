import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { backupFiles, readJson, writeJson } from '../core/fsutil.ts';
import { opencodeDataHome, opencodeHome } from '../core/paths.ts';
import type { ApplyPayload, McpServer, Provider } from '../core/types.ts';
import { liveProviderKey, payloadModelIds } from '../core/types.ts';
import { asRecord, asString, collectJsonlText, extractJson } from '../core/probe.ts';
import type { Adapter, LaunchSpec, ProbeParseInput, ProbeParseResult, ProbeSpec } from './types.ts';
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

function authPath(): string {
  return join(opencodeDataHome(), 'auth.json');
}

function providerKey(provider: Provider): string {
  return liveProviderKey(provider.id, 'opencode');
}

function writeAuth(providerId: string, apiKey: string): void {
  if (!apiKey) return;
  const auth = readJson<Record<string, unknown>>(authPath()) || {};
  auth[providerId] = { type: 'api', key: apiKey };
  writeJson(authPath(), auth, 0o600);
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
    return [configPath(), authPath(), join(opencodeHome(), 'AGENTS.md')];
  },
  apply(payload: ApplyPayload) {
    backupFiles('opencode', this.liveFiles());
    const proto = payload.provider.protocols.openai;
    if (!proto) throw new Error(`Provider ${payload.provider.id} has no OpenAI protocol for OpenCode`);
    const config = readJson<OpenCodeConfig>(configPath()) || {};
    const key = providerKey(payload.provider);
    const providers = { ...(config.provider || {}) };
    const current = (providers[key] as Record<string, unknown>) || {};
    const models: Record<string, { name: string }> = {};
    for (const id of payloadModelIds(payload)) models[id] = { name: id };
    // /v1/responses uses the OpenAI SDK; chat-completions uses openai-compatible.
    const npm = proto.wireApi === 'chat' ? '@ai-sdk/openai-compatible' : '@ai-sdk/openai';
    providers[key] = {
      ...current,
      npm,
      name: payload.provider.name,
      options: {
        ...((current.options as Record<string, unknown>) || {}),
        baseURL: proto.baseUrl,
        apiKey: payload.provider.apiKey,
      },
      models,
    };
    config.$schema = config.$schema || 'https://opencode.ai/config.json';
    config.provider = providers;
    config.model = `${key}/${payload.model}`;
    writeJson(configPath(), config);
    writeAuth(key, payload.provider.apiKey);
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
  probeSpec(payload: ApplyPayload, prompt: string, isolatedHome: string): ProbeSpec {
    const bin = findBinary(this.binaries) || 'opencode';
    const key = providerKey(payload.provider);
    const dataDir = join(isolatedHome, 'data');
    return {
      command: bin,
      args: [
        'run',
        '--model', `${key}/${payload.model}`,
        prompt,
      ],
      env: {
        OPENCODE_MODEL: `${key}/${payload.model}`,
      },
      pathEnv: {
        OPENCODE_CONFIG_DIR: isolatedHome,
        OPENCODE_DATA_DIR: dataDir,
      },
    };
  },
  parseProbe(input: ProbeParseInput): ProbeParseResult {
    const jsonl = collectJsonlText(input.stdout);
    if (jsonl) return { reply: jsonl };
    const json = extractJson(input.stdout);
    const root = asRecord(json);
    const reply = asString(root?.text) || asString(root?.result) || asString(root?.message);
    if (reply) return { reply };
    if (input.code === 0 && input.stdout.trim()) return { reply: input.stdout.trim() };
    return { error: input.stderr.trim() || input.stdout.trim() || input.spawnError };
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
