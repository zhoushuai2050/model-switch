import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { backupFiles, readJson, readText, writeJson, atomicWrite } from '../core/fsutil.ts';
import { codexHome } from '../core/paths.ts';
import { getTable, getTopLevel, setTopLevel, upsertTable } from '../core/toml.ts';
import type { ApplyPayload, McpServer, Provider } from '../core/types.ts';
import { now, slug } from '../core/types.ts';
import type { Adapter, LaunchSpec } from './types.ts';
import { findBinary } from './which.ts';

function configPath(): string {
  return join(codexHome(), 'config.toml');
}

function catalogPath(): string {
  return join(codexHome(), 'msw-model-catalog.json');
}

const CATALOG_REL = 'msw-model-catalog.json';

function catalogModels(payload: ApplyPayload): string[] {
  const extra = payload.extra?.models;
  const listed = Array.isArray(extra)
    ? extra.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const models = listed.length ? [...listed] : [payload.model];
  if (payload.model && !models.includes(payload.model)) models.unshift(payload.model);
  return [...new Set(models)];
}

function writeModelCatalog(models: string[]): void {
  const entries = models.map((slug, index) => ({
    slug,
    display_name: slug,
    description: slug,
    base_instructions:
      'You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user\'s goals.',
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

function authPath(): string {
  return join(codexHome(), 'auth.json');
}

function providerTableId(provider: Provider): string {
  return slug(provider.id).replace(/-/g, '_') || 'custom';
}

function applyProviderTable(text: string, provider: Provider): { text: string; tableId: string } {
  const proto = provider.protocols.openai;
  if (!proto) throw new Error(`Provider ${provider.id} has no OpenAI protocol for Codex`);
  const tableId = providerTableId(provider);
  const entries: Record<string, string | boolean | number | string[] | undefined> = {
    name: provider.name,
    base_url: proto.baseUrl,
    wire_api: 'responses',
    requires_openai_auth: true,
  };
  // env_key makes Codex read a process env var and ignore auth.json.
  // API keys are stored in ~/.codex/auth.json, same as official/apikey setups.
  if (proto.authMode === 'env_key' && proto.envKey) {
    entries.env_key = proto.envKey;
    entries.requires_openai_auth = false;
  }
  const next = upsertTable(text, `model_providers.${tableId}`, entries);
  return { text: sanitizeWireApi(next), tableId };
}

function sanitizeWireApi(text: string): string {
  return text.replace(/^wire_api\s*=\s*"chat"\s*$/gm, 'wire_api = "responses"');
}

function writeAuth(apiKey: string): void {
  const auth = readJson<Record<string, unknown>>(authPath()) || {};
  if (apiKey) auth.OPENAI_API_KEY = apiKey;
  if (!auth.auth_mode) auth.auth_mode = 'apikey';
  writeJson(authPath(), auth, 0o600);
}

export const codexAdapter: Adapter = {
  id: 'codex',
  displayName: 'Codex',
  protocol: 'openai',
  binaries: ['codex'],
  detect() {
    const bin = findBinary(this.binaries);
    return { installed: Boolean(bin), bin };
  },
  liveFiles() {
    return [configPath(), authPath(), catalogPath()];
  },
  importLive() {
    const text = readText(configPath());
    if (!text) return null;
    const model = getTopLevel(text, 'model') || '';
    const providerId = getTopLevel(text, 'model_provider') || '';
    const table = providerId ? getTable(text, `model_providers.${providerId}`) : undefined;
    const auth = readJson<Record<string, unknown>>(authPath()) || {};
    const apiKey = String(auth.OPENAI_API_KEY || '');
    const baseUrl = table && typeof table.base_url === 'string' ? table.base_url : '';
    if (!model && !providerId && !baseUrl) return null;
    const wire = table && typeof table.wire_api === 'string' ? table.wire_api : 'responses';
    const provider: Provider = {
      id: providerId ? `imported-codex-${slug(providerId)}` : 'imported-codex',
      name: String(table?.name || providerId || 'Imported Codex'),
      apiKey,
      protocols: {
        openai: {
          baseUrl: baseUrl || 'https://api.openai.com/v1',
          wireApi: wire === 'chat' ? 'chat' : 'responses',
          authMode: table?.requires_openai_auth === false ? 'env_key' : 'openai_auth',
          envKey: typeof table?.env_key === 'string' ? table.env_key : 'OPENAI_API_KEY',
        },
      },
      createdAt: now(),
      updatedAt: now(),
    };
    return { provider, model: model || 'gpt-5.4' };
  },
  apply(payload: ApplyPayload) {
    backupFiles('codex', this.liveFiles());
    const models = catalogModels(payload);
    writeModelCatalog(models);
    let text = readText(configPath()) || '';
    const applied = applyProviderTable(text, payload.provider);
    text = setTopLevel(applied.text, 'model_provider', applied.tableId);
    text = setTopLevel(text, 'model', payload.model);
    text = setTopLevel(text, 'model_catalog_json', CATALOG_REL);
    atomicWrite(configPath(), text.endsWith('\n') ? text : `${text}\n`);
    if (payload.provider.apiKey) writeAuth(payload.provider.apiKey);
  },
  readStatus() {
    const text = readText(configPath());
    if (!text) return { configured: false };
    const model = getTopLevel(text, 'model');
    const providerId = getTopLevel(text, 'model_provider');
    const table = providerId ? getTable(text, `model_providers.${providerId}`) : undefined;
    return {
      configured: true,
      model,
      baseUrl: typeof table?.base_url === 'string' ? table.base_url : undefined,
      providerLabel: typeof table?.name === 'string' ? table.name : providerId,
    };
  },
  sessionLaunch(payload: ApplyPayload, extraArgs: string[]): LaunchSpec {
    const bin = findBinary(this.binaries) || 'codex';
    const proto = payload.provider.protocols.openai;
    if (!proto) throw new Error(`Provider ${payload.provider.id} has no OpenAI protocol for Codex`);
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
    const env: Record<string, string> = {};
    if (payload.provider.apiKey) env.OPENAI_API_KEY = payload.provider.apiKey;
    return { command: bin, args, env };
  },
  syncMcp(servers: McpServer[]) {
    let text = readText(configPath()) || '';
    for (const server of servers.filter((item) => item.agents.includes('codex'))) {
      if (server.transport === 'stdio') {
        text = upsertTable(text, `mcp_servers.${server.name}`, {
          command: server.command || '',
          args: server.args,
        });
      } else {
        text = upsertTable(text, `mcp_servers.${server.name}`, {
          url: server.url || '',
        });
      }
    }
    atomicWrite(configPath(), text.endsWith('\n') ? text : `${text}\n`);
  },
};
