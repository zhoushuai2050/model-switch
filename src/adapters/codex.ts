import { join } from 'node:path';
import { backupFiles, readJson, readText, writeJson, atomicWrite } from '../core/fsutil.ts';
import { codexHome } from '../core/paths.ts';
import { getTable, getTopLevel, removeTable, setTopLevel, upsertTable } from '../core/toml.ts';
import type { ApplyPayload, McpServer, Provider } from '../core/types.ts';
import { liveProviderKey, payloadModelIds } from '../core/types.ts';
import { asRecord, asString, collectJsonlText, extractJson } from '../core/probe.ts';
import type { Adapter, LaunchSpec, ProbeParseInput, ProbeParseResult, ProbeSpec } from './types.ts';
import { findBinary } from './which.ts';

function configPath(): string {
  return join(codexHome(), 'config.toml');
}

function catalogPath(): string {
  return join(codexHome(), 'msw-model-catalog.json');
}

const CATALOG_REL = 'msw-model-catalog.json';

type CatalogModel = Record<string, unknown> & { slug?: string };

const REASONING_LEVELS = [
  { effort: 'none', description: 'Disable Thinking' },
  { effort: 'low', description: 'Fast responses with lighter reasoning' },
  { effort: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
  { effort: 'high', description: 'Greater reasoning depth for complex problems' },
  { effort: 'xhigh', description: 'Extra high reasoning depth for complex problems' },
  { effort: 'max', description: 'Maximum reasoning depth for the hardest problems' },
  { effort: 'ultra', description: 'Maximum reasoning with automatic task delegation' },
];

const MODEL_CATALOG_TEMPLATE: CatalogModel = {
  base_instructions:
    "You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user's goals.",
  default_reasoning_level: 'high',
  supported_reasoning_levels: REASONING_LEVELS,
  shell_type: 'shell_command',
  visibility: 'list',
  supported_in_api: true,
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
};

function reasoningLevels(current?: string) {
  const levels = REASONING_LEVELS.map((item) => ({ ...item }));
  if (current && !levels.some((item) => item.effort === current)) {
    levels.push({ effort: current, description: current });
  }
  return levels;
}

function writeModelCatalog(models: string[], reasoningEffort?: string): void {
  const existing = readJson<{ models?: CatalogModel[] }>(catalogPath());
  const prevBySlug = new Map<string, CatalogModel>();
  for (const row of existing?.models || []) {
    if (typeof row?.slug === 'string') prevBySlug.set(row.slug, row);
  }
  const entries = models.map((slug, index) => {
    const prev = prevBySlug.get(slug) || {};
    const defaultReasoning =
      (typeof prev.default_reasoning_level === 'string' && prev.default_reasoning_level) ||
      reasoningEffort ||
      String(MODEL_CATALOG_TEMPLATE.default_reasoning_level);
    return {
      ...MODEL_CATALOG_TEMPLATE,
      ...prev,
      slug,
      display_name: typeof prev.display_name === 'string' ? prev.display_name : slug,
      description: typeof prev.description === 'string' ? prev.description : slug,
      default_reasoning_level: defaultReasoning,
      supported_reasoning_levels: reasoningLevels(defaultReasoning),
      visibility: 'list',
      supported_in_api: true,
      priority: 1000 + index,
    };
  });
  writeJson(catalogPath(), { models: entries });
}

function applyModelConfig(text: string, payload: ApplyPayload): string {
  const models = payloadModelIds(payload);
  const reasoningEffort = getTopLevel(text, 'model_reasoning_effort');
  writeModelCatalog(models, reasoningEffort);
  const applied = applyProviderTable(text, payload.provider);
  const template: Record<string, string> = {
    model_provider: applied.tableId,
    model: payload.model,
    model_catalog_json: CATALOG_REL,
  };
  let next = applied.text;
  for (const [key, value] of Object.entries(template)) {
    next = setTopLevel(next, key, value);
  }
  return next;
}

function providerTableId(provider: Provider): string {
  return liveProviderKey(provider.id, 'codex');
}

function applyProviderTable(text: string, provider: Provider): { text: string; tableId: string } {
  const proto = provider.protocols.openai;
  if (!proto) throw new Error(`Provider ${provider.id} has no OpenAI protocol for Codex`);
  const tableId = providerTableId(provider);
  const useEnv = proto.authMode === 'env_key' && Boolean(proto.envKey);
  const entries: Record<string, string | boolean | number | string[] | undefined> = {
    name: provider.name,
    base_url: proto.baseUrl,
    wire_api: 'responses',
    requires_openai_auth: false,
  };
  if (useEnv) {
    entries.env_key = proto.envKey;
  } else if (provider.apiKey) {
    // OpenCode keeps the key on the provider (`options.apiKey`). Codex's equivalent
    // is experimental_bearer_token; auth.json is only for official ChatGPT login.
    entries.experimental_bearer_token = provider.apiKey;
  }
  let next = upsertTable(text, `model_providers.${tableId}`, entries);
  const headerTable = `model_providers.${tableId}.http_headers`;
  if (!useEnv && provider.apiKey) {
    // OpenCode `options.headers` analog; also works if an older Codex ignores the token field.
    next = upsertTable(next, headerTable, {
      Authorization: `Bearer ${provider.apiKey}`,
    });
  } else {
    next = removeTable(next, headerTable);
  }
  return { text: sanitizeWireApi(next), tableId };
}

function sanitizeWireApi(text: string): string {
  return text.replace(/^wire_api\s*=\s*"chat"\s*$/gm, 'wire_api = "responses"');
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
    return [configPath(), catalogPath()];
  },
  apply(payload: ApplyPayload) {
    backupFiles('codex', this.liveFiles());
    const text = applyModelConfig(readText(configPath()) || '', payload);
    atomicWrite(configPath(), text.endsWith('\n') ? text : `${text}\n`);
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
      providerId,
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
  probeSpec(payload: ApplyPayload, prompt: string, isolatedHome: string): ProbeSpec {
    const bin = findBinary(this.binaries) || 'codex';
    const proto = payload.provider.protocols.openai;
    if (!proto) throw new Error(`Provider ${payload.provider.id} has no OpenAI protocol for Codex`);
    const tableId = providerTableId(payload.provider);
    const outputFile = join(isolatedHome, 'last-message.txt');
    const env: Record<string, string> = {};
    if (payload.provider.apiKey) env.OPENAI_API_KEY = payload.provider.apiKey;
    return {
      command: bin,
      args: [
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '--sandbox', 'read-only',
        '--color', 'never',
        '-o', outputFile,
        '-c', `model=${payload.model}`,
        '-c', `model_provider=${tableId}`,
        prompt,
      ],
      env,
      pathEnv: { CODEX_HOME: isolatedHome },
      outputFile,
    };
  },
  parseProbe(input: ProbeParseInput): ProbeParseResult {
    const fromFile = input.outputFileText?.trim();
    if (fromFile) return { reply: fromFile };
    const jsonl = collectJsonlText(input.stdout);
    if (jsonl) return { reply: jsonl };
    const json = extractJson(input.stdout);
    const root = asRecord(json);
    const reply = asString(root?.output_text) || asString(root?.text) || asString(root?.result);
    if (reply) return { reply };
    if (input.code === 0 && input.stdout.trim()) return { reply: input.stdout.trim() };
    return { error: input.stderr.trim() || input.stdout.trim() || input.spawnError };
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
