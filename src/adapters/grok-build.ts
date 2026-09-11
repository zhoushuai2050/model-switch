import { join } from 'node:path';
import { backupFiles, readJson, readText, writeJson, atomicWrite } from '../core/fsutil.ts';
import { grokHome } from '../core/paths.ts';
import {
  findTableSpan,
  getTable,
  removeTable,
  stringifyTomlValue,
  upsertTable,
} from '../core/toml.ts';
import type { ApplyPayload, McpServer, ProtocolConfig, Provider } from '../core/types.ts';
import { payloadModelIds } from '../core/types.ts';
import { asRecord, asString, collectJsonlText, extractJson } from '../core/probe.ts';
import type { Adapter, LaunchSpec, ProbeParseInput, ProbeParseResult, ProbeSpec } from './types.ts';
import { findBinary } from './which.ts';

type LiveStatus = {
  providerId?: string;
  model?: string;
  baseUrl?: string;
  providerLabel?: string;
};

function configPath(): string {
  return join(grokHome(), 'config.toml');
}

function livePath(): string {
  return join(grokHome(), 'msw-live.json');
}

function modelTableHeader(modelId: string): string {
  return `model.${JSON.stringify(modelId)}`;
}

function mcpTableHeader(name: string): string {
  return `mcp_servers.${JSON.stringify(name)}`;
}

function apiBackend(proto: ProtocolConfig): string {
  return proto.wireApi === 'chat' ? 'chat_completions' : 'responses';
}

function openaiProto(provider: Provider): ProtocolConfig {
  const proto = provider.protocols.openai;
  if (!proto) throw new Error(`Provider ${provider.id} has no OpenAI protocol for Grok Build`);
  return proto;
}

function envFromProvider(provider: Provider, model: string): Record<string, string> {
  const proto = openaiProto(provider);
  const env: Record<string, string> = {
    GROK_DEFAULT_MODEL: model,
    GROK_XAI_API_BASE_URL: proto.baseUrl,
    GROK_MODELS_BASE_URL: proto.baseUrl,
    GROK_DISABLE_AUTOUPDATER: '1',
  };
  if (provider.apiKey) env.XAI_API_KEY = provider.apiKey;
  return env;
}

function setModelsDefault(text: string, modelId: string): string {
  const line = `default = ${stringifyTomlValue(modelId)}`;
  const span = findTableSpan(text, 'models');
  if (!span) {
    const block = `[models]\n${line}\n`;
    const trimmed = text.replace(/\s*$/, '');
    return trimmed ? `${trimmed}\n\n${block}` : block;
  }
  const block = text.slice(span.start, span.end);
  const nextBlock = /^default\s*=/m.test(block)
    ? block.replace(/^default\s*=\s*.*$/m, line)
    : block.replace(/^\[models\][ \t]*$/m, `[models]\n${line}`);
  return text.slice(0, span.start) + nextBlock + text.slice(span.end);
}

function applyModelConfig(text: string, payload: ApplyPayload): string {
  const proto = openaiProto(payload.provider);
  const models = payloadModelIds(payload);
  let next = text;
  for (const modelId of models) {
    const header = modelTableHeader(modelId);
    next = upsertTable(next, header, {
      model: modelId,
      base_url: proto.baseUrl,
      name: payload.provider.name,
      api_key: payload.provider.apiKey || undefined,
      api_backend: apiBackend(proto),
    });
    const headerTable = `${header}.extra_headers`;
    if (payload.provider.apiKey) {
      next = upsertTable(next, headerTable, {
        Authorization: `Bearer ${payload.provider.apiKey}`,
      });
    } else {
      next = removeTable(next, headerTable);
    }
  }
  return setModelsDefault(next, payload.model);
}

function writeLive(payload: ApplyPayload): void {
  const proto = openaiProto(payload.provider);
  writeJson(livePath(), {
    providerId: payload.provider.id,
    model: payload.model,
    baseUrl: proto.baseUrl,
    providerLabel: payload.provider.name,
  } satisfies LiveStatus);
}

function hasModelFlag(args: string[]): boolean {
  return args.some((item) => item === '-m' || item === '--model' || item.startsWith('--model='));
}

export const grokBuildAdapter: Adapter = {
  id: 'grok-build',
  displayName: 'Grok Build',
  protocol: 'openai',
  binaries: ['grok', 'grok-build'],
  detect() {
    const bin = findBinary(this.binaries);
    return { installed: Boolean(bin), bin };
  },
  liveFiles() {
    return [configPath(), livePath()];
  },
  apply(payload: ApplyPayload) {
    backupFiles('grok-build', this.liveFiles());
    const text = applyModelConfig(readText(configPath()) || '', payload);
    atomicWrite(configPath(), text.endsWith('\n') ? text : `${text}\n`);
    writeLive(payload);
  },
  readStatus() {
    const live = readJson<LiveStatus>(livePath());
    const text = readText(configPath());
    if (!text && !live) return { configured: false };
    const models = text ? getTable(text, 'models') : undefined;
    const model =
      live?.model ||
      (typeof models?.default === 'string' ? models.default : undefined);
    const table = model && text ? getTable(text, modelTableHeader(model)) : undefined;
    return {
      configured: true,
      model,
      baseUrl:
        live?.baseUrl ||
        (typeof table?.base_url === 'string' ? table.base_url : undefined),
      providerLabel:
        live?.providerLabel ||
        (typeof table?.name === 'string' ? table.name : undefined),
      providerId: live?.providerId,
    };
  },
  sessionLaunch(payload: ApplyPayload, extraArgs: string[]): LaunchSpec {
    const bin = findBinary(this.binaries) || 'grok';
    const args = hasModelFlag(extraArgs) ? extraArgs : ['-m', payload.model, ...extraArgs];
    return {
      command: bin,
      args,
      env: envFromProvider(payload.provider, payload.model),
    };
  },
  probeSpec(payload: ApplyPayload, prompt: string, isolatedHome: string): ProbeSpec {
    const bin = findBinary(this.binaries) || 'grok';
    return {
      command: bin,
      args: [
        '--no-auto-update',
        '-p',
        prompt,
        '--output-format',
        'json',
        '-m',
        payload.model,
        '--always-approve',
        '--sandbox',
        'read-only',
      ],
      env: envFromProvider(payload.provider, payload.model),
      pathEnv: { GROK_HOME: isolatedHome },
    };
  },
  parseProbe(input: ProbeParseInput): ProbeParseResult {
    const jsonl = collectJsonlText(input.stdout);
    if (jsonl) return { reply: jsonl };
    const json = extractJson(input.stdout) ?? extractJson(input.stderr);
    const root = asRecord(json);
    if (root) {
      const error = asRecord(root.error);
      if (error) return { error: asString(error.message) || asString(root.error) || 'Grok Build 报错' };
      if (root.is_error === true || root.ok === false) {
        return { error: asString(root.result) || asString(root.message) || 'Grok Build 报错' };
      }
      const reply =
        asString(root.result) ||
        asString(root.text) ||
        asString(root.response) ||
        asString(root.message) ||
        asString(root.content) ||
        asString(root.output);
      if (reply) return { reply };
    }
    if (input.code === 0 && input.stdout.trim()) return { reply: input.stdout.trim() };
    return { error: input.stderr.trim() || input.stdout.trim() || input.spawnError };
  },
  syncMcp(servers: McpServer[]) {
    let text = readText(configPath()) || '';
    for (const server of servers.filter((item) => item.agents.includes('grok-build'))) {
      const header = mcpTableHeader(server.name);
      if (server.transport === 'stdio') {
        text = upsertTable(text, header, {
          command: server.command || '',
          args: server.args,
          enabled: true,
        });
      } else {
        text = upsertTable(text, header, {
          url: server.url || '',
          enabled: true,
        });
      }
    }
    atomicWrite(configPath(), text.endsWith('\n') ? text : `${text}\n`);
  },
};
