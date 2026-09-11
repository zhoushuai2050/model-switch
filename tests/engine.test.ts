import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, test } from 'node:test';
import { resetDbCache } from '../src/core/db.ts';
import { Engine } from '../src/core/engine.ts';

const fakeAgent = join(dirname(fileURLToPath(import.meta.url)), 'fake-agent.cjs');
let originalPath = '';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'msw-'));
  originalPath = process.env.PATH || '';
  process.env.HOME = root;
  process.env.MSW_HOME = join(root, '.model-switch');
  process.env.CODEX_HOME = join(root, '.codex');
  process.env.CLAUDE_CONFIG_DIR = join(root, '.claude');
  process.env.GEMINI_CONFIG_DIR = join(root, '.gemini');
  process.env.GROK_HOME = join(root, '.grok');
  process.env.XDG_CONFIG_HOME = join(root, '.config');
  process.env.MSW_PROBE_LOG = join(root, 'probe-log.json');
  delete process.env.MSW_PROBE_FAIL;
  delete process.env.MSW_PROBE_REPLY;
  mkdirSync(join(root, '.codex'), { recursive: true });
  mkdirSync(join(root, '.claude'), { recursive: true });
  mkdirSync(join(root, '.grok'), { recursive: true });
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  for (const name of ['claude', 'codex', 'gemini', 'opencode', 'grok']) {
    const dest = join(binDir, name);
    copyFileSync(fakeAgent, dest);
    chmodSync(dest, 0o755);
  }
  process.env.PATH = `${binDir}${delimiter}${originalPath}`;
  resetDbCache();
});

afterEach(() => {
  process.env.PATH = originalPath;
  delete process.env.MSW_PROBE_LOG;
  delete process.env.MSW_PROBE_FAIL;
  delete process.env.MSW_PROBE_REPLY;
  resetDbCache();
});

test('agents are listed as claude, codex, grok-build, gemini, opencode', () => {
  const engine = new Engine();
  assert.deepEqual(engine.listAgents().map((item) => item.id), [
    'claude',
    'codex',
    'grok-build',
    'gemini',
    'opencode',
  ]);
});

test('new providers use random UUID IDs while names remain usable targets', () => {
  const engine = new Engine();
  const first = engine.addProvider({ name: 'relay', apiKey: 'sk-a', openaiUrl: 'https://a.example/v1', models: ['a'] });
  const second = engine.addProvider({ name: 'relay', apiKey: 'sk-b', openaiUrl: 'https://b.example/v1', models: ['b'] });
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.match(second.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(first.id, second.id);
  assert.equal(engine.getProvider(first.id).provider.name, 'relay');
});

test('deleteProvider removes a provider by name', () => {
  const engine = new Engine();
  engine.addProvider({ name: 'kimi', apiKey: 'sk-kimi', openaiUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k2.5'] });
  const deleted = engine.deleteProvider('kimi');
  assert.equal(deleted.name, 'kimi');
  assert.equal(engine.listProviders().length, 0);
  assert.equal(engine.listModels().length, 0);
});

test('deleteProvider requires id when names collide', () => {
  const engine = new Engine();
  const first = engine.addProvider({ name: 'relay', apiKey: 'sk-a', openaiUrl: 'https://a.example/v1', models: ['a'] });
  const second = engine.addProvider({ name: 'relay', apiKey: 'sk-b', openaiUrl: 'https://b.example/v1', models: ['b'] });
  assert.throws(() => engine.deleteProvider('relay'), /多个供应商名为 relay/);
  const deleted = engine.deleteProvider(first.id);
  assert.equal(deleted.id, first.id);
  assert.equal(engine.listProviders().map((item) => item.id).join(), second.id);
});

test('listProvidersForAgent isolates providers by agent, not just protocol', () => {
  const engine = new Engine();
  engine.addProvider({
    name: 'claude-only',
    apiKey: 'sk',
    anthropicUrl: 'https://a.example',
    models: ['claude-sonnet-4-6', 'claude-opus-4'],
  });
  engine.addProvider({
    name: 'codex-only',
    apiKey: 'sk',
    openaiUrl: 'https://b.example/v1',
    models: ['gpt-4.1'],
    agent: 'codex',
  });
  assert.deepEqual(engine.listProvidersForAgent('claude').map((item) => item.name).sort(), ['claude-only']);
  assert.deepEqual(engine.listProvidersForAgent('codex').map((item) => item.name).sort(), ['codex-only']);
  assert.deepEqual(engine.listProvidersForAgent('grok-build').map((item) => item.name), []);
  assert.deepEqual(engine.listProvidersForAgent('opencode').map((item) => item.name), []);
  assert.deepEqual(engine.listProvidersForAgent('gemini').map((item) => item.name), []);
  const claudeModels = engine.getProvider(engine.listProvidersForAgent('claude').find((item) => item.name === 'claude-only')!.id).models.map((item) => item.modelId).sort();
  assert.deepEqual(claudeModels, ['claude-opus-4', 'claude-sonnet-4-6']);
});

test('openai providers for Codex, Grok, and OpenCode stay independent', () => {
  const engine = new Engine();
  const codex = engine.addProvider({
    name: 'relay',
    apiKey: 'sk-codex',
    openaiUrl: 'https://a.example/v1',
    models: ['gpt-codex'],
    agent: 'codex',
  });
  const grok = engine.addProvider({
    name: 'relay',
    apiKey: 'sk-grok',
    openaiUrl: 'https://b.example/v1',
    models: ['grok-4.6'],
    agent: 'grok-build',
  });
  const opencode = engine.addProvider({
    name: 'relay',
    apiKey: 'sk-oc',
    openaiUrl: 'https://c.example/v1',
    models: ['gpt-oc'],
    agent: 'opencode',
  });
  assert.equal(codex.agent, 'codex');
  assert.equal(grok.agent, 'grok-build');
  assert.equal(opencode.agent, 'opencode');
  assert.deepEqual(engine.listProvidersForAgent('codex').map((item) => item.id), [codex.id]);
  assert.deepEqual(engine.listProvidersForAgent('grok-build').map((item) => item.id), [grok.id]);
  assert.deepEqual(engine.listProvidersForAgent('opencode').map((item) => item.id), [opencode.id]);
  engine.setAgent('codex');
  assert.equal(engine.use('relay').providerId, codex.id);
  engine.setAgent('grok-build');
  assert.equal(engine.use('relay').providerId, grok.id);
  engine.updateProvider(codex.id, { name: 'codex-relay' });
  assert.equal(engine.getProvider(grok.id).provider.name, 'relay');
  assert.equal(engine.getProvider(opencode.id).provider.name, 'relay');
});

test('addProvider isolates a preset to one agent instead of creating a multi-protocol provider', () => {
  const engine = new Engine();
  const claude = engine.addProvider({ preset: 'kimi', apiKey: 'sk-claude', agent: 'claude' });
  const codex = engine.addProvider({ preset: 'kimi', apiKey: 'sk-codex', agent: 'codex' });
  assert.ok(claude.protocols.anthropic?.baseUrl);
  assert.equal(claude.protocols.openai, undefined);
  assert.ok(codex.protocols.openai?.baseUrl);
  assert.equal(codex.protocols.anthropic, undefined);
  assert.notEqual(claude.id, codex.id);
  assert.deepEqual(engine.listProvidersForAgent('claude').map((item) => item.id), [claude.id]);
  assert.deepEqual(engine.listProvidersForAgent('codex').map((item) => item.id), [codex.id]);
  engine.setAgent('claude');
  assert.equal(engine.use('kimi').providerId, claude.id);
  engine.setAgent('codex');
  assert.equal(engine.use('kimi').providerId, codex.id);
});

test('addProvider refuses to create a multi-agent provider without --agent', () => {
  const engine = new Engine();
  assert.throws(
    () => engine.addProvider({
      name: 'packy',
      apiKey: 'sk',
      openaiUrl: 'https://relay.example/v1',
      anthropicUrl: 'https://relay.example',
      models: ['shared'],
    }),
    /指定 --agent/,
  );
});

test('addProvider maps a single URL onto the selected agent protocol', () => {
  const engine = new Engine();
  const provider = engine.addProvider({
    name: 'lvyrix',
    apiKey: 'sk',
    openaiUrl: 'https://api.lvyrix.com/v1',
    agent: 'claude',
    models: ['grok-4.6'],
  });
  assert.equal(provider.protocols.anthropic?.baseUrl, 'https://api.lvyrix.com/v1');
  assert.equal(provider.protocols.openai, undefined);
});

test('addProvider rejects an OpenAI-only preset for Claude', () => {
  const engine = new Engine();
  assert.throws(
    () => engine.addProvider({ preset: 'openai', apiKey: 'sk', agent: 'claude' }),
    /需要 Anthropic/,
  );
});

test('addProvider with current agent keeps only that agent protocol', () => {
  const engine = new Engine();
  engine.setAgent('claude');
  const provider = engine.addProvider({
    name: 'relay',
    apiKey: 'sk',
    openaiUrl: 'https://relay.example/v1',
    anthropicUrl: 'https://relay.example',
    models: ['grok-4.6'],
  });
  assert.ok(provider.protocols.anthropic?.baseUrl);
  assert.equal(provider.protocols.openai, undefined);
});

test('claude adapter writes anthropic env', () => {
  const engine = new Engine();
  const kimi = engine.addProvider({
    preset: 'kimi',
    apiKey: 'sk-kimi',
    agent: 'claude',
  });
  assert.match(kimi.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  engine.use('claude:kimi');
  const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'sk-kimi');
  assert.match(settings.env.ANTHROPIC_BASE_URL, /moonshot/);
  assert.equal(settings.model, 'sonnet');
  assert.equal(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'kimi-k2.5');
  assert.equal(settings.env.ANTHROPIC_MODEL, undefined);
});

test('claude apply maps unofficial models through official aliases and preserves other settings', () => {
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(
    join(root, '.claude', 'settings.json'),
    JSON.stringify({
      env: {
        ANTHROPIC_MODEL: 'old-model',
        ANTHROPIC_DEFAULT_MODEL: 'old-model',
        ANTHROPIC_BASE_URL: 'https://old.example/v1',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
      model: 'old-model',
      effortLevel: 'high',
      alwaysThinkingEnabled: true,
      permissions: {
        defaultMode: 'bypassPermissions',
        allow: ['Bash(*)'],
      },
    }, null, 2),
  );
  const engine = new Engine();
  engine.addProvider({
    name: 'lvyrix',
    apiKey: 'sk-lvy',
    anthropicUrl: 'https://api.lvyrix.com/v1',
    models: ['grok-4.6'],
  });
  engine.use('claude:lvyrix');
  const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.model, 'sonnet');
  assert.equal(settings.env.ANTHROPIC_BASE_URL, 'https://api.lvyrix.com');
  assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, 'sk-lvy');
  assert.equal(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'grok-4.6');
  assert.equal(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'grok-4.6');
  assert.equal(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'grok-4.6');
  assert.equal(settings.env.ANTHROPIC_SMALL_FAST_MODEL, 'grok-4.6');
  assert.equal(settings.env.ANTHROPIC_MODEL, undefined);
  assert.equal(settings.env.ANTHROPIC_DEFAULT_MODEL, undefined);
  assert.equal(settings.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  assert.equal(settings.effortLevel, 'high');
  assert.equal(settings.alwaysThinkingEnabled, true);
  assert.equal(settings.permissions.defaultMode, 'bypassPermissions');
  assert.deepEqual(settings.permissions.allow, ['Bash(*)']);
  const live = engine.listAgents().find((item) => item.id === 'claude');
  assert.equal(live?.model, 'grok-4.6');
  const spec = engine.launch({ agent: 'claude' });
  assert.equal(spec.env.ANTHROPIC_MODEL, undefined);
  assert.equal(spec.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'grok-4.6');
  assert.equal(spec.env.ANTHROPIC_BASE_URL, 'https://api.lvyrix.com');
  assert.equal(spec.args[0], '--model');
  assert.equal(spec.args[1], 'sonnet');
});

test('claude apply uses opus alias for opus-named models', () => {
  const engine = new Engine();
  engine.addProvider({
    name: 'anthropic-relay',
    apiKey: 'sk-a',
    anthropicUrl: 'https://relay.example.com',
    models: ['claude-opus-4-6'],
  });
  engine.use('claude:anthropic-relay');
  const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.model, 'opus');
  assert.equal(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'claude-opus-4-6');
  assert.equal(engine.listAgents().find((item) => item.id === 'claude')?.model, 'claude-opus-4-6');
});

test('session launch does not change global model', () => {
  writeFileSync(
    join(root, '.codex', 'config.toml'),
    `model = "grok-4.6"
model_provider = "crs"

[model_providers.crs]
base_url = "http://127.0.0.1:8000/v1"
name = "crs"
`,
  );
  const engine = new Engine();
  engine.addProvider({ preset: 'deepseek', apiKey: 'sk-ds', agent: 'codex' });
  engine.setAgent('codex');
  const spec = engine.launch({ target: 'deepseek' });
  assert.equal(spec.command.includes('codex') || spec.command === 'codex' || existsSync(spec.command) || spec.command.endsWith('codex'), true);
  assert.ok(spec.args.includes('model=deepseek-chat') || spec.args.some((a) => a.includes('deepseek')));
  const text = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
  assert.match(text, /model = "grok-4.6"/);
});

test('codex current provider follows model_provider id, not shared model names', () => {
  const engine = new Engine();
  const first = engine.addProvider({
    name: 'relay',
    apiKey: 'sk-a',
    openaiUrl: 'https://a.example/v1',
    models: ['gpt-shared'],
  });
  const second = engine.addProvider({
    name: 'relay',
    apiKey: 'sk-b',
    openaiUrl: 'https://b.example/v1',
    models: ['gpt-shared'],
  });
  engine.setAgent('codex');
  engine.use(first.id);
  const text = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
  const tableId = first.id.replace(/-/g, '_');
  assert.match(text, new RegExp(`model_provider = "${tableId}"`));
  const live = engine.listAgents().find((item) => item.id === 'codex');
  assert.equal(live?.currentProviderId, first.id);
  assert.notEqual(live?.currentProviderId, second.id);

  engine.use(second.id);
  const next = engine.listAgents().find((item) => item.id === 'codex');
  assert.equal(next?.currentProviderId, second.id);
});

test('codex apply rewrites leftover wire_api chat', () => {
  writeFileSync(
    join(root, '.codex', 'config.toml'),
    `model = "old"
model_provider = "legacy"

[model_providers.legacy]
base_url = "https://old.example/v1"
wire_api = "chat"
`,
  );
  const engine = new Engine();
  engine.addProvider({
    name: 'relay',
    apiKey: 'sk-x',
    openaiUrl: 'https://relay.example/v1',
    wireApi: 'responses',
    models: ['gpt-5.6-sol'],
  });
  engine.setAgent('codex');
  engine.use('relay');
  const text = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
  assert.equal((text.match(/wire_api = "chat"/g) || []).length, 0);
  assert.match(text, /wire_api = "responses"/);
  assert.match(text, /model = "gpt-5.6-sol"/);
});


test('codex apply stores key on the provider like OpenCode, not in auth.json', () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'relay',
    apiKey: 'sk-secret-key',
    openaiUrl: 'https://relay.example/v1',
    models: ['gpt-5.6-sol'],
  });
  engine.setAgent('codex');
  engine.use('relay');
  const text = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
  const tableId = created.id.replace(/-/g, '_');
  assert.doesNotMatch(text, /env_key/);
  assert.match(text, /requires_openai_auth = false/);
  assert.match(text, /experimental_bearer_token = "sk-secret-key"/);
  assert.match(text, new RegExp(`\\[model_providers\\.${tableId}\\.http_headers\\]`));
  assert.match(text, /Authorization = "Bearer sk-secret-key"/);
  assert.equal(existsSync(join(root, '.codex', 'auth.json')), false);
});

test('opencode apply writes provider-scoped models, npm, and credentials', () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'relay',
    apiKey: 'sk-oc',
    openaiUrl: 'https://relay.example/v1',
    wireApi: 'responses',
    models: ['gpt-5.6-sol', 'deepseek-v4-flash'],
  });
  engine.setAgent('opencode');
  engine.use('opencode:gpt-5.6-sol');
  const key = created.id.replace(/-/g, '');
  const config = JSON.parse(readFileSync(join(root, '.config', 'opencode', 'opencode.json'), 'utf8'));
  assert.equal(config.model, `${key}/gpt-5.6-sol`);
  assert.equal(config.provider[key].npm, '@ai-sdk/openai');
  assert.equal(config.provider[key].options.baseURL, 'https://relay.example/v1');
  assert.equal(config.provider[key].options.apiKey, 'sk-oc');
  assert.deepEqual(Object.keys(config.provider[key].models).sort(), ['deepseek-v4-flash', 'gpt-5.6-sol']);
  const auth = JSON.parse(readFileSync(join(root, '.local', 'share', 'opencode', 'auth.json'), 'utf8'));
  assert.equal(auth[key].type, 'api');
  assert.equal(auth[key].key, 'sk-oc');
});

test('opencode apply uses openai-compatible npm for chat wire api', () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'kimi-relay',
    apiKey: 'sk-kimi',
    openaiUrl: 'https://api.moonshot.cn/v1',
    wireApi: 'chat',
    models: ['kimi-k2.5'],
  });
  engine.setAgent('opencode');
  engine.use('kimi-relay');
  const key = created.id.replace(/-/g, '');
  const config = JSON.parse(readFileSync(join(root, '.config', 'opencode', 'opencode.json'), 'utf8'));
  assert.equal(config.provider[key].npm, '@ai-sdk/openai-compatible');
  assert.equal(config.model, `${key}/kimi-k2.5`);
});


test('codex apply writes model_catalog_json for /model picker', () => {
  const engine = new Engine();
  engine.addProvider({
    name: 'relay',
    apiKey: 'sk-x',
    openaiUrl: 'https://relay.example/v1',
    models: ['gpt-5.6-sol', 'deepseek-v4-flash', 'glm-5.3'],
  });
  engine.setAgent('codex');
  engine.use('relay');
  const text = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
  assert.match(text, /model_catalog_json = "msw-model-catalog.json"/);
  const catalog = JSON.parse(readFileSync(join(root, '.codex', 'msw-model-catalog.json'), 'utf8'));
  const slugs = catalog.models.map((row: { slug: string }) => row.slug);
  assert.ok(slugs.includes('deepseek-v4-flash'));
  assert.ok(slugs.includes('glm-5.3'));
  assert.ok(slugs.includes('gpt-5.6-sol'));
});

test('codex apply uses catalog template and preserves reasoning and sandbox settings', () => {
  writeFileSync(
    join(root, '.codex', 'config.toml'),
    `model = "old"
model_provider = "legacy"
model_reasoning_effort = "xhigh"
approval_policy = "never"
sandbox_mode = "danger-full-access"
disable_response_storage = true

[projects."/tmp/work"]
trust_level = "trusted"
`,
  );
  writeFileSync(
    join(root, '.codex', 'msw-model-catalog.json'),
    JSON.stringify({
      models: [
        {
          slug: 'gpt-5.6-sol',
          display_name: 'Custom Name',
          default_reasoning_level: 'xhigh',
          supported_reasoning_levels: [{ effort: 'high', description: 'Enabled Thinking' }],
        },
      ],
    }),
  );
  const engine = new Engine();
  engine.addProvider({
    name: 'relay',
    apiKey: 'sk-x',
    openaiUrl: 'https://relay.example/v1',
    models: ['gpt-5.6-sol', 'grok-4.6'],
  });
  engine.setAgent('codex');
  engine.use('relay');
  const text = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
  assert.match(text, /model = "gpt-5.6-sol"/);
  assert.match(text, /model_reasoning_effort = "xhigh"/);
  assert.match(text, /approval_policy = "never"/);
  assert.match(text, /sandbox_mode = "danger-full-access"/);
  assert.match(text, /disable_response_storage = true/);
  assert.match(text, /trust_level = "trusted"/);
  const catalog = JSON.parse(readFileSync(join(root, '.codex', 'msw-model-catalog.json'), 'utf8'));
  const bySlug = Object.fromEntries(catalog.models.map((row: { slug: string }) => [row.slug, row]));
  assert.equal(bySlug['gpt-5.6-sol'].display_name, 'Custom Name');
  assert.equal(bySlug['gpt-5.6-sol'].default_reasoning_level, 'xhigh');
  assert.equal(bySlug['grok-4.6'].default_reasoning_level, 'xhigh');
  const efforts = bySlug['gpt-5.6-sol'].supported_reasoning_levels.map((row: { effort: string }) => row.effort);
  assert.ok(efforts.includes('xhigh'));
  assert.ok(efforts.includes('high'));
  assert.ok(efforts.includes('none'));
});

test('updateProvider keeps key when blank and replaces models', () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'relay',
    apiKey: 'sk-old',
    openaiUrl: 'https://old.example/v1',
    models: ['gpt-old'],
  });
  const updated = engine.updateProvider(created.id, {
    name: 'relay-2',
    apiKey: '',
    openaiUrl: 'https://new.example/v1',
    models: ['gpt-5.6-sol', 'deepseek-v4-flash'],
  });
  assert.equal(updated.name, 'relay-2');
  assert.equal(updated.apiKey, 'sk-old');
  assert.equal(updated.protocols.openai?.baseUrl, 'https://new.example/v1');
  const models = engine.getProvider(created.id).models.map((item) => item.modelId);
  assert.deepEqual(models, ['gpt-5.6-sol', 'deepseek-v4-flash']);
  assert.equal(engine.getProvider(created.id).models[0].selected, true);
});

test('provider models keep insertion order and first item is selected', () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'relay',
    apiKey: 'sk',
    openaiUrl: 'https://relay.example/v1',
    models: ['zzz-last', 'aaa-first'],
  });
  const models = engine.getProvider(created.id).models;
  assert.deepEqual(models.map((item) => item.modelId), ['zzz-last', 'aaa-first']);
  assert.equal(models[0].selected, true);
  assert.equal(models[1].selected, false);
});

test('add/remove/select models updates the provider default', () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'relay',
    apiKey: 'sk',
    openaiUrl: 'https://relay.example/v1',
    models: ['grok-4.6'],
  });
  engine.addModel(created.id, 'gpt-5.6-sol');
  engine.addModel(created.id, 'deepseek-v4-flash');
  let models = engine.getProvider(created.id).models;
  assert.deepEqual(models.map((item) => item.modelId), ['grok-4.6', 'gpt-5.6-sol', 'deepseek-v4-flash']);
  assert.equal(models.find((item) => item.selected)?.modelId, 'grok-4.6');

  engine.selectModel(created.id, 'gpt-5.6-sol', { apply: false });
  models = engine.getProvider(created.id).models;
  assert.equal(models.find((item) => item.selected)?.modelId, 'gpt-5.6-sol');

  const removed = engine.removeModel(created.id, 'gpt-5.6-sol');
  assert.equal(removed.modelId, 'gpt-5.6-sol');
  models = engine.getProvider(created.id).models;
  assert.deepEqual(models.map((item) => item.modelId), ['grok-4.6', 'deepseek-v4-flash']);
  assert.equal(models.find((item) => item.selected)?.modelId, 'grok-4.6');

  assert.throws(() => engine.addModel(created.id, 'grok-4.6'), /已有模型/);
  engine.removeModel(created.id, 'deepseek-v4-flash');
  assert.throws(() => engine.removeModel(created.id, 'grok-4.6'), /至少保留一个模型/);
});

test('applyProvider uses the selected model instead of alphabetical order', () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'relay',
    apiKey: 'sk',
    openaiUrl: 'https://relay.example/v1',
    models: ['zzz-default', 'aaa-other'],
  });
  engine.setAgent('codex');
  engine.selectModel(created.id, 'aaa-other', { apply: false });
  const result = engine.use(created.id);
  assert.equal(result.model, 'aaa-other');
  const text = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
  assert.match(text, /model = "aaa-other"/);
});

test('ping sends a real test message through the agent SDK and reports the reply', async () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'local',
    apiKey: 'sk-x',
    openaiUrl: 'https://relay.example/v1',
    models: ['gpt-test'],
  });
  const result = await engine.ping(created.id, 'codex');
  assert.equal(result.ok, true);
  assert.ok(result.steps.some((step) => step.id === 'codex-sdk' && step.status === 'ok'));
  assert.ok(!result.steps.some((step) => step.id === 'openai-responses' || step.id === 'openai-models'));
  const sdk = [...result.steps].reverse().find((step) => step.id === 'codex-sdk');
  assert.match(sdk?.detail || '', /今天天气不错/);
  const log = JSON.parse(readFileSync(join(root, 'probe-log.json'), 'utf8')) as { name: string; argv: string[] };
  assert.equal(log.name, 'codex');
  assert.equal(log.argv[0], 'exec');
  assert.equal(log.argv.includes('--ephemeral'), true);
  assert.ok(log.argv.some((item) => item === 'model=gpt-test' || item.startsWith('model=gpt-test')));
});

test('ping uses the selected model, not the alphabetically first one', async () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'local',
    apiKey: 'sk-x',
    openaiUrl: 'https://relay.example/v1',
    models: ['zzz-selected', 'aaa-first'],
  });
  engine.selectModel(created.id, 'zzz-selected', { apply: false });
  const result = await engine.ping(created.id, 'codex');
  assert.equal(result.ok, true);
  const load = [...result.steps].reverse().find((step) => step.id === 'load');
  assert.match(load?.detail || '', /zzz-selected（当前）/);
  const log = JSON.parse(readFileSync(join(root, 'probe-log.json'), 'utf8')) as { argv: string[] };
  assert.ok(log.argv.includes('model=zzz-selected'));
});

test('ping uses the same randomized prompt in the SDK request and status text', async () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'local',
    apiKey: 'sk-x',
    openaiUrl: 'https://relay.example/v1',
    models: ['gpt-test'],
  });
  const result = await engine.ping(created.id, 'codex');
  const sdk = result.steps.find((step) => step.id === 'codex-sdk');
  const summary = result.steps.find((step) => step.id === 'summary');
  const titlePrompt = /「([^」]+)」/.exec(sdk?.title || '')?.[1] || '';
  assert.ok(titlePrompt.length > 0);
  assert.equal(titlePrompt.includes('连通性'), false);
  assert.ok((summary?.detail || '').includes(`「${titlePrompt}」`));
  const log = JSON.parse(readFileSync(join(root, 'probe-log.json'), 'utf8')) as { argv: string[] };
  assert.equal(log.argv.at(-1), titlePrompt);
});

test('ping maps Claude models through official aliases in the SDK env', async () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'lvyrix',
    apiKey: 'sk-x',
    anthropicUrl: 'https://api.lvyrix.com',
    agent: 'claude',
    models: ['grok-4.6'],
  });
  writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({ model: 'keep-me' }, null, 2));
  const result = await engine.ping(created.id, 'claude');
  assert.equal(result.ok, true);
  assert.ok(result.steps.some((step) => step.id === 'claude-sdk' && step.status === 'ok'));
  const log = JSON.parse(readFileSync(join(root, 'probe-log.json'), 'utf8')) as { name: string; argv: string[]; env: Record<string, string> };
  assert.equal(log.name, 'claude');
  assert.ok(log.argv.includes('sonnet'));
  assert.equal(log.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'grok-4.6');
  assert.equal(log.env.ANTHROPIC_BASE_URL, 'https://api.lvyrix.com');
  assert.equal(log.env.ANTHROPIC_AUTH_TOKEN, 'sk-x');
  assert.equal(JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8')).model, 'keep-me');
});

test('ping does not mutate the live Codex config', async () => {
  writeFileSync(join(root, '.codex', 'config.toml'), 'model = "keep-me"\n');
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'local',
    apiKey: 'sk-x',
    openaiUrl: 'https://relay.example/v1',
    models: ['gpt-test'],
  });
  const result = await engine.ping(created.id, 'codex');
  assert.equal(result.ok, true);
  assert.equal(readFileSync(join(root, '.codex', 'config.toml'), 'utf8'), 'model = "keep-me"\n');
});

test('ping treats auth errors as reachable, not down', async () => {
  process.env.MSW_PROBE_FAIL = 'auth';
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'lvyrix',
    apiKey: 'sk-bad',
    openaiUrl: 'https://relay.example/v1',
    models: ['gpt-test'],
  });
  const result = await engine.ping(created.id, 'codex');
  assert.equal(result.ok, true);
  const summary = result.steps.find((step) => step.id === 'summary');
  assert.equal(summary?.status, 'warn');
  assert.ok(result.steps.some((step) => step.id === 'codex-sdk' && step.status === 'warn'));
});

test('ping only invokes the current agent SDK', async () => {
  const engine = new Engine();
  const codexProvider = engine.addProvider({
    name: 'codex-p',
    apiKey: 'sk-x',
    openaiUrl: 'https://relay.example/v1',
    agent: 'codex',
    models: ['gpt-test'],
  });
  const claudeProvider = engine.addProvider({
    name: 'claude-p',
    apiKey: 'sk-x',
    anthropicUrl: 'https://relay.example',
    agent: 'claude',
    models: ['gpt-test'],
  });

  const codex = await engine.ping(codexProvider.id, 'codex');
  assert.equal(codex.ok, true);
  assert.ok(codex.steps.some((step) => step.id === 'codex-sdk' && step.status === 'ok'));
  assert.ok(!codex.steps.some((step) => step.id === 'claude-sdk' || step.id === 'gemini-sdk'));
  assert.equal(JSON.parse(readFileSync(join(root, 'probe-log.json'), 'utf8')).name, 'codex');

  const claude = await engine.ping(claudeProvider.id, 'claude');
  assert.equal(claude.ok, true);
  assert.ok(claude.steps.some((step) => step.id === 'claude-sdk' && step.status === 'ok'));
  assert.ok(!claude.steps.some((step) => step.id === 'codex-sdk' || step.id === 'gemini-sdk'));
  assert.equal(JSON.parse(readFileSync(join(root, 'probe-log.json'), 'utf8')).name, 'claude');
});

test('gemini only uses providers with a Gemini URL', async () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'openai-only',
    apiKey: 'sk-x',
    openaiUrl: 'https://example.test/v1',
    models: ['gpt-test'],
  });
  const result = await engine.ping(created.id, 'gemini');
  assert.equal(result.ok, false);
  assert.match(String(result.error), /Gemini/);
});

test('ping fails when current agent protocol is missing', async () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'openai-only',
    apiKey: 'sk-x',
    openaiUrl: 'https://example.test/v1',
    models: ['gpt-test'],
  });
  const result = await engine.ping(created.id, 'claude');
  assert.equal(result.ok, false);
  assert.match(String(result.error), /Anthropic/);
});

test('ping fails when the agent binary is not installed', async () => {
  process.env.PATH = ['/usr/bin', '/bin'].join(delimiter);
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'local',
    apiKey: 'sk-x',
    anthropicUrl: 'https://api.lvyrix.com',
    agent: 'claude',
    models: ['grok-4.6'],
  });
  const result = await engine.ping(created.id, 'claude');
  assert.equal(result.ok, false);
  assert.match(String(result.error), /未安装 Claude Code/);
});

test('ping gemini uses the Gemini CLI SDK', async () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'gemini-p',
    apiKey: 'sk-x',
    geminiUrl: 'https://generativelanguage.googleapis.com',
    agent: 'gemini',
    models: ['gemini-2.5-flash'],
  });
  const result = await engine.ping(created.id, 'gemini');
  assert.equal(result.ok, true);
  assert.ok(result.steps.some((step) => step.id === 'gemini-sdk' && step.status === 'ok'));
  const log = JSON.parse(readFileSync(join(root, 'probe-log.json'), 'utf8')) as { name: string; argv: string[] };
  assert.equal(log.name, 'gemini');
  assert.ok(log.argv.includes('-p'));
  assert.ok(log.argv.includes('gemini-2.5-flash'));
});

test('ping opencode uses opencode run', async () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'oc-p',
    apiKey: 'sk-x',
    openaiUrl: 'https://relay.example/v1',
    agent: 'opencode',
    models: ['gpt-test'],
  });
  const result = await engine.ping(created.id, 'opencode');
  assert.equal(result.ok, true);
  assert.ok(result.steps.some((step) => step.id === 'opencode-sdk' && step.status === 'ok'));
  const log = JSON.parse(readFileSync(join(root, 'probe-log.json'), 'utf8')) as { name: string; argv: string[] };
  assert.equal(log.name, 'opencode');
  assert.equal(log.argv[0], 'run');
});

test('listProviders returns creation order, not name order', () => {
  const engine = new Engine();
  const zeta = engine.addProvider({
    name: 'zeta',
    apiKey: 'sk-z',
    openaiUrl: 'https://z.example/v1',
    models: ['z'],
  });
  const alpha = engine.addProvider({
    name: 'alpha',
    apiKey: 'sk-a',
    openaiUrl: 'https://a.example/v1',
    models: ['a'],
  });
  assert.deepEqual(engine.listProviders().map((item) => item.id), [zeta.id, alpha.id]);
  assert.deepEqual(engine.listProviders().map((item) => item.name), ['zeta', 'alpha']);
});

test('grok-build adapter writes quoted model tables and live status', () => {
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'relay',
    apiKey: 'sk-grok',
    openaiUrl: 'https://relay.example/v1',
    wireApi: 'responses',
    agent: 'grok-build',
    models: ['grok-4.6', 'gpt-5.6-sol'],
  });
  engine.setAgent('grok-build');
  engine.use('relay');
  const text = readFileSync(join(root, '.grok', 'config.toml'), 'utf8');
  assert.match(text, /\[models\]/);
  assert.match(text, /default = "grok-4.6"/);
  assert.match(text, /\[model\."grok-4\.6"\]/);
  assert.match(text, /base_url = "https:\/\/relay.example\/v1"/);
  assert.match(text, /api_key = "sk-grok"/);
  assert.match(text, /api_backend = "responses"/);
  assert.match(text, /\[model\."grok-4\.6"\.extra_headers\]/);
  assert.match(text, /Authorization = "Bearer sk-grok"/);
  assert.match(text, /\[model\."gpt-5\.6-sol"\]/);
  const live = JSON.parse(readFileSync(join(root, '.grok', 'msw-live.json'), 'utf8')) as {
    providerId: string;
    model: string;
    baseUrl: string;
    providerLabel: string;
  };
  assert.equal(live.providerId, created.id);
  assert.equal(live.model, 'grok-4.6');
  assert.equal(live.baseUrl, 'https://relay.example/v1');
  assert.equal(live.providerLabel, 'relay');
  const status = engine.listAgents().find((item) => item.id === 'grok-build');
  assert.equal(status?.currentProviderId, created.id);
  assert.equal(status?.model, 'grok-4.6');
  const spec = engine.launch({ agent: 'grok-build' });
  assert.equal(spec.env.XAI_API_KEY, 'sk-grok');
  assert.equal(spec.env.GROK_DEFAULT_MODEL, 'grok-4.6');
  assert.equal(spec.env.GROK_XAI_API_BASE_URL, 'https://relay.example/v1');
  assert.ok(spec.args.includes('-m'));
  assert.ok(spec.args.includes('grok-4.6'));
});

test('grok-build apply maps chat wire api to chat_completions', () => {
  const engine = new Engine();
  engine.addProvider({
    name: 'kimi-relay',
    apiKey: 'sk-kimi',
    openaiUrl: 'https://api.moonshot.cn/v1',
    wireApi: 'chat',
    agent: 'grok-build',
    models: ['kimi-k2.5'],
  });
  engine.setAgent('grok-build');
  engine.use('kimi-relay');
  const text = readFileSync(join(root, '.grok', 'config.toml'), 'utf8');
  assert.match(text, /api_backend = "chat_completions"/);
  assert.match(text, /default = "kimi-k2.5"/);
});

test('ping grok-build uses grok -p and does not mutate live config', async () => {
  writeFileSync(join(root, '.grok', 'config.toml'), 'default = "keep-me"\n');
  const engine = new Engine();
  const created = engine.addProvider({
    name: 'grok-p',
    apiKey: 'sk-x',
    openaiUrl: 'https://relay.example/v1',
    agent: 'grok-build',
    models: ['grok-4.6'],
  });
  const result = await engine.ping(created.id, 'grok-build');
  assert.equal(result.ok, true);
  assert.ok(result.steps.some((step) => step.id === 'grok-build-sdk' && step.status === 'ok'));
  const log = JSON.parse(readFileSync(join(root, 'probe-log.json'), 'utf8')) as {
    name: string;
    argv: string[];
    env: Record<string, string>;
  };
  assert.equal(log.name, 'grok');
  assert.ok(log.argv.includes('-p'));
  assert.ok(log.argv.includes('--output-format'));
  assert.ok(log.argv.includes('grok-4.6'));
  assert.equal(log.env.XAI_API_KEY, 'sk-x');
  assert.equal(log.env.GROK_DEFAULT_MODEL, 'grok-4.6');
  assert.equal(readFileSync(join(root, '.grok', 'config.toml'), 'utf8'), 'default = "keep-me"\n');
});
